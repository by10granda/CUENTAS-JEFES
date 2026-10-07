import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Search, SlidersHorizontal, RotateCcw, X, Inbox, Eye, Pencil, Ban, ArrowUpRight } from 'lucide-react';
import type { Bootstrap, CatalogRow, Filters, Movement } from './types';
import { currency, displayDate, effectiveState, emptyFilters, linkedPaid, paidAmount, pendingAmount } from './finance';

export function label(rows: CatalogRow[], id: string) { return rows.find(row => row.ID === id)?.NOMBRE || id || 'Sin asignar'; }
export function Alert({ children, kind = 'error' }: { children: ReactNode; kind?: 'error' | 'success' | 'info' }) {
  return <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}
export function Empty({ title = 'No hay movimientos', children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty"><div className="empty-icon"><Inbox size={28} /></div><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function Modal({ title, children, onClose, wide = false, locked = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; locked?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const lockedRef = useRef(locked);
  closeRef.current = onClose;
  lockedRef.current = locked;
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !lockedRef.current) closeRef.current();
      if (event.key === 'Tab') {
        const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') || []);
        const first = items[0], last = items[items.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop"><div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref}>
    <div className="modal-head"><h2 id={titleId}>{title}</h2><button className="icon-button" onClick={onClose} disabled={locked} aria-label="Cerrar ventana"><X size={21} /></button></div>{children}
  </div></div>;
}
export function CatalogOptions({ rows }: { rows: CatalogRow[] }) {
  return <>{rows.filter(row => row.ESTADO === 'Activo').map(row => <option key={row.ID} value={row.ID}>{row.NOMBRE}</option>)}</>;
}
export function FilterBar({ data, ledger, filters, onChange }: { data: Bootstrap; ledger: Movement[]; filters: Filters; onChange: (filters: Filters) => void }) {
  const [expanded, setExpanded] = useState(false);
  const update = (name: keyof Filters, value: string) => onChange({ ...filters, [name]: value, cuenta: '' });
  const count = Object.entries(filters).filter(([key, value]) => key !== 'buscar' && key !== 'cuenta' && value).length;
  const providers = [...new Set(ledger.map(m => m.PROVEEDOR).filter((value): value is string => !!value))].sort();
  const invalid = !!filters.desde && !!filters.hasta && filters.desde > filters.hasta;
  return <section className="filter-panel" aria-label="Filtros compartidos">
    <div className="filter-top"><label className="search"><Search size={18} /><input aria-label="Buscar movimientos" placeholder="Buscar ID, descripción, proveedor, factura..." value={filters.buscar} onChange={e => update('buscar', e.target.value)} /></label>
      <button className={`button ${expanded || count ? 'selected' : 'secondary'}`} onClick={() => setExpanded(!expanded)} aria-expanded={expanded}><SlidersHorizontal size={17} /> Filtros {count > 0 && <span className="count">{count}</span>}<ChevronDown size={14} /></button>
      {(count > 0 || filters.buscar) && <button className="button text" onClick={() => onChange(emptyFilters())}><RotateCcw size={15} /> Limpiar</button>}
    </div>
    {expanded && <div className="filter-grid">
      <label>Desde<input type="date" value={filters.desde} onChange={e => update('desde', e.target.value)} /></label>
      <label>Hasta<input type="date" min={filters.desde || undefined} value={filters.hasta} onChange={e => update('hasta', e.target.value)} /></label>
      <label>Responsable<select value={filters.jefe} onChange={e => update('jefe', e.target.value)}><option value="">Todos los jefes</option>{data.jefes.map(row => <option key={row.ID} value={row.ID}>{row.NOMBRE}</option>)}</select></label>
      <label>Categoría<select value={filters.categoria} onChange={e => update('categoria', e.target.value)}><option value="">Todas las categorías</option>{data.categorias.map(row => <option key={row.ID} value={row.ID}>{row.NOMBRE}</option>)}</select></label>
      <label>Tipo<select value={filters.tipo} onChange={e => update('tipo', e.target.value)}><option value="">Todos los tipos</option>{data.tipos.map(tipo => <option key={tipo}>{tipo}</option>)}</select></label>
      <label>Estado actual<select value={filters.estado} onChange={e => update('estado', e.target.value)}><option value="">Todos los estados</option>{data.estados.map(row => <option key={row.ID}>{row.NOMBRE}</option>)}</select><small>Considera todos los pagos vinculados.</small></label>
      <label>Forma de pago<select value={filters.formaPago} onChange={e => update('formaPago', e.target.value)}><option value="">Todas las formas</option>{data.formasPago.map(row => <option key={row.ID} value={row.ID}>{row.NOMBRE}</option>)}</select></label>
      <label>Proveedor<select value={filters.proveedor} onChange={e => update('proveedor', e.target.value)}><option value="">Todos los proveedores</option>{providers.map(provider => <option key={provider}>{provider}</option>)}</select></label>
    </div>}
    {invalid && <Alert>La fecha inicial no puede ser posterior a la fecha final.</Alert>}
    {count > 0 && !expanded && <p className="filter-caption">Hay filtros aplicados. Se conservan al cambiar entre resumen, movimientos, pendientes y reportes.{filters.estado && ' El estado filtrado es el actual calculado, no el registrado originalmente.'}</p>}
  </section>;
}
export function Status({ movement, ledger }: { movement: Movement; ledger: Movement[] }) {
  const current = effectiveState(movement, ledger);
  return <span className={`status ${current === 'Pagado' ? 'paid' : current === 'Anulado' ? 'void' : 'pending'}`} title={`Estado registrado: ${movement.ESTADO}`}>{current}</span>;
}
export function MovementTable({ rows, ledger, data, onView, onEdit, onVoid, onPay, pending = false }: {
  rows: Movement[]; ledger: Movement[]; data: Bootstrap;
  onView: (m: Movement) => void; onEdit: (m: Movement) => void; onVoid: (m: Movement) => void; onPay: (m: Movement) => void; pending?: boolean;
}) {
  const [page, setPage] = useState(1);
  const signature = rows.map(row => row.ID).join('|');
  useEffect(() => { setPage(1); }, [signature]);
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  const sorted = [...rows].sort((a, b) => `${b.FECHA} ${b.HORA} ${b.ID}`.localeCompare(`${a.FECHA} ${a.HORA} ${a.ID}`));
  return <div className="table-card"><div className="table-scroll" tabIndex={0} role="region" aria-label={pending ? 'Obligaciones pendientes, tabla con desplazamiento horizontal' : 'Movimientos, tabla con desplazamiento horizontal'}><table className="movement-table"><thead><tr>
    <th>Fecha / ID</th><th>Responsable</th><th>Movimiento / categoría</th><th>Proveedor / factura</th><th>Forma de pago</th><th className="numeric">Total</th>
    {pending && <><th className="numeric">Pagado</th><th className="numeric">Pendiente</th></>}<th>Estado actual</th><th>Comprobante</th><th className="actions-col">Acciones</th>
  </tr></thead><tbody>{sorted.slice((page - 1) * 20, page * 20).map(m => {
    const blocked = m.ESTADO === 'Anulado' || linkedPaid(m, ledger) > 0;
    const receipt = safeReceiptUrl(m.COMPROBANTE_URL);
    return <tr key={m.ID}><td><strong>{displayDate(m.FECHA)}</strong><span className="cell-secondary mono" title={m.ID}>{m.ID.slice(0, 12)}</span></td>
      <td><strong>{label(data.jefes, m.JEFE)}</strong></td>
      <td className="description-cell"><strong>{m.TIPO}{m.DIRECCION && ` · ${m.DIRECCION}`}{m.MOVIMIENTO_ORIGEN_ID && <span className="linked-tag">Vinculado</span>}</strong><span className="cell-secondary">{m.DESCRIPCION || 'Sin descripción'}</span><small>Categoría: {label(data.categorias, m.CATEGORIA)}{m.SUBCATEGORIA && ` / ${m.SUBCATEGORIA}`}</small></td>
      <td className="provider-cell"><strong>{m.PROVEEDOR || 'Sin proveedor'}</strong><span className="cell-secondary">{(m.NUMERO_FACTURA || m.FACTURA) ? `Factura: ${m.NUMERO_FACTURA || m.FACTURA}` : 'Sin factura'}</span></td>
      <td>{label(data.formasPago, m.FORMA_PAGO)}</td>
      <td className="numeric amount">{currency(m.TOTAL)}</td>{pending && <><td className="numeric">{currency(paidAmount(m, ledger))}</td><td className="numeric amount teal">{currency(pendingAmount(m, ledger))}</td></>}
      <td><Status movement={m} ledger={ledger} />{effectiveState(m, ledger) !== m.ESTADO && <span className="cell-secondary">Registrado: {m.ESTADO}</span>}</td>
      <td>{receipt ? <a className="table-receipt" href={receipt} target="_blank" rel="noopener noreferrer" aria-label={`Abrir comprobante de ${m.ID}`}>Ver comprobante<ArrowUpRight size={13} /></a> : <span className="cell-secondary">Sin comprobante</span>}</td>
      <td><div className="row-actions"><button className="icon-button" title="Ver detalle" aria-label={`Ver ${m.ID}`} onClick={() => onView(m)}><Eye size={17} /></button>
        {pending ? <button className="button small" onClick={() => onPay(m)}>Pagar<ArrowUpRight size={14} /></button> : <><button className="icon-button" disabled={blocked} title={blocked ? 'Anulado o con pagos vinculados: no se puede editar' : 'Editar'} aria-label={`Editar ${m.ID}`} onClick={() => onEdit(m)}><Pencil size={16} /></button><button className="icon-button danger" disabled={blocked} title={blocked ? 'Anulado o con pagos vinculados: no se puede anular' : 'Anular'} aria-label={`Anular ${m.ID}`} onClick={() => onVoid(m)}><Ban size={16} /></button></>}
      </div></td></tr>;
  })}</tbody></table></div><div className="pagination"><span>{rows.length} registros · Página {page} de {pages}</span><div><button className="button secondary small" onClick={() => setPage(page - 1)} disabled={page <= 1}>Anterior</button><button className="button secondary small" onClick={() => setPage(page + 1)} disabled={page >= pages}>Siguiente</button></div></div></div>;
}
export function safeReceiptUrl(value: string | undefined): string | null {
  if (!value || /\s/.test(value)) return null;
  return /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/(?:view|preview)(?:\?[A-Za-z0-9_=%&.~+\-]*)?$/.test(value) ||
    /^https:\/\/drive\.google\.com\/open\?id=[A-Za-z0-9_-]+(?:&[A-Za-z0-9_=%&.~+\-]*)?$/.test(value) ? value : null;
}
export function MovementDetail({ movement: m, ledger, data }: { movement: Movement; ledger: Movement[]; data: Bootstrap }) {
  const fields: [string, ReactNode][] = [
    ['ID', m.ID], ['Fecha y hora', `${displayDate(m.FECHA)} · ${m.HORA}`], ['Tipo', m.TIPO], ['Responsable', label(data.jefes, m.JEFE)],
    ['Categoría', label(data.categorias, m.CATEGORIA)], ['Subcategoría', m.SUBCATEGORIA], ['Forma de pago', label(data.formasPago, m.FORMA_PAGO)],
    ['Estado registrado', m.ESTADO], ['Estado actual', <Status movement={m} ledger={ledger} />], ['Proveedor', m.PROVEEDOR], ['Factura', m.NUMERO_FACTURA || m.FACTURA],
    ['Descripción', m.DESCRIPCION], ['Observaciones', m.OBSERVACIONES], ['Cantidad', m.CANTIDAD], ['Valor unitario', currency(m.VALOR_UNITARIO)],
    ['Subtotal', currency(m.SUBTOTAL ?? m.CANTIDAD * m.VALOR_UNITARIO)], ['Total (IVA incluido)', currency(m.TOTAL)], ['Total manual', m.TOTAL_MANUAL ? 'Sí' : 'No'],
    ['Pago propio', currency(m.PAGADO)], ['Pagos vinculados', currency(linkedPaid(m, ledger))], ['Saldo pendiente', currency(pendingAmount(m, ledger))],
    ['Dirección', m.DIRECCION], ['Movimiento de origen', m.MOVIMIENTO_ORIGEN_ID],
    ['Usuario de registro', m.USUARIO_REGISTRO || m.CREADO_POR], ['Creado por', m.CREADO_POR], ['Creación', m.CREATED_AT], ['Actualizado por', m.ACTUALIZADO_POR], ['Última actualización', m.UPDATED_AT],
    ['Clave de idempotencia', m.CLAVE_IDEMPOTENCIA],
  ];
  const receipt = safeReceiptUrl(m.COMPROBANTE_URL);
  return <div className="modal-body"><dl className="detail-grid">{fields.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value ?? 'No registrado'}</dd></div>)}</dl>{receipt && <a className="button secondary" href={receipt} target="_blank" rel="noopener noreferrer">Abrir comprobante<ArrowUpRight size={16} /></a>}<p className="muted">El estado actual considera todos los pagos vinculados, incluso fuera del período seleccionado. Los registros anulados no afectan la inversión ni las obligaciones.</p></div>;
}
