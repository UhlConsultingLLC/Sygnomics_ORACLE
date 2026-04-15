import { useState } from 'react';
import { useFilterOptions } from '../hooks/useApi';
import { suggestOutcomes } from '../services/api';
import AutocompleteInput from './AutocompleteInput';
import { usePersistentState } from '../hooks/usePersistentState';
import type { FilterSpec } from '../types';

interface FilterPanelProps {
  onApply: (spec: FilterSpec) => void;
}

export default function FilterPanel({ onApply }: FilterPanelProps) {
  const { data: options, isLoading } = useFilterOptions();
  const [spec, setSpec, resetSpec] = usePersistentState<FilterSpec>('filter_panel_spec', {});

  // Search bars for filter groups
  const [filterSearch, setFilterSearch, resetFilterSearch] = usePersistentState<Record<string, string>>('filter_panel_search', {});

  // Intervention filter state
  const [interventionInput, setInterventionInput, resetIntervention] = usePersistentState<string>('filter_panel_intervention', '');

  // Outcome expansion state
  const [outcomeInput, setOutcomeInput, resetOutcomeInput] = usePersistentState<string>('filter_panel_outcome_input', '');
  const [expandedOutcomes, setExpandedOutcomes, resetExpandedOutcomes] = usePersistentState<string[]>('filter_panel_expanded_outcomes', []);
  const [selectedOutcomesArr, setSelectedOutcomesArr, resetSelectedOutcomes] = usePersistentState<string[]>('filter_panel_selected_outcomes', []);
  const selectedOutcomes = new Set(selectedOutcomesArr);
  const updateSelectedOutcomes = (next: Set<string>) => setSelectedOutcomesArr(Array.from(next));
  const [expanding, setExpanding] = useState(false);
  const [expandOriginal, setExpandOriginal, resetExpandOriginal] = usePersistentState<string>('filter_panel_expand_original', '');

  const handleMultiSelect = (field: keyof FilterSpec, value: string) => {
    setSpec((prev) => {
      const current = (prev[field] as string[] | undefined) || [];
      const updated = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [field]: updated.length ? updated : undefined };
    });
  };

  const handleExpandOutcomes = async () => {
    const keyword = outcomeInput.trim();
    if (!keyword) return;
    setExpanding(true);
    try {
      const result = await suggestOutcomes(keyword);
      setExpandedOutcomes(result.expanded_terms);
      setExpandOriginal(result.original);
      // Auto-select all expanded terms by default
      updateSelectedOutcomes(new Set(result.expanded_terms));
    } catch {
      setExpandedOutcomes([]);
    } finally {
      setExpanding(false);
    }
  };

  const toggleOutcome = (term: string) => {
    const next = new Set(selectedOutcomes);
    if (next.has(term)) next.delete(term); else next.add(term);
    updateSelectedOutcomes(next);
  };

  const selectAllOutcomes = () => updateSelectedOutcomes(new Set(expandedOutcomes));
  const deselectAllOutcomes = () => updateSelectedOutcomes(new Set());

  const handleClear = () => {
    resetSpec();
    resetFilterSearch();
    resetIntervention();
    resetOutcomeInput();
    resetExpandedOutcomes();
    resetSelectedOutcomes();
    resetExpandOriginal();
    onApply({});
  };

  const handleApply = () => {
    const finalSpec = { ...spec };
    // Parse comma-separated intervention keywords
    if (interventionInput.trim()) {
      finalSpec.intervention_keywords = interventionInput.split(',').map((k) => k.trim()).filter(Boolean);
    }
    // Use the selected expanded outcomes as the keyword list
    if (selectedOutcomes.size > 0) {
      finalSpec.outcome_keywords = Array.from(selectedOutcomes);
    } else if (outcomeInput.trim()) {
      finalSpec.outcome_keywords = outcomeInput.split(',').map((k) => k.trim()).filter(Boolean);
    }
    onApply(finalSpec);
  };

  if (isLoading) return <div>Loading filters...</div>;
  if (!options) return null;

  const MAX_VISIBLE = 30;
  const filterGroups: { label: string; field: keyof FilterSpec; values: string[] }[] = [
    { label: 'Phase', field: 'phases', values: options.phases },
    { label: 'Status', field: 'statuses', values: options.statuses },
    { label: 'Study Type', field: 'study_types', values: options.study_types },
    { label: 'Condition', field: 'conditions', values: options.conditions },
    { label: 'MOA Category', field: 'moa_categories', values: options.moa_categories },
    { label: 'Sponsor', field: 'sponsors', values: options.sponsors },
    { label: 'Country', field: 'locations_country', values: options.countries || [] },
  ];

  return (
    <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
      <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Filters</h3>

      {/* Checkbox-based filter groups */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' }}>
        {filterGroups.map(({ label, field, values }) => {
          const searchTerm = (filterSearch[field] || '').toLowerCase();
          const matched = searchTerm
            ? values.filter((v) => v.toLowerCase().includes(searchTerm))
            : values;
          // Show all matches when searching, otherwise cap at MAX_VISIBLE
          const filtered = searchTerm ? matched : matched.slice(0, MAX_VISIBLE);
          const hiddenCount = matched.length - filtered.length;
          return (
            <div key={field}>
              <strong style={{ fontSize: '0.8rem', color: '#555' }}>{label}</strong>
              <input
                type="text"
                placeholder={`Search ${label.toLowerCase()}...`}
                value={filterSearch[field] || ''}
                onChange={(e) =>
                  setFilterSearch((prev) => ({ ...prev, [field]: e.target.value }))
                }
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '3px 6px',
                  marginTop: 4,
                  marginBottom: 4,
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  fontSize: '0.75rem',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ maxHeight: 150, overflowY: 'auto' }}>
                {filtered.length === 0 && (
                  <div style={{ fontSize: '0.75rem', color: '#999', padding: '4px 0' }}>No matches</div>
                )}
                {filtered.map((v) => {
                  const selected = ((spec[field] as string[] | undefined) || []).includes(v);
                  return (
                    <label key={v} style={{ display: 'block', fontSize: '0.78rem', cursor: 'pointer', padding: '2px 0' }}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => handleMultiSelect(field, v)}
                        style={{ marginRight: 4 }}
                      />
                      {v}
                    </label>
                  );
                })}
                {hiddenCount > 0 && (
                  <div style={{ fontSize: '0.72rem', color: '#999', padding: '4px 0', fontStyle: 'italic' }}>
                    +{hiddenCount} more — use search to find
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Therapy/Treatment name filter */}
      <div style={{ marginTop: '1rem' }}>
        <strong style={{ fontSize: '0.8rem', color: '#555', display: 'block', marginBottom: 4 }}>
          Therapy / Treatment Name <span style={{ fontWeight: 400, color: '#999' }}>(comma-separated)</span>
        </strong>
        <AutocompleteInput
          placeholder="e.g., Temozolomide, Bevacizumab, Pembrolizumab..."
          value={interventionInput}
          onChange={setInterventionInput}
          field="interventions"
          style={{ fontSize: '0.8rem' }}
        />
      </div>

      {/* Has Results filter */}
      <div style={{ marginTop: '1rem' }}>
        <strong style={{ fontSize: '0.8rem', color: '#555', display: 'block', marginBottom: 4 }}>Reported Results</strong>
        <select
          value={spec.has_results === undefined ? '' : spec.has_results ? 'true' : 'false'}
          onChange={(e) => {
            const val = e.target.value;
            setSpec((prev) => ({
              ...prev,
              has_results: val === '' ? undefined : val === 'true',
            }));
          }}
          style={{ padding: '0.4rem 0.8rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.8rem' }}
        >
          <option value="">Any</option>
          <option value="true">Has results</option>
          <option value="false">No results</option>
        </select>
      </div>

      {/* Outcome keyword expansion */}
      <div style={{
        marginTop: '1rem',
        padding: '0.75rem',
        background: '#f8f9fa',
        borderRadius: 6,
        border: '1px solid #e9ecef',
      }}>
        <strong style={{ fontSize: '0.8rem', color: '#555', display: 'block', marginBottom: 6 }}>
          Outcome Keyword Expansion
        </strong>
        <p style={{ fontSize: '0.75rem', color: '#888', margin: '0 0 8px' }}>
          Enter an outcome term and click Expand to find all related variations (e.g., &quot;PFS&quot; expands to &quot;progression-free survival&quot;, &quot;time to progression&quot;, etc.)
        </p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <AutocompleteInput
            placeholder="e.g., response rate, PFS, overall survival, adverse events..."
            value={outcomeInput}
            onChange={setOutcomeInput}
            field="outcomes"
            onKeyDown={(e) => { if (e.key === 'Enter') handleExpandOutcomes(); }}
            style={{ fontSize: '0.8rem' }}
          />
          <button
            onClick={handleExpandOutcomes}
            disabled={expanding || !outcomeInput.trim()}
            style={{
              padding: '0.4rem 1.2rem',
              background: expanding ? '#6c757d' : '#17a2b8',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: expanding ? 'default' : 'pointer',
              fontSize: '0.8rem',
              whiteSpace: 'nowrap',
            }}
          >
            {expanding ? 'Expanding...' : 'Expand'}
          </button>
        </div>

        {/* Expanded terms display */}
        {expandedOutcomes.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 6 }}>
              <span style={{ fontSize: '0.75rem', color: '#555' }}>
                Expanded from <strong>&quot;{expandOriginal}&quot;</strong> — {selectedOutcomes.size} of {expandedOutcomes.length} selected
              </span>
              <button
                onClick={selectAllOutcomes}
                style={{ fontSize: '0.7rem', color: '#007bff', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
              >
                Select all
              </button>
              <button
                onClick={deselectAllOutcomes}
                style={{ fontSize: '0.7rem', color: '#dc3545', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
              >
                Deselect all
              </button>
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {expandedOutcomes.map((term) => {
                const isSelected = selectedOutcomes.has(term);
                return (
                  <button
                    key={term}
                    onClick={() => toggleOutcome(term)}
                    style={{
                      padding: '3px 10px',
                      borderRadius: 12,
                      border: isSelected ? '1px solid #17a2b8' : '1px solid #ccc',
                      background: isSelected ? '#d1ecf1' : '#fff',
                      color: isSelected ? '#0c5460' : '#666',
                      fontSize: '0.75rem',
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

      {/* Action buttons */}
      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={handleApply}
          style={{
            padding: '0.5rem 1.5rem',
            background: '#007bff',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: '0.85rem',
          }}
        >
          Apply Filters
        </button>
        <button
          onClick={handleClear}
          style={{
            padding: '0.5rem 1.5rem',
            background: '#6c757d',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: '0.85rem',
          }}
        >
          Clear All
        </button>
      </div>
    </div>
  );
}
