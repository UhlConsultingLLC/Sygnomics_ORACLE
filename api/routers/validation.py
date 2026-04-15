"""Real-world validation endpoints: SATGBM predictions vs TCGA outcomes.

For a given drug, runs the full DCNA + expression + threshold rule on every
TCGA patient, then compares predicted-responder vs non-responder survival
among patients who actually received that drug.
"""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from api.dependencies import get_db
from api.schemas import (
    KMPoint,
    ValidatableDrug,
    ValidatableDrugsResponse,
    ValidationRequest,
    ValidationResponse,
)
from database.models import TCGATreatment

router = APIRouter(prefix="/validation", tags=["validation"])
logger = logging.getLogger(__name__)


@router.get("/drugs", response_model=ValidatableDrugsResponse)
def list_validatable_drugs(session: Session = Depends(get_db)):
    """List drugs present in both DCNA data and tcga_treatments.

    Only these drugs can be validated end-to-end (DCNA score AND observed exposure).
    """
    from analysis.tcga_validation import _load_dcna, _match_drug_to_dcna

    try:
        _, dcna = _load_dcna()
        dcna_names = set(dcna.keys())

        # Count unique cases per therapeutic_agents_raw value
        treatments = session.execute(select(TCGATreatment)).scalars().all()
        raw_to_cases: dict[str, set[str]] = {}
        for t in treatments:
            raw = (t.therapeutic_agents_raw or "").strip()
            if not raw:
                continue
            raw_to_cases.setdefault(raw, set()).add(t.case_submitter_id)

        # Map each raw agent string -> DCNA canonical name (if resolvable)
        matches: Counter[str] = Counter()
        for raw, cases in raw_to_cases.items():
            canonical = _match_drug_to_dcna(raw)
            if canonical:
                matches[canonical] += len(cases)

        drugs = [
            ValidatableDrug(dcna_name=name, n_treated_patients=n)
            for name, n in matches.most_common()
        ]

        total_treated_cases = len({c for cs in raw_to_cases.values() for c in cs})
        return ValidatableDrugsResponse(
            drugs=drugs,
            total_dcna_drugs=len(dcna_names),
            total_tcga_treated_cases=total_treated_cases,
        )

    except Exception as e:
        logger.exception("Failed to list validatable drugs")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/drug", response_model=ValidationResponse)
def validate_drug_endpoint(
    req: ValidationRequest,
    session: Session = Depends(get_db),
):
    """Run the full validation pipeline for one drug.

    Returns predicted-responder vs non-responder survival stats (KM medians,
    log-rank p, Cox HR) on the TCGA cohort exposed to the drug.
    """
    from analysis.tcga_validation import validate_drug

    try:
        result = validate_drug(
            drug_name=req.drug_name,
            session=session,
            moa_category=req.moa_category,
            dcna_threshold=req.dcna_threshold,
            expression_threshold=req.expression_threshold,
        )

        d = asdict(result)
        d["km_responders"] = [KMPoint(**p) for p in d["km_responders"]]
        d["km_nonresponders"] = [KMPoint(**p) for p in d["km_nonresponders"]]
        return ValidationResponse(**d)

    except Exception as e:
        logger.exception("Validation failed for %s", req.drug_name)
        raise HTTPException(status_code=500, detail=str(e))
