"""Drug name resolution: clean ClinicalTrials.gov intervention names for ChEMBL lookup."""

import re

# Patterns to strip from intervention names
_DOSAGE_PATTERN = re.compile(
    r"\s*\d+\.?\d*\s*(mg|g|ml|mcg|ug|µg|mg/m2|mg/kg|iu|units?|mm|%)\b.*",
    re.IGNORECASE,
)
_ROUTE_PATTERN = re.compile(
    r"\s*\b(oral|intravenous|iv|subcutaneous|sc|intramuscular|im|topical|"
    r"intrathecal|intraperitoneal|inhaled|transdermal|ophthalmic|sublingual|"
    r"rectal|intranasal|injection|infusion|capsule|tablet|solution|suspension)\b.*",
    re.IGNORECASE,
)
_FREQUENCY_PATTERN = re.compile(
    r"\s*\b(daily|weekly|biweekly|monthly|once|twice|every|q\d+[hd]|bid|tid|qid|"
    r"prn|qd|qhs|qam|qpm)\b.*",
    re.IGNORECASE,
)
_PARENTHETICAL = re.compile(r"\s*\([^)]*\)")
_BRAND_MARKERS = re.compile(r"®|™|©")


def clean_drug_name(raw_name: str) -> str:
    """Clean a ClinicalTrials.gov intervention name for ChEMBL search.

    Strips dosage, route, frequency, and other non-drug-name text.

    Args:
        raw_name: Raw intervention name (e.g., "Temozolomide 200mg oral daily").

    Returns:
        Cleaned drug name (e.g., "Temozolomide").
    """
    name = raw_name.strip()

    # Remove brand markers
    name = _BRAND_MARKERS.sub("", name)

    # Remove parenthetical content
    name = _PARENTHETICAL.sub("", name)

    # Strip dosage info
    name = _DOSAGE_PATTERN.sub("", name)

    # Strip route of administration
    name = _ROUTE_PATTERN.sub("", name)

    # Strip frequency
    name = _FREQUENCY_PATTERN.sub("", name)

    # Clean up whitespace
    name = re.sub(r"\s+", " ", name).strip()

    # Remove trailing punctuation
    name = name.rstrip(",-;:")

    return name.strip()


def is_drug_intervention(intervention_type: str) -> bool:
    """Check if an intervention type represents a drug/biological agent.

    Args:
        intervention_type: ClinicalTrials.gov intervention type field.

    Returns:
        True if this is a drug-like intervention that should be looked up in ChEMBL.
    """
    drug_types = {"DRUG", "BIOLOGICAL", "COMBINATION_PRODUCT", "GENETIC"}
    return intervention_type.upper() in drug_types


def normalize_for_matching(name: str) -> str:
    """Normalize a drug name for fuzzy matching.

    Lowercases, removes hyphens and special characters to improve match rates.
    """
    name = name.lower().strip()
    name = re.sub(r"[-_]", " ", name)
    name = re.sub(r"[^a-z0-9\s]", "", name)
    name = re.sub(r"\s+", " ", name)
    return name.strip()
