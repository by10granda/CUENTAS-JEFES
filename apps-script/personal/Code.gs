/* Independent personal finance project. See CONTRACT.md before deployment. */
var PERSONAL_SPREADSHEET_ID = '1WU3UF1gTgut-Yx2dUn51Kk1fu2EHtnQSfxOOdx15-Y0';
var PERSONAL_META = ['ID', 'USERNAME', 'OP_ID', 'UPDATED_AT'];
var PERSONAL_FIELDS = {
  Cuentas: 'NOMBRE BANCO TITULAR IDENTIFICADOR TIPO SALDO_INICIAL DEUDA_INICIAL LIMITE_CREDITO FECHA_APERTURA DIA_CORTE DIA_PAGO PAGO_MINIMO PAGO_TOTAL_ESTADO ESTADO OBSERVACIONES MONEDA FECHA_CORTE FECHA_MAXIMA_PAGO',
  Beneficiarios: 'NOMBRE TIPO IDENTIFICACION TELEFONO EMAIL BANCO_DESTINO CUENTA_DESTINO CONCEPTO VALOR FRECUENCIA DIA_VENCIMIENTO ESTADO OBSERVACIONES',
  Categorias: 'NOMBRE TIPO ESTADO',
  Obligaciones: 'TITULO MONTO FRECUENCIA INICIO FIN DIA BENEFICIARIO CATEGORIA ESTADO OBSERVACIONES',
  Cuotas: 'TITULO MONTO FECHA_VENCIMIENTO DEFINICION FECHA_PROGRAMADA CLAVE_PERIODO BENEFICIARIO CATEGORIA TARJETA ESTADO OBSERVACIONES',
  Movimientos: 'FECHA TIPO DESCRIPCION MONTO CUENTA DESTINO CATEGORIA BENEFICIARIO METODO ASIENTOS ESTADO COMPROBANTE_URL REFERENCIA MOTIVO OBSERVADO DIFERENCIA',
  Transferencias: 'MOVIMIENTO ORIGEN DESTINO MONTO COMISION ESTADO',
  Pagos: 'CUOTA MOVIMIENTO MONTO FECHA REFERENCIA FACTURA DOCUMENTO ESTADO',
  Configuracion: 'CLAVE VALOR',
  Auditoria: 'ENTIDAD ENTIDAD_ID ANTES DESPUES MOTIVO'
};
var PERSONAL_SCHEMAS = {};
Object.keys(PERSONAL_FIELDS).forEach(function (s) { PERSONAL_SCHEMAS[s] = PERSONAL_META.concat(PERSONAL_FIELDS[s].split(' ')); });
PERSONAL_SCHEMAS.Operaciones = 'ID USERNAME REQUEST_ID HASH ACTION ESTADO MANIFEST RESULTADO ERROR CREATED_AT UPDATED_AT OP_ID'.split(' ');
var PERSONAL_REQUIRED = {
  Cuentas: ['NOMBRE', 'TIPO'], Beneficiarios: ['NOMBRE', 'TIPO'], Categorias: ['NOMBRE', 'TIPO'],
  Obligaciones: ['TITULO', 'MONTO', 'FRECUENCIA', 'INICIO'], Cuotas: ['TITULO', 'MONTO', 'FECHA_VENCIMIENTO']
};
var PERSONAL_METHODS = ['Efectivo', 'Transferencia bancaria', 'Tarjeta de crédito', 'Cheque'];
var PERSONAL_FREQUENCIES = ['Semanal', 'Quincenal', 'Mensual', 'Trimestral', 'Semestral', 'Anual', 'Pago único'];

function pFail(message, status) { var e = new Error(message); e.status = status || 400; throw e; }
function pAssert(ok, message, status) { if (!ok) pFail(message, status); }
function pUserMessage(message) {
  var messages = {
    'Personal identity required': 'Debe indicar los datos de usuario y el rol personal para identificar el espacio de datos.',
    'Busy; retry later': 'El servicio está ocupado. Intente nuevamente más tarde.',
    'Expected object': 'La solicitud debe contener un objeto de datos válido.',
    'Invalid JSON': 'El contenido de la solicitud no es un JSON válido.',
    'Unknown action': 'La acción solicitada no está disponible.',
    'Invalid money': 'El importe debe ser un número válido, con hasta dos decimales y un máximo de 1.000.000.000.',
    'Invalid confirmed money': 'Hay un importe almacenado inválido. Revise los registros confirmados.',
    'Invalid date': 'La fecha debe tener el formato AAAA-MM-DD.',
    'Invalid calendar date': 'La fecha indicada no existe o está fuera del intervalo permitido (1900 a 9999).',
    'Future execution date': 'La fecha de una operación ejecutada no puede ser posterior a hoy. Registre una obligación pendiente (cuota) para un compromiso futuro.',
    'Insufficient funds': 'Fondos insuficientes en la cuenta.',
    'Credit debt outside limit': 'La deuda de la tarjeta no puede ser negativa ni superar el límite de crédito.',
    'Allocation exceeds commitment': 'Los pagos asignados superan el importe de la obligación.',
    'Payment exceeds pending amount': 'El pago supera el importe pendiente de la obligación.',
    'Payment exceeds card debt': 'El pago supera la deuda actual de la tarjeta.',
    'Amount below paid': 'El importe no puede ser menor que los pagos ya registrados.',
    'Card installment amount is immutable': 'El importe de una cuota de tarjeta no se puede modificar. Registre una nueva compra o una conciliación auditada para ajustar la deuda.',
    'Statement due date precedes closing date': 'La fecha máxima de pago no puede ser anterior a la fecha de corte.',
    'Amount must be positive': 'El importe debe ser mayor que cero.',
    'Stale UPDATED_AT': 'El registro fue modificado. Actualice los datos antes de guardar.',
    'requestId must be UUID': 'El identificador de solicitud debe ser un UUID válido.',
    'Request ID conflict': 'El identificador de solicitud ya se utilizó con otros datos o con otro usuario.',
    'Request reserved; manually discard and use a fresh UUID': 'La solicitud está reservada por una operación no confirmada. Revísela y descártela antes de usar un nuevo identificador.',
    'Resolve pending operations before submitting any fresh mutation UUID': 'Debe resolver las operaciones pendientes antes de enviar una nueva solicitud.',
    'Retry result missing; inspect journal': 'No se pudo recuperar el resultado original. Revise el diario de operaciones.',
    'Operation uncertain; inspect/retry same request ID, never replay with a new ID before resolution': 'No se pudo confirmar el resultado de la operación. Revise el diario o consulte con el mismo identificador; no use uno nuevo antes de resolverla.',
    'Write/Drive failure; inspect operation before discard': 'Falló la escritura o el almacenamiento del comprobante. Revise la operación antes de descartarla.',
    'Internal failure; inspect operation journal': 'Ocurrió un error interno. Revise el diario de operaciones antes de volver a intentar.',
    'Operation too large': 'La operación supera el tamaño permitido. Reduzca la cantidad de registros o la extensión de los datos.',
    'Generation horizon exceeds 366 days': 'La fecha final de generación no puede superar los 366 días desde hoy.',
    'Generation exceeds 100 new occurrences': 'La generación supera las 100 cuotas nuevas por operación. Genere cada definición por separado o reduzca el plazo.',
    'Unsupported save sheet': 'No se permite guardar datos en la tabla indicada.',
    'Incompatible headers; zero setup writes': 'Los encabezados son incompatibles. No se realizó ningún cambio de configuración.',
    'New row cannot supply UPDATED_AT': 'Un registro nuevo no puede incluir una versión de actualización.',
    'Opening values locked once used': 'El tipo y los valores iniciales de una cuenta utilizada no se pueden modificar.',
    'Credit account cannot have cash opening balance': 'Una tarjeta de crédito no puede tener saldo inicial de efectivo.',
    'Invalid initial credit debt': 'La deuda inicial no puede superar el límite de crédito.',
    'Only last four card digits': 'El identificador de la tarjeta solo puede contener hasta sus últimos cuatro dígitos.',
    'Expense category required': 'Debe seleccionar una categoría activa de gasto.',
    'Category classification mismatch': 'La categoría no corresponde al tipo de ingreso o gasto de la operación.',
    'Cash/bank account required': 'Debe seleccionar una cuenta bancaria o de efectivo, no una tarjeta de crédito.',
    'Credit card required': 'Debe seleccionar una tarjeta de crédito.',
    'Identical accounts': 'Las cuentas de origen y destino deben ser diferentes.',
    'Unexpected destination': 'Esta operación no admite una cuenta de destino.',
    'Unexpected category': 'Esta operación no admite una categoría.',
    'Commission only on transfers': 'Solo las transferencias admiten comisión.',
    'Installments only on card purchase': 'Solo las compras con tarjeta admiten cuotas.',
    'Invalid installment schedule': 'El primer vencimiento no puede ser anterior a la compra y cada cuota debe tener al menos un centavo.',
    'Installment count required': 'Debe indicar la cantidad de cuotas para programar vencimientos.',
    'Paid commitment must void payment first': 'Debe anular los pagos antes de anular la obligación.',
    'Commitment has active payments': 'La obligación tiene pagos activos. Anúlelos antes de cancelar la obligación.',
    'Operation has active dependent payments': 'La operación tiene pagos dependientes activos. Anúlelos primero.',
    'Operation has no active financial entities': 'La operación no tiene registros financieros activos para anular.',
    'Exactly one void target': 'Debe indicar una sola operación u obligación para anular.',
    'Operation void does not accept UPDATED_AT': 'La anulación de una operación no admite una versión de actualización.',
    'Only an owned pending operation can be discarded': 'Solo se puede descartar una operación pendiente que pertenezca a su usuario.',
    'Negative observed debt': 'La deuda observada no puede ser negativa.',
    'Adjustment too large': 'La diferencia de conciliación supera el importe permitido.',
    'Empty preferences': 'Debe indicar al menos una preferencia para configurar.',
    'Only USD supported': 'La moneda admitida es USD.',
    'Private Drive upload not configured': 'La carga privada de comprobantes no está configurada.',
    'Receipt folder must be private': 'La carpeta de comprobantes debe ser privada.',
    'Created receipt not private': 'El comprobante creado no tiene acceso privado. Revise la operación.',
    'Unsupported file type': 'Solo se permiten comprobantes JPG, PNG o PDF con la extensión correspondiente.',
    'Invalid base64 or size': 'El archivo está mal codificado o supera el tamaño permitido.',
    'Receipt exceeds 3 MiB': 'El comprobante no puede superar los 3 MiB.',
    'File magic does not match MIME': 'El contenido del archivo no corresponde al tipo de comprobante indicado.',
    'Invalid private Drive URL': 'Debe ingresar una URL válida de Google Drive de hasta 300 caracteres.'
  };
  if (Object.prototype.hasOwnProperty.call(messages, message)) return messages[message];
  if (typeof message === 'string') {
    if (message.indexOf('Invalid owned reference: ') === 0) return 'La referencia indicada no existe o no pertenece a su usuario.';
    if (message.indexOf('Inactive reference: ') === 0) return 'El registro relacionado está inactivo o anulado.';
    if (message.indexOf('Unknown field: ') === 0) return 'La solicitud contiene un campo no permitido.';
    if (message.indexOf('Missing ') === 0) return 'Complete todos los campos obligatorios.';
    if (message.indexOf('Run setup first: ') === 0) return 'Debe completar la configuración de las hojas antes de usar el servicio.';
    if (message.indexOf('Immutable generated field: ') === 0) return 'No se pueden modificar las referencias ni la clave original de una cuota generada.';
    if (message.indexOf('Credit-only field: ') === 0) return 'Los datos de crédito solo se permiten en cuentas de tarjeta de crédito.';
    if (message.indexOf('Invalid ') === 0) return 'Los datos indicados no son válidos. Revise los campos y sus valores.';
  }
  return 'No se pudo completar la solicitud. Revise los datos y el diario de operaciones.';
}
function pKeys(value, allowed) {
  pAssert(value && typeof value === 'object' && !Array.isArray(value), 'Expected object');
  Object.keys(value).forEach(function (k) { pAssert(allowed.indexOf(k) >= 0, 'Unknown field: ' + k); });
}
function pText(v, label, max, optional) {
  if (optional && (v === undefined || v === '')) return '';
  pAssert(typeof v === 'string' && v.trim() && v.length <= (max || 500) && !/[\x00-\x1f\x7f-\x9f]/.test(v), 'Invalid ' + label);
  return v.trim();
}
function pMoney(v, signed) {
  pAssert(typeof v === 'number' && isFinite(v) && Math.abs(v) <= 1e9 && (signed || v >= 0) && Math.abs(v * 100 - Math.round(v * 100)) < 0.00001, 'Invalid money');
  return Math.round(v * 100);
}
function pInt(v, lo, hi, label) { pAssert(Number.isInteger(v) && v >= lo && v <= hi, 'Invalid ' + label); return v; }
function pDate(v) {
  pAssert(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v), 'Invalid date');
  var parts = v.split('-').map(Number), d = new Date(0);
  d.setUTCFullYear(parts[0], parts[1] - 1, parts[2]); d.setUTCHours(0, 0, 0, 0);
  pAssert(parts[0] >= 1900 && parts[0] <= 9999 && d.toISOString().slice(0, 10) === v, 'Invalid calendar date'); return v;
}
function pExecutedDate(v, hoy) { pAssert(pDate(v) <= hoy, 'Future execution date'); return v; }
function pAddDays(s, n) { var d = new Date(pDate(s) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return pDate(d.toISOString().slice(0, 10)); }
function pMonth(s, n, day) {
  var d = new Date(pDate(s) + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  var last = new Date(d.getTime()); last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0);
  d.setUTCDate(Math.min(day || Number(s.slice(8)), last.getUTCDate())); return pDate(d.toISOString().slice(0, 10));
}
function pStable(v) {
  if (Array.isArray(v)) return '[' + v.map(pStable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + pStable(v[k]); }).join(',') + '}';
  return JSON.stringify(v);
}
function pHash(v) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pStable(v), Utilities.Charset.UTF_8).map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join(''); }
function pUuid() { return Utilities.getUuid(); }
function pNow() { return new Date().toISOString(); }
function pSpreadsheet() { return SpreadsheetApp.openById(PERSONAL_SPREADSHEET_ID); }
function pLock(fn) {
  var lock = LockService.getScriptLock(); pAssert(lock.tryLock(30000), 'Busy; retry later', 503);
  try { return fn(); } finally { lock.releaseLock(); }
}
function pRead(ss, name) {
  var sh = ss.getSheetByName(name); pAssert(sh, 'Run setup first: ' + name, 503);
  if (!sh.getLastRow()) return [];
  var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues(), headers = data.shift();
  return data.filter(function (r) { return r.some(function (v) { return v !== ''; }); }).map(function (r) {
    var obj = {}; headers.forEach(function (h, i) { obj[h] = r[i] instanceof Date ? r[i].toISOString() : r[i]; }); return obj;
  });
}
function pNumbers(sheet, row) {
  var out = Object.assign({}, row);
  if (sheet !== 'Configuracion') ['SALDO_INICIAL', 'DEUDA_INICIAL', 'LIMITE_CREDITO', 'PAGO_MINIMO', 'PAGO_TOTAL_ESTADO', 'VALOR', 'MONTO', 'COMISION', 'OBSERVADO', 'DIFERENCIA'].forEach(function (h) {
    var v = out[h]; if (v === undefined || v === '') return;
    if (typeof v === 'string') { pAssert(/^-?\d+(?:\.\d{1,2})?$/.test(v), 'Invalid confirmed money', 409); v = Number(v); }
    out[h] = pMoney(v, h === 'OBSERVADO' || h === 'DIFERENCIA') / 100;
  }); return out;
}
function pAppend(ss, name, row) {
  var sh = ss.getSheetByName(name), headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  // Force strings to literal text, preserving dates, identifiers and formula-like input.
  sh.getRange(sh.getLastRow() + 1, 1, 1, headers.length).setValues([headers.map(function (k) {
    var v = row[k] === undefined ? '' : row[k]; return typeof v === 'string' && v !== '' ? "'" + v : v;
  })]);
}
function pInspect(ss) {
  var actual = ss.getSheets().map(function (sh) {
    var headers = sh.getLastRow() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
    var schema = Object.prototype.hasOwnProperty.call(PERSONAL_SCHEMAS, sh.getName()) ? PERSONAL_SCHEMAS[sh.getName()] : null;
    var required = Object.prototype.hasOwnProperty.call(PERSONAL_REQUIRED, sh.getName()) ? PERSONAL_META.concat(PERSONAL_REQUIRED[sh.getName()]) : schema || [];
    var compatible = !schema || !headers.length;
    if (schema && headers.length) {
      var knownUnique = headers.every(function (h, i) { return schema.indexOf(h) >= 0 && headers.indexOf(h) === i; });
      for (var cut = headers.length; knownUnique && cut >= required.length && !compatible; cut--) {
        var prefix = headers.slice(0, cut), suffix = headers.slice(cut);
        var ordered = prefix.every(function (h, i) { return i === 0 || schema.indexOf(prefix[i - 1]) < schema.indexOf(h); });
        var missing = schema.filter(function (h) { return prefix.indexOf(h) < 0; });
        compatible = ordered && required.every(function (h) { return prefix.indexOf(h) >= 0; }) && (!suffix.length || pStable(suffix) === pStable(missing));
      }
    }
    return { name: sh.getName(), headers: headers, known: !!schema, compatible: compatible, missing: schema ? schema.filter(function (h) { return headers.indexOf(h) < 0; }) : [] };
  });
  return { compatible: actual.every(function (t) { return t.compatible; }), tabs: actual, targets: Object.keys(PERSONAL_SCHEMAS).map(function (name) { return actual.filter(function (t) { return t.name === name; })[0] || { name: name, missing: PERSONAL_SCHEMAS[name], compatible: true, exists: false }; }) };
}
var setup = {
  inspect: function () { return pLock(function () { return pInspect(pSpreadsheet()); }); },
  run: function () { return pLock(function () {
    var ss = pSpreadsheet(), inspection = pInspect(ss); pAssert(inspection.compatible, 'Incompatible headers; zero setup writes', 409);
    inspection.targets.forEach(function (t) {
      var sh = ss.getSheetByName(t.name) || ss.insertSheet(t.name);
      if (!sh.getLastRow()) sh.getRange(1, 1, 1, PERSONAL_SCHEMAS[t.name].length).setValues([PERSONAL_SCHEMAS[t.name]]);
      else if (t.missing.length) sh.getRange(1, sh.getLastColumn() + 1, 1, t.missing.length).setValues([t.missing]);
    });
    var defaults = { MONEDA: 'USD', TIMEZONE: ss.getSpreadsheetTimeZone(), DIAS_ALERTA: 7, PERMITIR_SOBREGIRO: false, METODOS: PERSONAL_METHODS, CANAL_EMAIL: '' }, rows = pRead(ss, 'Configuracion');
    Object.keys(defaults).forEach(function (key) {
      if (!rows.some(function (r) { return r.CLAVE === key && !r.USERNAME; })) pAppend(ss, 'Configuracion', { ID: 'system:' + key, USERNAME: '', OP_ID: '', UPDATED_AT: pNow(), CLAVE: key, VALOR: JSON.stringify(defaults[key]) });
    });
    SpreadsheetApp.flush(); return pInspect(ss);
  }); }
};
function inspectPersonalStructure() { var inspection = setup.inspect(); console.log(JSON.stringify(inspection)); return inspection; }
function setupPersonalSpreadsheet() { return setup.run(); }

function pState(ss, user) {
  var raw = {}; Object.keys(PERSONAL_SCHEMAS).forEach(function (s) { raw[s] = pRead(ss, s); });
  // Resolution markers have a parent operation barrier. Iterate until confirmed parents are known.
  var confirmed = {}, ops = {}, changed = true;
  while (changed) {
    changed = false;
    raw.Operaciones.forEach(function (o) { if ((!o.OP_ID || confirmed[o.OP_ID]) && o.ESTADO === 'CONFIRMADA' && !confirmed[o.ID]) { confirmed[o.ID] = true; changed = true; } });
  }
  raw.Operaciones.forEach(function (o) { if (!o.OP_ID || confirmed[o.OP_ID]) ops[o.ID] = o; });
  var tables = {};
  Object.keys(PERSONAL_FIELDS).forEach(function (s) {
    var latest = {};
    raw[s].forEach(function (r) {
      if ((r.USERNAME === user && confirmed[r.OP_ID]) || (s === 'Configuracion' && !r.USERNAME && !r.OP_ID)) latest[r.ID] = r;
    }); tables[s] = Object.keys(latest).map(function (id) { return pNumbers(s, latest[id]); });
  });
  var cfg = {}; tables.Configuracion.forEach(function (r) { if (!r.USERNAME) cfg[r.CLAVE] = JSON.parse(r.VALOR); });
  tables.Configuracion.forEach(function (r) { if (r.USERNAME === user) cfg[r.CLAVE] = JSON.parse(r.VALOR); });
  cfg.TIMEZONE = ss.getSpreadsheetTimeZone(); cfg.UPLOAD_ENABLED = !!PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID');
  cfg.HOY = Utilities.formatDate(new Date(), cfg.TIMEZONE, 'yyyy-MM-dd');
  return { raw: raw, tables: tables, ops: ops, confirmed: confirmed, cfg: cfg, user: user };
}
function pFind(state, sheet, id, active) {
  var r = state.tables[sheet].filter(function (r) { return r.ID === id; })[0]; pAssert(r, 'Invalid owned reference: ' + sheet, 404);
  if (active) pAssert(['Activa', 'Activo', 'Pendiente'].indexOf(r.ESTADO) >= 0, 'Inactive reference: ' + sheet); return r;
}
function pPaid(state, id) { return state.tables.Pagos.reduce(function (sum, r) { return sum + (r.CUOTA === id && r.ESTADO === 'Activo' ? pMoney(r.MONTO) : 0); }, 0); }
function pBalances(state) {
  var balances = {}; state.tables.Cuentas.forEach(function (a) { balances[a.ID] = pMoney(a.TIPO === 'Tarjeta de crédito' ? a.DEUDA_INICIAL : a.SALDO_INICIAL); });
  state.tables.Movimientos.forEach(function (m) { if (m.ESTADO === 'Activo') JSON.parse(m.ASIENTOS).forEach(function (a) { pAssert(balances[a.CUENTA] !== undefined, 'Ledger references missing account', 409); balances[a.CUENTA] += a.CENTAVOS; }); }); return balances;
}
function pBootstrap(state) {
  var balances = pBalances(state), cfg = state.cfg;
  return {
    cuentas: state.tables.Cuentas.map(function (a) {
      var card = a.TIPO === 'Tarjeta de crédito', pending = null;
      if (card && a.PAGO_TOTAL_ESTADO > 0 && a.FECHA_CORTE && a.FECHA_MAXIMA_PAGO) {
        var paid = state.tables.Movimientos.reduce(function (sum, m) {
          return sum + (m.ESTADO === 'Activo' && m.TIPO === 'Pago tarjeta' && m.DESTINO === a.ID && m.FECHA >= a.FECHA_CORTE ? pMoney(m.MONTO) : 0);
        }, 0);
        pending = Math.min(balances[a.ID], Math.max(0, pMoney(a.PAGO_TOTAL_ESTADO) - paid));
      }
      return Object.assign({}, a, {
        SALDO_ACTUAL: card ? null : balances[a.ID] / 100,
        DEUDA_ACTUAL: card ? balances[a.ID] / 100 : null,
        CREDITO_DISPONIBLE: card ? (pMoney(a.LIMITE_CREDITO) - balances[a.ID]) / 100 : null,
        SALDO_ESTADO_PENDIENTE: pending === null ? null : pending / 100,
        ESTADO_CUENTA_VENCIDO: pending > 0 && a.FECHA_MAXIMA_PAGO < cfg.HOY,
        ESTADO_CUENTA_PROXIMO: pending > 0 && a.FECHA_MAXIMA_PAGO >= cfg.HOY && a.FECHA_MAXIMA_PAGO <= pAddDays(cfg.HOY, cfg.DIAS_ALERTA)
      });
    }),
    beneficiarios: state.tables.Beneficiarios, categorias: state.tables.Categorias, recurrentes: state.tables.Obligaciones,
    obligaciones: state.tables.Cuotas.map(function (q) { var paid = pPaid(state, q.ID), pending = pMoney(q.MONTO) - paid, annulled = q.ESTADO === 'Anulado'; return Object.assign({}, q, { PAGADO: paid / 100, PENDIENTE: annulled ? 0 : pending / 100, ESTADO_ACTUAL: annulled ? 'Anulado' : pending === 0 ? 'Pagado' : paid ? 'Pago parcial' : 'Pendiente', VENCIDO: !annulled && pending > 0 && q.FECHA_VENCIMIENTO < cfg.HOY, PROXIMO: !annulled && pending > 0 && q.FECHA_VENCIMIENTO >= cfg.HOY && q.FECHA_VENCIMIENTO <= pAddDays(cfg.HOY, cfg.DIAS_ALERTA) }); }),
    movimientos: state.tables.Movimientos, transferencias: state.tables.Transferencias, pagos: state.tables.Pagos,
    operacionesPendientes: Object.keys(state.ops).map(function (id) { return state.ops[id]; }).filter(function (o) { return o.USERNAME === state.user && ['PREPARADA', 'PENDIENTE_CONCILIACION'].indexOf(o.ESTADO) >= 0; }).map(function (o) { return { ID: o.ID, REQUEST_ID: o.REQUEST_ID, ACTION: o.ACTION, ESTADO: o.ESTADO, CREATED_AT: o.CREATED_AT, ERROR: o.ERROR ? pUserMessage(o.ERROR) : '' }; }),
    configuracion: cfg, hoy: cfg.HOY
  };
}
function pReceipt(v) {
  if (v === undefined || v === '') return '';
  pAssert(typeof v === 'string' && v.length <= 300 && !/[\s#]/.test(v) && /^https:\/\/drive\.google\.com\/(?:file\/d\/[A-Za-z0-9_-]{10,}\/(?:view|preview)(?:\?[A-Za-z0-9_=%&.~+\-]*)?|open\?id=[A-Za-z0-9_-]{10,}(?:&[A-Za-z0-9_=%&.~+\-]*)?)$/.test(v), 'Invalid private Drive URL'); return v;
}
function pStage(ctx, sheet, fields, before, reason) {
  var row = {}; PERSONAL_SCHEMAS[sheet].forEach(function (k) { row[k] = fields[k] === undefined ? '' : fields[k]; });
  row.ID = before ? before.ID : fields.ID || pUuid(); row.USERNAME = ctx.state.user; row.OP_ID = ctx.id; row.UPDATED_AT = ctx.time;
  ctx.writes.push({ sheet: sheet, row: row });
  if (sheet !== 'Auditoria' && sheet !== 'Operaciones') pStage(ctx, 'Auditoria', { ENTIDAD: sheet, ENTIDAD_ID: row.ID, ANTES: JSON.stringify(before || null), DESPUES: JSON.stringify(row), MOTIVO: reason || ctx.reason || ctx.action }, null);
  if (ctx.state.tables[sheet]) {
    ctx.state.tables[sheet] = ctx.state.tables[sheet].filter(function (r) { return r.ID !== row.ID; }).concat([row]);
  }
  return row;
}
function pValidateBalances(state) {
  var b = pBalances(state);
  state.tables.Cuentas.forEach(function (a) {
    if (a.TIPO === 'Tarjeta de crédito') pAssert(b[a.ID] >= 0 && b[a.ID] <= pMoney(a.LIMITE_CREDITO), 'Credit debt outside limit', 409);
    else pAssert(state.cfg.PERMITIR_SOBREGIRO || b[a.ID] >= 0, 'Insufficient funds', 409);
  });
  state.tables.Cuotas.forEach(function (q) { pAssert(pPaid(state, q.ID) <= pMoney(q.MONTO), 'Allocation exceeds commitment', 409); });
}
function pOperation(ss, state, action, payload, execute) {
  pAssert(typeof payload.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.requestId), 'requestId must be UUID');
  var hash = pHash({ action: action, payload: payload, username: state.user });
  var old = Object.keys(state.ops).map(function (id) { return state.ops[id]; }).filter(function (o) { return o.REQUEST_ID === payload.requestId; })[0];
  if (old) {
    pAssert(old.HASH === hash && old.USERNAME === state.user, 'Request ID conflict', 409);
    pAssert(old.ESTADO === 'CONFIRMADA', 'Request reserved; manually discard and use a fresh UUID', 409);
    function decode(v) {
      if (Array.isArray(v)) return v.map(decode);
      if (v && typeof v === 'object') {
        if (v.$sheet) { var row = state.raw[v.$sheet].filter(function (r) { return r.ID === v.$id && r.OP_ID === old.ID; })[0]; pAssert(row, 'Retry result missing; inspect journal', 409); return pNumbers(v.$sheet, row); }
        var out = {}; Object.keys(v).forEach(function (k) { out[k] = decode(v[k]); }); return out;
      } return v;
    }
    return decode(JSON.parse(old.RESULTADO));
  }
  pAssert(action === 'resolveOperation' || !Object.keys(state.ops).some(function (id) {
    var o = state.ops[id]; return o.USERNAME === state.user && ['PREPARADA', 'PENDIENTE_CONCILIACION'].indexOf(o.ESTADO) >= 0;
  }), 'Resolve pending operations before submitting any fresh mutation UUID', 409);
  var timestamp = Date.now();
  Object.keys(state.raw).forEach(function (s) { state.raw[s].forEach(function (r) { var t = Date.parse(r.UPDATED_AT); if (isFinite(t)) timestamp = Math.max(timestamp, t + 1); }); });
  var ctx = { id: pUuid(), time: new Date(timestamp).toISOString(), action: action, state: state, writes: [], reason: payload.MOTIVO || '' }, result = execute(ctx);
  pValidateBalances(state);
  // Touch account versions as well, so concurrent reconciliation/edit tokens expire after ledger changes.
  var touched = {};
  ctx.writes.forEach(function (w) { if (w.sheet === 'Movimientos') JSON.parse(w.row.ASIENTOS).forEach(function (a) { touched[a.CUENTA] = true; }); });
  Object.keys(touched).forEach(function (id) {
    if (!ctx.writes.some(function (w) { return w.sheet === 'Cuentas' && w.row.ID === id; })) { var account = pFind(state, 'Cuentas', id); pStage(ctx, 'Cuentas', account, account); }
  });
  function encode(v) {
    if (Array.isArray(v)) return v.map(encode);
    if (v && typeof v === 'object') {
      var write = ctx.writes.filter(function (w) { return w.row === v; })[0];
      if (write) return { $sheet: write.sheet, $id: v.ID };
      var out = {}; Object.keys(v).forEach(function (k) { out[k] = encode(v[k]); }); return out;
    } return v;
  }
  var encodedResult = encode(result);
  var manifest = ctx.writes.map(function (w) { return { sheet: w.sheet, id: w.row.ID, hash: pHash(w.row) }; });
  pAssert(JSON.stringify(manifest).length <= 45000 && JSON.stringify(encodedResult).length <= 45000, 'Operation too large');
  var journal = { ID: ctx.id, USERNAME: state.user, REQUEST_ID: payload.requestId, HASH: hash, ACTION: action, ESTADO: 'PREPARADA', MANIFEST: JSON.stringify(manifest), RESULTADO: JSON.stringify(encodedResult), ERROR: '', CREATED_AT: ctx.time, UPDATED_AT: ctx.time, OP_ID: '' };
  try {
    pAppend(ss, 'Operaciones', journal);
    SpreadsheetApp.flush();
    pAssert(pRead(ss, 'Operaciones').filter(function (o) { return o.ID === ctx.id && pHash(o) === pHash(journal); }).length === 1, 'Preparation verification failed', 503);
    if (ctx.upload) {
      var file = ctx.upload.folder.createFile(ctx.upload.blob);
      pAssert(file.getSharingAccess() === DriveApp.Access.PRIVATE, 'Created receipt not private');
      result = { url: 'https://drive.google.com/file/d/' + file.getId() + '/view', fileId: file.getId() };
      // Upload result and audit are constructed only once a private file exists.
      var audit = ctx.writes.filter(function (w) { return w.sheet === 'Auditoria'; })[0]; audit.row.DESPUES = JSON.stringify(result);
      manifest = ctx.writes.map(function (w) { return { sheet: w.sheet, id: w.row.ID, hash: pHash(w.row) }; });
      journal.MANIFEST = JSON.stringify(manifest); journal.RESULTADO = JSON.stringify(result);
    }
    ctx.writes.forEach(function (w) { pAppend(ss, w.sheet, w.row); }); SpreadsheetApp.flush();
    var read = {}; ctx.writes.forEach(function (w, i) {
      read[w.sheet] = read[w.sheet] || pRead(ss, w.sheet);
      var matches = read[w.sheet].filter(function (r) { return r.ID === w.row.ID && r.OP_ID === ctx.id && pHash(r) === manifest[i].hash; });
      pAssert(matches.length === 1, 'Write verification failed', 503);
    });
    journal.ESTADO = 'CONFIRMADA'; journal.UPDATED_AT = pNow(); pAppend(ss, 'Operaciones', journal); SpreadsheetApp.flush();
    pAssert(pRead(ss, 'Operaciones').filter(function (o) { return o.ID === ctx.id && pHash(o) === pHash(journal); }).length === 1, 'Confirmation uncertain', 503);
    return result;
  } catch (e) {
    // A failure after the confirm append may be an uncertain response, not a failed commit.
    var visible = pRead(ss, 'Operaciones').some(function (o) { return o.ID === ctx.id && o.ESTADO === 'CONFIRMADA'; });
    if (!visible) { journal.ESTADO = 'PENDIENTE_CONCILIACION'; journal.ERROR = 'Write/Drive failure; inspect operation before discard'; journal.UPDATED_AT = pNow(); try { pAppend(ss, 'Operaciones', journal); SpreadsheetApp.flush(); } catch (ignored) {} }
    pFail('Operation uncertain; inspect/retry same request ID, never replay with a new ID before resolution', 503);
  }
}

function pSave(ctx, payload) {
  pKeys(payload, ['requestId', 'sheet', 'row']);
  var sheet = payload.sheet; pAssert(Object.prototype.hasOwnProperty.call(PERSONAL_REQUIRED, sheet), 'Unsupported save sheet'); var required = PERSONAL_REQUIRED[sheet];
  pKeys(payload.row, PERSONAL_FIELDS[sheet].split(' ').concat(['ID', 'UPDATED_AT']));
  var input = payload.row, before = input.ID ? pFind(ctx.state, sheet, input.ID) : null;
  if (before) pAssert(input.UPDATED_AT === before.UPDATED_AT, 'Stale UPDATED_AT', 409);
  else pAssert(input.UPDATED_AT === undefined, 'New row cannot supply UPDATED_AT');
  var row = Object.assign({}, before || {}, input);
  required.forEach(function (k) { pAssert(row[k] !== undefined && row[k] !== '', 'Missing ' + k); });
  var money = ['SALDO_INICIAL', 'DEUDA_INICIAL', 'LIMITE_CREDITO', 'PAGO_MINIMO', 'PAGO_TOTAL_ESTADO', 'VALOR', 'MONTO'];
  PERSONAL_FIELDS[sheet].split(' ').forEach(function (k) {
    if (money.indexOf(k) >= 0) row[k] = pMoney(row[k] === undefined || row[k] === '' ? 0 : row[k]) / 100;
    else if (['DIA', 'DIA_CORTE', 'DIA_PAGO', 'DIA_VENCIMIENTO'].indexOf(k) >= 0) row[k] = row[k] === undefined || row[k] === '' ? '' : pInt(row[k], 1, 31, k);
    else row[k] = pText(row[k], k, ['OBSERVACIONES', 'CONCEPTO'].indexOf(k) >= 0 ? 2000 : 300, true);
  });
  if (sheet === 'Cuentas') {
    pAssert(input.MONEDA === undefined || input.MONEDA === 'USD', 'Only USD supported'); row.MONEDA = 'USD';
    pAssert(['Ahorros', 'Corriente', 'Efectivo', 'Tarjeta de crédito', 'Otra'].indexOf(row.TIPO) >= 0, 'Invalid account type');
    row.ESTADO = row.ESTADO || 'Activa'; pAssert(['Activa', 'Inactiva'].indexOf(row.ESTADO) >= 0, 'Invalid account state');
    var card = row.TIPO === 'Tarjeta de crédito';
    if (card) {
      pAssert(!row.SALDO_INICIAL, 'Credit account cannot have cash opening balance');
      if (!before || before.TIPO !== row.TIPO || before.DEUDA_INICIAL !== row.DEUDA_INICIAL) pAssert(row.DEUDA_INICIAL <= row.LIMITE_CREDITO, 'Invalid initial credit debt');
      pAssert(!row.IDENTIFICADOR || /^\d{1,4}$/.test(row.IDENTIFICADOR), 'Only last four card digits');
      if (row.FECHA_CORTE) pDate(row.FECHA_CORTE);
      if (row.FECHA_MAXIMA_PAGO) pDate(row.FECHA_MAXIMA_PAGO);
      if (row.FECHA_CORTE && row.FECHA_MAXIMA_PAGO) pAssert(row.FECHA_MAXIMA_PAGO >= row.FECHA_CORTE, 'Statement due date precedes closing date');
    }
    else {
      ['DEUDA_INICIAL', 'LIMITE_CREDITO', 'DIA_CORTE', 'DIA_PAGO', 'PAGO_MINIMO', 'PAGO_TOTAL_ESTADO', 'FECHA_CORTE', 'FECHA_MAXIMA_PAGO'].forEach(function (k) { pAssert(!row[k], 'Credit-only field: ' + k); });
      pAssert(row.IDENTIFICADOR.length <= 100 && (['Ahorros', 'Corriente'].indexOf(row.TIPO) >= 0 || !row.IDENTIFICADOR), 'Invalid account identifier');
    }
    if (row.FECHA_APERTURA) pDate(row.FECHA_APERTURA);
    if (before && ctx.state.tables.Movimientos.some(function (m) { return JSON.parse(m.ASIENTOS).some(function (a) { return a.CUENTA === before.ID; }); })) {
      ['SALDO_INICIAL', 'DEUDA_INICIAL', 'TIPO'].forEach(function (k) { pAssert(row[k] === before[k], 'Opening values locked once used', 409); });
    }
  } else if (sheet === 'Beneficiarios') {
    pAssert(['Persona', 'Empresa', 'Entidad financiera'].indexOf(row.TIPO) >= 0, 'Invalid beneficiary type');
    row.ESTADO = row.ESTADO || 'Activo'; pAssert(['Activo', 'Inactivo'].indexOf(row.ESTADO) >= 0, 'Invalid beneficiary state');
    if (row.EMAIL) pAssert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.EMAIL), 'Invalid email');
    if (row.FRECUENCIA) pAssert(PERSONAL_FREQUENCIES.indexOf(row.FRECUENCIA) >= 0, 'Invalid frequency');
  } else if (sheet === 'Categorias') {
    pAssert(['Ingreso', 'Gasto'].indexOf(row.TIPO) >= 0, 'Invalid category type'); row.ESTADO = row.ESTADO || 'Activa'; pAssert(['Activa', 'Inactiva'].indexOf(row.ESTADO) >= 0, 'Invalid category state');
  } else {
    if (row.BENEFICIARIO) pFind(ctx.state, 'Beneficiarios', row.BENEFICIARIO, true);
    if (row.CATEGORIA) pAssert(pFind(ctx.state, 'Categorias', row.CATEGORIA, true).TIPO === 'Gasto', 'Expense category required');
    if (sheet === 'Obligaciones') {
      pAssert(PERSONAL_FREQUENCIES.indexOf(row.FRECUENCIA) >= 0, 'Invalid frequency'); pDate(row.INICIO);
      if (row.FIN) pAssert(pDate(row.FIN) >= row.INICIO, 'Invalid end date');
      row.ESTADO = row.ESTADO || 'Activa'; pAssert(['Activa', 'Suspendida', 'Finalizada'].indexOf(row.ESTADO) >= 0, 'Invalid definition state');
    } else {
      pDate(row.FECHA_VENCIMIENTO); row.ESTADO = row.ESTADO || 'Pendiente'; pAssert(['Pendiente', 'Anulado'].indexOf(row.ESTADO) >= 0, 'Invalid commitment state');
      ['DEFINICION', 'FECHA_PROGRAMADA', 'CLAVE_PERIODO', 'TARJETA'].forEach(function (k) { pAssert(input[k] === undefined || (before && input[k] === before[k]), 'Immutable generated field: ' + k); });
      if (before) {
        if (before.TARJETA) pAssert(row.MONTO === before.MONTO, 'Card installment amount is immutable', 409);
        pAssert(pMoney(row.MONTO) >= pPaid(ctx.state, before.ID), 'Amount below paid', 409);
        pAssert(row.ESTADO !== 'Anulado' || !pPaid(ctx.state, before.ID), 'Paid commitment must void payment first', 409);
      }
    }
  }
  var saved = pStage(ctx, sheet, row, before);
  return { row: saved, generated: sheet === 'Obligaciones' ? pGenerate(ctx, pAddDays(ctx.state.cfg.HOY, 90), saved.ID) : [] };
}
function pGenerate(ctx, until, definitionId) {
  until = until || pAddDays(ctx.state.cfg.HOY, 90); pDate(until);
  pAssert(until <= pAddDays(ctx.state.cfg.HOY, 366), 'Generation horizon exceeds 366 days');
  var definitions = definitionId ? [pFind(ctx.state, 'Obligaciones', definitionId)] : ctx.state.tables.Obligaciones;
  var keys = {}; ctx.state.tables.Cuotas.forEach(function (q) { if (q.CLAVE_PERIODO) keys[q.CLAVE_PERIODO] = true; });
  var generated = [];
  definitions.forEach(function (d) {
    if (d.ESTADO !== 'Activa') return;
    var single = d.FRECUENCIA === 'Pago único', lower = single ? d.INICIO : (d.INICIO > ctx.state.cfg.HOY ? d.INICIO : ctx.state.cfg.HOY);
    if (lower > until || (d.FIN && d.FIN < lower)) return;
    if (d.BENEFICIARIO) pFind(ctx.state, 'Beneficiarios', d.BENEFICIARIO, true);
    if (d.CATEGORIA) pAssert(pFind(ctx.state, 'Categorias', d.CATEGORIA, true).TIPO === 'Gasto', 'Expense category required');
    var interval = { Mensual: 1, Trimestral: 3, Semestral: 6, Anual: 12 }[d.FRECUENCIA];
    var step = d.FRECUENCIA === 'Semanal' ? 7 : 15;
    var n = 0, planned;
    // Jump to the current window without losing the original month/day or day-interval anchor.
    if (!single) {
      if (interval) {
        var monthSpan = (Number(lower.slice(0, 4)) - Number(d.INICIO.slice(0, 4))) * 12 + Number(lower.slice(5, 7)) - Number(d.INICIO.slice(5, 7));
        n = Math.max(0, Math.floor(monthSpan / interval));
      } else n = Math.max(0, Math.ceil((Date.parse(lower + 'T00:00:00Z') - Date.parse(d.INICIO + 'T00:00:00Z')) / (86400000 * step)));
    }
    while (true) {
      planned = interval ? pMonth(d.INICIO, n * interval, d.DIA || Number(d.INICIO.slice(8))) : pAddDays(d.INICIO, single ? 0 : n * step);
      if (planned > until || (d.FIN && planned > d.FIN)) break;
      if (planned >= lower) {
        var key = d.ID + ':' + planned;
        if (!keys[key]) {
          pAssert(generated.length < 100, 'Generation exceeds 100 new occurrences');
          generated.push(pStage(ctx, 'Cuotas', { TITULO: d.TITULO, MONTO: d.MONTO, FECHA_VENCIMIENTO: planned, DEFINICION: d.ID, FECHA_PROGRAMADA: planned, CLAVE_PERIODO: key, BENEFICIARIO: d.BENEFICIARIO, CATEGORIA: d.CATEGORIA, TARJETA: '', ESTADO: 'Pendiente', OBSERVACIONES: d.OBSERVACIONES }, null)); keys[key] = true;
        }
      }
      n++; if (single) break;
    }
  }); return generated;
}
function pMovement(ctx, fields) {
  return pStage(ctx, 'Movimientos', Object.assign({ ESTADO: 'Activo', DESTINO: '', BENEFICIARIO: '', CATEGORIA: '', COMPROBANTE_URL: '', REFERENCIA: '', MOTIVO: '', OBSERVADO: '', DIFERENCIA: '' }, fields), null);
}
function pMethod(state, value, fallback) { value = value || fallback; pAssert(state.cfg.METODOS.indexOf(value) >= 0, 'Invalid payment method'); return value; }
function pCash(account) { pAssert(account.TIPO !== 'Tarjeta de crédito', 'Cash/bank account required'); }
function pCard(account) { pAssert(account.TIPO === 'Tarjeta de crédito', 'Credit card required'); }
function pAllocation(ctx, q, movement, cents, payload) {
  pAssert(cents > 0 && cents <= pMoney(q.MONTO) - pPaid(ctx.state, q.ID), 'Payment exceeds pending amount');
  return pStage(ctx, 'Pagos', { CUOTA: q.ID, MOVIMIENTO: movement.ID, MONTO: cents / 100, FECHA: movement.FECHA, REFERENCIA: payload.REFERENCIA || '', FACTURA: payload.FACTURA || '', DOCUMENTO: payload.DOCUMENTO || '', ESTADO: 'Activo' }, null);
}
function pCardPayment(ctx, source, target, cents, base, allocationPayload, onlyQuota) {
  pCash(source); pCard(target); pAssert(cents <= pBalances(ctx.state)[target.ID], 'Payment exceeds card debt');
  var movement = pMovement(ctx, Object.assign({}, base, { TIPO: 'Pago tarjeta', MONTO: cents / 100, CUENTA: source.ID, DESTINO: target.ID, ASIENTOS: JSON.stringify([{ CUENTA: source.ID, CENTAVOS: -cents }, { CUENTA: target.ID, CENTAVOS: -cents }]) }));
  var candidates = ctx.state.tables.Cuotas.filter(function (q) { return q.TARJETA === target.ID && q.ESTADO === 'Pendiente' && (!onlyQuota || q.ID === onlyQuota); }).sort(function (a, b) { return a.FECHA_VENCIMIENTO.localeCompare(b.FECHA_VENCIMIENTO) || a.FECHA_PROGRAMADA.localeCompare(b.FECHA_PROGRAMADA) || a.ID.localeCompare(b.ID); });
  var remaining = cents, payments = [];
  candidates.forEach(function (q) { var amount = Math.min(remaining, pMoney(q.MONTO) - pPaid(ctx.state, q.ID)); if (amount > 0) { payments.push(pAllocation(ctx, q, movement, amount, allocationPayload)); remaining -= amount; } });
  return { movimientos: [movement], pagos: payments };
}
function pTransaction(ctx, payload) {
  pKeys(payload, ['requestId', 'type', 'FECHA', 'DESCRIPCION', 'MONTO', 'CUENTA', 'DESTINO', 'CATEGORIA', 'BENEFICIARIO', 'METODO', 'COMISION', 'CUOTAS', 'PRIMER_VENCIMIENTO', 'COMPROBANTE_URL', 'REFERENCIA']);
  var type = payload.type; pAssert(['income', 'egress', 'transfer', 'cardpurchase', 'cardpayment'].indexOf(type) >= 0, 'Invalid transaction type');
  var cents = pMoney(payload.MONTO); pAssert(cents > 0, 'Amount must be positive');
  var account = pFind(ctx.state, 'Cuentas', payload.CUENTA, true), target;
  var base = { FECHA: pExecutedDate(payload.FECHA, ctx.state.cfg.HOY), DESCRIPCION: pText(payload.DESCRIPCION, 'description'), COMPROBANTE_URL: pReceipt(payload.COMPROBANTE_URL), REFERENCIA: pText(payload.REFERENCIA, 'reference', 300, true), METODO: pMethod(ctx.state, payload.METODO, type === 'cardpurchase' ? 'Tarjeta de crédito' : 'Transferencia bancaria') };
  if (payload.BENEFICIARIO) { pFind(ctx.state, 'Beneficiarios', payload.BENEFICIARIO, true); base.BENEFICIARIO = payload.BENEFICIARIO; }
  if (type === 'transfer' || type === 'cardpayment') { target = pFind(ctx.state, 'Cuentas', payload.DESTINO, true); pAssert(account.ID !== target.ID, 'Identical accounts'); }
  else pAssert(payload.DESTINO === undefined, 'Unexpected destination');
  if (type !== 'transfer') pAssert(payload.COMISION === undefined, 'Commission only on transfers');
  if (type !== 'cardpurchase') pAssert(payload.CUOTAS === undefined && payload.PRIMER_VENCIMIENTO === undefined, 'Installments only on card purchase');
  var fee = type === 'transfer' && payload.COMISION !== undefined ? pMoney(payload.COMISION) : 0;
  if (['income', 'egress', 'cardpurchase'].indexOf(type) >= 0 || fee) {
    var category = pFind(ctx.state, 'Categorias', payload.CATEGORIA, true); pAssert(category.TIPO === (type === 'income' ? 'Ingreso' : 'Gasto'), 'Category classification mismatch'); base.CATEGORIA = category.ID;
  } else pAssert(payload.CATEGORIA === undefined, 'Unexpected category');
  if (type === 'cardpayment') return pCardPayment(ctx, account, target, cents, base, payload);
  var result = { movimientos: [] }, movement;
  if (type === 'transfer') {
    pCash(account); pCash(target);
    movement = pMovement(ctx, Object.assign({}, base, { CATEGORIA: '', TIPO: 'Transferencia', MONTO: cents / 100, CUENTA: account.ID, DESTINO: target.ID, ASIENTOS: JSON.stringify([{ CUENTA: account.ID, CENTAVOS: -cents }, { CUENTA: target.ID, CENTAVOS: cents }]) }));
    result.movimientos.push(movement);
    if (fee) result.movimientos.push(pMovement(ctx, Object.assign({}, base, { TIPO: 'Gasto', DESCRIPCION: base.DESCRIPCION + ' (comision)', MONTO: fee / 100, CUENTA: account.ID, ASIENTOS: JSON.stringify([{ CUENTA: account.ID, CENTAVOS: -fee }]) })));
    result.transferencia = pStage(ctx, 'Transferencias', { MOVIMIENTO: movement.ID, ORIGEN: account.ID, DESTINO: target.ID, MONTO: cents / 100, COMISION: fee / 100, ESTADO: 'Activo' }, null);
  } else {
    if (type === 'cardpurchase') pCard(account); else pCash(account);
    movement = pMovement(ctx, Object.assign({}, base, { TIPO: type === 'income' ? 'Ingreso' : type === 'egress' ? 'Gasto' : 'Compra tarjeta', MONTO: cents / 100, CUENTA: account.ID, ASIENTOS: JSON.stringify([{ CUENTA: account.ID, CENTAVOS: type === 'egress' ? -cents : cents }]) })); result.movimientos.push(movement);
    if (type === 'cardpurchase' && payload.CUOTAS !== undefined) {
      var count = pInt(payload.CUOTAS, 1, 120, 'installment count'), first = pDate(payload.PRIMER_VENCIMIENTO || payload.FECHA);
      pAssert(first >= payload.FECHA && cents >= count, 'Invalid installment schedule'); result.cuotas = [];
      for (var i = 0; i < count; i++) {
        var due = pMonth(first, i), portion = Math.floor(cents / count) + (i < cents % count ? 1 : 0);
        result.cuotas.push(pStage(ctx, 'Cuotas', { TITULO: base.DESCRIPCION + ' ' + (i + 1) + '/' + count, MONTO: portion / 100, FECHA_VENCIMIENTO: due, FECHA_PROGRAMADA: due, CLAVE_PERIODO: movement.ID + ':' + i, TARJETA: account.ID, BENEFICIARIO: base.BENEFICIARIO || '', CATEGORIA: base.CATEGORIA, ESTADO: 'Pendiente' }, null));
      }
    } else pAssert(payload.PRIMER_VENCIMIENTO === undefined, 'Installment count required');
  } return result;
}
function pPay(ctx, payload) {
  pKeys(payload, ['requestId', 'cuotaId', 'CUENTA', 'MONTO', 'FECHA', 'DESCRIPCION', 'METODO', 'COMPROBANTE_URL', 'REFERENCIA', 'FACTURA', 'DOCUMENTO']);
  var q = pFind(ctx.state, 'Cuotas', payload.cuotaId, true), source = pFind(ctx.state, 'Cuentas', payload.CUENTA, true), cents = pMoney(payload.MONTO);
  pAssert(cents > 0 && cents <= pMoney(q.MONTO) - pPaid(ctx.state, q.ID), 'Payment exceeds pending amount');
  ['REFERENCIA', 'FACTURA', 'DOCUMENTO'].forEach(function (k) { pText(payload[k], k, 300, true); });
  var base = { FECHA: pExecutedDate(payload.FECHA, ctx.state.cfg.HOY), DESCRIPCION: pText(payload.DESCRIPCION, 'description'), METODO: pMethod(ctx.state, payload.METODO, source.TIPO === 'Tarjeta de crédito' ? 'Tarjeta de crédito' : 'Transferencia bancaria'), COMPROBANTE_URL: pReceipt(payload.COMPROBANTE_URL), REFERENCIA: payload.REFERENCIA || '' };
  if (q.TARJETA) return pCardPayment(ctx, source, pFind(ctx.state, 'Cuentas', q.TARJETA, true), cents, base, payload, q.ID);
  if (q.CATEGORIA) pAssert(pFind(ctx.state, 'Categorias', q.CATEGORIA, true).TIPO === 'Gasto', 'Expense category required');
  if (q.BENEFICIARIO) pFind(ctx.state, 'Beneficiarios', q.BENEFICIARIO, true);
  var movement = pMovement(ctx, Object.assign({}, base, { TIPO: source.TIPO === 'Tarjeta de crédito' ? 'Compra tarjeta' : 'Gasto', MONTO: cents / 100, CUENTA: source.ID, CATEGORIA: q.CATEGORIA, BENEFICIARIO: q.BENEFICIARIO, ASIENTOS: JSON.stringify([{ CUENTA: source.ID, CENTAVOS: source.TIPO === 'Tarjeta de crédito' ? cents : -cents }]) }));
  return { movimientos: [movement], pagos: [pAllocation(ctx, q, movement, cents, payload)] };
}
function pVoid(ctx, payload) {
  pKeys(payload, ['requestId', 'operationId', 'cuotaId', 'UPDATED_AT', 'MOTIVO']); ctx.reason = pText(payload.MOTIVO, 'reason', 2000);
  pAssert(!!payload.operationId !== !!payload.cuotaId, 'Exactly one void target'); var targets = [];
  if (payload.cuotaId) {
    var q = pFind(ctx.state, 'Cuotas', payload.cuotaId, true); pAssert(payload.UPDATED_AT === q.UPDATED_AT, 'Stale UPDATED_AT', 409);
    pAssert(!pPaid(ctx.state, q.ID), 'Commitment has active payments', 409); targets.push({ sheet: 'Cuotas', row: q });
  } else {
    pAssert(payload.UPDATED_AT === undefined, 'Operation void does not accept UPDATED_AT');
    var operation = ctx.state.ops[payload.operationId]; pAssert(operation && operation.USERNAME === ctx.state.user && operation.ESTADO === 'CONFIRMADA', 'Invalid confirmed operation');
    // Later edits retain entity IDs; use original manifest IDs, not current version OP_ID.
    var manifest = JSON.parse(operation.MANIFEST);
    ['Movimientos', 'Pagos', 'Cuotas', 'Transferencias'].forEach(function (s) {
      ctx.state.tables[s].forEach(function (r) { if (r.ESTADO !== 'Anulado' && manifest.some(function (m) { return m.sheet === s && m.id === r.ID; })) targets.push({ sheet: s, row: r }); });
    });
    pAssert(targets.length, 'Operation has no active financial entities', 409);
    var movementIds = targets.filter(function (t) { return t.sheet === 'Movimientos'; }).map(function (t) { return t.row.ID; }), quotaIds = targets.filter(function (t) { return t.sheet === 'Cuotas'; }).map(function (t) { return t.row.ID; });
    ctx.state.tables.Pagos.forEach(function (p) {
      if (p.ESTADO === 'Activo' && (movementIds.indexOf(p.MOVIMIENTO) >= 0 || quotaIds.indexOf(p.CUOTA) >= 0)) pAssert(targets.some(function (t) { return t.sheet === 'Pagos' && t.row.ID === p.ID; }), 'Operation has active dependent payments', 409);
    });
  }
  targets.forEach(function (t) { pStage(ctx, t.sheet, Object.assign({}, t.row, { ESTADO: 'Anulado' }), t.row, ctx.reason); });
  return { anulados: targets.map(function (t) { return t.row.ID; }) };
}
function pReconcile(ctx, payload) {
  pKeys(payload, ['requestId', 'CUENTA', 'OBSERVADO', 'FECHA', 'MOTIVO', 'UPDATED_AT']);
  var account = pFind(ctx.state, 'Cuentas', payload.CUENTA, true); pAssert(payload.UPDATED_AT === account.UPDATED_AT, 'Stale UPDATED_AT', 409);
  var reason = pText(payload.MOTIVO, 'reason', 2000), observed = pMoney(payload.OBSERVADO, true); if (account.TIPO === 'Tarjeta de crédito') pAssert(observed >= 0, 'Negative observed debt');
  var delta = observed - pBalances(ctx.state)[account.ID]; pAssert(Math.abs(delta) <= 1e11, 'Adjustment too large');
  ctx.reason = reason;
  return { movimientos: [pMovement(ctx, { FECHA: pExecutedDate(payload.FECHA, ctx.state.cfg.HOY), TIPO: 'Ajuste', DESCRIPCION: reason, MONTO: Math.abs(delta) / 100, CUENTA: account.ID, METODO: '', MOTIVO: reason, OBSERVADO: observed / 100, DIFERENCIA: delta / 100, ASIENTOS: JSON.stringify([{ CUENTA: account.ID, CENTAVOS: delta }]) })] };
}
function pConfigure(ctx, payload) {
  pKeys(payload, ['requestId', 'preferences']); pKeys(payload.preferences, ['MONEDA', 'DIAS_ALERTA', 'PERMITIR_SOBREGIRO', 'CANAL_EMAIL']);
  var prefs = payload.preferences; pAssert(Object.keys(prefs).length, 'Empty preferences');
  if (prefs.MONEDA !== undefined) pAssert(prefs.MONEDA === 'USD', 'Only USD supported');
  if (prefs.DIAS_ALERTA !== undefined) pInt(prefs.DIAS_ALERTA, 0, 90, 'alert days');
  if (prefs.PERMITIR_SOBREGIRO !== undefined) pAssert(typeof prefs.PERMITIR_SOBREGIRO === 'boolean', 'Invalid overdraft preference');
  if (prefs.CANAL_EMAIL !== undefined) pText(prefs.CANAL_EMAIL, 'future email channel', 300, true);
  Object.keys(prefs).forEach(function (k) {
    var before = ctx.state.tables.Configuracion.filter(function (r) { return r.USERNAME === ctx.state.user && r.CLAVE === k; })[0];
    pStage(ctx, 'Configuracion', { CLAVE: k, VALOR: JSON.stringify(prefs[k]) }, before); ctx.state.cfg[k] = prefs[k];
  }); return prefs;
}
function pUpload(ctx, payload) {
  pKeys(payload, ['requestId', 'filename', 'mimeType', 'base64']);
  var folderId = PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID'); pAssert(folderId, 'Private Drive upload not configured', 503);
  var filename = pText(payload.filename, 'filename', 120); pAssert(!/[\\/]/.test(filename) && !filename.startsWith('.'), 'Invalid filename');
  var types = { 'image/jpeg': /\.jpe?g$/i, 'image/png': /\.png$/i, 'application/pdf': /\.pdf$/i };
  pAssert(types[payload.mimeType] && types[payload.mimeType].test(filename), 'Unsupported file type');
  var encoded = payload.base64;
  pAssert(typeof encoded === 'string' && encoded.length > 0 && encoded.length <= 4194304 && encoded.length % 4 === 0, 'Invalid base64 or size');
  var padding = encoded.charAt(encoded.length - 1) === '=' ? (encoded.charAt(encoded.length - 2) === '=' ? 2 : 1) : 0;
  var dataLength = encoded.length - padding;
  // A linear scan avoids V8 stack exhaustion on multi-megabyte repeated regex groups.
  for (var i = 0; i < encoded.length; i++) {
    var c = encoded.charCodeAt(i);
    pAssert(i < dataLength ? ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47) : c === 61, 'Invalid base64 or size');
  }
  pAssert(encoded.length / 4 * 3 - padding <= 3 * 1024 * 1024, 'Receipt exceeds 3 MiB');
  var bytes = Utilities.base64Decode(encoded);
  pAssert(bytes.length > 0 && bytes.length <= 3 * 1024 * 1024, 'Receipt exceeds 3 MiB');
  pAssert(Utilities.base64Encode(bytes) === encoded, 'Invalid base64 or size');
  var magic = payload.mimeType === 'image/jpeg' ? [255, 216, 255] : payload.mimeType === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10] : [37, 80, 68, 70, 45];
  pAssert(magic.every(function (b, i) { return (bytes[i] + 256) % 256 === b; }), 'File magic does not match MIME');
  var folder = DriveApp.getFolderById(folderId); pAssert(folder.getSharingAccess() === DriveApp.Access.PRIVATE, 'Receipt folder must be private');
  ctx.upload = { folder: folder, blob: Utilities.newBlob(bytes, payload.mimeType, filename) };
  pStage(ctx, 'Auditoria', { ENTIDAD: 'Drive', ENTIDAD_ID: ctx.id, ANTES: 'null', DESPUES: '{}', MOTIVO: 'Private receipt upload: ' + filename }, null); return { url: '', fileId: '' };
}
function pResolve(ctx, payload) {
  pKeys(payload, ['requestId', 'operationId', 'MOTIVO']); var reason = pText(payload.MOTIVO, 'reason', 2000), old = ctx.state.ops[payload.operationId];
  pAssert(old && old.USERNAME === ctx.state.user && ['PREPARADA', 'PENDIENTE_CONCILIACION'].indexOf(old.ESTADO) >= 0, 'Only an owned pending operation can be discarded', 409);
  var marker = Object.assign({}, old, { ESTADO: 'DESCARTADA', ERROR: reason, OP_ID: ctx.id, UPDATED_AT: ctx.time });
  ctx.writes.push({ sheet: 'Operaciones', row: marker });
  pStage(ctx, 'Auditoria', { ENTIDAD: 'Operaciones', ENTIDAD_ID: old.ID, ANTES: JSON.stringify(old), DESPUES: JSON.stringify(marker), MOTIVO: reason }, null);
  return { discarded: old.ID };
}
function pDispatch(ss, state, action, payload) {
  if (action === 'bootstrap') { pKeys(payload, []); return pBootstrap(state); }
  if (action === 'backup') {
    pKeys(payload, []); var tables = {};
    Object.keys(state.raw).forEach(function (s) { tables[s] = state.raw[s].filter(function (r) { return r.USERNAME === state.user || (s === 'Configuracion' && !r.USERNAME && !r.OP_ID); }); });
    return { schemaVersion: 1, generatedAt: pNow(), schemas: PERSONAL_SCHEMAS, tables: tables };
  }
  var handlers = { save: pSave, transaction: pTransaction, pay: pPay, void: pVoid, reconcile: pReconcile, configure: pConfigure, upload: pUpload, resolveOperation: pResolve,
    generate: function (ctx, p) { pKeys(p, ['requestId', 'until', 'definitionId']); return { generated: pGenerate(ctx, p.until, p.definitionId) }; }
  };
  pAssert(Object.prototype.hasOwnProperty.call(handlers, action), 'Unknown action', 404); return pOperation(ss, state, action, payload, function (ctx) { return handlers[action](ctx, payload); });
}
function pJson(data) { return ContentService.createTextOutput(JSON.stringify(Object.assign({}, data, { service: 'personal-finance', spreadsheetId: PERSONAL_SPREADSHEET_ID }))).setMimeType(ContentService.MimeType.JSON); }
function doGet() {
  try {
    return pLock(function () {
      var ss = pSpreadsheet(), inspection = pInspect(ss);
      var initialized = inspection.compatible && inspection.targets.every(function (t) { return t.exists !== false && t.headers.length > 0 && t.missing.length === 0; });
      if (initialized) {
        var preferences = pRead(ss, 'Configuracion');
        initialized = ['MONEDA', 'TIMEZONE', 'DIAS_ALERTA', 'PERMITIR_SOBREGIRO', 'METODOS', 'CANAL_EMAIL'].every(function (key) {
          return preferences.some(function (r) { return r.CLAVE === key && !r.USERNAME && !r.OP_ID; });
        });
      }
      return pJson({ success: true, data: { connected: true, initialized: initialized } });
    });
  } catch (error) { return pJson({ success: false, status: error.status || 500, message: pUserMessage(error.status ? error.message : 'Internal failure; inspect operation journal') }); }
}
function doPost(e) {
  try {
    pAssert(e && e.postData && typeof e.postData.contents === 'string' && e.postData.contents.length <= 4300000, 'Invalid request');
    var request; try { request = JSON.parse(e.postData.contents); } catch (badJson) { pFail('Invalid JSON'); }
    pKeys(request, ['action', 'payload', 'user']);
    pAssert(request.user && request.user.role === 'personal', 'Personal identity required');
    pKeys(request.user, ['username', 'name', 'role']);
    var username = pText(request.user.username, 'username', 100); pText(request.user.name, 'name', 200);
    pAssert(username === request.user.username, 'Invalid username');
    pAssert(typeof request.action === 'string', 'Invalid action'); pKeys(request.payload, Object.keys(request.payload || {}));
    return pLock(function () { var ss = pSpreadsheet(); return pJson({ success: true, data: pDispatch(ss, pState(ss, username), request.action, request.payload) }); });
  } catch (error) { return pJson({ success: false, status: error.status || 500, message: pUserMessage(error.status ? error.message : 'Internal failure; inspect operation journal') }); }
}
