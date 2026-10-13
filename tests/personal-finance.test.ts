import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alerts, allocated, calendarCells, cardStatement, dashboardCharts, dateAdd, dayDistance, emptyFilters, filterRows, historicalCash, indicators, monthlyDate, nextCardDate, postings, quotaState, runningBalances, totals, validAmount, validDate } from '../src/personal/finance.ts';
import type { Account, Movement, Payment, PersonalBootstrap, Quota } from '../src/personal/types.ts';
import { catalogDraft, payDraft, transactionDraft, visibleFields } from '../src/personal/forms.ts';
import { buildPayload, validateExecutionDate } from '../src/personal/Editor.tsx';
import { personalReceiptUrl, validUploadFilename } from '../src/personal/receipts.ts';
import { csvCell, filterDescription, reportData, reportWorkbook } from '../src/personal/reports.ts';
import { businessDateFields, displayDate, displayField, displayMonth, rowDisplay, timezoneToday } from '../src/personal/display.ts';
import { personalApi } from '../src/personal/api.ts';
const accounts: Account[] = [
  { ID: 'bank', UPDATED_AT: 'v', NOMBRE: 'Test bank', TIPO: 'Ahorros', ESTADO: 'Activa', SALDO_INICIAL: 100, DEUDA_INICIAL: 0, SALDO_ACTUAL: 158, DEUDA_ACTUAL: null, CREDITO_DISPONIBLE: null },
  { ID: 'cash', UPDATED_AT: 'v', NOMBRE: 'Test cash', TIPO: 'Efectivo', ESTADO: 'Activa', SALDO_INICIAL: 0, DEUDA_INICIAL: 0, SALDO_ACTUAL: 20, DEUDA_ACTUAL: null, CREDITO_DISPONIBLE: null },
  { ID: 'card', UPDATED_AT: 'v', NOMBRE: 'Test card', TIPO: 'Tarjeta de cr\u00e9dito', ESTADO: 'Activa', SALDO_INICIAL: 0, DEUDA_INICIAL: 50, SALDO_ACTUAL: null, DEUDA_ACTUAL: 70, CREDITO_DISPONIBLE: 430 },
];
function movement(ID: string, TIPO: string, MONTO: number, ASIENTOS: { CUENTA: string; CENTAVOS: number }[], patch: Partial<Movement> = {}): Movement { return { ID, TIPO, MONTO, ASIENTOS: JSON.stringify(ASIENTOS), CUENTA: 'bank', FECHA: '2026-10-12', UPDATED_AT: ID, ESTADO: 'Activo', ...patch }; }
const ledger = [movement('1', 'Ingreso', 100, [{ CUENTA: 'bank', CENTAVOS: 10000 }]), movement('2', 'Transferencia', 20, [{ CUENTA: 'bank', CENTAVOS: -2000 }, { CUENTA: 'cash', CENTAVOS: 2000 }]), movement('3', 'Gasto', 2, [{ CUENTA: 'bank', CENTAVOS: -200 }]), movement('4', 'Compra tarjeta', 40, [{ CUENTA: 'card', CENTAVOS: 4000 }], { CUENTA: 'card' }), movement('5', 'Pago tarjeta', 20, [{ CUENTA: 'bank', CENTAVOS: -2000 }, { CUENTA: 'card', CENTAVOS: -2000 }]), movement('6', 'Gasto', 999, [{ CUENTA: 'bank', CENTAVOS: -99900 }], { ESTADO: 'Anulado' })];
const q: Quota = { ID: 'q', UPDATED_AT: 'v', TITULO: 'Test quota', MONTO: 30, FECHA_VENCIMIENTO: '2026-10-11', ESTADO: 'Pendiente', PAGADO: 5, PENDIENTE: 25, ESTADO_ACTUAL: 'Pago parcial', VENCIDO: true, PROXIMO: false };
const payments: Payment[] = [{ ID: 'p', UPDATED_AT: 'v', CUOTA: 'q', MOVIMIENTO: '3', FECHA: '2026-10-12', MONTO: 5, ESTADO: 'Activo' }, { ID: 'void', UPDATED_AT: 'v', CUOTA: 'q', MOVIMIENTO: '6', FECHA: '2026-10-12', MONTO: 25, ESTADO: 'Anulado' }];
const data: PersonalBootstrap = { cuentas: accounts, movimientos: ledger, obligaciones: [q], pagos: payments, categorias: [], beneficiarios: [], recurrentes: [], transferencias: [], operacionesPendientes: [], hoy: '2026-10-12', configuracion: { MONEDA: 'USD', TIMEZONE: 'America/Guayaquil', DIAS_ALERTA: 7, PERMITIR_SOBREGIRO: false, METODOS: [], CANAL_EMAIL: '', UPLOAD_ENABLED: false, HOY: '2026-10-12' } };
test('personal ledger uses cents, credit-positive means debt; cash excludes cards and annulled rows', () => { const b = runningBalances(accounts, ledger).get('6')!; assert.equal(b.get('bank'), 158); assert.equal(b.get('cash'), 20); assert.equal(b.get('card'), 70); assert.equal(historicalCash(accounts, ledger), 178); assert.equal(historicalCash(accounts, ledger, '2026-10-11'), 100); assert.equal(historicalCash(accounts, ledger, '', 'bank'), 158); assert.deepEqual(postings({ ...ledger[0], ASIENTOS: 'bad' }), []); });
test('income/expense excludes transfers and card payments but includes fee and full card purchase', () => { assert.deepEqual(totals(ledger), { income: 100, expense: 42 }); });
test('payment allocation and partial/complete/annulled quota states never duplicate ledger expense', () => { assert.equal(allocated('q', payments), 5); assert.equal(quotaState(q, payments), 'Pago parcial'); assert.equal(quotaState(q, [...payments, { ...payments[0], ID: 'p2', MONTO: 25 }]), 'Pagado'); assert.equal(quotaState({ ...q, ESTADO: 'Anulado' }, payments), 'Anulado'); assert.equal(quotaState(q, []), 'Pendiente'); });
test('Gregorian dates and amount precision validated without timezone shifts', () => { assert.equal(validDate('2024-02-29'), true); for (const d of ['2026-02-29', '2026-04-31', '1899-12-31', '2026-1-01']) assert.equal(validDate(d), false); assert.equal(validAmount(0.01), true); for (const n of [0, -1, 0.001, Infinity, 1e9 + 1]) assert.equal(validAmount(n), false); assert.equal(validAmount(0, false), true); assert.equal(dateAdd('2026-12-31', 1), '2027-01-01'); assert.equal(dayDistance('2026-10-12', '2026-10-13'), 1); });
test('monthly clamp and card metadata next dates are information only', () => { assert.equal(monthlyDate('2026-02', 31), '2026-02-28'); assert.equal(monthlyDate('2024-02', 31), '2024-02-29'); assert.equal(nextCardDate('2026-12-31', 30), '2027-01-30'); assert.equal(nextCardDate('2026-10-12', 12), '2026-10-12'); });
test('alerts cover overdue, today, tomorrow, <=3, <=7, month, partial and installments', () => { assert.deepEqual(alerts(q, data.hoy), ['Vencido', 'Este mes', 'Pago parcial']); for (const [date, expected] of [['2026-10-12', 'Hoy'], ['2026-10-13', 'Ma\u00f1ana'], ['2026-10-15', 'En 3 d\u00edas'], ['2026-10-19', 'En 7 d\u00edas']]) assert.ok(alerts({ ...q, FECHA_VENCIMIENTO: date, TARJETA: 'card' }, data.hoy).includes(expected)); assert.ok(alerts({ ...q, TARJETA: 'card' }, data.hoy).includes('Cuota de tarjeta')); assert.deepEqual(alerts({ ...q, PENDIENTE: 0 }, data.hoy), []); });
test('calendar is six Monday-start weeks spanning month boundaries', () => { const cells = calendarCells('2026-10'); assert.equal(cells.length, 42); assert.equal(cells[0], '2026-09-28'); assert.equal(cells[41], '2026-11-08'); });
test('ten indicators use backend cash, separate credit debt and selected monthly ledger', () => { const result = indicators(data); assert.equal(result.length, 10); assert.equal(result[0][1], 178); assert.equal(result[2][1], 25); assert.equal(result[4][1], 5); assert.equal(result[5][1], 42); assert.equal(result[6][1], 100); assert.equal(result[7][1], 70); });
test('combined date, amount, account, type, state and query filters are stable', () => { const f = { ...emptyFilters(), from: '2026-10-01', to: '2026-10-31', month: '2026-10', year: '2026', account: 'bank', type: 'Ingreso', state: 'Activo', min: '99', max: '100', query: 'Test bank' }; assert.deepEqual(filterRows(ledger, f, data).map(m => m.ID), ['1']); assert.equal(filterRows(ledger, { ...f, max: '99' }, data).length, 0); assert.equal(filterRows([q], { ...emptyFilters(), due: 'overdue' }, data).length, 1); });
test('catalog payload strips server metadata and schedule keys; optional fields can clear on audited edit', () => { const d = catalogDraft('Cuotas', data, { ...q, DEFINICION: 'server', TARJETA: 'card', FECHA_PROGRAMADA: '2026-10-11', CLAVE_PERIODO: 'immutable', USERNAME: 'test', OP_ID: 'operation', OBSERVACIONES: 'before' }); d.values.OBSERVACIONES = ''; const row = buildPayload(d).row as Record<string, unknown>; assert.equal(row.ID, 'q'); assert.equal(row.UPDATED_AT, 'v'); assert.equal(row.OBSERVACIONES, ''); for (const key of ['DEFINICION', 'TARJETA', 'FECHA_PROGRAMADA', 'CLAVE_PERIODO', 'USERNAME', 'OP_ID', 'PAGADO']) assert.equal(key in row, false); });
test('opening balance and type stay locked even with annulled confirmed history', () => { const d = catalogDraft('Cuentas', { ...data, movimientos: ledger.map(m => ({ ...m, ESTADO: 'Anulado' })) }, accounts[0]); for (const key of ['TIPO', 'SALDO_INICIAL', 'DEUDA_INICIAL']) assert.equal(d.fields.find(f => f.key === key)?.readOnly, true); });
test('card installments require bank payment source; ordinary quotas may use active credit', () => { assert.equal(payDraft({ ...q, TARJETA: 'card' }, data).fields.find(f => f.key === 'CUENTA')?.options?.some(o => o.value === 'card'), false); assert.equal(payDraft(q, data).fields.find(f => f.key === 'CUENTA')?.options?.some(o => o.value === 'card'), true); });
test('transfer form excludes credit and demands a fee expense category; no equal endpoints', () => { const d = transactionDraft('transfer', data); d.values = { FECHA: data.hoy, DESCRIPCION: 'Test', MONTO: 1, CUENTA: 'bank', DESTINO: 'cash', COMISION: 1 }; assert.equal(d.fields.find(f => f.key === 'CUENTA')?.options?.some(o => o.value === 'card'), false); assert.throws(() => buildPayload(d), /comisi/); d.values.COMISION = 0; d.values.DESTINO = 'bank'; assert.throws(() => buildPayload(d), /distintos/); });
test('receipt URLs obey stricter personal GAS rule and preserve allowed Drive queries intact', () => {
  const base = 'https://drive.google.com/file/d/test_private_id/view';
  const valid = [base, `${base}?usp=sharing`, `${base}?usp=drive_link&resourcekey=test_key-123`, 'https://drive.google.com/file/d/test_private_id/preview?resourcekey=test_key&usp=sharing', 'https://drive.google.com/open?id=test_private_id&usp=sharing&resourcekey=test_key', `${base}?q=AZaz09_=%25&.~+-`, `${base}?`, 'https://drive.google.com/open?id=test_private_id&'];
  const boundary = `${base}?resourcekey=` + 'a'.repeat(300 - `${base}?resourcekey=`.length);
  valid.push(boundary);
  for (const url of valid) assert.equal(personalReceiptUrl(url), url, url);
  for (const url of [
    'javascript:alert(1)', 'https://drive.google.com/file/d/short/view?usp=sharing', 'https://drive.google.com/open?id=short&resourcekey=test_key',
    'http://drive.google.com/file/d/test_private_id/view', 'https://drive.google.com.evil.test/file/d/test_private_id/view',
    'https://user@drive.google.com/file/d/test_private_id/view', 'https://drive.google.com:443/file/d/test_private_id/view',
    'https://drive.google.com/drive/folders/test_private_id?usp=sharing', 'https://drive.google.com/file/d/test_private_id/edit',
    `${base}#fragment`, `${base}?usp=sharing#fragment`, `${base}?q=white space`, `${base}?q=path/value`, `${base}?q=@value`, `${base}\n`,
    'https://drive.google.com/open?usp=sharing&id=test_private_id', boundary + 'a',
  ]) assert.equal(personalReceiptUrl(url), null, url);
});
test('receipt query strings survive financial payload validation and report exports', () => {
  const url = 'https://drive.google.com/file/d/test_private_id/view?usp=drive_link&resourcekey=test_key';
  const d = transactionDraft('transfer', data); d.values = { FECHA: data.hoy, DESCRIPCION: 'Test receipt query', MONTO: 1, CUENTA: 'bank', DESTINO: 'cash', COMPROBANTE_URL: url };
  assert.equal(buildPayload(d).COMPROBANTE_URL, url);
  const table = reportData([{ ...ledger[0], COMPROBANTE_URL: url }], data);
  assert.equal(table.rows[0][table.keys.indexOf('COMPROBANTE_URL')], url);
});
test('CSV formula cells remain sanitized', () => { for (const value of ['=SUM(A1)', '+1', '-1', '@test', '  =formula']) assert.ok(csvCell(value).startsWith('"\'')); assert.equal(csvCell(2.5), '"2.5"'); assert.equal(csvCell('a"b'), '"a""b"'); });
test('personal API rejects non-whitelisted actions and bootstrap query/body attempts before fetch', () => { for (const action of ['movements', 'statistics', 'create', 'personal-bootstrap', 'unknown']) assert.throws(() => personalApi(action as never), /no permitida/); assert.throws(() => personalApi('bootstrap', { filters: {} }), /no permitida/); assert.throws(() => personalApi('save'), /no permitida/); });
test('cash does not disappear when catalog account becomes inactive; dates beyond 9999 not invented', () => { assert.equal(indicators({ ...data, cuentas: accounts.map(a => ({ ...a, ESTADO: 'Inactiva' })) })[0][1], 178); assert.equal(nextCardDate('9999-12-31', 30), 'Fuera de rango'); });
test('dashboard chart aggregates use active selected ledger, include fees/card purchases, exclude transfer principal and card payment expense', () => {
  const source = { ...data, categorias: [{ ID: 'cat', UPDATED_AT: 'v', NOMBRE: 'Test category', ESTADO: 'Activa', TIPO: 'Gasto' }] };
  const selected = ledger.map(m => ({ ...m, CATEGORIA: 'cat', METODO: 'Cheque' }));
  selected.push(movement('future', 'Gasto', 8, [{ CUENTA: 'bank', CENTAVOS: -800 }], { FECHA: '2027-01-15', CATEGORIA: 'cat', METODO: 'Efectivo' }));
  const charts = dashboardCharts(selected, [q], source);
  assert.deepEqual(charts.monthly, [{ month: '2026-10', ingresos: 100, gastos: 42 }, { month: '2027-01', ingresos: 0, gastos: 8 }]);
  assert.deepEqual(charts.categories, [{ name: 'Test category', amount: 50, events: 3 }]);
  assert.deepEqual(charts.methods, [{ name: 'Cheque', amount: 22, events: 2 }, { name: 'Efectivo', amount: 8, events: 1 }]);
  assert.deepEqual(charts.settlement, [{ name: 'Pagado', amount: 5 }, { name: 'Pendiente', amount: 25 }]);
  assert.deepEqual(dashboardCharts([], [], data), { monthly: [], categories: [], methods: [], settlement: [] });
});
test('payment method events do not duplicate movements with multiple active quota allocations', () => {
  const source = { ...data, pagos: [...payments, { ...payments[0], ID: 'second-allocation', CUOTA: 'other', MONTO: 1 }] };
  const charts = dashboardCharts(ledger, [q, { ...q, ID: 'annulled', ESTADO: 'Anulado', ESTADO_ACTUAL: 'Anulado' }], source);
  assert.equal(charts.methods.reduce((s, r) => s + r.events, 0), 2);
  assert.equal(charts.methods.reduce((s, r) => s + r.amount, 0), 22);
  assert.deepEqual(charts.settlement, [{ name: 'Pagado', amount: 5 }, { name: 'Pendiente', amount: 25 }]);
});
test('business date display is DD/MM/AAAA without changing canonical inputs; actual spreadsheet date respects timezone', () => {
  for (const key of businessDateFields) assert.equal(displayField(key, '2024-02-29', 'America/Guayaquil'), '29/02/2024');
  assert.equal(displayDate('9999-12-31'), '31/12/9999'); assert.equal(displayMonth('2026-10'), '10/2026');
  assert.equal(timezoneToday('America/Guayaquil', new Date('2026-10-13T04:59:59Z')), '2026-10-12');
  assert.equal(timezoneToday('America/Guayaquil', new Date('2026-10-13T05:00:00Z')), '2026-10-13');
  assert.equal(timezoneToday('Asia/Tokyo', new Date('2026-10-12T16:00:00Z')), '2026-10-13');
  assert.equal(ledger[0].FECHA, '2026-10-12'); assert.match(rowDisplay('ASIENTOS', ledger[0].ASIENTOS, data), /Test bank: 100.00 USD/);
});
test('reports use Spanish fields, formatted display dates, numeric Excel dates and amounts, no raw postings or formula cells', async () => {
  const rows = [{ ...ledger[0], DESCRIPCION: '=TEST-FORMULA', INICIO: '1900-01-01', FIN: '2026-10-31', FECHA_APERTURA: '2024-02-29' }];
  const table = reportData(rows, data); assert.ok(table.headers.includes('Fecha')); assert.ok(table.headers.includes('Monto USD')); assert.equal(table.headers.includes('ASIENTOS'), false);
  assert.equal(table.rows[0][table.keys.indexOf('FECHA')], '12/10/2026');
  const XLSX = await import('xlsx'); const book = await reportWorkbook(rows, data, 'movimientos', 'Desde 01/10/2026');
  for (const key of ['FECHA', 'INICIO', 'FIN', 'FECHA_APERTURA']) { const cell = book.Sheets.Personal[XLSX.utils.encode_cell({ r: 5, c: table.keys.indexOf(key) })]; assert.equal(cell.t, 'n'); assert.equal(cell.z, 'dd/mm/yyyy'); assert.equal(XLSX.SSF.format(cell.z, cell.v), displayDate(String(rows[0][key as keyof typeof rows[0]]))); }
  const amount = book.Sheets.Personal[XLSX.utils.encode_cell({ r: 5, c: table.keys.indexOf('MONTO') })]; assert.equal(amount.t, 'n'); assert.equal(amount.v, 100);
  const formula = book.Sheets.Personal[XLSX.utils.encode_cell({ r: 5, c: table.keys.indexOf('DESCRIPCION') })]; assert.equal(formula.t, 's'); assert.equal(formula.f, undefined);
  assert.equal(filterDescription({ ...emptyFilters(), from: '2026-10-01', to: '2026-10-31', account: 'bank' }, data), 'Desde: 01/10/2026 | Hasta: 31/10/2026 | Cuenta: Test bank');
});
test('recipient sorting resolves quota allocations and linked payments; combined account/method filters use same confirmed event', () => {
  const source = { ...data, beneficiarios: [{ ID: 'a', UPDATED_AT: 'v', NOMBRE: 'Ana' }, { ID: 'z', UPDATED_AT: 'v', NOMBRE: 'Zoe' }], obligaciones: [{ ...q, BENEFICIARIO: 'z' }, { ...q, ID: 'qa', BENEFICIARIO: 'a' }], movimientos: [{ ...ledger[2], METODO: 'Cheque' }, { ...ledger[4], METODO: 'Efectivo', CUENTA: 'cash' }], pagos: [...payments, { ...payments[0], ID: 'pa', CUOTA: 'qa' }, { ...payments[0], ID: 'cash-payment', MOVIMIENTO: '5' }] };
  assert.deepEqual(filterRows(source.pagos, { ...emptyFilters(), sort: 'person' }, source).filter(p => p.ESTADO === 'Activo').map(p => p.ID), ['pa', 'p', 'cash-payment']);
  assert.equal(filterRows(source.obligaciones, { ...emptyFilters(), account: 'bank', method: 'Cheque' }, source).length, 2);
  assert.equal(filterRows(source.obligaciones, { ...emptyFilters(), account: 'bank', method: 'Efectivo' }, source).length, 0);
});
test('upload filenames enforce 120-character limit and reject leading dots/control characters/paths before reading bytes', () => {
  assert.equal(validUploadFilename('a'.repeat(116) + '.pdf'), true);
  for (const name of ['a'.repeat(117) + '.pdf', '.hidden.pdf', ' .hidden.pdf', 'path/file.pdf', 'path\\file.pdf', 'test\u0000.pdf', ' ']) assert.equal(validUploadFilename(name), false);
});
test('account currency is explicit USD on creation and missing-currency edits, with no conversion or other selectable currency', () => {
  for (const type of ['Ahorros', 'Corriente', 'Efectivo', 'Tarjeta de cr\u00e9dito', 'Otra']) {
    const d = catalogDraft('Cuentas', data); d.values.NOMBRE = 'Test USD account'; d.values.TIPO = type;
    const field = visibleFields(d).find(f => f.key === 'MONEDA')!;
    assert.equal(field.label, 'Moneda'); assert.equal(field.required, true); assert.equal(field.readOnly, undefined);
    assert.deepEqual(field.options, [{ value: 'USD', label: 'USD' }]); assert.equal(d.values.MONEDA, 'USD');
    assert.equal((buildPayload(d).row as Record<string, unknown>).MONEDA, 'USD');
    d.values.MONEDA = 'EUR'; assert.throws(() => buildPayload(d), /Moneda/);
    d.values.MONEDA = ''; assert.throws(() => buildPayload(d), /Completa Moneda/);
  }
  const oldAccount = { ...accounts[0] }; const d = catalogDraft('Cuentas', data, oldAccount);
  assert.equal(oldAccount.MONEDA, undefined); assert.equal(d.values.MONEDA, 'USD');
  const row = buildPayload(d).row as Record<string, unknown>; assert.equal(row.MONEDA, 'USD'); assert.equal(row.SALDO_INICIAL, 100); assert.equal(row.UPDATED_AT, 'v');
  const table = reportData([{ ...oldAccount, MONEDA: 'USD' }], data); assert.equal(table.headers[table.keys.indexOf('MONEDA')], 'Moneda'); assert.equal(table.rows[0][table.keys.indexOf('MONEDA')], 'USD');
});
test('concrete statement dates are optional, card-only, canonical, and due must be on or after closing', () => {
  const d = catalogDraft('Cuentas', data); d.values.NOMBRE = 'Test dated card'; d.values.TIPO = 'Tarjeta de cr\u00e9dito';
  assert.equal(d.values.FECHA_CORTE, undefined); assert.equal(d.values.FECHA_MAXIMA_PAGO, undefined);
  let row = buildPayload(d).row as Record<string, unknown>; assert.equal('FECHA_CORTE' in row, false); assert.equal('FECHA_MAXIMA_PAGO' in row, false);
  d.values.FECHA_CORTE = '2026-10-01'; d.values.FECHA_MAXIMA_PAGO = '2026-10-01'; row = buildPayload(d).row as Record<string, unknown>; assert.equal(row.FECHA_CORTE, '2026-10-01'); assert.equal(row.FECHA_MAXIMA_PAGO, '2026-10-01');
  d.values.FECHA_MAXIMA_PAGO = '2026-09-30'; assert.throws(() => buildPayload(d), /igual o posterior/);
  d.values.FECHA_MAXIMA_PAGO = '2026-02-30'; assert.throws(() => buildPayload(d), /Fecha inv/);
  d.values.TIPO = 'Ahorros'; assert.equal(visibleFields(d).some(f => ['FECHA_CORTE', 'FECHA_MAXIMA_PAGO'].includes(f.key)), false); row = buildPayload(d).row as Record<string, unknown>; assert.equal('FECHA_CORTE' in row, false); assert.equal('FECHA_MAXIMA_PAGO' in row, false);
  const edit = catalogDraft('Cuentas', data, { ...accounts[2], FECHA_CORTE: '2026-10-01', FECHA_MAXIMA_PAGO: '2026-10-15' }); edit.values.FECHA_CORTE = ''; edit.values.FECHA_MAXIMA_PAGO = ''; row = buildPayload(edit).row as Record<string, unknown>; assert.equal('FECHA_CORTE' in row, false); assert.equal('FECHA_MAXIMA_PAGO' in row, false);
});
test('card statement alerts use backend snapshot, not monthly days, debt inference or duplicated quota allocations', () => {
  const declared = { ...accounts[2], PAGO_TOTAL_ESTADO: 50, FECHA_CORTE: '2026-10-01', FECHA_MAXIMA_PAGO: '2026-10-10', SALDO_ESTADO_PENDIENTE: 8, ESTADO_CUENTA_VENCIDO: true, ESTADO_CUENTA_PROXIMO: false };
  assert.deepEqual(cardStatement(declared), { declared: true, remaining: 8, overdue: true, upcoming: false, status: 'Vencido' });
  assert.equal(cardStatement({ ...declared, ESTADO_CUENTA_VENCIDO: false, ESTADO_CUENTA_PROXIMO: true }).status, 'Proximo');
  assert.deepEqual(cardStatement({ ...declared, SALDO_ESTADO_PENDIENTE: 0 }), { declared: true, remaining: 0, overdue: false, upcoming: false, status: 'Pagado' });
  for (const row of [accounts[2], { ...declared, FECHA_CORTE: '' }, { ...declared, PAGO_TOTAL_ESTADO: 0 }, { ...declared, SALDO_ESTADO_PENDIENTE: null }, { ...declared, SALDO_ESTADO_PENDIENTE: undefined }, { ...declared, TIPO: 'Ahorros' }]) {
    const s = cardStatement(row); assert.equal(s.declared, false); assert.equal(s.remaining, null); assert.equal(s.overdue, false); assert.equal(s.upcoming, false);
  }
  assert.equal(cardStatement({ ...accounts[2], DIA_CORTE: 1, DIA_PAGO: 2 }).overdue, false);
  assert.equal(cardStatement({ ...declared, ESTADO_CUENTA_VENCIDO: undefined, ESTADO_CUENTA_PROXIMO: undefined }).status, 'Pendiente');
  const derived = indicators({ ...data, cuentas: [accounts[0], accounts[1], declared] }); assert.equal(derived[1][1], 25); assert.equal(derived[2][1], 25); assert.equal(derived[7][1], 70);
  assert.equal(displayField('FECHA_CORTE', declared.FECHA_CORTE, data.configuracion.TIMEZONE), '01/10/2026'); assert.equal(displayField('FECHA_MAXIMA_PAGO', declared.FECHA_MAXIMA_PAGO, data.configuracion.TIMEZONE), '10/10/2026');
});
test('generated card quota amount is read-only and exact in editable-title/date/notes payload; other commitments remain variable', () => {
  const installment = { ...q, TARJETA: 'card', FECHA_PROGRAMADA: '2026-10-11', CLAVE_PERIODO: 'server-key' }; const d = catalogDraft('Cuotas', data, installment);
  assert.equal(d.fields.find(f => f.key === 'MONTO')?.readOnly, true); d.values.TITULO = 'Updated title'; d.values.FECHA_VENCIMIENTO = '2026-10-20'; d.values.OBSERVACIONES = 'Updated notes';
  const row = buildPayload(d).row as Record<string, unknown>; assert.equal(row.MONTO, 30); assert.equal(row.FECHA_VENCIMIENTO, '2026-10-20'); assert.equal(row.TITULO, 'Updated title'); assert.equal(row.OBSERVACIONES, 'Updated notes'); assert.equal(row.UPDATED_AT, 'v');
  for (const key of ['TARJETA', 'FECHA_PROGRAMADA', 'CLAVE_PERIODO', 'PENDIENTE']) assert.equal(key in row, false);
  for (const quota of [q, { ...q, DEFINICION: 'test-recurring' }]) { const edit = catalogDraft('Cuotas', data, quota); assert.notEqual(edit.fields.find(f => f.key === 'MONTO')?.readOnly, true); edit.values.MONTO = 40; assert.equal((buildPayload(edit).row as Record<string, unknown>).MONTO, 40); }
});
test('actual execution dates cannot exceed server hoy; same-day and past operations remain valid', () => {
  for (const action of ['transaction', 'pay', 'reconcile'] as const) {
    assert.throws(() => validateExecutionDate(action, '2026-10-13', data.hoy), /compromiso pendiente/);
    for (const fecha of [data.hoy, '2026-10-11', '1900-01-01']) assert.doesNotThrow(() => validateExecutionDate(action, fecha, data.hoy));
    assert.throws(() => validateExecutionDate(action, '2026-02-30', data.hoy), /fecha real/);
    assert.throws(() => validateExecutionDate(action, data.hoy, ''), /fecha actual confirmada/);
  }
  assert.doesNotThrow(() => validateExecutionDate('transaction', '2026-10-13', '2026-10-13'));
});
test('future commitments, recurrence dates, first installments and statement dates remain scheduled metadata, not execution', () => {
  const manual = catalogDraft('Cuotas', data); manual.values = { TITULO: 'Test future commitment', MONTO: 10, FECHA_VENCIMIENTO: '2027-01-15' }; const row = buildPayload(manual).row as Record<string, unknown>; assert.equal(row.FECHA_VENCIMIENTO, '2027-01-15'); assert.doesNotThrow(() => validateExecutionDate(manual.action, undefined, data.hoy));
  const recurring = catalogDraft('Obligaciones', data); recurring.values = { TITULO: 'Test future recurrence', MONTO: 10, FRECUENCIA: 'Mensual', INICIO: '2027-01-15', FIN: '2027-12-15' }; assert.equal((buildPayload(recurring).row as Record<string, unknown>).INICIO, '2027-01-15');
  const purchase = transactionDraft('cardpurchase', { ...data, categorias: [{ ID: 'test-gasto', UPDATED_AT: 'v', NOMBRE: 'Test category', TIPO: 'Gasto', ESTADO: 'Activa' }] }); purchase.values = { FECHA: data.hoy, DESCRIPCION: 'Actual purchase, scheduled future installment', MONTO: 10, CUENTA: 'card', CATEGORIA: 'test-gasto', PRIMER_VENCIMIENTO: '2027-01-15' }; const payload = buildPayload(purchase); assert.equal(payload.PRIMER_VENCIMIENTO, '2027-01-15'); assert.doesNotThrow(() => validateExecutionDate(purchase.action, payload.FECHA, data.hoy));
  const statement = catalogDraft('Cuentas', data, accounts[2]); statement.values.FECHA_CORTE = '2027-01-01'; statement.values.FECHA_MAXIMA_PAGO = '2027-01-15'; assert.equal((buildPayload(statement).row as Record<string, unknown>).FECHA_MAXIMA_PAGO, '2027-01-15');
  assert.doesNotThrow(() => validateExecutionDate('generate', '2027-01-15', data.hoy));
});
