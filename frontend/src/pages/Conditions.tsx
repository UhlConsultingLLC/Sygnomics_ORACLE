import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConditions } from '../hooks/useApi';
import { expandConditionCounts, type ExpandedTrialCounts } from '../services/api';
import AutocompleteInput from '../components/AutocompleteInput';
import { usePersistentState } from '../hooks/usePersistentState';
import { setTrialExplorerFilters } from '../stores/trialExplorerStore';
import { InterpretBox, InlineHelp } from '../components/Interpretation';

export default function Conditions() {
  const navigate = useNavigate();
  const { data: conditions, isLoading } = useConditions();
  const [disease, setDisease, resetDisease] = usePersistentState<string>('conditions_disease', '');
  const [suggestion, setSuggestion, resetSuggestion] = usePersistentState<ExpandedTrialCounts | null>('conditions_suggestion', null);
  const [suggesting, setSuggesting] = useState(false);

  const handleReset = () => {
    resetDisease();
    resetSuggestion();
  };

  const handleSuggest = async () => {
    if (!disease.trim()) return;
    setSuggesting(true);
    try {
      const result = await expandConditionCounts(disease);
      setSuggestion(result);
    } catch {
      setSuggestion(null);
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Disease Search</h1>

      <InterpretBox id="conditions-intro" title="How to read this page">
        <p style={{ margin: '0 0 0.5rem' }}>
          Clinical trial condition strings vary wildly: the same tumor might be indexed
          as "glioblastoma", "GBM", "glioblastoma multiforme", "WHO grade IV astrocytoma",
          or "high-grade glioma". This page uses NLM MeSH expansion to map a disease term
          to all its synonyms, then counts trials in the local database for each synonym.
        </p>
        <ul style={{ margin: '0.25rem 0 0.5rem 1.1rem', padding: 0 }}>
          <li>
            <strong>Original vs expanded</strong> — the term you typed is shown under{' '}
            <em>Original</em>; MeSH-derived synonyms are listed in the <em>Term</em>{' '}
            column. Each has its own independent trial count in the local DB.
          </li>
          <li>
            <strong>Unique trials matching any term</strong> — deduplicated count across
            all synonyms (a trial indexed under two different synonyms is counted once).
            This is the number that lands in Trial Explorer when you click the green
            action button.
          </li>
          <li>
            <strong>All Conditions in Database (bottom)</strong> — raw condition strings
            already ingested from CT.gov. Useful when you want to see what condition
            labels exist before launching an expansion.
          </li>
        </ul>
        <p style={{ margin: '0.4rem 0 0', fontSize: '0.78rem', color: '#555' }}>
          <strong>Workflow:</strong> expand → review synonyms → click{' '}
          <em>View matching trials</em> to pre-populate the Trial Explorer with all
          synonyms pre-selected and the "expand synonyms" toggle on.
        </p>
      </InterpretBox>

      <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Disease Term Expansion</h3>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <AutocompleteInput
            placeholder="Enter disease name (e.g., GBM, NSCLC)..."
            value={disease}
            onChange={setDisease}
            field="conditions"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSuggest(); }}
          />
          <button
            onClick={handleSuggest}
            disabled={suggesting}
            style={{ padding: '0.4rem 1.2rem', background: '#007bff', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            {suggesting ? 'Expanding...' : 'Expand'}
          </button>
          <button
            onClick={handleReset}
            style={{ padding: '0.4rem 1.2rem', background: '#6c757d', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            Reset
          </button>
        </div>
        {suggestion && (
          <div style={{ marginTop: '0.75rem' }}>
            <p style={{ fontSize: '0.85rem', color: '#555', margin: '0 0 0.5rem' }}>
              Original: <strong>{suggestion.original}</strong>
              <span style={{ marginLeft: 12, color: '#256029' }}>
                Unique trials matching any term: <strong>{suggestion.unique_total.toLocaleString()}</strong>
                <InlineHelp
                  size={12}
                  text="Deduplicated trial count across all MeSH synonyms. A trial indexed under two different synonyms is counted once. This is the total number loaded into Trial Explorer."
                />
              </span>
            </p>
            <button
              onClick={() => {
                const terms = suggestion.per_term.map((t) => t.term).join(',');
                setTrialExplorerFilters({
                  condition: terms,
                  expandSynonyms: true,
                  page: 0,
                });
                navigate('/trials');
              }}
              style={{
                padding: '0.35rem 0.9rem', background: '#28a745', color: '#fff',
                border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem',
                marginBottom: '0.5rem',
              }}
            >
              View {suggestion.unique_total.toLocaleString()} matching trials in Trial Explorer →
            </button>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.82rem', marginTop: 4 }}>
              <thead>
                <tr style={{ background: '#f4f8fc' }}>
                  <th style={{ textAlign: 'left', padding: '4px 10px', borderBottom: '1px solid #cdd' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      Term
                      <InlineHelp
                        size={11}
                        text="MeSH-derived synonym. Includes the original term plus related descriptor strings from the NLM thesaurus."
                      />
                    </span>
                  </th>
                  <th style={{ textAlign: 'right', padding: '4px 10px', borderBottom: '1px solid #cdd' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                      Trials in DB
                      <InlineHelp
                        size={11}
                        text="Independent trial count for this term in the local database. Counts overlap across terms; the 'Unique total' deduplicates them."
                      />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {suggestion.per_term.map((t) => (
                  <tr key={t.term} style={{ borderBottom: '1px solid #eef' }}>
                    <td style={{ padding: '4px 10px' }}>
                      <span style={{ background: '#e8f4fd', padding: '2px 8px', borderRadius: 10 }}>{t.term}</span>
                    </td>
                    <td style={{ padding: '4px 10px', textAlign: 'right', fontWeight: 600 }}>
                      {t.trial_count.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>All Conditions in Database</h3>
        {isLoading && <div>Loading conditions...</div>}
        {conditions && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid #ddd' }}>Condition</th>
                <th style={{ textAlign: 'right', padding: '0.5rem', borderBottom: '2px solid #ddd' }}>Trials</th>
              </tr>
            </thead>
            <tbody>
              {conditions.map((c) => (
                <tr key={c.name} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '0.4rem 0.5rem' }}>{c.name}</td>
                  <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{c.trial_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
