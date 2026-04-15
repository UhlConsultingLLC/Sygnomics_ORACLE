"""Summary metrics and aggregate statistics for clinical trial data."""

import pandas as pd
from sqlalchemy import func
from sqlalchemy.orm import Session

from analysis.models import (
    ConditionCount,
    MOADistribution,
    PhaseDistribution,
    StatusDistribution,
)
from database.models import (
    ConditionRecord,
    InterventionRecord,
    MOAAnnotationRecord,
    TrialRecord,
    trial_conditions,
    trial_interventions,
)


def trials_per_condition(session: Session, limit: int = 50) -> list[ConditionCount]:
    """Count trials per condition, sorted by frequency."""
    results = (
        session.query(
            ConditionRecord.name,
            func.count(trial_conditions.c.trial_nct_id).label("trial_count"),
        )
        .join(trial_conditions, ConditionRecord.id == trial_conditions.c.condition_id)
        .group_by(ConditionRecord.name)
        .order_by(func.count(trial_conditions.c.trial_nct_id).desc())
        .limit(limit)
        .all()
    )
    return [ConditionCount(condition=name, trial_count=count) for name, count in results]


def interventions_by_moa(session: Session) -> list[MOADistribution]:
    """Count interventions and trials per MOA category."""
    results = (
        session.query(
            MOAAnnotationRecord.moa_category,
            func.count(func.distinct(InterventionRecord.id)).label("intervention_count"),
            func.count(func.distinct(TrialRecord.nct_id)).label("trial_count"),
        )
        .join(InterventionRecord, MOAAnnotationRecord.intervention_id == InterventionRecord.id)
        .join(trial_interventions, InterventionRecord.id == trial_interventions.c.intervention_id)
        .join(TrialRecord, trial_interventions.c.trial_nct_id == TrialRecord.nct_id)
        .group_by(MOAAnnotationRecord.moa_category)
        .order_by(func.count(func.distinct(TrialRecord.nct_id)).desc())
        .all()
    )
    return [
        MOADistribution(
            moa_category=cat, intervention_count=iv_count, trial_count=t_count
        )
        for cat, iv_count, t_count in results
    ]


_PHASE_NORMALIZE = {
    "EARLY_PHASE1": "Early Phase 1", "EARLY PHASE 1": "Early Phase 1",
    "EARLYPHASE1": "Early Phase 1",
    "PHASE1": "Phase 1", "PHASE 1": "Phase 1", "1": "Phase 1",
    "PHASE2": "Phase 2", "PHASE 2": "Phase 2",
    "3": "Phase 2", "4": "Phase 2",
    "PHASE3": "Phase 3", "PHASE 3": "Phase 3",
    "5": "Phase 3", "6": "Phase 3",
    "PHASE4": "Phase 4", "PHASE 4": "Phase 4", "7": "Phase 4",
}
_PHASE_ORDER = ["Early Phase 1", "Phase 1", "Phase 2", "Phase 3", "Phase 4"]


def phase_distribution(session: Session) -> list[PhaseDistribution]:
    """Count trials per phase, normalized and filtered to standard phases."""
    results = (
        session.query(
            TrialRecord.phase,
            func.count(TrialRecord.nct_id).label("trial_count"),
        )
        .group_by(TrialRecord.phase)
        .all()
    )
    counts: dict[str, int] = {}
    for phase, count in results:
        if not phase:
            continue
        canonical = _PHASE_NORMALIZE.get(phase.strip().upper())
        if canonical:
            counts[canonical] = counts.get(canonical, 0) + count
    return [
        PhaseDistribution(phase=p, trial_count=counts[p])
        for p in _PHASE_ORDER if p in counts
    ]


def status_distribution(session: Session) -> list[StatusDistribution]:
    """Count trials per status."""
    results = (
        session.query(
            TrialRecord.status,
            func.count(TrialRecord.nct_id).label("trial_count"),
        )
        .group_by(TrialRecord.status)
        .order_by(func.count(TrialRecord.nct_id).desc())
        .all()
    )
    return [StatusDistribution(status=s or "Unknown", trial_count=c) for s, c in results]


def enrollment_summary(session: Session) -> dict:
    """Compute aggregate enrollment statistics."""
    result = session.query(
        func.count(TrialRecord.nct_id).label("total_trials"),
        func.sum(TrialRecord.enrollment_count).label("total_enrollment"),
        func.avg(TrialRecord.enrollment_count).label("mean_enrollment"),
        func.min(TrialRecord.enrollment_count).label("min_enrollment"),
        func.max(TrialRecord.enrollment_count).label("max_enrollment"),
    ).first()

    return {
        "total_trials": result.total_trials or 0,
        "total_enrollment": result.total_enrollment or 0,
        "mean_enrollment": round(result.mean_enrollment, 1) if result.mean_enrollment else 0,
        "min_enrollment": result.min_enrollment or 0,
        "max_enrollment": result.max_enrollment or 0,
    }


def metrics_to_dataframe(metrics: list) -> pd.DataFrame:
    """Convert a list of Pydantic metric models to a pandas DataFrame."""
    return pd.DataFrame([m.model_dump() for m in metrics])
