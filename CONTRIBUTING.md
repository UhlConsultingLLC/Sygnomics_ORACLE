# Contributing to ORACLE

Thanks for taking the time to contribute. ORACLE is a translational clinical-trial
analysis pipeline — small enough that every PR gets a real human review, large
enough that coding style and process consistency matter. This document captures
what we expect from both contributors and maintainers.

The short version: follow the [README's Quick start](README.md#quick-start),
run `npx tsc --noEmit` + `pytest` before you push, keep PRs focused on one idea,
and a maintainer will review within a couple of business days.

---

## Table of contents

1. [Getting set up](#getting-set-up)
2. [Filing an issue](#filing-an-issue)
3. [Working on a change](#working-on-a-change)
4. [Code style](#code-style)
5. [Commit messages](#commit-messages)
6. [Pull requests](#pull-requests)
7. [Release process](#release-process)
8. [Code of conduct](#code-of-conduct)

---

## Getting set up

Follow [README → Quick start](README.md#quick-start). In short:

```bash
python -m venv venv && source venv/bin/activate
pip install -e ".[dev]"
cd frontend && npm install
```

Start the backend with `uvicorn api.main:app --reload` and the frontend with
`npm run dev`. Browse the app at http://localhost:5173 and the Swagger UI at
http://localhost:8000/docs.

Every clone should also copy / write a fresh `config/_build_info.py` via
`pip install -e .` — that's what stamps exports with the current build SHA.
If you ever see `git_sha: "unknown"` in `/version`, re-run `pip install -e .`.

## Filing an issue

Before opening an issue, please search [existing issues](../../issues) to make
sure it hasn't already been reported.

- **Bug report** — use the *Bug report* template. Include the build ID from
  the sidebar version badge (click to copy), your OS + Python + Node versions,
  and a minimal reproduction.
- **Feature request** — use the *Feature request* template. Describe the
  problem first, then the proposed solution.
- **Security vulnerability** — do NOT file a public issue. See [SECURITY.md](SECURITY.md).

## Working on a change

### Branching

- Branch off `main`.
- Name the branch `<verb>-<noun>-<detail>` in kebab-case. Examples:
  `add-tam-estimator-ui`, `fix-cors-port-bumps`, `widen-percentage-tile`.
- Keep one idea per branch. If your change touches two unrelated areas, split
  into two branches + two PRs.

### Making edits

- Backend code lives in `api/`, `analysis/`, `connectors/`, `database/`,
  `moa_classification/`, `visualization/`, `config/`. See the README's
  ["Where to look when you want to…" table](README.md#where-to-look-when-you-want-to)
  for the mapping from intent to file.
- Frontend code lives in `frontend/src/`. Components under `components/`,
  page-level views under `pages/`, hooks under `hooks/`, API clients under
  `services/`, utilities under `utils/`.
- Configuration keys live in `config/default_config.yaml` and are validated
  by Pydantic in `config/schema.py`. If you add a new key, add it to both.

### Database schema changes

ORACLE does **not** use Alembic. Tables are created by
`database/engine.init_db()` → `Base.metadata.create_all()` on first
start. When you add a column:

1. Add the column to the ORM model in `database/models.py`.
2. Add an ALTER TABLE entry to `database/engine._apply_column_migrations()`.
   This function runs on every startup and silently catches "column already
   exists" errors, so existing databases upgrade without data loss.
3. Test locally: delete `clinical_trials.db`, restart uvicorn, confirm the
   new column appears in `sqlite3 clinical_trials.db '.schema <table>'`.

### Set up pre-commit hooks (once)

```bash
pip install pre-commit
pre-commit install
```

After this, `ruff check`, `ruff format`, TypeScript typecheck, and
file-hygiene checks run automatically on every `git commit`. If a hook
fails, the commit is blocked and you fix the issue before retrying.

### Before you push

The hooks catch most issues, but also run the full suite manually:

```bash
# Python
ruff check .
ruff format --check .
pytest

# Frontend
cd frontend
npx tsc --noEmit
npm run lint
npm test
```

All must exit cleanly. If any don't, fix the offending code rather than
disabling the check.

### UI / visual changes

If your PR changes something that renders in the browser:

1. Start the dev server (`npm run dev`) and exercise the feature end-to-end.
2. Attach a before/after screenshot to the PR.
3. Check `preview_logs` (or your browser console) for new errors / warnings.

## Code style

### Python

- **Formatting**: `ruff format .` (Black-compatible, 100-char line length).
- **Linting**: `ruff check .` — uses the `E, F, I, N, W` rule sets from
  `pyproject.toml`.
- **Type hints**: use them on every public API / module boundary. Prefer
  `X | None` over `Optional[X]`. Prefer Pydantic models over raw dicts when
  passing structured data across function boundaries.
- **Docstrings**: every router module, every public function, every
  non-trivial class. One-sentence summary, blank line, details. Usage
  examples welcome when the caller isn't obvious.

### TypeScript / React

- **Formatting**: Prettier defaults (will be enforced by CI soon; manually
  keep consistent with surrounding code).
- **Linting**: `npm run lint` — currently enforces `react-hooks` + base ESLint.
- **Type safety**: treat `any` as a code smell. `unknown` + narrow is almost
  always better. If you genuinely need `any`, leave a `// eslint-disable-next-line`
  comment with a one-line justification.
- **State management**: React Query for server state, local `useState` for
  UI-only state, `usePersistentState` for state that should survive refresh,
  and the module-level stores in `MOACorrelation.tsx` / `Simulation.tsx` for
  state that should outlive component mounts.
- **Plot layouts**: every `Plotly.newPlot` call MUST wrap its layout with
  `withProvenance(layout, '/source-path')` and use `provenanceImageFilename(base)`
  in `toImageButtonOptions.filename` so exports stay traceable. CI will not
  yet check this — reviewers will.

### YAML / JSON / Markdown

- 2-space indent. No trailing whitespace. LF line endings.
  (`.editorconfig` handles all of this automatically.)

## Commit messages

- Imperative mood: "Add X", not "Added X" or "Adds X".
- Subject line under 72 chars.
- Blank line, then a body that explains *why* (not *what* — the diff shows
  what). Wrap at 72 chars.
- Co-author trailers are welcome:

  ```
  Co-Authored-By: Name <email@example.com>
  ```

- Reference related issues: `Fixes #42` / `Refs #17`.

## Pull requests

- Target `main`. Use the [PR template](.github/pull_request_template.md) — it
  asks for a summary, a "why", and a test plan.
- Keep the diff focused. If review feedback balloons scope, consider splitting
  the follow-up work into a second PR.
- Every PR must pass CI before merging. Don't merge around red CI without a
  clear reason + sign-off.
- Squash on merge unless the branch has a meaningful commit history worth
  preserving (e.g., `versioning-infrastructure` → `stamping-exports` →
  `versioning-docs` stack). When in doubt, squash.

### Review

- A maintainer will acknowledge within a couple of business days.
- For non-trivial changes, expect at least one round of feedback.
- Be specific in comments: quote the exact line, suggest the concrete
  alternative, link to evidence.

## Release process

1. Bump the version in lockstep across:
   - `pyproject.toml` → `project.version`
   - `config/version.py` → `APP_VERSION`
   - `frontend/package.json` → `version`
2. Add an entry to `CHANGELOG.md` under the new version header. Follow
   [Keep a Changelog](https://keepachangelog.com/) sections: Added, Changed,
   Deprecated, Removed, Fixed, Security.
3. Open a release PR titled `Release v<MAJOR>.<MINOR>.<PATCH>`.
4. After merge, tag and push:
   ```bash
   git tag -a v1.1.0 -m "Release v1.1.0"
   git push origin v1.1.0
   ```
5. GitHub Actions will pick up the tag and generate a release draft.

## Code of conduct

We aim to keep the contribution experience respectful, professional, and
free of harassment. Disagreements on technical merit are expected and
healthy; personal attacks are not. If you see something that feels off,
email the maintainer privately (see [SECURITY.md](SECURITY.md) for the
disclosure channel — the same address is fine for conduct issues).
