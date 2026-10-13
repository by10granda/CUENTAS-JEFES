import { card, cardStatement, money } from './finance';
import { displayDate } from './display';
import type { Account } from './types';

export default function CardStatements({ accounts }: { accounts: Account[] }) {
  const cards = accounts.filter(a => card(a) && a.ESTADO === 'Activa');
  if (!cards.length) return null;
  return <section className="pf-panel" aria-label="Estados de tarjetas"><h2>Estados de tarjetas</h2><p>Avisos de tarjetas vigentes, independientes del filtro de movimientos. El saldo del estado ya forma parte de la deuda de tarjeta y puede coincidir con sus cuotas; no se suma otra vez a las obligaciones ni al efectivo.</p>
    {cards.map(a => { const s = cardStatement(a); return <div key={a.ID} className={s.overdue ? 'pf-error' : s.upcoming ? 'pf-warning' : 'pf-note'}><strong>{a.NOMBRE} · {s.status}</strong><p>{s.remaining === null ? 'Sin saldo de estado confirmado. Los dias mensuales son pronosticos, no deuda vencida.' : `Saldo del estado: ${money(s.remaining)} · Fecha maxima: ${displayDate(String(a.FECHA_MAXIMA_PAGO))}`}</p>{s.declared && <small>Corte del estado: {displayDate(String(a.FECHA_CORTE))}. Saldo calculado por el servidor; no es un pago automatico.</small>}</div>; })}
  </section>;
}
