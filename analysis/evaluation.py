"""Classifier evaluation metrics: MAE, CI coverage, sensitivity, specificity, etc."""

import numpy as np
from pydantic import BaseModel
from sklearn.metrics import (
    confusion_matrix,
    mean_absolute_error,
)


class ClassifierMetrics(BaseModel):
    """Comprehensive classifier evaluation metrics."""

    sensitivity: float  # true positive rate (recall)
    specificity: float  # true negative rate
    ppv: float  # positive predictive value (precision)
    npv: float  # negative predictive value
    accuracy: float
    mae: float
    n_positive: int
    n_negative: int
    n_total: int


def evaluate_classifier(
    predictions: np.ndarray,
    actuals: np.ndarray,
    scores: np.ndarray | None = None,
) -> ClassifierMetrics:
    """Evaluate a binary classifier.

    Args:
        predictions: Binary predictions (0/1).
        actuals: Binary ground truth (0/1).
        scores: Optional continuous scores (for MAE against actuals).

    Returns:
        ClassifierMetrics with all evaluation measures.
    """
    predictions = np.asarray(predictions, dtype=int)
    actuals = np.asarray(actuals, dtype=int)

    cm = confusion_matrix(actuals, predictions, labels=[0, 1])
    tn, fp, fn, tp = cm.ravel()

    sensitivity = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    specificity = tn / (tn + fp) if (tn + fp) > 0 else 0.0
    ppv = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    npv = tn / (tn + fn) if (tn + fn) > 0 else 0.0
    accuracy = (tp + tn) / (tp + tn + fp + fn) if (tp + tn + fp + fn) > 0 else 0.0

    if scores is not None:
        mae = float(mean_absolute_error(actuals, scores))
    else:
        mae = float(mean_absolute_error(actuals, predictions))

    return ClassifierMetrics(
        sensitivity=round(sensitivity, 4),
        specificity=round(specificity, 4),
        ppv=round(ppv, 4),
        npv=round(npv, 4),
        accuracy=round(accuracy, 4),
        mae=round(mae, 4),
        n_positive=int(tp + fn),
        n_negative=int(tn + fp),
        n_total=len(actuals),
    )


def confidence_interval_coverage(
    true_values: np.ndarray,
    lower_bounds: np.ndarray,
    upper_bounds: np.ndarray,
) -> float:
    """Compute the proportion of true values within their confidence intervals.

    Args:
        true_values: Observed values.
        lower_bounds: Lower CI bounds.
        upper_bounds: Upper CI bounds.

    Returns:
        Coverage proportion (0 to 1).
    """
    true_values = np.asarray(true_values)
    lower_bounds = np.asarray(lower_bounds)
    upper_bounds = np.asarray(upper_bounds)

    within = (true_values >= lower_bounds) & (true_values <= upper_bounds)
    return float(np.mean(within))
