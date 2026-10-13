import type { Account, Movement, Payment, PersonalBootstrap, Quota, Row } from './types';
export const money = (n: number) => new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(n);
export const card = (a: Row) => a.TIPO === 'Tarjeta de cr\u00e9dito';
export const cents = (n: number) => Math.round(n * 100);
export function cardStatement(account: Row) {
  const remaining = card(account) && typeof account.SALDO_ESTADO_PENDIENTE === 'number' && Number.isFinite(account.SALDO_ESTADO_PENDIENTE) && account.SALDO_ESTADO_PENDIENTE >= 0 ? account.SALDO_ESTADO_PENDIENTE : null;
  const declared = remaining !== null && Number(account.PAGO_TOTAL_ESTADO) > 0 && validDate(String(account.FECHA_CORTE || '')) && validDate(String(account.FECHA_MAXIMA_PAGO || ''));
  const overdue = declared && remaining! > 0 && account.ESTADO_CUENTA_VENCIDO === true;
  const upcoming = declared && remaining! > 0 && account.ESTADO_CUENTA_PROXIMO === true;
  return { declared, remaining: declared ? remaining : null, overdue, upcoming, status: !declared ? 'Sin estado confirmado' : remaining === 0 ? 'Pagado' : overdue ? 'Vencido' : upcoming ? 'Proximo' : 'Pendiente' };
}
export function validAmount(n: number, positive = true): boolean { return Number.isFinite(n) && n <= 1e9 && (positive ? n > 0 : n >= 0) && Math.abs(n * 100 - Math.round(n * 100)) < 0.00001; }
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  return y >= 1900 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function dateAdd(value: string, days: number): string { const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export function dayDistance(from: string, to: string): number { return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000); }
export function monthlyDate(month: string, day: number): string { const [y, m] = month.split('-').map(Number); return `${month}-${String(Math.min(day, new Date(Date.UTC(y, m, 0)).getUTCDate())).padStart(2, '0')}`; }
export function nextCardDate(today: string, day: number): string { const first = monthlyDate(today.slice(0, 7), day); if (first >= today) return first; if (today.slice(0, 7) === '9999-12') return 'Fuera de rango'; return monthlyDate(dateAdd(`${today.slice(0, 7)}-28`, 5).slice(0, 7), day); }
export function postings(m: Movement): { CUENTA: string; CENTAVOS: number }[] {
  try { const p: unknown = JSON.parse(m.ASIENTOS); return Array.isArray(p) ? p.filter(v => typeof v?.CUENTA === 'string' && Number.isSafeInteger(v.CENTAVOS)) : []; } catch { return []; }
}
export function runningBalances(accounts: Account[], movements: Movement[]) {
  const balances = new Map(accounts.map(a => [a.ID, cents(Number(card(a) ? a.DEUDA_INICIAL : a.SALDO_INICIAL) || 0)]));
  const result = new Map<string, Map<string, number>>();
  for (const m of [...movements].sort((a, b) => a.FECHA.localeCompare(b.FECHA) || a.UPDATED_AT.localeCompare(b.UPDATED_AT) || a.ID.localeCompare(b.ID))) {
    if (m.ESTADO === 'Activo') for (const p of postings(m)) balances.set(p.CUENTA, (balances.get(p.CUENTA) || 0) + p.CENTAVOS);
    result.set(m.ID, new Map([...balances].map(([id, amount]) => [id, amount / 100])));
  }
  return result;
}
export function historicalCash(accounts: Account[], movements: Movement[], until = '', account = ''): number {
  const ids = new Set(accounts.filter(a => !card(a) && (!account || a.ID === account)).map(a => a.ID));
  return (accounts.filter(a => ids.has(a.ID)).reduce((s, a) => s + cents(a.SALDO_INICIAL || 0), 0) + movements.filter(m => m.ESTADO === 'Activo' && (!until || m.FECHA <= until)).reduce((s, m) => s + postings(m).filter(p => ids.has(p.CUENTA)).reduce((v, p) => v + p.CENTAVOS, 0), 0)) / 100;
}
export function totals(rows: Movement[]) { const active = rows.filter(m => m.ESTADO === 'Activo'); return { income: active.filter(m => m.TIPO === 'Ingreso').reduce((s, m) => s + cents(m.MONTO), 0) / 100, expense: active.filter(m => ['Gasto', 'Compra tarjeta'].includes(m.TIPO)).reduce((s, m) => s + cents(m.MONTO), 0) / 100 }; }
export function dashboardCharts(selected: Movement[], quotas: Quota[], data: PersonalBootstrap) {
  const active = selected.filter(m => m.ESTADO === 'Activo');
  const financial = active.filter(m => ['Ingreso', 'Gasto', 'Compra tarjeta'].includes(m.TIPO));
  const monthly = [...new Set(financial.map(m => m.FECHA.slice(0, 7)))].sort().map(month => {
    const t = totals(financial.filter(m => m.FECHA.startsWith(month)));
    return { month, ingresos: t.income, gastos: t.expense };
  });
  const grouped = (rows: Movement[], key: string, name: (id: string) => string) => {
    const groups = new Map<string, { name: string; amount: number; events: number }>();
    for (const m of rows) { const id = String(m[key] || ''); const previous = groups.get(id) || { name: name(id), amount: 0, events: 0 }; previous.amount += cents(m.MONTO); previous.events++; groups.set(id, previous); }
    return [...groups.values()].map(g => ({ ...g, amount: g.amount / 100 })).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  };
  const categories = grouped(active.filter(m => ['Gasto', 'Compra tarjeta'].includes(m.TIPO)), 'CATEGORIA', id => label(data.categorias, id) || 'Sin categoria');
  const paymentMovements = new Set(data.pagos.filter(p => p.ESTADO === 'Activo').map(p => p.MOVIMIENTO));
  const methods = grouped(active.filter(m => ['Gasto', 'Pago tarjeta'].includes(m.TIPO) || paymentMovements.has(m.ID)), 'METODO', id => id || 'Sin metodo registrado');
  const issued = quotas.filter(q => q.ESTADO_ACTUAL !== 'Anulado' && q.ESTADO !== 'Anulado');
  const paidCents = issued.reduce((s, q) => s + cents(allocated(q.ID, data.pagos)), 0);
  const pendingCents = issued.reduce((s, q) => s + Math.max(0, cents(q.MONTO) - cents(allocated(q.ID, data.pagos))), 0);
  return { monthly, categories, methods, settlement: issued.length ? [{ name: 'Pagado', amount: paidCents / 100 }, { name: 'Pendiente', amount: pendingCents / 100 }] : [] };
}
export function allocated(quotaId: string, payments: Payment[]): number { return payments.filter(p => p.CUOTA === quotaId && p.ESTADO === 'Activo').reduce((s, p) => s + cents(p.MONTO), 0) / 100; }
export function quotaState(q: Quota, payments: Payment[]): string { if (q.ESTADO === 'Anulado') return 'Anulado'; const paid = allocated(q.ID, payments); return paid >= q.MONTO ? 'Pagado' : paid > 0 ? 'Pago parcial' : 'Pendiente'; }
export function alerts(q: Quota, today: string): string[] {
  if (q.PENDIENTE <= 0 || q.ESTADO_ACTUAL === 'Anulado') return [];
  const days = dayDistance(today, q.FECHA_VENCIMIENTO);
  return [days < 0 ? 'Vencido' : days === 0 ? 'Hoy' : days === 1 ? 'Ma\u00f1ana' : days <= 3 ? 'En 3 d\u00edas' : days <= 7 ? 'En 7 d\u00edas' : '', q.FECHA_VENCIMIENTO.slice(0, 7) === today.slice(0, 7) ? 'Este mes' : '', q.PAGADO > 0 ? 'Pago parcial' : '', q.TARJETA ? 'Cuota de tarjeta' : ''].filter(Boolean);
}
export function indicators(data: PersonalBootstrap, selected = data.movimientos, quotas = data.obligaciones) {
  const month = data.hoy.slice(0, 7); const t = totals(selected.filter(m => m.FECHA.startsWith(month)));
  const pending = quotas.filter(q => q.ESTADO_ACTUAL !== 'Anulado' && q.PENDIENTE > 0);
  return [ ['Disponible actual (efectivo, incluso cuentas inactivas)', data.cuentas.filter(a => !card(a)).reduce((s, a) => s + cents(a.SALDO_ACTUAL || 0), 0) / 100], ['Obligaciones pendientes', pending.reduce((s, q) => s + cents(q.PENDIENTE), 0) / 100], ['Vencido', pending.filter(q => q.FECHA_VENCIMIENTO < data.hoy).reduce((s, q) => s + cents(q.PENDIENTE), 0) / 100], ['Pr\u00f3ximo a vencer', pending.filter(q => dayDistance(data.hoy, q.FECHA_VENCIMIENTO) >= 0 && dayDistance(data.hoy, q.FECHA_VENCIMIENTO) <= data.configuracion.DIAS_ALERTA).reduce((s, q) => s + cents(q.PENDIENTE), 0) / 100], ['Pagado este mes (asignaciones a cuotas)', data.pagos.filter(p => p.ESTADO === 'Activo' && p.FECHA.startsWith(month) && selected.some(m => m.ID === p.MOVIMIENTO)).reduce((s, p) => s + cents(p.MONTO), 0) / 100], ['Gastos este mes', t.expense], ['Ingresos este mes', t.income], ['Deuda de tarjetas', data.cuentas.filter(card).reduce((s, a) => s + cents(a.DEUDA_ACTUAL || 0), 0) / 100], ['Pendiente este mes', pending.filter(q => q.FECHA_VENCIMIENTO.startsWith(month)).reduce((s, q) => s + cents(q.PENDIENTE), 0) / 100], ['Pagos parciales pendientes', pending.filter(q => q.PAGADO > 0).reduce((s, q) => s + cents(q.PENDIENTE), 0) / 100] ] as [string, number][];
}
export interface Filters { query: string; from: string; to: string; month: string; year: string; account: string; bank: string; person: string; category: string; type: string; method: string; state: string; due: string; recurring: string; min: string; max: string; sort: string }
export const emptyFilters = (): Filters => ({ query: '', from: '', to: '', month: '', year: '', account: '', bank: '', person: '', category: '', type: '', method: '', state: '', due: '', recurring: '', min: '', max: '', sort: 'date' });
export const label = (rows: Row[], id: unknown) => String(rows.find(r => r.ID === id)?.NOMBRE || id || '');
export function filterRows<T extends Row>(rows: T[], f: Filters, data: PersonalBootstrap): T[] {
  return rows.filter(r => {
    const movement = data.movimientos.find(m => m.ID === r.MOVIMIENTO);
    const quota = data.obligaciones.find(q => q.ID === r.CUOTA);
    const context: Row = { ...quota, ...movement, ...r };
    const date = String(r.FECHA || r.FECHA_VENCIMIENTO || r.INICIO || r.FECHA_APERTURA || '');
    const accounts = [context.CUENTA, context.DESTINO, context.ORIGEN, context.TARJETA, r.ID];
    const paidMovements = data.pagos.filter(p => p.CUOTA === r.ID && p.ESTADO === 'Activo').map(p => data.movimientos.find(m => m.ID === p.MOVIMIENTO)).filter((m): m is Movement => !!m && m.ESTADO === 'Activo');
    const referenceMatch = [context, ...paidMovements.map(m => ({ ...m, ...r }))].some(candidate => {
      const ids = [candidate.CUENTA, candidate.DESTINO, candidate.ORIGEN, candidate.TARJETA, r.ID];
      return (!f.account || ids.includes(f.account)) && (!f.bank || ids.some(id => data.cuentas.some(a => a.ID === id && a.BANCO === f.bank))) && (!f.type || candidate.TIPO === f.type) && (!f.method || candidate.METODO === f.method);
    });
    const amount = Number(r.MONTO ?? r.VALOR ?? r.SALDO_ACTUAL ?? r.DEUDA_ACTUAL ?? 0);
    const invoice = data.pagos.filter(p => p.MOVIMIENTO === r.ID).map(p => `${p.FACTURA || ''} ${p.DOCUMENTO || ''} ${p.REFERENCIA || ''}`).join(' ');
    const search = `${Object.values(context).join(' ')} ${accounts.map(id => label(data.cuentas, id)).join(' ')} ${label(data.beneficiarios, context.BENEFICIARIO)} ${label(data.categorias, context.CATEGORIA)} ${invoice}`.toLocaleLowerCase();
    return referenceMatch && (!f.query || search.includes(f.query.toLocaleLowerCase())) && (!f.from || date >= f.from) && (!f.to || date <= f.to) && (!f.month || date.slice(0, 7) === f.month) && (!f.year || date.slice(0, 4) === f.year) && (!f.person || context.BENEFICIARIO === f.person) && (!f.category || context.CATEGORIA === f.category) && (!f.state || (r.ESTADO_ACTUAL || r.ESTADO) === f.state) && (!f.recurring || context.DEFINICION === f.recurring || r.ID === f.recurring) && (!f.min || amount >= Number(f.min)) && (!f.max || amount <= Number(f.max)) && (!f.due || (Number(context.PENDIENTE) > 0 && (f.due === 'overdue' ? String(context.FECHA_VENCIMIENTO || date) < data.hoy : dayDistance(data.hoy, String(context.FECHA_VENCIMIENTO || date)) >= 0 && dayDistance(data.hoy, String(context.FECHA_VENCIMIENTO || date)) <= data.configuracion.DIAS_ALERTA)));
  }).sort((a, b) => {
    const person = (r: Row) => label(data.beneficiarios, r.BENEFICIARIO || data.obligaciones.find(q => q.ID === r.CUOTA)?.BENEFICIARIO || data.movimientos.find(m => m.ID === r.MOVIMIENTO)?.BENEFICIARIO);
    return f.sort === 'amount' ? Number(a.MONTO || a.VALOR || 0) - Number(b.MONTO || b.VALOR || 0) : f.sort === 'person' ? person(a).localeCompare(person(b)) : String(a.FECHA || a.FECHA_VENCIMIENTO || a.INICIO || '').localeCompare(String(b.FECHA || b.FECHA_VENCIMIENTO || b.INICIO || ''));
  });
}
export function calendarCells(month: string): string[] { const first = `${month}-01`; const weekday = new Date(`${first}T12:00:00Z`).getUTCDay(); return Array.from({ length: 42 }, (_, i) => dateAdd(first, i - (weekday + 6) % 7)); }
