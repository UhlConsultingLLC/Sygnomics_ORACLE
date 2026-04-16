"""External-API connectors — ClinicalTrials.gov, ChEMBL, TCGA, MeSH, CTIS, CIViC.

Thin wrappers around each data source. Each connector handles
pagination, retry with exponential backoff, response validation via
Pydantic models (in ``connectors.models``), and local caching where
applicable. The TCGA connector operates in three modes (API / local /
auto) configurable via ``config/default_config.yaml``.
"""
