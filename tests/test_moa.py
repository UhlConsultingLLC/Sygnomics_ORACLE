"""Tests for MOA classification: name resolver, categories, and classifier."""

import pytest
from unittest.mock import AsyncMock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from connectors.chembl import ChEMBLConnector
from connectors.models.chembl import Compound, Mechanism, Target
from database.models import Base, InterventionRecord, MOAAnnotationRecord
from moa_classification.classifier import MOAClassifier
from moa_classification.moa_categories import MOACategory, classify_moa
from moa_classification.name_resolver import clean_drug_name, is_drug_intervention


# --- Name resolver tests ---


class TestCleanDrugName:
    def test_strips_dosage(self):
        assert clean_drug_name("Temozolomide 200mg") == "Temozolomide"

    def test_strips_dosage_with_route(self):
        assert clean_drug_name("Temozolomide 200mg/m2 oral") == "Temozolomide"

    def test_strips_route_only(self):
        assert clean_drug_name("Pembrolizumab intravenous") == "Pembrolizumab"

    def test_strips_frequency(self):
        assert clean_drug_name("Aspirin daily") == "Aspirin"

    def test_strips_parenthetical(self):
        assert clean_drug_name("Bevacizumab (Avastin)") == "Bevacizumab"

    def test_preserves_simple_name(self):
        assert clean_drug_name("Temozolomide") == "Temozolomide"

    def test_strips_complex_dosing(self):
        result = clean_drug_name("Nivolumab 3mg/kg IV every 2 weeks")
        assert result == "Nivolumab"

    def test_handles_empty(self):
        assert clean_drug_name("") == ""

    def test_handles_whitespace(self):
        assert clean_drug_name("  Temozolomide  ") == "Temozolomide"


class TestIsDrugIntervention:
    def test_drug_is_drug(self):
        assert is_drug_intervention("DRUG") is True

    def test_biological_is_drug(self):
        assert is_drug_intervention("BIOLOGICAL") is True

    def test_procedure_is_not_drug(self):
        assert is_drug_intervention("PROCEDURE") is False

    def test_radiation_is_not_drug(self):
        assert is_drug_intervention("RADIATION") is False

    def test_device_is_not_drug(self):
        assert is_drug_intervention("DEVICE") is False


# --- MOA category tests ---


class TestClassifyMOA:
    def test_kinase_inhibitor(self):
        result = classify_moa(
            action_type="INHIBITOR",
            target_name="EGFR tyrosine kinase",
        )
        assert result == MOACategory.KINASE_INHIBITOR

    def test_checkpoint_inhibitor_pd1(self):
        result = classify_moa(
            action_type="ANTAGONIST",
            target_name="PD-1",
            mechanism_description="Anti-PD-1 monoclonal antibody",
        )
        assert result == MOACategory.CHECKPOINT_INHIBITOR

    def test_checkpoint_inhibitor_pdl1(self):
        result = classify_moa(
            mechanism_description="Binds PD-L1 on tumor cells",
        )
        assert result == MOACategory.CHECKPOINT_INHIBITOR

    def test_vegf_is_angiogenesis(self):
        result = classify_moa(target_name="VEGF receptor")
        assert result == MOACategory.ANGIOGENESIS_INHIBITOR

    def test_alkylating_agent(self):
        result = classify_moa(
            mechanism_description="DNA alkylating agent that methylates guanine"
        )
        assert result == MOACategory.ALKYLATING_AGENT

    def test_parp_inhibitor(self):
        result = classify_moa(target_name="PARP-1")
        assert result == MOACategory.PARP_INHIBITOR

    def test_non_drug_procedure(self):
        result = classify_moa(intervention_type="PROCEDURE")
        assert result == MOACategory.NON_DRUG

    def test_non_drug_radiation(self):
        result = classify_moa(intervention_type="RADIATION")
        assert result == MOACategory.NON_DRUG

    def test_unknown_fallback(self):
        result = classify_moa()
        assert result == MOACategory.UNKNOWN

    def test_action_type_inhibitor_without_keyword(self):
        result = classify_moa(action_type="INHIBITOR", target_name="Novel Target X")
        assert result == MOACategory.OTHER_TARGETED


# --- Classifier integration tests ---


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


@pytest.mark.asyncio
async def test_classify_drug_intervention(db_session):
    """Classifier should resolve a drug, get MOA, and create annotations."""
    # Set up intervention in DB
    intervention = InterventionRecord(
        name="Temozolomide 200mg",
        intervention_type="DRUG",
    )
    db_session.add(intervention)
    db_session.flush()

    # Mock ChEMBL responses
    mock_compound_search = AsyncMock(return_value={
        "compounds": [{"molecule_chembl_id": "CHEMBL1372", "pref_name": "TEMOZOLOMIDE"}]
    })
    mock_get_mechanism = AsyncMock(return_value={
        "mechanisms": [{
            "action_type": "INHIBITOR",
            "mechanism_of_action": "DNA alkylating agent",
            "target_chembl_id": "CHEMBL612545",
            "target_name": "DNA",
        }]
    })
    mock_target_search = AsyncMock(return_value={
        "targets": [{"target_chembl_id": "CHEMBL612545", "gene_symbol": ""}]
    })

    connector = ChEMBLConnector(
        mcp_compound_search=mock_compound_search,
        mcp_get_mechanism=mock_get_mechanism,
        mcp_target_search=mock_target_search,
    )
    classifier = MOAClassifier(chembl_connector=connector)

    annotations = await classifier.classify_intervention(intervention)

    assert len(annotations) >= 1
    assert annotations[0].moa_category == MOACategory.ALKYLATING_AGENT.value
    assert intervention.chembl_id == "CHEMBL1372"


@pytest.mark.asyncio
async def test_classify_non_drug_intervention(db_session):
    """Non-drug interventions should get NON_DRUG category without ChEMBL lookup."""
    intervention = InterventionRecord(
        name="Radiation Therapy",
        intervention_type="RADIATION",
    )
    db_session.add(intervention)
    db_session.flush()

    connector = ChEMBLConnector()  # No MCP callables needed
    classifier = MOAClassifier(chembl_connector=connector)

    annotations = await classifier.classify_intervention(intervention)

    assert len(annotations) == 1
    assert annotations[0].moa_category == MOACategory.NON_DRUG.value


@pytest.mark.asyncio
async def test_classify_unresolved_drug(db_session):
    """Unresolvable drugs should get UNKNOWN category."""
    intervention = InterventionRecord(
        name="Experimental Agent XYZ-999",
        intervention_type="DRUG",
    )
    db_session.add(intervention)
    db_session.flush()

    mock_compound_search = AsyncMock(return_value={"compounds": []})
    connector = ChEMBLConnector(mcp_compound_search=mock_compound_search)
    classifier = MOAClassifier(chembl_connector=connector)

    annotations = await classifier.classify_intervention(intervention)

    assert len(annotations) == 1
    assert annotations[0].moa_category == MOACategory.UNKNOWN.value
    assert "UNRESOLVED" in annotations[0].action_type


@pytest.mark.asyncio
async def test_classify_all(db_session):
    """classify_all should process all interventions in the database."""
    interventions = [
        InterventionRecord(name="Temozolomide", intervention_type="DRUG"),
        InterventionRecord(name="Surgery", intervention_type="PROCEDURE"),
    ]
    for iv in interventions:
        db_session.add(iv)
    db_session.flush()

    mock_compound_search = AsyncMock(return_value={
        "compounds": [{"molecule_chembl_id": "CHEMBL1372", "pref_name": "TEMOZOLOMIDE"}]
    })
    mock_get_mechanism = AsyncMock(return_value={
        "mechanisms": [{"action_type": "INHIBITOR", "mechanism_of_action": "Alkylating agent"}]
    })

    connector = ChEMBLConnector(
        mcp_compound_search=mock_compound_search,
        mcp_get_mechanism=mock_get_mechanism,
    )
    classifier = MOAClassifier(chembl_connector=connector)

    stats = await classifier.classify_all(db_session)

    assert stats["classified"] == 2
    assert stats["skipped"] == 0
    assert stats["failed"] == 0

    annotations = db_session.query(MOAAnnotationRecord).all()
    assert len(annotations) >= 2
