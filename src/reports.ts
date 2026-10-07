import type { Bootstrap, Filters, Movement } from './types';
import { currency, displayDate, effectiveState, localDate, paidAmount, pendingAmount, summarizeMovements } from './finance';
import { label, safeReceiptUrl } from './components';

const headers = ['Fecha', 'ID', 'Responsable', 'Tipo / dirección', 'Categoría', 'Proveedor / factura', 'Descripción / observaciones', 'Forma de pago', 'Total', 'Pagado actual', 'Pendiente', 'Estado actual / registrado', 'Comprobante'];
function reportRows(rows: Movement[], ledger: Movement[], data: Bootstrap): (string | number)[][] {
  return [...rows].sort((a, b) => a.FECHA.localeCompare(b.FECHA)).map(m => [
    m.FECHA, m.ID, label(data.jefes, m.JEFE),
    [m.TIPO, m.DIRECCION].filter(Boolean).join(' / '), [label(data.categorias, m.CATEGORIA), m.SUBCATEGORIA].filter(Boolean).join(' / '),
    [m.PROVEEDOR, (m.NUMERO_FACTURA || m.FACTURA) ? `Factura: ${m.NUMERO_FACTURA || m.FACTURA}` : ''].filter(Boolean).join(' / '),
    [m.DESCRIPCION, m.OBSERVACIONES].filter(Boolean).join(' / '), label(data.formasPago, m.FORMA_PAGO),
    m.TOTAL, paidAmount(m, ledger), pendingAmount(m, ledger), `Actual: ${effectiveState(m, ledger)}\nRegistrado: ${m.ESTADO}`, safeReceiptUrl(m.COMPROBANTE_URL) || '',
  ]);
}
function filterDescription(filters: Filters, data: Bootstrap): string {
  return [filters.desde ? `Desde ${displayDate(filters.desde)}` : 'Desde el inicio', filters.hasta ? `hasta ${displayDate(filters.hasta)}` : 'hasta el último registro',
    filters.jefe ? label(data.jefes, filters.jefe) : 'Todos los responsables',
    filters.categoria && label(data.categorias, filters.categoria), filters.tipo, filters.estado && `Estado actual: ${filters.estado}`, filters.formaPago && label(data.formasPago, filters.formaPago),
    filters.proveedor, filters.buscar && `Búsqueda: ${filters.buscar}`].filter(Boolean).join(' · ');
}
export async function exportExcel(rows: Movement[], ledger: Movement[], data: Bootstrap, filters: Filters): Promise<void> {
  const XLSX = await import('xlsx');
  const summary = summarizeMovements(rows, ledger);
  const raw = reportRows(rows, ledger, data);
  const sheet = XLSX.utils.aoa_to_sheet([
    ['CUENTAS | GERENCIA'], ['Reporte de movimientos · USD'], [filterDescription(filters, data)], [], headers,
    ...raw.map(row => { const [year, month, day] = String(row[0]).split('-').map(Number); return [new Date(year, month - 1, day), ...row.slice(1)]; }),
    [], ['Totales contables (sin anulados ni doble conteo de pagos vinculados)'],
    ['Total invertido (incluye pendientes)', summary.gastos], ['Ingresos efectivos', summary.ingresos], ['Egresos efectivos', summary.egresos], ['Pendiente actual', summary.pendiente],
    ['Los importes por fila no deben sumarse como gasto: los pagos vinculados liquidan obligaciones existentes.'],
    ['La inversión es el total registrado, no el efectivo pagado. Reembolsos no restan; anulaciones excluyen. Préstamos, adelantos, ingresos, transferencias y retiros no se incluyen.'],
    ['El filtro de estado usa el estado actual calculado con todos los pagos vinculados. El estado registrado se conserva para auditoría.'],
  ], { cellDates: true });
  for (let row = 5; row < 5 + raw.length; row++) {
    const dateCell = sheet[XLSX.utils.encode_cell({ r: row, c: 0 })];
    if (dateCell) dateCell.z = 'dd/mm/yyyy';
    for (const col of [8, 9, 10]) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell) cell.z = '"$"#,##0.00;[Red]-"$"#,##0.00';
    }
  }
  for (let row = raw.length + 7; row <= raw.length + 10; row++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: row, c: 1 })];
    if (cell) cell.z = '"$"#,##0.00;[Red]-"$"#,##0.00';
  }
  sheet['!cols'] = [14, 38, 40, 25, 22, 30, 50, 22, 17, 17, 17, 30, 55].map(wch => ({ wch }));
  sheet['!autofilter'] = { ref: `A5:M${Math.max(5, raw.length + 5)}` };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Movimientos');
  XLSX.writeFile(book, `cuentas-reporte-${localDate()}.xlsx`);
}
export async function exportPDF(rows: Movement[], ledger: Movement[], data: Bootstrap, filters: Filters): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  const summary = summarizeMovements(rows, ledger);
  doc.setFontSize(19); doc.setTextColor(18, 43, 53); doc.text('CUENTAS / GERENCIA', 12, 15);
  doc.setFontSize(10); doc.text('Reporte de movimientos | USD | Estado filtrado: actual calculado con todos los pagos vinculados', 12, 23);
  const filterLines = doc.splitTextToSize(filterDescription(filters, data), 390);
  doc.setFontSize(8); doc.text(filterLines, 12, 30);
  const startY = 33 + filterLines.length * 4;
  autoTable(doc, {
    startY, head: [headers], body: reportRows(rows, ledger, data).map(row => row.map((value, index) => index === 0 ? displayDate(String(value)) : [8, 9, 10].includes(index) ? currency(Number(value)) : String(value))),
    margin: { left: 12, right: 12, top: 16, bottom: 18 }, theme: 'grid',
    styles: { fontSize: 7, cellPadding: 2.2, overflow: 'linebreak', lineColor: [225, 231, 230], textColor: [35, 53, 59] },
    headStyles: { fillColor: [18, 43, 53], fontSize: 7 }, alternateRowStyles: { fillColor: [245, 247, 244] },
    columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 27 }, 2: { cellWidth: 32 }, 3: { cellWidth: 22 }, 4: { cellWidth: 26 }, 5: { cellWidth: 31 }, 6: { cellWidth: 48 }, 7: { cellWidth: 26 }, 8: { cellWidth: 25, halign: 'right' }, 9: { cellWidth: 25, halign: 'right' }, 10: { cellWidth: 25, halign: 'right' }, 11: { cellWidth: 24 }, 12: { cellWidth: 42 } },
    didDrawPage: () => { doc.setFontSize(8); doc.setTextColor(95, 110, 114); doc.text(`Generado: ${displayDate(localDate())} | Página ${doc.getNumberOfPages()} | Registros reales del sistema`, 12, doc.internal.pageSize.getHeight() - 9); },
  });
  autoTable(doc, { head: [['Total invertido (incluye pendientes)', 'Ingresos efectivos', 'Egresos efectivos', 'Pendiente actual']], body: [[currency(summary.gastos), currency(summary.ingresos), currency(summary.egresos), currency(summary.pendiente)]],
    margin: { left: 12, right: 12, bottom: 18 }, styles: { fontSize: 9 }, headStyles: { fillColor: [25, 113, 107] } });
  autoTable(doc, { body: [['Inversión: total registrado, no efectivo pagado; sin duplicar pagos vinculados. Reembolsos no restan; anulaciones excluyen. Préstamos, adelantos, ingresos, transferencias y retiros no se incluyen.']], margin: { left: 12, right: 12, bottom: 18 }, styles: { fontSize: 8 }, theme: 'plain' });
  doc.save(`cuentas-reporte-${localDate()}.pdf`);
}
