import { card, postings } from './finance';
import type { Draft, Field, PersonalBootstrap, Row, Sheet, Value, WriteAction } from './types';
const options = (values: string[]) => values.map(value => ({ value, label: value }));
const text = (key: string, label: string, required = false): Field => ({ key, label, required });
const amount = (key: string, label: string, required = false, min = 0): Field => ({ key, label, required, type: 'number', min, max: 1e9, step: 0.01 });
const date = (key: string, label: string, required = false): Field => ({ key, label, required, type: 'date' });
const select = (key: string, label: string, values: string[], required = false): Field => ({ key, label, required, type: 'select', options: options(values) });
const day = (key: string, label: string): Field => ({ key, label, type: 'number', min: 1, max: 31, step: 1 });
export const frequencies = ['Semanal', 'Quincenal', 'Mensual', 'Trimestral', 'Semestral', 'Anual', 'Pago \u00fanico'];
export function reference(key: string, label: string, rows: Row[], required = false): Field { return { key, label, type: 'select', required, options: rows.map(r => ({ value: r.ID, label: String(r.NOMBRE || r.TITULO || r.ID) })) }; }
export function active(rows: Row[]) { return rows.filter(r => ['Activa', 'Activo'].includes(String(r.ESTADO))); }
export function catalogFields(sheet: Sheet, data: PersonalBootstrap): Field[] {
  const refs = [reference('BENEFICIARIO', 'Persona o empresa', active(data.beneficiarios)), reference('CATEGORIA', 'Categor\u00eda de gasto (recomendada)', active(data.categorias).filter(r => r.TIPO === 'Gasto'))];
  if (sheet === 'Cuentas') return [text('NOMBRE', 'Nombre', true), select('TIPO', 'Tipo', ['Ahorros', 'Corriente', 'Efectivo', 'Tarjeta de cr\u00e9dito', 'Otra'], true), select('MONEDA', 'Moneda', ['USD'], true), text('BANCO', 'Banco'), text('TITULAR', 'Titular'), { ...text('IDENTIFICADOR', 'Identificador / solo 4 d\u00edgitos en tarjeta'), maxLength: 100 }, amount('SALDO_INICIAL', 'Saldo inicial (ingresado expl\u00edcitamente)'), amount('DEUDA_INICIAL', 'Deuda inicial'), amount('LIMITE_CREDITO', 'L\u00edmite de cr\u00e9dito'), date('FECHA_APERTURA', 'Fecha de apertura'), day('DIA_CORTE', 'D\u00eda de corte'), day('DIA_PAGO', 'D\u00eda de pago'), date('FECHA_CORTE', 'Fecha de corte del estado'), date('FECHA_MAXIMA_PAGO', 'Fecha maxima de pago del estado'), amount('PAGO_MINIMO', 'Pago m\u00ednimo del estado'), amount('PAGO_TOTAL_ESTADO', 'Pago total del estado'), select('ESTADO', 'Estado', ['Activa', 'Inactiva']), text('OBSERVACIONES', 'Observaciones')];
  if (sheet === 'Beneficiarios') return [text('NOMBRE', 'Nombre', true), select('TIPO', 'Tipo', ['Persona', 'Empresa', 'Entidad financiera'], true), ...['IDENTIFICACION', 'TELEFONO', 'EMAIL', 'BANCO_DESTINO', 'CUENTA_DESTINO', 'CONCEPTO'].map(k => text(k, ({ IDENTIFICACION: 'Identificaci\u00f3n', TELEFONO: 'Tel\u00e9fono', EMAIL: 'Email', BANCO_DESTINO: 'Banco destino', CUENTA_DESTINO: 'Cuenta destino', CONCEPTO: 'Concepto' } as Record<string, string>)[k])), amount('VALOR', 'Valor habitual'), select('FRECUENCIA', 'Frecuencia', frequencies), day('DIA_VENCIMIENTO', 'D\u00eda de vencimiento'), select('ESTADO', 'Estado', ['Activo', 'Inactivo']), text('OBSERVACIONES', 'Observaciones')];
  if (sheet === 'Categorias') return [text('NOMBRE', 'Nombre', true), select('TIPO', 'Clasificaci\u00f3n', ['Ingreso', 'Gasto'], true), select('ESTADO', 'Estado', ['Activa', 'Inactiva'])];
  if (sheet === 'Obligaciones') return [text('TITULO', 'T\u00edtulo', true), amount('MONTO', 'Monto', true, 0.01), select('FRECUENCIA', 'Frecuencia', frequencies, true), date('INICIO', 'Inicio', true), date('FIN', 'Fin opcional'), day('DIA', 'D\u00eda mensual'), ...refs, select('ESTADO', 'Estado', ['Activa', 'Suspendida', 'Finalizada']), text('OBSERVACIONES', 'Observaciones')];
  return [text('TITULO', 'T\u00edtulo', true), amount('MONTO', 'Monto', true, 0.01), date('FECHA_VENCIMIENTO', 'Fecha de vencimiento', true), ...refs, select('ESTADO', 'Estado', ['Pendiente', 'Anulado']), text('OBSERVACIONES', 'Observaciones')];
}
export function draft(title: string, action: WriteAction, fields: Field[], fixed: Record<string, unknown> = {}, values: Record<string, Value> = {}): Draft { return { title, action, fields, fixed, values, requestId: crypto.randomUUID() }; }
export function catalogDraft(sheet: Sheet, data: PersonalBootstrap, row?: Row): Draft {
  const fields = catalogFields(sheet, data); const values: Record<string, Value> = {};
  for (const f of fields) if (row?.[f.key] !== undefined && row[f.key] !== null) values[f.key] = row[f.key]!;
  if (!row) values.ESTADO = sheet === 'Beneficiarios' ? 'Activo' : sheet === 'Cuotas' ? 'Pendiente' : 'Activa';
  if (sheet === 'Cuentas') values.MONEDA = row?.MONEDA || 'USD';
  if (sheet === 'Cuentas' && !row) { values.TIPO = 'Ahorros'; values.SALDO_INICIAL = 0; }
  if (sheet === 'Cuentas' && row && data.movimientos.some(m => postings(m).some(p => p.CUENTA === row.ID))) for (const f of fields) if (['TIPO', 'SALDO_INICIAL', 'DEUDA_INICIAL'].includes(f.key)) f.readOnly = true;
  if (sheet === 'Cuotas' && row?.TARJETA) fields.find(f => f.key === 'MONTO')!.readOnly = true;
  return { ...draft(`${row ? 'Editar' : 'Crear'} ${sheet}`, 'save', fields, row ? { ID: row.ID, UPDATED_AT: row.UPDATED_AT } : {}, values), sheet };
}
export function visibleFields(d: Draft): Field[] {
  if (d.sheet !== 'Cuentas') return d.fields;
  const credit = d.values.TIPO === 'Tarjeta de cr\u00e9dito';
  return d.fields.filter(f => credit ? f.key !== 'SALDO_INICIAL' : !['DEUDA_INICIAL', 'LIMITE_CREDITO', 'DIA_CORTE', 'DIA_PAGO', 'FECHA_CORTE', 'FECHA_MAXIMA_PAGO', 'PAGO_MINIMO', 'PAGO_TOTAL_ESTADO'].includes(f.key));
}
export function transactionDraft(type: string, data: PersonalBootstrap): Draft {
  const bank = active(data.cuentas).filter(a => !card(a)); const cards = active(data.cuentas).filter(card);
  const fields: Field[] = [date('FECHA', 'Fecha real de la operaci\u00f3n', true), text('DESCRIPCION', 'Descripci\u00f3n', true), amount('MONTO', 'Monto', true, 0.01), reference('CUENTA', type === 'cardpurchase' ? 'Tarjeta' : 'Cuenta origen', type === 'cardpurchase' ? cards : bank, true)];
  if (['transfer', 'cardpayment'].includes(type)) fields.push(reference('DESTINO', 'Cuenta destino', type === 'cardpayment' ? cards : bank, true));
  if (type !== 'cardpayment') fields.push(reference('CATEGORIA', type === 'transfer' ? 'Categor\u00eda de la comisi\u00f3n (Gasto)' : 'Categor\u00eda', active(data.categorias).filter(c => c.TIPO === (type === 'income' ? 'Ingreso' : 'Gasto')), type !== 'transfer'));
  if (type === 'transfer') fields.push(amount('COMISION', 'Comisi\u00f3n opcional'));
  if (type === 'cardpurchase') fields.push({ key: 'CUOTAS', label: 'N\u00famero de cuotas', type: 'number', min: 1, max: 120, step: 1 }, date('PRIMER_VENCIMIENTO', 'Primer vencimiento'));
  fields.push(reference('BENEFICIARIO', 'Persona o empresa', active(data.beneficiarios)), select('METODO', 'M\u00e9todo', data.configuracion.METODOS), text('REFERENCIA', 'Referencia'), text('COMPROBANTE_URL', 'URL privada de Drive'));
  return draft(({ income: 'Registrar ingreso', egress: 'Registrar gasto', transfer: 'Transferir entre cuentas', cardpurchase: 'Registrar compra con tarjeta', cardpayment: 'Pagar tarjeta' } as Record<string, string>)[type], 'transaction', fields, { type }, { FECHA: data.hoy });
}
export function payDraft(q: Row, data: PersonalBootstrap): Draft { return draft('Pagar obligaci\u00f3n', 'pay', [date('FECHA', 'Fecha real del pago', true), text('DESCRIPCION', 'Descripci\u00f3n', true), reference('CUENTA', 'Cuenta de pago', active(data.cuentas).filter(a => !q.TARJETA || !card(a)), true), { ...amount('MONTO', 'Abono (hasta el pendiente)', true, 0.01), max: Number(q.PENDIENTE) }, select('METODO', 'M\u00e9todo', data.configuracion.METODOS), text('REFERENCIA', 'Referencia'), text('FACTURA', 'Factura'), text('DOCUMENTO', 'Documento (identificador, no archivo)'), text('COMPROBANTE_URL', 'URL privada de Drive')], { cuotaId: q.ID }, { MONTO: Number(q.PENDIENTE), FECHA: data.hoy, DESCRIPCION: `Pago ${q.TITULO}` }); }
export function reconcileDraft(a: Row, data: PersonalBootstrap): Draft { return draft('Conciliar saldo observado', 'reconcile', [{ ...amount('OBSERVADO', card(a) ? 'Deuda observada' : 'Saldo observado', true), min: card(a) ? 0 : -1e9 }, date('FECHA', 'Fecha', true), text('MOTIVO', 'Motivo del ajuste auditado', true)], { CUENTA: a.ID, UPDATED_AT: a.UPDATED_AT }, { FECHA: data.hoy }); }
export function reasonDraft(title: string, action: 'void' | 'resolveOperation', fixed: Record<string, unknown>): Draft { return draft(title, action, [text('MOTIVO', 'Motivo obligatorio', true)], fixed); }
