"""MOA-based in-silico simulation engine.

Given an MOA category, identifies drugs, finds trials with response rates,
partitions into training/testing sets, runs iterative TCGA-based simulations
to learn a DCNA threshold, then validates against testing trials.
"""

import csv
import json
import logging
import os
import random
import uuid
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
DCNA_PATH = os.path.join(DATA_DIR, "tcga_dcna.csv")
EXPR_PATH = os.path.join(DATA_DIR, "tcga_gene_expression.csv")
DRUG_TARGETS_CACHE_PATH = os.path.join(DATA_DIR, "drug_targets_cache.json")
SIMULATIONS_DIR = os.path.join(DATA_DIR, "simulations")

# Common drug name suffixes to strip for matching
SALT_SUFFIXES = [
    " hydrochloride", " tosylate", " mesylate", " maleate", " citrate",
    " sodium", " potassium", " acetate", " succinate", " fumarate",
    " tartrate", " sulfate", " phosphate", " besylate", " dihydrochloride",
    " hemifumarate", " dimesylate", " ditosylate",
]

# ── GBM / Glioma condition allowlist ────────────────────────────────────
# Only trials whose conditions match at least one of these patterns are
# eligible for MOA simulation.  This keeps the analysis focused on
# GBM and diffuse gliomas and excludes unrelated tumour types
# (ependymoma, medulloblastoma, meningioma, neuroblastoma, etc.) that
# happen to use the same drugs.

import re as _re

_GBM_GLIOMA_CONDITION_RE = _re.compile(
    r"""
    glioblastoma | \bgbm\b | gliosarcoma
    | glioma | high[\s-]grade\s+glioma | low[\s-]grade\s+glioma
    | diffuse\s+(intrinsic\s+pontine\s+)?glioma
    | astrocytoma | oligodendroglioma | oligoastrocytoma
    | oligo[\s-]astrocytoma
    | brain\s+(and\s+central\s+nervous\s+system\s+)?tumor
    | brain\s+cancer | brain\s+neoplasm
    | malignant\s+brain | primary\s+brain
    | cns\s+(tumor|neoplasm|cancer)
    | central\s+nervous\s+system\s+(tumor|neoplasm|cancer)
    | intracranial\s+(tumor|neoplasm)
    | neuroepithelial\s+tumor
    | malignant\s+neoplasm.*brain
    """,
    _re.IGNORECASE | _re.VERBOSE,
)

# Conditions that look brain-related but are NOT gliomas and should be
# excluded even if they matched the broad patterns above.
_NON_GLIOMA_EXCLUDE_RE = _re.compile(
    r"""
    ependymoma | medulloblastoma | meningioma
    | craniopharyngioma | schwannoma | acoustic\s+neuroma
    | neuroblastoma | pnet | primitive\s+neuroectodermal
    | pineoblastoma | pineocytoma | pinealoma
    | choroid\s+plexus | ganglioglioma | ganglioneuroma
    | hemangioblastoma | hemangiopericytoma
    | atrt | rhabdoid | medulloepithelioma
    | lymphoma | leukemia | melanoma
    | (?<!glio)sarcoma
    | metastatic.*brain | brain\s+metast
    """,
    _re.IGNORECASE | _re.VERBOSE,
)


def _is_glioma_relevant_condition(condition_name: str) -> bool:
    """Return True if the condition name is GBM/glioma-relevant."""
    if not condition_name:
        return False
    # Check exclusion first (more specific)
    if _NON_GLIOMA_EXCLUDE_RE.search(condition_name):
        return False
    # Then check inclusion
    return bool(_GBM_GLIOMA_CONDITION_RE.search(condition_name))


def _trial_has_glioma_condition(nct_id: str, db) -> bool:
    """Check whether a trial has at least one GBM/glioma-relevant condition."""
    from database.models import ConditionRecord, trial_conditions

    conditions = (
        db.query(ConditionRecord.name)
        .join(trial_conditions)
        .filter(trial_conditions.c.trial_nct_id == nct_id)
        .all()
    )
    for (cond_name,) in conditions:
        if _is_glioma_relevant_condition(cond_name):
            return True
    return False


# Regex for detecting non-glioma disease mentions in group titles/descriptions.
# A group is considered non-glioma if it explicitly mentions one of these
# conditions AND does NOT also mention a glioma-related term.
_GROUP_NON_GLIOMA_RE = _re.compile(
    r"""
    ependymoma | medulloblastoma | meningioma
    | craniopharyngioma | schwannoma
    | neuroblastoma
    | pineoblastoma | pineocytoma
    | choroid\s+plexus
    | atrt | rhabdoid
    | (?<!glio)sarcoma
    | osteosarcoma | rhabdomyosarcoma | ewing
    | melanoma | breast\s+cancer | lung\s+cancer
    | nsclc | non-?small\s+cell\s+lung
    | small\s+cell\s+lung
    | colorectal | colon\s+cancer
    | renal | kidney | rcc\b
    | prostate | ovarian | pancrea
    | hepato | liver\s+cancer | hcc\b
    | thyroid | cervical | bladder
    | endometri | esophag
    | gastric\s+(?:cancer|carcinoma|adenocarcinoma|tumor|neoplasm)
    | gastroenteropancreatic
    | lymphoma | leukemia
    | mesothelioma
    | carcinoid | neuroendocrine(?!\s+glioma)
    | myeloma | hodgkin
    | head\s+and\s+neck
    | squamous\s+cell\s+carcinoma
    """,
    _re.IGNORECASE | _re.VERBOSE,
)

_GROUP_GLIOMA_RE = _re.compile(
    r"""
    glioblastoma | \bgbm\b | gliosarcoma
    | glioma | astrocytoma | oligodendroglioma | oligoastrocytoma
    | high[\s-]grade\s+glioma | low[\s-]grade\s+glioma
    | brain\s+tumor | brain\s+cancer
    | malignant\s+glioma | diffuse\s+glioma
    | pontine\s+glioma | brain\s+stem\s+glioma
    """,
    _re.IGNORECASE | _re.VERBOSE,
)


def _is_group_glioma_relevant(group_title: str, group_description: str) -> bool:
    """Check if a results group/arm is GBM/glioma-relevant.

    Returns True if the group text mentions a glioma-related term, OR if
    it does NOT mention any specific non-glioma disease (i.e. neutral /
    treatment-only labels like "Arm A: Drug X 200 mg" are kept).

    Returns False only when the group explicitly mentions a non-glioma
    disease without also mentioning a glioma term.
    """
    combined = f"{group_title} {group_description}"

    has_glioma = bool(_GROUP_GLIOMA_RE.search(combined))
    has_non_glioma = bool(_GROUP_NON_GLIOMA_RE.search(combined))

    # If it mentions a glioma term, always keep it
    if has_glioma:
        return True

    # If it mentions a non-glioma disease, exclude it
    if has_non_glioma:
        return False

    # Neutral group (no disease mentioned) — keep it
    return True

# Development code → generic/DCNA name mapping.
# Trials often use internal codes or brand names; the DCNA dataset uses
# INN (generic) names.  This table maps common aliases.
DRUG_ALIASES = {
    # EGFR/HER family
    "BIBW2992": "AFATINIB", "BIBW 2992": "AFATINIB",
    "PF-299804": "DACOMITINIB", "PF299804": "DACOMITINIB",
    "OSI-774": "ERLOTINIB", "OSI774": "ERLOTINIB",
    "TARCEVA": "ERLOTINIB",
    "IRESSA": "GEFITINIB",
    "ZD1839": "GEFITINIB", "ZD-1839": "GEFITINIB",
    # VEGFR family
    "ZD6474": "VANDETANIB", "ZD 6474": "VANDETANIB", "ZACTIMA": "VANDETANIB",
    "AZD2171": "CEDIRANIB", "AZD-2171": "CEDIRANIB",
    "SU11248": "SUNITINIB", "SUTENT": "SUNITINIB",
    "BAY 43-9006": "SORAFENIB", "NEXAVAR": "SORAFENIB",
    "PTK787": "VATALANIB", "PTK/ZK": "VATALANIB",
    # mTOR
    "RAD001": "EVEROLIMUS", "RAD 001": "EVEROLIMUS", "AFINITOR": "EVEROLIMUS",
    "CCI-779": "TEMSIROLIMUS", "CCI779": "TEMSIROLIMUS",
    # Other targeted
    "ABT-888": "VELIPARIB", "ABT888": "VELIPARIB",
    "AZD6244": "SELUMETINIB", "AZD-6244": "SELUMETINIB",
    "MLN8237": "ALISERTIB",
    "CC-5013": "LENALIDOMIDE", "REVLIMID": "LENALIDOMIDE",
    "CP-751871": "FIGITUMUMAB", "CP751871": "FIGITUMUMAB",
    "MK-8628": "BIRABRESIB",
    "GDC-0449": "VISMODEGIB", "GDC0449": "VISMODEGIB",
    "RO4929097": "RG4733",
    "LBH589": "PANOBINOSTAT", "LBH-589": "PANOBINOSTAT",
    "SAHA": "VORINOSTAT", "MK-0683": "VORINOSTAT", "ZOLINZA": "VORINOSTAT",
    "AVASTIN": "BEVACIZUMAB",
    "ERBITUX": "CETUXIMAB",
    # Chemotherapy
    "TEMOZOLOMIDE": "TEMOZOLOMIDE", "TEMODAR": "TEMOZOLOMIDE", "TMZ": "TEMOZOLOMIDE",
    "CCNU": "LOMUSTINE",
    "BCNU": "CARMUSTINE",
    "VP-16": "ETOPOSIDE",
    "CPT-11": "IRINOTECAN",
    # Typos / spelling variants found in trial data
    "VORINOSTST": "VORINOSTAT",
    "TEMOZOLAMIDE": "TEMOZOLOMIDE",
    "FLUVASTATINE": "FLUVASTATIN",
    # Formulation variants
    "NAB-PACLITAXEL": "PACLITAXEL",
    "NAB-SIROLIMUS": "SIROLIMUS",
    "DOXORUBICIN HCL LIPOSOME": "DOXORUBICIN",
    "LIPOSOMAL DOXORUBICIN": "DOXORUBICIN",
    "PEGYLATED LIPOSOMAL DOXORUBICIN": "DOXORUBICIN",
}


# ── Data Loading ──────────────────────────────────────────────────────────


def _load_dcna_data():
    """Load DCNA CSV. Returns (patients, drugs, {drug: [values]})."""
    with open(DCNA_PATH, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        patients = header[1:]
        drugs = []
        data = {}
        for row in reader:
            drug = row[0]
            drugs.append(drug)
            data[drug] = [float(v) if v else 0.0 for v in row[1:]]
    return patients, drugs, data


def _load_expression_data():
    """Load expression CSV. Returns (patients, {symbol: [values]})."""
    with open(EXPR_PATH, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        patients = header[2:]
        data = {}
        for row in reader:
            symbol = row[1] or row[0]
            data[symbol] = [float(v) if v else 0.0 for v in row[2:]]
    return patients, data


def _load_drug_targets():
    """Load drug-gene target cache."""
    if os.path.exists(DRUG_TARGETS_CACHE_PATH):
        with open(DRUG_TARGETS_CACHE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def _strip_salt(name: str) -> str:
    """Remove common salt form suffixes from a drug name."""
    lower = name.lower()
    for suffix in SALT_SUFFIXES:
        if lower.endswith(suffix):
            return name[: len(name) - len(suffix)]
    return name


def _split_combination_drugs(name: str) -> list[str]:
    """Split combination drug entries into individual drug names.

    Handles patterns like:
      "Erlotinib + sirolimus"  -> ["Erlotinib", "sirolimus"]
      "Bevacizumab and Etoposide"  -> ["Bevacizumab", "Etoposide"]
      "Bevacizumab / Irinotecan"  -> ["Bevacizumab", "Irinotecan"]
      "BIBW 2992 plus TMZ"  -> ["BIBW 2992", "TMZ"]
      "Bevacizumab, CA4P"  -> ["Bevacizumab", "CA4P"]
    Returns a list with at least one entry (the original if no split found).
    """
    import re
    # Split on common combination separators
    # Order matters: try more specific patterns first
    parts = re.split(r'\s*(?:\+|/)\s*|\s+(?:and|plus|with|combined\s+with)\s+|\s*[,;]\s*', name, flags=re.IGNORECASE)
    # Filter out empty strings and non-drug phrases (radiation, etc.)
    non_drug_phrases = {"radiation therapy", "radiotherapy", "radiation",
                        "surgery", "placebo", "best supportive care"}
    result = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if p.lower() in non_drug_phrases:
            continue
        # Skip if it looks like a dosage or formulation note, not a drug
        if re.match(r'^\d+\s*(mg|ml|g|mcg|iu)\b', p, re.IGNORECASE):
            continue
        result.append(p)
    return result if result else [name]


def _parse_stratum_criteria_from_text(criteria_text: str) -> dict[str, dict]:
    """Extract per-stratum/per-arm molecular criteria from eligibility text.

    Looks for patterns like ``Stratum 1 (IDH wild-type)`` or
    ``Stratum 2 (IDH mutant)`` and returns a mapping of normalized stratum
    label -> criteria dict, e.g.::

        {"stratum 1": {"idh_wildtype": True}, "stratum 2": {"idh_mutant": True}}

    Used to override trial-level criteria for trials whose strata are split
    only in the eligibility prose (not as separate ArmRecords).
    """
    import re as _re
    if not criteria_text:
        return {}
    out: dict[str, dict] = {}
    pattern = _re.compile(
        r"(stratum\s+[A-Z0-9]+|arm\s+[A-Z0-9]+|group\s+[A-Z0-9]+|cohort\s+[A-Z0-9]+)\s*\(([^)]{1,120})\)",
        _re.IGNORECASE,
    )
    for m in pattern.finditer(criteria_text):
        label = " ".join(m.group(1).lower().split())
        body = m.group(2).lower()
        crit: dict = {}
        if _re.search(r"idh[12]?\s*[- ]?\s*(?:wild[\s-]?type|wt)", body):
            crit["idh_wildtype"] = True
        elif _re.search(r"idh[12]?\s*[- ]?\s*mut", body):
            crit["idh_mutant"] = True
        if _re.search(r"unmethyl", body):
            crit["mgmt_unmethylated"] = True
        elif _re.search(r"methyl", body):
            crit["mgmt_methylated"] = True
        if _re.search(r"braf\s*v600", body):
            crit["braf_v600e"] = True
        if _re.search(r"egfrviii|egfr\s*v(?:iii|3)", body):
            crit["egfrviii"] = True
        elif _re.search(r"egfr\s*amplif", body):
            crit["egfr_amplified"] = True
        if crit:
            out[label] = crit
    return out


def _parse_age_years(age_str: Optional[str]) -> Optional[float]:
    """Parse a CT.gov age string like '3 Years', '6 Months', '18 Years' to years.

    Returns None for empty/N/A/unparseable values so the caller leaves that bound open.
    """
    if not age_str:
        return None
    s = str(age_str).strip().lower()
    if not s or s in ("n/a", "na", "none"):
        return None
    import re as _re
    m = _re.match(r"(\d+(?:\.\d+)?)\s*(year|month|week|day)s?", s)
    if not m:
        return None
    val = float(m.group(1)); unit = m.group(2)
    if unit == "year":   return val
    if unit == "month":  return val / 12.0
    if unit == "week":   return val / 52.1775
    if unit == "day":    return val / 365.25
    return None


def _match_drug_to_dcna(drug_name: str, dcna_drugs: set[str]) -> Optional[str]:
    """Match a trial drug name to a DCNA drug name.

    Applies a cascade of matching strategies:
    1. Exact match (case-insensitive)
    2. Salt-form suffix stripping
    3. First-word / base-name match
    4. DRUG_ALIASES lookup (development codes, brand names -> generic)
    5. Punctuation cleanup (trailing periods, parenthetical notes)
    6. Hyphen normalization (AC480 <-> AC-480)
    7. Numeric prefix stripping (5-fluorouracil -> FLUOROURACIL)
    8. Leading non-drug words (and, IA, IV, oral, nab-)
    """
    import re

    upper = drug_name.strip().upper()
    if upper in dcna_drugs:
        return upper

    # ── Canonical alias resolution (e.g. "PARP Inhibitor BGB-290" -> "Pamiparib") ──
    try:
        from moa_classification.drug_aliases import resolve_drug_name
        resolved = resolve_drug_name(drug_name)
        if resolved and resolved.strip().upper() != upper:
            resolved_upper = resolved.strip().upper()
            if resolved_upper in dcna_drugs:
                return resolved_upper
            # Strip parenthetical "(CODE)" suffix the alias table tends to add
            if "(" in resolved_upper:
                bare = resolved_upper.split("(")[0].strip()
                if bare in dcna_drugs:
                    return bare
    except Exception:
        pass
    stripped = _strip_salt(upper)
    if stripped in dcna_drugs:
        return stripped
    # Try matching first word (base name)
    base = upper.split()[0] if " " in upper else None
    if base and base in dcna_drugs:
        return base

    # ── Alias lookup (development codes, brand names -> generic) ──
    alias = DRUG_ALIASES.get(upper)
    if alias and alias in dcna_drugs:
        return alias
    alias_stripped = DRUG_ALIASES.get(stripped)
    if alias_stripped and alias_stripped in dcna_drugs:
        return alias_stripped
    if base:
        alias_base = DRUG_ALIASES.get(base)
        if alias_base and alias_base in dcna_drugs:
            return alias_base

    # ── Punctuation cleanup ──
    cleaned = upper.rstrip(".,;:")
    if cleaned != upper and cleaned in dcna_drugs:
        return cleaned
    # Strip parenthetical suffixes: "CARMUSTINE(BCNU)" -> "CARMUSTINE"
    if "(" in cleaned:
        paren_stripped = cleaned.split("(")[0].strip()
        if paren_stripped in dcna_drugs:
            return paren_stripped

    # ── Hyphen normalization ──
    # Insert hyphen between letters and digits: AC480 -> AC-480
    hyphenated = re.sub(r"([A-Z]+)(\d)", r"\1-\2", upper)
    if hyphenated != upper and hyphenated in dcna_drugs:
        return hyphenated
    # Remove hyphens: AC-480 -> AC480
    dehyphenated = upper.replace("-", "")
    if dehyphenated != upper and dehyphenated in dcna_drugs:
        return dehyphenated

    # ── Numeric prefix stripping (5-fluorouracil -> FLUOROURACIL) ──
    num_stripped = re.sub(r"^\d+-", "", upper)
    if num_stripped != upper and num_stripped in dcna_drugs:
        return num_stripped

    # ── Leading non-drug word stripping ──
    for prefix in ("AND ", "IA ", "IV ", "ORAL ", "NAB-"):
        if upper.startswith(prefix):
            remainder = upper[len(prefix):].strip()
            if remainder in dcna_drugs:
                return remainder
            # Also try salt-stripping on the remainder
            remainder_stripped = _strip_salt(remainder)
            if remainder_stripped in dcna_drugs:
                return remainder_stripped

    # ── Whole-word substring fallback ──
    # Catches cases where the DCNA drug name appears embedded in a descriptive
    # intervention label (e.g. "Superselective Intraarterial Infusion of Cetuximab",
    # "Nab paclitaxel", "ziv-aflibercept", "PEG-interferon alfa-2b",
    # "Placebo Cediranib", "Lower Dose Topotecan", etc.).
    # Restricted to DCNA names of length >= 6 to avoid spurious short-token hits,
    # and prefers the longest match so multi-word drugs (e.g. "MOTEXAFIN GADOLINIUM",
    # "INTERFERON ALFA-2B") win over single-word components.
    candidates = sorted((d for d in dcna_drugs if len(d) >= 6), key=len, reverse=True)
    for d in candidates:
        if re.search(rf"(?<![A-Z0-9]){re.escape(d)}(?![A-Z0-9])", upper):
            return d

    return None


# ── Response Rate Extraction ──────────────────────────────────────────────

# Priority tiers for response rate outcome measures (lower = better).
# Returns None if the measure is not a response rate outcome.
_RR_PRIORITY_TIERS = [
    # Tier 0: Explicit ORR / objective response rate
    (0, ["objective response rate", "orr"]),
    # Tier 1: Overall response rate
    (1, ["overall response rate"]),
    # Tier 2: Other specific response rate measures
    (2, [
        "tumor response rate", "tumour response rate",
        "tumor objective response", "tumour objective response",
        "radiographic response rate",
        "best overall response rate",
        "treatment response rate", "treatment responses rate",
        "confirmed response rate",
    ]),
    # Tier 3: Named response-type measures
    (3, [
        "response rate", "response rates",
        "best overall response", "best radiographic response",
        "radiographic response", "radiological response",
        "clinical response", "disease response",
        "tumor response", "tumour response",
    ]),
    # Tier 4: Clinical benefit / disease control (related but distinct)
    (4, [
        "clinical benefit rate", "cbr",
        "disease control rate", "dcr",
        "disease control",
        "clinical benefit",
    ]),
    # Tier 5: Generic response mentions
    (5, [
        "complete or partial response",
        "complete and partial response",
        "partial response",
        "complete response",
        "complete remission",
        "partial remission",
        "objective response",
        "overall response",
        "response to treatment",
        "response",
    ]),
]


_RR_EXCLUSIONS = [
    "duration of response", "duration of overall response",
    "time to response", "time to first response",
    "depth of response",
]


def _response_rate_priority(measure_lower: str) -> Optional[int]:
    """Return priority tier for a response rate measure, or None if not matched."""
    # Exclude duration/time measures that happen to contain 'response'
    if any(ex in measure_lower for ex in _RR_EXCLUSIONS):
        return None
    for priority, keywords in _RR_PRIORITY_TIERS:
        for kw in keywords:
            if kw in measure_lower:
                return priority
    return None


_POSITIVE_CATEGORIES = {
    "yes", "responder", "responders", "response", "responded",
    "complete response", "partial response", "complete or partial response",
    "complete remission", "partial remission", "complete or partial remission",
    "objective response", "overall response", "objective response rate",
    "cr", "pr", "cr+pr", "cr/pr", "cr or pr",
    "tumor response", "tumour response", "with response", "achieved response",
}
_NEGATIVE_CATEGORIES = {
    "no", "non-responder", "non responders", "non-responders", "no response",
    "stable disease", "stable", "sd", "sd (stable disease)",
    "progressive disease", "progression", "progressed", "progressive",
    "pd", "pd (progressive disease)", "sd+pd", "sd/pd",
    "without response", "non response", "no response (sd+pd)",
    "disease progression", "disease stable",
}



def _is_positive_category(cat: str) -> bool:
    return (cat or "").strip().lower() in _POSITIVE_CATEGORIES


def _is_negative_category(cat: str) -> bool:
    return (cat or "").strip().lower() in _NEGATIVE_CATEGORIES


def _filter_groups_by_category(data: list) -> list:
    """For binary categorical outcomes (e.g. Tumor Response Yes/No), keep
    only the responder/positive category entries so we don't accidentally
    interpret the No/Non-responder count as the response rate.

    - If any entry carries an explicit "category" label, drop all rows whose
      category is in the negative set.
    - If multiple entries share a group_title and at least one is positive,
      keep only the positive ones for that group.
    - If category info is absent BUT the same group_title has multiple
      integer entries that sum to participants_count (the classic Yes/No
      pattern), the data is ambiguous: drop the group entirely so we don't
      report a wrong rate.
    """
    if not isinstance(data, list) or not data:
        return data

    def _cat_of(e: dict) -> str:
        # CT.gov v2 stores binary Yes/No labels in class_title (classes layer),
        # while category may be empty. Prefer category, fall back to class_title.
        return (e.get("category") or e.get("class_title") or "").strip()

    has_category = any(_cat_of(e) for e in data)

    # Bucket by group_title for per-group reasoning
    from collections import defaultdict
    by_group: dict[str, list[dict]] = defaultdict(list)
    for e in data:
        by_group[e.get("group_title", "")].append(e)

    out: list[dict] = []
    for title, entries in by_group.items():
        if has_category:
            positives = [e for e in entries if _is_positive_category(_cat_of(e))]
            negatives = [e for e in entries if _is_negative_category(_cat_of(e))]
            neutral = [e for e in entries if not _is_positive_category(_cat_of(e)) and not _is_negative_category(_cat_of(e))]
            if positives:
                out.extend(positives)
            elif negatives and not neutral:
                # Only negative-category data — unusable as a response rate.
                continue
            else:
                out.extend(neutral)
            continue

        # No category info: detect ambiguous binary-categorical pair.
        if len(entries) >= 2:
            participants = max((e.get("participants_count") or 0) for e in entries)
            int_values: list[float] = []
            for e in entries:
                try:
                    v = float(str(e.get("value", "")).strip())
                except (ValueError, TypeError):
                    int_values = []
                    break
                if not v.is_integer():
                    int_values = []
                    break
                int_values.append(v)
            if int_values and participants > 0 and abs(sum(int_values) - participants) <= 1:
                # Looks like a Yes/No split — refuse to guess.
                continue
        out.extend(entries)
    return out


def extract_response_rate(results_json_str: str, measure: str = "") -> Optional[float]:
    """Parse a response rate (0-1 proportion) from outcome results_json.

    Handles proportions, percentages, and count-based values.
    Returns the first valid response rate found, or None.

    """
    try:
        data = json.loads(results_json_str) if isinstance(results_json_str, str) else results_json_str
    except (json.JSONDecodeError, TypeError):
        return None

    if not isinstance(data, list) or not data:
        return None

    data = _filter_groups_by_category(data)
    if not data:
        return None

    # ── Combined CR+PR aggregation ──────────────────────────────────────
    # When a trial reports response by RECIST category (CR / PR / SD / PD),
    # _filter_groups_by_category has already dropped SD/PD rows, so what
    # remains for a given group_title is the CR row, the PR row, or both.
    # Sum integer participant counts across those positive-category rows
    # and divide by participants_count (which is identical across rows of
    # the same group). Example: NCT00045110 → CR=1, PR=1, N=48 → 4.2%.
    def _cat_of(e: dict) -> str:
        return (e.get("category") or e.get("class_title") or "").strip()

    from collections import defaultdict
    by_group: dict[str, list[dict]] = defaultdict(list)
    for e in data:
        by_group[e.get("group_title", "")].append(e)

    for _title, entries in by_group.items():
        # Aggregate when there is at least one positive-category integer
        # participant count and the group has multiple categorized rows
        # (i.e. category-style RECIST reporting). _filter_groups_by_category
        # already removed SD/PD; what remains here is the positive subset.
        positives = [e for e in entries if _is_positive_category(_cat_of(e))]
        if not positives:
            continue
        entries = positives
        participants = max((e.get("participants_count") or 0) for e in entries)
        if participants <= 0:
            continue
        total = 0.0
        all_int = True
        for e in entries:
            try:
                v = float(str(e.get("value", "")).strip())
            except (ValueError, TypeError):
                all_int = False
                break
            if not v.is_integer():
                all_int = False
                break
            total += v
        if not all_int:
            continue
        if 0 <= total <= participants:
            return round(total / participants, 4)

    for group in data:
        value_str = str(group.get("value", "")).strip()
        if not value_str or value_str.upper() in ("NA", "NE", "NR", "N/A", ""):
            continue

        try:
            value = float(value_str)
        except ValueError:
            continue

        participants = group.get("participants_count", 0) or 0
        param_type = (group.get("param_type") or "").upper()
        unit = (group.get("unit") or "").lower()
        unit_class = _classify_unit(unit)

        # Unit takes precedence over param_type — when CT.gov reports a
        # percentage value, treat the value as a direct response rate even if
        # the param_type happens to be COUNT_OF_PARTICIPANTS.
        # Unit says percentage → use value directly. Only divide by 100 when
        # the value is reported on a 0-100 scale.
        if unit_class == "percentage":
            if 0 <= value <= 1:
                return round(value, 4)  # already fractional
            if 1 < value <= 100:
                return round(value / 100.0, 4)
            continue

        # Unit says proportion → use directly (0-1 scale)
        if unit_class == "proportion" and 0 <= value <= 1:
            return round(value, 4)

        # Unit says count of participants → divide by total
        if unit_class == "count" and participants > 0 and value <= participants:
            rate = value / participants
            if 0 <= rate <= 1:
                return round(rate, 4)
            continue

        # No unit info but param_type is an explicit count → divide by total
        if param_type == "COUNT_OF_PARTICIPANTS" and unit_class == "unknown" and participants > 0:
            rate = value / participants
            if 0 <= rate <= 1:
                return round(rate, 4)
            continue

        # Fallback: proportion (0-1)
        if 0 <= value <= 1:
            return round(value, 4)

        # Fallback: likely percentage (value > 1 and ≤ 100)
        if 1 < value <= 100:
            return round(value / 100.0, 4)

    return None


# ── Eligibility Criteria Parsing ──────────────────────────────────────────


def parse_molecular_criteria(criteria_text: str) -> dict:
    """Extract molecular eligibility criteria from free text.

    Returns dict with keys like 'mgmt_methylated', 'idh_mutant', 'egfr_amplified', etc.
    Each value is True (required) or False (excluded) or absent (no requirement).

    Covers: MGMT methylation, IDH mutations (including R132H), EGFR alterations
    (amplification, EGFRvIII, mutations, overexpression), TP53 mutations, PTEN
    loss/mutations, BRAF mutations (including V600E), ATRX loss, 1p/19q codeletion,
    TERT promoter mutations, CDKN2A deletion, CDK4/MDM2/PDGFRA/MET amplification,
    NF1/PIK3CA/RB1 mutations, NTRK/ALK/ROS1/FGFR fusions, TMB-high, MSI-high,
    PD-L1 expression, H3K27M, recurrence status, and prior treatment markers.
    """
    import re
    criteria = {}
    text = criteria_text.lower() if criteria_text else ""
    if not text:
        return criteria

    # ── MGMT methylation ──
    if re.search(r"mgmt\s*(?:promoter\s*)?(?:un)?methyl", text):
        if re.search(r"unmethyl", text):
            criteria["mgmt_unmethylated"] = True
        else:
            criteria["mgmt_methylated"] = True

    # ── IDH mutations ──
    if re.search(r"idh[12]?\s*(?:r132h|r132[a-z]?|r172k)", text):
        criteria["idh1_r132h"] = True
    if re.search(r"idh[12]?\s*(?:mut|wild|wt)", text):
        if re.search(r"idh[12]?\s*(?:wild|wt)", text):
            criteria["idh_wildtype"] = True
        elif re.search(r"idh[12]?\s*mut", text):
            criteria["idh_mutant"] = True

    # ── EGFR ──
    if re.search(r"egfr\s*(?:amplif|amp\b)", text):
        criteria["egfr_amplified"] = True
    # EGFRvIII explicit negative (check before positive so "EGFRvIII negative"
    # is not misclassified as a positive requirement)
    if re.search(
        r"(?:egfrviii|egfr\s*v(?:iii|3))\s*(?:negative|neg\b|wild[- ]?type|wt\b|absent)"
        r"|(?:no|without|lacking|non[- ]?)\s*(?:egfrviii|egfr\s*v(?:iii|3))",
        text,
    ):
        criteria["egfrviii_negative"] = True
    elif re.search(r"egfr\s*v(?:iii|3)|egfrviii", text):
        criteria["egfrviii"] = True
    if re.search(r"egfr\s*(?:overexpress|over-express)", text):
        criteria["egfr_overexpressed"] = True
    if re.search(r"egfr\s*(?:mutation|mutant|mut\b)", text):
        criteria["egfr_mutant"] = True
    # Generic EGFR alteration catch-all
    if re.search(r"egfr\s*(?:alter|positive)", text) and "egfr_amplified" not in criteria:
        criteria["egfr_altered"] = True

    # ── TP53 ──
    if re.search(r"tp53\s*(?:mutation|mutant|mut\b|alter)", text):
        criteria["tp53_mutant"] = True
    if re.search(r"tp53\s*(?:wild|wt)", text):
        criteria["tp53_wildtype"] = True

    # ── PTEN ──
    if re.search(r"pten\s*(?:loss|delet|del\b|absent|deficien)", text):
        criteria["pten_loss"] = True
    if re.search(r"pten\s*(?:mutation|mutant|mut\b|alter)", text):
        criteria["pten_mutant"] = True
    if re.search(r"pten\s*(?:intact|positive|present|wild|wt)", text):
        criteria["pten_intact"] = True

    # ── BRAF ──
    if re.search(r"braf\s*v600[e]?\b", text):
        criteria["braf_v600e"] = True
    elif re.search(r"braf\s*(?:mutation|mutant|mut\b|alter)", text):
        criteria["braf_mutant"] = True

    # ── ATRX ──
    if re.search(r"atrx\s*(?:loss|absent|delet|mut|alter)", text):
        criteria["atrx_loss"] = True

    # ── 1p/19q ──
    if re.search(r"1p[/\\]?19q\s*(?:co-?delet|loss)", text):
        criteria["1p19q_codeletion"] = True
    if re.search(r"(?:no|without|intact|non).{0,15}1p[/\\]?19q", text):
        criteria["1p19q_intact"] = True

    # ── TERT ──
    if re.search(r"tert\s*(?:promoter\s*)?(?:mutation|mutant|mut\b)", text):
        criteria["tert_mutant"] = True

    # ── CDKN2A ──
    if re.search(r"cdkn2a\s*(?:delet|del\b|loss|homozyg)", text):
        criteria["cdkn2a_deleted"] = True

    # ── Amplifications ──
    for gene in ["cdk4", "mdm2", "pdgfra", "met", "myc", "mycn"]:
        if re.search(rf"{gene}\s*(?:amplif|amp\b|gain)", text):
            criteria[f"{gene}_amplified"] = True

    # ── NF1, PIK3CA, RB1 mutations ──
    for gene in ["nf1", "pik3ca", "rb1"]:
        if re.search(rf"{gene}\s*(?:mutation|mutant|mut\b|loss|alter|delet)", text):
            criteria[f"{gene}_mutant"] = True

    # ── Fusions ──
    for gene in ["ntrk", "ntrk1", "ntrk2", "ntrk3"]:
        if re.search(rf"{gene}\s*(?:fusion|rearrange|transloc)", text):
            criteria["ntrk_fusion"] = True
    if re.search(r"alk\s*(?:fusion|rearrange|transloc)", text):
        criteria["alk_fusion"] = True
    if re.search(r"ros1\s*(?:fusion|rearrange|transloc)", text):
        criteria["ros1_fusion"] = True
    for gene in ["fgfr", "fgfr1", "fgfr2", "fgfr3"]:
        if re.search(rf"{gene}\s*(?:fusion|rearrange|alter|amplif|mut)", text):
            criteria["fgfr_altered"] = True

    # ── TMB / MSI ──
    if re.search(r"(?:tmb|tumor\s*mutation\s*burden)\s*(?:high|h\b|>|>=)", text):
        criteria["tmb_high"] = True
    if re.search(r"(?:msi|microsatellite\s*instability)\s*(?:high|h\b|msi-h)", text):
        criteria["msi_high"] = True

    # ── PD-L1 ──
    if re.search(r"pd-?l1\s*(?:positive|express|>|>=|high|tps)", text):
        criteria["pdl1_positive"] = True

    # ── H3K27M ──
    if re.search(r"h3\s*k27m|h3f3a\s*(?:k27m|mut)", text):
        criteria["h3k27m"] = True

    # ── Recurrence / prior treatment ──
    # Only match unambiguous recurrent-population phrases. "Progressive disease"
    # alone is RANO/RECIST response-assessment terminology and must NOT trigger
    # the recurrent flag.
    if re.search(r"(?:recurrent|recurrence|relapsed|relapse)\s*(?:glioblastoma|gbm|glioma|brain\s*tumor)", text):
        criteria["recurrent"] = True
    if re.search(r"newly\s*diagnos", text):
        criteria["newly_diagnosed"] = True
    # Newly diagnosed and recurrent are mutually exclusive — newly_diagnosed wins.
    if criteria.get("newly_diagnosed"):
        criteria.pop("recurrent", None)
    if re.search(r"(?:prior|previous)\s*(?:temozolomide|tmz)", text):
        criteria["prior_tmz"] = True
    if re.search(r"(?:prior|previous)\s*(?:bevacizumab|avastin)", text):
        criteria["prior_bevacizumab"] = True
    if re.search(r"alkylator.{0,10}resist", text):
        criteria["alkylator_resistant"] = True

    return criteria


def _parse_group_molecular_criteria(group_title: str, group_description: str = "") -> dict:
    """Parse molecular criteria from a group title AND description.

    Scans both the group title (e.g. 'Methylated', 'IDH Mutant Arm')
    and the group description (e.g. 'Subjects with EGFR Gene-amplified
    Glioblastoma') for biomarker requirements.

    Uses the full ``parse_molecular_criteria`` engine on the description
    text and a focused quick-parse on the title, then merges them.
    """
    import re

    # ── Quick-parse from title (short labels like "Methylated", "IDH-wt") ──
    title_text = group_title.lower() if group_title else ""
    criteria = {}

    # MGMT methylation
    if re.search(r"unmethyl", title_text):
        criteria["mgmt_unmethylated"] = True
    elif re.search(r"methyl", title_text):
        criteria["mgmt_methylated"] = True

    # IDH
    if re.search(r"idh[12]?\s*(?:wild|wt)", title_text):
        criteria["idh_wildtype"] = True
    elif re.search(r"idh[12]?\s*mut", title_text):
        criteria["idh_mutant"] = True

    # EGFR — distinguish sub-types in title quick-parse
    if re.search(r"egfr\s*(?:gene[- ]*)?amplif", title_text):
        criteria["egfr_amplified"] = True
    if re.search(r"egfr\s*(?:viii|v3|variant\s*(?:iii|3))|egfrviii", title_text):
        criteria["egfrviii"] = True
    if re.search(r"egfr\s*overexpress", title_text):
        criteria["egfr_overexpressed"] = True
    if re.search(r"egfr\s*mut", title_text) and "egfr_amplified" not in criteria:
        criteria["egfr_mutant"] = True
    # Generic fallback only if no specific sub-type matched from title
    if (not any(k.startswith("egfr") for k in criteria)
            and re.search(r"egfr\s*(?:positive|pos\b|alter|gene)", title_text)):
        criteria["egfr_altered"] = True

    # BRAF
    if re.search(r"braf\s*v600", title_text):
        criteria["braf_v600e"] = True

    # 1p/19q
    if re.search(r"1p[/\\]?19q", title_text):
        criteria["1p19q_codeletion"] = True

    # Recurrence/resistance indicators
    if re.search(r"alkylator.{0,10}resist", title_text):
        criteria["alkylator_resistant"] = True
    if re.search(r"recurrent|progressive", title_text):
        criteria["recurrent"] = True

    # ── Full-depth parse from description ──
    if group_description:
        desc_criteria = _parse_group_description_criteria(group_description)
        # Merge: description criteria supplement (but don't override) title criteria
        for key, value in desc_criteria.items():
            if key not in criteria:
                criteria[key] = value

    return criteria


def _parse_group_description_criteria(description: str) -> dict:
    """Parse molecular / eligibility criteria from a group description.

    Descriptions are longer free-text fields that may contain phrases like:
      "Subjects with EGFR Gene-amplified Glioblastoma"
      "Recurrent IDH1/2-mutant glioma (WHO grades II/III)"
      "Participants with rGBM uMGMT or mMGMT received ..."
      "Methylated MGMT (O[6]-methylguanine-DNA methyltransferase)"

    This function applies the same comprehensive patterns used by
    ``parse_molecular_criteria`` (the trial-level criteria parser)
    but with additional patterns specific to group descriptions.

    **Negation-aware:** Phrases like "with or without EGFR", "had or
    did not have EGFR", "regardless of MGMT" indicate the biomarker
    is NOT required and the criterion is suppressed.
    """
    import re

    text = description.lower() if description else ""
    if not text:
        return {}

    criteria = {}

    # ── Negation patterns ──
    # Detect phrases that negate a biomarker requirement, e.g.:
    #   "who had or did not have EGFR gene-amplified"
    #   "with or without MGMT methylation"
    #   "regardless of IDH status"
    #   "irrespective of EGFR amplification"
    #   "uMGMT or mMGMT" (both mentioned = no filtering)
    negated_markers: set[str] = set()

    # "had or did not have X", "with or without X", "regardless of X",
    # "irrespective of X"
    neg_patterns = [
        r"(?:had|have|has)\s+or\s+(?:did\s+)?not\s+(?:had|have)\s+(\w[\w\s/-]{2,30})",
        r"(?:with|having)\s+or\s+without\s+(\w[\w\s/-]{2,30})",
        r"(?:regardless|irrespective)\s+of\s+(\w[\w\s/-]{2,30})",
        r"(?:did\s+not|do\s+not|does\s+not)\s+(?:express|have|carry)\s+(?:either\s+)?(\w[\w\s/-]{2,30})",
        r"(?:biomarker|marker)[- ]*negative.{0,60}(egfr|egfrviii|pten|mgmt|idh|braf)",
        r"(?:negative|absent|lack\w*)\s+(?:for\s+)?(\w[\w\s/-]{2,30})",
        r"(?:without|lacking|no)\s+(egfr|egfrviii|pten|mgmt|idh|braf)[\w\s/-]{0,20}(?:express|amplif|mut|methyl|alter)",
    ]
    for pat in neg_patterns:
        for m in re.finditer(pat, text):
            neg_text = m.group(1).lower().strip()
            if "egfr" in neg_text:
                negated_markers.add("egfr")
            if "mgmt" in neg_text or "methyl" in neg_text:
                negated_markers.add("mgmt")
            if "idh" in neg_text:
                negated_markers.add("idh")
            if "braf" in neg_text:
                negated_markers.add("braf")
            if "pten" in neg_text:
                negated_markers.add("pten")

    # "uMGMT or mMGMT" / "mMGMT or uMGMT" — both statuses = no requirement
    if re.search(r"(?:umgmt|unmethylat\w*).{0,20}(?:mmgmt|methylat\w*)|(?:mmgmt|methylat\w*).{0,20}(?:umgmt|unmethylat\w*)", text):
        negated_markers.add("mgmt")

    # ── MGMT ──
    if "mgmt" not in negated_markers:
        if re.search(r"unmethylat\w*\s*mgmt|umgmt\b", text):
            criteria["mgmt_unmethylated"] = True
        elif re.search(r"methylat\w*\s*mgmt|mmgmt\b|mgmt\s*(?:promoter\s*)?methylat", text):
            criteria["mgmt_methylated"] = True

    # ── IDH ──
    if "idh" not in negated_markers:
        if re.search(r"idh[12]?(?:/[12])?[/ -]*(?:wild|wt\b|wild-?type)", text):
            criteria["idh_wildtype"] = True
        elif re.search(r"idh[12]?(?:/[12])?[/ -]*(?:mut\w*)", text):
            criteria["idh_mutant"] = True

    # ── EGFR ──
    # Distinguish specific EGFR sub-types for proper patient filtering:
    #   egfr_amplified  → EGFR gene amplification / copy-number gain
    #   egfrviii        → EGFRvIII (variant III truncation)
    #   egfr_mutant     → EGFR point mutations
    #   egfr_overexpressed → EGFR protein overexpression
    #   egfr_altered    → generic / unspecified EGFR alteration
    # EGFRvIII explicit negative / wildtype — keep only patients WITHOUT the
    # variant. This is handled before the generic EGFR negation guard so
    # "EGFRvIII negative" does not disable all EGFR parsing.
    if re.search(
        r"(?:egfrviii|egfr\s*(?:viii|v3|variant\s*(?:iii|3)))\s*(?:negative|neg\b|wild[- ]?type|wt\b|absent)"
        r"|(?:no|without|lacking|non[- ]?)\s*(?:egfrviii|egfr\s*(?:viii|v3|variant\s*(?:iii|3)))",
        text,
    ):
        criteria["egfrviii_negative"] = True

    if "egfr" not in negated_markers:
        # Amplification
        if re.search(r"egfr\s*(?:gene[- ]*)?amplif\w*", text):
            criteria["egfr_amplified"] = True
        # EGFRvIII (only if not already flagged as negative)
        if (
            "egfrviii_negative" not in criteria
            and re.search(r"egfr\s*(?:viii|v3|variant\s*(?:iii|3))|egfrviii", text)
        ):
            criteria["egfrviii"] = True
        # Overexpression
        if re.search(r"egfr\s*overexpress\w*", text):
            criteria["egfr_overexpressed"] = True
        # Mutation (not amplification/vIII)
        if re.search(r"egfr\s*(?:mut\w+)", text) and "egfr_amplified" not in criteria:
            criteria["egfr_mutant"] = True
        # Generic positive / altered (only if no specific type matched)
        if (not any(k.startswith("egfr") for k in criteria)
                and re.search(r"egfr\s*(?:positive|pos\b|alter)", text)):
            criteria["egfr_altered"] = True

    # ── BRAF ──
    if re.search(r"braf\s*v600[e]?\b", text):
        criteria["braf_v600e"] = True
    elif re.search(r"braf\s*(?:mutation|mutant|mut\b|alter)", text):
        criteria["braf_mutant"] = True

    # ── PTEN ──
    if "pten" not in negated_markers:
        if re.search(r"pten\s*(?:loss|delet|absent|mut\w*|deficien)", text):
            criteria["pten_loss"] = True

    # ── TP53 ──
    if re.search(r"tp53\s*(?:mut\w*|loss|alter|delet)", text):
        criteria["tp53_mutant"] = True

    # ── ATRX ──
    if re.search(r"atrx\s*(?:loss|absent|delet|mut\w*|alter)", text):
        criteria["atrx_loss"] = True

    # ── 1p/19q ──
    if re.search(r"1p[/\\]?19q\s*(?:co-?delet|loss)", text):
        criteria["1p19q_codeletion"] = True
    if re.search(r"(?:no|without|intact|non).{0,15}1p[/\\]?19q", text):
        criteria["1p19q_intact"] = True

    # ── TERT ──
    if re.search(r"tert\s*(?:promoter\s*)?(?:mutation|mutant|mut\b)", text):
        criteria["tert_mutant"] = True

    # ── CDKN2A ──
    if re.search(r"cdkn2a\s*(?:delet|del\b|loss|homozyg)", text):
        criteria["cdkn2a_deleted"] = True

    # ── Amplifications ──
    for gene in ["cdk4", "mdm2", "pdgfra", "met", "myc", "mycn"]:
        if re.search(rf"{gene}\s*(?:amplif|amp\b|gain)", text):
            criteria[f"{gene}_amplified"] = True

    # ── NF1, PIK3CA, RB1 mutations ──
    for gene in ["nf1", "pik3ca", "rb1"]:
        if re.search(rf"{gene}\s*(?:mutation|mutant|mut\b|loss|alter|delet)", text):
            criteria[f"{gene}_mutant"] = True

    # ── Fusions ──
    for gene in ["ntrk", "ntrk1", "ntrk2", "ntrk3"]:
        if re.search(rf"{gene}\s*(?:fusion|rearrange|transloc)", text):
            criteria["ntrk_fusion"] = True
    if re.search(r"alk\s*(?:fusion|rearrange|transloc)", text):
        criteria["alk_fusion"] = True
    if re.search(r"ros1\s*(?:fusion|rearrange|transloc)", text):
        criteria["ros1_fusion"] = True
    for gene in ["fgfr", "fgfr1", "fgfr2", "fgfr3"]:
        if re.search(rf"{gene}\s*(?:fusion|rearrange|alter|amplif|mut)", text):
            criteria["fgfr_altered"] = True

    # ── TMB / MSI ──
    if re.search(r"(?:tmb|tumor\s*mutation\s*burden)\s*(?:high|h\b|>|>=)", text):
        criteria["tmb_high"] = True
    if re.search(r"(?:msi|microsatellite\s*instability)\s*(?:high|h\b|msi-h)", text):
        criteria["msi_high"] = True

    # ── PD-L1 ──
    if re.search(r"pd-?l1\s*(?:positive|express|>|>=|high|tps)", text):
        criteria["pdl1_positive"] = True

    # ── H3K27M ──
    if re.search(r"h3\s*k27m|h3f3a\s*(?:k27m|mut)", text):
        criteria["h3k27m"] = True

    # ── Recurrence / prior treatment ──
    # See parse_molecular_criteria: "progressive disease" is RANO/RECIST
    # response language, not a recurrent-population indicator.
    if re.search(r"(?:recurrent|recurrence|relapsed|relapse)\s*(?:glioblastoma|gbm|glioma|brain\s*tumor)", text):
        criteria["recurrent"] = True
    if re.search(r"newly\s*diagnos", text):
        criteria["newly_diagnosed"] = True
    if criteria.get("newly_diagnosed"):
        criteria.pop("recurrent", None)
    if re.search(r"(?:prior|previous|failed?)\s*(?:temozolomide|tmz)", text):
        criteria["prior_tmz"] = True
    if re.search(r"(?:prior|previous|failed?|progression\s+on\s+(?:a\s+)?)\s*(?:bevacizumab|avastin)", text):
        criteria["prior_bevacizumab"] = True
    if re.search(r"bevacizumab[- ]*(?:fail|resist|refract|progress)", text):
        criteria["prior_bevacizumab"] = True
    if re.search(r"alkylator.{0,10}resist", text):
        criteria["alkylator_resistant"] = True

    return criteria


def _extract_per_group_response_rates(results_json_str: str) -> list[dict]:
    """Legacy wrapper — redirects to _extract_all_group_response_rates."""
    return _extract_all_group_response_rates(results_json_str)


def _extract_all_group_response_rates(results_json_str: str, measure: str = "") -> list[dict]:
    """Extract response rates per group from results_json for ALL groups.

    Returns a list of dicts with keys:
        group_title, criteria, response_rate, participants, group_description.

    Unlike the old version, this does NOT require molecular criteria — it
    splits every multi-group outcome so that different arms/therapies/doses
    are treated as separate entries.  Molecular criteria are still parsed
    when present and attached for downstream patient filtering.

    """
    try:
        data = json.loads(results_json_str) if isinstance(results_json_str, str) else results_json_str
    except (json.JSONDecodeError, TypeError):
        return []

    if not isinstance(data, list) or not data:
        return []

    # Drop negative/ambiguous categorical rows so we don't treat the No
    # bucket of a Yes/No outcome as a response rate.
    data = _filter_groups_by_category(data)
    if not data:
        return []

    # Group entries by group_title (multiple rows per group for different response categories)
    from collections import defaultdict
    groups: dict[str, list[dict]] = defaultdict(list)
    for entry in data:
        title = entry.get("group_title", "")
        if title:
            groups[title].append(entry)

    if len(groups) < 2:
        # Only one group — no splitting needed
        return []

    # Extract response rate per group (regardless of molecular criteria)
    results = []
    for title, entries in groups.items():
        rr = _extract_rr_from_group_entries(entries)
        if rr is not None and 0 <= rr < 1:
            participants = max((e.get("participants_count") or 0) for e in entries)
            # Capture description for drug identification and criteria parsing
            desc = entries[0].get("group_description", "") if entries else ""
            # Parse molecular criteria from BOTH title AND description
            mc = _parse_group_molecular_criteria(title, desc)
            results.append({
                "group_title": title,
                "criteria": mc,
                "response_rate": rr,
                "participants": participants,
                "group_description": desc,
            })

    # Only return if we got at least 2 groups with valid rates
    if len(results) < 2:
        return []

    return results


def _classify_unit(unit: str) -> str:
    """Classify an outcome unit string as 'percentage', 'proportion', 'count', or 'unknown'.

    CT.gov uses many variations of unit strings.  The key distinctions:
      - "percentage of participants", "Percent of Participants", "%" → percentage (0-100)
      - "proportion of participants", "proportion of patients"       → proportion (0-1)
      - "Participants", "participants", "Number of participants"     → count (needs ÷ total)
      - Everything else                                              → unknown
    """
    lower = unit.lower()
    # Check percentage first — "percentage of participants" contains both
    # "percent" and "participant", so order matters.
    if "percent" in lower or "%" in lower:
        return "percentage"
    if "proportion" in lower:
        return "proportion"
    if "participant" in lower or "patient" in lower:
        return "count"
    return "unknown"


def _extract_rr_from_group_entries(entries: list[dict]) -> Optional[float]:
    """Extract a response rate from a single group's result entries.

    If every entry carries a positive RECIST category (CR / PR / etc.),
    the integer participant counts are summed and divided by the shared
    participants_count to yield a combined response rate (e.g. CR=1 + PR=1
    out of 48 → 4.2%). Otherwise the first parseable rate is returned.
    """
    def _cat_of(e: dict) -> str:
        return (e.get("category") or e.get("class_title") or "").strip()

    positives_only = [e for e in entries if _is_positive_category(_cat_of(e))]
    if positives_only:
        participants = max((e.get("participants_count") or 0) for e in positives_only)
        if participants > 0:
            total = 0.0
            all_int = True
            for e in positives_only:
                try:
                    v = float(str(e.get("value", "")).strip())
                except (ValueError, TypeError):
                    all_int = False
                    break
                if not v.is_integer():
                    all_int = False
                    break
                total += v
            if all_int and 0 <= total <= participants:
                return round(total / participants, 4)

    for entry in entries:
        value_str = str(entry.get("value", "")).strip()
        if not value_str or value_str.upper() in ("NA", "NE", "NR", "N/A", ""):
            continue
        try:
            value = float(value_str)
        except ValueError:
            continue

        participants = entry.get("participants_count", 0) or 0
        param_type = (entry.get("param_type") or "").upper()
        unit = (entry.get("unit") or "").lower()
        unit_class = _classify_unit(unit)

        # Unit takes precedence over param_type — see extract_response_rate
        # for the rationale.  When the unit explicitly says percentage, the
        # value is already a response rate.
        if unit_class == "percentage":
            if 0 <= value <= 1:
                return round(value, 4)  # already fractional
            if 1 < value <= 100:
                return round(value / 100.0, 4)
            continue

        if unit_class == "proportion" and 0 <= value <= 1:
            return round(value, 4)

        if unit_class == "count" and participants > 0 and value <= participants:
            rate = value / participants
            if 0 <= rate <= 1:
                return round(rate, 4)

        if param_type == "COUNT_OF_PARTICIPANTS" and unit_class == "unknown" and participants > 0:
            rate = value / participants
            if 0 <= rate <= 1:
                return round(rate, 4)

        if 0 <= value <= 1:
            return round(value, 4)

        if 1 < value <= 100:
            return round(value / 100.0, 4)

    return None


_CRITERIA_LABELS = {
    # MGMT
    "mgmt_methylated": "MGMT Methylated",
    "mgmt_unmethylated": "MGMT Unmethylated",
    # IDH
    "idh_mutant": "IDH Mutant",
    "idh_wildtype": "IDH Wild-type",
    "idh1_r132h": "IDH1 R132H",
    # EGFR
    "egfr_altered": "EGFR Altered",
    "egfr_amplified": "EGFR Amplified",
    "egfrviii": "EGFRvIII",
    "egfr_overexpressed": "EGFR Overexpressed",
    "egfr_mutant": "EGFR Mutant",
    # TP53
    "tp53_mutant": "TP53 Mutant",
    "tp53_wildtype": "TP53 Wild-type",
    # PTEN
    "pten_loss": "PTEN Loss",
    "pten_mutant": "PTEN Mutant",
    "pten_intact": "PTEN Intact",
    # BRAF
    "braf_v600e": "BRAF V600E",
    "braf_mutant": "BRAF Mutant",
    # Other mutations
    "atrx_loss": "ATRX Loss",
    "tert_mutant": "TERT Promoter Mutant",
    "nf1_mutant": "NF1 Mutant",
    "pik3ca_mutant": "PIK3CA Mutant",
    "rb1_mutant": "RB1 Mutant",
    # Copy number
    "cdkn2a_deleted": "CDKN2A Deleted",
    "cdk4_amplified": "CDK4 Amplified",
    "mdm2_amplified": "MDM2 Amplified",
    "pdgfra_amplified": "PDGFRA Amplified",
    "met_amplified": "MET Amplified",
    "myc_amplified": "MYC Amplified",
    "mycn_amplified": "MYCN Amplified",
    # Codeletions
    "1p19q_codeletion": "1p/19q Codeletion",
    "1p19q_intact": "1p/19q Intact",
    # Fusions
    "ntrk_fusion": "NTRK Fusion",
    "alk_fusion": "ALK Fusion",
    "ros1_fusion": "ROS1 Fusion",
    "fgfr_altered": "FGFR Altered",
    # Biomarkers
    "tmb_high": "TMB-High",
    "msi_high": "MSI-High",
    "pdl1_positive": "PD-L1 Positive",
    "h3k27m": "H3 K27M",
    # Clinical
    "recurrent": "Recurrent",
    "newly_diagnosed": "Newly Diagnosed",
    "prior_tmz": "Prior TMZ",
    "prior_bevacizumab": "Prior Bevacizumab",
    "alkylator_resistant": "Alkylator-Resistant",
}


def _format_molecular_criteria(criteria: dict) -> list[str]:
    """Convert parsed molecular criteria dict to human-readable labels."""
    if not criteria:
        return []
    return [_CRITERIA_LABELS.get(k, k) for k, v in criteria.items() if v]


def _identify_group_drugs(
    group_title: str,
    group_description: str,
    arm_records: list,
    trial_drug_names: list[str],
) -> list[str]:
    """Identify which drugs are used in a specific arm/group.

    Matches group title to arm records and parses drug names from
    arm descriptions or group titles. Returns arm-specific drug list,
    or empty list if no specific drugs can be identified (meaning the
    caller should use the trial-level drug list).

    Args:
        group_title: The group/arm title from results_json.
        group_description: The group description from results_json.
        arm_records: List of ArmRecord objects for this trial.
        trial_drug_names: All drug names from the trial's interventions.
    """
    import re

    title_lower = group_title.lower().strip()
    desc_lower = group_description.lower().strip()

    # Step 1: Try to match group_title to an ArmRecord label
    best_arm = None
    best_score = 0
    for arm in arm_records:
        arm_label = (arm.label or "").lower().strip()
        if not arm_label:
            continue

        # Exact match
        if arm_label == title_lower:
            best_arm = arm
            best_score = 100
            break

        # Title contains arm label or vice versa
        if arm_label in title_lower or title_lower in arm_label:
            score = len(arm_label)
            if score > best_score:
                best_arm = arm
                best_score = score

        # Fuzzy: check if key words match
        arm_words = set(re.findall(r'\w+', arm_label))
        title_words = set(re.findall(r'\w+', title_lower))
        overlap = arm_words & title_words - {"arm", "group", "phase", "part", "cohort"}
        if len(overlap) >= 2 and len(overlap) > best_score:
            best_arm = arm
            best_score = len(overlap)

    # Step 2: Parse drug names from matched arm description, or from group title/description
    search_texts = []
    if best_arm and best_arm.description:
        search_texts.append(best_arm.description.lower())
    search_texts.append(title_lower)
    if desc_lower:
        search_texts.append(desc_lower)
    search_text = " ".join(search_texts)

    # Check which of the trial's known drugs appear in the search text
    found_drugs = []
    for drug_name in trial_drug_names:
        # Check for the full drug name or its base name (first word)
        drug_lower = drug_name.lower()
        base_name = drug_lower.split()[0] if " " in drug_lower else drug_lower
        stripped = _strip_salt(drug_lower)

        if (drug_lower in search_text
            or stripped in search_text
            or base_name in search_text):
            found_drugs.append(drug_name)

    return found_drugs


def filter_patients_by_molecular_criteria(
    patient_ids: list[str],
    criteria: dict,
    expr_data: dict,
    expr_patients: list[str],
    biomarker_data: Optional[dict] = None,
) -> list[str]:
    """Filter TCGA patients based on molecular criteria.

    Uses a tiered approach:
      1. Real mutation/CNV data from GDC biomarker cache (preferred)
      2. Gene expression data as proxy (fallback)

    Args:
        patient_ids: List of TCGA patient barcodes to filter.
        criteria: Dict of molecular criteria parsed from trial eligibility.
        expr_data: Gene expression data keyed by gene symbol.
        expr_patients: Ordered list of patient IDs in expression data.
        biomarker_data: Optional dict of per-patient biomarker profiles from GDC.
    """
    if not criteria:
        return patient_ids

    patient_idx = {p: i for i, p in enumerate(expr_patients)}
    patients_dict = (biomarker_data or {}).get("patients", {})

    # Pre-compute expression percentiles for proxy-based filtering
    _expr_cache: dict[str, dict] = {}

    def _get_expr_stats(gene: str) -> dict:
        if gene not in _expr_cache and gene in expr_data:
            vals = expr_data[gene]
            _expr_cache[gene] = {
                "median": float(np.median(vals)),
                "p25": float(np.percentile(vals, 25)),
                "p75": float(np.percentile(vals, 75)),
                "p90": float(np.percentile(vals, 90)),
                "p10": float(np.percentile(vals, 10)),
            }
        return _expr_cache.get(gene, {})

    def _patient_has_mutation(profile: dict, gene: str) -> bool:
        """Check if patient has a non-synonymous mutation in the gene."""
        muts = profile.get("mutations", {}).get(gene, [])
        for m in muts:
            ctype = m.get("consequence_type", "")
            impact = m.get("vep_impact", "")
            # Exclude synonymous and low-impact variants
            if ctype == "synonymous_variant":
                continue
            if impact in ("HIGH", "MODERATE") or ctype in (
                "missense_variant", "nonsense_variant", "frameshift_variant",
                "stop_gained", "start_lost", "splice_donor_variant",
                "splice_acceptor_variant", "inframe_deletion", "inframe_insertion",
            ):
                return True
            # If no consequence type info, assume mutation is relevant
            if not ctype and not impact:
                return True
        return False

    def _patient_has_specific_mutation(profile: dict, gene: str, aa_pattern: str) -> bool:
        """Check for a specific amino acid change (e.g., 'R132H')."""
        import re
        muts = profile.get("mutations", {}).get(gene, [])
        for m in muts:
            aa = m.get("aa_change", "")
            if aa and re.search(aa_pattern, aa, re.IGNORECASE):
                return True
        return False

    def _patient_has_cnv(profile: dict, gene: str, change_type: str) -> bool:
        """Check if patient has a CNV change (Gain/Loss) for a gene."""
        cnv = profile.get("cnv", {})
        return cnv.get(gene, "").lower() == change_type.lower()

    filtered = []

    for pid in patient_ids:
        if pid not in patient_idx:
            continue
        idx = patient_idx[pid]
        profile = patients_dict.get(pid, {})
        has_genomic = bool(profile.get("mutations") or profile.get("cnv"))
        clinical = profile.get("clinical", {})
        eligible = True

        # ── MGMT methylation (expression proxy: lower = methylated) ──
        if "mgmt_methylated" in criteria and "MGMT" in expr_data:
            stats = _get_expr_stats("MGMT")
            if expr_data["MGMT"][idx] > stats.get("median", 0):
                eligible = False
        if "mgmt_unmethylated" in criteria and "MGMT" in expr_data:
            stats = _get_expr_stats("MGMT")
            if expr_data["MGMT"][idx] <= stats.get("median", 0):
                eligible = False

        # ── IDH mutations ──
        if "idh_mutant" in criteria:
            if has_genomic:
                has_idh = (_patient_has_mutation(profile, "IDH1")
                           or _patient_has_mutation(profile, "IDH2"))
                if not has_idh:
                    eligible = False
            elif "IDH1" in expr_data:
                stats = _get_expr_stats("IDH1")
                if expr_data["IDH1"][idx] <= stats.get("median", 0):
                    eligible = False

        if "idh_wildtype" in criteria:
            if has_genomic:
                has_idh = (_patient_has_mutation(profile, "IDH1")
                           or _patient_has_mutation(profile, "IDH2"))
                if has_idh:
                    eligible = False
            elif "IDH1" in expr_data:
                stats = _get_expr_stats("IDH1")
                if expr_data["IDH1"][idx] > stats.get("median", 0):
                    eligible = False

        if "idh1_r132h" in criteria:
            if has_genomic:
                if not _patient_has_specific_mutation(profile, "IDH1", r"R132H"):
                    eligible = False
            elif "IDH1" in expr_data:
                stats = _get_expr_stats("IDH1")
                if expr_data["IDH1"][idx] <= stats.get("p75", 0):
                    eligible = False

        # ── EGFR ──
        if "egfr_amplified" in criteria:
            if has_genomic:
                if not _patient_has_cnv(profile, "EGFR", "Gain"):
                    eligible = False
            elif "EGFR" in expr_data:
                stats = _get_expr_stats("EGFR")
                if expr_data["EGFR"][idx] < stats.get("p75", 0):
                    eligible = False

        if "egfrviii_negative" in criteria:
            # Keep only patients explicitly called EGFRvIII-negative in
            # Brennan 2013 S5. Patients with no direct call are excluded to
            # avoid mislabelling.
            egfrviii_neg = False
            if profile:
                clin = profile.get("clinical") or {}
                v = (clin.get("egfrviii_status") or "").strip().lower()
                if v in ("no", "false"):
                    egfrviii_neg = True
            if not egfrviii_neg:
                eligible = False

        if "egfrviii" in criteria:
            # Prefer the direct EGFRvIII call imported from Brennan 2013 Cell
            # Supplemental Table S5 (clinical.egfrviii_status). Fall back to
            # an EGFR mutation/CNV/expression proxy when the direct call is
            # not available for this patient.
            egfrviii_flag = None
            if profile:
                clin = profile.get("clinical") or {}
                v = (clin.get("egfrviii_status") or "").strip().lower()
                if v in ("yes", "true"):
                    egfrviii_flag = True
                elif v in ("no", "false"):
                    egfrviii_flag = False
            if egfrviii_flag is True:
                pass  # eligible
            elif egfrviii_flag is False:
                eligible = False
            elif has_genomic:
                has_egfr_mut = _patient_has_mutation(profile, "EGFR")
                has_egfr_gain = _patient_has_cnv(profile, "EGFR", "Gain")
                if not (has_egfr_mut or has_egfr_gain):
                    eligible = False
            elif "EGFR" in expr_data:
                stats = _get_expr_stats("EGFR")
                if expr_data["EGFR"][idx] < stats.get("p90", 0):
                    eligible = False

        if "egfr_overexpressed" in criteria and "EGFR" in expr_data:
            stats = _get_expr_stats("EGFR")
            if expr_data["EGFR"][idx] < stats.get("p75", 0):
                eligible = False

        if "egfr_mutant" in criteria:
            if has_genomic:
                if not _patient_has_mutation(profile, "EGFR"):
                    eligible = False
            elif "EGFR" in expr_data:
                stats = _get_expr_stats("EGFR")
                if expr_data["EGFR"][idx] < stats.get("p75", 0):
                    eligible = False

        if "egfr_altered" in criteria:
            if has_genomic:
                has_any = (_patient_has_mutation(profile, "EGFR")
                           or _patient_has_cnv(profile, "EGFR", "Gain"))
                if not has_any:
                    eligible = False
            elif "EGFR" in expr_data:
                stats = _get_expr_stats("EGFR")
                if expr_data["EGFR"][idx] < stats.get("p75", 0):
                    eligible = False

        # ── TP53 ──
        if "tp53_mutant" in criteria:
            if has_genomic:
                if not _patient_has_mutation(profile, "TP53"):
                    eligible = False
            elif "TP53" in expr_data:
                stats = _get_expr_stats("TP53")
                if expr_data["TP53"][idx] > stats.get("p25", 0):
                    eligible = False

        if "tp53_wildtype" in criteria:
            if has_genomic:
                if _patient_has_mutation(profile, "TP53"):
                    eligible = False
            elif "TP53" in expr_data:
                stats = _get_expr_stats("TP53")
                if expr_data["TP53"][idx] <= stats.get("p25", 0):
                    eligible = False

        # ── PTEN ──
        if "pten_loss" in criteria or "pten_mutant" in criteria:
            if has_genomic:
                has_pten_issue = (_patient_has_mutation(profile, "PTEN")
                                  or _patient_has_cnv(profile, "PTEN", "Loss"))
                if not has_pten_issue:
                    eligible = False
            elif "PTEN" in expr_data:
                stats = _get_expr_stats("PTEN")
                if expr_data["PTEN"][idx] > stats.get("p25", 0):
                    eligible = False

        if "pten_intact" in criteria:
            if has_genomic:
                has_pten_issue = (_patient_has_mutation(profile, "PTEN")
                                  or _patient_has_cnv(profile, "PTEN", "Loss"))
                if has_pten_issue:
                    eligible = False

        # ── BRAF ──
        if "braf_v600e" in criteria:
            if has_genomic:
                if not _patient_has_specific_mutation(profile, "BRAF", r"V600E"):
                    eligible = False
            elif "BRAF" in expr_data:
                stats = _get_expr_stats("BRAF")
                if expr_data["BRAF"][idx] < stats.get("p90", 0):
                    eligible = False

        if "braf_mutant" in criteria:
            if has_genomic:
                if not _patient_has_mutation(profile, "BRAF"):
                    eligible = False
            elif "BRAF" in expr_data:
                stats = _get_expr_stats("BRAF")
                if expr_data["BRAF"][idx] < stats.get("p75", 0):
                    eligible = False

        # ── ATRX ──
        if "atrx_loss" in criteria:
            if has_genomic:
                has_atrx = (_patient_has_mutation(profile, "ATRX")
                            or _patient_has_cnv(profile, "ATRX", "Loss"))
                if not has_atrx:
                    eligible = False
            elif "ATRX" in expr_data:
                stats = _get_expr_stats("ATRX")
                if expr_data["ATRX"][idx] > stats.get("p25", 0):
                    eligible = False

        # ── CDKN2A deletion ──
        if "cdkn2a_deleted" in criteria:
            if has_genomic:
                if not _patient_has_cnv(profile, "CDKN2A", "Loss"):
                    eligible = False
            elif "CDKN2A" in expr_data:
                stats = _get_expr_stats("CDKN2A")
                if expr_data["CDKN2A"][idx] > stats.get("p25", 0):
                    eligible = False

        # ── Gene amplifications (CDK4, MDM2, PDGFRA, MET, MYC, MYCN) ──
        for gene_key in ["cdk4", "mdm2", "pdgfra", "met", "myc", "mycn"]:
            crit_key = f"{gene_key}_amplified"
            if crit_key in criteria:
                gene_sym = gene_key.upper()
                if has_genomic:
                    if not _patient_has_cnv(profile, gene_sym, "Gain"):
                        eligible = False
                elif gene_sym in expr_data:
                    stats = _get_expr_stats(gene_sym)
                    if expr_data[gene_sym][idx] < stats.get("p75", 0):
                        eligible = False

        # ── Other gene mutations (NF1, PIK3CA, RB1) ──
        for gene_key in ["nf1", "pik3ca", "rb1"]:
            crit_key = f"{gene_key}_mutant"
            if crit_key in criteria:
                gene_sym = gene_key.upper()
                if has_genomic:
                    has_mut = (_patient_has_mutation(profile, gene_sym)
                               or _patient_has_cnv(profile, gene_sym, "Loss"))
                    if not has_mut:
                        eligible = False
                elif gene_sym in expr_data:
                    stats = _get_expr_stats(gene_sym)
                    if expr_data[gene_sym][idx] > stats.get("p25", 0):
                        eligible = False

        # ── 1p/19q codeletion ──
        # No direct data; use ATRX expression as rough proxy
        # (1p/19q codel is mutually exclusive with ATRX loss in gliomas)
        if "1p19q_codeletion" in criteria and "ATRX" in expr_data:
            stats = _get_expr_stats("ATRX")
            # 1p/19q tumors tend to retain ATRX; use higher ATRX as proxy
            if expr_data["ATRX"][idx] < stats.get("median", 0):
                eligible = False

        if "1p19q_intact" in criteria and "ATRX" in expr_data:
            stats = _get_expr_stats("ATRX")
            if expr_data["ATRX"][idx] >= stats.get("median", 0):
                eligible = False

        # ── TERT promoter mutation ──
        if "tert_mutant" in criteria:
            if has_genomic:
                if not _patient_has_mutation(profile, "TERT"):
                    eligible = False
            elif "TERT" in expr_data:
                stats = _get_expr_stats("TERT")
                if expr_data["TERT"][idx] <= stats.get("median", 0):
                    eligible = False

        # ── Fusions (NTRK, ALK, ROS1, FGFR) ──
        # Use expression-based proxy: very high expression suggests fusion-driven activation
        for fuse_key, gene_syms in [
            ("ntrk_fusion", ["NTRK1", "NTRK2", "NTRK3"]),
            ("alk_fusion", ["ALK"]),
            ("ros1_fusion", ["ROS1"]),
            ("fgfr_altered", ["FGFR1", "FGFR2", "FGFR3"]),
        ]:
            if fuse_key in criteria:
                # Check if any of the fusion genes is highly expressed
                any_high = False
                for gs in gene_syms:
                    if gs in expr_data:
                        stats = _get_expr_stats(gs)
                        if expr_data[gs][idx] >= stats.get("p90", float("inf")):
                            any_high = True
                            break
                if not any_high:
                    eligible = False

        # ── TMB-high (no direct data; skip filtering if unknown) ──
        # ── MSI-high (no direct data; skip filtering if unknown) ──

        # ── PD-L1 expression ──
        # CD274 is the gene encoding PD-L1
        if "pdl1_positive" in criteria:
            pdl1_gene = "CD274" if "CD274" in expr_data else None
            if pdl1_gene:
                stats = _get_expr_stats(pdl1_gene)
                if expr_data[pdl1_gene][idx] < stats.get("median", 0):
                    eligible = False

        # ── H3K27M (histone mutation) ──
        if "h3k27m" in criteria:
            if has_genomic:
                if not _patient_has_specific_mutation(profile, "H3F3A", r"K27M"):
                    eligible = False
            # Very rare in adult GBM; no good expression proxy

        # ── Clinical: Recurrence / Prior Treatment ──
        if "recurrent" in criteria:
            recurrence_val = clinical.get("progression_or_recurrence", "").lower()
            prior_tx = clinical.get("prior_treatment", "").lower()
            if recurrence_val not in ("yes", "progression", "recurrence"):
                if prior_tx != "yes":
                    eligible = False

        if "newly_diagnosed" in criteria:
            recurrence_val = clinical.get("progression_or_recurrence", "").lower()
            prior_tx = clinical.get("prior_treatment", "").lower()
            if recurrence_val in ("yes", "progression", "recurrence") or prior_tx == "yes":
                eligible = False

        # ── prior_tmz / prior_bevacizumab / alkylator_resistant ──
        # These are treatment-history criteria; TCGA clinical data has limited info
        # We allow all patients through for these (no filtering possible)

        if eligible:
            filtered.append(pid)

    return filtered


# ── Core Simulation ───────────────────────────────────────────────────────


def find_dcna_threshold(
    dcna_values: np.ndarray,
    expr_values: np.ndarray,
    target_response_rate: float,
) -> float:
    """Find DCNA threshold where % of patients in upper-right quadrant ≈ target rate.

    Upper-right quadrant: DCNA > threshold AND expression > 0.
    Uses binary search on sorted DCNA values.
    """
    n = len(dcna_values)
    if n == 0:
        return 0.0

    # Patients with expression > 0
    expr_positive = expr_values > 0

    # Sort unique DCNA values as candidate thresholds
    sorted_dcna = np.sort(dcna_values)

    best_threshold = float(sorted_dcna[0])
    best_diff = float("inf")

    # Binary search approach over DCNA values
    lo, hi = float(sorted_dcna.min()), float(sorted_dcna.max())
    for _ in range(200):
        mid = (lo + hi) / 2
        in_upper_right = np.sum((dcna_values > mid) & expr_positive)
        predicted_rate = in_upper_right / n

        diff = abs(predicted_rate - target_response_rate)
        if diff < best_diff:
            best_diff = diff
            best_threshold = mid

        if predicted_rate > target_response_rate:
            lo = mid  # Need higher threshold to reduce rate
        else:
            hi = mid  # Need lower threshold to increase rate

        if best_diff < 0.001:
            break

    return best_threshold


def compute_patient_values(
    patient_id: str,
    drug_names: list[str],
    dcna_patients: list[str],
    dcna_data: dict,
    expr_patients: list[str],
    expr_data: dict,
    drug_targets: dict,
) -> tuple[float, float]:
    """Compute average DCNA and average gene expression for a patient.

    DCNA: averaged across all trial drugs found in DCNA data.
    Expression: averaged across all gene targets of all trial drugs.
    """
    dcna_idx = dcna_patients.index(patient_id) if patient_id in dcna_patients else None
    expr_idx_map = {p: i for i, p in enumerate(expr_patients)}
    expr_idx = expr_idx_map.get(patient_id)

    # Average DCNA across drugs
    dcna_vals = []
    if dcna_idx is not None:
        for drug in drug_names:
            if drug in dcna_data:
                dcna_vals.append(dcna_data[drug][dcna_idx])
    avg_dcna = float(np.mean(dcna_vals)) if dcna_vals else 0.0

    # Collect all gene targets across all drugs
    all_genes = set()
    expr_keys_upper = {k.upper(): k for k in expr_data}
    for drug in drug_names:
        entry = drug_targets.get(drug, {})
        for t in entry.get("targets", []):
            gene = t.get("gene_symbol", "")
            if gene.upper() in expr_keys_upper:
                all_genes.add(expr_keys_upper[gene.upper()])

    # Average expression across all gene targets
    expr_vals = []
    if expr_idx is not None and all_genes:
        for gene in all_genes:
            expr_vals.append(expr_data[gene][expr_idx])
    avg_expr = float(np.mean(expr_vals)) if expr_vals else 0.0

    return avg_dcna, avg_expr


# ── Main Simulation Engine ────────────────────────────────────────────────


class TrialInfo:
    """Holds parsed trial information for simulation."""

    def __init__(self, nct_id, title, enrollment, response_rate, drug_names,
                 dcna_drug_names, criteria_text="", min_age="", max_age="", sex="ALL",
                 arm_group="", arm_criteria=None,
                 arm_drug_names=None, arm_dcna_drug_names=None):
        self.nct_id = nct_id
        self.title = title
        self.enrollment = enrollment or 50
        self.response_rate = response_rate
        self.drug_names = drug_names          # Original trial drug names
        self.dcna_drug_names = dcna_drug_names  # Matched DCNA drug names
        self.criteria_text = criteria_text
        self.min_age = min_age
        self.max_age = max_age
        self.sex = sex
        self.arm_group = arm_group            # Group/arm label (if split)
        self.arm_criteria = arm_criteria or {}  # Molecular criteria from group title
        # Arm-specific drugs (override trial-level when set for DCNA averaging)
        self.arm_drug_names = arm_drug_names or []
        self.arm_dcna_drug_names = arm_dcna_drug_names or []

    @property
    def effective_dcna_drugs(self) -> list[str]:
        """Return arm-specific DCNA drugs if available, else trial-level."""
        return self.arm_dcna_drug_names if self.arm_dcna_drug_names else self.dcna_drug_names

    @property
    def effective_drug_names(self) -> list[str]:
        """Return arm-specific drug names if available, else trial-level."""
        return self.arm_drug_names if self.arm_drug_names else self.drug_names


class MOASimulationEngine:
    """Orchestrates the full MOA-based simulation pipeline."""

    def __init__(self, n_iterations: int = 1000, save_plots: bool = True):
        self.n_iterations = n_iterations
        self.save_plots = save_plots

        # Load data
        logger.info("Loading TCGA data...")
        self.dcna_patients, self.dcna_drugs_list, self.dcna_data = _load_dcna_data()
        self.dcna_drugs_set = set(self.dcna_drugs_list)
        self.expr_patients, self.expr_data = _load_expression_data()
        self.drug_targets = _load_drug_targets()

        # Common patients between DCNA and expression
        self.common_patients = [
            p for p in self.dcna_patients if p in set(self.expr_patients)
        ]
        logger.info("Loaded %d common patients", len(self.common_patients))

        # Load comprehensive biomarker data (GDC mutations, CNV, clinical)
        self.biomarker_data = self._load_biomarker_data()

    def _load_biomarker_data(self) -> dict:
        """Load or fetch comprehensive per-patient biomarker data from GDC.

        Fetches somatic mutations, CNV, and clinical data for all common
        patients and caches the result for subsequent runs.
        """
        try:
            from connectors.tcga_biomarkers import TCGABiomarkerFetcher

            fetcher = TCGABiomarkerFetcher()
            data = fetcher.fetch_and_cache(self.common_patients)
            n_patients = len(data.get("patients", {}))
            n_mut = data.get("_meta", {}).get("patients_with_mutations", 0)
            n_cnv = data.get("_meta", {}).get("patients_with_cnv", 0)
            logger.info(
                "Biomarker data: %d patients, %d with mutations, %d with CNV",
                n_patients, n_mut, n_cnv,
            )
            return data
        except Exception as e:
            logger.warning(
                "Failed to load biomarker data: %s — falling back to expression-only proxies", e,
            )
            return {}

    def find_drugs_for_moa(self, moa_category: str, db) -> list[dict]:
        """Find all drugs with the given MOA category from the database.

        Supports two selection modes:
          - ``"group:<broad_name>"`` — matches all short-forms that share the
            given ``moa_broad_category`` (e.g. ``"group:PARP inhibitor"``
            fetches PARP1, PARP2, PARP 1,2,3 inhibitors).
          - Plain string — exact match on ``moa_short_form``.
        """
        from database.models import InterventionRecord, MOAAnnotationRecord
        from sqlalchemy import func

        q = (
            db.query(
                InterventionRecord.name,
                MOAAnnotationRecord.target_gene_symbol,
                MOAAnnotationRecord.action_type,
            )
            .join(MOAAnnotationRecord)
        )

        if moa_category.startswith("group:"):
            broad_name = moa_category[len("group:"):]
            # Include aliased broad categories that normalize to this family
            _BROAD_ALIASES_REV: dict[str, list[str]] = {}
            _BROAD_ALIASES = {
                "PARP 1, 2 and 3 inhibitor": "PARP inhibitor",
                "DNA Damage cross-linking agent": "DNA Damage inhibitor",
                "DNA Damage disrupting agent": "DNA Damage inhibitor",
                "Immune Checkpoint antagonist": "Immune Checkpoint inhibitor",
                "Immune Checkpoint other": "Immune Checkpoint inhibitor",
                "PDGFR antagonist": "PDGFR inhibitor",
            }
            all_broads = [broad_name]
            for alias, target in _BROAD_ALIASES.items():
                if target == broad_name:
                    all_broads.append(alias)
            q = q.filter(MOAAnnotationRecord.moa_broad_category.in_(all_broads))
        else:
            q = q.filter(MOAAnnotationRecord.moa_short_form == moa_category)

        rows = q.all()

        drugs = {}
        for name, gene, action in rows:
            upper = name.upper()
            if upper not in drugs:
                drugs[upper] = {"name": name, "genes": [], "dcna_match": None}
            if gene:
                drugs[upper]["genes"].append(gene)

            # Try to match to DCNA dataset
            if drugs[upper]["dcna_match"] is None:
                match = _match_drug_to_dcna(name, self.dcna_drugs_set)
                if match:
                    drugs[upper]["dcna_match"] = match

        return list(drugs.values())

    def find_trials_with_response_rates(self, drug_names: list[str], db) -> list[TrialInfo]:
        """Find trials using these drugs that have response rate outcomes.

        Splits multi-group outcomes into separate TrialInfo entries so that
        different arms (different drugs, doses, or molecular criteria) are
        each simulated independently with their own DCNA drug lists.
        """
        from database.models import (
            ArmRecord, InterventionRecord, OutcomeRecord, TrialRecord,
            EligibilityRecord, trial_interventions, MOAAnnotationRecord,
        )
        from sqlalchemy import func

        # Get trial IDs that use any of these drugs
        drug_names_upper = [d.upper() for d in drug_names]
        trial_ids_q = (
            db.query(TrialRecord.nct_id)
            .join(trial_interventions)
            .join(InterventionRecord)
            .filter(func.upper(InterventionRecord.name).in_(drug_names_upper))
            .distinct()
        )
        trial_ids = [r[0] for r in trial_ids_q.all()]

        if not trial_ids:
            return []

        # Filter to trials with GBM/glioma-relevant conditions
        filtered_ids = []
        skipped_conditions = 0
        for nct_id in trial_ids:
            if _trial_has_glioma_condition(nct_id, db):
                filtered_ids.append(nct_id)
            else:
                skipped_conditions += 1
                logger.debug(
                    "Trial %s skipped: no GBM/glioma-relevant condition", nct_id,
                )
        if skipped_conditions:
            logger.info(
                "Condition filter: kept %d / %d trials (%d excluded as non-glioma)",
                len(filtered_ids), len(trial_ids), skipped_conditions,
            )
        trial_ids = filtered_ids

        trials = []
        for nct_id in trial_ids:
            # Get outcomes with response rate data
            outcomes = (
                db.query(OutcomeRecord)
                .filter(
                    OutcomeRecord.trial_nct_id == nct_id,
                    OutcomeRecord.results_json.isnot(None),
                )
                .all()
            )

            # Find best response-rate outcome, preferring multi-group data
            per_group_results = []
            best_rr = None
            best_priority = 999

            for outcome in outcomes:
                measure = (outcome.measure or "").lower()
                priority = _response_rate_priority(measure)
                if priority is None:
                    continue

                # Try to extract per-group response rates (ALL groups, not just molecular)
                group_rrs = _extract_all_group_response_rates(outcome.results_json, outcome.measure)
                if group_rrs and len(group_rrs) >= 2:
                    if not per_group_results or priority < best_priority:
                        per_group_results = group_rrs
                        if priority < best_priority:
                            best_priority = priority

                # Also track overall best RR as fallback
                if priority <= best_priority or best_rr is None:
                    rr = extract_response_rate(outcome.results_json, outcome.measure)
                    if rr is not None and 0 <= rr < 1:
                        if best_rr is None or priority < best_priority:
                            best_rr = rr
                            best_priority = priority

            if best_rr is None and not per_group_results:
                continue

            # Get trial info
            trial = db.query(TrialRecord).filter(TrialRecord.nct_id == nct_id).first()
            if not trial:
                continue

            # Get interventions for this trial, splitting combination entries
            interventions = (
                db.query(InterventionRecord.name)
                .join(trial_interventions)
                .filter(trial_interventions.c.trial_nct_id == nct_id)
                .all()
            )
            trial_drug_names = []
            for (iv_name,) in interventions:
                trial_drug_names.extend(_split_combination_drugs(iv_name))

            # Match to DCNA drugs
            dcna_matches = []
            for drug in trial_drug_names:
                match = _match_drug_to_dcna(drug, self.dcna_drugs_set)
                if match:
                    dcna_matches.append(match)

            if not dcna_matches:
                continue

            # Get eligibility
            elig = db.query(EligibilityRecord).filter(
                EligibilityRecord.trial_nct_id == nct_id
            ).first()

            # Get arm records for group-to-drug matching
            arm_records = (
                db.query(ArmRecord)
                .filter(ArmRecord.trial_nct_id == nct_id)
                .all()
            )

            base_kwargs = dict(
                title=trial.title or "",
                drug_names=trial_drug_names,
                dcna_drug_names=list(set(dcna_matches)),
                criteria_text=elig.criteria_text if elig else "",
                min_age=elig.min_age if elig else "",
                max_age=elig.max_age if elig else "",
                sex=elig.sex if elig else "ALL",
            )

            # Per-stratum criteria mined from the eligibility prose
            stratum_criteria_map = _parse_stratum_criteria_from_text(
                elig.criteria_text if elig else ""
            )

            if per_group_results:
                # Split into separate entries per arm/group
                for grp in per_group_results:
                    arm_label = grp["group_title"]
                    arm_criteria = dict(grp.get("criteria", {}))
                    group_desc = grp.get("group_description", "")

                    # ── Stratum-specific criteria override ──
                    # When the group title matches a stratum/arm label found in
                    # the eligibility prose (e.g. "Stratum 1 (IDH wild-type)"),
                    # apply those criteria so each stratum gets its own IDH /
                    # MGMT / BRAF state instead of inheriting the trial-level one.
                    label_key = " ".join((arm_label or "").lower().split())
                    if label_key in stratum_criteria_map:
                        arm_criteria.update(stratum_criteria_map[label_key])

                    # ── Group-level disease condition check ──
                    # Skip groups that explicitly target non-glioma diseases
                    # (e.g. a melanoma or NSCLC arm in a multi-cancer basket trial)
                    if not _is_group_glioma_relevant(arm_label, group_desc):
                        logger.info(
                            "Trial %s group '%s' skipped: non-glioma disease condition",
                            nct_id, arm_label,
                        )
                        continue

                    # Identify arm-specific drugs
                    arm_drugs = _identify_group_drugs(
                        arm_label, group_desc, arm_records, trial_drug_names,
                    )
                    # Match arm-specific drugs to DCNA
                    arm_dcna = []
                    if arm_drugs:
                        for drug in arm_drugs:
                            match = _match_drug_to_dcna(drug, self.dcna_drugs_set)
                            if match:
                                arm_dcna.append(match)
                        arm_dcna = list(set(arm_dcna))

                    # ── MOA relevance check ──
                    # If arm-specific drugs were identified, at least one must
                    # match the MOA drug list. This prevents arms that use only
                    # non-MOA drugs from being included (e.g. a Temsirolimus +
                    # Sorafenib arm should not appear in an EGFR inhibitor sim
                    # just because another arm of the same trial used Erlotinib).
                    if arm_drugs:
                        arm_drugs_upper = {d.upper() for d in arm_drugs}
                        if not arm_drugs_upper.intersection(drug_names_upper):
                            logger.info(
                                "Trial %s arm '%s' skipped: arm drugs %s do not "
                                "include any MOA-matching drugs",
                                nct_id, arm_label, arm_drugs,
                            )
                            continue

                    trials.append(TrialInfo(
                        nct_id=f"{nct_id}:{arm_label}",
                        enrollment=grp["participants"] or trial.enrollment_count,
                        response_rate=grp["response_rate"],
                        arm_group=arm_label,
                        arm_criteria=arm_criteria,
                        arm_drug_names=arm_drugs,
                        arm_dcna_drug_names=arm_dcna,
                        **base_kwargs,
                    ))
                    logger.info(
                        "Trial %s split arm '%s': RR=%.3f, n=%d, criteria=%s, "
                        "arm_drugs=%s, arm_dcna=%s",
                        nct_id, arm_label, grp["response_rate"],
                        grp["participants"], arm_criteria,
                        arm_drugs or "(trial-level)", arm_dcna or "(trial-level)",
                    )
            else:
                trials.append(TrialInfo(
                    nct_id=nct_id,
                    enrollment=trial.enrollment_count,
                    response_rate=best_rr,
                    **base_kwargs,
                ))

        return trials

    @staticmethod
    def _trial_display_criteria(t: "TrialInfo") -> list[str]:
        """Format a trial's molecular criteria for display, applying
        IDH/MGMT conflict resolution so a stratum's arm-level state
        overrides any opposite trial-level state."""
        try:
            mc = parse_molecular_criteria(t.criteria_text or "")
            if t.arm_criteria:
                _conflicts = {
                    "idh_wildtype": "idh_mutant",
                    "idh_mutant": "idh_wildtype",
                    "mgmt_methylated": "mgmt_unmethylated",
                    "mgmt_unmethylated": "mgmt_methylated",
                }
                for k in list(t.arm_criteria.keys()):
                    opp = _conflicts.get(k)
                    if opp and opp in mc:
                        mc.pop(opp, None)
                mc.update(t.arm_criteria)
            return _format_molecular_criteria(mc)
        except Exception:
            return []

    @staticmethod
    def detect_outlier_trials(
        trials: list[TrialInfo],
        min_enrollment: int = 5,
        z_threshold: float = 3.5,
    ) -> tuple[list[TrialInfo], list[dict]]:
        """Screen trials for artificially high (or suspicious) response rates.

        Uses a 3-layer approach:
          Layer 1 – Hard enrollment floor: exclude arms with enrollment < min_enrollment
          Layer 2 – Wilson Score CI overlap: flag if the lower bound of the
                    Wilson 95 % CI exceeds the 75th percentile of all RRs
          Layer 3 – MAD-based modified Z-score: flag if |z| > z_threshold

        Returns (kept_trials, excluded_list) where excluded_list contains dicts
        with metadata and the exclusion reason for display in the frontend.
        """

        kept: list[TrialInfo] = []
        excluded: list[dict] = []

        if not trials:
            return kept, excluded

        def _trial_criteria(t: TrialInfo) -> list[str]:
            try:
                mc = parse_molecular_criteria(t.criteria_text or "")
                if t.arm_criteria:
                    _conflicts = {
                        "idh_wildtype": "idh_mutant",
                        "idh_mutant": "idh_wildtype",
                        "mgmt_methylated": "mgmt_unmethylated",
                        "mgmt_unmethylated": "mgmt_methylated",
                    }
                    for k in list(t.arm_criteria.keys()):
                        opp = _conflicts.get(k)
                        if opp and opp in mc:
                            mc.pop(opp, None)
                    mc.update(t.arm_criteria)
                return _format_molecular_criteria(mc)
            except Exception:
                return []

        # ── Layer 1: Hard enrollment floor ──────────────────────────────
        post_enrollment = []
        for t in trials:
            if t.enrollment < min_enrollment:
                excluded.append({
                    "nct_id": t.nct_id,
                    "title": t.title,
                    "arm_group": t.arm_group,
                    "enrollment": t.enrollment,
                    "actual_response_rate": t.response_rate,
                    "drugs": t.effective_dcna_drugs,
                    "exclusion_reason": (
                        f"Enrollment too small (n={t.enrollment}, minimum={min_enrollment})"
                    ),
                    "exclusion_method": "enrollment_floor",
                    "molecular_criteria": _trial_criteria(t),
                })
                logger.info(
                    "Outlier excluded (enrollment floor): %s enrollment=%d",
                    t.nct_id, t.enrollment,
                )
            else:
                post_enrollment.append(t)

        # ── Layer 1b: Auto-exclude 100 % response rate ──────────────────
        post_perfect = []
        for t in post_enrollment:
            if t.response_rate >= 1.0:
                excluded.append({
                    "nct_id": t.nct_id,
                    "title": t.title,
                    "arm_group": t.arm_group,
                    "enrollment": t.enrollment,
                    "actual_response_rate": t.response_rate,
                    "drugs": t.effective_dcna_drugs,
                    "exclusion_reason": "Response rate = 100 % (likely data artifact)",
                    "exclusion_method": "perfect_rr",
                    "molecular_criteria": _trial_criteria(t),
                })
                logger.info("Outlier excluded (100%% RR): %s", t.nct_id)
            else:
                post_perfect.append(t)

        # If too few trials remain for statistical tests, skip layers 2-3
        if len(post_perfect) < 6:
            logger.info(
                "Only %d trials remain after hard rules — skipping statistical outlier layers",
                len(post_perfect),
            )
            return post_perfect, excluded

        rr_values = np.array([t.response_rate for t in post_perfect])
        q75 = float(np.percentile(rr_values, 75))

        # ── Layer 2: Wilson Score CI overlap ────────────────────────────
        # For each trial, compute the lower bound of the Wilson 95% CI.
        # If it exceeds the 75th-percentile RR, the trial is suspiciously high.
        z_alpha = 1.96  # 95 % confidence
        layer2_flagged_ids: set[str] = set()

        for t in post_perfect:
            n = t.enrollment
            p_hat = t.response_rate
            # Wilson score interval lower bound
            denom = 1 + z_alpha ** 2 / n
            centre = p_hat + z_alpha ** 2 / (2 * n)
            spread = z_alpha * np.sqrt(
                (p_hat * (1 - p_hat) + z_alpha ** 2 / (4 * n)) / n
            )
            wilson_lower = (centre - spread) / denom

            if wilson_lower > q75:
                layer2_flagged_ids.add(t.nct_id)
                logger.info(
                    "Outlier flagged (Wilson CI): %s  RR=%.3f  Wilson-lower=%.3f > Q75=%.3f",
                    t.nct_id, p_hat, wilson_lower, q75,
                )

        # ── Layer 3: MAD-based modified Z-score ─────────────────────────
        median_rr = float(np.median(rr_values))
        abs_devs = np.abs(rr_values - median_rr)
        mad = float(np.median(abs_devs))

        layer3_flagged_ids: set[str] = set()

        if mad > 0:
            # Standard MAD-based modified Z-score
            for t in post_perfect:
                mod_z = 0.6745 * (t.response_rate - median_rr) / mad
                if abs(mod_z) > z_threshold:
                    layer3_flagged_ids.add(t.nct_id)
                    logger.info(
                        "Outlier flagged (MAD Z-score): %s  RR=%.3f  z=%.2f",
                        t.nct_id, t.response_rate, mod_z,
                    )
        else:
            # MAD = 0 (many identical RRs) — use mean absolute deviation fallback
            mean_ad = float(np.mean(abs_devs))
            if mean_ad > 0:
                for t in post_perfect:
                    mod_z = (t.response_rate - median_rr) / mean_ad
                    if abs(mod_z) > z_threshold:
                        layer3_flagged_ids.add(t.nct_id)
                        logger.info(
                            "Outlier flagged (MeanAD Z-score): %s  RR=%.3f  z=%.2f",
                            t.nct_id, t.response_rate, mod_z,
                        )

        # A trial is excluded only if flagged by BOTH layer 2 AND layer 3,
        # or by layer 3 alone with an extreme z-score (> 2 * threshold).
        for t in post_perfect:
            tid = t.nct_id
            flagged_l2 = tid in layer2_flagged_ids
            flagged_l3 = tid in layer3_flagged_ids

            reasons = []
            if flagged_l2:
                reasons.append("Wilson CI lower bound exceeds 75th-percentile RR")
            if flagged_l3:
                # Recompute z for the reason string
                if mad > 0:
                    z_val = 0.6745 * (t.response_rate - median_rr) / mad
                else:
                    mean_ad_val = float(np.mean(abs_devs))
                    z_val = (t.response_rate - median_rr) / mean_ad_val if mean_ad_val > 0 else 0
                reasons.append(f"Modified Z-score = {z_val:.2f} (threshold ±{z_threshold})")

            exclude = False
            if flagged_l2 and flagged_l3:
                exclude = True
            elif flagged_l3 and not flagged_l2:
                # Extreme outlier by Z-score alone (2× threshold)
                if mad > 0:
                    z_val = 0.6745 * (t.response_rate - median_rr) / mad
                else:
                    mean_ad_val = float(np.mean(abs_devs))
                    z_val = (t.response_rate - median_rr) / mean_ad_val if mean_ad_val > 0 else 0
                if abs(z_val) > 2 * z_threshold:
                    exclude = True

            if exclude:
                excluded.append({
                    "nct_id": t.nct_id,
                    "title": t.title,
                    "arm_group": t.arm_group,
                    "enrollment": t.enrollment,
                    "actual_response_rate": t.response_rate,
                    "drugs": t.effective_dcna_drugs,
                    "exclusion_reason": "; ".join(reasons),
                    "exclusion_method": "statistical",
                    "molecular_criteria": _trial_criteria(t),
                })
                logger.info("Outlier excluded (statistical): %s  RR=%.3f", t.nct_id, t.response_rate)
            else:
                kept.append(t)

        return kept, excluded

    def partition_trials(self, trials: list[TrialInfo]) -> tuple[list[TrialInfo], list[TrialInfo]]:
        """Split trials into training (~1/3 closest to median) and testing (~2/3)."""
        if len(trials) < 3:
            # Not enough for meaningful split
            return trials, []

        # Calculate median response rate
        rr_values = [t.response_rate for t in trials]
        median_rr = float(np.median(rr_values))

        # Sort by distance from median
        sorted_trials = sorted(trials, key=lambda t: abs(t.response_rate - median_rr))

        n_training = max(1, len(trials) // 3)
        training = sorted_trials[:n_training]
        testing = sorted_trials[n_training:]

        return training, testing

    def get_eligible_patients(self, trial: TrialInfo) -> list[str]:
        """Get TCGA patients eligible for this trial based on criteria."""
        patients = list(self.common_patients)

        # ── Age range filter ──
        # Drops TCGA patients whose age_at_diagnosis (years) falls outside the
        # trial's [min_age, max_age] window. Patients without age data are kept.
        min_yr = _parse_age_years(trial.min_age)
        max_yr = _parse_age_years(trial.max_age)
        if min_yr is not None or max_yr is not None:
            pts_dict = (self.biomarker_data or {}).get("patients", {})
            kept = []
            for pid in patients:
                rec = pts_dict.get(pid) or pts_dict.get(pid[:12])
                age_days = (rec or {}).get("clinical", {}).get("age_at_diagnosis_days")
                if age_days is None:
                    kept.append(pid)
                    continue
                age_yr = age_days / 365.25
                if min_yr is not None and age_yr < min_yr:
                    continue
                if max_yr is not None and age_yr > max_yr:
                    continue
                kept.append(pid)
            logger.info(
                "Trial %s: %d -> %d patients after age filter [%s, %s]",
                trial.nct_id, len(patients), len(kept), min_yr, max_yr,
            )
            patients = kept

        # Parse and apply trial-level molecular criteria
        mol_criteria = parse_molecular_criteria(trial.criteria_text)

        # Merge arm-level criteria (from group title) — these take priority
        if trial.arm_criteria:
            # Conflict resolution: arm-level state wins over the trial-level
            # state for stratified markers (IDH, MGMT, BRAF) so that, e.g., a
            # Stratum 2 entry tagged idh_mutant doesn't inherit a trial-level
            # idh_wildtype constraint scraped from the same eligibility text.
            _conflicts = {
                "idh_wildtype": "idh_mutant",
                "idh_mutant": "idh_wildtype",
                "mgmt_methylated": "mgmt_unmethylated",
                "mgmt_unmethylated": "mgmt_methylated",
            }
            for k in list(trial.arm_criteria.keys()):
                opp = _conflicts.get(k)
                if opp and opp in mol_criteria:
                    mol_criteria.pop(opp, None)
            mol_criteria.update(trial.arm_criteria)

        if mol_criteria:
            patients = filter_patients_by_molecular_criteria(
                patients, mol_criteria, self.expr_data, self.expr_patients,
                biomarker_data=self.biomarker_data,
            )
            logger.info(
                "Trial %s: %d patients after molecular filtering (criteria: %s)",
                trial.nct_id, len(patients), mol_criteria,
            )

        return patients

    def simulate_trial_iterations(
        self,
        trial: TrialInfo,
        eligible_patients: list[str],
        sim_dir: str,
        is_training: bool,
        learned_threshold: Optional[float] = None,
    ) -> dict:
        """Run N iterations of simulation for a single trial.

        For training: finds optimal DCNA threshold per iteration.
        For testing: applies learned_threshold and computes predicted response rate.
        """
        cohort_size = min(trial.enrollment, len(eligible_patients))
        if cohort_size < 5:
            logger.warning("Trial %s: too few eligible patients (%d)", trial.nct_id, len(eligible_patients))
            return {"thresholds": [], "predicted_rates": [], "cohort_size": cohort_size}

        rng = np.random.default_rng()
        thresholds = []
        predicted_rates = []
        fractions_above_threshold = []  # for screened-RR / lift analysis on testing trials

        # Precompute patient indices for fast lookup
        dcna_patient_idx = {p: i for i, p in enumerate(self.dcna_patients)}
        expr_patient_idx = {p: i for i, p in enumerate(self.expr_patients)}

        # Use arm-specific drugs if available, otherwise trial-level
        effective_dcna_drugs = trial.effective_dcna_drugs

        # Precompute gene targets for this trial's effective drugs
        all_gene_keys = set()
        expr_keys_upper = {k.upper(): k for k in self.expr_data}
        for drug in effective_dcna_drugs:
            entry = self.drug_targets.get(drug, {})
            for t in entry.get("targets", []):
                gene = t.get("gene_symbol", "")
                if gene.upper() in expr_keys_upper:
                    all_gene_keys.add(expr_keys_upper[gene.upper()])

        for iteration in range(self.n_iterations):
            # Random sample of patients matching trial cohort size
            sampled = rng.choice(eligible_patients, size=cohort_size, replace=False)

            # Compute DCNA and expression for each patient
            dcna_vals = np.zeros(cohort_size)
            expr_vals = np.zeros(cohort_size)

            for j, pid in enumerate(sampled):
                # Average DCNA across the arm's effective drugs
                d_idx = dcna_patient_idx.get(pid)
                if d_idx is not None:
                    drug_dcna = [
                        self.dcna_data[drug][d_idx]
                        for drug in effective_dcna_drugs
                        if drug in self.dcna_data
                    ]
                    if drug_dcna:
                        dcna_vals[j] = np.mean(drug_dcna)

                # Average expression across all gene targets
                e_idx = expr_patient_idx.get(pid)
                if e_idx is not None and all_gene_keys:
                    gene_expr = [self.expr_data[g][e_idx] for g in all_gene_keys]
                    expr_vals[j] = np.mean(gene_expr)

            if is_training:
                # Find DCNA threshold for this iteration
                threshold = find_dcna_threshold(dcna_vals, expr_vals, trial.response_rate)
                thresholds.append(threshold)
                # Also compute the predicted rate at this threshold for tracking
                in_upper = np.sum((dcna_vals > threshold) & (expr_vals > 0))
                predicted_rates.append(float(in_upper / cohort_size))
            else:
                # Apply learned threshold
                in_upper_right = np.sum(
                    (dcna_vals > learned_threshold) & (expr_vals > 0)
                )
                predicted_rate = in_upper_right / cohort_size
                predicted_rates.append(float(predicted_rate))
                # Fraction of the eligible cohort that would be enrolled if
                # we pre-screened on BOTH the learned DCNA threshold AND the
                # gene expression threshold (expr > 0). This matches the
                # responder definition used to compute predicted_rate above,
                # so the Threshold Validation lift math is consistent with
                # the simulation's own definition of a responder.
                n_above = int(np.sum((dcna_vals > learned_threshold) & (expr_vals > 0)))
                fractions_above_threshold.append(float(n_above / cohort_size))

            # Save plot every 100th iteration or first/last (to limit disk usage)
            if self.save_plots and sim_dir and iteration % 100 == 0:
                self._save_scatter_plot(
                    dcna_vals, expr_vals, trial, iteration, sim_dir,
                    is_training, thresholds[-1] if thresholds else learned_threshold,
                )

        return {
            "thresholds": thresholds,
            "predicted_rates": predicted_rates,
            "fractions_above_threshold": fractions_above_threshold,
            "cohort_size": cohort_size,
        }

    def _save_scatter_plot(
        self, dcna_vals, expr_vals, trial, iteration, sim_dir,
        is_training, threshold,
    ):
        """Save a DCNA vs Expression scatter plot to disk."""
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt

            fig, ax = plt.subplots(figsize=(8, 6))
            ax.scatter(dcna_vals, expr_vals, s=10, alpha=0.5, c="#4a90d9")

            # Gene expression threshold at y=0
            ax.axhline(y=0, color="green", linestyle="--", linewidth=1, label="Expr = 0")

            # DCNA threshold
            if threshold is not None:
                ax.axvline(x=threshold, color="red", linestyle="--", linewidth=1,
                           label=f"DCNA = {threshold:.4f}")

            ax.set_xlabel("DCNA (avg)")
            ax.set_ylabel("Gene Expression (avg)")
            phase = "Training" if is_training else "Testing"
            ax.set_title(f"{phase} - {trial.nct_id} - Iteration {iteration + 1}")
            ax.legend(fontsize=8)
            ax.grid(True, alpha=0.3)

            plot_dir = os.path.join(sim_dir, "training" if is_training else "testing", trial.nct_id)
            os.makedirs(plot_dir, exist_ok=True)
            fig.savefig(
                os.path.join(plot_dir, f"iter_{iteration + 1:04d}.png"),
                dpi=80, bbox_inches="tight",
            )
            plt.close(fig)
        except Exception as e:
            logger.warning("Failed to save scatter plot: %s", e)

    def run(self, moa_category: str, db, progress_callback=None) -> dict:
        """Execute the full MOA simulation pipeline.

        Returns a comprehensive results dictionary.
        """
        sim_id = str(uuid.uuid4())[:8]
        sim_dir = os.path.join(SIMULATIONS_DIR, sim_id)
        os.makedirs(sim_dir, exist_ok=True)

        def update_progress(stage, detail="", pct=0):
            if progress_callback:
                progress_callback(stage, detail, pct)
            logger.info("[%s] %s: %s (%.0f%%)", sim_id, stage, detail, pct)

        update_progress("init", "Finding drugs for MOA category", 0)

        # Step 1: Find drugs
        drugs = self.find_drugs_for_moa(moa_category, db)
        drug_names = [d["name"] for d in drugs]
        dcna_matched = [d for d in drugs if d["dcna_match"]]

        update_progress("drugs_found", f"{len(drugs)} drugs, {len(dcna_matched)} in DCNA data", 5)

        if not drug_names:
            _display = moa_category.replace("group:", "") if moa_category.startswith("group:") else moa_category
            return {"error": f"No drugs found for MOA category '{_display}'", "sim_id": sim_id}

        # Step 2: Find trials with response rates
        update_progress("finding_trials", "Searching for trials with response rate data", 10)
        trials = self.find_trials_with_response_rates(drug_names, db)

        if len(trials) < 3:
            return {
                "error": f"Not enough trials with response rates ({len(trials)} found, need >= 3)",
                "sim_id": sim_id,
                "drugs_found": len(drugs),
                "trials_found": len(trials),
            }

        # Step 2b: Outlier detection — screen out suspiciously high response rates
        update_progress("outlier_check", f"Screening {len(trials)} trials for response rate outliers", 12)
        trials, excluded_trials = self.detect_outlier_trials(trials)

        if excluded_trials:
            logger.info(
                "Outlier detection excluded %d trial entries: %s",
                len(excluded_trials),
                [e["nct_id"] for e in excluded_trials],
            )

        if len(trials) < 3:
            return {
                "error": (
                    f"Not enough trials after outlier removal ({len(trials)} remain, need >= 3). "
                    f"{len(excluded_trials)} trial(s) excluded."
                ),
                "sim_id": sim_id,
                "drugs_found": len(drugs),
                "trials_found": len(trials),
                "excluded_trials": excluded_trials,
            }

        # Step 2c: Eligibility-based exclusion — drop trials/arms whose eligible
        # TCGA cohort (after age + molecular filtering) is below the simulation
        # minimum cohort size of 5.
        MIN_ELIGIBLE = 5
        post_eligibility = []
        for t in trials:
            n_eligible = len(self.get_eligible_patients(t))
            if n_eligible < MIN_ELIGIBLE:
                reason = (
                    "No TCGA-GBM patients match this trial's eligibility "
                    "(age + molecular criteria)"
                    if n_eligible == 0
                    else (
                        f"Insufficient eligible TCGA patients "
                        f"(n={n_eligible}, minimum={MIN_ELIGIBLE})"
                    )
                )
                excluded_trials.append({
                    "nct_id": t.nct_id,
                    "title": t.title,
                    "arm_group": t.arm_group,
                    "enrollment": t.enrollment,
                    "actual_response_rate": t.response_rate,
                    "drugs": t.effective_dcna_drugs,
                    "exclusion_reason": reason,
                    "exclusion_method": "no_eligible_patients",
                    "molecular_criteria": self._trial_display_criteria(t),
                    "min_age": t.min_age,
                    "max_age": t.max_age,
                })
                logger.info(
                    "Trial %s excluded: %d eligible TCGA patients (age %s-%s, criteria=%s)",
                    t.nct_id, n_eligible, t.min_age, t.max_age, t.arm_criteria,
                )
            else:
                post_eligibility.append(t)
        trials = post_eligibility

        if len(trials) < 3:
            return {
                "error": (
                    f"Not enough trials after eligibility filtering "
                    f"({len(trials)} remain, need >= 3)."
                ),
                "sim_id": sim_id,
                "drugs_found": len(drugs),
                "trials_found": len(trials),
                "excluded_trials": excluded_trials,
            }

        # Step 3: Calculate median response rate
        all_rr = [t.response_rate for t in trials]
        median_rr = float(np.median(all_rr))

        update_progress(
            "trials_found",
            f"{len(trials)} trials (excl. {len(excluded_trials)} outliers), median RR = {median_rr:.3f}",
            15,
        )

        # Step 4: Partition into training and testing
        training_trials, testing_trials = self.partition_trials(trials)

        update_progress(
            "partitioned",
            f"{len(training_trials)} training, {len(testing_trials)} testing",
            20,
        )

        # Step 5: Run training simulations
        all_training_thresholds = []
        training_results = []

        for i, trial in enumerate(training_trials):
            eligible = self.get_eligible_patients(trial)
            # Combine trial-level + arm-level criteria for display
            mol_criteria = parse_molecular_criteria(trial.criteria_text)
            if trial.arm_criteria:
                _conflicts = {
                    "idh_wildtype": "idh_mutant",
                    "idh_mutant": "idh_wildtype",
                    "mgmt_methylated": "mgmt_unmethylated",
                    "mgmt_unmethylated": "mgmt_methylated",
                }
                for k in list(trial.arm_criteria.keys()):
                    opp = _conflicts.get(k)
                    if opp and opp in mol_criteria:
                        mol_criteria.pop(opp, None)
                mol_criteria.update(trial.arm_criteria)
            pct = 20 + (i + 1) / len(training_trials) * 40

            update_progress(
                "training",
                f"Trial {i + 1}/{len(training_trials)}: {trial.nct_id} "
                f"({len(eligible)} eligible, RR={trial.response_rate:.3f})",
                pct,
            )

            result = self.simulate_trial_iterations(
                trial, eligible, sim_dir, is_training=True,
            )
            # If the simulation produced no predicted rates (e.g. cohort_size < 5
            # because enrollment is too small), exclude the trial entirely so it
            # never reaches the correlation analysis with mean_predicted_rate=0.
            if not result.get("predicted_rates") or not result.get("thresholds"):
                excluded_trials.append({
                    "nct_id": trial.nct_id,
                    "title": trial.title,
                    "arm_group": trial.arm_group,
                    "enrollment": trial.enrollment,
                    "actual_response_rate": trial.response_rate,
                    "drugs": trial.effective_dcna_drugs,
                    "exclusion_reason": (
                        f"Simulation produced no predicted rates "
                        f"(cohort_size={result.get('cohort_size', 0)}, "
                        f"eligible={len(eligible)}, enrollment={trial.enrollment})"
                    ),
                    "exclusion_method": "simulation_failed",
                    "molecular_criteria": self._trial_display_criteria(trial),
                    "min_age": trial.min_age,
                    "max_age": trial.max_age,
                })
                continue
            all_training_thresholds.extend(result["thresholds"])
            training_results.append({
                "nct_id": trial.nct_id,
                "title": trial.title,
                "arm_group": trial.arm_group,
                "enrollment": trial.enrollment,
                "actual_response_rate": trial.response_rate,
                "drugs": trial.effective_dcna_drugs,
                "all_trial_drugs": trial.dcna_drug_names,
                "arm_drugs": trial.arm_dcna_drug_names,
                "molecular_criteria": _format_molecular_criteria(mol_criteria),
                "min_age": trial.min_age,
                "max_age": trial.max_age,
                "eligible_patients": len(eligible),
                "total_patients": len(self.common_patients),
                "cohort_size": result["cohort_size"],
                "thresholds": result["thresholds"],
                "mean_threshold": float(np.mean(result["thresholds"])) if result["thresholds"] else 0,
                "std_threshold": float(np.std(result["thresholds"])) if result["thresholds"] else 0,
                "mean_predicted_rate": float(np.mean(result["predicted_rates"])) if result["predicted_rates"] else 0,
                "std_predicted_rate": float(np.std(result["predicted_rates"])) if result["predicted_rates"] else 0,
            })

        # Step 6: Calculate Overall Learned Threshold
        if not all_training_thresholds:
            return {"error": "No training thresholds learned", "sim_id": sim_id}

        overall_threshold = float(np.mean(all_training_thresholds))
        threshold_std = float(np.std(all_training_thresholds))

        update_progress(
            "threshold_learned",
            f"Overall threshold = {overall_threshold:.4f} (std={threshold_std:.4f}) "
            f"from {len(all_training_thresholds)} thresholds",
            60,
        )

        # Step 7: Run testing simulations
        testing_results = []

        for i, trial in enumerate(testing_trials):
            eligible = self.get_eligible_patients(trial)
            mol_criteria = parse_molecular_criteria(trial.criteria_text)
            if trial.arm_criteria:
                _conflicts = {
                    "idh_wildtype": "idh_mutant",
                    "idh_mutant": "idh_wildtype",
                    "mgmt_methylated": "mgmt_unmethylated",
                    "mgmt_unmethylated": "mgmt_methylated",
                }
                for k in list(trial.arm_criteria.keys()):
                    opp = _conflicts.get(k)
                    if opp and opp in mol_criteria:
                        mol_criteria.pop(opp, None)
                mol_criteria.update(trial.arm_criteria)
            pct = 60 + (i + 1) / len(testing_trials) * 30

            update_progress(
                "testing",
                f"Trial {i + 1}/{len(testing_trials)}: {trial.nct_id} "
                f"({len(eligible)} eligible, actual RR={trial.response_rate:.3f})",
                pct,
            )

            result = self.simulate_trial_iterations(
                trial, eligible, sim_dir, is_training=False,
                learned_threshold=overall_threshold,
            )
            if not result.get("predicted_rates"):
                excluded_trials.append({
                    "nct_id": trial.nct_id,
                    "title": trial.title,
                    "arm_group": trial.arm_group,
                    "enrollment": trial.enrollment,
                    "actual_response_rate": trial.response_rate,
                    "drugs": trial.effective_dcna_drugs,
                    "exclusion_reason": (
                        f"Simulation produced no predicted rates "
                        f"(cohort_size={result.get('cohort_size', 0)}, "
                        f"eligible={len(eligible)}, enrollment={trial.enrollment})"
                    ),
                    "exclusion_method": "simulation_failed",
                    "molecular_criteria": self._trial_display_criteria(trial),
                    "min_age": trial.min_age,
                    "max_age": trial.max_age,
                })
                continue
            testing_results.append({
                "nct_id": trial.nct_id,
                "title": trial.title,
                "arm_group": trial.arm_group,
                "enrollment": trial.enrollment,
                "actual_response_rate": trial.response_rate,
                "drugs": trial.effective_dcna_drugs,
                "all_trial_drugs": trial.dcna_drug_names,
                "arm_drugs": trial.arm_dcna_drug_names,
                "molecular_criteria": _format_molecular_criteria(mol_criteria),
                "min_age": trial.min_age,
                "max_age": trial.max_age,
                "eligible_patients": len(eligible),
                "total_patients": len(self.common_patients),
                "cohort_size": result["cohort_size"],
                "predicted_rates": result["predicted_rates"],
                "mean_predicted_rate": float(np.mean(result["predicted_rates"])) if result["predicted_rates"] else 0,
                "std_predicted_rate": float(np.std(result["predicted_rates"])) if result["predicted_rates"] else 0,
                "mean_fraction_above_threshold": (
                    float(np.mean(result.get("fractions_above_threshold", [])))
                    if result.get("fractions_above_threshold") else 0
                ),
                # Full per-iteration list so the Threshold Validation page can
                # derive honest per-trial confidence intervals on screened RR
                # and lift rather than relying on the mean alone.
                "fractions_above_threshold": list(
                    result.get("fractions_above_threshold", []) or []
                ),
            })

        update_progress("analysis", "Running comparison analyses", 92)

        # Step 8: Comparison analyses
        analyses = self._run_comparison_analyses(testing_results)

        # Step 9: Build response rate ranges for violin overlay
        # Build the violin-overlay range directly from the current MOA cohort
        # (training + testing trials that survived outlier filtering) using
        # each trial's own response_rate — the same values the simulation
        # actually uses. This keeps the overlay consistent with the analysis
        # cohort and avoids pulling sub-population outcome rows from unrelated
        # trials in the DB.
        drug_rr_ranges = self._compute_drug_rr_ranges_from_cohort(
            testing_trials, trials
        )

        update_progress("complete", "Simulation complete", 100)

        # Build set of MOA drug names (raw DB names + DCNA-resolved names)
        # so the frontend can bold drugs that match the selected MOA category.
        # Only include DCNA matches for single-drug entries to avoid false
        # positives from combination names like "Bevacizumab and Erlotinib"
        # where the DCNA match resolves to just "BEVACIZUMAB".
        import re as _re
        _combo_pattern = _re.compile(r'\s+(?:and|plus|with|\+|/|,)\s+', _re.IGNORECASE)
        _moa_names = set()
        for _d in drugs:
            _raw = _d["name"].upper()
            _moa_names.add(_raw)
            if _d.get("dcna_match"):
                _dcna = _d["dcna_match"].upper()
                # Only add DCNA match if the raw name is a single drug
                # (not a combination entry like "Drug A and Drug B")
                if not _combo_pattern.search(_d["name"]):
                    _moa_names.add(_dcna)
                # For combinations, don't add DCNA match (it would be
                # just one component of the combo, not necessarily the
                # one responsible for the MOA classification)
        _moa_all = sorted(_moa_names)

        # Save summary to disk
        moa_display = moa_category.replace("group:", "") if moa_category.startswith("group:") else moa_category
        summary = {
            "sim_id": sim_id,
            "moa_category": moa_display,
            "total_drugs": len(drugs),
            "total_trials": len(trials),
            "median_response_rate": median_rr,
            "overall_learned_threshold": overall_threshold,
            "threshold_std": threshold_std,
            "total_training_thresholds": len(all_training_thresholds),
            "moa_drug_names": _moa_all,
            "training_trials": [
                {k: v for k, v in r.items() if k not in ("thresholds", "predicted_rates")}
                for r in training_results
            ],
            "testing_trials": [
                {k: v for k, v in r.items() if k != "predicted_rates"}
                for r in testing_results
            ],
            "testing_violin_data": [
                {
                    "nct_id": r["nct_id"],
                    "title": r["title"],
                    "drugs": r["drugs"],
                    "actual_response_rate": r["actual_response_rate"],
                    "predicted_rates": r["predicted_rates"],
                    "drug_rr_range": drug_rr_ranges.get(r["nct_id"], {}),
                }
                for r in testing_results
            ],
            "excluded_trials": excluded_trials,
            "analyses": analyses,
        }

        # Step 10: Responder classification matrix for similarity analysis
        try:
            from analysis.responder_similarity import build_classification_matrix
            classification_matrix = build_classification_matrix(
                self, trials, overall_threshold
            )
            summary["responder_classification_matrix"] = classification_matrix
        except Exception as e:
            logger.warning(f"Failed to build responder classification matrix: {e}")
            summary["responder_classification_matrix"] = None

        with open(os.path.join(sim_dir, "summary.json"), "w") as f:
            json.dump(summary, f, indent=2)

        return summary

    def _compute_drug_rr_ranges_from_cohort(
        self,
        testing_trials: list[TrialInfo],
        cohort_trials: list[TrialInfo],
    ) -> dict:
        """Drug RR ranges restricted to the current MOA cohort.

        For each testing trial, collect the response rates of every cohort
        trial that shares at least one drug name with it. The range is then
        min/max/median of those cohort-level trial RRs.
        """
        # Canonicalize drug names through the alias map so that synonyms
        # (e.g. "ABT-888" and "Veliparib", "PARP Inhibitor BGB-290" and
        # "Pamiparib") collapse to the same key.
        try:
            from moa_classification.drug_aliases import resolve_drug_name
        except Exception:
            resolve_drug_name = None  # type: ignore

        def _canon(name: str) -> str:
            base = (name or "").strip()
            if not base:
                return ""
            if resolve_drug_name is not None:
                try:
                    resolved = resolve_drug_name(base) or base
                except Exception:
                    resolved = base
            else:
                resolved = base
            up = resolved.strip().upper()
            # Strip parenthetical code-name suffix, e.g. "PAMIPARIB (BGB-290)" -> "PAMIPARIB"
            if "(" in up:
                up = up.split("(", 1)[0].strip()
            return up

        # Build a drug -> list of (nct_id, response_rate) index over the cohort
        drug_index: dict[str, list[tuple[str, float]]] = {}
        for ct in cohort_trials:
            ct_keys = {_canon(dn) for dn in ct.drug_names}
            ct_keys.discard("")
            for key in ct_keys:
                drug_index.setdefault(key, []).append((ct.nct_id, float(ct.response_rate)))

        ranges: dict = {}
        for trial in testing_trials:
            seen_nct: set[str] = set()
            rrs: list[float] = []
            trial_keys = {_canon(dn) for dn in trial.drug_names}
            trial_keys.discard("")
            for key in trial_keys:
                for nct_id, rr in drug_index.get(key, []):
                    if nct_id in seen_nct:
                        continue
                    seen_nct.add(nct_id)
                    rrs.append(rr)
            if rrs:
                ranges[trial.nct_id] = {
                    "min": float(min(rrs)),
                    "max": float(max(rrs)),
                    "median": float(np.median(rrs)),
                    "count": len(rrs),
                }
        return ranges

    def _compute_drug_rr_ranges(
        self,
        testing_trials: list[TrialInfo],
        db,
        excluded_nct_ids: set[str] | None = None,
        cohort_nct_ids: set[str] | None = None,
    ) -> dict:
        """Compute the range of response rates for each drug.

        When ``cohort_nct_ids`` is provided, the range is restricted to trials
        in the current MOA cohort (training + testing trials that survived
        outlier filtering), so the overlay matches the data the simulation
        actually used. Any ``excluded_nct_ids`` are removed as an extra guard.
        """
        from database.models import OutcomeRecord, InterventionRecord, trial_interventions
        from sqlalchemy import func

        excluded_nct_ids = excluded_nct_ids or set()
        cohort_nct_ids = cohort_nct_ids or set()
        ranges = {}
        for trial in testing_trials:
            drug_rrs = []
            for drug_name in trial.drug_names:
                # Find all trials using this drug with response rates
                trial_ids_q = (
                    db.query(trial_interventions.c.trial_nct_id)
                    .join(InterventionRecord)
                    .filter(func.upper(InterventionRecord.name) == drug_name.upper())
                )
                outcomes_q = (
                    db.query(OutcomeRecord)
                    .filter(
                        OutcomeRecord.trial_nct_id.in_(trial_ids_q.subquery()),
                        OutcomeRecord.results_json.isnot(None),
                    )
                )
                if cohort_nct_ids:
                    outcomes_q = outcomes_q.filter(
                        OutcomeRecord.trial_nct_id.in_(list(cohort_nct_ids))
                    )
                if excluded_nct_ids:
                    outcomes_q = outcomes_q.filter(
                        ~OutcomeRecord.trial_nct_id.in_(list(excluded_nct_ids))
                    )
                outcomes = outcomes_q.all()
                for o in outcomes:
                    measure = (o.measure or "").lower()
                    if _response_rate_priority(measure) is not None:
                        rr = extract_response_rate(o.results_json)
                        if rr is not None and 0 <= rr < 1:
                            drug_rrs.append(rr)

            if drug_rrs:
                ranges[trial.nct_id] = {
                    "min": float(min(drug_rrs)),
                    "max": float(max(drug_rrs)),
                    "median": float(np.median(drug_rrs)),
                    "count": len(drug_rrs),
                }

        return ranges

    def _run_comparison_analyses(self, testing_results: list[dict]) -> dict:
        """Run MAE, Bland-Altman, and 95% CI Coverage analyses."""
        if not testing_results:
            return {}

        # For each testing trial, compare mean predicted rate vs actual
        actual = np.array([r["actual_response_rate"] for r in testing_results])
        predicted = np.array([r["mean_predicted_rate"] for r in testing_results])

        if len(actual) < 2:
            return {"note": "Too few testing trials for meaningful comparison"}

        # MAE Analysis
        abs_errors = np.abs(predicted - actual)
        mae = float(np.mean(abs_errors))
        mae_per_trial = [
            {
                "nct_id": r["nct_id"],
                "actual": r["actual_response_rate"],
                "predicted": r["mean_predicted_rate"],
                "abs_error": float(abs(r["mean_predicted_rate"] - r["actual_response_rate"])),
            }
            for r in testing_results
        ]

        # Bland-Altman Analysis
        means_ba = (actual + predicted) / 2
        diffs_ba = predicted - actual
        mean_diff = float(np.mean(diffs_ba))
        std_diff = float(np.std(diffs_ba, ddof=1)) if len(diffs_ba) > 1 else 0
        loa_upper = mean_diff + 1.96 * std_diff
        loa_lower = mean_diff - 1.96 * std_diff

        bland_altman = {
            "mean_diff": round(mean_diff, 4),
            "std_diff": round(std_diff, 4),
            "upper_loa": round(loa_upper, 4),
            "lower_loa": round(loa_lower, 4),
            "points": [
                {
                    "nct_id": testing_results[i]["nct_id"],
                    "mean": float(means_ba[i]),
                    "diff": float(diffs_ba[i]),
                }
                for i in range(len(testing_results))
            ],
        }

        # 95% CI Coverage Analysis
        # For each testing trial, check if actual RR falls within the
        # 95% CI of the 1000 predicted rates
        ci_results = []
        covered_count = 0
        for r in testing_results:
            rates = r["predicted_rates"]
            if len(rates) < 2:
                continue
            ci_lower = float(np.percentile(rates, 2.5))
            ci_upper = float(np.percentile(rates, 97.5))
            actual_rr = r["actual_response_rate"]
            covered = ci_lower <= actual_rr <= ci_upper
            if covered:
                covered_count += 1
            ci_results.append({
                "nct_id": r["nct_id"],
                "actual": actual_rr,
                "ci_lower": round(ci_lower, 4),
                "ci_upper": round(ci_upper, 4),
                "covered": covered,
                "predicted_mean": r["mean_predicted_rate"],
            })

        ci_coverage = {
            "coverage_rate": round(covered_count / len(ci_results), 4) if ci_results else 0,
            "covered_count": covered_count,
            "total_trials": len(ci_results),
            "trials": ci_results,
        }

        return {
            "mae": {
                "value": round(mae, 4),
                "per_trial": mae_per_trial,
            },
            "bland_altman": bland_altman,
            "ci_coverage": ci_coverage,
        }
