"""Pydantic models for validating pipeline configuration."""

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field


class DatabaseConfig(BaseModel):
    url: str = "sqlite:///data/ct_pipeline.db"
    echo: bool = False


class ClinicalTrialsConfig(BaseModel):
    max_results_per_query: int = Field(default=1000, ge=1)
    page_size: int = Field(default=100, ge=1, le=1000)
    retry_max_attempts: int = Field(default=3, ge=1)
    retry_backoff_factor: float = Field(default=2.0, gt=0)
    request_delay_seconds: float = Field(default=0.5, ge=0)


class ChEMBLConfig(BaseModel):
    retry_max_attempts: int = Field(default=3, ge=1)
    retry_backoff_factor: float = Field(default=2.0, gt=0)
    request_delay_seconds: float = Field(default=0.5, ge=0)


class MeSHConfig(BaseModel):
    api_base_url: str = "https://id.nlm.nih.gov/mesh"
    max_related_terms: int = Field(default=20, ge=1)


class TCGAConfig(BaseModel):
    mode: Literal["api", "local", "auto"] = "auto"
    local_path: str = "data/tcga_local"
    cache_dir: str = "data/tcga_cache"
    gdc_api_base: str = "https://api.gdc.cancer.gov"
    gdc_token_path: str = ""
    default_project: str = "TCGA-GBM"


class CTISConfig(BaseModel):
    """EU Clinical Trials Information System (CTIS) connector settings."""
    max_results_per_query: int = Field(default=500, ge=1)
    page_size: int = Field(default=100, ge=1, le=100)
    retry_max_attempts: int = Field(default=3, ge=1)
    retry_backoff_factor: float = Field(default=2.0, gt=0)
    request_delay_seconds: float = Field(default=0.5, ge=0)
    fetch_details: bool = True  # Fetch full detail for richer data (slower)


class AnalysisConfig(BaseModel):
    response_rate_default: float = Field(default=0.15, ge=0, le=1)
    confidence_level: float = Field(default=0.95, gt=0, lt=1)


class SplitConfig(BaseModel):
    strategy: Literal["random", "stratified", "temporal"] = "stratified"
    test_fraction: float = Field(default=0.2, gt=0, lt=1)
    random_seed: int = 42
    stratify_by: list[str] = Field(default=["moa_category", "response_rate_bin"])


class ThresholdConfig(BaseModel):
    method: Literal["youden", "cost_based", "percentile"] = "youden"
    cost_fn_ratio: float = Field(default=1.0, gt=0)
    percentile: float = Field(default=0.5, ge=0, le=1)


class VisualizationConfig(BaseModel):
    theme: str = "plotly_white"
    color_palette: str = "Set2"
    default_export_formats: list[str] = Field(default=["png", "svg"])
    figure_width: int = Field(default=900, ge=100)
    figure_height: int = Field(default=600, ge=100)


class APIConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = Field(default=8000, ge=1, le=65535)
    cors_origins: list[str] = Field(
        default=["http://localhost:5173", "http://localhost:3000"]
    )


class PipelineConfig(BaseModel):
    database: DatabaseConfig = DatabaseConfig()
    clinicaltrials: ClinicalTrialsConfig = ClinicalTrialsConfig()
    chembl: ChEMBLConfig = ChEMBLConfig()
    ctis: CTISConfig = CTISConfig()
    mesh: MeSHConfig = MeSHConfig()
    tcga: TCGAConfig = TCGAConfig()
    analysis: AnalysisConfig = AnalysisConfig()
    split: SplitConfig = SplitConfig()
    threshold: ThresholdConfig = ThresholdConfig()
    visualization: VisualizationConfig = VisualizationConfig()
    api: APIConfig = APIConfig()


def load_config(config_path: str | Path | None = None) -> PipelineConfig:
    """Load and validate pipeline configuration from a YAML file.

    Args:
        config_path: Path to YAML config file. Defaults to config/default_config.yaml.

    Returns:
        Validated PipelineConfig instance.
    """
    if config_path is None:
        config_path = Path(__file__).parent / "default_config.yaml"
    else:
        config_path = Path(config_path)

    if not config_path.exists():
        return PipelineConfig()

    with open(config_path) as f:
        raw = yaml.safe_load(f) or {}

    return PipelineConfig(**raw)
