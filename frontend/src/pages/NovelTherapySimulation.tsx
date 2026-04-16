/* eslint-disable @typescript-eslint/no-explicit-any --
 * One `any` on the axios error catch block (standard pattern).
 */
import { useState, useEffect } from 'react';
import axios from 'axios';
import AutocompleteInput from '../components/AutocompleteInput';
import { fetchTCGAGenes } from '../services/api';
import { usePersistentState } from '../hooks/usePersistentState';
import { InterpretBox, InlineHelp } from '../components/Interpretation';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
});

// Fetch gene symbols matching a query via the TCGA gene endpoint.
const fetchGeneSuggestions = async (q: string): Promise<string[]> => {
  try {
    const genes = await fetchTCGAGenes(q);
    return genes.map((g) => g.symbol).filter(Boolean).slice(0, 15);
  } catch {
    return [];
  }
};

interface SimilarTrial {
  nct_id: string;
  title: string;
  phase?: string;
  status?: string;
  enrollment?: number;
  interventions: string[];
  matched_drugs: string[];
  matched_targets: string[];
  conditions: string[];
  eligibility_excerpt?: string;
  response_rate?: number | null;
  similarity_score: number;
  results_url?: string;
}

interface LiteratureItem {
  pmid: string;
  title: string;
  journal?: string;
  year?: string;
  url: string;
}

interface NovelResponse {
  predicted_response_rate: number;
  ci_low: number;
  ci_high: number;
  n_supporting_trials: number;
  matched_drugs: string[];
  basis: string;
  similar_trials: SimilarTrial[];
  literature: LiteratureItem[];
  warnings: string[];
}

export default function NovelTherapySimulation() {
  const [geneTargets, setGeneTargets, resetGeneTargets] = usePersistentState<string>('nts_gene_targets', '');
  const [condition, setCondition, resetCondition] = usePersistentState<string>('nts_condition', '');
  const [stage, setStage, resetStage] = usePersistentState<string>('nts_stage', '');
  const [size, setSize, resetSize] = usePersistentState<number>('nts_size', 100);
  const [criteria, setCriteria, resetCriteria] = usePersistentState<string>('nts_criteria', '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult, resetResult] = usePersistentState<NovelResponse | null>('nts_result', null);
  const [conditionPreview, setConditionPreview] = useState<string[]>([]);

  const handleReset = () => {
    resetGeneTargets();
    resetCondition();
    resetStage();
    resetSize();
    resetCriteria();
    resetResult();
    setError(null);
    setConditionPreview([]);
  };

  // Live MeSH expansion preview for the condition field — fires as the
  // user types (debounced) so they can see synonyms before submitting.
  useEffect(() => {
    const term = condition.trim();
    if (term.length < 2) { setConditionPreview([]); return; }
    const handle = setTimeout(async () => {
      try {
        const { data } = await api.get('/analysis/expand-condition', { params: { q: term } });
        const expanded: string[] = data?.expanded || [];
        // Only show the preview when MeSH actually added synonyms.
        setConditionPreview(expanded.length > 1 ? expanded : []);
      } catch {
        setConditionPreview([]);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [condition]);

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const payload = {
        gene_targets: geneTargets.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean),
        condition: condition.trim(),
        disease_stage: stage.trim() || null,
        trial_size: size,
        recruitment_criteria: criteria.trim() || null,
      };
      if (payload.gene_targets.length === 0) throw new Error('At least one gene target is required');
      if (!payload.condition) throw new Error('Condition is required');
      const { data } = await api.post('/novel-therapy/simulate', payload);
      setResult(data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1200 }}>
      <h2 style={{ marginTop: 0 }}>Novel Therapy Simulation</h2>
      <p style={{ fontSize: '0.9rem', color: '#555', marginTop: 0 }}>
        Describe a proposed new drug and trial. The simulator estimates the expected response
        rate by pooling evidence from historical trials that used drugs hitting the same gene
        targets in the same condition, surfaces the most similar past trials, and retrieves
        supporting PubMed literature.
      </p>

      <InterpretBox id="novel-therapy-intro" title="How this simulation works">
        <p style={{ margin: '0 0 0.5rem' }}>
          A fast, evidence-based sanity check for a trial you're designing — <em>before</em> you've
          enrolled anyone. Given one or more gene targets and a condition, ORACLE finds historical
          trials whose drugs hit the same targets for the same disease, weights them by similarity,
          and returns a pooled response-rate estimate with a 95% CI.
        </p>
        <ul style={{ margin: '0 0 0.4rem 1.1rem', padding: 0 }}>
          <li><strong>Predicted Response Rate</strong> — a weighted average of observed RRs across the similar trials. The CI reflects how much those trials disagree and how many there are.</li>
          <li><strong>Supporting trials (n)</strong> — count of historical trials that actually contributed to the estimate. Fewer than ~5 means treat the prediction as exploratory.</li>
          <li><strong>Similarity score</strong> (0–1) — per-trial overlap on gene targets + disease stage + phase. Higher = more comparable; the top 3–5 carry most of the signal.</li>
          <li><strong>Observed RR column</strong> — the actual historical RR for each similar trial. Wide variance across these rows is a warning sign; tight clustering is confirmatory.</li>
          <li><strong>Literature</strong> — PubMed matches for the target+condition combination, for additional human context (not used in the numeric prediction).</li>
        </ul>
        <p style={{ margin: '0 0 0.3rem' }}>
          <strong>When to trust the prediction:</strong> ≥5 supporting trials with top similarity
          scores &gt; 0.4 and a narrow CI (&lt; 10 pp wide). Warnings under the prediction flag low
          evidence quality — take them seriously.
        </p>
        <p style={{ margin: 0, color: '#555', fontSize: '0.8rem' }}>
          Use <em>Threshold Validation</em> once the predicted RR looks believable — that page takes
          the MOA's learned biomarker threshold and projects what the screened RR would be.
        </p>
      </InterpretBox>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Gene targets (comma-separated)</label>
          <AutocompleteInput
            placeholder="e.g. EGFR, VEGFR2"
            value={geneTargets}
            onChange={setGeneTargets}
            field="interventions"
            fetcher={fetchGeneSuggestions}
            multiToken
          />
        </div>
        <div>
          <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>
            Disease / Condition{' '}
            <span style={{ fontWeight: 400, color: '#607d8b', fontSize: '0.75rem' }}>
              (MeSH vocabulary expansion applied)
            </span>
          </label>
          <AutocompleteInput
            placeholder="e.g. glioblastoma"
            value={condition}
            onChange={setCondition}
            field="conditions"
          />
          {conditionPreview.length > 0 && (
            <div style={{
              marginTop: 4,
              padding: '6px 10px',
              background: '#e3f2fd',
              border: '1px solid #bbdefb',
              borderRadius: 4,
              fontSize: '0.78rem',
              color: '#1565c0',
            }}>
              <strong>Condition matched via MeSH:</strong> {conditionPreview.join(', ')}
            </div>
          )}
        </div>
        <div>
          <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Disease stage (optional)</label>
          <input
            type="text"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            placeholder="e.g. recurrent, newly diagnosed"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Planned trial size (patients)</label>
          <input
            type="number"
            value={size}
            min={1}
            onChange={(e) => setSize(parseInt(e.target.value || '0', 10))}
            style={inputStyle}
          />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Recruitment criteria (optional, free text)</label>
          <textarea
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            rows={4}
            placeholder="Inclusion/exclusion criteria, biomarker requirements, etc."
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>
      </div>

      <button
        onClick={run}
        disabled={loading}
        style={{
          padding: '8px 20px',
          background: '#1a1a2e',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: '0.9rem',
        }}
      >
        {loading ? 'Running…' : 'Run Novel Therapy Simulation'}
      </button>
      <button
        onClick={handleReset}
        disabled={loading}
        style={{
          marginLeft: 8,
          padding: '8px 20px',
          background: '#6c757d',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: '0.9rem',
        }}
      >
        Reset
      </button>

      {error && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#fdecea', color: '#c62828', borderRadius: 4 }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: '1.5rem' }}>
          {/* Prediction card */}
          <div style={{ padding: '1rem', border: '1px solid #cfd8dc', borderRadius: 6, background: '#fafafa', marginBottom: '1rem' }}>
            <h3 style={{ margin: '0 0 0.5rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Predicted Response Rate
              <InlineHelp text="Similarity-weighted average of observed response rates across historical trials matching your target + condition. The CI widens when supporting trials disagree or are few." />
            </h3>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: '#1a1a2e' }}>
              {(result.predicted_response_rate * 100).toFixed(1)}%
            </div>
            <div style={{ fontSize: '0.9rem', color: '#555', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              95% CI: [{(result.ci_low * 100).toFixed(1)}%, {(result.ci_high * 100).toFixed(1)}%] ·{' '}
              {result.n_supporting_trials} supporting trial{result.n_supporting_trials === 1 ? '' : 's'}
              <InlineHelp size={12} text="95% confidence interval on the pooled estimate. Narrow (<10 pp) with ≥5 supporting trials is solid; wide (>20 pp) or <3 trials is exploratory only." />
            </div>
            <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#37474f' }}>
              <b>Basis:</b> {result.basis}
            </div>
            {result.matched_drugs.length > 0 && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                <b>Matched drugs ({result.matched_drugs.length}):</b>{' '}
                {result.matched_drugs.slice(0, 20).join(', ')}
                {result.matched_drugs.length > 20 && ` (+${result.matched_drugs.length - 20} more)`}
              </div>
            )}
            {result.warnings.length > 0 && (
              <ul style={{ marginTop: '0.5rem', color: '#e65100', fontSize: '0.8rem' }}>
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
          </div>

          {/* Similar trials */}
          <div style={{ marginBottom: '1rem' }}>
            <h3>Similar Historical Trials ({result.similar_trials.length})</h3>
            {result.similar_trials.length === 0 ? (
              <div style={{ color: '#888' }}>No similar trials found in the database.</div>
            ) : (
              <div style={{ maxHeight: 500, overflow: 'auto', border: '1px solid #e0e0e0', borderRadius: 4 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#f5f5f5' }}>
                    <tr>
                      <th style={thStyle}>NCT ID</th>
                      <th style={thStyle}>Title</th>
                      <th style={thStyle}>Phase</th>
                      <th style={thStyle}>Enrollment</th>
                      <th style={thStyle}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          Matched drugs / targets
                          <InlineHelp size={11} text="Drugs and gene targets from this historical trial that overlap with what you entered. More overlap → higher similarity score."/>
                        </span>
                      </th>
                      <th style={thStyle}>Interventions</th>
                      <th style={thStyle}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          Observed RR
                          <InlineHelp size={11} text="Actual reported response rate for this historical trial. The predicted RR is a similarity-weighted average of these values."/>
                        </span>
                      </th>
                      <th style={thStyle}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          Similarity
                          <InlineHelp size={11} text="0–1. Combines overlap on gene targets, disease stage, and phase. Anything above ~0.4 is meaningfully comparable."/>
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.similar_trials.map((t) => (
                      <tr key={t.nct_id} style={{ borderTop: '1px solid #eee' }}>
                        <td style={tdStyle}>
                          <a
                            href={`https://clinicaltrials.gov/study/${t.nct_id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t.nct_id}
                          </a>
                        </td>
                        <td style={{ ...tdStyle, maxWidth: 280 }}>{t.title}</td>
                        <td style={tdStyle}>{t.phase || '—'}</td>
                        <td style={tdStyle}>{t.enrollment ?? '—'}</td>
                        <td style={tdStyle}>
                          {t.matched_drugs.length > 0 && (
                            <div><b>{t.matched_drugs.join(', ')}</b></div>
                          )}
                          <div style={{ color: '#607d8b' }}>{t.matched_targets.join(', ')}</div>
                        </td>
                        <td style={{ ...tdStyle, maxWidth: 200 }}>{t.interventions.join('; ')}</td>
                        <td style={tdStyle}>{t.response_rate != null ? `${(t.response_rate * 100).toFixed(1)}%` : '—'}</td>
                        <td style={tdStyle}>{t.similarity_score.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Literature */}
          <div>
            <h3>Supporting Literature ({result.literature.length})</h3>
            {result.literature.length === 0 ? (
              <div style={{ color: '#888', fontSize: '0.85rem' }}>
                No matching PubMed articles found (or PubMed fetch failed).
              </div>
            ) : (
              <ul style={{ paddingLeft: '1.2rem' }}>
                {result.literature.map((lit) => (
                  <li key={lit.pmid} style={{ marginBottom: '0.4rem', fontSize: '0.85rem' }}>
                    <a href={lit.url} target="_blank" rel="noreferrer"><b>{lit.title}</b></a>
                    <div style={{ color: '#607d8b', fontSize: '0.75rem' }}>
                      {lit.journal || ''} {lit.year ? `· ${lit.year}` : ''} · PMID {lit.pmid}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem',
  border: '1px solid #ccc',
  borderRadius: 4,
  fontSize: '0.85rem',
  boxSizing: 'border-box',
};

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '6px 8px' };
const tdStyle: React.CSSProperties = { padding: '4px 8px', verticalAlign: 'top' };
