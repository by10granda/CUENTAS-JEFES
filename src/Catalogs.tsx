import { useState, type FormEvent } from 'react';
import { Plus, Pencil, Check } from 'lucide-react';
import { api, errorMessage } from './api';
import { Alert, CatalogOptions, Empty, Modal, label } from './components';
import { currency } from './finance';
import type { AccountRow, Bootstrap, CatalogRow, CatalogSheet, Movement } from './types';

const tabs: { sheet: CatalogSheet; title: string; key: 'jefes' | 'cuentas' | 'categorias' | 'formasPago' | 'estados' }[] = [
  { sheet: 'JEFES', title: 'Responsables', key: 'jefes' }, { sheet: 'CUENTAS', title: 'Cuentas', key: 'cuentas' },
  { sheet: 'CATEGORIAS', title: 'Categorías', key: 'categorias' }, { sheet: 'FORMAS_PAGO', title: 'Formas de pago', key: 'formasPago' }, { sheet: 'ESTADOS', title: 'Estados', key: 'estados' },
];
interface CatalogInput { ID?: string; UPDATED_AT?: string; NOMBRE: string; ESTADO: 'Activo' | 'Inactivo'; JEFE?: string; SALDO_INICIAL?: number }
export default function Catalogs({ data, ledger, onSaved }: { data: Bootstrap; ledger: Movement[]; onSaved: () => Promise<void> }) {
  const [sheet, setSheet] = useState<CatalogSheet>('JEFES');
  const [row, setRow] = useState<CatalogInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = tabs.find(tab => tab.sheet === sheet)!;
  const used = !!row?.ID && ledger.some(m => m.CUENTA === row.ID || m.CUENTA_DESTINO_ID === row.ID);
  const protectedState = sheet === 'ESTADOS' && !!row?.ID && ['Pagado', 'Pendiente', 'Pago parcial', 'Anulado'].includes(data.estados.find(r => r.ID === row.ID)?.NOMBRE || '');
  function edit(existing?: CatalogRow | AccountRow) {
    if (sheet === 'ESTADOS') return;
    setError('');
    setRow(existing ? { ID: existing.ID, UPDATED_AT: existing.UPDATED_AT, NOMBRE: existing.NOMBRE, ESTADO: existing.ESTADO, ...('JEFE' in existing ? { JEFE: existing.JEFE, SALDO_INICIAL: existing.SALDO_INICIAL } : {}) } : { NOMBRE: '', ESTADO: 'Activo', ...(sheet === 'CUENTAS' ? { JEFE: '', SALDO_INICIAL: 0 } : {}) });
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!row || busy || sheet === 'ESTADOS') return;
    if (sheet === 'CUENTAS' && (!Number.isFinite(row.SALDO_INICIAL) || Number(row.SALDO_INICIAL) < 0)) { setError('Ingresa un saldo inicial no negativo.'); return; }
    setBusy(true); setError('');
    try { await api('saveCatalog', { sheet, row }); setRow(null); await onSaved(); }
    catch (cause) { setError(`No se pudo guardar el catálogo. ${errorMessage(cause)}`); }
    finally { setBusy(false); }
  }
  return <><div className="catalog-intro"><h2>Una base ordenada para tus cuentas.</h2><p>Administra los datos reales de tu organización. Los registros inactivos permanecen disponibles para consultar el historial.</p></div>
    <div className="catalog-tabs" role="tablist" aria-label="Catálogos">{tabs.map(tab => <button role="tab" aria-selected={sheet === tab.sheet} key={tab.sheet} className={sheet === tab.sheet ? 'active' : ''} onClick={() => setSheet(tab.sheet)}>{tab.title}<span>{data[tab.key].length}</span></button>)}</div>
    <div className="section-title"><h2>{current.title}</h2>{sheet !== 'ESTADOS' && <button className="button" onClick={() => edit()}><Plus size={17} /> Agregar</button>}</div>
    {sheet === 'ESTADOS' && <Alert kind="info">Los estados son reglas contables del sistema, no un catálogo ampliable. No se pueden agregar estados personalizados ni cambiar los cuatro existentes. Una ampliación futura requiere implementar y validar nuevas reglas contables en el backend.</Alert>}
    {error && !row && <Alert>{error}</Alert>}
    {data[current.key].length === 0 ? <Empty title={`Sin ${current.title.toLowerCase()} registrados`} action={sheet !== 'ESTADOS' ? <button className="button secondary" onClick={() => edit()}>Agregar primer registro</button> : undefined}>{sheet === 'ESTADOS' ? 'Solicita al administrador que verifique la estructura y configuración del servidor.' : 'Agrega únicamente los nombres y saldos aprobados por la organización.'}</Empty> : <div className="table-card"><div className="table-scroll"><table><thead><tr><th>Nombre</th>{sheet === 'CUENTAS' && <><th>Responsable</th><th className="numeric">Saldo inicial</th><th className="numeric">Saldo actual</th></>}<th>Estado</th><th>Acciones</th></tr></thead><tbody>{data[current.key].map(item => <tr key={item.ID}><td><strong>{item.NOMBRE}</strong><span className="cell-secondary mono">{item.ID}</span></td>{sheet === 'CUENTAS' && <><td>{label(data.jefes, (item as AccountRow).JEFE)}</td><td className="numeric">{currency((item as AccountRow).SALDO_INICIAL)}</td><td className="numeric amount teal">{currency((item as AccountRow).SALDO_ACTUAL)}</td></>}<td><span className={`status ${item.ESTADO === 'Activo' ? 'paid' : 'void'}`}>{item.ESTADO}</span></td><td>{sheet === 'ESTADOS' ? <span className="muted">Protegido</span> : <button className="button secondary small" onClick={() => edit(item)}><Pencil size={14} /> Editar</button>}</td></tr>)}</tbody></table></div></div>}
    <div className="accounting-note"><span className="note-dot" /><p>Los cuatro estados contables del sistema no se pueden renombrar ni desactivar. Las cuentas con movimientos conservan su responsable y saldo inicial. No se eliminan registros históricos.</p></div>
    {row && <Modal title={`${row.ID ? 'Editar' : 'Agregar'} · ${current.title}`} onClose={() => { if (!busy) setRow(null); }} locked={busy}><form onSubmit={submit}><div className="modal-body">{error && <Alert>{error}</Alert>}<fieldset disabled={busy}><div className="form-grid two">
      <label className="span-full">Nombre<input required maxLength={150} value={row.NOMBRE} disabled={protectedState} onChange={e => setRow({ ...row, NOMBRE: e.target.value })} /></label>
      {sheet === 'CUENTAS' && <><label>Responsable<select required value={row.JEFE || ''} disabled={used} onChange={e => setRow({ ...row, JEFE: e.target.value })}><option value="">Seleccionar responsable</option><CatalogOptions rows={data.jefes} /></select></label><label>Saldo inicial (USD)<input required type="number" step="0.01" min="0" max="1000000000" disabled={used} value={Number.isFinite(row.SALDO_INICIAL) ? row.SALDO_INICIAL : ''} onChange={e => setRow({ ...row, SALDO_INICIAL: e.target.value === '' ? NaN : Number(e.target.value) })} /></label></>}
      <label>Estado<select value={row.ESTADO} disabled={protectedState} onChange={e => setRow({ ...row, ESTADO: e.target.value as 'Activo' | 'Inactivo' })}><option>Activo</option><option>Inactivo</option></select></label>
    </div></fieldset>{used && <p className="muted">Esta cuenta tiene movimientos: el responsable y el saldo inicial no pueden cambiar.</p>}</div><div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={() => setRow(null)}>Cancelar</button><button className="button" disabled={busy}><Check size={16} /> {busy ? 'Guardando...' : 'Guardar catálogo'}</button></div></form></Modal>}
  </>;
}
