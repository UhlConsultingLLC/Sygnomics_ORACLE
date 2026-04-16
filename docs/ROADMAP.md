# ORACLE v1.1 Roadmap

Items tracked for the next release. Each maps to a `tracked for v1.1`
comment in the source — `grep -rn "tracked for v1.1" frontend/ pyproject.toml`
will produce the full list with line numbers.

---

## TypeScript type safety (replace `any` with proper types)

| Source file | What needs typing | Effort |
|---|---|---|
| `frontend/src/pages/Simulation.tsx` (line 7) | Plotly layout objects + simulation/responder-similarity API responses (~200 lines of interface definitions) | Large |
| `frontend/src/pages/TCGACohort.tsx` (line 5) | TCGA API payloads: cohort, DCNA, expression, scatter, heatmap | Medium |
| `frontend/src/pages/MOACorrelation.tsx` (line 7) | Bootstrap-result records, per-MOA stats with dynamic keys | Medium |

**Approach**: create `frontend/src/types/plotly-extensions.d.ts` for the
Plotly layout unions ORACLE uses (annotations, shapes, hoverlabel) and
`frontend/src/types/simulation.ts` for the simulation API shapes. Then
swap `any` → the new types page by page.

---

## React hooks refactoring

| Source file | What to refactor |
|---|---|
| `frontend/src/pages/Simulation.tsx` (line 15) | Multiple useEffect callbacks intentionally omit computed deps; refactor to either include them or extract into custom hooks with stable references |
| `frontend/src/hooks/useVersion.ts` (line 26) | Replace sync setState from module-level cache with a React Suspense boundary or a proper data-fetching primitive |
| `frontend/src/components/PlotContainer.tsx` (line 24) | Derive `plotHeight` from props or a `useMemo` instead of setState inside useEffect |

---

## Python lint cleanup

| Source file | Issue |
|---|---|
| `analysis/who_extractor.py` | `F841` unused variable `grade_order` |
| `api/routers/analysis.py` | `F841` unused variable `q_lower` |
| `connectors/civic.py` | `F841` unused variable `disease_context` |
| `connectors/mesh_client.py` | `F841` unused variables `url` + `params` |

These are tracked in `pyproject.toml` (line 89) under `[tool.ruff.lint.per-file-ignores]`.
Fix: either delete the assignments or wire the values into the surrounding
logic. Then remove the per-file ignore entries.

---

## How to contribute to this roadmap

When you complete an item, remove it from this file, delete the corresponding
`tracked for v1.1` comment from the source, and mention the change in
`CHANGELOG.md` under the `[1.1.0]` heading.

When you defer an item past v1.1, update the comment to `tracked for v1.2`
and move it to a new section at the bottom of this file.
