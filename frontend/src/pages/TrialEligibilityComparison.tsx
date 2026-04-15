import { useState, useEffect, useRef } from 'react';
import Plotly from 'plotly.js/dist/plotly.min.js';
import { runTrialComparison, fetchTrialDrugOptions } from '../services/api';
import type { TrialDrugOption, TrialArmOption, TrialSubgroupOption } from '../services/api';
import { InterpretBox, InlineHelp } from '../components/Interpretation';
import {
  buildExportMetadata,
  provenanceFilename,
  provenanceImageFilename,
  svgProvenanceStamp,
  withProvenance,
} from '../utils/provenance';

// ── Response types ───────────────────────────────────────────────────────
type Category =
  | 'responder_enrolled'
  | 'responder_excluded_by_criteria'
  | 'nonresponder_enrolled'
  | 'nonresponder_excluded_by_criteria';

// Note: "enrolled" = meets eligibility criteria (thick black border)
// "excluded_by_criteria" = does not meet criteria (no border)

interface Point {
  patient_id: string;
  dcna: number;
  expression: number;
  category: Category;
}

interface PanelStats {
  enrolled?: number;
  responders: number;
  response_rate: number;
  responders_missed: number;
}

interface Panel {
  label: string;
  points: Point[];
  stats: PanelStats;
}

interface ExtractedBiomarker {
  marker: string;
  context: string;
  mapped: boolean;
}

interface BiomarkerTherapyAssoc {
  biomarker: string;
  biomarker_status: string;
  biomarker_category: string;
  therapy_name: string;
  therapy_class: string;
  response_effect: string;
  effect_size: string;
  mechanism_summary: string;
  evidence_level: string;
  evidence_sources: string;
  disease_context: string;
  clinical_actionability: string;
  marker_in_trial_criteria: boolean;
}

interface SelectedArm {
  arm_id: number;
  label: string;
  type: string;
  description: string;
  intervention_names: string[];
}

interface SelectedSubgroup {
  group_title: string;
  group_description: string;
}

interface ComparisonResponse {
  nct_id: string;
  drug: string;
  moa_category: string;
  learned_dcna_threshold: number;
  expression_threshold: number;
  drug_targets: string[];
  extracted_biomarkers: ExtractedBiomarker[];
  unmapped_biomarkers: string[];
  observed_response_rate: number | null;
  selected_arm?: SelectedArm | null;
  selected_subgroup?: SelectedSubgroup | null;
  biomarker_therapy_associations?: BiomarkerTherapyAssoc[];
  left_panel: Panel;
  right_panel: Panel;
  diff: {
    response_rate_pp: number;
    responders_recovered: number;
    nonresponders_spared: number;
  };
}

// ── Styling constants ────────────────────────────────────────────────────
const ORANGE = '#e8872b';
const ORANGE_DARK = '#b8691e';   // slightly darker orange for thin borders
const GRAY = '#9aa0a6';
const GRAY_DARK = '#71777e';     // slightly darker grey for thin borders

const panelStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #d7dce3',
  borderRadius: 6,
  padding: '1rem 1.25rem',
};

const buttonStyle: React.CSSProperties = {
  background: '#1c3e72',
  color: '#fff',
  border: 'none',
  padding: '0.55rem 1.1rem',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: '0.9rem',
};

const inputStyle: React.CSSProperties = {
  padding: '0.5rem 0.7rem',
  border: '1px solid #c8cfd8',
  borderRadius: 4,
  fontSize: '0.9rem',
  width: 200,
};

const tileStyle: React.CSSProperties = {
  background: '#f5f7fa',
  border: '1px solid #dee3ea',
  borderRadius: 5,
  padding: '0.6rem 0.8rem',
  textAlign: 'center',
  flex: 1,
};

// ── Plot builder ─────────────────────────────────────────────────────────
function buildPanelTraces(panel: Panel, threshold: number, exprThresh: number, sharedRange?: { xMin: number; xMax: number; yMin: number; yMax: number }, _side: 'left' | 'right' = 'left') {
  // Four categories: eligible gets thick black border, non-eligible gets no border
  const nonRespIneligible = panel.points.filter(p => p.category === 'nonresponder_excluded_by_criteria');
  const nonRespEligible   = panel.points.filter(p => p.category === 'nonresponder_enrolled');
  const respIneligible    = panel.points.filter(p => p.category === 'responder_excluded_by_criteria');
  const respEligible      = panel.points.filter(p => p.category === 'responder_enrolled');

  const mkTrace = (pts: Point[], name: string, color: string, borderW: number, borderColor: string) => ({
    x: pts.map(p => p.dcna),
    y: pts.map(p => p.expression),
    text: pts.map(p => p.patient_id),
    mode: 'markers',
    type: 'scatter',
    name,
    marker: { color, size: 9, symbol: 'circle', line: { color: borderColor, width: borderW } },
    hovertemplate: '%{text}<br>DCNA: %{x:.3f}<br>Expr: %{y:.3f}<extra></extra>',
  });

  // Plot ineligible (thin darker border) first so eligible (thick black border) renders on top
  const traces: any[] = [
    mkTrace(nonRespIneligible, 'Predicted Non-responder',                    GRAY,   1, GRAY_DARK),
    mkTrace(nonRespEligible,   'Predicted Non-responder (trial eligible)',   GRAY,   2.5, '#000000'),
    mkTrace(respIneligible,    'Predicted Responder',                        ORANGE, 1, ORANGE_DARK),
    mkTrace(respEligible,      'Predicted Responder (trial eligible)',       ORANGE, 2.5, '#000000'),
  ];

  let xMin: number, xMax: number, yMin: number, yMax: number;
  if (sharedRange) {
    xMin = sharedRange.xMin; xMax = sharedRange.xMax;
    yMin = sharedRange.yMin; yMax = sharedRange.yMax;
  } else {
    const xs = panel.points.map(p => p.dcna);
    const ys = panel.points.map(p => p.expression);
    xMin = xs.length ? Math.min(...xs) - 0.05 : -1;
    xMax = xs.length ? Math.max(...xs) + 0.05 : 1;
    yMin = ys.length ? Math.min(...ys) - 0.5 : 0;
    yMax = ys.length ? Math.max(...ys) + 0.5 : 10;
  }

  const layout: any = {
    title: { text: panel.label, font: { size: 18 } },
    xaxis: {
      title: { text: 'Therapy Network Activity Score', font: { size: 14 }, standoff: 10 },
      tickfont: { size: 12 },
      range: [xMin, xMax],
      zeroline: false,
      dtick: 0.25,
      automargin: true,
    },
    yaxis: {
      title: { text: 'Biomarker Expression Index', font: { size: 14 }, standoff: 10 },
      tickfont: { size: 12 },
      range: [yMin, yMax],
      zeroline: false,
      dtick: 0.5,
      automargin: true,
    },
    autosize: true,
    height: 560,
    margin: { l: 80, r: 40, t: 40, b: 110 },
    showlegend: true,
    legend: { orientation: 'h', y: -0.18, xanchor: 'center', x: 0.5, font: { size: 11 } },
    shapes: [
      // shaded responder quadrant
      {
        type: 'rect',
        x0: threshold,
        x1: xMax,
        y0: exprThresh,
        y1: yMax,
        fillcolor: 'rgba(232, 135, 43, 0.08)',
        line: { width: 0 },
        layer: 'below',
      },
      // vertical threshold
      {
        type: 'line',
        x0: threshold,
        x1: threshold,
        y0: yMin,
        y1: yMax,
        line: { color: '#444', width: 1.5, dash: 'dash' },
      },
      // horizontal threshold
      {
        type: 'line',
        x0: xMin,
        x1: xMax,
        y0: exprThresh,
        y1: exprThresh,
        line: { color: '#444', width: 1.5, dash: 'dash' },
      },
    ],
    annotations: [
      {
        x: threshold,
        y: yMin,
        xref: 'x',
        yref: 'y',
        text: 'SATGBM Identified<br>Threshold',
        showarrow: false,
        font: { size: 11, color: '#444' },
        xanchor: 'left',
        yanchor: 'bottom',
        textangle: -90,
        xshift: 6,
      },
      {
        x: xMin,
        y: exprThresh,
        xref: 'x',
        yref: 'y',
        text: 'SATGBM Identified<br>Threshold',
        showarrow: false,
        font: { size: 11, color: '#444' },
        xanchor: 'left',
        yanchor: 'bottom',
        yshift: 4,
      },
    ],
  };

  return { traces, layout };
}

// ── Marker dot helper ────────────────────────────────────────────────────
type MarkerDot = { fill: string; borderColor: string; borderWidth: number };

function DotIcon({ dot }: { dot: MarkerDot }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 12,
        height: 12,
        borderRadius: '50%',
        background: dot.fill,
        border: `${dot.borderWidth}px solid ${dot.borderColor}`,
        flexShrink: 0,
      }}
    />
  );
}

// Pre-defined marker styles matching the plot
const DOT_GRAY_ELIGIBLE:    MarkerDot = { fill: GRAY,   borderColor: '#000000',   borderWidth: 2.5 };
const DOT_ORANGE_ELIGIBLE:  MarkerDot = { fill: ORANGE, borderColor: '#000000',   borderWidth: 2.5 };
const DOT_ORANGE_INELIGIBLE: MarkerDot = { fill: ORANGE, borderColor: ORANGE_DARK, borderWidth: 1 };

// ── Stat tile helpers ────────────────────────────────────────────────────
const opStyle: React.CSSProperties = { fontSize: '1rem', fontWeight: 900, color: '#60656e' };

function StatTile({ label, value, markers, showPlus, markerContent, tooltip }: {
  label: string; value: string; markers?: MarkerDot[]; showPlus?: boolean;
  markerContent?: React.ReactNode;
  tooltip?: string;
}) {
  return (
    <div style={{ ...tileStyle, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ fontSize: '0.7rem', color: '#60656e', textTransform: 'uppercase', letterSpacing: 0.5, minHeight: '2.2em', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 4 }}>
        <span>{label}</span>
        {tooltip && <InlineHelp text={tooltip} size={11} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
        {markerContent}
        {!markerContent && markers && markers.map((m, i) => {
          const dot = <DotIcon key={`d${i}`} dot={m} />;
          if (showPlus && i > 0) {
            return [<span key={`p${i}`} style={opStyle}>+</span>, dot];
          }
          return dot;
        })}
        <span style={{ fontSize: '1.3rem', fontWeight: 700, color: '#1c3e72' }}>{value}</span>
      </div>
    </div>
  );
}

// ── Session persistence helpers ──────────────────────────────────────────
const STORAGE_KEY = 'trial_comparison_state';

interface PersistedState {
  nctId: string;
  drugOptions: TrialDrugOption[] | null;
  armOptions: TrialArmOption[] | null;
  subgroupOptions: TrialSubgroupOption[] | null;
  selectedDrugId: number | null;
  selectedArmId: number | null;
  selectedSubgroup: string | null;  // group_title or null
  result: ComparisonResponse | null;
  showBiomarkers: boolean;
}

function loadPersistedState(): PersistedState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function persistState(state: PersistedState) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* quota exceeded — ignore */ }
}

// ── Main component ───────────────────────────────────────────────────────
export default function TrialEligibilityComparison() {
  const saved = useRef(loadPersistedState()).current;
  const [nctId, setNctId] = useState(saved?.nctId ?? '');
  const [loadingDrugs, setLoadingDrugs] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [drugOptions, setDrugOptions] = useState<TrialDrugOption[] | null>(saved?.drugOptions ?? null);
  const [armOptions, setArmOptions] = useState<TrialArmOption[] | null>(saved?.armOptions ?? null);
  const [subgroupOptions, setSubgroupOptions] = useState<TrialSubgroupOption[] | null>(saved?.subgroupOptions ?? null);
  const [selectedDrugId, setSelectedDrugId] = useState<number | null>(saved?.selectedDrugId ?? null);
  const [selectedArmId, setSelectedArmId] = useState<number | null>(saved?.selectedArmId ?? null);
  const [selectedSubgroup, setSelectedSubgroup] = useState<string | null>(saved?.selectedSubgroup ?? null);
  const [result, setResult] = useState<ComparisonResponse | null>(saved?.result ?? null);
  const [showBiomarkers, setShowBiomarkers] = useState(saved?.showBiomarkers ?? false);
  const plotRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<HTMLDivElement>(null);

  // Persist state on every meaningful change
  useEffect(() => {
    persistState({ nctId, drugOptions, armOptions, subgroupOptions, selectedDrugId, selectedArmId, selectedSubgroup, result, showBiomarkers });
  }, [nctId, drugOptions, armOptions, subgroupOptions, selectedDrugId, selectedArmId, selectedSubgroup, result, showBiomarkers]);

  const handleSnapshot = async () => {
    if (!result) return;
    try {
      // Build a native composite SVG that mirrors the in-app layout using
      // only standard SVG primitives (rect, text, line, g). No <foreignObject>
      // so PowerPoint Online and other Office importers render it correctly.

      // ── helpers ───────────────────────────────────────────────────────
      const esc = (s: any) =>
        String(s ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      const FF = 'Arial, Helvetica, sans-serif';
      const rect = (
        x: number, y: number, w: number, h: number,
        fill: string, stroke = '#d7dce3', rx = 6,
      ) =>
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ry="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;
      const text = (
        x: number, y: number, str: string,
        opts: { size?: number; weight?: number | string; fill?: string; anchor?: string; tt?: 'upper' } = {},
      ) => {
        const { size = 14, weight = 400, fill = '#1c3e72', anchor = 'start', tt } = opts;
        const content = tt === 'upper' ? str.toUpperCase() : str;
        const ls = tt === 'upper' ? ' letter-spacing="0.5"' : '';
        return `<text x="${x}" y="${y}" font-family="${FF}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${ls}>${esc(content)}</text>`;
      };
      const line = (x1: number, y1: number, x2: number, y2: number, color = '#e0e4ea') =>
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1"/>`;

      // ── plot SVG extraction ───────────────────────────────────────────
      const plotW = 640;
      const plotH = 540;
      const getPlotSvgInner = async (div: HTMLDivElement | null): Promise<string> => {
        if (!div) return '';
        const dataUrl: string = await (Plotly as any).toImage(div, {
          format: 'svg',
          width: plotW,
          height: plotH,
        });
        const encoded = dataUrl.replace(/^data:image\/svg\+xml,?/, '');
        const raw = decodeURIComponent(encoded);
        const match = raw.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
        return match ? match[1] : raw;
      };
      const plotInner = await getPlotSvgInner(plotRef.current);

      // ── layout constants (match app: ~1rem padding, panel borders) ────
      const outerPad = 16;
      const panelPadX = 20;
      const panelPadY = 16;
      const panelGap = 16;
      // headerH reserves vertical space for: ~42 px above first info row,
      // two info rows (row spacing below), an optional 3rd row for
      // sub-population / arm, the divider at dividerY, and the
      // TCGA-matchable criteria block underneath. Bumped from 170 → 182
      // to absorb the extra 12 px introduced by the taller info grid
      // (rowSpacing 24 → 28, labelValueGap 14 → 16, dividerY shift +12).
      const headerH = 182;
      const plotPanelW = panelPadX * 2 + plotW;
      const plotPanelInnerBottomPad = 16;
      const tileH = 68;
      const tileRows = 2;
      const tileRowGap = 10;
      const plotPanelH = panelPadY * 2 + plotH + plotPanelInnerBottomPad + tileH * tileRows + tileRowGap;
      const diffW = 230;
      const diffH = plotPanelH;

      const totalW = outerPad * 2 + diffW + panelGap + plotPanelW;
      const totalH = outerPad * 2 + headerH + panelGap + plotPanelH;

      // ── header panel ──────────────────────────────────────────────────
      let out = '';
      out += rect(outerPad, outerPad, totalW - outerPad * 2, headerH, '#ffffff');

      // Info fields in a 4-col, 2-row grid matching the on-screen layout.
      // Each field specifies its (col, row) position and optional colSpan.
      // The "Percentage of TCGA patients predicted to respond based on
      // trial criteria" label is ~72 characters; in a 1/4-column cell it
      // overflows into the next column, so it spans the last 2 cells of
      // row 2 (same as the on-screen grid) to stay on a single line.
      type Field = { label: string; value: string; col: number; row: number; colSpan?: number };
      const fields: Field[] = [
        // Row 0: trial identity
        { label: 'Trial:',       value: result.nct_id,                                          col: 0, row: 0 },
        { label: 'Drug:',        value: result.drug,                                            col: 1, row: 0 },
        { label: 'MOA:',         value: result.moa_category.replace(/^group:/, ''),             col: 2, row: 0 },
        { label: 'Drug targets:', value: result.drug_targets.join(', ') || '(none in expression data)', col: 3, row: 0 },
        // Row 1: model params + headline prediction (percentage spans cols 2-3)
        { label: 'Learned TNAS threshold:', value: result.learned_dcna_threshold.toFixed(4),    col: 0, row: 1 },
        { label: 'Expression threshold:',   value: result.expression_threshold.toFixed(2),      col: 1, row: 1 },
        { label: 'Percentage of TCGA patients predicted to respond based on trial criteria:',
          value: `${(result.left_panel.stats.response_rate * 100).toFixed(1)}%`,                col: 2, row: 1, colSpan: 2 },
      ];
      if (result.selected_subgroup) {
        fields.push({ label: 'Sub-population:', value: result.selected_subgroup.group_title, col: 0, row: 2 });
      } else if (result.selected_arm) {
        const armTherapies = result.selected_arm.intervention_names.length > 0
          ? ` (${result.selected_arm.intervention_names.join(', ')})`
          : '';
        fields.push({ label: 'Arm/Group:', value: `${result.selected_arm.label}${armTherapies}`, col: 0, row: 2 });
      }
      const infoX0 = outerPad + panelPadX;
      const infoY0 = outerPad + 26;
      const colW = (totalW - outerPad * 2 - panelPadX * 2) / 4;
      // Spacing tuned to mirror the on-screen grid's airier rowGap / columnGap
      // (see the grid above the plot in the app). Wider gaps improve
      // readability of the exported figure; the only cost is headerH below.
      const rowSpacing = 28;      // vertical distance between row baselines
      const labelValueGap = 16;   // distance from label baseline to value baseline
      fields.forEach((f) => {
        const x = infoX0 + f.col * colW;
        const y = infoY0 + f.row * rowSpacing;
        // label (bold) then value on next line for clarity. Cells with
        // colSpan don't change x/y — the available horizontal space is
        // simply larger, so long labels no longer overflow neighbours.
        out += text(x, y, f.label, { size: 11, weight: 700, fill: '#1c3e72' });
        out += text(x, y + labelValueGap, f.value, { size: 11, weight: 400, fill: '#333' });
      });

      // Divider + TCGA-matchable criteria block. Pushed down from 96 → 108
      // to preserve ≥6 px between the bottom of the (optional) 3rd info row
      // and the divider line.
      const dividerY = outerPad + 108;
      out += line(outerPad + panelPadX, dividerY, totalW - outerPad - panelPadX, dividerY, '#e3e7ee');

      const incl = result.extracted_biomarkers.filter(b => b.mapped && b.context !== 'exclusion');
      const excl = result.extracted_biomarkers.filter(b => b.mapped && b.context === 'exclusion');
      const critY = dividerY + 22;
      out += text(
        infoX0, critY,
        `TCGA-matchable criteria applied (${incl.length + excl.length})`,
        { size: 13, weight: 700, fill: '#1c3e72' },
      );
      const critY2 = critY + 22;
      const inclStr = 'Inclusion: ' + (incl.length ? incl.map(b => b.marker).join(', ') : 'none');
      out += text(infoX0, critY2, inclStr, { size: 12, fill: '#555' });
      const exclStr = 'Exclusion: ' + (excl.length ? excl.map(b => b.marker).join(', ') : 'none');
      out += text(infoX0, critY2 + 18, exclStr, { size: 12, fill: '#555' });
      if (result.unmapped_biomarkers.length > 0) {
        out += text(
          infoX0, critY2 + 36,
          `Ignored (unmappable): ${result.unmapped_biomarkers.length}`,
          { size: 12, fill: '#888' },
        );
      }

      // ── content row: diff column (left) | plot panel (right) ─────────
      const rowY = outerPad + headerH + panelGap;
      const diffX = outerPad;
      const plotX = diffX + diffW + panelGap;

      // Diff column background
      out += rect(diffX, rowY, diffW, diffH, '#ffffff');
      const diffCX = diffX + diffW / 2;
      out += text(diffCX, rowY + 28, 'SATGBM vs Trial', { size: 11, weight: 600, fill: '#60656e', anchor: 'middle', tt: 'upper' });
      const drawBigMetric = (cy: number, big: string, bigColor: string, sub: string) => {
        let s = text(diffCX, cy, big, { size: 28, weight: 700, fill: bigColor, anchor: 'middle' });
        s += text(diffCX, cy + 20, sub, { size: 11, fill: '#60656e', anchor: 'middle' });
        return s;
      };
      const d = result.diff;
      const m1y = rowY + 80;
      const m2y = m1y + 78;
      const m3y = m2y + 78;
      const pctMissed = result.right_panel.stats.responders > 0
        ? (result.left_panel.stats.responders_missed / result.right_panel.stats.responders * 100)
        : 0;
      out += drawBigMetric(
        m1y,
        `${pctMissed.toFixed(1)}%`,
        '#1b7a3a',
        'percentage of predicted responders recovered',
      );
      out += line(diffX + 16, m1y + 34, diffX + diffW - 16, m1y + 34);
      out += drawBigMetric(
        m2y,
        `${d.responders_recovered >= 0 ? '+' : ''}${d.responders_recovered}`,
        d.responders_recovered >= 0 ? '#1b7a3a' : '#b00020',
        'predicted responders recovered',
      );
      out += line(diffX + 16, m2y + 34, diffX + diffW - 16, m2y + 34);
      out += drawBigMetric(
        m3y,
        `−${d.nonresponders_spared}`,
        d.nonresponders_spared >= 0 ? '#1b7a3a' : '#b00020',
        'predicted non-responders spared',
      );

      // Plot panel background
      out += rect(plotX, rowY, plotPanelW, plotPanelH, '#ffffff');
      out += `<g transform="translate(${plotX + panelPadX}, ${rowY + panelPadY})">${plotInner}</g>`;

      // Two rows of stat tiles
      const tilesW = plotW;
      const tileGap = 8;
      const tilesX = plotX + panelPadX;
      const row1Y = rowY + panelPadY + plotH + plotPanelInnerBottomPad;
      const row2Y = row1Y + tileH + tileRowGap;
      // SVG dot helper for marker icons in tiles
      const svgDot = (cx: number, cy: number, fill: string, borderColor: string, borderWidth: number) =>
        `<circle cx="${cx}" cy="${cy}" r="5" fill="${fill}" stroke="${borderColor}" stroke-width="${borderWidth}" />`;

      const drawTile = (tx: number, ty: number, w: number, label: string, value: string, dots?: { fill: string; border: string; bw: number }[], plusBetween?: boolean) => {
        let s = rect(tx, ty, w, tileH, '#f5f7fa', '#dee3ea', 5);
        // Word-wrap the label to fit within the tile width
        const labelFontSize = 8;
        const charW = labelFontSize * 0.58; // approximate char width for uppercase
        const maxChars = Math.floor((w - 12) / charW);
        const words = label.split(' ');
        const lines: string[] = [];
        let cur = '';
        for (const word of words) {
          const test = cur ? cur + ' ' + word : word;
          if (test.length > maxChars && cur) { lines.push(cur); cur = word; }
          else { cur = test; }
        }
        if (cur) lines.push(cur);
        const labelLineH = 11;
        const labelBlockH = lines.length * labelLineH;
        const labelStartY = ty + 10 + labelLineH;
        lines.forEach((ln, li) => {
          s += text(tx + w / 2, labelStartY + li * labelLineH, ln, { size: labelFontSize, weight: 600, fill: '#60656e', anchor: 'middle', tt: 'upper' });
        });
        const valueY = ty + 10 + labelBlockH + 18;
        if (dots && dots.length > 0) {
          // Layout: [dot (+dot)...] [gap] [value]
          // All elements placed left-to-right, then shifted to center in tile.
          const r = 5; // dot radius
          const dotGap = plusBetween ? 12 : 4; // gap between dots (center-to-center extra)
          const dotToVal = 8; // gap between last dot edge and value text start
          // Compute total width: each dot is 2*r diameter, gaps between, then value
          const dotsBlockW = dots.length * (2 * r) + (dots.length - 1) * dotGap;
          // Place value text with anchor='start' so its position is deterministic
          const valEstW = value.length * 10; // rough estimate for centering only
          const totalGroupW = dotsBlockW + dotToVal + valEstW;
          const originX = tx + w / 2 - totalGroupW / 2;

          dots.forEach((d, i) => {
            const cx = originX + r + i * (2 * r + dotGap);
            s += svgDot(cx, valueY, d.fill, d.border, d.bw);
            if (plusBetween && i < dots.length - 1) {
              const plusX = cx + r + dotGap / 2;
              s += text(plusX, valueY, '+', { size: 10, weight: 700, fill: '#60656e', anchor: 'middle' });
            }
          });
          const valX = originX + dotsBlockW + dotToVal;
          s += text(valX, valueY, value, { size: 18, weight: 700, fill: '#1c3e72', anchor: 'start' });
        } else {
          s += text(tx + w / 2, valueY, value, { size: 18, weight: 700, fill: '#1c3e72', anchor: 'middle' });
        }
        return s;
      };
      // Row 1: Trial stats (4 tiles, 1.25:2:3.5:1.25 width ratio = 8 units
      // + 3 gaps). Still sums to 8 so the overall row width is unchanged.
      // Rationale per tile:
      //   - "Trial Eligible" (14 chars) at 1 unit fit, but "Observed
      //     Clinical Response Rate" (30 chars) at 1 unit wraps to 3 lines
      //     at the conservative char-width estimator and overflows the
      //     tile height. Bumping both edge tiles to 1.25 units gives the
      //     Observed label a clean 2-line wrap and gives Trial Eligible
      //     a bit more breathing room on either side of its 1-line text.
      //   - The percentage tile is narrowed slightly from 4 → 3.5 units
      //     (still 44% of the row). Its label is now rendered from a
      //     hardcoded 2-line split below (not the word-wrap estimator),
      //     which guarantees exactly 2 lines that stay within the tile
      //     regardless of font metrics.
      const t1Unit        = (tilesW - tileGap * 3) / 8;
      const w1Eligible    = t1Unit * 1.25;  // "Trial Eligible" (+25%)
      const w1Responders  = t1Unit * 2;     // "Trial Eligible Predicted Responders"
      const w1Percentage  = t1Unit * 3.5;   // "Percentage…" (−12.5%, now 2-line hard split)
      const w1ObservedRR  = t1Unit * 1.25;  // "Observed Clinical Response Rate" (+25%)
      const grayElig  = { fill: GRAY, border: '#000000', bw: 2.5 };
      const orangeElig = { fill: ORANGE, border: '#000000', bw: 2.5 };
      const orangeInelig = { fill: ORANGE, border: ORANGE_DARK, bw: 1 };
      // Tile x-positions built left-to-right from the row start.
      const tile0X = tilesX;
      const tile1X = tile0X + w1Eligible   + tileGap;
      const tile2X = tile1X + w1Responders + tileGap;   // wide percentage tile
      const tile3X = tile2X + w1Percentage + tileGap;
      out += drawTile(tile0X, row1Y, w1Eligible,   'Trial Eligible', String(result.left_panel.stats.enrolled ?? 0), [orangeElig, grayElig], true);
      out += drawTile(tile1X, row1Y, w1Responders, 'Trial Eligible Predicted Responders', String(result.left_panel.stats.responders), [orangeElig]);
      // Response rate tile: fraction layout (numerator / denominator with dividing line)
      {
        const tx = tile2X;
        const w = w1Percentage;
        const val = `${(result.left_panel.stats.response_rate * 100).toFixed(1)}%`;
        let s = rect(tx, row1Y, w, tileH, '#f5f7fa', '#dee3ea', 5);
        // Hardcoded 2-line split. The character-count word-wrap used for
        // the other tiles under-estimates uppercase glyph widths (font-size
        // × 0.58 ignores letter-spacing + per-letter variance), which let
        // the first line of this long label overflow the tile boundary.
        // Splitting at a natural phrase boundary guarantees exactly 2
        // lines and a rendered width that stays inside the tile regardless
        // of the font-metric quirk.
        const rrLines: string[] = [
          'Percentage of TCGA patients predicted to',
          'respond based on trial criteria',
        ];
        const rrLineH = 11;
        const rrLabelStartY = row1Y + 10 + rrLineH;
        rrLines.forEach((ln, li) => {
          s += text(tx + w / 2, rrLabelStartY + li * rrLineH, ln, { size: 8, weight: 600, fill: '#60656e', anchor: 'middle', tt: 'upper' });
        });
        const rrValueY = row1Y + 10 + rrLines.length * rrLineH + 16;
        // Fraction layout: [orange] / [orange + grey]  then value
        // All dot positions computed from a shared center line
        const fracCX = tx + w / 2 - 20; // center-x of the fraction column
        const numY = rrValueY - 6;
        const divY = rrValueY + 2;
        const denY = rrValueY + 10;
        // Numerator: single orange dot centered
        s += svgDot(fracCX, numY, orangeElig.fill, orangeElig.border, orangeElig.bw);
        // Dividing line centered under/over the dots
        s += `<line x1="${fracCX - 12}" y1="${divY}" x2="${fracCX + 12}" y2="${divY}" stroke="#60656e" stroke-width="2" stroke-linecap="round" />`;
        // Denominator: orange + grey centered
        s += svgDot(fracCX - 8, denY, orangeElig.fill, orangeElig.border, orangeElig.bw);
        s += text(fracCX, denY, '+', { size: 9, weight: 700, fill: '#60656e', anchor: 'middle' });
        s += svgDot(fracCX + 8, denY, grayElig.fill, grayElig.border, grayElig.bw);
        // Value to the right of the fraction
        s += text(fracCX + 20, rrValueY + 2, val, { size: 18, weight: 700, fill: '#1c3e72', anchor: 'start' });
        out += s;
      }
      out += drawTile(tile3X, row1Y, w1ObservedRR, 'Observed Clinical Response Rate', result.observed_response_rate != null ? `${(result.observed_response_rate * 100).toFixed(1)}%` : 'N/A');
      // Row 2: SATGBM stats (3 tiles evenly filling the same total width as
      // row 1). With 2 gaps between 3 tiles, each gets (tilesW - 2*tileGap)/3.
      // Previously these used the 4-tile `tileW`, which left the last quarter
      // of the row empty and made the layout look unbalanced next to row 1.
      const row2TileW = (tilesW - tileGap * 2) / 3;
      out += drawTile(tilesX, row2Y, row2TileW, 'SATGBM Predicted Responders', String(result.right_panel.stats.responders ?? 0), [orangeInelig, orangeElig], true);
      out += drawTile(tilesX + (row2TileW + tileGap), row2Y, row2TileW, 'Predicted Responders Missed by Trial Criteria', String(result.left_panel.stats.responders_missed), [orangeInelig]);
      out += drawTile(tilesX + (row2TileW + tileGap) * 2, row2Y, row2TileW, 'Predicted Non-responders Spared', String(result.diff.nonresponders_spared), [grayElig]);

      const composite =
      // Provenance stamp — bottom-right corner, plus a stamped filename.
      // Anyone who later opens this file can trace the exact build it came
      // from (e.g. for debugging a number that looks "off" vs. today's run).
      const provMeta = buildExportMetadata(`/trial-comparison/${result.nct_id}`);
      const stampSvg = svgProvenanceStamp(totalW, totalH, provMeta);

      const composite =
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">` +
        out +
        stampSvg +
        `</svg>`;

      const blob = new Blob([composite], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = provenanceFilename(`${result.nct_id}_comparison_snapshot`, 'svg', provMeta);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error('Snapshot failed', e);
    }
  };

  const handleLoadDrugs = async () => {
    if (!nctId.trim()) return;
    setLoadingDrugs(true);
    setError('');
    setDrugOptions(null);
    setArmOptions(null);
    setSubgroupOptions(null);
    setSelectedDrugId(null);
    setSelectedArmId(null);
    setSelectedSubgroup(null);
    setResult(null);
    try {
      const data = await fetchTrialDrugOptions(nctId.trim());
      setDrugOptions(data.drugs);
      setArmOptions(data.arms || []);
      setSubgroupOptions(data.subgroups || []);
      const firstAvail = data.drugs.find(d => d.has_dcna_profile);
      if (firstAvail) setSelectedDrugId(firstAvail.intervention_id);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Request failed');
    } finally {
      setLoadingDrugs(false);
    }
  };

  const handleRun = async () => {
    if (!nctId.trim() || selectedDrugId == null) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = await runTrialComparison(
        nctId.trim(),
        selectedDrugId,
        selectedArmId ?? undefined,
        selectedSubgroup ?? undefined,
      );
      setResult(data as ComparisonResponse);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!result) return;
    const pts = result.left_panel.points;
    const ys = pts.map(p => p.expression);
    const sharedRange = {
      xMin: -1.05,
      xMax: 1.05,
      yMin: ys.length ? Math.min(...ys) - 0.5 : 0,
      yMax: ys.length ? Math.max(...ys) + 0.5 : 10,
    };
    const exportConfig: any = {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: [
        'zoom2d', 'pan2d', 'select2d', 'lasso2d', 'zoomIn2d', 'zoomOut2d',
        'autoScale2d', 'resetScale2d', 'hoverClosestCartesian', 'hoverCompareCartesian',
        'toggleSpikelines',
      ],
      toImageButtonOptions: { format: 'svg' as const, filename: provenanceImageFilename(`${result.nct_id}_comparison`), width: 800, height: 680, scale: 2 },
    };
    if (plotRef.current) {
      const { traces, layout } = buildPanelTraces(
        result.left_panel,
        result.learned_dcna_threshold,
        result.expression_threshold,
        sharedRange,
        'left',
      );
      layout.title.text = 'TCGA-GBM Cohort (N=548)';
      Plotly.newPlot(plotRef.current, traces, withProvenance(layout, `/trial-comparison/${result.nct_id}`), exportConfig);
    }
  }, [result]);

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      <h1 style={{ color: '#1c3e72', marginBottom: '0.3rem' }}>Trial vs SATGBM Comparison</h1>
      <p style={{ color: '#555', marginTop: 0 }}>
        Compares how a single clinical trial's enrollment would look on the TCGA-GBM cohort
        under the trial's stated eligibility criteria vs SATGBM's learned TNAS + expression thresholds.
      </p>

      <InterpretBox id="trial-comparison-intro" title="How to read this page">
        <p style={{ margin: '0 0 0.5rem' }}>
          For one trial and one of its drugs, we project who the trial would <em>actually</em> enroll
          (using its written eligibility criteria) vs. who SATGBM's learned biomarker thresholds
          would enroll — both applied to the same TCGA-GBM cohort. The scatter plot colors each
          patient by predicted responder status; borders indicate eligibility under the trial's criteria.
        </p>
        <ul style={{ margin: '0 0 0.4rem 1.1rem', padding: 0 }}>
          <li><strong>Orange dot</strong> — predicted <em>responder</em> (DCNA + expression above thresholds).</li>
          <li><strong>Grey dot</strong> — predicted <em>non-responder</em>.</li>
          <li><strong>Thick black border</strong> — eligible per the trial's written criteria.</li>
          <li><strong>No border</strong> — excluded by the trial's criteria.</li>
        </ul>
        <p style={{ margin: '0 0 0.3rem' }}>
          <strong>Key outcomes:</strong>
        </p>
        <ul style={{ margin: '0 0 0.3rem 1.1rem', padding: 0 }}>
          <li><strong>Responders recovered</strong> — predicted responders that the trial's criteria would exclude but SATGBM's biomarker would enroll. Higher = more potential patients the trial's eligibility language is missing.</li>
          <li><strong>Non-responders spared</strong> — patients the trial would enroll even though SATGBM predicts they wouldn't respond. Higher = more recruitment waste the biomarker could avoid.</li>
          <li><strong>Observed Clinical Response Rate</strong> — what this trial actually reported. If SATGBM's predicted rate is close to this, the biomarker is well-calibrated for this drug.</li>
        </ul>
        <p style={{ margin: 0, color: '#555', fontSize: '0.8rem' }}>
          Use the arm / sub-population selector to scope the comparison to a specific cohort within
          the trial (e.g. a biomarker-positive sub-group reported in the outcome tables).
        </p>
      </InterpretBox>

      <div style={{ ...panelStyle, display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '1rem' }}>
        <label style={{ fontWeight: 600, color: '#1c3e72' }}>NCT ID:</label>
        <input
          style={inputStyle}
          value={nctId}
          onChange={e => { setNctId(e.target.value); setDrugOptions(null); setArmOptions(null); setSubgroupOptions(null); setSelectedDrugId(null); setSelectedArmId(null); setSelectedSubgroup(null); setResult(null); }}
          placeholder="e.g. NCT01234567"
          onKeyDown={e => { if (e.key === 'Enter') handleLoadDrugs(); }}
        />
        <button style={buttonStyle} onClick={handleLoadDrugs} disabled={loadingDrugs || !nctId.trim()}>
          {loadingDrugs ? 'Loading…' : 'Load drugs'}
        </button>
      </div>

      {drugOptions && (
        <div style={{ ...panelStyle, marginBottom: '1rem' }}>
          {/* Arm / Sub-group selection */}
          {((armOptions && armOptions.length > 0) || (subgroupOptions && subgroupOptions.length > 0)) && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 600, color: '#1c3e72', marginBottom: '0.6rem' }}>
                Select an arm/group or sub-population{' '}
                <span style={{ fontWeight: 400, fontSize: '0.8rem', color: '#60656e' }}>
                  (optional — scopes eligibility criteria &amp; observed response rate to the selection)
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {/* "All / Full trial" option */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.7rem',
                    padding: '0.45rem 0.7rem',
                    borderRadius: 4,
                    border: (selectedArmId === null && selectedSubgroup === null) ? '1px solid #1c3e72' : '1px solid #dee3ea',
                    background: (selectedArmId === null && selectedSubgroup === null) ? '#eef3fb' : '#fafbfd',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="scope-option"
                    checked={selectedArmId === null && selectedSubgroup === null}
                    onChange={() => { setSelectedArmId(null); setSelectedSubgroup(null); }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, color: '#1c3e72', fontSize: '0.88rem' }}>Full trial (all arms &amp; groups)</div>
                  </div>
                </label>

                {/* Arms */}
                {armOptions && armOptions.length > 1 && (
                  <>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5, color: '#60656e', fontWeight: 600, marginTop: 4, marginBottom: -2, paddingLeft: 4 }}>
                      Arms / Groups
                    </div>
                    {armOptions.map(arm => {
                      const isSelected = selectedArmId === arm.arm_id && selectedSubgroup === null;
                      return (
                        <label
                          key={`arm-${arm.arm_id}`}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '0.7rem',
                            padding: '0.45rem 0.7rem',
                            borderRadius: 4,
                            border: isSelected ? '1px solid #1c3e72' : '1px solid #dee3ea',
                            background: isSelected ? '#eef3fb' : '#fafbfd',
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="radio"
                            name="scope-option"
                            checked={isSelected}
                            onChange={() => { setSelectedArmId(arm.arm_id); setSelectedSubgroup(null); }}
                            style={{ marginTop: 3 }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, color: '#1c3e72', fontSize: '0.88rem' }}>
                              {arm.label}
                              {arm.type && (
                                <span style={{ fontWeight: 400, fontSize: '0.75rem', color: '#60656e', marginLeft: 8 }}>
                                  ({arm.type})
                                </span>
                              )}
                            </div>
                            {arm.description && (
                              <div style={{ fontSize: '0.76rem', color: '#555', marginTop: 2, lineHeight: 1.35 }}>
                                {arm.description.length > 200 ? arm.description.slice(0, 200) + '…' : arm.description}
                              </div>
                            )}
                            {arm.intervention_names.length > 0 && (
                              <div style={{ fontSize: '0.72rem', color: '#60656e', marginTop: 3 }}>
                                Therapies: {arm.intervention_names.join(', ')}
                              </div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </>
                )}

                {/* Sub-groups from outcome results */}
                {subgroupOptions && subgroupOptions.length > 0 && (
                  <>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5, color: '#60656e', fontWeight: 600, marginTop: 4, marginBottom: -2, paddingLeft: 4 }}>
                      Sub-populations (from outcome results)
                    </div>
                    {subgroupOptions.map(sg => {
                      const isSelected = selectedSubgroup === sg.group_title;
                      return (
                        <label
                          key={`sg-${sg.group_title}`}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '0.7rem',
                            padding: '0.45rem 0.7rem',
                            borderRadius: 4,
                            border: isSelected ? '1px solid #1c3e72' : '1px solid #dee3ea',
                            background: isSelected ? '#eef3fb' : '#fafbfd',
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="radio"
                            name="scope-option"
                            checked={isSelected}
                            onChange={() => { setSelectedSubgroup(sg.group_title); setSelectedArmId(null); }}
                            style={{ marginTop: 3 }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, color: '#1c3e72', fontSize: '0.88rem' }}>
                              {sg.group_title}
                            </div>
                            {sg.group_description && (
                              <div style={{ fontSize: '0.76rem', color: '#555', marginTop: 2, lineHeight: 1.35 }}>
                                {sg.group_description.length > 250 ? sg.group_description.slice(0, 250) + '…' : sg.group_description}
                              </div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          )}

          <div style={{ fontWeight: 600, color: '#1c3e72', marginBottom: '0.6rem' }}>
            Select a drug to analyze
          </div>
          {drugOptions.length === 0 && (
            <div style={{ color: '#60656e', fontSize: '0.9rem' }}>
              No eligible drug interventions found for this trial.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {drugOptions.map(d => {
              const disabled = !d.has_dcna_profile;
              const isSelected = selectedDrugId === d.intervention_id;
              return (
                <label
                  key={d.intervention_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.7rem',
                    padding: '0.55rem 0.7rem',
                    borderRadius: 4,
                    border: isSelected ? '1px solid #1c3e72' : '1px solid #dee3ea',
                    background: isSelected ? '#eef3fb' : '#fafbfd',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.6 : 1,
                  }}
                >
                  <input
                    type="radio"
                    name="drug-option"
                    disabled={disabled}
                    checked={isSelected}
                    onChange={() => setSelectedDrugId(d.intervention_id)}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: '#1c3e72' }}>{d.standard_name}</div>
                    <div style={{ fontSize: '0.78rem', color: '#60656e' }}>
                      {d.moa_short_form || '(no MOA annotation)'}
                      {d.raw_names.length > 1 && (
                        <span style={{ marginLeft: 8 }}>
                          aka {d.raw_names.filter(r => r !== d.standard_name).join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      padding: '0.2rem 0.5rem',
                      borderRadius: 10,
                      background: d.has_dcna_profile ? '#d7ead8' : '#f1d7d7',
                      color: d.has_dcna_profile ? '#1b5e20' : '#8a1f1f',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: 0.3,
                    }}
                  >
                    {d.has_dcna_profile ? 'DCNA profile available' : 'no DCNA profile'}
                  </span>
                </label>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginTop: '0.9rem' }}>
            <button
              style={buttonStyle}
              onClick={handleRun}
              disabled={loading || selectedDrugId == null}
            >
              {loading ? 'Running…' : 'Run comparison'}
            </button>
            {loading && (
              <span style={{ color: '#60656e', fontSize: '0.85rem' }}>
                Running a fresh MOA simulation — this can take 30+ seconds.
              </span>
            )}
          </div>
        </div>
      )}

      {error && (
        <div style={{ ...panelStyle, color: '#b00020', marginBottom: '1rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && (
        <>
          <div ref={captureRef}>
          <div style={{ ...panelStyle, marginBottom: '1rem' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                rowGap: '0.9rem',
                columnGap: '2.25rem',
                fontSize: '0.9rem',
                lineHeight: 1.55,
              }}
            >
              {/* Row 1: trial identity */}
              <div><strong style={{ marginRight: 6 }}>Trial:</strong>{result.nct_id}</div>
              <div><strong style={{ marginRight: 6 }}>Drug:</strong>{result.drug}</div>
              <div><strong style={{ marginRight: 6 }}>MOA:</strong>{result.moa_category.replace(/^group:/, '')}</div>
              <div><strong style={{ marginRight: 6 }}>Targets:</strong>{result.drug_targets.join(', ') || '(none)'}</div>
              {/* Row 2: model params + headline prediction */}
              <div><strong style={{ marginRight: 6 }}>Learned TNAS threshold:</strong>{result.learned_dcna_threshold.toFixed(4)}</div>
              <div><strong style={{ marginRight: 6 }}>Expression threshold:</strong>{result.expression_threshold.toFixed(2)}</div>
              <div style={{ gridColumn: '3 / -1' }}>
                <strong style={{ marginRight: 6 }}>Percentage of TCGA patients predicted to respond based on trial criteria:</strong>
                {(result.left_panel.stats.response_rate * 100).toFixed(1)}%
              </div>
            </div>
            {(result.selected_arm || result.selected_subgroup) && (
              <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.7rem', background: '#f0f4fa', borderRadius: 4, fontSize: '0.82rem', color: '#1c3e72' }}>
                {result.selected_subgroup ? (
                  <>
                    <strong>Sub-population:</strong> {result.selected_subgroup.group_title}
                    <span style={{ color: '#555', marginLeft: 8, fontSize: '0.78rem' }}>
                      — {result.selected_subgroup.group_description.length > 120
                        ? result.selected_subgroup.group_description.slice(0, 120) + '…'
                        : result.selected_subgroup.group_description}
                    </span>
                  </>
                ) : result.selected_arm ? (
                  <>
                    <strong>Selected arm:</strong> {result.selected_arm.label}
                    {result.selected_arm.intervention_names.length > 0 && (
                      <span style={{ color: '#555', marginLeft: 8 }}>
                        (Therapies: {result.selected_arm.intervention_names.join(', ')})
                      </span>
                    )}
                  </>
                ) : null}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '25% 1fr', gap: '1rem', alignItems: 'start' }}>
            {/* Left column: criteria panel + diff panel */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0 }}>
              {/* TCGA-matchable criteria panel */}
              <div style={{ ...panelStyle, textAlign: 'center' }}>
                {(() => {
                  const incl = result.extracted_biomarkers.filter(b => b.mapped && b.context !== 'exclusion');
                  const excl = result.extracted_biomarkers.filter(b => b.mapped && b.context === 'exclusion');
                  return (
                    <>
                      <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#60656e', letterSpacing: 0.5, marginBottom: 8 }}>
                        TCGA-matchable criteria applied ({incl.length + excl.length})
                      </div>
                      <div style={{ fontSize: '0.85rem', textAlign: 'left' }}>
                        <div style={{ marginBottom: 4 }}>
                          <span style={{ color: '#555', fontWeight: 600 }}>Inclusion:</span>{' '}
                          {incl.length > 0
                            ? incl.map(b => b.marker).join(', ')
                            : <em style={{ color: '#888' }}>none</em>}
                        </div>
                        <div style={{ marginBottom: 4 }}>
                          <span style={{ color: '#555', fontWeight: 600 }}>Exclusion:</span>{' '}
                          {excl.length > 0
                            ? excl.map(b => b.marker).join(', ')
                            : <em style={{ color: '#888' }}>none</em>}
                        </div>
                        {result.unmapped_biomarkers.length > 0 && (
                          <div style={{ color: '#888' }}>
                            <span style={{ fontWeight: 600 }}>Ignored (unmappable):</span> {result.unmapped_biomarkers.length}
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* SATGBM vs Trial diff panel */}
              <div style={{ ...panelStyle, textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#60656e', letterSpacing: 0.5, marginBottom: 4 }}>
                SATGBM vs Trial
              </div>
              <div style={{ fontSize: '1.7rem', fontWeight: 700, color: '#1b7a3a' }}>
                {result.right_panel.stats.responders > 0
                  ? `${(result.left_panel.stats.responders_missed / result.right_panel.stats.responders * 100).toFixed(1)}%`
                  : '0.0%'}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#60656e', display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                percentage of predicted responders recovered
                <InlineHelp size={11} text="Of all the patients SATGBM predicts would respond, what fraction does the biomarker recover that the trial's criteria would have missed. Higher is better." />
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid #e0e4ea', margin: '0.9rem 0' }} />
              <div style={{ fontSize: '1.7rem', fontWeight: 700, color: result.diff.responders_recovered >= 0 ? '#1b7a3a' : '#b00020' }}>
                {result.diff.responders_recovered >= 0 ? '+' : ''}
                {result.diff.responders_recovered}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#60656e', display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                predicted responders recovered
                <InlineHelp size={11} text="Absolute count of patients SATGBM would enroll but the trial's criteria would exclude, and who SATGBM predicts would respond. Green = biomarker helps find more responders." />
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid #e0e4ea', margin: '0.9rem 0' }} />
              <div style={{ fontSize: '1.7rem', fontWeight: 700, color: result.diff.nonresponders_spared >= 0 ? '#1b7a3a' : '#b00020' }}>
                −{result.diff.nonresponders_spared}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#60656e', display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                predicted non-responders spared
                <InlineHelp size={11} text="Patients the trial would have enrolled but SATGBM predicts wouldn't respond. Screening these out reduces enrollment cost without losing responders." />
              </div>
            </div>

              {/* Biomarker–Therapy Evidence panel */}
              {result.biomarker_therapy_associations && result.biomarker_therapy_associations.length > 0 && (
                <div style={{ ...panelStyle }}>
                  <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#60656e', letterSpacing: 0.5, marginBottom: 8, textAlign: 'center' }}>
                    Biomarker–Therapy Evidence ({result.biomarker_therapy_associations.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {result.biomarker_therapy_associations.map((a, i) => {
                      const effectColor =
                        a.response_effect === 'increased_response' || a.response_effect === 'sensitivity'
                          ? '#1b7a3a'
                          : a.response_effect === 'resistance' || a.response_effect === 'decreased_response'
                          ? '#b00020'
                          : '#60656e';
                      const effectLabel =
                        a.response_effect === 'increased_response' ? '▲ Increased response'
                        : a.response_effect === 'sensitivity' ? '▲ Sensitivity'
                        : a.response_effect === 'resistance' ? '▼ Resistance'
                        : a.response_effect === 'decreased_response' ? '▼ Decreased response'
                        : a.response_effect === 'no_effect' ? '— No effect'
                        : a.response_effect.replace(/_/g, ' ');
                      const levelLabel =
                        a.evidence_level === 'level_1' ? 'L1'
                        : a.evidence_level === 'level_2' ? 'L2'
                        : a.evidence_level === 'level_3' ? 'L3'
                        : a.evidence_level === 'level_4' ? 'L4' : '?';
                      const levelColor =
                        a.evidence_level === 'level_1' ? '#1b5e20'
                        : a.evidence_level === 'level_2' ? '#33691e'
                        : a.evidence_level === 'level_3' ? '#7f6b00'
                        : '#888';
                      const levelBg =
                        a.evidence_level === 'level_1' ? '#d7ead8'
                        : a.evidence_level === 'level_2' ? '#e3efd4'
                        : a.evidence_level === 'level_3' ? '#fff3cd'
                        : '#eee';
                      const sizeLabel = a.effect_size ? ` (${a.effect_size})` : '';
                      return (
                        <div
                          key={i}
                          style={{
                            padding: '0.5rem 0.6rem',
                            background: a.marker_in_trial_criteria ? '#fdf6ee' : '#f9fafb',
                            border: a.marker_in_trial_criteria ? '1px solid #e8c07a' : '1px solid #e8ecf0',
                            borderRadius: 4,
                            fontSize: '0.78rem',
                            lineHeight: 1.45,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem', marginBottom: 3 }}>
                            <span style={{ fontWeight: 700, color: '#1c3e72' }}>{a.biomarker}</span>
                            <span
                              style={{
                                fontSize: '0.65rem',
                                fontWeight: 700,
                                padding: '0.1rem 0.35rem',
                                borderRadius: 3,
                                background: levelBg,
                                color: levelColor,
                                flexShrink: 0,
                              }}
                            >
                              {levelLabel}
                            </span>
                          </div>
                          <div style={{ color: effectColor, fontWeight: 600, fontSize: '0.75rem' }}>
                            {effectLabel}{sizeLabel}
                          </div>
                          {a.mechanism_summary && (
                            <div style={{ color: '#555', fontSize: '0.72rem', marginTop: 2, lineHeight: 1.35 }}>
                              {a.mechanism_summary.length > 150
                                ? a.mechanism_summary.slice(0, 150) + '…'
                                : a.mechanism_summary}
                            </div>
                          )}
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: 3, fontSize: '0.65rem', color: '#888' }}>
                            {a.disease_context && <span>{a.disease_context}</span>}
                            {a.clinical_actionability && (
                              <span style={{ textTransform: 'capitalize' }}>
                                · {a.clinical_actionability.replace(/_/g, ' ')}
                              </span>
                            )}
                            {a.marker_in_trial_criteria && (
                              <span style={{ color: '#b07d2e', fontWeight: 600 }}>· In trial criteria</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>

            {/* Right: single plot + two rows of stat tiles */}
            <div style={panelStyle}>
              <div ref={plotRef} style={{ width: '100%' }} />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
                <StatTile
                  label="Trial Eligible"
                  value={String(result.left_panel.stats.enrolled ?? 0)}
                  markers={[DOT_ORANGE_ELIGIBLE, DOT_GRAY_ELIGIBLE]}
                  showPlus
                  tooltip="Total patients meeting the trial's written eligibility criteria (responders + non-responders combined)."
                />
                <StatTile
                  label="Trial Eligible Predicted Responders"
                  value={String(result.left_panel.stats.responders)}
                  markers={[DOT_ORANGE_ELIGIBLE]}
                  tooltip="Patients both eligible AND predicted responders by SATGBM. These are the patients the trial enrolls who would likely respond."
                />
                <div style={{ ...tileStyle, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', flex: 2 }}>
                  <div style={{ fontSize: '0.7rem', color: '#60656e', textTransform: 'uppercase', letterSpacing: 0.5, minHeight: '2.2em', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 4 }}>
                    <span>Percentage of TCGA patients predicted to respond based on trial criteria</span>
                    <InlineHelp
                      size={11}
                      text={
                        "Of the TCGA patients who satisfy this trial's written eligibility criteria, the fraction predicted to respond by the SATGBM biomarker rule (DCNA > learned threshold AND target expression > 0). " +
                        "Numerator = eligible AND predicted-responder; denominator = eligible (responders + non-responders). " +
                        "This is the model's expectation for the observed response rate if the trial were run on a TCGA-like population. " +
                        "Compare to 'Observed Clinical Response Rate' on the right: close values = biomarker is well-calibrated for this drug; large gap = either the trial population differs from TCGA, or the DCNA threshold needs re-learning for this MOA."
                      }
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <DotIcon dot={DOT_ORANGE_ELIGIBLE} />
                      </div>
                      <div style={{ width: '100%', height: 2, background: '#60656e', borderRadius: 1 }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <DotIcon dot={DOT_ORANGE_ELIGIBLE} />
                        <span style={opStyle}>+</span>
                        <DotIcon dot={DOT_GRAY_ELIGIBLE} />
                      </div>
                    </div>
                    <span style={{ fontSize: '1.3rem', fontWeight: 700, color: '#1c3e72' }}>
                      {(result.left_panel.stats.response_rate * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
                <StatTile
                  label="Observed Clinical Response Rate"
                  value={result.observed_response_rate != null ? `${(result.observed_response_rate * 100).toFixed(1)}%` : 'N/A'}
                  tooltip="Response rate the trial actually reported for this drug/arm. If SATGBM's predicted rate (left of this tile) is close, the biomarker is well-calibrated for this drug."
                />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <StatTile
                  label="SATGBM Predicted Responders"
                  value={String(result.right_panel.stats.responders ?? 0)}
                  markers={[DOT_ORANGE_INELIGIBLE, DOT_ORANGE_ELIGIBLE]}
                  showPlus
                  tooltip="All patients SATGBM predicts would respond — whether or not the trial's criteria would enroll them."
                />
                <StatTile
                  label="Predicted Responders Missed by Trial Criteria"
                  value={String(result.left_panel.stats.responders_missed)}
                  markers={[DOT_ORANGE_INELIGIBLE]}
                  tooltip="Patients SATGBM predicts would respond but the trial's written criteria exclude. Large values = the eligibility language may be too restrictive."
                />
                <StatTile
                  label="Predicted Non-responders Spared"
                  value={String(result.diff.nonresponders_spared)}
                  markers={[DOT_GRAY_ELIGIBLE]}
                  tooltip="Predicted non-responders that the trial would enroll anyway. Screening these out would reduce enrollment costs without losing responders."
                />
              </div>
            </div>
            {/* Right column continued: Evidence Level Guide as separate tile */}
            <div>
              {result.biomarker_therapy_associations && result.biomarker_therapy_associations.length > 0 && (
                <div style={{
                  ...panelStyle,
                  maxWidth: 250,
                }}>
                  <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, color: '#60656e', marginBottom: 6, textAlign: 'center' }}>
                    Evidence Level Guide
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.75rem', color: '#555' }}>
                    <div><span style={{ fontWeight: 700, color: '#1b5e20', background: '#d7ead8', padding: '0.1rem 0.4rem', borderRadius: 3, fontSize: '0.65rem', marginRight: 6, display: 'inline-block', minWidth: 22, textAlign: 'center' }}>L1</span>Phase III / FDA-approved</div>
                    <div><span style={{ fontWeight: 700, color: '#33691e', background: '#e3efd4', padding: '0.1rem 0.4rem', borderRadius: 3, fontSize: '0.65rem', marginRight: 6, display: 'inline-block', minWidth: 22, textAlign: 'center' }}>L2</span>Phase II / concordant studies</div>
                    <div><span style={{ fontWeight: 700, color: '#7f6b00', background: '#fff3cd', padding: '0.1rem 0.4rem', borderRadius: 3, fontSize: '0.65rem', marginRight: 6, display: 'inline-block', minWidth: 22, textAlign: 'center' }}>L3</span>Preclinical / early-phase</div>
                    <div><span style={{ fontWeight: 700, color: '#888', background: '#eee', padding: '0.1rem 0.4rem', borderRadius: 3, fontSize: '0.65rem', marginRight: 6, display: 'inline-block', minWidth: 22, textAlign: 'center' }}>L4</span>Case reports / emerging</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          </div>

          <div style={{ marginTop: '0.8rem' }}>
            <button
              style={{ ...buttonStyle, background: '#1c3e72' }}
              onClick={handleSnapshot}
            >
              📸 Save snapshot (SVG)
            </button>
          </div>

          <div style={{ ...panelStyle, marginTop: '1rem' }}>
            <button
              style={{ ...buttonStyle, background: '#4a6a99' }}
              onClick={() => setShowBiomarkers(s => !s)}
            >
              {showBiomarkers ? 'Hide' : 'Show'} extracted biomarkers ({result.extracted_biomarkers.length})
            </button>
            {showBiomarkers && (
              <div style={{ marginTop: '0.8rem', fontSize: '0.85rem' }}>
                <div style={{ marginBottom: 8 }}>
                  <strong>Mapped (applied to TCGA patients):</strong>
                  <ul>
                    {result.extracted_biomarkers.filter(b => b.mapped).map((b, i) => (
                      <li key={i}>{b.marker} <em style={{ color: '#60656e' }}>({b.context})</em></li>
                    ))}
                    {result.extracted_biomarkers.filter(b => b.mapped).length === 0 && <li>(none)</li>}
                  </ul>
                </div>
                <div>
                  <strong>Unmapped (ignored):</strong>
                  <ul>
                    {result.unmapped_biomarkers.map((b, i) => <li key={i}>{b}</li>)}
                    {result.unmapped_biomarkers.length === 0 && <li>(none)</li>}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
