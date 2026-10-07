import type { ReactNode } from 'react';
import { ArrowDownLeft, ArrowUpRight, Wallet, ShoppingBag, ReceiptText, Clock3, Users } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, AreaChart, Area } from 'recharts';
import type { Bootstrap, Filters, Movement } from './types';
import { accountBalance, availableBalance, balanceEvolution, cashFlow, currency, displayDate, expenseEvolution, isExpense, isLive, roundMoney, summarizeMovements } from './finance';
import { Empty, label } from './components';

const colors = ['#19716b', '#426b83', '#c79b54', '#83b3a5', '#94a6b5', '#b38475', '#445b53'];
const tooltipFormat = (value: unknown) => currency(Number(value));
const axisFormat = (value: number) => Math.abs(value) >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
function ChartCard({ title, subtitle, children, empty, wide = false }: { title: string; subtitle: string; children: ReactNode; empty: boolean; wide?: boolean }) {
  return <section className={`chart-card ${wide ? 'chart-wide' : ''}`}><div className="section-head"><div><h3>{title}</h3><p>{subtitle}</p></div></div>{empty ? <div className="chart-empty">Sin datos para este período</div> : <div className="chart-body">{children}</div>}</section>;
}
function grouped(rows: Movement[], key: (m: Movement) => string, amount: (m: Movement) => number) {
  const groups = new Map<string, number>();
  rows.forEach(m => { const name = key(m); groups.set(name, (groups.get(name) || 0) + amount(m)); });
  return [...groups].map(([name, value]) => ({ name, value: roundMoney(value) })).filter(item => item.value > 0).sort((a, b) => b.value - a.value);
}
export default function Dashboard({ data, ledger, selected, filters, onCreate, onConfigure }: { data: Bootstrap; ledger: Movement[]; selected: Movement[]; filters: Filters; onCreate: () => void; onConfigure: () => void }) {
  const summary = summarizeMovements(selected, ledger);
  const expenses = selected.filter(m => isLive(m) && isExpense(m));
  const live = selected.filter(isLive);
  const categories = grouped(expenses, m => label(data.categorias, m.CATEGORIA), m => m.TOTAL);
  const persons = grouped(expenses, m => label(data.jefes, m.JEFE), m => m.TOTAL);
  const payments = grouped(live, m => label(data.formasPago, m.FORMA_PAGO), m => cashFlow(m).expense);
  const months = new Map<string, { name: string; ingresos: number; egresos: number; gastos: number }>();
  for (const m of live) {
    const key = m.FECHA.slice(0, 7);
    const item = months.get(key) || { name: key, ingresos: 0, egresos: 0, gastos: 0 };
    const flow = cashFlow(m); item.ingresos = roundMoney(item.ingresos + flow.income); item.egresos = roundMoney(item.egresos + flow.expense);
    if (isExpense(m)) item.gastos = roundMoney(item.gastos + m.TOTAL);
    months.set(key, item);
  }
  const monthly = [...months.values()].sort((a, b) => a.name.localeCompare(b.name));
  const evolution = balanceEvolution(data.cuentas, ledger, filters);
  const expensesOverTime = expenseEvolution(selected);
  const available = availableBalance(data.cuentas, ledger, filters);
  const people = data.jefes.filter(row => (!filters.jefe || row.ID === filters.jefe) && (!filters.cuenta || data.cuentas.some(a => a.ID === filters.cuenta && a.JEFE === row.ID)));
  const indicators = [
    { title: 'Gasto', value: summary.gasto, icon: ReceiptText, note: 'Obligaciones independientes' },
    { title: 'Compra', value: summary.compra, icon: ShoppingBag, note: 'Total de compras registradas' },
    { title: 'Pago', value: summary.pago, icon: ArrowUpRight, note: 'Solo pagos independientes' },
    { title: 'Pendiente', value: summary.pendiente, icon: Clock3, note: 'Saldo actual por liquidar' },
    { title: 'Disponible', value: available, icon: Wallet, note: filters.hasta ? `Al ${displayDate(filters.hasta)}` : 'Historial completo', accent: true },
  ];
  return <>
    <div className="indicator-grid">{indicators.map(item => <section className={`indicator ${item.accent ? 'accent' : ''}`} key={item.title}><div className="indicator-top"><span>{item.title}</span><item.icon size={18} /></div><strong>{currency(item.value)}</strong><p>{item.note}</p></section>)}</div>
    <div className="accounting-note"><span className="note-dot" /><p>Gasto, Compra y Pago cuentan cada obligación una sola vez. Los pagos vinculados no se duplican. <strong>Disponible</strong> considera saldos iniciales e historial hasta la fecha final; solo responde a responsable y cuenta, no a los demás filtros. El pendiente considera todos los pagos, incluso posteriores al período.</p></div>
    {!data.cuentas.length && <Empty title="Empieza con tus cuentas reales" action={<button className="button" onClick={onConfigure}>Configurar catálogos</button>}>Registra responsables y cuentas con sus saldos iniciales. No se generan importes ni movimientos automáticamente.</Empty>}
    {!!data.cuentas.length && !ledger.length && <Empty title="Tus cuentas están listas" action={<button className="button" onClick={onCreate}>Registrar primer movimiento</button>}>El panel se construirá con los movimientos que registres.</Empty>}
    <div className="section-title"><div><span className="eyebrow">DISTRIBUCIÓN DE FONDOS</span><h2>Por responsable</h2></div><span className="section-meta"><Users size={15} /> {people.length} responsables</span></div>
    <div className="person-grid">{people.map(person => {
      const accounts = data.cuentas.filter(a => a.JEFE === person.ID && (!filters.cuenta || a.ID === filters.cuenta));
      const personSummary = summarizeMovements(selected.filter(m => m.JEFE === person.ID), ledger);
      return <section className="person-card" key={person.ID}><div className="person-head"><span className="avatar">{person.NOMBRE.split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('')}</span><div><h3>{person.NOMBRE}</h3><p>{accounts.length} cuentas{person.ESTADO === 'Inactivo' ? ' · Inactivo' : ''}</p></div></div><span className="muted">Disponible{filters.hasta ? ` al ${displayDate(filters.hasta)}` : ''}</span><strong className="person-balance">{currency(accounts.reduce((sum, a) => sum + accountBalance(a, ledger, filters.hasta), 0))}</strong><div className="person-bottom"><span>Gastos <b>{currency(personSummary.gasto)}</b></span><span>Compras <b>{currency(personSummary.compra)}</b></span><span title="Solo pagos independientes, sin duplicar abonos vinculados">Pagos <b>{currency(personSummary.pago)}</b></span><span>Pendiente <b>{currency(personSummary.pendiente)}</b></span></div></section>;
    })}</div>
    <div className="section-title"><div><span className="eyebrow">LECTURA FINANCIERA</span><h2>En perspectiva</h2></div><span className="section-meta">{summary.cantidad} movimientos vigentes seleccionados</span></div>
    <div className="charts-grid">
      <ChartCard title="Gastos por categoría" subtitle="Obligaciones, sin duplicar pagos vinculados" empty={!categories.length}><ResponsiveContainer width="100%" height="100%"><BarChart data={categories} layout="vertical" margin={{ left: 5, right: 25 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickFormatter={axisFormat} /><YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} /><Tooltip formatter={tooltipFormat} /><Bar dataKey="value" name="Gastos" fill={colors[0]} radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Gastos por responsable" subtitle="Importes del período seleccionado" empty={!persons.length}><ResponsiveContainer width="100%" height="100%"><BarChart data={persons} margin={{ left: 0, right: 10 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tickFormatter={axisFormat} /><Tooltip formatter={tooltipFormat} /><Bar dataKey="value" name="Gastos" fill={colors[1]} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Gastos y flujo mensual" subtitle="Gastos: obligaciones independientes · Ingresos y egresos: efectivo" empty={!monthly.length}><ResponsiveContainer width="100%" height="100%"><BarChart data={monthly}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tickFormatter={axisFormat} /><Tooltip formatter={tooltipFormat} /><Legend /><Bar dataKey="gastos" name="Gastos (obligaciones)" fill={colors[1]} radius={[3, 3, 0, 0]} /><Bar dataKey="ingresos" name="Ingresos" fill={colors[0]} radius={[3, 3, 0, 0]} /><Bar dataKey="egresos" name="Egresos" fill={colors[2]} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Formas de pago" subtitle="Egresos efectivos, no importes pendientes" empty={!payments.length}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={payments} dataKey="value" nameKey="name" innerRadius="48%" outerRadius="76%" paddingAngle={3}>{payments.map((item, index) => <Cell key={item.name} fill={colors[index % colors.length]} />)}</Pie><Tooltip formatter={tooltipFormat} /><Legend /></PieChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Evolución de gastos" subtitle="Acumulado de obligaciones seleccionadas · Todos los filtros · Sin duplicar pagos vinculados" empty={!expensesOverTime.length} wide><ResponsiveContainer width="100%" height="100%"><AreaChart data={expensesOverTime} margin={{ left: 10, right: 20 }}><defs><linearGradient id="expenses-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#426b83" stopOpacity={0.2} /><stop offset="100%" stopColor="#426b83" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="fecha" tickFormatter={displayDate} minTickGap={45} tick={{ fontSize: 11 }} /><YAxis tickFormatter={axisFormat} /><Tooltip formatter={tooltipFormat} labelFormatter={value => displayDate(String(value))} /><Area type="stepAfter" dataKey="gastos" name="Gastos acumulados" stroke="#426b83" strokeWidth={2} fill="url(#expenses-fill)" /></AreaChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Evolución del disponible" subtitle="Historial completo · Solo responsable, cuenta y fecha final" empty={!evolution.length} wide><ResponsiveContainer width="100%" height="100%"><AreaChart data={evolution} margin={{ left: 10, right: 20 }}><defs><linearGradient id="balance-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#19716b" stopOpacity={0.2} /><stop offset="100%" stopColor="#19716b" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="fecha" tickFormatter={displayDate} minTickGap={45} tick={{ fontSize: 11 }} /><YAxis tickFormatter={axisFormat} /><Tooltip formatter={tooltipFormat} labelFormatter={value => displayDate(String(value))} /><Area type="monotone" dataKey="saldo" name="Disponible" stroke="#19716b" strokeWidth={2} fill="url(#balance-fill)" /></AreaChart></ResponsiveContainer></ChartCard>
    </div><div className="flow-strip"><span><ArrowDownLeft size={17} /> Ingresos efectivos <strong>{currency(summary.ingresos)}</strong></span><span><ArrowUpRight size={17} /> Egresos efectivos <strong>{currency(summary.egresos)}</strong></span><span>Neto del período <strong>{currency(summary.ingresos - summary.egresos)}</strong></span></div>
  </>;
}
