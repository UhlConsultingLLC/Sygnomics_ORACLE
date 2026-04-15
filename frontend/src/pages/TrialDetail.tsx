import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTrialDetail, useTrialBiomarkers } from '../hooks/useApi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { refreshTrialResults, fetchWHOTrialProfile } from '../services/api';
import type { OutcomeResultInfo, BiomarkerMatch, ArmBiomarkerInfo } from '../types';

export default function TrialDetail() {
  const { nctId } = useParams<{ nctId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: trial, isLoading, error } = useTrialDetail(nctId || '');
  const { data: biomarkerData } = useTrialBiomarkers(nctId || '');
  const { data: whoProfile } = useQuery({
    queryKey: ['who-profile', nctId],
    queryFn: () => fetchWHOTrialProfile(nctId || ''),
    enabled: !!nctId,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState('');
  const autoFetchAttempted = useRef(false);

  // Auto-fetch results from CT.gov when outcomes have no results data
  useEffect(() => {
    if (!trial || !nctId || autoFetchAttempted.current) return;
    const hasOutcomes = trial.outcomes.length > 0;
    const allMissingResults = trial.outcomes.every(o => !o.results || o.results.length === 0);
    if (hasOutcomes && allMissingResults) {
      autoFetchAttempted.current = true;
      handleRefresh();
    }
  }, [trial, nctId]);

  const handleRefresh = async () => {
    if (!nctId) return;
    setRefreshing(true);
    setRefreshMsg('');
    try {
      const res = await refreshTrialResults(nctId);
      if (res.outcomes_updated > 0) {
        setRefreshMsg(`Updated ${res.outcomes_updated} outcome(s) with results data.`);
        queryClient.invalidateQueries({ queryKey: ['trial', nctId] });
      } else if (!res.has_results_on_ctgov) {
        setRefreshMsg('This trial has no posted results on ClinicalTrials.gov yet.');
      } else {
        setRefreshMsg('Results fetched but no matching outcomes found in database.');
      }
    } catch {
      setRefreshMsg('Failed to refresh from ClinicalTrials.gov.');
    } finally {
      setRefreshing(false);
    }
  };

  if (isLoading) return <div>Loading trial details...</div>;
  if (error || !trial) return <div>Trial not found. <Link to="/trials">Back to explorer</Link></div>;

  return (
    <div>
      <button
        onClick={() => navigate('/trials')}
        style={{ fontSize: '0.85rem', color: '#007bff', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
      >
        &larr; Back to Explorer
      </button>
      <h1 style={{ fontSize: '1.3rem', margin: '0.5rem 0' }}>{trial.nct_id}</h1>
      <h2 style={{ fontSize: '1rem', color: '#555', fontWeight: 400, marginBottom: '1rem' }}>{trial.title}</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <InfoCard label="Status" value={trial.status} />
        <InfoCard label="Phase" value={trial.phase} />
        <InfoCard label="Study Type" value={trial.study_type} />
        <InfoCard label="Enrollment" value={trial.enrollment_count?.toLocaleString() ?? 'N/A'} />
        <InfoCard label="Start Date" value={trial.start_date ?? 'N/A'} />
        <InfoCard label="Completion Date" value={trial.completion_date ?? 'N/A'} />
      </div>

      {trial.brief_summary && (
        <Section title="Summary">
          <p style={{ fontSize: '0.9rem', color: '#444', lineHeight: 1.5 }}>{trial.brief_summary}</p>
        </Section>
      )}

      {trial.conditions.length > 0 && (
        <Section title="Conditions">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {trial.conditions.map((c) => (
              <span key={c} style={{ background: '#e8f4fd', padding: '4px 10px', borderRadius: 12, fontSize: '0.8rem' }}>{c}</span>
            ))}
          </div>
        </Section>
      )}

      {whoProfile && (
        <Section title="WHO 2021 Classification">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            {whoProfile.who_types.map((wt: string) => {
              const typeColors: Record<string, { bg: string; text: string }> = {
                'Glioblastoma, IDH-wildtype': { bg: '#fce4ec', text: '#c62828' },
                'Astrocytoma, IDH-mutant': { bg: '#e8eaf6', text: '#283593' },
                'Oligodendroglioma, IDH-mutant and 1p/19q-codeleted': { bg: '#e0f2f1', text: '#00695c' },
                'Diffuse midline glioma, H3 K27-altered': { bg: '#f3e5f5', text: '#6a1b9a' },
                'Diffuse glioma, NOS': { bg: '#f5f5f5', text: '#616161' },
              };
              const c = typeColors[wt] || { bg: '#f5f5f5', text: '#616161' };
              return (
                <span key={wt} style={{
                  background: c.bg, color: c.text,
                  padding: '4px 12px', borderRadius: 6,
                  fontSize: '0.85rem', fontWeight: 600,
                }}>
                  {wt}
                </span>
              );
            })}
            <span style={{
              fontSize: '0.78rem', color: '#888', alignSelf: 'center',
            }}>
              Confidence: <span style={{
                color: whoProfile.confidence === 'high' ? '#2e7d32'
                  : whoProfile.confidence === 'medium' ? '#f57f17' : '#9e9e9e',
                fontWeight: 600,
              }}>{whoProfile.confidence}</span>
            </span>
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: '0.82rem' }}>
            <MolReq label="IDH" value={whoProfile.idh_status} />
            <MolReq label="1p/19q" value={whoProfile.codeletion_1p19q} />
            <MolReq label="MGMT" value={whoProfile.mgmt_status} />
            <MolReq label="CDKN2A" value={whoProfile.cdkn2a_status} />
            <MolReq label="H3K27M" value={whoProfile.h3k27m_status} />
            {whoProfile.who_grade_min !== 'Unknown' && (
              <span style={{ color: '#555' }}>
                Grade: {whoProfile.who_grade_min === whoProfile.who_grade_max
                  ? whoProfile.who_grade_min
                  : `${whoProfile.who_grade_min} \u2013 ${whoProfile.who_grade_max}`}
              </span>
            )}
            <span style={{ color: '#888' }}>
              {whoProfile.biomarker_count} biomarker criteria detected
            </span>
          </div>
        </Section>
      )}

      {trial.interventions.length > 0 && (
        <Section title="Interventions">
          {trial.interventions.map((iv, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <strong>{iv.name}</strong> <span style={{ color: '#888', fontSize: '0.8rem' }}>({iv.type})</span>
              {iv.chembl_id && <span style={{ marginLeft: 8, fontSize: '0.75rem', color: '#007bff' }}>{iv.chembl_id}</span>}
              {iv.description && <p style={{ margin: '2px 0 0', fontSize: '0.85rem', color: '#666' }}>{iv.description}</p>}
            </div>
          ))}
        </Section>
      )}

      {trial.sponsor && (
        <Section title="Sponsor">
          <p style={{ fontSize: '0.9rem' }}>{trial.sponsor.name} ({trial.sponsor.type})</p>
        </Section>
      )}

      {trial.arms.length > 0 && (
        <Section title="Arms">
          {trial.arms.map((arm, i) => {
            const armBio = biomarkerData?.arm_biomarkers?.find(
              (ab) => ab.arm_label === arm.label
            );
            return (
              <div key={i} style={{ marginBottom: 10 }}>
                <div>
                  <strong>{arm.label}</strong> <span style={{ color: '#888', fontSize: '0.8rem' }}>({arm.type})</span>
                </div>
                {arm.description && <p style={{ margin: '2px 0 0', fontSize: '0.85rem', color: '#666' }}>{arm.description}</p>}
                {armBio && armBio.biomarkers.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <InlineBiomarkerTags biomarkers={armBio.biomarkers} />
                  </div>
                )}
              </div>
            );
          })}
        </Section>
      )}

      {trial.outcomes.length > 0 && (
        <Section title="Outcomes">
          {/* Arm-level molecular criteria callout */}
          {biomarkerData && biomarkerData.arm_biomarkers && biomarkerData.arm_biomarkers.length > 0 && (
            <ArmCriteriaPanel armBiomarkers={biomarkerData.arm_biomarkers} />
          )}
          {trial.outcomes.every(o => !o.results || o.results.length === 0) && (
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {refreshing && (
                <span style={{ fontSize: '0.8rem', color: '#007bff', fontStyle: 'italic' }}>
                  Fetching results from ClinicalTrials.gov...
                </span>
              )}
              {!refreshing && !refreshMsg && (
                <button
                  onClick={handleRefresh}
                  style={{
                    fontSize: '0.8rem', padding: '4px 12px', borderRadius: 4,
                    border: '1px solid #007bff', background: '#e8f4fd', color: '#007bff',
                    cursor: 'pointer',
                  }}
                >
                  Fetch Results from CT.gov
                </button>
              )}
              {!refreshing && refreshMsg && (
                <>
                  <span style={{ fontSize: '0.8rem', color: '#888' }}>{refreshMsg}</span>
                  <button
                    onClick={() => { setRefreshMsg(''); autoFetchAttempted.current = false; handleRefresh(); }}
                    style={{
                      fontSize: '0.75rem', padding: '2px 8px', borderRadius: 4,
                      border: '1px solid #ccc', background: '#f8f9fa', color: '#555',
                      cursor: 'pointer',
                    }}
                  >
                    Retry
                  </button>
                </>
              )}
            </div>
          )}
          {trial.outcomes.map((o, i) => (
            <div key={i} style={{ marginBottom: 12, paddingBottom: 10, borderBottom: i < trial.outcomes.length - 1 ? '1px solid #eee' : 'none' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 4 }}>
                <span style={{
                  background: o.type === 'PRIMARY' ? '#e3f2fd' : o.type === 'SECONDARY' ? '#fff3e0' : '#f3e5f5',
                  color: o.type === 'PRIMARY' ? '#1565c0' : o.type === 'SECONDARY' ? '#e65100' : '#7b1fa2',
                  padding: '2px 8px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600, flexShrink: 0,
                }}>{o.type}</span>
                <strong style={{ fontSize: '0.9rem' }}>{o.measure}</strong>
              </div>
              {o.time_frame && <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: 4 }}>Time frame: {o.time_frame}</div>}
              {o.results && o.results.length > 0 && (
                <OutcomeResultsTable
                  results={o.results}
                  armBiomarkers={biomarkerData?.arm_biomarkers}
                />
              )}
            </div>
          ))}
        </Section>
      )}

      {trial.eligibility && (
        <Section title="Eligibility">
          <p style={{ fontSize: '0.85rem' }}>Sex: {trial.eligibility.sex} | Age: {trial.eligibility.min_age} - {trial.eligibility.max_age}</p>
          {biomarkerData && biomarkerData.biomarkers.length > 0 && (
            <BiomarkerTags biomarkers={biomarkerData.biomarkers} />
          )}
          {trial.eligibility.criteria_text && (
            <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', background: '#f8f9fa', padding: '0.5rem', borderRadius: 4, maxHeight: 300, overflow: 'auto' }}>
              {trial.eligibility.criteria_text}
            </pre>
          )}
        </Section>
      )}
    </div>
  );
}

function computeRate(value: string, participants: number | null, unit: string | null): string | null {
  const num = parseFloat(value);
  if (isNaN(num)) return null;
  const u = (unit || '').toLowerCase();
  // Unit takes precedence: percentage values are already response rates.
  if (u.includes('percent') || u.includes('%') || u.includes('proportion') || u.includes('fraction') || u.includes('rate')) {
    if (num >= 0 && num <= 1) return (num * 100).toFixed(1) + '%';
    if (num > 1 && num <= 100) return num.toFixed(1) + '%';
    return null;
  }
  // Otherwise treat value as a count and divide by participants.
  if (participants == null || participants === 0) return null;
  if (!Number.isInteger(num) || num > participants) return null;
  return ((num / participants) * 100).toFixed(1) + '%';
}

function OutcomeResultsTable({ results, armBiomarkers }: { results: OutcomeResultInfo[]; armBiomarkers?: ArmBiomarkerInfo[] }) {
  // Match result groups to arm biomarkers by scored fuzzy label matching
  const getArmBioForGroup = (groupTitle: string): ArmBiomarkerInfo | undefined => {
    if (!armBiomarkers || armBiomarkers.length === 0) return undefined;
    const gt = groupTitle.toLowerCase();

    let bestMatch: ArmBiomarkerInfo | undefined;
    let bestScore = 0;

    for (const ab of armBiomarkers) {
      const label = ab.arm_label.toLowerCase();
      let score = 0;

      // Exact full match is highest priority
      if (gt === label) { score += 100; }
      // Full label contained in group title (e.g. "group a" in "Group A - TG02 + RT")
      else if (gt.includes(label)) { score += 50; }
      // Group title contained in arm label
      else if (label.includes(gt)) { score += 40; }

      // Check for group identifier matches (e.g. "group a", "group b", "arm 1", "arm 2")
      const groupIdPattern = /\b(group|arm|cohort)\s*[a-z0-9]+\b/gi;
      const gtIds = (gt.match(groupIdPattern) || []).map(s => s.toLowerCase().replace(/\s+/g, ' '));
      const labelIds = (label.match(groupIdPattern) || []).map(s => s.toLowerCase().replace(/\s+/g, ' '));
      if (gtIds.length > 0 && labelIds.length > 0) {
        const idOverlap = gtIds.filter(id => labelIds.includes(id)).length;
        if (idOverlap > 0) {
          score += 30 * idOverlap; // Strong signal: "Group B" matches "Group B"
        } else {
          // Group identifiers exist but DON'T match (e.g. "Group A" vs "Group B") — penalize
          score -= 20;
        }
      }

      // Word overlap scoring for remaining words (skip very short/common words)
      const stopWords = new Set(['the', 'and', 'for', 'with', 'group', 'arm', 'cohort', 'total']);
      const gtWords = gt.split(/[\s:,\-+/()]+/).filter(w => w.length > 2 && !stopWords.has(w));
      const labelWords = label.split(/[\s:,\-+/()]+/).filter(w => w.length > 2 && !stopWords.has(w));
      const wordOverlap = gtWords.filter(w => labelWords.includes(w)).length;
      score += wordOverlap * 5;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = ab;
      }
    }

    return bestScore > 0 ? bestMatch : undefined;
  };
  return (
    <div style={{ marginTop: 6, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
        <thead>
          <tr style={{ background: '#f8f9fa' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #ddd', fontWeight: 600 }}>Arm / Group</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #ddd', fontWeight: 600 }}>Category</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #ddd', fontWeight: 600 }}>N Analyzed</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #ddd', fontWeight: 600 }}>Value</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #ddd', fontWeight: 600 }}>Rate</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #ddd', fontWeight: 600 }}>CI / Range</th>
          </tr>
        </thead>
        <tbody>
          {(() => {
            const NEG = new Set([
              'no', 'non-responder', 'non responders', 'non-responders', 'no response',
              'progressive disease', 'progression', 'progressed', 'progressive',
              'pd', 'pd (progressive disease)', 'disease progression',
              'stable disease', 'stable', 'sd', 'sd (stable disease)', 'disease stable',
              'sd+pd', 'sd/pd',
            ]);
            const POS = new Set([
              'yes', 'responder', 'responders', 'response', 'responded',
              'complete response', 'partial response', 'complete or partial response',
              'complete remission', 'partial remission', 'complete or partial remission',
              'objective response', 'overall response', 'objective response rate',
              'cr', 'pr', 'cr+pr', 'cr/pr', 'cr or pr',
              'tumor response', 'tumour response', 'with response', 'achieved response',
            ]);
            const catOf = (r: OutcomeResultInfo) => (r.category || r.class_title || '').trim();
            // Preserve ordering of group_title first appearance
            const groupOrder: string[] = [];
            const byGroup: Record<string, { rows: OutcomeResultInfo[]; idxs: number[] }> = {};
            results.forEach((r, idx) => {
              const gt = r.group_title || '';
              if (!(gt in byGroup)) {
                byGroup[gt] = { rows: [], idxs: [] };
                groupOrder.push(gt);
              }
              byGroup[gt].rows.push(r);
              byGroup[gt].idxs.push(idx);
            });

            const renderRow = (r: OutcomeResultInfo, key: string | number) => {
              const cat = catOf(r);
              const catLower = cat.toLowerCase();
              const isNegative = NEG.has(catLower);
              const isMissing = ['missing', 'unknown', 'na', 'n/a'].includes(catLower) && cat !== '';
              const dim = isNegative || isMissing;
              const autoRate = dim ? null : computeRate(r.value, r.participants_count, r.unit);
              return (
              <tr key={key} style={{ borderBottom: '1px solid #eee', opacity: dim ? 0.55 : 1, background: dim ? '#fafafa' : undefined }}>
                <td style={{ padding: '5px 8px', maxWidth: 280 }}>
                  <div style={{ fontWeight: 500 }}>{r.group_title}</div>
                  {r.group_description && (
                    <div
                      title={r.group_description}
                      style={{ fontSize: '0.72rem', color: '#888', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}
                    >
                      {r.group_description}
                    </div>
                  )}
                  {(() => {
                    const armBio = getArmBioForGroup(r.group_title);
                    return armBio && armBio.biomarkers.length > 0 ? (
                      <div style={{ marginTop: 3 }}>
                        <InlineBiomarkerTags biomarkers={armBio.biomarkers} small />
                      </div>
                    ) : null;
                  })()}
                </td>
                <td style={{ padding: '5px 8px', fontSize: '0.78rem' }}>
                  {cat ? (
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
                      background: isNegative ? '#fce4e4' : (isMissing ? '#eee' : '#e3f2e3'),
                      color: isNegative ? '#a33' : (isMissing ? '#777' : '#256029'),
                      fontWeight: 600,
                    }}>{cat}</span>
                  ) : <span style={{ color: '#bbb' }}>-</span>}
                </td>
                <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 500 }}>
                  {r.participants_count != null ? r.participants_count.toLocaleString() : '-'}
                </td>
                <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                  <span style={{ fontWeight: 600, color: '#1a1a2e' }}>{r.value || '-'}</span>
                  {r.unit && <span style={{ fontSize: '0.72rem', color: '#888', marginLeft: 3 }}>{r.unit}</span>}
                  {r.param_type && (
                    <div style={{ fontSize: '0.68rem', color: '#999' }}>{r.param_type.toLowerCase().replace(/_/g, ' ')}</div>
                  )}
                </td>
                <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: '#2e7d32' }}>
                  {autoRate || '-'}
                </td>
                <td style={{ padding: '5px 8px', fontSize: '0.78rem', color: '#666' }}>
                  {r.lower_limit && r.upper_limit
                    ? `${r.lower_limit} to ${r.upper_limit}`
                    : '-'}
                  {r.dispersion_type && r.lower_limit && (
                    <div style={{ fontSize: '0.68rem', color: '#999' }}>{r.dispersion_type}</div>
                  )}
                </td>
              </tr>
              );
            };

            const out: React.ReactNode[] = [];
            groupOrder.forEach((gt) => {
              const { rows, idxs } = byGroup[gt];
              rows.forEach((r, j) => out.push(renderRow(r, idxs[j])));

              // Synthesize a combined CR+PR row if every row in the group is
              // a positive RECIST category with an integer participant count
              // and a shared participants_count.
              if (rows.length < 2) return;
              const positives = rows.filter((r) => POS.has(catOf(r).toLowerCase()));
              // Trigger when we have at least one positive RECIST row alongside
              // other categorized rows (SD/PD/Missing) — i.e. category-style
              // reporting. Single-positive groups still get a derived row so
              // the combined response rate is explicit even if only CR or only
              // PR was observed.
              if (positives.length < 1) return;
              const participants = positives[0].participants_count;
              if (!participants || positives.some((r) => r.participants_count !== participants)) return;
              let total = 0;
              let allInt = true;
              for (const r of positives) {
                const v = parseFloat((r.value || '').trim());
                if (!Number.isFinite(v) || !Number.isInteger(v)) { allInt = false; break; }
                total += v;
              }
              if (!allInt || total < 0 || total > participants) return;
              const combinedRate = ((total / participants) * 100).toFixed(1) + '%';
              const labels = positives.map((r) => catOf(r)).join(' + ');
              out.push(
                <tr key={`${gt}-combined`} style={{
                  borderBottom: '1px solid #cde',
                  background: '#f0f7ff',
                }}>
                  <td style={{ padding: '6px 8px', maxWidth: 280 }}>
                    <div style={{ fontWeight: 600, color: '#1a3a6e' }}>{gt}</div>
                    <div style={{ fontSize: '0.7rem', color: '#5a6e8a', fontStyle: 'italic', marginTop: 1 }}>
                      Derived value — not reported in original trial data
                    </div>
                  </td>
                  <td style={{ padding: '6px 8px', fontSize: '0.78rem' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
                      background: '#1a3a6e', color: '#fff', fontWeight: 600,
                    }} title={`Computed as ${labels}`}>
                      Combined ({labels})
                    </span>
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>
                    {participants.toLocaleString()}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    <span style={{ fontWeight: 700, color: '#1a3a6e' }}>{total}</span>
                    <span style={{ fontSize: '0.72rem', color: '#5a6e8a', marginLeft: 3 }}>Participants</span>
                    <div style={{ fontSize: '0.66rem', color: '#5a6e8a' }}>sum of {positives.length} categories</div>
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: '#1a3a6e' }}>
                    {combinedRate}
                  </td>
                  <td style={{ padding: '6px 8px', fontSize: '0.72rem', color: '#5a6e8a', fontStyle: 'italic' }}>
                    app-calculated
                  </td>
                </tr>
              );
            });
            return out;
          })()}
        </tbody>
      </table>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '0.75rem' }}>
      <div style={{ fontSize: '0.75rem', color: '#888' }}>{label}</div>
      <div style={{ fontSize: '1rem', fontWeight: 600, color: '#333' }}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#333' }}>{title}</h3>
      {children}
    </div>
  );
}

function ArmCriteriaPanel({ armBiomarkers }: { armBiomarkers: ArmBiomarkerInfo[] }) {
  return (
    <div style={{
      margin: '0 0 12px',
      padding: '8px 12px',
      background: '#f0f4f8',
      border: '1px solid #d0d7de',
      borderRadius: 6,
    }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#586069', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
        Arm-Specific Molecular Criteria
      </div>
      {armBiomarkers.map((ab, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: i < armBiomarkers.length - 1 ? 6 : 0, flexWrap: 'wrap' }}>
          <span
            title={ab.arm_label}
            style={{
              fontSize: '0.78rem', fontWeight: 600, color: '#24292e',
              minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: 280,
            }}
          >
            {ab.arm_label}
          </span>
          <span style={{ color: '#d0d7de' }}>{'\u2192'}</span>
          <InlineBiomarkerTags biomarkers={ab.biomarkers} />
        </div>
      ))}
    </div>
  );
}

function InlineBiomarkerTags({ biomarkers, small }: { biomarkers: BiomarkerMatch[]; small?: boolean }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const fontSize = small ? '0.68rem' : '0.73rem';
  const badgeFontSize = small ? '0.6rem' : '0.65rem';
  const padding = small ? '1px 6px' : '2px 8px';

  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
      {biomarkers.map((bm, i) => {
        const colors = CATEGORY_COLORS[bm.category] || CATEGORY_COLORS.other;
        const isExcluded = bm.requirement === 'excluded' || bm.context === 'exclusion';
        return (
          <span
            key={`${bm.marker}-${i}`}
            style={{ position: 'relative', display: 'inline-block' }}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
          >
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding,
              borderRadius: 10,
              border: `1px solid ${colors.border}`,
              background: isExcluded ? '#f5f5f5' : colors.bg,
              color: isExcluded ? '#999' : colors.text,
              fontSize,
              fontWeight: 500,
              cursor: 'default',
              textDecoration: isExcluded ? 'line-through' : 'none',
              opacity: isExcluded ? 0.7 : 1,
              transition: 'box-shadow 0.15s',
              boxShadow: hoveredIdx === i ? '0 2px 8px rgba(0,0,0,0.15)' : 'none',
            }}>
              {bm.marker}
              {bm.tcga_percent != null && (
                <span style={{
                  fontSize: badgeFontSize, fontWeight: 600,
                  background: isExcluded ? '#e0e0e0' : colors.text,
                  color: '#fff', borderRadius: 6, padding: '0px 4px',
                }}>
                  {bm.tcga_percent < 1 ? '<1' : Math.round(bm.tcga_percent)}%
                </span>
              )}
            </span>
            {hoveredIdx === i && (
              <div style={{
                position: 'absolute', bottom: '100%', left: '50%',
                transform: 'translateX(-50%)', marginBottom: 6,
                padding: '8px 12px', background: '#1a1a2e', color: '#fff',
                borderRadius: 6, fontSize: '0.75rem', lineHeight: 1.4,
                whiteSpace: 'nowrap', zIndex: 1000,
                boxShadow: '0 4px 16px rgba(0,0,0,0.25)', pointerEvents: 'none',
                minWidth: 200,
              }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>{bm.marker}</div>
                {bm.tcga_count != null && bm.tcga_total != null && (
                  <div style={{ color: '#7dd3fc', fontWeight: 600 }}>
                    TCGA-GBM: {bm.tcga_count}/{bm.tcga_total} ({bm.tcga_percent?.toFixed(1)}%)
                  </div>
                )}
                {bm.tcga_note && (
                  <div style={{ fontSize: '0.68rem', color: '#aaa', whiteSpace: 'normal', maxWidth: 280, marginTop: 2 }}>
                    {bm.tcga_note}
                  </div>
                )}
                <div style={{
                  position: 'absolute', top: '100%', left: '50%',
                  transform: 'translateX(-50%)', width: 0, height: 0,
                  borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
                  borderTop: '5px solid #1a1a2e',
                }} />
              </div>
            )}
          </span>
        );
      })}
    </span>
  );
}

function MolReq({ label, value }: { label: string; value: string }) {
  if (!value || value === 'unknown') return null;
  const colors: Record<string, string> = {
    required: '#1565c0',
    excluded: '#c62828',
    any: '#2e7d32',
    mentioned: '#f57f17',
  };
  const labels: Record<string, string> = {
    required: 'Required',
    excluded: 'Excluded',
    any: 'Any',
    mentioned: 'Mentioned',
  };
  return (
    <span style={{ color: '#555' }}>
      {label}: <span style={{ color: colors[value] || '#666', fontWeight: 600 }}>
        {labels[value] || value}
      </span>
    </span>
  );
}

const CATEGORY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  mutation: { bg: '#fce4ec', border: '#ef9a9a', text: '#c62828' },
  amplification: { bg: '#e8eaf6', border: '#9fa8da', text: '#283593' },
  methylation: { bg: '#e0f2f1', border: '#80cbc4', text: '#00695c' },
  expression: { bg: '#fff3e0', border: '#ffcc80', text: '#e65100' },
  fusion: { bg: '#f3e5f5', border: '#ce93d8', text: '#6a1b9a' },
  codeletion: { bg: '#e1f5fe', border: '#81d4fa', text: '#01579b' },
  other: { bg: '#f5f5f5', border: '#bdbdbd', text: '#424242' },
};

const REQ_ICONS: Record<string, string> = {
  required: '\u2714',   // checkmark
  excluded: '\u2718',   // X
  mentioned: '\u2022',  // bullet
};

function BiomarkerTags({ biomarkers }: { biomarkers: BiomarkerMatch[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <div style={{ margin: '8px 0 12px', padding: '10px 12px', background: '#fafbfc', border: '1px solid #e1e4e8', borderRadius: 6 }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#586069', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
        TCGA-GBM Matchable Criteria
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {biomarkers.map((bm, i) => {
          const colors = CATEGORY_COLORS[bm.category] || CATEGORY_COLORS.other;
          const reqIcon = REQ_ICONS[bm.requirement] || REQ_ICONS.mentioned;
          const isExcluded = bm.requirement === 'excluded' || bm.context === 'exclusion';

          return (
            <div
              key={`${bm.marker}-${i}`}
              style={{ position: 'relative', display: 'inline-block' }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 10px',
                  borderRadius: 14,
                  border: `1px solid ${colors.border}`,
                  background: isExcluded ? '#f5f5f5' : colors.bg,
                  color: isExcluded ? '#999' : colors.text,
                  fontSize: '0.78rem',
                  fontWeight: 500,
                  cursor: 'default',
                  textDecoration: isExcluded ? 'line-through' : 'none',
                  opacity: isExcluded ? 0.7 : 1,
                  transition: 'box-shadow 0.15s',
                  boxShadow: hoveredIdx === i ? '0 2px 8px rgba(0,0,0,0.15)' : 'none',
                }}
              >
                <span style={{ fontSize: '0.7rem' }}>{reqIcon}</span>
                {bm.marker}
                {bm.tcga_percent != null && (
                  <span style={{
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    background: isExcluded ? '#e0e0e0' : colors.text,
                    color: '#fff',
                    borderRadius: 8,
                    padding: '1px 5px',
                    marginLeft: 2,
                  }}>
                    {bm.tcga_percent < 1 ? '<1' : Math.round(bm.tcga_percent)}%
                  </span>
                )}
              </span>

              {/* Tooltip popup */}
              {hoveredIdx === i && (
                <div style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  marginBottom: 8,
                  padding: '10px 14px',
                  background: '#1a1a2e',
                  color: '#fff',
                  borderRadius: 8,
                  fontSize: '0.78rem',
                  lineHeight: 1.5,
                  whiteSpace: 'nowrap',
                  zIndex: 1000,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
                  pointerEvents: 'none',
                  minWidth: 220,
                }}>
                  <div style={{ fontWeight: 700, marginBottom: 4, fontSize: '0.85rem' }}>{bm.marker}</div>
                  <div style={{ color: '#ccc', marginBottom: 4 }}>
                    <span style={{ textTransform: 'capitalize' }}>{bm.category}</span>
                    {' \u2022 '}
                    <span style={{ textTransform: 'capitalize' }}>{bm.context}</span>
                    {' \u2022 '}
                    <span style={{ textTransform: 'capitalize' }}>{bm.requirement}</span>
                  </div>
                  {bm.tcga_count != null && bm.tcga_total != null && (
                    <div style={{ marginTop: 4, padding: '6px 8px', background: 'rgba(255,255,255,0.1)', borderRadius: 4 }}>
                      <div style={{ fontWeight: 600, color: '#7dd3fc', fontSize: '0.9rem' }}>
                        TCGA-GBM: {bm.tcga_count} / {bm.tcga_total} patients ({bm.tcga_percent?.toFixed(1)}%)
                      </div>
                      <div style={{
                        marginTop: 4, height: 6, background: 'rgba(255,255,255,0.15)', borderRadius: 3, overflow: 'hidden',
                      }}>
                        <div style={{
                          height: '100%',
                          width: `${Math.min(100, bm.tcga_percent || 0)}%`,
                          background: '#7dd3fc',
                          borderRadius: 3,
                        }} />
                      </div>
                    </div>
                  )}
                  {bm.tcga_note && (
                    <div style={{ marginTop: 6, fontSize: '0.72rem', color: '#aaa', whiteSpace: 'normal', maxWidth: 300 }}>
                      {bm.tcga_note}
                    </div>
                  )}
                  <div style={{ marginTop: 6, fontSize: '0.68rem', color: '#888', fontStyle: 'italic' }}>
                    Matched text: &ldquo;{bm.raw_text}&rdquo;
                  </div>
                  {/* Tooltip arrow */}
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 0,
                    height: 0,
                    borderLeft: '6px solid transparent',
                    borderRight: '6px solid transparent',
                    borderTop: '6px solid #1a1a2e',
                  }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
