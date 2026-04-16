// Tiny helper around ExcelJS that turns an array-of-arrays per sheet into
// a downloaded .xlsx file. Replaces the old `xlsx` (SheetJS CE) call sites,
// which had known-unfixed CVEs on the npm registry. ExcelJS is MIT-licensed,
// actively maintained, and covers the same write-only use case cleanly.
//
// The ExcelJS import is deliberately dynamic so the library is split into
// its own chunk and only loaded when a user actually clicks a Download
// button — same lazy behavior the old `import('xlsx').then(...)` pattern
// gave us.

export type SheetSpec = {
  name: string;
  rows: unknown[][];
};

/**
 * Write `sheets` to a workbook and trigger a browser download as `fileName`.
 *
 * Each sheet's `rows` is an array-of-arrays — one inner array per row, with
 * cell values as strings, numbers, booleans, null, or undefined. Empty inner
 * arrays produce empty rows (used as visual separators in some exports).
 */
export async function downloadSheetsAsXlsx(
  sheets: SheetSpec[],
  fileName: string,
): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name);
    ws.addRows(sheet.rows);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Defer revoke so Firefox / Safari don't cancel the download mid-flight.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
