import { useMOACategories, useMOAInterventions, useLookupDrugMOA, useClassifyMOA } from '../hooks/useApi';
import PlotContainer from '../components/PlotContainer';
import AutocompleteInput from '../components/AutocompleteInput';
import { usePersistentState } from '../hooks/usePersistentState';
import type { MOACategoryItem } from '../types';
import { InterpretBox, InlineHelp } from '../components/Interpretation';

const MOA_FILTERS_INITIAL = { broad: '', moa: '', interventions: '', trials: '' };

export default function MOAOverview() {
  const { data: categories, isLoading, refetch } = useMOACategories();
  const [selectedRowKey, setSelectedRowKey, resetSelectedRowKey] = usePersistentState<string>('moa_selected_row_key', '');
  const [filters, setFilters, resetFilters] = usePersistentState<{ broad: string; moa: string; interventions: string; trials: string }>('moa_filters', MOA_FILTERS_INITIAL);
  // Derive the broad category from the selected row key for the API call (MOA Category column)
  const selectedCategory = selectedRowKey ? selectedRowKey.split('::')[1] : '';
  const { data: interventions, isLoading: ivsLoading } = useMOAInterventions(selectedCategory);

  // Drug lookup
  const [lookupName, setLookupName, resetLookupName] = usePersistentState<string>('moa_lookup_name', '');
  const lookupMutation = useLookupDrugMOA();

  const handleReset = () => {
    resetSelectedRowKey();
    resetFilters();
    resetLookupName();
  };

  // Classify trigger
  const classifyMutation = useClassifyMOA();

  const handleLookup = () => {
    if (lookupName.trim()) {
      lookupMutation.mutate(lookupName.trim());
    }
  };

  const handleClassify = (force: boolean) => {
    classifyMutation.mutate(force, {
      onSuccess: () => refetch(),
    });
  };

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>MOA Overview</h1>

      <InterpretBox id="moa-overview-intro" title="How to read this page">
        <p style={{ margin: '0 0 0.5rem' }}>
          Each trial intervention (drug, combination, device) is mapped to a
          mechanism-of-action (MOA) via Open Targets / ChEMBL. MOAs are grouped
          hierarchically: a <em>long-form</em> description (e.g., "Epidermal growth
          factor receptor (EGFR) inhibitor") is condensed to a <em>short form</em>{' '}
          ("EGFR inhibitor") and rolled up into a <em>broad category</em> ("Kinase
          inhibitor"). Grouping lets downstream pages (simulation, TAM, screening)
          aggregate across similar drugs.
        </p>
        <ul style={{ margin: '0.25rem 0 0.5rem 1.1rem', padding: 0 }}>
          <li>
            <strong>Drug MOA Lookup</strong> — queries Open Targets live for any drug
            name. Useful for spot-checking a single intervention without running a
            full re-classification.
          </li>
          <li>
            <strong>Classify New Interventions</strong> — processes only interventions
            without existing MOA annotations. <strong>Re-classify All</strong> wipes
            and rebuilds annotations (use after ontology updates).
          </li>
          <li>
            <strong>Distribution chart</strong> — trial count per MOA category. Tall
            bars indicate well-studied mechanisms in the corpus; thin tail reveals
            rare/novel MOAs where data is sparse.
          </li>
          <li>
            <strong>Categories table</strong> — filterable by broad category, MOA,
            minimum intervention count, or minimum trial count. Click <em>View</em>{' '}
            on any row to inspect the underlying interventions, their long-form
            descriptions, target genes, and data source (Open Targets vs fallback).
          </li>
        </ul>
        <p style={{ margin: '0.4rem 0 0', fontSize: '0.78rem', color: '#555' }}>
          <strong>Caveat:</strong> Non-drug interventions (radiation, surgery, device)
          are tagged <code>NON_DRUG</code> with a subtype from the CT.gov
          <code>intervention_type</code> field; they are excluded from most downstream
          biomarker analyses.
        </p>
      </InterpretBox>

      {/* Drug Lookup Tool */}
      <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Drug MOA Lookup (Open Targets)</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <AutocompleteInput
            placeholder="Enter drug name (e.g., Erlotinib, Pamiparib)"
            value={lookupName}
            onChange={setLookupName}
            field="interventions"
            onKeyDown={(e) => { if (e.key === 'Enter') handleLookup(); }}
            style={{ padding: '0.5rem', fontSize: '0.9rem' }}
          />
          <button
            onClick={handleLookup}
            disabled={lookupMutation.isPending || !lookupName.trim()}
            style={{
              padding: '0.5rem 1rem', background: '#1976d2', color: '#fff',
              border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem',
            }}
          >
            {lookupMutation.isPending ? 'Looking up...' : 'Lookup'}
          </button>
        </div>

        {lookupMutation.data && (
          <div style={{ background: '#f5f5f5', borderRadius: 6, padding: '0.75rem', fontSize: '0.85rem' }}>
            <div style={{ marginBottom: 4 }}>
              <strong>{lookupMutation.data.drug_name}</strong>
              {lookupMutation.data.chembl_id && (
                <span style={{ color: '#666', marginLeft: 8 }}>({lookupMutation.data.chembl_id})</span>
              )}
            </div>
            {lookupMutation.data.mechanisms.length === 0 ? (
              <div style={{ color: '#999' }}>No mechanisms found in Open Targets</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #ddd' }}>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: '0.8rem', color: '#666' }}>Long Form</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: '0.8rem', color: '#666' }}>Short Form</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: '0.8rem', color: '#666' }}>Broad Category</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: '0.8rem', color: '#666' }}>Gene Symbols</th>
                  </tr>
                </thead>
                <tbody>
                  {lookupMutation.data.mechanisms.map((m, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '4px 8px' }}>{m.long_form}</td>
                      <td style={{ padding: '4px 8px', fontWeight: 600, color: '#1976d2' }}>{m.short_form}</td>
                      <td style={{ padding: '4px 8px' }}>
                        <span style={{
                          background: '#e3f2fd', color: '#1565c0', padding: '2px 8px',
                          borderRadius: 10, fontSize: '0.78rem', fontWeight: 500,
                        }}>
                          {m.broad_category}
                        </span>
                      </td>
                      <td style={{ padding: '4px 8px', fontSize: '0.8rem', color: '#666' }}>
                        {m.gene_symbols.join(', ') || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Classification Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
        <button
          onClick={() => handleClassify(false)}
          disabled={classifyMutation.isPending}
          style={{
            padding: '0.5rem 1rem', background: '#388e3c', color: '#fff',
            border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem',
          }}
        >
          {classifyMutation.isPending ? 'Classifying...' : 'Classify New Interventions'}
        </button>
        <button
          onClick={() => handleClassify(true)}
          disabled={classifyMutation.isPending}
          style={{
            padding: '0.5rem 1rem', background: '#f57c00', color: '#fff',
            border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem',
          }}
        >
          Re-classify All
        </button>
        {classifyMutation.data && (
          <span style={{ fontSize: '0.85rem', color: '#666', alignSelf: 'center' }}>
            Classified: {classifyMutation.data.classified}, Skipped: {classifyMutation.data.skipped}, Failed: {classifyMutation.data.failed}
          </span>
        )}
        <button
          onClick={handleReset}
          style={{
            padding: '0.5rem 1rem', background: '#6c757d', color: '#fff',
            border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem',
            marginLeft: 'auto',
          }}
        >
          Reset
        </button>
      </div>

      <PlotContainer plotType="moa_distribution" title="Mechanism of Action Distribution" />

      {/* Category Table */}
      <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginTop: '1rem' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>MOA Categories</h3>
        {isLoading && <div>Loading...</div>}
        {categories && (() => {
          const fl = filters.broad.toLowerCase();
          const fm = filters.moa.toLowerCase();
          const fi = filters.interventions;
          const ft = filters.trials;
          const filtered = categories.filter((cat: MOACategoryItem) => {
            if (fl && !cat.moa_category.toLowerCase().includes(fl)) return false;
            if (fm && !cat.moa_broad_category.toLowerCase().includes(fm)) return false;
            if (fi && cat.intervention_count < Number(fi)) return false;
            if (ft && cat.trial_count < Number(ft)) return false;
            return true;
          });
          const filterInputStyle: React.CSSProperties = {
            width: '100%', padding: '3px 6px', fontSize: '0.78rem',
            border: '1px solid #ddd', borderRadius: 3, boxSizing: 'border-box',
            outline: 'none',
          };
          return (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: '0.78rem', color: '#888' }}>
                Showing {filtered.length} of {categories.length} categories
              </span>
              {(filters.broad || filters.moa || filters.interventions || filters.trials) && (
                <button
                  onClick={resetFilters}
                  style={{
                    padding: '2px 8px', fontSize: '0.75rem', background: 'transparent',
                    border: '1px solid #999', color: '#666', borderRadius: 3, cursor: 'pointer',
                  }}
                >
                  Clear Filters
                </button>
              )}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid #ddd' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      Broad Category
                      <InlineHelp
                        size={11}
                        text="Condensed MOA label (e.g., 'EGFR inhibitor'). Used as the pivot for simulation, TAM, and screening pages."
                      />
                    </span>
                  </th>
                  <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid #ddd' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      MOA Category
                      <InlineHelp
                        size={11}
                        text="Top-level roll-up (e.g., 'Kinase inhibitor'). Multiple Broad Categories may share the same MOA Category."
                      />
                    </span>
                  </th>
                  <th style={{ textAlign: 'right', padding: '0.5rem', borderBottom: '2px solid #ddd' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                      Interventions
                      <InlineHelp
                        size={11}
                        text="Distinct drug/combination records mapped to this category."
                      />
                    </span>
                  </th>
                  <th style={{ textAlign: 'right', padding: '0.5rem', borderBottom: '2px solid #ddd' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                      Trials
                      <InlineHelp
                        size={11}
                        text="Distinct trials that include at least one intervention in this category."
                      />
                    </span>
                  </th>
                  <th style={{ textAlign: 'center', padding: '0.5rem', borderBottom: '2px solid #ddd' }}>Details</th>
                </tr>
                <tr>
                  <th style={{ padding: '4px 0.5rem' }}>
                    <input
                      type="text" placeholder="Filter..."
                      value={filters.broad}
                      onChange={(e) => setFilters((f) => ({ ...f, broad: e.target.value }))}
                      style={filterInputStyle}
                    />
                  </th>
                  <th style={{ padding: '4px 0.5rem' }}>
                    <input
                      type="text" placeholder="Filter..."
                      value={filters.moa}
                      onChange={(e) => setFilters((f) => ({ ...f, moa: e.target.value }))}
                      style={filterInputStyle}
                    />
                  </th>
                  <th style={{ padding: '4px 0.5rem' }}>
                    <input
                      type="number" placeholder="Min"
                      value={filters.interventions}
                      onChange={(e) => setFilters((f) => ({ ...f, interventions: e.target.value }))}
                      style={{ ...filterInputStyle, textAlign: 'right' }}
                    />
                  </th>
                  <th style={{ padding: '4px 0.5rem' }}>
                    <input
                      type="number" placeholder="Min"
                      value={filters.trials}
                      onChange={(e) => setFilters((f) => ({ ...f, trials: e.target.value }))}
                      style={{ ...filterInputStyle, textAlign: 'right' }}
                    />
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((cat: MOACategoryItem) => {
                  const rowKey = `${cat.moa_category}::${cat.moa_broad_category}`;
                  return (
                  <tr key={rowKey} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '0.4rem 0.5rem', fontWeight: 500 }}>{cat.moa_category}</td>
                    <td style={{ padding: '0.4rem 0.5rem' }}>
                      {cat.moa_broad_category ? (
                        <span style={{
                          background: '#e3f2fd', color: '#1565c0', padding: '2px 8px',
                          borderRadius: 10, fontSize: '0.78rem', fontWeight: 500,
                        }}>
                          {cat.moa_broad_category}
                        </span>
                      ) : '-'}
                    </td>
                    <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{cat.intervention_count}</td>
                    <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{cat.trial_count}</td>
                    <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                      <button
                        onClick={() => setSelectedRowKey(
                          selectedRowKey === rowKey ? '' : rowKey
                        )}
                        style={{
                          padding: '2px 10px', fontSize: '0.78rem', background: 'transparent',
                          border: '1px solid #1976d2', color: '#1976d2', borderRadius: 4,
                          cursor: 'pointer',
                        }}
                      >
                        {selectedRowKey === rowKey ? 'Hide' : 'View'}
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </>
          );
        })()}
      </div>

      {/* Intervention Details Panel */}
      {selectedRowKey && (
        <div style={{ background: '#fff', border: '1px solid #1976d2', borderRadius: 8, padding: '1rem', marginTop: '1rem' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#1976d2' }}>
            Interventions — {selectedCategory}
          </h3>
          {ivsLoading && <div>Loading interventions...</div>}
          {interventions && interventions.length === 0 && <div style={{ color: '#999' }}>No interventions found.</div>}
          {interventions && interventions.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid #ddd' }}>Drug</th>
                  <th style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid #ddd' }}>MOA (Long Form)</th>
                  <th style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid #ddd' }}>Short Form</th>
                  <th style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid #ddd' }}>Broad</th>
                  <th style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid #ddd' }}>Genes</th>
                  <th style={{ textAlign: 'left', padding: '0.4rem', borderBottom: '2px solid #ddd' }}>Source</th>
                </tr>
              </thead>
              <tbody>
                {interventions.map((iv, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '0.3rem 0.4rem', fontWeight: 600 }}>{iv.intervention_name}</td>
                    <td title={iv.mechanism_description || ''} style={{ padding: '0.3rem 0.4rem', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {iv.mechanism_description || '-'}
                    </td>
                    <td style={{ padding: '0.3rem 0.4rem', fontWeight: 600, color: '#1976d2' }}>
                      {iv.moa_short_form || '-'}
                    </td>
                    <td style={{ padding: '0.3rem 0.4rem' }}>
                      {iv.moa_broad_category ? (
                        <span style={{
                          background: '#e8f5e9', color: '#2e7d32', padding: '2px 6px',
                          borderRadius: 8, fontSize: '0.75rem',
                        }}>
                          {iv.moa_broad_category}
                        </span>
                      ) : '-'}
                    </td>
                    <td style={{ padding: '0.3rem 0.4rem', fontSize: '0.8rem', color: '#666' }}>
                      {iv.gene_symbols.join(', ') || '-'}
                    </td>
                    <td style={{ padding: '0.3rem 0.4rem' }}>
                      <span style={{
                        fontSize: '0.72rem', padding: '1px 6px', borderRadius: 4,
                        background: iv.data_source === 'open_targets' ? '#e8f5e9' : '#fff3e0',
                        color: iv.data_source === 'open_targets' ? '#2e7d32' : '#e65100',
                      }}>
                        {iv.data_source || 'unknown'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
