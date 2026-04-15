"""Dynamic filtering engine for clinical trial queries."""

import re
from datetime import date

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

# Canonical phase vocabulary used throughout the UI/API.
CANONICAL_PHASES = ["EARLY_PHASE1", "PHASE1", "PHASE2", "PHASE3", "PHASE4", "NA"]


def canonicalize_phase(raw: str | None) -> set[str]:
    """Map a raw DB phase string (any format) to the set of canonical phases
    it represents. A combined phase like "Phase 1/Phase 2" maps to both
    PHASE1 and PHASE2. None, "NA", "N/A", "Not Applicable", etc. all map to
    the canonical "NA" bucket.
    """
    if not raw:
        return {"NA"}
    s = raw.strip().upper().replace("-", " ").replace("_", " ")
    if not s or s in {"NA", "N/A", "NOT APPLICABLE", "NONE", "NULL"}:
        return {"NA"}
    out: set[str] = set()
    if "EARLY" in s and "1" in s:
        out.add("EARLY_PHASE1")
        # Don't also add PHASE1 — early phase 1 is its own bucket.
        return out
    # Find all standalone phase numbers 1..4
    for n in re.findall(r"PHASE\s*([1-4])", s):
        out.add(f"PHASE{n}")
    if not out:
        # Fallback: bare digits like "1/2"
        for n in re.findall(r"(?<![A-Z])([1-4])(?![A-Z])", s):
            out.add(f"PHASE{n}")
    return out

from analysis.models import FilterSpec
from database.models import (
    ConditionRecord,
    EligibilityRecord,
    InterventionRecord,
    LocationRecord,
    MOAAnnotationRecord,
    OutcomeRecord,
    SponsorRecord,
    TrialRecord,
    trial_conditions,
    trial_interventions,
)


def apply_filters(session: Session, spec: FilterSpec) -> list[TrialRecord]:
    """Apply a FilterSpec to build a dynamic query and return matching trials.

    Args:
        session: Active database session.
        spec: Filter specification with optional criteria.

    Returns:
        List of TrialRecord objects matching all specified filters.
    """
    query = session.query(TrialRecord)

    if spec.conditions:
        query = query.join(TrialRecord.conditions).filter(
            ConditionRecord.name.in_(spec.conditions)
        )

    _joined_interventions = False

    if spec.moa_categories:
        # Parse composite "Broad - Category" labels into filter conditions
        moa_filters = []
        for label in spec.moa_categories:
            if " - " in label:
                broad, cat = label.split(" - ", 1)
                moa_filters.append(
                    and_(
                        MOAAnnotationRecord.moa_broad_category == broad,
                        MOAAnnotationRecord.moa_category == cat,
                    )
                )
            else:
                # Plain category (no broad prefix)
                moa_filters.append(
                    and_(
                        or_(
                            MOAAnnotationRecord.moa_broad_category.is_(None),
                            MOAAnnotationRecord.moa_broad_category == "",
                        ),
                        MOAAnnotationRecord.moa_category == label,
                    )
                )
        query = (
            query.join(TrialRecord.interventions)
            .join(InterventionRecord.moa_annotations)
            .filter(or_(*moa_filters))
        )
        _joined_interventions = True

    if spec.intervention_keywords:
        # Expand each user-entered keyword via ChEMBL synonyms so that
        # brand/generic/research-code aliases all match (e.g. "XL184" →
        # Cabozantinib, "Avastin" → Bevacizumab).
        try:
            from api.mesh_expansion import expand_intervention
            expanded_kws: list[str] = []
            for kw in spec.intervention_keywords:
                syns = list(expand_intervention(kw)) or [kw]
                expanded_kws.extend(syns)
            # Dedupe case-insensitively
            seen: set[str] = set()
            kws = [k for k in expanded_kws if not (k.lower() in seen or seen.add(k.lower()))]
        except Exception:
            kws = list(spec.intervention_keywords)
        iv_filters = [InterventionRecord.name.ilike(f"%{kw}%") for kw in kws]
        if not _joined_interventions:
            query = query.join(TrialRecord.interventions)
            _joined_interventions = True
        query = query.filter(or_(*iv_filters))

    if spec.phases:
        # Map canonical phases (EARLY_PHASE1, PHASE1..4, NA) back to the set
        # of raw DB phase strings that canonicalize to any of the requested
        # ones. "NA" also matches NULL phase rows.
        requested = {p.strip().upper() for p in spec.phases if p}
        all_raw = [r for (r,) in session.query(TrialRecord.phase).distinct().all()]
        matching_raw = [r for r in all_raw if r and (canonicalize_phase(r) & requested)]
        clauses = []
        if matching_raw:
            clauses.append(TrialRecord.phase.in_(matching_raw))
        if "NA" in requested:
            clauses.append(TrialRecord.phase.is_(None))
        query = query.filter(or_(*clauses)) if clauses else query.filter(False)

    if spec.statuses:
        query = query.filter(TrialRecord.status.in_(spec.statuses))

    if spec.sponsors:
        query = query.join(TrialRecord.sponsor).filter(
            SponsorRecord.name.in_(spec.sponsors)
        )

    if spec.study_types:
        query = query.filter(TrialRecord.study_type.in_(spec.study_types))

    if spec.min_enrollment is not None:
        query = query.filter(TrialRecord.enrollment_count >= spec.min_enrollment)

    if spec.max_enrollment is not None:
        query = query.filter(TrialRecord.enrollment_count <= spec.max_enrollment)

    if spec.locations_country:
        query = query.join(TrialRecord.locations).filter(
            LocationRecord.country.in_(spec.locations_country)
        )

    if spec.eligibility_keywords:
        keyword_filters = [
            EligibilityRecord.criteria_text.ilike(f"%{kw}%")
            for kw in spec.eligibility_keywords
        ]
        query = query.join(TrialRecord.eligibility).filter(or_(*keyword_filters))

    if spec.start_date_from:
        query = query.filter(TrialRecord.start_date >= spec.start_date_from)

    if spec.start_date_to:
        query = query.filter(TrialRecord.start_date <= spec.start_date_to)

    _joined_outcomes = False

    if spec.has_results is not None:
        query = query.outerjoin(
            OutcomeRecord, TrialRecord.nct_id == OutcomeRecord.trial_nct_id
        )
        _joined_outcomes = True
        if spec.has_results:
            query = query.filter(
                or_(
                    and_(
                        TrialRecord.results_url.isnot(None),
                        func.length(TrialRecord.results_url) > 0,
                    ),
                    OutcomeRecord.id.isnot(None),
                )
            )
        else:
            query = query.filter(
                and_(
                    or_(
                        TrialRecord.results_url.is_(None),
                        func.length(TrialRecord.results_url) == 0,
                    ),
                    OutcomeRecord.id.is_(None),
                )
            )

    if spec.outcome_keywords:
        outcome_filters = [
            OutcomeRecord.measure.ilike(f"%{kw}%")
            for kw in spec.outcome_keywords
        ]
        if not _joined_outcomes:
            query = query.join(
                OutcomeRecord, TrialRecord.nct_id == OutcomeRecord.trial_nct_id
            )
        query = query.filter(or_(*outcome_filters))

    return query.distinct().all()


def get_filter_options(session: Session) -> dict:
    """Retrieve all available filter values from the database.

    Returns a dict of dimension -> sorted list of available values,
    suitable for populating UI dropdown menus.
    """
    conditions = [
        name for (name,) in
        session.query(ConditionRecord.name).order_by(ConditionRecord.name).all()
    ]

    # Build combined "Broad Category - MOA Category" labels for MOA filter
    moa_rows = (
        session.query(
            MOAAnnotationRecord.moa_broad_category,
            MOAAnnotationRecord.moa_category,
        )
        .distinct()
        .order_by(
            MOAAnnotationRecord.moa_broad_category,
            MOAAnnotationRecord.moa_category,
        )
        .all()
    )
    moa_categories = []
    for broad, cat in moa_rows:
        if not cat:
            continue
        if broad:
            moa_categories.append(f"{broad} - {cat}")
        else:
            moa_categories.append(cat)

    # Consolidate all raw DB phase values into the canonical vocabulary
    # so the UI only shows EARLY_PHASE1, PHASE1, PHASE2, PHASE3, PHASE4.
    raw_phases = [
        p for (p,) in session.query(TrialRecord.phase).distinct().all() if p
    ]
    present: set[str] = set()
    for rp in raw_phases:
        present.update(canonicalize_phase(rp))
    phases = [p for p in CANONICAL_PHASES if p in present]

    statuses = [
        s for (s,) in
        session.query(TrialRecord.status).distinct().order_by(TrialRecord.status).all()
        if s
    ]

    sponsors = [
        name for (name,) in
        session.query(SponsorRecord.name).order_by(SponsorRecord.name).all()
    ]

    study_types = [
        st for (st,) in
        session.query(TrialRecord.study_type).distinct().order_by(TrialRecord.study_type).all()
        if st
    ]

    countries = [
        c for (c,) in
        session.query(LocationRecord.country).distinct().order_by(LocationRecord.country).all()
        if c
    ]

    interventions = [
        name for (name,) in
        session.query(InterventionRecord.name).order_by(InterventionRecord.name).all()
        if name
    ]

    return {
        "conditions": conditions,
        "moa_categories": moa_categories,
        "phases": phases,
        "statuses": statuses,
        "sponsors": sponsors,
        "study_types": study_types,
        "countries": countries,
        "interventions": interventions,
    }
