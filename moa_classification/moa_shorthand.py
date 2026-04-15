"""MOA short-hand name resolution.

Converts long-form mechanism-of-action descriptions from Open Targets into
clinically standard short-hand names.

Example:
  "Poly [ADP-ribose] polymerase 1 inhibitor" -> "PARP1 inhibitor"
  "Poly [ADP-ribose] polymerase 2 inhibitor" -> "PARP2 inhibitor"
  Broad category for both: "PARP inhibitor"

  "Epidermal growth factor receptor erbB1 inhibitor" -> "EGFR inhibitor"
"""

import re
from dataclasses import dataclass, field

# ---- Curated target name -> short-hand mapping ----
# Key: substring that appears in the long-form MOA (lowercased for matching).
# Value: (short_symbol, broad_family).
#   short_symbol: the most specific short-hand (e.g., "PARP1")
#   broad_family: the broad family short-hand (e.g., "PARP")

_TARGET_SHORTHAND: dict[str, tuple[str, str]] = {
    # PARP family
    "poly [adp-ribose] polymerase 1":  ("PARP1", "PARP"),
    "poly [adp-ribose] polymerase-1":  ("PARP1", "PARP"),
    "poly [adp-ribose] polymerase 2":  ("PARP2", "PARP"),
    "poly [adp-ribose] polymerase-2":  ("PARP2", "PARP"),
    "poly(adp-ribose) polymerase 1":   ("PARP1", "PARP"),
    "poly(adp-ribose) polymerase-1":   ("PARP1", "PARP"),
    "poly(adp-ribose) polymerase 2":   ("PARP2", "PARP"),
    "poly(adp-ribose) polymerase-2":   ("PARP2", "PARP"),
    "poly [adp-ribose] polymerase":    ("PARP",  "PARP"),
    "poly(adp-ribose) polymerase":     ("PARP",  "PARP"),

    # EGFR / ErbB family
    "epidermal growth factor receptor erbb1": ("EGFR",  "EGFR"),
    "epidermal growth factor receptor":       ("EGFR",  "EGFR"),
    "erbb2": ("HER2",  "HER"),
    "erbb3": ("HER3",  "HER"),
    "erbb4": ("HER4",  "HER"),

    # VEGF / VEGFR family
    "vascular endothelial growth factor receptor 1": ("VEGFR1", "VEGFR"),
    "vascular endothelial growth factor receptor 2": ("VEGFR2", "VEGFR"),
    "vascular endothelial growth factor receptor 3": ("VEGFR3", "VEGFR"),
    "vascular endothelial growth factor receptor":   ("VEGFR",  "VEGFR"),
    "vascular endothelial growth factor":            ("VEGF",   "VEGF"),

    # PDGFR
    "platelet-derived growth factor receptor alpha": ("PDGFRa", "PDGFR"),
    "platelet-derived growth factor receptor beta":  ("PDGFRb", "PDGFR"),
    "platelet-derived growth factor receptor":       ("PDGFR",  "PDGFR"),

    # FGFR
    "fibroblast growth factor receptor 1": ("FGFR1", "FGFR"),
    "fibroblast growth factor receptor 2": ("FGFR2", "FGFR"),
    "fibroblast growth factor receptor 3": ("FGFR3", "FGFR"),
    "fibroblast growth factor receptor 4": ("FGFR4", "FGFR"),
    "fibroblast growth factor receptor":   ("FGFR",  "FGFR"),

    # ALK / ROS1 / MET
    "anaplastic lymphoma kinase":    ("ALK",  "ALK"),
    "proto-oncogene tyrosine-protein kinase ros": ("ROS1", "ROS1"),
    "hepatocyte growth factor receptor": ("MET",  "MET"),

    # PI3K / AKT / mTOR pathway
    "pi3-kinase":                     ("PI3K",  "PI3K"),
    "pi3k":                           ("PI3K",  "PI3K"),
    "phosphatidylinositol 4,5-bisphosphate 3-kinase": ("PI3K", "PI3K"),
    "serine/threonine-protein kinase mtor": ("mTOR", "mTOR"),
    "mechanistic target of rapamycin": ("mTOR", "mTOR"),
    "akt":                             ("AKT",  "AKT"),

    # RAF / MEK / ERK pathway
    "raf":   ("RAF",  "RAF"),
    "b-raf": ("BRAF", "RAF"),
    "serine/threonine-protein kinase b-raf": ("BRAF", "RAF"),
    "dual specificity mitogen-activated protein kinase kinase 1": ("MEK1", "MEK"),
    "dual specificity mitogen-activated protein kinase kinase 2": ("MEK2", "MEK"),
    "mek1":  ("MEK1", "MEK"),
    "mek2":  ("MEK2", "MEK"),

    # CDK family
    "cyclin-dependent kinase 4":  ("CDK4",  "CDK4/6"),
    "cyclin-dependent kinase 6":  ("CDK6",  "CDK4/6"),
    "cyclin-dependent kinase 2":  ("CDK2",  "CDK"),
    "cyclin-dependent kinase 1":  ("CDK1",  "CDK"),
    "cyclin-dependent kinase":    ("CDK",   "CDK"),

    # Immune checkpoint
    "programmed cell death 1 ligand 1":  ("PD-L1",  "Immune Checkpoint"),
    "programmed cell death protein 1":   ("PD-1",   "Immune Checkpoint"),
    "cytotoxic t-lymphocyte protein 4":  ("CTLA-4", "Immune Checkpoint"),

    # BCR-ABL / Tyrosine kinases
    "tyrosine-protein kinase abl1": ("ABL1",    "BCR-ABL"),
    "bcr-abl":                      ("BCR-ABL", "BCR-ABL"),

    # BTK
    "tyrosine-protein kinase btk":  ("BTK", "BTK"),
    "bruton":                       ("BTK", "BTK"),

    # JAK family
    "janus kinase 1": ("JAK1", "JAK"),
    "janus kinase 2": ("JAK2", "JAK"),
    "janus kinase 3": ("JAK3", "JAK"),
    "janus kinase":   ("JAK",  "JAK"),

    # Proteasome
    "proteasome":  ("Proteasome", "Proteasome"),
    "20s proteasome": ("Proteasome", "Proteasome"),

    # HDAC
    "histone deacetylase": ("HDAC", "HDAC"),

    # BCL2 family
    "apoptosis regulator bcl-2": ("BCL-2", "BCL-2"),
    "bcl-2":                     ("BCL-2", "BCL-2"),

    # IDH
    "isocitrate dehydrogenase 1": ("IDH1", "IDH"),
    "isocitrate dehydrogenase 2": ("IDH2", "IDH"),

    # DNA topoisomerase
    "dna topoisomerase 1": ("TOP1", "Topoisomerase"),
    "dna topoisomerase 2": ("TOP2", "Topoisomerase"),
    "topoisomerase i":     ("TOP1", "Topoisomerase"),
    "topoisomerase ii":    ("TOP2", "Topoisomerase"),

    # Tubulin
    "tubulin": ("Tubulin", "Tubulin"),

    # DNA / general
    "dna inhibitor": ("DNA Alkylating/Damaging", "DNA Damage"),
    "dna":           ("DNA", "DNA Damage"),
}

# Gene-symbol-based fallback: if the target's approvedSymbol matches a key,
# use that as the short-hand. This handles cases not in the curated list.
_SYMBOL_TO_FAMILY: dict[str, str] = {
    "EGFR": "EGFR",  "ERBB2": "HER2", "ERBB3": "HER3", "ERBB4": "HER4",
    "PARP1": "PARP",  "PARP2": "PARP", "PARP3": "PARP",
    "BRAF": "RAF",    "RAF1": "RAF",   "ARAF": "RAF",
    "MAP2K1": "MEK",  "MAP2K2": "MEK",
    "CDK4": "CDK4/6", "CDK6": "CDK4/6", "CDK2": "CDK",
    "PDCD1": "PD-1",  "CD274": "PD-L1", "CTLA4": "CTLA-4",
    "KDR": "VEGFR",   "FLT1": "VEGFR",  "FLT4": "VEGFR",
    "PDGFRA": "PDGFR","PDGFRB": "PDGFR",
    "FGFR1": "FGFR",  "FGFR2": "FGFR", "FGFR3": "FGFR", "FGFR4": "FGFR",
    "ALK": "ALK",     "ROS1": "ROS1",   "MET": "MET",
    "MTOR": "mTOR",   "AKT1": "AKT",    "AKT2": "AKT",
    "JAK1": "JAK",    "JAK2": "JAK",    "JAK3": "JAK",
    "BTK": "BTK",     "ABL1": "ABL",
    "BCL2": "BCL-2",  "BCL2L1": "BCL-XL",
    "IDH1": "IDH",    "IDH2": "IDH",
    "TOP1": "Topoisomerase", "TOP2A": "Topoisomerase", "TOP2B": "Topoisomerase",
    "TUBB": "Tubulin", "TUBA1A": "Tubulin",
    "PIK3CA": "PI3K",  "PIK3CB": "PI3K", "PIK3CD": "PI3K",
    "HDAC1": "HDAC",   "HDAC2": "HDAC", "HDAC3": "HDAC", "HDAC6": "HDAC",
    "PSMA1": "Proteasome", "PSMB5": "Proteasome",
}


@dataclass
class MOAShorthand:
    """Result of short-hand resolution for a single MOA entry."""
    long_form: str             # Original from Open Targets, e.g., "Poly [ADP-ribose] polymerase 1 inhibitor"
    short_form: str            # Specific, e.g., "PARP1 inhibitor"
    broad_category: str        # Family-level, e.g., "PARP inhibitor"
    action_type: str = ""      # e.g., "INHIBITOR"
    gene_symbols: list[str] = field(default_factory=list)


def resolve_shorthand(
    mechanism_of_action: str,
    action_type: str = "",
    gene_symbols: list[str] | None = None,
) -> MOAShorthand:
    """Convert a long-form MOA description to short-hand names.

    Args:
        mechanism_of_action: Full MOA string from Open Targets
            (e.g., "Poly [ADP-ribose] polymerase 1 inhibitor").
        action_type: Action type (e.g., "INHIBITOR").
        gene_symbols: Gene symbols from Open Targets targets
            (e.g., ["PARP1"]).

    Returns:
        MOAShorthand with long_form, short_form, and broad_category.
    """
    moa_lower = mechanism_of_action.lower()
    gene_symbols = gene_symbols or []

    # Extract the action word from the end of the MOA string
    # (e.g., "inhibitor", "agonist", "antagonist", "modulator")
    action_word = ""
    action_match = re.search(
        r"\b(inhibitor|agonist|antagonist|blocker|activator|modulator|opener|"
        r"suppressor|stimulant|substrate)\s*$",
        moa_lower,
    )
    if action_match:
        action_word = action_match.group(1)
    elif action_type:
        action_word = action_type.lower()

    # Pass 1: Check curated target-name mapping (longest match first)
    best_match_len = 0
    best_short = ""
    best_broad = ""
    for pattern, (short, broad) in _TARGET_SHORTHAND.items():
        if pattern in moa_lower and len(pattern) > best_match_len:
            best_match_len = len(pattern)
            best_short = short
            best_broad = broad

    if best_short:
        short_form = f"{best_short} {action_word}".strip()
        broad_form = f"{best_broad} {action_word}".strip()
        return MOAShorthand(
            long_form=mechanism_of_action,
            short_form=short_form,
            broad_category=broad_form,
            action_type=action_type,
            gene_symbols=gene_symbols,
        )

    # Pass 2: Use gene symbol directly if available
    if gene_symbols:
        symbol = gene_symbols[0]
        family = _SYMBOL_TO_FAMILY.get(symbol, symbol)
        short_form = f"{symbol} {action_word}".strip()
        broad_form = f"{family} {action_word}".strip()
        return MOAShorthand(
            long_form=mechanism_of_action,
            short_form=short_form,
            broad_category=broad_form,
            action_type=action_type,
            gene_symbols=gene_symbols,
        )

    # Pass 3: No resolution — return original as-is
    return MOAShorthand(
        long_form=mechanism_of_action,
        short_form=mechanism_of_action,
        broad_category=mechanism_of_action,
        action_type=action_type,
        gene_symbols=gene_symbols,
    )


def group_moa_shorthands(shorthands: list[MOAShorthand]) -> dict[str, list[str]]:
    """Group multiple MOA shorthands by their broad family category.

    Useful for display: e.g., "PARP inhibitor" -> ["PARP1 inhibitor", "PARP2 inhibitor"]

    Args:
        shorthands: List of resolved MOAShorthand objects.

    Returns:
        Dict mapping broad_category -> list of short_forms.
    """
    groups: dict[str, list[str]] = {}
    for sh in shorthands:
        if sh.broad_category not in groups:
            groups[sh.broad_category] = []
        if sh.short_form not in groups[sh.broad_category]:
            groups[sh.broad_category].append(sh.short_form)
    return groups
