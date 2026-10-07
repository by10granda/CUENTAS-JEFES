import { useState, type FormEvent } from 'react';
import { Plus, Pencil, Check } from 'lucide-react';
import { api, errorMessage } from './api';
import { Alert, Empty, Modal } from './components';
import type { Bootstrap, CatalogRow, CatalogSheet } from './types';

const tabs: { sheet: Exclude<CatalogSheet, 'CUENTAS'>; title: string; key: 'jefes' | 'categorias' | 'formasPago' | 'estados' }[] = [
  { sheet: 'JEFES', title: 'Responsables', key: 'jefes' },
  { sheet: 'CATEGORIAS', title: 'Categorías', key: 'categorias' }, { sheet: 'FORMAS_PAGO', title: 'Formas de pago', key: 'formasPago' }, { sheet: 'ESTADOS', title: 'Estados', key: 'estados' },
];
interface CatalogInput { ID?: string; UPDATED_AT?: string; NOMBRE: string; ESTADO: 'Activo' | 'Inactivo' }
export default function Catalogs({ data, onSaved }: { data: Bootstrap; onSaved: () => Promise<void> }) {
  const [sheet, setSheet] = useState<Exclude<CatalogSheet, 'CUENTAS'>>('JEFES');
  const [row, setRow] = useState<CatalogInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = tabs.find(tab => tab.sheet === sheet)!;
  function edit(existing?: CatalogRow) {
    if (sheet === 'ESTADOS') return;
    setError('');
    setRow(existing ? { ID: existing.ID, UPDATED_AT: existing.UPDATED_AT, NOMBRE: existing.NOMBRE, ESTADO: existing.ESTADO } : { NOMBRE: '', ESTADO: 'Activo' });
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!row || busy || sheet === 'ESTADOS') return;
    setBusy(true); setError('');
    try { await api('saveCatalog', { sheet, row }); setRow(null); await onSaved(); }
    catch (cause) { setError(`No se pudo guardar el catálogo. ${errorMessage(cause)}`); }
    finally { setBusy(false); }
  }
  return <><div className="catalog-intro"><h2>Una base ordenada para tus movimientos.</h2><p>Administra los datos reales de tu organización. Los registros inactivos permanecen disponibles para consultar el historial.</p></div>
    <div className="catalog-tabs" role="tablist" aria-label="Catálogos">{tabs.map(tab => <button role="tab" aria-selected={sheet === tab.sheet} key={tab.sheet} className={sheet === tab.sheet ? 'active' : ''} onClick={() => setSheet(tab.sheet)}>{tab.title}<span>{data[tab.key].length}</span></button>)}</div>
    <div className="section-title"><h2>{current.title}</h2>{sheet !== 'ESTADOS' && <button className="button" onClick={() => edit()}><Plus size={17} /> Agregar</button>}</div>
    {sheet === 'ESTADOS' && <Alert kind="info">Los estados son reglas contables del sistema, no un catálogo ampliable. No se pueden agregar estados personalizados ni cambiar los cuatro existentes. Una ampliación futura requiere implementar y validar nuevas reglas contables en el backend.</Alert>}
    {error && !row && <Alert>{error}</Alert>}
    {data[current.key].length === 0 ? <Empty title={`Sin ${current.title.toLowerCase()} registrados`} action={sheet !== 'ESTADOS' ? <button className="button secondary" onClick={() => edit()}>Agregar primer registro</button> : undefined}>{sheet === 'ESTADOS' ? 'Solicita al administrador que verifique la estructura y configuración del servidor.' : 'Agrega únicamente los nombres aprobados por la organización.'}</Empty> : <div className="table-card"><div className="table-scroll"><table><thead><tr><th>Nombre</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{data[current.key].map(item => <tr key={item.ID}><td><strong>{item.NOMBRE}</strong><span className="cell-secondary mono">{item.ID}</span></td><td><span className={`status ${item.ESTADO === 'Activo' ? 'paid' : 'void'}`}>{item.ESTADO}</span></td><td>{sheet === 'ESTADOS' ? <span className="muted">Protegido</span> : <button className="button secondary small" onClick={() => edit(item)}><Pencil size={14} /> Editar</button>}</td></tr>)}</tbody></table></div></div>}
    <div className="accounting-note"><span className="note-dot" /><p>Los cuatro estados contables del sistema no se pueden renombrar ni desactivar. No se eliminan registros históricos.</p></div>
    {row && <Modal title={`${row.ID ? 'Editar' : 'Agregar'} · ${current.title}`} onClose={() => { if (!busy) setRow(null); }} locked={busy}><form onSubmit={submit}><div className="modal-body">{error && <Alert>{error}</Alert>}<fieldset disabled={busy}><div className="form-grid two">
      <label className="span-full">Nombre<input required maxLength={150} value={row.NOMBRE} onChange={e => setRow({ ...row, NOMBRE: e.target.value })} /></label>
      <label>Estado<select value={row.ESTADO} onChange={e => setRow({ ...row, ESTADO: e.target.value as 'Activo' | 'Inactivo' })}><option>Activo</option><option>Inactivo</option></select></label>
    </div></fieldset></div><div className="modal-footer"><button type="button" className="button secondary" disabled={busy} onClick={() => setRow(null)}>Cancelar</button><button className="button" disabled={busy}><Check size={16} /> {busy ? 'Guardando...' : 'Guardar catálogo'}</button></div></form></Modal>}
  </>;
}
