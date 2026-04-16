"""CIViC (Clinical Interpretation of Variants in Cancer) database connector.

Downloads the CIViC nightly evidence export and filters for CNS-tumor-relevant
predictive biomarker–therapy associations.

CIViC data is community-curated, peer-reviewed evidence linking molecular
variants to therapeutic response, prognosis, and diagnosis.

See: https://civicdb.org
"""
from __future__ import annotations

import csv
import io
import logging
import re
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

CIVIC_NIGHTLY_URL = (
    "https://civicdb.org/downloads/nightly/nightly-ClinicalEvidenceSummaries.tsv"
)
CIVIC_GRAPHQL_URL = "https://civicdb.org/api/graphql"

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
CIVIC_CACHE_PATH = DATA_DIR / "civic_evidence_cache.tsv"

# ── Disease matching ─────────────────────────────────────────────────────
# Diseases considered relevant for glioma / CNS tumor analysis.
GLIOMA_DISEASE_TERMS = [
    "glioblastoma",
    "glioma",
    "astrocytoma",
    "oligodendroglioma",
    "diffuse midline",
    "brain glioma",
    "ganglioglioma",
    "pilocytic",
    "ependymoma",
]

# Tumor-agnostic diseases where evidence may still apply to GBM patients.
AGNOSTIC_DISEASE_TERMS = [
    "solid tumor",
    "advanced solid tumor",
]

# Combined set
ALL_RELEVANT_TERMS = GLIOMA_DISEASE_TERMS + AGNOSTIC_DISEASE_TERMS

# ── Gene allowlist ───────────────────────────────────────────────────────
# Genes tracked in our TCGA patient biomarker profiles.
TARGET_GENES = {
    "IDH1", "IDH2", "EGFR", "BRAF", "MGMT", "TP53", "PTEN", "CDKN2A",
    "TERT", "ATRX", "H3-3A", "H3F3A", "NTRK1", "NTRK2", "NTRK3",
    "ALK", "ROS1", "FGFR1", "FGFR2", "FGFR3", "MET", "PDGFRA",
    "PIK3CA", "NF1", "MDM2", "CDK4", "RB1", "PMS2", "MSH2", "MSH6",
    "MLH1",  # MMR genes for MSI-H
}


@dataclass
class CIViCEvidence:
    """A single CIViC evidence item mapped to our schema."""

    evidence_id: int
    molecular_profile: str
    molecular_profile_id: int
    gene_symbols: list[str]
    variant_name: str  # e.g. "V600E", "Promoter Methylation", "Amplification"
    disease: str
    disease_doid: str
    therapies: str  # comma-separated
    therapy_interaction_type: str
    evidence_type: str  # Predictive, Prognostic, etc.
    evidence_direction: str  # Supports, Does Not Support
    evidence_level: str  # A-E
    significance: str  # Sensitivity/Response, Resistance, etc.
    evidence_statement: str
    citation: str
    citation_id: str  # PMID
    source_type: str
    rating: int
    nct_ids: str
    civic_url: str = ""

    # ── Mapping helpers ──────────────────────────────────────────────
    @property
    def biomarker_name(self) -> str:
        """Map CIViC molecular profile to our canonical biomarker name."""
        mp = self.molecular_profile
        mp_upper = mp.upper()

        # Direct matches
        if "MGMT PROMOTER METHYLATION" in mp_upper:
            return "MGMT methylated"
        if "MGMT UNDEREXPRESSION" in mp_upper:
            return "MGMT methylated"  # proxy
        if "MGMT RS16906252" in mp_upper:
            return "MGMT methylated"

        # IDH
        if re.search(r"IDH[12]\s+R\d+", mp):
            gene = "IDH1" if "IDH1" in mp else "IDH2"
            return f"{gene} mutation"
        if re.search(r"IDH[12]\s+MUTATION", mp_upper):
            return "IDH mutation"

        # EGFR
        if "EGFRVIII" in mp_upper or "EGFR VIII" in mp_upper:
            return "EGFRvIII"
        if "EGFR AMPLIFICATION" in mp_upper:
            return "EGFR amplification"
        if re.search(r"EGFR\s+[A-Z]\d+", mp):
            return "EGFR mutation"

        # BRAF
        if "BRAF V600E" in mp_upper or "BRAF V600" in mp_upper:
            return "BRAF V600E"
        if "KIAA1549" in mp_upper and "BRAF" in mp_upper:
            return "BRAF mutation"
        if re.search(r"BRAF\s+(MUTATION|FUSION)", mp_upper):
            return "BRAF mutation"

        # NTRK fusions
        if re.search(r"NTRK[123]", mp_upper) and "FUSION" in mp_upper:
            return "NTRK fusion"

        # ALK / ROS1 fusions
        if "ALK" in mp_upper and "FUSION" in mp_upper:
            return "ALK fusion"
        if "ROS1" in mp_upper and ("FUSION" in mp_upper or "GOPC" in mp_upper):
            return "ROS1 fusion"

        # FGFR
        if re.search(r"FGFR[1-3]", mp_upper) and ("FUSION" in mp_upper or "MUTATION" in mp_upper):
            return "FGFR alteration"

        # MET
        if "MET AMPLIFICATION" in mp_upper:
            return "MET amplification"
        if "MET EXON 14" in mp_upper or "MET" in mp_upper and "SKIPPING" in mp_upper:
            return "MET amplification"

        # H3K27M
        if ("H3-3A" in mp_upper or "H3F3A" in mp_upper) and "K27M" in mp_upper:
            return "H3K27M mutation"

        # PTEN
        if "PTEN" in mp_upper and ("EXPRESSION" in mp_upper or "LOSS" in mp_upper):
            return "PTEN loss"
        if "PTEN" in mp_upper and "MUTATION" in mp_upper:
            return "PTEN mutation"

        # TP53
        if "TP53" in mp_upper:
            return "TP53 mutation"

        # CDKN2A
        if "CDKN2A" in mp_upper:
            return "CDKN2A deletion"

        # TERT
        if "TERT" in mp_upper:
            return "TERT promoter mutation"

        # ATRX
        if "ATRX" in mp_upper:
            return "ATRX mutation"

        # NF1
        if "NF1" in mp_upper:
            return "NF1 mutation"

        # MDM2
        if "MDM2" in mp_upper:
            return "MDM2 amplification"

        # CDK4
        if "CDK4" in mp_upper:
            return "CDK4 amplification"

        # RB1
        if "RB1" in mp_upper:
            return "RB1 loss"

        # PIK3CA
        if "PIK3CA" in mp_upper:
            return "PIK3CA mutation"

        # PDGFRA
        if "PDGFRA" in mp_upper:
            return "PDGFRA amplification"

        # MMR / MSI
        if re.search(r"PMS2|MSH[26]|MLH1", mp_upper):
            return "MSI-H"

        # Fallback
        return mp

    @property
    def biomarker_status(self) -> str:
        """Infer biomarker status from molecular profile."""
        mp = self.molecular_profile.upper()
        if "METHYLATION" in mp or "UNDEREXPRESSION" in mp:
            return "methylated"
        if "AMPLIFICATION" in mp:
            return "amplified"
        if "LOSS" in mp or "DELETION" in mp:
            return "deleted"
        if "FUSION" in mp:
            return "present"
        if "EXPRESSION" in mp and "OVER" in mp:
            return "overexpressed"
        return "mutant"

    @property
    def biomarker_category(self) -> str:
        """Map to our biomarker category."""
        mp = self.molecular_profile.upper()
        if "METHYLATION" in mp or "UNDEREXPRESSION" in mp:
            return "methylation"
        if "AMPLIFICATION" in mp:
            return "amplification"
        if "FUSION" in mp:
            return "fusion"
        if "LOSS" in mp or "DELETION" in mp:
            return "expression"
        if "EXPRESSION" in mp:
            return "expression"
        return "mutation"

    @property
    def response_effect(self) -> str:
        """Map CIViC significance + direction to our response_effect."""
        sig = self.significance.upper()
        direction = self.evidence_direction.upper()

        if direction == "DOES NOT SUPPORT":
            # Inverted logic
            if "SENSITIVITY" in sig or "RESPONSE" in sig:
                return "resistance"
            if "RESISTANCE" in sig:
                return "sensitivity"
            return "no_effect"

        # direction == SUPPORTS
        if "SENSITIVITY" in sig or "RESPONSE" in sig:
            return "increased_response"
        if "RESISTANCE" in sig:
            return "resistance"
        if "REDUCED" in sig:
            return "decreased_response"
        if "ADVERSE" in sig:
            return "decreased_response"

        return "sensitivity"

    @property
    def mapped_evidence_level(self) -> str:
        """Map CIViC level (A-E) to our schema (level_1-4)."""
        mapping = {
            "A": "level_1",  # Validated association
            "B": "level_2",  # Clinical evidence
            "C": "level_2",  # Case study
            "D": "level_3",  # Preclinical
            "E": "level_4",  # Inferential
        }
        return mapping.get(self.evidence_level, "level_4")


def _extract_gene_symbols(molecular_profile: str) -> list[str]:
    """Extract gene symbols from a CIViC molecular profile string."""
    genes = set()
    for gene in TARGET_GENES:
        # Match gene name at word boundary
        if re.search(rf"\b{re.escape(gene)}\b", molecular_profile, re.IGNORECASE):
            genes.add(gene)
    return sorted(genes)


def _parse_variant_name(molecular_profile: str) -> str:
    """Extract the variant portion from a molecular profile."""
    mp = molecular_profile.strip()
    # Try to extract "GENE VARIANT" pattern
    for gene in TARGET_GENES:
        pattern = rf"\b{re.escape(gene)}\s+(.+)"
        m = re.search(pattern, mp, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return mp


# ── Data fetching ────────────────────────────────────────────────────────

def download_nightly_evidence(force: bool = False) -> list[dict]:
    """Download CIViC nightly evidence TSV and return as list of dicts.

    Caches to disk for 24 hours unless force=True.
    """
    if not force and CIVIC_CACHE_PATH.exists():
        age_hours = (time.time() - CIVIC_CACHE_PATH.stat().st_mtime) / 3600
        if age_hours < 24:
            logger.info("Using cached CIViC data (%.1f hours old)", age_hours)
            with open(CIVIC_CACHE_PATH, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f, delimiter="\t")
                return list(reader)

    logger.info("Downloading CIViC nightly evidence from %s", CIVIC_NIGHTLY_URL)
    req = urllib.request.Request(
        CIVIC_NIGHTLY_URL,
        headers={"User-Agent": "CT-Pipeline/0.1.0"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8")

    # Cache to disk
    CIVIC_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CIVIC_CACHE_PATH, "w", encoding="utf-8") as f:
        f.write(raw)
    logger.info("Cached CIViC data to %s", CIVIC_CACHE_PATH)

    reader = csv.DictReader(io.StringIO(raw), delimiter="\t")
    return list(reader)


def _is_relevant_disease(disease_name: str) -> tuple[bool, str]:
    """Check if a disease name is relevant to our CNS tumor context.

    Returns (is_relevant, disease_context) where disease_context is
    'GBM', 'Glioma', 'DMG', 'Solid tumors', etc.
    """
    dl = disease_name.lower()
    if "glioblastoma" in dl:
        return True, "GBM"
    if "diffuse midline" in dl:
        return True, "DMG"
    if "oligodendroglioma" in dl:
        return True, "Oligodendroglioma"
    if "astrocytoma" in dl:
        return True, "Astrocytoma"
    if "pilocytic" in dl:
        return True, "Pilocytic astrocytoma"
    if "low grade glioma" in dl or "low-grade glioma" in dl:
        return True, "Low-grade glioma"
    if "high grade glioma" in dl or "high-grade glioma" in dl:
        return True, "High-grade glioma"
    if "glioma" in dl:
        return True, "Glioma"
    if "brain" in dl and ("glioma" in dl or "glioblastoma" in dl):
        return True, "GBM"
    if "ganglioglioma" in dl:
        return True, "Ganglioglioma"
    if "ependymoma" in dl:
        return True, "Ependymoma"
    if "solid tumor" in dl:
        return True, "Solid tumors"
    return False, ""


def _has_target_gene(molecular_profile: str) -> bool:
    """Check if the molecular profile mentions any of our target genes."""
    mp_upper = molecular_profile.upper()
    for gene in TARGET_GENES:
        if gene.upper() in mp_upper:
            return True
    return False


def filter_relevant_evidence(
    all_evidence: list[dict],
    include_non_glioma_gene_matches: bool = True,
) -> list[CIViCEvidence]:
    """Filter CIViC evidence to items relevant for our application.

    Selection criteria:
    1. evidence_type == 'Predictive' (therapy response)
    2. Disease is glioma-related OR (gene is in our target list AND disease is tumor-agnostic)
    3. Molecular profile mentions one of our target genes

    Args:
        all_evidence: Raw rows from the nightly TSV.
        include_non_glioma_gene_matches: If True, also include non-glioma
            evidence for our target genes (useful for tumor-agnostic
            FDA approvals like NTRK inhibitors).
    """
    results: list[CIViCEvidence] = []
    seen_ids: set[int] = set()

    for row in all_evidence:
        # Must be Predictive evidence
        if row.get("evidence_type") != "Predictive":
            continue

        eid = int(row.get("evidence_id", 0))
        if eid in seen_ids:
            continue

        mp = row.get("molecular_profile", "")
        disease = row.get("disease", "")

        # Check disease relevance
        is_relevant, disease_context = _is_relevant_disease(disease)

        # For non-glioma diseases, only include if gene matches AND agnostic
        if not is_relevant:
            if include_non_glioma_gene_matches and _has_target_gene(mp):
                # Include tumor-agnostic or high-evidence items for our genes
                level = row.get("evidence_level", "")
                if level in ("A", "B"):
                    is_relevant = True
                    disease_context = disease  # Keep original disease name
            if not is_relevant:
                continue

        # Must mention one of our target genes
        if not _has_target_gene(mp):
            continue

        gene_symbols = _extract_gene_symbols(mp)
        variant_name = _parse_variant_name(mp)

        try:
            rating = int(row.get("rating") or 0)
        except (ValueError, TypeError):
            rating = 0

        evidence = CIViCEvidence(
            evidence_id=eid,
            molecular_profile=mp,
            molecular_profile_id=int(row.get("molecular_profile_id", 0)),
            gene_symbols=gene_symbols,
            variant_name=variant_name,
            disease=disease,
            disease_doid=row.get("doid", ""),
            therapies=row.get("therapies", ""),
            therapy_interaction_type=row.get("therapy_interaction_type", ""),
            evidence_type=row.get("evidence_type", ""),
            evidence_direction=row.get("evidence_direction", ""),
            evidence_level=row.get("evidence_level", ""),
            significance=row.get("significance", ""),
            evidence_statement=row.get("evidence_statement", ""),
            citation=row.get("citation", ""),
            citation_id=row.get("citation_id", ""),
            source_type=row.get("source_type", ""),
            rating=rating,
            nct_ids=row.get("nct_ids", ""),
        )

        seen_ids.add(eid)
        results.append(evidence)

    logger.info(
        "Filtered %d relevant CIViC evidence items from %d total",
        len(results),
        len(all_evidence),
    )
    return results
