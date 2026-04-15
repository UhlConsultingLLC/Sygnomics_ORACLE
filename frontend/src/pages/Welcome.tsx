import { Link } from 'react-router-dom';

type Stage = { title: string; path: string; blurb: string };
type Phase = { phase: string; subtitle: string; stages: Stage[] };

// Pipeline phases shown on the Welcome page. Sidebar order in Layout.tsx mirrors
// this same sequence.
const pipeline: Phase[] = [
  {
    phase: '1. Acquire',
    subtitle: 'Pull every relevant trial from public registries.',
    stages: [
      { title: 'Disease Search', path: '/conditions', blurb: 'Type a disease name and expand it via MeSH to see how many trials in the database match each related term.' },
      { title: 'Trial Explorer', path: '/trials', blurb: 'Browse, filter, and inspect every trial pulled from ClinicalTrials.gov and EU CTIS, with normalized phases and per-arm outcome tables.' },
      { title: 'EU Trials (CTIS)', path: '/ctis', blurb: 'Import and review trials registered in the EU Clinical Trials Information System, keeping the database dual-registry.' },
    ],
  },
  {
    phase: '2. Organize',
    subtitle: 'Tag trials by disease subtype and group drugs by mechanism.',
    stages: [
      { title: 'WHO Classification', path: '/who', blurb: 'Tag trials with WHO 2021 CNS tumor subtypes for subtype-aware cohort building.' },
      { title: 'MOA Overview', path: '/moa', blurb: 'Drugs grouped by mechanism of action via ChEMBL — ask "does this kind of drug work?" instead of one molecule at a time.' },
    ],
  },
  {
    phase: '3. Summarize & Filter',
    subtitle: 'Understand the corpus, then carve out a focused cohort.',
    stages: [
      { title: 'Analysis Dashboard', path: '/dashboard', blurb: 'Interactive Plotly charts for phase distribution, response rate histograms, and MOA prevalence across the full database.' },
      { title: 'Trial Filtering', path: '/filtering', blurb: 'Build a focused training cohort from any combination of conditions, MOA, phase, status, and outcome metrics.' },
    ],
  },
  {
    phase: '4. Score & Simulate',
    subtitle: 'Translate a clinical trial onto real TCGA patients.',
    stages: [
      { title: 'TCGA Cohort', path: '/tcga', blurb: 'Score real TCGA patients with Drug-Constrained Network Activity (DCNA) and explore expression / patient tabs.' },
      { title: 'Simulation', path: '/simulation', blurb: 'Run an in-silico trial: match TCGA patients to a real trial\'s eligibility criteria and project outcomes.' },
    ],
  },
  {
    phase: '5. Learn & Validate',
    subtitle: 'Find biomarker signal, then prove the threshold holds.',
    stages: [
      { title: 'MOA Correlation', path: '/moa-correlation', blurb: 'Scan every MOA for the correlation between DCNA and observed response — identify which mechanisms carry predictive biomarker signal.' },
      { title: 'Threshold Validation', path: '/threshold-validation', blurb: 'Validate the learned biomarker threshold on held-out trials — sensitivity, specificity, ROC, and Bland-Altman agreement with observed rates.' },
    ],
  },
  {
    phase: '6. Apply',
    subtitle: 'Use the threshold to design and benchmark the next trial.',
    stages: [
      { title: 'Novel Therapy Simulation', path: '/novel-therapy', blurb: 'Apply a learned biomarker threshold to design and simulate the next-generation trial — your enrollment cut-point in action.' },
      { title: 'Trial vs SATGBM', path: '/trial-comparison', blurb: 'Benchmark a novel therapy arm against standard-of-care (SATGBM) — head-to-head projected response rates on the same TCGA cohort.' },
    ],
  },
  {
    phase: '7. Forecast Impact',
    subtitle: 'Project feasibility and market size for the novel trial.',
    stages: [
      { title: 'Screening Impact', path: '/screening-impact', blurb: 'Given threshold prevalence and screening throughput, project how many patients you must screen to enroll a target cohort size.' },
      { title: 'TAM Estimator', path: '/tam-estimator', blurb: 'Estimate the total addressable market — threshold-qualified patient population given incidence, prevalence, and biomarker-positive rate.' },
    ],
  },
  {
    phase: '8. Deliver',
    subtitle: 'Export everything for downstream packaging.',
    stages: [
      { title: 'Export', path: '/export', blurb: 'Download cohorts as CSV and figures as PNG/SVG for IRB packets, manuscripts, and slide decks.' },
    ],
  },
];

export default function Welcome() {
  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{
        background: 'linear-gradient(135deg, #1c3e72 0%, #634697 100%)',
        color: '#fff',
        padding: '2rem 2.25rem',
        borderRadius: 12,
        marginBottom: '1.5rem',
      }}>
        <div style={{ fontSize: '0.85rem', color: '#ffffff', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>
          Sygnomics
        </div>
        <h1 style={{ margin: '0 0 0.5rem', fontSize: '2.2rem', letterSpacing: '3px', color: '#ffffff' }}>
          ORACLE
        </h1>
        <div style={{ fontSize: '0.95rem', color: '#cfd8e8', marginBottom: '1rem' }}>
          <strong style={{ color: '#fff' }}>O</strong>ncology{' '}
          <strong style={{ color: '#fff' }}>R</strong>esponse &amp;{' '}
          <strong style={{ color: '#fff' }}>C</strong>ohort{' '}
          <strong style={{ color: '#fff' }}>L</strong>earning{' '}
          <strong style={{ color: '#fff' }}>E</strong>ngine
        </div>
        <p style={{ fontSize: '1rem', lineHeight: 1.55, margin: 0, color: '#e8eef8' }}>
          ORACLE is an end-to-end translational pipeline that turns public clinical trial data into
          decision-ready biomarker thresholds and simulated next-generation trials. Public data in,
          actionable enrollment rules out — every step traceable to its source.
        </p>
      </div>

      <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 10, padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', color: '#1c3e72' }}>
          What ORACLE does
        </h2>
        <ol style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.92rem', lineHeight: 1.65, color: '#333' }}>
          <li>
            <strong>Acquires</strong> every trial relevant to a disease from ClinicalTrials.gov and EU CTIS,
            expanding terms via MeSH so nothing gets missed.
          </li>
          <li>
            <strong>Classifies</strong> every drug intervention by mechanism of action using ChEMBL, turning
            hundreds of molecules into ~20 interpretable categories.
          </li>
          <li>
            <strong>Extracts</strong> per-arm response rates from outcome tables — including correctly
            combining CR + PR rows from RECIST-style category data.
          </li>
          <li>
            <strong>Scores</strong> real TCGA patients with Drug-Constrained Network Activity (DCNA), a
            biomarker derived from drug-target gene sets.
          </li>
          <li>
            <strong>Learns</strong> a biomarker threshold that separates likely responders from
            non-responders, then validates it on held-out trials.
          </li>
          <li>
            <strong>Simulates</strong> a next-generation trial against that learned threshold — predicting
            response rates, screening burden, and market size before any patient is enrolled.
          </li>
          <li>
            <strong>Exports</strong> cohorts, figures, and reports for IRB packets, manuscripts, and decks.
          </li>
        </ol>
      </div>

      <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 10, padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.35rem', fontSize: '1.1rem', color: '#1c3e72' }}>
          Suggested workflow
        </h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: '#555' }}>
          The sidebar is ordered top-to-bottom in the same sequence as the eight-phase pipeline below.
          Each phase builds on the previous one; you can also jump straight to a phase once upstream
          data is loaded.
        </p>

        {pipeline.map((group, gi) => {
          const startNum = pipeline.slice(0, gi).reduce((sum, g) => sum + g.stages.length, 0);
          return (
            <div key={group.phase} style={{ marginBottom: gi === pipeline.length - 1 ? 0 : '1.1rem' }}>
              <div style={{
                fontSize: '0.78rem',
                color: '#634697',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.6px',
                marginBottom: 2,
              }}>
                {group.phase}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.5rem' }}>
                {group.subtitle}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem 1rem' }}>
                {group.stages.map((s, si) => {
                  const num = startNum + si + 1;
                  return (
                    <Link
                      key={s.path}
                      to={s.path}
                      style={{
                        display: 'block',
                        padding: '0.7rem 0.9rem',
                        background: '#f7f9fc',
                        border: '1px solid #e0e6ee',
                        borderRadius: 6,
                        textDecoration: 'none',
                        color: '#1c3e72',
                      }}
                    >
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 2 }}>
                        <span style={{ color: '#634697', marginRight: 6 }}>{num}.</span>
                        {s.title}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#666', lineHeight: 1.4 }}>
                        {s.blurb}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 10, padding: '1.25rem 1.5rem' }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem', color: '#1c3e72' }}>
          Get started
        </h2>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: '#555' }}>
          New to ORACLE? Start with <strong>Disease Search</strong> to expand a disease term and see how
          much evidence the database holds. Already know your cohort? Jump straight to{' '}
          <strong>Trial Filtering</strong> or <strong>TCGA Cohort</strong>. If you have a learned
          threshold already, go to <strong>Novel Therapy Simulation</strong>.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link to="/conditions" style={primaryBtn}>Start with Disease Search →</Link>
          <Link to="/filtering" style={secondaryBtn}>Build a Cohort</Link>
          <Link to="/tcga" style={secondaryBtn}>Explore TCGA</Link>
          <Link to="/novel-therapy" style={secondaryBtn}>Design a Novel Trial</Link>
        </div>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: '0.55rem 1.1rem',
  background: '#634697',
  color: '#fff',
  borderRadius: 6,
  textDecoration: 'none',
  fontSize: '0.88rem',
  fontWeight: 600,
};

const secondaryBtn: React.CSSProperties = {
  padding: '0.55rem 1.1rem',
  background: '#f0f4f8',
  color: '#1c3e72',
  borderRadius: 6,
  textDecoration: 'none',
  fontSize: '0.88rem',
  fontWeight: 600,
  border: '1px solid #d0d8e0',
};
