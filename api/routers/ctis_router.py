"""CTIS endpoints: search, import, and manage EU clinical trial data."""

import logging
import threading
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api.dependencies import get_db, get_engine, get_session_factory

router = APIRouter(prefix="/ctis", tags=["ctis"])
logger = logging.getLogger(__name__)

# In-memory store for import job progress
_import_jobs: dict[str, dict] = {}


# ── Request / Response schemas ──────────────────────────────────────────


class CTISSearchRequest(BaseModel):
    query: str = ""
    medical_condition: str = ""
    max_results: int = Field(default=100, ge=1, le=500)
    fetch_details: bool = False


class CTISSearchResultItem(BaseModel):
    ct_number: str
    title: str = ""
    status: str = ""
    phase: str = ""
    sponsor: str = ""
    conditions: str = ""
    products: str = ""
    countries: list[str] = Field(default_factory=list)
    start_date: Optional[str] = None
    enrollment: Optional[int] = None
    already_imported: bool = False


class CTISSearchResponse(BaseModel):
    results: list[CTISSearchResultItem]
    total: int


class CTISImportRequest(BaseModel):
    query: str = ""
    medical_condition: str = ""
    max_results: int = Field(default=100, ge=1, le=500)
    fetch_details: bool = True
    use_glioma_search: bool = False


class CTISImportStartResponse(BaseModel):
    job_id: str
    status: str
    message: str


class CTISImportStatusResponse(BaseModel):
    job_id: str
    status: str  # "running", "complete", "error"
    stage: str = ""
    detail: str = ""
    progress_pct: int = 0
    trials_found: int = 0
    trials_imported: int = 0
    trials_skipped: int = 0
    error: Optional[str] = None


# ── Search endpoint (preview, no import) ────────────────────────────────


@router.post("/search", response_model=CTISSearchResponse)
def search_ctis_trials(req: CTISSearchRequest, db: Session = Depends(get_db)):
    """Search CTIS for trials matching the query.

    Returns a preview list without importing anything into the database.
    """
    from connectors.ctis import CTISConnector
    from database.models import TrialRecord

    conn = CTISConnector()

    try:
        raw_results = conn.search_trials(
            query=req.query,
            medical_condition=req.medical_condition,
            max_results=req.max_results,
        )
    except Exception as e:
        logger.error("CTIS search failed: %s", e)
        raise HTTPException(status_code=502, detail=f"CTIS API error: {e}")

    # Check which trials are already imported
    existing_ids = set()
    if raw_results:
        ct_numbers = [r.get("ctNumber", "") for r in raw_results]
        euct_ids = [f"EUCT-{cn}" for cn in ct_numbers if cn]
        existing_records = (
            db.query(TrialRecord.nct_id)
            .filter(TrialRecord.nct_id.in_(euct_ids))
            .all()
        )
        existing_ids = {r.nct_id for r in existing_records}

    items = []
    for raw in raw_results:
        ct_number = raw.get("ctNumber", "")
        countries_raw = raw.get("trialCountries", [])
        countries = [c.split(":")[0].strip() for c in countries_raw if c]

        enrollment = None
        enroll_str = raw.get("totalNumberEnrolled", "")
        if enroll_str:
            try:
                enrollment = int(enroll_str)
            except (ValueError, TypeError):
                pass

        # Map status code to human-readable string
        raw_status = raw.get("ctStatus", "")
        if isinstance(raw_status, int):
            from connectors.ctis import _STATUS_CODES
            status_str = _STATUS_CODES.get(raw_status, f"Unknown ({raw_status})")
        else:
            status_str = str(raw_status)

        # Coerce phase to string
        raw_phase = raw.get("trialPhase", "")
        phase_str = str(raw_phase) if raw_phase else ""

        items.append(CTISSearchResultItem(
            ct_number=ct_number,
            title=raw.get("ctTitle", ""),
            status=status_str,
            phase=phase_str,
            sponsor=str(raw.get("sponsor", "")),
            conditions=str(raw.get("conditions", "")),
            products=str(raw.get("product", "")),
            countries=countries,
            start_date=str(raw.get("startDateEU", "") or ""),
            enrollment=enrollment,
            already_imported=f"EUCT-{ct_number}" in existing_ids,
        ))

    return CTISSearchResponse(results=items, total=len(items))


# ── Import endpoint (background job) ───────────────────────────────────


@router.post("/import", response_model=CTISImportStartResponse)
def start_ctis_import(req: CTISImportRequest):
    """Start a background import of CTIS trials into the database.

    Returns a job ID to poll for progress via GET /ctis/import-status/{job_id}.
    """
    import uuid

    job_id = str(uuid.uuid4())[:8]
    _import_jobs[job_id] = {
        "status": "running",
        "stage": "initializing",
        "detail": "",
        "progress_pct": 0,
        "trials_found": 0,
        "trials_imported": 0,
        "trials_skipped": 0,
        "error": None,
    }

    def run_import():
        try:
            from connectors.ctis import CTISConnector
            from database.etl import load_trial
            from database.models import TrialRecord

            job = _import_jobs[job_id]
            job["stage"] = "searching"
            job["detail"] = f"Searching CTIS for '{req.query or req.medical_condition}'"

            conn = CTISConnector()

            # Search for trials
            if req.use_glioma_search:
                job["detail"] = "Running multi-term glioma search"
                trials = conn.get_glioma_trials(
                    fetch_details=req.fetch_details,
                    max_results=req.max_results,
                )
            else:
                trials = conn.search_and_parse(
                    query=req.query,
                    medical_condition=req.medical_condition,
                    max_results=req.max_results,
                    fetch_details=req.fetch_details,
                )

            job["trials_found"] = len(trials)
            job["stage"] = "importing"
            job["detail"] = f"Found {len(trials)} trials, importing..."
            job["progress_pct"] = 30

            # Import into database
            db_engine = get_engine()
            sf = get_session_factory(db_engine)
            db = sf()
            try:
                imported = 0
                skipped = 0
                for i, trial in enumerate(trials):
                    try:
                        # Check if already exists
                        existing = db.get(TrialRecord, trial.nct_id)
                        if existing:
                            skipped += 1
                        else:
                            load_trial(db, trial)
                            imported += 1

                        if (i + 1) % 5 == 0:
                            db.commit()
                            pct = 30 + int(60 * (i + 1) / len(trials))
                            job["progress_pct"] = min(pct, 90)
                            job["detail"] = f"Imported {imported}, skipped {skipped} of {len(trials)}"
                            job["trials_imported"] = imported
                            job["trials_skipped"] = skipped
                    except Exception as e:
                        logger.warning("Failed to import trial %s: %s", trial.nct_id, e)
                        db.rollback()
                        skipped += 1

                db.commit()
                job["trials_imported"] = imported
                job["trials_skipped"] = skipped
                job["progress_pct"] = 100
                job["stage"] = "complete"
                job["status"] = "complete"
                job["detail"] = f"Imported {imported} new trials ({skipped} already existed)"
            finally:
                db.close()

        except Exception as e:
            logger.exception("CTIS import job %s failed", job_id)
            _import_jobs[job_id]["status"] = "error"
            _import_jobs[job_id]["error"] = str(e)

    thread = threading.Thread(target=run_import, daemon=True)
    thread.start()

    search_desc = req.query or req.medical_condition or "glioma (multi-term)"
    return CTISImportStartResponse(
        job_id=job_id,
        status="running",
        message=f"Import started for CTIS search '{search_desc}' (max {req.max_results} trials)",
    )


@router.get("/import-status/{job_id}", response_model=CTISImportStatusResponse)
def get_ctis_import_status(job_id: str):
    """Poll for CTIS import job progress."""
    if job_id not in _import_jobs:
        raise HTTPException(status_code=404, detail=f"Import job {job_id} not found")

    job = _import_jobs[job_id]
    return CTISImportStatusResponse(
        job_id=job_id,
        status=job["status"],
        stage=job["stage"],
        detail=job["detail"],
        progress_pct=job["progress_pct"],
        trials_found=job["trials_found"],
        trials_imported=job["trials_imported"],
        trials_skipped=job["trials_skipped"],
        error=job["error"],
    )


@router.get("/import-jobs")
def list_ctis_import_jobs():
    """List all CTIS import jobs."""
    return [
        {
            "job_id": jid,
            "status": job["status"],
            "stage": job["stage"],
            "trials_found": job["trials_found"],
            "trials_imported": job["trials_imported"],
        }
        for jid, job in _import_jobs.items()
    ]


# ── Stats endpoint ──────────────────────────────────────────────────────


@router.get("/stats")
def get_ctis_stats(db: Session = Depends(get_db)):
    """Get statistics about CTIS trials in the database."""
    from database.models import TrialRecord, LocationRecord
    from sqlalchemy import func

    total_ctis = (
        db.query(func.count(TrialRecord.nct_id))
        .filter(TrialRecord.source == "ctis")
        .scalar() or 0
    )

    total_ctgov = (
        db.query(func.count(TrialRecord.nct_id))
        .filter(TrialRecord.source == "ctgov")
        .scalar() or 0
    )

    # Count CTIS trials with cross-references to CT.gov
    cross_referenced = (
        db.query(func.count(TrialRecord.nct_id))
        .filter(TrialRecord.source == "ctis")
        .filter(TrialRecord.cross_reference_id != "")
        .scalar() or 0
    )

    # Countries represented in CTIS trials
    ctis_countries = (
        db.query(LocationRecord.country)
        .join(TrialRecord, LocationRecord.trial_nct_id == TrialRecord.nct_id)
        .filter(TrialRecord.source == "ctis")
        .filter(LocationRecord.country != "")
        .distinct()
        .all()
    )

    return {
        "total_ctis_trials": total_ctis,
        "total_ctgov_trials": total_ctgov,
        "cross_referenced": cross_referenced,
        "ctis_countries": sorted([c[0] for c in ctis_countries]),
    }
