"""MOA category mapping from ChEMBL action types to higher-level categories.

Provides a curated mapping of granular ChEMBL action_type values to ~15-20
higher-level categories suitable for stratification and analysis.
"""

from enum import Enum


class MOACategory(str, Enum):
    """High-level mechanism-of-action categories."""

    ALKYLATING_AGENT = "Alkylating Agent"
    ANTIMETABOLITE = "Antimetabolite"
    KINASE_INHIBITOR = "Kinase Inhibitor"
    CHECKPOINT_INHIBITOR = "Immune Checkpoint Inhibitor"
    MONOCLONAL_ANTIBODY = "Monoclonal Antibody"
    ANGIOGENESIS_INHIBITOR = "Angiogenesis Inhibitor"
    HORMONE_THERAPY = "Hormone Therapy"
    PROTEASOME_INHIBITOR = "Proteasome Inhibitor"
    HDAC_INHIBITOR = "HDAC Inhibitor"
    PARP_INHIBITOR = "PARP Inhibitor"
    CAR_T_CELL = "CAR-T Cell Therapy"
    IMMUNOMODULATOR = "Immunomodulator"
    CYTOTOXIC = "Cytotoxic Agent"
    SIGNAL_TRANSDUCTION = "Signal Transduction Modifier"
    GENE_THERAPY = "Gene Therapy"
    VACCINE = "Cancer Vaccine"
    RADIOPHARMACEUTICAL = "Radiopharmaceutical"
    SUPPORTIVE_CARE = "Supportive Care"
    OTHER_TARGETED = "Other Targeted Therapy"
    UNKNOWN = "Unknown"
    NON_DRUG = "Non-Drug Intervention"


# Mapping from ChEMBL action_type values to MOA categories
# Keys are normalized to uppercase for matching
ACTION_TYPE_TO_CATEGORY: dict[str, MOACategory] = {
    # Inhibitors by target class
    "INHIBITOR": MOACategory.OTHER_TARGETED,
    "NEGATIVE MODULATOR": MOACategory.OTHER_TARGETED,
    "NEGATIVE ALLOSTERIC MODULATOR": MOACategory.OTHER_TARGETED,
    "BLOCKER": MOACategory.OTHER_TARGETED,
    "ANTAGONIST": MOACategory.OTHER_TARGETED,
    "INVERSE AGONIST": MOACategory.OTHER_TARGETED,

    # Agonists / Activators
    "AGONIST": MOACategory.SIGNAL_TRANSDUCTION,
    "POSITIVE MODULATOR": MOACategory.SIGNAL_TRANSDUCTION,
    "POSITIVE ALLOSTERIC MODULATOR": MOACategory.SIGNAL_TRANSDUCTION,
    "ACTIVATOR": MOACategory.SIGNAL_TRANSDUCTION,
    "OPENER": MOACategory.SIGNAL_TRANSDUCTION,
    "PARTIAL AGONIST": MOACategory.SIGNAL_TRANSDUCTION,

    # Enzyme mechanisms
    "SUBSTRATE": MOACategory.OTHER_TARGETED,
    "CHELATING AGENT": MOACategory.SUPPORTIVE_CARE,
    "CROSS-LINKING AGENT": MOACategory.ALKYLATING_AGENT,

    # Immune
    "IMMUNOSTIMULANT": MOACategory.IMMUNOMODULATOR,
    "IMMUNOSUPPRESSANT": MOACategory.IMMUNOMODULATOR,
}

# Keywords in mechanism_of_action or target_name -> MOACategory override
MECHANISM_KEYWORD_OVERRIDES: dict[str, MOACategory] = {
    "alkylat": MOACategory.ALKYLATING_AGENT,
    "antimetabolite": MOACategory.ANTIMETABOLITE,
    "kinase": MOACategory.KINASE_INHIBITOR,
    "pd-1": MOACategory.CHECKPOINT_INHIBITOR,
    "pd-l1": MOACategory.CHECKPOINT_INHIBITOR,
    "ctla-4": MOACategory.CHECKPOINT_INHIBITOR,
    "ctla4": MOACategory.CHECKPOINT_INHIBITOR,
    "checkpoint": MOACategory.CHECKPOINT_INHIBITOR,
    "vegf": MOACategory.ANGIOGENESIS_INHIBITOR,
    "angiogen": MOACategory.ANGIOGENESIS_INHIBITOR,
    "estrogen": MOACategory.HORMONE_THERAPY,
    "androgen": MOACategory.HORMONE_THERAPY,
    "aromatase": MOACategory.HORMONE_THERAPY,
    "proteasome": MOACategory.PROTEASOME_INHIBITOR,
    "hdac": MOACategory.HDAC_INHIBITOR,
    "histone deacetylase": MOACategory.HDAC_INHIBITOR,
    "parp": MOACategory.PARP_INHIBITOR,
    "poly(adp-ribose)": MOACategory.PARP_INHIBITOR,
    "car-t": MOACategory.CAR_T_CELL,
    "chimeric antigen": MOACategory.CAR_T_CELL,
    "vaccine": MOACategory.VACCINE,
    "radiopharmaceutical": MOACategory.RADIOPHARMACEUTICAL,
    "radiolabeled": MOACategory.RADIOPHARMACEUTICAL,
}

# Non-drug intervention type mappings
INTERVENTION_TYPE_TO_CATEGORY: dict[str, MOACategory] = {
    "PROCEDURE": MOACategory.NON_DRUG,
    "RADIATION": MOACategory.NON_DRUG,
    "DEVICE": MOACategory.NON_DRUG,
    "BEHAVIORAL": MOACategory.NON_DRUG,
    "DIETARY_SUPPLEMENT": MOACategory.SUPPORTIVE_CARE,
    "DIAGNOSTIC_TEST": MOACategory.NON_DRUG,
    "OTHER": MOACategory.NON_DRUG,
}


def classify_moa(
    action_type: str = "",
    mechanism_description: str = "",
    target_name: str = "",
    intervention_type: str = "",
) -> MOACategory:
    """Classify a therapy into a high-level MOA category.

    Checks keyword overrides first (for specificity), then falls back to
    action_type mapping, then intervention_type mapping.

    Args:
        action_type: ChEMBL action_type (e.g., "INHIBITOR").
        mechanism_description: Full mechanism description text.
        target_name: Target protein/gene name.
        intervention_type: ClinicalTrials.gov intervention type.

    Returns:
        MOACategory classification.
    """
    search_text = f"{mechanism_description} {target_name}".lower()

    # Check keyword overrides first (most specific)
    for keyword, category in MECHANISM_KEYWORD_OVERRIDES.items():
        if keyword in search_text:
            return category

    # Check action_type mapping
    normalized_action = action_type.strip().upper()
    if normalized_action in ACTION_TYPE_TO_CATEGORY:
        return ACTION_TYPE_TO_CATEGORY[normalized_action]

    # Check intervention type for non-drug interventions
    normalized_type = intervention_type.strip().upper()
    if normalized_type in INTERVENTION_TYPE_TO_CATEGORY:
        return INTERVENTION_TYPE_TO_CATEGORY[normalized_type]

    return MOACategory.UNKNOWN
