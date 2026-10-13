import { test as base, expect, type Page } from '@playwright/test';
import type { PersonalBootstrap, Row, Account, Movement, Quota, Payment } from '../src/personal/types';
import type { User } from '../src/types';
export const personalUser: User = { username: 'personal-browser-test', name: 'Personal test only', role: 'personal' };
export const personalPassword = 'personal-test-only-password';
export function personalBootstrap(): PersonalBootstrap {
  return { cuentas: [], beneficiarios: [], categorias: [], recurrentes: [], obligaciones: [], movimientos: [], transferencias: [], pagos: [], operacionesPendientes: [], hoy: '2026-10-12', configuracion: { MONEDA: 'USD', TIMEZONE: 'America/Guayaquil', DIAS_ALERTA: 7, PERMITIR_SOBREGIRO: false, METODOS: ['Efectivo', 'Transferencia bancaria', 'Tarjeta de cr\u00e9dito', 'Cheque'], CANAL_EMAIL: '', UPLOAD_ENABLED: false, HOY: '2026-10-12' } };
}
const fields: Record<string, string[]> = {
  Cuentas: 'NOMBRE TIPO BANCO TITULAR IDENTIFICADOR SALDO_INICIAL DEUDA_INICIAL LIMITE_CREDITO FECHA_APERTURA DIA_CORTE DIA_PAGO PAGO_MINIMO PAGO_TOTAL_ESTADO ESTADO OBSERVACIONES MONEDA FECHA_CORTE FECHA_MAXIMA_PAGO'.split(' '),
  Beneficiarios: 'NOMBRE TIPO IDENTIFICACION TELEFONO EMAIL BANCO_DESTINO CUENTA_DESTINO CONCEPTO VALOR FRECUENCIA DIA_VENCIMIENTO ESTADO OBSERVACIONES'.split(' '),
  Categorias: 'NOMBRE TIPO ESTADO'.split(' '), Obligaciones: 'TITULO MONTO FRECUENCIA INICIO BENEFICIARIO CATEGORIA FIN DIA ESTADO OBSERVACIONES'.split(' '), Cuotas: 'TITULO MONTO FECHA_VENCIMIENTO BENEFICIARIO CATEGORIA ESTADO OBSERVACIONES'.split(' '),
};
interface State { user: User | null; data: PersonalBootstrap; calls: { action: string; payload: Record<string, unknown> | null }[]; failAction: string; failBootstrap: boolean; pendingOnFailure: boolean; unexpected: string[] }
export const test = base.extend<{ personal: State }>({ personal: async ({ page }, use) => {
  const state: State = { user: personalUser, data: personalBootstrap(), calls: [], failAction: '', failBootstrap: false, pendingOnFailure: false, unexpected: [] }; let seq = 0;
  const metadata = () => ({ ID: `test-${++seq}`, UPDATED_AT: `2026-10-12T12:00:${String(seq).padStart(2, '0')}Z`, USERNAME: personalUser.username, OP_ID: `operation-${seq}` });
  const update = () => {
    for (const a of state.data.cuentas) {
      const debt = a.TIPO === 'Tarjeta de cr\u00e9dito'; let amount = Math.round(Number(debt ? a.DEUDA_INICIAL : a.SALDO_INICIAL || 0) * 100);
      for (const m of state.data.movimientos.filter(m => m.ESTADO === 'Activo')) for (const p of JSON.parse(m.ASIENTOS)) if (p.CUENTA === a.ID) amount += p.CENTAVOS;
      a.SALDO_ACTUAL = debt ? null : amount / 100; a.DEUDA_ACTUAL = debt ? amount / 100 : null; a.CREDITO_DISPONIBLE = debt ? Number(a.LIMITE_CREDITO) - amount / 100 : null;
      a.SALDO_ESTADO_PENDIENTE = null; a.ESTADO_CUENTA_VENCIDO = false; a.ESTADO_CUENTA_PROXIMO = false;
      if (debt && Number(a.PAGO_TOTAL_ESTADO) > 0 && a.FECHA_CORTE && a.FECHA_MAXIMA_PAGO) {
        const paid = state.data.movimientos.filter(m => m.ESTADO === 'Activo' && m.TIPO === 'Pago tarjeta' && m.DESTINO === a.ID && m.FECHA >= a.FECHA_CORTE!).reduce((s, m) => s + Math.round(m.MONTO * 100), 0);
        a.SALDO_ESTADO_PENDIENTE = Math.min(amount, Math.max(0, Math.round(Number(a.PAGO_TOTAL_ESTADO) * 100) - paid)) / 100;
        const alertEnd = new Date(Date.parse(`${state.data.hoy}T12:00:00Z`) + state.data.configuracion.DIAS_ALERTA * 86400000).toISOString().slice(0, 10);
        a.ESTADO_CUENTA_VENCIDO = a.SALDO_ESTADO_PENDIENTE > 0 && a.FECHA_MAXIMA_PAGO < state.data.hoy;
        a.ESTADO_CUENTA_PROXIMO = a.SALDO_ESTADO_PENDIENTE > 0 && a.FECHA_MAXIMA_PAGO >= state.data.hoy && a.FECHA_MAXIMA_PAGO <= alertEnd;
      }
    }
    for (const q of state.data.obligaciones) { q.PAGADO = state.data.pagos.filter(p => p.CUOTA === q.ID && p.ESTADO === 'Activo').reduce((s, p) => s + p.MONTO, 0); q.PENDIENTE = q.ESTADO === 'Anulado' ? 0 : q.MONTO - q.PAGADO; q.ESTADO_ACTUAL = q.ESTADO === 'Anulado' ? 'Anulado' : q.PENDIENTE <= 0 ? 'Pagado' : q.PAGADO > 0 ? 'Pago parcial' : 'Pendiente'; q.VENCIDO = q.PENDIENTE > 0 && q.FECHA_VENCIMIENTO < state.data.hoy; q.PROXIMO = q.PENDIENTE > 0 && q.FECHA_VENCIMIENTO >= state.data.hoy && q.FECHA_VENCIMIENTO <= '2026-10-19'; }
  };
  const quota = (row: Record<string, unknown>) => { const q = { ...metadata(), ESTADO: 'Pendiente', PAGADO: 0, PENDIENTE: Number(row.MONTO), ESTADO_ACTUAL: 'Pendiente', VENCIDO: false, PROXIMO: false, ...row } as Quota; state.data.obligaciones.push(q); return q; };
  await page.route('**/*', async route => {
    const req = route.request(); const url = new URL(req.url());
    if (url.hostname === 'fonts.googleapis.com') { await route.fulfill({ contentType: 'text/css', body: '' }); return; }
    if (url.origin !== 'http://localhost:5173') { state.unexpected.push(url.href); await route.abort(); return; }
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
    const action = url.searchParams.get('action') || ''; const write = !['config', 'session', 'personal-bootstrap', 'personal-backup'].includes(action); const payload = write ? req.postDataJSON() : null;
    state.calls.push({ action, payload });
    if (!['config', 'session', 'login', 'logout', 'personal-bootstrap', 'personal-backup', 'personal-save', 'personal-generate', 'personal-transaction', 'personal-pay', 'personal-void', 'personal-reconcile', 'personal-configure', 'personal-upload', 'personal-resolveOperation'].includes(action) || req.method() !== (write ? 'POST' : 'GET') || [...url.searchParams.keys()].some(k => k !== 'action')) { state.unexpected.push(action); await route.abort(); return; }
    if (write && action.startsWith('personal-')) {
      expect(payload.requestId).toMatch(/^[0-9a-f-]{36}$/);
      const allowed: Record<string, string> = {
        'personal-save': 'requestId sheet row', 'personal-generate': 'requestId until definitionId', 'personal-transaction': 'requestId type FECHA DESCRIPCION MONTO CUENTA DESTINO CATEGORIA BENEFICIARIO METODO COMISION CUOTAS PRIMER_VENCIMIENTO COMPROBANTE_URL REFERENCIA', 'personal-pay': 'requestId cuotaId CUENTA MONTO FECHA DESCRIPCION METODO COMPROBANTE_URL REFERENCIA FACTURA DOCUMENTO', 'personal-void': 'requestId operationId cuotaId UPDATED_AT MOTIVO', 'personal-reconcile': 'requestId CUENTA OBSERVADO FECHA MOTIVO UPDATED_AT', 'personal-configure': 'requestId preferences', 'personal-upload': 'requestId filename mimeType base64', 'personal-resolveOperation': 'requestId operationId MOTIVO',
      };
      expect(Object.keys(payload).every(k => allowed[action].split(' ').includes(k))).toBe(true);
    }
    if (action === state.failAction || action === 'personal-bootstrap' && state.failBootstrap) {
      state.failAction = '';
      if (state.pendingOnFailure && write) state.data.operacionesPendientes.push({ ...metadata(), ID: 'test-pending', REQUEST_ID: payload.requestId, ACTION: action, ESTADO: 'PENDIENTE_CONCILIACION', ERROR: 'Test uncertain write' });
      await route.fulfill({ status: 503, json: { success: false, message: 'Test personal connection pending' } }); return;
    }
    let result: unknown;
    if (action === 'config') result = { authMode: 'password', configured: true };
    else if (action === 'session') result = { user: state.user };
    else if (action === 'login') { if (payload.username !== personalUser.username || payload.password !== personalPassword) { await route.fulfill({ status: 401, json: { success: false, message: 'Test invalid credentials' } }); return; } state.user = personalUser; result = { user: state.user }; }
    else if (action === 'logout') { state.user = null; result = { user: null }; }
    else if (action === 'personal-bootstrap') { update(); result = state.data; }
    else if (action === 'personal-backup') result = { schemaVersion: 1, generatedAt: '2026-10-12T12:00:00Z', schemas: fields, tables: state.data };
    else if (action === 'personal-save') {
      const sheet = String(payload.sheet); const row = payload.row as Record<string, unknown>; expect(Object.keys(row).every(k => [...fields[sheet], 'ID', 'UPDATED_AT'].includes(k))).toBe(true);
      const collection = ({ Cuentas: state.data.cuentas, Beneficiarios: state.data.beneficiarios, Categorias: state.data.categorias, Obligaciones: state.data.recurrentes, Cuotas: state.data.obligaciones } as Record<string, Row[]>)[sheet];
      const old = collection.find(r => r.ID === row.ID);
      if (sheet === 'Cuotas' && old?.TARJETA && row.MONTO !== undefined && row.MONTO !== old.MONTO) { await route.fulfill({ status: 409, json: { success: false, message: 'El monto de una cuota de tarjeta no se puede cambiar.' } }); return; }
      const saved = { ...metadata(), ...old, ...row } as Row; if (old) collection.splice(collection.indexOf(old), 1, saved); else collection.push(saved);
      if (sheet === 'Cuentas') { expect(row.MONEDA === undefined || row.MONEDA === 'USD').toBe(true); Object.assign(saved, { MONEDA: row.MONEDA || 'USD', SALDO_INICIAL: Number(saved.SALDO_INICIAL || 0), DEUDA_INICIAL: Number(saved.DEUDA_INICIAL || 0), LIMITE_CREDITO: Number(saved.LIMITE_CREDITO || 0) }); }
      if (sheet === 'Cuotas') Object.assign(saved, { PAGADO: 0, PENDIENTE: saved.MONTO, ESTADO_ACTUAL: 'Pendiente' });
      const generated = sheet === 'Obligaciones' && saved.ESTADO === 'Activa' && !old ? [quota({ TITULO: saved.TITULO, MONTO: saved.MONTO, FECHA_VENCIMIENTO: saved.INICIO, DEFINICION: saved.ID })] : []; result = { row: saved, generated };
    } else if (action === 'personal-generate') result = { generated: [] };
    else if (action === 'personal-transaction' || action === 'personal-pay') {
      const payingQuota = action === 'personal-pay' ? state.data.obligaciones.find(q => q.ID === payload.cuotaId) : undefined;
      const n = Number(payload.MONTO); const type = action === 'personal-pay' ? payingQuota?.TARJETA ? 'cardpayment' : 'egress' : String(payload.type); const source = String(payload.CUENTA); const target = String(payingQuota?.TARJETA || payload.DESTINO || '');
      const credit = state.data.cuentas.find(a => a.ID === source)?.TIPO === 'Tarjeta de cr\u00e9dito';
      const m = { ...metadata(), FECHA: payload.FECHA, DESCRIPCION: payload.DESCRIPCION, CUENTA: source, DESTINO: target, MONTO: n, TIPO: ({ income: 'Ingreso', egress: credit ? 'Compra tarjeta' : 'Gasto', transfer: 'Transferencia', cardpurchase: 'Compra tarjeta', cardpayment: 'Pago tarjeta' } as Record<string, string>)[type], ESTADO: 'Activo', CATEGORIA: payload.CATEGORIA || '', METODO: payload.METODO || 'Transferencia bancaria', BENEFICIARIO: payload.BENEFICIARIO || '', REFERENCIA: payload.REFERENCIA || '', COMPROBANTE_URL: payload.COMPROBANTE_URL || '', ASIENTOS: JSON.stringify([{ CUENTA: source, CENTAVOS: Math.round(n * 100) * (type === 'income' || type === 'cardpurchase' || credit ? 1 : -1) }, ...(['transfer', 'cardpayment'].includes(type) ? [{ CUENTA: target, CENTAVOS: Math.round(n * 100) * (type === 'cardpayment' ? -1 : 1) }] : [])]) } as Movement;
      state.data.movimientos.push(m);
      if (type === 'transfer') { state.data.transferencias.push({ ...metadata(), OP_ID: m.OP_ID, MOVIMIENTO: m.ID, ORIGEN: source, DESTINO: target, MONTO: n, COMISION: Number(payload.COMISION || 0), ESTADO: 'Activo' }); if (Number(payload.COMISION)) state.data.movimientos.push({ ...m, ID: metadata().ID, TIPO: 'Gasto', MONTO: Number(payload.COMISION), ASIENTOS: JSON.stringify([{ CUENTA: source, CENTAVOS: -Math.round(Number(payload.COMISION) * 100) }]) }); }
      if (type === 'cardpurchase') { const count = Number(payload.CUOTAS || 1); for (let i = 0; i < count; i++) quota({ TITULO: m.DESCRIPCION, MONTO: n / count, FECHA_VENCIMIENTO: payload.PRIMER_VENCIMIENTO || m.FECHA, TARJETA: source }); }
      if (action === 'personal-pay') state.data.pagos.push({ ...metadata(), OP_ID: m.OP_ID, CUOTA: String(payload.cuotaId), MOVIMIENTO: m.ID, MONTO: n, FECHA: String(payload.FECHA), FACTURA: String(payload.FACTURA || ''), DOCUMENTO: String(payload.DOCUMENTO || ''), ESTADO: 'Activo' } as Payment);
      if (action === 'personal-transaction' && type === 'cardpayment') {
        let available = Math.round(n * 100);
        for (const q of state.data.obligaciones.filter(q => q.TARJETA === target && q.ESTADO !== 'Anulado').sort((a, b) => a.FECHA_VENCIMIENTO.localeCompare(b.FECHA_VENCIMIENTO) || a.ID.localeCompare(b.ID))) {
          const paid = state.data.pagos.filter(p => p.CUOTA === q.ID && p.ESTADO === 'Activo').reduce((s, p) => s + Math.round(p.MONTO * 100), 0);
          const allocated = Math.min(available, Math.max(0, Math.round(q.MONTO * 100) - paid));
          if (allocated > 0) state.data.pagos.push({ ...metadata(), OP_ID: m.OP_ID, CUOTA: q.ID, MOVIMIENTO: m.ID, MONTO: allocated / 100, FECHA: m.FECHA, ESTADO: 'Activo' });
          available -= allocated;
        }
      }
      result = { movimientos: [m], pagos: [] };
    } else if (action === 'personal-reconcile') {
      const a = state.data.cuentas.find(a => a.ID === payload.CUENTA)!; expect(payload.UPDATED_AT).toBe(a.UPDATED_AT);
      const delta = Number(payload.OBSERVADO) - Number(a.TIPO === 'Tarjeta de cr\u00e9dito' ? a.DEUDA_ACTUAL : a.SALDO_ACTUAL);
      const m = { ...metadata(), FECHA: String(payload.FECHA), TIPO: 'Ajuste', DESCRIPCION: String(payload.MOTIVO), MOTIVO: String(payload.MOTIVO), MONTO: Math.abs(delta), DIFERENCIA: delta, OBSERVADO: Number(payload.OBSERVADO), CUENTA: a.ID, ASIENTOS: JSON.stringify([{ CUENTA: a.ID, CENTAVOS: Math.round(delta * 100) }]), ESTADO: 'Activo' } as Movement;
      state.data.movimientos.push(m); result = { movimientos: [m] };
    } else if (action === 'personal-configure') { expect(Object.keys(payload.preferences).every(k => ['MONEDA', 'DIAS_ALERTA', 'PERMITIR_SOBREGIRO', 'CANAL_EMAIL'].includes(k))).toBe(true); Object.assign(state.data.configuracion, payload.preferences); result = state.data.configuracion; }
    else if (action === 'personal-resolveOperation') { expect(String(payload.MOTIVO).trim().length).toBeGreaterThan(0); state.data.operacionesPendientes = state.data.operacionesPendientes.filter(r => r.ID !== payload.operationId); result = { discarded: payload.operationId }; }
    else if (action === 'personal-upload') { expect(payload).toHaveProperty('filename'); expect(payload).not.toHaveProperty('name'); result = { url: 'https://drive.google.com/file/d/test_private_file_id/view', fileId: 'test_private_file_id' }; }
    else if (action === 'personal-void') { for (const m of state.data.movimientos) if (m.OP_ID === payload.operationId) m.ESTADO = 'Anulado'; for (const p of state.data.pagos) if (p.OP_ID === payload.operationId) p.ESTADO = 'Anulado'; const q = state.data.obligaciones.find(q => q.ID === payload.cuotaId); if (q) q.ESTADO = 'Anulado'; result = { anulados: [] }; }
    else { state.unexpected.push(action); await route.abort(); return; }
    update(); await route.fulfill({ json: { success: true, data: result } });
  });
  await use(state); expect(state.unexpected).toEqual([]);
} });
export { expect };
export async function navigatePersonal(page: Page, name: string) { await page.locator('.personal-shell').waitFor(); const open = page.getByRole('button', { name: 'Abrir navegacion personal', exact: true }); if (await open.isVisible()) await open.click(); await page.getByRole('navigation', { name: 'Navegacion personal' }).getByRole('button', { name, exact: true }).click(); }
export function fundedAccounts(): Account[] { return [{ ID: 'test-bank', UPDATED_AT: 'test-version', NOMBRE: 'Test bank', TIPO: 'Ahorros', BANCO: 'Test bank label', ESTADO: 'Activa', SALDO_INICIAL: 200, DEUDA_INICIAL: 0, SALDO_ACTUAL: 200, DEUDA_ACTUAL: null, CREDITO_DISPONIBLE: null }, { ID: 'test-cash', UPDATED_AT: 'test-version', NOMBRE: 'Test cash', TIPO: 'Efectivo', ESTADO: 'Activa', SALDO_INICIAL: 0, DEUDA_INICIAL: 0, SALDO_ACTUAL: 0, DEUDA_ACTUAL: null, CREDITO_DISPONIBLE: null }, { ID: 'test-card', UPDATED_AT: 'test-version', NOMBRE: 'Test card', TIPO: 'Tarjeta de cr\u00e9dito', ESTADO: 'Activa', SALDO_INICIAL: 0, DEUDA_INICIAL: 50, LIMITE_CREDITO: 500, SALDO_ACTUAL: null, DEUDA_ACTUAL: 50, CREDITO_DISPONIBLE: 450, DIA_CORTE: 31, DIA_PAGO: 15 }]; }
