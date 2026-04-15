"""In-silico trial simulation engine.

Takes trial eligibility criteria and a TCGA cohort, filters by eligibility,
and generates synthetic responses using a configurable response model.
"""

import logging
from typing import Optional

from analysis.eligibility_matcher import EligibilityMatcher
from analysis.response_model import HistoricalResponseModel, ResponseModel
from connectors.models.tcga import (
    GeneExpressionProfile,
    SimulatedResponse,
    TCGACase,
)

logger = logging.getLogger(__name__)


class SimulationResult:
    """Container for in-silico simulation results."""

    def __init__(
        self,
        trial_nct_id: str,
        total_cohort: int,
        eligible_count: int,
        responses: list[SimulatedResponse],
        eligibility_details: list[dict],
    ):
        self.trial_nct_id = trial_nct_id
        self.total_cohort = total_cohort
        self.eligible_count = eligible_count
        self.responses = responses
        self.eligibility_details = eligibility_details

    @property
    def response_rate(self) -> float:
        if not self.responses:
            return 0.0
        return sum(1 for r in self.responses if r.is_responder) / len(self.responses)

    @property
    def responder_count(self) -> int:
        return sum(1 for r in self.responses if r.is_responder)

    def summary(self) -> dict:
        return {
            "trial_nct_id": self.trial_nct_id,
            "total_cohort": self.total_cohort,
            "eligible_count": self.eligible_count,
            "responder_count": self.responder_count,
            "response_rate": round(self.response_rate, 4),
            "mean_magnitude": round(
                sum(r.response_magnitude for r in self.responses) / len(self.responses), 4
            ) if self.responses else 0.0,
        }


class InSilicoSimulator:
    """Executes virtual trials using TCGA cohort data."""

    def __init__(
        self,
        response_model: Optional[ResponseModel] = None,
        eligibility_matcher: Optional[EligibilityMatcher] = None,
    ):
        self.response_model = response_model or HistoricalResponseModel()
        self.matcher = eligibility_matcher or EligibilityMatcher()

    def run_simulation(
        self,
        trial_nct_id: str,
        criteria_text: str,
        cohort: list[TCGACase],
        expression_data: Optional[dict[str, GeneExpressionProfile]] = None,
        min_age_str: str = "",
        max_age_str: str = "",
        sex: str = "ALL",
        molecular_requirements: Optional[dict[str, str]] = None,
    ) -> SimulationResult:
        """Run an in-silico trial simulation.

        Args:
            trial_nct_id: NCT ID of the trial being simulated.
            criteria_text: Free-text eligibility criteria.
            cohort: TCGA patient cohort.
            expression_data: Optional gene expression profiles keyed by case_id.
            min_age_str: Structured min age from trial.
            max_age_str: Structured max age from trial.
            sex: Sex requirement.
            molecular_requirements: Optional molecular marker requirements from
                WHO extractor for subtype-aware filtering (keys: idh_status,
                codeletion_1p19q, mgmt_status, cdkn2a_status, h3k27m_status;
                values: required, excluded, any, mentioned, unknown).

        Returns:
            SimulationResult with eligible cohort and predicted responses.
        """
        # Filter by eligibility (including molecular subtype if provided)
        eligible, details = self.matcher.filter_cohort(
            cohort, criteria_text, min_age_str, max_age_str, sex,
            molecular_requirements=molecular_requirements,
        )

        logger.info(
            "Simulation for %s: %d/%d eligible",
            trial_nct_id, len(eligible), len(cohort),
        )

        # Generate responses
        responses = []
        for case in eligible:
            expr = None
            if expression_data:
                expr = expression_data.get(case.case_id)

            response = self.response_model.predict_response(
                case, trial_nct_id, expr
            )
            responses.append(response)

        result = SimulationResult(
            trial_nct_id=trial_nct_id,
            total_cohort=len(cohort),
            eligible_count=len(eligible),
            responses=responses,
            eligibility_details=details,
        )

        logger.info(
            "Simulation complete: %d responders / %d eligible (%.1f%%)",
            result.responder_count,
            result.eligible_count,
            result.response_rate * 100,
        )

        return result
