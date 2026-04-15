import { useState } from 'react';
import FilterPanel from '../components/FilterPanel';
import { useFilterTrials } from '../hooks/useApi';
import type { FilterSpec, FilteredTrialsResponse } from '../types';

export default function Filtering() {
  const filterMutation = useFilterTrials();
  const [results, setResults] = useState<FilteredTrialsResponse | null>(null);

  const handleApply = (spec: FilterSpec) => {
    filterMutation.mutate(spec, {
      onSuccess: (data) => setResults(data),
    });
  };

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Trial Filtering</h1>

      <FilterPanel onApply={handleApply} />

      {filterMutation.isPending && <div>Filtering...</div>}

      {results && (
        <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>
            Results ({results.total} trials)
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid #ddd' }}>NCT ID</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid #ddd' }}>Title</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid #ddd' }}>Therapies</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid #ddd' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid #ddd' }}>Phase</th>
                <th style={{ textAlign: 'right', padding: '0.5rem', borderBottom: '2px solid #ddd' }}>Enrollment</th>
              </tr>
            </thead>
            <tbody>
              {results.trials.map((t) => (
                <tr key={t.nct_id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '0.4rem 0.5rem', fontWeight: 600 }}>{t.nct_id}</td>
                  <td title={t.title} style={{ padding: '0.4rem 0.5rem', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</td>
                  <td style={{ padding: '0.4rem 0.5rem', maxWidth: 200, fontSize: '0.8rem' }}>{t.interventions?.join(', ') || '-'}</td>
                  <td style={{ padding: '0.4rem 0.5rem' }}>{t.status}</td>
                  <td style={{ padding: '0.4rem 0.5rem' }}>{t.phase}</td>
                  <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{t.enrollment_count ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
