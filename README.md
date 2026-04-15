# ORACLE — Oncology Response & Cohort Learning Engine

[![Version](https://img.shields.io/badge/version-1.0.0-blue)](CHANGELOG.md) [![Python](https://img.shields.io/badge/python-3.11%2B-blue)](https://www.python.org/) [![Node](https://img.shields.io/badge/node-20%2B-green)](https://nodejs.org/) [![License](https://img.shields.io/badge/license-MIT-lightgrey)](#license)

ORACLE is an end-to-end translational pipeline that turns public clinical-trial data into decision-ready biomarker thresholds and simulated next-generation trials. It ingests every trial relevant to a disease from **ClinicalTrials.gov** and the **EU CTIS registry**, classifies every drug intervention by mechanism-of-action via **ChEMBL**, scores **TCGA** patients with a Drug-Constrained Network Activity (DCNA) biomarker, learns the responder threshold that best separates outcomes, validates it on held-out trials, and projects the result onto a next-generation trial — all through a single web UI.

Every data file, figure, CSV, and JSON this application emits is stamped with a **build ID** so you can always trace an artifact back to the exact commit that produced it.

---

## Table of contents

1. [Quick start](#quick-start)
2. [Prerequisites](#prerequisites)
3. [Project layout](#project-layout)
4. [Where to look when you want to…](#where-to-look-when-you-want-to)
5. [Development workflow](#development-workflow)
6. [Configuration](#configuration)
7. [Data pipeline](#data-pipeline)
8. [API reference](#api-reference)
9. [Frontend routes](#frontend-routes)
10. [Versioning & provenance](#versioning--provenance)
11. [Testing](#testing)
12. [Troubleshooting](#troubleshooting)
13. [Known limitations](#known-limitations)
14. [Contributing](#contributing)
15. [License](#license)

---

## Quick start

### macOS / Linux

```bash
# Clone
git clone https://github.com/UhlConsultingLLC/Sygnomics_ORACLE.git
cd Sygnomics_ORACLE

# Backend (Python 3.11+)
python -m venv venv
source venv/bin/activate
pip install -e ".[dev]"
uvicorn api.main:app --reload &

# Frontend (Node 20+)
cd frontend
npm install
npm run dev
```

### Windows (PowerShell)

```powershell
git clone https://github.com/UhlConsultingLLC/Sygnomics_ORACLE.git
cd Sygnomics_ORACLE

python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -e ".[dev]"
Start-Process uvicorn -ArgumentList "api.main:app","--reload"

cd frontend
npm install
npm run dev
```

Then open **http://localhost:5173** in your browser. The backend is on **http://localhost:8000** — Swagger UI is at `/docs`, build provenance at `/version`.

`launch_claude.bat` and `launch_claude_server.bat` in the repo root start both processes together on Windows for convenience.

---

## Prerequisites

| Requirement | Minimum | Notes |
|---|---|---|
| Python | 3.11 | Typed via PEP 604 unions; older releases will fail to import |
| Node.js | 20 | Vite 8 requires 20.x+; Node 18 still works but is unsupported |
| Git | any | Used at install time to bake the build SHA into the package |
| Ports | `5173`, `5174`, `5175`, `8000` | Frontend (Vite, auto-bumps if 5173 taken), backend (uvicorn) |
| Disk | ~500 MB | SQLite DB + cached TCGA fetches |
| External credentials | none | All public APIs; no API keys required for local development |

You do **not** need Docker, Postgres, or a cloud account to run ORACLE locally.

---

## Project layout

```
Sygnomics_ORACLE/
├── api/                    # FastAPI backend
│   ├── main.py             # App entrypoint, CORS, router registration
│   ├── dependencies.py     # DI for config, DB session, engine caching
│   ├── provenance.py       # Build-ID stamps for every export (CSV/JSON)
│   └── routers/            # One router per pipeline stage
│       ├── trials.py           # /trials — search + detail
│       ├── conditions.py       # /conditions — MeSH expansion, trial counts
│       ├── ctis_router.py      # /ctis — EU registry search + import
│       ├── who.py              # /who — WHO 2021 CNS subtype classification
│       ├── moa.py              # /moa — mechanism-of-action classification
│       ├── analysis.py         # /analysis — filters, metrics, plots
│       ├── tcga.py             # /tcga — cohort summaries, DCNA/expression detail
│       ├── simulation.py       # /simulation — in-silico trials + MOA pipeline
│       ├── novel_therapy.py    # /novel-therapy — prediction for unseen drugs
│       ├── threshold.py        # /threshold — learning + Bland-Altman
│       ├── validation.py       # /validation — held-out win-rate back-test
│       ├── export.py           # /export — stamped CSV / JSON downloads
│       └── version.py          # /version — build ID / git SHA / build time
│
├── config/                 # YAML config + Pydantic schema + version helpers
│   ├── default_config.yaml     # Active config (DB path, CORS, TCGA mode, …)
│   ├── schema.py               # Pydantic validation of every config key
│   ├── version.py              # APP_VERSION, get_git_sha(), get_build_id()
│   └── _build_info.py          # GITIGNORED — baked at `pip install` time
│
├── connectors/             # External-API wrappers (CT.gov, ChEMBL, TCGA, MeSH)
│   ├── clinicaltrials.py
│   ├── chembl.py
│   ├── mesh_client.py
│   ├── tcga.py                 # Dual-mode: GDC API + local parquet cache
│   └── models/                 # Pydantic response models
│
├── database/               # SQLAlchemy ORM + ETL + query builders
│   ├── models.py               # TrialRecord, InterventionRecord, …
│   ├── engine.py               # Engine factory (SQLite today, PG-ready)
│   ├── etl.py                  # load_trials() with upsert
│   ├── queries.py              # Query helpers returning Pydantic models
│   └── migrations/             # Alembic initial + incremental migrations
│
├── moa_classification/     # Drug name → MOA category resolution
│   ├── name_resolver.py        # Strip dosage / salt / route to canonical drug
│   ├── moa_categories.py       # ChEMBL action_types → ~20 human categories
│   └── classifier.py           # Orchestrator; writes moa_annotations rows
│
├── analysis/               # Metrics, filters, simulation, threshold learning
│   ├── metrics.py              # trials_per_condition, response_rate_stats, …
│   ├── filters.py              # FilterSpec + apply_filters() SQL builder
│   ├── split.py                # Random / stratified / temporal train-test
│   ├── simulation.py           # InSilicoSimulator, eligibility matcher
│   ├── dcna.py                 # Drug-Constrained Network Activity scoring
│   ├── gene_expression.py      # Log2 TPM normalization, DE testing
│   ├── threshold_learning.py   # Youden's J, cost-based, percentile
│   ├── evaluation.py           # MAE, Bland-Altman, CI coverage, PPV/NPV
│   └── responder_similarity.py # Feature extraction for predicted responders
│
├── visualization/          # Backend-side Plotly figures (optional)
│   └── *.py                    # summary, genomic, threshold, comparison plots
│
├── frontend/               # React + TypeScript + Vite
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── App.tsx                 # Routing
│       ├── components/
│       │   ├── Layout.tsx              # App shell + sidebar nav + VersionBadge
│       │   ├── VersionBadge.tsx        # Provenance chip in sidebar footer
│       │   ├── Interpretation.tsx      # <InterpretBox>, <Metric>, <InlineHelp>
│       │   ├── PlotContainer.tsx       # Plotly figure wrapper
│       │   └── DataTable.tsx           # Sortable/paginated table
│       ├── hooks/
│       │   ├── useApi.ts               # React-Query hooks (one per route)
│       │   ├── useVersion.ts           # Fetch + cache /version response
│       │   └── usePersistentState.ts   # sessionStorage-backed state
│       ├── pages/                  # One file per sidebar entry (see below)
│       ├── services/
│       │   ├── api.ts                  # Axios client + every endpoint wrapper
│       │   └── version.ts              # Client for /version
│       ├── utils/
│       │   ├── bootstrap.ts            # Pearson r CI, permutation tests, BCa
│       │   └── provenance.ts           # Client-side build-ID stamps
│       └── types/index.ts          # TypeScript mirrors of Pydantic models
│
├── data/                   # GITIGNORED — cached TCGA + DB snapshots
├── docs/                   # Supplemental docs (architecture notes, notebooks)
├── tests/                  # pytest suite
├── pyproject.toml          # Python metadata — version source of truth
├── setup.py                # Install hook that bakes git SHA into _build_info.py
├── CHANGELOG.md            # Version history
└── README.md               # (this file)
```

---

## Where to look when you want to…

| Goal | Files to touch |
|---|---|
| Add a new API endpoint | Create `api/routers/<name>.py`, register in `api/main.py` |
| Add a new page | `frontend/src/pages/<Name>.tsx` + route in `App.tsx` + sidebar entry in `Layout.tsx` |
| Change MOA classification | `moa_classification/moa_categories.py` (category map) or `moa_classification/name_resolver.py` (drug-name canonicalization) |
| Change the DCNA formula | `analysis/dcna.py` |
| Change threshold-learning method | `analysis/threshold_learning.py` — Youden / cost / percentile selectors |
| Change CORS allowlist | `config/default_config.yaml` → `api.cors_origins` (then restart backend) |
| Change the DB schema | `database/models.py` + new Alembic migration in `database/migrations/` |
| Change TCGA data source | `config/default_config.yaml` → `tcga.mode` (`api` / `local` / `auto`) |
| Add a new export format | `api/routers/export.py` + `api/provenance.py` |
| Bump the app version | `pyproject.toml`, `config/version.py`, `frontend/package.json`, `CHANGELOG.md` — all four in lockstep |
| Add an interpretation tooltip to a page | `frontend/src/components/Interpretation.tsx` — `<InterpretBox>`, `<InlineHelp>`, `<Metric>` primitives |
| Stamp a new output with the build ID | Backend: `api.provenance.build_export_metadata()`. Frontend: `utils/provenance.ts` — `withProvenance(layout, source)`, `provenanceImageFilename(base)` |

---

## Development workflow

**Backend** — run from the repo root with the venv activated:

```bash
uvicorn api.main:app --reload --port 8000
```

Reloads on any Python file change. Swagger UI at http://localhost:8000/docs.

**Frontend** — in a second terminal:

```bash
cd frontend
npm run dev
```

Vite HMR picks up `.tsx`/`.ts` changes instantly. The default port is 5173; if that is already bound Vite auto-bumps to 5174 / 5175. All three ports are in the CORS allowlist (see `config/default_config.yaml`).

**Parallel dev servers.** If another tool grabs 5173 (e.g. a preview server), your second Vite lands on 5174. Requests from 5174 work because the backend's CORS allowlist includes 5174 and 5175 — just remember the backend reads `default_config.yaml` at startup, so if you edit the CORS list while uvicorn is running, restart uvicorn.

**Typecheck** before every commit: `cd frontend && npx tsc --noEmit`.

---

## Configuration

Every runtime knob lives in `config/default_config.yaml`; Pydantic (`config/schema.py`) validates it at startup and fails fast on unknown keys.

```yaml
database:
  url: "sqlite:///clinical_trials.db"   # Drop-in PostgreSQL: postgresql+psycopg://user:pw@host/db

api:
  host: "0.0.0.0"
  port: 8000
  cors_origins:
    - "http://localhost:5173"    # Vite default
    - "http://localhost:5174"    # Auto-bump when 5173 taken
    - "http://localhost:5175"    # Spare
    - "http://localhost:3000"

tcga:
  mode: "auto"                   # "api" = always GDC; "local" = always parquet cache; "auto" = cache-first
  local_path: "data/tcga_cache"
  gdc_token_path: null           # Optional; not required for open data

visualization:
  figure_width: 900
  figure_height: 600
  default_formats: ["svg", "png"]

split:
  strategy: "stratified"         # random / stratified / temporal
  test_size: 0.2
  random_state: 42
```

Edit the file, save, **restart uvicorn**. Backend configuration is loaded once at process start.

---

## Data pipeline

ORACLE's eight stages mirror the sidebar order:

1. **Acquire** — Disease Search → Trial Explorer → EU Trials. Expand a disease term via NLM MeSH, fetch every matching trial from CT.gov and CTIS, upsert into SQLite.
2. **Organize** — WHO Classification → MOA Overview. NLP over eligibility text assigns WHO 2021 subtypes; ChEMBL lookups classify every intervention into a mechanism-of-action category.
3. **Summarize & Filter** — Analysis Dashboard → Trial Filtering. Metrics (phase distribution, response rate histograms, sponsor breakdowns) plus multi-criteria filters.
4. **Score & Simulate** — TCGA Cohort → Simulation. Compute DCNA for every TCGA patient using the selected MOA's target gene set; train/test split; simulate per-trial predicted response distributions.
5. **Learn & Validate** — MOA Correlation → Threshold Validation. Bootstrap Pearson r / Spearman ρ with calibration test; held-out win-rate back-test with Wilson CIs + bootstrap lift intervals.
6. **Apply** — Novel Therapy Simulation → Trial vs SATGBM. Use the learned biomarker rule to predict response for unseen drugs; compare trial eligibility to a biomarker-only rule on the TCGA cohort.
7. **Forecast Impact** — Screening Impact → TAM Estimator. Per-arm lift from biomarker screening; project unique responder counts to US/worldwide populations via TCGA prevalence.
8. **Deliver** — Export. CSV / JSON downloads carrying the full provenance stamp.

---

## API reference

Swagger UI lives at http://localhost:8000/docs when uvicorn is running. Top-level router families:

| Path | What it does |
|---|---|
| `/trials`, `/trials/{nct_id}` | List + detail, with drug options and sub-population membership |
| `/conditions` | MeSH expansion, condition-count breakdowns |
| `/ctis` | EU registry search + background import |
| `/who` | WHO 2021 CNS subtype stats + filtered trials |
| `/moa` | MOA categories, intervention drill-down, drug lookup |
| `/analysis` | Metrics summary + plot JSON |
| `/tcga` | Cohort summary, DCNA distribution, expression heatmaps |
| `/simulation` | Launch runs, poll status, fetch summaries, download features |
| `/novel-therapy` | Similarity-weighted predicted response for unseen drugs |
| `/threshold` | Learn threshold, evaluation metrics, Bland-Altman |
| `/validation` | Held-out back-test, Wilson CIs, lift CIs |
| `/export/csv/…`, `/export/json/…` | Stamped downloads (see "Versioning & provenance") |
| `/version` | Build ID, git SHA, build time, Python + platform info |

---

## Frontend routes

| Path | Page | Purpose |
|---|---|---|
| `/` | Welcome | Landing page + pipeline explainer |
| `/conditions` | Disease Search | MeSH expansion, term preview |
| `/trials` | Trial Explorer | Sortable/filterable trial table + detail drawer |
| `/ctis` | EU Trials (CTIS) | Search + background import with progress |
| `/who` | WHO Classification | WHO 2021 subtype dashboard + IDH/MGMT filters |
| `/moa` | MOA Overview | Category table, drug-name lookup, distribution chart |
| `/dashboard` | Analysis Dashboard | Summary metrics + plots across the corpus |
| `/filtering` | Trial Filtering | Multi-criteria filter panel with live updates |
| `/tcga` | TCGA Cohort | 548-patient cohort summaries + DCNA/expression scatter |
| `/simulation` | Simulation | Run MOA simulations, inspect per-trial distributions |
| `/moa-correlation` | MOA Correlation | Bootstrap r/ρ, robustness, calibration ellipse |
| `/threshold-validation` | Threshold Validation | Held-out back-test + forest plot |
| `/novel-therapy` | Novel Therapy Simulation | Predict RR for a drug not in the training set |
| `/trial-comparison` | Trial vs SATGBM | Side-by-side eligibility vs biomarker classification |
| `/screening-impact` | Screening Impact | Per-arm lift from biomarker-based enrollment |
| `/tam-estimator` | TAM Estimator | US/WW addressable-market projections |
| `/export` | Export | Download center |

---

## Versioning & provenance

ORACLE follows **semantic versioning**: `MAJOR.MINOR.PATCH`. `1.0.0` is the first release that ships the full provenance-stamping stack.

**Source of truth.** Three files hold the version string; they are bumped in lockstep on every release:

1. `pyproject.toml` → `project.version`
2. `config/version.py` → `APP_VERSION`
3. `frontend/package.json` → `version`

**Git SHA resolution** (first hit wins):

1. `config/_build_info.py` — written at `pip install .` time by `setup.py`, survives deployment. Gitignored so it never leaks a stale SHA.
2. `git rev-parse HEAD` against the repo root — used during local dev when the `.git` directory is present.
3. The literal string `"unknown"` — only when steps 1 and 2 both fail (deployed artifact with no baked SHA).

**Build ID format.** `<version>+<sha7>` — e.g. `1.0.0+d160ce3`.

**What gets stamped:**

| Artifact | Where the stamp lands |
|---|---|
| CSV exports (`/export/csv/...`, `/simulation/.../download`) | Three `# ` header rows with build ID, build time, context; filename includes `v{version}_{sha}_{timestamp}`; `X-Oracle-Build-Id` response header |
| JSON exports (`/export/json/...`) | Top-level `metadata` wrapper: `{ metadata: {version, git_sha, build_id, build_time, exported_at, endpoint, ...}, data: ... }` |
| Plotly SVG/PNG exports (18 plots across 6 pages) | Bottom-right corner annotation: `ORACLE 1.0.0+d160ce3 · exported 2026-04-15T12:04Z · /source`. Filename includes the version/SHA/timestamp |
| Composite SVG (Trial vs SATGBM snapshot) | `<text>` element at the bottom of the SVG + stamped filename |
| UI | Sidebar footer chip shows `ORACLE v1.0.0 · d160ce3`; click to copy the full build ID; hover for build time + Python + platform |
| API metadata | `GET /version` returns the full provenance object |

**How to trace a figure back to its source.** Open the SVG in any text editor — the bottom-right `<text>` element carries the build ID and the source path. Check out that commit: `git checkout d160ce3`. The rendering code is in the file(s) you can find by grepping for the source tag (e.g., `/moa-correlation/calibration`).

**When you bump the version.** Update all four locations listed above, add an entry to `CHANGELOG.md`, commit, push, and tag the release: `git tag -a v1.0.0 -m "…" && git push origin v1.0.0`.

---

## Testing

**Backend** — pytest is configured in `pyproject.toml`:

```bash
pytest                          # all tests
pytest tests/test_filters.py -v # single file
pytest -k "threshold" -v        # keyword match
pytest --cov=api --cov=analysis # with coverage
```

Integration tests under `tests/integration/` are skipped by default (they require live MCP connectors or a populated DB).

**Frontend** — no component-level test suite today; the strategy is:

1. `npx tsc --noEmit` (always must exit 0)
2. `npm run lint`
3. Manual preview sweep (`npm run dev` + click through pages after a UI change)

Preview-based automated verification is available — see `.claude/launch.json`.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Error: Network Error` in the UI on every call | Browser loaded on a port (e.g. 5174) that isn't in `api.cors_origins`. | Either restart the frontend so it grabs 5173, or add the port to `cors_origins` and restart uvicorn. |
| Backend won't start — `sqlite3.OperationalError: database is locked` | Another process (a previous uvicorn, or a notebook) still has the DB open. | Stop the other process, then restart uvicorn. |
| `ModuleNotFoundError: config.version` | Running Python from an unconfigured shell. | Make sure `pip install -e ".[dev]"` completed successfully; confirm `venv` is activated. |
| `GET /version` returns `"git_sha": "unknown"` | `_build_info.py` wasn't written AND `.git` is missing. | Re-run `pip install -e ".[dev]"` from inside the repo root; that writes a fresh `_build_info.py`. |
| TCGA page shows "no data" | `tcga.mode = "local"` and the local cache is empty. | Switch to `"api"` or `"auto"` in `config/default_config.yaml` and restart uvicorn. Or populate `data/tcga_cache/`. |
| SVG export has `version unknown` stamp | Frontend started before the backend. | Refresh the page — `useVersion` will pick up the real build ID from `/version`. |
| Vite dev server hot-reload stops firing | Watcher hit its file-watch limit (Linux) or antivirus is scanning `node_modules`. | Linux: `sudo sysctl -w fs.inotify.max_user_watches=524288`. Windows: exclude the repo path from Defender's real-time scan. |
| `npm install` fails on Windows with `EPERM` | An IDE or `node_modules` is still holding a file lock. | Close the IDE / kill lingering Node processes; delete `frontend/node_modules`; re-run. |
| Plotly figures look blank on first load | Plotly 3.x requires WebGL for some traces; headless test browsers without WebGL skip them. | Use a real browser or enable WebGL in the headless config. |

---

## Known limitations

- **Eligibility parsing is regex-based**, not an LLM. The top ~10 criteria types (age, prior therapy, performance status, IDH, 1p/19q, MGMT, EGFR amplification, …) are extracted reliably; everything else is logged as `unmapped_biomarkers` and silently ignored during biomarker matching. Review low-confidence WHO classifications before using them downstream.
- **TCGA cohort is GBM-only (N=548)**. Other tumor types are not yet wired in. Extending to LGG or a pan-cancer view requires populating additional gene-expression parquet files and revisiting the MOA → target mapping.
- **SQLite is the default database.** The ORM is written against SQLAlchemy 2.x so PostgreSQL "just works" via a connection-string change, but we have not stress-tested high-concurrency PG deployments — expect to tune the pool if you move to prod.
- **MCP connectors are optional at runtime.** Live ClinicalTrials.gov / ChEMBL / PubMed / bioRxiv queries depend on the MCP tool runtime. Without it, the pipeline falls back to the cached SQLite snapshot; you cannot ingest new trials.
- **Simulation is deterministic but not reproducible across machines** unless `split.random_state` is pinned AND NumPy/SciPy versions match. The build ID in exports captures the code version but not the numerics-library version — compare carefully when diffing figures across machines.
- **Frontend has no component test suite.** Coverage relies on typecheck + preview sweep. High-churn components (MOA Correlation especially) occasionally regress visually; review screenshots in PRs.
- **No authentication or multi-tenant support.** ORACLE is designed for single-user local / intranet deployment. Exposing the backend to the open internet without a reverse proxy + auth layer is out-of-scope for 1.0.
- **`avg unique` on case bootstraps is an approximation.** The statistic converges to ≈63% of n; at very small n (< 8 points) it can swing widely. Don't read too much into a single number.
- **EU CTIS import can be slow.** The registry's public API is rate-limited and has unpredictable latency. Large imports (> 500 trials with `fetch_details=true`) are expected to take tens of minutes.

---

## Contributing

- **Branch naming** — `<verb>-<noun>-<detail>`, kebab-case. Examples: `widen-cors-vite-ports`, `relabel-trial-eligible-rr`. Keep branches focused; one idea per PR.
- **Commit messages** — imperative mood, < 72-char subject line, body wraps at 72. Co-author trailers welcome.
- **PR expectations** — include a test plan in the body; if the change is UI-visible, attach a before/after screenshot. Always run `npx tsc --noEmit` and `pytest` locally before pushing.
- **Python linting** — `ruff check .` and `ruff format .`. CI will reject unformatted code.
- **Code review** — every PR gets a human review. Drive-by merges even for trivial changes are discouraged.

---

## License

MIT — see `pyproject.toml` for the declaration. Copyright © 2026 Sygnomics / UhlConsulting LLC.
