"""Fetch and cache comprehensive biomarker data for TCGA-GBM patients from NCI GDC.

Queries the GDC API for:
  - Somatic mutations (SSM occurrences) per case
  - Copy number variations (CNV occurrences) per case for key oncogenes
  - Clinical data (recurrence status, demographics)

Builds a per-patient biomarker profile keyed by TCGA aliquot barcode
and caches the result as JSON for use by the simulation engine.
"""

import json
import logging
import os
import time
from collections import defaultdict
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

GDC_API_BASE = "https://api.gdc.cancer.gov"
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
BIOMARKER_CACHE_PATH = os.path.join(DATA_DIR, "tcga_patient_biomarkers.json")

# Key biomarker genes to query for CNV data
CNV_GENES = [
    "EGFR", "CDKN2A", "PTEN", "CDK4", "MDM2", "PDGFRA", "MET",
    "BRAF", "NF1", "RB1", "PIK3CA", "NTRK1", "NTRK2", "NTRK3",
    "ALK", "ROS1", "FGFR1", "FGFR2", "FGFR3", "MYC", "MYCN",
    # 1p/19q codeletion sentinel genes
    "FUBP1", "CAMTA1", "CHD5",  # 1p arm
    "CIC", "TGFB1",             # 19q arm
]


def barcode_to_case_id(barcode: str) -> str:
    """Convert TCGA aliquot barcode to case/participant ID.

    TCGA-06-0125-02 -> TCGA-06-0125
    """
    parts = barcode.split("-")
    if len(parts) >= 3:
        return "-".join(parts[:3])
    return barcode


class TCGABiomarkerFetcher:
    """Fetches comprehensive per-patient biomarker data from GDC."""

    def __init__(self, project: str = "TCGA-GBM", timeout: float = 120.0):
        self.project = project
        self.cache_path = BIOMARKER_CACHE_PATH
        self.timeout = timeout

    # ── Cache management ─────────────────────────────────────────────────

    def load_cached(self) -> Optional[dict]:
        """Load cached biomarker data if available."""
        if os.path.exists(self.cache_path):
            try:
                with open(self.cache_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if "patients" in data:
                    logger.info(
                        "Loaded cached biomarker data for %d patients",
                        len(data["patients"]),
                    )
                    return data
            except (json.JSONDecodeError, OSError) as e:
                logger.warning("Failed to load biomarker cache: %s", e)
        return None

    def save_cache(self, data: dict):
        """Save biomarker data to cache."""
        os.makedirs(os.path.dirname(self.cache_path), exist_ok=True)
        with open(self.cache_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)
        n_patients = len(data.get("patients", {}))
        logger.info("Saved biomarker data for %d patients to %s", n_patients, self.cache_path)

    # ── GDC API queries ──────────────────────────────────────────────────

    def fetch_mutations(self, progress_cb=None) -> dict[str, list[dict]]:
        """Fetch somatic mutations from GDC for all TCGA-GBM cases.

        Returns: {case_submitter_id: [{gene, aa_change, consequence_type, vep_impact}, ...]}
        """
        mutations: dict[str, list[dict]] = defaultdict(list)
        url = f"{GDC_API_BASE}/ssm_occurrences"
        page_size = 5000
        offset = 0
        total_fetched = 0

        while True:
            params = {
                "filters": json.dumps({
                    "op": "=",
                    "content": {
                        "field": "case.project.project_id",
                        "value": self.project,
                    },
                }),
                "fields": ",".join([
                    "case.submitter_id",
                    "ssm.consequence.transcript.gene.symbol",
                    "ssm.consequence.transcript.aa_change",
                    "ssm.consequence.transcript.consequence_type",
                    "ssm.consequence.transcript.annotation.vep_impact",
                ]),
                "size": page_size,
                "from": offset,
            }

            try:
                resp = httpx.get(url, params=params, timeout=self.timeout)
                resp.raise_for_status()
                data = resp.json()
            except Exception as e:
                logger.error("GDC mutation query failed at offset %d: %s", offset, e)
                break

            hits = data.get("data", {}).get("hits", [])
            if not hits:
                break

            for hit in hits:
                case_id = (hit.get("case") or {}).get("submitter_id", "")
                if not case_id:
                    continue

                ssm = hit.get("ssm") or {}
                consequences = ssm.get("consequence") or []
                # Track unique mutations per gene to avoid transcript duplicates
                seen_for_case = set()
                for csq in consequences:
                    transcript = csq.get("transcript") or {}
                    gene_info = transcript.get("gene") or {}
                    gene = gene_info.get("symbol", "")
                    aa_change = transcript.get("aa_change", "") or ""
                    if not gene:
                        continue
                    key = (gene, aa_change)
                    if key in seen_for_case:
                        continue
                    seen_for_case.add(key)

                    mutations[case_id].append({
                        "gene": gene,
                        "aa_change": aa_change,
                        "consequence_type": transcript.get("consequence_type", ""),
                        "vep_impact": (transcript.get("annotation") or {}).get("vep_impact", ""),
                    })

            total_fetched += len(hits)
            offset += page_size

            pagination = data.get("data", {}).get("pagination", {})
            total = pagination.get("total", 0)
            pct = min(100, int(offset / max(total, 1) * 100))

            if progress_cb:
                progress_cb("fetching_mutations", f"{total_fetched}/{total} SSM occurrences", pct * 0.5)

            logger.info("Fetched %d/%d SSM occurrences...", total_fetched, total)

            if offset >= total:
                break

            time.sleep(0.3)  # Rate limiting

        logger.info(
            "Fetched mutations for %d cases (%d total occurrences)",
            len(mutations), total_fetched,
        )
        return dict(mutations)

    def fetch_cnv(self, progress_cb=None) -> dict[str, list[dict]]:
        """Fetch gene-level CNV data from GDC for key oncogenes.

        Returns: {case_submitter_id: [{gene, cnv_change}, ...]}
        """
        cnv_data: dict[str, list[dict]] = defaultdict(list)
        url = f"{GDC_API_BASE}/cnv_occurrences"
        page_size = 5000
        offset = 0
        total_fetched = 0

        while True:
            params = {
                "filters": json.dumps({
                    "op": "and",
                    "content": [
                        {
                            "op": "=",
                            "content": {
                                "field": "case.project.project_id",
                                "value": self.project,
                            },
                        },
                        {
                            "op": "in",
                            "content": {
                                "field": "cnv.consequence.gene.symbol",
                                "value": CNV_GENES,
                            },
                        },
                    ],
                }),
                "fields": ",".join([
                    "case.submitter_id",
                    "cnv.cnv_change",
                    "cnv.consequence.gene.symbol",
                ]),
                "size": page_size,
                "from": offset,
            }

            try:
                resp = httpx.get(url, params=params, timeout=self.timeout)
                resp.raise_for_status()
                data = resp.json()
            except Exception as e:
                logger.error("GDC CNV query failed at offset %d: %s", offset, e)
                break

            hits = data.get("data", {}).get("hits", [])
            if not hits:
                break

            for hit in hits:
                case_id = (hit.get("case") or {}).get("submitter_id", "")
                if not case_id:
                    continue

                cnv = hit.get("cnv") or {}
                cnv_change = cnv.get("cnv_change", "")
                consequences = cnv.get("consequence") or []
                for csq in consequences:
                    gene = (csq.get("gene") or {}).get("symbol", "")
                    if gene and cnv_change:
                        cnv_data[case_id].append({
                            "gene": gene,
                            "cnv_change": cnv_change,
                        })

            total_fetched += len(hits)
            offset += page_size

            pagination = data.get("data", {}).get("pagination", {})
            total = pagination.get("total", 0)

            if progress_cb:
                pct = min(100, int(offset / max(total, 1) * 100))
                progress_cb("fetching_cnv", f"{total_fetched}/{total} CNV occurrences", 50 + pct * 0.25)

            logger.info("Fetched %d/%d CNV occurrences...", total_fetched, total)

            if offset >= total:
                break

            time.sleep(0.3)

        logger.info(
            "Fetched CNV data for %d cases (%d occurrences)",
            len(cnv_data), total_fetched,
        )
        return dict(cnv_data)

    def fetch_clinical(self, progress_cb=None) -> dict[str, dict]:
        """Fetch clinical data from GDC including recurrence status."""
        cases: dict[str, dict] = {}
        url = f"{GDC_API_BASE}/cases"
        page_size = 100
        offset = 0

        while True:
            params = {
                "filters": json.dumps({
                    "op": "=",
                    "content": {
                        "field": "project.project_id",
                        "value": self.project,
                    },
                }),
                "fields": ",".join([
                    "submitter_id",
                    "diagnoses.age_at_diagnosis",
                    "diagnoses.primary_diagnosis",
                    "diagnoses.tissue_or_organ_of_origin",
                    "diagnoses.tumor_grade",
                    "diagnoses.tumor_stage",
                    "diagnoses.morphology",
                    "diagnoses.progression_or_recurrence",
                    "diagnoses.prior_treatment",
                    "diagnoses.treatments.treatment_type",
                    "demographic.gender",
                    "demographic.vital_status",
                    "demographic.days_to_death",
                    "demographic.race",
                    "demographic.ethnicity",
                ]),
                "size": page_size,
                "from": offset,
            }

            try:
                resp = httpx.get(url, params=params, timeout=60)
                resp.raise_for_status()
                data = resp.json()
            except Exception as e:
                logger.error("GDC clinical query failed at offset %d: %s", offset, e)
                break

            hits = data.get("data", {}).get("hits", [])
            if not hits:
                break

            for hit in hits:
                sid = hit.get("submitter_id", "")
                if not sid:
                    continue

                diagnoses = hit.get("diagnoses") or [{}]
                diag = diagnoses[0] if diagnoses else {}
                demo = hit.get("demographic") or {}

                # Check treatments for prior TMZ/bevacizumab
                treatments = []
                for d in diagnoses:
                    for tx in (d.get("treatments") or []):
                        tt = tx.get("treatment_type", "")
                        if tt:
                            treatments.append(tt)

                recurrence = diag.get("progression_or_recurrence", "")
                prior_treatment = diag.get("prior_treatment", "")

                cases[sid] = {
                    "age_at_diagnosis_days": diag.get("age_at_diagnosis"),
                    "primary_diagnosis": diag.get("primary_diagnosis", ""),
                    "tumor_grade": diag.get("tumor_grade", ""),
                    "progression_or_recurrence": recurrence or "",
                    "prior_treatment": prior_treatment or "",
                    "treatment_types": treatments,
                    "gender": demo.get("gender", ""),
                    "vital_status": demo.get("vital_status", ""),
                    "race": demo.get("race", ""),
                    "ethnicity": demo.get("ethnicity", ""),
                }

            offset += page_size
            pagination = data.get("data", {}).get("pagination", {})
            total = pagination.get("total", 0)

            if progress_cb:
                pct = min(100, int(offset / max(total, 1) * 100))
                progress_cb("fetching_clinical", f"{len(cases)}/{total} cases", 75 + pct * 0.25)

            if offset >= total:
                break

            time.sleep(0.2)

        logger.info("Fetched clinical data for %d cases", len(cases))
        return cases

    # ── Profile building ─────────────────────────────────────────────────

    def build_patient_biomarkers(
        self,
        patient_barcodes: list[str],
        progress_cb=None,
    ) -> dict:
        """Build comprehensive biomarker profiles for specified patients.

        Returns structure:
        {
            "_meta": {...},
            "patients": {
                "TCGA-06-0125-02": {
                    "case_id": "TCGA-06-0125",
                    "mutations": {"IDH1": [{"aa_change": "R132H", ...}], ...},
                    "cnv": {"EGFR": "Gain", "CDKN2A": "Loss", ...},
                    "clinical": {"progression_or_recurrence": "...", ...},
                },
                ...
            }
        }
        """
        # Map barcodes to case IDs
        barcode_to_case: dict[str, str] = {}
        case_to_barcodes: dict[str, list[str]] = defaultdict(list)
        for bc in patient_barcodes:
            case_id = barcode_to_case_id(bc)
            barcode_to_case[bc] = case_id
            case_to_barcodes[case_id].append(bc)

        unique_case_ids = set(barcode_to_case.values())
        logger.info(
            "Building biomarker profiles: %d barcodes -> %d unique cases",
            len(patient_barcodes), len(unique_case_ids),
        )

        # Fetch data from GDC
        logger.info("Fetching mutation data from GDC...")
        mutations_by_case = self.fetch_mutations(progress_cb)

        logger.info("Fetching CNV data from GDC...")
        cnv_by_case = self.fetch_cnv(progress_cb)

        logger.info("Fetching clinical data from GDC...")
        clinical_by_case = self.fetch_clinical(progress_cb)

        # Build per-patient profiles
        profiles: dict[str, dict] = {}
        matched_mutations = 0
        matched_cnv = 0
        matched_clinical = 0

        for barcode in patient_barcodes:
            case_id = barcode_to_case[barcode]

            # Mutations: build gene -> [mutation_details] dict
            case_mutations = mutations_by_case.get(case_id, [])
            mutated_genes: dict[str, list[dict]] = defaultdict(list)
            for mut in case_mutations:
                gene = mut["gene"]
                mutated_genes[gene].append({
                    "aa_change": mut["aa_change"],
                    "consequence_type": mut["consequence_type"],
                    "vep_impact": mut["vep_impact"],
                })
            if mutated_genes:
                matched_mutations += 1

            # CNV: build gene -> change_type dict
            case_cnv = cnv_by_case.get(case_id, [])
            cnv_summary: dict[str, str] = {}
            for entry in case_cnv:
                gene = entry["gene"]
                change = entry["cnv_change"]
                # Keep the most severe change if multiple
                if gene not in cnv_summary or change in ("Gain", "Loss"):
                    cnv_summary[gene] = change

            if cnv_summary:
                matched_cnv += 1

            # Clinical
            clinical = clinical_by_case.get(case_id, {})
            if clinical:
                matched_clinical += 1

            # Infer 1p/19q codeletion from sentinel gene losses
            has_1p_loss = any(
                cnv_summary.get(g, "").lower() == "loss"
                for g in ("FUBP1", "CAMTA1", "CHD5")
            )
            has_19q_loss = any(
                cnv_summary.get(g, "").lower() == "loss"
                for g in ("CIC", "TGFB1")
            )
            clinical["codeletion_1p19q"] = "codeleted" if (has_1p_loss and has_19q_loss) else "intact"

            profiles[barcode] = {
                "case_id": case_id,
                "mutations": dict(mutated_genes),
                "cnv": cnv_summary,
                "clinical": clinical,
            }

        logger.info(
            "Built profiles: %d patients, %d with mutations, %d with CNV, %d with clinical",
            len(profiles), matched_mutations, matched_cnv, matched_clinical,
        )

        result = {
            "_meta": {
                "project": self.project,
                "total_patients": len(profiles),
                "patients_with_mutations": matched_mutations,
                "patients_with_cnv": matched_cnv,
                "patients_with_clinical": matched_clinical,
                "cnv_genes_queried": CNV_GENES,
            },
            "patients": profiles,
        }

        return result

    def fetch_and_cache(
        self,
        patient_barcodes: list[str],
        force_refresh: bool = False,
        progress_cb=None,
    ) -> dict:
        """Fetch biomarker data and cache it. Returns the full data dict.

        If cached data exists and covers all requested patients, uses cache.
        """
        if not force_refresh:
            cached = self.load_cached()
            if cached:
                cached_patients = set(cached.get("patients", {}).keys())
                missing = [bc for bc in patient_barcodes if bc not in cached_patients]
                if not missing:
                    return cached
                logger.info(
                    "%d patients missing from cache (%d cached), refetching...",
                    len(missing), len(cached_patients),
                )

        data = self.build_patient_biomarkers(patient_barcodes, progress_cb)
        self.save_cache(data)
        return data
