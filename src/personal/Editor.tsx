import { useRef, useState } from 'react';
import { ApiError, errorMessage } from '../api';
import { Modal } from '../components';
import { personalReceiptUrl, validUploadFilename } from './receipts';
import { personalApi } from './api';
import { validAmount, validDate } from './finance';
import { visibleFields } from './forms';
import type { Draft, PersonalBootstrap, Value } from './types';
export function validateExecutionDate(action: Draft['action'], fecha: unknown, hoy: string): void {
  if (!['transaction', 'pay', 'reconcile'].includes(action)) return;
  if (!validDate(hoy) || !validDate(String(fecha))) throw new Error('La operacion requiere una fecha real y la fecha actual confirmada de la hoja.');
  if (String(fecha) > hoy) throw new Error('La fecha de la operacion no puede ser futura en la zona horaria de la hoja. Usa un compromiso pendiente para programar un pago futuro.');
}
export function buildPayload(d: Draft): Record<string, unknown> {
  const row: Record<string, unknown> = { ...d.fixed };
  for (const f of visibleFields(d)) {
    const v = d.values[f.key];
    if (v === undefined || v === '' || v === null) { if (f.required) throw new Error(`Completa ${f.label}`); if (v === '' && d.action === 'save' && d.fixed.ID && !['FECHA_CORTE', 'FECHA_MAXIMA_PAGO'].includes(f.key)) row[f.key] = ''; continue; }
    if (f.type === 'number') {
      const n = Number(v); if (!Number.isFinite(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max) || (f.step === 1 ? !Number.isInteger(n) : !validAmount(Math.abs(n), false))) throw new Error(`Valor inv\u00e1lido: ${f.label}`);
      row[f.key] = n;
    } else if (f.type === 'date') { if (!validDate(String(v))) throw new Error(`Fecha inv\u00e1lida: ${f.label}`); row[f.key] = v; }
    else if (f.type === 'select') { if (!f.options?.some(o => o.value === v)) throw new Error(`Selecci\u00f3n inv\u00e1lida: ${f.label}`); row[f.key] = v; }
    else { if (typeof v === 'string' && !v.trim() && f.required) throw new Error(`Completa ${f.label}`); row[f.key] = typeof v === 'string' ? v.trim() : v; }
  }
  if (row.COMPROBANTE_URL && !personalReceiptUrl(String(row.COMPROBANTE_URL))) throw new Error('Usa una URL HTTPS de archivo de Google Drive v\u00e1lida, sin parametros adicionales.');
  if (row.CUENTA && row.CUENTA === row.DESTINO) throw new Error('Origen y destino deben ser distintos.');
  if (Number(row.COMISION) > 0 && !row.CATEGORIA) throw new Error('Selecciona una categor\u00eda de gasto para la comisi\u00f3n.');
  if (row.INICIO && row.FIN && String(row.FIN) < String(row.INICIO)) throw new Error('Fin debe ser posterior al inicio.');
  if (row.FECHA_CORTE && row.FECHA_MAXIMA_PAGO && String(row.FECHA_MAXIMA_PAGO) < String(row.FECHA_CORTE)) throw new Error('Fecha maxima de pago debe ser igual o posterior a la fecha de corte del estado.');
  if (row.CUOTAS && Number(row.CUOTAS) > Math.round(Number(row.MONTO) * 100)) throw new Error('Cada cuota debe tener al menos un centavo.');
  if (d.sheet === 'Cuentas' && row.IDENTIFICADOR) {
    if (row.TIPO === 'Tarjeta de cr\u00e9dito' ? !/^\d{4}$/.test(String(row.IDENTIFICADOR)) : ['Efectivo', 'Otra'].includes(String(row.TIPO))) throw new Error('Tarjeta: solo cuatro d\u00edgitos. Efectivo/Otra: sin identificador.');
  }
  return d.action === 'save' ? { requestId: d.requestId, sheet: d.sheet, row } : d.action === 'configure' ? { requestId: d.requestId, preferences: row } : { requestId: d.requestId, ...row };
}
export default function Editor({ draft, data, onChange, onClose, onSaved, blocked }: { draft: Draft; data: PersonalBootstrap; onChange: (d: Draft) => void; onClose: () => void; onSaved: () => Promise<void>; blocked: boolean }) {
  const [busy, setBusy] = useState(false); const [uploadError, setUploadError] = useState('');
  const upload = useRef<{ requestId: string; filename: string; mimeType: string; base64: string } | null>(null);
  const [uploadPending, setUploadPending] = useState(!!draft.uploadUncertain);
  const locked = !!draft.retryPayload;
  const actualExecution = ['transaction', 'pay', 'reconcile'].includes(draft.action);
  function change(key: string, value: Value) { onChange({ ...draft, values: { ...draft.values, [key]: value }, error: '' }); }
  async function save() {
    if (busy || (blocked && draft.action !== 'resolveOperation')) return;
    let payload: Record<string, unknown>;
    try {
      payload = draft.retryPayload || buildPayload(draft);
      validateExecutionDate(draft.action, payload.FECHA, data.hoy);
      if (!draft.retryPayload && ['transaction', 'pay'].includes(draft.action)) {
        const source = data.cuentas.find(a => a.ID === payload.CUENTA);
        if (!source || source.ESTADO !== 'Activa') throw new Error('Selecciona una cuenta activa.');
        const amount = Number(payload.MONTO); const type = String(payload.type || 'pay');
        if (draft.action === 'pay') { const quota = data.obligaciones.find(q => q.ID === payload.cuotaId); if (!quota || amount > quota.PENDIENTE || quota.ESTADO_ACTUAL === 'Anulado') throw new Error('El abono supera el pendiente actual. Actualiza la obligacion.'); }
        const credit = source.TIPO === 'Tarjeta de cr\u00e9dito';
        if (type !== 'income' && (credit ? amount > Number(source.CREDITO_DISPONIBLE) : !data.configuracion.PERMITIR_SOBREGIRO && amount + Number(payload.COMISION || 0) > Number(source.SALDO_ACTUAL))) throw new Error(credit ? 'Credito disponible insuficiente.' : 'Saldo disponible insuficiente.');
        if (type === 'cardpayment') { const target = data.cuentas.find(a => a.ID === payload.DESTINO); if (!target || amount > Number(target.DEUDA_ACTUAL)) throw new Error('El pago supera la deuda actual de la tarjeta.'); }
      }
    } catch (e) { onChange({ ...draft, error: errorMessage(e) }); return; }
    setBusy(true); const submitted = { ...draft, retryPayload: payload, error: '' }; onChange(submitted);
    try { await personalApi(draft.action, payload); await onSaved(); }
    catch (e) { const uncertain = !(e instanceof ApiError) || ![400, 403, 404, 413].includes(e.status); onChange({ ...submitted, retryPayload: uncertain ? payload : undefined, error: `${errorMessage(e)}${uncertain ? ' Resultado no confirmado: se conserva la clave y el payload exactos. Actualiza y revisa las operaciones pendientes antes de reintentar.' : ''}` }); }
    finally { setBusy(false); }
  }
  async function uploadFile(file: File) {
    if (busy || locked || uploadPending || blocked) return;
    setUploadError('');
    if (!validUploadFilename(file.name)) { setUploadError('Nombre de archivo invalido: maximo 120 caracteres, sin punto inicial ni rutas.'); return; }
    if (file.size > 3 * 1024 * 1024 || !['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) { setUploadError('Solo JPG, PNG o PDF hasta 3 MiB.'); return; }
    setBusy(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('No se pudo leer el archivo')); reader.readAsDataURL(file); });
      upload.current = { requestId: crypto.randomUUID(), filename: file.name, mimeType: file.type, base64 };
      const result = await personalApi<{ url: string }>('upload', upload.current);
      if (!personalReceiptUrl(result.url)) throw new Error('El servidor devolvi\u00f3 una URL no permitida.');
      change('COMPROBANTE_URL', result.url); upload.current = null;
    } catch (e) { const pending = !(e instanceof ApiError) || ![400, 413].includes(e.status); setUploadPending(pending); if (pending) onChange({ ...draft, uploadUncertain: upload.current?.requestId }); setUploadError(`${errorMessage(e)}${pending ? ' No se volver\u00e1 a subir autom\u00e1ticamente. Revisa Configuraci\u00f3n y el diario con el propietario; el archivo podr\u00eda existir.' : ''}`); }
    finally { setBusy(false); }
  }
  return <Modal title={draft.title} onClose={() => { if (!busy) onClose(); }} locked={busy} wide><form className="pf-editor" onSubmit={e => { e.preventDefault(); void save(); }}>
    {draft.sheet === 'Obligaciones' && <p className="pf-note">Activa: genera desde hoy hasta los proximos 90 dias, inclusive, sin recuperar automaticamente cuotas pasadas de una recurrencia. Pago unico puede emitir su unica ocurrencia pasada. Suspendida/Finalizada: no genera ni cancela cuotas ya emitidas. Limites: 100 nuevas cuotas por operacion y hasta hoy + 366 dias. Un fallo cancela todo el guardado; el historial emitido y la fecha Inicio se conservan.</p>}
    {draft.action === 'void' && <p className="pf-note">Se anula la operacion completa y sus asientos. No hay edicion financiera silenciosa: corrige anulando y registrando de nuevo.</p>}
    {draft.action === 'resolveOperation' && <p className="pf-note">Solo descartar el diario pendiente. No confirma importes parciales. Revisa las filas reales con el propietario antes de continuar.</p>}
    {draft.action === 'pay' && <p className="pf-note">El vencimiento pertenece a la obligacion y se modifica desde Editar obligacion. La fecha de este formulario es la fecha real del pago registrado.</p>}
    {draft.sheet === 'Cuentas' && draft.values.TIPO === 'Tarjeta de cr\u00e9dito' && <p className="pf-note">Declara el total y las fechas reales de tu estado. Los dias mensuales son solo pronosticos y no declaran deuda vencida. El servidor calcula el saldo del estado con pagos confirmados desde la fecha de corte, inclusive; guardar estos datos no registra pagos ni ajustes. Las fechas vacias no se envian; al editar conservan el dato guardado.</p>}
    {draft.sheet === 'Cuotas' && draft.fields.some(f => f.key === 'MONTO' && f.readOnly) && <p className="pf-note">El monto de esta cuota de tarjeta corresponde a la compra original y no se puede editar. Puedes cambiar titulo, vencimiento y notas. Cambios de deuda requieren una nueva compra o una conciliacion auditada, no otra edicion de importe.</p>}
    <div className="pf-fields">{visibleFields(draft).map(f => <label key={f.key}>{f.label}{f.required ? ' *' : ''}{f.type === 'select' ? <select aria-label={`${f.label}${f.required ? ' *' : ''}`} value={String(draft.values[f.key] ?? '')} required={f.required} disabled={busy || locked || f.readOnly} onChange={e => change(f.key, e.target.value)}><option value="">Seleccionar</option>{f.options?.map(o => <option value={o.value} key={o.value}>{o.label}</option>)}</select> : f.type === 'checkbox' ? <input type="checkbox" checked={!!draft.values[f.key]} disabled={busy || locked} onChange={e => change(f.key, e.target.checked)} /> : <input type={f.type || 'text'} value={String(draft.values[f.key] ?? '')} required={f.required} min={f.type === 'date' ? '1900-01-01' : f.min} max={f.type === 'date' ? actualExecution && f.key === 'FECHA' ? data.hoy : '9999-12-31' : f.max} step={f.step} maxLength={f.maxLength || 500} readOnly={f.readOnly} disabled={busy || locked} onChange={e => change(f.key, e.target.value)} onInvalid={() => { if (actualExecution && f.key === 'FECHA') { try { validateExecutionDate(draft.action, draft.values.FECHA, data.hoy); } catch (e) { onChange({ ...draft, error: errorMessage(e) }); } } }} />}</label>)}</div>
    {draft.fields.some(f => f.key === 'COMPROBANTE_URL') && <div className="pf-note"><label>Adjuntar comprobante (opcional)<input type="file" accept="image/jpeg,image/png,application/pdf" disabled={!data.configuracion.UPLOAD_ENABLED || busy || locked || uploadPending || blocked} onChange={e => { const file = e.target.files?.[0]; if (file) void uploadFile(file); }} /></label><p>{data.configuracion.UPLOAD_ENABLED ? 'Subida a carpeta privada de Drive, hasta 3 MiB. Los permisos del archivo son independientes del conector publico. La subida no modifica importes.' : 'La carpeta privada no est\u00e1 configurada por el administrador. Puedes ingresar una URL de Drive; sus permisos dependen del propietario del archivo.'}</p>{(uploadError || draft.uploadUncertain) && <p role="alert">{uploadError || `Subida incierta ${draft.uploadUncertain}. Revisa el diario y el archivo con el propietario; no se repite automaticamente. Conserva los campos o cierra este borrador.`}</p>}{uploadPending && <button type="button" disabled={busy || blocked} onClick={() => { if (window.confirm('Actualiza primero el diario. ¿El propietario verifico o resolvio esta subida y confirmo que puedes continuar sin volver a subir el archivo? Podras usar la URL real de Drive conservando el formulario.')) { onChange({ ...draft, uploadUncertain: undefined }); setUploadPending(false); setUploadError('Subida verificada por el propietario. Ingresa la URL real del archivo o continua sin adjunto.'); } }}>Continuar con URL tras verificacion del propietario</button>}</div>}
    {draft.error && <p className="pf-error" role="alert">{draft.error}</p>}
    {blocked && draft.action !== 'resolveOperation' && <p role="alert">Hay operaciones pendientes. Resuelvelas en Configuracion antes de guardar.</p>}
    <div className="pf-actions"><button type="button" onClick={onClose} disabled={busy}>Cerrar y conservar</button><button className="pf-primary" disabled={busy || (blocked && draft.action !== 'resolveOperation') || uploadPending}>{busy ? 'Procesando...' : locked ? 'Reintentar payload exacto' : 'Guardar'}</button></div>
  </form></Modal>;
}
