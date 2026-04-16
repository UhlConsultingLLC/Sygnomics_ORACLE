import { describe, it, expect } from 'vitest';
import {
  buildExportMetadata,
  provenanceFilename,
  provenanceFooterText,
  filenameStamp,
  csvHeaderLines,
} from '../utils/provenance';

describe('filenameStamp', () => {
  it('collapses ISO timestamp to compact form', () => {
    expect(filenameStamp('2026-04-15T12:04:27Z')).toBe('20260415T120427Z');
  });
});

describe('buildExportMetadata', () => {
  it('returns all required keys', () => {
    const meta = buildExportMetadata('/test-page');
    expect(meta).toHaveProperty('app');
    expect(meta).toHaveProperty('app_version');
    expect(meta).toHaveProperty('git_sha');
    expect(meta).toHaveProperty('build_id');
    expect(meta).toHaveProperty('build_time');
    expect(meta).toHaveProperty('exported_at');
    expect(meta).toHaveProperty('source', '/test-page');
  });
});

describe('provenanceFilename', () => {
  it('includes version, sha, timestamp, and extension', () => {
    const meta = buildExportMetadata('/test');
    const name = provenanceFilename('trials', 'csv', meta);
    // In test context (no backend), version/sha are "unknown"; match that too
    expect(name).toMatch(/^trials_v[\w.]+_\w+_\d{8}T\d{6}Z\.csv$/);
  });
});

describe('provenanceFooterText', () => {
  it('includes app name, build_id, and source', () => {
    const meta = buildExportMetadata('/moa-correlation');
    const text = provenanceFooterText(meta);
    expect(text).toContain('ORACLE');
    expect(text).toContain('/moa-correlation');
    expect(text).toContain('exported');
  });
});

describe('csvHeaderLines', () => {
  it('starts each line with #', () => {
    const meta = buildExportMetadata('/export/csv');
    const header = csvHeaderLines(meta);
    for (const line of header.trim().split('\n')) {
      expect(line.startsWith('#')).toBe(true);
    }
  });

  it('contains the build_id', () => {
    const meta = buildExportMetadata('/export/csv');
    const header = csvHeaderLines(meta);
    expect(header).toContain(meta.build_id);
  });
});
