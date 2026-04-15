import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchWHOStats, fetchWHOTrials } from '../services/api';
import { usePersistentState } from '../hooks/usePersistentState';
import { InterpretBox, InlineHelp } from '../components/Interpretation';

const typeColors: Record<string, { bg: string; text: string; border: string }> = {
  'Glioblastoma, IDH-wildtype': { bg: '#fce4ec', text: '#c62828', border: '#ef9a9a' },
  'Astrocytoma, IDH-mutant': { bg: '#e8eaf6', text: '#283593', border: '#9fa8da' },
  'Oligodendroglioma, IDH-mutant and 1p/19q-codeleted': { bg: '#e0f2f1', text: '#00695c', border: '#80cbc4' },
  'Diffuse midline glioma, H3 K27-altered': { bg: '#f3e5f5', text: '#6a1b9a', border: '#ce93d8' },
  'Diffuse glioma, NOS': { bg: '#f5f5f5', text: '#616161', border: '#bdbdbd' },
};

const shortLabels: Record<string, string> = {
  'Glioblastoma, IDH-wildtype': 'GBM IDH-wt',
  'Astrocytoma, IDH-mutant': 'Astrocytoma IDH-mut',
  'Oligodendroglioma, IDH-mutant and 1p/19q-codeleted': 'Oligodendroglioma',
  'Diffuse midline glioma, H3 K27-altered': 'DMG H3K27',
  'Diffuse glioma, NOS': 'Glioma NOS',
};

const confidenceColors: Record<string, string> = {
  high: '#2e7d32',
  medium: '#f57f17',
  low: '#9e9e9e',
};

const markerLabels: Record<string, string> = {
  required: 'Required',
  excluded: 'Excluded',
  any: 'Any',
  mentioned: 'Mentioned',
  unknown: 'Unknown',
};

export default function WHOClassification() {
  const [whoTypeFilter, setWhoTypeFilter, resetWhoTypeFilter] = usePersistentState<string>('who_type_filter', '');
  const [idhFilter, setIdhFilter, resetIdhFilter] = usePersistentState<string>('who_idh_filter', '');
  const [confFilter, setConfFilter, resetConfFilter] = usePersistentState<string>('who_conf_filter', '');
  const [codeletionFilter, setCodeletionFilter, resetCodeletionFilter] = usePersistentState<string>('who_codeletion_filter', '');
  const [mgmtFilter, setMgmtFilter, resetMgmtFilter] = usePersistentState<string>('who_mgmt_filter', '');
  const [regionFilter, setRegionFilter, resetRegionFilter] = usePersistentState<string>('who_region_filter', '');
  const [nctSearch, setNctSearch, resetNctSearch] = usePersistentState<string>('who_nct_search', '');
  const [page, setPage, resetPage] = usePersistentState<number>('who_page', 0);
  const limit = 25;

  const handleReset = () => {
    resetWhoTypeFilter();
    resetIdhFilter();
    resetConfFilter();
    resetCodeletionFilter();
    resetMgmtFilter();
    resetRegionFilter();
    resetNctSearch();
    resetPage();
  };

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['who-stats'],
    queryFn: fetchWHOStats,
  });

  const { data: trials, isLoading: trialsLoading } = useQuery({
    queryKey: ['who-trials', whoTypeFilter, idhFilter, confFilter, codeletionFilter, mgmtFilter, regionFilter, nctSearch, page],
    queryFn: () =>
      fetchWHOTrials({
        who_type: whoTypeFilter || undefined,
        idh_status: idhFilter || undefined,
        confidence: confFilter || undefined,
        codeletion_1p19q: codeletionFilter || undefined,
        mgmt_status: mgmtFilter || undefined,
        region: regionFilter || undefined,
        nct_id: nctSearch || undefined,
        limit,
        offset: page * limit,
      }),
  });

  const totalClassified = stats?.total_classified || 0;

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>WHO 2021 CNS Classification</h1>
      <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
        Molecular subtype classification for {totalClassified} trials based on WHO 2021 5th Edition criteria.
        Integrates IDH status, 1p/19q codeletion, MGMT methylation, CDKN2A/B, and H3K27M markers.
      </p>

      <InterpretBox id="who-intro" title="How to read this page">
        <p style={{ margin: '0 0 0.5rem' }}>
          The WHO 5th Edition (2021) overhauled CNS tumor classification by making
          molecular markers part of the diagnosis itself — not just add-ons. This page
          parses each trial's eligibility text to detect molecular requirements and
          assigns the trial to one or more WHO 2021 subtypes.
        </p>
        <ul style={{ margin: '0.25rem 0 0.5rem 1.1rem', padding: 0 }}>
          <li>
            <strong>Subtype cards (top)</strong> — click to filter the trial table below
            to only trials assigned that WHO type. Trials may target multiple subtypes,
            so percentages need not sum to 100%.
          </li>
          <li>
            <strong>Classification Confidence</strong> — <span style={{ color: '#2e7d32' }}>
            High</span> requires an explicit WHO subtype or IDH + ≥2 markers;{' '}
            <span style={{ color: '#f57f17' }}>Medium</span> needs IDH or one clear marker;{' '}
            <span style={{ color: '#9e9e9e' }}>Low</span> is histological terms only.
            Trust <em>High</em> for simulation/TAM analyses; <em>Low</em> entries may
            be mis-classified and should be audited.
          </li>
          <li>
            <strong>IDH Status Requirement</strong> — "IDH excluded" (wildtype) defines
            the GBM population; "IDH required" captures lower-grade astrocytomas and
            oligodendrogliomas. The remaining buckets catch ambiguous or unspecified
            trials.
          </li>
          <li>
            <strong>Marker badges</strong> (IDH / 1p19q / MGMT columns) — Required,
            Excluded, Any, Mentioned, Unknown. "Mentioned" means the marker is
            referenced but no direction can be inferred from the eligibility text.
          </li>
          <li>
            <strong>Region</strong> — US (CT.gov) vs EU (CTIS) so you can compare
            molecular subtyping practices across registries.
          </li>
        </ul>
        <p style={{ margin: '0.4rem 0 0', fontSize: '0.78rem', color: '#555' }}>
          <strong>Caveat:</strong> NLP extraction is imperfect. Trials without explicit
          molecular language default to histological assignment or Unknown — always
          spot-check Low-confidence trials before including them in downstream analyses.
        </p>
      </InterpretBox>

      {statsLoading && <div>Loading classification data...</div>}

      {/* Distribution cards */}
      {stats && (
        <>
          {/* WHO Type Distribution */}
          <div style={{
            background: '#fff', borderRadius: 8, padding: '1.2rem',
            marginBottom: '1.5rem', border: '1px solid #e0e0e0',
          }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#333' }}>
              WHO 2021 Subtype Distribution
            </h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {Object.entries(stats.type_distribution).map(([type, count]) => {
                const colors = typeColors[type] || typeColors['Diffuse glioma, NOS'];
                const pct = totalClassified > 0 ? ((count / totalClassified) * 100).toFixed(1) : '0';
                return (
                  <button
                    key={type}
                    onClick={() => {
                      setWhoTypeFilter(whoTypeFilter === type ? '' : type);
                      setPage(0);
                    }}
                    style={{
                      flex: '1 1 180px',
                      maxWidth: 260,
                      padding: '0.8rem 1rem',
                      background: whoTypeFilter === type ? colors.text : colors.bg,
                      color: whoTypeFilter === type ? '#fff' : colors.text,
                      border: `2px solid ${colors.border}`,
                      borderRadius: 8,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{count}</div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, marginTop: 2 }}>
                      {shortLabels[type] || type}
                    </div>
                    <div style={{ fontSize: '0.7rem', opacity: 0.7, marginTop: 2 }}>
                      {pct}% of trials
                    </div>
                  </button>
                );
              })}
            </div>
            <p style={{ fontSize: '0.72rem', color: '#999', marginTop: 8, marginBottom: 0 }}>
              Note: Trials may target multiple subtypes. Click a card to filter the table below.
            </p>
          </div>

          {/* Confidence + IDH row */}
          <div style={{ display: 'flex', gap: 16, marginBottom: '1.5rem' }}>
            {/* Confidence */}
            <div style={{
              flex: 1, background: '#fff', borderRadius: 8, padding: '1rem',
              border: '1px solid #e0e0e0',
            }}>
              <h3 style={{ margin: '0 0 0.8rem', fontSize: '0.95rem', color: '#333' }}>
                Classification Confidence
              </h3>
              {['high', 'medium', 'low'].map((level) => {
                const count = stats.confidence_distribution[level] || 0;
                const pct = totalClassified > 0 ? (count / totalClassified) * 100 : 0;
                return (
                  <div
                    key={level}
                    onClick={() => {
                      setConfFilter(confFilter === level ? '' : level);
                      setPage(0);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      marginBottom: 6, cursor: 'pointer',
                      opacity: confFilter && confFilter !== level ? 0.4 : 1,
                    }}
                  >
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: confidenceColors[level],
                      flexShrink: 0,
                    }} />
                    <span style={{ fontSize: '0.85rem', textTransform: 'capitalize', width: 65 }}>
                      {level}
                    </span>
                    <div style={{
                      flex: 1, height: 16, background: '#f0f0f0', borderRadius: 4,
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${pct}%`, height: '100%',
                        background: confidenceColors[level],
                        borderRadius: 4,
                        transition: 'width 0.3s',
                      }} />
                    </div>
                    <span style={{ fontSize: '0.8rem', color: '#666', width: 80, textAlign: 'right' }}>
                      {count} ({pct.toFixed(1)}%)
                    </span>
                  </div>
                );
              })}
              <div style={{
                fontSize: '0.7rem', color: '#555', marginTop: 10, padding: '6px 8px',
                background: '#f8f9fa', borderRadius: 4, border: '1px solid #eee', lineHeight: 1.5,
              }}>
                <strong style={{ color: '#333' }}>How confidence is assigned:</strong> based on the
                molecular evidence parsed from each trial's eligibility text.
                {' '}<strong style={{ color: '#2e7d32' }}>High</strong> — an explicit WHO 2021 subtype is
                named (e.g. "Glioblastoma, IDH-wildtype") <em>or</em> IDH status is stated plus ≥2 other
                molecular markers.
                {' '}<strong style={{ color: '#f57f17' }}>Medium</strong> — IDH status is stated on its own,
                <em> or</em> at least one molecular marker / ≥2 biomarkers are present, <em>or</em> the trial
                targets a single subtype.
                {' '}<strong style={{ color: '#9e9e9e' }}>Low</strong> — minimal or no molecular evidence;
                classification relies on histological terms alone.
              </div>
            </div>

            {/* IDH Status */}
            <div style={{
              flex: 1, background: '#fff', borderRadius: 8, padding: '1rem',
              border: '1px solid #e0e0e0',
            }}>
              <h3 style={{ margin: '0 0 0.8rem', fontSize: '0.95rem', color: '#333' }}>
                IDH Status Requirement
              </h3>
              {['excluded', 'required', 'any', 'mentioned', 'unknown'].map((status) => {
                const count = stats.idh_distribution[status] || 0;
                if (count === 0 && status !== 'unknown') return null;
                const pct = totalClassified > 0 ? (count / totalClassified) * 100 : 0;
                const label = status === 'excluded' ? 'IDH-wildtype (mutation excluded)'
                  : status === 'required' ? 'IDH-mutant (mutation required)'
                  : status === 'any' ? 'Any IDH status'
                  : status === 'mentioned' ? 'Mentioned (no direction)'
                  : 'Not specified';
                return (
                  <div
                    key={status}
                    onClick={() => {
                      setIdhFilter(idhFilter === status ? '' : status);
                      setPage(0);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      marginBottom: 6, cursor: 'pointer',
                      opacity: idhFilter && idhFilter !== status ? 0.4 : 1,
                    }}
                  >
                    <span style={{ fontSize: '0.8rem', width: 200, color: '#444' }}>{label}</span>
                    <div style={{
                      flex: 1, height: 14, background: '#f0f0f0', borderRadius: 4,
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${Math.min(pct, 100)}%`, height: '100%',
                        background: status === 'excluded' ? '#c62828'
                          : status === 'required' ? '#283593'
                          : status === 'any' ? '#00695c'
                          : '#9e9e9e',
                        borderRadius: 4,
                      }} />
                    </div>
                    <span style={{ fontSize: '0.78rem', color: '#666', width: 80, textAlign: 'right' }}>
                      {count} ({pct.toFixed(1)}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Trial list */}
      <div style={{
        background: '#fff', borderRadius: 8, padding: '1rem',
        border: '1px solid #e0e0e0',
      }}>
        {(() => {
          const anyFilter = whoTypeFilter || idhFilter || confFilter || codeletionFilter || mgmtFilter || regionFilter || nctSearch;
          const selStyle: React.CSSProperties = { padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.78rem' };
          return (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', color: '#333' }}>
                  Trials {anyFilter ? '(filtered)' : ''}
                </h3>
                <button
                  onClick={handleReset}
                  style={{
                    padding: '4px 12px', background: '#6c757d', color: '#fff',
                    border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem',
                  }}
                >
                  Reset
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '0.8rem', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Search NCT ID..."
                  value={nctSearch}
                  onChange={(e) => { setNctSearch(e.target.value); setPage(0); }}
                  style={{ ...selStyle, width: 160 }}
                />
                <select value={regionFilter} onChange={(e) => { setRegionFilter(e.target.value); setPage(0); }} style={selStyle}>
                  <option value="">All Regions</option>
                  <option value="US">US (CT.gov)</option>
                  <option value="EU">EU (CTIS)</option>
                </select>
                <select value={whoTypeFilter} onChange={(e) => { setWhoTypeFilter(e.target.value); setPage(0); }} style={selStyle}>
                  <option value="">All WHO Types</option>
                  {Object.keys(shortLabels).map((t) => (
                    <option key={t} value={t}>{shortLabels[t]}</option>
                  ))}
                </select>
                <select value={idhFilter} onChange={(e) => { setIdhFilter(e.target.value); setPage(0); }} style={selStyle}>
                  <option value="">Any IDH</option>
                  <option value="required">IDH required</option>
                  <option value="excluded">IDH excluded (wt)</option>
                  <option value="any">Any IDH status</option>
                  <option value="mentioned">Mentioned</option>
                  <option value="unknown">Unknown</option>
                </select>
                <select value={codeletionFilter} onChange={(e) => { setCodeletionFilter(e.target.value); setPage(0); }} style={selStyle}>
                  <option value="">Any 1p/19q</option>
                  <option value="required">Required</option>
                  <option value="excluded">Excluded</option>
                  <option value="any">Any</option>
                  <option value="mentioned">Mentioned</option>
                  <option value="unknown">Unknown</option>
                </select>
                <select value={mgmtFilter} onChange={(e) => { setMgmtFilter(e.target.value); setPage(0); }} style={selStyle}>
                  <option value="">Any MGMT</option>
                  <option value="required">Required</option>
                  <option value="excluded">Excluded</option>
                  <option value="any">Any</option>
                  <option value="mentioned">Mentioned</option>
                  <option value="unknown">Unknown</option>
                </select>
                <select value={confFilter} onChange={(e) => { setConfFilter(e.target.value); setPage(0); }} style={selStyle}>
                  <option value="">Any Confidence</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
            </>
          );
        })()}

        {trialsLoading && <div style={{ color: '#666' }}>Loading trials...</div>}

        {trials && (
          <>
            <p style={{ fontSize: '0.8rem', color: '#888', marginBottom: '0.8rem' }}>
              Showing {trials.trials.length} of {trials.total} trials
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem',
              }}>
                <thead>
                  <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>NCT ID</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                        Region
                        <InlineHelp size={11} text="US = trial sourced from ClinicalTrials.gov; EU = trial sourced from CTIS." />
                      </span>
                    </th>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        WHO Types
                        <InlineHelp size={11} text="WHO 2021 CNS 5th edition subtype(s) inferred from eligibility text. A trial may be assigned to multiple subtypes." />
                      </span>
                    </th>
                    <th style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                        Grade
                        <InlineHelp size={11} text="WHO grade range required for eligibility (1–4). A single value means a specific grade; a range means any within the window." />
                      </span>
                    </th>
                    <th style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                        IDH
                        <InlineHelp size={11} text="IDH1/2 mutation status requirement. Required = mutant-only trial; Excluded = wildtype-only (typical of GBM); Any = both accepted; Mentioned = referenced without direction." />
                      </span>
                    </th>
                    <th style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                        1p/19q
                        <InlineHelp size={11} text="1p/19q codeletion status (defines oligodendroglioma when co-occurring with IDH mutation)." />
                      </span>
                    </th>
                    <th style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                        MGMT
                        <InlineHelp size={11} text="MGMT promoter methylation status (predictive for temozolomide response in GBM)." />
                      </span>
                    </th>
                    <th style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                        Conf.
                        <InlineHelp size={11} text="Classification confidence: green = High, orange = Medium, gray = Low. Based on quantity and specificity of molecular evidence in the eligibility text." />
                      </span>
                    </th>
                    <th style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                        Markers
                        <InlineHelp size={11} text="Total count of distinct molecular markers referenced in the trial's eligibility text. More markers generally yield higher confidence." />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {trials.trials.map((t) => (
                    <tr key={t.nct_id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '6px 10px' }}>
                        <Link to={`/trials/${t.nct_id}`} style={{ color: '#1976d2', textDecoration: 'none', fontWeight: 500 }}>
                          {t.nct_id}
                        </Link>
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                        <span style={{
                          background: t.region === 'EU' ? '#e3f2fd' : '#f3e5f5',
                          color: t.region === 'EU' ? '#1565c0' : '#6a1b9a',
                          padding: '2px 8px', borderRadius: 4,
                          fontSize: '0.7rem', fontWeight: 700,
                        }}>
                          {t.region}
                        </span>
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {t.who_types.map((wt) => {
                            const c = typeColors[wt] || typeColors['Diffuse glioma, NOS'];
                            return (
                              <span key={wt} style={{
                                background: c.bg, color: c.text,
                                padding: '1px 6px', borderRadius: 4,
                                fontSize: '0.7rem', fontWeight: 600,
                              }}>
                                {shortLabels[wt] || wt}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'center', fontSize: '0.78rem', color: '#555' }}>
                        {t.who_grade_min === t.who_grade_max
                          ? t.who_grade_min
                          : `${t.who_grade_min} - ${t.who_grade_max}`}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                        <MarkerBadge value={t.idh_status} />
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                        <MarkerBadge value={t.codeletion_1p19q} />
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                        <MarkerBadge value={t.mgmt_status} />
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                          background: confidenceColors[t.confidence] || '#9e9e9e',
                        }} title={t.confidence} />
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'center', color: '#888' }}>
                        {t.biomarker_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                style={{ padding: '0.4rem 1rem', borderRadius: 4, border: '1px solid #ccc', cursor: 'pointer' }}
              >
                Previous
              </button>
              <span style={{ padding: '0.4rem 0.5rem', fontSize: '0.85rem', color: '#666' }}>
                Page {page + 1}
              </span>
              <button
                disabled={trials.trials.length < limit}
                onClick={() => setPage((p) => p + 1)}
                style={{ padding: '0.4rem 1rem', borderRadius: 4, border: '1px solid #ccc', cursor: 'pointer' }}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MarkerBadge({ value }: { value: string }) {
  if (!value || value === 'unknown') return <span style={{ color: '#ccc', fontSize: '0.72rem' }}>-</span>;
  const colors: Record<string, { bg: string; text: string }> = {
    required: { bg: '#e3f2fd', text: '#1565c0' },
    excluded: { bg: '#fce4ec', text: '#c62828' },
    any: { bg: '#e8f5e9', text: '#2e7d32' },
    mentioned: { bg: '#fff8e1', text: '#f57f17' },
  };
  const c = colors[value] || { bg: '#f5f5f5', text: '#616161' };
  return (
    <span style={{
      background: c.bg, color: c.text,
      padding: '1px 6px', borderRadius: 4,
      fontSize: '0.68rem', fontWeight: 600,
    }}>
      {markerLabels[value] || value}
    </span>
  );
}
