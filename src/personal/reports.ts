import type { PersonalBootstrap, Row } from './types';
import { label, totals, validDate, type Filters } from './finance';
import { businessDateFields, displayDate, displayMonth, displayTimestamp, fieldLabel, rowDisplay } from './display';
import { personalReceiptUrl } from './receipts';

export function downloadBlob(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export const csvCell = (v: string | number) => `"${(typeof v === 'string' && /^[\s]*[=+\-@]/.test(v) ? `'${v}` : String(v)).replace(/"/g, '""')}"`;
export const reportKeys = (rows: Row[]) => [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => !['USERNAME', 'ASIENTOS', 'OP_ID', 'UPDATED_AT'].includes(k));
export function filterDescription(filters: Filters, data: PersonalBootstrap): string {
  const names: Record<string, string> = { query: 'Busqueda', from: 'Desde', to: 'Hasta', month: 'Mes', year: 'Ano', account: 'Cuenta', bank: 'Banco', person: 'Persona o empresa', category: 'Categoria', type: 'Tipo', method: 'Metodo', state: 'Estado', due: 'Vencimiento', recurring: 'Definicion recurrente', min: 'Monto minimo USD', max: 'Monto maximo USD' };
  return Object.entries(filters).filter(([k, v]) => k !== 'sort' && v).map(([k, v]) => {
    const value = ['from', 'to'].includes(k) ? displayDate(v) : k === 'month' ? displayMonth(v) : k === 'account' ? label(data.cuentas, v) : k === 'person' ? label(data.beneficiarios, v) : k === 'category' ? label(data.categorias, v) : k === 'recurring' ? String(data.recurrentes.find(r => r.ID === v)?.TITULO || v) : k === 'due' ? v === 'overdue' ? 'Vencido' : 'Proximo' : v;
    return `${names[k]}: ${value}`;
  }).join(' | ') || 'Todo el periodo, sin filtros';
}
export function reportData(rows: Row[], data: PersonalBootstrap): { keys: string[]; headers: string[]; rows: (string | number)[][] } {
  const keys = reportKeys(rows);
  return { keys, headers: keys.map(fieldLabel), rows: rows.map(r => keys.map(k => k === 'COMPROBANTE_URL' ? personalReceiptUrl(String(r[k] || '')) || '' : typeof r[k] === 'number' ? r[k] as number : rowDisplay(k, r[k], data))) };
}
function reportInfo(rows: Row[], data: PersonalBootstrap, report: string, period: string, generated: string): (string | number)[][] {
  const summary = totals(data.movimientos.filter(m => rows.some(r => r.ID === m.ID)));
  return [[`CUENTAS / PERSONAL: ${report}`], [`USD | ${period} | Generado ${displayTimestamp(generated, data.configuracion.TIMEZONE)}`], ['Ingresos (solo movimientos seleccionados)', summary.income], ['Gastos (sin transferencias ni pagos tarjeta)', summary.expense]];
}
export async function reportWorkbook(rows: Row[], data: PersonalBootstrap, report: string, period: string, generated = new Date().toISOString()) {
  const XLSX = await import('xlsx');
  const table = reportData(rows, data);
  // Date objects become numeric Excel date cells in UTC, never locale-dependent strings.
  const excelRows = table.rows.map((r, index) => r.map((v, col) => {
    const raw = String(rows[index][table.keys[col]] || '');
    return businessDateFields.has(table.keys[col]) && validDate(raw) ? new Date(`${raw}T00:00:00Z`) : v;
  }));
  const sheet = XLSX.utils.aoa_to_sheet([...reportInfo(rows, data, report, period, generated), table.headers, ...excelRows], { cellDates: false, dateNF: 'dd/mm/yyyy', UTC: true });
  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue;
    if (typeof sheet[key].v === 'string') { sheet[key].t = 's'; delete sheet[key].f; }
  }
  for (let row = 0; row < rows.length; row++) for (let col = 0; col < table.keys.length; col++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: row + 5, c: col })];
    if (!cell || cell.t !== 'n') continue;
    cell.z = businessDateFields.has(table.keys[col]) ? 'dd/mm/yyyy' : table.headers[col].endsWith('USD') ? '"$"#,##0.00;[Red]-"$"#,##0.00' : '0';
  }
  for (const cell of ['B3', 'B4']) if (sheet[cell]) sheet[cell].z = '"$"#,##0.00';
  sheet['!cols'] = table.headers.map(() => ({ wch: 24 }));
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Personal'); return book;
}
export async function exportReport(kind: 'csv' | 'xlsx' | 'pdf', rows: Row[], data: PersonalBootstrap, report: string, period: string) {
  const table = reportData(rows, data); const generated = new Date().toISOString();
  const summary = totals(data.movimientos.filter(m => rows.some(r => r.ID === m.ID)));
  if (kind === 'csv') { downloadBlob(new Blob(['\uFEFF' + [...reportInfo(rows, data, report, period, generated), table.headers, ...table.rows].map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'personal-reporte.csv'); return; }
  if (kind === 'xlsx') { const XLSX = await import('xlsx'); XLSX.writeFile(await reportWorkbook(rows, data, report, period, generated), 'personal-reporte.xlsx'); return; }
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', format: 'a3' }); doc.setFontSize(16); doc.text(`CUENTAS / PERSONAL: ${report}`, 12, 15); doc.setFontSize(9);
  const description = doc.splitTextToSize(`USD | ${period} | Ingresos ${summary.income.toFixed(2)} | Gastos ${summary.expense.toFixed(2)}`, 390); doc.text(description, 12, 23);
  autoTable(doc, { head: [table.headers], body: table.rows.map(r => r.map((v, i) => typeof v === 'number' ? table.headers[i].endsWith('USD') ? v.toFixed(2) : String(v) : v)), startY: 28 + description.length * 4, styles: { fontSize: 6, overflow: 'linebreak' }, headStyles: { fillColor: [17, 32, 59] }, margin: { bottom: 18 }, horizontalPageBreak: true, didDrawPage: () => { doc.setFontSize(8); doc.text(doc.splitTextToSize(`Generado ${displayTimestamp(generated, data.configuracion.TIMEZONE)} | ${period} | Pagina ${doc.getNumberOfPages()}`, 390), 12, doc.internal.pageSize.getHeight() - 12); } }); doc.save('personal-reporte.pdf');
}
