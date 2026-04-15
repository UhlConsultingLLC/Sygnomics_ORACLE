"""Tests for TCGA integration, eligibility matching, and in-silico simulation."""

import pytest

from analysis.eligibility_matcher import (
    EligibilityMatcher,
    _parse_age_range,
    _parse_ecog_requirement,
)
from analysis.response_model import HistoricalResponseModel, MolecularResponseModel
from analysis.simulation import InSilicoSimulator
from connectors.models.tcga import (
    ClinicalData,
    GeneExpressionProfile,
    SimulatedResponse,
    TCGACase,
)
from connectors.tcga import TCGAConnector


def _make_case(
    case_id: str = "case1",
    age_days: int = 21900,  # ~60 years
    gender: str = "male",
    diagnosis: str = "Glioblastoma",
    ecog: int = 1,
) -> TCGACase:
    return TCGACase(
        case_id=case_id,
        submitter_id=f"TCGA-{case_id}",
        project_id="TCGA-GBM",
        clinical=ClinicalData(
            case_id=case_id,
            age_at_diagnosis=age_days,
            gender=gender,
            vital_status="Alive",
            primary_diagnosis=diagnosis,
            ecog_performance_status=ecog,
        ),
    )


# --- Criteria parsing tests ---


class TestCriteriaParsing:
    def test_parse_age_min(self):
        min_age, max_age = _parse_age_range("Age >= 18 years")
        assert min_age == 18
        assert max_age is None

    def test_parse_age_max(self):
        min_age, max_age = _parse_age_range("Age <= 75")
        assert max_age == 75

    def test_parse_age_range(self):
        min_age, max_age = _parse_age_range("Age >= 18, age <= 70")
        assert min_age == 18
        assert max_age == 70

    def test_parse_age_natural_language(self):
        min_age, _ = _parse_age_range("18 years or older")
        assert min_age == 18

    def test_parse_ecog_simple(self):
        max_ecog = _parse_ecog_requirement("ECOG performance status 0-2")
        assert max_ecog == 2

    def test_parse_ecog_lte(self):
        max_ecog = _parse_ecog_requirement("ECOG <= 1")
        assert max_ecog == 1

    def test_parse_ecog_none(self):
        assert _parse_ecog_requirement("No ECOG requirement") is None


# --- Eligibility matching tests ---


class TestEligibilityMatcher:
    def setup_method(self):
        self.matcher = EligibilityMatcher()

    def test_eligible_case(self):
        case = _make_case(age_days=21900, gender="male", ecog=1)
        eligible, matched, unmatched = self.matcher.match_case(
            case, "Age >= 18\nECOG 0-2", sex="ALL"
        )
        assert eligible is True
        assert any("Age" in m for m in matched)

    def test_too_young(self):
        case = _make_case(age_days=5475)  # ~15 years
        eligible, _, unmatched = self.matcher.match_case(
            case, "Age >= 18", sex="ALL"
        )
        assert eligible is False
        assert any("minimum" in u for u in unmatched)

    def test_sex_mismatch(self):
        case = _make_case(gender="male")
        eligible, _, unmatched = self.matcher.match_case(
            case, "", sex="FEMALE"
        )
        assert eligible is False

    def test_ecog_too_high(self):
        case = _make_case(ecog=3)
        eligible, _, unmatched = self.matcher.match_case(
            case, "ECOG <= 1", sex="ALL"
        )
        assert eligible is False

    def test_filter_cohort(self):
        cohort = [
            _make_case("case1", age_days=21900, ecog=1),
            _make_case("case2", age_days=5475, ecog=0),   # too young
            _make_case("case3", age_days=25550, ecog=3),   # ECOG too high
            _make_case("case4", age_days=18250, ecog=1),
        ]
        eligible, details = self.matcher.filter_cohort(
            cohort, "Age >= 18\nECOG <= 2", sex="ALL"
        )
        assert len(eligible) == 2
        assert eligible[0].case_id == "case1"
        assert eligible[1].case_id == "case4"


# --- Response model tests ---


class TestHistoricalResponseModel:
    def test_deterministic_with_seed(self):
        model1 = HistoricalResponseModel(response_rate=0.5, random_seed=42)
        model2 = HistoricalResponseModel(response_rate=0.5, random_seed=42)
        case = _make_case()

        r1 = model1.predict_response(case, "NCT1")
        r2 = model2.predict_response(case, "NCT1")
        assert r1.is_responder == r2.is_responder
        assert r1.response_magnitude == r2.response_magnitude

    def test_response_rate_approximate(self):
        model = HistoricalResponseModel(response_rate=0.3, random_seed=42)
        cases = [_make_case(f"case{i}") for i in range(1000)]
        responses = [model.predict_response(c, "NCT1") for c in cases]
        rate = sum(1 for r in responses if r.is_responder) / len(responses)
        assert 0.2 < rate < 0.4  # within reasonable range of 0.3


class TestMolecularResponseModel:
    def test_with_expression_data(self):
        model = MolecularResponseModel(
            target_genes=["EGFR", "TP53"],
            threshold_percentile=0.5,
            random_seed=42,
        )
        case = _make_case()
        expr = GeneExpressionProfile(
            case_id=case.case_id,
            gene_values={"EGFR": 8.5, "TP53": 6.2, "BRCA1": 3.1},
        )
        response = model.predict_response(case, "NCT1", expr)
        assert response.dcna_score is not None
        assert response.dcna_score > 0

    def test_without_expression_falls_back(self):
        model = MolecularResponseModel(target_genes=["EGFR"], random_seed=42)
        case = _make_case()
        response = model.predict_response(case, "NCT1", expression=None)
        assert response.dcna_score is None


# --- Full simulation tests ---


class TestInSilicoSimulator:
    def test_full_simulation(self):
        cohort = [
            _make_case(f"case{i}", age_days=21900 + i * 365, ecog=i % 3)
            for i in range(20)
        ]
        model = HistoricalResponseModel(response_rate=0.3, random_seed=42)
        simulator = InSilicoSimulator(response_model=model)

        result = simulator.run_simulation(
            trial_nct_id="NCT00000001",
            criteria_text="Age >= 18\nECOG 0-2",
            cohort=cohort,
            sex="ALL",
        )

        assert result.total_cohort == 20
        assert result.eligible_count > 0
        assert len(result.responses) == result.eligible_count
        assert 0 <= result.response_rate <= 1

    def test_simulation_summary(self):
        cohort = [_make_case(f"case{i}", age_days=21900) for i in range(10)]
        simulator = InSilicoSimulator()

        result = simulator.run_simulation(
            trial_nct_id="NCT00000001",
            criteria_text="Age >= 18",
            cohort=cohort,
        )

        summary = result.summary()
        assert summary["trial_nct_id"] == "NCT00000001"
        assert summary["total_cohort"] == 10
        assert "response_rate" in summary

    def test_empty_cohort(self):
        simulator = InSilicoSimulator()
        result = simulator.run_simulation("NCT1", "Age >= 18", cohort=[])
        assert result.eligible_count == 0
        assert result.responses == []
        assert result.response_rate == 0.0


# --- TCGA connector tests ---


class TestTCGAConnector:
    def test_load_from_nonexistent_cache(self, tmp_path):
        config_dict = {"cache_dir": str(tmp_path / "cache"), "mode": "local"}
        from config.schema import TCGAConfig
        config = TCGAConfig(**config_dict)
        connector = TCGAConnector(config)

        cases = connector.load_from_cache("TCGA-GBM")
        assert cases == []

    def test_save_and_load_cache(self, tmp_path):
        from config.schema import TCGAConfig
        config = TCGAConfig(cache_dir=str(tmp_path / "cache"))
        connector = TCGAConnector(config)

        cases = [_make_case("case1"), _make_case("case2")]
        connector.save_to_cache(cases, "TCGA-GBM")

        loaded = connector.load_from_cache("TCGA-GBM")
        assert len(loaded) == 2
        assert loaded[0].case_id == "case1"
