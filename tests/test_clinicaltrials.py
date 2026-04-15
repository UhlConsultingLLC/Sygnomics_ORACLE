"""Tests for the ClinicalTrials.gov connector and disease mapper."""

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from connectors.clinicaltrials import ClinicalTrialsConnector, _parse_trial_from_search
from connectors.disease_mapper import DiseaseMapper, KNOWN_SYNONYMS
from connectors.models.trial import Trial
from config.schema import ClinicalTrialsConfig


FIXTURES_DIR = Path(__file__).parent / "fixtures"


# --- Trial parsing tests ---


def test_parse_trial_from_fixture():
    """Parse a trial from the sample fixture file."""
    with open(FIXTURES_DIR / "sample_trial.json") as f:
        raw = json.load(f)

    trial = _parse_trial_from_search(raw)

    assert trial.nct_id == "NCT00000001"
    assert "Temozolomide" in trial.title
    assert trial.status == "COMPLETED"
    assert trial.phase == "Phase 2"
    assert trial.enrollment_count == 150
    assert len(trial.conditions) == 2
    assert "Glioblastoma Multiforme" in trial.conditions
    assert len(trial.interventions) == 2
    assert trial.interventions[0].name == "Temozolomide 200mg"
    assert trial.interventions[0].type == "DRUG"
    assert len(trial.outcomes) == 2
    assert trial.outcomes[0].type == "PRIMARY"
    assert trial.outcomes[0].measure == "Overall Survival"
    assert trial.eligibility is not None
    assert "Age >= 18" in trial.eligibility.criteria_text
    assert trial.sponsor.name == "National Cancer Institute"
    assert len(trial.locations) == 1
    assert trial.locations[0].city == "Houston"


def test_parse_trial_minimal():
    """Parse a trial with minimal fields."""
    raw = {"nct_id": "NCT99999999", "title": "Minimal Trial"}
    trial = _parse_trial_from_search(raw)
    assert trial.nct_id == "NCT99999999"
    assert trial.title == "Minimal Trial"
    assert trial.interventions == []
    assert trial.conditions == []


def test_parse_trial_alternative_field_names():
    """Parse a trial using alternative field names from different API formats."""
    raw = {
        "nctId": "NCT12345678",
        "briefTitle": "Alt Format Trial",
        "overallStatus": "RECRUITING",
        "studyType": "INTERVENTIONAL",
        "enrollment": 50,
    }
    trial = _parse_trial_from_search(raw)
    assert trial.nct_id == "NCT12345678"
    assert trial.title == "Alt Format Trial"
    assert trial.status == "RECRUITING"
    assert trial.enrollment_count == 50


# --- Disease mapper tests ---


def test_known_synonyms_gbm():
    """GBM should expand to glioblastoma-related terms."""
    mapper = DiseaseMapper()
    # Test synchronous expansion with mocked MeSH (no network)
    mapper.mesh_client.expand_disease_term = AsyncMock(return_value=[])

    terms = mapper.expand_sync("GBM")
    assert "GBM" in terms
    assert any("glioblastoma" in t.lower() for t in terms)


def test_known_synonyms_nsclc():
    """NSCLC should expand to non-small cell lung cancer terms."""
    mapper = DiseaseMapper()
    mapper.mesh_client.expand_disease_term = AsyncMock(return_value=[])

    terms = mapper.expand_sync("nsclc")
    assert any("non-small cell lung cancer" in t.lower() for t in terms)


def test_unknown_term_passthrough():
    """Unknown terms should be passed through as-is."""
    mapper = DiseaseMapper()
    mapper.mesh_client.expand_disease_term = AsyncMock(return_value=[])

    terms = mapper.expand_sync("xyzunknowndisease123")
    assert "xyzunknowndisease123" in terms


# --- Connector tests ---


@pytest.mark.asyncio
async def test_search_trials_basic():
    """search_trials should parse MCP response and return Trial objects."""
    mock_response = {
        "trials": [
            {
                "nct_id": "NCT00000001",
                "title": "Test Trial 1",
                "status": "COMPLETED",
                "conditions": ["Glioblastoma"],
                "interventions": [{"name": "Drug A", "type": "DRUG"}],
            },
            {
                "nct_id": "NCT00000002",
                "title": "Test Trial 2",
                "status": "RECRUITING",
                "conditions": ["Glioblastoma"],
                "interventions": [{"name": "Drug B", "type": "DRUG"}],
            },
        ],
        "next_page_token": None,
    }

    mock_search = AsyncMock(return_value=mock_response)
    config = ClinicalTrialsConfig(request_delay_seconds=0)
    connector = ClinicalTrialsConnector(config=config, mcp_search=mock_search)

    trials = await connector.search_trials(condition="glioblastoma")

    assert len(trials) == 2
    assert trials[0].nct_id == "NCT00000001"
    assert trials[1].nct_id == "NCT00000002"
    mock_search.assert_called_once()


@pytest.mark.asyncio
async def test_search_trials_pagination():
    """search_trials should handle multi-page responses."""
    page1 = {
        "trials": [{"nct_id": f"NCT0000000{i}", "title": f"Trial {i}"} for i in range(1, 4)],
        "next_page_token": "page2token",
    }
    page2 = {
        "trials": [{"nct_id": f"NCT0000000{i}", "title": f"Trial {i}"} for i in range(4, 6)],
        "next_page_token": None,
    }

    mock_search = AsyncMock(side_effect=[page1, page2])
    config = ClinicalTrialsConfig(request_delay_seconds=0, page_size=3)
    connector = ClinicalTrialsConnector(config=config, mcp_search=mock_search)

    trials = await connector.search_trials(condition="glioblastoma")

    assert len(trials) == 5
    assert mock_search.call_count == 2


@pytest.mark.asyncio
async def test_search_trials_retry_on_error():
    """search_trials should retry on transient errors."""
    mock_search = AsyncMock(
        side_effect=[ConnectionError("timeout"), {"trials": [{"nct_id": "NCT00000001"}]}]
    )
    config = ClinicalTrialsConfig(
        request_delay_seconds=0,
        retry_max_attempts=3,
        retry_backoff_factor=0.01,
    )
    connector = ClinicalTrialsConnector(config=config, mcp_search=mock_search)

    trials = await connector.search_trials(condition="test")
    assert len(trials) == 1
    assert mock_search.call_count == 2


@pytest.mark.asyncio
async def test_get_all_trials_deduplicates():
    """get_all_trials_for_disease should deduplicate by NCT ID across terms."""
    responses = [
        {"trials": [{"nct_id": "NCT00000001"}, {"nct_id": "NCT00000002"}]},
        {"trials": [{"nct_id": "NCT00000002"}, {"nct_id": "NCT00000003"}]},
    ]

    mock_search = AsyncMock(side_effect=responses)
    config = ClinicalTrialsConfig(request_delay_seconds=0)
    mapper = DiseaseMapper()
    mapper.mesh_client.expand_disease_term = AsyncMock(return_value=[])

    connector = ClinicalTrialsConnector(
        config=config,
        mcp_search=mock_search,
        disease_mapper=mapper,
    )

    # GBM expands to multiple terms via KNOWN_SYNONYMS
    trials = await connector.get_all_trials_for_disease("GBM", expand_terms=True)

    nct_ids = [t.nct_id for t in trials]
    assert len(nct_ids) == len(set(nct_ids)), "Should not have duplicate NCT IDs"


@pytest.mark.asyncio
async def test_get_trial_details():
    """get_trial_details should return a parsed Trial for a valid NCT ID."""
    mock_details = AsyncMock(return_value={
        "nct_id": "NCT00000001",
        "title": "Detailed Trial",
        "status": "COMPLETED",
        "eligibility": {
            "criteria_text": "Age >= 18",
            "min_age": "18 Years",
            "sex": "ALL",
        },
    })
    config = ClinicalTrialsConfig(request_delay_seconds=0)
    connector = ClinicalTrialsConnector(config=config, mcp_get_details=mock_details)

    trial = await connector.get_trial_details("NCT00000001")

    assert trial is not None
    assert trial.nct_id == "NCT00000001"
    assert trial.eligibility.criteria_text == "Age >= 18"


# --- Cache tests ---


def test_save_and_load_cache(tmp_path):
    """Trials should round-trip through JSON cache."""
    trials = [
        Trial(nct_id="NCT00000001", title="Trial 1"),
        Trial(nct_id="NCT00000002", title="Trial 2"),
    ]
    cache_path = tmp_path / "cache" / "trials.json"

    connector = ClinicalTrialsConnector()
    connector.save_trials_cache(trials, cache_path)
    loaded = connector.load_trials_cache(cache_path)

    assert len(loaded) == 2
    assert loaded[0].nct_id == "NCT00000001"
    assert loaded[1].title == "Trial 2"


def test_load_nonexistent_cache(tmp_path):
    """Loading from a nonexistent cache should return empty list."""
    connector = ClinicalTrialsConnector()
    loaded = connector.load_trials_cache(tmp_path / "nonexistent.json")
    assert loaded == []
