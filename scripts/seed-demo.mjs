import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

// Explicitly authorized fictional fixtures. Never include existing financial rows in the public workbook.
const origin = process.env.DEMO_ORIGIN || 'https://cuentas-jefes.vercel.app';
const date = '2026-10-08';
const batch = 'DEMO-10-POR-JEFE-20261008';
const plan = [
  ['Gasto', 'Alimentación', 25, 'Pagado', 'Efectivo', 'Alimentacion de prueba'],
  ['Gasto', 'Transporte', 15, 'Pagado', 'Transferencia', 'Transporte de prueba'],
  ['Gasto', 'Combustible', 40, 'Pagado', 'Tarjeta de débito', 'Combustible de prueba'],
  ['Compra', 'Oficina', 60, 'Pendiente', 'Transferencia', 'Compra de oficina de prueba'],
  ['Compra', 'Tecnología', 90, 'Pago parcial', 'Tarjeta de crédito', 'Compra tecnologica de prueba', 30],
  ['Gasto', 'Servicios', 35, 'Pendiente', 'Transferencia', 'Servicio de prueba'],
  ['Pago', 'Otros', 20, 'Pagado', 'Depósito', 'Pago independiente de prueba'],
  ['Pago', 'Oficina', 20, 'Pagado', 'Transferencia', 'Abono de prueba a la compra de oficina', undefined, 3],
  ['Gasto', 'Salud', 12, 'Pagado', 'Efectivo', 'Gasto de salud de prueba'],
  ['Gasto', 'Otros', 18, 'Pendiente', 'Otro', 'Otro gasto de prueba'],
];

function keyFor(jefe, index) {
  const hex = createHash('sha256').update(`${origin}|${batch}|${jefe}|${index}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function reference(rows, name) {
  const matches = rows.filter(row => row.NOMBRE === name && row.ESTADO === 'Activo');
  assert.equal(matches.length, 1, `Catalogo activo no encontrado o duplicado: ${name}`);
  return String(matches[0].ID);
}
function simulatedDate(index) {
  const value = new Date(date + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() - 9 + index);
  return value.toISOString().slice(0, 10);
}

let cookie = '';
let authenticatedUser;
async function request(action, body) {
  const direct = process.env.DEMO_GAS_WEB_APP_URL && !['login', 'logout'].includes(action);
  if (direct) assert.ok(process.env.GAS_API_SECRET && authenticatedUser, 'La conexion directa requiere secreto privado e identidad autenticada');
  const response = await fetch(direct ? process.env.DEMO_GAS_WEB_APP_URL : `${origin}/api/index?action=${action}`, {
    method: direct || body !== undefined ? 'POST' : 'GET',
    headers: direct ? { 'Content-Type': 'application/json' } : { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }), ...(cookie ? { Cookie: cookie } : {}) },
    body: direct ? JSON.stringify({ secret: process.env.GAS_API_SECRET, action, payload: body || {}, user: authenticatedUser }) : body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
    cache: 'no-store',
  });
  let result;
  try { result = await response.json(); }
  catch { const error = new Error('Respuesta temporal no JSON'); error.status = 502; throw error; }
  if (!response.ok || !result.success) {
    const error = new Error(result.message || `HTTP ${response.status}`);
    error.status = result.status || response.status;
    throw error;
  }
  if (action === 'login') {
    cookie = response.headers.get('set-cookie')?.split(';')[0] || '';
    assert.ok(cookie, 'No se recibio sesion');
    authenticatedUser = result.data.user;
  }
  return result.data;
}
async function create(movement) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await request('create', { movement }); }
    catch (error) {
      if ((error.status && error.status < 500) || attempt === 2) throw error;
      // Exact same UUID and payload on retry; Apps Script performs idempotent creation.
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
}

function writeWorkbook(rows, catalogs) {
  const names = (list, id) => list.find(row => String(row.ID) === String(id))?.NOMBRE || '';
  const live = rows.filter(row => row.ESTADO !== 'Anulado');
  const paid = row => row.PAGADO + live.filter(item => item.MOVIMIENTO_ORIGEN_ID === row.ID).reduce((sum, item) => sum + item.TOTAL, 0);
  const book = XLSX.utils.book_new();
  const summary = [['DATOS FICTICIOS DE DEMOSTRACION'], ['Lote', batch],
    ['No contiene movimientos reales. Los pagos vinculados no son inversion adicional.'], [],
    ['Responsable', 'Registros', 'Total invertido', 'Egresos efectivos', 'Pendiente actual']];
  for (const jefe of catalogs.jefes.filter(row => ['Franco Becerra', 'Josselyn Becerra'].includes(row.NOMBRE))) {
    const selected = rows.filter(row => row.JEFE === String(jefe.ID));
    assert.equal(selected.length, 10);
    const independent = selected.filter(row => ['Gasto', 'Compra', 'Pago'].includes(row.TIPO) && !row.MOVIMIENTO_ORIGEN_ID && row.ESTADO !== 'Anulado');
    summary.push([jefe.NOMBRE, selected.length, independent.reduce((sum, row) => sum + row.TOTAL, 0),
      selected.filter(row => row.ESTADO !== 'Anulado').reduce((sum, row) => sum + row.PAGADO, 0),
      independent.reduce((sum, row) => sum + Math.max(0, row.TOTAL - paid(row)), 0)]);
    const sheet = XLSX.utils.aoa_to_sheet([
      ['DATOS FICTICIOS DE DEMOSTRACION'], ['Responsable', jefe.NOMBRE], ['Lote', batch], [],
      ['ID', 'Fecha', 'Hora', 'Responsable', 'Tipo', 'Categoria', 'Descripcion', 'Cantidad', 'Precio unitario', 'Total', 'Pagado actual', 'Pendiente', 'Estado registrado', 'Origen del pago', 'Observaciones'],
      ...selected.sort((a, b) => a.FECHA.localeCompare(b.FECHA)).map(row => [row.ID, new Date(row.FECHA + 'T12:00:00'), row.HORA, jefe.NOMBRE, row.TIPO,
        names(catalogs.categorias, row.CATEGORIA), row.DESCRIPCION, row.CANTIDAD, row.VALOR_UNITARIO, row.TOTAL, paid(row),
        row.MOVIMIENTO_ORIGEN_ID ? 0 : Math.max(0, row.TOTAL - paid(row)), row.ESTADO, row.MOVIMIENTO_ORIGEN_ID || '', row.OBSERVACIONES]),
    ], { cellDates: true });
    for (let r = 5; r < 15; r++) {
      sheet[XLSX.utils.encode_cell({ r, c: 1 })].z = 'dd/mm/yyyy';
      for (const c of [8, 9, 10, 11]) sheet[XLSX.utils.encode_cell({ r, c })].z = '"$"#,##0.00';
    }
    sheet['!cols'] = [38, 14, 10, 24, 16, 20, 68, 12, 18, 16, 18, 16, 18, 38, 100].map(wch => ({ wch }));
    sheet['!autofilter'] = { ref: 'A5:O15' };
    XLSX.utils.book_append_sheet(book, sheet, jefe.NOMBRE);
  }
  const totals = XLSX.utils.aoa_to_sheet(summary);
  totals['!cols'] = [{ wch: 30 }, { wch: 36 }, { wch: 24 }, { wch: 24 }, { wch: 24 }];
  for (let r = 5; r < 7; r++) for (const c of [2, 3, 4]) totals[XLSX.utils.encode_cell({ r, c })].z = '"$"#,##0.00';
  XLSX.utils.book_append_sheet(book, totals, 'Resumen de demostracion');
  const output = fileURLToPath(new URL('../public/movimientos-demo.xlsx', import.meta.url));
  writeFileSync(output, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
  console.log('Excel generado con los 20 movimientos ficticios, sin datos financieros reales.');
}

async function main() {
  assert.ok(process.env.APP_USERNAME && process.env.APP_PASSWORD, 'Defina las credenciales en variables privadas del proceso');
  await request('login', { username: process.env.APP_USERNAME, password: process.env.APP_PASSWORD });
  try {
    const catalogs = await request('bootstrap');
    const before = await request('movements');
    const selectedJefes = ['Franco Becerra', 'Josselyn Becerra'].map(name => ({ ID: reference(catalogs.jefes, name), NOMBRE: name }));
    for (const [, category, , state, method] of plan) {
      reference(catalogs.categorias, category);
      reference(catalogs.formasPago, method);
      reference(catalogs.estados, state);
    }
    const batchKeys = new Set(selectedJefes.flatMap(jefe => plan.map((_, index) => keyFor(jefe.ID, index))));
    const originals = before.filter(row => !batchKeys.has(row.CLAVE_IDEMPOTENCIA));
    if (!process.argv.includes('--export-only')) for (const jefe of selectedJefes) {
      const records = [];
      for (let index = 0; index < plan.length; index++) {
        const [tipo, category, total, state, method, description, partial, originIndex] = plan[index];
        const movement = {
          FECHA: simulatedDate(index), HORA: '12:00', JEFE: jefe.ID, TIPO: tipo,
          CATEGORIA: reference(catalogs.categorias, category), FORMA_PAGO: reference(catalogs.formasPago, method),
          DESCRIPCION: `[DEMO] ${description} - ${jefe.NOMBRE}`, CANTIDAD: 1, VALOR_UNITARIO: total,
          TOTAL: total, TOTAL_MANUAL: false, ESTADO: state, PAGADO: state === 'Pendiente' ? 0 : partial ?? total,
          COMPROBANTE_URL: '', PROVEEDOR: '', NUMERO_FACTURA: '',
          OBSERVACIONES: `DATOS FICTICIOS PARA PRUEBAS. No es una operacion real. LOTE: ${batch}. REGISTRO: ${jefe.ID}/${index + 1}.`,
          CLAVE_IDEMPOTENCIA: keyFor(jefe.ID, index),
          ...(originIndex === undefined ? {} : { MOVIMIENTO_ORIGEN_ID: records[originIndex].ID }),
        };
        const record = await create(movement);
        assert.equal(record.ESTADO !== 'Anulado', true, 'El lote ya fue anulado. No se recrean filas automaticamente.');
        records.push(record);
        console.log(`${jefe.NOMBRE}: demostracion ${index + 1}/10 confirmada`);
      }
    }
    const after = await request('movements');
    for (const original of originals) {
      const stored = after.find(row => row.ID === original.ID);
      assert.ok(stored, 'Falta un registro previo; revise el historial');
      assert.equal(stored.UPDATED_AT, original.UPDATED_AT, 'Un registro previo cambio durante la carga; este script no lo edita');
    }
    const demo = after.filter(row => batchKeys.has(row.CLAVE_IDEMPOTENCIA));
    assert.equal(demo.length, 20);
    assert.ok(demo.every(row => row.DESCRIPCION.startsWith('[DEMO]') && !row.CUENTA && !row.COMPROBANTE_URL && row.OBSERVACIONES.includes(batch)));
    writeWorkbook(demo, catalogs);
    console.log(JSON.stringify({ lote: batch, ficticios: demo.length, originalesConservados: originals.length,
      porJefe: selectedJefes.map(jefe => ({ nombre: jefe.NOMBRE, ficticios: demo.filter(row => row.JEFE === jefe.ID).length })) }, null, 2));
  } finally {
    await request('logout', {});
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
