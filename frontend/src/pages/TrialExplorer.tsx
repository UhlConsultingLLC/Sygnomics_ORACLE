import { useState, useEffect } from 'react';
import { useTrials } from '../hooks/useApi';
import { suggestOutcomes } from '../services/api';
import TrialCard from '../components/TrialCard';
import AutocompleteInput from '../components/AutocompleteInput';
import {
  getTrialExplorerFilters,
  setTrialExplorerFilters,
  clearTrialExplorerFilters,
} from '../stores/trialExplorerStore';

interface MultiPickerProps {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}
function MultiPicker({ label, options, selected, onChange }: MultiPickerProps) {
  const remaining = options.filter((o) => !selected.includes(o.value));
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label || v;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <select
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          onChange([...selected, v]);
        }}
        style={{ padding: '0.4rem 0.8rem', border: '1px solid #ccc', borderRadius: 4 }}
        disabled={remaining.length === 0}
      >
        <option value="">{label}</option>
        {remaining.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {selected.map((v) => (
        <span
          key={v}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            background: '#e3f2fd',
            color: '#1565c0',
            border: '1px solid #bbdefb',
            borderRadius: 12,
            fontSize: '0.75rem',
          }}
        >
          {labelOf(v)}
          <button
            onClick={() => onChange(selected.filter((x) => x !== v))}
            style={{
              background: 'none',
              border: 'none',
              color: '#1565c0',
              cursor: 'pointer',
              padding: 0,
              fontSize: '0.9rem',
              lineHeight: 1,
            }}
            title={`Remove ${labelOf(v)}`}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

export default function TrialExplorer() {
  // Initialize state from the persistent store so filters survive navigation
  const initial = getTrialExplorerFilters();

  const [nctId, setNctId] = useState(initial.nctId);
  const [condition, setCondition] = useState(initial.condition);
  const [statuses, setStatuses] = useState<string[]>(initial.statuses);
  const [phases, setPhases] = useState<string[]>(initial.phases);
  const [interventionFilter, setInterventionFilter] = useState(initial.intervention);
  const [hasResultsList, setHasResultsList] = useState<string[]>(initial.hasResultsList);
  const [whoTypes, setWhoTypes] = useState<string[]>(initial.whoTypes);
  const [outcomeInput, setOutcomeInput] = useState(initial.outcomeInput);
  const [activeOutcomeKeyword, setActiveOutcomeKeyword] = useState(initial.activeOutcomeKeyword);

  const [expandedOutcomes, setExpandedOutcomes] = useState<string[]>(initial.expandedOutcomes);
  const [selectedOutcomes, setSelectedOutcomes] = useState<Set<string>>(() => new Set(initial.selectedOutcomes));
  const [expanding, setExpanding] = useState(false);
  const [page, setPage] = useState(initial.page);
  const [expandSynonyms, setExpandSynonyms] = useState(initial.expandSynonyms);
  const [interventionMode, setInterventionMode] = useState<'any' | 'all'>(initial.interventionMode);
  const [interventionExclusive, setInterventionExclusive] = useState(initial.interventionExclusive);
  const [interventionSameArm, setInterventionSameArm] = useState(initial.interventionSameArm);
  const limit = 20;

  // Persist filter state back to the store whenever it changes
  useEffect(() => {
    setTrialExplorerFilters({
      nctId,
      condition,
      statuses,
      phases,
      intervention: interventionFilter,
      hasResultsList,
      whoTypes,
      outcomeInput,
      activeOutcomeKeyword,
      expandedOutcomes,
      selectedOutcomes: Array.from(selectedOutcomes),
      page,
      expandSynonyms,
      interventionMode,
      interventionExclusive,
      interventionSameArm,
    });
  }, [
    nctId,
    condition,
    statuses,
    phases,
    interventionFilter,
    hasResultsList,
    whoTypes,
    outcomeInput,
    activeOutcomeKeyword,
    expandedOutcomes,
    selectedOutcomes,
    page,
    expandSynonyms,
    interventionMode,
    interventionExclusive,
    interventionSameArm,
  ]);

  // Build the effective outcome keyword for the API (join all selected terms)
  const effectiveOutcomeKeyword =
    selectedOutcomes.size > 0 ? Array.from(selectedOutcomes).join(',') : activeOutcomeKeyword;

  const { data, isLoading, isFetching } = useTrials({
    nct_id: nctId || undefined,
    condition: condition || undefined,
    status: statuses.length ? statuses.join(',') : undefined,
    phase: phases.length ? phases.join(',') : undefined,
    intervention: interventionFilter || undefined,
    intervention_mode: interventionMode,
    intervention_exclusive: interventionMode === 'all' ? interventionExclusive : undefined,
    intervention_same_arm: interventionMode === 'all' ? interventionSameArm : undefined,
    has_results: hasResultsList.length ? hasResultsList.join(',') : undefined,
    outcome_keyword: effectiveOutcomeKeyword || undefined,
    who_type: whoTypes.length ? whoTypes.join(',') : undefined,
    expand_synonyms: expandSynonyms,
    limit,
    offset: page * limit,
  });

  const appliedExpansions = data?.applied_expansions || {};

  const handleExpandOutcomes = async () => {
    const keyword = outcomeInput.trim();
    if (!keyword) return;
    setExpanding(true);
    try {
      const result = await suggestOutcomes(keyword);
      setExpandedOutcomes(result.expanded_terms);
      setSelectedOutcomes(new Set(result.expanded_terms));
      setActiveOutcomeKeyword('');
      setPage(0);
    } catch {
      setActiveOutcomeKeyword(keyword);
      setExpandedOutcomes([]);
      setSelectedOutcomes(new Set());
    } finally {
      setExpanding(false);
    }
  };

  const toggleOutcome = (term: string) => {
    setSelectedOutcomes((prev) => {
      const next = new Set(prev);
      if (next.has(term)) next.delete(term);
      else next.add(term);
      return next;
    });
    setPage(0);
  };

  const clearOutcomes = () => {
    setOutcomeInput('');
    setExpandedOutcomes([]);
    setSelectedOutcomes(new Set());
    setActiveOutcomeKeyword('');
    setPage(0);
  };

  const clearAllFilters = () => {
    setNctId('');
    setCondition('');
    setStatuses([]);
    setPhases([]);
    setInterventionFilter('');
    setInterventionMode('any');
    setInterventionExclusive(false);
    setInterventionSameArm(false);
    setHasResultsList([]);
    setWhoTypes([]);
    setOutcomeInput('');
    setExpandedOutcomes([]);
    setSelectedOutcomes(new Set());
    setActiveOutcomeKeyword('');
    setPage(0);
    clearTrialExplorerFilters();
  };

  const hasAnyFilter = !!(
    nctId ||
    condition ||
    statuses.length ||
    phases.length ||
    interventionFilter ||
    hasResultsList.length ||
    whoTypes.length ||
    effectiveOutcomeKeyword
  );

  const clearBtnStyle: React.CSSProperties = {
    position: 'absolute',
    right: 6,
    top: '50%',
    transform: 'translateY(-50%)',
    background: '#6c757d',
    color: '#fff',
    border: 'none',
    borderRadius: '50%',
    width: 18,
    height: 18,
    fontSize: '0.65rem',
    lineHeight: '18px',
    textAlign: 'center',
    cursor: 'pointer',
    padding: 0,
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Trial Explorer</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label
            title="When enabled, condition & intervention inputs are expanded via MeSH vocabulary so synonyms (e.g. GBM ↔ Glioblastoma) are matched automatically."
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: '0.78rem',
              color: '#444',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={expandSynonyms}
              onChange={(e) => {
                setExpandSynonyms(e.target.checked);
                setPage(0);
              }}
            />
            MeSH synonym expansion
          </label>
          {hasAnyFilter && (
            <button
              onClick={clearAllFilters}
              style={{
                padding: '0.4rem 1rem',
                background: '#dc3545',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: '0.8rem',
              }}
            >
              Clear All Filters
            </button>
          )}
        </div>
      </div>

      {/* Row 1: NCT ID + Condition + Intervention search */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.5rem' }}>
        <div style={{ position: 'relative', width: 200, flexShrink: 0 }}>
          <input
            type="text"
            placeholder="Search by NCT ID..."
            value={nctId}
            onChange={(e) => {
              setNctId(e.target.value);
              setPage(0);
            }}
            style={{
              width: '100%',
              padding: '0.4rem 0.8rem',
              paddingRight: nctId ? 28 : '0.8rem',
              border: '1px solid #ccc',
              borderRadius: 4,
              boxSizing: 'border-box',
            }}
          />
          {nctId && (
            <button
              onClick={() => {
                setNctId('');
                setPage(0);
              }}
              style={clearBtnStyle}
              title="Clear NCT ID"
            >
              &times;
            </button>
          )}
        </div>
        <AutocompleteInput
          placeholder="Filter by condition..."
          value={condition}
          onChange={(v) => {
            setCondition(v);
            setPage(0);
          }}
          field="conditions"
          clearButton={
            condition ? (
              <button
                onClick={() => {
                  setCondition('');
                  setPage(0);
                }}
                style={clearBtnStyle}
                title="Clear condition"
              >
                &times;
              </button>
            ) : undefined
          }
        />
        <AutocompleteInput
          placeholder="Therapy/treatment (comma-separate for multiple, e.g. Erlotinib, Temozolomide)..."
          value={interventionFilter}
          onChange={(v) => {
            setInterventionFilter(v);
            setPage(0);
          }}
          field="interventions"
          clearButton={
            interventionFilter ? (
              <button
                onClick={() => {
                  setInterventionFilter('');
                  setPage(0);
                }}
                style={clearBtnStyle}
                title="Clear intervention"
              >
                &times;
              </button>
            ) : undefined
          }
        />
      </div>

      {/* Multi-therapy combination controls (only relevant when 2+ therapies entered) */}
      {interventionFilter
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean).length >= 2 && (
        <div
          style={{
            marginBottom: '0.5rem',
            padding: '0.5rem 0.7rem',
            background: '#fff8e1',
            border: '1px solid #ffe082',
            borderRadius: 4,
            fontSize: '0.75rem',
            color: '#5d4037',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <strong style={{ color: '#4e342e' }}>Multi-therapy match:</strong>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="iv-mode"
              checked={interventionMode === 'any'}
              onChange={() => {
                setInterventionMode('any');
                setPage(0);
              }}
            />
            Any (OR) — trials with at least one of the therapies
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="iv-mode"
              checked={interventionMode === 'all'}
              onChange={() => {
                setInterventionMode('all');
                setPage(0);
              }}
            />
            All (AND) — trials containing every therapy
          </label>
          {interventionMode === 'all' && (
            <>
              <span style={{ color: '#bbb' }}>|</span>
              <label
                title="If checked, the trial must contain ONLY the searched therapies (no other drugs)."
                style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={interventionExclusive}
                  onChange={(e) => {
                    setInterventionExclusive(e.target.checked);
                    setPage(0);
                  }}
                />
                Exclusive (no other therapies allowed)
              </label>
              <label
                title="If checked, every therapy must appear in the SAME trial arm/group (not across separate arms)."
                style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={interventionSameArm}
                  onChange={(e) => {
                    setInterventionSameArm(e.target.checked);
                    setPage(0);
                  }}
                />
                Same arm/group
              </label>
            </>
          )}
        </div>
      )}

      {/* MeSH expansion info */}
      {expandSynonyms && (appliedExpansions.condition || appliedExpansions.intervention) && (
        <div
          style={{
            marginBottom: '0.5rem',
            padding: '0.4rem 0.6rem',
            background: '#e8f4fd',
            border: '1px solid #b3dcf5',
            borderRadius: 4,
            fontSize: '0.72rem',
            color: '#0c5460',
          }}
        >
          {appliedExpansions.condition && (
            <div>
              <strong>Condition matched via MeSH:</strong> {appliedExpansions.condition.join(', ')}
            </div>
          )}
          {appliedExpansions.intervention && (
            <div style={{ marginTop: appliedExpansions.condition ? 4 : 0 }}>
              <strong>Intervention matched via MeSH:</strong> {appliedExpansions.intervention.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Row 2: Status + Phase + Results + WHO filters */}
      <div
        style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}
      >
        <MultiPicker
          label="+ Status…"
          options={[
            { value: 'RECRUITING', label: 'RECRUITING' },
            { value: 'COMPLETED', label: 'COMPLETED' },
            { value: 'ACTIVE_NOT_RECRUITING', label: 'ACTIVE_NOT_RECRUITING' },
            { value: 'TERMINATED', label: 'TERMINATED' },
            { value: 'WITHDRAWN', label: 'WITHDRAWN' },
            { value: 'NOT_YET_RECRUITING', label: 'NOT_YET_RECRUITING' },
          ]}
          selected={statuses}
          onChange={(next) => {
            setStatuses(next);
            setPage(0);
          }}
        />
        <MultiPicker
          label="+ Phase…"
          options={['EARLY_PHASE1', 'PHASE1', 'PHASE2', 'PHASE3', 'PHASE4', 'NA'].map((p) => ({ value: p, label: p }))}
          selected={phases}
          onChange={(next) => {
            setPhases(next);
            setPage(0);
          }}
        />
        <MultiPicker
          label="+ Results…"
          options={[
            { value: 'with_data', label: 'Has results data' },
            { value: 'no_data', label: 'No posted results on CT.gov' },
            { value: 'no_outcomes', label: 'No outcomes reported' },
          ]}
          selected={hasResultsList}
          onChange={(next) => {
            setHasResultsList(next);
            setPage(0);
          }}
        />
        <MultiPicker
          label="+ WHO Subtype…"
          options={[
            { value: 'Glioblastoma, IDH-wildtype', label: 'GBM IDH-wildtype' },
            { value: 'Astrocytoma, IDH-mutant', label: 'Astrocytoma IDH-mutant' },
            { value: 'Oligodendroglioma', label: 'Oligodendroglioma' },
            { value: 'Diffuse midline glioma', label: 'DMG H3K27' },
            { value: 'Diffuse glioma, NOS', label: 'Glioma NOS' },
          ]}
          selected={whoTypes}
          onChange={(next) => {
            setWhoTypes(next);
            setPage(0);
          }}
        />
      </div>

      {/* Row 3: Outcome keyword expansion */}
      <div
        style={{
          marginBottom: '1rem',
          padding: '0.6rem 0.75rem',
          background: '#f8f9fa',
          borderRadius: 6,
          border: '1px solid #e9ecef',
        }}
      >
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <AutocompleteInput
            placeholder="Outcome measure (e.g., PFS, response rate, overall survival)..."
            value={outcomeInput}
            onChange={(v) => setOutcomeInput(v)}
            field="outcomes"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleExpandOutcomes();
            }}
          />
          <button
            onClick={handleExpandOutcomes}
            disabled={expanding || !outcomeInput.trim()}
            style={{
              padding: '0.4rem 1rem',
              background: expanding ? '#6c757d' : '#17a2b8',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: expanding ? 'default' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {expanding ? 'Expanding...' : 'Expand Outcomes'}
          </button>
          {(expandedOutcomes.length > 0 || activeOutcomeKeyword) && (
            <button
              onClick={clearOutcomes}
              style={{
                padding: '0.4rem 0.8rem',
                background: '#dc3545',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: '0.8rem',
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Expanded outcome tags */}
        {expandedOutcomes.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '0.75rem',
                color: '#555',
                marginBottom: 4,
              }}
            >
              <span>
                {selectedOutcomes.size} of {expandedOutcomes.length} terms selected — click to toggle:
              </span>
              <button
                onClick={() => {
                  setSelectedOutcomes(new Set(expandedOutcomes));
                  setPage(0);
                }}
                disabled={selectedOutcomes.size === expandedOutcomes.length}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#17a2b8',
                  cursor: 'pointer',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  padding: 0,
                  opacity: selectedOutcomes.size === expandedOutcomes.length ? 0.4 : 1,
                }}
              >
                Select All
              </button>
              <span style={{ color: '#ccc' }}>|</span>
              <button
                onClick={() => {
                  setSelectedOutcomes(new Set());
                  setPage(0);
                }}
                disabled={selectedOutcomes.size === 0}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#dc3545',
                  cursor: 'pointer',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  padding: 0,
                  opacity: selectedOutcomes.size === 0 ? 0.4 : 1,
                }}
              >
                Deselect All
              </button>
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {expandedOutcomes.map((term) => {
                const isSelected = selectedOutcomes.has(term);
                return (
                  <button
                    key={term}
                    onClick={() => toggleOutcome(term)}
                    style={{
                      padding: '2px 8px',
                      borderRadius: 12,
                      border: isSelected ? '1px solid #17a2b8' : '1px solid #ccc',
                      background: isSelected ? '#d1ecf1' : '#fff',
                      color: isSelected ? '#0c5460' : '#999',
                      fontSize: '0.72rem',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {term}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {isLoading && <div>Loading trials...</div>}
      {!isLoading && isFetching && (
        <div style={{ fontSize: '0.8rem', color: '#007bff', marginBottom: '0.5rem' }}>Updating...</div>
      )}

      {data && (
        <>
          <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.75rem' }}>
            Showing {data.trials.length} of {data.total} trials
          </p>
          {data.trials.map((t) => (
            <TrialCard key={t.nct_id} trial={t} />
          ))}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              style={{ padding: '0.4rem 1rem', borderRadius: 4, border: '1px solid #ccc', cursor: 'pointer' }}
            >
              Previous
            </button>
            <span style={{ padding: '0.4rem 0.5rem', fontSize: '0.85rem', color: '#666' }}>Page {page + 1}</span>
            <button
              disabled={data.trials.length < limit}
              onClick={() => setPage((p) => p + 1)}
              style={{ padding: '0.4rem 1rem', borderRadius: 4, border: '1px solid #ccc', cursor: 'pointer' }}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
