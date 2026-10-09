/* Owner-only operation: run from the existing Apps Script editor, never from the web API. */
function reiniciarDatosCliente() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    assertReady_(ss);
    var targets = ['MOVIMIENTOS'];
    var snapshots = targets.map(function (name) {
      var sheet = ss.getSheetByName(name);
      var count = Math.max(0, sheet.getLastRow() - 1);
      var range = count ? sheet.getRange(2, 1, count, sheet.getLastColumn()) : null;
      var values = range ? range.getValues() : [];
      var formulas = range ? range.getFormulas() : [];
      var restore = values.map(function (row, i) {
        return row.map(function (value, j) {
          if (formulas[i][j]) return formulas[i][j];
          return typeof value === 'string' && /^[=+\-@]/.test(value) ? "'" + value : value;
        });
      });
      return { name: name, sheet: sheet, range: range, restore: restore,
        records: values.filter(function (row) { return row.some(function (v) { return v !== ''; }); }).length };
    });

    // A separate spreadsheet owned by the operator preserves the previous data and catalog labels.
    var backup = SpreadsheetApp.create('RESPALDO CUENTAS GERENCIA ' + new Date().toISOString());
    var blank = backup.getSheets()[0];
    Object.keys(SCHEMA).forEach(function (name) {
      var source = ss.getSheetByName(name);
      var copied = source.copyTo(backup).setName(name);
      if (copied.getLastRow() !== source.getLastRow() || copied.getLastColumn() !== source.getLastColumn()) {
        throw new Error('Respaldo incompleto. No se borro ningun registro.');
      }
    });
    backup.deleteSheet(blank);
    SpreadsheetApp.flush();
    console.log('Respaldo privado previo al reinicio: ' + backup.getUrl());

    var touched = [];
    try {
      snapshots.forEach(function (item) {
        if (!item.range) return;
        touched.push(item);
        item.range.clearContent();
      });
      SpreadsheetApp.flush();
      snapshots.forEach(function (item) {
        if (item.sheet.getLastRow() > 1) throw new Error('No se pudo verificar el vaciado de ' + item.name);
      });
    } catch (error) {
      var restored = true;
      touched.reverse().forEach(function (item) {
        try { item.range.setValues(item.restore); } catch (_) { restored = false; }
      });
      try { SpreadsheetApp.flush(); } catch (_) { restored = false; }
      throw new Error('El reinicio no se completo. ' + (restored ? 'Se restauraron los datos anteriores.' : 'Revise la restauracion manualmente.') + ' Respaldo: ' + backup.getUrl());
    }

    var result = { success: true, respaldoUrl: backup.getUrl(), eliminados: {} };
    snapshots.forEach(function (item) { result.eliminados[item.name] = item.records; });
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    lock.releaseLock();
  }
}
