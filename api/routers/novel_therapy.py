"""Novel Therapy Simulation endpoint.

Given a set of gene targets, a disease/condition, planned trial size, and
optional recruitment criteria, this endpoint estimates the expected
response rate for a proposed new drug by pooling evidence from historical
clinical trials using drugs that hit the same target set, and surfaces
the most similar trials along with supporting PubMed literature.
"""

from __future__ import annotations

import logging
import math
from typing import Optional

import httpx
import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from api.dependencies import get_db
from database.models import (
    ConditionRecord,
    InterventionRecord,
    MOAAnnotationRecord,
    TrialRecord,
    trial_conditions,
    trial_interventions,
)

from analysis.filters import canonicalize_phase, CANONICAL_PHASES


def _display_phase_norm(raw):
    canon = canonicalize_phase(raw)
    if not canon:
        return "NA"
    return "/".join(p for p in CANONICAL_PHASES if p in canon)


router = APIRouter(prefix="/novel-therapy", tags=["novel-therapy"])
logger = logging.getLogger(__name__)


# ── Schemas ───────────────────────────────────────────────────────────────


class NovelTherapyRequest(BaseModel):
    gene_targets: list[str] = Field(..., min_length=1, description="Gene symbols (e.g. ['EGFR', 'VEGFR2'])")
    condition: str = Field(..., description="Disease or condition name (e.g. 'glioblastoma')")
    disease_stage: Optional[str] = Field(None, description="Optional stage/phase descriptor (e.g. 'recurrent', 'newly diagnosed')")
    trial_size: int = Field(..., ge=1, description="Planned number of patients")
    recruitment_criteria: Optional[str] = Field(None, description="Free-text recruitment criteria")


class SimilarTrialItem(BaseModel):
    nct_id: str
    title: str
    phase: Optional[str] = None
    status: Optional[str] = None
    enrollment: Optional[int] = None
    interventions: list[str] = []
    matched_drugs: list[str] = []
    matched_targets: list[str] = []
    conditions: list[str] = []
    eligibility_excerpt: Optional[str] = None
    response_rate: Optional[float] = None
    similarity_score: float
    results_url: Optional[str] = None


class LiteratureItem(BaseModel):
    pmid: str
    title: str
    journal: Optional[str] = None
    year: Optional[str] = None
    url: str


class NovelTherapyResponse(BaseModel):
    predicted_response_rate: float
    ci_low: float
    ci_high: float
    n_supporting_trials: int
    matched_drugs: list[str]
    basis: str
    similar_trials: list[SimilarTrialItem]
    literature: list[LiteratureItem]
    warnings: list[str] = []


# ── Helpers ───────────────────────────────────────────────────────────────


def _find_drugs_for_targets(db: Session, genes: list[str]) -> dict[str, set[str]]:
    """Return {drug_name (upper): {gene_symbol, ...}} for any drugs in the DB
    whose MOA annotations list at least one of the input genes as a target."""
    g_upper = [g.strip().upper() for g in genes if g.strip()]
    if not g_upper:
        return {}
    rows = (
        db.query(InterventionRecord.name, MOAAnnotationRecord.target_gene_symbol)
        .join(MOAAnnotationRecord, MOAAnnotationRecord.intervention_id == InterventionRecord.id)
        .filter(func.upper(MOAAnnotationRecord.target_gene_symbol).in_(g_upper))
        .all()
    )
    drugs: dict[str, set[str]] = {}
    for name, gene in rows:
        if not name:
            continue
        drugs.setdefault(name.upper(), set()).add(gene.upper())
    return drugs


def _find_trials_for_condition(db: Session, condition: str) -> tuple[set[str], list[str]]:
    """Return (NCT ids, expanded_terms) for trials whose condition list matches
    the input term or any of its MeSH-expanded synonyms (case-insensitive)."""
    raw = condition.strip()
    if not raw:
        return set(), []
    try:
        from api.mesh_expansion import expand_condition
        expanded = list(expand_condition(raw)) or [raw]
    except Exception:
        expanded = [raw]
    # Dedupe case-insensitive
    seen: set[str] = set()
    terms = [t for t in expanded if not (t.lower() in seen or seen.add(t.lower()))]
    from sqlalchemy import or_
    filters = [func.lower(ConditionRecord.name).like(f"%{t.lower()}%") for t in terms]
    rows = (
        db.query(TrialRecord.nct_id)
        .join(trial_conditions, trial_conditions.c.trial_nct_id == TrialRecord.nct_id)
        .join(ConditionRecord, ConditionRecord.id == trial_conditions.c.condition_id)
        .filter(or_(*filters))
        .distinct()
        .all()
    )
    return {r[0] for r in rows}, terms


def _expand_terms(term: str) -> list[str]:
    """Expand a free-text term via MeSH (disease vocabulary). Always includes
    the original term as the first entry. Returns [] for empty input."""
    raw = (term or "").strip()
    if not raw:
        return []
    try:
        from api.mesh_expansion import expand_condition
        expanded = list(expand_condition(raw)) or [raw]
    except Exception:
        expanded = [raw]
    seen: set[str] = set()
    return [t for t in ([raw, *expanded]) if not (t.lower() in seen or seen.add(t.lower()))]


def _fetch_pubmed(gene_targets: list[str], conditions: list[str], max_results: int = 5) -> list[LiteratureItem]:
    """Query NCBI PubMed E-utilities (no auth required) for recent articles
    matching the targets and any of the (MeSH-expanded) condition synonyms."""
    try:
        terms = [f"{g}[Title/Abstract]" for g in gene_targets[:3]]
        cond_clause = " OR ".join(f"{c}[Title/Abstract]" for c in (conditions or [])[:6]) or "cancer[Title/Abstract]"
        query = f"({' OR '.join(terms)}) AND ({cond_clause}) AND (clinical trial[pt])"
        esearch = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
        esummary = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"
        with httpx.Client(timeout=10.0) as client:
            r = client.get(esearch, params={"db": "pubmed", "term": query, "retmax": max_results, "retmode": "json", "sort": "date"})
            r.raise_for_status()
            ids = r.json().get("esearchresult", {}).get("idlist", [])
            if not ids:
                return []
            r2 = client.get(esummary, params={"db": "pubmed", "id": ",".join(ids), "retmode": "json"})
            r2.raise_for_status()
            result = r2.json().get("result", {})
        items: list[LiteratureItem] = []
        for pmid in ids:
            rec = result.get(pmid) or {}
            items.append(LiteratureItem(
                pmid=pmid,
                title=rec.get("title") or "(no title)",
                journal=rec.get("fulljournalname") or rec.get("source"),
                year=(rec.get("pubdate") or "").split(" ")[0] if rec.get("pubdate") else None,
                url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
            ))
        return items
    except Exception as e:
        logger.info("PubMed fetch failed: %s", e)
        return []


def _wilson_ci(p: float, n: int, z: float = 1.96) -> tuple[float, float]:
    if n <= 0:
        return (0.0, 0.0)
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    margin = (z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denom
    return (max(0.0, centre - margin), min(1.0, centre + margin))


# ── Endpoint ──────────────────────────────────────────────────────────────


@router.post("/simulate", response_model=NovelTherapyResponse)
def simulate_novel_therapy(req: NovelTherapyRequest, db: Session = Depends(get_db)):
    warnings: list[str] = []

    # Step 1: gene targets → known drugs
    drug_targets = _find_drugs_for_targets(db, req.gene_targets)
    if not drug_targets:
        warnings.append(
            f"No drugs in the local database target any of: {', '.join(req.gene_targets)}. "
            "Prediction falls back to condition-level priors."
        )

    # Step 2: candidate trials — those that use one of those drugs via the
    # trial_interventions join. Keep track of which drug matched per trial.
    trial_drug_map: dict[str, set[str]] = {}
    if drug_targets:
        drug_names_upper = list(drug_targets.keys())
        rows = (
            db.query(TrialRecord.nct_id, InterventionRecord.name)
            .join(trial_interventions, trial_interventions.c.trial_nct_id == TrialRecord.nct_id)
            .join(InterventionRecord, InterventionRecord.id == trial_interventions.c.intervention_id)
            .filter(func.upper(InterventionRecord.name).in_(drug_names_upper))
            .all()
        )
        for nct, drug in rows:
            trial_drug_map.setdefault(nct, set()).add((drug or "").upper())

    # Step 3: condition filter (with MeSH synonym expansion)
    cond_nct_ids, expanded_terms = _find_trials_for_condition(db, req.condition)
    if len(expanded_terms) > 1:
        warnings.append(
            f"Condition matched via MeSH: {', '.join(expanded_terms)}"
        )
    if not cond_nct_ids:
        warnings.append(f"No trials found in DB matching condition '{req.condition}'.")

    # Intersect drug-matched + condition-matched. If drug set is empty,
    # fall back to the condition cohort alone.
    if trial_drug_map:
        candidate_nct_ids = set(trial_drug_map.keys()) & cond_nct_ids if cond_nct_ids else set(trial_drug_map.keys())
    else:
        candidate_nct_ids = cond_nct_ids

    # Step 4: load trial records and compute response rates. Reuse the
    # cached MOA simulation engine to populate TrialInfo objects (which
    # contains RR extraction from outcome rows).
    from api.routers.simulation import _get_cached_engine
    engine = _get_cached_engine()

    # Query TrialInfo for each matched drug once, dedupe by nct_id. This
    # gives us extractable response-rate data for the prediction step,
    # but it is NOT the gate for the similar-trials surface — any trial
    # that matched the drug+condition criteria should appear, even if it
    # has no extractable RR.
    trial_info_map: dict[str, any] = {}
    if drug_targets:
        try:
            infos = engine.find_trials_with_response_rates(list(drug_targets.keys()), db)
            for info in infos:
                if info.nct_id in candidate_nct_ids or not cond_nct_ids:
                    trial_info_map.setdefault(info.nct_id, info)
        except Exception as e:
            logger.warning("Engine RR extraction failed: %s", e)

    # Always include every drug+condition match in the similar-trials list,
    # regardless of whether RR extraction succeeded for it. RR-bearing trials
    # contribute to the prediction step further down; the rest still inform
    # similarity ranking.
    candidates = list(candidate_nct_ids)[:200]
    trial_records = {
        t.nct_id: t for t in
        db.query(TrialRecord).filter(TrialRecord.nct_id.in_(candidates)).all()
    }

    # Step 4b: MeSH-expand the disease stage and recruitment criteria so
    # that synonyms (e.g. "recurrent" ↔ "relapsed") match eligibility text.
    stage_terms = [t.lower() for t in _expand_terms(req.disease_stage or "")]
    if req.disease_stage and len(stage_terms) > 1:
        warnings.append(
            f"Disease stage matched via MeSH: {', '.join(stage_terms)}"
        )

    recruit_groups: list[list[str]] = []
    if req.recruitment_criteria:
        raw_tokens = [
            tok.strip() for tok in req.recruitment_criteria.replace(";", ",").split(",")
            if tok.strip()
        ]
        for tok in raw_tokens:
            expanded_tok = [t.lower() for t in _expand_terms(tok)]
            if expanded_tok:
                recruit_groups.append(expanded_tok)
        all_recruit_syns = sorted({s for grp in recruit_groups for s in grp})
        if all_recruit_syns and len(all_recruit_syns) > len(raw_tokens):
            warnings.append(
                f"Recruitment criteria matched via MeSH: {', '.join(all_recruit_syns)}"
            )

    # Step 5: build similarity score and prediction inputs
    items: list[SimilarTrialItem] = []
    rr_values: list[float] = []

    for nct_id, trec in trial_records.items():
        info = trial_info_map.get(nct_id)
        drug_matches = trial_drug_map.get(nct_id, set())
        matched_targets: set[str] = set()
        for d in drug_matches:
            matched_targets.update(drug_targets.get(d, set()))

        elig_text = (trec.eligibility.criteria_text if trec.eligibility else "") or ""
        elig_lower = elig_text.lower()

        # Similarity score components:
        #   target overlap (0.5)  + condition match (0.25)
        # + stage match  (0.10)  + recruitment criteria match (0.15)
        target_overlap = len(matched_targets) / max(1, len(req.gene_targets))
        cond_score = 1.0 if nct_id in cond_nct_ids else 0.0
        stage_score = 1.0 if (stage_terms and any(s in elig_lower for s in stage_terms)) else 0.0
        if recruit_groups:
            matched_groups = sum(
                1 for grp in recruit_groups if any(s in elig_lower for s in grp)
            )
            recruit_score = matched_groups / len(recruit_groups)
        else:
            recruit_score = 0.0
        similarity = (
            0.50 * target_overlap
            + 0.25 * cond_score
            + 0.10 * stage_score
            + 0.15 * recruit_score
        )

        rr = info.response_rate if info else None
        if rr is not None and 0 <= rr <= 1:
            rr_values.append(rr)

        conds = [c.name for c in (trec.conditions or [])][:5]
        interv_names = [iv.name for iv in (trec.interventions or [])][:6]

        items.append(SimilarTrialItem(
            nct_id=nct_id,
            title=trec.title or "",
            phase=_display_phase_norm(trec.phase),
            status=trec.status,
            enrollment=trec.enrollment_count,
            interventions=interv_names,
            matched_drugs=sorted(drug_matches),
            matched_targets=sorted(matched_targets),
            conditions=conds,
            eligibility_excerpt=(elig_text[:400] + "…") if len(elig_text) > 400 else (elig_text or None),
            response_rate=rr,
            similarity_score=round(similarity, 3),
            results_url=trec.results_url,
        ))

    items.sort(key=lambda x: (-x.similarity_score, -(x.response_rate or 0)))
    items = items[:25]

    # Step 6: predicted response rate (median of supporting trials, Wilson CI)
    if rr_values:
        predicted = float(np.median(rr_values))
        lo, hi = _wilson_ci(predicted, min(req.trial_size, max(len(rr_values) * 20, req.trial_size)))
        basis = (
            f"Median response rate across {len(rr_values)} historical trials using drugs that "
            f"target {', '.join(sorted({t for it in items for t in it.matched_targets}))}. "
            f"Wilson score interval at planned trial size n={req.trial_size}."
        )
    else:
        # Condition-only fallback: no RR support
        predicted = 0.15
        lo, hi = _wilson_ci(predicted, req.trial_size)
        basis = (
            "No historical response-rate data found for drugs matching these gene targets "
            f"and condition. Showing a neutral 15% prior with a Wilson interval at n={req.trial_size}."
        )
        warnings.append("Prediction is a weak prior — no drug-target-matched RR data available.")

    # Step 7: literature — feed PubMed the MeSH-expanded condition list so
    # synonyms (e.g. GBM ↔ Glioblastoma) all surface.
    literature = _fetch_pubmed(req.gene_targets, expanded_terms or [req.condition])

    return NovelTherapyResponse(
        predicted_response_rate=round(predicted, 4),
        ci_low=round(lo, 4),
        ci_high=round(hi, 4),
        n_supporting_trials=len(rr_values),
        matched_drugs=sorted(drug_targets.keys()),
        basis=basis,
        similar_trials=items,
        literature=literature,
        warnings=warnings,
    )
