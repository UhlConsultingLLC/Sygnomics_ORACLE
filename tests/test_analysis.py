"""Tests for analysis metrics, filters, and split."""

from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from analysis.filters import apply_filters, get_filter_options
from analysis.metrics import (
    enrollment_summary,
    phase_distribution,
    status_distribution,
    trials_per_condition,
)
from analysis.models import FilterSpec, SplitResult
from analysis.split import split_trials
from config.schema import SplitConfig
from connectors.models.trial import (
    EligibilityCriteria,
    Intervention,
    Location,
    Outcome,
    Sponsor,
    Trial,
)
from database.etl import load_trials
from database.models import Base, InterventionRecord, MOAAnnotationRecord


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture
def populated_db(db_session):
    """Load a set of test trials into the database."""
    trials = [
        Trial(
            nct_id="NCT00000001",
            title="GBM Trial 1",
            status="COMPLETED",
            phase="Phase 2",
            study_type="INTERVENTIONAL",
            enrollment_count=100,
            start_date=date(2020, 1, 1),
            conditions=["Glioblastoma"],
            interventions=[Intervention(name="Temozolomide", type="DRUG")],
            outcomes=[Outcome(type="PRIMARY", measure="OS")],
            eligibility=EligibilityCriteria(criteria_text="Age >= 18", sex="ALL"),
            sponsor=Sponsor(name="NCI", type="NIH"),
            locations=[Location(city="Boston", country="United States")],
        ),
        Trial(
            nct_id="NCT00000002",
            title="GBM Trial 2",
            status="RECRUITING",
            phase="Phase 3",
            study_type="INTERVENTIONAL",
            enrollment_count=300,
            start_date=date(2022, 6, 1),
            conditions=["Glioblastoma", "Brain Tumor"],
            interventions=[Intervention(name="Bevacizumab", type="BIOLOGICAL")],
            eligibility=EligibilityCriteria(criteria_text="ECOG 0-1", sex="ALL"),
            sponsor=Sponsor(name="Genentech", type="INDUSTRY"),
            locations=[Location(city="Houston", country="United States")],
        ),
        Trial(
            nct_id="NCT00000003",
            title="Lung Cancer Trial",
            status="COMPLETED",
            phase="Phase 2",
            study_type="INTERVENTIONAL",
            enrollment_count=200,
            start_date=date(2021, 3, 15),
            conditions=["Lung Cancer"],
            interventions=[Intervention(name="Pembrolizumab", type="DRUG")],
            sponsor=Sponsor(name="Merck", type="INDUSTRY"),
            locations=[Location(city="London", country="United Kingdom")],
        ),
        Trial(
            nct_id="NCT00000004",
            title="GBM Observation",
            status="COMPLETED",
            phase="Phase 1",
            study_type="OBSERVATIONAL",
            enrollment_count=50,
            start_date=date(2019, 9, 1),
            conditions=["Glioblastoma"],
            interventions=[Intervention(name="Surgery", type="PROCEDURE")],
            sponsor=Sponsor(name="NCI", type="NIH"),
        ),
    ]
    load_trials(db_session, trials)
    return db_session


# --- Metrics tests ---


class TestMetrics:
    def test_trials_per_condition(self, populated_db):
        result = trials_per_condition(populated_db)
        cond_map = {r.condition: r.trial_count for r in result}
        assert cond_map["Glioblastoma"] == 3
        assert cond_map["Lung Cancer"] == 1

    def test_phase_distribution(self, populated_db):
        result = phase_distribution(populated_db)
        phase_map = {r.phase: r.trial_count for r in result}
        assert phase_map["Phase 2"] == 2
        assert phase_map["Phase 3"] == 1
        assert phase_map["Phase 1"] == 1

    def test_status_distribution(self, populated_db):
        result = status_distribution(populated_db)
        status_map = {r.status: r.trial_count for r in result}
        assert status_map["COMPLETED"] == 3
        assert status_map["RECRUITING"] == 1

    def test_enrollment_summary(self, populated_db):
        result = enrollment_summary(populated_db)
        assert result["total_trials"] == 4
        assert result["total_enrollment"] == 650
        assert result["min_enrollment"] == 50
        assert result["max_enrollment"] == 300


# --- Filter tests ---


class TestFilters:
    def test_filter_by_condition(self, populated_db):
        spec = FilterSpec(conditions=["Glioblastoma"])
        results = apply_filters(populated_db, spec)
        nct_ids = {r.nct_id for r in results}
        assert "NCT00000001" in nct_ids
        assert "NCT00000002" in nct_ids
        assert "NCT00000003" not in nct_ids

    def test_filter_by_status(self, populated_db):
        spec = FilterSpec(statuses=["RECRUITING"])
        results = apply_filters(populated_db, spec)
        assert len(results) == 1
        assert results[0].nct_id == "NCT00000002"

    def test_filter_by_phase(self, populated_db):
        spec = FilterSpec(phases=["Phase 2"])
        results = apply_filters(populated_db, spec)
        assert len(results) == 2

    def test_filter_by_sponsor(self, populated_db):
        spec = FilterSpec(sponsors=["NCI"])
        results = apply_filters(populated_db, spec)
        nct_ids = {r.nct_id for r in results}
        assert "NCT00000001" in nct_ids
        assert "NCT00000004" in nct_ids

    def test_filter_by_enrollment_range(self, populated_db):
        spec = FilterSpec(min_enrollment=100, max_enrollment=200)
        results = apply_filters(populated_db, spec)
        enrollments = {r.enrollment_count for r in results}
        assert all(100 <= e <= 200 for e in enrollments)

    def test_filter_by_country(self, populated_db):
        spec = FilterSpec(locations_country=["United Kingdom"])
        results = apply_filters(populated_db, spec)
        assert len(results) == 1
        assert results[0].nct_id == "NCT00000003"

    def test_filter_by_eligibility_keyword(self, populated_db):
        spec = FilterSpec(eligibility_keywords=["ECOG"])
        results = apply_filters(populated_db, spec)
        assert len(results) == 1
        assert results[0].nct_id == "NCT00000002"

    def test_empty_filter_returns_all(self, populated_db):
        spec = FilterSpec()
        results = apply_filters(populated_db, spec)
        assert len(results) == 4

    def test_combined_filters(self, populated_db):
        spec = FilterSpec(
            conditions=["Glioblastoma"],
            statuses=["COMPLETED"],
        )
        results = apply_filters(populated_db, spec)
        nct_ids = {r.nct_id for r in results}
        assert "NCT00000001" in nct_ids
        assert "NCT00000004" in nct_ids
        assert "NCT00000002" not in nct_ids  # RECRUITING, not COMPLETED

    def test_get_filter_options(self, populated_db):
        options = get_filter_options(populated_db)
        assert "Glioblastoma" in options["conditions"]
        assert "COMPLETED" in options["statuses"]
        assert "Phase 2" in options["phases"]
        assert "NCI" in options["sponsors"]


# --- Split tests ---


class TestSplit:
    def test_random_split(self, populated_db):
        nct_ids = ["NCT00000001", "NCT00000002", "NCT00000003", "NCT00000004"]
        config = SplitConfig(strategy="random", test_fraction=0.25, random_seed=42)
        result = split_trials(populated_db, nct_ids, config)

        assert len(result.train_nct_ids) + len(result.test_nct_ids) == 4
        assert len(result.test_nct_ids) == 1
        assert result.strategy == "random"

    def test_stratified_split(self, populated_db):
        nct_ids = ["NCT00000001", "NCT00000002", "NCT00000003", "NCT00000004"]
        config = SplitConfig(strategy="stratified", test_fraction=0.25, random_seed=42)
        result = split_trials(populated_db, nct_ids, config)

        all_ids = set(result.train_nct_ids + result.test_nct_ids)
        assert all_ids == set(nct_ids)

    def test_temporal_split(self, populated_db):
        nct_ids = ["NCT00000001", "NCT00000002", "NCT00000003", "NCT00000004"]
        config = SplitConfig(strategy="temporal", test_fraction=0.25)
        result = split_trials(populated_db, nct_ids, config)

        # NCT00000002 has the latest date (2022-06-01), should be in test
        assert "NCT00000002" in result.test_nct_ids

    def test_reproducibility(self, populated_db):
        nct_ids = ["NCT00000001", "NCT00000002", "NCT00000003", "NCT00000004"]
        config = SplitConfig(strategy="random", random_seed=42)
        r1 = split_trials(populated_db, nct_ids, config)
        r2 = split_trials(populated_db, nct_ids, config)
        assert r1.train_nct_ids == r2.train_nct_ids
        assert r1.test_nct_ids == r2.test_nct_ids

    def test_single_trial_goes_to_train(self, populated_db):
        result = split_trials(populated_db, ["NCT00000001"])
        assert result.train_nct_ids == ["NCT00000001"]
        assert result.test_nct_ids == []
