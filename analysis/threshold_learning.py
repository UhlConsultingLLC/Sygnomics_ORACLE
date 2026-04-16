"""Threshold learning for responder classification.

Optimizes classification thresholds using ROC analysis, Youden's J statistic,
cost-based optimization, or percentile-based approaches.
"""

import logging

import numpy as np
from pydantic import BaseModel
from sklearn.metrics import auc, roc_curve

logger = logging.getLogger(__name__)


class ThresholdResult(BaseModel):
    """Result of threshold learning."""

    threshold: float
    method: str
    sensitivity: float
    specificity: float
    auc: float
    youden_j: float
    fpr_at_threshold: float
    tpr_at_threshold: float


def learn_threshold(
    scores: np.ndarray,
    labels: np.ndarray,
    method: str = "youden",
    cost_fn_ratio: float = 1.0,
    percentile: float = 0.5,
) -> ThresholdResult:
    """Learn the optimal classification threshold from scores and labels.

    Args:
        scores: Continuous prediction scores (e.g., DCNA values).
        labels: Binary ground truth (1 = responder, 0 = non-responder).
        method: "youden" (Youden's J), "cost_based", or "percentile".
        cost_fn_ratio: FN cost / FP cost ratio (for cost_based method).
        percentile: Score percentile to use as threshold (for percentile method).

    Returns:
        ThresholdResult with optimal cutoff and associated metrics.
    """
    scores = np.asarray(scores, dtype=float)
    labels = np.asarray(labels, dtype=int)

    if len(scores) != len(labels):
        raise ValueError("scores and labels must have the same length")

    if len(np.unique(labels)) < 2:
        raise ValueError("labels must contain both positive and negative examples")

    # Compute ROC curve
    fpr, tpr, thresholds = roc_curve(labels, scores)
    roc_auc = auc(fpr, tpr)

    if method == "youden":
        # Youden's J statistic: maximize sensitivity + specificity - 1
        j_scores = tpr - fpr
        best_idx = np.argmax(j_scores)

    elif method == "cost_based":
        # Minimize weighted cost: cost = FP_rate + cost_fn_ratio * FN_rate
        fn_rate = 1 - tpr
        costs = fpr + cost_fn_ratio * fn_rate
        best_idx = np.argmin(costs)

    elif method == "percentile":
        # Use a specific percentile of scores as threshold
        threshold_val = np.percentile(scores, percentile * 100)
        # Find closest ROC threshold
        best_idx = np.argmin(np.abs(thresholds - threshold_val))

    else:
        raise ValueError(f"Unknown threshold method: {method}")

    optimal_threshold = float(thresholds[best_idx])
    optimal_tpr = float(tpr[best_idx])
    optimal_fpr = float(fpr[best_idx])
    optimal_specificity = 1.0 - optimal_fpr
    youden_j = optimal_tpr - optimal_fpr

    logger.info(
        "Threshold learned (method=%s): %.4f "
        "(sensitivity=%.3f, specificity=%.3f, AUC=%.3f)",
        method, optimal_threshold, optimal_tpr, optimal_specificity, roc_auc,
    )

    return ThresholdResult(
        threshold=optimal_threshold,
        method=method,
        sensitivity=optimal_tpr,
        specificity=optimal_specificity,
        auc=roc_auc,
        youden_j=youden_j,
        fpr_at_threshold=optimal_fpr,
        tpr_at_threshold=optimal_tpr,
    )
