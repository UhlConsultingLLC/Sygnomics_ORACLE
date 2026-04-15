"""Shared pytest fixtures for the CT Pipeline test suite."""

import json
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from config.schema import PipelineConfig, load_config


FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def config() -> PipelineConfig:
    """Provide a default pipeline configuration for testing."""
    return PipelineConfig(
        database={"url": "sqlite:///:memory:", "echo": False},
    )


@pytest.fixture
def db_engine(config):
    """Create an in-memory SQLite engine for testing."""
    engine = create_engine(config.database.url, echo=config.database.echo)
    # Import here to avoid circular imports; models must be defined first
    try:
        from database.models import Base
        Base.metadata.create_all(engine)
    except ImportError:
        pass  # Models not yet created
    yield engine
    engine.dispose()


@pytest.fixture
def db_session(db_engine) -> Session:
    """Provide a transactional database session that rolls back after each test."""
    session_factory = sessionmaker(bind=db_engine)
    session = session_factory()
    yield session
    session.rollback()
    session.close()


@pytest.fixture
def sample_trial_json() -> dict:
    """Load a sample trial JSON fixture."""
    fixture_path = FIXTURES_DIR / "sample_trial.json"
    if fixture_path.exists():
        with open(fixture_path) as f:
            return json.load(f)
    return {
        "nct_id": "NCT00000001",
        "title": "Test Trial for GBM Treatment",
        "status": "COMPLETED",
        "phase": "Phase 2",
        "study_type": "INTERVENTIONAL",
        "enrollment_count": 100,
        "conditions": ["Glioblastoma Multiforme"],
        "interventions": [
            {
                "name": "Temozolomide",
                "type": "DRUG",
            }
        ],
        "sponsor": {"name": "Test University", "type": "ACADEMIC"},
    }
