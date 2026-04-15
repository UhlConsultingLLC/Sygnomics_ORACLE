"""Export endpoints: download data and figures."""

import io
import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from analysis.filters import canonicalize_phase, CANONICAL_PHASES
from api.dependencies import get_db
from database.queries import get_all_trials


def _display_phase(raw):
    canon = canonicalize_phase(raw)
    if not canon:
        return "NA"
    return "/".join(p for p in CANONICAL_PHASES if p in canon)

router = APIRouter(prefix="/export", tags=["export"])


@router.get("/csv/trials")
def export_trials_csv(db: Session = Depends(get_db)):
    """Export all trials as CSV."""
    import pandas as pd

    trials = get_all_trials(db)
    rows = []
    for t in trials:
        rows.append({
            "nct_id": t.nct_id,
            "title": t.title,
            "status": t.status,
            "phase": _display_phase(t.phase),
            "study_type": t.study_type,
            "enrollment_count": t.enrollment_count,
            "start_date": str(t.start_date) if t.start_date else "",
            "conditions": "; ".join(t.conditions),
            "interventions": "; ".join(iv.name for iv in t.interventions),
            "sponsor": t.sponsor.name if t.sponsor else "",
        })

    df = pd.DataFrame(rows)
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    buf.seek(0)

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=trials.csv"},
    )


@router.get("/json/trials")
def export_trials_json(db: Session = Depends(get_db)):
    """Export all trials as JSON."""
    trials = get_all_trials(db)
    data = [t.model_dump(mode="json") for t in trials]

    return StreamingResponse(
        iter([json.dumps(data, indent=2, default=str)]),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=trials.json"},
    )
