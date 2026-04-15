import { Link, Outlet, useLocation } from 'react-router-dom';

// Sidebar order mirrors the analysis pipeline: acquire -> organize -> summarize &
// filter -> score & simulate -> learn & validate -> apply -> forecast impact ->
// deliver. The Welcome page groups these same pages into labeled phases.
const navItems = [
  { path: '/', label: 'Welcome' },
  // 1. Acquire
  { path: '/conditions', label: 'Disease Search' },
  { path: '/trials', label: 'Trial Explorer' },
  { path: '/ctis', label: 'EU Trials (CTIS)' },
  // 2. Organize
  { path: '/who', label: 'WHO Classification' },
  { path: '/moa', label: 'MOA Overview' },
  // 3. Summarize & Filter
  { path: '/dashboard', label: 'Analysis Dashboard' },
  { path: '/filtering', label: 'Trial Filtering' },
  // 4. Score & Simulate
  { path: '/tcga', label: 'TCGA Cohort' },
  { path: '/simulation', label: 'Simulation' },
  // 5. Learn & Validate
  { path: '/moa-correlation', label: 'MOA Correlation' },
  { path: '/threshold-validation', label: 'Threshold Validation' },
  // 6. Apply
  { path: '/novel-therapy', label: 'Novel Therapy Simulation' },
  { path: '/trial-comparison', label: 'Trial vs SATGBM' },
  // 7. Forecast Impact
  { path: '/screening-impact', label: 'Screening Impact' },
  { path: '/tam-estimator', label: 'TAM Estimator' },
  // 8. Deliver
  { path: '/export', label: 'Export' },
];

export default function Layout() {
  const location = useLocation();

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav style={{
        width: 220,
        background: '#1c3e72',
        color: '#e0e0e0',
        padding: '1rem 0',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        position: 'sticky',
        top: 0,
        height: '100vh',
        overflowY: 'auto',
      }}>
        <h2 style={{ textAlign: 'center', color: '#ffffff', margin: '0 0 0.25rem', fontSize: '1.05rem', letterSpacing: '0.5px' }}>
          Sygnomics
        </h2>
        <h1 style={{ textAlign: 'center', color: '#ffffff', margin: '0 0 1.25rem', fontSize: '1.5rem', fontWeight: 700, letterSpacing: '2px' }}>
          ORACLE
        </h1>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, flex: 1 }}>
          {navItems.map(({ path, label }) => {
            const active = location.pathname === path;
            return (
              <li key={path}>
                <Link
                  to={path}
                  style={{
                    display: 'block',
                    padding: '0.6rem 1.2rem',
                    color: '#ffffff',
                    background: active ? 'rgba(255,255,255,0.15)' : 'transparent',
                    textDecoration: 'none',
                    borderLeft: active ? '3px solid #ffffff' : '3px solid transparent',
                    fontSize: '0.9rem',
                  }}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div style={{
          marginTop: '1rem',
          padding: '0.85rem 1rem',
          borderTop: '1px solid #2c5a96',
          fontSize: '0.7rem',
          lineHeight: 1.5,
          color: '#ffffff',
        }}>
          <div style={{ color: '#ffffff', fontWeight: 600, marginBottom: 4, letterSpacing: '0.5px' }}>
            ORACLE
          </div>
          <div><strong style={{ color: '#ffffff' }}>O</strong>ncology</div>
          <div><strong style={{ color: '#ffffff' }}>R</strong>esponse &amp;</div>
          <div><strong style={{ color: '#ffffff' }}>C</strong>ohort</div>
          <div><strong style={{ color: '#ffffff' }}>L</strong>earning</div>
          <div><strong style={{ color: '#ffffff' }}>E</strong>ngine</div>
        </div>
      </nav>
      <main style={{ flex: 1, padding: '1.5rem 2rem', background: '#f5f7fa', overflowY: 'auto' }}>
        <Outlet />
      </main>
    </div>
  );
}
