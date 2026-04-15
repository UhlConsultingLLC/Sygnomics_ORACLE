# CT Collection Threshold Learning

Clinical Trial Data Analysis Pipeline with MOA classification, in-silico simulation, and threshold learning.

## Overview

This pipeline automates clinical trial data retrieval, processing, and analysis for disease-focused discovery. It integrates data from ClinicalTrials.gov, ChEMBL, and TCGA to enable therapy mechanism classification, virtual trial execution, and responder threshold optimization.

## Architecture

- **Backend:** Python (FastAPI) with SQLite database
- **Frontend:** React (TypeScript) with Plotly visualizations
- **Data Sources:** ClinicalTrials.gov (MCP), ChEMBL (MCP), TCGA (GDC API + local)

## Pipeline Stages

1. **Data Acquisition** - Query ClinicalTrials.gov with disease expansion via MeSH
2. **Data Ingestion** - ETL into SQLite with normalization and deduplication
3. **MOA Classification** - Classify interventions by mechanism-of-action via ChEMBL
4. **Analysis** - Summary metrics, filtering, and stratified train/test splitting
5. **In-Silico Simulation** - Virtual trials using TCGA GBM cohort data
6. **Genomics** - DCNA and gene expression analysis with ssGSEA
7. **Threshold Learning** - Responder classification via Youden's J statistic
8. **Visualization** - Interactive Plotly charts with export capabilities

## Quick Start

```bash
# Install Python dependencies
pip install -e ".[dev]"

# Start the backend
uvicorn api.main:app --reload

# Start the frontend (in another terminal)
cd frontend
npm install
npm run dev
```

## Configuration

Edit `config/default_config.yaml` to configure database path, API settings, TCGA data access mode, and analysis parameters.

## Project Structure

```
connectors/           # API wrappers (CT.gov, ChEMBL, TCGA)
database/             # SQLAlchemy ORM, ETL, queries
moa_classification/   # Drug name resolution, MOA mapping
analysis/             # Metrics, filters, split, simulation, threshold learning
visualization/        # Plotly figures, export utilities
api/                  # FastAPI backend (REST endpoints)
frontend/             # React TypeScript app
config/               # YAML configs and validation
data/                 # Cached TCGA downloads (gitignored)
tests/                # Unit and integration tests
```
