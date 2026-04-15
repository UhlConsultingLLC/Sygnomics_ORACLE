import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { TrialSummary } from '../types';

const statusColors: Record<string, string> = {
  COMPLETED: '#28a745',
  RECRUITING: '#007bff',
  ACTIVE_NOT_RECRUITING: '#ffc107',
  TERMINATED: '#dc3545',
  WITHDRAWN: '#6c757d',
  NOT_YET_RECRUITING: '#17a2b8',
};

const outcomeTypeColors: Record<string, { bg: string; text: string }> = {
  PRIMARY: { bg: '#e3f2fd', text: '#1565c0' },
  SECONDARY: { bg: '#fff3e0', text: '#e65100' },
  OTHER: { bg: '#f3e5f5', text: '#7b1fa2' },
};

// WHO 2021 subtype short labels and colors
const whoTypeDisplay: Record<string, { label: string; bg: string; text: string }> = {
  'Glioblastoma, IDH-wildtype': { label: 'GBM IDH-wt', bg: '#fce4ec', text: '#c62828' },
  'Astrocytoma, IDH-mutant': { label: 'Astro IDH-mut', bg: '#e8eaf6', text: '#283593' },
  'Oligodendroglioma, IDH-mutant and 1p/19q-codeleted': { label: 'Oligo', bg: '#e0f2f1', text: '#00695c' },
  'Diffuse midline glioma, H3 K27-altered': { label: 'DMG H3K27', bg: '#f3e5f5', text: '#6a1b9a' },
  'Diffuse glioma, NOS': { label: 'Glioma NOS', bg: '#f5f5f5', text: '#616161' },
};

const confidenceColors: Record<string, string> = {
  high: '#2e7d32',
  medium: '#f57f17',
  low: '#9e9e9e',
};

// Mechanism labels → short human-readable display names
const mechanismDisplayNames: Record<string, string> = {
  intracavitary: 'Intracavitary',
  tumor_cavity: 'Tumor Cavity',
  CED: 'CED',
  gliadel_wafer: 'Gliadel Wafer',
  intratumoral: 'Intratumoral',
  ommaya: 'Ommaya Reservoir',
  intracerebral_delivery: 'Intracerebral',
  intraventricular_delivery: 'Intraventricular',
  stereotactic_injection: 'Stereotactic Inj.',
  catheter_delivery: 'Catheter Delivery',
  local_delivery: 'Local Delivery',
  interstitial_chemo: 'Interstitial Chemo',
  implanted_device: 'Implanted Device',
  ultrasound_delivery: 'Ultrasound/BBB',
  intra_arterial: 'Intra-Arterial',
};

export default function TrialCard({ trial }: { trial: TrialSummary }) {
  const color = statusColors[trial.status] || '#6c757d';
  const [showOutcomes, setShowOutcomes] = useState(false);

  const outcomes = trial.outcomes || [];
  const primaryCount = outcomes.filter((o) => o.type === 'PRIMARY').length;
  const secondaryCount = outcomes.filter((o) => o.type === 'SECONDARY').length;
  const otherCount = outcomes.filter((o) => o.type !== 'PRIMARY' && o.type !== 'SECONDARY').length;

  // Parse intercavitary mechanisms into display labels
  const isConfirmed = trial.intercavitary_delivery === 'confirmed';
  const isMentioned = trial.intercavitary_delivery === 'mentioned';
  const hasIntercavitary = isConfirmed || isMentioned;
  const mechanisms = trial.intercavitary_mechanisms
    ? trial.intercavitary_mechanisms.split(', ').map(m => mechanismDisplayNames[m.trim()] || m.trim())
    : [];

  // WHO 2021 classification
  const whoTypes = trial.who_types || [];
  const whoConfidence = trial.who_confidence || '';

  return (
    <div style={{
      border: '1px solid #ddd',
      borderRadius: 8,
      padding: '1rem',
      marginBottom: '0.75rem',
      background: '#fff',
      borderLeft: `4px solid ${color}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Link to={`/trials/${trial.nct_id}`} style={{ fontWeight: 600, color: '#1a1a2e', textDecoration: 'none' }}>
            {trial.nct_id}
          </Link>
          <span style={{ fontSize: '0.8rem', color, fontWeight: 500 }}>{trial.status}</span>
          {trial.source === 'ctis' && (
            <span style={{
              background: '#e8f5e9', color: '#2e7d32', padding: '1px 6px',
              borderRadius: 4, fontSize: '0.65rem', fontWeight: 600,
            }}>EU</span>
          )}
          {hasIntercavitary && (
            <span
              title={`Intercavitary delivery (${isConfirmed ? 'confirmed' : 'mentioned in eligibility'}): ${mechanisms.join(', ')}`}
              style={{
                background: isConfirmed ? '#fff3e0' : '#f5f5f5',
                color: isConfirmed ? '#e65100' : '#999',
                border: `1px solid ${isConfirmed ? '#ffcc80' : '#ddd'}`,
                padding: '1px 7px',
                borderRadius: 4,
                fontSize: '0.65rem',
                fontWeight: 600,
                cursor: 'default',
              }}
            >
              {isConfirmed ? 'IC' : 'IC?'} {mechanisms.length > 0 ? mechanisms[0] : ''}
              {mechanisms.length > 1 ? ` +${mechanisms.length - 1}` : ''}
            </span>
          )}
          {whoTypes.length > 0 && whoTypes.map((wt) => {
            const display = whoTypeDisplay[wt] || { label: wt.split(',')[0], bg: '#f5f5f5', text: '#616161' };
            return (
              <span
                key={wt}
                title={`WHO 2021: ${wt} (${whoConfidence} confidence)`}
                style={{
                  background: display.bg,
                  color: display.text,
                  padding: '1px 6px',
                  borderRadius: 4,
                  fontSize: '0.6rem',
                  fontWeight: 600,
                  cursor: 'default',
                  border: `1px solid ${display.bg}`,
                }}
              >
                {display.label}
                {whoConfidence && (
                  <span style={{
                    display: 'inline-block',
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: confidenceColors[whoConfidence] || '#9e9e9e',
                    marginLeft: 3,
                    verticalAlign: 'middle',
                  }} />
                )}
              </span>
            );
          })}
        </div>
        <span style={{ fontSize: '0.8rem', color: '#888', flexShrink: 0 }}>{trial.phase}</span>
      </div>
      <p style={{ margin: '0.4rem 0 0.3rem', fontSize: '0.9rem', color: '#333' }}>{trial.title}</p>

      {/* Therapies / Treatments */}
      {trial.interventions && trial.interventions.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
          {trial.interventions.map((iv) => (
            <span key={iv} style={{
              background: '#e8f5e9',
              color: '#2e7d32',
              padding: '2px 8px',
              borderRadius: 10,
              fontSize: '0.72rem',
              fontWeight: 500,
              border: '1px solid #c8e6c9',
            }}>
              {iv}
            </span>
          ))}
        </div>
      )}

      <div style={{ fontSize: '0.8rem', color: '#666' }}>
        {trial.conditions.length > 0 && <span>{trial.conditions.join(', ')}</span>}
        {trial.enrollment_count != null && <span style={{ marginLeft: 12 }}>N={trial.enrollment_count}</span>}
        {trial.sponsor_name && <span style={{ marginLeft: 12 }}>{trial.sponsor_name}</span>}
      </div>

      {/* Outcomes summary */}
      {outcomes.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <button
            onClick={() => setShowOutcomes(!showOutcomes)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: '0.75rem',
              color: '#1976d2',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span style={{ fontSize: '0.65rem' }}>{showOutcomes ? '▼' : '▶'}</span>
            Outcomes ({outcomes.length})
            {primaryCount > 0 && (
              <span style={{ ...pillStyle, ...outcomeTypeColors.PRIMARY }}>{primaryCount} primary</span>
            )}
            {secondaryCount > 0 && (
              <span style={{ ...pillStyle, ...outcomeTypeColors.SECONDARY }}>{secondaryCount} secondary</span>
            )}
            {otherCount > 0 && (
              <span style={{ ...pillStyle, ...outcomeTypeColors.OTHER }}>{otherCount} other</span>
            )}
          </button>

          {showOutcomes && (
            <div style={{
              marginTop: 6,
              padding: '0.5rem',
              background: '#fafafa',
              borderRadius: 6,
              border: '1px solid #eee',
              maxHeight: 250,
              overflowY: 'auto',
            }}>
              {outcomes.map((o, i) => {
                const typeStyle = outcomeTypeColors[o.type] || outcomeTypeColors.OTHER;
                return (
                  <div key={i} style={{
                    padding: '4px 0',
                    borderBottom: i < outcomes.length - 1 ? '1px solid #eee' : 'none',
                    fontSize: '0.78rem',
                  }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                      <span style={{
                        background: typeStyle.bg,
                        color: typeStyle.text,
                        padding: '1px 6px',
                        borderRadius: 4,
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        flexShrink: 0,
                        marginTop: 1,
                      }}>
                        {o.type}
                      </span>
                      <span style={{ color: '#333' }}>{o.measure}</span>
                    </div>
                    {o.time_frame && (
                      <div style={{ fontSize: '0.7rem', color: '#888', marginLeft: 50, marginTop: 1 }}>
                        {o.time_frame}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const pillStyle: React.CSSProperties = {
  padding: '1px 6px',
  borderRadius: 8,
  fontSize: '0.65rem',
  fontWeight: 500,
};
