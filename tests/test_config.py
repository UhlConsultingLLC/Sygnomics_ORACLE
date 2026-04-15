"""Tests for configuration loading and validation."""

import pytest
from config.schema import PipelineConfig, load_config


def test_default_config_loads():
    """Default config file should load and validate successfully."""
    config = load_config()
    assert config.database.url == "sqlite:///data/ct_pipeline.db"
    assert config.clinicaltrials.page_size == 100
    assert config.tcga.mode == "auto"
    assert config.split.strategy == "stratified"
    assert config.threshold.method == "youden"


def test_config_with_overrides():
    """Config should accept valid overrides."""
    config = PipelineConfig(
        database={"url": "sqlite:///:memory:"},
        tcga={"mode": "local", "local_path": "/data/my_tcga"},
        split={"strategy": "random", "test_fraction": 0.3},
    )
    assert config.database.url == "sqlite:///:memory:"
    assert config.tcga.mode == "local"
    assert config.tcga.local_path == "/data/my_tcga"
    assert config.split.strategy == "random"
    assert config.split.test_fraction == 0.3


def test_config_rejects_invalid_split_strategy():
    """Config should reject invalid strategy values."""
    with pytest.raises(Exception):
        PipelineConfig(split={"strategy": "invalid_strategy"})


def test_config_rejects_invalid_test_fraction():
    """Test fraction must be between 0 and 1 exclusive."""
    with pytest.raises(Exception):
        PipelineConfig(split={"test_fraction": 1.5})


def test_config_rejects_invalid_tcga_mode():
    """TCGA mode must be api, local, or auto."""
    with pytest.raises(Exception):
        PipelineConfig(tcga={"mode": "invalid"})


def test_missing_config_file_returns_defaults():
    """Loading a nonexistent config file should return defaults."""
    config = load_config("nonexistent_file.yaml")
    assert config == PipelineConfig()
