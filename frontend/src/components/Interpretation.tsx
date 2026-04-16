import { useState, type ReactNode, type CSSProperties } from 'react';
import { usePersistentState } from '../hooks/usePersistentState';

/**
 * Shared interpretation primitives used across analysis pages to give users
 * simple, consistent explanations for numbers, tables, and plots.
 *
 * Three pieces:
 *   - <Metric>      — card-style statistic with optional one-line hint and
 *                     optional ⓘ tooltip.
 *   - <InterpretBox> — collapsible "How to read this" panel. Expanded on first
 *                      visit (per user request); toggled state is persisted
 *                      to sessionStorage keyed by the provided `id`.
 *   - <InlineHelp>  — small ⓘ next to column headers / tight labels; shows a
 *                     tooltip on hover.
 *
 * Uses the ORACLE palette (navy #1c3e72, purple #634697, grays).
 */

// ---------------------------------------------------------------------------
// Metric — replaces bare StatCards with an optional interpretation hint.
// ---------------------------------------------------------------------------

export interface MetricProps {
  label: string;
  value: ReactNode;
  /** One-line, quiet gray hint shown under the value. Keep short (<12 words). */
  hint?: ReactNode;
  /** Hover-to-reveal explanation surfaced via an ⓘ next to the label. */
  tooltip?: string;
  /** Optional accent color for the value (defaults to navy). */
  valueColor?: string;
  /** Minimum card width in px (default 160). */
  minWidth?: number;
  style?: CSSProperties;
}

export function Metric({ label, value, hint, tooltip, valueColor = '#1c3e72', minWidth = 160, style }: MetricProps) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e0e6ee',
        borderRadius: 8,
        padding: '0.85rem 1rem',
        minWidth,
        textAlign: 'center',
        ...style,
      }}
    >
      <div style={{ fontSize: '1.55rem', fontWeight: 700, color: valueColor, lineHeight: 1.15 }}>{value}</div>
      <div
        style={{
          fontSize: '0.78rem',
          color: '#666',
          marginTop: 4,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span>{label}</span>
        {tooltip && <InlineHelp text={tooltip} />}
      </div>
      {hint && (
        <div
          style={{
            fontSize: '0.72rem',
            color: '#888',
            marginTop: 4,
            lineHeight: 1.35,
            fontStyle: 'italic',
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InterpretBox — collapsible explanatory panel.
// ---------------------------------------------------------------------------

export interface InterpretBoxProps {
  /** Unique id used as the sessionStorage key for expanded/collapsed state. */
  id: string;
  /** Heading shown in the header bar. */
  title?: string;
  /** Optional tone — 'info' (blue/navy) or 'tip' (purple). */
  tone?: 'info' | 'tip';
  /** Defaults to true (expanded on first visit). */
  defaultOpen?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}

const tonePalettes: Record<
  'info' | 'tip',
  {
    border: string;
    bg: string;
    headerBg: string;
    title: string;
    accent: string;
  }
> = {
  info: {
    border: '#d5dff0',
    bg: '#f5f8fd',
    headerBg: '#eaf0fa',
    title: '#1c3e72',
    accent: '#1c3e72',
  },
  tip: {
    border: '#e1d6ef',
    bg: '#f8f4fd',
    headerBg: '#efe7fa',
    title: '#634697',
    accent: '#634697',
  },
};

export function InterpretBox({
  id,
  title = 'How to read this',
  tone = 'info',
  defaultOpen = true,
  children,
  style,
}: InterpretBoxProps) {
  const storageKey = `interpret_box_${id}`;
  const [open, setOpen] = usePersistentState<boolean>(storageKey, defaultOpen);
  const palette = tonePalettes[tone];

  return (
    <div
      style={{
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        borderRadius: 8,
        marginBottom: '1rem',
        overflow: 'hidden',
        ...style,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '0.55rem 0.9rem',
          background: palette.headerBg,
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: palette.title,
          fontSize: '0.82rem',
          fontWeight: 600,
          letterSpacing: '0.2px',
        }}
        aria-expanded={open}
        aria-controls={`${storageKey}-body`}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span
            aria-hidden="true"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: palette.accent,
              color: '#fff',
              fontSize: '0.72rem',
              fontWeight: 700,
              fontStyle: 'italic',
              fontFamily: 'Georgia, serif',
            }}
          >
            i
          </span>
          <span>{title}</span>
        </span>
        <span
          aria-hidden="true"
          style={{
            fontSize: '0.7rem',
            color: palette.accent,
            transition: 'transform 0.15s ease',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            display: 'inline-block',
          }}
        >
          ▶
        </span>
      </button>
      {open && (
        <div
          id={`${storageKey}-body`}
          style={{
            padding: '0.75rem 1rem 0.9rem',
            fontSize: '0.83rem',
            lineHeight: 1.55,
            color: '#333',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InlineHelp — small ⓘ with hover tooltip for tight layouts.
// ---------------------------------------------------------------------------

export interface InlineHelpProps {
  text: string;
  /** Icon size in px (default 14). */
  size?: number;
  /** Icon fill (default muted gray). */
  color?: string;
}

export function InlineHelp({ text, size = 14, color = '#8a93a3' }: InlineHelpProps) {
  const [hover, setHover] = useState(false);

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', lineHeight: 1 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      tabIndex={0}
      aria-label={text}
      role="img"
    >
      <span
        aria-hidden="true"
        title={text}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          borderRadius: '50%',
          background: color,
          color: '#fff',
          fontSize: Math.round(size * 0.72),
          fontWeight: 700,
          fontStyle: 'italic',
          fontFamily: 'Georgia, serif',
          cursor: 'help',
          userSelect: 'none',
        }}
      >
        i
      </span>
      {hover && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: `calc(100% + 6px)`,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#1c3e72',
            color: '#fff',
            padding: '6px 9px',
            borderRadius: 4,
            fontSize: '0.72rem',
            fontStyle: 'normal',
            fontWeight: 400,
            lineHeight: 1.4,
            whiteSpace: 'normal',
            width: 'max-content',
            maxWidth: 260,
            zIndex: 1000,
            boxShadow: '0 3px 8px rgba(0,0,0,0.18)',
            pointerEvents: 'none',
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
