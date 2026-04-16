/* eslint-disable @typescript-eslint/no-explicit-any --
 * TCGA API payloads (cohort, DCNA, expression, scatter, heatmap) are
 * dynamic shapes that aren't fully typed in frontend/src/types yet.
 * Plotly layout objects here also use `any` for the same reason as
 * Simulation.tsx. Proper types tracked for v1.1.
 */
/* eslint-disable react-hooks/exhaustive-deps --
 * Effects intentionally omit setState updaters (stable by React
 * contract) and computed props. Tracked for v1.1.
 */
import { useState, useEffect, useRef } from 'react';
import { useTCGASummary, useDCNADetail, useExpressionDetail, usePatientProfile } from '../hooks/useApi';
import {
  fetchTCGADrugs,
  fetchTCGAGenes,
  fetchScatterData,
  fetchDrugTargets,
  fetchExpressionHeatmap,
} from '../services/api';
import { usePersistentState, clearPersistentKeys } from '../hooks/usePersistentState';
import { Metric, InterpretBox, InlineHelp } from '../components/Interpretation';
import { withProvenance, provenanceImageFilename } from '../utils/provenance';

const tabResetBtnStyle: React.CSSProperties = {
  padding: '0.3rem 0.9rem',
  background: '#6c757d',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: '0.78rem',
};
import Plotly from 'plotly.js/dist/plotly.min.js';

export default function TCGACohort() {
  const { data: summary, isLoading } = useTCGASummary();
  const [activeTab, setActiveTab, resetActiveTab] = usePersistentState<'dcna' | 'expression' | 'scatter' | 'patient'>(
    'tcga_cohort_active_tab',
    'dcna',
  );
  const [dcnaNonce, setDcnaNonce] = useState(0);
  const [exprNonce, setExprNonce] = useState(0);
  const [scatterNonce, setScatterNonce] = useState(0);
  const [patientNonce, setPatientNonce] = useState(0);

  const resetDcna = () => {
    clearPersistentKeys('tcga_cohort_dcna_drug');
    setDcnaNonce((n) => n + 1);
  };
  const resetExpr = () => {
    clearPersistentKeys('tcga_cohort_expression_gene');
    setExprNonce((n) => n + 1);
  };
  const resetScatter = () => {
    clearPersistentKeys('tcga_cohort_scatter_drug', 'tcga_cohort_scatter_gene');
    setScatterNonce((n) => n + 1);
  };
  const resetPatient = () => {
    clearPersistentKeys('tcga_cohort_patient_id');
    setPatientNonce((n) => n + 1);
  };

  const handleResetAll = () => {
    resetActiveTab();
    resetDcna();
    resetExpr();
    resetScatter();
    resetPatient();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>TCGA-GBM Cohort Explorer</h1>
        <button
          onClick={handleResetAll}
          style={{
            padding: '0.4rem 1.2rem',
            background: '#6c757d',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: '0.85rem',
          }}
        >
          Reset All
        </button>
      </div>
      <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '1rem' }}>
        Explore Drug Constrained Network Activity (DCNA) and normalized gene expression across the TCGA-GBM cohort.
      </p>

      <InterpretBox id="tcga-intro" title="How to read this page">
        <p style={{ margin: '0 0 0.5rem' }}>
          This page lets you inspect every molecular signal we use downstream to simulate trials. Each tab answers one
          question:
        </p>
        <ul style={{ margin: '0 0 0.5rem 1.1rem', padding: 0 }}>
          <li>
            <strong>DCNA by Drug</strong> — "how sensitive is each patient to this drug?" A per-patient score built from
            the drug's target gene set. Higher = more sensitive.
          </li>
          <li>
            <strong>Gene Expression</strong> — "how much of this gene's mRNA does each patient make?" Raw normalized
            expression; use the heatmap for relative z-scores across the cohort.
          </li>
          <li>
            <strong>DCNA vs Expression</strong> — scatter plot to check whether a drug's DCNA really tracks its target
            gene's expression (expected: positive correlation for agonists, negative for inhibitors).
          </li>
          <li>
            <strong>Patient Profile</strong> — per-patient leaderboard of top DCNA hits and highest-expressed genes.
          </li>
        </ul>
        <p style={{ margin: '0 0 0.25rem' }}>
          <strong>Reading distributions.</strong> DCNA is roughly <em>−1 to +1</em>; expression in the heatmap is shown
          as
          <em> z-score</em> (red = above cohort mean, blue = below). One patient's z = 0 means "average for this
          cohort", not "average expression" in absolute terms.
        </p>
        <p style={{ margin: '0.3rem 0 0', color: '#555', fontSize: '0.8rem' }}>
          Tip: compare two drugs by opening the DCNA tab for each — if their target gene sets overlap heavily, DCNA
          profiles will look very similar.
        </p>
      </InterpretBox>

      {isLoading && <div>Loading cohort data...</div>}
      {summary && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '1rem',
              marginBottom: '1.5rem',
            }}
          >
            <Metric
              label="Patients"
              value={summary.patient_count.toLocaleString()}
              hint="TCGA-GBM cohort size"
              tooltip="Number of TCGA glioblastoma patients with both DCNA and expression data available. Every per-drug and per-gene view below draws from this same fixed cohort."
            />
            <Metric
              label="Drugs (DCNA)"
              value={summary.drug_count.toLocaleString()}
              hint="Drugs with per-patient DCNA scores"
              tooltip="Count of drugs for which DCNA has been precomputed for every patient. Drugs sharing the same target set produce identical DCNA profiles."
            />
            <Metric
              label="Genes"
              value={summary.gene_count.toLocaleString()}
              hint="Genes in expression matrix"
              tooltip="Number of protein-coding genes retained after filtering the TCGA expression matrix. Only genes present here can appear in the scatter plot or heatmaps."
            />
          </div>

          <div style={{ display: 'flex', gap: 0, marginBottom: '1rem' }}>
            {(['dcna', 'expression', 'scatter', 'patient'] as const).map((tab, idx, arr) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '8px 20px',
                  fontSize: '0.85rem',
                  fontWeight: activeTab === tab ? 600 : 400,
                  background: activeTab === tab ? '#1a1a2e' : '#e8e8e8',
                  color: activeTab === tab ? '#00d4ff' : '#555',
                  border: 'none',
                  cursor: 'pointer',
                  borderRadius: idx === 0 ? '6px 0 0 6px' : idx === arr.length - 1 ? '0 6px 6px 0' : 0,
                }}
              >
                {tab === 'dcna'
                  ? 'DCNA by Drug'
                  : tab === 'expression'
                    ? 'Gene Expression'
                    : tab === 'scatter'
                      ? 'DCNA vs Expression'
                      : 'Patient Profile'}
              </button>
            ))}
          </div>

          <div style={{ display: activeTab === 'dcna' ? 'block' : 'none' }}>
            <DCNATab key={`dcna-${dcnaNonce}`} patients={summary.patients} onReset={resetDcna} />
          </div>
          <div style={{ display: activeTab === 'expression' ? 'block' : 'none' }}>
            <ExpressionTab key={`expr-${exprNonce}`} patients={summary.patients} onReset={resetExpr} />
          </div>
          <div style={{ display: activeTab === 'scatter' ? 'block' : 'none' }}>
            <ScatterTab key={`scatter-${scatterNonce}`} onReset={resetScatter} />
          </div>
          <div style={{ display: activeTab === 'patient' ? 'block' : 'none' }}>
            <PatientTab key={`patient-${patientNonce}`} patients={summary.patients} onReset={resetPatient} />
          </div>
        </>
      )}
    </div>
  );
}

// --- Autocomplete search input ---
function SearchInput({
  placeholder,
  fetchSuggestions,
  onSelect,
}: {
  placeholder: string;
  fetchSuggestions: (q: string) => Promise<string[]>;
  onSelect: (val: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const results = await fetchSuggestions(query);
      setSuggestions(results);
      setShowDropdown(true);
      setHighlight(-1);
    }, 250);
  }, [query]);

  const select = (val: string) => {
    setQuery(val);
    setShowDropdown(false);
    onSelect(val);
  };

  return (
    <div style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
        onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
            e.preventDefault();
          } else if (e.key === 'ArrowUp') {
            setHighlight((h) => Math.max(h - 1, 0));
            e.preventDefault();
          } else if (e.key === 'Enter') {
            if (highlight >= 0 && highlight < suggestions.length) select(suggestions[highlight]);
            else if (query.trim()) onSelect(query.trim());
          }
        }}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '8px 12px',
          fontSize: '0.85rem',
          border: '1px solid #ccc',
          borderRadius: 6,
          boxSizing: 'border-box',
        }}
      />
      {showDropdown && suggestions.length > 0 && (
        <ul
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 100,
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: '0 0 6px 6px',
            listStyle: 'none',
            padding: 0,
            margin: 0,
            maxHeight: 220,
            overflowY: 'auto',
            boxShadow: '0 4px 8px rgba(0,0,0,0.12)',
          }}
        >
          {suggestions.map((s, i) => (
            <li
              key={s}
              title={s}
              onMouseDown={(e) => {
                e.preventDefault();
                select(s);
              }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                padding: '6px 12px',
                fontSize: '0.82rem',
                cursor: 'pointer',
                background: i === highlight ? '#e8f4fd' : '#fff',
                color: '#333',
                borderBottom: i < suggestions.length - 1 ? '1px solid #f0f0f0' : 'none',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Distribution bar chart helper ---
function DistributionChart({
  values,
  label,
  color,
}: {
  values: { patient: string; value: number }[];
  label: string;
  color: string;
}) {
  if (!values || values.length === 0) return null;

  // Build histogram data
  const vals = values.map((v) => v.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const binCount = 40;
  const binWidth = (max - min) / binCount || 1;
  const bins = Array(binCount).fill(0);
  vals.forEach((v) => {
    const idx = Math.min(Math.floor((v - min) / binWidth), binCount - 1);
    bins[idx]++;
  });
  const maxBin = Math.max(...bins);

  return (
    <div style={{ margin: '12px 0' }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#555', marginBottom: 4 }}>
        {label} Distribution ({values.length} patients)
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', height: 100, gap: 1 }}>
        {bins.map((count, i) => (
          <div
            key={i}
            title={`${(min + i * binWidth).toFixed(2)} to ${(min + (i + 1) * binWidth).toFixed(2)}: ${count} patients`}
            style={{
              flex: 1,
              height: maxBin > 0 ? `${(count / maxBin) * 100}%` : 0,
              background: color,
              borderRadius: '2px 2px 0 0',
              minHeight: count > 0 ? 2 : 0,
            }}
          />
        ))}
      </div>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#999', marginTop: 2 }}
      >
        <span>{min.toFixed(2)}</span>
        <span>{max.toFixed(2)}</span>
      </div>
    </div>
  );
}

// --- Stats display ---
const STAT_TOOLTIPS: Record<string, string> = {
  mean: 'Average value across all patients in the cohort.',
  median: 'Middle value; half the cohort is below this, half above. More robust to outliers than the mean.',
  stdev: 'Standard deviation — a measure of spread. Larger values mean the cohort varies more widely across patients.',
  min: 'Smallest value in the cohort — the patient with the lowest score.',
  max: 'Largest value in the cohort — the patient with the highest score.',
};

function StatsRow({ stats }: { stats: { mean: number; median: number; stdev: number; min: number; max: number } }) {
  return (
    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', margin: '8px 0', alignItems: 'center' }}>
      {Object.entries(stats).map(([k, v]) => (
        <div key={k} style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#888', textTransform: 'capitalize' }}>{k}: </span>
          <span style={{ fontWeight: 600 }}>{v.toFixed(4)}</span>
          {STAT_TOOLTIPS[k] && <InlineHelp text={STAT_TOOLTIPS[k]} size={12} />}
        </div>
      ))}
    </div>
  );
}

// --- Ranked table ---
function RankedTable({
  rows,
  columns,
  maxRows = 50,
}: {
  rows: Record<string, any>[];
  columns: { key: string; label: string; align?: string; format?: (v: any) => string }[];
  maxRows?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const displayed = showAll ? rows : rows.slice(0, maxRows);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead>
          <tr style={{ background: '#f8f9fa' }}>
            <th style={{ padding: '5px 8px', textAlign: 'left', borderBottom: '2px solid #ddd', fontWeight: 600 }}>
              #
            </th>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{
                  padding: '5px 8px',
                  textAlign: (c.align || 'left') as any,
                  borderBottom: '2px solid #ddd',
                  fontWeight: 600,
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayed.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '4px 8px', color: '#999', fontSize: '0.72rem' }}>{i + 1}</td>
              {columns.map((c) => (
                <td key={c.key} style={{ padding: '4px 8px', textAlign: (c.align || 'left') as any }}>
                  {c.format ? c.format(row[c.key]) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > maxRows && (
        <button
          onClick={() => setShowAll(!showAll)}
          style={{
            marginTop: 6,
            fontSize: '0.78rem',
            color: '#007bff',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          {showAll ? `Show top ${maxRows}` : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

// --- Expression Heatmap (z-score differential expression) ---
function ExpressionHeatmap({
  genes,
  includeAverage,
  title,
}: {
  genes: string[];
  includeAverage?: boolean;
  title?: string;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchExpressionHeatmap>> | null>(null);
  const [loading, setLoading] = useState(false);
  const plotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!genes || genes.length === 0) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchExpressionHeatmap(genes, includeAverage || false)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setData({ error: 'Failed to load heatmap' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [genes.join(','), includeAverage]);

  useEffect(() => {
    if (!data || !data.zscores || !plotRef.current) return;
    // `zmid` is a valid Plotly heatmap prop but missing from plotly.js types;
    // widen to `any` locally so the z-scale stays anchored at 0 (diverging).
    const trace: any = {
      z: data.zscores,
      x: data.patients,
      y: data.genes,
      type: 'heatmap' as const,
      colorscale: [
        [0, '#1565c0'],
        [0.25, '#64b5f6'],
        [0.5, '#ffffff'],
        [0.75, '#ef5350'],
        [1, '#b71c1c'],
      ],
      zmid: 0,
      zmin: -3,
      zmax: 3,
      colorbar: { title: { text: 'z-score' }, thickness: 12, len: 0.9 },
      hovertemplate: '<b>%{y}</b><br>Patient: %{x}<br>z-score: %{z:.2f}<extra></extra>',
    };
    const rowCount = data.genes?.length || 1;
    const layout: Partial<Plotly.Layout> = {
      height: Math.max(180, 40 + rowCount * 22),
      margin: { l: 140, r: 40, t: 20, b: 50 },
      xaxis: {
        showticklabels: false,
        title: {
          text: `Patients sorted by ${includeAverage ? 'target-avg' : 'mean'} z-score (n=${data.patients?.length || 0})`,
        },
      },
      yaxis: { automargin: true, tickfont: { size: 10 } },
    };
    Plotly.newPlot(plotRef.current, [trace], withProvenance(layout, '/tcga/summary'), {
      responsive: true,
      displayModeBar: false,
    });
    return () => {
      if (plotRef.current) Plotly.purge(plotRef.current);
    };
  }, [data]);

  if (loading) {
    return <div style={{ fontSize: '0.78rem', color: '#888', marginTop: 8 }}>Loading expression heatmap...</div>;
  }
  if (!data || data.error) {
    if (data?.error) return <div style={{ fontSize: '0.78rem', color: '#c62828', marginTop: 8 }}>{data.error}</div>;
    return null;
  }
  if (!data.zscores || data.zscores.length === 0) return null;
  return (
    <div
      style={{ marginTop: 14, padding: '8px 10px', background: '#fafafa', border: '1px solid #eee', borderRadius: 6 }}
    >
      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#555', marginBottom: 4 }}>
        {title || 'Differential Expression Heatmap (z-score across TCGA cohort)'}
      </div>
      {data.missing && data.missing.length > 0 && (
        <div style={{ fontSize: '0.7rem', color: '#999', marginBottom: 4 }}>
          Not in expression data: {data.missing.join(', ')}
        </div>
      )}
      <div ref={plotRef} style={{ width: '100%' }} />
    </div>
  );
}

// --- DCNA Tab ---
function DCNATab({ patients: _patients, onReset }: { patients: string[]; onReset: () => void }) {
  const [selectedDrug, setSelectedDrug] = usePersistentState<string>('tcga_cohort_dcna_drug', '');
  const { data, isLoading } = useDCNADetail(selectedDrug);
  const [targetGenes, setTargetGenes] = useState<string[]>([]);

  useEffect(() => {
    if (!selectedDrug) {
      setTargetGenes([]);
      return;
    }
    let cancelled = false;
    fetchDrugTargets(selectedDrug)
      .then((res) => {
        if (cancelled) return;
        const genes = (res.targets || []).filter((t) => t.in_expression_data).map((t) => t.gene_symbol);
        setTargetGenes(genes);
      })
      .catch(() => {
        if (!cancelled) setTargetGenes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDrug]);

  return (
    <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Drug Constrained Network Activity (DCNA)</h3>
        <button onClick={onReset} style={tabResetBtnStyle}>
          Reset
        </button>
      </div>
      <p style={{ fontSize: '0.82rem', color: '#666', marginBottom: '0.75rem' }}>
        Search for a drug to see its DCNA values across all patients in the TCGA-GBM cohort.
      </p>
      <InterpretBox id="tcga-dcna-tab" title="How to read DCNA" tone="tip">
        <p style={{ margin: '0 0 0.4rem' }}>
          <strong>DCNA (Drug-Constrained Network Activity)</strong> is a per-patient score derived from the expression
          of a drug's target genes. A higher DCNA means the drug's target pathway is more active in that patient, so we
          expect the patient to be more sensitive to the drug.
        </p>
        <ul style={{ margin: '0 0 0.4rem 1.1rem', padding: 0 }}>
          <li>
            <strong>Scale</strong> — roughly <em>−1 to +1</em>, centered near 0. Values are quantized per drug (step
            sizes like 0.01, 0.1, or 0.5 depending on target-set size).
          </li>
          <li>
            <strong>Distribution</strong> — the histogram shows how DCNA varies across the cohort. Bimodal distributions
            suggest a biomarker-defined split (responders vs non-responders).
          </li>
          <li>
            <strong>Heatmap</strong> — target-gene expression z-scores across the same patients, sorted by average. Use
            it to see which patients drive the high-DCNA tail.
          </li>
          <li>
            <strong>Ranked table</strong> — patients sorted by DCNA. Highest = top candidates for simulated enrollment
            in this drug's arm.
          </li>
        </ul>
        <p style={{ margin: 0, color: '#555', fontSize: '0.8rem' }}>
          Two drugs that share the same gene targets produce identical DCNA profiles — that's by design.
        </p>
      </InterpretBox>
      <SearchInput
        placeholder="Search drugs (e.g., Temozolomide, Bevacizumab)..."
        fetchSuggestions={fetchTCGADrugs}
        onSelect={setSelectedDrug}
      />

      {isLoading && <div style={{ marginTop: 12, color: '#007bff' }}>Loading DCNA data...</div>}
      {data && !data.error && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ margin: '0 0 4px', fontSize: '0.95rem', color: '#1a1a2e' }}>{data.drug}</h4>
          <StatsRow stats={data.stats} />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: targetGenes.length > 0 ? '1fr 1fr' : '1fr',
              gap: '1rem',
              alignItems: 'start',
            }}
          >
            <DistributionChart values={data.values} label="DCNA" color="#4a90d9" />
            {targetGenes.length > 0 && (
              <ExpressionHeatmap
                genes={targetGenes}
                includeAverage
                title={`Target Expression Heatmap — ${selectedDrug} (avg of ${targetGenes.length} gene target${targetGenes.length > 1 ? 's' : ''})`}
              />
            )}
          </div>
          <RankedTable
            rows={data.values}
            columns={[
              { key: 'patient', label: 'Patient ID' },
              { key: 'value', label: 'DCNA Value', align: 'right', format: (v: number) => v.toFixed(4) },
            ]}
          />
        </div>
      )}
      {data?.error && <div style={{ marginTop: 12, color: '#c62828' }}>{data.error}</div>}
    </div>
  );
}

// --- Expression Tab ---
function ExpressionTab({ patients: _patients, onReset }: { patients: string[]; onReset: () => void }) {
  const [selectedGene, setSelectedGene] = usePersistentState<string>('tcga_cohort_expression_gene', '');
  const { data, isLoading } = useExpressionDetail(selectedGene);

  const fetchGeneSuggestions = async (q: string): Promise<string[]> => {
    const genes = await fetchTCGAGenes(q);
    return genes.map((g) => g.symbol || g.ensembl_id);
  };

  return (
    <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Normalized Gene Expression (RSEM)</h3>
        <button onClick={onReset} style={tabResetBtnStyle}>
          Reset
        </button>
      </div>
      <p style={{ fontSize: '0.82rem', color: '#666', marginBottom: '0.75rem' }}>
        Search for a gene to see its normalized expression across all patients.
      </p>
      <InterpretBox id="tcga-expression-tab" title="How to read gene expression" tone="tip">
        <p style={{ margin: '0 0 0.4rem' }}>
          Each patient has one normalized expression value per gene (log-scaled, RSEM-style). Use this to see which
          patients over- or under-express a gene of interest.
        </p>
        <ul style={{ margin: '0 0 0.3rem 1.1rem', padding: 0 }}>
          <li>
            <strong>Histogram</strong> — raw normalized expression values across the cohort.
          </li>
          <li>
            <strong>Heatmap</strong> — the same values rendered as <em>z-scores</em>: red = above cohort mean, blue =
            below. A z of ±1 means roughly 1 standard deviation from the cohort mean.
          </li>
          <li>
            <strong>Ranked table</strong> — patients sorted by absolute expression (not z-score).
          </li>
        </ul>
        <p style={{ margin: 0, color: '#555', fontSize: '0.8rem' }}>
          Expression here is relative to this GBM cohort only — a "low" value does not mean the gene is truly silent,
          just that it's low relative to other GBM patients.
        </p>
      </InterpretBox>
      <SearchInput
        placeholder="Search genes (e.g., EGFR, TP53, IDH1)..."
        fetchSuggestions={fetchGeneSuggestions}
        onSelect={setSelectedGene}
      />

      {isLoading && <div style={{ marginTop: 12, color: '#007bff' }}>Loading expression data...</div>}
      {data && !data.error && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ margin: '0 0 4px', fontSize: '0.95rem', color: '#1a1a2e' }}>
            {data.gene}
            {data.ensembl_id && (
              <span style={{ fontSize: '0.78rem', color: '#888', marginLeft: 8 }}>{data.ensembl_id}</span>
            )}
          </h4>
          <StatsRow stats={data.stats} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'start' }}>
            <DistributionChart values={data.values} label="Expression" color="#2e7d32" />
            <ExpressionHeatmap genes={[data.gene]} title={`Differential Expression Heatmap — ${data.gene}`} />
          </div>
          <RankedTable
            rows={data.values}
            columns={[
              { key: 'patient', label: 'Patient ID' },
              { key: 'value', label: 'Expression', align: 'right', format: (v: number) => v.toFixed(4) },
            ]}
          />
        </div>
      )}
      {data?.error && <div style={{ marginTop: 12, color: '#c62828' }}>{data.error}</div>}
    </div>
  );
}

// --- Scatter Tab ---
function ScatterTab({ onReset }: { onReset: () => void }) {
  const [selectedDrug, setSelectedDrug] = usePersistentState<string>('tcga_cohort_scatter_drug', '');
  const [selectedGene, setSelectedGene] = usePersistentState<string>('tcga_cohort_scatter_gene', '');
  const [scatterData, setScatterData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const plotRef = useRef<HTMLDivElement>(null);
  const [drugTargets, setDrugTargets] = useState<
    { gene_symbol: string; action_type: string; in_expression_data: boolean }[]
  >([]);
  const [targetsLoading, setTargetsLoading] = useState(false);

  // Fetch drug targets when a drug is selected
  useEffect(() => {
    if (!selectedDrug) {
      setDrugTargets([]);
      return;
    }
    let cancelled = false;
    setTargetsLoading(true);
    fetchDrugTargets(selectedDrug)
      .then((result) => {
        if (!cancelled) {
          setDrugTargets(result.targets || []);
          setTargetsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDrugTargets([]);
          setTargetsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDrug]);

  const fetchGeneSuggestions = async (q: string): Promise<string[]> => {
    const genes = await fetchTCGAGenes(q);
    return genes.map((g) => g.symbol || g.ensembl_id);
  };

  const handleGenerate = async () => {
    if (!selectedDrug || !selectedGene) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchScatterData(selectedDrug, selectedGene);
      if (data.error) {
        setError(data.error);
        setScatterData(null);
      } else {
        setScatterData(data);
      }
    } catch {
      setError('Failed to fetch scatter data.');
      setScatterData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleTargetClick = (geneSymbol: string) => {
    setSelectedGene(geneSymbol);
  };

  const handleAverageClick = () => {
    const availableTargets = drugTargets.filter((t) => t.in_expression_data).map((t) => t.gene_symbol);
    if (availableTargets.length > 0) {
      setSelectedGene(`AVG_TARGETS:${availableTargets.join(',')}`);
    }
  };

  useEffect(() => {
    if (!scatterData || !plotRef.current) return;

    const xs = scatterData.points.map((p: any) => p.dcna);
    const ys = scatterData.points.map((p: any) => p.expression);
    const text = scatterData.points.map((p: any) => p.patient);

    const trace: Partial<Plotly.PlotData> = {
      x: xs,
      y: ys,
      text,
      mode: 'markers' as const,
      type: 'scatter' as const,
      marker: {
        size: 5,
        color: '#4a90d9',
        opacity: 0.6,
      },
      hovertemplate: '<b>%{text}</b><br>DCNA: %{x:.4f}<br>Expression: %{y:.4f}<extra></extra>',
    };

    // Trend line via simple linear regression
    const n = xs.length;
    const meanX = xs.reduce((a: number, b: number) => a + b, 0) / n;
    const meanY = ys.reduce((a: number, b: number) => a + b, 0) / n;
    let num = 0,
      den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - meanX) * (ys[i] - meanY);
      den += (xs[i] - meanX) ** 2;
    }
    const slope = den !== 0 ? num / den : 0;
    const intercept = meanY - slope * meanX;
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);

    const trendLine: Partial<Plotly.PlotData> = {
      x: [xMin, xMax],
      y: [slope * xMin + intercept, slope * xMax + intercept],
      mode: 'lines' as const,
      type: 'scatter' as const,
      line: { color: '#c62828', width: 2, dash: 'dash' },
      name: `Trend (r=${scatterData.correlation})`,
      hoverinfo: 'skip' as const,
    };

    const layout: Partial<Plotly.Layout> = {
      xaxis: { title: { text: 'DCNA' }, zeroline: true, zerolinecolor: '#ddd', dtick: 0.1, automargin: true },
      yaxis: { title: { text: 'Gene Expression' }, zeroline: true, zerolinecolor: '#ddd', automargin: true },
      height: 500,
      margin: { l: 60, r: 30, t: 30, b: 60 },
      showlegend: true,
      legend: { x: 0.01, y: 0.99, bgcolor: 'rgba(255,255,255,0.8)', bordercolor: '#ddd', borderwidth: 1 },
      hovermode: 'closest' as const,
    };

    Plotly.newPlot(plotRef.current, [trace, trendLine], withProvenance(layout, '/tcga/scatter'), {
      responsive: true,
      displayModeBar: true,
      modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'],
      toImageButtonOptions: { format: 'svg', filename: provenanceImageFilename('tcga_cohort_scatter'), scale: 4 },
    });

    return () => {
      if (plotRef.current) Plotly.purge(plotRef.current);
    };
  }, [scatterData]);

  const availableTargets = drugTargets.filter((t) => t.in_expression_data);
  const unavailableTargets = drugTargets.filter((t) => !t.in_expression_data);

  return (
    <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>DCNA vs Gene Expression</h3>
        <button onClick={onReset} style={tabResetBtnStyle}>
          Reset
        </button>
      </div>
      <p style={{ fontSize: '0.82rem', color: '#666', marginBottom: '0.75rem' }}>
        Select a drug and a gene to generate a scatter plot of DCNA (x-axis) vs normalized expression (y-axis) across
        all patients.
      </p>
      <InterpretBox id="tcga-scatter-tab" title="How to read the scatter plot" tone="tip">
        <p style={{ margin: '0 0 0.4rem' }}>
          Each point is one patient. The <strong>x-axis</strong> is the drug's DCNA for that patient; the
          <strong> y-axis</strong> is that patient's expression of the chosen gene. The dashed red line is a
          least-squares fit, and Pearson <em>r</em> quantifies how tightly DCNA tracks expression.
        </p>
        <ul style={{ margin: '0 0 0.3rem 1.1rem', padding: 0 }}>
          <li>
            <strong>r ≈ 0</strong> — DCNA and this gene's expression are unrelated. Likely an off-target gene.
          </li>
          <li>
            <strong>r &gt; 0.3</strong> — DCNA rises with expression. Consistent with DCNA being driven by this gene
            (typical for targets of agonists / activators).
          </li>
          <li>
            <strong>r &lt; −0.3</strong> — inverse relationship. Consistent with the gene being an inhibitor target
            (high expression → pathway activity → but DCNA is computed from the target set as a whole).
          </li>
        </ul>
        <p style={{ margin: '0 0 0.25rem' }}>
          Use the <em>"Avg of all targets"</em> button to plot DCNA against the mean expression of <strong>all</strong>
          the drug's known targets — the cleanest sanity check that DCNA reflects the drug's target biology.
        </p>
        <p style={{ margin: 0, color: '#555', fontSize: '0.8rem' }}>
          r reported here is the sample Pearson correlation. To see a permutation-based p-value for the correlation, use
          the <em>MOA Correlation</em> page instead.
        </p>
      </InterpretBox>
      <div
        style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '0.5rem' }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>
            Drug (DCNA)
          </label>
          <SearchInput
            placeholder="Search drugs..."
            fetchSuggestions={fetchTCGADrugs}
            onSelect={(val) => {
              setSelectedDrug(val);
              setSelectedGene('');
            }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>
            Gene (Expression)
          </label>
          <SearchInput
            placeholder={selectedGene.startsWith('AVG_TARGETS:') ? selectedGene : 'Search genes...'}
            fetchSuggestions={fetchGeneSuggestions}
            onSelect={setSelectedGene}
          />
          {selectedGene.startsWith('AVG_TARGETS:') && (
            <div style={{ fontSize: '0.72rem', color: '#1565c0', marginTop: 2 }}>
              Using average of: {selectedGene.replace('AVG_TARGETS:', '').split(',').join(', ')}
            </div>
          )}
        </div>
        <button
          onClick={handleGenerate}
          disabled={!selectedDrug || !selectedGene || loading}
          style={{
            padding: '8px 20px',
            fontSize: '0.85rem',
            fontWeight: 600,
            background: !selectedDrug || !selectedGene ? '#ccc' : '#1a1a2e',
            color: !selectedDrug || !selectedGene ? '#888' : '#00d4ff',
            border: 'none',
            borderRadius: 6,
            cursor: !selectedDrug || !selectedGene ? 'not-allowed' : 'pointer',
            height: 38,
          }}
        >
          {loading ? 'Loading...' : 'Generate Plot'}
        </button>
      </div>

      {/* Drug target suggestions */}
      {selectedDrug && (
        <div style={{ marginBottom: '1rem' }}>
          {targetsLoading && <div style={{ fontSize: '0.78rem', color: '#888' }}>Looking up gene targets...</div>}
          {!targetsLoading && drugTargets.length > 0 && (
            <div style={{ fontSize: '0.78rem' }}>
              <span style={{ color: '#555', fontWeight: 600 }}>Known gene targets for {selectedDrug}: </span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {availableTargets.map((t) => (
                  <button
                    key={t.gene_symbol}
                    onClick={() => handleTargetClick(t.gene_symbol)}
                    style={{
                      padding: '3px 10px',
                      fontSize: '0.75rem',
                      borderRadius: 12,
                      border: '1px solid #4a90d9',
                      background: selectedGene === t.gene_symbol ? '#4a90d9' : '#e8f4fd',
                      color: selectedGene === t.gene_symbol ? '#fff' : '#1565c0',
                      cursor: 'pointer',
                    }}
                    title={t.action_type ? `Action: ${t.action_type}` : ''}
                  >
                    {t.gene_symbol}
                    {t.action_type && <span style={{ opacity: 0.7, marginLeft: 4 }}>({t.action_type})</span>}
                  </button>
                ))}
                {availableTargets.length > 1 && (
                  <button
                    onClick={handleAverageClick}
                    style={{
                      padding: '3px 10px',
                      fontSize: '0.75rem',
                      borderRadius: 12,
                      border: '1px solid #7b1fa2',
                      background: selectedGene.startsWith('AVG_TARGETS:') ? '#7b1fa2' : '#f3e5f5',
                      color: selectedGene.startsWith('AVG_TARGETS:') ? '#fff' : '#7b1fa2',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                    title={`Average expression of: ${availableTargets.map((t) => t.gene_symbol).join(', ')}`}
                  >
                    Avg of all targets ({availableTargets.length})
                  </button>
                )}
                {unavailableTargets.length > 0 && (
                  <span
                    style={{ fontSize: '0.72rem', color: '#999', alignSelf: 'center' }}
                    title={`Not in expression data: ${unavailableTargets.map((t) => t.gene_symbol).join(', ')}`}
                  >
                    +{unavailableTargets.length} not in expression data
                  </span>
                )}
              </div>
            </div>
          )}
          {!targetsLoading && drugTargets.length === 0 && selectedDrug && (
            <div style={{ fontSize: '0.75rem', color: '#999', fontStyle: 'italic' }}>
              No known gene targets found for {selectedDrug}. Use the gene search above to select a gene manually.
            </div>
          )}
        </div>
      )}

      {error && <div style={{ color: '#c62828', fontSize: '0.85rem', marginBottom: 8 }}>{error}</div>}

      {scatterData && (
        <div>
          <div
            style={{
              display: 'flex',
              gap: '1.5rem',
              fontSize: '0.82rem',
              marginBottom: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <span>
              <span style={{ color: '#888' }}>Patients: </span>
              <strong>{scatterData.patient_count}</strong>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: '#888' }}>Pearson r: </span>
              <strong
                style={{
                  color: scatterData.correlation > 0 ? '#2e7d32' : scatterData.correlation < 0 ? '#c62828' : '#555',
                }}
              >
                {scatterData.correlation}
              </strong>
              <InlineHelp
                size={12}
                text="Linear correlation coefficient between DCNA and expression across patients. Ranges from -1 (perfect negative) to +1 (perfect positive). |r| > ~0.3 is typically meaningful for biological data."
              />
            </span>
            <span>
              <span style={{ color: '#888' }}>Drug: </span>
              <strong>{scatterData.drug}</strong>
            </span>
            <span>
              <span style={{ color: '#888' }}>Gene: </span>
              <strong>{scatterData.gene}</strong>
            </span>
          </div>
          <div ref={plotRef} style={{ width: '100%', height: 500, border: '1px solid #eee', borderRadius: 6 }} />
          {(() => {
            const heatmapGenes = selectedGene.startsWith('AVG_TARGETS:')
              ? selectedGene
                  .replace('AVG_TARGETS:', '')
                  .split(',')
                  .map((g) => g.trim())
                  .filter(Boolean)
              : selectedGene
                ? [selectedGene]
                : [];
            if (heatmapGenes.length === 0) return null;
            return (
              <ExpressionHeatmap
                genes={heatmapGenes}
                includeAverage={heatmapGenes.length > 1}
                title={`Differential Expression Heatmap — ${heatmapGenes.length > 1 ? `${heatmapGenes.length} targets` : heatmapGenes[0]}`}
              />
            );
          })()}
        </div>
      )}
    </div>
  );
}

// --- Patient Tab ---
function PatientTab({ patients, onReset }: { patients: string[]; onReset: () => void }) {
  const [selectedPatient, setSelectedPatient] = usePersistentState<string>('tcga_cohort_patient_id', '');
  const { data, isLoading } = usePatientProfile(selectedPatient);

  const fetchPatientSuggestions = async (q: string): Promise<string[]> => {
    const ql = q.toLowerCase();
    return patients.filter((p) => p.toLowerCase().includes(ql)).slice(0, 50);
  };

  return (
    <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Patient Profile</h3>
        <button onClick={onReset} style={tabResetBtnStyle}>
          Reset
        </button>
      </div>
      <p style={{ fontSize: '0.82rem', color: '#666', marginBottom: '0.75rem' }}>
        Search for a patient to see their top DCNA drug sensitivities and highest-expressed genes.
      </p>
      <InterpretBox id="tcga-patient-tab" title="How to read a patient profile" tone="tip">
        <p style={{ margin: '0 0 0.4rem' }}>A single patient's fingerprint, summarized as two ranked tables.</p>
        <ul style={{ margin: '0 0 0.3rem 1.1rem', padding: 0 }}>
          <li>
            <strong>Top DCNA</strong> — drugs to which this patient is most sensitive (highest DCNA). Useful for
            exploring personalized treatment possibilities in silico.
          </li>
          <li>
            <strong>Top expressed genes</strong> — genes this patient produces the most mRNA for. Compare against known
            biomarkers for the disease.
          </li>
        </ul>
        <p style={{ margin: 0, color: '#555', fontSize: '0.8rem' }}>
          Rankings are relative to this single patient, not the whole cohort. A patient with broadly low DCNA will still
          have a "top drug" — that doesn't mean they'd respond in absolute terms.
        </p>
      </InterpretBox>
      <SearchInput
        placeholder="Search patient ID (e.g., TCGA-06-0125)..."
        fetchSuggestions={fetchPatientSuggestions}
        onSelect={setSelectedPatient}
      />

      {isLoading && <div style={{ marginTop: 12, color: '#007bff' }}>Loading patient profile...</div>}
      {data && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: '0.95rem', color: '#1a1a2e' }}>{data.patient_id}</h4>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {/* Top DCNA */}
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#1565c0', marginBottom: 6 }}>
                Top DCNA (Highest Sensitivity)
              </div>
              <RankedTable
                rows={data.top_dcna}
                columns={[
                  { key: 'drug', label: 'Drug' },
                  { key: 'value', label: 'DCNA', align: 'right', format: (v: number) => v.toFixed(4) },
                ]}
                maxRows={20}
              />
            </div>

            {/* Bottom DCNA */}
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#c62828', marginBottom: 6 }}>
                Bottom DCNA (Lowest Sensitivity)
              </div>
              <RankedTable
                rows={data.bottom_dcna}
                columns={[
                  { key: 'drug', label: 'Drug' },
                  { key: 'value', label: 'DCNA', align: 'right', format: (v: number) => v.toFixed(4) },
                ]}
                maxRows={20}
              />
            </div>
          </div>

          {data.top_expressed_genes && data.top_expressed_genes.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#2e7d32', marginBottom: 6 }}>
                Top Expressed Genes
              </div>
              <RankedTable
                rows={data.top_expressed_genes}
                columns={[
                  { key: 'gene', label: 'Gene' },
                  { key: 'ensembl_id', label: 'Ensembl ID' },
                  { key: 'value', label: 'Expression', align: 'right', format: (v: number) => v.toFixed(4) },
                ]}
                maxRows={20}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
