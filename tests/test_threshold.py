"""Tests for threshold learning, evaluation, and Bland-Altman analysis."""

import numpy as np
import pytest

from analysis.bland_altman import bland_altman_analysis
from analysis.evaluation import (
    confidence_interval_coverage,
    evaluate_classifier,
)
from analysis.threshold_learning import ThresholdResult, learn_threshold


@pytest.fixture
def synthetic_data():
    """Synthetic data with known optimal threshold around 0.5."""
    rng = np.random.RandomState(42)
    n = 200
    labels = np.array([0] * 100 + [1] * 100)
    # Non-responders: scores around 0.3; responders: around 0.7
    scores = np.concatenate([
        rng.normal(0.3, 0.15, 100),
        rng.normal(0.7, 0.15, 100),
    ])
    return scores, labels


# --- Threshold learning tests ---


class TestThresholdLearning:
    def test_youden_method(self, synthetic_data):
        scores, labels = synthetic_data
        result = learn_threshold(scores, labels, method="youden")

        assert isinstance(result, ThresholdResult)
        assert result.method == "youden"
        # Threshold should be roughly between 0.3 and 0.7
        assert 0.2 < result.threshold < 0.8
        assert result.sensitivity > 0.7
        assert result.specificity > 0.7
        assert result.auc > 0.8

    def test_cost_based_method(self, synthetic_data):
        scores, labels = synthetic_data
        result = learn_threshold(scores, labels, method="cost_based", cost_fn_ratio=2.0)

        assert result.method == "cost_based"
        # With higher FN cost, threshold should be lower (more sensitive)
        youden_result = learn_threshold(scores, labels, method="youden")
        assert result.threshold <= youden_result.threshold + 0.1

    def test_percentile_method(self, synthetic_data):
        scores, labels = synthetic_data
        result = learn_threshold(scores, labels, method="percentile", percentile=0.5)

        assert result.method == "percentile"
        # Should be near the median of scores
        assert abs(result.threshold - np.median(scores)) < 0.15

    def test_invalid_method(self, synthetic_data):
        scores, labels = synthetic_data
        with pytest.raises(ValueError, match="Unknown threshold method"):
            learn_threshold(scores, labels, method="invalid")

    def test_mismatched_lengths(self):
        with pytest.raises(ValueError):
            learn_threshold(np.array([1, 2, 3]), np.array([0, 1]))

    def test_single_class_labels(self):
        with pytest.raises(ValueError, match="both positive and negative"):
            learn_threshold(np.array([1, 2, 3]), np.array([0, 0, 0]))

    def test_perfect_separation(self):
        scores = np.array([0.1, 0.2, 0.3, 0.8, 0.9, 1.0])
        labels = np.array([0, 0, 0, 1, 1, 1])
        result = learn_threshold(scores, labels, method="youden")

        assert result.auc > 0.99
        assert result.sensitivity > 0.99
        assert result.specificity > 0.99


# --- Evaluation tests ---


class TestEvaluation:
    def test_perfect_classifier(self):
        actuals = np.array([0, 0, 1, 1])
        predictions = np.array([0, 0, 1, 1])
        metrics = evaluate_classifier(predictions, actuals)

        assert metrics.sensitivity == 1.0
        assert metrics.specificity == 1.0
        assert metrics.ppv == 1.0
        assert metrics.npv == 1.0
        assert metrics.accuracy == 1.0
        assert metrics.mae == 0.0

    def test_all_wrong(self):
        actuals = np.array([0, 0, 1, 1])
        predictions = np.array([1, 1, 0, 0])
        metrics = evaluate_classifier(predictions, actuals)

        assert metrics.sensitivity == 0.0
        assert metrics.specificity == 0.0
        assert metrics.accuracy == 0.0

    def test_mixed_performance(self):
        actuals = np.array([0, 0, 0, 1, 1, 1, 1, 1])
        predictions = np.array([0, 0, 1, 0, 1, 1, 1, 1])
        metrics = evaluate_classifier(predictions, actuals)

        assert 0 < metrics.sensitivity < 1
        assert 0 < metrics.specificity < 1
        assert metrics.n_total == 8

    def test_with_continuous_scores(self):
        actuals = np.array([0, 0, 1, 1])
        predictions = np.array([0, 0, 1, 1])
        scores = np.array([0.1, 0.3, 0.7, 0.9])
        metrics = evaluate_classifier(predictions, actuals, scores=scores)
        assert metrics.mae > 0  # MAE from continuous scores vs binary actuals


# --- Bland-Altman tests ---


class TestBlandAltman:
    def test_identical_methods(self):
        values = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        result, df = bland_altman_analysis(values, values)

        assert result.mean_diff == 0.0
        assert result.n == 5
        assert len(df) == 5

    def test_systematic_bias(self):
        method_a = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        method_b = method_a - 1.0  # A consistently 1.0 higher
        result, df = bland_altman_analysis(method_a, method_b)

        assert abs(result.mean_diff - 1.0) < 0.01
        # With zero variance, limits equal the mean
        assert result.upper_limit >= result.mean_diff
        assert result.lower_limit <= result.mean_diff

    def test_random_agreement(self):
        rng = np.random.RandomState(42)
        method_a = rng.normal(10, 2, 100)
        method_b = method_a + rng.normal(0, 0.5, 100)
        result, df = bland_altman_analysis(method_a, method_b)

        assert abs(result.mean_diff) < 0.5
        assert result.n == 100


# --- CI coverage tests ---


class TestCICoverage:
    def test_perfect_coverage(self):
        true_vals = np.array([1, 2, 3, 4, 5])
        lower = np.array([0, 1, 2, 3, 4])
        upper = np.array([2, 3, 4, 5, 6])
        assert confidence_interval_coverage(true_vals, lower, upper) == 1.0

    def test_no_coverage(self):
        true_vals = np.array([10, 20, 30])
        lower = np.array([0, 0, 0])
        upper = np.array([1, 1, 1])
        assert confidence_interval_coverage(true_vals, lower, upper) == 0.0

    def test_partial_coverage(self):
        true_vals = np.array([1, 5, 10])
        lower = np.array([0, 0, 0])
        upper = np.array([2, 2, 2])
        coverage = confidence_interval_coverage(true_vals, lower, upper)
        assert abs(coverage - 1 / 3) < 0.01
