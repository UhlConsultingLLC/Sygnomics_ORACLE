"""Extract WHO 2021 CNS classification signals from trial eligibility text.

Builds on the biomarker_extractor to determine which WHO 2021 glioma subtypes
each clinical trial targets. This enables:
  - Filtering trials by WHO subtype (GBM IDH-wt vs Astrocytoma IDH-mut)
  - Matching trials to TCGA patients based on molecular subtype
  - Understanding the molecular inclusivity of each trial's design

The extractor examines:
  1. Explicit WHO subtype mentions (e.g., "IDH-wildtype glioblastoma")
  2. Molecular eligibility criteria (IDH, 1p/19q, MGMT, etc.)
  3. Grade requirements (WHO Grade IV, high-grade glioma)
  4. Diagnosis keywords (glioblastoma, astrocytoma, oligodendroglioma)
"""

import logging
import re
from typing import Optional

from pydantic import BaseModel, Field

from analysis.biomarker_extractor import BiomarkerMatch, extract_biomarkers
from analysis.who_classification import (
    MolecularStatus,
    WHOClassificationResult,
    WHOGliomaType,
    WHOGrade,
    normalize_biomarker_dict,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result model
# ---------------------------------------------------------------------------

class TrialWHOProfile(BaseModel):
    """WHO 2021 classification profile for a clinical trial."""

    nct_id: str = ""

    # Primary WHO types this trial targets (may be multiple)
    target_who_types: list[str] = Field(default_factory=list)
    # Grade range accepted
    who_grade_min: str = "Unknown"
    who_grade_max: str = "Unknown"

    # Molecular requirements inferred from eligibility
    idh_status: str = "unknown"           # required, excluded, any, unknown
    codeletion_1p19q: str = "unknown"
    mgmt_status: str = "unknown"
    cdkn2a_status: str = "unknown"
    h3k27m_status: str = "unknown"

    # Classification confidence
    confidence: str = "low"  # high, medium, low
    evidence: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)

    # Number of biomarker criteria found
    biomarker_count: int = 0


# ---------------------------------------------------------------------------
# Diagnosis keyword patterns
# ---------------------------------------------------------------------------

# Patterns that strongly imply specific WHO 2021 subtypes
_WHO_TYPE_PATTERNS: list[tuple[str, WHOGliomaType, str]] = [
    # Explicit WHO 2021 subtype mentions
    (r"glioblastoma[,\s]+IDH[\s-]?wild[\s-]?type",
     WHOGliomaType.GLIOBLASTOMA_IDH_WT, "Explicit: glioblastoma, IDH-wildtype"),
    (r"IDH[\s-]?wild[\s-]?type\s+glioblastoma",
     WHOGliomaType.GLIOBLASTOMA_IDH_WT, "Explicit: IDH-wildtype glioblastoma"),
    (r"astrocytoma[,\s]+IDH[\s-]?mut(?:ant|ated)?",
     WHOGliomaType.ASTROCYTOMA_IDH_MUT, "Explicit: astrocytoma, IDH-mutant"),
    (r"IDH[\s-]?mut(?:ant|ated)?\s+astrocytoma",
     WHOGliomaType.ASTROCYTOMA_IDH_MUT, "Explicit: IDH-mutant astrocytoma"),
    (r"oligodendroglioma[,\s]+IDH[\s-]?mut(?:ant|ated)?(?:\s+and)?\s+1p\s*/?\s*19q",
     WHOGliomaType.OLIGODENDROGLIOMA, "Explicit: oligodendroglioma, IDH-mutant and 1p/19q-codeleted"),
    (r"diffuse\s+midline\s+glioma.*H3\s*K27",
     WHOGliomaType.DIFFUSE_MIDLINE_GLIOMA, "Explicit: diffuse midline glioma, H3 K27-altered"),
    (r"H3\s*K27[\s-]?(?:altered|mutant).*glioma",
     WHOGliomaType.DIFFUSE_MIDLINE_GLIOMA, "Explicit: H3 K27-altered glioma"),
    (r"DIPG|diffuse\s+intrinsic\s+pontine\s+glioma",
     WHOGliomaType.DIFFUSE_MIDLINE_GLIOMA, "DIPG (typically H3 K27-altered)"),
]

# Diagnosis keywords that suggest which subtypes are eligible
_DIAGNOSIS_PATTERNS: list[tuple[str, list[WHOGliomaType], str]] = [
    # GBM-specific (without molecular qualifier)
    (r"\bglioblastoma\s+multiforme\b",
     [WHOGliomaType.GLIOBLASTOMA_IDH_WT, WHOGliomaType.ASTROCYTOMA_IDH_MUT],
     "GBM multiforme (may include IDH-wt and reclassified IDH-mut Grade 4)"),
    (r"\bglioblastoma\b",
     [WHOGliomaType.GLIOBLASTOMA_IDH_WT],
     "Glioblastoma (primarily IDH-wildtype under WHO 2021)"),
    # Astrocytoma
    (r"\bastrocytoma\b",
     [WHOGliomaType.ASTROCYTOMA_IDH_MUT, WHOGliomaType.GLIOBLASTOMA_IDH_WT],
     "Astrocytoma (could be IDH-mutant or IDH-wildtype)"),
    (r"\banaplastic\s+astrocytoma\b",
     [WHOGliomaType.ASTROCYTOMA_IDH_MUT],
     "Anaplastic astrocytoma (WHO 2021: Astrocytoma IDH-mutant, Grade 3)"),
    # Oligodendroglioma
    (r"\boligodendroglioma\b",
     [WHOGliomaType.OLIGODENDROGLIOMA],
     "Oligodendroglioma"),
    (r"\banaplastic\s+oligodendroglioma\b",
     [WHOGliomaType.OLIGODENDROGLIOMA],
     "Anaplastic oligodendroglioma (WHO 2021: Oligodendroglioma, Grade 3)"),
    # Mixed / broad
    (r"\bhigh[\s-]?grade\s+glioma\b",
     [WHOGliomaType.GLIOBLASTOMA_IDH_WT, WHOGliomaType.ASTROCYTOMA_IDH_MUT],
     "High-grade glioma (Grade 3-4)"),
    (r"\blow[\s-]?grade\s+glioma\b",
     [WHOGliomaType.ASTROCYTOMA_IDH_MUT, WHOGliomaType.OLIGODENDROGLIOMA],
     "Low-grade glioma (Grade 2)"),
    (r"\bdiffuse\s+glioma\b",
     [WHOGliomaType.GLIOBLASTOMA_IDH_WT, WHOGliomaType.ASTROCYTOMA_IDH_MUT, WHOGliomaType.OLIGODENDROGLIOMA],
     "Diffuse glioma (broad)"),
    (r"\bmalignant\s+glioma\b",
     [WHOGliomaType.GLIOBLASTOMA_IDH_WT, WHOGliomaType.ASTROCYTOMA_IDH_MUT],
     "Malignant glioma (high-grade)"),
    (r"\bgliosarcoma\b",
     [WHOGliomaType.GLIOBLASTOMA_IDH_WT],
     "Gliosarcoma (variant of GBM, IDH-wildtype)"),
]


# ---------------------------------------------------------------------------
# Grade extraction patterns
# ---------------------------------------------------------------------------

_GRADE_PATTERNS: list[tuple[str, WHOGrade]] = [
    (r"(?:WHO\s+)?[Gg]rade\s*(?:IV|4)", WHOGrade.GRADE_4),
    (r"(?:WHO\s+)?[Gg]rade\s*(?:III|3)", WHOGrade.GRADE_3),
    (r"(?:WHO\s+)?[Gg]rade\s*(?:II|2)\b", WHOGrade.GRADE_2),
    (r"(?:WHO\s+)?[Gg]rade\s*(?:I|1)\b", WHOGrade.GRADE_1),
    # Textual grade descriptions
    (r"\bhigh[\s-]?grade\b", WHOGrade.GRADE_3),  # Min grade for "high-grade"
    (r"\blow[\s-]?grade\b", WHOGrade.GRADE_2),    # Typical grade for "low-grade"
]


def _extract_grade_range(text: str) -> tuple[WHOGrade, WHOGrade]:
    """Extract the grade range from eligibility text.

    Returns (min_grade, max_grade). Defaults to (UNKNOWN, UNKNOWN).
    """
    grades_found: list[WHOGrade] = []

    for pattern, grade in _GRADE_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            grades_found.append(grade)

    if not grades_found:
        return WHOGrade.UNKNOWN, WHOGrade.UNKNOWN

    # Grade ordering for comparison
    grade_order = {
        WHOGrade.GRADE_1: 1, WHOGrade.GRADE_2: 2,
        WHOGrade.GRADE_3: 3, WHOGrade.GRADE_4: 4,
        WHOGrade.UNKNOWN: 0,
    }
    grades_found.sort(key=lambda g: grade_order[g])
    return grades_found[0], grades_found[-1]


# ---------------------------------------------------------------------------
# Molecular requirement extraction from biomarker matches
# ---------------------------------------------------------------------------

def _biomarker_to_requirement(matches: list[BiomarkerMatch]) -> dict[str, str]:
    """Convert biomarker extractor output to molecular requirement dict.

    Maps BiomarkerMatch list to a dict like:
        {"idh_status": "required", "mgmt_status": "excluded", ...}

    The 'requirement' field from BiomarkerMatch tells us whether the biomarker
    is required (inclusion), excluded (exclusion), or just mentioned.
    """
    result: dict[str, str] = {}

    marker_to_field = {
        "IDH mutation": "idh_status",
        "IDH1 mutation": "idh_status",
        "IDH2 mutation": "idh_status",
        "IDH1 R132H mutation": "idh_status",
        "IDH wild-type": "idh_status_wt",  # Special: WT = IDH negative
        "1p/19q codeletion": "codeletion_1p19q",
        "1p/19q": "codeletion_1p19q",
        "MGMT promoter methylated": "mgmt_status",
        "MGMT methylated": "mgmt_status",
        "MGMT unmethylated": "mgmt_status_unmeth",
        "MGMT status known": "mgmt_status_known",
        "CDKN2A deletion": "cdkn2a_status",
        "H3K27M mutation": "h3k27m_status",
    }

    for bm in matches:
        field = marker_to_field.get(bm.marker)
        if not field:
            continue

        # IDH wild-type handling
        # NOTE: The biomarker_extractor's _determine_requirement often returns
        # "excluded" for IDH wild-type because the word "wild-type" itself
        # matches the negative pattern. We use context (inclusion/exclusion
        # section) as the primary signal instead.
        if field == "idh_status_wt":
            if bm.context == "inclusion":
                # IDH wild-type in inclusion criteria = trial wants IDH-wt = mutation excluded
                result["idh_status"] = "excluded"
            elif bm.context == "exclusion":
                # IDH wild-type in exclusion criteria = trial excludes IDH-wt = mutation required
                result["idh_status"] = "required"
            elif bm.requirement == "required":
                result["idh_status"] = "excluded"
            elif bm.requirement == "excluded":
                result["idh_status"] = "required"
            else:
                result.setdefault("idh_status", "any")
            continue

        # MGMT unmethylated handling
        if field == "mgmt_status_unmeth":
            if bm.requirement == "required":
                result["mgmt_status"] = "excluded"  # Unmethylated required = methylated excluded
            elif bm.requirement == "excluded":
                result["mgmt_status"] = "required"  # Unmethylated excluded = methylated required
            else:
                result.setdefault("mgmt_status", "any")
            continue

        # MGMT status known
        if field == "mgmt_status_known":
            result.setdefault("mgmt_status", "any")  # Known = either is fine
            continue

        # Standard markers
        if bm.context == "exclusion" and bm.requirement != "excluded":
            result[field] = "excluded"
        elif bm.requirement == "required":
            result[field] = "required"
        elif bm.requirement == "excluded":
            result[field] = "excluded"
        else:
            result.setdefault(field, "mentioned")

    return result


# ---------------------------------------------------------------------------
# Main extraction function
# ---------------------------------------------------------------------------

def classify_trial_who(
    criteria_text: str,
    nct_id: str = "",
    title: str = "",
    conditions: list[str] | None = None,
    biomarker_matches: list[BiomarkerMatch] | None = None,
) -> TrialWHOProfile:
    """Classify which WHO 2021 glioma subtypes a trial targets.

    Analyzes eligibility criteria, title, and conditions to determine
    the trial's molecular subtype requirements.

    Args:
        criteria_text: Raw eligibility criteria text.
        nct_id: Trial identifier.
        title: Trial title (checked for explicit subtype mentions).
        conditions: List of condition names.
        biomarker_matches: Pre-extracted biomarker matches (if None, extracts fresh).

    Returns:
        TrialWHOProfile with target subtypes, molecular requirements, and confidence.
    """
    profile = TrialWHOProfile(nct_id=nct_id)
    combined_text = f"{title}\n{criteria_text}"
    conditions = conditions or []

    # 1. Extract biomarkers if not provided
    if biomarker_matches is None:
        biomarker_matches = extract_biomarkers(criteria_text)
    profile.biomarker_count = len(biomarker_matches)

    # 2. Check for explicit WHO 2021 subtype mentions
    who_types_found: dict[WHOGliomaType, str] = {}  # type -> evidence
    for pattern, who_type, evidence in _WHO_TYPE_PATTERNS:
        if re.search(pattern, combined_text, re.IGNORECASE):
            who_types_found[who_type] = evidence
            profile.evidence.append(evidence)

    # 3. Check diagnosis keyword patterns
    diagnosis_types: dict[WHOGliomaType, str] = {}
    for pattern, types, evidence in _DIAGNOSIS_PATTERNS:
        if re.search(pattern, combined_text, re.IGNORECASE):
            for t in types:
                if t not in diagnosis_types:
                    diagnosis_types[t] = evidence
            profile.evidence.append(evidence)

    # Also check condition names
    conditions_text = " ".join(conditions)
    for pattern, types, evidence in _DIAGNOSIS_PATTERNS:
        if re.search(pattern, conditions_text, re.IGNORECASE):
            for t in types:
                if t not in diagnosis_types:
                    diagnosis_types[t] = f"Condition: {evidence}"

    # 4. Extract molecular requirements from biomarkers
    mol_requirements = _biomarker_to_requirement(biomarker_matches)
    profile.idh_status = mol_requirements.get("idh_status", "unknown")
    profile.codeletion_1p19q = mol_requirements.get("codeletion_1p19q", "unknown")
    profile.mgmt_status = mol_requirements.get("mgmt_status", "unknown")
    profile.cdkn2a_status = mol_requirements.get("cdkn2a_status", "unknown")
    profile.h3k27m_status = mol_requirements.get("h3k27m_status", "unknown")

    # 5. Extract grade range
    grade_min, grade_max = _extract_grade_range(combined_text)
    profile.who_grade_min = grade_min.value
    profile.who_grade_max = grade_max.value

    # 6. Resolve target WHO types using molecular + diagnosis evidence
    target_types = _resolve_target_types(
        explicit_types=who_types_found,
        diagnosis_types=diagnosis_types,
        mol_requirements=mol_requirements,
        grade_min=grade_min,
        grade_max=grade_max,
    )
    profile.target_who_types = [t.value for t in target_types]

    # 7. Determine confidence
    profile.confidence = _assess_confidence(
        explicit_types=who_types_found,
        mol_requirements=mol_requirements,
        biomarker_count=profile.biomarker_count,
        target_types=target_types,
    )

    # 8. Add contextual notes
    if not target_types:
        profile.notes.append("Could not determine WHO 2021 subtype from available criteria")
        profile.target_who_types = [WHOGliomaType.GLIOMA_NOS.value]

    if profile.idh_status == "excluded":
        profile.notes.append("IDH mutation excluded -> targets IDH-wildtype (GBM)")
    elif profile.idh_status == "required":
        profile.notes.append("IDH mutation required -> targets IDH-mutant tumors")

    return profile


def _resolve_target_types(
    explicit_types: dict[WHOGliomaType, str],
    diagnosis_types: dict[WHOGliomaType, str],
    mol_requirements: dict[str, str],
    grade_min: WHOGrade,
    grade_max: WHOGrade,
) -> list[WHOGliomaType]:
    """Resolve the set of WHO 2021 types a trial targets.

    Priority: explicit mentions > molecular requirements > diagnosis keywords.
    """
    # If we have explicit WHO subtype mentions, use those
    if explicit_types:
        return list(explicit_types.keys())

    # Molecular requirements can narrow down the types
    idh = mol_requirements.get("idh_status", "unknown")
    codeletion = mol_requirements.get("codeletion_1p19q", "unknown")
    h3k27m = mol_requirements.get("h3k27m_status", "unknown")

    # H3K27M required -> diffuse midline glioma
    if h3k27m == "required":
        return [WHOGliomaType.DIFFUSE_MIDLINE_GLIOMA]

    # IDH mutation excluded (wild-type required) -> GBM
    if idh == "excluded":
        return [WHOGliomaType.GLIOBLASTOMA_IDH_WT]

    # IDH mutation required
    if idh == "required":
        if codeletion == "required":
            return [WHOGliomaType.OLIGODENDROGLIOMA]
        elif codeletion == "excluded":
            return [WHOGliomaType.ASTROCYTOMA_IDH_MUT]
        else:
            # IDH-mutant but 1p/19q status unknown -> could be either
            return [WHOGliomaType.ASTROCYTOMA_IDH_MUT, WHOGliomaType.OLIGODENDROGLIOMA]

    # No strong molecular signal -> use diagnosis keywords
    if diagnosis_types:
        # Filter by grade if available
        result = list(diagnosis_types.keys())
        grade_order = {
            WHOGrade.GRADE_1: 1, WHOGrade.GRADE_2: 2,
            WHOGrade.GRADE_3: 3, WHOGrade.GRADE_4: 4,
            WHOGrade.UNKNOWN: 0,
        }
        # If only Grade 4: exclude oligodendroglioma (max Grade 3)
        if grade_min == WHOGrade.GRADE_4:
            result = [t for t in result if t != WHOGliomaType.OLIGODENDROGLIOMA]
        # If only Grade 2: exclude GBM (always Grade 4)
        if grade_max == WHOGrade.GRADE_2:
            result = [t for t in result if t != WHOGliomaType.GLIOBLASTOMA_IDH_WT]

        return result if result else list(diagnosis_types.keys())

    return []


def _assess_confidence(
    explicit_types: dict[WHOGliomaType, str],
    mol_requirements: dict[str, str],
    biomarker_count: int,
    target_types: list[WHOGliomaType],
) -> str:
    """Assess classification confidence based on available evidence."""
    # Explicit WHO subtype mention -> high confidence
    if explicit_types:
        return "high"

    # Strong molecular signal (IDH status known + at least one other marker)
    idh = mol_requirements.get("idh_status", "unknown")
    known_markers = sum(1 for v in mol_requirements.values() if v not in ("unknown",))

    if idh in ("required", "excluded") and known_markers >= 2:
        return "high"

    if idh in ("required", "excluded"):
        return "medium"

    if known_markers >= 1 or biomarker_count >= 2:
        return "medium"

    if target_types and len(target_types) == 1:
        return "medium"

    return "low"


# ---------------------------------------------------------------------------
# Batch classification for all trials
# ---------------------------------------------------------------------------

def classify_all_trials(
    db_session,
    limit: int | None = None,
) -> list[TrialWHOProfile]:
    """Classify all trials in the database with WHO 2021 profiles.

    Args:
        db_session: SQLAlchemy session.
        limit: Optional limit on number of trials to process.

    Returns:
        List of TrialWHOProfile results.
    """
    from database.models import EligibilityRecord, TrialRecord

    query = db_session.query(TrialRecord).options(
        __import__("sqlalchemy.orm", fromlist=["subqueryload"]).subqueryload(TrialRecord.conditions),
    )

    if limit:
        query = query.limit(limit)

    trials = query.all()
    results = []
    type_counts: dict[str, int] = {}

    for trial in trials:
        # Get eligibility text
        elig = db_session.query(EligibilityRecord).filter_by(
            trial_nct_id=trial.nct_id
        ).first()
        criteria_text = elig.criteria_text if elig else ""

        # Classify
        profile = classify_trial_who(
            criteria_text=criteria_text,
            nct_id=trial.nct_id,
            title=trial.title,
            conditions=[c.name for c in trial.conditions],
        )
        results.append(profile)

        # Track distribution
        for t in profile.target_who_types:
            type_counts[t] = type_counts.get(t, 0) + 1

    logger.info(
        "WHO 2021 trial classification complete: %d trials. Type distribution: %s",
        len(results), type_counts,
    )
    return results


def save_who_profiles(
    db_session,
    profiles: list[TrialWHOProfile],
) -> int:
    """Save WHO classification profiles to the database.

    Args:
        db_session: SQLAlchemy session.
        profiles: List of TrialWHOProfile results.

    Returns:
        Number of records saved/updated.
    """
    from database.models import WHOClassificationRecord

    count = 0
    for profile in profiles:
        existing = db_session.query(WHOClassificationRecord).filter_by(
            trial_nct_id=profile.nct_id
        ).first()

        if existing:
            existing.who_types = " | ".join(profile.target_who_types)
            existing.who_grade_min = profile.who_grade_min
            existing.who_grade_max = profile.who_grade_max
            existing.idh_status = profile.idh_status
            existing.codeletion_1p19q = profile.codeletion_1p19q
            existing.mgmt_status = profile.mgmt_status
            existing.cdkn2a_status = profile.cdkn2a_status
            existing.h3k27m_status = profile.h3k27m_status
            existing.confidence = profile.confidence
            existing.biomarker_count = profile.biomarker_count
        else:
            record = WHOClassificationRecord(
                trial_nct_id=profile.nct_id,
                who_types=" | ".join(profile.target_who_types),
                who_grade_min=profile.who_grade_min,
                who_grade_max=profile.who_grade_max,
                idh_status=profile.idh_status,
                codeletion_1p19q=profile.codeletion_1p19q,
                mgmt_status=profile.mgmt_status,
                cdkn2a_status=profile.cdkn2a_status,
                h3k27m_status=profile.h3k27m_status,
                confidence=profile.confidence,
                biomarker_count=profile.biomarker_count,
            )
            db_session.add(record)
        count += 1

    db_session.commit()
    logger.info("Saved %d WHO classification records", count)
    return count
