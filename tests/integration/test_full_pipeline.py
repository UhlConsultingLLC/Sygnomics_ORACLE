"""Integration tests for the full CT pipeline.

These tests exercise the end-to-end data flow:
  1. Trial data → ETL → SQLite
  2. MOA classification on stored interventions
  3. Analysis metrics computed from DB
  4. In-silico simulation with synthetic TCGA data
  5. Threshold learning on simulated results
  6. Bland-Altman comparison of methods
  7. Visualization generation (Plotly JSON)
  8. FastAPI serves results via REST
"""

import numpy as np
import pytest
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from analysis.bland_altman import bland_altman_analysis
from analysis.dcna import compute_dcna_scores
from analysis.evaluation import evaluate_classifier
from analysis.metrics import (
    enrollment_summary,
    interventions_by_moa,
    phase_distribution,
    status_distribution,
    trials_per_condition,
)
from analysis.simulation import InSilicoSimulator
from analysis.split import split_trials
from analysis.threshold_learning import learn_threshold
from api.dependencies import get_db
from api.routers import analysis as analysis_router, conditions, export, trials
from connectors.models.tcga import ClinicalData, GeneExpressionProfile, TCGACase
from connectors.models.trial import Intervention, Sponsor, Trial
from database.etl import load_trials
from database.models import Base
from database.queries import (
    get_all_conditions,
    get_all_interventions,
    get_all_trials,
    get_trial,
    get_trial_count,
)
from moa_classification.classifier import MOAClassifier
from moa_classification.moa_categories import MOACategory, classify_moa
from visualization.summary_plots import (
    plot_moa_distribution,
    plot_phase_distribution,
    plot_trials_per_condition,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def engine():
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def session(engine):
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


SAMPLE_TRIALS = [
    Trial(
        nct_id="NCT10000001",
        title="Phase 2 TMZ in GBM",
        status="COMPLETED",
        phase="Phase 2",
        study_type="INTERVENTIONAL",
        enrollment_count=120,
        conditions=["Glioblastoma"],
        interventions=[
            Intervention(name="Temozolomide", type="DRUG"),
            Intervention(name="Radiation Therapy", type="PROCEDURE"),
        ],
        sponsor=Sponsor(name="NCI", type="NIH"),
        start_date="2020-01-15",
    ),
    Trial(
        nct_id="NCT10000002",
        title="Phase 3 Bevacizumab in GBM",
        status="RECRUITING",
        phase="Phase 3",
        study_type="INTERVENTIONAL",
        enrollment_count=300,
        conditions=["Glioblastoma", "Brain Neoplasms"],
        interventions=[
            Intervention(name="Bevacizumab", type="BIOLOGICAL"),
        ],
        sponsor=Sponsor(name="Genentech", type="INDUSTRY"),
        start_date="2022-06-01",
    ),
    Trial(
        nct_id="NCT10000003",
        title="Phase 1 Nivolumab + Ipilimumab in GBM",
        status="ACTIVE_NOT_RECRUITING",
        phase="Phase 1",
        study_type="INTERVENTIONAL",
        enrollment_count=45,
        conditions=["Glioblastoma"],
        interventions=[
            Intervention(name="Nivolumab", type="BIOLOGICAL"),
            Intervention(name="Ipilimumab", type="BIOLOGICAL"),
        ],
        sponsor=Sponsor(name="BMS", type="INDUSTRY"),
        start_date="2023-03-20",
    ),
    Trial(
        nct_id="NCT10000004",
        title="Observational Study of GBM Biomarkers",
        status="COMPLETED",
        phase="Not Applicable",
        study_type="OBSERVATIONAL",
        enrollment_count=200,
        conditions=["Glioblastoma", "Brain Neoplasms"],
        interventions=[],
        sponsor=Sponsor(name="Mayo Clinic", type="OTHER"),
        start_date="2019-09-10",
    ),
]


@pytest.fixture
def populated_session(session):
    load_trials(session, SAMPLE_TRIALS)
    return session


# ---------------------------------------------------------------------------
# Phase 1-3: ETL + DB queries
# ---------------------------------------------------------------------------


class TestETLAndQueries:
    def test_load_and_count(self, populated_session):
        assert get_trial_count(populated_session) == 4

    def test_query_all_trials(self, populated_session):
        trials = get_all_trials(populated_session)
        assert len(trials) == 4
        nct_ids = {t.nct_id for t in trials}
        assert "NCT10000001" in nct_ids

    def test_query_single_trial(self, populated_session):
        trial = get_trial(populated_session, "NCT10000002")
        assert trial is not None
        assert trial.title == "Phase 3 Bevacizumab in GBM"
        assert "Glioblastoma" in trial.conditions

    def test_conditions_deduplicated(self, populated_session):
        conditions = get_all_conditions(populated_session)
        # Returns list of strings
        assert "Glioblastoma" in conditions
        assert "Brain Neoplasms" in conditions
        assert len(conditions) == len(set(conditions))

    def test_interventions_loaded(self, populated_session):
        interventions = get_all_interventions(populated_session)
        # Returns list of dicts with 'name' key
        names = {i["name"] for i in interventions}
        assert "Temozolomide" in names
        assert "Bevacizumab" in names


# ---------------------------------------------------------------------------
# Phase 4-5: MOA classification
# ---------------------------------------------------------------------------


class TestMOAClassification:
    def test_classify_known_action_type(self):
        cat = classify_moa(
            action_type="INHIBITOR",
            target_name="VEGFR",
            intervention_type="BIOLOGICAL",
        )
        assert cat == MOACategory.ANGIOGENESIS_INHIBITOR

    def test_classify_checkpoint_keyword(self):
        cat = classify_moa(
            action_type="ANTAGONIST",
            target_name="PD-1 receptor",
            intervention_type="BIOLOGICAL",
        )
        assert cat == MOACategory.CHECKPOINT_INHIBITOR


# ---------------------------------------------------------------------------
# Phase 4-6: Analysis metrics
# ---------------------------------------------------------------------------


class TestAnalysisMetrics:
    def test_trials_per_condition(self, populated_session):
        counts = trials_per_condition(populated_session)
        gbm = next((c for c in counts if c.condition == "Glioblastoma"), None)
        assert gbm is not None
        assert gbm.trial_count == 4

    def test_phase_distribution(self, populated_session):
        dist = phase_distribution(populated_session)
        phases = {d.phase: d.trial_count for d in dist}
        assert phases.get("Phase 2", 0) >= 1
        assert phases.get("Phase 3", 0) >= 1

    def test_status_distribution(self, populated_session):
        dist = status_distribution(populated_session)
        statuses = {d.status for d in dist}
        assert "COMPLETED" in statuses
        assert "RECRUITING" in statuses

    def test_enrollment_summary(self, populated_session):
        summary = enrollment_summary(populated_session)
        assert summary["total_trials"] == 4
        assert summary["total_enrollment"] == 120 + 300 + 45 + 200

    def test_split_random(self, populated_session):
        from config.schema import SplitConfig
        nct_ids = [t.nct_id for t in get_all_trials(populated_session)]
        config = SplitConfig(method="random", test_fraction=0.5)
        result = split_trials(populated_session, nct_ids, config)
        assert len(result.train_nct_ids) + len(result.test_nct_ids) == 4
        assert len(result.train_nct_ids) >= 1
        assert len(result.test_nct_ids) >= 1


# ---------------------------------------------------------------------------
# Phase 7-8: Simulation + Threshold
# ---------------------------------------------------------------------------


class TestSimulationAndThreshold:
    @pytest.fixture
    def cohort(self):
        cases = []
        for i in range(50):
            cases.append(TCGACase(
                case_id=f"TCGA-{i:04d}",
                project_id="TCGA-GBM",
                clinical=ClinicalData(
                    age_at_diagnosis=40 + i,
                    gender="male" if i % 2 == 0 else "female",
                    vital_status="alive",
                    primary_diagnosis="Glioblastoma",
                ),
            ))
        return cases

    @pytest.fixture
    def expression_data(self, cohort):
        rng = np.random.default_rng(42)
        profiles = {}
        for case in cohort:
            profiles[case.case_id] = GeneExpressionProfile(
                case_id=case.case_id,
                gene_values={
                    "EGFR": float(rng.normal(8, 2)),
                    "MGMT": float(rng.normal(5, 1.5)),
                    "TP53": float(rng.normal(7, 1)),
                    "PTEN": float(rng.normal(4, 2)),
                },
            )
        return profiles

    def test_simulation_basic(self, cohort):
        sim = InSilicoSimulator()
        result = sim.run_simulation(
            trial_nct_id="NCT10000001",
            criteria_text="",
            cohort=cohort,
        )
        assert result.total_cohort == 50
        assert result.eligible_count >= 0
        assert 0 <= result.response_rate <= 1

    def test_simulation_with_expression(self, cohort, expression_data):
        sim = InSilicoSimulator()
        result = sim.run_simulation(
            trial_nct_id="NCT10000001",
            criteria_text="",
            cohort=cohort,
            expression_data=expression_data,
        )
        assert result.total_cohort == 50
        summary = result.summary()
        assert "response_rate" in summary
        assert "mean_magnitude" in summary

    def test_dcna_scores(self, cohort, expression_data):
        import pandas as pd
        # Convert dict of GeneExpressionProfile to DataFrame (genes x samples)
        data = {cid: prof.gene_values for cid, prof in expression_data.items()}
        df = pd.DataFrame(data)  # genes as rows, samples as columns
        gene_set = ["EGFR", "TP53"]
        scores = compute_dcna_scores(df, gene_set, method="mean")
        assert len(scores) == len(cohort)
        for score in scores.values:
            assert isinstance(score, float)

    def test_threshold_learning(self):
        rng = np.random.default_rng(99)
        scores = rng.normal(0, 1, 100)
        labels = (scores > 0.3).astype(int)
        result = learn_threshold(scores, labels, method="youden")
        assert 0 <= result.sensitivity <= 1
        assert 0 <= result.specificity <= 1
        assert 0 <= result.auc <= 1

    def test_bland_altman(self):
        rng = np.random.default_rng(77)
        method1 = rng.normal(5, 1, 40)
        method2 = method1 + rng.normal(0.1, 0.3, 40)
        result, points_df = bland_altman_analysis(method1, method2)
        assert result.mean_diff is not None
        assert result.lower_limit < result.upper_limit

    def test_classifier_evaluation(self):
        y_true = np.array([1, 1, 0, 0, 1, 0, 1, 0])
        y_pred = np.array([1, 0, 0, 1, 1, 0, 1, 0])
        metrics = evaluate_classifier(y_true, y_pred)
        assert 0 <= metrics.sensitivity <= 1
        assert 0 <= metrics.specificity <= 1
        assert 0 <= metrics.accuracy <= 1


# ---------------------------------------------------------------------------
# Phase 9: Visualization
# ---------------------------------------------------------------------------


class TestVisualization:
    def test_trials_per_condition_plot(self, populated_session):
        data = trials_per_condition(populated_session)
        fig = plot_trials_per_condition(data)
        assert fig is not None
        json_str = fig.to_json()
        assert "data" in json_str

    def test_phase_distribution_plot(self, populated_session):
        data = phase_distribution(populated_session)
        fig = plot_phase_distribution(data)
        assert fig is not None

    def test_moa_distribution_plot(self, populated_session):
        data = interventions_by_moa(populated_session)
        fig = plot_moa_distribution(data)
        assert fig is not None


# ---------------------------------------------------------------------------
# Phase 10A: API
# ---------------------------------------------------------------------------


class TestAPIIntegration:
    @pytest.fixture
    def client(self, populated_session):
        @asynccontextmanager
        async def noop_lifespan(app):
            yield

        test_app = FastAPI(lifespan=noop_lifespan)
        test_app.include_router(trials.router)
        test_app.include_router(conditions.router)
        test_app.include_router(analysis_router.router)
        test_app.include_router(export.router)

        @test_app.get("/")
        def root():
            return {"message": "CT Pipeline API"}

        def override_get_db():
            try:
                yield populated_session
            finally:
                pass

        test_app.dependency_overrides[get_db] = override_get_db
        with TestClient(test_app) as c:
            yield c

    def test_api_trials_list(self, client):
        resp = client.get("/trials")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 4

    def test_api_trial_detail(self, client):
        resp = client.get("/trials/NCT10000001")
        assert resp.status_code == 200
        body = resp.json()
        assert body["nct_id"] == "NCT10000001"
        assert "Glioblastoma" in body["conditions"]

    def test_api_metrics(self, client):
        resp = client.get("/analysis/metrics")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total_trials"] == 4
        assert body["total_enrollment"] == 665

    def test_api_phase_distribution(self, client):
        resp = client.get("/analysis/phase-distribution")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1

    def test_api_export_csv(self, client):
        resp = client.get("/export/csv/trials")
        assert resp.status_code == 200
        assert "text/csv" in resp.headers.get("content-type", "")
        lines = resp.text.strip().split("\n")
        assert len(lines) >= 2  # header + data

    def test_api_filter(self, client):
        resp = client.post("/analysis/filter", json={"phases": ["Phase 3"]})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] >= 1
        for t in body["trials"]:
            assert t["phase"] == "Phase 3"
