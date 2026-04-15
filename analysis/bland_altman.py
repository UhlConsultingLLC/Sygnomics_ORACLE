"""Bland-Altman analysis for method comparison."""

import numpy as np
import pandas as pd
from pydantic import BaseModel


class BlandAltmanResult(BaseModel):
    """Result of a Bland-Altman analysis."""

    mean_diff: float
    std_diff: float
    upper_limit: float  # mean + 1.96 * std
    lower_limit: float  # mean - 1.96 * std
    n: int


def bland_altman_analysis(
    method_a: np.ndarray,
    method_b: np.ndarray,
    confidence: float = 0.95,
) -> tuple[BlandAltmanResult, pd.DataFrame]:
    """Perform Bland-Altman analysis comparing two measurement methods.

    Args:
        method_a: Measurements from method A.
        method_b: Measurements from method B.
        confidence: Confidence level for limits of agreement.

    Returns:
        Tuple of (BlandAltmanResult summary, DataFrame with per-point data).
    """
    method_a = np.asarray(method_a, dtype=float)
    method_b = np.asarray(method_b, dtype=float)

    means = (method_a + method_b) / 2
    diffs = method_a - method_b

    mean_diff = float(np.mean(diffs))
    std_diff = float(np.std(diffs, ddof=1))

    # z-value for the given confidence level
    from scipy.stats import norm
    z = norm.ppf((1 + confidence) / 2)

    upper = mean_diff + z * std_diff
    lower = mean_diff - z * std_diff

    points_df = pd.DataFrame({
        "mean": means,
        "diff": diffs,
    })

    result = BlandAltmanResult(
        mean_diff=mean_diff,
        std_diff=std_diff,
        upper_limit=upper,
        lower_limit=lower,
        n=len(method_a),
    )

    return result, points_df
