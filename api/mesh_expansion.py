"""In-memory cached MeSH expansion for user-entered query terms.

Provides synonym expansion for conditions and interventions so that manual
inputs transparently match semantically equivalent terms in the database.
"""

from __future__ import annotations

import logging
from functools import lru_cache

from connectors.disease_mapper import DiseaseMapper

logger = logging.getLogger(__name__)

# Known intervention/drug aliases that MeSH may not resolve consistently.
KNOWN_INTERVENTION_SYNONYMS: dict[str, list[str]] = {
    "tmz": ["temozolomide", "temodar", "temodal"],
    "temozolomide": ["temozolomide", "temodar", "temodal", "TMZ"],
    "bcnu": ["carmustine", "BiCNU", "BCNU"],
    "ccnu": ["lomustine", "CeeNU", "CCNU"],
    "bev": ["bevacizumab", "avastin"],
    "bevacizumab": ["bevacizumab", "avastin"],
    "pembro": ["pembrolizumab", "keytruda"],
    "nivo": ["nivolumab", "opdivo"],
    "ttfields": ["tumor treating fields", "optune", "NovoTTF"],
}


def _normalize_terms(terms: list[str]) -> list[str]:
    """Dedupe terms case-insensitively while preserving first casing."""
    seen: dict[str, str] = {}
    for t in terms:
        key = t.strip().lower()
        if key and key not in seen:
            seen[key] = t.strip()
    return list(seen.values())


@lru_cache(maxsize=512)
def expand_condition(term: str) -> tuple[str, ...]:
    """Expand a condition/disease term via MeSH + known synonyms (cached)."""
    if not term or not term.strip():
        return tuple()
    try:
        mapper = DiseaseMapper()
        expanded = mapper.expand_sync(term)
    except Exception as exc:  # MeSH unreachable, fall back to input
        logger.warning("Condition expansion failed for %r: %s", term, exc)
        expanded = [term]
    return tuple(_normalize_terms(expanded))


@lru_cache(maxsize=512)
def _chembl_synonyms(term: str) -> tuple[str, ...]:
    """Query the ChEMBL REST API for a drug's synonym list (cached).

    Returns the union of pref_name and molecule_synonyms across the top
    matches. Empty tuple on any error so callers can fall back gracefully.
    """
    import json
    import urllib.parse
    import urllib.request

    try:
        url = (
            "https://www.ebi.ac.uk/chembl/api/data/molecule/search.json?"
            + urllib.parse.urlencode({"q": term, "limit": 5})
        )
        req = urllib.request.Request(url, headers={
            "Accept": "application/json",
            "User-Agent": "CT-Pipeline/0.1.0",
        })
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        logger.info("ChEMBL synonym lookup failed for %r: %s", term, exc)
        return tuple()

    import re
    def _slug(s: str) -> str:
        return re.sub(r"[^a-z0-9]+", "", s.lower())

    out: set[str] = set()
    norm = _slug(term)
    for mol in (data.get("molecules") or [])[:5]:
        pref = (mol.get("pref_name") or "").strip()
        syns_raw = mol.get("molecule_synonyms") or []
        syn_names = [
            (s.get("molecule_synonym") or s.get("synonyms") or "").strip()
            for s in syns_raw if isinstance(s, dict)
        ]
        # Only accept this molecule if the user's term actually appears in its
        # name set (alphanumeric-insensitive) — guards against unrelated
        # fuzzy hits from molecule/search while still catching "XL184" ↔
        # "XL-184 FREE BASE".
        all_slugs = {_slug(pref), *(_slug(s) for s in syn_names)}
        if not any(norm and (norm == n or norm in n or n in norm) for n in all_slugs if n):
            continue
        if pref:
            out.add(pref)
        out.update(s for s in syn_names if s)
    return tuple(sorted(out, key=str.lower))


@lru_cache(maxsize=512)
def expand_intervention(term: str) -> tuple[str, ...]:
    """Expand an intervention/drug term via known aliases + ChEMBL synonyms.

    Combines (1) a hardcoded alias table for common shorthand, and
    (2) live ChEMBL REST lookup for brand/generic/code synonyms
    (e.g. "XL184" → "Cabozantinib", "Cometriq", "BMS-907351"). Cached.
    """
    if not term or not term.strip():
        return tuple()
    terms = {term.strip()}
    normalized = term.strip().lower()

    if normalized in KNOWN_INTERVENTION_SYNONYMS:
        terms.update(KNOWN_INTERVENTION_SYNONYMS[normalized])
    for key, syns in KNOWN_INTERVENTION_SYNONYMS.items():
        if normalized == key or normalized in (s.lower() for s in syns):
            terms.add(key)
            terms.update(syns)

    # ChEMBL-grounded synonyms (live REST, cached). Best source for
    # brand/generic/research-code aliases of small molecules and biologics.
    terms.update(_chembl_synonyms(term))

    return tuple(_normalize_terms(sorted(terms, key=str.lower)))


@lru_cache(maxsize=512)
def expand_outcome(term: str) -> tuple[str, ...]:
    """Expand an outcome-measure term via the OutcomeMapper (cached)."""
    if not term or not term.strip():
        return tuple()
    try:
        from connectors.outcome_mapper import OutcomeMapper
        expanded = OutcomeMapper().expand_sync(term)
    except Exception as exc:
        logger.warning("Outcome expansion failed for %r: %s", term, exc)
        expanded = [term]
    return tuple(_normalize_terms(expanded))
