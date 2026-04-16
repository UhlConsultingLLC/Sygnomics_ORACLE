/**
 * ORACLE color palette — single source of truth.
 *
 * Extracted from inline styles across the app so a future dark-mode
 * implementation only needs to swap this object (or toggle CSS custom
 * properties derived from it). For now the app is light-mode only;
 * this file documents the palette and gives editors autocomplete.
 *
 * Usage:
 *   import { colors } from '../theme';
 *   <div style={{ background: colors.sidebar }}>
 */

export const colors = {
  // ── Brand ────────────────────────────────────────────────────────
  /** Navy — sidebar, primary headings, stat-tile accent */
  navy: '#1c3e72',
  /** Purple — ORACLE accent, tab-level interpret boxes */
  purple: '#634697',

  // ── Surfaces ─────────────────────────────────────────────────────
  /** App background */
  pageBg: '#f5f7fa',
  /** Card / panel background */
  cardBg: '#ffffff',
  /** Card border */
  cardBorder: '#dee3ea',
  /** Stat-tile background */
  tileBg: '#f5f7fa',

  // ── Text ─────────────────────────────────────────────────────────
  /** Primary text */
  text: '#1a1a2e',
  /** Secondary text */
  textMuted: '#666666',
  /** Tertiary / hint text */
  textHint: '#888888',
  /** Label text (uppercase tile headers) */
  textLabel: '#60656e',

  // ── Semantic ─────────────────────────────────────────────────────
  /** Success / positive */
  success: '#2e7d32',
  /** Warning */
  warning: '#f57f17',
  /** Error / danger */
  error: '#c62828',
  /** Info / link */
  info: '#1976d2',

  // ── Sidebar ──────────────────────────────────────────────────────
  sidebar: '#1c3e72',
  sidebarText: '#ffffff',
  sidebarActiveBg: 'rgba(255,255,255,0.15)',
  sidebarDivider: '#2c5a96',

  // ── Plot-specific ────────────────────────────────────────────────
  /** Scatter: orange responder dot */
  orange: '#ff9800',
  orangeDark: '#e65100',
  /** Scatter: gray non-responder dot */
  gray: '#9e9e9e',
  grayDark: '#616161',

  // ── Provenance stamp ─────────────────────────────────────────────
  stamp: '#8a93a6',
} as const;

/**
 * CSS custom-property declarations derived from `colors`.
 *
 * To enable dark mode in the future:
 * 1. Define a `colorsDark` object with the same keys.
 * 2. Write both sets as CSS custom properties on `:root` / `[data-theme="dark"]`.
 * 3. Swap inline `colors.X` references to `var(--oracle-X)` in JSX styles.
 *
 * This function is NOT called today — it exists to document the
 * migration path and prevent drift.
 */
export function toCssVars(palette: Record<string, string>): string {
  return Object.entries(palette)
    .map(([key, value]) => `--oracle-${key}: ${value};`)
    .join('\n  ');
}
