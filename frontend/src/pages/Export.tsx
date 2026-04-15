import { getExportUrl } from '../services/api';

export default function Export() {
  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Export Data</h1>

      <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Download Trial Data</h3>
        <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '1rem' }}>
          Export all trial data from the database in your preferred format.
        </p>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <a
            href={getExportUrl('csv')}
            download
            style={{
              display: 'inline-block',
              padding: '0.6rem 2rem',
              background: '#28a745',
              color: '#fff',
              borderRadius: 4,
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: '0.9rem',
            }}
          >
            Download CSV
          </a>
          <a
            href={getExportUrl('json')}
            download
            style={{
              display: 'inline-block',
              padding: '0.6rem 2rem',
              background: '#007bff',
              color: '#fff',
              borderRadius: 4,
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: '0.9rem',
            }}
          >
            Download JSON
          </a>
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginTop: '1rem' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Export Formats</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid #ddd' }}>Format</th>
              <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid #ddd' }}>Description</th>
              <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '2px solid #ddd' }}>Use Case</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '0.4rem 0.5rem', fontWeight: 600 }}>CSV</td>
              <td style={{ padding: '0.4rem 0.5rem' }}>Comma-separated values with headers</td>
              <td style={{ padding: '0.4rem 0.5rem' }}>Excel, R, pandas, statistical tools</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '0.4rem 0.5rem', fontWeight: 600 }}>JSON</td>
              <td style={{ padding: '0.4rem 0.5rem' }}>Structured JSON with nested fields</td>
              <td style={{ padding: '0.4rem 0.5rem' }}>APIs, JavaScript, programmatic access</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
