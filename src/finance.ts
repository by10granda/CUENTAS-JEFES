import type { AccountRow, Filters, Movement } from './types';

export const currency = (value: number) => new Intl.NumberFormat('es-EC', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2,
}).format(value);
export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const displayDate = (value: string) => {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
};
export const emptyFilters = (): Filters => ({ desde: '', hasta: '', jefe: '', cuenta: '', categoria: '', tipo: '', estado: '', formaPago: '', proveedor: '', buscar: '' });
export const isLive = (movement: Movement) => movement.ESTADO !== 'Anulado';
export const isExpense = (movement: Movement) => ['Gasto', 'Compra', 'Pago'].includes(movement.TIPO) && !movement.MOVIMIENTO_ORIGEN_ID;

export function linkedPaid(original: Movement, ledger: Movement[]): number {
  return roundMoney(ledger.reduce((sum, item) => sum + (isLive(item) && item.TIPO === 'Pago' && item.MOVIMIENTO_ORIGEN_ID === original.ID ? item.TOTAL : 0), 0));
}
export function pendingAmount(original: Movement, ledger: Movement[]): number {
  if (!isLive(original) || !isExpense(original)) return 0;
  return roundMoney(Math.max(0, original.TOTAL - original.PAGADO - linkedPaid(original, ledger)));
}
export function paidAmount(original: Movement, ledger: Movement[]): number {
  return isLive(original) ? roundMoney(original.PAGADO + (isExpense(original) ? linkedPaid(original, ledger) : 0)) : 0;
}
export function effectiveState(movement: Movement, ledger: Movement[]): 'Anulado' | 'Pagado' | 'Pago parcial' | 'Pendiente' {
  if (!isLive(movement)) return 'Anulado';
  if (pendingAmount(movement, ledger) === 0) return 'Pagado';
  return paidAmount(movement, ledger) > 0 ? 'Pago parcial' : 'Pendiente';
}
// The caller passes the common-filter selection; linked payments never add expenses.
export function expenseEvolution(selected: Movement[]): { fecha: string; gastos: number }[] {
  const daily = new Map<string, number>();
  for (const m of selected) {
    if (isLive(m) && isExpense(m)) daily.set(m.FECHA, (daily.get(m.FECHA) || 0) + m.TOTAL);
  }
  let gastos = 0;
  return [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, amount]) => {
    gastos = roundMoney(gastos + amount);
    return { fecha, gastos };
  });
}
export function cashFlow(movement: Movement): { income: number; expense: number } {
  if (!isLive(movement) || movement.TIPO === 'Transferencia') return { income: 0, expense: 0 };
  if (['Ingreso', 'Reembolso'].includes(movement.TIPO) || (['Préstamo', 'Adelanto'].includes(movement.TIPO) && movement.DIRECCION === 'Recibido')) {
    return { income: movement.TOTAL, expense: 0 };
  }
  return { income: 0, expense: ['Gasto', 'Compra', 'Pago'].includes(movement.TIPO) ? movement.PAGADO : movement.TOTAL };
}

// Balances use the full ledger up to the closing date, never category/search filters.
export function accountBalance(account: AccountRow, ledger: Movement[], through = ''): number {
  let balance = account.SALDO_INICIAL;
  for (const movement of ledger) {
    if (!isLive(movement) || movement.JEFE !== account.JEFE || (through && movement.FECHA > through)) continue;
    if (movement.TIPO === 'Transferencia') {
      if (movement.CUENTA === account.ID) balance -= movement.TOTAL;
      if (movement.CUENTA_DESTINO_ID === account.ID) balance += movement.TOTAL;
    } else if (movement.CUENTA === account.ID) {
      const flow = cashFlow(movement);
      balance += flow.income - flow.expense;
    }
  }
  return roundMoney(balance);
}
export function availableBalance(accounts: AccountRow[], ledger: Movement[], filters: Pick<Filters, 'jefe' | 'cuenta' | 'hasta'>): number {
  return roundMoney(accounts.filter(account => (!filters.jefe || account.JEFE === filters.jefe) && (!filters.cuenta || account.ID === filters.cuenta))
    .reduce((sum, account) => sum + accountBalance(account, ledger, filters.hasta), 0));
}
export function balanceEvolution(accounts: AccountRow[], ledger: Movement[], filters: Pick<Filters, 'jefe' | 'cuenta' | 'hasta'>): { fecha: string; saldo: number }[] {
  const selected = accounts.filter(a => (!filters.jefe || a.JEFE === filters.jefe) && (!filters.cuenta || a.ID === filters.cuenta));
  const ids = new Set(selected.map(a => a.ID));
  const daily = new Map<string, number>();
  for (const m of ledger) {
    if (!isLive(m) || (filters.hasta && m.FECHA > filters.hasta)) continue;
    let delta = 0;
    if (m.TIPO === 'Transferencia') {
      if (ids.has(m.CUENTA)) delta -= m.TOTAL;
      if (m.CUENTA_DESTINO_ID && ids.has(m.CUENTA_DESTINO_ID)) delta += m.TOTAL;
    } else if (ids.has(m.CUENTA)) { const flow = cashFlow(m); delta = flow.income - flow.expense; }
    if (ids.has(m.CUENTA) || (m.CUENTA_DESTINO_ID && ids.has(m.CUENTA_DESTINO_ID))) daily.set(m.FECHA, (daily.get(m.FECHA) || 0) + delta);
  }
  let saldo = roundMoney(selected.reduce((sum, a) => sum + a.SALDO_INICIAL, 0));
  return [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, delta]) => { saldo = roundMoney(saldo + delta); return { fecha, saldo }; });
}
// UI state filters use current obligations; the statistics API uses the stored state.
export function filterMovements(ledger: Movement[], filters: Filters): Movement[] {
  const search = filters.buscar.trim().toLocaleLowerCase('es');
  return ledger.filter(m =>
    (!filters.desde || m.FECHA >= filters.desde) && (!filters.hasta || m.FECHA <= filters.hasta) &&
    (!filters.jefe || m.JEFE === filters.jefe) &&
    (!filters.categoria || m.CATEGORIA === filters.categoria) && (!filters.tipo || m.TIPO === filters.tipo) &&
    (!filters.estado || effectiveState(m, ledger) === filters.estado) && (!filters.formaPago || m.FORMA_PAGO === filters.formaPago) &&
    (!filters.proveedor || m.PROVEEDOR === filters.proveedor) &&
    (!search || [m.ID, m.DESCRIPCION, m.PROVEEDOR, m.NUMERO_FACTURA, m.FACTURA, m.OBSERVACIONES].some(value => value?.toLocaleLowerCase('es').includes(search)))
  );
}
export function summarizeMovements(selected: Movement[], ledger: Movement[]) {
  const live = selected.filter(isLive);
  const expenses = live.filter(isExpense);
  return {
    gasto: roundMoney(expenses.filter(m => m.TIPO === 'Gasto').reduce((sum, m) => sum + m.TOTAL, 0)),
    compra: roundMoney(expenses.filter(m => m.TIPO === 'Compra').reduce((sum, m) => sum + m.TOTAL, 0)),
    pago: roundMoney(expenses.filter(m => m.TIPO === 'Pago').reduce((sum, m) => sum + m.TOTAL, 0)),
    pendiente: roundMoney(expenses.reduce((sum, m) => sum + pendingAmount(m, ledger), 0)),
    gastos: roundMoney(expenses.reduce((sum, m) => sum + m.TOTAL, 0)),
    ingresos: roundMoney(live.reduce((sum, m) => sum + cashFlow(m).income, 0)),
    egresos: roundMoney(live.reduce((sum, m) => sum + cashFlow(m).expense, 0)),
    cantidad: live.length,
  };
}
export function datePreset(preset: 'day' | 'week' | 'month', now = new Date()): Pick<Filters, 'desde' | 'hasta'> {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (preset === 'month') start.setDate(1);
  return { desde: localDate(start), hasta: localDate(now) };
}
