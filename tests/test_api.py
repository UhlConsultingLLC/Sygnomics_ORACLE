"""Tests for the FastAPI backend endpoints."""

from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from api.dependencies import get_db
from api.routers import analysis, conditions, export, trials
from connectors.models.trial import Intervention, Sponsor, Trial
from database.etl import load_trials
from database.models import Base


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture
def populated_db(db_session):
    trials_data = [
        Trial(
            nct_id="NCT00000001",
            title="GBM Trial 1",
            status="COMPLETED",
            phase="Phase 2",
            study_type="INTERVENTIONAL",
            enrollment_count=100,
            conditions=["Glioblastoma"],
            interventions=[Intervention(name="Temozolomide", type="DRUG")],
            sponsor=Sponsor(name="NCI", type="NIH"),
        ),
        Trial(
            nct_id="NCT00000002",
            title="GBM Trial 2",
            status="RECRUITING",
            phase="Phase 3",
            enrollment_count=250,
            conditions=["Glioblastoma", "Brain Tumor"],
            interventions=[Intervention(name="Bevacizumab", type="BIOLOGICAL")],
            sponsor=Sponsor(name="Genentech", type="INDUSTRY"),
        ),
    ]
    load_trials(db_session, trials_data)
    return db_session


@pytest.fixture
def client(populated_db):
    """TestClient with a fresh FastAPI app using the test DB session."""

    @asynccontextmanager
    async def noop_lifespan(app):
        yield

    test_app = FastAPI(title="CT Pipeline API", version="0.1.0", lifespan=noop_lifespan)
    test_app.include_router(trials.router)
    test_app.include_router(conditions.router)
    test_app.include_router(analysis.router)
    test_app.include_router(export.router)

    @test_app.get("/")
    def root():
        return {"message": "CT Pipeline API", "version": "0.1.0"}

    @test_app.get("/health")
    def health():
        return {"status": "ok"}

    def override_get_db():
        try:
            yield populated_db
        finally:
            pass

    test_app.dependency_overrides[get_db] = override_get_db
    with TestClient(test_app) as c:
        yield c


class TestRootEndpoints:
    def test_root(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        assert resp.json()["version"] == "0.1.0"

    def test_health(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


class TestTrialEndpoints:
    def test_list_trials(self, client):
        resp = client.get("/trials")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert len(data["trials"]) == 2

    def test_list_trials_by_condition(self, client):
        resp = client.get("/trials?condition=Glioblastoma")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2

    def test_get_trial_detail(self, client):
        resp = client.get("/trials/NCT00000001")
        assert resp.status_code == 200
        data = resp.json()
        assert data["nct_id"] == "NCT00000001"
        assert data["title"] == "GBM Trial 1"

    def test_get_trial_not_found(self, client):
        resp = client.get("/trials/NCT99999999")
        assert resp.status_code == 404


class TestConditionEndpoints:
    def test_list_conditions(self, client):
        resp = client.get("/conditions")
        assert resp.status_code == 200
        data = resp.json()
        names = [c["name"] for c in data]
        assert "Glioblastoma" in names
        # Verify each item has name and trial_count
        for item in data:
            assert "name" in item
            assert "trial_count" in item

    def test_suggest_conditions(self, client):
        resp = client.post("/conditions/suggest", json={"disease": "GBM"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["original"] == "GBM"
        assert len(data["expanded_terms"]) > 0


class TestAnalysisEndpoints:
    def test_get_metrics(self, client):
        resp = client.get("/analysis/metrics")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_trials"] == 2
        assert data["total_enrollment"] == 350

    def test_trials_per_condition(self, client):
        resp = client.get("/analysis/trials-per-condition")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) > 0

    def test_phase_distribution(self, client):
        resp = client.get("/analysis/phase-distribution")
        assert resp.status_code == 200

    def test_filter_options(self, client):
        resp = client.get("/analysis/filter-options")
        assert resp.status_code == 200
        data = resp.json()
        assert "conditions" in data
        assert "phases" in data

    def test_filter_trials(self, client):
        resp = client.post("/analysis/filter", json={"statuses": ["COMPLETED"]})
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["trials"][0]["nct_id"] == "NCT00000001"

    def test_filter_empty(self, client):
        resp = client.post("/analysis/filter", json={})
        assert resp.status_code == 200
        assert resp.json()["total"] == 2


class TestExportEndpoints:
    def test_export_csv(self, client):
        resp = client.get("/export/csv/trials")
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]
        assert "NCT00000001" in resp.text

    def test_export_json(self, client):
        resp = client.get("/export/json/trials")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
