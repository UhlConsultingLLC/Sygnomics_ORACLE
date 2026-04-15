"""Threshold learning endpoints."""

import logging
import numpy as np
from fastapi import APIRouter, HTTPException

from api.schemas import ThresholdLearnRequest, ThresholdResponse

router = APIRouter(prefix="/threshold", tags=["threshold"])

logger = logging.getLogger(__name__)


@router.post("/learn", response_model=ThresholdResponse)
def learn_threshold_endpoint(req: ThresholdLearnRequest):
    """Learn an optimal classification threshold.

    If real simulation/DCNA scores are available, uses them.
    Otherwise generates synthetic data to demonstrate the threshold learning pipeline.
    """
    from analysis.threshold_learning import learn_threshold

    try:
        # Generate synthetic demonstration data if no real data exists yet
        rng = np.random.default_rng(42)
        n_samples = 200

        # Create two overlapping distributions for responders vs non-responders
        n_pos = int(n_samples * 0.3)
        n_neg = n_samples - n_pos

        scores_pos = rng.normal(loc=0.65, scale=0.15, size=n_pos)
        scores_neg = rng.normal(loc=0.35, scale=0.15, size=n_neg)
        scores = np.concatenate([scores_pos, scores_neg])
        labels = np.concatenate([np.ones(n_pos), np.zeros(n_neg)])

        # Clip scores to [0, 1]
        scores = np.clip(scores, 0, 1)

        result = learn_threshold(
            scores=scores,
            labels=labels,
            method=req.method,
            cost_fn_ratio=req.cost_fn_ratio,
            percentile=req.percentile,
        )

        return ThresholdResponse(
            threshold=result.threshold,
            method=result.method,
            sensitivity=result.sensitivity,
            specificity=result.specificity,
            auc=result.auc,
            youden_j=result.youden_j,
        )

    except Exception as e:
        logger.error("Threshold learning failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
