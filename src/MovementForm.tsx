import { useState, type FormEvent } from 'react';
import { Check, FileText, LockKeyhole } from 'lucide-react';
import { api, ApiError, saveError } from './api';
import { Alert, CatalogOptions, label, safeReceiptUrl } from './components';
import { currency, isExpense, isLive, localDate, pendingAmount, roundMoney } from './finance';
import type { Bootstrap, Movement, MovementInput } from './types';

export interface MovementDraft {
  value: MovementInput;
  editing?: Movement;
  retryPayload?: MovementInput;
}
export function newMovement(original?: Movement): MovementDraft {
  const now = new Date();
  return { value: {
    FECHA: localDate(now), HORA: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    TIPO: original ? 'Pago' : 'Gasto', JEFE: original?.JEFE || '', CATEGORIA: original?.CATEGORIA || '',
    FORMA_PAGO: '', SUBCATEGORIA: original?.SUBCATEGORIA || '', DESCRIPCION: original ? `Pago de ${original.DESCRIPCION || original.ID}` : '', PROVEEDOR: original?.PROVEEDOR || '', FACTURA: '', OBSERVACIONES: '',
    CANTIDAD: 1, VALOR_UNITARIO: 0, TOTAL: 0, TOTAL_MANUAL: false, ESTADO: 'Pagado', PAGADO: 0,
    ...(original ? { MOVIMIENTO_ORIGEN_ID: original.ID } : {}), CLAVE_IDEMPOTENCIA: crypto.randomUUID(),
  } };
}
export function editMovement(m: Movement): MovementDraft {
  const { FECHA, HORA, TIPO, JEFE, CUENTA, CATEGORIA, SUBCATEGORIA, FORMA_PAGO, DESCRIPCION, PROVEEDOR, OBSERVACIONES, CANTIDAD, VALOR_UNITARIO, TOTAL, TOTAL_MANUAL, ESTADO, PAGADO, DIRECCION, MOVIMIENTO_ORIGEN_ID, CUENTA_DESTINO_ID, COMPROBANTE_URL, CLAVE_IDEMPOTENCIA } = m;
  return { editing: m, value: { FECHA, HORA, TIPO, JEFE, CUENTA, CATEGORIA, SUBCATEGORIA, FORMA_PAGO, DESCRIPCION, PROVEEDOR, FACTURA: m.NUMERO_FACTURA ?? m.FACTURA ?? '', OBSERVACIONES, CANTIDAD, VALOR_UNITARIO, TOTAL, TOTAL_MANUAL, ESTADO, PAGADO, DIRECCION, MOVIMIENTO_ORIGEN_ID, CUENTA_DESTINO_ID, COMPROBANTE_URL, CLAVE_IDEMPOTENCIA } };
}

export default function MovementForm({ draft, onDraftChange, data, ledger, onSaved, onCancel, onDiscard, onBusy }: {
  draft: MovementDraft; onDraftChange: (draft: MovementDraft) => void; data: Bootstrap; ledger: Movement[];
  onSaved: (movement: Movement) => Promise<void>; onCancel: () => void; onDiscard: () => void; onBusy: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const m = draft.value;
  const locked = !!draft.retryPayload;
  const subtotal = roundMoney(m.CANTIDAD * m.VALOR_UNITARIO);
  const total = m.TOTAL_MANUAL ? m.TOTAL : subtotal;
  const linked = m.TIPO === 'Pago' && !!m.MOVIMIENTO_ORIGEN_ID;
  const expense = ['Gasto', 'Compra', 'Pago'].includes(m.TIPO) && !linked;
  const directional = ['Préstamo', 'Adelanto'].includes(m.TIPO);
  const originals = ledger.filter(row => (!m.JEFE || row.JEFE === m.JEFE) && isLive(row) && isExpense(row) && row.ID !== draft.editing?.ID && (pendingAmount(row, ledger) > 0 || row.ID === m.MOVIMIENTO_ORIGEN_ID));
  const origin = ledger.find(row => row.ID === m.MOVIMIENTO_ORIGEN_ID);
  const cap = origin ? roundMoney(pendingAmount(origin, ledger) + (draft.editing?.MOVIMIENTO_ORIGEN_ID === origin.ID ? draft.editing.TOTAL : 0)) : 0;
  const update = (patch: Partial<MovementInput>) => onDraftChange({ ...draft, value: { ...m, ...patch } });
  const number = (field: 'CANTIDAD' | 'VALOR_UNITARIO' | 'TOTAL' | 'PAGADO', value: string) => update({ [field]: value === '' ? NaN : Number(value) });
  const displayNumber = (value: number) => Number.isFinite(value) ? value : '';
  function chooseType(tipo: string) {
    if (tipo === m.TIPO) return;
    update({ TIPO: tipo, DIRECCION: undefined, CUENTA: '', CUENTA_DESTINO_ID: '', MOVIMIENTO_ORIGEN_ID: undefined, ESTADO: 'Pagado' });
  }
  function chooseOriginal(id: string) {
    const original = ledger.find(row => row.ID === id);
    update({ MOVIMIENTO_ORIGEN_ID: id || undefined, ESTADO: 'Pagado', ...(original ? { JEFE: original.JEFE, ...(original.JEFE !== m.JEFE ? { CUENTA: '', CUENTA_DESTINO_ID: '' } : {}), CATEGORIA: original.CATEGORIA, SUBCATEGORIA: original.SUBCATEGORIA, PROVEEDOR: original.PROVEEDOR } : {}) });
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setError('');
    const payload = draft.retryPayload || {
      ...m, TOTAL: total, TOTAL_MANUAL: Boolean(m.TOTAL_MANUAL),
      ESTADO: expense ? m.ESTADO : 'Pagado', PAGADO: expense && m.ESTADO === 'Pago parcial' ? m.PAGADO : expense && m.ESTADO === 'Pendiente' ? 0 : total,
      DIRECCION: directional ? m.DIRECCION : undefined,
      MOVIMIENTO_ORIGEN_ID: m.TIPO === 'Pago' ? m.MOVIMIENTO_ORIGEN_ID : undefined,
    };
    if (!payload.DESCRIPCION.trim()) { setError('Ingresa una descripción para el movimiento.'); return; }
    for (const field of ['VALOR_UNITARIO', 'TOTAL', 'PAGADO'] as const) {
      const value = payload[field];
      if (!Number.isFinite(value) || value < 0 || value > 1e9 || Math.abs(roundMoney(value) - value) > 0.000001) { setError('Los importes deben ser números no negativos, con máximo dos decimales y hasta 1.000.000.000.'); return; }
    }
    if (!Number.isFinite(payload.CANTIDAD) || payload.CANTIDAD < 0 || payload.CANTIDAD > 1e9) { setError('Ingresa una cantidad válida y no negativa.'); return; }
    if (payload.ESTADO === 'Pago parcial' && !(payload.PAGADO > 0 && payload.PAGADO < payload.TOTAL)) { setError('El pago parcial debe ser mayor que cero y menor que el total.'); return; }
    if (!locked && linked && (!origin || origin.JEFE !== payload.JEFE || total <= 0 || total > cap)) { setError(`El pago debe pertenecer al mismo responsable, ser mayor que cero y no superar ${currency(cap)} de saldo pendiente.`); return; }
    if (payload.TIPO === 'Transferencia' && payload.TOTAL <= 0) { setError('La transferencia requiere un total mayor que cero.'); return; }
    if (payload.COMPROBANTE_URL && !safeReceiptUrl(payload.COMPROBANTE_URL)) { setError('Usa un enlace HTTPS de drive.google.com: /file/d/ID/view, /file/d/ID/preview u /open?id=ID. El comprobante es opcional.'); return; }
    setBusy(true); onBusy(true);
    // Keep the exact submitted input before transport, including interrupted sessions.
    onDraftChange({ ...draft, retryPayload: payload });
    try {
      const result = await api<Movement>(draft.editing ? 'update' : 'create', { movement: { ...payload, ...(draft.editing ? { ID: draft.editing.ID, UPDATED_AT: draft.editing.UPDATED_AT } : {}) } });
      await onSaved(result);
    } catch (cause) {
      if (!draft.retryPayload && cause instanceof ApiError && [400, 401, 403, 404, 405, 409, 413, 415].includes(cause.status)) onDraftChange({ ...draft, retryPayload: undefined });
      else onDraftChange({ ...draft, retryPayload: payload });
      setError(saveError(cause));
    } finally { setBusy(false); onBusy(false); }
  }
  const missing = !data.jefes.some(r => r.ESTADO === 'Activo') || !data.categorias.some(r => r.ESTADO === 'Activo') || !data.formasPago.some(r => r.ESTADO === 'Activo');
  return <form onSubmit={submit} className="movement-form">
    <div className="modal-body">
      {error && <Alert>{error}</Alert>}
      {missing && <Alert kind="info">Completa los catálogos de responsables, categorías y formas de pago en Configuración antes de registrar movimientos.</Alert>}
      {locked && <Alert kind="info"><LockKeyhole size={16} /> La respuesta del servidor no se pudo confirmar. Reintenta sin modificar los datos: se conserva la misma clave para evitar duplicados.</Alert>}
      <fieldset disabled={busy || locked}>
        <div className="form-section-title"><span>01</span><h3>Datos del movimiento</h3></div>
        <div className="form-grid">
          <label>Fecha<input type="date" required value={m.FECHA} onChange={e => update({ FECHA: e.target.value })} /></label>
          <label>Hora<input type="time" required value={m.HORA} onChange={e => update({ HORA: e.target.value })} /></label>
          <label>Tipo<select required value={m.TIPO} onChange={e => chooseType(e.target.value)}><option value="">Seleccionar</option>{data.tipos.map(type => <option key={type}>{type}</option>)}</select></label>
          {m.TIPO === 'Pago' && <label className="span-full">Obligación de origen <span className="optional">Opcional para pagos independientes</span><select value={m.MOVIMIENTO_ORIGEN_ID || ''} onChange={e => chooseOriginal(e.target.value)}><option value="">Pago independiente (no vinculado)</option>{originals.map(row => <option key={row.ID} value={row.ID}>{row.ID.slice(0, 10)} · {label(data.jefes, row.JEFE)} · {row.DESCRIPCION || row.TIPO} · {currency(pendingAmount(row, ledger))}</option>)}</select>{linked && <small>Pendiente para este pago: {currency(cap)}. El responsable corresponde al original.</small>}</label>}
          <label>Responsable<select required disabled={linked} value={m.JEFE} onChange={e => { if (e.target.value !== m.JEFE) update({ JEFE: e.target.value, CUENTA: '', CUENTA_DESTINO_ID: '' }); }}><option value="">Seleccionar jefe</option><CatalogOptions rows={data.jefes} /></select></label>
          <label>Categoría<select required value={m.CATEGORIA} onChange={e => update({ CATEGORIA: e.target.value })}><option value="">Seleccionar categoría</option><CatalogOptions rows={data.categorias} /></select></label>
          <label>Subcategoría <span className="optional">Opcional</span><input maxLength={200} value={m.SUBCATEGORIA || ''} onChange={e => update({ SUBCATEGORIA: e.target.value })} /></label>
          {m.TIPO === 'Transferencia' && <p className="muted span-full">Transferencia: solo registro; no se incluye en el total invertido.</p>}
          {directional && <label>Dirección<select required value={m.DIRECCION || ''} onChange={e => update({ DIRECCION: e.target.value as 'Recibido' | 'Entregado' })}><option value="">Seleccionar</option><option>Recibido</option><option>Entregado</option></select></label>}
          <label>Proveedor <span className="optional">Opcional</span><input maxLength={200} value={m.PROVEEDOR || ''} onChange={e => update({ PROVEEDOR: e.target.value })} /></label>
          <label>N.º de factura <span className="optional">Opcional</span><input maxLength={100} value={m.FACTURA || ''} onChange={e => update({ FACTURA: e.target.value })} /></label>
          <label className="span-full">Descripción<textarea required rows={2} maxLength={2000} value={m.DESCRIPCION} onChange={e => update({ DESCRIPCION: e.target.value })} placeholder="Detalle del movimiento" /></label>
        </div>
        <div className="form-section-title"><span>02</span><h3>Importes y pago</h3></div>
        <div className="form-grid">
          <label>Cantidad<input type="number" required min="0" max="1000000000" step="any" value={displayNumber(m.CANTIDAD)} onChange={e => number('CANTIDAD', e.target.value)} /></label>
          <label>Valor unitario (USD)<input type="number" required min="0" max="1000000000" step="0.01" value={displayNumber(m.VALOR_UNITARIO)} onChange={e => number('VALOR_UNITARIO', e.target.value)} /></label>
          <label>Subtotal<output className="form-output">{Number.isFinite(subtotal) ? currency(subtotal) : '—'}</output></label>
          <label className="checkbox-label span-full"><input type="checkbox" checked={m.TOTAL_MANUAL} onChange={e => update({ TOTAL_MANUAL: e.target.checked, TOTAL: subtotal })} /> Introducir el total manualmente</label>
          <label>Total final (USD)<input type="number" required readOnly={!m.TOTAL_MANUAL} min={linked || m.TIPO === 'Transferencia' ? '0.01' : '0'} max={linked ? cap : 1e9} step="0.01" value={displayNumber(total)} onChange={e => number('TOTAL', e.target.value)} /></label>
          <label>Forma de pago<select required value={m.FORMA_PAGO} onChange={e => update({ FORMA_PAGO: e.target.value })}><option value="">Seleccionar</option><CatalogOptions rows={data.formasPago} /></select></label>
          <label>Estado<select required value={expense ? m.ESTADO : 'Pagado'} disabled={!expense} onChange={e => update({ ESTADO: e.target.value })}>{data.estados.filter(row => row.ESTADO === 'Activo' && ['Pagado', 'Pendiente', 'Pago parcial'].includes(row.NOMBRE)).map(row => <option key={row.ID}>{row.NOMBRE}</option>)}</select></label>
          {expense && m.ESTADO === 'Pago parcial' && <label>Importe pagado (USD)<input type="number" required min="0.01" max={roundMoney(total - 0.01)} step="0.01" value={displayNumber(m.PAGADO)} onChange={e => number('PAGADO', e.target.value)} /></label>}
        </div>
        <p className="tax-note">Los precios y el total ya incluyen IVA. No se agrega ningún impuesto. {linked ? 'Este pago reduce el pendiente original; no crea un gasto adicional.' : ''}</p>
        <div className="form-section-title"><span>03</span><h3>Respaldo y notas</h3></div>
        <label>Observaciones <span className="optional">Opcional</span><textarea rows={2} maxLength={2000} value={m.OBSERVACIONES || ''} onChange={e => update({ OBSERVACIONES: e.target.value })} /></label>
        <label className="receipt-label">URL del comprobante <span className="optional">Opcional · Enlace HTTPS de Drive</span><input type="url" maxLength={300} placeholder="https://drive.google.com/file/d/.../view" value={m.COMPROBANTE_URL || ''} onChange={e => update({ COMPROBANTE_URL: e.target.value })} /></label>
        {safeReceiptUrl(m.COMPROBANTE_URL) && <a className="receipt-link" href={safeReceiptUrl(m.COMPROBANTE_URL)!} target="_blank" rel="noopener noreferrer"><FileText size={15} /> Ver comprobante adjunto</a>}
        <p className="muted">Solo se registra el enlace; no se suben archivos. No podemos comprobar su privacidad ni sus permisos. El propietario de Drive controla el acceso.</p>
      </fieldset>
    </div>
    <div className="modal-footer"><span className="footer-total">Total <strong>{Number.isFinite(total) ? currency(total) : '—'}</strong></span><button className="button text" type="button" onClick={onDiscard} disabled={busy}>Descartar borrador</button><button className="button secondary" type="button" onClick={onCancel} disabled={busy}>Cerrar y conservar</button><button className="button" type="submit" disabled={busy || (missing && !locked)}><Check size={17} />{busy ? 'Guardando...' : locked ? 'Reintentar guardado' : draft.editing ? 'Guardar cambios' : 'Registrar movimiento'}</button></div>
  </form>;
}
