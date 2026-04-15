"""WHO 2021 CNS Tumor Classification engine.

Implements the WHO 2021 5th Edition classification for diffuse gliomas,
which integrates molecular markers (IDH, 1p/19q, CDKN2A, H3K27M) with
histological grading. This replaces the older histology-only approach.

Key decision tree:
  - IDH-wildtype + diffuse astrocytic + adult = Glioblastoma, IDH-wildtype (Grade 4)
    * Even if histologically Grade 2/3, molecular features (TERT, EGFR, +7/-10) can
      upgrade to Grade 4 per WHO 2021 criteria
  - IDH-mutant + no 1p/19q codeletion = Astrocytoma, IDH-mutant (Grade 2-4)
    * Grade 4 replaces the old "secondary glioblastoma" designation
    * CDKN2A/B homozygous deletion upgrades to Grade 4
  - IDH-mutant + 1p/19q codeletion = Oligodendroglioma, IDH-mutant (Grade 2-3)
  - H3K27M = Diffuse midline glioma, H3 K27-altered (Grade 4)

References:
  Louis et al. (2021). The 2021 WHO Classification of Tumors of the
  Central Nervous System: a summary. Neuro-Oncology, 23(8), 1231-1251.
"""

import logging
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class WHOGliomaType(str, Enum):
    """WHO 2021 diffuse glioma integrated diagnoses."""

    GLIOBLASTOMA_IDH_WT = "Glioblastoma, IDH-wildtype"
    ASTROCYTOMA_IDH_MUT = "Astrocytoma, IDH-mutant"
    OLIGODENDROGLIOMA = "Oligodendroglioma, IDH-mutant and 1p/19q-codeleted"
    DIFFUSE_MIDLINE_GLIOMA = "Diffuse midline glioma, H3 K27-altered"
    # Catch-all for cases lacking sufficient molecular data
    GLIOMA_NOS = "Diffuse glioma, NOS"
    # Non-glioma / not classifiable
    UNCLASSIFIABLE = "Unclassifiable"


class WHOGrade(str, Enum):
    """WHO CNS tumor grades (Arabic numerals per WHO 2021)."""

    GRADE_1 = "Grade 1"
    GRADE_2 = "Grade 2"
    GRADE_3 = "Grade 3"
    GRADE_4 = "Grade 4"
    UNKNOWN = "Unknown"


class MolecularStatus(str, Enum):
    """Standardized molecular marker status values."""

    POSITIVE = "positive"
    NEGATIVE = "negative"
    UNKNOWN = "unknown"


# ---------------------------------------------------------------------------
# Result model
# ---------------------------------------------------------------------------

class WHOClassificationResult(BaseModel):
    """Result of WHO 2021 classification for a single patient or trial."""

    who_type: WHOGliomaType = WHOGliomaType.UNCLASSIFIABLE
    who_grade: WHOGrade = WHOGrade.UNKNOWN
    who_grade_min: WHOGrade = WHOGrade.UNKNOWN  # For trials: min eligible grade
    who_grade_max: WHOGrade = WHOGrade.UNKNOWN  # For trials: max eligible grade

    # Molecular basis
    idh_status: MolecularStatus = MolecularStatus.UNKNOWN
    codeletion_1p19q: MolecularStatus = MolecularStatus.UNKNOWN
    mgmt_status: MolecularStatus = MolecularStatus.UNKNOWN
    cdkn2a_status: MolecularStatus = MolecularStatus.UNKNOWN
    h3k27m_status: MolecularStatus = MolecularStatus.UNKNOWN
    tert_promoter: MolecularStatus = MolecularStatus.UNKNOWN
    egfr_amplification: MolecularStatus = MolecularStatus.UNKNOWN

    # Classification metadata
    confidence: str = "low"  # "high", "medium", "low"
    molecular_basis: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Molecular marker normalization
# ---------------------------------------------------------------------------

def _normalize_marker_status(
    biomarkers: dict[str, str],
    marker_keys: list[str],
    positive_values: list[str] | None = None,
    negative_values: list[str] | None = None,
) -> MolecularStatus:
    """Check multiple biomarker keys and return a normalized status.

    Args:
        biomarkers: Dict mapping marker names to status strings.
        marker_keys: Ordered list of keys to check (first match wins).
        positive_values: Strings indicating positive (default: common positives).
        negative_values: Strings indicating negative (default: common negatives).
    """
    if positive_values is None:
        positive_values = [
            "positive", "mutant", "mutated", "present", "detected",
            "amplified", "methylated", "yes", "true", "1", "required",
            "loss", "deleted", "deletion", "codeleted", "codeletion",
        ]
    if negative_values is None:
        negative_values = [
            "negative", "wild-type", "wildtype", "wt", "absent",
            "not detected", "none", "no", "false", "0", "intact",
            "unmethylated", "excluded",
        ]

    for key in marker_keys:
        val = biomarkers.get(key, "").strip().lower()
        if not val or val in ("unknown", "not tested", "na", "n/a"):
            continue
        if any(p in val for p in positive_values):
            return MolecularStatus.POSITIVE
        if any(n in val for n in negative_values):
            return MolecularStatus.NEGATIVE
        # If we got a value but can't classify it, note but continue
        logger.debug("Ambiguous marker value: %s = %s", key, val)

    return MolecularStatus.UNKNOWN


def normalize_biomarker_dict(biomarkers: dict[str, str]) -> dict[str, MolecularStatus]:
    """Normalize a raw biomarker dict into standardized molecular statuses.

    Accepts biomarker dicts from:
      - BiomarkerMatch.marker -> BiomarkerMatch.requirement (from biomarker_extractor)
      - TCGA molecular data dicts
      - Manual user input

    Returns dict with keys: idh, 1p19q, mgmt, cdkn2a, h3k27m, tert, egfr_amp
    """
    # Handle IDH specially: "IDH wild-type" means NEGATIVE (no mutation)
    idh_status = MolecularStatus.UNKNOWN

    # First check explicit IDH mutation markers
    idh_mutation_status = _normalize_marker_status(
        biomarkers,
        ["IDH mutation", "IDH1 mutation", "IDH2 mutation", "IDH1 R132H mutation",
         "idh_status", "idh"],
        positive_values=["positive", "mutant", "mutated", "present", "detected",
                         "required", "yes", "true", "1"],
        negative_values=["negative", "wild-type", "wildtype", "wt", "absent",
                         "not detected", "excluded", "no", "false", "0"],
    )
    if idh_mutation_status != MolecularStatus.UNKNOWN:
        idh_status = idh_mutation_status
    else:
        # Check for IDH wild-type markers (inverted: WT present = mutation absent)
        wt_val = biomarkers.get("IDH wild-type", "").strip().lower()
        if wt_val and wt_val not in ("unknown", "not tested", "na", "n/a"):
            # Any indication of WT = IDH mutation is NEGATIVE
            if any(p in wt_val for p in ["positive", "required", "present", "detected", "yes", "true", "1",
                                          "wild-type", "wildtype", "wt", "confirmed"]):
                idh_status = MolecularStatus.NEGATIVE
            elif any(n in wt_val for n in ["negative", "excluded", "absent", "no", "false", "0"]):
                idh_status = MolecularStatus.POSITIVE  # WT excluded = mutation present

    return {
        "idh": idh_status,
        "1p19q": _normalize_marker_status(
            biomarkers,
            ["1p/19q codeletion", "1p/19q", "codeletion_1p19q", "1p19q"],
        ),
        "mgmt": _normalize_marker_status(
            biomarkers,
            ["MGMT promoter methylated", "MGMT methylated", "MGMT unmethylated",
             "MGMT status known", "mgmt_status", "mgmt"],
            positive_values=["positive", "methylated", "present", "yes", "required"],
            negative_values=["negative", "unmethylated", "absent", "no", "excluded"],
        ),
        "cdkn2a": _normalize_marker_status(
            biomarkers,
            ["CDKN2A deletion", "CDKN2A/B deletion", "cdkn2a_status", "cdkn2a"],
            positive_values=["positive", "deleted", "deletion", "loss", "homozygous",
                             "present", "detected", "required"],
            negative_values=["negative", "intact", "absent", "no", "excluded"],
        ),
        "h3k27m": _normalize_marker_status(
            biomarkers,
            ["H3K27M mutation", "H3 K27M", "H3F3A K27M", "h3k27m_status", "h3k27m"],
        ),
        "tert": _normalize_marker_status(
            biomarkers,
            ["TERT promoter mutation", "tert_promoter", "tert"],
        ),
        "egfr_amp": _normalize_marker_status(
            biomarkers,
            ["EGFR amplification", "egfr_amplification", "egfr_amp"],
        ),
    }


# ---------------------------------------------------------------------------
# IDH wild-type special handling
# ---------------------------------------------------------------------------

def _check_idh_wt_special(biomarkers: dict[str, str]) -> bool:
    """Check for IDH wild-type mentions that should override IDH unknown.

    Some eligibility texts explicitly require "IDH wild-type" which means
    IDH negative (no mutation). This catches the common patterns.
    """
    wt_keys = ["IDH wild-type", "idh_wildtype", "idh_wt"]
    for key in wt_keys:
        val = biomarkers.get(key, "").strip().lower()
        if val and val not in ("unknown", "not tested", "na", "n/a"):
            return True
    return False


# ---------------------------------------------------------------------------
# Core WHO 2021 decision tree
# ---------------------------------------------------------------------------

def classify_patient(
    biomarkers: dict[str, str],
    histological_grade: str = "",
    is_diffuse: bool = True,
    is_midline: bool = False,
    age_years: int | None = None,
) -> WHOClassificationResult:
    """Classify a case using the WHO 2021 CNS tumor classification.

    This implements the integrated molecular-histological decision tree
    for adult-type diffuse gliomas.

    Args:
        biomarkers: Dict mapping marker names to status strings.
            Accepts both canonical names from biomarker_extractor and
            shorthand keys (idh, 1p19q, mgmt, cdkn2a, h3k27m, tert, egfr_amp).
        histological_grade: Optional histological grade string (e.g., "IV", "3", "Grade 2").
        is_diffuse: Whether the tumor is diffuse (default True for glioma pipeline).
        is_midline: Whether the tumor is in a midline location.
        age_years: Patient age in years (used for pediatric vs adult distinction).

    Returns:
        WHOClassificationResult with type, grade, and molecular basis.
    """
    result = WHOClassificationResult()
    mol = normalize_biomarker_dict(biomarkers)

    result.idh_status = mol["idh"]
    result.codeletion_1p19q = mol["1p19q"]
    result.mgmt_status = mol["mgmt"]
    result.cdkn2a_status = mol["cdkn2a"]
    result.h3k27m_status = mol["h3k27m"]
    result.tert_promoter = mol["tert"]
    result.egfr_amplification = mol["egfr_amp"]

    # Check for explicit IDH wild-type mentions
    if mol["idh"] == MolecularStatus.UNKNOWN and _check_idh_wt_special(biomarkers):
        mol["idh"] = MolecularStatus.NEGATIVE
        result.idh_status = MolecularStatus.NEGATIVE
        result.molecular_basis.append("IDH wild-type (explicit mention)")

    # Parse histological grade
    hist_grade = _parse_grade(histological_grade)

    # -----------------------------------------------------------------------
    # Decision tree (order matters)
    # -----------------------------------------------------------------------

    # 1. H3 K27M-altered diffuse midline glioma
    if mol["h3k27m"] == MolecularStatus.POSITIVE:
        result.who_type = WHOGliomaType.DIFFUSE_MIDLINE_GLIOMA
        result.who_grade = WHOGrade.GRADE_4
        result.who_grade_min = WHOGrade.GRADE_4
        result.who_grade_max = WHOGrade.GRADE_4
        result.molecular_basis.append("H3 K27M mutation detected")
        result.confidence = "high"
        if is_midline:
            result.molecular_basis.append("Midline location confirmed")
        else:
            result.notes.append("Midline location not confirmed; classification based on H3K27M alone")
            result.confidence = "medium"
        return result

    # 2. IDH-mutant with 1p/19q codeletion -> Oligodendroglioma
    if mol["idh"] == MolecularStatus.POSITIVE and mol["1p19q"] == MolecularStatus.POSITIVE:
        result.who_type = WHOGliomaType.OLIGODENDROGLIOMA
        result.molecular_basis.extend(["IDH-mutant", "1p/19q codeleted"])
        result.confidence = "high"
        # Oligodendrogliomas are Grade 2 or 3 (never 4 per WHO 2021)
        if hist_grade in (WHOGrade.GRADE_2, WHOGrade.GRADE_3):
            result.who_grade = hist_grade
        else:
            result.who_grade = WHOGrade.GRADE_2  # Default
            result.notes.append("Histological grade not specified; defaulting to Grade 2")
        result.who_grade_min = WHOGrade.GRADE_2
        result.who_grade_max = WHOGrade.GRADE_3
        return result

    # 3. IDH-mutant without 1p/19q codeletion -> Astrocytoma, IDH-mutant
    if mol["idh"] == MolecularStatus.POSITIVE:
        result.who_type = WHOGliomaType.ASTROCYTOMA_IDH_MUT
        result.molecular_basis.append("IDH-mutant")
        if mol["1p19q"] == MolecularStatus.NEGATIVE:
            result.molecular_basis.append("1p/19q intact")
        result.confidence = "high"

        # CDKN2A/B homozygous deletion -> Grade 4 (molecular upgrade)
        if mol["cdkn2a"] == MolecularStatus.POSITIVE:
            result.who_grade = WHOGrade.GRADE_4
            result.molecular_basis.append("CDKN2A/B homozygous deletion (molecular Grade 4)")
        elif hist_grade != WHOGrade.UNKNOWN:
            result.who_grade = hist_grade
        else:
            result.who_grade = WHOGrade.GRADE_2  # Default conservative
            result.notes.append("Grade not determinable; defaulting to Grade 2")

        result.who_grade_min = WHOGrade.GRADE_2
        result.who_grade_max = WHOGrade.GRADE_4
        return result

    # 4. IDH-wildtype -> Glioblastoma, IDH-wildtype (with molecular criteria)
    if mol["idh"] == MolecularStatus.NEGATIVE:
        result.who_type = WHOGliomaType.GLIOBLASTOMA_IDH_WT
        result.molecular_basis.append("IDH-wildtype")
        result.who_grade = WHOGrade.GRADE_4
        result.who_grade_min = WHOGrade.GRADE_4
        result.who_grade_max = WHOGrade.GRADE_4

        # WHO 2021: even histologically lower-grade IDH-wt astrocytomas are
        # upgraded to GBM Grade 4 if they have ANY of:
        #   - TERT promoter mutation
        #   - EGFR amplification
        #   - +7/-10 (chromosome 7 gain / chromosome 10 loss)
        molecular_upgrade_evidence = []
        if mol["tert"] == MolecularStatus.POSITIVE:
            molecular_upgrade_evidence.append("TERT promoter mutation")
        if mol["egfr_amp"] == MolecularStatus.POSITIVE:
            molecular_upgrade_evidence.append("EGFR amplification")

        if molecular_upgrade_evidence:
            result.molecular_basis.extend(molecular_upgrade_evidence)
            result.notes.append("Molecular features confirm Grade 4 per WHO 2021 criteria")
            result.confidence = "high"
        elif hist_grade == WHOGrade.GRADE_4:
            result.molecular_basis.append("Histological Grade 4")
            result.confidence = "high"
        else:
            # IDH-wt without confirmatory molecular or histological grade
            result.confidence = "medium"
            result.notes.append(
                "IDH-wildtype classified as GBM; molecular upgrade markers "
                "(TERT, EGFR amp, +7/-10) not tested or not available"
            )

        return result

    # 5. IDH status unknown -> cannot fully classify
    result.who_type = WHOGliomaType.GLIOMA_NOS
    result.confidence = "low"
    result.notes.append("IDH status unknown; cannot determine WHO 2021 integrated diagnosis")

    if hist_grade != WHOGrade.UNKNOWN:
        result.who_grade = hist_grade
        result.molecular_basis.append(f"Histological {hist_grade.value}")

    # Provide hints based on available data
    if mol["1p19q"] == MolecularStatus.POSITIVE:
        result.notes.append("1p/19q codeletion detected; likely oligodendroglioma if IDH-mutant")
    if mol["cdkn2a"] == MolecularStatus.POSITIVE:
        result.notes.append("CDKN2A deletion detected; suggests higher grade")
    if mol["tert"] == MolecularStatus.POSITIVE:
        result.notes.append("TERT promoter mutation detected; more common in IDH-wt GBM and oligodendroglioma")

    return result


# ---------------------------------------------------------------------------
# Grade parsing helpers
# ---------------------------------------------------------------------------

_GRADE_MAP = {
    "1": WHOGrade.GRADE_1, "i": WHOGrade.GRADE_1,
    "2": WHOGrade.GRADE_2, "ii": WHOGrade.GRADE_2,
    "3": WHOGrade.GRADE_3, "iii": WHOGrade.GRADE_3,
    "4": WHOGrade.GRADE_4, "iv": WHOGrade.GRADE_4,
}


def _parse_grade(grade_str: str) -> WHOGrade:
    """Parse a grade string into a WHOGrade enum value."""
    if not grade_str:
        return WHOGrade.UNKNOWN
    import re
    # Try to extract a numeric or Roman numeral grade
    m = re.search(r"(?:grade\s*)?([1-4]|I{1,3}V?|IV)", grade_str, re.IGNORECASE)
    if m:
        return _GRADE_MAP.get(m.group(1).lower(), WHOGrade.UNKNOWN)
    return WHOGrade.UNKNOWN


# ---------------------------------------------------------------------------
# TCGA patient classification
# ---------------------------------------------------------------------------

def classify_tcga_patient(
    patient_id: str,
    biomarker_data: dict[str, str],
    clinical_data: dict | None = None,
) -> WHOClassificationResult:
    """Classify a TCGA-GBM patient using WHO 2021 criteria.

    Most TCGA-GBM patients are IDH-wildtype (93.5%) and will classify as
    Glioblastoma, IDH-wildtype, Grade 4. The ~6.5% IDH-mutant cases would
    now be classified as Astrocytoma, IDH-mutant, Grade 4 under WHO 2021
    (no longer called "secondary glioblastoma").

    Args:
        patient_id: TCGA patient/case identifier.
        biomarker_data: Molecular data for the patient.
        clinical_data: Optional clinical metadata dict.

    Returns:
        WHOClassificationResult with TCGA-specific notes.
    """
    hist_grade = ""
    age = None

    if clinical_data:
        hist_grade = clinical_data.get("tumor_grade", "")
        age_days = clinical_data.get("age_at_diagnosis")
        if age_days is not None:
            try:
                age = int(age_days) // 365
            except (ValueError, TypeError):
                pass

    result = classify_patient(
        biomarkers=biomarker_data,
        histological_grade=hist_grade,
        is_diffuse=True,
        is_midline=False,
        age_years=age,
    )

    result.notes.insert(0, f"TCGA patient: {patient_id}")

    # TCGA-GBM historical note
    if result.who_type == WHOGliomaType.ASTROCYTOMA_IDH_MUT:
        result.notes.append(
            "Under WHO 2016 this was called 'secondary glioblastoma'; "
            "WHO 2021 reclassifies as Astrocytoma, IDH-mutant"
        )

    return result


# ---------------------------------------------------------------------------
# Batch classification
# ---------------------------------------------------------------------------

def classify_tcga_cohort(
    patients: list[dict],
) -> dict[str, WHOClassificationResult]:
    """Classify a batch of TCGA-GBM patients.

    Args:
        patients: List of dicts with keys 'patient_id', 'biomarkers', and
            optional 'clinical'.

    Returns:
        Dict mapping patient_id -> WHOClassificationResult.
    """
    results = {}
    for p in patients:
        pid = p.get("patient_id", p.get("case_id", "unknown"))
        biomarkers = p.get("biomarkers", {})
        clinical = p.get("clinical", None)
        results[pid] = classify_tcga_patient(pid, biomarkers, clinical)

    # Summary stats
    type_counts = {}
    for r in results.values():
        type_counts[r.who_type.value] = type_counts.get(r.who_type.value, 0) + 1

    logger.info(
        "WHO 2021 classification complete: %d patients. Distribution: %s",
        len(results),
        {k: f"{v} ({100*v/len(results):.1f}%)" for k, v in type_counts.items()},
    )
    return results
