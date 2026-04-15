# CT Collection Threshold Learning - User Guide

## Overview

This pipeline automates clinical trial data retrieval, MOA classification, in-silico simulation, threshold learning, and interactive visualization for clinical trial analysis.

## Quick Start

### 1. Install Dependencies

```bash
pip install -e .
```

### 2. Start the Backend API

```bash
uvicorn api.main:app --reload --port 8000
```

### 3. Start the Frontend (Development)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## Pipeline Workflow

### Step 1: Data Acquisition

The pipeline retrieves clinical trial data from ClinicalTrials.gov using the MCP connector. Disease terms are automatically expanded using:
- Hardcoded synonym mappings (e.g., GBM -> Glioblastoma Multiforme)
- NLM MeSH API hierarchical term expansion

```python
from connectors.clinicaltrials import ClinicalTrialsConnector
from connectors.disease_mapper import DiseaseMapper

mapper = DiseaseMapper()
terms = mapper.expand("GBM")
# Returns: ['Glioblastoma', 'Glioblastoma Multiforme', ...]
```

### Step 2: Database Storage

Retrieved trials are stored in SQLite via SQLAlchemy ORM with full normalization:
- Trials, Conditions, Interventions (M2M relationships)
- Sponsors, Outcomes, Arms, Eligibility criteria

### Step 3: MOA Classification

Each drug intervention is classified by Mechanism of Action using ChEMBL:
1. Drug name cleaning (strip dosage, route info)
2. ChEMBL compound search
3. Target and mechanism lookup
4. Classification into ~20 MOA categories (e.g., KINASE_INHIBITOR, CHECKPOINT_INHIBITOR)

### Step 4: Analysis

Available analyses from the dashboard:
- **Trials per Condition**: Bar chart of trial counts by condition
- **Phase Distribution**: Breakdown across Phase 1-4
- **Status Distribution**: RECRUITING, COMPLETED, etc.
- **MOA Distribution**: Intervention and trial counts by MOA category
- **Enrollment Summary**: Total, mean, median enrollment statistics

### Step 5: Advanced Filtering

Filter trials by any combination of:
- Phase, Status, Study Type
- Condition, MOA Category, Sponsor
- Enrollment range

### Step 6: In-Silico Simulation

Simulate trial outcomes using TCGA patient cohorts:
1. Match TCGA cases to trial eligibility criteria
2. Apply response models (Historical or Molecular)
3. Generate predicted response rates

### Step 7: Genomic Analysis

- Gene expression normalization (log2, z-score)
- Differential expression with Welch's t-test + BH correction
- DCNA scoring via ssGSEA on MOA-specific gene sets
- Responder classification by DCNA threshold

### Step 8: Threshold Learning

Optimize classification thresholds using:
- **Youden's J statistic**: Maximizes sensitivity + specificity - 1
- **Cost-based**: Minimizes weighted false positive/negative costs
- **Percentile**: Sets threshold at a given percentile

Evaluation includes ROC curves, confusion matrices, and Bland-Altman analysis for method comparison.

### Step 9: Export

Download results as CSV or JSON from the Export page or API:
- `GET /export/csv/trials` - CSV format
- `GET /export/json/trials` - JSON format

## Configuration

Edit `config/default_config.yaml` to customize:

```yaml
database:
  url: "sqlite:///ct_pipeline.db"

clinicaltrials:
  max_results_per_query: 100

chembl:
  timeout: 30

tcga:
  mode: auto  # api, local, or auto

analysis:
  min_enrollment: 10

threshold:
  method: youden
```

## API Reference

Base URL: `http://localhost:8000`

| Endpoint | Method | Description |
|---|---|---|
| `/trials` | GET | List trials (filterable) |
| `/trials/{nct_id}` | GET | Trial detail |
| `/conditions` | GET | List conditions |
| `/conditions/suggest` | POST | Expand disease terms |
| `/analysis/metrics` | GET | Summary metrics |
| `/analysis/trials-per-condition` | GET | Condition counts |
| `/analysis/moa-distribution` | GET | MOA breakdown |
| `/analysis/phase-distribution` | GET | Phase breakdown |
| `/analysis/status-distribution` | GET | Status breakdown |
| `/analysis/filter-options` | GET | Available filter values |
| `/analysis/filter` | POST | Apply filters |
| `/analysis/plots/{type}` | GET | Plotly figure JSON |
| `/export/csv/trials` | GET | CSV export |
| `/export/json/trials` | GET | JSON export |
