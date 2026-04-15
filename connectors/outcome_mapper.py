"""Outcome measure keyword expansion.

Accepts user input (e.g., "response rate", "PFS", "survival") and returns a
comprehensive list of related outcome measure terms so that filtering catches
all plausible variations reported across clinical trials.

Uses a curated synonym dictionary for common clinical endpoints plus optional
MeSH API expansion for broader ontological coverage.
"""

import logging
from typing import Optional

from config.schema import MeSHConfig
from connectors.mesh_client import MeSHClient

logger = logging.getLogger(__name__)

# ---- Curated outcome synonym groups ----
# Each key is a canonical short-form; its value is the full set of terms that
# should all be searched when a user enters any one of them.
OUTCOME_SYNONYMS: dict[str, list[str]] = {
    # --- Survival endpoints ---
    "os": [
        "overall survival",
        "OS",
        "median overall survival",
        "overall survival rate",
        "survival time",
        "time to death",
        "median survival",
        "survival duration",
    ],
    "pfs": [
        "progression-free survival",
        "progression free survival",
        "PFS",
        "median PFS",
        "median progression-free survival",
        "time to progression",
        "TTP",
        "time to disease progression",
    ],
    "dfs": [
        "disease-free survival",
        "disease free survival",
        "DFS",
        "relapse-free survival",
        "relapse free survival",
        "RFS",
        "recurrence-free survival",
        "recurrence free survival",
    ],
    "efs": [
        "event-free survival",
        "event free survival",
        "EFS",
    ],

    # --- Response endpoints ---
    "response rate": [
        "response rate",
        "objective response rate",
        "ORR",
        "overall response rate",
        "tumor response",
        "tumour response",
        "tumor response rate",
        "tumour response rate",
        "best overall response",
        "BOR",
        "clinical response",
        "clinical response rate",
        "radiographic response",
        "radiologic response",
    ],
    "complete response": [
        "complete response",
        "complete response rate",
        "CR",
        "complete remission",
        "complete remission rate",
        "pathological complete response",
        "pathologic complete response",
        "pCR",
    ],
    "partial response": [
        "partial response",
        "partial response rate",
        "PR",
        "partial remission",
    ],
    "disease control": [
        "disease control rate",
        "DCR",
        "disease control",
        "clinical benefit rate",
        "CBR",
        "clinical benefit",
        "stable disease",
        "SD",
    ],

    # --- Time-to-event endpoints ---
    "dor": [
        "duration of response",
        "DOR",
        "response duration",
        "median duration of response",
    ],
    "ttp": [
        "time to progression",
        "TTP",
        "time to disease progression",
        "time to treatment failure",
        "TTF",
    ],
    "ttf": [
        "time to treatment failure",
        "TTF",
        "time to treatment discontinuation",
    ],
    "ttr": [
        "time to response",
        "TTR",
        "time to first response",
    ],

    # --- Toxicity/safety endpoints ---
    "adverse events": [
        "adverse events",
        "adverse event",
        "AE",
        "AEs",
        "treatment-related adverse events",
        "treatment-emergent adverse events",
        "TEAE",
        "TEAEs",
        "toxicity",
        "toxicities",
        "dose-limiting toxicity",
        "DLT",
        "dose limiting toxicity",
        "side effects",
        "safety",
        "tolerability",
    ],
    "sae": [
        "serious adverse events",
        "serious adverse event",
        "SAE",
        "SAEs",
        "grade 3 or higher adverse events",
        "grade 3+ adverse events",
        "grade 3-4 adverse events",
        "grade 3-5 adverse events",
    ],

    # --- Quality of life ---
    "qol": [
        "quality of life",
        "QoL",
        "health-related quality of life",
        "HRQoL",
        "patient-reported outcomes",
        "PRO",
        "EORTC QLQ-C30",
        "FACT",
        "functional assessment",
        "EQ-5D",
    ],

    # --- Pharmacokinetics ---
    "pk": [
        "pharmacokinetics",
        "PK",
        "pharmacokinetic",
        "Cmax",
        "AUC",
        "half-life",
        "bioavailability",
        "clearance",
        "Tmax",
        "drug concentration",
        "plasma concentration",
        "serum concentration",
    ],

    # --- Tumor measurement endpoints ---
    "tumor size": [
        "tumor size",
        "tumour size",
        "tumor volume",
        "tumour volume",
        "tumor shrinkage",
        "tumour shrinkage",
        "tumor reduction",
        "change in tumor size",
        "change in tumour size",
        "RECIST",
        "target lesion",
    ],

    # --- Biomarker endpoints ---
    "biomarker": [
        "biomarker",
        "biomarker response",
        "PSA",
        "PSA response",
        "CA-125",
        "CA 125",
        "tumor marker",
        "tumour marker",
        "serum marker",
        "circulating tumor DNA",
        "ctDNA",
    ],

    # --- Dose-finding endpoints ---
    "mtd": [
        "maximum tolerated dose",
        "MTD",
        "recommended phase 2 dose",
        "RP2D",
        "dose escalation",
        "dose finding",
    ],
}

# Build a reverse index: lowercase term -> canonical group key
_REVERSE_INDEX: dict[str, str] = {}
for _key, _terms in OUTCOME_SYNONYMS.items():
    for _term in _terms:
        _REVERSE_INDEX[_term.lower()] = _key
    _REVERSE_INDEX[_key.lower()] = _key


class OutcomeMapper:
    """Maps user outcome keyword input to expanded search terms."""

    def __init__(self, mesh_config: Optional[MeSHConfig] = None):
        self.mesh_client = MeSHClient(mesh_config)

    async def expand(self, user_input: str) -> list[str]:
        """Expand an outcome keyword into related outcome measure terms.

        Combines curated synonym lookup with optional MeSH API expansion.

        Args:
            user_input: Outcome term or abbreviation (e.g., "PFS", "response rate").

        Returns:
            Sorted, deduplicated list of related outcome measure terms.
        """
        terms: set[str] = {user_input}
        normalized = user_input.strip().lower()

        # 1. Check reverse index for exact match to any known synonym
        if normalized in _REVERSE_INDEX:
            group_key = _REVERSE_INDEX[normalized]
            terms.update(OUTCOME_SYNONYMS[group_key])

        # 2. Fuzzy substring matching (only for inputs longer than 3 chars
        #    to avoid short abbreviations like "OS" matching "dose", "toxicities", etc.)
        if len(normalized) > 3:
            for key, synonyms in OUTCOME_SYNONYMS.items():
                for syn in synonyms:
                    if normalized in syn.lower() or syn.lower() in normalized:
                        terms.update(synonyms)
                        break

        # 3. Try MeSH API for ontological expansion (gracefully degrade)
        try:
            mesh_terms = await self.mesh_client.expand_disease_term(user_input)
            # Filter MeSH results to keep only those that look like endpoints
            for mt in mesh_terms:
                mt_lower = mt.lower()
                # Keep terms that contain endpoint-ish words
                if any(kw in mt_lower for kw in (
                    "survival", "response", "mortality", "remission",
                    "progression", "recurrence", "toxicity", "adverse",
                    "endpoint", "outcome", "efficacy", "safety",
                )):
                    terms.add(mt)
        except Exception:
            pass  # MeSH API may be unavailable; proceed with synonyms

        return sorted(terms, key=str.lower)

    def expand_sync(self, user_input: str) -> list[str]:
        """Synchronous wrapper for expand()."""
        import asyncio

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(
                    asyncio.run, self.expand(user_input)
                ).result()
        else:
            return asyncio.run(self.expand(user_input))
