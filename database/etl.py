"""ETL functions for loading Trial Pydantic models into the database."""

import logging
from typing import Optional

from sqlalchemy.orm import Session

from connectors.models.trial import Trial
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

logger = logging.getLogger(__name__)


def _get_or_create_condition(session: Session, name: str) -> ConditionRecord:
    """Get existing condition or create a new one."""
    condition = session.query(ConditionRecord).filter_by(name=name).first()
    if condition is None:
        condition = ConditionRecord(name=name)
        session.add(condition)
        session.flush()
    return condition


def _get_or_create_intervention(
    session: Session, name: str, intervention_type: str, description: str
) -> InterventionRecord:
    """Get existing intervention by name or create a new one."""
    intervention = session.query(InterventionRecord).filter_by(name=name).first()
    if intervention is None:
        intervention = InterventionRecord(
            name=name,
            intervention_type=intervention_type,
            description=description,
        )
        session.add(intervention)
        session.flush()
    else:
        if intervention_type and not intervention.intervention_type:
            intervention.intervention_type = intervention_type
        if description and not intervention.description:
            intervention.description = description
    return intervention


def _get_or_create_sponsor(
    session: Session, name: str, sponsor_type: str
) -> SponsorRecord:
    """Get existing sponsor or create a new one."""
    sponsor = session.query(SponsorRecord).filter_by(name=name).first()
    if sponsor is None:
        sponsor = SponsorRecord(name=name, type=sponsor_type)
        session.add(sponsor)
        session.flush()
    return sponsor


def load_trial(session: Session, trial: Trial) -> TrialRecord:
    """Load a single Trial into the database, upserting if it already exists.

    Args:
        session: Active database session.
        trial: Validated Trial Pydantic model.

    Returns:
        The created or updated TrialRecord.
    """
    existing = session.get(TrialRecord, trial.nct_id)

    # Determine data source from the trial ID prefix
    source = "ctis" if trial.nct_id.startswith("EUCT-") else "ctgov"

    # Extract cross-reference IDs (e.g. CT.gov NCT IDs mentioned in CTIS trials)
    cross_ref = ""
    if source == "ctis" and trial.detailed_description:
        import re
        nct_match = re.search(r"(NCT\d{8})", trial.detailed_description)
        if nct_match:
            cross_ref = nct_match.group(1)

    if existing is not None:
        # Update existing record
        existing.title = trial.title
        existing.brief_summary = trial.brief_summary
        existing.detailed_description = trial.detailed_description
        existing.status = trial.status
        existing.phase = trial.phase
        existing.study_type = trial.study_type
        existing.enrollment_count = trial.enrollment_count
        existing.start_date = trial.start_date
        existing.completion_date = trial.completion_date
        existing.results_url = trial.results_url
        existing.source = source
        if cross_ref:
            existing.cross_reference_id = cross_ref
        record = existing
    else:
        record = TrialRecord(
            nct_id=trial.nct_id,
            title=trial.title,
            brief_summary=trial.brief_summary,
            detailed_description=trial.detailed_description,
            status=trial.status,
            phase=trial.phase,
            study_type=trial.study_type,
            enrollment_count=trial.enrollment_count,
            start_date=trial.start_date,
            completion_date=trial.completion_date,
            results_url=trial.results_url,
            source=source,
            cross_reference_id=cross_ref,
        )
        session.add(record)

    # Conditions (M2M) — deduplicate by name
    record.conditions.clear()
    seen_conditions: set[str] = set()
    for cond_name in trial.conditions:
        if cond_name in seen_conditions:
            continue
        seen_conditions.add(cond_name)
        cond = _get_or_create_condition(session, cond_name)
        record.conditions.append(cond)

    # Interventions (M2M) — deduplicate by name
    record.interventions.clear()
    seen_interventions: set[str] = set()
    for iv in trial.interventions:
        if iv.name in seen_interventions:
            continue
        seen_interventions.add(iv.name)
        intervention = _get_or_create_intervention(
            session, iv.name, iv.type, iv.description
        )
        record.interventions.append(intervention)

    # Outcomes (replace)
    session.query(OutcomeRecord).filter_by(trial_nct_id=trial.nct_id).delete()
    for oc in trial.outcomes:
        results_json = ""
        if oc.results:
            import json as _json
            results_json = _json.dumps([r.model_dump() for r in oc.results])
        outcome = OutcomeRecord(
            trial_nct_id=trial.nct_id,
            type=oc.type,
            measure=oc.measure,
            description=oc.description,
            time_frame=oc.time_frame,
            results_json=results_json,
        )
        session.add(outcome)

    # Arms (replace)
    session.query(ArmRecord).filter_by(trial_nct_id=trial.nct_id).delete()
    for arm in trial.arms:
        arm_record = ArmRecord(
            trial_nct_id=trial.nct_id,
            label=arm.label,
            type=arm.type,
            description=arm.description,
            intervention_names=",".join(arm.interventions) if arm.interventions else "",
        )
        session.add(arm_record)

    # Eligibility (replace)
    session.query(EligibilityRecord).filter_by(trial_nct_id=trial.nct_id).delete()
    if trial.eligibility:
        elig = EligibilityRecord(
            trial_nct_id=trial.nct_id,
            criteria_text=trial.eligibility.criteria_text,
            min_age=trial.eligibility.min_age,
            max_age=trial.eligibility.max_age,
            sex=trial.eligibility.sex,
            healthy_volunteers=trial.eligibility.healthy_volunteers,
        )
        session.add(elig)

    # Sponsor
    if trial.sponsor and trial.sponsor.name:
        sponsor = _get_or_create_sponsor(
            session, trial.sponsor.name, trial.sponsor.type
        )
        record.sponsor_id = sponsor.id

    # Locations (replace)
    session.query(LocationRecord).filter_by(trial_nct_id=trial.nct_id).delete()
    for loc in trial.locations:
        location = LocationRecord(
            trial_nct_id=trial.nct_id,
            facility=loc.facility,
            city=loc.city,
            state=loc.state,
            country=loc.country,
            zip_code=loc.zip_code,
        )
        session.add(location)

    session.flush()
    return record


def load_trials(session: Session, trials: list[Trial]) -> list[TrialRecord]:
    """Load multiple trials into the database.

    Args:
        session: Active database session.
        trials: List of validated Trial Pydantic models.

    Returns:
        List of created/updated TrialRecord objects.
    """
    records = []
    failed = 0
    for trial in trials:
        try:
            record = load_trial(session, trial)
            records.append(record)
        except Exception as e:
            logger.error("Failed to load trial %s: %s", trial.nct_id, e)
            session.rollback()
            failed += 1

    session.commit()
    logger.info(
        "Loaded %d trials into database (%d failed)",
        len(records), failed,
    )
    return records
