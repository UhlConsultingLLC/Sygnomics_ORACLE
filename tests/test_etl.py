"""Tests for the ETL pipeline and database queries."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from connectors.models.trial import (
    EligibilityCriteria,
    Intervention,
    Location,
    Outcome,
    Sponsor,
    StudyArm,
    Trial,
)
from database.models import Base, ConditionRecord, InterventionRecord, TrialRecord
from database.etl import load_trial, load_trials
from database.queries import (
    get_all_conditions,
    get_all_trials,
    get_trial,
    get_trial_count,
    get_trials_by_condition,
    get_trials_by_intervention,
    get_trials_by_status,
)


@pytest.fixture
def db_session():
    """Create an in-memory SQLite database and session."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


def _make_trial(nct_id: str = "NCT00000001", **kwargs) -> Trial:
    """Helper to create a Trial with defaults."""
    defaults = {
        "nct_id": nct_id,
        "title": f"Trial {nct_id}",
        "status": "COMPLETED",
        "phase": "Phase 2",
        "study_type": "INTERVENTIONAL",
        "enrollment_count": 100,
        "conditions": ["Glioblastoma Multiforme"],
        "interventions": [Intervention(name="Temozolomide", type="DRUG")],
        "outcomes": [Outcome(type="PRIMARY", measure="Overall Survival", time_frame="24 months")],
        "arms": [StudyArm(label="Treatment", type="EXPERIMENTAL")],
        "eligibility": EligibilityCriteria(
            criteria_text="Age >= 18", min_age="18 Years", sex="ALL"
        ),
        "sponsor": Sponsor(name="NCI", type="NIH"),
        "locations": [Location(facility="Test Hospital", city="Boston", country="United States")],
    }
    defaults.update(kwargs)
    return Trial(**defaults)


class TestLoadTrial:
    def test_load_single_trial(self, db_session):
        trial = _make_trial()
        record = load_trial(db_session, trial)
        db_session.commit()

        assert record.nct_id == "NCT00000001"
        assert record.title == "Trial NCT00000001"
        assert len(record.conditions) == 1
        assert record.conditions[0].name == "Glioblastoma Multiforme"
        assert len(record.interventions) == 1
        assert record.interventions[0].name == "Temozolomide"

    def test_upsert_updates_existing(self, db_session):
        trial_v1 = _make_trial(title="Original Title", enrollment_count=50)
        load_trial(db_session, trial_v1)
        db_session.commit()

        trial_v2 = _make_trial(title="Updated Title", enrollment_count=200)
        load_trial(db_session, trial_v2)
        db_session.commit()

        # Should be one record, not two
        count = db_session.query(TrialRecord).count()
        assert count == 1

        record = db_session.get(TrialRecord, "NCT00000001")
        assert record.title == "Updated Title"
        assert record.enrollment_count == 200

    def test_load_trial_with_multiple_conditions(self, db_session):
        trial = _make_trial(conditions=["GBM", "Glioblastoma", "Brain Cancer"])
        load_trial(db_session, trial)
        db_session.commit()

        record = db_session.get(TrialRecord, "NCT00000001")
        cond_names = sorted([c.name for c in record.conditions])
        assert cond_names == ["Brain Cancer", "GBM", "Glioblastoma"]

    def test_shared_conditions_across_trials(self, db_session):
        trial1 = _make_trial("NCT00000001", conditions=["GBM"])
        trial2 = _make_trial("NCT00000002", conditions=["GBM", "Brain Tumor"])
        load_trial(db_session, trial1)
        load_trial(db_session, trial2)
        db_session.commit()

        # GBM should be a single condition record shared by both trials
        gbm_count = db_session.query(ConditionRecord).filter_by(name="GBM").count()
        assert gbm_count == 1

        gbm = db_session.query(ConditionRecord).filter_by(name="GBM").first()
        assert len(gbm.trials) == 2

    def test_load_trial_without_eligibility(self, db_session):
        trial = _make_trial(eligibility=None)
        record = load_trial(db_session, trial)
        db_session.commit()
        assert record.eligibility is None

    def test_load_trial_without_sponsor(self, db_session):
        trial = _make_trial(sponsor=None)
        record = load_trial(db_session, trial)
        db_session.commit()
        assert record.sponsor is None


class TestLoadTrials:
    def test_load_multiple_trials(self, db_session):
        trials = [
            _make_trial("NCT00000001"),
            _make_trial("NCT00000002"),
            _make_trial("NCT00000003"),
        ]
        records = load_trials(db_session, trials)
        assert len(records) == 3
        assert get_trial_count(db_session) == 3


class TestQueries:
    @pytest.fixture(autouse=True)
    def setup_data(self, db_session):
        self.session = db_session
        trials = [
            _make_trial(
                "NCT00000001",
                status="COMPLETED",
                conditions=["GBM"],
                interventions=[Intervention(name="Temozolomide", type="DRUG")],
            ),
            _make_trial(
                "NCT00000002",
                status="RECRUITING",
                conditions=["GBM", "Brain Tumor"],
                interventions=[Intervention(name="Bevacizumab", type="BIOLOGICAL")],
            ),
            _make_trial(
                "NCT00000003",
                status="COMPLETED",
                conditions=["Lung Cancer"],
                interventions=[Intervention(name="Pembrolizumab", type="DRUG")],
            ),
        ]
        load_trials(db_session, trials)

    def test_get_trial(self):
        trial = get_trial(self.session, "NCT00000001")
        assert trial is not None
        assert trial.nct_id == "NCT00000001"
        assert "GBM" in trial.conditions

    def test_get_trial_not_found(self):
        assert get_trial(self.session, "NCT99999999") is None

    def test_get_all_trials(self):
        trials = get_all_trials(self.session)
        assert len(trials) == 3

    def test_get_trials_by_condition(self):
        trials = get_trials_by_condition(self.session, "GBM")
        nct_ids = {t.nct_id for t in trials}
        assert "NCT00000001" in nct_ids
        assert "NCT00000002" in nct_ids
        assert "NCT00000003" not in nct_ids

    def test_get_trials_by_intervention(self):
        trials = get_trials_by_intervention(self.session, "Temozolomide")
        assert len(trials) == 1
        assert trials[0].nct_id == "NCT00000001"

    def test_get_trials_by_status(self):
        completed = get_trials_by_status(self.session, "COMPLETED")
        assert len(completed) == 2

        recruiting = get_trials_by_status(self.session, "RECRUITING")
        assert len(recruiting) == 1

    def test_get_all_conditions(self):
        conditions = get_all_conditions(self.session)
        assert "GBM" in conditions
        assert "Lung Cancer" in conditions

    def test_get_trial_count(self):
        assert get_trial_count(self.session) == 3
