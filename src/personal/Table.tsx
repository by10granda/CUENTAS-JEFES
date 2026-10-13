import { useEffect, useState, type ReactNode } from 'react';
import type { Row } from './types';
export interface Column { title: string; render: (row: Row) => ReactNode }
export default function Table({ rows, columns, actions }: { rows: Row[]; columns: Column[]; actions?: (row: Row) => ReactNode }) {
  const [page, setPage] = useState(0); const last = Math.max(0, Math.ceil(rows.length / 20) - 1); const current = Math.min(page, last);
  useEffect(() => { setPage(0); }, [rows]);
  return <section className="pf-table-panel">{!rows.length ? <div className="pf-empty"><h2>Sin registros en esta seleccion</h2><p>No se muestran datos de ejemplo. Crea un registro real o limpia los filtros.</p></div> : <><div className="pf-table-scroll" role="region" aria-label="Registros financieros, tabla desplazable" tabIndex={0}><table><thead><tr>{columns.map(c => <th key={c.title} scope="col">{c.title}</th>)}{actions && <th scope="col">Acciones</th>}</tr></thead><tbody>{rows.slice(current * 20, (current + 1) * 20).map(r => <tr key={r.ID}>{columns.map(c => <td key={c.title}>{c.render(r)}</td>)}{actions && <td><div className="pf-row-actions">{actions(r)}</div></td>}</tr>)}</tbody></table></div><div className="pf-pagination"><span>{rows.length} registros · Pagina {current + 1} de {last + 1}</span><button disabled={!current} onClick={() => setPage(current - 1)}>Anterior</button><button disabled={current >= last} onClick={() => setPage(current + 1)}>Siguiente</button></div></>}</section>;
}
