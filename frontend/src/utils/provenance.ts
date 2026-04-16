// Shared helpers for stamping client-side exports (SVG, PNG, XLSX, JSON,
// CSV) with the app's build identity so artifacts can be traced back to
// the exact commit that produced them.
//
// This mirrors `api/provenance.py` on the backend. Frontend exports land
// on the user's machine without ever passing through the backend export
// router, so they need to carry the stamp themselves.
//
// Reads the version from `useVersion` / `getVersionSync` — the `/version`
// endpoint is fetched once on app load and cached; if the backend is
// unreachable, everything falls through to literal "unknown" strings and
// the export still succeeds (just without provenance).

import { getVersionSync } from '../hooks/useVersion';
import type { VersionInfo } from '../services/version';

export interface ExportMetadata {
  app: string;
  app_version: string;
  git_sha: string;
  build_id: string;
  build_time: string;
  exported_at: string;
  source: string; // page path / feature name (e.g. "/trial-comparison")
}

function nowUtcIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

/** Compact UTC stamp suitable for filenames: 20260415T120427Z. */
export function filenameStamp(iso?: string): string {
  return (iso ?? nowUtcIso()).replace(/-/g, '').replace(/:/g, '').replace(/\.\d+/, '');
}

export function buildExportMetadata(source: string, info?: VersionInfo): ExportMetadata {
  const v = info ?? getVersionSync();
  return {
    app: v.name,
    app_version: v.version,
    git_sha: v.git_sha,
    build_id: v.build_id,
    build_time: v.build_time,
    exported_at: nowUtcIso(),
    source,
  };
}

/**
 * Build a filename that bakes in the build ID and an export timestamp.
 * Example: `NCT02844439_comparison_v1.0.0_d160ce3_20260415T1204Z.svg`
 */
export function provenanceFilename(base: string, ext: string, meta: ExportMetadata): string {
  const { app_version, git_sha, exported_at } = meta;
  const stamp = filenameStamp(exported_at);
  const cleanExt = ext.replace(/^\./, '');
  return `${base}_v${app_version}_${git_sha}_${stamp}.${cleanExt}`;
}

/** Human-readable one-liner for the bottom of an SVG figure. */
export function provenanceFooterText(meta: ExportMetadata): string {
  return `${meta.app} ${meta.build_id} · exported ${meta.exported_at} · ${meta.source}`;
}

/**
 * Build an SVG <text> element string to append at the bottom of an SVG
 * export. Returns a fragment that can be concatenated into the outer
 * `<svg>` body. Caller passes the total width/height of the SVG so the
 * stamp can anchor to the bottom-right corner.
 */
export function svgProvenanceStamp(
  totalW: number,
  totalH: number,
  meta: ExportMetadata,
  opts: { margin?: number; size?: number; color?: string } = {},
): string {
  const margin = opts.margin ?? 8;
  const size = opts.size ?? 8;
  const color = opts.color ?? '#8a93a6';
  const text = provenanceFooterText(meta);
  // Right-aligned, plus one x-axis title.
  return (
    `<text x="${totalW - margin}" y="${totalH - margin}" ` +
    `font-family="Arial, Helvetica, sans-serif" font-size="${size}" ` +
    `fill="${color}" text-anchor="end">${escapeXml(text)}</text>`
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Wrap a JSON body with a top-level `metadata` block (mirrors api.provenance.wrap_json_export). */
export function wrapJsonExport<T>(data: T, meta: ExportMetadata): { metadata: ExportMetadata; data: T } {
  return { metadata: meta, data };
}

/** Plotly annotation spec for embedding provenance at the bottom-right of a chart. */
export function plotlyProvenanceAnnotation(meta: ExportMetadata) {
  return {
    xref: 'paper',
    yref: 'paper',
    x: 1.0,
    y: -0.12,
    xanchor: 'right' as const,
    yanchor: 'top' as const,
    text: provenanceFooterText(meta),
    showarrow: false,
    font: {
      size: 9,
      color: '#8a93a6',
      family: 'Arial, Helvetica, sans-serif',
    },
  };
}

/**
 * Merge a Plotly provenance annotation into a layout object. Every Plotly
 * plot across the app should be built as `withProvenance(layout, '/page/plot')`
 * so the bottom-right stamp shows up on-screen (and in any exported SVG/PNG).
 *
 * The returned object is a shallow copy — the caller's layout is not mutated.
 */
export function withProvenance<L extends { annotations?: unknown[] }>(layout: L, source: string): L {
  const meta = buildExportMetadata(source);
  const ann = plotlyProvenanceAnnotation(meta);
  return {
    ...layout,
    annotations: [...(layout.annotations ?? []), ann],
  } as L;
}

/**
 * Compact `toImageButtonOptions.filename` payload that incorporates the
 * build ID and UTC timestamp. Usage:
 *
 *   toImageButtonOptions: {
 *     format: 'svg',
 *     filename: provenanceImageFilename('moa_correlation'),
 *     ...
 *   }
 *
 * Returns the filename without the extension — Plotly appends it itself.
 */
export function provenanceImageFilename(base: string, info?: VersionInfo): string {
  const meta = buildExportMetadata(base, info);
  // Plotly appends the extension, so strip `.svg` before returning.
  return provenanceFilename(base, 'svg', meta).replace(/\.svg$/, '');
}

/**
 * Three-line CSV header. Safe for pandas `read_csv(..., comment='#')`.
 * Matches the format emitted by `api.provenance.csv_header_lines`.
 */
export function csvHeaderLines(meta: ExportMetadata): string {
  const short = `# ${meta.app} ${meta.build_id} · ${meta.source} · exported ${meta.exported_at}`;
  const build = `# built: ${meta.build_time}`;
  const ctx = `# context: ${JSON.stringify({})}`;
  return [short, build, ctx].join('\n') + '\n';
}
