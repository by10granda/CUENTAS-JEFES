import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../apps-script/Reset.gs', import.meta.url), 'utf8');

function harness(options = {}) {
  let locked = false;
  let backup;
  let clears = 0;
  class Sheet {
    constructor(name, data) { this.name = name; this.data = structuredClone(data); }
    getLastRow() {
      for (let i = this.data.length - 1; i >= 0; i--) if (this.data[i].some(v => v !== '')) return i + 1;
      return 0;
    }
    getLastColumn() { return Math.max(0, ...this.data.map(row => row.length)); }
    copyTo(book) {
      if (options.copyFailure && this.name === 'AUDITORIA') throw new Error('Copy failure');
      const copy = new Sheet('Copy ' + this.name, this.data);
      book.sheets.push(copy);
      return copy;
    }
    setName(name) { this.name = name; return this; }
    getRange(row, column, height, width) {
      return {
        getValues: () => Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => this.data[row - 1 + i]?.[column - 1 + j] ?? '')),
        getFormulas: () => Array.from({ length: height }, () => Array(width).fill('')),
        clearContent: () => {
          assert.ok(backup && backup.sheets.some(sheet => sheet.name === 'AUDITORIA'), 'Must finish backup before clearing');
          clears++;
          for (let i = 0; i < height; i++) for (let j = 0; j < width; j++) this.data[row - 1 + i][column - 1 + j] = '';
          if (options.clearFailure && this.name === 'MOVIMIENTOS') throw new Error('Partial clear failure');
        },
        setValues: values => {
          if (options.rollbackFailure && this.name === 'MOVIMIENTOS') throw new Error('Rollback failure');
          for (let i = 0; i < height; i++) for (let j = 0; j < width; j++) {
            const value = values[i][j];
            this.data[row - 1 + i][column - 1 + j] = typeof value === 'string' && value.startsWith("'") ? value.slice(1) : value;
          }
        },
      };
    }
  }
  const sheets = [
    new Sheet('MOVIMIENTOS', [['ID', 'DESCRIPCION'], ['old-id', '=literal text'], ['test-id', '[DEMO]']]),
    new Sheet('CUENTAS', [['ID', 'SALDO_INICIAL'], ['old-account', 50]]),
    new Sheet('AUDITORIA', [['ID', 'ACCION'], ['audit-id', 'CREAR']]),
    new Sheet('JEFES', [['ID', 'NOMBRE'], ['1', 'Franco Becerra'], ['2', 'Josselyn Becerra']]),
    new Sheet('CATEGORIAS', [['ID', 'NOMBRE'], ['cat', 'Others']]),
    new Sheet('FORMAS_PAGO', [['ID', 'NOMBRE'], ['cash', 'Cash']]),
    new Sheet('ESTADOS', [['ID', 'NOMBRE'], ['state', 'Pagado']]),
    new Sheet('CONFIGURACION', [['CLAVE', 'VALOR'], ['MONEDA', 'USD']]),
    new Sheet('Hoja 1', [['Preserved user sheet']]),
  ];
  const ss = { getSheetByName: name => sheets.find(sheet => sheet.name === name) };
  const logs = [];
  const context = vm.createContext({
    SPREADSHEET_ID: 'expected-id',
    SCHEMA: Object.fromEntries(sheets.filter(sheet => sheet.name !== 'Hoja 1').map(sheet => [sheet.name, {}])),
    assertReady_: () => { if (options.notReady) throw new Error('Not ready'); },
    console: { log: value => logs.push(value) },
    LockService: { getScriptLock: () => ({ waitLock() { locked = true; }, releaseLock() { locked = false; } }) },
    SpreadsheetApp: {
      openById: id => { assert.equal(id, 'expected-id'); return ss; },
      create: () => {
        backup = { sheets: [new Sheet('Blank', [['']])], getSheets() { return this.sheets; },
          deleteSheet(sheet) { this.sheets = this.sheets.filter(item => item !== sheet); },
          getUrl: () => 'https://docs.google.com/spreadsheets/d/private-test-backup/edit' };
        return backup;
      },
      flush() {},
    },
  });
  vm.runInContext(source, context);
  return { run: () => context.reiniciarDatosCliente(), sheets, getBackup: () => backup, logs,
    locked: () => locked, clearCount: () => clears };
}

test('owner reset backs up first, clears movements only and preserves accounts, audit, headers, catalogs and unrelated sheets', () => {
  const h = harness();
  const before = h.sheets.map(sheet => ({ name: sheet.name, data: structuredClone(sheet.data) }));
  const result = h.run();
  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.eliminados)), { MOVIMIENTOS: 2 });
  const backup = h.getBackup();
  assert.equal(backup.sheets.length, 8);
  for (const old of before) {
    const sheet = h.sheets.find(item => item.name === old.name);
    assert.deepEqual(sheet.data[0], old.data[0]);
    if (old.name === 'MOVIMIENTOS') {
      assert.equal(sheet.getLastRow(), 1);
      assert.deepEqual(backup.sheets.find(item => item.name === old.name).data, old.data);
    } else assert.deepEqual(sheet.data, old.data);
  }
  assert.equal(h.locked(), false);
  assert.ok(h.logs.some(value => value.includes(result.respaldoUrl)));
});

test('reset refuses invalid setup or an incomplete backup before clearing anything', () => {
  for (const options of [{ notReady: true }, { copyFailure: true }]) {
    const h = harness(options);
    const before = JSON.stringify(h.sheets);
    assert.throws(h.run);
    assert.equal(JSON.stringify(h.sheets), before);
    assert.equal(h.clearCount(), 0);
    assert.equal(h.locked(), false);
  }
});

test('reset rolls back failed clearing and reports backup URL if restoration fails', () => {
  const h = harness({ clearFailure: true });
  const before = JSON.stringify(h.sheets);
  assert.throws(h.run, /Se restauraron los datos anteriores/);
  assert.equal(JSON.stringify(h.sheets), before);
  assert.equal(h.locked(), false);
  const failed = harness({ clearFailure: true, rollbackFailure: true });
  assert.throws(failed.run, /Revise la restauracion manualmente.*private-test-backup/);
  assert.equal(failed.locked(), false);
});

test('reset with no movements leaves historical accounts and audit untouched and performs no clearing', () => {
  const h = harness();
  const movements = h.sheets.find(sheet => sheet.name === 'MOVIMIENTOS');
  movements.data = [movements.data[0]];
  assert.equal(h.run().success, true);
  assert.equal(h.clearCount(), 0);
  assert.equal(h.sheets.find(sheet => sheet.name === 'JEFES').getLastRow(), 3);
  assert.equal(h.sheets.find(sheet => sheet.name === 'CUENTAS').getLastRow(), 2);
  assert.equal(h.sheets.find(sheet => sheet.name === 'AUDITORIA').getLastRow(), 2);
});
