"""Response models for in-silico trial simulation.

Generates synthetic response data for virtual trial execution.
Pluggable via the ResponseModel protocol.
"""

import logging
from typing import Optional, Protocol

import numpy as np

from connectors.models.tcga import GeneExpressionProfile, SimulatedResponse, TCGACase

logger = logging.getLogger(__name__)


class ResponseModel(Protocol):
    """Protocol for response models used in simulation."""

    def predict_response(
        self,
        case: TCGACase,
        trial_nct_id: str,
        expression: Optional[GeneExpressionProfile] = None,
    ) -> SimulatedResponse: ...


class HistoricalResponseModel:
    """Generate responses based on historical response rates.

    Uses a binomial model with the given response rate to assign
    responder status. Response magnitude is drawn from a beta distribution.
    """

    def __init__(
        self,
        response_rate: float = 0.15,
        random_seed: int = 42,
    ):
        self.response_rate = response_rate
        self.rng = np.random.RandomState(random_seed)

    def predict_response(
        self,
        case: TCGACase,
        trial_nct_id: str,
        expression: Optional[GeneExpressionProfile] = None,
    ) -> SimulatedResponse:
        is_responder = self.rng.random() < self.response_rate

        # Response magnitude: higher for responders
        if is_responder:
            magnitude = self.rng.beta(2, 5)  # skewed toward lower values
        else:
            magnitude = self.rng.beta(1, 10)  # mostly near zero

        return SimulatedResponse(
            case_id=case.case_id,
            trial_nct_id=trial_nct_id,
            is_responder=is_responder,
            response_magnitude=float(magnitude),
        )


class MolecularResponseModel:
    """Generate responses informed by gene expression data.

    Uses DCNA score (drug-constrained network activity) as a predictor.
    Cases with high DCNA scores for the drug's target genes are more
    likely to respond.
    """

    def __init__(
        self,
        target_genes: list[str],
        threshold_percentile: float = 0.7,
        base_response_rate: float = 0.15,
        enhanced_response_rate: float = 0.45,
        random_seed: int = 42,
    ):
        self.target_genes = target_genes
        self.threshold_percentile = threshold_percentile
        self.base_rate = base_response_rate
        self.enhanced_rate = enhanced_response_rate
        self.rng = np.random.RandomState(random_seed)

    def _compute_target_score(self, expression: GeneExpressionProfile) -> float:
        """Compute a simple mean expression score for target genes."""
        values = [
            expression.gene_values[g]
            for g in self.target_genes
            if g in expression.gene_values
        ]
        if not values:
            return 0.0
        return float(np.mean(values))

    def predict_response(
        self,
        case: TCGACase,
        trial_nct_id: str,
        expression: Optional[GeneExpressionProfile] = None,
    ) -> SimulatedResponse:
        dcna_score = None

        if expression and self.target_genes:
            dcna_score = self._compute_target_score(expression)
            # Higher DCNA -> higher response probability
            effective_rate = (
                self.enhanced_rate
                if dcna_score > self.threshold_percentile
                else self.base_rate
            )
        else:
            effective_rate = self.base_rate

        is_responder = self.rng.random() < effective_rate
        magnitude = self.rng.beta(2, 5) if is_responder else self.rng.beta(1, 10)

        return SimulatedResponse(
            case_id=case.case_id,
            trial_nct_id=trial_nct_id,
            is_responder=is_responder,
            response_magnitude=float(magnitude),
            dcna_score=dcna_score,
        )
