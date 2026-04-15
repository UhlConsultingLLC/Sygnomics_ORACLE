# CT Collection Threshold Learning - Developer Guide

## Architecture

```
CT_Collection_Threshold_Learning/
├── config/                    # Configuration loading + Pydantic validation
│   ├── default_config.yaml
│   └── schema.py
├── connectors/                # External data source clients
│   ├── clinicaltrials.py      # ClinicalTrials.gov MCP wrapper
│   ├── chembl.py              # ChEMBL MCP wrapper
│   ├── disease_mapper.py      # Disease synonym + MeSH expansion
│   ├── mesh_client.py         # NLM MeSH SPARQL API
│   ├── tcga.py                # TCGA GDC dual-mode client
│   └── models/                # Pydantic data models
│       ├── trial.py
│       ├── chembl.py
│       └── tcga.py
├── database/                  # SQLAlchemy ORM + ETL
│   ├── models.py              # ORM table definitions
│   ├── engine.py              # Engine/session factories
│   ├── etl.py                 # Trial loading with upsert
│   └── queries.py             # Query functions -> Pydantic
├── moa_classification/        # MOA classification pipeline
│   ├── classifier.py          # Orchestrator (two-pass resolution)
│   ├── moa_categories.py      # Category enum + mapping
│   └── name_resolver.py       # Drug name cleaning
├── analysis/                  # Analytical modules
│   ├── models.py              # Analysis Pydantic models
│   ├── metrics.py             # Aggregate statistics
│   ├── filters.py             # Dynamic multi-field filtering
│   ├── split.py               # Train/test splitting strategies
│   ├── eligibility_matcher.py # Trial eligibility parsing
│   ├── response_model.py      # Historical + Molecular models
│   ├── simulation.py          # In-silico trial engine
│   ├── gene_expression.py     # Expression normalization + DE
│   ├── dcna.py                # DCNA scoring via ssGSEA
│   ├── threshold_learning.py  # Youden/cost/percentile thresholds
│   ├── bland_altman.py        # Method comparison analysis
│   └── evaluation.py          # Classifier performance metrics
├── visualization/             # Plotly figure generators
│   ├── theme.py               # Shared Plotly template
│   ├── summary_plots.py       # Trial/condition charts
│   ├── genomic_plots.py       # Expression/DCNA plots
│   ├── threshold_plots.py     # ROC, confusion matrix, B-A
│   ├── comparison_plots.py    # Cross-method comparisons
│   └── export.py              # Figure/DataFrame export
├── api/                       # FastAPI REST backend
│   ├── main.py                # App setup, CORS, lifespan
│   ├── dependencies.py        # DI: config, engine, session
│   ├── schemas.py             # Request/response schemas
│   └── routers/
│       ├── trials.py
│       ├── conditions.py
│       ├── analysis.py
│       └── export.py
├── frontend/                  # React + TypeScript + Vite
│   └── src/
│       ├── types/index.ts     # TypeScript interfaces
│       ├── services/api.ts    # Axios API client
│       ├── hooks/useApi.ts    # React Query hooks
│       ├── components/        # Reusable UI components
│       └── pages/             # Route page components
├── tests/                     # pytest test suite
│   ├── test_config.py
│   ├── test_clinicaltrials.py
│   ├── test_etl.py
│   ├── test_moa.py
│   ├── test_analysis.py
│   ├── test_simulation.py
│   ├── test_genomics.py
│   ├── test_threshold.py
│   ├── test_api.py
│   └── integration/
│       └── test_full_pipeline.py
└── pyproject.toml
```

## Design Principles

1. **MCP Connector Abstraction**: All external API calls go through connector classes that accept injectable callables, making them testable without network access.

2. **Pydantic V2 Everywhere**: All data contracts use Pydantic BaseModel for validation, serialization, and documentation.

3. **SQLAlchemy 2.0 ORM**: Database layer uses the modern declarative style with `mapped_column`. SQLite for development, abstractable to PostgreSQL.

4. **Dependency Injection**: FastAPI endpoints receive DB sessions via `Depends(get_db)`, making them easy to test with overrides.

## Testing

```bash
# Run all tests
python -m pytest

# Run specific phase
python -m pytest tests/test_api.py -v

# Run integration tests only
python -m pytest tests/integration/ -v

# With coverage
python -m pytest --cov=. --cov-report=html
```

### Test Architecture

- **Unit tests** (`tests/test_*.py`): Each module tested in isolation with in-memory SQLite and mock callables
- **Integration tests** (`tests/integration/test_full_pipeline.py`): End-to-end flow from ETL through API serving

Key testing patterns:
- `StaticPool` for SQLite in-memory to share across threads (required for TestClient)
- `check_same_thread=False` for cross-thread SQLite access
- Separate `FastAPI()` instance in tests to avoid lifespan conflicts

## Adding New Features

### New MCP Connector

1. Create `connectors/new_source.py` with async client class
2. Add Pydantic models in `connectors/models/`
3. Add connector config to `config/schema.py`
4. Write tests with injectable mock callables

### New Analysis Module

1. Add module in `analysis/`
2. Define result models in `analysis/models.py`
3. Add visualization in `visualization/`
4. Create API endpoint in `api/routers/`
5. Add TypeScript types in `frontend/src/types/`
6. Create React page in `frontend/src/pages/`

### New API Endpoint

1. Add Pydantic schema in `api/schemas.py`
2. Create route in appropriate `api/routers/` file
3. Add corresponding TypeScript types and API function
4. Create React Query hook in `hooks/useApi.ts`

## Key Dependencies

| Package | Purpose |
|---|---|
| SQLAlchemy 2.0 | ORM + database abstraction |
| Pydantic V2 | Data validation + serialization |
| FastAPI | REST API framework |
| httpx | Async HTTP client (MeSH, TCGA) |
| numpy/scipy | Statistical computations |
| pandas | DataFrames for analysis |
| scikit-learn | ROC curves, AUC |
| plotly | Interactive visualizations |
| React 19 | Frontend UI framework |
| @tanstack/react-query | Server state management |
| react-plotly.js | Plotly React wrapper |
| axios | HTTP client |
| react-router-dom v6 | Client-side routing |
