"""WHO 2021 CNS Classification endpoints."""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from api.dependencies import get_db
from database.models import TrialRecord, WHOClassificationRecord

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/who", tags=["who-classification"])


@router.get("/stats")
def who_stats(db: Session = Depends(get_db)):
    """Get WHO 2021 classification statistics across all trials."""
    total = db.query(func.count(WHOClassificationRecord.trial_nct_id)).scalar() or 0
    if total == 0:
        return {
            "total_classified": 0,
            "type_distribution": {},
            "confidence_distribution": {},
            "idh_distribution": {},
        }

    # Confidence distribution
    conf_rows = (
        db.query(WHOClassificationRecord.confidence, func.count())
        .group_by(WHOClassificationRecord.confidence)
        .all()
    )
    confidence_dist = {row[0]: row[1] for row in conf_rows}

    # IDH status distribution
    idh_rows = (
        db.query(WHOClassificationRecord.idh_status, func.count())
        .group_by(WHOClassificationRecord.idh_status)
        .all()
    )
    idh_dist = {row[0]: row[1] for row in idh_rows}

    # WHO type distribution (need to parse comma-separated who_types)
    all_records = db.query(WHOClassificationRecord.who_types).all()
    type_counts: dict[str, int] = {}
    for (who_types,) in all_records:
        for t in who_types.split(" | "):
            t = t.strip()
            if t:
                type_counts[t] = type_counts.get(t, 0) + 1

    return {
        "total_classified": total,
        "type_distribution": dict(sorted(type_counts.items(), key=lambda x: -x[1])),
        "confidence_distribution": confidence_dist,
        "idh_distribution": idh_dist,
    }


@router.get("/trial/{nct_id}")
def who_trial_profile(nct_id: str, db: Session = Depends(get_db)):
    """Get WHO 2021 classification profile for a specific trial."""
    record = db.query(WHOClassificationRecord).filter_by(trial_nct_id=nct_id).first()
    if record is None:
        raise HTTPException(status_code=404, detail=f"WHO classification not found for {nct_id}")

    return {
        "nct_id": record.trial_nct_id,
        "who_types": [t.strip() for t in record.who_types.split(" | ") if t.strip()],
        "who_grade_min": record.who_grade_min,
        "who_grade_max": record.who_grade_max,
        "idh_status": record.idh_status,
        "codeletion_1p19q": record.codeletion_1p19q,
        "mgmt_status": record.mgmt_status,
        "cdkn2a_status": record.cdkn2a_status,
        "h3k27m_status": record.h3k27m_status,
        "confidence": record.confidence,
        "biomarker_count": record.biomarker_count,
    }


@router.get("/trials")
def who_trials_by_type(
    who_type: Optional[str] = Query(None, description="Filter by WHO type (partial match)"),
    idh_status: Optional[str] = Query(None, description="Filter by IDH status"),
    codeletion_1p19q: Optional[str] = Query(None, description="Filter by 1p/19q codeletion status"),
    mgmt_status: Optional[str] = Query(None, description="Filter by MGMT status"),
    confidence: Optional[str] = Query(None, description="Filter by confidence: high, medium, low"),
    region: Optional[str] = Query(None, description="Filter by region: US, EU"),
    nct_id: Optional[str] = Query(None, description="Search by NCT ID (partial match)"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """List trials filtered by WHO 2021 classification criteria."""
    query = (
        db.query(WHOClassificationRecord, TrialRecord.source)
        .join(TrialRecord, TrialRecord.nct_id == WHOClassificationRecord.trial_nct_id)
    )

    if who_type:
        query = query.filter(WHOClassificationRecord.who_types.ilike(f"%{who_type}%"))
    if idh_status:
        query = query.filter(WHOClassificationRecord.idh_status == idh_status)
    if codeletion_1p19q:
        query = query.filter(WHOClassificationRecord.codeletion_1p19q == codeletion_1p19q)
    if mgmt_status:
        query = query.filter(WHOClassificationRecord.mgmt_status == mgmt_status)
    if confidence:
        query = query.filter(WHOClassificationRecord.confidence == confidence)
    if nct_id:
        query = query.filter(WHOClassificationRecord.trial_nct_id.ilike(f"%{nct_id}%"))
    if region:
        r = region.upper()
        if r == "US":
            query = query.filter(TrialRecord.source == "ctgov")
        elif r == "EU":
            query = query.filter(TrialRecord.source == "ctis")

    total = query.count()
    rows = query.order_by(WHOClassificationRecord.trial_nct_id).offset(offset).limit(limit).all()

    return {
        "total": total,
        "trials": [
            {
                "nct_id": r.trial_nct_id,
                "who_types": [t.strip() for t in r.who_types.split(" | ") if t.strip()],
                "who_grade_min": r.who_grade_min,
                "who_grade_max": r.who_grade_max,
                "idh_status": r.idh_status,
                "codeletion_1p19q": r.codeletion_1p19q,
                "mgmt_status": r.mgmt_status,
                "confidence": r.confidence,
                "biomarker_count": r.biomarker_count,
                "region": "EU" if source == "ctis" else "US",
                "source": source,
            }
            for r, source in rows
        ],
    }


@router.post("/reclassify")
def reclassify_all(
    limit: Optional[int] = Query(None, description="Max trials to process"),
    db: Session = Depends(get_db),
):
    """Re-run WHO 2021 classification on all trials."""
    from analysis.who_extractor import classify_all_trials, save_who_profiles

    profiles = classify_all_trials(db, limit=limit)
    saved = save_who_profiles(db, profiles)

    # Compute summary
    type_counts: dict[str, int] = {}
    for p in profiles:
        for t in p.target_who_types:
            type_counts[t] = type_counts.get(t, 0) + 1

    return {
        "total_classified": len(profiles),
        "records_saved": saved,
        "type_distribution": type_counts,
    }
