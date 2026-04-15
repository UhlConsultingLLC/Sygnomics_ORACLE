"""MOA classification endpoints: categories, interventions, classification trigger."""

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from api.dependencies import get_db
from database.models import (
    InterventionRecord,
    MOAAnnotationRecord,
    TrialRecord,
    trial_interventions,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/moa", tags=["moa"])


# --- Response schemas ---

class MOACategoryItem(BaseModel):
    moa_category: str
    moa_broad_category: str = ""
    intervention_count: int
    trial_count: int


class MOAInterventionItem(BaseModel):
    intervention_name: str
    chembl_id: str = ""
    mechanism_description: str = ""
    moa_short_form: str = ""
    moa_broad_category: str = ""
    action_type: str = ""
    data_source: str = ""
    gene_symbols: list[str] = Field(default_factory=list)


class MOAClassifyRequest(BaseModel):
    force_reclassify: bool = False


class MOAClassifyResponse(BaseModel):
    classified: int
    skipped: int
    failed: int


class MOADrugLookupRequest(BaseModel):
    drug_name: str


class MOADrugLookupResponse(BaseModel):
    drug_name: str
    chembl_id: str = ""
    mechanisms: list[dict] = Field(default_factory=list)


# --- Endpoints ---

@router.get("/categories", response_model=list[MOACategoryItem])
def list_moa_categories(db: Session = Depends(get_db)):
    """Get all MOA categories with intervention and trial counts.

    Returns short-hand broad categories where available, falling back to
    the moa_category field for legacy annotations.
    """
    results = (
        db.query(
            MOAAnnotationRecord.moa_category,
            MOAAnnotationRecord.moa_broad_category,
            func.count(func.distinct(InterventionRecord.id)).label("intervention_count"),
            func.count(func.distinct(TrialRecord.nct_id)).label("trial_count"),
        )
        .join(InterventionRecord, MOAAnnotationRecord.intervention_id == InterventionRecord.id)
        .join(trial_interventions, InterventionRecord.id == trial_interventions.c.intervention_id)
        .join(TrialRecord, trial_interventions.c.trial_nct_id == TrialRecord.nct_id)
        .group_by(MOAAnnotationRecord.moa_category, MOAAnnotationRecord.moa_broad_category)
        .order_by(func.count(func.distinct(TrialRecord.nct_id)).desc())
        .all()
    )

    return [
        MOACategoryItem(
            moa_category=cat,
            moa_broad_category=broad or "",
            intervention_count=iv_count,
            trial_count=t_count,
        )
        for cat, broad, iv_count, t_count in results
    ]


@router.get("/interventions/{category}", response_model=list[MOAInterventionItem])
def list_interventions_by_category(
    category: str,
    db: Session = Depends(get_db),
):
    """Get all interventions annotated with a given MOA category."""
    annotations = (
        db.query(MOAAnnotationRecord)
        .join(InterventionRecord, MOAAnnotationRecord.intervention_id == InterventionRecord.id)
        .filter(MOAAnnotationRecord.moa_broad_category == category)
        .all()
    )

    items = []
    for ann in annotations:
        iv = ann.intervention
        gene_symbols = [ann.target_gene_symbol] if ann.target_gene_symbol else []
        items.append(MOAInterventionItem(
            intervention_name=iv.name,
            chembl_id=iv.chembl_id or "",
            mechanism_description=ann.mechanism_description,
            moa_short_form=ann.moa_short_form or "",
            moa_broad_category=ann.moa_broad_category or "",
            action_type=ann.action_type,
            data_source=ann.data_source or "",
            gene_symbols=gene_symbols,
        ))

    return items


@router.post("/classify", response_model=MOAClassifyResponse)
def classify_interventions(
    req: MOAClassifyRequest,
    db: Session = Depends(get_db),
):
    """Trigger MOA classification for all interventions.

    Uses Open Targets as the primary source with ChEMBL fallback.
    """
    from moa_classification.classifier import MOAClassifier

    classifier = MOAClassifier()

    # Run the async classifier in a sync context
    loop = asyncio.new_event_loop()
    try:
        stats = loop.run_until_complete(
            classifier.classify_all(db, force_reclassify=req.force_reclassify)
        )
    finally:
        loop.close()

    return MOAClassifyResponse(**stats)


@router.post("/lookup", response_model=MOADrugLookupResponse)
def lookup_drug_moa(req: MOADrugLookupRequest):
    """Look up MOA for a drug name via Open Targets (without storing).

    Useful for previewing MOA resolution before running full classification.
    """
    from connectors.open_targets import OpenTargetsClient
    from moa_classification.moa_shorthand import resolve_shorthand
    from api.mesh_expansion import expand_intervention

    client = OpenTargetsClient()
    result = client.lookup_drug_moa(req.drug_name)

    # If the literal name doesn't resolve, retry with each synonym (brand,
    # generic, research code) before giving up.
    if not result:
        for syn in expand_intervention(req.drug_name):
            if syn.lower() == req.drug_name.strip().lower():
                continue
            result = client.lookup_drug_moa(syn)
            if result:
                break

    if not result:
        return MOADrugLookupResponse(drug_name=req.drug_name)

    mechanisms = []
    for row in result.rows:
        gene_symbols = [t.approved_symbol for t in row.targets if t.approved_symbol]
        shorthand = resolve_shorthand(
            mechanism_of_action=row.mechanism_of_action,
            action_type=row.action_type,
            gene_symbols=gene_symbols,
        )
        mechanisms.append({
            "long_form": row.mechanism_of_action,
            "short_form": shorthand.short_form,
            "broad_category": shorthand.broad_category,
            "action_type": row.action_type,
            "target_name": row.target_name,
            "gene_symbols": gene_symbols,
        })

    return MOADrugLookupResponse(
        drug_name=req.drug_name,
        chembl_id=result.chembl_id,
        mechanisms=mechanisms,
    )
