"""Export endpoints: download data and figures.

Every export emitted from this router carries a provenance stamp built by
:mod:`api.provenance`:

* **CSV**  — three ``# `` comment rows at the top (app + build_id + endpoint,
  build time, context JSON), then the regular CSV body. ``pandas.read_csv``
  with ``comment='#'`` ignores them. ``Content-Disposition`` uses a filename
  that encodes the version + git SHA + UTC timestamp.
* **JSON** — response is wrapped as ``{ "metadata": {...}, "data": <body> }``.
  This is a breaking change from pre-1.0.0 but is an acceptable cost for
  full traceability.
"""

import io
import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from analysis.filters import canonicalize_phase, CANONICAL_PHASES
from api.dependencies import get_db
from api.provenance import (
    build_export_metadata,
    csv_header_lines,
    provenance_filename,
    wrap_json_export,
)
from database.queries import get_all_trials


def _display_phase(raw):
    canon = canonicalize_phase(raw)
    if not canon:
        return "NA"
    return "/".join(p for p in CANONICAL_PHASES if p in canon)


router = APIRouter(prefix="/export", tags=["export"])


@router.get("/csv/trials")
def export_trials_csv(db: Session = Depends(get_db)):
    """Export all trials as CSV with provenance header."""
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
    meta = build_export_metadata(endpoint="/export/csv/trials", row_count=len(df))

    buf = io.StringIO()
    buf.write(csv_header_lines(meta))
    df.to_csv(buf, index=False)
    buf.seek(0)

    filename = provenance_filename("trials", "csv", meta)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            # Echo the build ID so shell pipelines can capture it without
            # reopening the file.
            "X-Oracle-Build-Id": meta["build_id"],
        },
    )


@router.get("/json/trials")
def export_trials_json(db: Session = Depends(get_db)):
    """Export all trials as JSON with a top-level ``metadata`` wrapper."""
    trials = get_all_trials(db)
    data = [t.model_dump(mode="json") for t in trials]
    meta = build_export_metadata(endpoint="/export/json/trials", row_count=len(data))
    payload = wrap_json_export(data, meta)

    filename = provenance_filename("trials", "json", meta)
    return StreamingResponse(
        iter([json.dumps(payload, indent=2, default=str)]),
        media_type="application/json",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "X-Oracle-Build-Id": meta["build_id"],
        },
    )
