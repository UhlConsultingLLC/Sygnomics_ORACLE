import { Fragment, useState, useEffect } from 'react';
import {
  runTAMEstimate,
  fetchMOACategoriesForSim,
  type TAMResponse,
} from '../services/api';
import { InterpretBox, InlineHelp } from '../components/Interpretation';

const fmt = (n: number) => n.toLocaleString('en-US');
const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

interface MOAOption {
  category: string;
  value: string;
  drug_count: number;
  is_group: boolean;
}

export default function TAMEstimator() {
  const [usPatients, setUsPatients] = useState(20000);
  const [wwPatients, setWwPatients] = useState(75000);
  const [rule, setRule] = useState<'majority' | 'any'>('majority');
  const [topN, setTopN] = useState(3);
  const [useTopN, setUseTopN] = useState(true);
  const [options, setOptions] = useState<MOAOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [result, setResult] = useState<TAMResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchMOACategoriesForSim()
      .then((o) => setOptions(o))
      .catch((e) => setError(`Failed to load MOA categories: ${e.message}`));
  }, []);

  const toggleMOA = (moa: string) => {
    setSelected((s) =>
      s.includes(moa) ? s.filter((x) => x !== moa) : [...s, moa],
    );
  };

  const handleRun = async () => {
    if (!selected.length) {
      setError('Select at least one MOA.');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      // The backend stores moa_category without the "group:" prefix,
      // so strip it before sending.
      const moas = selected.map((v) => (v.startsWith('group:') ? v.slice(6) : v));
      const data = await runTAMEstimate({
        moas,
        us_patients: usPatients,
        ww_patients: wwPatients,
        rule,
        top_n: useTopN ? topN : 0,
      });
      setResult(data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const filteredOptions = options.filter((o) =>
    o.category.toLowerCase().includes(filter.toLowerCase()),
  );

  // Table color bands (lightly tinted rows, mimicking the reference image)
  const bandColors = [
    '#e7f3dc', // green
    '#ebdef0', // purple
    '#d6e4f0', // blue
    '#fdf2d0', // yellow
    '#f9e0d0', // orange
    '#dff5f3', // teal
  ];

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1100 }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
        TAM Estimator — Predicted Responders by Drug MOA
      </h1>
      <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '1rem' }}>
        Estimate the number of GBM patients that would be predicted to respond to
        each drug MOA class based on the learned DCNA threshold and gene expression
        &gt; 0 within the TCGA cohort. Enter US and worldwide GBM patient counts,
        select drug MOAs that have completed simulations, and the tool multiplies
        the TCGA response rate against your population counts. Unique responders
        across all MOAs are estimated via the union of responder IDs.
      </p>

      <InterpretBox id="tam-intro" title="How to read this page">
        <p style={{ margin: '0 0 0.5rem' }}>
          This page projects how many GBM patients would be predicted responders,
          by MOA class, using the learned DCNA threshold from simulation runs.
          The math is intentionally simple: <em>TCGA response rate × annual patient population</em>.
          The value is in comparing MOA classes and estimating total addressable
          market (TAM) when biomarker-gated.
        </p>
        <ul style={{ margin: '0.25rem 0 0.5rem 1.1rem', padding: 0 }}>
          <li>
            <strong>Response Rate (TCGA)</strong> — fraction of the TCGA cohort flagged as
            a predicted responder by the MOA's simulation (learned DCNA threshold +
            expression &gt; 0). This is the biomarker-gated prevalence, not an observed
            clinical response rate.
          </li>
          <li>
            <strong>Top-N vs All trials</strong> — <em>Top-N</em> selects the N best-performing
            drugs per MOA by response rate (less noisy; highlights leads).
            <em> All trials aggregated</em> uses every testing-set trial with a majority- or
            any-vote rule across drugs in the class (broader, noisier estimate).
          </li>
          <li>
            <strong>Per-MOA rows (colored bands)</strong> — US and WW projections are on
            separate rows so you can read the absolute patient counts directly.
            Response rate is repeated for quick comparison across MOAs.
          </li>
          <li>
            <strong>Union total (gold band)</strong> — each TCGA patient is counted{' '}
            <em>at most once</em> across all selected MOAs. The union response rate is
            therefore ≤ the sum of individual MOA rates (overlap is discarded), and
            represents unique patients addressable by any drug in the selected set.
          </li>
          <li>
            <strong>Missing simulations</strong> — MOAs without a completed simulation are
            excluded and listed in a yellow warning banner above the table.
          </li>
        </ul>
        <p style={{ margin: '0.4rem 0 0', fontSize: '0.78rem', color: '#555' }}>
          <strong>Caveat:</strong> TAM is an upper-bound market estimate assuming perfect
          biomarker deployment and uniform drug access. It does not model adherence,
          pricing, or clinical response beyond what the DCNA threshold predicts.
        </p>
      </InterpretBox>

      {/* Inputs */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '1rem',
          marginBottom: '1rem',
          background: '#f7f9fc',
          padding: '1rem',
          border: '1px solid #e0e6ed',
          borderRadius: 6,
        }}
      >
        <label style={{ fontSize: '0.85rem', color: '#444' }}>
          US GBM Patients / year
          <input
            type="number"
            value={usPatients}
            onChange={(e) => setUsPatients(parseInt(e.target.value || '0', 10))}
            style={{ width: '100%', padding: '0.4rem', marginTop: 4, border: '1px solid #ccc', borderRadius: 4 }}
          />
        </label>
        <label style={{ fontSize: '0.85rem', color: '#444' }}>
          Worldwide GBM Patients / year
          <input
            type="number"
            value={wwPatients}
            onChange={(e) => setWwPatients(parseInt(e.target.value || '0', 10))}
            style={{ width: '100%', padding: '0.4rem', marginTop: 4, border: '1px solid #ccc', borderRadius: 4 }}
          />
        </label>
        <label style={{ fontSize: '0.85rem', color: '#444' }}>
          Drug selection
          <select
            value={useTopN ? 'topn' : 'all'}
            onChange={(e) => setUseTopN(e.target.value === 'topn')}
            style={{ width: '100%', padding: '0.4rem', marginTop: 4, border: '1px solid #ccc', borderRadius: 4 }}
          >
            <option value="topn">Top-N drugs per MOA (by response rate)</option>
            <option value="all">All trials aggregated (classification matrix)</option>
          </select>
        </label>
        {useTopN ? (
          <label style={{ fontSize: '0.85rem', color: '#444' }}>
            Top-N drugs per MOA
            <input
              type="number"
              min={1}
              max={20}
              value={topN}
              onChange={(e) => setTopN(Math.max(1, parseInt(e.target.value || '1', 10)))}
              style={{ width: '100%', padding: '0.4rem', marginTop: 4, border: '1px solid #ccc', borderRadius: 4 }}
            />
          </label>
        ) : (
          <label style={{ fontSize: '0.85rem', color: '#444' }}>
            Aggregation rule
            <select
              value={rule}
              onChange={(e) => setRule(e.target.value as 'majority' | 'any')}
              style={{ width: '100%', padding: '0.4rem', marginTop: 4, border: '1px solid #ccc', borderRadius: 4 }}
            >
              <option value="majority">Majority (≥50% of trials)</option>
              <option value="any">Any (≥1 trial)</option>
            </select>
          </label>
        )}
      </div>

      {/* MOA picker */}
      <div style={{ marginBottom: '1rem', border: '1px solid #e0e6ed', borderRadius: 6, padding: '0.75rem', background: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <strong style={{ fontSize: '0.9rem' }}>Drug MOAs ({selected.length} selected)</strong>
          <input
            placeholder="Filter MOAs…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', border: '1px solid #ccc', borderRadius: 4, width: 240 }}
          />
        </div>
        <div style={{ maxHeight: 260, overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: '0.78rem' }}>
          {filteredOptions.map((o) => (
            <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px', cursor: 'pointer', fontWeight: o.is_group ? 600 : 400 }}>
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={() => toggleMOA(o.value)}
              />
              <span>{o.category}</span>
            </label>
          ))}
        </div>
        <button
          onClick={handleRun}
          disabled={loading || !selected.length}
          style={{
            marginTop: '0.75rem',
            padding: '0.5rem 1.25rem',
            background: loading || !selected.length ? '#aaa' : '#1c3e72',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: loading || !selected.length ? 'default' : 'pointer',
            fontWeight: 600,
          }}
        >
          {loading ? 'Running…' : 'Calculate TAM'}
        </button>
        {error && <div style={{ marginTop: '0.5rem', color: '#c62828', fontSize: '0.8rem' }}>{error}</div>}
      </div>

      {/* Results */}
      {result && (
        <div>
          {result.missing_moas.length > 0 && (
            <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: '#fff3cd', border: '1px solid #ffeeba', borderRadius: 4, fontSize: '0.8rem', color: '#856404' }}>
              <strong>Missing simulations:</strong> {result.missing_moas.join(', ')} — run a simulation for these MOAs first.
            </div>
          )}
          <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.5rem' }}>
            TCGA cohort size: {fmt(result.cohort_total)} ·{' '}
            {result.top_n > 0
              ? `Top-${result.top_n} drugs per MOA`
              : `All trials aggregated (${result.rule} rule)`}
          </div>
          {result.top_n > 0 && result.per_moa.some((r) => r.top_drugs?.length) && (
            <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: '#f0f6ff', border: '1px solid #c9dbf3', borderRadius: 4, fontSize: '0.78rem' }}>
              <strong>Top drugs selected per MOA:</strong>
              <ul style={{ margin: '0.3rem 0 0 1.2rem', padding: 0 }}>
                {result.per_moa.map((r) =>
                  r.top_drugs && r.top_drugs.length ? (
                    <li key={r.moa_category}>
                      <strong>{r.moa_category}</strong> (of {r.n_drugs_evaluated} drugs):{' '}
                      {r.top_drugs
                        .map((d) => `${d.drug_name} (${pct(d.response_rate)})`)
                        .join(', ')}
                    </li>
                  ) : null,
                )}
              </ul>
            </div>
          )}
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.85rem',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}
          >
            <thead>
              <tr style={{ background: '#1c3e72', color: '#fff' }}>
                <th colSpan={4} style={{ padding: '0.75rem', textAlign: 'center', fontSize: '1rem' }}>
                  SATGBM Identified TAM by Drug MOA
                </th>
              </tr>
              <tr style={{ background: '#f0f3f8' }}>
                <th style={{ padding: '0.4rem', textAlign: 'left', border: '1px solid #d0d6df' }}>MOA</th>
                <th style={{ padding: '0.4rem', textAlign: 'right', border: '1px solid #d0d6df' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                    Response Rate (TCGA)
                    <InlineHelp
                      size={11}
                      text="Fraction of the TCGA cohort flagged as a predicted responder by this MOA's learned DCNA threshold + expression > 0 rule. Biomarker prevalence, not clinical response rate."
                    />
                  </span>
                </th>
                <th style={{ padding: '0.4rem', textAlign: 'right', border: '1px solid #d0d6df' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                    US Predicted
                    <InlineHelp
                      size={11}
                      text="Response rate (TCGA) × US GBM patients/year. Represents annual US patients likely to benefit from drugs in this MOA if biomarker-gated."
                    />
                  </span>
                </th>
                <th style={{ padding: '0.4rem', textAlign: 'right', border: '1px solid #d0d6df' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                    WW Predicted
                    <InlineHelp
                      size={11}
                      text="Response rate (TCGA) × worldwide GBM patients/year. Represents annual global patients likely to benefit if biomarker-gated."
                    />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ fontWeight: 600 }}>
                <td style={{ padding: '0.4rem', border: '1px solid #d0d6df' }}>Annual Active GBM Patients (US)</td>
                <td style={{ padding: '0.4rem', border: '1px solid #d0d6df', textAlign: 'right' }}>—</td>
                <td style={{ padding: '0.4rem', border: '1px solid #d0d6df', textAlign: 'right' }}>{fmt(result.us_patients)}</td>
                <td style={{ padding: '0.4rem', border: '1px solid #d0d6df', textAlign: 'right' }}>—</td>
              </tr>
              <tr style={{ fontWeight: 600 }}>
                <td style={{ padding: '0.4rem', border: '1px solid #d0d6df' }}>Annual Active GBM Patients (WW)</td>
                <td style={{ padding: '0.4rem', border: '1px solid #d0d6df', textAlign: 'right' }}>—</td>
                <td style={{ padding: '0.4rem', border: '1px solid #d0d6df', textAlign: 'right' }}>—</td>
                <td style={{ padding: '0.4rem', border: '1px solid #d0d6df', textAlign: 'right' }}>{fmt(result.ww_patients)}</td>
              </tr>
              {result.per_moa.map((row, i) => {
                const band = bandColors[i % bandColors.length];
                return (
                  <Fragment key={row.moa_category}>
                    <tr style={{ background: band }}>
                      <td style={{ padding: '0.4rem', border: '1px solid #d0d6df', fontWeight: 600 }}>
                        Top {row.moa_category} Predicted Responders (US)
                      </td>
                      <td style={{ padding: '0.4rem', border: '1px solid #d0d6df', textAlign: 'right' }}>
                        {pct(row.response_rate)} ({row.n_responders}/{row.cohort_total})
                      </td>
                      <td style={{ padding: '0.4rem', border: '1px solid #d0d6df', textAlign: 'right' }}>
                        ~{fmt(row.us_predicted)}
                      </td>
                      <td style={{ padding: '0.4rem', border: '1px solid #d0d6df', textAlign: 'right' }}>—</td>
                    </tr>
                    <tr style={{ background: band }}>
                      <td style={{ padding: '0.4rem', border: '1px solid #d0d6df', fontWeight: 600 }}>
                        Top {row.moa_category} Predicted Responders (WW)
                      </td>
                      <td style={{ padding: '0.4rem', border: '1px solid #d0d6df', textAlign: 'right' }}>
                        {pct(row.response_rate)}
                      </td>
                      <td style={{ padding: '0.4rem', border: '1px solid #d0d6df', textAlign: 'right' }}>—</td>
                      <td style={{ padding: '0.4rem', border: '1px solid #d0d6df', textAlign: 'right' }}>
                        ~{fmt(row.ww_predicted)}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
              <tr style={{ background: '#fdf2d0', fontWeight: 700 }}>
                <td style={{ padding: '0.5rem', border: '1px solid #d0d6df' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    Total Unique Predicted Responders across {result.per_moa.length} drug classes (US)
                    <InlineHelp
                      size={11}
                      text="Union: each TCGA patient counted at most once across all selected MOAs. Overlap between MOAs is removed, so union ≤ sum of individual MOA responders. Represents unique US patients addressable by at least one drug in the selected set."
                    />
                  </span>
                </td>
                <td style={{ padding: '0.5rem', border: '1px solid #d0d6df', textAlign: 'right' }}>
                  {pct(result.union.response_rate)} ({result.union.n_responders}/{result.cohort_total})
                </td>
                <td style={{ padding: '0.5rem', border: '1px solid #d0d6df', textAlign: 'right', textDecoration: 'underline' }}>
                  ~{fmt(result.union.us_predicted)}
                </td>
                <td style={{ padding: '0.5rem', border: '1px solid #d0d6df', textAlign: 'right' }}>—</td>
              </tr>
              <tr style={{ background: '#fdf2d0', fontWeight: 700 }}>
                <td style={{ padding: '0.5rem', border: '1px solid #d0d6df' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    Total Unique Predicted Responders across {result.per_moa.length} drug classes (WW)
                    <InlineHelp
                      size={11}
                      text="Union across MOAs (each TCGA patient counted at most once) × worldwide GBM patients/year. Represents unique global patients addressable by at least one drug in the selected set."
                    />
                  </span>
                </td>
                <td style={{ padding: '0.5rem', border: '1px solid #d0d6df', textAlign: 'right' }}>
                  {pct(result.union.response_rate)}
                </td>
                <td style={{ padding: '0.5rem', border: '1px solid #d0d6df', textAlign: 'right' }}>—</td>
                <td style={{ padding: '0.5rem', border: '1px solid #d0d6df', textAlign: 'right', textDecoration: 'underline' }}>
                  ~{fmt(result.union.ww_predicted)}
                </td>
              </tr>
            </tbody>
          </table>

          <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#888' }}>
            Response rates computed against the {result.cohort_total}-patient TCGA cohort using
            each MOA's most recent simulation (learned DCNA threshold + expression &gt; 0,
            aggregated across testing trials with the {result.rule} rule). The union row
            counts each TCGA patient at most once across all selected MOAs.
          </div>
        </div>
      )}
    </div>
  );
}
