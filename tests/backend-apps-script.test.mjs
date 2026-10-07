import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';
import { driveUrl_ } from '../server/security.ts';

const source = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

function harness() {
  class Sheet {
    constructor(name, data = []) { this.name = name; this.data = structuredClone(data); this.failWrites = 0; }
    getLastRow() {
      for (let i = this.data.length - 1; i >= 0; i--) if (this.data[i]?.some(v => v !== '' && v !== undefined)) return i + 1;
      return 0;
    }
    getLastColumn() { return Math.max(0, ...this.data.map(r => r.length)); }
    setFrozenRows() {}
    getRange(row, column, height, width) {
      return {
        getValues: () => Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => this.data[row - 1 + i]?.[column - 1 + j] ?? '')),
        setValues: values => {
          if (this.failWrites > 0) { this.failWrites--; throw new Error('Injected Sheets failure'); }
          for (let i = 0; i < height; i++) {
            this.data[row - 1 + i] ||= [];
            for (let j = 0; j < width; j++) {
              const value = values[i][j];
              this.data[row - 1 + i][column - 1 + j] = typeof value === 'string' && value.startsWith("'") ? value.slice(1) : value;
            }
          }
        }
      };
    }
  }
  const sheets = { Hoja1: new Sheet('Hoja1', [['Do not touch']]) };
  const ss = {
    getSheetByName: name => sheets[name] || null,
    insertSheet: name => (sheets[name] = new Sheet(name)),
    getSpreadsheetTimeZone: () => 'Etc/UTC'
  };
  const properties = { GAS_API_SECRET: 'shared-secret' };
  let held = false;
  let rejectLock = false;
  const context = vm.createContext({
    console: { log() {}, error() {} },
    SpreadsheetApp: { openById: id => { assert.equal(id, '1waRuU63wJjxNJP8usUtHkl5mV-WM7E099dz-4llwJrI'); return ss; }, flush() {} },
    LockService: { getScriptLock: () => ({ tryLock() { held = !rejectLock; return held; }, waitLock() { held = true; }, hasLock: () => held, releaseLock() { held = false; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] || null }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType: () => text }) },
    Utilities: {
      getUuid: randomUUID,
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_algo, value) => [...createHash('sha256').update(value).digest()].map(v => v > 127 ? v - 256 : v),
      formatDate: date => date.toISOString().slice(0, 10)
    }
  });
  vm.runInContext(source, context, { filename: 'Code.gs' });
  // Synthetic test-only identity, not a deployment credential.
  const call = (action, payload = {}, extra = {}) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ secret: 'shared-secret', action, payload, user: { username: 'test-only-user', name: 'Test Only' }, ...extra }) } }));
  const rows = name => JSON.parse(JSON.stringify(context.table_(ss, name).rows));
  const ready = () => {
    context.setupSpreadsheet();
    const jefe = call('saveCatalog', { sheet: 'JEFES', row: { NOMBRE: 'Approved jefe', ESTADO: 'Activo' } }).data;
    const otherJefe = call('saveCatalog', { sheet: 'JEFES', row: { NOMBRE: 'Second approved jefe', ESTADO: 'Activo' } }).data;
    const seedAccount = row => {
      const account = { ID: randomUUID(), ESTADO: 'Activo', UPDATED_AT: 'historical-version', TIPO: 'Historical type', ...row };
      context.appendDirect_(ss, 'CUENTAS', account);
      return account;
    };
    const account = seedAccount({ NOMBRE: 'Operating', JEFE: jefe.ID, SALDO_INICIAL: 100 });
    const destination = seedAccount({ NOMBRE: 'Reserve', JEFE: jefe.ID, SALDO_INICIAL: 0 });
    const foreign = seedAccount({ NOMBRE: 'Foreign', JEFE: otherJefe.ID, SALDO_INICIAL: 0 });
    const category = call('saveCatalog', { sheet: 'CATEGORIAS', row: { NOMBRE: 'Approved category', ESTADO: 'Activo' } }).data;
    const method = call('saveCatalog', { sheet: 'FORMAS_PAGO', row: { NOMBRE: 'Approved method', ESTADO: 'Activo' } }).data;
    const movement = (changes = {}) => ({ FECHA: '2026-10-07', HORA: '12:30', TIPO: 'Gasto', JEFE: jefe.ID, CUENTA: account.ID, CATEGORIA: category.ID, FORMA_PAGO: method.ID, DESCRIPCION: 'Test', CANTIDAD: 1, VALOR_UNITARIO: 40, TOTAL: 40, TOTAL_MANUAL: false, ESTADO: 'Pendiente', CLAVE_IDEMPOTENCIA: randomUUID(), ...changes });
    return { jefe, otherJefe, account, destination, foreign, category, method, movement };
  };
  return { context, call, rows, ready, sheets, ss, properties, rejectLock: () => { rejectLock = true; }, locked: () => held };
}

test('setup refuses incompatible existing targets before ANY changes; preserves Hoja1', () => {
  const h = harness();
  h.sheets.MOVIMIENTOS = new h.sheets.Hoja1.constructor('MOVIMIENTOS', [['UNKNOWN'], ['data']]);
  const before = JSON.stringify(h.sheets);
  assert.equal(h.context.inspectStructure().compatible, false);
  assert.throws(() => h.context.setupSpreadsheet(), /incompatible/);
  assert.equal(JSON.stringify(h.sheets), before);
  assert.equal(h.locked(), false);
});

test('setup seeds exactly approved catalogs idempotently, appends compatible optional headers, no financial seeds', () => {
  const h = harness();
  h.context.setupSpreadsheet();
  h.context.setupSpreadsheet();
  assert.deepEqual(h.rows('ESTADOS').map(r => r.NOMBRE), ['Pagado', 'Pendiente', 'Pago parcial', 'Anulado']);
  assert.deepEqual(h.rows('JEFES').map(({ ID, NOMBRE, TIPO, ESTADO }) => ({ ID, NOMBRE, TIPO, ESTADO })), [
    { ID: '1', NOMBRE: 'Franco Becerra', TIPO: 'Jefe', ESTADO: 'Activo' },
    { ID: '2', NOMBRE: 'Josselyn Becerra', TIPO: 'Jefa', ESTADO: 'Activo' }
  ]);
  assert.deepEqual(h.rows('CATEGORIAS').map(r => r.NOMBRE), ['Alimentación', 'Transporte', 'Combustible', 'Hospedaje', 'Compras', 'Servicios', 'Salud', 'Entretenimiento', 'Viajes', 'Mantenimiento', 'Tecnología', 'Oficina', 'Representación', 'Impuestos', 'Otros']);
  assert.deepEqual(h.rows('FORMAS_PAGO').map(r => r.NOMBRE), ['Efectivo', 'Transferencia', 'Tarjeta de crédito', 'Tarjeta de débito', 'Depósito', 'Otro']);
  for (const sheet of ['CUENTAS', 'MOVIMIENTOS', 'AUDITORIA']) assert.equal(h.rows(sheet).length, 0);
  for (const sheet of ['JEFES', 'CATEGORIAS', 'FORMAS_PAGO', 'ESTADOS']) {
    const rows = h.rows(sheet);
    assert.ok(rows.every(r => typeof r.ID === 'string' && r.ESTADO === 'Activo'));
    assert.equal(new Set(rows.map(r => r.ID)).size, rows.length);
  }
  assert.deepEqual(h.sheets.Hoja1.data, [['Do not touch']]);
  h.sheets.JEFES.data = h.sheets.JEFES.data.map(row => row.slice(0, 3));
  h.context.setupSpreadsheet();
  assert.deepEqual(h.sheets.JEFES.data[0], ['ID', 'NOMBRE', 'ESTADO', 'UPDATED_AT', 'TIPO']);
  assert.deepEqual(h.call('bootstrap').data.configuracion, { MONEDA: 'USD', IVA_PORCENTAJE: 0 });
});

test('GAS public reads denied, shared secret checked, unknown actions and lock contention rejected', () => {
  const h = harness();
  assert.equal(JSON.parse(h.context.doGet()).status, 401);
  assert.equal(h.call('bootstrap', {}, { secret: 'wrong' }).status, 401);
  assert.equal(h.call('bootstrap', {}, { user: null }).status, 401);
  for (const username of ['', '   ', 123, 'x'.repeat(101), 'test\nuser', 'test\x7fuser', 'test\x85user']) {
    assert.equal(h.call('bootstrap', {}, { user: { username, name: 'Test Only' } }).status, 401);
  }
  assert.equal(h.call('bootstrap', {}, { user: { email: 'legacy-test-only@example.com' } }).status, 401);
  assert.equal(h.call('evil').status, 404);
  h.context.setupSpreadsheet();
  h.rejectLock();
  assert.equal(h.call('bootstrap').status, 503);
});

test('movement validation rejects invalid calendar/time/amounts/references and uses inclusive tax zero', () => {
  const h = harness(); const f = h.ready();
  for (const changes of [
    { DESCRIPCION: '' }, { DESCRIPCION: '   ' }, { DESCRIPCION: undefined },
    { FECHA: '2026-02-30' }, { HORA: '24:00' }, { TOTAL: -1 }, { TOTAL: 1.001 },
    { CANTIDAD: '1' }, { VALOR_UNITARIO: null }, { TOTAL_MANUAL: 'false' }, { TOTAL: 30 },
    { JEFE: f.otherJefe.ID }, { CUENTA: 'missing' }, { CATEGORIA: 'missing' }, { FORMA_PAGO: 'missing' },
    { TIPO: 'Unknown' }, { TIPO: 'Préstamo' }, { ESTADO: 'Anulado' },
    { ESTADO: 'Pago parcial', PAGADO: 40 }, { ESTADO: 'Pendiente', PAGADO: 1 },
    { ESTADO: 'Pagado', PAGADO: 0 }, { COMPROBANTE_URL: 'https://evil.example/file' }
  ]) {
    const result = h.call('create', { movement: f.movement(changes) });
    assert.equal(result.success, false, JSON.stringify(changes));
  }
  const created = h.call('create', { movement: f.movement({ TOTAL_MANUAL: true, TOTAL: 25, IVA: 99, IVA_PORCENTAJE: 99 }) });
  assert.equal(created.success, true);
  assert.equal(created.data.TOTAL, 25);
  assert.equal(created.data.IVA, 0);
  assert.equal(created.data.IVA_PORCENTAJE, 0);
  assert.equal(h.locked(), false);
});

test('idempotency retries exactly once, conflicting payload/user rejected, audit full before/after immutable', () => {
  const h = harness(); const f = h.ready();
  const input = f.movement();
  const created = h.call('create', { movement: input }).data;
  assert.equal(h.call('create', { movement: input }).data.ID, created.ID);
  assert.equal(h.rows('MOVIMIENTOS').length, 1);
  assert.equal(h.call('create', { movement: { ...input, DESCRIPCION: 'different' } }).status, 409);
  assert.equal(h.call('create', { movement: input }, { user: { username: 'other-test-only-user', name: 'Other Test Only' } }).status, 409);
  const beforeAudit = h.rows('AUDITORIA').at(-1);
  assert.equal(JSON.parse(beforeAudit.ANTES), null);
  assert.equal(JSON.parse(beforeAudit.DESPUES).ID, created.ID);
  const updated = h.call('update', { movement: { ...created, DESCRIPCION: 'Edited' } });
  assert.equal(updated.success, true);
  assert.notEqual(updated.data.UPDATED_AT, created.UPDATED_AT);
  assert.equal(updated.data.CREATED_AT, created.CREATED_AT);
  assert.deepEqual(h.rows('AUDITORIA').at(-2), beforeAudit);
  const audit = h.rows('AUDITORIA').at(-1);
  assert.equal(JSON.parse(audit.ANTES).DESCRIPCION, 'Test');
  assert.equal(JSON.parse(audit.DESPUES).DESCRIPCION, 'Edited');
  assert.equal(audit.USUARIO, 'test-only-user');
  assert.equal(h.call('update', { movement: created }).status, 409);
  assert.equal(h.call('void', { id: created.ID, updatedAt: created.UPDATED_AT }).status, 409);
  assert.equal(h.call('update', { movement: { ...updated.data, UPDATED_AT: undefined } }).status, 409);
  assert.equal(h.call('create', { movement: input }).data.DESCRIPCION, 'Edited');
});

test('linked payments reduce obligation once, debit actual cash only, forbid overpay/mismatch/origin edits', () => {
  const h = harness(); const f = h.ready();
  const original = h.call('create', { movement: f.movement({ TOTAL: 80, VALOR_UNITARIO: 80, ESTADO: 'Pago parcial', PAGADO: 10 }) }).data;
  const paymentInput = f.movement({ TIPO: 'Pago', ESTADO: 'Pagado', TOTAL: 30, VALOR_UNITARIO: 30, MOVIMIENTO_ORIGEN_ID: original.ID });
  const payment = h.call('create', { movement: paymentInput }).data;
  assert.ok(payment?.ID);
  let movement = h.call('movements').data.find(m => m.ID === original.ID);
  assert.equal(movement.PAGADO, 10);
  assert.equal(movement.PAGADO_VINCULADO, 30);
  assert.equal(movement.SALDO_PENDIENTE, 40);
  assert.equal(h.call('bootstrap').data.cuentas.find(a => a.ID === f.account.ID).SALDO_ACTUAL, 60);
  let stats = h.call('statistics').data.resumen;
  assert.equal(stats.gastos, 80);
  assert.equal(stats.egresos, 40);
  assert.equal(stats.pendiente, 40);
  assert.equal(h.call('create', { movement: { ...paymentInput, CLAVE_IDEMPOTENCIA: randomUUID(), TOTAL: 41, VALOR_UNITARIO: 41 } }).success, false);
  const otherAccountPayment = h.call('create', { movement: { ...paymentInput, CLAVE_IDEMPOTENCIA: randomUUID(), CUENTA: f.destination.ID } });
  assert.equal(otherAccountPayment.success, true);
  assert.equal(h.call('void', { id: otherAccountPayment.data.ID, updatedAt: otherAccountPayment.data.UPDATED_AT }).success, true);
  assert.equal(h.call('create', { movement: { ...paymentInput, CLAVE_IDEMPOTENCIA: randomUUID(), JEFE: f.otherJefe.ID, CUENTA: f.foreign.ID } }).success, false);
  assert.equal(h.call('update', { movement: original }).status, 409);
  assert.equal(h.call('void', { id: original.ID, updatedAt: original.UPDATED_AT }).status, 409);
  assert.equal(h.call('void', { id: payment.ID, updatedAt: payment.UPDATED_AT }).success, true);
  stats = h.call('statistics').data.resumen;
  assert.equal(stats.egresos, 10);
  assert.equal(stats.pendiente, 70);
  assert.equal(h.call('void', { id: original.ID, updatedAt: original.UPDATED_AT }).success, true);
  assert.equal(h.call('bootstrap').data.cuentas.find(a => a.ID === f.account.ID).SALDO_ACTUAL, 100);
});

test('transfers, income, refunds, loan/advance directions, withdrawals and paid expenses balance correctly', () => {
  const h = harness(); const f = h.ready();
  function add(type, amount, changes = {}) {
    const result = h.call('create', { movement: f.movement({ TIPO: type, ESTADO: 'Pagado', TOTAL: amount, VALOR_UNITARIO: amount, ...changes }) });
    assert.equal(result.success, true, result.message);
    return result.data;
  }
  add('Ingreso', 20); add('Reembolso', 5);
  add('Préstamo', 10, { DIRECCION: 'Recibido' }); add('Préstamo', 4, { DIRECCION: 'Entregado' });
  add('Adelanto', 8, { DIRECCION: 'Recibido' }); add('Adelanto', 3, { DIRECCION: 'Entregado' });
  add('Retiro', 6); add('Compra', 7);
  add('Transferencia', 30, { CUENTA_DESTINO_ID: f.destination.ID });
  const accounts = h.call('bootstrap').data.cuentas;
  assert.equal(accounts.find(a => a.ID === f.account.ID).SALDO_ACTUAL, 93);
  assert.equal(accounts.find(a => a.ID === f.destination.ID).SALDO_ACTUAL, 30);
  for (const changes of [{ CUENTA_DESTINO_ID: f.account.ID }, { CUENTA_DESTINO_ID: f.foreign.ID }, { CUENTA_DESTINO_ID: f.destination.ID, ESTADO: 'Pendiente' }]) assert.equal(h.call('create', { movement: f.movement({ TIPO: 'Transferencia', ...changes }) }).success, false);
  const stats = h.call('statistics').data.resumen;
  assert.equal(stats.ingresos, 43); assert.equal(stats.egresos, 20); assert.equal(stats.transferencias, 30);
  add('Retiro', 200);
  assert.equal(h.call('bootstrap').data.cuentas.find(a => a.ID === f.account.ID).SALDO_ACTUAL, -107);
});

test('catalog restricted fields, no deletion, accounts read-only, unchanged inactive refs allow edits', () => {
  const h = harness(); const f = h.ready();
  assert.equal(h.call('saveCatalog', { sheet: 'MOVIMIENTOS', row: {} }).success, false);
  assert.equal(h.call('saveCatalog', { sheet: 'JEFES', row: { NOMBRE: 'x', ESTADO: 'Activo', ADMIN: true } }).success, false);
  assert.equal(h.call('saveCatalog', { sheet: 'JEFES', row: { ID: 'unknown', NOMBRE: 'x', ESTADO: 'Activo' } }).status, 404);
  const original = h.call('create', { movement: f.movement() }).data;
  const accounts = h.rows('CUENTAS'), audits = h.rows('AUDITORIA');
  for (const row of [{ NOMBRE: 'New account', JEFE: f.jefe.ID, SALDO_INICIAL: 0, ESTADO: 'Activo' },
    { ...f.account, SALDO_INICIAL: 200 }, { ...f.account, JEFE: f.otherJefe.ID }, { ...f.account, ESTADO: 'Inactivo' }]) {
    assert.equal(h.call('saveCatalog', { sheet: 'CUENTAS', row }).status, 403);
  }
  assert.deepEqual(h.rows('CUENTAS'), accounts);
  assert.deepEqual(h.rows('AUDITORIA'), audits);
  const result = h.call('saveCatalog', { sheet: 'CATEGORIAS', row: { ...f.category, ESTADO: 'Inactivo' } });
  assert.equal(result.success, true);
  assert.equal(h.call('create', { movement: f.movement() }).success, false);
  const edited = h.call('update', { movement: { ...original, DESCRIPCION: 'Unrelated edit' } });
  assert.equal(edited.success, true);
  assert.equal(h.call('void', { id: original.ID, updatedAt: edited.data.UPDATED_AT }).success, true);
  const state = h.rows('ESTADOS')[0];
  assert.equal(h.call('saveCatalog', { sheet: 'ESTADOS', row: { ...state, NOMBRE: 'Foo' } }).success, false);
});

test('audit failure rolls back mutation and does not report silent success', () => {
  const h = harness(); const f = h.ready();
  const auditCount = h.rows('AUDITORIA').length;
  h.sheets.AUDITORIA.failWrites = 1;
  const input = f.movement();
  const failed = h.call('create', { movement: input });
  assert.equal(failed.success, false); assert.equal(failed.status, 503);
  assert.equal(h.rows('MOVIMIENTOS').length, 0);
  assert.equal(h.rows('AUDITORIA').length, auditCount);
  const created = h.call('create', { movement: input }).data;
  h.sheets.AUDITORIA.failWrites = 1;
  assert.equal(h.call('update', { movement: { ...created, DESCRIPCION: 'not saved' } }).success, false);
  assert.equal(h.rows('MOVIMIENTOS')[0].DESCRIPCION, 'Test');
  h.sheets.AUDITORIA.failWrites = 1;
  assert.equal(h.call('void', { id: created.ID, updatedAt: created.UPDATED_AT }).success, false);
  assert.equal(h.rows('MOVIMIENTOS')[0].ESTADO, 'Pendiente');
});

test('removed GAS upload action is unknown and historical upload audits are preserved', () => {
  const h = harness(); h.context.setupSpreadsheet();
  h.context.appendDirect_(h.ss, 'AUDITORIA', { ID: 'legacy-upload', ACCION: 'SUBIR_COMPROBANTE', HOJA: 'DRIVE', REGISTRO_ID: 'legacy-file', DESPUES: '{"url":"historical"}' });
  const before = JSON.stringify(h.sheets);
  assert.equal(h.call('upload', { fileName: 'receipt.pdf', base64: 'JVBERi0=' }).status, 404);
  assert.equal(JSON.stringify(h.sheets), before);
  h.context.setupSpreadsheet();
  assert.equal(JSON.stringify(h.sheets), before);
  assert.equal(h.context.upload_, undefined);
  const manifest = JSON.parse(readFileSync(new URL('../apps-script/appsscript.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets']);
});

test('statistics filter validation, global balances and pending totals remain independent of payment filters', () => {
  const h = harness(); const f = h.ready();
  h.call('create', { movement: f.movement() });
  h.call('create', { movement: f.movement({ TIPO: 'Ingreso', ESTADO: 'Pagado', FECHA: '2026-10-06' }) });
  const stats = h.call('statistics', { filters: { desde: '2026-10-07', hasta: '2026-10-07', jefe: f.jefe.ID } }).data;
  assert.equal(stats.resumen.cantidad, 1);
  assert.equal(stats.resumen.pendiente, 40);
  assert.equal(stats.saldos.find(a => a.CUENTA === f.account.ID).SALDO, 140);
  for (const filters of [{ desde: '2026-02-30' }, { desde: '2026-10-07', hasta: '2026-10-01' }, { injected: true }, { jefe: 1 }]) assert.equal(h.call('statistics', { filters }).success, false);
});

test('linked payment edits exclude self, full settlement leaves no pending and no duplicate expense', () => {
  const h = harness(); const f = h.ready();
  const original = h.call('create', { movement: f.movement() }).data;
  const payment = h.call('create', { movement: f.movement({ TIPO: 'Pago', ESTADO: 'Pagado', TOTAL: 20, VALOR_UNITARIO: 20, MOVIMIENTO_ORIGEN_ID: original.ID }) }).data;
  const updated = h.call('update', { movement: { ...payment, TOTAL: 40, VALOR_UNITARIO: 40, PAGADO: 40 } });
  assert.equal(updated.success, true);
  assert.equal(h.call('update', { movement: { ...updated.data, TOTAL: 41, VALOR_UNITARIO: 41, PAGADO: 41 } }).success, false);
  const stats = h.call('statistics').data.resumen;
  assert.equal(stats.gastos, 40);
  assert.equal(stats.egresos, 40);
  assert.equal(stats.pendiente, 0);
  assert.equal(h.call('create', { movement: f.movement({ TIPO: 'Pago', ESTADO: 'Pagado', TOTAL: 1, VALOR_UNITARIO: 1, MOVIMIENTO_ORIGEN_ID: original.ID }) }).success, false);
});

test('failed rollback is explicitly reported; formula-like user text is written literally', () => {
  const h = harness(); const f = h.ready();
  const cells = h.context.cells_(['DESCRIPCION'], { DESCRIPCION: '=IMPORTXML("https://evil.example", "*")' });
  assert.equal(cells[0][0], "'");
  const created = h.call('create', { movement: f.movement({ DESCRIPCION: '=SUM(1,2)' }) }).data;
  assert.equal(JSON.parse(h.rows('AUDITORIA').at(-1).DESPUES).DESCRIPCION, '=SUM(1,2)');
  h.sheets.MOVIMIENTOS.failWrites = 2;
  const result = h.call('update', { movement: { ...created, DESCRIPCION: 'failed' } });
  assert.equal(result.success, false);
  assert.equal(result.status, 503);
  assert.match(result.message, /restauracion/);
});

test('GAS and Node expose identical strict receipt URL patterns', () => {
  const h = harness();
  const nodeSource = readFileSync(new URL('../server/security.ts', import.meta.url), 'utf8');
  const patterns = text => text.split('\n').filter(line => line.includes('/^https:')).map(line => line.trim());
  assert.deepEqual(patterns(source), patterns(nodeSource));
  for (const url of ['', 'https://drive.google.com/file/d/ID/view?usp=sharing',
    'https://drive.google.com/file/d/ID/preview?resourcekey=0-a+b%3D&usp=drive_link',
    'https://drive.google.com/open?id=ID&usp=drivesdk',
    'https://user@drive.google.com/file/d/ID/view', 'https://drive.google.com/file/d/ID/view\n',
    'https://drive.google.com/file/d/ID/view#x', 'https://drive.google.com/open?id=ID/path', null]) {
    assert.equal(h.context.driveUrl_(url), driveUrl_(url), String(url));
  }
});

test('approved setup preserves existing names and rows, handles numeric ID collisions with UUIDs', () => {
  const h = harness();
  const Sheet = h.sheets.Hoja1.constructor;
  h.sheets.JEFES = new Sheet('JEFES', [
    ['ID', 'NOMBRE', 'ESTADO', 'UPDATED_AT', 'TIPO'],
    [1, 'Existing owner', 'Inactivo', 'old-version', 'Original type'],
    [2, 'Another existing owner', 'Activo', 'other-version', 'Existing type'],
    [9, 'Franco Becerra', 'Inactivo', 'franco-version', 'Do not overwrite']
  ]);
  h.sheets.CATEGORIAS = new Sheet('CATEGORIAS', [
    ['ID', 'NOMBRE', 'ESTADO', 'UPDATED_AT'],
    ['CAT-1', 'Existing category', 'Activo', 'category-version'],
    ['existing-food', 'Alimentación', 'Inactivo', 'food-version']
  ]);
  h.sheets.FORMAS_PAGO = new Sheet('FORMAS_PAGO', [
    ['ID', 'NOMBRE', 'ESTADO', 'UPDATED_AT'],
    ['FP-1', 'Existing method', 'Activo', 'method-version']
  ]);
  const oldJefes = structuredClone(h.sheets.JEFES.data);
  const oldCategories = structuredClone(h.sheets.CATEGORIAS.data);
  h.context.setupSpreadsheet();
  assert.deepEqual(h.sheets.JEFES.data.slice(0, oldJefes.length), oldJefes);
  assert.deepEqual(h.sheets.CATEGORIAS.data.slice(0, oldCategories.length), oldCategories);
  const josselyn = h.rows('JEFES').find(r => r.NOMBRE === 'Josselyn Becerra');
  assert.match(josselyn.ID, /^[0-9a-f-]{36}$/);
  assert.equal(josselyn.TIPO, 'Jefa');
  assert.match(h.rows('FORMAS_PAGO').find(r => r.NOMBRE === 'Efectivo').ID, /^[0-9a-f-]{36}$/);
  assert.equal(h.rows('JEFES').find(r => r.NOMBRE === 'Franco Becerra').ID, '9');
  assert.equal(h.rows('CATEGORIAS').filter(r => r.NOMBRE === 'Alimentación').length, 1);
  const before = JSON.stringify(h.sheets);
  h.context.setupSpreadsheet();
  assert.equal(JSON.stringify(h.sheets), before);
  assert.equal(h.rows('CUENTAS').length, 0);
  assert.equal(h.rows('MOVIMIENTOS').length, 0);
});

test('full form text fields, computed subtotal and authenticated registration user roundtrip and audit on update', () => {
  const h = harness(); const f = h.ready();
  const input = f.movement({
    SUBCATEGORIA: '  Almuerzo  ', PROVEEDOR: '  Restaurante  ', NUMERO_FACTURA: '  INV-001  ',
    OBSERVACIONES: '  Nota inicial\nSegunda linea  ', CANTIDAD: 2, VALOR_UNITARIO: 12.50,
    TOTAL: 20, TOTAL_MANUAL: true, SUBTOTAL: 999, USUARIO_REGISTRO: 'spoof@example.com'
  });
  const created = h.call('create', { movement: input }).data;
  assert.equal(created.SUBCATEGORIA, 'Almuerzo');
  assert.equal(created.PROVEEDOR, 'Restaurante');
  assert.equal(created.NUMERO_FACTURA, 'INV-001');
  assert.equal(created.FACTURA, 'INV-001');
  assert.equal(created.OBSERVACIONES, 'Nota inicial\nSegunda linea');
  assert.equal(created.SUBTOTAL, 25);
  assert.equal(created.TOTAL, 20);
   assert.equal(created.USUARIO_REGISTRO, 'test-only-user');
   assert.equal(created.CREADO_POR, 'test-only-user');
  assert.equal(h.rows('MOVIMIENTOS')[0].SUBTOTAL, 25);
  assert.deepEqual(h.call('movements').data[0].NUMERO_FACTURA, 'INV-001');
  const updated = h.call('update', { movement: {
    ...created, SUBCATEGORIA: 'Cena', PROVEEDOR: 'Otro proveedor', NUMERO_FACTURA: 'INV-002', FACTURA: undefined,
    OBSERVACIONES: 'Nota editada', CANTIDAD: 3, SUBTOTAL: 999, USUARIO_REGISTRO: 'spoof-again@example.com'
  } }, { user: { username: 'test-only-editor', name: 'Test Only Editor' } });
  assert.equal(updated.success, true, updated.message);
  assert.equal(updated.data.SUBTOTAL, 37.50);
  assert.equal(updated.data.FACTURA, 'INV-002');
  assert.equal(updated.data.USUARIO_REGISTRO, 'test-only-user');
  assert.equal(updated.data.CREADO_POR, 'test-only-user');
  assert.equal(updated.data.ACTUALIZADO_POR, 'test-only-editor');
  const audit = h.rows('AUDITORIA').at(-1);
  const before = JSON.parse(audit.ANTES), after = JSON.parse(audit.DESPUES);
  for (const field of ['SUBCATEGORIA', 'PROVEEDOR', 'NUMERO_FACTURA', 'OBSERVACIONES', 'SUBTOTAL', 'USUARIO_REGISTRO']) {
    assert.equal(before[field], created[field]);
    assert.equal(after[field], updated.data[field]);
    assert.equal(h.call('movements').data[0][field], updated.data[field]);
  }
  assert.equal(audit.USUARIO, 'test-only-editor');
});

test('existing frontend FACTURA alias persists canonical invoice and omitted optional fields survive edits', () => {
  const h = harness(); const f = h.ready();
  const created = h.call('create', { movement: f.movement({ FACTURA: 'F-01', SUBCATEGORIA: 'Preserve', PROVEEDOR: 'Supplier', OBSERVACIONES: 'Notes' }) }).data;
  assert.equal(created.NUMERO_FACTURA, 'F-01');
  assert.equal(h.call('movements').data[0].FACTURA, 'F-01');
  const input = { ...created, FACTURA: 'F-02', DESCRIPCION: 'Frontend edit' };
  for (const key of ['NUMERO_FACTURA', 'SUBCATEGORIA', 'PROVEEDOR', 'OBSERVACIONES']) delete input[key];
  const updated = h.call('update', { movement: input }).data;
  assert.equal(updated.NUMERO_FACTURA, 'F-02');
  assert.equal(updated.SUBCATEGORIA, 'Preserve');
  assert.equal(updated.PROVEEDOR, 'Supplier');
  assert.equal(updated.OBSERVACIONES, 'Notes');
  const cleared = h.call('update', { movement: { ...updated, FACTURA: '', NUMERO_FACTURA: undefined, SUBCATEGORIA: '' } }).data;
  assert.equal(cleared.NUMERO_FACTURA, '');
  assert.equal(cleared.SUBCATEGORIA, '');
});

test('username-authenticated edits preserve historical email registration and existing audit identities', () => {
  const h = harness(); const f = h.ready();
  const created = h.call('create', { movement: f.movement() }).data;
  const sheet = h.sheets.MOVIMIENTOS;
  const headers = sheet.data[0];
  const legacyIdentity = 'historical-test-only@example.com';
  for (const field of ['CREADO_POR', 'USUARIO_REGISTRO', 'ACTUALIZADO_POR']) sheet.data[1][headers.indexOf(field)] = legacyIdentity;
  const audits = h.sheets.AUDITORIA;
  audits.data.at(-1)[audits.data[0].indexOf('USUARIO')] = legacyIdentity;
  const oldAudits = h.rows('AUDITORIA');
  h.context.setupSpreadsheet();
  assert.deepEqual(h.rows('AUDITORIA'), oldAudits);
  const loaded = h.call('movements').data[0];
  const updated = h.call('update', { movement: { ...loaded, DESCRIPCION: 'Username edit' } });
  assert.equal(updated.success, true, updated.message);
  assert.equal(updated.data.ID, created.ID);
  assert.equal(updated.data.CREADO_POR, legacyIdentity);
  assert.equal(updated.data.USUARIO_REGISTRO, legacyIdentity);
  assert.equal(updated.data.ACTUALIZADO_POR, 'test-only-user');
  assert.deepEqual(h.rows('AUDITORIA').slice(0, -1), oldAudits);
  assert.equal(h.rows('AUDITORIA').at(-1).USUARIO, 'test-only-user');
});

test('new form text validates lengths/types/control characters and participates in idempotency', () => {
  const h = harness(); const f = h.ready();
  for (const changes of [
    { SUBCATEGORIA: 1 }, { PROVEEDOR: {} }, { NUMERO_FACTURA: false }, { OBSERVACIONES: ['x'] },
    { SUBCATEGORIA: 'x'.repeat(201) }, { PROVEEDOR: 'x'.repeat(201) }, { NUMERO_FACTURA: 'x'.repeat(101) }, { OBSERVACIONES: 'x'.repeat(2001) },
    { FACTURA: 'x'.repeat(101) }, { NUMERO_FACTURA: 'A', FACTURA: 'B' }, { OBSERVACIONES: '\u0000' },
    { TOTAL_MANUAL: true, CANTIDAD: 1e9, VALOR_UNITARIO: 1e9 }
  ]) assert.equal(h.call('create', { movement: f.movement(changes) }).success, false, JSON.stringify(changes));
  const input = f.movement({ SUBCATEGORIA: 'A', PROVEEDOR: 'Supplier', FACTURA: 'F-1', OBSERVACIONES: 'Note' });
  assert.equal(h.call('create', { movement: input }).success, true);
  assert.equal(h.call('create', { movement: input }).success, true);
  for (const field of ['SUBCATEGORIA', 'PROVEEDOR', 'FACTURA', 'OBSERVACIONES']) assert.equal(h.call('create', { movement: { ...input, [field]: 'changed' } }).status, 409);
  for (const field of ['SUBCATEGORIA', 'PROVEEDOR', 'NUMERO_FACTURA', 'OBSERVACIONES']) assert.equal(h.context.cells_([field], { [field]: '=HYPERLINK("https://evil.example")' })[0][0], "'");
});

test('optional catalog TIPO validates and survives frontend omission, custom accounting states rejected clearly', () => {
  const h = harness(); h.context.setupSpreadsheet();
  const franco = h.rows('JEFES').find(r => r.ID === '1');
  const { TIPO, ...frontendRow } = franco;
  const edited = h.call('saveCatalog', { sheet: 'JEFES', row: { ...frontendRow, NOMBRE: 'Franco Becerra' } }).data;
  assert.equal(edited.TIPO, 'Jefe');
  assert.equal(h.call('saveCatalog', { sheet: 'JEFES', row: { NOMBRE: 'No optional type', ESTADO: 'Activo' } }).success, true);
  assert.equal(h.call('saveCatalog', { sheet: 'JEFES', row: { NOMBRE: 'Invalid type', ESTADO: 'Activo', TIPO: {} } }).success, false);
  const custom = h.call('saveCatalog', { sheet: 'ESTADOS', row: { NOMBRE: 'Aprobado', ESTADO: 'Activo' } });
  assert.equal(custom.success, false);
  assert.match(custom.message, /no se admiten estados personalizados/);
  assert.equal(h.rows('ESTADOS').length, 4);
});

test('numeric Sheets IDs and references normalize to strings and work through create/update/void', () => {
  const h = harness(); const f = h.ready();
  const setNumeric = (sheet, key, id, number) => {
    const headers = h.sheets[sheet].data[0];
    const row = h.sheets[sheet].data.find((r, i) => i && r[headers.indexOf('ID')] === id);
    row[headers.indexOf(key)] = number;
  };
  setNumeric('JEFES', 'ID', '1', 1);
  setNumeric('CUENTAS', 'ID', f.account.ID, 101);
  setNumeric('CUENTAS', 'JEFE', 101, 1);
  const input = f.movement({ JEFE: '1', CUENTA: '101' });
  const created = h.call('create', { movement: input }).data;
  assert.ok(created.ID);
  setNumeric('MOVIMIENTOS', 'ID', created.ID, 202);
  setNumeric('MOVIMIENTOS', 'JEFE', 202, 1);
  setNumeric('MOVIMIENTOS', 'CUENTA', 202, 101);
  const loaded = h.call('movements').data[0];
  assert.equal(loaded.ID, '202'); assert.equal(loaded.JEFE, '1'); assert.equal(loaded.CUENTA, '101');
  const updated = h.call('update', { movement: { ...loaded, DESCRIPCION: 'Updated numeric row' } });
  assert.equal(updated.success, true, updated.message);
  assert.equal(h.call('void', { id: updated.data.ID, updatedAt: updated.data.UPDATED_AT }).success, true);
});

test('upgrading the previous schema appends optional headers without rewriting financial rows or audits', () => {
  const h = harness(); const f = h.ready();
  h.call('create', { movement: f.movement() });
  const added = ['SUBCATEGORIA', 'PROVEEDOR', 'NUMERO_FACTURA', 'OBSERVACIONES', 'SUBTOTAL', 'USUARIO_REGISTRO'];
  const sheet = h.sheets.MOVIMIENTOS;
  const indices = sheet.data[0].map((field, i) => added.includes(field) ? -1 : i).filter(i => i >= 0);
  sheet.data = sheet.data.map(row => indices.map(i => row[i]));
  const oldHeader = structuredClone(sheet.data[0]);
  const oldRows = structuredClone(sheet.data.slice(1));
  const oldAudits = h.rows('AUDITORIA');
  assert.equal(h.call('movements').status, 503);
  assert.equal(h.context.inspectStructure().compatible, true);
  h.context.setupSpreadsheet();
  assert.deepEqual(sheet.data[0], [...oldHeader, ...added]);
  assert.deepEqual(sheet.data.slice(1), oldRows);
  assert.deepEqual(h.rows('AUDITORIA'), oldAudits);
  const loaded = h.call('movements').data[0];
  assert.equal(loaded.SUBTOTAL, 40);
  assert.equal(loaded.USUARIO_REGISTRO, 'test-only-user');
  const updated = h.call('update', { movement: { ...loaded, OBSERVACIONES: 'New notes after schema upgrade' } });
  assert.equal(updated.success, true, updated.message);
  assert.equal(updated.data.SUBTOTAL, 40);
  assert.equal(updated.data.USUARIO_REGISTRO, 'test-only-user');
});

test('setup alone supports accountless obligations, linked settlement, transfers and investment totals', () => {
  const h = harness(); h.context.setupSpreadsheet();
  const movement = changes => ({ FECHA: '2026-10-07', HORA: '12:30', TIPO: 'Gasto', JEFE: '1',
    CATEGORIA: 'CAT-1', FORMA_PAGO: 'FP-1', DESCRIPCION: 'Accountless investment', CANTIDAD: 1,
    VALOR_UNITARIO: 80, TOTAL: 80, TOTAL_MANUAL: false, ESTADO: 'Pendiente', CLAVE_IDEMPOTENCIA: randomUUID(), ...changes });
  const create = changes => {
    const result = h.call('create', { movement: movement(changes) });
    assert.equal(result.success, true, result.message);
    assert.equal(result.data.CUENTA, '');
    assert.equal(result.data.CUENTA_DESTINO_ID, '');
    return result.data;
  };
  const original = create({});
  const paid = create({ CUENTA: '', ESTADO: 'Pagado', TOTAL: 20, VALOR_UNITARIO: 20 });
  const payment = create({ TIPO: 'Pago', ESTADO: 'Pagado', TOTAL: 30, VALOR_UNITARIO: 30, MOVIMIENTO_ORIGEN_ID: original.ID });
  const transfer = create({ TIPO: 'Transferencia', ESTADO: 'Pagado', TOTAL: 15, VALOR_UNITARIO: 15 });
  assert.equal(h.call('create', { movement: movement({ TIPO: 'Pago', ESTADO: 'Pagado', TOTAL: 51, VALOR_UNITARIO: 51, MOVIMIENTO_ORIGEN_ID: original.ID }) }).success, false);
  assert.equal(h.call('create', { movement: movement({ TIPO: 'Pago', ESTADO: 'Pagado', JEFE: '2', MOVIMIENTO_ORIGEN_ID: original.ID }) }).success, false);
  assert.equal(h.call('update', { movement: original }).status, 409);
  assert.equal(h.call('void', { id: original.ID, updatedAt: original.UPDATED_AT }).status, 409);
  for (const changes of [{ TIPO: 'Transferencia', TOTAL: 0, VALOR_UNITARIO: 0, ESTADO: 'Pagado' },
    { TIPO: 'Transferencia' }, { JEFE: '' }, { CATEGORIA: '' }, { FORMA_PAGO: '' }]) {
    assert.equal(h.call('create', { movement: movement(changes) }).success, false);
  }
  assert.deepEqual(h.call('bootstrap').data.cuentas, []);
  const stats = h.call('statistics').data;
  assert.deepEqual(stats.resumen, { cantidad: 4, ingresos: 0, egresos: 50, gastos: 100, pendiente: 50, transferencias: 15, neto: -50 });
  assert.deepEqual(stats.saldos, []);
  assert.deepEqual(stats.porCategoria, [{ CATEGORIA: 'CAT-1', TOTAL: 100 }]);
  const loaded = h.call('movements').data;
  assert.equal(loaded.find(m => m.ID === original.ID).SALDO_PENDIENTE, 50);
  for (const record of [paid, payment, transfer]) {
    const updated = h.call('update', { movement: { ...record, CUENTA: undefined, CUENTA_DESTINO_ID: undefined, DESCRIPCION: 'Edited accountless' } });
    assert.equal(updated.success, true, updated.message);
    assert.equal(updated.data.CUENTA, '');
    assert.equal(updated.data.CUENTA_DESTINO_ID, '');
  }
  assert.equal(h.rows('CUENTAS').length, 0);
});

test('receipt URLs roundtrip, omission preserves, explicit blank clears, malformed URLs reject without writes', () => {
  const h = harness(); const f = h.ready();
  for (const url of ['https://drive.google.com/file/d/Ab_12-xy/view?usp=sharing',
    'https://drive.google.com/file/d/ID/preview?usp=drive_link&resourcekey=0-a+b%3D',
    'https://drive.google.com/file/d/ID/view?usp=drivesdk',
    'https://drive.google.com/open?id=ID&usp=sharing&resourcekey=0-key']) {
    const created = h.call('create', { movement: f.movement({ CUENTA: undefined, COMPROBANTE_URL: url }) }).data;
    assert.equal(created.COMPROBANTE_URL, url);
    assert.equal(h.call('movements').data.find(m => m.ID === created.ID).COMPROBANTE_URL, url);
    const edited = h.call('update', { movement: { ...created, COMPROBANTE_URL: undefined, DESCRIPCION: 'Keep receipt' } });
    assert.equal(edited.success, true, edited.message);
    assert.equal(edited.data.COMPROBANTE_URL, url);
    const cleared = h.call('update', { movement: { ...edited.data, COMPROBANTE_URL: '' } });
    assert.equal(cleared.success, true, cleared.message);
    assert.equal(cleared.data.COMPROBANTE_URL, '');
    const audit = h.rows('AUDITORIA').at(-1);
    assert.equal(JSON.parse(audit.ANTES).COMPROBANTE_URL, url);
    assert.equal(JSON.parse(audit.DESPUES).COMPROBANTE_URL, '');
    const before = JSON.stringify(h.sheets);
    for (const bad of [' https://drive.google.com/file/d/ID/view', 'https://drive.google.com/file/d/ID/view\n',
      'https://drive.google.com/file/d/ID/view#x', 'https://user@drive.google.com/file/d/ID/view',
      'https://drive.google.com.evil/file/d/ID/view', 'https://drive.google.com/open?id=ID/path',
      'https://drive.google.com/file/d/ID/view?next=https://evil.example', null, false]) {
      assert.equal(h.call('create', { movement: f.movement({ COMPROBANTE_URL: bad }) }).success, false, String(bad));
      assert.equal(h.call('update', { movement: { ...cleared.data, COMPROBANTE_URL: bad } }).success, false, String(bad));
    }
    assert.equal(JSON.stringify(h.sheets), before);
  }
});

test('historical inactive account references and metadata survive edits, owner changes clear omitted accounts', () => {
  const h = harness(); const f = h.ready();
  const expense = h.call('create', { movement: f.movement({ ESTADO: 'Pagado' }) }).data;
  const transfer = h.call('create', { movement: f.movement({ TIPO: 'Transferencia', ESTADO: 'Pagado', CUENTA_DESTINO_ID: f.destination.ID }) }).data;
  const headers = h.sheets.CUENTAS.data[0];
  for (const row of h.sheets.CUENTAS.data.slice(1)) {
    if ([f.account.ID, f.destination.ID].includes(row[headers.indexOf('ID')])) row[headers.indexOf('ESTADO')] = 'Inactivo';
  }
  const accounts = h.rows('CUENTAS');
  const audits = h.rows('AUDITORIA');
  h.context.setupSpreadsheet();
  assert.deepEqual(h.rows('CUENTAS'), accounts);
  assert.deepEqual(h.rows('AUDITORIA'), audits);
  const bootstrap = h.call('bootstrap');
  assert.equal(bootstrap.success, true, bootstrap.message);
  assert.equal(bootstrap.data.cuentas.find(a => a.ID === f.account.ID).SALDO_ACTUAL, 20);
  for (const account of accounts) {
    const loaded = bootstrap.data.cuentas.find(a => a.ID === account.ID);
    for (const field of Object.keys(account)) assert.equal(loaded[field], account[field]);
  }
  for (const original of [expense, transfer]) {
    const edited = h.call('update', { movement: { ...original, CUENTA: undefined, CUENTA_DESTINO_ID: undefined, DESCRIPCION: 'Unrelated edit' } });
    assert.equal(edited.success, true, edited.message);
    assert.equal(edited.data.CUENTA, original.CUENTA);
    assert.equal(edited.data.CUENTA_DESTINO_ID, original.CUENTA_DESTINO_ID);
    const explicit = h.call('update', { movement: { ...edited.data, DESCRIPCION: 'Unchanged inactive refs' } });
    assert.equal(explicit.success, true, explicit.message);
    assert.equal(h.call('update', { movement: { ...explicit.data, JEFE: f.otherJefe.ID } }).success, false);
    const moved = h.call('update', { movement: { ...explicit.data, JEFE: f.otherJefe.ID, CUENTA: undefined, CUENTA_DESTINO_ID: undefined } });
    assert.equal(moved.success, true, moved.message);
    assert.equal(moved.data.CUENTA, '');
    assert.equal(moved.data.CUENTA_DESTINO_ID, '');
    assert.equal(h.call('update', { movement: { ...moved.data, CUENTA: f.account.ID, JEFE: f.jefe.ID, CUENTA_DESTINO_ID: original.CUENTA_DESTINO_ID } }).success, false);
  }
  assert.equal(h.call('create', { movement: f.movement() }).success, false);
  assert.deepEqual(h.rows('CUENTAS'), accounts);
  assert.equal(h.call('bootstrap').data.cuentas.find(a => a.ID === f.account.ID).SALDO_ACTUAL, 100);
  assert.equal(h.call('statistics').data.resumen.gastos, 40);
});

test('account-bound transfers require both accounts and legacy unknown nonblank accounts remain inconsistent', () => {
  const h = harness(); const f = h.ready();
  for (const changes of [{ CUENTA_DESTINO_ID: '' }, { CUENTA: '', CUENTA_DESTINO_ID: f.destination.ID },
    { CUENTA_DESTINO_ID: 'unknown' }, { CUENTA_DESTINO_ID: f.account.ID }, { CUENTA_DESTINO_ID: f.foreign.ID }]) {
    assert.equal(h.call('create', { movement: f.movement({ TIPO: 'Transferencia', ESTADO: 'Pagado', ...changes }) }).success, false);
  }
  const transfer = h.call('create', { movement: f.movement({ TIPO: 'Transferencia', ESTADO: 'Pagado', CUENTA_DESTINO_ID: f.destination.ID }) }).data;
  for (const changes of [{ CUENTA: '' }, { CUENTA_DESTINO_ID: '' }]) {
    assert.equal(h.call('update', { movement: { ...transfer, ...changes } }).success, false);
  }
  const accounts = h.rows('CUENTAS');
  for (const m of [{ TIPO: 'Gasto', CUENTA: 'unknown' },
    { TIPO: 'Transferencia', CUENTA: f.account.ID, CUENTA_DESTINO_ID: 'unknown' },
    { TIPO: 'Transferencia', CUENTA: '', CUENTA_DESTINO_ID: 'unknown' }]) {
    assert.throws(() => h.context.balances_(accounts, [{ ESTADO: 'Pagado', PAGADO: 1, ...m }]), /inexistente|incompletas/);
  }
  const sheet = h.sheets.MOVIMIENTOS;
  sheet.data[1][sheet.data[0].indexOf('CUENTA_DESTINO_ID')] = 'unknown';
  assert.equal(h.call('bootstrap').status, 503);
  assert.equal(h.call('statistics').status, 503);
  assert.equal(h.call('movements').success, true);
});

test('mixed accountless and historical ledger keeps legacy balances and investment totals independent', () => {
  const h = harness(); const f = h.ready();
  const create = changes => {
    const result = h.call('create', { movement: f.movement({ ESTADO: 'Pagado', ...changes }) });
    assert.equal(result.success, true, result.message);
    return result.data;
  };
  const original = create({ ESTADO: 'Pendiente' });
  create({ TIPO: 'Pago', CUENTA: undefined, MOVIMIENTO_ORIGEN_ID: original.ID });
  create({ CUENTA: '', TOTAL: 20, VALOR_UNITARIO: 20 });
  create({ TIPO: 'Ingreso', CUENTA: undefined, TOTAL: 10, VALOR_UNITARIO: 10 });
  create({ TIPO: 'Transferencia', CUENTA: undefined });
  const historicalTransfer = create({ TIPO: 'Transferencia', CUENTA_DESTINO_ID: f.destination.ID });
  const edited = h.call('update', { movement: { ...historicalTransfer, CUENTA: undefined, CUENTA_DESTINO_ID: undefined, DESCRIPCION: 'Preserve active transfer' } });
  assert.equal(edited.success, true, edited.message);
  assert.equal(edited.data.CUENTA, f.account.ID);
  assert.equal(edited.data.CUENTA_DESTINO_ID, f.destination.ID);
  const bootstrap = h.call('bootstrap').data;
  assert.equal(bootstrap.cuentas.find(a => a.ID === f.account.ID).SALDO_ACTUAL, 60);
  assert.equal(bootstrap.cuentas.find(a => a.ID === f.destination.ID).SALDO_ACTUAL, 40);
  const stats = h.call('statistics').data;
  assert.equal(stats.resumen.gastos, 60);
  assert.equal(stats.resumen.pendiente, 0);
  assert.equal(stats.resumen.egresos, 60);
  assert.equal(stats.resumen.ingresos, 10);
  assert.equal(stats.resumen.transferencias, 80);
  assert.equal(stats.saldos.find(a => a.CUENTA === f.account.ID).SALDO, 60);
  assert.equal(stats.saldos.find(a => a.CUENTA === f.destination.ID).SALDO, 40);
});
