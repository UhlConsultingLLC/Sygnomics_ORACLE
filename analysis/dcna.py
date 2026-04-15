"""Drug-Constrained Network Activity (DCNA) calculation.

Computes single-sample enrichment scores for drug target gene sets
derived from ChEMBL MOA annotations.
"""

import logging

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


def compute_dcna_scores(
    expression_matrix: pd.DataFrame,
    gene_set: list[str],
    method: str = "ssgsea",
) -> pd.Series:
    """Compute DCNA scores for each sample using a drug target gene set.

    Args:
        expression_matrix: Normalized expression matrix (genes x samples).
        gene_set: List of gene symbols forming the drug-constrained gene set.
        method: Scoring method ("ssgsea" or "mean").

    Returns:
        Series mapping sample_id -> DCNA score.
    """
    # Filter gene set to genes present in the matrix
    available_genes = [g for g in gene_set if g in expression_matrix.index]

    if not available_genes:
        logger.warning("No genes from gene set found in expression matrix")
        return pd.Series(dtype=float)

    logger.info(
        "Computing DCNA with %d/%d target genes present",
        len(available_genes), len(gene_set),
    )

    if method == "mean":
        return expression_matrix.loc[available_genes].mean(axis=0)

    elif method == "ssgsea":
        return _ssgsea_scores(expression_matrix, available_genes)

    else:
        raise ValueError(f"Unknown DCNA method: {method}")


def _ssgsea_scores(
    expression_matrix: pd.DataFrame,
    gene_set: list[str],
) -> pd.Series:
    """Compute single-sample GSEA enrichment scores.

    Simplified ssGSEA implementation:
    1. Rank genes by expression for each sample.
    2. Walk down the ranked list, accumulating a running sum.
    3. Genes in the set contribute positively (weighted by rank), others negatively.
    4. The enrichment score is the sum of the running sum.
    """
    gene_set_idx = set(gene_set)
    scores = {}

    for sample in expression_matrix.columns:
        expr = expression_matrix[sample].dropna()
        if expr.empty:
            scores[sample] = 0.0
            continue

        # Rank genes by expression (descending)
        ranked = expr.sort_values(ascending=False)
        n = len(ranked)
        n_in_set = sum(1 for g in ranked.index if g in gene_set_idx)

        if n_in_set == 0 or n_in_set == n:
            scores[sample] = 0.0
            continue

        # Compute enrichment score using running sum
        running_sum = 0.0
        max_dev = 0.0

        # Weight by absolute expression rank
        ranks = np.abs(ranked.values)
        rank_sum_in_set = sum(ranks[i] for i, g in enumerate(ranked.index) if g in gene_set_idx)

        if rank_sum_in_set == 0:
            scores[sample] = 0.0
            continue

        p_hit_factor = 1.0 / rank_sum_in_set
        p_miss_factor = 1.0 / (n - n_in_set)

        for i, gene in enumerate(ranked.index):
            if gene in gene_set_idx:
                running_sum += ranks[i] * p_hit_factor
            else:
                running_sum -= p_miss_factor
            max_dev += running_sum

        scores[sample] = max_dev / n  # normalize by gene count

    return pd.Series(scores)


def classify_responders_by_dcna(
    dcna_scores: pd.Series,
    threshold: float,
) -> pd.Series:
    """Classify samples as responders/non-responders based on DCNA threshold.

    Args:
        dcna_scores: Series mapping sample_id -> DCNA score.
        threshold: DCNA score cutoff (above = responder).

    Returns:
        Boolean Series (True = responder).
    """
    return dcna_scores >= threshold


def get_gene_set_from_moa(
    session,
    intervention_id: int,
) -> list[str]:
    """Extract the drug-constrained gene set from MOA annotations.

    Args:
        session: Database session.
        intervention_id: ID of the intervention.

    Returns:
        List of target gene symbols.
    """
    from database.models import MOAAnnotationRecord

    annotations = (
        session.query(MOAAnnotationRecord)
        .filter_by(intervention_id=intervention_id)
        .all()
    )

    genes = []
    for ann in annotations:
        if ann.target_gene_symbol:
            genes.append(ann.target_gene_symbol)

    return list(set(genes))
