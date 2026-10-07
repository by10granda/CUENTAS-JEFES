import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountBalance, availableBalance, cashFlow, datePreset, effectiveState, emptyFilters, expenseEvolution, filterMovements, pendingAmount, summarizeMovements } from '../src/finance.ts';
import type { AccountRow, Movement } from '../src/types.ts';

// These fixtures are test-only; they never connect to or seed the real spreadsheet.
const accounts: AccountRow[] = [
  { ID: 'test-a', JEFE: '1', NOMBRE: 'Test', ESTADO: 'Activo', UPDATED_AT: '', SALDO_INICIAL: 0, SALDO_ACTUAL: 0 },
  { ID: 'test-b', JEFE: '1', NOMBRE: 'Test reserve', ESTADO: 'Activo', UPDATED_AT: '', SALDO_INICIAL: 0, SALDO_ACTUAL: 0 },
  { ID: 'test-c', JEFE: '2', NOMBRE: 'Test other person', ESTADO: 'Activo', UPDATED_AT: '', SALDO_INICIAL: 0, SALDO_ACTUAL: 0 },
];
function movement(ID: string, patch: Partial<Movement> = {}): Movement {
  return { ID, FECHA: '2026-10-01', HORA: '10:00', JEFE: '1', CUENTA: 'test-a', TIPO: 'Gasto', CATEGORIA: 'cat', FORMA_PAGO: 'cash', DESCRIPCION: 'Test only', CANTIDAD: 1, VALOR_UNITARIO: 30, TOTAL: 30, TOTAL_MANUAL: false, ESTADO: 'Pagado', PAGADO: 30, UPDATED_AT: '', CLAVE_IDEMPOTENCIA: 'test-only', ...patch };
}

test('frontend separates people and accounts; transfers do not change person funds', () => {
  const ledger = [
    movement('income', { TIPO: 'Ingreso', TOTAL: 100, PAGADO: 100 }),
    movement('expense', { TOTAL: 30, PAGADO: 5, ESTADO: 'Pago parcial' }),
    movement('payment', { TIPO: 'Pago', TOTAL: 10, PAGADO: 10, MOVIMIENTO_ORIGEN_ID: 'expense' }),
    movement('transfer', { TIPO: 'Transferencia', TOTAL: 20, PAGADO: 20, CUENTA_DESTINO_ID: 'test-b' }),
    movement('other-income', { TIPO: 'Ingreso', JEFE: '2', CUENTA: 'test-c', TOTAL: 50, PAGADO: 50 }),
    movement('void', { ESTADO: 'Anulado', TOTAL: 999, PAGADO: 999 }),
  ];
  assert.equal(accountBalance(accounts[0], ledger), 65);
  assert.equal(accountBalance(accounts[1], ledger), 20);
  assert.equal(accountBalance(accounts[2], ledger), 50);
  assert.equal(availableBalance(accounts, ledger, { jefe: '1', cuenta: '', hasta: '' }), 85);
  const summary = summarizeMovements(ledger, ledger);
  assert.equal(summary.gastos, 30);
  assert.equal(summary.pago, 0);
  assert.equal(summary.egresos, 15);
  assert.equal(summary.pendiente, 15);
});

test('frontend obligations use ALL linked payments even outside selected dates', () => {
  const original = movement('original', { ESTADO: 'Pendiente', PAGADO: 0 });
  const payment = movement('payment', { FECHA: '2026-10-07', TIPO: 'Pago', MOVIMIENTO_ORIGEN_ID: original.ID });
  const ledger = [original, payment];
  assert.equal(pendingAmount(original, ledger), 0);
  assert.equal(effectiveState(original, ledger), 'Pagado');
  assert.equal(filterMovements(ledger, { ...emptyFilters(), hasta: '2026-10-01', estado: 'Pendiente' }).length, 0);
  assert.deepEqual(filterMovements(ledger, { ...emptyFilters(), hasta: '2026-10-01', estado: 'Pagado' }).map(m => m.ID), ['original']);
  assert.equal(accountBalance(accounts[0], ledger, '2026-10-01'), 0);
  assert.equal(accountBalance(accounts[0], ledger), -30);
  assert.equal(pendingAmount(original, [original, { ...payment, ESTADO: 'Anulado' }]), 30);
});

test('frontend directions, refunds and withdrawals have correct cash signs', () => {
  for (const TIPO of ['Préstamo', 'Adelanto']) {
    assert.deepEqual(cashFlow(movement('a', { TIPO, DIRECCION: 'Recibido' })), { income: 30, expense: 0 });
    assert.deepEqual(cashFlow(movement('b', { TIPO, DIRECCION: 'Entregado' })), { income: 0, expense: 30 });
  }
  assert.deepEqual(cashFlow(movement('refund', { TIPO: 'Reembolso' })), { income: 30, expense: 0 });
  assert.deepEqual(cashFlow(movement('withdrawal', { TIPO: 'Retiro' })), { income: 0, expense: 30 });
});

test('frontend search, common filters and expense evolution exclude linked duplication', () => {
  const first = movement('first', { NUMERO_FACTURA: 'REAL-SEARCH-TEST', PROVEEDOR: 'Test supplier' });
  const second = movement('second', { FECHA: '2026-10-02', TIPO: 'Compra', TOTAL: 12.35, PAGADO: 12.35 });
  const payment = movement('linked', { TIPO: 'Pago', MOVIMIENTO_ORIGEN_ID: first.ID });
  const ledger = [second, first, payment];
  assert.deepEqual(filterMovements(ledger, { ...emptyFilters(), buscar: 'search-test' }).map(m => m.ID), ['first']);
  assert.deepEqual(filterMovements(ledger, { ...emptyFilters(), proveedor: 'Test supplier', formaPago: 'cash', categoria: 'cat', tipo: 'Gasto' }).map(m => m.ID), ['first']);
  assert.deepEqual(expenseEvolution(ledger), [{ fecha: '2026-10-01', gastos: 30 }, { fecha: '2026-10-02', gastos: 42.35 }]);
  assert.deepEqual(datePreset('week', new Date(2026, 9, 7, 23)), { desde: '2026-10-05', hasta: '2026-10-07' });
  assert.deepEqual(datePreset('month', new Date(2026, 9, 7, 23)), { desde: '2026-10-01', hasta: '2026-10-07' });
});
