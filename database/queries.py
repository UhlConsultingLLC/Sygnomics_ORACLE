"""Query functions for retrieving trial data from the database.

All functions return Pydantic models, not ORM objects, at the boundary.
"""

from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from connectors.models.trial import (
    EligibilityCriteria,
    Intervention,
    Location,
    Outcome,
    OutcomeResult,
    Sponsor,
    StudyArm,
    Trial,
)
from database.models import (
    ArmRecord,
    ConditionRecord,
    EligibilityRecord,
    InterventionRecord,
    LocationRecord,
    MOAAnnotationRecord,
    OutcomeRecord,
    SponsorRecord,
    TrialRecord,
)


def _parse_results_json(results_json: str) -> list[OutcomeResult]:
    """Parse JSON-encoded outcome results back into OutcomeResult objects."""
    import json
    try:
        data = json.loads(results_json)
        return [OutcomeResult(**r) for r in data]
    except (json.JSONDecodeError, TypeError):
        return []


def _trial_record_to_pydantic(record: TrialRecord) -> Trial:
    """Convert a SQLAlchemy TrialRecord to a Pydantic Trial model."""
    return Trial(
        nct_id=record.nct_id,
        title=record.title,
        brief_summary=record.brief_summary,
        detailed_description=record.detailed_description,
        status=record.status,
        phase=record.phase,
        study_type=record.study_type,
        enrollment_count=record.enrollment_count,
        start_date=record.start_date,
        completion_date=record.completion_date,
        results_url=record.results_url,
        conditions=[c.name for c in record.conditions],
        interventions=[
            Intervention(
                name=iv.name,
                type=iv.intervention_type,
                description=iv.description,
                chembl_id=iv.chembl_id,
            )
            for iv in record.interventions
        ],
        outcomes=[
            Outcome(
                type=oc.type,
                measure=oc.measure,
                description=oc.description,
                time_frame=oc.time_frame,
                results=_parse_results_json(oc.results_json) if hasattr(oc, 'results_json') and oc.results_json else [],
            )
            for oc in record.outcomes
        ],
        arms=[
            StudyArm(
                label=arm.label,
                type=arm.type,
                description=arm.description,
            )
            for arm in record.arms
        ],
        eligibility=EligibilityCriteria(
            criteria_text=record.eligibility.criteria_text,
            min_age=record.eligibility.min_age,
            max_age=record.eligibility.max_age,
            sex=record.eligibility.sex,
            healthy_volunteers=record.eligibility.healthy_volunteers,
        ) if record.eligibility else None,
        sponsor=Sponsor(
            name=record.sponsor.name,
            type=record.sponsor.type,
        ) if record.sponsor else None,
        locations=[
            Location(
                facility=loc.facility,
                city=loc.city,
                state=loc.state,
                country=loc.country,
                zip_code=loc.zip_code,
            )
            for loc in record.locations
        ],
    )


def get_trial(session: Session, nct_id: str) -> Optional[Trial]:
    """Get a single trial by NCT ID."""
    record = session.get(TrialRecord, nct_id)
    if record is None:
        return None
    return _trial_record_to_pydantic(record)


def get_all_trials(session: Session) -> list[Trial]:
    """Get all trials from the database."""
    records = session.query(TrialRecord).all()
    return [_trial_record_to_pydantic(r) for r in records]


def get_trials_by_condition(session: Session, condition: str) -> list[Trial]:
    """Get trials matching a specific condition name."""
    records = (
        session.query(TrialRecord)
        .join(TrialRecord.conditions)
        .filter(ConditionRecord.name.ilike(f"%{condition}%"))
        .all()
    )
    return [_trial_record_to_pydantic(r) for r in records]


def get_trials_by_intervention(session: Session, intervention_name: str) -> list[Trial]:
    """Get trials containing a specific intervention."""
    records = (
        session.query(TrialRecord)
        .join(TrialRecord.interventions)
        .filter(InterventionRecord.name.ilike(f"%{intervention_name}%"))
        .all()
    )
    return [_trial_record_to_pydantic(r) for r in records]


def get_trials_by_status(session: Session, status: str) -> list[Trial]:
    """Get trials with a specific status."""
    records = (
        session.query(TrialRecord)
        .filter(TrialRecord.status == status)
        .all()
    )
    return [_trial_record_to_pydantic(r) for r in records]


def get_trials_by_phase(session: Session, phase: str) -> list[Trial]:
    """Get trials in a specific phase."""
    records = (
        session.query(TrialRecord)
        .filter(TrialRecord.phase.ilike(f"%{phase}%"))
        .all()
    )
    return [_trial_record_to_pydantic(r) for r in records]


def get_all_conditions(session: Session) -> list[str]:
    """Get all unique condition names."""
    return [
        name for (name,) in session.query(ConditionRecord.name).order_by(ConditionRecord.name).all()
    ]


def get_all_interventions(session: Session) -> list[dict]:
    """Get all unique interventions with their types."""
    records = session.query(InterventionRecord).order_by(InterventionRecord.name).all()
    return [
        {"id": r.id, "name": r.name, "type": r.intervention_type, "chembl_id": r.chembl_id}
        for r in records
    ]


def get_all_sponsors(session: Session) -> list[str]:
    """Get all unique sponsor names."""
    return [
        name for (name,) in session.query(SponsorRecord.name).order_by(SponsorRecord.name).all()
    ]


def get_trial_count(session: Session) -> int:
    """Get total number of trials in the database."""
    return session.query(func.count(TrialRecord.nct_id)).scalar() or 0


def get_moa_annotations_for_intervention(
    session: Session, intervention_id: int
) -> list[dict]:
    """Get MOA annotations for a specific intervention."""
    records = (
        session.query(MOAAnnotationRecord)
        .filter_by(intervention_id=intervention_id)
        .all()
    )
    return [
        {
            "target_chembl_id": r.target_chembl_id,
            "target_name": r.target_name,
            "target_gene_symbol": r.target_gene_symbol,
            "action_type": r.action_type,
            "mechanism_description": r.mechanism_description,
            "moa_category": r.moa_category,
        }
        for r in records
    ]
