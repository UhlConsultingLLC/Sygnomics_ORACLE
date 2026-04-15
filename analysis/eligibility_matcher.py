"""Parse trial eligibility criteria and match against TCGA patient cohorts.

Uses regex patterns for the most common criteria types. Logs unmatched
criteria for manual review rather than silently dropping them.

Enhanced with WHO 2021 molecular subtype filtering: when a trial specifies
molecular requirements (IDH status, 1p/19q, MGMT, etc.), patients are
filtered based on their molecular profile.
"""

import logging
import re
from typing import Optional

from connectors.models.tcga import ClinicalData, TCGACase

logger = logging.getLogger(__name__)


def _parse_age_range(criteria_text: str) -> tuple[Optional[int], Optional[int]]:
    """Extract min/max age from eligibility criteria text.

    Returns (min_age_years, max_age_years) or None for each if not found.
    """
    min_age = None
    max_age = None

    # "Age >= 18" or "age ≥ 18" or "18 years or older"
    match = re.search(r"age\s*(?:>=|≥|>=)\s*(\d+)", criteria_text, re.IGNORECASE)
    if match:
        min_age = int(match.group(1))

    match = re.search(r"(\d+)\s*years?\s*(?:or\s+)?older", criteria_text, re.IGNORECASE)
    if match and min_age is None:
        min_age = int(match.group(1))

    # "Age <= 75" or "no older than 75"
    match = re.search(r"age\s*(?:<=|≤)\s*(\d+)", criteria_text, re.IGNORECASE)
    if match:
        max_age = int(match.group(1))

    match = re.search(r"no\s+older\s+than\s+(\d+)", criteria_text, re.IGNORECASE)
    if match and max_age is None:
        max_age = int(match.group(1))

    return min_age, max_age


def _parse_sex_requirement(criteria_text: str) -> Optional[str]:
    """Extract sex requirement from criteria. Returns 'male', 'female', or None (any)."""
    if re.search(r"\b(?:female|women)\s+only\b", criteria_text, re.IGNORECASE):
        return "female"
    if re.search(r"\b(?:male|men)\s+only\b", criteria_text, re.IGNORECASE):
        return "male"
    return None


def _parse_ecog_requirement(criteria_text: str) -> Optional[int]:
    """Extract maximum ECOG performance status. Returns max ECOG or None."""
    match = re.search(
        r"ECOG\s*(?:performance\s*status)?\s*(?:of\s+)?(?:<=?|≤|0-)\s*(\d)",
        criteria_text,
        re.IGNORECASE,
    )
    if match:
        return int(match.group(1))

    match = re.search(r"ECOG\s*(?:of\s+)?(\d)\s*(?:or\s+less|-\s*(\d))", criteria_text, re.IGNORECASE)
    if match:
        return int(match.group(2) or match.group(1))

    return None


def _parse_diagnosis_keywords(criteria_text: str) -> list[str]:
    """Extract diagnosis-related keywords from inclusion criteria."""
    keywords = []
    patterns = [
        r"(?:histologically|pathologically)\s+confirmed\s+([\w\s]+?)(?:\.|,|\n)",
        r"diagnosis\s+of\s+([\w\s]+?)(?:\.|,|\n)",
    ]
    for pattern in patterns:
        matches = re.findall(pattern, criteria_text, re.IGNORECASE)
        keywords.extend(m.strip().lower() for m in matches)
    return keywords


# ---------------------------------------------------------------------------
# Molecular marker matching helpers
# ---------------------------------------------------------------------------

def _check_marker_match(
    patient_value: str,
    requirement: str,
    positive_terms: list[str],
    negative_terms: list[str],
) -> tuple[bool, str]:
    """Check if a patient's molecular marker matches a trial requirement.

    Args:
        patient_value: The patient's marker status (e.g., "mutant", "wild-type", "").
        requirement: Trial requirement: "required", "excluded", "any", "mentioned", "unknown".
        positive_terms: Terms that indicate the marker is positive/present.
        negative_terms: Terms that indicate the marker is negative/absent.

    Returns:
        (matches, reason): Whether the patient matches, and an explanation.
    """
    if requirement in ("unknown", "any", "mentioned", ""):
        return True, ""  # No restriction

    pval = patient_value.strip().lower()

    # If patient has no data for this marker, assume eligible (conservative)
    if not pval:
        return True, "marker data unavailable (assumed eligible)"

    is_positive = any(t in pval for t in positive_terms)
    is_negative = any(t in pval for t in negative_terms)

    if requirement == "required":
        if is_positive:
            return True, "marker present (required)"
        if is_negative:
            return False, "marker absent but required"
        return True, "marker status ambiguous (assumed eligible)"

    if requirement == "excluded":
        if is_negative:
            return True, "marker absent (excluded criteria met)"
        if is_positive:
            return False, "marker present but excluded"
        return True, "marker status ambiguous (assumed eligible)"

    return True, ""


class EligibilityMatcher:
    """Matches TCGA patient cases against trial eligibility criteria.

    Supports both clinical criteria (age, sex, ECOG, diagnosis) and
    molecular criteria (IDH, 1p/19q, MGMT, CDKN2A, H3K27M) for
    WHO 2021-aware matching.
    """

    def match_case(
        self,
        case: TCGACase,
        criteria_text: str,
        min_age_str: str = "",
        max_age_str: str = "",
        sex: str = "ALL",
        molecular_requirements: dict[str, str] | None = None,
    ) -> tuple[bool, list[str], list[str]]:
        """Check if a TCGA case matches trial eligibility.

        Args:
            case: TCGA patient case with clinical data.
            criteria_text: Free-text eligibility criteria.
            min_age_str: Minimum age string from trial (e.g., "18 Years").
            max_age_str: Maximum age string from trial.
            sex: Sex requirement ("ALL", "MALE", "FEMALE").
            molecular_requirements: Optional dict of molecular marker requirements
                from WHO extractor. Keys: idh_status, codeletion_1p19q, mgmt_status,
                cdkn2a_status, h3k27m_status. Values: "required", "excluded",
                "any", "mentioned", "unknown".

        Returns:
            Tuple of (is_eligible, matched_criteria, unmatched_criteria).
        """
        matched = []
        unmatched = []
        clinical = case.clinical

        if clinical is None:
            return False, [], ["No clinical data available"]

        # Age check
        patient_age_years = None
        if clinical.age_at_diagnosis is not None:
            patient_age_years = clinical.age_at_diagnosis // 365

        min_age, max_age = _parse_age_range(criteria_text)

        # Also parse from structured fields
        if min_age is None and min_age_str:
            age_match = re.search(r"(\d+)", min_age_str)
            if age_match:
                min_age = int(age_match.group(1))

        if max_age is None and max_age_str and max_age_str.upper() != "N/A":
            age_match = re.search(r"(\d+)", max_age_str)
            if age_match:
                max_age = int(age_match.group(1))

        if patient_age_years is not None:
            if min_age is not None and patient_age_years < min_age:
                unmatched.append(f"Age {patient_age_years} < minimum {min_age}")
                return False, matched, unmatched
            if max_age is not None and patient_age_years > max_age:
                unmatched.append(f"Age {patient_age_years} > maximum {max_age}")
                return False, matched, unmatched
            matched.append(f"Age {patient_age_years} in range")
        else:
            unmatched.append("Age at diagnosis not available")

        # Sex check
        sex_req = sex.upper()
        if sex_req != "ALL" and clinical.gender:
            if sex_req == "FEMALE" and clinical.gender.lower() != "female":
                unmatched.append(f"Sex mismatch: {clinical.gender} vs required {sex_req}")
                return False, matched, unmatched
            if sex_req == "MALE" and clinical.gender.lower() != "male":
                unmatched.append(f"Sex mismatch: {clinical.gender} vs required {sex_req}")
                return False, matched, unmatched
            matched.append(f"Sex: {clinical.gender}")

        # ECOG check
        max_ecog = _parse_ecog_requirement(criteria_text)
        if max_ecog is not None and clinical.ecog_performance_status is not None:
            if clinical.ecog_performance_status > max_ecog:
                unmatched.append(
                    f"ECOG {clinical.ecog_performance_status} > max {max_ecog}"
                )
                return False, matched, unmatched
            matched.append(f"ECOG {clinical.ecog_performance_status} <= {max_ecog}")
        elif max_ecog is not None:
            unmatched.append("ECOG status not available in TCGA data")

        # Diagnosis keyword check (soft match)
        diag_keywords = _parse_diagnosis_keywords(criteria_text)
        if diag_keywords and clinical.primary_diagnosis:
            patient_diag = clinical.primary_diagnosis.lower()
            found_match = any(kw in patient_diag for kw in diag_keywords)
            if found_match:
                matched.append(f"Diagnosis matches: {clinical.primary_diagnosis}")
            else:
                unmatched.append(
                    f"Diagnosis '{clinical.primary_diagnosis}' "
                    f"may not match: {diag_keywords}"
                )

        # ----- Molecular subtype filtering (WHO 2021) -----
        if molecular_requirements:
            mol_result = self._check_molecular_eligibility(
                clinical, molecular_requirements
            )
            for is_match, marker_name, reason in mol_result:
                if is_match:
                    if reason:
                        matched.append(f"{marker_name}: {reason}")
                else:
                    unmatched.append(f"{marker_name}: {reason}")
                    return False, matched, unmatched

        return True, matched, unmatched

    def _check_molecular_eligibility(
        self,
        clinical: ClinicalData,
        requirements: dict[str, str],
    ) -> list[tuple[bool, str, str]]:
        """Check molecular marker eligibility for WHO 2021 matching.

        Args:
            clinical: Patient clinical data with molecular fields.
            requirements: Dict of marker -> requirement status.

        Returns:
            List of (matches, marker_name, reason) tuples.
        """
        checks: list[tuple[bool, str, str]] = []

        # IDH status
        idh_req = requirements.get("idh_status", "unknown")
        if idh_req not in ("unknown", ""):
            ok, reason = _check_marker_match(
                clinical.idh_status, idh_req,
                positive_terms=["mutant", "mutated", "positive"],
                negative_terms=["wild-type", "wildtype", "wt", "negative"],
            )
            checks.append((ok, "IDH", reason))

        # 1p/19q codeletion
        codel_req = requirements.get("codeletion_1p19q", "unknown")
        if codel_req not in ("unknown", ""):
            ok, reason = _check_marker_match(
                clinical.codeletion_1p19q, codel_req,
                positive_terms=["codeleted", "codeletion", "positive", "loss"],
                negative_terms=["intact", "negative", "no codeletion", "absent"],
            )
            checks.append((ok, "1p/19q", reason))

        # MGMT methylation
        mgmt_req = requirements.get("mgmt_status", "unknown")
        if mgmt_req not in ("unknown", ""):
            ok, reason = _check_marker_match(
                clinical.mgmt_methylation, mgmt_req,
                positive_terms=["methylated", "positive"],
                negative_terms=["unmethylated", "negative"],
            )
            checks.append((ok, "MGMT", reason))

        # CDKN2A deletion
        cdkn2a_req = requirements.get("cdkn2a_status", "unknown")
        if cdkn2a_req not in ("unknown", ""):
            ok, reason = _check_marker_match(
                clinical.cdkn2a_status, cdkn2a_req,
                positive_terms=["deleted", "deletion", "loss", "homozygous"],
                negative_terms=["intact", "negative", "normal"],
            )
            checks.append((ok, "CDKN2A", reason))

        # H3K27M
        h3k27m_req = requirements.get("h3k27m_status", "unknown")
        if h3k27m_req not in ("unknown", ""):
            ok, reason = _check_marker_match(
                clinical.h3k27m_status, h3k27m_req,
                positive_terms=["mutant", "mutated", "positive", "altered"],
                negative_terms=["wild-type", "wildtype", "negative", "absent"],
            )
            checks.append((ok, "H3K27M", reason))

        return checks

    def filter_cohort(
        self,
        cases: list[TCGACase],
        criteria_text: str,
        min_age_str: str = "",
        max_age_str: str = "",
        sex: str = "ALL",
        molecular_requirements: dict[str, str] | None = None,
    ) -> tuple[list[TCGACase], list[dict]]:
        """Filter a TCGA cohort by trial eligibility criteria.

        Args:
            cases: List of TCGA patient cases.
            criteria_text: Free-text eligibility criteria.
            min_age_str: Structured min age from trial.
            max_age_str: Structured max age from trial.
            sex: Sex requirement.
            molecular_requirements: Optional molecular marker requirements
                from WHO extractor for subtype filtering.

        Returns:
            Tuple of (eligible_cases, match_details) where match_details
            contains per-case matching info for review.
        """
        eligible = []
        details = []

        for case in cases:
            is_eligible, matched_list, unmatched_list = self.match_case(
                case, criteria_text, min_age_str, max_age_str, sex,
                molecular_requirements=molecular_requirements,
            )
            details.append({
                "case_id": case.case_id,
                "eligible": is_eligible,
                "matched": matched_list,
                "unmatched": unmatched_list,
            })
            if is_eligible:
                eligible.append(case)

        mol_msg = ""
        if molecular_requirements:
            active = {k: v for k, v in molecular_requirements.items()
                      if v not in ("unknown", "")}
            if active:
                mol_msg = f" (molecular filters: {active})"

        logger.info(
            "Eligibility: %d/%d cases eligible (%.1f%%)%s",
            len(eligible), len(cases),
            100 * len(eligible) / len(cases) if cases else 0,
            mol_msg,
        )
        return eligible, details
