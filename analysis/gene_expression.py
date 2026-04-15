"""Gene expression processing: normalization and differential expression."""

import logging
from typing import Optional

import numpy as np
import pandas as pd
from scipy import stats

logger = logging.getLogger(__name__)


def normalize_expression(
    matrix: pd.DataFrame, method: str = "log2"
) -> pd.DataFrame:
    """Normalize a gene expression matrix.

    Args:
        matrix: DataFrame with genes as rows, samples as columns.
        method: "log2" for log2(x+1) transform, "zscore" for z-score normalization.

    Returns:
        Normalized DataFrame.
    """
    if method == "log2":
        return np.log2(matrix + 1)
    elif method == "zscore":
        return matrix.apply(stats.zscore, axis=1, result_type="broadcast")
    else:
        raise ValueError(f"Unknown normalization method: {method}")


def differential_expression(
    matrix: pd.DataFrame,
    group_labels: dict[str, bool],
    min_fold_change: float = 1.0,
    max_pvalue: float = 0.05,
) -> pd.DataFrame:
    """Compute differential expression between two groups.

    Args:
        matrix: Normalized expression matrix (genes x samples).
        group_labels: Dict mapping sample_id -> True (group A) or False (group B).
        min_fold_change: Minimum absolute log2 fold change to report.
        max_pvalue: Maximum p-value threshold.

    Returns:
        DataFrame with columns: gene, log2_fold_change, pvalue, adjusted_pvalue.
    """
    group_a_cols = [s for s, is_a in group_labels.items() if is_a and s in matrix.columns]
    group_b_cols = [s for s, is_a in group_labels.items() if not is_a and s in matrix.columns]

    if len(group_a_cols) < 2 or len(group_b_cols) < 2:
        logger.warning("Insufficient samples for differential expression (need >=2 per group)")
        return pd.DataFrame(columns=["gene", "log2_fold_change", "pvalue", "adjusted_pvalue"])

    results = []
    for gene in matrix.index:
        a_values = matrix.loc[gene, group_a_cols].values.astype(float)
        b_values = matrix.loc[gene, group_b_cols].values.astype(float)

        mean_a = np.mean(a_values)
        mean_b = np.mean(b_values)
        log2_fc = mean_a - mean_b  # already in log2 space if normalized

        try:
            _, pvalue = stats.ttest_ind(a_values, b_values, equal_var=False)
        except Exception:
            pvalue = 1.0

        if np.isnan(pvalue):
            pvalue = 1.0

        results.append({
            "gene": gene,
            "log2_fold_change": log2_fc,
            "pvalue": pvalue,
            "mean_group_a": mean_a,
            "mean_group_b": mean_b,
        })

    df = pd.DataFrame(results)

    if df.empty:
        df["adjusted_pvalue"] = []
        return df

    # Benjamini-Hochberg correction
    df = df.sort_values("pvalue")
    n = len(df)
    df["adjusted_pvalue"] = df["pvalue"] * n / (np.arange(1, n + 1))
    df["adjusted_pvalue"] = df["adjusted_pvalue"].clip(upper=1.0)
    df["adjusted_pvalue"] = df["adjusted_pvalue"][::-1].cummin()[::-1]

    # Filter
    df = df[
        (df["adjusted_pvalue"] <= max_pvalue) &
        (df["log2_fold_change"].abs() >= min_fold_change)
    ].sort_values("adjusted_pvalue")

    return df.reset_index(drop=True)
