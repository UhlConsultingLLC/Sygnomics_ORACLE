# Changelog

All notable changes to ORACLE are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-04-15

The first version tagged for public traceability. `1.0.0` marks the point from
which every artifact the application emits carries a build ID that can be
traced back to the exact commit that produced it.

### Added
- **`config/version.py`** — single source of truth for the runtime build
  identity (`APP_VERSION`, `get_git_sha()`, `get_build_time()`, `get_build_id()`),
  with a three-tier SHA resolver: install-time baked → live `git rev-parse` →
  `"unknown"` sentinel.
- **`setup.py` install hook** — writes `config/_build_info.py` on every
  `pip install` / `pip install -e .` so deployed artifacts report their
  provenance even when the `.git` directory is unavailable.
  `config/_build_info.py` is gitignored.
- **`GET /version` endpoint** — returns build ID, git SHA, build time, Python
  version, and platform string. Consumed by the frontend on every app load.
- **Frontend `<VersionBadge>`** — provenance chip in the sidebar footer.
  Click to copy the full build ID; hover for build time, Python, platform.
  Turns red when the backend's `/version` endpoint is unreachable so users can
  tell at a glance that exports are not being stamped.
- **`api/provenance.py`** — backend stamp helpers: `build_export_metadata`,
  `csv_header_lines`, `wrap_json_export`, `provenance_filename`.
- **`frontend/src/utils/provenance.ts`** — matching client-side helpers:
  `buildExportMetadata`, `svgProvenanceStamp`, `withProvenance`,
  `provenanceImageFilename`, `plotlyProvenanceAnnotation`, `csvHeaderLines`,
  `wrapJsonExport`.
- **Full-matrix export stamping**:
  - CSV exports (`/export/csv/trials`, `/simulation/moa-responder-similarity/.../download`)
    now carry a three-line `#` header + stamped filename + `X-Oracle-Build-Id`
    response header.
  - JSON exports (`/export/json/trials`) are wrapped in
    `{ metadata: {...}, data: <body> }`. **Breaking change** from the
    pre-1.0.0 API shape; consumers that expected a top-level array must be
    updated.
  - Plotly SVG/PNG exports across all 18 figures in 6 pages
    (MOA Correlation ×3, Simulation ×8, Screening Impact ×3, TCGA Cohort ×2,
    Threshold Validation ×1, Trial vs SATGBM ×1) now include a
    bottom-right provenance annotation and stamp their filenames.
  - The custom composite SVG export in Trial vs SATGBM appends a `<text>`
    provenance stamp to the bottom of the SVG.
- **Comprehensive `README.md`** — full rewrite covering quick-start,
  prerequisites, project layout, API reference, frontend routes, versioning,
  testing, troubleshooting, known limitations, and contributing guidelines.
- **This `CHANGELOG.md`**.
- **CORS whitelist** now includes `localhost:5174` and `localhost:5175` so
  parallel Vite dev servers don't hit "Network Error" when they auto-bump off
  the default 5173.

### Changed
- **`pyproject.toml`** — version bumped `0.1.0` → `1.0.0`. Description updated
  to reference the ORACLE acronym.
- **`frontend/package.json`** — version `0.0.0` → `1.0.0`; name
  `frontend` → `oracle-frontend`.
- **FastAPI app title** — `CT Pipeline API` → `ORACLE API` (Oncology Response
  & Cohort Learning Engine). Description updated.
- **Root `/` endpoint** and `/version` both now surface the canonical
  `APP_VERSION` from `config/version.py` rather than hard-coded literals.

### Deprecated
- None.

### Removed
- None — all additive.

### Fixed
- **Trial vs SATGBM header overlap in SVG exports**. Rebuilt the info grid as
  an explicit 4-column, 2-row layout matching the on-screen version; the
  long "Percentage of TCGA patients predicted to respond…" label now spans
  the last 2 cells of row 2.
- **MOA Correlation stats box cut-off in SVG exports**. The export was
  hard-coded to `height: 800` while the layout computed a dynamic `figHeight`
  from the number of annotation lines; mismatch dragged the annotation below
  the figure bottom. Export height now matches `figHeight`.
- **Calibration test annotation overlapping the (1, 0) null marker** in the
  MOA Correlation calibration ellipse. Moved from bottom-right to top-right
  of the plot.
- **Observed Clinical Response Rate tile wrapping to 3 lines** in the Trial
  vs SATGBM SVG tile row. Widened both edge tiles from 1 to 1.25 relative
  units; the second tile's label now fits cleanly on 2 lines.

### Security
- No security-relevant changes in this release.

---

## [0.1.0] — 2026-03-30

Initial internal release. No public tag.

### Added
- Backend FastAPI service with routers for trials, conditions, MOA, analysis,
  TCGA, simulation, novel therapy, threshold, validation, WHO classification,
  CTIS import, and export.
- React + TypeScript + Vite frontend with 17 pipeline pages.
- SQLite-backed trial corpus ingested from ClinicalTrials.gov and EU CTIS.
- TCGA-GBM cohort (N=548) wired in via GDC API with local parquet caching.
- MOA classification pipeline (ChEMBL → ~20 human-readable categories).
- In-silico simulation with Drug-Constrained Network Activity (DCNA) scoring.
- Threshold learning (Youden's J, cost-based, percentile) + held-out validation.
- Plotly-based interactive figures across every page.
- CSV and JSON export endpoints (unstamped — full provenance added in 1.0.0).

[1.0.0]: https://github.com/UhlConsultingLLC/Sygnomics_ORACLE/releases/tag/v1.0.0
[0.1.0]: https://github.com/UhlConsultingLLC/Sygnomics_ORACLE/releases/tag/v0.1.0
