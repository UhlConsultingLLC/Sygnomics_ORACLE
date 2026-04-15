"""Extract biomarker criteria from eligibility text for TCGA GBM matching.

Parses free-text eligibility criteria to identify gene mutations, amplifications,
expression markers, fusions, methylation status, and other molecular features
that can be matched against the TCGA GBM patient cohort.
"""

import json
import logging
import re
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# Path to TCGA GBM prevalence reference data
PREVALENCE_FILE = Path(__file__).resolve().parent.parent / "data" / "tcga_gbm_biomarker_prevalence.json"


class BiomarkerMatch(BaseModel):
    """A biomarker criterion extracted from eligibility text."""

    marker: str  # Canonical name (e.g., "IDH1 mutation")
    category: str  # mutation, amplification, methylation, expression, fusion, codeletion, other
    raw_text: str  # The matched text from the criteria
    context: str  # inclusion or exclusion
    requirement: str  # required, excluded, or any (mentioned but no direction)
    tcga_count: Optional[int] = None  # Patients in TCGA-GBM with this marker
    tcga_total: Optional[int] = None  # Total patients in TCGA-GBM reference
    tcga_percent: Optional[float] = None  # Percentage
    tcga_note: Optional[str] = None  # Extra context about the stat


# Ordered list of biomarker patterns to search for.
# Each entry: (canonical_name, category, regex_pattern)
# More specific patterns come first to avoid partial matches.
BIOMARKER_PATTERNS: list[tuple[str, str, str]] = [
    # --- MGMT methylation (order matters: status-known > unmethylated > methylated > catch-all) ---
    # "status known/available" FIRST — these look like "MGMT methylation status must be available"
    # which contains "methylation" but means status-known, not methylated-required.
    # Allow optional punctuation/parens after MGMT (e.g., "(MGMT) methylation status")
    ("MGMT status known", "methylation",
     r"MGMT[)\s]+(?:(?:gene\s+)?(?:promoter\s+)?)?methylation\s+status\s+(?:must\s+be\s+|is\s+)?(?:known|available|determined|documented|required|needed)"),
    ("MGMT status known", "methylation",
     r"MGMT[)\s]+(?:(?:promoter\s+)?methylation\s+)?status\s+(?:must\s+be\s+)?(?:known|available|determined|documented)"),
    ("MGMT status known", "methylation",
     r"(?:known|available|determined|documented)\s+MGMT[)\s]+(?:promoter\s+)?(?:methylation\s+)?status"),
    ("MGMT status known", "methylation",
     r"MGMT[)\s]+(?:promoter\s+)?methylation\s+(?:testing|test)\s+(?:is\s+|must\s+be\s+)?(?:required|needed|mandatory)"),
    # Catch "Proven/Established/Confirmed MGMT (gene) (promoter) methylation status"
    # — these say the status must be known, not that it must be methylated.
    ("MGMT status known", "methylation",
     r"(?:proven|established|confirmed|verified|validated)\s+MGMT[)\s]*(?:gene\s+)?(?:promoter\s+)?methylation\s+status"),
    # "unmethylated" must precede "methylated" because "unmethylated" contains "methylated"
    ("MGMT unmethylated", "methylation",
     r"(?:MGMT[)\s]+(?:(?:gene\s+)?promoter\s+)?(?:is\s+|must\s+be\s+)?unmethylat(?:ion|ed)|unmethylat(?:ion|ed)\s+(?:of\s+)?MGMT|MGMT[)\s]+(?:promoter\s+)?(?:status\s+)?(?:is\s+)?unmethylat)"),
    # Negative lookahead `(?!\s+status)` prevents "methylation status" from being
    # mis-classified as "promoter methylated" / "methylated".
    ("MGMT promoter methylated", "methylation",
     r"(?:MGMT[)\s]+(?:gene\s+)?promoter\s+(?:is\s+|must\s+be\s+)?methylat(?:ion|ed)(?!\s+status)|methylat(?:ion|ed)(?!\s+status)\s+(?:of\s+)?(?:the\s+)?MGMT\s+(?:gene\s+)?promoter)"),
    ("MGMT methylated", "methylation",
     r"(?:MGMT[)\s]+(?:is\s+|must\s+be\s+)?methylat(?:ion|ed)(?!\s+status)|methylat(?:ion|ed)(?!\s+status)\s+(?:of\s+)?MGMT)"),

    # --- IDH mutations ---
    ("IDH1 R132H mutation", "mutation",
     r"IDH1?\s+R132H"),
    ("IDH1 mutation", "mutation",
     r"IDH[- ]?1\s+(?:R132[A-Z]?\s+)?mut(?:ation|ated|ant)"),
    ("IDH2 mutation", "mutation",
     r"IDH[- ]?2\s+mut(?:ation|ated|ant)"),
    ("IDH mutation", "mutation",
     r"IDH[12]?\s*(?:/\s*IDH[12]?)?\s+mut(?:ation|ated|ant)"),
    ("IDH wild-type", "mutation",
     r"IDH[12]?\s*(?:-|\s)?(?:wild[\s-]?type|wt|WT)"),

    # --- EGFR ---
    ("EGFRvIII", "mutation",
     r"EGFRvIII|EGFR\s+variant\s+III|EGFR\s+vIII"),
    ("EGFR amplification", "amplification",
     r"EGFR\s+(?:gene[\s-]+)?amplif(?:ication|ied)"),
    ("EGFR mutation", "mutation",
     r"EGFR\s+mut(?:ation|ated|ant)"),
    ("EGFR overexpression", "expression",
     r"EGFR\s+(?:over)?express(?:ion|ing|ed)"),
    ("EGFR alteration", "other",
     r"EGFR\s+alter(?:ation|ed)"),

    # --- TP53 ---
    ("TP53 mutation", "mutation",
     r"(?:TP53|p53)\s+mut(?:ation|ated|ant)"),

    # --- PTEN ---
    ("PTEN loss", "expression",
     r"PTEN\s+(?:loss|delet(?:ion|ed)|deficien(?:cy|t))"),
    ("PTEN mutation", "mutation",
     r"PTEN\s+mut(?:ation|ated|ant)"),

    # --- BRAF ---
    ("BRAF V600E mutation", "mutation",
     r"BRAF\s*V600[EKD]?\s*mut(?:ation|ated|ant)"),
    ("BRAF V600E", "mutation",
     r"BRAF\s*V600[EKD]?"),
    ("BRAF mutation", "mutation",
     r"BRAF\s+mut(?:ation|ated|ant)"),

    # --- TERT ---
    ("TERT promoter mutation", "mutation",
     r"TERT\s+(?:promoter\s+)?mut(?:ation|ated|ant)"),

    # --- 1p/19q codeletion ---
    ("1p/19q codeletion", "codeletion",
     r"1p\s*/?\s*19q\s+(?:co[\s-]?delet(?:ion|ed)|loss)"),
    ("1p/19q", "codeletion",
     r"1p\s*/\s*19q"),

    # --- ATRX ---
    ("ATRX loss", "expression",
     r"ATRX\s+(?:loss|absent|neg(?:ative)?)"),
    ("ATRX mutation", "mutation",
     r"ATRX\s+mut(?:ation|ated|ant)"),

    # --- PDGFRA ---
    ("PDGFRA amplification", "amplification",
     r"PDGFRA?\s+amplif(?:ication|ied)"),

    # --- CDK4/6, CDKN2A ---
    ("CDKN2A deletion", "mutation",
     r"CDKN2A\s*(?:/\s*CDKN2B)?\s+(?:delet(?:ion|ed)|loss|homozygous)"),
    ("CDK4 amplification", "amplification",
     r"CDK[46]\s+amplif(?:ication|ied)"),

    # --- MDM2 ---
    ("MDM2 amplification", "amplification",
     r"MDM[24]\s+amplif(?:ication|ied)"),

    # --- NTRK fusions ---
    ("NTRK fusion", "fusion",
     r"NTRK[123]?\s+(?:gene\s+)?fus(?:ion|ed)"),

    # --- ALK ---
    ("ALK fusion", "fusion",
     r"ALK\s+(?:gene\s+)?(?:fus(?:ion|ed)|rearrange(?:ment|d))"),

    # --- ROS1 ---
    ("ROS1 fusion", "fusion",
     r"ROS1\s+(?:gene\s+)?(?:fus(?:ion|ed)|rearrange(?:ment|d))"),

    # --- FGFR ---
    ("FGFR alteration", "mutation",
     r"FGFR[1234]?\s+(?:mutat(?:ion|ed)|amplif(?:ication|ied)|fus(?:ion|ed)|alter(?:ation|ed))"),

    # --- MET ---
    ("MET amplification", "amplification",
     r"(?:c-)?MET\s+amplif(?:ication|ied)"),

    # --- PIK3CA ---
    ("PIK3CA mutation", "mutation",
     r"PIK3CA\s+mut(?:ation|ated|ant)"),

    # --- NF1 ---
    ("NF1 mutation", "mutation",
     r"NF1\s+(?:mut(?:ation|ated|ant)|loss|delet(?:ion|ed)|inactiv)"),

    # --- TMB / MSI ---
    ("High TMB", "other",
     r"(?:high\s+)?(?:TMB|tumor\s+mutational\s+burden)(?:\s+high)?"),
    ("MSI-H", "other",
     r"(?:MSI[\s-]?H|microsatellite\s+instability[\s-]?high)"),

    # --- PD-L1 ---
    ("PD-L1 expression", "expression",
     r"PD[\s-]?L1\s+(?:express(?:ion|ing)|positive|TPS|CPS)"),

    # --- Broad catch-all for mentions ---
    ("Ki-67 expression", "expression",
     r"Ki[\s-]?67\s+(?:express(?:ion|ing)|index|proliferat)"),

    # --- H3K27M (diffuse midline glioma) ---
    ("H3K27M mutation", "mutation",
     r"H3\s*K27M|H3F3A\s+K27M"),

    # --- MGMT as standalone catch-all (classify by context) ---
    ("MGMT mentioned", "methylation",
     r"\bMGMT\b"),

    # --- Disease state (TCGA-GBM matchable) ---
    ("Newly diagnosed", "disease_state",
     r"newly[\s-]diagnos(?:ed|is)|first[\s-]diagnos(?:ed|is)|treatment[\s-]na(?:ï|i)ve|primary\s+(?:newly\s+)?diagnos(?:ed|is)"),
    ("Recurrent disease", "disease_state",
     r"recurren(?:t|ce)\s+(?:glioblastoma|gbm|glioma|brain\s*tumor|disease|tumou?r)|relaps(?:ed|e|ing)\s+(?:glioblastoma|gbm|glioma|disease|brain\s*tumor)|second\s+recurren"),
]


# Fallback prevalence for markers not in the JSON reference file.
# TCGA-GBM cohort is overwhelmingly newly diagnosed primary GBM.
_FALLBACK_PREVALENCE: dict[str, dict] = {
    "Newly diagnosed": {
        "count": 590, "total": 596, "percent": 99.0,
        "note": "TCGA-GBM is composed almost entirely of newly diagnosed primary GBM samples.",
    },
    "Recurrent disease": {
        "count": 13, "total": 596, "percent": 2.2,
        "note": "TCGA-GBM contains very few recurrent/secondary GBM samples.",
    },
}


def _load_prevalence() -> dict:
    """Load TCGA GBM biomarker prevalence reference data."""
    if PREVALENCE_FILE.exists():
        with open(PREVALENCE_FILE) as f:
            return json.load(f)
    logger.warning("TCGA GBM prevalence file not found at %s", PREVALENCE_FILE)
    return {}


def _determine_context(text_before: str, eligibility_end_offset: int | None = None, match_start: int | None = None) -> str:
    """Guess whether a match is in inclusion or exclusion criteria.

    If *eligibility_end_offset* is set and the match occurs after that
    position (i.e. inside summary / description text that was appended
    after the formal eligibility criteria), the context defaults to
    ``"inclusion"`` because trial summaries describe what the trial
    *requires* (positive criteria) rather than exclusions.
    """
    # If the match is in summary text (after eligibility), default to inclusion
    if eligibility_end_offset is not None and match_start is not None:
        if match_start >= eligibility_end_offset:
            return "inclusion"

    # Search backwards for section headers within eligibility text only
    search_text = text_before
    if eligibility_end_offset is not None:
        # Only look at eligibility portion for section headers
        search_text = text_before[:eligibility_end_offset] if len(text_before) > eligibility_end_offset else text_before

    text_lower = search_text.lower()
    last_incl = max(text_lower.rfind("inclusion"), text_lower.rfind("inclusion criteria"))
    last_excl = max(text_lower.rfind("exclusion"), text_lower.rfind("exclusion criteria"))
    if last_excl > last_incl:
        return "exclusion"
    return "inclusion"


def _determine_requirement(match_text: str, surrounding: str) -> str:
    """Determine if the biomarker is required, excluded, or just mentioned."""
    surrounding_lower = surrounding.lower()
    # Negative / exclusion indicators
    neg_patterns = [
        r"\bnot?\s+(?:have|harbor|carry|show|express)",
        r"\bwithout\b",
        r"\babsence\s+of\b",
        r"\bneg(?:ative)?\b",
        r"\bwild[\s-]?type\b",
        r"\bexclud(?:e|ed|ing)\b",
        r"\bmust\s+not\b",
    ]
    for pat in neg_patterns:
        if re.search(pat, surrounding_lower):
            return "excluded"

    # Positive / required indicators
    pos_patterns = [
        r"\bconfirmed\b",
        r"\bpositive\b",
        r"\brequired\b",
        r"\bmust\s+have\b",
        r"\bpresence\s+of\b",
        r"\bharbor(?:ing)?\b",
        r"\bcarry(?:ing)?\b",
        r"\bdocumented\b",
        r"\bproven\b",
    ]
    for pat in pos_patterns:
        if re.search(pat, surrounding_lower):
            return "required"

    return "mentioned"


def _classify_mgmt_mention(surrounding: str) -> str:
    """Classify a bare MGMT mention by its surrounding context.

    Returns a canonical marker name:
      - "MGMT methylated" if context indicates methylation is required
      - "MGMT unmethylated" if context indicates unmethylated
      - "MGMT status known" if context says status must be available/known
      - "MGMT mentioned" if no clear direction
    """
    s = surrounding.lower()

    # Check for unmethylated first (contains "methylated")
    if re.search(r"unmethylat", s):
        return "MGMT unmethylated"

    # Check for "status known/available/determined" patterns
    status_known_pats = [
        r"status\s+(?:must\s+be\s+)?(?:known|available|determined|documented)",
        r"(?:known|available|determined|documented)\s+.*status",
        r"status\s+(?:is\s+)?(?:required|needed)",
        r"(?:must|should)\s+(?:be\s+)?(?:known|tested|assessed|evaluated)",
        r"(?:either|any)\s+(?:methylat|result)",
        r"(?:methylat\w+|unmethylat\w+).{0,30}(?:allowed|permitted|eligible|accepted)",
        r"(?:allowed|permitted|eligible)\s+regardless",
    ]
    for pat in status_known_pats:
        if re.search(pat, s):
            return "MGMT status known"

    # Check for methylated (positive)
    if re.search(r"methylat(?:ed|ion)", s):
        # But make sure it's not "methylation status" without direction
        if re.search(r"methylation\s+status", s) and not re.search(r"(?:proven|confirmed|documented)\s+.*methylat(?:ed|ion)", s):
            return "MGMT status known"
        return "MGMT methylated"

    return "MGMT mentioned"


class ArmBiomarkerInfo(BaseModel):
    """Biomarker criteria extracted from a study arm description."""

    arm_label: str
    arm_type: str
    arm_description: str
    biomarkers: list[BiomarkerMatch]


# Generic tokens to ignore when fingerprinting an arm by intervention text.
_ARM_STOPWORDS = {
    "the", "and", "with", "for", "arm", "group", "experimental", "comparator",
    "placebo", "active", "cohort", "regimen", "treatment", "patients", "patient",
    "dose", "phase", "study", "control", "standard", "care", "plus", "without",
    "alone", "combination", "combined", "therapy", "drug", "drugs", "use",
    "administered", "received", "receive", "every", "day", "days", "week", "weeks",
    "cycle", "cycles", "mg", "kg", "iv", "po", "oral", "intravenous",
}


def _arm_tokens(arm: dict) -> set[str]:
    """Extract distinctive tokens from an arm's label, description, and interventions."""
    parts = [
        arm.get("label", "") or "",
        arm.get("description", "") or "",
    ]
    for iv in arm.get("interventions", []) or []:
        parts.append(str(iv))
    text = " ".join(parts).lower()
    toks = set(re.findall(r"[a-z][a-z0-9]{2,}", text))
    return {t for t in toks if t not in _ARM_STOPWORDS}


def _split_summary_chunks(text: str) -> list[str]:
    """Split a summary into bullet/sentence-sized chunks for per-arm analysis."""
    if not text:
        return []
    # Normalize bullets and split on bullets, blank lines, and sentence boundaries.
    pieces = re.split(r"(?:\n\s*[*•\-–—]\s+|\n{2,}|(?<=[.!?])\s+(?=[A-Z]))", text)
    return [p.strip() for p in pieces if p and len(p.strip()) >= 10]


def extract_arm_biomarkers(
    arms: list[dict],
    summary_text: str = "",
) -> list[ArmBiomarkerInfo]:
    """Extract biomarkers from study arm labels, descriptions, and (optionally)
    arm-specific mentions inside a trial's brief/detailed summary.

    Args:
        arms: List of arm dicts with 'label', 'type', 'description', and optionally
              'interventions' keys.
        summary_text: Optional trial-level prose (brief_summary + detailed_description)
              that may describe arm-specific patient criteria not present in the arm
              description itself (e.g., MGMT methylation status assigned per regimen).

    Returns:
        List of ArmBiomarkerInfo, only for arms that have biomarker mentions.
    """
    by_label: dict[str, list[BiomarkerMatch]] = {}

    # Pass 1: pull biomarkers directly from each arm's own label/description.
    for arm in arms:
        label = arm.get("label", "")
        combined = f"{label}\n{arm.get('description', '') or ''}"
        for bm in extract_biomarkers(combined):
            by_label.setdefault(label, []).append(bm)

    # Pass 2: scan the trial summary for arm-specific biomarker mentions.
    if summary_text and arms:
        arm_token_map = {a.get("label", ""): _arm_tokens(a) for a in arms}
        chunks = _split_summary_chunks(summary_text)
        unassigned: list[list[BiomarkerMatch]] = []
        assigned_from_summary: set[str] = set()

        for chunk in chunks:
            chunk_bms = extract_biomarkers(chunk)
            if not chunk_bms:
                continue
            chunk_low = chunk.lower()
            scored = []
            for arm in arms:
                lbl = arm.get("label", "")
                toks = arm_token_map.get(lbl, set())
                score = sum(1 for t in toks if t in chunk_low)
                scored.append((score, lbl))
            scored.sort(reverse=True)
            top_score = scored[0][0] if scored else 0
            second = scored[1][0] if len(scored) > 1 else 0
            if top_score > 0 and top_score > second:
                lbl = scored[0][1]
                existing = {bm.marker for bm in by_label.get(lbl, [])}
                for bm in chunk_bms:
                    if bm.marker not in existing:
                        by_label.setdefault(lbl, []).append(bm)
                        existing.add(bm.marker)
                assigned_from_summary.add(lbl)
            else:
                unassigned.append(chunk_bms)

        # Pass 3: by-elimination — if exactly one arm has no summary-derived
        # biomarkers and exactly one chunk is unassigned, link them.
        remaining_arms = [
            a.get("label", "") for a in arms
            if a.get("label", "") not in assigned_from_summary
            and not by_label.get(a.get("label", ""))
        ]
        if len(unassigned) == 1 and len(remaining_arms) == 1:
            lbl = remaining_arms[0]
            existing = {bm.marker for bm in by_label.get(lbl, [])}
            for bm in unassigned[0]:
                if bm.marker not in existing:
                    by_label.setdefault(lbl, []).append(bm)
                    existing.add(bm.marker)

        # Pass 4: trial-wide propagation. Any biomarker found anywhere in the
        # summary whose category is inherently trial-wide (disease state) is
        # added to *every* arm. These criteria modify the patient population as
        # a whole rather than differentiating between arms.
        trial_wide = extract_biomarkers(summary_text)
        for bm in trial_wide:
            if bm.category != "disease_state":
                continue
            for arm in arms:
                lbl = arm.get("label", "")
                existing = {x.marker for x in by_label.get(lbl, [])}
                if bm.marker not in existing:
                    by_label.setdefault(lbl, []).append(bm)

    # Build results, preserving original arm order.
    results: list[ArmBiomarkerInfo] = []
    for arm in arms:
        label = arm.get("label", "")
        bms = by_label.get(label)
        if bms:
            results.append(ArmBiomarkerInfo(
                arm_label=label,
                arm_type=arm.get("type", ""),
                arm_description=arm.get("description", "") or "",
                biomarkers=bms,
            ))
    return results


def _is_treatment_history_mention(criteria_text: str, match_start: int) -> bool:
    """Return True if the biomarker match is in a treatment-history context.

    Phrases like "Prior exposure to EGFR inhibitors" or "Previous treatment
    with anti-EGFR therapy" describe treatment history, not molecular
    requirements.  We suppress these so they don't generate false
    biomarker matches.

    Only considers text within the *same line/sentence* as the match
    (up to 80 chars before) to avoid false positives from nearby but
    unrelated exclusion criteria.
    """
    # Look at the same line/sentence only (max ~80 chars before the match)
    window_start = max(0, match_start - 80)
    before_raw = criteria_text[window_start:match_start]
    # Limit to the same line: only take text after the last newline or bullet
    last_break = max(before_raw.rfind("\n"), before_raw.rfind("•"), before_raw.rfind("- "))
    if last_break >= 0:
        before_raw = before_raw[last_break + 1:]
    before = before_raw.lower().strip()

    treatment_patterns = [
        r"prior\s+(?:exposure|treatment|therapy|use|receipt)",
        r"previous(?:ly)?\s+(?:exposure|treatment|therapy|use|treated|received)",
        r"(?:received|treated\s+with|exposed\s+to)",
        r"history\s+of\s+(?:treatment|therapy)",
    ]
    for pat in treatment_patterns:
        if re.search(pat, before):
            return True
    return False


def extract_biomarkers(criteria_text: str, eligibility_end_offset: int | None = None) -> list[BiomarkerMatch]:
    """Extract all biomarker criteria from eligibility text.

    Args:
        criteria_text: Text to scan (may be eligibility + summary concatenated).
        eligibility_end_offset: If set, the character offset where formal
            eligibility criteria end and supplementary text (brief_summary,
            detailed_description) begins.  Matches found after this offset
            default to ``"inclusion"`` context regardless of section headers
            found in the eligibility portion.

    Returns a deduplicated list of BiomarkerMatch objects ordered by
    position in text. Attaches TCGA GBM prevalence data when available.
    """
    if not criteria_text:
        return []

    prevalence = _load_prevalence()
    matches: list[BiomarkerMatch] = []
    seen_markers: set[str] = set()
    # Track gene roots already matched to suppress catch-all patterns
    seen_gene_roots: set[str] = set()

    # Catch-all markers (less specific) that should be suppressed
    # when a more specific variant of the same gene was matched
    CATCH_ALL_MARKERS = {"MGMT mentioned", "EGFR alteration"}
    # When "MGMT status known" fires, suppress the less-specific "MGMT methylated"
    # (which can falsely match on "methylation status" / "methylation testing" text)
    MGMT_STATUS_SUPPRESSIBLE = {"MGMT methylated", "MGMT promoter methylated"}

    for canonical, category, pattern in BIOMARKER_PATTERNS:
        for m in re.finditer(pattern, criteria_text, re.IGNORECASE):
            # Deduplicate by canonical name
            if canonical in seen_markers:
                continue

            # Suppress catch-all if a specific variant already matched
            if canonical in CATCH_ALL_MARKERS:
                gene_root = canonical.split()[0]
                if gene_root in seen_gene_roots:
                    continue

            # Suppress generic "MGMT methylated" when "MGMT status known" already matched
            # (the word "methylation" appears in "methylation status" and "methylation testing")
            if canonical in MGMT_STATUS_SUPPRESSIBLE and "MGMT status known" in seen_markers:
                # Only suppress if the match is near a "status"/"testing" context
                match_context = criteria_text[max(0, m.start() - 20):min(len(criteria_text), m.end() + 40)].lower()
                if re.search(r"status|testing|test\b|result", match_context):
                    continue

            seen_markers.add(canonical)
            # Track the gene root for suppression
            gene_root = canonical.split()[0]
            seen_gene_roots.add(gene_root)

            raw_text = m.group(0)
            start = max(0, m.start() - 150)
            end = min(len(criteria_text), m.end() + 150)
            surrounding = criteria_text[start:end]

            # Skip treatment-history mentions (e.g. "Prior exposure to EGFR inhibitors")
            if _is_treatment_history_mention(criteria_text, m.start()):
                continue

            context = _determine_context(criteria_text[:m.start()], eligibility_end_offset, m.start())
            requirement = _determine_requirement(raw_text, surrounding)

            # Post-process MGMT catch-all: classify by surrounding context
            if canonical == "MGMT mentioned":
                canonical = _classify_mgmt_mention(surrounding)
                if canonical in seen_markers:
                    continue
                seen_markers.add(canonical)

            # Look up TCGA prevalence (with fallback for markers not in reference file)
            prev = prevalence.get(canonical) or _FALLBACK_PREVALENCE.get(canonical, {})

            matches.append(BiomarkerMatch(
                marker=canonical,
                category=category,
                raw_text=raw_text,
                context=context,
                requirement=requirement,
                tcga_count=prev.get("count"),
                tcga_total=prev.get("total"),
                tcga_percent=prev.get("percent"),
                tcga_note=prev.get("note"),
            ))

    # Sort by position in original text (re-scan for order)
    def sort_key(bm: BiomarkerMatch) -> int:
        m = re.search(re.escape(bm.raw_text), criteria_text, re.IGNORECASE)
        return m.start() if m else 0

    matches.sort(key=sort_key)
    return matches
