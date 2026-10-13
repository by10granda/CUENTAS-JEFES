import { useState } from 'react';
import { calendarCells, card, cardStatement, dateAdd, monthlyDate, money } from './finance';
import { displayDate, displayMonth } from './display';
import type { PersonalBootstrap, Quota } from './types';

export default function Calendar({ data, quotas, onPay }: { data: PersonalBootstrap; quotas: Quota[]; onPay: (q: Quota) => void }) {
  const [month, setMonth] = useState(data.hoy.slice(0, 7));
  const cards = data.cuentas.filter(a => card(a) && a.ESTADO === 'Activa');
  return <section className="pf-calendar">
    <div className="pf-actions"><button aria-label="Mes anterior" onClick={() => setMonth(dateAdd(`${month}-01`, -1).slice(0, 7))}>Anterior</button><h2>{displayMonth(month)}</h2><button aria-label="Mes siguiente" onClick={() => setMonth(dateAdd(`${month}-28`, 5).slice(0, 7))}>Siguiente</button></div>
    <p>Cuotas reales y estados de tarjeta declarados, sin pagos automaticos. El saldo del estado puede coincidir con cuotas de tarjeta: no se suma otra vez. Sin estado confirmado, los dias mensuales son solo avisos azules y no declaran deuda vencida.</p>
    <div className="pf-calendar-grid">{['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'].map(d => <strong key={d}>{d}</strong>)}
      {calendarCells(month).map(day => <div key={day} className={`pf-day ${day.slice(0, 7) !== month ? 'pf-other-month' : ''}`}>
        <time dateTime={day} title={displayDate(day)} aria-label={displayDate(day)}>{Number(day.slice(-2))}</time>
        {quotas.filter(q => q.FECHA_VENCIMIENTO === day).map(q => <button key={q.ID} className={`pf-event ${q.ESTADO_ACTUAL === 'Pagado' ? 'pf-green' : q.ESTADO_ACTUAL === 'Anulado' ? 'pf-blue' : q.PENDIENTE > 0 && day < data.hoy ? 'pf-red' : q.PAGADO > 0 ? 'pf-orange' : 'pf-yellow'}`} onClick={() => q.PENDIENTE > 0 && q.ESTADO_ACTUAL !== 'Anulado' && onPay(q)} title={`${displayDate(day)} | ${q.TITULO} | ${q.ESTADO_ACTUAL} | ${money(q.PENDIENTE)}`}>{q.TITULO}<small>{q.ESTADO_ACTUAL} · {money(q.PENDIENTE)}</small></button>)}
        {cards.map(a => {
          const s = cardStatement(a);
          if (s.declared && a.FECHA_CORTE !== day && a.FECHA_MAXIMA_PAGO !== day) return null;
          if (s.declared) return <div key={a.ID}>
            {a.FECHA_CORTE === day && <span className="pf-event pf-blue" title={displayDate(day)}>Corte del estado {a.NOMBRE}<small>Fecha declarada, no pago</small></span>}
            {a.FECHA_MAXIMA_PAGO === day && <span className={`pf-event ${s.overdue ? 'pf-red' : s.remaining === 0 ? 'pf-green' : s.upcoming ? 'pf-orange' : 'pf-blue'}`} role="note" aria-label={`Estado ${a.NOMBRE}: ${s.status}, ${displayDate(day)}`} title={displayDate(day)}>Estado {a.NOMBRE}<small>{s.status} · {money(s.remaining!)} · Saldo del estado</small></span>}
          </div>;
          return ['DIA_CORTE', 'DIA_PAGO'].filter(k => Number(a[k]) > 0 && monthlyDate(day.slice(0, 7), Number(a[k])) === day).map(k => <span className="pf-event pf-blue" key={`${a.ID}${k}`} title={displayDate(day)}>{k === 'DIA_CORTE' ? 'Corte previsto' : 'Pago previsto'} {a.NOMBRE}<small>Solo pronostico; no deuda vencida</small></span>);
        })}
      </div>)}
    </div>
  </section>;
}
