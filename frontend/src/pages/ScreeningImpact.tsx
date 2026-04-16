/* eslint-disable @typescript-eslint/no-explicit-any --
 * Plotly layout objects + screening-impact API records use dynamic
 * keys not fully typed in frontend/src/types. Tracked for v1.1.
 */
/* eslint-disable react-hooks/exhaustive-deps --
 * Ref-cleanup warnings from the three plot effects; refs are copied
 * to local vars inside each effect at read time. Tracked for v1.1.
 */
import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import Plotly from 'plotly.js/dist/plotly.min.js';
import { InterpretBox, InlineHelp } from '../components/Interpretation';
import { withProvenance, provenanceImageFilename } from '../utils/provenance';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
});

interface ImpactRow {
  moa_category: string;
  sim_id: string;
  nct_id: string;
  title: string;
  arm_group?: string;
  drugs: string[];
  enrollment?: number;
  recruitment_criteria: string[];
  observed_rate: number;
  screened_rate: number;
  lift_pp: number;
  learned_threshold?: number;
  eligible_patients?: number;
  cohort_size?: number;
}

const MOA_COLORS: Record<string, string> = {
  'EGFR inhibitor': '#2e7d32',
  'PARP inhibitor': '#6a1b9a',
  'VEGFR inhibitor': '#1e3a8a',
};

// Short display label for each arm on the y-axis
function armLabel(r: ImpactRow): string {
  const nct = (r.nct_id || '').split(':')[0];
  const arm = r.arm_group ? ` — ${r.arm_group}` : '';
  const crit = (r.recruitment_criteria || []).join(', ') || 'no criteria';
  return `<b>${nct}</b>${arm}<br><span style="font-size:10px;color:#555">${crit}</span>`;
}

export default function ScreeningImpact() {
  const [rows, setRows] = useState<ImpactRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const dumbbellRef = useRef<HTMLDivElement>(null);
  const liftRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    api
      .get('/simulation/screening-impact')
      .then(({ data }) => setRows(data.results || []))
      .catch((e) => setError(e?.response?.data?.detail || e.message))
      .finally(() => setLoading(false));
  }, []);

  // Dumbbell chart: observed → screened per arm, colored by MOA.
  useEffect(() => {
    if (!rows || rows.length === 0 || !dumbbellRef.current) return;
    const sorted = [...rows].sort((a, b) => a.lift_pp - b.lift_pp);
    // Strip prior-therapy entries from the criteria shown on the y-axis
    // (e.g. "Prior Bevacizumab", "Prior TMZ") while still plotting every arm.
    const isPriorTherapy = (c: string) => /^\s*prior\s+/i.test(c);
    const labelFor = (r: ImpactRow): string => {
      const nct = (r.nct_id || '').split(':')[0];
      const arm = r.arm_group ? ` — ${r.arm_group}` : '';
      const crit = (r.recruitment_criteria || []).filter(
        (c) => !isPriorTherapy(c) && !/alkylator[-\s]?resistant/i.test(c),
      );
      const critText = crit.length > 0 ? crit.join(', ') : '&nbsp;';
      return `<b>${nct}</b>${arm}<br><span style="font-size:10px;color:#555">${critText}</span>`;
    };
    const y = sorted.map(labelFor);

    const traces: any[] = [];
    // Connector lines (one per arm)
    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      traces.push({
        type: 'scatter',
        mode: 'lines',
        x: [r.observed_rate, r.screened_rate],
        y: [y[i], y[i]],
        line: { color: '#aaa', width: 2 },
        hoverinfo: 'skip',
        showlegend: false,
      });
    }

    // Observed marker
    traces.push({
      type: 'scatter',
      mode: 'markers',
      x: sorted.map((r) => r.observed_rate),
      y,
      name: 'Observed (recruitment criteria)',
      marker: { size: 12, color: '#c62828', symbol: 'circle', line: { color: '#333', width: 0.8 } },
      hovertemplate: '<b>%{y}</b><br>Observed: %{x:.1%}<extra></extra>',
      legendgroup: 'obs',
    });
    // Screened marker, grouped by MOA so each MOA gets its own color swatch
    const moaGroups: Record<string, number[]> = {};
    sorted.forEach((r, i) => {
      (moaGroups[r.moa_category] = moaGroups[r.moa_category] || []).push(i);
    });
    for (const moa of Object.keys(moaGroups)) {
      const idxs = moaGroups[moa];
      traces.push({
        type: 'scatter',
        mode: 'markers',
        x: idxs.map((i) => sorted[i].screened_rate),
        y: idxs.map((i) => y[i]),
        name: `Biomarker-screened (${moa})`,
        marker: { size: 14, color: MOA_COLORS[moa] || '#1e3a8a', symbol: 'diamond', line: { color: '#333', width: 0.8 } },
        hovertemplate: '<b>%{y}</b><br>Screened: %{x:.1%}<br>MOA: ' + moa + '<extra></extra>',
        legendgroup: moa,
      });
    }

    const layout: any = {
      font: { size: 14 },
      title: { text: 'Biomarker Screening vs. Observed Response Rates' },
      xaxis: { title: { text: 'Response Rate' }, tickformat: '.0%', range: [-0.02, Math.max(...sorted.map((r) => r.screened_rate)) + 0.05], automargin: true },
      yaxis: { automargin: true, tickfont: { size: 11 } },
      height: Math.max(520, 60 * sorted.length + 160),
      width: 1280,
      margin: { l: 560, r: 40, t: 70, b: 80 },
      showlegend: true,
      legend: { x: -1.35, y: 1.0, xanchor: 'left', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.92)', bordercolor: '#ccc', borderwidth: 1 },
    };
    Plotly.newPlot(dumbbellRef.current, traces, withProvenance(layout, '/screening-impact/dumbbell'), {
      responsive: false,
      toImageButtonOptions: { format: 'svg', filename: provenanceImageFilename('screening_impact_dumbbell'), width: 1280, height: layout.height, scale: 4 },
    });
    return () => { if (dumbbellRef.current) Plotly.purge(dumbbellRef.current); };
  }, [rows]);

  // Horizontal bar of lift (pp), colored by MOA
  useEffect(() => {
    if (!rows || rows.length === 0 || !liftRef.current) return;
    const sorted = [...rows].sort((a, b) => a.lift_pp - b.lift_pp);
    const trace: any = {
      type: 'bar',
      orientation: 'h',
      x: sorted.map((r) => r.lift_pp),
      y: sorted.map(armLabel),
      marker: {
        color: sorted.map((r) => MOA_COLORS[r.moa_category] || '#1e3a8a'),
        line: { color: '#333', width: 0.6 },
      },
      text: sorted.map((r) => `+${r.lift_pp.toFixed(1)} pp`),
      textposition: 'outside',
      hovertemplate: '<b>%{y}</b><br>Lift: +%{x:.1f} pp<extra></extra>',
      showlegend: false,
    };
    // Legend-only traces for MOA colors
    const moas = Array.from(new Set(sorted.map((r) => r.moa_category)));
    const legendTraces = moas.map((m) => ({
      type: 'scatter',
      mode: 'markers',
      x: [null],
      y: [null],
      marker: { size: 14, color: MOA_COLORS[m] || '#1e3a8a', symbol: 'square' },
      name: m,
      hoverinfo: 'skip',
      showlegend: true,
    }));
    const layout: any = {
      font: { size: 14 },
      title: { text: 'Response-Rate Lift from Biomarker Screening (percentage points)' },
      xaxis: { title: { text: 'Lift (pp)' }, automargin: true, zeroline: true },
      yaxis: { automargin: true, tickfont: { size: 11 } },
      height: Math.max(520, 60 * sorted.length + 160),
      width: 1280,
      margin: { l: 560, r: 60, t: 70, b: 80 },
      showlegend: true,
      legend: { x: -0.42, y: 1.0, xanchor: 'left', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.92)', bordercolor: '#ccc', borderwidth: 1 },
    };
    Plotly.newPlot(liftRef.current, [trace, ...legendTraces], withProvenance(layout, '/screening-impact/lift'), {
      responsive: false,
      toImageButtonOptions: { format: 'svg', filename: provenanceImageFilename('screening_impact_lift'), width: 1280, height: layout.height, scale: 4 },
    });
    return () => { if (liftRef.current) Plotly.purge(liftRef.current); };
  }, [rows]);

  // Grouped bar: per-MOA mean observed vs mean screened
  useEffect(() => {
    if (!rows || rows.length === 0 || !summaryRef.current) return;
    const byMoa: Record<string, ImpactRow[]> = {};
    for (const r of rows) (byMoa[r.moa_category] = byMoa[r.moa_category] || []).push(r);
    const moas = Object.keys(byMoa);
    if (moas.length === 0) return;
    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const obs = moas.map((m) => mean(byMoa[m].map((r) => r.observed_rate)));
    const scr = moas.map((m) => mean(byMoa[m].map((r) => r.screened_rate)));
    const counts = moas.map((m) => byMoa[m].length);

    const traces: any[] = [
      {
        type: 'bar',
        name: 'Observed (recruitment criteria)',
        x: moas.map((m, i) => `${m}<br>(n=${counts[i]})`),
        y: obs,
        marker: { color: '#c62828' },
        text: obs.map((v) => `${(v * 100).toFixed(1)}%`),
        textposition: 'outside',
      },
      {
        type: 'bar',
        name: 'Biomarker-screened',
        x: moas.map((m, i) => `${m}<br>(n=${counts[i]})`),
        y: scr,
        marker: { color: '#1e3a8a' },
        text: scr.map((v) => `${(v * 100).toFixed(1)}%`),
        textposition: 'outside',
      },
    ];
    const layout: any = {
      font: { size: 16 },
      title: { text: 'Mean Response Rate by MOA — Criteria vs. Biomarker Screening' },
      barmode: 'group',
      yaxis: { title: { text: 'Mean Response Rate' }, tickformat: '.0%', range: [0, Math.max(...scr, ...obs) + 0.08], automargin: true },
      xaxis: { title: { text: 'MOA' }, automargin: true },
      height: 520,
      width: 900,
      margin: { l: 90, r: 30, t: 80, b: 90 },
      legend: { x: 0.02, y: 0.98, xanchor: 'left', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.9)', bordercolor: '#ccc', borderwidth: 1 },
    };
    Plotly.newPlot(summaryRef.current, traces, withProvenance(layout, '/screening-impact/by-moa'), {
      responsive: false,
      toImageButtonOptions: { format: 'svg', filename: provenanceImageFilename('screening_impact_by_moa'), width: 900, height: 520, scale: 4 },
    });
    return () => { if (summaryRef.current) Plotly.purge(summaryRef.current); };
  }, [rows]);

  return (
    <div style={{ padding: '1rem 1.5rem', maxWidth: 1200 }}>
      <h1 style={{ marginTop: 0 }}>Screening Impact</h1>
      <p style={{ color: '#555', maxWidth: 900 }}>
        For the most recent completed <b>EGFR</b>, <b>PARP</b>, and <b>VEGFR</b> inhibitor
        simulations, this page isolates the testing-trial arms whose observed response rates
        were hindered by the recruitment criteria that were actually applied. The "screened"
        rate is the mean predicted response rate across simulation iterations when a TCGA
        cohort is filtered solely on <code>DCNA &gt; learned_threshold</code> AND
        <code> gene expression &gt; 0</code> — i.e., the biomarker-based responder definition.
        Arms shown have positive lift (screened &gt; observed).
      </p>

      <InterpretBox id="screening-impact-intro" title="How to read this page">
        <p style={{ margin: '0 0 0.5rem' }}>
          Each arm below was enrolled under its original clinical recruitment criteria
          (age, prior therapy, performance status, etc.) and produced an <em>observed</em>{' '}
          response rate. This page asks: <em>what if the arm had been enrolled instead
          by biomarker alone?</em> The biomarker rule is{' '}
          <code>DCNA &gt; learned_threshold</code> AND{' '}
          <code>gene expression &gt; 0</code>, with the threshold learned in simulation.
        </p>
        <ul style={{ margin: '0.25rem 0 0.5rem 1.1rem', padding: 0 }}>
          <li>
            <strong>Mean-by-MOA bar chart (top)</strong> — red = observed RR under
            recruitment criteria, navy = biomarker-screened RR. The gap between bars
            is the MOA-level lift. Larger gaps suggest the MOA would benefit most
            from biomarker-gated enrollment.
          </li>
          <li>
            <strong>Per-arm dumbbell (middle)</strong> — one row per testing-trial arm.
            Red dot = observed; MOA-colored diamond = biomarker-screened. Gray line is
            the lift. Arms are sorted by lift (smallest at top, largest at bottom).
          </li>
          <li>
            <strong>Lift ranking bar chart</strong> — absolute lift in percentage points,
            colored by MOA. Quickly identifies which arms have the most to gain from
            biomarker screening.
          </li>
          <li>
            <strong>Positive-lift filter</strong> — only arms where screened &gt; observed
            are shown. Arms where biomarker screening would <em>lower</em> the RR are
            excluded (they would benefit less from this approach).
          </li>
        </ul>
        <p style={{ margin: '0.4rem 0 0', fontSize: '0.78rem', color: '#555' }}>
          <strong>Caveat:</strong> "Biomarker-screened RR" is predicted by the learned
          DCNA rule applied to the full TCGA cohort, not to the trial's actual enrolled
          patients. Real-world biomarker screening would depend on molecular profiling
          availability and patient consent for testing.
        </p>
      </InterpretBox>

      {loading && <div>Loading screening-impact data…</div>}
      {error && <div style={{ color: '#c62828' }}>Error: {error}</div>}
      {rows && rows.length === 0 && <div>No arms with positive lift were found in the latest simulations.</div>}

      {rows && rows.length > 0 && (
        <>
          <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginTop: '1rem' }}>
            <div ref={summaryRef} style={{ width: 900, minWidth: 900 }} />
          </div>

          <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginTop: '1rem' }}>
            <h3 style={{ marginTop: 0 }}>Per-Arm Response Rate Comparison</h3>
            <p style={{ fontSize: '0.85rem', color: '#555', marginTop: 0 }}>
              Each row is a single testing-trial arm. The red dot shows the observed response
              rate under the trial's recruitment criteria; the diamond shows the mean predicted
              response rate when the cohort is selected by the biomarker rule. The connecting
              gray line is the lift.
            </p>
            <div ref={dumbbellRef} style={{ width: 1280, minWidth: 1280, overflowX: 'auto' }} />
          </div>

          <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginTop: '1rem' }}>
            <h3 style={{ marginTop: 0 }}>Lift Ranking</h3>
            <div ref={liftRef} style={{ width: 1280, minWidth: 1280, overflowX: 'auto' }} />
          </div>

          <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginTop: '1rem' }}>
            <h3 style={{ marginTop: 0 }}>Trial Details</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>MOA</th>
                    <th style={thStyle}>Trial / Arm</th>
                    <th style={thStyle}>Drugs</th>
                    <th style={thStyle}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        Recruitment Criteria
                        <InlineHelp
                          size={11}
                          text="Clinical recruitment criteria used in the original trial — e.g., IDH status, EGFR amplification, prior therapy, performance status. Drives the 'observed' RR column."
                        />
                      </span>
                    </th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                        Observed RR
                        <InlineHelp
                          size={11}
                          text="Response rate actually reported in the trial arm when enrolled under recruitment criteria. From CT.gov outcome data."
                        />
                      </span>
                    </th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                        Screened RR
                        <InlineHelp
                          size={11}
                          text="Mean predicted response rate across simulation iterations when the TCGA cohort is filtered by DCNA > learned_threshold AND gene expression > 0 (biomarker rule only, no clinical criteria)."
                        />
                      </span>
                    </th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                        Lift (pp)
                        <InlineHelp
                          size={11}
                          text="Screened RR − Observed RR in percentage points. Positive values mean biomarker gating would outperform the original recruitment criteria."
                        />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].sort((a, b) => b.lift_pp - a.lift_pp).map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={tdStyle}>
                        <span style={{
                          display: 'inline-block',
                          width: 10, height: 10, borderRadius: 2,
                          background: MOA_COLORS[r.moa_category] || '#1e3a8a',
                          marginRight: 6,
                        }} />
                        {r.moa_category}
                      </td>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>{(r.nct_id || '').split(':')[0]}</div>
                        {r.arm_group && <div style={{ color: '#666' }}>{r.arm_group}</div>}
                      </td>
                      <td style={tdStyle}>{(r.drugs || []).join(', ')}</td>
                      <td style={tdStyle}>{(r.recruitment_criteria || []).join(', ')}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{(r.observed_rate * 100).toFixed(1)}%</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{(r.screened_rate * 100).toFixed(1)}%</td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: '#2e7d32', fontWeight: 700 }}>
                        +{r.lift_pp.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '6px 8px',
  textAlign: 'left',
  borderBottom: '2px solid #ddd',
  fontWeight: 600,
  fontSize: '0.78rem',
  background: '#f7f7f7',
  position: 'sticky',
  top: 0,
};

const tdStyle: React.CSSProperties = {
  padding: '6px 8px',
  verticalAlign: 'top',
};
