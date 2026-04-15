"""Tests for DCNA, gene expression analysis, and genomic visualizations."""

import numpy as np
import pandas as pd
import pytest

from analysis.dcna import (
    classify_responders_by_dcna,
    compute_dcna_scores,
)
from analysis.gene_expression import (
    differential_expression,
    normalize_expression,
)


@pytest.fixture
def expression_matrix():
    """Synthetic gene expression matrix: 100 genes x 20 samples."""
    rng = np.random.RandomState(42)
    genes = [f"GENE{i}" for i in range(100)]
    samples = [f"SAMPLE{i}" for i in range(20)]
    data = rng.exponential(scale=10, size=(100, 20))
    return pd.DataFrame(data, index=genes, columns=samples)


@pytest.fixture
def target_gene_set():
    """A small gene set of 10 target genes."""
    return [f"GENE{i}" for i in range(10)]


# --- Normalization tests ---


class TestNormalization:
    def test_log2_transform(self, expression_matrix):
        result = normalize_expression(expression_matrix, method="log2")
        assert result.shape == expression_matrix.shape
        # log2(x+1) should always be >= 0 for non-negative input
        assert (result >= 0).all().all()

    def test_zscore(self, expression_matrix):
        result = normalize_expression(expression_matrix, method="zscore")
        assert result.shape == expression_matrix.shape
        # Each row should have approximately mean 0, std 1
        row_means = result.mean(axis=1)
        assert (row_means.abs() < 0.01).all()

    def test_invalid_method(self, expression_matrix):
        with pytest.raises(ValueError):
            normalize_expression(expression_matrix, method="invalid")


# --- Differential expression tests ---


class TestDifferentialExpression:
    def test_basic_de(self, expression_matrix):
        # Create groups: first 10 samples vs last 10
        labels = {f"SAMPLE{i}": i < 10 for i in range(20)}

        # Inject signal: make GENE0-4 higher in group A
        modified = expression_matrix.copy()
        for i in range(5):
            modified.iloc[i, :10] += 20  # boost group A

        normalized = normalize_expression(modified)
        result = differential_expression(
            normalized, labels, min_fold_change=0.5, max_pvalue=0.05
        )

        assert len(result) > 0
        assert "gene" in result.columns
        assert "log2_fold_change" in result.columns
        # Our injected genes should show up
        found_genes = set(result["gene"].values)
        assert any(f"GENE{i}" in found_genes for i in range(5))

    def test_no_signal(self, expression_matrix):
        labels = {f"SAMPLE{i}": i < 10 for i in range(20)}
        normalized = normalize_expression(expression_matrix)
        result = differential_expression(
            normalized, labels, min_fold_change=2.0, max_pvalue=0.01
        )
        # With random data and strict thresholds, expect few or no hits
        assert len(result) < 10

    def test_insufficient_samples(self, expression_matrix):
        labels = {"SAMPLE0": True}  # only one sample per group
        result = differential_expression(expression_matrix, labels)
        assert result.empty


# --- DCNA tests ---


class TestDCNA:
    def test_mean_method(self, expression_matrix, target_gene_set):
        scores = compute_dcna_scores(expression_matrix, target_gene_set, method="mean")
        assert len(scores) == 20
        assert all(np.isfinite(scores))

    def test_ssgsea_method(self, expression_matrix, target_gene_set):
        scores = compute_dcna_scores(expression_matrix, target_gene_set, method="ssgsea")
        assert len(scores) == 20
        assert all(np.isfinite(scores))

    def test_empty_gene_set(self, expression_matrix):
        scores = compute_dcna_scores(expression_matrix, ["NONEXISTENT_GENE"])
        assert len(scores) == 0

    def test_partial_gene_set(self, expression_matrix):
        # Mix of existing and non-existing genes
        gene_set = ["GENE0", "GENE1", "FAKE_GENE"]
        scores = compute_dcna_scores(expression_matrix, gene_set, method="mean")
        assert len(scores) == 20

    def test_classify_responders(self, expression_matrix, target_gene_set):
        scores = compute_dcna_scores(expression_matrix, target_gene_set, method="mean")
        threshold = scores.median()
        classified = classify_responders_by_dcna(scores, threshold)
        assert classified.dtype == bool
        # Roughly half should be above median
        responder_count = classified.sum()
        assert 5 <= responder_count <= 15
