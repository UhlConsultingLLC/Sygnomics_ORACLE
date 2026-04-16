/* eslint-disable @typescript-eslint/no-explicit-any --
 * Two `any` usages: the axios error catch block (standard pattern;
 * axios errors don't have a precise public type) and the
 * background-import job status object which is a dynamic JSON shape.
 * Tracked for v1.1.
 */
import { useState, useEffect, useRef } from 'react';
import { searchCTIS, startCTISImport, getCTISImportStatus, getCTISStats } from '../services/api';
import { usePersistentState } from '../hooks/usePersistentState';
import { InterpretBox, InlineHelp } from '../components/Interpretation';

interface CTISResult {
  ct_number: string;
  title: string;
  status: string;
  phase: string;
  sponsor: string;
  conditions: string;
  products: string;
  countries: string[];
  start_date: string | null;
  enrollment: number | null;
  already_imported: boolean;
}

interface ImportJob {
  job_id: string;
  status: string;
  stage: string;
  detail: string;
  progress_pct: number;
  trials_found: number;
  trials_imported: number;
  trials_skipped: number;
  error: string | null;
}

interface CTISStats {
  total_ctis_trials: number;
  total_ctgov_trials: number;
  cross_referenced: number;
  ctis_countries: string[];
}

export default function CTISImport() {
  const [query, setQuery, resetQuery] = usePersistentState<string>('ctis_query', '');
  const [maxResults, setMaxResults, resetMaxResults] = usePersistentState<number>('ctis_max_results', 100);
  const [fetchDetails, setFetchDetails, resetFetchDetails] = usePersistentState<boolean>('ctis_fetch_details', true);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<CTISResult[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchError, setSearchError] = useState('');

  const handleReset = () => {
    resetQuery();
    resetMaxResults();
    resetFetchDetails();
    setResults([]);
    setSearchTotal(0);
    setSearchError('');
  };

  const [importJob, setImportJob] = useState<ImportJob | null>(null);
  const [importing, setImporting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [stats, setStats] = useState<CTISStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Load stats on mount
  useEffect(() => {
    getCTISStats()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setStatsLoading(false));
  }, [importJob?.status]);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError('');
    setResults([]);
    try {
      const resp = await searchCTIS({
        query: query.trim(),
        max_results: maxResults,
        fetch_details: false, // Search preview is always lightweight
      });
      setResults(resp.results);
      setSearchTotal(resp.total);
    } catch (e: any) {
      setSearchError(e?.response?.data?.detail || e?.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const handleImport = async (useGliomaSearch: boolean = false) => {
    setImporting(true);
    setImportJob(null);
    try {
      const resp = await startCTISImport({
        query: useGliomaSearch ? '' : query.trim(),
        max_results: maxResults,
        fetch_details: fetchDetails,
        use_glioma_search: useGliomaSearch,
      });
      const jobId = resp.job_id;
      setImportJob({
        job_id: jobId,
        status: 'running',
        stage: 'initializing',
        detail: resp.message,
        progress_pct: 0,
        trials_found: 0,
        trials_imported: 0,
        trials_skipped: 0,
        error: null,
      });

      // Start polling
      pollRef.current = setInterval(async () => {
        try {
          const status = await getCTISImportStatus(jobId);
          setImportJob(status);
          if (status.status === 'complete' || status.status === 'error') {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setImporting(false);
            // Refresh stats
            getCTISStats()
              .then(setStats)
              .catch(() => {});
          }
        } catch {
          // Keep polling on transient errors
        }
      }, 2000);
    } catch (e: any) {
      setImporting(false);
      setImportJob({
        job_id: '',
        status: 'error',
        stage: '',
        detail: '',
        progress_pct: 0,
        trials_found: 0,
        trials_imported: 0,
        trials_skipped: 0,
        error: e?.response?.data?.detail || e?.message || 'Import failed to start',
      });
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>EU Clinical Trials (CTIS)</h1>
      <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
        Search and import clinical trial data from the EU Clinical Trials Information System
      </p>

      <InterpretBox id="ctis-intro" title="How to read this page">
        <p style={{ margin: '0 0 0.5rem' }}>
          CT.gov only lists US-registered trials plus their international partners; many EU-only trials never appear.
          The EU Clinical Trials Information System (CTIS) is the complementary registry. This page lets you search
          CTIS, preview results, and import selected trials into the local database with
          <em> cross-referencing</em> to existing CT.gov records.
        </p>
        <ul style={{ margin: '0.25rem 0 0.5rem 1.1rem', padding: 0 }}>
          <li>
            <strong>Stats banner</strong> — CT.gov count (US-centric) vs CTIS count (EU-centric) vs Cross-referenced
            (trials registered in both). EU countries is the number of distinct CTIS member states represented.
          </li>
          <li>
            <strong>Search &amp; preview</strong> — lightweight query (no details fetched). The{' '}
            <em>Already Imported</em> column shows which rows already exist in the local DB so you can skip duplicate
            work.
          </li>
          <li>
            <strong>Import flow</strong> — runs in the background with progress polling every 2 s.{' '}
            <em>Fetch full details</em> makes the import slower but captures sponsors, conditions, products, and country
            lists.
          </li>
          <li>
            <strong>Import All Glioma Trials</strong> — one-click bulk import using a pre-canned multi-term query for
            glioma variants (bypasses the search box).
          </li>
        </ul>
        <p style={{ margin: '0.4rem 0 0', fontSize: '0.78rem', color: '#555' }}>
          <strong>Cross-referencing:</strong> a trial is considered cross-referenced when its CTIS{' '}
          <code>ct_number</code> maps to a known CT.gov NCT ID via the sponsor/identifier links published by EMA.
        </p>
      </InterpretBox>

      {/* Stats banner */}
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
        }}
      >
        <StatCard
          label="CT.gov Trials"
          value={stats?.total_ctgov_trials ?? '-'}
          loading={statsLoading}
          color="#007bff"
          tooltip="Total trials ingested from ClinicalTrials.gov in the local DB."
        />
        <StatCard
          label="CTIS Trials"
          value={stats?.total_ctis_trials ?? '-'}
          loading={statsLoading}
          color="#28a745"
          tooltip="Total trials ingested from the EU Clinical Trials Information System."
        />
        <StatCard
          label="Cross-Referenced"
          value={stats?.cross_referenced ?? '-'}
          loading={statsLoading}
          color="#6f42c1"
          tooltip="Trials present in both registries — CTIS ct_number linked to CT.gov NCT ID via EMA-published sponsor identifiers."
        />
        <StatCard
          label="EU Countries"
          value={stats?.ctis_countries?.length ?? '-'}
          loading={statsLoading}
          color="#fd7e14"
          tooltip="Number of distinct CTIS member states represented across imported trials."
        />
      </div>

      {/* Search panel */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #ddd',
          borderRadius: 8,
          padding: '1.25rem',
          marginBottom: '1.5rem',
        }}
      >
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Search CTIS</h3>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search term (e.g., glioblastoma, temozolomide)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
            style={{
              flex: 1,
              minWidth: 250,
              padding: '0.5rem 0.75rem',
              border: '1px solid #ccc',
              borderRadius: 4,
              fontSize: '0.9rem',
            }}
          />
          <select
            value={maxResults}
            onChange={(e) => setMaxResults(Number(e.target.value))}
            style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: 4 }}
          >
            <option value={50}>50 results</option>
            <option value={100}>100 results</option>
            <option value={200}>200 results</option>
            <option value={500}>500 results</option>
          </select>
          <button
            onClick={handleSearch}
            disabled={searching || !query.trim()}
            style={{
              padding: '0.5rem 1.2rem',
              background: '#007bff',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              opacity: searching || !query.trim() ? 0.6 : 1,
            }}
          >
            {searching ? 'Searching...' : 'Search'}
          </button>
          <button
            onClick={handleReset}
            style={{
              padding: '0.5rem 1.2rem',
              background: '#6c757d',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Reset
          </button>
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', fontSize: '0.85rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={fetchDetails} onChange={(e) => setFetchDetails(e.target.checked)} />
            Fetch full details on import (slower but richer data)
          </label>
          <button
            onClick={() => handleImport(true)}
            disabled={importing}
            style={{
              padding: '0.4rem 1rem',
              background: '#28a745',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              marginLeft: 'auto',
              opacity: importing ? 0.6 : 1,
              fontSize: '0.85rem',
            }}
          >
            Import All Glioma Trials
          </button>
        </div>

        {searchError && (
          <div style={{ marginTop: '0.75rem', color: '#dc3545', fontSize: '0.85rem' }}>{searchError}</div>
        )}
      </div>

      {/* Import progress */}
      {importJob && (
        <div
          style={{
            background: importJob.status === 'error' ? '#fff5f5' : importJob.status === 'complete' ? '#f0fff4' : '#fff',
            border: `1px solid ${importJob.status === 'error' ? '#f5c6cb' : importJob.status === 'complete' ? '#c3e6cb' : '#ddd'}`,
            borderRadius: 8,
            padding: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>
            Import{' '}
            {importJob.status === 'running' ? 'In Progress' : importJob.status === 'complete' ? 'Complete' : 'Failed'}
          </h3>
          {importJob.status === 'running' && (
            <div style={{ marginBottom: '0.5rem' }}>
              <div
                style={{
                  height: 8,
                  background: '#e9ecef',
                  borderRadius: 4,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${importJob.progress_pct}%`,
                    background: '#007bff',
                    borderRadius: 4,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </div>
          )}
          <div style={{ fontSize: '0.85rem', color: '#555' }}>
            <p style={{ margin: '0.25rem 0' }}>
              <strong>Stage:</strong> {importJob.stage}
            </p>
            <p style={{ margin: '0.25rem 0' }}>{importJob.detail}</p>
            {importJob.trials_found > 0 && (
              <p style={{ margin: '0.25rem 0' }}>
                Found: {importJob.trials_found} | Imported: {importJob.trials_imported} | Skipped:{' '}
                {importJob.trials_skipped}
              </p>
            )}
            {importJob.error && <p style={{ margin: '0.25rem 0', color: '#dc3545' }}>Error: {importJob.error}</p>}
          </div>
        </div>
      )}

      {/* Search results table */}
      {results.length > 0 && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: 8,
            padding: '1rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.75rem',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '1rem' }}>Search Results ({searchTotal} trials)</h3>
            <button
              onClick={() => handleImport(false)}
              disabled={importing}
              style={{
                padding: '0.4rem 1rem',
                background: '#28a745',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                opacity: importing ? 0.6 : 1,
              }}
            >
              {importing ? 'Importing...' : `Import ${searchTotal} Trials`}
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  <th style={thStyle}>CT Number</th>
                  <th style={{ ...thStyle, minWidth: 250 }}>Title</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Phase</th>
                  <th style={thStyle}>Products</th>
                  <th style={thStyle}>Countries</th>
                  <th style={thStyle}>Imported</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.ct_number} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={tdStyle}>
                      <a
                        href={`https://euclinicaltrials.eu/ctis-public/search#searchResult/trialDetail/${r.ct_number}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#007bff', textDecoration: 'none' }}
                      >
                        {r.ct_number}
                      </a>
                    </td>
                    <td style={tdStyle} title={r.title}>
                      {r.title.length > 120 ? r.title.slice(0, 120) + '...' : r.title}
                    </td>
                    <td style={tdStyle}>{r.status}</td>
                    <td style={tdStyle}>{r.phase}</td>
                    <td style={tdStyle}>{r.products}</td>
                    <td style={tdStyle}>{r.countries.join(', ')}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      {r.already_imported ? (
                        <span style={{ color: '#28a745' }}>Yes</span>
                      ) : (
                        <span style={{ color: '#999' }}>No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Countries list */}
      {stats && stats.ctis_countries.length > 0 && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: 8,
            padding: '1rem',
            marginTop: '1.5rem',
          }}
        >
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Countries Represented</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {stats.ctis_countries.map((c) => (
              <span
                key={c}
                style={{
                  background: '#e8f4fd',
                  padding: '3px 10px',
                  borderRadius: 12,
                  fontSize: '0.8rem',
                }}
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  loading,
  color,
  tooltip,
}: {
  label: string;
  value: number | string;
  loading: boolean;
  color: string;
  tooltip?: string;
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #ddd',
        borderRadius: 8,
        padding: '1rem 1.25rem',
        minWidth: 140,
        borderTop: `3px solid ${color}`,
      }}
    >
      <div
        style={{ fontSize: '0.75rem', color: '#888', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}
      >
        {label}
        {tooltip && <InlineHelp size={11} text={tooltip} />}
      </div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color }}>{loading ? '...' : value}</div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem',
  borderBottom: '2px solid #ddd',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '0.4rem 0.5rem',
  verticalAlign: 'top',
};
