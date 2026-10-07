/* Deploy as a web app: execute as owner, access anyone. Only doPost + shared secret serves data. */
var SPREADSHEET_ID = '1waRuU63wJjxNJP8usUtHkl5mV-WM7E099dz-4llwJrI';
var TYPES = ['Gasto', 'Compra', 'Pago', 'Transferencia', 'Préstamo', 'Adelanto', 'Reembolso', 'Ingreso', 'Retiro'];
var STATES = ['Pagado', 'Pendiente', 'Pago parcial', 'Anulado'];
var APPROVED_CATALOGS = {
  JEFES: [
    { ID: '1', NOMBRE: 'Franco Becerra', TIPO: 'Jefe' },
    { ID: '2', NOMBRE: 'Josselyn Becerra', TIPO: 'Jefa' }
  ],
  CATEGORIAS: ['Alimentación', 'Transporte', 'Combustible', 'Hospedaje', 'Compras', 'Servicios', 'Salud', 'Entretenimiento', 'Viajes', 'Mantenimiento', 'Tecnología', 'Oficina', 'Representación', 'Impuestos', 'Otros'].map(function (name, i) { return { ID: 'CAT-' + (i + 1), NOMBRE: name }; }),
  FORMAS_PAGO: ['Efectivo', 'Transferencia', 'Tarjeta de crédito', 'Tarjeta de débito', 'Depósito', 'Otro'].map(function (name, i) { return { ID: 'FP-' + (i + 1), NOMBRE: name }; }),
  ESTADOS: STATES.map(function (name, i) { return { ID: 'EST-' + (i + 1), NOMBRE: name }; })
};
var SCHEMA = {
  JEFES: { required: ['ID', 'NOMBRE', 'ESTADO'], optional: ['UPDATED_AT', 'TIPO'] },
  CUENTAS: { required: ['ID', 'NOMBRE', 'JEFE', 'SALDO_INICIAL', 'ESTADO'], optional: ['UPDATED_AT', 'TIPO'] },
  CATEGORIAS: { required: ['ID', 'NOMBRE', 'ESTADO'], optional: ['UPDATED_AT'] },
  FORMAS_PAGO: { required: ['ID', 'NOMBRE', 'ESTADO'], optional: ['UPDATED_AT'] },
  ESTADOS: { required: ['ID', 'NOMBRE', 'ESTADO'], optional: ['UPDATED_AT'] },
  MOVIMIENTOS: {
    required: ['ID', 'FECHA', 'HORA', 'TIPO', 'JEFE', 'CUENTA', 'CATEGORIA', 'FORMA_PAGO', 'DESCRIPCION', 'CANTIDAD', 'VALOR_UNITARIO', 'TOTAL', 'ESTADO', 'UPDATED_AT'],
    optional: ['DIRECCION', 'PAGADO', 'MOVIMIENTO_ORIGEN_ID', 'CUENTA_DESTINO_ID', 'CLAVE_IDEMPOTENCIA', 'TOTAL_MANUAL', 'COMPROBANTE_URL', 'IVA', 'IVA_PORCENTAJE', 'CREATED_AT', 'CREADO_POR', 'ACTUALIZADO_POR', 'SOLICITUD_HASH', 'SUBCATEGORIA', 'PROVEEDOR', 'NUMERO_FACTURA', 'OBSERVACIONES', 'SUBTOTAL', 'USUARIO_REGISTRO']
  },
  AUDITORIA: { required: ['ID', 'FECHA', 'USUARIO', 'ACCION', 'HOJA', 'REGISTRO_ID', 'ANTES', 'DESPUES'], optional: [] },
  CONFIGURACION: { required: ['CLAVE', 'VALOR'], optional: [] }
};

function fail_(message, status) { var e = new Error(message); e.status = status || 400; throw e; }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function doGet() { return json_({ success: false, message: 'No autorizado', status: 401 }); }

function equalSecret_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !b) return false;
  var x = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, a, Utilities.Charset.UTF_8);
  var y = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, b, Utilities.Charset.UTF_8);
  var difference = 0;
  for (var i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}

function doPost(e) {
  var lock;
  try {
    if (!e || !e.postData || e.postData.contents.length > 7500000) fail_('Solicitud invalida', 413);
    var request;
    try { request = JSON.parse(e.postData.contents); } catch (_) { fail_('JSON invalido'); }
    if (!request || !equalSecret_(request.secret, PropertiesService.getScriptProperties().getProperty('GAS_API_SECRET'))) fail_('No autorizado', 401);
    if (!request.user || typeof request.user.username !== 'string' || !request.user.username.trim() || request.user.username.length > 100 || /[\x00-\x1f\x7f-\x9f]/.test(request.user.username)) fail_('Usuario invalido', 401);
    var actions = ['bootstrap', 'movements', 'statistics', 'create', 'update', 'void', 'saveCatalog'];
    if (actions.indexOf(request.action) < 0) fail_('Accion desconocida', 404);
    var payload = request.payload || {};
    if (typeof payload !== 'object' || Array.isArray(payload)) fail_('Payload invalido');
    lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) fail_('Servidor ocupado, reintente', 503);
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    assertReady_(ss);
    var data;
    switch (request.action) {
      case 'bootstrap': data = bootstrap_(ss); break;
      case 'movements': data = enrichedMovements_(ss); break;
      case 'statistics': data = statistics_(ss, payload.filters || {}); break;
      case 'create': data = create_(ss, payload, request.user.username); break;
      case 'update': data = update_(ss, payload, request.user.username); break;
      case 'void': data = void_(ss, payload, request.user.username); break;
      case 'saveCatalog': data = saveCatalog_(ss, payload, request.user.username); break;
    }
    if (['create', 'update', 'void'].indexOf(request.action) >= 0) data = Object.assign({}, data, { FACTURA: data.NUMERO_FACTURA || '' });
    return json_({ success: true, data: data });
  } catch (error) {
    console.error(error.stack || error.message);
    return json_({ success: false, message: error.status ? error.message : 'Error de almacenamiento o configuracion. Verifique la auditoria antes de reintentar.', status: error.status || 500 });
  } finally { if (lock && lock.hasLock()) lock.releaseLock(); }
}

function inspect_(ss) {
  var report = { spreadsheetId: SPREADSHEET_ID, compatible: true, sheets: [] };
  Object.keys(SCHEMA).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    var spec = SCHEMA[name];
    var item = { name: name, exists: !!sheet, empty: !sheet || sheet.getLastRow() === 0, headers: [], missingRequired: [], unknownHeaders: [], duplicateHeaders: [] };
    if (!item.empty) {
      item.headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
      item.missingRequired = spec.required.filter(function (h) { return item.headers.indexOf(h) < 0; });
      item.unknownHeaders = item.headers.filter(function (h) { return spec.required.concat(spec.optional).indexOf(h) < 0; });
      item.duplicateHeaders = item.headers.filter(function (h, i) { return item.headers.indexOf(h) !== i; });
      if (item.missingRequired.length || item.unknownHeaders.length || item.duplicateHeaders.length) report.compatible = false;
    }
    report.sheets.push(item);
  });
  return report;
}

function inspectStructure() {
  var report = inspect_(SpreadsheetApp.openById(SPREADSHEET_ID));
  console.log(JSON.stringify(report, null, 2));
  return report;
}

function setupSpreadsheet() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    // Preflight every target before inserting, appending headers, seeding, or changing anything.
    var report = inspect_(ss);
    if (!report.compatible) fail_('Estructura incompatible. Ejecute inspectStructure y revise encabezados; no se modifico ninguna hoja.', 409);
    report.sheets.forEach(function (item) {
      var sheet = ss.getSheetByName(item.name) || ss.insertSheet(item.name);
      var expected = SCHEMA[item.name].required.concat(SCHEMA[item.name].optional);
      if (item.empty) sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
      else {
        var missing = SCHEMA[item.name].optional.filter(function (h) { return item.headers.indexOf(h) < 0; });
        if (missing.length) sheet.getRange(1, item.headers.length + 1, 1, missing.length).setValues([missing]);
      }
      sheet.setFrozenRows(1);
    });
    Object.keys(APPROVED_CATALOGS).forEach(function (name) {
      var existing = table_(ss, name).rows;
      APPROVED_CATALOGS[name].forEach(function (seed) {
        if (existing.some(function (r) { return String(r.NOMBRE).trim().toLowerCase() === seed.NOMBRE.toLowerCase(); })) return;
        var id = seed.ID;
        while (existing.some(function (r) { return r.ID === id; })) id = Utilities.getUuid();
        var row = Object.assign({}, seed, { ID: id, ESTADO: 'Activo', UPDATED_AT: new Date().toISOString() });
        appendDirect_(ss, name, row);
        existing.push(row);
      });
    });
    var config = table_(ss, 'CONFIGURACION').rows;
    [{ CLAVE: 'MONEDA', VALOR: 'USD' }, { CLAVE: 'IVA_PORCENTAJE', VALOR: 0 }].forEach(function (row) {
      if (!config.some(function (r) { return r.CLAVE === row.CLAVE; })) appendDirect_(ss, 'CONFIGURACION', row);
    });
    SpreadsheetApp.flush();
    return inspect_(ss);
  } finally { lock.releaseLock(); }
}

function assertReady_(ss) {
  var report = inspect_(ss);
  if (!report.compatible || report.sheets.some(function (s) {
    return s.empty || SCHEMA[s.name].optional.some(function (h) { return s.headers.indexOf(h) < 0; });
  })) fail_('Ejecute inspectStructure y setupSpreadsheet antes de usar la API', 503);
}

function table_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet || !sheet.getLastRow()) fail_('Hoja no configurada: ' + name, 503);
  var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  var headers = values.shift().map(String);
  var rows = [];
  values.forEach(function (cells, i) {
    if (cells.every(function (v) { return v === ''; })) return;
    var row = {};
    headers.forEach(function (h, j) {
      var v = cells[j];
      if (v instanceof Date) v = h === 'FECHA' || h === 'HORA' ? Utilities.formatDate(v, ss.getSpreadsheetTimeZone(), h === 'FECHA' ? 'yyyy-MM-dd' : 'HH:mm') : v.toISOString();
      if (typeof v === 'number' && (h === 'ID' || /_ID$/.test(h) || ['JEFE', 'CUENTA', 'CATEGORIA', 'FORMA_PAGO', 'CLAVE_IDEMPOTENCIA'].indexOf(h) >= 0)) v = String(v);
      row[h] = v;
    });
    Object.defineProperty(row, '_row', { value: i + 2, enumerable: false });
    rows.push(row);
  });
  return { sheet: sheet, headers: headers, rows: rows };
}

function cells_(headers, row) {
  return headers.map(function (h) {
    var value = row[h] === undefined || row[h] === null ? '' : row[h];
    // User strings must remain literal text, not executable Sheets formulas.
    return typeof value === 'string' && /^[=+\-@]/.test(value) ? "'" + value : value;
  });
}

function appendDirect_(ss, name, row) {
  var t = table_(ss, name);
  t.sheet.getRange(t.sheet.getLastRow() + 1, 1, 1, t.headers.length).setValues([cells_(t.headers, row)]);
}

function audit_(action, sheet, id, before, after, user) {
  var oldJson = JSON.stringify(before === undefined ? null : before);
  var newJson = JSON.stringify(after === undefined ? null : after);
  if (oldJson.length > 45000 || newJson.length > 45000) fail_('Registro demasiado grande para auditoria');
  return { ID: Utilities.getUuid(), FECHA: new Date().toISOString(), USUARIO: user, ACCION: action, HOJA: sheet, REGISTRO_ID: id, ANTES: oldJson, DESPUES: newJson };
}

function commit_(ss, name, before, after, action, user) {
  var target = table_(ss, name);
  var audits = table_(ss, 'AUDITORIA');
  var audit = audit_(action, name, after.ID || after.CLAVE, before, after, user);
  var operations = [
    { sheet: target.sheet, row: before ? before._row : target.sheet.getLastRow() + 1, headers: target.headers, value: after },
    { sheet: audits.sheet, row: audits.sheet.getLastRow() + 1, headers: audits.headers, value: audit }
  ];
  var touched = [];
  try {
    operations.forEach(function (op) {
      var range = op.sheet.getRange(op.row, 1, 1, op.headers.length);
      var previous = range.getValues();
      touched.push({ range: range, previous: previous });
      range.setValues([cells_(op.headers, op.value)]);
    });
    SpreadsheetApp.flush();
  } catch (error) {
    var rollbackFailed = false;
    touched.reverse().forEach(function (op) {
      try { op.range.setValues(op.previous); } catch (_) { rollbackFailed = true; }
    });
    try { SpreadsheetApp.flush(); } catch (_) { rollbackFailed = true; }
    console.error('Write failed; rollbackFailed=' + rollbackFailed + ': ' + error.message);
    fail_(rollbackFailed ? 'Fallo de escritura y restauracion. Revise MOVIMIENTOS y AUDITORIA antes de reintentar.' : 'No se guardo el cambio: fallo de escritura o auditoria. Reintente.', 503);
  }
  return after;
}

function active_(row) { return !!row && row.ESTADO === 'Activo'; }
function reference_(ss, sheet, id, allowInactive) {
  if (typeof id !== 'string' || !id) fail_('ID requerido en ' + sheet);
  var matches = table_(ss, sheet).rows.filter(function (r) { return r.ID === id; });
  if (matches.length !== 1 || (!allowInactive && !active_(matches[0]))) fail_('Referencia invalida o inactiva en ' + sheet);
  return matches[0];
}
function text_(value, max, name, required) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) || (required && !value.trim())) fail_('Campo invalido: ' + name);
  return value.trim();
}
function number_(value, name) {
  if (typeof value !== 'number' || !isFinite(value) || value < 0 || value > 1000000000) fail_('Numero invalido: ' + name);
  return value;
}
function money_(value, name) {
  number_(value, name);
  if (Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) fail_('Use como maximo dos decimales: ' + name);
  return Math.round(value * 100) / 100;
}
function cents_(value) { return Math.round(Number(value || 0) * 100); }
function date_(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail_('FECHA debe ser yyyy-mm-dd');
  var d = new Date(value + 'T00:00:00Z');
  if (!isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) fail_('Fecha invalida');
  return value;
}
function stateName_(ss, value) {
  var matches = table_(ss, 'ESTADOS').rows.filter(function (r) { return active_(r) && (r.NOMBRE === value || r.ID === value); });
  if (matches.length !== 1 || STATES.indexOf(matches[0].NOMBRE) < 0) fail_('Estado invalido');
  return matches[0].NOMBRE;
}
function uuid_(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function live_(m) { return m.ESTADO !== 'Anulado'; }
function expense_(m) { return ['Gasto', 'Compra', 'Pago'].indexOf(m.TIPO) >= 0 && !m.MOVIMIENTO_ORIGEN_ID; }
function linked_(rows, id, excluding) { return rows.filter(function (m) { return live_(m) && m.MOVIMIENTO_ORIGEN_ID === id && m.ID !== excluding; }); }
function driveUrl_(value) {
  return typeof value === 'string' && !/\s/.test(value) && (value === '' ||
    /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/(?:view|preview)(?:\?[A-Za-z0-9_=%&.~+\-]*)?$/.test(value) ||
    /^https:\/\/drive\.google\.com\/open\?id=[A-Za-z0-9_-]+(?:&[A-Za-z0-9_=%&.~+\-]*)?$/.test(value));
}

function normalize_(ss, input, rows, previous) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail_('movement es requerido');
  var m = {};
  m.FECHA = date_(input.FECHA);
  m.HORA = text_(input.HORA, 5, 'HORA', true);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(m.HORA)) fail_('HORA debe ser HH:mm');
  m.TIPO = text_(input.TIPO, 30, 'TIPO', true);
  if (TYPES.indexOf(m.TIPO) < 0) fail_('Tipo invalido');
  ['JEFE', 'CATEGORIA', 'FORMA_PAGO'].forEach(function (key) {
    m[key] = text_(input[key], 100, key, true);
    var sheet = { JEFE: 'JEFES', CATEGORIA: 'CATEGORIAS', FORMA_PAGO: 'FORMAS_PAGO' }[key];
    reference_(ss, sheet, m[key], !!previous && previous[key] === m[key]);
  });
  var sameJefe = !!previous && previous.JEFE === m.JEFE;
  m.CUENTA = text_(input.CUENTA === undefined && sameJefe ? previous.CUENTA : input.CUENTA, 100, 'CUENTA', false);
  if (m.CUENTA) {
    var account = reference_(ss, 'CUENTAS', m.CUENTA, sameJefe && previous.CUENTA === m.CUENTA);
    if (account.JEFE !== m.JEFE) fail_('La cuenta no pertenece al jefe');
  }
  m.DESCRIPCION = text_(input.DESCRIPCION, 2000, 'DESCRIPCION', true);
  ['SUBCATEGORIA', 'PROVEEDOR', 'OBSERVACIONES'].forEach(function (key) {
    m[key] = text_(input[key] === undefined && previous ? previous[key] : input[key], key === 'OBSERVACIONES' ? 2000 : 200, key, false);
  });
  var invoice = input.NUMERO_FACTURA;
  if (input.FACTURA !== undefined) {
    var alias = text_(input.FACTURA, 100, 'FACTURA', false);
    if (invoice !== undefined && text_(invoice, 100, 'NUMERO_FACTURA', false) !== alias) fail_('FACTURA y NUMERO_FACTURA deben coincidir');
    invoice = alias;
  }
  m.NUMERO_FACTURA = text_(invoice === undefined && previous ? previous.NUMERO_FACTURA : invoice, 100, 'NUMERO_FACTURA', false);
  m.CANTIDAD = number_(input.CANTIDAD, 'CANTIDAD');
  m.VALOR_UNITARIO = money_(input.VALOR_UNITARIO, 'VALOR_UNITARIO');
  if (typeof input.TOTAL_MANUAL !== 'boolean') fail_('TOTAL_MANUAL debe ser booleano');
  m.TOTAL_MANUAL = input.TOTAL_MANUAL;
  m.TOTAL = money_(input.TOTAL, 'TOTAL');
  m.SUBTOTAL = money_(Math.round((m.CANTIDAD * m.VALOR_UNITARIO + Number.EPSILON) * 100) / 100, 'SUBTOTAL');
  if (!m.TOTAL_MANUAL && cents_(m.SUBTOTAL) !== cents_(m.TOTAL)) fail_('TOTAL no coincide con cantidad por valor unitario');
  m.ESTADO = stateName_(ss, input.ESTADO);
  if (m.ESTADO === 'Anulado') fail_('Use la accion void para anular');
  m.DIRECCION = text_(input.DIRECCION, 20, 'DIRECCION', false);
  if (m.TIPO === 'Préstamo' || m.TIPO === 'Adelanto') {
    if (['Recibido', 'Entregado'].indexOf(m.DIRECCION) < 0) fail_('Seleccione DIRECCION Recibido o Entregado');
  } else if (m.DIRECCION) fail_('DIRECCION solo aplica a Prestamo o Adelanto');
  m.MOVIMIENTO_ORIGEN_ID = text_(input.MOVIMIENTO_ORIGEN_ID, 100, 'MOVIMIENTO_ORIGEN_ID', false);
  m.CUENTA_DESTINO_ID = text_(input.CUENTA_DESTINO_ID === undefined && sameJefe ? previous.CUENTA_DESTINO_ID : input.CUENTA_DESTINO_ID, 100, 'CUENTA_DESTINO_ID', false);
  if (m.TIPO === 'Transferencia') {
    if (m.CUENTA || m.CUENTA_DESTINO_ID) {
      if (!m.CUENTA || !m.CUENTA_DESTINO_ID) fail_('Transferencia con cuentas requiere origen y destino');
      var destination = reference_(ss, 'CUENTAS', m.CUENTA_DESTINO_ID, sameJefe && previous.CUENTA_DESTINO_ID === m.CUENTA_DESTINO_ID);
      if (destination.ID === m.CUENTA || destination.JEFE !== m.JEFE) fail_('Transferencia requiere dos cuentas distintas del mismo jefe');
    }
    if (m.ESTADO !== 'Pagado' || m.TOTAL <= 0) fail_('Transferencia requiere total positivo y estado Pagado');
  } else if (m.CUENTA_DESTINO_ID) fail_('CUENTA_DESTINO_ID solo aplica a Transferencia');
  if (m.MOVIMIENTO_ORIGEN_ID) {
    if (m.TIPO !== 'Pago' || m.ESTADO !== 'Pagado' || m.TOTAL <= 0) fail_('Pago vinculado requiere tipo Pago, total positivo y estado Pagado');
    var origin = rows.filter(function (r) { return r.ID === m.MOVIMIENTO_ORIGEN_ID; })[0];
    if (!origin || !live_(origin) || !expense_(origin) || (previous && origin.ID === previous.ID)) fail_('Gasto original invalido');
    if (origin.JEFE !== m.JEFE) fail_('Pago y gasto deben pertenecer al mismo jefe');
    var paid = cents_(origin.PAGADO) + linked_(rows, origin.ID, previous && previous.ID).reduce(function (sum, r) { return sum + cents_(r.PAGADO); }, 0);
    if (paid + cents_(m.TOTAL) > cents_(origin.TOTAL)) fail_('El pago supera el saldo pendiente');
  }
  if (!expense_(m) && m.ESTADO !== 'Pagado') fail_('Este tipo de movimiento requiere estado Pagado');
  if (m.ESTADO === 'Pagado') {
    m.PAGADO = m.TOTAL;
    if (input.PAGADO !== undefined && money_(input.PAGADO, 'PAGADO') !== m.TOTAL) fail_('PAGADO debe coincidir con TOTAL');
  } else if (m.ESTADO === 'Pendiente') {
    m.PAGADO = 0;
    if (input.PAGADO !== undefined && money_(input.PAGADO, 'PAGADO') !== 0) fail_('Pendiente requiere PAGADO cero');
  } else {
    m.PAGADO = money_(input.PAGADO, 'PAGADO');
    if (m.PAGADO <= 0 || m.PAGADO >= m.TOTAL) fail_('Pago parcial requiere PAGADO mayor que cero y menor que TOTAL');
  }
  var receipt = input.COMPROBANTE_URL === undefined && previous ? previous.COMPROBANTE_URL : input.COMPROBANTE_URL;
  if (receipt === undefined) receipt = '';
  if (!driveUrl_(receipt)) fail_('URL de comprobante invalida');
  m.COMPROBANTE_URL = text_(receipt, 300, 'COMPROBANTE_URL', false);
  m.IVA = 0;
  m.IVA_PORCENTAJE = 0;
  return m;
}

function newTimestamp_(previous) {
  var time = Date.now();
  if (previous && Date.parse(previous.UPDATED_AT) >= time) time = Date.parse(previous.UPDATED_AT) + 1;
  return new Date(time).toISOString();
}
function findMovement_(rows, id) {
  var matches = rows.filter(function (m) { return m.ID === id; });
  if (matches.length !== 1) fail_('Movimiento no encontrado', 404);
  return matches[0];
}
function checkVersion_(m, version) {
  if (typeof version !== 'string' || !version || m.UPDATED_AT !== version) fail_('El movimiento cambio. Recargue antes de editar.', 409);
}
function protectOrigin_(rows, m) {
  if (linked_(rows, m.ID).length) fail_('Anule primero los pagos vinculados antes de editar o anular el gasto original', 409);
}

function requestHash_(input) {
  var fields = ['FECHA', 'HORA', 'TIPO', 'JEFE', 'CUENTA', 'CATEGORIA', 'FORMA_PAGO', 'DESCRIPCION', 'SUBCATEGORIA', 'PROVEEDOR', 'NUMERO_FACTURA', 'FACTURA', 'OBSERVACIONES', 'CANTIDAD', 'VALOR_UNITARIO', 'TOTAL', 'ESTADO', 'DIRECCION', 'PAGADO', 'MOVIMIENTO_ORIGEN_ID', 'CUENTA_DESTINO_ID', 'TOTAL_MANUAL', 'COMPROBANTE_URL'];
  var value = {};
  fields.forEach(function (key) { if (input[key] !== undefined) value[key] = input[key]; });
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(value), Utilities.Charset.UTF_8).map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

function create_(ss, payload, user) {
  var input = payload.movement;
  if (!input || !uuid_(input.CLAVE_IDEMPOTENCIA)) fail_('CLAVE_IDEMPOTENCIA debe ser un UUID generado por el cliente');
  var rows = table_(ss, 'MOVIMIENTOS').rows;
  var hash = requestHash_(input);
  var previous = rows.filter(function (r) { return r.CLAVE_IDEMPOTENCIA === input.CLAVE_IDEMPOTENCIA; });
  if (previous.length) {
    if (previous.length !== 1 || previous[0].CREADO_POR !== user || previous[0].SOLICITUD_HASH !== hash) fail_('Clave de idempotencia en uso con otra solicitud', 409);
    // A retry returns the committed record even if later edits or catalog changes occurred.
    return previous[0];
  }
  var m = normalize_(ss, input, rows, null);
  m.ID = Utilities.getUuid();
  m.CLAVE_IDEMPOTENCIA = input.CLAVE_IDEMPOTENCIA;
  m.SOLICITUD_HASH = hash;
  m.CREATED_AT = m.UPDATED_AT = newTimestamp_();
  m.CREADO_POR = m.ACTUALIZADO_POR = user;
  m.USUARIO_REGISTRO = user;
  return commit_(ss, 'MOVIMIENTOS', null, m, 'CREAR', user);
}

function update_(ss, payload, user) {
  var input = payload.movement;
  if (!input) fail_('movement es requerido');
  var rows = table_(ss, 'MOVIMIENTOS').rows;
  var previous = findMovement_(rows, input.ID);
  checkVersion_(previous, input.UPDATED_AT);
  if (!live_(previous)) fail_('No se puede editar un movimiento anulado', 409);
  protectOrigin_(rows, previous);
  var m = normalize_(ss, input, rows, previous);
  ['ID', 'CLAVE_IDEMPOTENCIA', 'CREATED_AT', 'CREADO_POR', 'SOLICITUD_HASH'].forEach(function (key) { m[key] = previous[key]; });
  m.USUARIO_REGISTRO = previous.USUARIO_REGISTRO || previous.CREADO_POR;
  m.UPDATED_AT = newTimestamp_(previous);
  m.ACTUALIZADO_POR = user;
  return commit_(ss, 'MOVIMIENTOS', previous, m, 'ACTUALIZAR', user);
}

function void_(ss, payload, user) {
  var rows = table_(ss, 'MOVIMIENTOS').rows;
  var previous = findMovement_(rows, payload.id);
  checkVersion_(previous, payload.updatedAt);
  if (!live_(previous)) fail_('Movimiento ya anulado', 409);
  protectOrigin_(rows, previous);
  var m = Object.assign({}, previous, { ESTADO: 'Anulado', UPDATED_AT: newTimestamp_(previous), ACTUALIZADO_POR: user });
  return commit_(ss, 'MOVIMIENTOS', previous, m, 'ANULAR', user);
}

function saveCatalog_(ss, payload, user) {
  var name = payload.sheet;
  if (name === 'CUENTAS') fail_('CUENTAS es un catalogo historico de solo lectura', 403);
  if (['JEFES', 'CATEGORIAS', 'FORMAS_PAGO', 'ESTADOS'].indexOf(name) < 0) fail_('Catalogo no permitido');
  var input = payload.row;
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail_('row es requerido');
  var allowed = SCHEMA[name].required.concat(SCHEMA[name].optional);
  if (Object.keys(input).some(function (key) { return allowed.indexOf(key) < 0; })) fail_('Campo de catalogo no permitido');
  var t = table_(ss, name);
  var previous = input.ID ? t.rows.filter(function (r) { return r.ID === input.ID; })[0] : null;
  if (input.ID && !previous) fail_('ID de catalogo no encontrado; omita ID para crear', 404);
  if (previous) checkVersion_(previous, input.UPDATED_AT);
  var row = { ID: previous ? previous.ID : Utilities.getUuid(), NOMBRE: text_(input.NOMBRE, 120, 'NOMBRE', true), ESTADO: text_(input.ESTADO, 20, 'ESTADO', true), UPDATED_AT: newTimestamp_(previous) };
  if (['Activo', 'Inactivo'].indexOf(row.ESTADO) < 0) fail_('ESTADO de catalogo debe ser Activo o Inactivo');
  if (t.rows.some(function (r) { return r.ID !== row.ID && String(r.NOMBRE).toLowerCase() === row.NOMBRE.toLowerCase(); })) fail_('Nombre de catalogo duplicado', 409);
  if (name === 'ESTADOS' && STATES.indexOf(row.NOMBRE) < 0) fail_('Solo se permiten los estados contables Pagado, Pendiente, Pago parcial y Anulado; no se admiten estados personalizados');
  if (name === 'ESTADOS' && (row.ESTADO !== 'Activo' || (previous && row.NOMBRE !== previous.NOMBRE))) fail_('Los estados contables no se pueden renombrar ni desactivar');
  if (name === 'JEFES') row.TIPO = text_(input.TIPO === undefined && previous ? previous.TIPO : input.TIPO, 100, 'TIPO', false);
  return commit_(ss, name, previous, row, previous ? 'EDITAR_CATALOGO' : 'CREAR_CATALOGO', user);
}

function enrichedMovements_(ss) {
  var rows = table_(ss, 'MOVIMIENTOS').rows;
  var paidByOrigin = Object.create(null);
  rows.forEach(function (m) {
    if (live_(m) && m.MOVIMIENTO_ORIGEN_ID) paidByOrigin[m.MOVIMIENTO_ORIGEN_ID] = (paidByOrigin[m.MOVIMIENTO_ORIGEN_ID] || 0) + cents_(m.PAGADO);
  });
  return rows.map(function (m) {
    var row = Object.assign({}, m);
    if (row.SUBTOTAL === '' || row.SUBTOTAL === undefined) row.SUBTOTAL = Math.round((Number(row.CANTIDAD) * Number(row.VALOR_UNITARIO) + Number.EPSILON) * 100) / 100;
    row.USUARIO_REGISTRO = row.USUARIO_REGISTRO || row.CREADO_POR || '';
    ['CANTIDAD', 'VALOR_UNITARIO', 'SUBTOTAL', 'TOTAL', 'PAGADO', 'IVA', 'IVA_PORCENTAJE'].forEach(function (key) { row[key] = Number(row[key] || 0); });
    row.FACTURA = row.NUMERO_FACTURA || '';
    row.TOTAL_MANUAL = row.TOTAL_MANUAL === true || row.TOTAL_MANUAL === 'TRUE';
    var linkedPaid = live_(m) && expense_(m) ? paidByOrigin[m.ID] || 0 : 0;
    row.PAGADO_VINCULADO = linkedPaid / 100;
    row.SALDO_PENDIENTE = live_(m) && expense_(m) ? Math.max(0, cents_(m.TOTAL) - cents_(m.PAGADO) - linkedPaid) / 100 : 0;
    return row;
  });
}

function balances_(accounts, rows) {
  // Legacy account balances cover only accounted ledger entries, not total investment.
  var balances = Object.create(null);
  accounts.forEach(function (a) { balances[a.ID] = cents_(a.SALDO_INICIAL); });
  rows.filter(live_).forEach(function (m) {
    if (m.TIPO === 'Transferencia' && (m.CUENTA || m.CUENTA_DESTINO_ID) && (!m.CUENTA || !m.CUENTA_DESTINO_ID)) fail_('Transferencia con cuentas incompletas', 503);
    if (!m.CUENTA) return;
    var paid = cents_(m.PAGADO);
    var sign = ['Ingreso', 'Reembolso'].indexOf(m.TIPO) >= 0 || (['Préstamo', 'Adelanto'].indexOf(m.TIPO) >= 0 && m.DIRECCION === 'Recibido') ? 1 : -1;
    if (balances[m.CUENTA] === undefined) fail_('Movimiento con cuenta inexistente', 503);
    balances[m.CUENTA] += sign * paid;
    if (m.TIPO === 'Transferencia') {
      if (balances[m.CUENTA_DESTINO_ID] === undefined) fail_('Transferencia con destino inexistente', 503);
      balances[m.CUENTA_DESTINO_ID] += paid;
    }
  });
  return balances;
}

function bootstrap_(ss) {
  var accounts = table_(ss, 'CUENTAS').rows;
  var balances = balances_(accounts, table_(ss, 'MOVIMIENTOS').rows);
  return {
    jefes: table_(ss, 'JEFES').rows,
    cuentas: accounts.map(function (a) { return Object.assign({}, a, { SALDO_INICIAL: Number(a.SALDO_INICIAL || 0), SALDO_ACTUAL: balances[a.ID] / 100 }); }),
    categorias: table_(ss, 'CATEGORIAS').rows,
    formasPago: table_(ss, 'FORMAS_PAGO').rows,
    estados: table_(ss, 'ESTADOS').rows,
    tipos: TYPES.slice(),
    configuracion: { MONEDA: 'USD', IVA_PORCENTAJE: 0 }
  };
}

function statistics_(ss, filters) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) fail_('Filtros invalidos');
  var allowed = ['desde', 'hasta', 'jefe', 'cuenta', 'categoria', 'tipo', 'estado'];
  if (Object.keys(filters).some(function (key) { return allowed.indexOf(key) < 0; })) fail_('Filtro desconocido');
  if (filters.desde) date_(filters.desde);
  if (filters.hasta) date_(filters.hasta);
  if (filters.desde && filters.hasta && filters.desde > filters.hasta) fail_('Rango de fechas invalido');
  allowed.forEach(function (key) { if (filters[key] !== undefined && typeof filters[key] !== 'string') fail_('Filtro invalido'); });
  var all = enrichedMovements_(ss);
  var rows = all.filter(function (m) {
    return live_(m) && (!filters.desde || m.FECHA >= filters.desde) && (!filters.hasta || m.FECHA <= filters.hasta) &&
      (!filters.jefe || m.JEFE === filters.jefe) && (!filters.cuenta || m.CUENTA === filters.cuenta || m.CUENTA_DESTINO_ID === filters.cuenta) &&
      (!filters.categoria || m.CATEGORIA === filters.categoria) && (!filters.tipo || m.TIPO === filters.tipo) && (!filters.estado || m.ESTADO === filters.estado);
  });
  var summary = { cantidad: rows.length, ingresos: 0, egresos: 0, gastos: 0, pendiente: 0, transferencias: 0 };
  var categories = Object.create(null);
  rows.forEach(function (m) {
    var paid = cents_(m.PAGADO);
    if (m.TIPO === 'Transferencia') summary.transferencias += paid;
    else if (['Ingreso', 'Reembolso'].indexOf(m.TIPO) >= 0 || (['Préstamo', 'Adelanto'].indexOf(m.TIPO) >= 0 && m.DIRECCION === 'Recibido')) summary.ingresos += paid;
    else summary.egresos += paid;
    if (expense_(m)) {
      summary.gastos += cents_(m.TOTAL);
      summary.pendiente += cents_(m.SALDO_PENDIENTE);
      categories[m.CATEGORIA] = (categories[m.CATEGORIA] || 0) + cents_(m.TOTAL);
    }
  });
  ['ingresos', 'egresos', 'gastos', 'pendiente', 'transferencias'].forEach(function (key) { summary[key] /= 100; });
  summary.neto = Math.round((summary.ingresos - summary.egresos) * 100) / 100;
  var accounts = table_(ss, 'CUENTAS').rows;
  var balances = balances_(accounts, all);
  return {
    resumen: summary,
    porCategoria: Object.keys(categories).map(function (id) { return { CATEGORIA: id, TOTAL: categories[id] / 100 }; }),
    saldos: accounts.filter(function (a) { return (!filters.jefe || a.JEFE === filters.jefe) && (!filters.cuenta || a.ID === filters.cuenta); }).map(function (a) { return { CUENTA: a.ID, JEFE: a.JEFE, SALDO: balances[a.ID] / 100 }; })
  };
}
