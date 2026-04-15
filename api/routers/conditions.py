"""Condition endpoints: suggest related conditions, list all."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from api.dependencies import get_db
from api.schemas import ConditionSuggestion, DiseaseSearchRequest
from connectors.disease_mapper import DiseaseMapper
from database.models import ConditionRecord, trial_conditions

router = APIRouter(prefix="/conditions", tags=["conditions"])


class ConditionWithCount(BaseModel):
    name: str
    trial_count: int


@router.post("/suggest", response_model=ConditionSuggestion)
def suggest_conditions(req: DiseaseSearchRequest):
    """Expand a disease name to related conditions using MeSH."""
    mapper = DiseaseMapper()
    terms = mapper.expand_sync(req.disease)
    return ConditionSuggestion(original=req.disease, expanded_terms=terms)


class TermTrialCount(BaseModel):
    term: str
    trial_count: int


class ExpandedTrialCounts(BaseModel):
    original: str
    per_term: list[TermTrialCount]
    unique_total: int


@router.post("/expand-counts", response_model=ExpandedTrialCounts)
def expand_with_counts(req: DiseaseSearchRequest, db: Session = Depends(get_db)):
    """Expand a disease term via MeSH and return the number of trials in
    the database matching the original term and each expanded term, plus
    the de-duplicated union count across all terms.

    Matching is case-insensitive substring against ConditionRecord.name.
    """
    mapper = DiseaseMapper()
    expanded = mapper.expand_sync(req.disease)
    # Always include the original first, dedup while preserving order
    seen: set[str] = set()
    ordered: list[str] = []
    for t in [req.disease, *expanded]:
        key = t.strip().lower()
        if key and key not in seen:
            seen.add(key)
            ordered.append(t.strip())

    per_term: list[TermTrialCount] = []
    union_ids: set[str] = set()
    for term in ordered:
        sub = (
            db.query(trial_conditions.c.trial_nct_id)
            .join(ConditionRecord, ConditionRecord.id == trial_conditions.c.condition_id)
            .filter(ConditionRecord.name.ilike(f"%{term}%"))
            .distinct()
        )
        ids = {row[0] for row in sub.all()}
        per_term.append(TermTrialCount(term=term, trial_count=len(ids)))
        union_ids.update(ids)

    return ExpandedTrialCounts(
        original=req.disease,
        per_term=per_term,
        unique_total=len(union_ids),
    )


@router.get("", response_model=list[ConditionWithCount])
def list_conditions(db: Session = Depends(get_db)):
    """List all conditions with trial counts."""
    results = (
        db.query(
            ConditionRecord.name,
            func.count(trial_conditions.c.trial_nct_id).label("trial_count"),
        )
        .outerjoin(trial_conditions, ConditionRecord.id == trial_conditions.c.condition_id)
        .group_by(ConditionRecord.name)
        .order_by(func.count(trial_conditions.c.trial_nct_id).desc())
        .all()
    )
    return [ConditionWithCount(name=name, trial_count=count) for name, count in results]
