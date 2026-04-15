<!--
Thanks for contributing! Fill in the sections below. Strip any that aren't
relevant (keep the headings; delete placeholder text).
-->

## Summary
<!-- One to three bullets: what this PR does, at a high level. -->

-
-

## Why
<!-- The motivation. Skip if the summary already captures it. Link to a
     GitHub issue if one exists (e.g., "Fixes #42"). -->

## What changed
<!-- Brief list of the meaningful edits. Do not restate the diff. -->

-

## Test plan
<!-- How a reviewer (or future-you) can verify this. Check the boxes as
     you verify them locally. -->

- [ ] `cd frontend && npx tsc --noEmit` exits 0
- [ ] `pytest` passes (if backend code changed)
- [ ] `npm run lint` passes (if frontend code changed)
- [ ] Manual preview sweep on affected pages (attach screenshots below)

## Screenshots / output
<!-- For UI changes, attach a before/after pair. For API/data changes,
     paste a sample curl + response or a stamp from a generated export. -->

## Breaking changes
<!-- None? Delete this section. Otherwise: what breaks, and what
     consumers need to do to migrate. -->

## Checklist

- [ ] Branch name is `<verb>-<noun>-<detail>` in kebab-case
- [ ] Version bumped (if this is a release PR)
- [ ] `CHANGELOG.md` updated (if user-visible)
- [ ] Docs updated (`README.md`, `CONTRIBUTING.md`, or inline)
- [ ] New `Plotly.newPlot` calls wrap layout with `withProvenance(layout, '/source')` — if applicable
