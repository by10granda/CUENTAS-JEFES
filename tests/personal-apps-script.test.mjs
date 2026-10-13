import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(new URL('../apps-script/personal/Code.gs', import.meta.url), 'utf8');
const plain = v => JSON.parse(JSON.stringify(v));
const namespace = { service: 'personal-finance', spreadsheetId: '1WU3UF1gTgut-Yx2dUn51Kk1fu2EHtnQSfxOOdx15-Y0' };

function harness() {
  let writes = 0, held = false, rejectLock = false, fail = null, persistentFail = false, flushFail = false;
  class Sheet {
    constructor(name, data = []) { this.name = name; this.data = structuredClone(data); }
    getName() { return this.name; }
    getLastRow() { return this.data.length; }
    getLastColumn() { return Math.max(0, ...this.data.map(r => r.length)); }
    getRange(r, c, h, w) {
      return {
        getValues: () => Array.from({ length: h }, (_, i) => Array.from({ length: w }, (_, j) => this.data[r - 1 + i]?.[c - 1 + j] ?? '')),
        setValues: values => {
          assert.equal(held, true, 'every write must hold ScriptLock');
          writes++;
          if (fail?.(this.name, values, writes)) { if (!persistentFail) fail = null; throw new Error('Synthetic partial failure'); }
          for (let i = 0; i < h; i++) {
            this.data[r - 1 + i] ||= [];
            for (let j = 0; j < w; j++) {
              let value = values[i][j];
              if (typeof value === 'string' && value.startsWith("'")) value = value.slice(1);
              this.data[r - 1 + i][c - 1 + j] = value;
            }
          }
        }
      };
    }
  }
  const sheets = { Hoja1: new Sheet('Hoja1', [['Original'], ['Preserved']]) };
  const ss = {
    getSheets: () => Object.values(sheets), getSheetByName: name => sheets[name] || null,
    insertSheet: name => { assert.equal(held, true); writes++; return sheets[name] = new Sheet(name); },
    getSpreadsheetTimeZone: () => 'America/Guayaquil'
  };
  const props = {};
  const files = [];
  let folderAccess = 'PRIVATE', folderFailure = false, simulatedToday = null;
  const context = vm.createContext({
    SpreadsheetApp: { openById: id => { assert.equal(id, '1WU3UF1gTgut-Yx2dUn51Kk1fu2EHtnQSfxOOdx15-Y0'); return ss; }, flush() { if (flushFail) { flushFail = false; throw new Error('Synthetic uncertain flush'); } } },
    LockService: { getScriptLock: () => ({ tryLock: () => { held = !rejectLock; return held; }, releaseLock() { held = false; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType: () => text }) },
    Utilities: {
      getUuid: randomUUID, DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_a, value) => [...createHash('sha256').update(value).digest()].map(b => b > 127 ? b - 256 : b),
      formatDate: (date, zone) => { assert.equal(zone, 'America/Guayaquil'); return simulatedToday || new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); },
      base64Decode: s => Array.from(Buffer.from(s, 'base64'), b => b > 127 ? b - 256 : b),
      base64Encode: bytes => Buffer.from(bytes).toString('base64'),
      newBlob: (bytes, mimeType, filename) => ({ bytes, mimeType, filename })
    },
    DriveApp: {
      Access: { PRIVATE: 'PRIVATE' }, getFolderById: id => {
        assert.equal(id, 'synthetic-private-folder');
        if (folderFailure) throw new Error('Synthetic Drive access denied; private deployment details');
        return { getSharingAccess: () => folderAccess, createFile: blob => {
          assert.equal(held, true); const file = { blob, getId: () => 'synthetic_file_' + files.length, getSharingAccess: () => folderAccess };
          files.push(file); return file;
        } };
      }
    }
  });
  vm.runInContext(source, context, { filename: 'personal/Code.gs' });
  const call = (action, payload = {}, extra = {}) => {
    const result = JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ action, payload, user: { username: 'owner', name: 'Synthetic Owner', role: 'personal' }, ...extra }) } }));
    assert.equal(result.service, namespace.service); assert.equal(result.spreadsheetId, namespace.spreadsheetId);
    if (!result.success) {
      assert.equal(typeof result.message, 'string'); assert.ok(result.message.length > 0);
      assert.equal(Object.hasOwn(result, 'error'), false); assert.ok(Number.isInteger(result.status));
      assert.doesNotMatch(result.message, /Invalid |Unknown |Insufficient |Request reserved|Operation uncertain|Internal failure|Generation exceeds/);
    }
    return result;
  };
  const mutate = (action, payload = {}, extra = {}) => call(action, { requestId: randomUUID(), ...payload }, extra);
  const ok = result => { assert.equal(result.success, true, JSON.stringify(result)); return result.data; };
  const save = (sheet, row) => ok(mutate('save', { sheet, row })).row;
  const boot = () => ok(call('bootstrap'));
  const rows = sheet => plain(context.pRead(ss, sheet));
  const setup = () => context.setupPersonalSpreadsheet();
  const ready = () => {
    setup();
    const account = save('Cuentas', { NOMBRE: 'Synthetic checking', TIPO: 'Corriente', SALDO_INICIAL: 1000 });
    const destination = save('Cuentas', { NOMBRE: 'Synthetic cash', TIPO: 'Efectivo', SALDO_INICIAL: 0 });
    const card = save('Cuentas', { NOMBRE: 'Synthetic card', TIPO: 'Tarjeta de crédito', DEUDA_INICIAL: 100, LIMITE_CREDITO: 2000, IDENTIFICADOR: '1234' });
    const category = save('Categorias', { NOMBRE: 'Synthetic expense', TIPO: 'Gasto' });
    const income = save('Categorias', { NOMBRE: 'Synthetic income', TIPO: 'Ingreso' });
    const beneficiary = save('Beneficiarios', { NOMBRE: 'Synthetic beneficiary', TIPO: 'Persona' });
    const tx = (type, changes = {}) => mutate('transaction', { type, FECHA: boot().hoy, DESCRIPCION: 'Synthetic financial event', MONTO: 50, CUENTA: account.ID, ...(['income', 'egress', 'cardpurchase'].includes(type) ? { CATEGORIA: type === 'income' ? income.ID : category.ID } : {}), ...changes });
    const quota = changes => save('Cuotas', { TITULO: 'Synthetic commitment', MONTO: 100, FECHA_VENCIMIENTO: boot().hoy, BENEFICIARIO: beneficiary.ID, CATEGORIA: category.ID, ...changes });
    const pay = (q, changes = {}) => mutate('pay', { cuotaId: q.ID, CUENTA: account.ID, MONTO: 25, FECHA: boot().hoy, DESCRIPCION: 'Synthetic payment', ...changes });
    return { account, destination, card, category, income, beneficiary, tx, quota, pay };
  };
  return { context, sheets, ss, props, files, call, mutate, ok, save, boot, rows, setup, ready, Sheet,
    writes: () => writes, failNext: fn => { fail = fn; persistentFail = false; }, failWrites: fn => { fail = fn; persistentFail = true; }, failFlush: () => { flushFail = true; },
    rejectLock: () => { rejectLock = true; }, held: () => held, folderAccess: v => { folderAccess = v; }, folderFailure: v => { folderFailure = v; }, today: v => { simulatedToday = context.pDate(v); } };
}

test('setup.inspect reports every actual tab; preflight incompatible targets performs zero writes', () => {
  const h = harness();
  h.sheets.Cuentas = new h.Sheet('Cuentas', [['BAD'], ['untouched']]);
  h.sheets.Extra = new h.Sheet('Extra', [['custom'], [42]]);
  const before = JSON.stringify(h.sheets);
  const inspection = plain(h.context.setup.inspect());
  assert.equal(inspection.compatible, false);
  assert.deepEqual(inspection.tabs.map(t => t.name), ['Hoja1', 'Cuentas', 'Extra']);
  assert.equal(inspection.targets.length, 11);
  assert.throws(() => h.setup(), /Incompatible/);
  assert.equal(h.writes(), 0); assert.equal(JSON.stringify(h.sheets), before); assert.equal(h.held(), false);
});

test('setup preserves data, appends optional headers, seeds only system preferences and is idempotent', () => {
  const h = harness();
  h.sheets.Cuentas = new h.Sheet('Cuentas', [['ID', 'USERNAME', 'OP_ID', 'UPDATED_AT', 'NOMBRE', 'TIPO'], ['legacy', 'owner', '', 'historical', 'Preserve', 'Corriente']]);
  h.setup(); const before = JSON.stringify(h.sheets); const writes = h.writes(); h.setup();
  assert.equal(JSON.stringify(h.sheets), before); assert.equal(h.writes(), writes);
  assert.equal(h.rows('Cuentas')[0].NOMBRE, 'Preserve');
  assert.equal(h.sheets.Cuentas.data[0].includes('MONEDA'), true);
  assert.deepEqual(h.sheets.Cuentas.data[1], ['legacy', 'owner', '', 'historical', 'Preserve', 'Corriente'], 'optional header append never backfills existing data');
  assert.deepEqual(h.sheets.Hoja1.data, [['Original'], ['Preserved']]);
  for (const s of ['Beneficiarios', 'Categorias', 'Obligaciones', 'Cuotas', 'Movimientos', 'Transferencias', 'Pagos', 'Auditoria', 'Operaciones']) assert.equal(h.rows(s).length, 0);
  const b = h.boot(); assert.equal(b.cuentas.length, 0, 'blank OP_ID not trusted for financial data');
  assert.equal(b.configuracion.TIMEZONE, 'America/Guayaquil'); assert.equal(b.configuracion.MONEDA, 'USD');
  assert.deepEqual(b.configuracion.METODOS, ['Efectivo', 'Transferencia bancaria', 'Tarjeta de crédito', 'Cheque']);
  assert.equal(b.configuracion.UPLOAD_ENABLED, false); assert.equal(h.rows('Configuracion').length, 6);
});

test('public GET/POST need no secret; malformed claimed identity, unknown fields, routing and lock contention fail validation', () => {
  const h = harness(); h.setup();
  assert.deepEqual(JSON.parse(h.context.doGet()), { ...namespace, success: true, data: { connected: true, initialized: true } });
  assert.equal(h.call('bootstrap').success, true);
  assert.equal(h.call('bootstrap', {}, { secret: 'not-required' }).status, 400, 'removed secret input is an unknown key, not an authentication credential');
  h.props.GAS_API_SECRET = 'ignored-old-property'; assert.equal(h.call('bootstrap').success, true);
  delete h.props.GAS_API_SECRET;
  for (const user of [null, { username: 'owner', name: 'X', role: 'admin' }, { username: ' owner ', name: 'X', role: 'personal' }, { username: 1, name: 'X', role: 'personal' }, { username: 'owner', name: 'X' }]) assert.equal(h.call('bootstrap', {}, { user }).status, 400);
  assert.equal(h.call('personal-bootstrap').status, 404, 'Node strips the prefix; GAS accepts bare actions only');
  assert.equal(h.mutate('constructor').status, 404); assert.equal(h.mutate('__proto__').status, 404);
  assert.equal(h.call('bootstrap', { extra: true }).status, 400);
  h.rejectLock(); assert.equal(h.call('bootstrap').status, 503); assert.equal(h.held(), false);
});

test('account and beneficiary CRUD validates money, card privacy, states and immutable openings', () => {
  const h = harness(), f = h.ready();
  for (const row of [
    { NOMBRE: '', TIPO: 'Corriente' }, { NOMBRE: 'X', TIPO: 'bank' }, { NOMBRE: 'X', TIPO: 'Corriente', SALDO_INICIAL: -1 },
    { NOMBRE: 'X', TIPO: 'Corriente', SALDO_INICIAL: 0.001 }, { NOMBRE: 'X', TIPO: 'Corriente', SALDO_INICIAL: 1e9 + 1 },
    { NOMBRE: 'X', TIPO: 'Corriente', SALDO_INICIAL: '100' }, { NOMBRE: 'X', TIPO: 'Corriente', DIA_CORTE: 1 },
    { NOMBRE: 'X', TIPO: 'Tarjeta de crédito', IDENTIFICADOR: '1234567890123456' }, { NOMBRE: 'X', TIPO: 'Tarjeta de crédito', CVV: '123' },
    { NOMBRE: 'X', TIPO: 'Tarjeta de crédito', DEUDA_INICIAL: 20, LIMITE_CREDITO: 10 }, { NOMBRE: 'X', TIPO: 'Efectivo', IDENTIFICADOR: '123' },
    { NOMBRE: 'X', TIPO: 'Corriente', FECHA_APERTURA: '2025-02-29' }
  ]) assert.equal(h.mutate('save', { sheet: 'Cuentas', row }).success, false, JSON.stringify(row));
  let edited = h.save('Cuentas', { ID: f.account.ID, UPDATED_AT: f.account.UPDATED_AT, NOMBRE: 'Renamed' });
  assert.notEqual(edited.UPDATED_AT, f.account.UPDATED_AT);
  assert.equal(h.mutate('save', { sheet: 'Cuentas', row: { ID: edited.ID, UPDATED_AT: f.account.UPDATED_AT, NOMBRE: 'stale' } }).status, 409);
  h.ok(f.tx('egress')); edited = h.boot().cuentas.find(a => a.ID === f.account.ID);
  assert.equal(h.mutate('save', { sheet: 'Cuentas', row: { ID: edited.ID, UPDATED_AT: edited.UPDATED_AT, SALDO_INICIAL: 2000 } }).status, 409);
  assert.equal(h.mutate('save', { sheet: 'Beneficiarios', row: { NOMBRE: 'X', TIPO: 'Persona', EMAIL: 'bad' } }).success, false);
  const inactive = h.save('Beneficiarios', { ID: f.beneficiary.ID, UPDATED_AT: f.beneficiary.UPDATED_AT, ESTADO: 'Inactivo' });
  assert.equal(inactive.ESTADO, 'Inactivo'); assert.ok(h.rows('Auditoria').every(a => a.ANTES && a.DESPUES));
  assert.equal(h.rows('Cuentas').filter(a => a.ID === f.account.ID).length, 3);
});

test('idempotency binds input/action/username; retries return original versions after edits', () => {
  const h = harness(); h.setup();
  const p = { requestId: randomUUID(), sheet: 'Cuentas', row: { NOMBRE: 'One', TIPO: 'Corriente', SALDO_INICIAL: 100 } };
  const first = h.ok(h.call('save', p)); const count = h.writes(); assert.deepEqual(h.ok(h.call('save', p)), first); assert.equal(h.writes(), count);
  assert.equal(h.call('save', { ...p, row: { ...p.row, NOMBRE: 'Other' } }).status, 409);
  assert.equal(h.call('save', p, { user: { username: 'other', name: 'Other', role: 'personal' } }).status, 409);
  h.save('Cuentas', { ID: first.row.ID, UPDATED_AT: first.row.UPDATED_AT, NOMBRE: 'New version' });
  assert.deepEqual(h.ok(h.call('save', p)), first);
  assert.equal(h.rows('Operaciones').filter(o => o.REQUEST_ID === p.requestId).length, 2);
});

test('ownership, inactive references, unknown assignment fields, category classification and calendar validation', () => {
  const h = harness(), f = h.ready();
  const foreign = h.ok(h.mutate('save', { sheet: 'Categorias', row: { NOMBRE: 'Foreign', TIPO: 'Gasto' } }, { user: { username: 'other', name: 'Other', role: 'personal' } })).row;
  for (const changes of [{ CATEGORIA: foreign.ID }, { CATEGORIA: f.income.ID }, { CUENTA: 'unknown' }, { MONTO: -1 }, { MONTO: 0 }, { MONTO: 1.001 }, { MONTO: '1' }, { FECHA: '2026-02-30' }, { FECHA: '2025-02-29' }, { DESCRIPCION: ' ' }, { METODO: 'fake' }, { ASIENTOS: '[]' }, { COMPROBANTE_URL: 'https://evil.test/x' }]) assert.equal(f.tx('egress', changes).success, false, JSON.stringify(changes));
  h.save('Categorias', { ID: f.category.ID, UPDATED_AT: f.category.UPDATED_AT, ESTADO: 'Inactiva' });
  assert.equal(f.tx('egress').success, false);
  assert.equal(h.boot().categorias.some(c => c.ID === foreign.ID), false);
});

test('transfer is a single two-posting movement plus fee expense; balances and reversal conserve money', () => {
  const h = harness(), f = h.ready();
  const result = h.ok(f.tx('transfer', { DESTINO: f.destination.ID, MONTO: 100, COMISION: 3, CATEGORIA: f.category.ID }));
  assert.equal(result.movimientos.length, 2); assert.equal(result.movimientos.filter(m => m.TIPO === 'Transferencia').length, 1);
  assert.equal(JSON.parse(result.movimientos[0].ASIENTOS).length, 2);
  let b = h.boot(); assert.equal(b.cuentas.find(a => a.ID === f.account.ID).SALDO_ACTUAL, 897); assert.equal(b.cuentas.find(a => a.ID === f.destination.ID).SALDO_ACTUAL, 100);
  assert.equal(b.movimientos.filter(m => m.TIPO === 'Gasto').reduce((s, m) => s + m.MONTO, 0), 3);
  assert.equal(f.tx('transfer', { DESTINO: f.account.ID }).success, false); assert.equal(f.tx('transfer', { DESTINO: f.card.ID }).success, false);
  h.ok(h.mutate('void', { operationId: result.movimientos[0].OP_ID, MOTIVO: 'Synthetic reversal' }));
  b = h.boot(); assert.equal(b.cuentas.find(a => a.ID === f.account.ID).SALDO_ACTUAL, 1000); assert.equal(b.cuentas.find(a => a.ID === f.destination.ID).SALDO_ACTUAL, 0);
  assert.ok(b.movimientos.every(m => m.ESTADO === 'Anulado')); assert.equal(b.transferencias[0].ESTADO, 'Anulado');
  assert.equal(h.rows('Movimientos').length, 4, 'history retained');
});

test('overdraft off, overdraft preference, and void checks funds in every affected account', () => {
  const h = harness(), f = h.ready();
  assert.equal(f.tx('egress', { MONTO: 1001 }).status, 409);
  const transfer = h.ok(f.tx('transfer', { DESTINO: f.destination.ID, MONTO: 100 }));
  h.ok(f.tx('egress', { CUENTA: f.destination.ID, MONTO: 90 }));
  assert.equal(h.mutate('void', { operationId: transfer.movimientos[0].OP_ID, MOTIVO: 'Would overdraw' }).status, 409);
  h.ok(h.mutate('configure', { preferences: { PERMITIR_SOBREGIRO: true, DIAS_ALERTA: 10, CANAL_EMAIL: 'future-channel' } }));
  h.ok(h.mutate('void', { operationId: transfer.movimientos[0].OP_ID, MOTIVO: 'Approved overdraft reversal' }));
  assert.equal(h.boot().cuentas.find(a => a.ID === f.destination.ID).SALDO_ACTUAL, -90);
  assert.equal(h.mutate('configure', { preferences: { PERMITIR_SOBREGIRO: false } }).status, 409);
  assert.equal(h.mutate('configure', { preferences: { GAS_API_SECRET: 'no' } }).success, false);
});

test('commitments have no ledger until paid; partial/late payments compute state and cancellations retain history', () => {
  const h = harness(), f = h.ready(); const yesterday = h.context.pAddDays(h.boot().hoy, -1);
  const q = f.quota({ FECHA_VENCIMIENTO: yesterday }); assert.equal(h.boot().movimientos.length, 0);
  let enriched = h.boot().obligaciones.find(x => x.ID === q.ID); assert.equal(enriched.VENCIDO, true); assert.equal(enriched.PENDIENTE, 100);
  const partial = h.ok(f.pay(q)); enriched = h.boot().obligaciones.find(x => x.ID === q.ID);
  assert.equal(enriched.PAGADO, 25); assert.equal(enriched.PENDIENTE, 75); assert.equal(enriched.ESTADO_ACTUAL, 'Pago parcial');
  assert.equal(h.mutate('save', { sheet: 'Cuotas', row: { ID: q.ID, UPDATED_AT: q.UPDATED_AT, MONTO: 24 } }).status, 409);
  assert.equal(h.mutate('void', { cuotaId: q.ID, UPDATED_AT: q.UPDATED_AT, MOTIVO: 'Cancel' }).status, 409);
  assert.equal(f.pay(q, { MONTO: 76 }).success, false);
  const remaining = h.ok(f.pay(q, { MONTO: 75 })); enriched = h.boot().obligaciones.find(x => x.ID === q.ID);
  assert.equal(enriched.ESTADO_ACTUAL, 'Pagado'); assert.equal(enriched.VENCIDO, false);
  h.ok(h.mutate('void', { operationId: remaining.movimientos[0].OP_ID, MOTIVO: 'Reverse final payment' }));
  h.ok(h.mutate('void', { operationId: partial.movimientos[0].OP_ID, MOTIVO: 'Reverse partial payment' }));
  h.ok(h.mutate('void', { cuotaId: q.ID, UPDATED_AT: q.UPDATED_AT, MOTIVO: 'Cancel unpaid commitment' }));
  assert.equal(h.boot().obligaciones.find(x => x.ID === q.ID).ESTADO_ACTUAL, 'Anulado');
  assert.equal(h.boot().cuentas.find(x => x.ID === f.account.ID).SALDO_ACTUAL, 1000);
  assert.equal(h.rows('Pagos').length, 4);
});

test('generation clamps leap February, preserves immutable planned keys and changes only unissued amounts', () => {
  const h = harness(), f = h.ready();
  const saved = h.ok(h.mutate('save', { sheet: 'Obligaciones', row: { TITULO: 'Month end', MONTO: 20, FRECUENCIA: 'Mensual', INICIO: '2028-01-31', DIA: 31, CATEGORIA: f.category.ID } }));
  assert.equal(saved.generated.length, 0);
  const run = until => plain(h.context.pLock(() => h.context.pOperation(h.ss, h.context.pState(h.ss, 'owner'), 'generate', { requestId: randomUUID(), until }, ctx => { ctx.state.cfg.HOY = '2028-01-01'; return { generated: h.context.pGenerate(ctx, until, saved.row.ID) }; })));
  let generated = run('2028-03-31').generated; assert.deepEqual(generated.map(q => q.FECHA_VENCIMIENTO), ['2028-01-31', '2028-02-29', '2028-03-31']);
  assert.equal(run('2028-03-31').generated.length, 0);
  const feb = generated[1]; const changed = h.save('Cuotas', { ID: feb.ID, UPDATED_AT: feb.UPDATED_AT, FECHA_VENCIMIENTO: '2028-03-02', MONTO: 25 });
  assert.equal(changed.FECHA_PROGRAMADA, '2028-02-29'); assert.equal(changed.CLAVE_PERIODO, feb.CLAVE_PERIODO);
  h.ok(h.mutate('void', { cuotaId: changed.ID, UPDATED_AT: changed.UPDATED_AT, MOTIVO: 'Skip month' })); assert.equal(run('2028-03-31').generated.length, 0);
  const edited = h.save('Obligaciones', { ID: saved.row.ID, UPDATED_AT: saved.row.UPDATED_AT, MONTO: 30 });
  generated = run('2028-04-30').generated; assert.equal(generated.length, 1); assert.equal(generated[0].MONTO, 30);
  assert.equal(h.boot().obligaciones.find(q => q.ID === feb.ID).MONTO, 25);
  h.save('Obligaciones', { ID: edited.ID, UPDATED_AT: edited.UPDATED_AT, ESTADO: 'Suspendida' }); assert.equal(run('2028-05-31').generated.length, 0);
  assert.equal(h.boot().movimientos.length, 0);
});

test('weekly/quincenal anchored intervals, single payments, recurrence limits and active dependencies', () => {
  const h = harness(), f = h.ready(); const today = h.boot().hoy;
  for (const [frequency, step] of [['Semanal', 7], ['Quincenal', 15]]) {
    const saved = h.ok(h.mutate('save', { sheet: 'Obligaciones', row: { TITULO: frequency, MONTO: 10, FRECUENCIA: frequency, INICIO: today, FIN: h.context.pAddDays(today, 30) } }));
    assert.equal(saved.generated.length, Math.floor(30 / step) + 1);
    assert.deepEqual(saved.generated.map(q => q.FECHA_PROGRAMADA), Array.from({ length: Math.floor(30 / step) + 1 }, (_, n) => h.context.pAddDays(today, n * step)));
  }
  const single = h.ok(h.mutate('save', { sheet: 'Obligaciones', row: { TITULO: 'Once', MONTO: 10, FRECUENCIA: 'Pago único', INICIO: today } })); assert.equal(single.generated.length, 1);
  assert.equal(h.ok(h.mutate('generate')).generated.length, 0);
  assert.equal(h.mutate('generate', { until: h.context.pAddDays(today, 367) }).success, false);
  const older = h.ok(h.mutate('save', { sheet: 'Obligaciones', row: { TITULO: 'Longstanding weekly', MONTO: 1, FRECUENCIA: 'Semanal', INICIO: h.context.pAddDays(today, -800) } }));
  assert.ok(older.generated.length > 0); assert.ok(older.generated.every(q => q.FECHA_PROGRAMADA >= today));
  assert.equal(h.mutate('save', { sheet: 'Cuotas', row: { TITULO: 'Injected', MONTO: 10, FECHA_VENCIMIENTO: today, TARJETA: f.card.ID } }).success, false);
});

test('credit purchase books one expense, installments split cents exactly; FIFO payments avoid double expense', () => {
  const h = harness(), f = h.ready();
  const purchase = h.ok(f.tx('cardpurchase', { CUENTA: f.card.ID, MONTO: 100.01, CUOTAS: 3, PRIMER_VENCIMIENTO: '2027-01-31' }));
  assert.deepEqual(purchase.cuotas.map(q => q.MONTO), [33.34, 33.34, 33.33]);
  assert.deepEqual(purchase.cuotas.map(q => q.FECHA_VENCIMIENTO), ['2027-01-31', '2027-02-28', '2027-03-31']);
  let b = h.boot(); assert.equal(b.cuentas.find(a => a.ID === f.card.ID).DEUDA_ACTUAL, 200.01); assert.equal(b.cuentas.find(a => a.ID === f.card.ID).SALDO_ACTUAL, null);
  assert.equal(b.cuentas.find(a => a.ID === f.card.ID).CREDITO_DISPONIBLE, 1799.99);
  const payment = h.ok(f.tx('cardpayment', { DESTINO: f.card.ID, MONTO: 50 }));
  assert.deepEqual(payment.pagos.map(p => p.MONTO), [33.34, 16.66]);
  b = h.boot(); assert.equal(b.cuentas.find(a => a.ID === f.account.ID).SALDO_ACTUAL, 950); assert.equal(b.cuentas.find(a => a.ID === f.card.ID).DEUDA_ACTUAL, 150.01);
  assert.equal(b.movimientos.filter(m => m.TIPO === 'Compra tarjeta').reduce((s, m) => s + m.MONTO, 0), 100.01);
  assert.equal(h.mutate('void', { operationId: purchase.movimientos[0].OP_ID, MOTIVO: 'Dependent payment' }).status, 409);
  assert.equal(f.tx('cardpayment', { DESTINO: f.card.ID, MONTO: 150.02 }).success, false);
  assert.equal(f.tx('cardpurchase', { CUENTA: f.card.ID, MONTO: 1900 }).status, 409);
  h.ok(h.mutate('void', { operationId: payment.movimientos[0].OP_ID, MOTIVO: 'Reverse payment' }));
  h.ok(h.mutate('void', { operationId: purchase.movimientos[0].OP_ID, MOTIVO: 'Reverse purchase' }));
  b = h.boot(); assert.equal(b.cuentas.find(a => a.ID === f.card.ID).DEUDA_ACTUAL, 100); assert.ok(b.obligaciones.every(q => q.ESTADO === 'Anulado'));
});

test('pay card installment reduces debt, initial debt can be paid without schedules, ordinary card payment is expense', () => {
  const h = harness(), f = h.ready();
  const purchase = h.ok(f.tx('cardpurchase', { CUENTA: f.card.ID, MONTO: 60, CUOTAS: 2 }));
  const paid = h.ok(f.pay(purchase.cuotas[0], { MONTO: 30 })); assert.equal(paid.movimientos[0].TIPO, 'Pago tarjeta');
  assert.equal(h.boot().obligaciones.find(q => q.ID === purchase.cuotas[0].ID).PENDIENTE, 0);
  h.ok(f.tx('cardpayment', { DESTINO: f.card.ID, MONTO: 130 })); assert.equal(h.boot().cuentas.find(a => a.ID === f.card.ID).DEUDA_ACTUAL, 0);
  const normal = f.quota({ MONTO: 20 }); const result = h.ok(f.pay(normal, { CUENTA: f.card.ID, MONTO: 20 }));
  assert.equal(result.movimientos[0].TIPO, 'Compra tarjeta'); assert.equal(h.boot().cuentas.find(a => a.ID === f.card.ID).DEUDA_ACTUAL, 20);
});

test('reconciliation is explicit signed audited delta, rejects stale token and never rewrites ledger', () => {
  const h = harness(), f = h.ready(); h.ok(f.tx('egress', { MONTO: 100 }));
  const payload = { CUENTA: f.account.ID, OBSERVADO: 850, FECHA: h.boot().hoy, MOTIVO: 'Synthetic observed statement', UPDATED_AT: f.account.UPDATED_AT };
  assert.equal(h.mutate('reconcile', payload).status, 409);
  const account = h.boot().cuentas.find(a => a.ID === f.account.ID);
  const result = h.ok(h.mutate('reconcile', { ...payload, UPDATED_AT: account.UPDATED_AT }));
  assert.equal(result.movimientos[0].DIFERENCIA, -50); assert.equal(result.movimientos[0].TIPO, 'Ajuste'); assert.equal(result.movimientos[0].OBSERVADO, 850);
  assert.equal(h.boot().cuentas.find(a => a.ID === f.account.ID).SALDO_ACTUAL, 850);
  assert.equal(h.rows('Movimientos').length, 2);
  const current = h.boot().cuentas.find(a => a.ID === f.account.ID);
  assert.equal(h.mutate('reconcile', { ...payload, UPDATED_AT: current.UPDATED_AT, MOTIVO: '' }).success, false);
  assert.equal(h.mutate('reconcile', { ...payload, UPDATED_AT: current.UPDATED_AT, OBSERVADO: -10 }).status, 409);
  h.ok(h.mutate('configure', { preferences: { PERMITIR_SOBREGIRO: true } }));
  h.ok(h.mutate('reconcile', { ...payload, UPDATED_AT: current.UPDATED_AT, OBSERVADO: -10 }));
  assert.equal(h.boot().cuentas.find(a => a.ID === f.account.ID).SALDO_ACTUAL, -10);
});

test('partial write leaves both accounts unchanged, original versions visible, request reserved and explicit discard required', () => {
  const h = harness(), f = h.ready();
  const payload = { requestId: randomUUID(), type: 'transfer', CUENTA: f.account.ID, DESTINO: f.destination.ID, MONTO: 100, COMISION: 3, CATEGORIA: f.category.ID, FECHA: h.boot().hoy, DESCRIPCION: 'Synthetic uncertain transfer' };
  // First canonical transfer is physically appended, then fee fails. No committed half-operation.
  let ledgerWrites = 0; h.failNext((sheet) => sheet === 'Movimientos' && ++ledgerWrites === 2);
  assert.equal(h.call('transaction', payload).status, 503);
  const b = h.boot(); assert.equal(b.movimientos.length, 0); assert.equal(h.rows('Movimientos').length, 1);
  assert.equal(b.cuentas.find(a => a.ID === f.account.ID).SALDO_ACTUAL, 1000); assert.equal(b.cuentas.find(a => a.ID === f.destination.ID).SALDO_ACTUAL, 0);
  assert.equal(b.cuentas.find(a => a.ID === f.account.ID).UPDATED_AT, f.account.UPDATED_AT);
  assert.equal(b.operacionesPendientes.length, 1); assert.equal(b.operacionesPendientes[0].ESTADO, 'PENDIENTE_CONCILIACION');
  assert.equal(typeof b.operacionesPendientes[0].ERROR, 'string'); assert.ok(b.operacionesPendientes[0].ERROR.length > 0);
  const count = h.writes(); assert.equal(h.call('transaction', payload).status, 409); assert.equal(h.writes(), count);
  assert.equal(h.call('transaction', { ...payload, requestId: randomUUID() }).status, 409, 'fresh UUID blocked before manual resolution');
  assert.equal(h.mutate('resolveOperation', { operationId: b.operacionesPendientes[0].ID, MOTIVO: 'Review' }, { user: { username: 'other', name: 'Other', role: 'personal' } }).status, 409);
  h.ok(h.mutate('resolveOperation', { operationId: b.operacionesPendientes[0].ID, MOTIVO: 'Reviewed physical rows; discard failed transfer' }));
  assert.equal(h.boot().operacionesPendientes.length, 0); assert.equal(h.call('transaction', payload).status, 409);
  const fresh = h.ok(h.call('transaction', { ...payload, requestId: randomUUID() })); assert.equal(fresh.movimientos.length, 2);
  assert.equal(h.boot().cuentas.find(a => a.ID === f.account.ID).SALDO_ACTUAL, 897);
  assert.equal(h.mutate('resolveOperation', { operationId: fresh.movimientos[0].OP_ID, MOTIVO: 'Cannot discard committed' }).status, 409);
});

test('partial edit preserves older confirmed version and prepared marker survives pending marker failure', () => {
  const h = harness(), f = h.ready();
  h.failNext(sheet => sheet === 'Auditoria');
  assert.equal(h.mutate('save', { sheet: 'Cuentas', row: { ID: f.account.ID, UPDATED_AT: f.account.UPDATED_AT, NOMBRE: 'Uncommitted rename' } }).status, 503);
  assert.equal(h.boot().cuentas.find(a => a.ID === f.account.ID).NOMBRE, 'Synthetic checking');
  assert.equal(h.rows('Cuentas').filter(a => a.ID === f.account.ID).length, 2);
  assert.equal(h.boot().operacionesPendientes.length, 1);
  const second = harness(), g = second.ready();
  second.failWrites((sheet, values) => sheet === 'Auditoria' || (sheet === 'Operaciones' && values[0][second.sheets.Operaciones.data[0].indexOf('ESTADO')].replace(/^'/, '') === 'PENDIENTE_CONCILIACION'));
  const p = { requestId: randomUUID(), sheet: 'Cuentas', row: { ID: g.account.ID, UPDATED_AT: g.account.UPDATED_AT, NOMBRE: 'Not committed' } };
  assert.equal(second.call('save', p).status, 503); assert.equal(second.boot().operacionesPendientes[0].ESTADO, 'PREPARADA');
  assert.equal(second.call('save', p).status, 409);
});

test('verification detects unexpected changed row; no financial effect', () => {
  const h = harness(), f = h.ready();
  h.failNext((sheet, values) => { if (sheet === 'Movimientos') { const idx = h.sheets.Movimientos.data[0].indexOf('MONTO'); values[0][idx] += 1; } return false; });
  assert.equal(f.tx('egress').status, 503);
  assert.equal(h.boot().movimientos.length, 0); assert.equal(h.boot().cuentas.find(a => a.ID === f.account.ID).SALDO_ACTUAL, 1000);
  assert.equal(h.boot().operacionesPendientes.length, 1);
});

test('private Drive storage validates MIME/magic/size, never shares, retries once and public backup excludes properties/bytes', () => {
  const h = harness(), f = h.ready();
  const pdf = Buffer.from('%PDF-1.7\nsynthetic-only').toString('base64');
  const payload = { requestId: randomUUID(), filename: 'synthetic.pdf', mimeType: 'application/pdf', base64: pdf };
  assert.equal(h.call('upload', payload).status, 503); assert.equal(h.files.length, 0);
  h.props.DRIVE_FOLDER_ID = 'synthetic-private-folder'; assert.equal(h.boot().configuracion.UPLOAD_ENABLED, true);
  for (const changes of [{ mimeType: 'text/plain' }, { filename: '../x.pdf' }, { filename: 'x.png' }, { base64: 'not base64!' }, { base64: Buffer.from('not pdf').toString('base64') }, { base64: Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64') }]) assert.equal(h.call('upload', { ...payload, ...changes }).success, false);
  h.folderAccess('ANYONE_WITH_LINK'); assert.equal(h.call('upload', payload).success, false); h.folderAccess('PRIVATE');
  const uploaded = h.ok(h.call('upload', payload)); assert.match(uploaded.url, /^https:\/\/drive\.google\.com\/file\/d\//);
  assert.deepEqual(h.ok(h.call('upload', payload)), uploaded); assert.equal(h.files.length, 1);
  h.ok(f.tx('egress', { COMPROBANTE_URL: uploaded.url }));
  const backup = h.ok(h.call('backup')); assert.equal(backup.schemaVersion, 1); assert.equal(backup.schemas.Cuentas.includes('OP_ID'), true);
  assert.equal(JSON.stringify(backup).includes(pdf), false); assert.equal(JSON.stringify(backup).includes('DRIVE_FOLDER_ID'), false);
  assert.equal(backup.tables.Auditoria.some(a => a.ENTIDAD === 'Drive'), true);
  assert.equal(backup.tables.Movimientos.length, 1);
});

test('formula-like descriptions are escaped but returned unchanged; dates include real leap days', () => {
  const h = harness(); h.today('2028-02-29'); const f = h.ready();
  const created = h.ok(f.tx('income', { DESCRIPCION: '=IMPORTXML("synthetic")', FECHA: '2028-02-29', MONTO: 0.01 }));
  assert.equal(created.movimientos[0].DESCRIPCION, '=IMPORTXML("synthetic")');
  assert.equal(h.boot().movimientos[0].DESCRIPCION, created.movimientos[0].DESCRIPCION);
  assert.equal(h.boot().cuentas.find(a => a.ID === f.account.ID).SALDO_ACTUAL, 1000.01);
});

test('arbitrarily reordered/duplicate/unknown/missing mandatory headers fail setup before all writes', () => {
  for (const mutateHeaders of [h => h.reverse(), h => { h[4] = h[5]; return h; }, h => { h.push('CVV'); return h; }, h => h.filter(k => k !== 'ID')]) {
    const h = harness(); const headers = mutateHeaders(plain(h.context.PERSONAL_SCHEMAS.Cuentas));
    h.sheets.Cuentas = new h.Sheet('Cuentas', [headers, headers.map(() => 'preserve')]);
    assert.equal(h.context.setup.inspect().compatible, false);
    const before = JSON.stringify(h.sheets); assert.throws(() => h.setup(), /Incompatible/); assert.equal(h.writes(), 0); assert.equal(JSON.stringify(h.sheets), before);
  }
});

test('confirmed money strings normalize; malformed pending monetary versions stay completely invisible', () => {
  const h = harness(), f = h.ready();
  const a = h.sheets.Cuentas, headers = a.data[0], idx = headers.indexOf('SALDO_INICIAL'); a.data[1][idx] = '1000.00';
  assert.equal(typeof h.boot().cuentas.find(x => x.ID === f.account.ID).SALDO_INICIAL, 'number');
  h.failNext((sheet, values) => { if (sheet === 'Movimientos') values[0][h.sheets.Movimientos.data[0].indexOf('MONTO')] = 'corrupt pending only'; return false; });
  assert.equal(f.tx('egress').status, 503);
  assert.equal(h.boot().movimientos.length, 0); assert.equal(h.boot().cuentas.find(x => x.ID === f.account.ID).SALDO_ACTUAL, 1000);
  assert.equal(h.boot().operacionesPendientes.length, 1);
});

test('uncertain confirmation response retries confirmed result and never duplicates ledger', () => {
  const h = harness(), f = h.ready();
  const payload = { requestId: randomUUID(), type: 'egress', CUENTA: f.account.ID, CATEGORIA: f.category.ID, MONTO: 30, FECHA: h.boot().hoy, DESCRIPCION: 'Uncertain confirmed response' };
  h.failNext((sheet, values) => {
    if (sheet === 'Operaciones' && values[0][h.sheets.Operaciones.data[0].indexOf('ESTADO')].replace(/^'/, '') === 'CONFIRMADA') h.failFlush();
    return false;
  });
  assert.equal(h.call('transaction', payload).status, 503);
  assert.equal(h.boot().movimientos.length, 1); assert.equal(h.boot().operacionesPendientes.length, 0);
  h.failNext(() => false);
  const count = h.writes(); const retry = h.ok(h.call('transaction', payload)); assert.equal(retry.movimientos.length, 1); assert.equal(h.writes(), count);
  assert.equal(h.boot().cuentas.find(a => a.ID === f.account.ID).SALDO_ACTUAL, 970);
});

test('120 credit installments fit bounded journal with compact original-version retry results', () => {
  const h = harness(), f = h.ready();
  const payload = { requestId: randomUUID(), type: 'cardpurchase', CUENTA: f.card.ID, CATEGORIA: f.category.ID, MONTO: 120.01, CUOTAS: 120, FECHA: h.boot().hoy, DESCRIPCION: 'Synthetic long schedule' };
  const result = h.ok(h.call('transaction', payload)); assert.equal(result.cuotas.length, 120);
  assert.equal(result.cuotas.reduce((sum, q) => sum + Math.round(q.MONTO * 100), 0), 12001);
  assert.deepEqual(h.ok(h.call('transaction', payload)), result);
  const op = h.rows('Operaciones').find(o => o.ID === result.movimientos[0].OP_ID && o.ESTADO === 'CONFIRMADA');
  assert.ok(op.MANIFEST.length <= 45000); assert.ok(op.RESULTADO.length <= 45000);
  assert.equal(h.call('transaction', { ...payload, requestId: randomUUID(), CUOTAS: 121 }).success, false);
});

test('quarterly/semestral/yearly definition intervals and finalization preserve issued commitments', () => {
  const h = harness(), f = h.ready(); const today = h.boot().hoy;
  for (const [frequency, months] of [['Trimestral', 3], ['Semestral', 6], ['Anual', 12]]) {
    const saved = h.ok(h.mutate('save', { sheet: 'Obligaciones', row: { TITULO: frequency, MONTO: 10, FRECUENCIA: frequency, INICIO: today, DIA: Number(today.slice(8)) } }));
    h.ok(h.mutate('generate', { definitionId: saved.row.ID, until: h.context.pAddDays(today, 366) }));
    const issued = h.boot().obligaciones.filter(q => q.DEFINICION === saved.row.ID);
    assert.deepEqual(issued.map(q => q.FECHA_PROGRAMADA), Array.from({ length: Math.floor(12 / months) + 1 }, (_, n) => h.context.pMonth(today, n * months)));
    const updated = h.save('Obligaciones', { ID: saved.row.ID, UPDATED_AT: saved.row.UPDATED_AT, ESTADO: 'Finalizada' }); assert.equal(updated.ESTADO, 'Finalizada');
    assert.equal(h.ok(h.mutate('generate', { definitionId: updated.ID })).generated.length, 0);
    assert.equal(h.boot().obligaciones.filter(q => q.DEFINICION === updated.ID).length, issued.length);
  }
  assert.equal(h.boot().movimientos.length, 0); assert.equal(h.boot().pagos.length, 0);
  const older = h.ok(h.mutate('save', { sheet: 'Obligaciones', row: { TITULO: 'Old start', MONTO: 1, FRECUENCIA: 'Mensual', INICIO: h.context.pMonth(today, -40) } }));
  assert.ok(older.generated.length > 0); assert.ok(older.generated.every(q => q.FECHA_PROGRAMADA >= today));
});

test('all mutations require UUID; logical reads/export are side-effect free and tenant-scoped', () => {
  const h = harness(), f = h.ready();
  for (const action of ['save', 'generate', 'transaction', 'pay', 'void', 'reconcile', 'configure', 'upload', 'resolveOperation']) {
    assert.equal(h.call(action).success, false); assert.equal(h.call(action, { requestId: 'not-uuid' }).success, false);
  }
  const before = h.writes(); h.boot(); const backup = h.ok(h.call('backup')); assert.equal(h.writes(), before);
  assert.equal(backup.tables.Cuentas.length, 3);
  const foreignBackup = h.ok(h.call('backup', {}, { user: { username: 'other', name: 'Other', role: 'personal' } }));
  assert.equal(foreignBackup.tables.Cuentas.length, 0); assert.equal(foreignBackup.tables.Operaciones.length, 0);
  assert.equal(h.mutate('pay', { cuotaId: 'foreign', CUENTA: f.account.ID, MONTO: 1, FECHA: h.boot().hoy, DESCRIPCION: 'No' }).status, 404);
});

test('failed receipt audit leaves a private orphan, reserves request and never uploads twice automatically', () => {
  const h = harness(); h.setup(); h.props.DRIVE_FOLDER_ID = 'synthetic-private-folder';
  const payload = { requestId: randomUUID(), filename: 'synthetic.png', mimeType: 'image/png', base64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]).toString('base64') };
  h.failNext(sheet => sheet === 'Auditoria'); assert.equal(h.call('upload', payload).status, 503);
  assert.equal(h.files.length, 1); assert.equal(h.files[0].getSharingAccess(), 'PRIVATE');
  assert.equal(h.boot().operacionesPendientes.length, 1); assert.equal(h.call('upload', payload).status, 409); assert.equal(h.files.length, 1);
  h.ok(h.mutate('resolveOperation', { operationId: h.boot().operacionesPendientes[0].ID, MOTIVO: 'Reviewed orphan receipt; discard operation' }));
  assert.equal(h.files.length, 1, 'no physical file deletion');
  const jpeg = h.ok(h.mutate('upload', { filename: 'synthetic.jpg', mimeType: 'image/jpeg', base64: Buffer.from([255, 216, 255, 0]).toString('base64') })); assert.ok(jpeg.fileId);
});

test('external Drive receipt URL variants are strictly bounded and credit void checks current limits', () => {
  const h = harness(), f = h.ready();
  for (const url of ['https://drive.google.com/file/d/synthetic_file_ID/view', 'https://drive.google.com/file/d/synthetic_file_ID/preview', 'https://drive.google.com/open?id=synthetic_file_ID']) h.ok(f.tx('egress', { MONTO: 1, COMPROBANTE_URL: url }));
  for (const url of ['http://drive.google.com/open?id=synthetic_file_ID', 'https://drive.google.com.evil.test/file/d/synthetic_file_ID/view', 'https://drive.google.com/file/d/synthetic_file_ID/edit', 'https://drive.google.com/open?id=' + 'x'.repeat(301)]) assert.equal(f.tx('egress', { COMPROBANTE_URL: url }).success, false);
  const payment = h.ok(f.tx('cardpayment', { DESTINO: f.card.ID, MONTO: 100 }));
  const card = h.boot().cuentas.find(a => a.ID === f.card.ID);
  h.save('Cuentas', { ID: card.ID, UPDATED_AT: card.UPDATED_AT, LIMITE_CREDITO: 50 });
  assert.equal(h.mutate('void', { operationId: payment.movimientos[0].OP_ID, MOTIVO: 'Would exceed lowered limit' }).status, 409);
  assert.equal(h.boot().cuentas.find(a => a.ID === f.card.ID).DEUDA_ACTUAL, 0);
});

test('Drive sharing/resource-key queries preserve the complete URL; spoofed hosts and unsafe forms fail without writes', () => {
  const h = harness(), f = h.ready();
  const base = 'https://drive.google.com/file/d/synthetic_file_ID/view';
  const queries = [
    base + '?usp=sharing',
    base + '?usp=drive_link',
    base + '?resourcekey=0-Abc_def&usp=sharing',
    'https://drive.google.com/file/d/synthetic_file_ID/preview?usp=drive_link&resourcekey=0-Abc_def.%7E~xyz+plus%2B&authuser=0',
    'https://drive.google.com/open?id=synthetic_file_ID&usp=sharing',
    'https://drive.google.com/open?id=synthetic_file_ID&resourcekey=0-Abc_def&usp=drive_link'
  ];
  const longPrefix = base + '?resourcekey=';
  queries.push(longPrefix + 'a'.repeat(300 - longPrefix.length)); assert.equal(queries.at(-1).length, 300);
  for (const url of queries) {
    const movement = h.ok(f.tx('egress', { MONTO: 1, COMPROBANTE_URL: url })).movimientos[0];
    assert.equal(movement.COMPROBANTE_URL, url);
    assert.equal(h.boot().movimientos.find(m => m.ID === movement.ID).COMPROBANTE_URL, url);
    const audit = h.rows('Auditoria').find(a => a.ENTIDAD === 'Movimientos' && a.ENTIDAD_ID === movement.ID);
    assert.equal(JSON.parse(audit.DESPUES).COMPROBANTE_URL, url);
  }
  const receipt = queries[3], quota = f.quota();
  assert.equal(h.ok(f.pay(quota, { COMPROBANTE_URL: receipt })).movimientos[0].COMPROBANTE_URL, receipt, 'pay preserves required resource key too');
  const invalid = [
    'https://drive.google.com.evil.test/file/d/synthetic_file_ID/view?usp=sharing',
    'https://evil.test/file/d/synthetic_file_ID/view?resourcekey=0-Abc_def',
    'https://drive.google.com@evil.test/file/d/synthetic_file_ID/view',
    'https://evil.test@drive.google.com/file/d/synthetic_file_ID/view',
    'https://drive.google.com:443/file/d/synthetic_file_ID/view',
    'http://drive.google.com/file/d/synthetic_file_ID/view?usp=sharing',
    'javascript:alert(1)',
    '//drive.google.com/file/d/synthetic_file_ID/view',
    'https://drive.google.com/drive/folders/synthetic_file_ID?usp=sharing',
    'https://drive.google.com/file/d/short/view?usp=sharing',
    'https://drive.google.com/file/d/synthetic_file_ID/edit?usp=sharing',
    'https://drive.google.com/open?usp=sharing&id=synthetic_file_ID',
    base + '?usp=sharing#fragment', base + '#fragment', base + '\n', base + '?usp=sharing\n',
    base + '?usp=sharing\r\n', base + '?resourcekey=abc def', base + '?resourcekey=abc\tdef',
    base + '?resourcekey=abc/def', base + '?resourcekey=abc@def', base + '?resourcekey="abc"',
    ' ' + base, queries.at(-1) + 'a'
  ];
  const before = h.writes(), operationCount = h.rows('Operaciones').length;
  for (const url of invalid) {
    const result = f.tx('egress', { MONTO: 1, COMPROBANTE_URL: url });
    assert.deepEqual(result, { ...namespace, success: false, status: 400, message: 'Debe ingresar una URL válida de Google Drive de hasta 300 caracteres.' }, JSON.stringify(url));
  }
  assert.equal(h.writes(), before); assert.equal(h.rows('Operaciones').length, operationCount);
  assert.equal(h.files.length, 0); assert.equal(h.boot().operacionesPendientes.length, 0);
});

test('upload folder preflight failures use message envelope and create no files or journal/audit rows', () => {
  const h = harness(); h.setup();
  const payload = { requestId: randomUUID(), filename: 'synthetic.pdf', mimeType: 'application/pdf', base64: Buffer.from('%PDF-1.7\nsynthetic').toString('base64') };
  const before = h.writes();
  const missing = h.call('upload', payload);
  assert.equal(missing.status, 503); assert.equal(missing.message, 'La carga privada de comprobantes no está configurada.');
  assert.equal(h.boot().configuracion.UPLOAD_ENABLED, false);
  h.props.DRIVE_FOLDER_ID = 'synthetic-private-folder';
  for (const access of ['ANYONE', 'ANYONE_WITH_LINK', 'DOMAIN', 'DOMAIN_WITH_LINK']) {
    h.folderAccess(access);
    const result = h.call('upload', payload);
    assert.equal(result.status, 400); assert.equal(result.message, 'La carpeta de comprobantes debe ser privada.');
  }
  h.folderAccess('PRIVATE'); h.folderFailure(true);
  const inaccessible = h.call('upload', payload);
  assert.deepEqual(inaccessible, { ...namespace, success: false, status: 500, message: 'Ocurrió un error interno. Revise el diario de operaciones antes de volver a intentar.' });
  assert.equal(JSON.stringify(inaccessible).includes('private deployment details'), false);
  assert.equal(h.boot().configuracion.UPLOAD_ENABLED, true, 'property presence is not Drive access verification');
  h.folderFailure(false);
  const { filename, ...legacy } = payload;
  const wrongName = h.call('upload', { ...legacy, name: filename });
  assert.equal(wrongName.status, 400); assert.equal(wrongName.message, 'La solicitud contiene un campo no permitido.');
  assert.equal(h.writes(), before); assert.equal(h.files.length, 0);
  assert.equal(h.rows('Operaciones').length, 0); assert.equal(h.rows('Auditoria').length, 0);
  assert.equal(h.boot().operacionesPendientes.length, 0);
});

test('older starts generate no historical backlog; historical standalone dates remain supported', () => {
  const h = harness(), f = h.ready(); const today = h.boot().hoy;
  for (const row of [
    { TITULO: 'Historical weekly', MONTO: 1, FRECUENCIA: 'Semanal', INICIO: h.context.pAddDays(today, -800) },
    { TITULO: 'Historical monthly', MONTO: 1, FRECUENCIA: 'Mensual', INICIO: h.context.pMonth(today, -40) }
  ]) {
    const result = h.ok(h.mutate('save', { sheet: 'Obligaciones', row }));
    assert.ok(result.generated.length > 0); assert.ok(result.generated.every(q => q.FECHA_PROGRAMADA >= today));
  }
  const quota = f.quota({ FECHA_VENCIMIENTO: '2000-02-29' }); assert.equal(quota.FECHA_VENCIMIENTO, '2000-02-29');
  h.ok(f.tx('income', { FECHA: '2000-02-29', MONTO: 1 }));
  assert.equal(h.boot().movimientos[0].FECHA, '2000-02-29');
  const before = h.writes();
  const horizon = h.mutate('generate', { until: h.context.pAddDays(today, 367) });
  assert.equal(horizon.status, 400); assert.equal(horizon.message, 'La fecha final de generación no puede superar los 366 días desde hoy.'); assert.equal(h.writes(), before);
});

test('card schedule calendar failures are zero-write validation errors and monthly card columns stay uppercase', () => {
  const h = harness(); h.today('2028-02-29'); const f = h.ready();
  for (const column of ['DEUDA_INICIAL', 'LIMITE_CREDITO', 'DIA_CORTE', 'DIA_PAGO', 'PAGO_MINIMO', 'PAGO_TOTAL_ESTADO']) assert.ok(h.context.PERSONAL_SCHEMAS.Cuentas.includes(column));
  for (const changes of [
    { FECHA: '2027-02-29' },
    { FECHA: '2028-02-29', PRIMER_VENCIMIENTO: '2028-02-28' },
    { FECHA: '9999-12-31', PRIMER_VENCIMIENTO: '9999-12-31' }
  ]) {
    h.today(changes.FECHA === '9999-12-31' ? '9999-12-31' : '2028-02-29');
    const before = h.writes(); const result = f.tx('cardpurchase', { CUENTA: f.card.ID, CUOTAS: 2, ...changes });
    assert.equal(result.status, 400); assert.ok(result.message); assert.equal(h.writes(), before);
  }
  assert.equal(h.boot().movimientos.length, 0); assert.equal(h.boot().obligaciones.length, 0);
  assert.equal(h.boot().cuentas.find(a => a.ID === f.card.ID).DEUDA_ACTUAL, 100);
});

test('twenty-year recurring anchors fast-forward to current/future window without invented old debt', () => {
  const h = harness(); h.today('2028-02-29'); h.setup();
  for (const [frequency, months] of [['Mensual', 1], ['Trimestral', 3], ['Semestral', 6], ['Anual', 12]]) {
    const saved = h.ok(h.mutate('save', { sheet: 'Obligaciones', row: { TITULO: frequency, MONTO: 10, FRECUENCIA: frequency, INICIO: '2008-01-31', DIA: 31 } }));
    const issued = h.ok(h.mutate('generate', { definitionId: saved.row.ID, until: '2029-02-28' })).generated.concat(saved.generated).sort((a, b) => a.FECHA_PROGRAMADA.localeCompare(b.FECHA_PROGRAMADA));
    assert.ok(issued.length > 0); assert.ok(issued.every(q => q.FECHA_PROGRAMADA >= '2028-02-29' && q.FECHA_PROGRAMADA <= '2029-02-28'));
    for (const q of issued) {
      const span = (Number(q.FECHA_PROGRAMADA.slice(0, 4)) - 2008) * 12 + Number(q.FECHA_PROGRAMADA.slice(5, 7)) - 1;
      assert.equal(span % months, 0, 'month phase preserved from original start');
      assert.equal(q.FECHA_PROGRAMADA, h.context.pMonth('2008-01-31', span, 31));
    }
    if (months === 1) assert.deepEqual(issued.slice(0, 3).map(q => q.FECHA_PROGRAMADA), ['2028-02-29', '2028-03-31', '2028-04-30']);
    assert.equal(h.ok(h.mutate('generate', { definitionId: saved.row.ID, until: '2029-02-28' })).generated.length, 0);
  }
  for (const [frequency, step] of [['Semanal', 7], ['Quincenal', 15]]) {
    const saved = h.ok(h.mutate('save', { sheet: 'Obligaciones', row: { TITULO: frequency, MONTO: 10, FRECUENCIA: frequency, INICIO: '2008-01-31' } }));
    const elapsed = (Date.parse('2028-02-29T00:00:00Z') - Date.parse('2008-01-31T00:00:00Z')) / 86400000;
    const first = h.context.pAddDays('2008-01-31', Math.ceil(elapsed / step) * step);
    assert.equal(saved.generated[0].FECHA_PROGRAMADA, first);
    assert.ok(saved.generated.length > 0);
    assert.deepEqual(saved.generated.map(q => q.FECHA_PROGRAMADA), Array.from({ length: saved.generated.length }, (_, n) => h.context.pAddDays(first, n * step)));
    assert.ok(saved.generated.every(q => q.FECHA_PROGRAMADA >= '2028-02-29'));
    assert.equal(h.ok(h.mutate('generate', { definitionId: saved.row.ID })).generated.length, 0);
    const reanchored = h.ok(h.mutate('save', { sheet: 'Obligaciones', row: { ID: saved.row.ID, UPDATED_AT: saved.row.UPDATED_AT, INICIO: h.context.pAddDays('2008-01-31', -step) } }));
    assert.equal(reanchored.generated.length, 0, 'same-phase day-interval anchor edit cannot duplicate issued dates');
  }
  assert.ok(h.boot().obligaciones.every(q => q.FECHA_PROGRAMADA >= '2028-02-29'));
  assert.equal(h.boot().movimientos.length, 0); assert.equal(h.boot().pagos.length, 0);
});

test('past FIN creates no recurring debt; explicitly authorized past Pago único creates only one unpaid commitment', () => {
  const h = harness(); h.today('2028-02-29'); h.setup();
  for (const frequency of ['Semanal', 'Quincenal', 'Mensual', 'Trimestral', 'Semestral', 'Anual']) {
    const saved = h.ok(h.mutate('save', { sheet: 'Obligaciones', row: { TITULO: frequency, MONTO: 10, FRECUENCIA: frequency, INICIO: '2008-01-31', FIN: '2010-12-31' } }));
    assert.equal(saved.generated.length, 0);
  }
  assert.equal(h.boot().obligaciones.length, 0);
  const once = h.ok(h.mutate('save', { sheet: 'Obligaciones', row: { TITULO: 'Explicit historical single', MONTO: 10, FRECUENCIA: 'Pago único', INICIO: '2008-01-31', FIN: '2008-01-31' } }));
  assert.equal(once.generated.length, 1); assert.equal(once.generated[0].FECHA_PROGRAMADA, '2008-01-31');
  assert.equal(h.boot().obligaciones[0].VENCIDO, true); assert.equal(h.boot().obligaciones[0].PAGADO, 0);
  assert.equal(h.ok(h.mutate('generate')).generated.length, 0);
  const q = once.generated[0];
  h.ok(h.mutate('void', { cuotaId: q.ID, UPDATED_AT: q.UPDATED_AT, MOTIVO: 'Anulación explícita' }));
  assert.equal(h.ok(h.mutate('generate')).generated.length, 0);
  assert.equal(h.boot().obligaciones[0].ESTADO, 'Anulado');
  assert.equal(h.boot().movimientos.length, 0); assert.equal(h.boot().pagos.length, 0);
});

test('older paid/annulled/overridden history survives future generation and same-phase INICIO edits without duplicates', () => {
  const h = harness(); h.today('2008-01-01'); const f = h.ready();
  const saved = h.ok(h.mutate('save', { sheet: 'Obligaciones', row: { TITULO: 'Longstanding month end', MONTO: 20, FRECUENCIA: 'Mensual', INICIO: '2008-01-31', DIA: 31, CATEGORIA: f.category.ID } }));
  assert.deepEqual(saved.generated.map(q => q.FECHA_PROGRAMADA), ['2008-01-31', '2008-02-29', '2008-03-31']);
  h.ok(f.pay(saved.generated[0], { MONTO: 20 }));
  const feb = saved.generated[1]; h.ok(h.mutate('void', { cuotaId: feb.ID, UPDATED_AT: feb.UPDATED_AT, MOTIVO: 'Mes cancelado' }));
  const mar = saved.generated[2]; h.save('Cuotas', { ID: mar.ID, UPDATED_AT: mar.UPDATED_AT, FECHA_VENCIMIENTO: '2008-04-05', MONTO: 25 });
  const historicalRows = h.rows('Cuotas'), payments = h.rows('Pagos'), movements = h.rows('Movimientos');
  h.today('2028-01-01');
  const updated = h.ok(h.mutate('save', { sheet: 'Obligaciones', row: { ID: saved.row.ID, UPDATED_AT: saved.row.UPDATED_AT, INICIO: '2007-01-31', MONTO: 30 } }));
  assert.deepEqual(updated.generated.map(q => q.FECHA_PROGRAMADA), ['2028-01-31', '2028-02-29', '2028-03-31']);
  assert.ok(updated.generated.every(q => q.MONTO === 30));
  const second = h.ok(h.mutate('save', { sheet: 'Obligaciones', row: { ID: updated.row.ID, UPDATED_AT: updated.row.UPDATED_AT, INICIO: '2006-01-31' } }));
  assert.equal(second.generated.length, 0);
  assert.equal(h.ok(h.mutate('generate')).generated.length, 0);
  assert.deepEqual(h.rows('Cuotas').filter(q => q.FECHA_PROGRAMADA < '2028-01-01'), historicalRows);
  assert.deepEqual(h.rows('Pagos'), payments); assert.deepEqual(h.rows('Movimientos'), movements);
  const cuotas = h.boot().obligaciones;
  assert.equal(cuotas.find(q => q.ID === saved.generated[0].ID).ESTADO_ACTUAL, 'Pagado');
  assert.equal(cuotas.find(q => q.ID === feb.ID).ESTADO_ACTUAL, 'Anulado');
  assert.equal(cuotas.find(q => q.ID === mar.ID).FECHA_VENCIMIENTO, '2008-04-05');
  assert.equal(cuotas.length, 6); assert.equal(new Set(cuotas.map(q => q.CLAVE_PERIODO)).size, 6);
});

test('106 combined future weekly candidates reject with zero writes; per-definition generation succeeds', () => {
  const h = harness(); h.today('2028-01-01'); h.setup();
  const definitions = [];
  for (const title of ['First weekly', 'Second weekly']) {
    const saved = h.ok(h.mutate('save', { sheet: 'Obligaciones', row: { TITULO: title, MONTO: 10, FRECUENCIA: 'Semanal', INICIO: '2028-04-10' } }));
    assert.equal(saved.generated.length, 0); definitions.push(saved.row);
  }
  h.today('2028-04-10');
  const until = h.context.pAddDays('2028-04-10', 366), before = h.writes();
  const result = h.mutate('generate', { until });
  assert.deepEqual(result, { ...namespace, success: false, status: 400, message: 'La generación supera las 100 cuotas nuevas por operación. Genere cada definición por separado o reduzca el plazo.' });
  assert.equal(h.writes(), before); assert.equal(h.boot().obligaciones.length, 0); assert.equal(h.boot().operacionesPendientes.length, 0);
  for (const d of definitions) assert.equal(h.ok(h.mutate('generate', { definitionId: d.ID, until })).generated.length, 53);
  assert.equal(h.ok(h.mutate('generate', { until })).generated.length, 0, 'existing keys do not consume the new-record cap');
  assert.equal(h.boot().obligaciones.length, 106); assert.equal(h.boot().movimientos.length, 0);
});

test('critical financial and identity conflicts return Spanish UI messages without leaking internal diagnostics', () => {
  const h = harness(), f = h.ready();
  const expectFailure = (result, status, message) => assert.deepEqual(result, { ...namespace, success: false, status, message });
  expectFailure(f.tx('egress', { MONTO: 1001 }), 409, 'Fondos insuficientes en la cuenta.');
  const q = f.quota(); expectFailure(f.pay(q, { MONTO: 101 }), 400, 'El pago supera el importe pendiente de la obligación.');
  expectFailure(f.tx('cardpayment', { DESTINO: f.card.ID, MONTO: 101 }), 400, 'El pago supera la deuda actual de la tarjeta.');
  expectFailure(f.tx('egress', { CUENTA: 'missing-account' }), 404, 'La referencia indicada no existe o no pertenece a su usuario.');
  h.save('Cuentas', { ID: f.destination.ID, UPDATED_AT: f.destination.UPDATED_AT, ESTADO: 'Inactiva' });
  expectFailure(f.tx('transfer', { DESTINO: f.destination.ID }), 400, 'El registro relacionado está inactivo o anulado.');
  h.save('Cuentas', { ID: f.account.ID, UPDATED_AT: f.account.UPDATED_AT, NOMBRE: 'Cuenta editada' });
  expectFailure(h.mutate('save', { sheet: 'Cuentas', row: { ID: f.account.ID, UPDATED_AT: f.account.UPDATED_AT, NOMBRE: 'Versión antigua' } }), 409, 'El registro fue modificado. Actualice los datos antes de guardar.');
  const payload = { requestId: randomUUID(), type: 'egress', CUENTA: f.account.ID, CATEGORIA: f.category.ID, MONTO: 10, FECHA: h.boot().hoy, DESCRIPCION: 'Prueba de solicitud' };
  h.ok(h.call('transaction', payload));
  expectFailure(h.call('transaction', { ...payload, MONTO: 11 }), 409, 'El identificador de solicitud ya se utilizó con otros datos o con otro usuario.');
  const pending = { ...payload, requestId: randomUUID() }; h.failNext(sheet => sheet === 'Auditoria');
  expectFailure(h.call('transaction', pending), 503, 'No se pudo confirmar el resultado de la operación. Revise el diario o consulte con el mismo identificador; no use uno nuevo antes de resolverla.');
  expectFailure(h.call('transaction', pending), 409, 'La solicitud está reservada por una operación no confirmada. Revísela y descártela antes de usar un nuevo identificador.');
  expectFailure(h.call('transaction', { ...pending, requestId: randomUUID() }), 409, 'Debe resolver las operaciones pendientes antes de enviar una nueva solicitud.');
  assert.equal(h.boot().operacionesPendientes[0].ERROR, 'Falló la escritura o el almacenamiento del comprobante. Revise la operación antes de descartarla.');
  assert.ok(h.rows('Operaciones').some(o => o.ERROR === 'Write/Drive failure; inspect operation before discard'), 'stored diagnostics retained');
  assert.equal(h.context.pUserMessage('Unmapped secret internal diagnostic'), 'No se pudo completar la solicitud. Revise los datos y el diario de operaciones.');
});

test('exact 3 MiB PDF uploads privately with bounded metadata-only journal and an idempotent retry', () => {
  const h = harness(); h.setup(); h.props.DRIVE_FOLDER_ID = 'synthetic-private-folder';
  const bytes = Buffer.alloc(3 * 1024 * 1024, 0xaa); bytes.write('%PDF-1.7\n');
  const base64 = bytes.toString('base64'); assert.equal(base64.length, 4194304); assert.equal(base64.endsWith('='), false);
  const payload = { requestId: randomUUID(), filename: 'x'.repeat(116) + '.pdf', mimeType: 'application/pdf', base64 };
  const result = h.ok(h.call('upload', payload));
  assert.equal(h.files.length, 1); assert.equal(h.files[0].getSharingAccess(), 'PRIVATE');
  assert.equal(h.files[0].blob.bytes.length, bytes.length); assert.equal(h.files[0].blob.filename.length, 120);
  assert.equal(Buffer.from(h.files[0].blob.bytes).equals(bytes), true, 'signed byte encoding preserves receipt contents');
  const operations = h.rows('Operaciones'); assert.deepEqual(operations.map(o => o.ESTADO), ['PREPARADA', 'CONFIRMADA']);
  const committed = operations[1]; assert.ok(committed.MANIFEST.length < 45000); assert.ok(committed.RESULTADO.length < 45000);
  assert.deepEqual(JSON.parse(committed.RESULTADO), result);
  assert.equal(JSON.parse(committed.MANIFEST).length, 1, 'upload writes only one audit artifact');
  const audit = h.rows('Auditoria'); assert.equal(audit.length, 1); assert.equal(audit[0].ENTIDAD, 'Drive');
  assert.deepEqual(JSON.parse(audit[0].DESPUES), result);
  const stored = JSON.stringify(h.sheets); assert.ok(stored.length < 10000); assert.equal(stored.includes(base64), false);
  assert.equal(stored.includes('base64'), false); assert.equal(stored.includes('"bytes"'), false);
  for (const sheet of ['Cuentas', 'Beneficiarios', 'Categorias', 'Obligaciones', 'Cuotas', 'Movimientos', 'Transferencias', 'Pagos']) assert.equal(h.rows(sheet).length, 0);
  const before = h.writes(); assert.deepEqual(h.ok(h.call('upload', payload)), result);
  assert.equal(h.writes(), before); assert.equal(h.files.length, 1);
});

test('near-limit receipt sizes accept both canonical padding forms; 3 MiB plus one rejects before file creation', () => {
  const h = harness(); h.setup(); h.props.DRIVE_FOLDER_ID = 'synthetic-private-folder';
  for (const [size, suffix] of [[3 * 1024 * 1024 - 1, '='], [3 * 1024 * 1024 - 2, '==']]) {
    const bytes = Buffer.alloc(size, 0xaa); bytes.write('%PDF-1.7\n');
    const base64 = bytes.toString('base64'); assert.equal(base64.length, 4194304); assert.ok(base64.endsWith(suffix));
    assert.equal(base64.endsWith('=='), suffix === '==');
    const result = h.ok(h.mutate('upload', { filename: 'neighbor.pdf', mimeType: 'application/pdf', base64 }));
    assert.ok(result.fileId); assert.equal(h.files.at(-1).blob.bytes.length, size);
  }
  const oversized = Buffer.alloc(3 * 1024 * 1024 + 1, 0xaa); oversized.write('%PDF-1.7\n');
  const before = h.writes(), fileCount = h.files.length, opCount = h.rows('Operaciones').length;
  const result = h.mutate('upload', { filename: 'oversized.pdf', mimeType: 'application/pdf', base64: oversized.toString('base64') });
  assert.equal(result.status, 400); assert.equal(result.message, 'El archivo está mal codificado o supera el tamaño permitido.');
  assert.equal(h.writes(), before); assert.equal(h.files.length, fileCount); assert.equal(h.rows('Operaciones').length, opCount);
  assert.equal(h.boot().operacionesPendientes.length, 0);
});

test('linear Base64 validation rejects misplaced padding, invalid alphabet and noncanonical pad bits without a journal', () => {
  const h = harness(); h.setup(); h.props.DRIVE_FOLDER_ID = 'synthetic-private-folder';
  const valid = Buffer.from('%PDF-').toString('base64'); assert.equal(valid, 'JVBERi0=');
  const before = h.writes();
  for (const base64 of ['', 'A', 'AAA', '====', 'AAA===', 'A===', '=AAA', 'AA=A', 'AA==AAAA', 'JVBERi0=\n', 'JVBE Ri0=', 'JVBERi0_', 'JVBERi0-', 'JVBERi0é', 'JVBERi1=', 'JVBERi0=AAAA']) {
    const result = h.mutate('upload', { filename: 'invalid.pdf', mimeType: 'application/pdf', base64 });
    assert.equal(result.status, 400, base64); assert.equal(result.message, 'El archivo está mal codificado o supera el tamaño permitido.', base64);
  }
  // The decoder is deliberately permissive; re-encoding must reject nonzero unused pad bits.
  assert.equal(Buffer.from('JVBERi1=', 'base64').equals(Buffer.from(valid, 'base64')), true);
  const oneByteTail = Buffer.from('%PDF-x!').toString('base64'); assert.ok(oneByteTail.endsWith('=='));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lastIndex = oneByteTail.length - 3, noncanonical = oneByteTail.slice(0, lastIndex) + alphabet[alphabet.indexOf(oneByteTail[lastIndex]) + 1] + '==';
  assert.equal(Buffer.from(noncanonical, 'base64').equals(Buffer.from(oneByteTail, 'base64')), true);
  assert.equal(h.mutate('upload', { filename: 'invalid.pdf', mimeType: 'application/pdf', base64: noncanonical }).status, 400);
  assert.equal(h.writes(), before); assert.equal(h.files.length, 0);
  assert.equal(h.rows('Operaciones').length, 0); assert.equal(h.rows('Auditoria').length, 0);
  h.ok(h.mutate('upload', { filename: 'valid.pdf', mimeType: 'application/pdf', base64: valid }));
  assert.equal(h.files.length, 1);
});

test('accounts store USD by default or explicit input; edits keep USD and other currencies fail without writes', () => {
  const h = harness(), f = h.ready();
  assert.equal(f.account.MONEDA, 'USD'); assert.equal(f.destination.MONEDA, 'USD'); assert.equal(f.card.MONEDA, 'USD');
  const savings = h.save('Cuentas', { NOMBRE: 'Synthetic savings', TIPO: 'Ahorros', MONEDA: 'USD' });
  const other = h.save('Cuentas', { NOMBRE: 'Synthetic other', TIPO: 'Otra' });
  assert.equal(savings.MONEDA, 'USD'); assert.equal(other.MONEDA, 'USD');
  let edited = h.save('Cuentas', { ID: savings.ID, UPDATED_AT: savings.UPDATED_AT, NOMBRE: 'Synthetic edited savings' });
  assert.equal(edited.MONEDA, 'USD');
  edited = h.save('Cuentas', { ID: edited.ID, UPDATED_AT: edited.UPDATED_AT, MONEDA: 'USD', OBSERVACIONES: 'Explicit same currency edit' });
  assert.equal(edited.MONEDA, 'USD');
  const before = h.writes(), operationCount = h.rows('Operaciones').length;
  for (const currency of ['EUR', 'COP', 'usd', '', ' USD ', null, 1, false]) {
    const creation = h.mutate('save', { sheet: 'Cuentas', row: { NOMBRE: 'Rejected currency', TIPO: 'Corriente', MONEDA: currency } });
    const edit = h.mutate('save', { sheet: 'Cuentas', row: { ID: edited.ID, UPDATED_AT: edited.UPDATED_AT, MONEDA: currency } });
    assert.equal(creation.status, 400); assert.equal(edit.status, 400);
    if (typeof currency === 'string') { assert.equal(creation.message, 'La moneda admitida es USD.'); assert.equal(edit.message, 'La moneda admitida es USD.'); }
  }
  assert.equal(h.writes(), before); assert.equal(h.rows('Operaciones').length, operationCount);
  assert.ok(h.rows('Cuentas').every(a => a.MONEDA === 'USD')); assert.ok(h.boot().cuentas.every(a => a.MONEDA === 'USD'));
  h.ok(f.tx('egress', { MONTO: 1 }));
  const current = h.boot().cuentas.find(a => a.ID === f.account.ID);
  assert.equal(current.MONEDA, 'USD'); assert.equal(current.SALDO_ACTUAL, 999);
  const beforeSetup = h.writes(), snapshot = h.boot(); h.setup(); h.setup();
  assert.equal(h.writes(), beforeSetup); assert.deepEqual(h.boot(), snapshot, 'repeated same-version setup cannot alter confirmed financial state');
  const backup = h.ok(h.call('backup')); assert.equal(backup.schemaVersion, 1);
  assert.deepEqual(backup.schemas.Cuentas.slice(-3), ['MONEDA', 'FECHA_CORTE', 'FECHA_MAXIMA_PAGO']); assert.ok(backup.tables.Cuentas.every(a => a.MONEDA === 'USD'));
});

test('setup appends optional currency/statement columns without changing old cells or creating financial state', () => {
  const h = harness();
  const appended = ['MONEDA', 'FECHA_CORTE', 'FECHA_MAXIMA_PAGO'];
  const oldHeaders = plain(h.context.PERSONAL_SCHEMAS.Cuentas).filter(k => !appended.includes(k));
  const preserved = oldHeaders.map(k => ({ ID: 'pre-deployment-existing-row', USERNAME: 'owner', OP_ID: '', UPDATED_AT: 'old-version', NOMBRE: 'Preserved existing row', TIPO: 'Corriente', SALDO_INICIAL: 12.34, ESTADO: 'Activa' })[k] ?? '');
  h.sheets.Cuentas = new h.Sheet('Cuentas', [oldHeaders, preserved]);
  const inspection = plain(h.context.setup.inspect()); assert.equal(inspection.compatible, true);
  assert.deepEqual(inspection.targets.find(t => t.name === 'Cuentas').missing, appended);
  h.setup();
  assert.deepEqual(h.sheets.Cuentas.data[0], [...oldHeaders, ...appended]); assert.deepEqual(h.sheets.Cuentas.data[1], preserved);
  assert.equal(h.rows('Cuentas')[0].SALDO_INICIAL, 12.34, 'physical existing monetary data is preserved');
  assert.equal(h.rows('Cuentas')[0].MONEDA, '', 'setup never writes business values into existing rows');
  assert.equal(h.boot().cuentas.length, 0, 'uncommitted pre-deployment rows are not invented financial records');
  assert.equal(h.rows('Movimientos').length, 0); assert.equal(h.rows('Operaciones').length, 0);
  const before = JSON.stringify(h.sheets), writes = h.writes(); h.setup();
  assert.equal(JSON.stringify(h.sheets), before); assert.equal(h.writes(), writes);
});

test('fixed namespace metadata covers GET and malformed requests and cannot be overridden at the transport boundary', () => {
  const h = harness();
  assert.deepEqual(JSON.parse(h.context.doGet()), { ...namespace, success: true, data: { connected: true, initialized: false } });
  h.context.SpreadsheetApp.openById = () => { throw new Error('Malformed requests must not read financial data'); };
  const invalid = JSON.parse(h.context.doPost({ postData: { contents: '{invalid' } }));
  assert.deepEqual(invalid, { ...namespace, success: false, status: 400, message: 'El contenido de la solicitud no es un JSON válido.' });
  const absent = JSON.parse(h.context.doPost());
  assert.deepEqual(absent, { ...namespace, success: false, status: 400, message: 'Los datos indicados no son válidos. Revise los campos y sus valores.' });
  const response = JSON.parse(h.context.pJson({ success: true, data: { value: 1 }, service: 'gerencia', spreadsheetId: 'wrong-document' }));
  assert.deepEqual(response, { ...namespace, success: true, data: { value: 1 } });
  const unknownField = h.call('bootstrap', {}, { secret: 'unknown-field' });
  assert.equal(unknownField.status, 400); assert.equal(Object.hasOwn(unknownField, 'data'), false);
  assert.equal(h.writes(), 0);
});

test('namespace markers wrap successful and idempotent responses but are absent from stored operation results/hashes', () => {
  const h = harness(), f = h.ready();
  const payload = { requestId: randomUUID(), type: 'egress', CUENTA: f.account.ID, CATEGORIA: f.category.ID, MONTO: 1, FECHA: h.boot().hoy, DESCRIPCION: 'Namespace transport test' };
  const first = h.call('transaction', payload); assert.equal(first.success, true);
  assert.equal(first.service, namespace.service); assert.equal(first.spreadsheetId, namespace.spreadsheetId);
  assert.equal(Object.hasOwn(first.data, 'service'), false); assert.equal(Object.hasOwn(first.data, 'spreadsheetId'), false);
  const operation = h.rows('Operaciones').find(o => o.ID === first.data.movimientos[0].OP_ID && o.ESTADO === 'CONFIRMADA');
  assert.equal(operation.HASH, h.context.pHash({ action: 'transaction', payload, username: 'owner' }));
  for (const field of ['RESULTADO', 'MANIFEST']) {
    assert.equal(operation[field].includes('"service"'), false); assert.equal(operation[field].includes('"spreadsheetId"'), false);
  }
  const before = h.writes(); assert.deepEqual(h.call('transaction', payload), first); assert.equal(h.writes(), before);
  assert.equal(h.rows('Movimientos').length, 1);
});

test('generated card installment amounts are locked, while metadata and ordinary commitment amounts remain editable', () => {
  const h = harness(); h.today('2028-01-01'); const f = h.ready();
  const purchase = h.ok(f.tx('cardpurchase', { CUENTA: f.card.ID, MONTO: 100, CUOTAS: 2, PRIMER_VENCIMIENTO: '2028-01-31' }));
  const quota = purchase.cuotas[0]; h.ok(f.pay(quota, { MONTO: 10 }));
  const payments = h.rows('Pagos'), movements = h.rows('Movimientos'), before = h.writes();
  for (const amount of [60, 49, 10]) {
    const result = h.mutate('save', { sheet: 'Cuotas', row: { ID: quota.ID, UPDATED_AT: quota.UPDATED_AT, MONTO: amount } });
    assert.equal(result.status, 409);
    assert.equal(result.message, 'El importe de una cuota de tarjeta no se puede modificar. Registre una nueva compra o una conciliación auditada para ajustar la deuda.');
  }
  assert.equal(h.writes(), before);
  const unchanged = h.save('Cuotas', { ID: quota.ID, UPDATED_AT: quota.UPDATED_AT, MONTO: 50, TITULO: 'Título actualizado', FECHA_VENCIMIENTO: '2028-02-05', OBSERVACIONES: 'Fecha acordada' });
  assert.equal(unchanged.MONTO, 50); assert.equal(unchanged.FECHA_PROGRAMADA, '2028-01-31');
  assert.equal(unchanged.CLAVE_PERIODO, quota.CLAVE_PERIODO); assert.equal(unchanged.FECHA_VENCIMIENTO, '2028-02-05');
  const notes = h.save('Cuotas', { ID: unchanged.ID, UPDATED_AT: unchanged.UPDATED_AT, OBSERVACIONES: 'Solo notas' }); assert.equal(notes.MONTO, 50);
  assert.deepEqual(h.rows('Pagos'), payments); assert.deepEqual(h.rows('Movimientos'), movements);
  assert.equal(h.boot().cuentas.find(a => a.ID === f.card.ID).DEUDA_ACTUAL, 190);
  assert.equal(h.boot().obligaciones.find(q => q.ID === quota.ID).PAGADO, 10);
  const manual = f.quota(); h.ok(f.pay(manual));
  const edited = h.save('Cuotas', { ID: manual.ID, UPDATED_AT: manual.UPDATED_AT, MONTO: 80 }); assert.equal(edited.MONTO, 80);
  assert.equal(h.mutate('save', { sheet: 'Cuotas', row: { ID: edited.ID, UPDATED_AT: edited.UPDATED_AT, MONTO: 24 } }).status, 409);
  const recurring = h.ok(h.mutate('save', { sheet: 'Obligaciones', row: { TITULO: 'Variable recurrente', MONTO: 10, FRECUENCIA: 'Mensual', INICIO: h.boot().hoy } })).generated[0];
  assert.equal(h.save('Cuotas', { ID: recurring.ID, UPDATED_AT: recurring.UPDATED_AT, MONTO: 15 }).MONTO, 15);
});

test('concrete statement dates are card-only, calendar-validated, ordered and optimistic versioned', () => {
  const h = harness(), f = h.ready();
  const before = h.writes();
  for (const changes of [
    { FECHA_CORTE: '2027-02-29' }, { FECHA_MAXIMA_PAGO: '2028-02-30' },
    { FECHA_CORTE: '2028-02-29', FECHA_MAXIMA_PAGO: '2028-02-28' },
    { FECHA_CORTE: '2028-01-31T00:00:00Z' }, { FECHA_MAXIMA_PAGO: 20280229 }
  ]) assert.equal(h.mutate('save', { sheet: 'Cuentas', row: { ID: f.card.ID, UPDATED_AT: f.card.UPDATED_AT, ...changes } }).status, 400);
  for (const type of ['Ahorros', 'Corriente', 'Efectivo', 'Otra']) {
    for (const field of ['FECHA_CORTE', 'FECHA_MAXIMA_PAGO']) assert.equal(h.mutate('save', { sheet: 'Cuentas', row: { NOMBRE: 'No es tarjeta', TIPO: type, [field]: '2028-02-29' } }).status, 400);
  }
  assert.equal(h.writes(), before);
  const changed = h.save('Cuentas', { ID: f.card.ID, UPDATED_AT: f.card.UPDATED_AT, FECHA_CORTE: '2028-02-29', FECHA_MAXIMA_PAGO: '2028-02-29', DIA_CORTE: 31, DIA_PAGO: 5 });
  assert.notEqual(changed.UPDATED_AT, f.card.UPDATED_AT);
  assert.equal(h.mutate('save', { sheet: 'Cuentas', row: { ID: f.card.ID, UPDATED_AT: f.card.UPDATED_AT, FECHA_MAXIMA_PAGO: '2028-03-05' } }).status, 409);
  const edited = h.save('Cuentas', { ID: changed.ID, UPDATED_AT: changed.UPDATED_AT, FECHA_MAXIMA_PAGO: '2028-03-05' });
  assert.equal(edited.FECHA_CORTE, '2028-02-29'); assert.equal(edited.FECHA_MAXIMA_PAGO, '2028-03-05');
  assert.equal(edited.DIA_CORTE, 31); assert.equal(edited.DIA_PAGO, 5);
  const audit = h.rows('Auditoria').find(a => a.ENTIDAD_ID === edited.ID && a.OP_ID === edited.OP_ID);
  assert.equal(JSON.parse(audit.ANTES).FECHA_MAXIMA_PAGO, '2028-02-29');
  assert.equal(JSON.parse(audit.DESPUES).FECHA_MAXIMA_PAGO, '2028-03-05');
  assert.equal(h.rows('Movimientos').length, 0); assert.equal(h.rows('Pagos').length, 0);
});

test('declared statement pending uses inclusive closing-date card payments, cents and current debt; reversals restore it', () => {
  const h = harness(); h.today('2028-02-01'); const f = h.ready();
  h.save('Cuentas', { ID: f.card.ID, UPDATED_AT: f.card.UPDATED_AT, PAGO_TOTAL_ESTADO: 80.05, FECHA_CORTE: '2028-01-31', FECHA_MAXIMA_PAGO: '2028-02-05', DIA_CORTE: 31, DIA_PAGO: 5 });
  const account = () => h.boot().cuentas.find(a => a.ID === f.card.ID);
  assert.equal(account().SALDO_ESTADO_PENDIENTE, 80.05); assert.equal(account().ESTADO_CUENTA_PROXIMO, true); assert.equal(account().ESTADO_CUENTA_VENCIDO, false);
  h.ok(f.tx('cardpayment', { DESTINO: f.card.ID, MONTO: 10.01, FECHA: '2028-01-30' }));
  assert.equal(account().DEUDA_ACTUAL, 89.99); assert.equal(account().SALDO_ESTADO_PENDIENTE, 80.05, 'payment before cut is not a statement payment');
  h.ok(f.tx('cardpurchase', { CUENTA: f.card.ID, MONTO: 50.02, CUOTAS: 2 }));
  assert.equal(account().DEUDA_ACTUAL, 140.01); assert.equal(account().SALDO_ESTADO_PENDIENTE, 80.05, 'later purchases do not enlarge the declared bill');
  const other = h.save('Cuentas', { NOMBRE: 'Otra tarjeta', TIPO: 'Tarjeta de crédito', DEUDA_INICIAL: 1, LIMITE_CREDITO: 10 });
  h.ok(f.tx('cardpayment', { DESTINO: other.ID, MONTO: 0.50 })); assert.equal(account().SALDO_ESTADO_PENDIENTE, 80.05);
  h.ok(f.tx('cardpayment', { DESTINO: f.card.ID, MONTO: 20.03, FECHA: '2028-01-31' }));
  assert.equal(account().DEUDA_ACTUAL, 119.98); assert.equal(account().SALDO_ESTADO_PENDIENTE, 60.02, 'closing-date payment is included');
  h.today('2028-02-02');
  const partial = h.ok(f.tx('cardpayment', { DESTINO: f.card.ID, MONTO: 30.04, FECHA: '2028-02-02' }));
  assert.equal(partial.pagos.length, 2, 'multiple FIFO allocations are not counted as separate card payments');
  assert.equal(account().DEUDA_ACTUAL, 89.94); assert.equal(account().SALDO_ESTADO_PENDIENTE, 29.98);
  h.today('2028-02-05'); assert.equal(account().ESTADO_CUENTA_PROXIMO, true); assert.equal(account().ESTADO_CUENTA_VENCIDO, false);
  h.today('2028-02-06'); assert.equal(account().ESTADO_CUENTA_VENCIDO, true); assert.equal(account().ESTADO_CUENTA_PROXIMO, false);
  h.ok(f.tx('cardpurchase', { CUENTA: f.card.ID, MONTO: 15.01 }));
  assert.equal(account().DEUDA_ACTUAL, 104.95); assert.equal(account().SALDO_ESTADO_PENDIENTE, 29.98);
  h.ok(h.mutate('void', { operationId: partial.movimientos[0].OP_ID, MOTIVO: 'Reversar pago parcial' }));
  assert.equal(account().DEUDA_ACTUAL, 134.99); assert.equal(account().SALDO_ESTADO_PENDIENTE, 60.02);
  const payoff = h.ok(f.tx('cardpayment', { DESTINO: f.card.ID, MONTO: 134.99 }));
  assert.equal(account().DEUDA_ACTUAL, 0); assert.equal(account().SALDO_ESTADO_PENDIENTE, 0);
  assert.equal(account().ESTADO_CUENTA_VENCIDO, false); assert.equal(account().ESTADO_CUENTA_PROXIMO, false);
  const current = account();
  h.ok(h.mutate('reconcile', { CUENTA: current.ID, UPDATED_AT: current.UPDATED_AT, OBSERVADO: 15.50, FECHA: h.boot().hoy, MOTIVO: 'Ajuste de deuda explícito' }));
  assert.equal(account().DEUDA_ACTUAL, 15.50); assert.equal(account().SALDO_ESTADO_PENDIENTE, 0, 'paid statement does not become due again from a new adjustment');
  h.ok(h.mutate('void', { operationId: payoff.movimientos[0].OP_ID, MOTIVO: 'Reversar pago total' }));
  assert.equal(account().DEUDA_ACTUAL, 150.49); assert.equal(account().SALDO_ESTADO_PENDIENTE, 60.02); assert.equal(account().ESTADO_CUENTA_VENCIDO, true);
  assert.equal(h.boot().movimientos.filter(m => m.ESTADO === 'Activo' && ['Gasto', 'Compra tarjeta'].includes(m.TIPO)).reduce((sum, m) => sum + Math.round(m.MONTO * 100), 0), 6503, 'card payments never count the expense twice');
});

test('missing concrete statement declaration cannot invent alerts from old debt or recurring payment days', () => {
  const h = harness(); h.today('2028-02-10'); h.setup();
  for (const changes of [
    { DIA_CORTE: 1, DIA_PAGO: 5 },
    { PAGO_TOTAL_ESTADO: 100, DIA_CORTE: 1, DIA_PAGO: 5 },
    { PAGO_TOTAL_ESTADO: 100, FECHA_CORTE: '2028-01-31' },
    { PAGO_TOTAL_ESTADO: 100, FECHA_MAXIMA_PAGO: '2028-02-05' },
    { PAGO_TOTAL_ESTADO: 0, FECHA_CORTE: '2028-01-31', FECHA_MAXIMA_PAGO: '2028-02-05' }
  ]) {
    const card = h.save('Cuentas', { NOMBRE: 'Declaración incompleta', TIPO: 'Tarjeta de crédito', DEUDA_INICIAL: 100, LIMITE_CREDITO: 200, ...changes });
    const out = h.boot().cuentas.find(a => a.ID === card.ID);
    assert.equal(out.DEUDA_ACTUAL, 100); assert.equal(out.SALDO_ESTADO_PENDIENTE, null);
    assert.equal(out.ESTADO_CUENTA_VENCIDO, false); assert.equal(out.ESTADO_CUENTA_PROXIMO, false);
  }
  const capped = h.save('Cuentas', { NOMBRE: 'Declaración limitada por deuda', TIPO: 'Tarjeta de crédito', DEUDA_INICIAL: 20.01, LIMITE_CREDITO: 200, PAGO_TOTAL_ESTADO: 100, FECHA_CORTE: '2028-01-31', FECHA_MAXIMA_PAGO: '2028-02-05' });
  const out = h.boot().cuentas.find(a => a.ID === capped.ID); assert.equal(out.SALDO_ESTADO_PENDIENTE, 20.01); assert.equal(out.ESTADO_CUENTA_VENCIDO, true);
  const bank = h.save('Cuentas', { NOMBRE: 'Cuenta de efectivo', TIPO: 'Efectivo' });
  const bankOut = h.boot().cuentas.find(a => a.ID === bank.ID);
  assert.equal(bankOut.SALDO_ESTADO_PENDIENTE, null); assert.equal(bankOut.ESTADO_CUENTA_VENCIDO, false); assert.equal(bankOut.ESTADO_CUENTA_PROXIMO, false);
  assert.equal(h.rows('Movimientos').length, 0); assert.equal(h.rows('Pagos').length, 0);
});

test('future executed dates reject every transaction/pay/reconcile route before journal or financial writes', () => {
  const h = harness(); h.today('2028-02-29'); const f = h.ready();
  const tomorrow = '2028-03-01';
  const manual = f.quota({ FECHA_VENCIMIENTO: '2028-04-01' });
  const purchase = h.ok(f.tx('cardpurchase', { CUENTA: f.card.ID, MONTO: 10, CUOTAS: 2, PRIMER_VENCIMIENTO: '2028-03-31' }));
  const current = h.boot(), bank = current.cuentas.find(a => a.ID === f.account.ID), card = current.cuentas.find(a => a.ID === f.card.ID);
  const requests = [
    () => f.tx('income', { MONTO: 1, FECHA: tomorrow }),
    () => f.tx('egress', { MONTO: 1, FECHA: tomorrow }),
    () => f.tx('transfer', { MONTO: 1, DESTINO: f.destination.ID, FECHA: tomorrow, COMISION: 0.01, CATEGORIA: f.category.ID }),
    () => f.tx('cardpurchase', { MONTO: 1, CUENTA: f.card.ID, CUOTAS: 2, PRIMER_VENCIMIENTO: '2028-03-31', FECHA: tomorrow }),
    () => f.tx('cardpayment', { MONTO: 1, DESTINO: f.card.ID, FECHA: tomorrow }),
    () => f.pay(manual, { MONTO: 1, FECHA: tomorrow }),
    () => f.pay(manual, { MONTO: 1, CUENTA: f.card.ID, FECHA: tomorrow }),
    () => f.pay(purchase.cuotas[0], { MONTO: 1, FECHA: tomorrow }),
    () => h.mutate('reconcile', { CUENTA: bank.ID, UPDATED_AT: bank.UPDATED_AT, OBSERVADO: 1001, FECHA: tomorrow, MOTIVO: 'Ajuste futuro no ejecutado' }),
    () => h.mutate('reconcile', { CUENTA: card.ID, UPDATED_AT: card.UPDATED_AT, OBSERVADO: 111, FECHA: tomorrow, MOTIVO: 'Deuda futura no ejecutada' })
  ];
  const before = h.writes(), sheetsBefore = JSON.stringify(h.sheets), operationsBefore = h.rows('Operaciones').length;
  for (const request of requests) assert.deepEqual(request(), {
    ...namespace, success: false, status: 400,
    message: 'La fecha de una operación ejecutada no puede ser posterior a hoy. Registre una obligación pendiente (cuota) para un compromiso futuro.'
  });
  assert.equal(h.writes(), before); assert.equal(JSON.stringify(h.sheets), sheetsBefore);
  assert.equal(h.rows('Operaciones').length, operationsBefore); assert.deepEqual(h.boot(), current);
  assert.equal(h.boot().obligaciones.find(q => q.ID === manual.ID).PAGADO, 0);
  assert.equal(h.boot().obligaciones.find(q => q.ID === purchase.cuotas[0].ID).PAGADO, 0);
  assert.equal(h.boot().operacionesPendientes.length, 0);
});

test('future commitments/definitions/installment and statement dates remain valid without executing future money', () => {
  const h = harness(); h.today('2028-02-29'); const f = h.ready();
  const manual = f.quota({ FECHA_VENCIMIENTO: '2028-04-01' });
  const recurring = h.ok(h.mutate('save', { sheet: 'Obligaciones', row: { TITULO: 'Compromiso futuro', MONTO: 10, FRECUENCIA: 'Mensual', INICIO: '2028-03-01', FIN: '2028-06-01', CATEGORIA: f.category.ID } }));
  assert.deepEqual(recurring.generated.map(q => q.FECHA_PROGRAMADA), ['2028-03-01', '2028-04-01', '2028-05-01']);
  h.save('Cuentas', { ID: f.card.ID, UPDATED_AT: f.card.UPDATED_AT, PAGO_TOTAL_ESTADO: 20, FECHA_CORTE: '2028-04-30', FECHA_MAXIMA_PAGO: '2028-05-10' });
  let b = h.boot();
  assert.equal(b.movimientos.length, 0); assert.equal(b.pagos.length, 0);
  assert.equal(b.cuentas.find(a => a.ID === f.account.ID).SALDO_ACTUAL, 1000); assert.equal(b.cuentas.find(a => a.ID === f.card.ID).DEUDA_ACTUAL, 100);
  assert.ok(b.obligaciones.every(q => q.PAGADO === 0 && q.ESTADO_ACTUAL === 'Pendiente' && !q.VENCIDO));
  assert.equal(b.obligaciones.find(q => q.ID === manual.ID).PENDIENTE, 100);
  const purchase = h.ok(f.tx('cardpurchase', { CUENTA: f.card.ID, MONTO: 3, CUOTAS: 3, PRIMER_VENCIMIENTO: '2028-04-30' }));
  assert.deepEqual(purchase.cuotas.map(q => q.FECHA_PROGRAMADA), ['2028-04-30', '2028-05-30', '2028-06-30']);
  assert.equal(purchase.movimientos[0].FECHA, '2028-02-29');
  b = h.boot(); assert.equal(b.cuentas.find(a => a.ID === f.card.ID).DEUDA_ACTUAL, 103);
  assert.equal(b.cuentas.find(a => a.ID === f.account.ID).SALDO_ACTUAL, 1000); assert.equal(b.pagos.length, 0);
  assert.ok(b.obligaciones.every(q => q.PAGADO === 0 && q.ESTADO_ACTUAL === 'Pendiente'));
});

test('same-day and past execution dates remain valid, including actual early payments of future-due commitments', () => {
  const h = harness(); h.today('2028-02-29'); const f = h.ready();
  for (const date of ['2028-02-29', '2028-02-28']) {
    assert.equal(h.ok(f.tx('income', { FECHA: date, MONTO: 10 })).movimientos[0].FECHA, date);
    assert.equal(h.ok(f.tx('egress', { FECHA: date, MONTO: 2 })).movimientos[0].FECHA, date);
    assert.equal(h.ok(f.tx('transfer', { FECHA: date, MONTO: 3, DESTINO: f.destination.ID })).movimientos[0].FECHA, date);
    assert.equal(h.ok(f.tx('cardpurchase', { FECHA: date, MONTO: 4, CUENTA: f.card.ID })).movimientos[0].FECHA, date);
    assert.equal(h.ok(f.tx('cardpayment', { FECHA: date, MONTO: 1, DESTINO: f.card.ID })).movimientos[0].FECHA, date);
    const quota = f.quota({ MONTO: 5, FECHA_VENCIMIENTO: '2028-04-01' });
    assert.equal(h.ok(f.pay(quota, { FECHA: date, MONTO: 1 })).movimientos[0].FECHA, date);
    assert.equal(h.boot().obligaciones.find(q => q.ID === quota.ID).PAGADO, 1, 'future due date does not forbid an actual early payment');
    const account = h.boot().cuentas.find(a => a.ID === f.account.ID);
    const observed = (Math.round(account.SALDO_ACTUAL * 100) + 1) / 100;
    const result = h.ok(h.mutate('reconcile', { CUENTA: account.ID, UPDATED_AT: account.UPDATED_AT, OBSERVADO: observed, FECHA: date, MOTIVO: 'Conciliación ejecutada' }));
    assert.equal(result.movimientos[0].FECHA, date);
  }
  const b = h.boot(); assert.ok(b.movimientos.every(m => m.FECHA <= b.hoy));
  assert.equal(b.cuentas.find(a => a.ID === f.account.ID).SALDO_ACTUAL, 1006.02);
  assert.equal(b.cuentas.find(a => a.ID === f.destination.ID).SALDO_ACTUAL, 6);
  assert.equal(b.cuentas.find(a => a.ID === f.card.ID).DEUDA_ACTUAL, 106);
});

test('anonymous health reads actual tab/setup state under lock and never initializes or exposes financial data', () => {
  const h = harness(), getSheets = h.ss.getSheets; let inspections = 0;
  h.ss.getSheets = () => { assert.equal(h.held(), true); inspections++; return getSheets(); };
  const health = initialized => assert.deepEqual(JSON.parse(h.context.doGet()), { ...namespace, success: true, data: { connected: true, initialized } });
  const original = JSON.stringify(h.sheets); health(false);
  assert.equal(h.writes(), 0); assert.equal(JSON.stringify(h.sheets), original); assert.equal(h.held(), false);
  h.setup(); const before = h.writes(), initializedState = JSON.stringify(h.sheets); health(true);
  assert.equal(h.writes(), before); assert.equal(JSON.stringify(h.sheets), initializedState);
  h.sheets.Cuentas.data[0].pop(); health(false); h.sheets.Cuentas.data[0].push('FECHA_MAXIMA_PAGO'); health(true);
  const preferences = h.sheets.Configuracion.data; h.sheets.Configuracion.data = preferences.slice(0, -1); health(false);
  h.sheets.Configuracion.data = preferences; health(true);
  h.sheets.Extra = new h.Sheet('Extra', [['existing unrelated data']]); health(true);
  h.sheets.Cuotas.data[0][0] = 'UNKNOWN'; health(false);
  assert.ok(inspections >= 8); assert.equal(h.writes(), before);
  h.rejectLock();
  const busy = JSON.parse(h.context.doGet()); assert.equal(busy.status, 503); assert.equal(busy.service, namespace.service);
  assert.equal(Object.hasOwn(busy, 'data'), false); assert.equal(h.writes(), before);
  const failed = harness(); failed.context.SpreadsheetApp.openById = () => { throw new Error('Synthetic owner spreadsheet permission failure'); };
  assert.deepEqual(JSON.parse(failed.context.doGet()), { ...namespace, success: false, status: 500, message: 'Ocurrió un error interno. Revise el diario de operaciones antes de volver a intentar.' });
  assert.equal(failed.writes(), 0); assert.equal(failed.held(), false);
});

test('public POST can read/export/change a known claimed username without keys or identity verification', () => {
  const h = harness(), f = h.ready();
  assert.deepEqual(h.props, {}); assert.equal(h.boot().configuracion.UPLOAD_ENABLED, false);
  const getProperty = h.context.PropertiesService.getScriptProperties;
  h.context.PropertiesService.getScriptProperties = () => {
    const props = getProperty(); return { getProperty: key => { assert.notEqual(key, 'GAS_API_SECRET', 'backend must not look up a personal API secret'); return props.getProperty(key); } };
  };
  const claimed = { user: { username: 'owner', name: 'Unverified caller label', role: 'personal' } };
  const data = h.ok(h.call('bootstrap', {}, claimed)); assert.equal(data.cuentas.length, 3);
  const current = data.cuentas.find(a => a.ID === f.account.ID);
  h.ok(h.mutate('save', { sheet: 'Cuentas', row: { ID: current.ID, UPDATED_AT: current.UPDATED_AT, NOMBRE: 'Publicly changed account label' } }, claimed));
  const result = h.ok(h.mutate('transaction', { type: 'egress', FECHA: data.hoy, DESCRIPCION: 'Public caller expenditure', MONTO: 1, CUENTA: f.account.ID, CATEGORIA: f.category.ID }, claimed));
  assert.equal(h.boot().cuentas.find(a => a.ID === f.account.ID).SALDO_ACTUAL, 999);
  const audit = h.rows('Auditoria').find(a => a.OP_ID === result.movimientos[0].OP_ID);
  assert.equal(audit.USERNAME, 'owner', 'audit records only the claimed namespace, not proof of caller authenticity');
  const backup = h.ok(h.call('backup', {}, claimed)); assert.ok(backup.tables.Cuentas.length > 0); assert.equal(backup.tables.Movimientos.length, 1);
  assert.equal(h.call('bootstrap', {}, { ...claimed, password: 'not-a-GAS-input' }).status, 400);
  assert.equal(h.call('bootstrap', {}, { ...claimed, secret: 'not-a-GAS-input' }).status, 400);
  assert.doesNotMatch(source, /GAS_API_SECRET|status:\s*401/);
});

test('anonymous claimed namespace can upload only when optional private folder is enabled, consuming owner storage', () => {
  const h = harness(); h.setup();
  const claimed = { user: { username: 'unverified-upload-caller', name: 'Caller-supplied label', role: 'personal' } };
  const payload = { requestId: randomUUID(), filename: 'public-api-private-file.pdf', mimeType: 'application/pdf', base64: Buffer.from('%PDF-1.7\nsynthetic').toString('base64') };
  const before = h.writes(); assert.equal(h.call('upload', payload, claimed).status, 503);
  assert.equal(h.writes(), before); assert.equal(h.files.length, 0);
  h.props.DRIVE_FOLDER_ID = 'synthetic-private-folder';
  const result = h.ok(h.call('upload', payload, claimed)); assert.ok(result.url); assert.equal(h.files.length, 1);
  assert.equal(h.files[0].getSharingAccess(), 'PRIVATE', 'storage permissions remain private although upload API is public');
  const backup = h.ok(h.call('backup', {}, claimed)); assert.equal(backup.tables.Auditoria[0].USERNAME, claimed.user.username);
  assert.equal(JSON.parse(backup.tables.Auditoria[0].DESPUES).url, result.url);
  assert.equal(backup.tables.Cuentas.length, 0); assert.equal(backup.tables.Movimientos.length, 0);
});
