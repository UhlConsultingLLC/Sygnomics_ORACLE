interface Column<T> {
  key: keyof T;
  header: string;
  render?: (value: T[keyof T], row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyField: keyof T;
}

export default function DataTable<T>({ columns, data, keyField }: DataTableProps<T>) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={String(col.key)}
                style={{
                  textAlign: 'left',
                  padding: '0.6rem 0.8rem',
                  borderBottom: '2px solid #ddd',
                  background: '#f8f9fa',
                  fontWeight: 600,
                  color: '#333',
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={String(row[keyField])} style={{ borderBottom: '1px solid #eee' }}>
              {columns.map((col) => (
                <td key={String(col.key)} style={{ padding: '0.5rem 0.8rem', color: '#555' }}>
                  {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length === 0 && <p style={{ textAlign: 'center', color: '#888', padding: '1.5rem' }}>No data available.</p>}
    </div>
  );
}
