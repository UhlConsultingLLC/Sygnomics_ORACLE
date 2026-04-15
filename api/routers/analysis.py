"""Analysis endpoints: metrics, filtering, plots."""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from api.dependencies import get_db
from api.schemas import FilterOptionsResponse, MetricsSummary
from analysis.filters import apply_filters, canonicalize_phase, CANONICAL_PHASES, get_filter_options


def _display_phase(raw):
    canon = canonicalize_phase(raw)
    if not canon:
        return "NA"
    return "/".join(p for p in CANONICAL_PHASES if p in canon)
from analysis.metrics import (
    enrollment_summary,
    interventions_by_moa,
    phase_distribution,
    status_distribution,
    trials_per_condition,
)
from analysis.models import FilterSpec
from connectors.outcome_mapper import OutcomeMapper
from database.models import ConditionRecord, InterventionRecord, OutcomeRecord
from database.queries import get_all_conditions, get_all_interventions, get_trial_count

router = APIRouter(prefix="/analysis", tags=["analysis"])


class OutcomeExpandRequest(BaseModel):
    keyword: str


class OutcomeExpandResponse(BaseModel):
    original: str
    expanded_terms: list[str]


@router.get("/metrics", response_model=MetricsSummary)
def get_metrics(db: Session = Depends(get_db)):
    """Get high-level summary metrics."""
    enrollment = enrollment_summary(db)
    return MetricsSummary(
        total_trials=enrollment["total_trials"],
        total_enrollment=enrollment["total_enrollment"],
        mean_enrollment=enrollment["mean_enrollment"],
        conditions_count=len(get_all_conditions(db)),
        interventions_count=len(get_all_interventions(db)),
    )


@router.get("/trials-per-condition")
def get_trials_per_condition(limit: int = 30, db: Session = Depends(get_db)):
    """Get trial counts per condition."""
    return [m.model_dump() for m in trials_per_condition(db, limit)]


@router.get("/moa-distribution")
def get_moa_distribution(db: Session = Depends(get_db)):
    """Get intervention and trial counts per MOA category."""
    return [m.model_dump() for m in interventions_by_moa(db)]


@router.get("/phase-distribution")
def get_phase_distribution(db: Session = Depends(get_db)):
    """Get trial counts per phase."""
    return [m.model_dump() for m in phase_distribution(db)]


@router.get("/status-distribution")
def get_status_distribution(db: Session = Depends(get_db)):
    """Get trial counts per status."""
    return [m.model_dump() for m in status_distribution(db)]


@router.get("/filter-options", response_model=FilterOptionsResponse)
def get_filter_opts(db: Session = Depends(get_db)):
    """Get available filter values for the UI."""
    return get_filter_options(db)


@router.post("/filter")
def filter_trials(spec: FilterSpec, db: Session = Depends(get_db)):
    """Apply filters and return matching trials."""
    records = apply_filters(db, spec)
    return {
        "total": len(records),
        "trials": [
            {
                "nct_id": r.nct_id,
                "title": r.title,
                "status": r.status,
                "phase": _display_phase(r.phase),
                "enrollment_count": r.enrollment_count,
                "interventions": [iv.name for iv in r.interventions],
            }
            for r in records
        ],
    }


@router.get("/plots/{plot_type}")
def get_plot(plot_type: str, db: Session = Depends(get_db)):
    """Get a Plotly figure JSON for a specific plot type."""
    from visualization.summary_plots import (
        plot_moa_distribution,
        plot_phase_distribution,
        plot_trials_per_condition,
    )

    if plot_type == "trials_per_condition":
        data = trials_per_condition(db)
        fig = plot_trials_per_condition(data)
    elif plot_type == "moa_distribution":
        data = interventions_by_moa(db)
        fig = plot_moa_distribution(data)
    elif plot_type == "phase_distribution":
        data = phase_distribution(db)
        fig = plot_phase_distribution(data)
    else:
        return {"error": f"Unknown plot type: {plot_type}"}

    return fig.to_json()


@router.get("/autocomplete/{field}")
def autocomplete(
    field: str,
    q: str = Query("", min_length=1, description="Search prefix"),
    limit: int = Query(15, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Return autocomplete suggestions for condition, intervention, or outcome fields.

    When synonym expansion is enabled, DB matches include rows for any MeSH
    synonym of ``q``, so typing "GBM" surfaces "Glioblastoma" results too.
    """
    from sqlalchemy import or_
    from api.mesh_expansion import expand_condition, expand_intervention

    q_lower = q.lower()

    def _ilike_any(col, terms: list[str]):
        return or_(*[col.ilike(f"%{t}%") for t in terms])

    if field == "conditions":
        terms = list(expand_condition(q)) or [q]
        rows = (
            db.query(ConditionRecord.name)
            .filter(_ilike_any(ConditionRecord.name, terms))
            .distinct()
            .order_by(ConditionRecord.name)
            .limit(limit)
            .all()
        )
        return [r[0] for r in rows]

    elif field == "interventions":
        terms = list(expand_intervention(q)) or [q]
        rows = (
            db.query(InterventionRecord.name)
            .filter(_ilike_any(InterventionRecord.name, terms))
            .distinct()
            .order_by(InterventionRecord.name)
            .limit(limit)
            .all()
        )
        return [r[0] for r in rows]

    elif field == "outcomes":
        rows = (
            db.query(OutcomeRecord.measure)
            .filter(OutcomeRecord.measure.ilike(f"%{q}%"))
            .distinct()
            .order_by(OutcomeRecord.measure)
            .limit(limit)
            .all()
        )
        return [r[0] for r in rows]

    return []


@router.get("/expand-condition")
def preview_expand_condition(q: str = Query("", min_length=1)):
    """Return the MeSH-expanded synonym list for a condition term.

    Used by the frontend to render an inline "Condition matched via MeSH"
    preview as the user types, without running a full search.
    """
    from api.mesh_expansion import expand_condition
    terms = list(expand_condition(q)) or [q]
    return {"original": q, "expanded": terms}


@router.post("/outcomes/suggest", response_model=OutcomeExpandResponse)
def suggest_outcomes(req: OutcomeExpandRequest):
    """Expand an outcome keyword to related clinical endpoint terms.

    E.g., "response rate" -> ["objective response rate", "ORR", "tumor response", ...].
    """
    mapper = OutcomeMapper()
    terms = mapper.expand_sync(req.keyword)
    return OutcomeExpandResponse(original=req.keyword, expanded_terms=terms)
