import { useMetrics, usePhaseDistribution, useStatusDistribution } from '../hooks/useApi';
import PlotContainer from '../components/PlotContainer';
import DataTable from '../components/DataTable';
import { Metric, InterpretBox } from '../components/Interpretation';
import type { PhaseDistribution, StatusDistribution } from '../types';

export default function Dashboard() {
  const { data: metrics, isLoading } = useMetrics();
  const { data: phaseData } = usePhaseDistribution();
  const { data: statusData } = useStatusDistribution();

  if (isLoading) return <div>Loading dashboard...</div>;

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>Analysis Dashboard</h1>
      <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '1rem' }}>
        A bird's-eye view of the full trial corpus currently loaded in the database.
      </p>

      <InterpretBox id="dashboard-intro" title="How to read this dashboard">
        <p style={{ margin: '0 0 0.5rem' }}>
          These cards and charts summarize <strong>every trial ingested so far</strong> — before any
          disease filters, cohort splits, or simulations. Use it to sanity-check that ingestion pulled
          the expected volume of trials for a disease, and to get a feel for which phases, statuses,
          and conditions dominate the corpus.
        </p>
        <ul style={{ margin: '0 0 0.25rem 1.1rem', padding: 0 }}>
          <li><strong>Total Trials</strong> — unique NCT IDs in the database.</li>
          <li><strong>Total / Mean Enrollment</strong> — sum and average of reported enrollment sizes. Many Phase 1 trials are tiny, which pulls the mean down.</li>
          <li><strong>Conditions / Interventions</strong> — distinct disease terms and distinct intervention strings (before MOA grouping).</li>
          <li><strong>Phase &amp; Status breakdowns</strong> — useful for spotting gaps (e.g. no Phase 3 trials recruiting) before you commit to a cohort.</li>
        </ul>
        <p style={{ margin: '0.5rem 0 0', color: '#555', fontSize: '0.8rem' }}>
          Move to <em>Trial Filtering</em> once these numbers look sensible — that's where you carve
          a focused cohort out of this raw pool.
        </p>
      </InterpretBox>

      {metrics && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          <Metric
            label="Total Trials"
            value={metrics.total_trials.toLocaleString()}
            hint="Unique NCT IDs ingested"
            tooltip="Count of distinct clinical trials currently loaded in the database, across every disease and registry source."
          />
          <Metric
            label="Total Enrollment"
            value={metrics.total_enrollment.toLocaleString()}
            hint="Reported across all trials"
            tooltip="Sum of self-reported enrollment targets across every trial. Trials without a reported enrollment count contribute 0."
          />
          <Metric
            label="Mean Enrollment"
            value={metrics.mean_enrollment.toFixed(1)}
            hint="Small Phase 1 trials pull this down"
            tooltip="Average enrollment per trial. Heavily skewed by small early-phase trials — the median is often more representative."
          />
          <Metric
            label="Conditions"
            value={metrics.conditions_count.toLocaleString()}
            hint="Distinct disease terms"
            tooltip="Number of unique MeSH/condition strings. A single disease (e.g. glioblastoma) often expands into many synonyms here."
          />
          <Metric
            label="Interventions"
            value={metrics.interventions_count.toLocaleString()}
            hint="Before MOA grouping"
            tooltip="Distinct intervention strings as reported by CT.gov. The MOA Overview page collapses these into ~20 mechanism groups."
          />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <PlotContainer plotType="trials_per_condition" title="Trials per Condition" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <PlotContainer plotType="phase_distribution" title="Phase Distribution" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Phase Breakdown</h3>
          <div style={{ fontSize: '0.78rem', color: '#666', marginBottom: 6 }}>
            How many trials fall in each clinical phase. Phase 2 typically dominates mid-stage oncology corpora.
          </div>
          {phaseData && (
            <DataTable<PhaseDistribution>
              keyField="phase"
              columns={[
                { key: 'phase', header: 'Phase' },
                { key: 'trial_count', header: 'Count' },
              ]}
              data={phaseData}
            />
          )}
        </div>
        <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Status Breakdown</h3>
          <div style={{ fontSize: '0.78rem', color: '#666', marginBottom: 6 }}>
            Trial recruitment state. Completed trials are the main source of outcome data; recruiting / active trials are candidates for future simulation.
          </div>
          {statusData && (
            <DataTable<StatusDistribution>
              keyField="status"
              columns={[
                { key: 'status', header: 'Status' },
                { key: 'trial_count', header: 'Count' },
              ]}
              data={statusData}
            />
          )}
        </div>
      </div>
    </div>
  );
}
