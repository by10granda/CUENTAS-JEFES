import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { card, dashboardCharts, historicalCash, indicators, money } from './finance';
import { displayDate, displayMonth } from './display';
import type { Filters } from './finance';
import type { Movement, PersonalBootstrap, Quota } from './types';
import CardStatements from './CardStatements';

const colors = ['#2463eb', '#21946a', '#df8b27', '#d54b55', '#6b5cb2'];
export default function Dashboard({ data, selected, quotas, filters }: { data: PersonalBootstrap; selected: Movement[]; quotas: Quota[]; filters: Filters }) {
  const dates = [...new Set(data.movimientos.filter(m => m.ESTADO === 'Activo' && (!filters.from || m.FECHA >= filters.from) && (!filters.to || m.FECHA <= filters.to) && (!filters.month || m.FECHA.startsWith(filters.month)) && (!filters.year || m.FECHA.startsWith(filters.year))).map(m => m.FECHA))].sort();
  const cashAccounts = data.cuentas.filter(a => !card(a) && (!filters.bank || a.BANCO === filters.bank));
  const chart = dates.map(date => ({ date, saldo: historicalCash(cashAccounts, data.movimientos, date, filters.account) }));
  const charts = dashboardCharts(selected, quotas, data);
  const next = quotas.filter(q => q.PENDIENTE > 0 && q.ESTADO_ACTUAL !== 'Anulado').sort((a, b) => a.FECHA_VENCIMIENTO.localeCompare(b.FECHA_VENCIMIENTO)).slice(0, 5);
  const latest = [...selected].sort((a, b) => b.FECHA.localeCompare(a.FECHA) || b.UPDATED_AT.localeCompare(a.UPDATED_AT)).slice(0, 10);
  return <>
    <div className="pf-metrics">{indicators(data, selected, quotas).map(([title, value], i) => <article key={title} className={i === 0 ? 'pf-featured' : ''}><span>{title}</span><strong>{money(value)}</strong><small>{i === 0 || i === 7 ? 'Saldo backend actual, no limitado por filtros' : 'Seleccion actual; mes de la fecha del servidor'}</small></article>)}</div>
    <CardStatements accounts={data.cuentas} />
    <section className="pf-panel" aria-label="Saldo de efectivo a traves del tiempo"><h2>Saldo de efectivo a traves del tiempo</h2><p>Cuenta, banco y periodo seleccionados. Saldo inicial mas todos los asientos confirmados hasta cada fecha, incluso anteriores al periodo. Tarjetas excluidas; categoria, persona, metodo y estado no redefinen el saldo bancario.</p>
      {chart.length ? <div className="pf-chart"><ResponsiveContainer width="100%" height={260}><LineChart data={chart} margin={{ right: 12 }}><XAxis dataKey="date" tickFormatter={displayDate} minTickGap={30} tick={{ fontSize: 10 }} /><YAxis width={55} tick={{ fontSize: 10 }} /><Tooltip labelFormatter={v => displayDate(String(v))} formatter={v => money(Number(v))} /><Line name="Saldo USD" type="stepAfter" dataKey="saldo" stroke="#2463eb" dot={false} /></LineChart></ResponsiveContainer></div> : <p>No hay movimientos confirmados para graficar.</p>}
    </section>
    <div className="pf-two-panels">
      <section className="pf-panel" aria-label="Ingresos vs gastos mensuales"><h2>Ingresos vs gastos mensuales</h2><p>Movimientos activos de la seleccion. Gastos incluyen compras con tarjeta y comisiones, no transferencias ni pagos de tarjeta.</p>
        {charts.monthly.length ? <div className="pf-chart"><ResponsiveContainer width="100%" height={260}><BarChart data={charts.monthly}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tickFormatter={displayMonth} tick={{ fontSize: 10 }} /><YAxis width={55} tick={{ fontSize: 10 }} /><Tooltip labelFormatter={v => displayMonth(String(v))} formatter={v => money(Number(v))} /><Legend /><Bar name="Ingresos USD" dataKey="ingresos" fill="#21946a" /><Bar name="Gastos USD" dataKey="gastos" fill="#2463eb" /></BarChart></ResponsiveContainer><div className="pf-chart-values">{charts.monthly.map(r => <p key={r.month}>{displayMonth(r.month)}: ingresos {money(r.ingresos)} · gastos {money(r.gastos)}</p>)}</div></div> : <p>No hay ingresos ni gastos en esta seleccion.</p>}
      </section>
      <section className="pf-panel" aria-label="Gastos por categoria"><h2>Gastos por categoria</h2><p>Gastos y compras con tarjeta confirmados. Sin principal de transferencias ni segundo gasto por pagar una tarjeta.</p>
        <Distribution rows={charts.categories} />
      </section>
      <section className="pf-panel" aria-label="Pagos por metodo"><h2>Pagos por metodo</h2><p>Eventos confirmados en USD: gastos pagados, pagos de tarjetas y pagos vinculados a cuotas. Cada movimiento cuenta una vez, aunque tenga varias asignaciones. Compras con tarjeta sin pago de cuota no son eventos de pago.</p>
        <Distribution rows={charts.methods} events />
      </section>
      <section className="pf-panel" aria-label="Obligaciones pagadas vs pendientes"><h2>Obligaciones pagadas vs pendientes</h2><p>Importes de las cuotas seleccionadas, sin anuladas. Pagado usa todas sus asignaciones activas; un abono parcial divide el importe entre pagado y pendiente. No es un nuevo gasto.</p>
        <Distribution rows={charts.settlement} />
      </section>
    </div>
    <div className="pf-two-panels"><section className="pf-panel"><h2>Proximos 5 vencimientos</h2>{next.map(q => <p className="pf-list-line" key={q.ID}><span>{displayDate(q.FECHA_VENCIMIENTO)} · {q.TITULO}</span><strong>{money(q.PENDIENTE)}</strong></p>)}{!next.length && <p>No hay obligaciones pendientes en esta seleccion.</p>}</section>
      <section className="pf-panel"><h2>Ultimos 10 movimientos</h2>{latest.map(m => <p className="pf-list-line" key={m.ID}><span>{displayDate(m.FECHA)} · {m.DESCRIPCION} · {m.TIPO}</span><strong>{money(m.MONTO)}</strong></p>)}{!latest.length && <p>No hay movimientos registrados.</p>}</section></div>
  </>;
}

function Distribution({ rows, events = false }: { rows: { name: string; amount: number; events?: number }[]; events?: boolean }) {
  if (!rows.length) return <p>No hay registros confirmados en esta seleccion.</p>;
  return <div className="pf-chart"><ResponsiveContainer width="100%" height={240}><PieChart><Pie data={rows} dataKey="amount" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>{rows.map((r, i) => <Cell key={r.name} fill={colors[i % colors.length]} />)}</Pie><Tooltip formatter={v => money(Number(v))} /></PieChart></ResponsiveContainer>
    <div className="pf-chart-values">{rows.map((r, i) => <p key={r.name}><span className="pf-chart-key" style={{ background: colors[i % colors.length] }} aria-hidden="true" />{r.name}: {money(r.amount)}{events ? ` · ${r.events} ${r.events === 1 ? 'evento' : 'eventos'}` : ''}</p>)}</div>
  </div>;
}
