import { label, postings, validDate } from './finance';
import type { Movement, PersonalBootstrap, Value } from './types';

export const businessDateFields = new Set(['FECHA', 'FECHA_VENCIMIENTO', 'FECHA_PROGRAMADA', 'INICIO', 'FIN', 'FECHA_APERTURA', 'FECHA_CORTE', 'FECHA_MAXIMA_PAGO', 'PRIMER_VENCIMIENTO', 'HOY']);
export function displayDate(value: string): string {
  return validDate(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : value;
}
export function displayMonth(value: string): string { return /^\d{4}-\d{2}$/.test(value) ? `${value.slice(5, 7)}/${value.slice(0, 4)}` : value; }
export function timezoneToday(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function displayTimestamp(value: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) return value;
  return new Intl.DateTimeFormat('es-EC', { timeZone, dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
}
const labels: Record<string, string> = {
  MONEDA: 'Moneda',
  FECHA_CORTE: 'Fecha de corte del estado', FECHA_MAXIMA_PAGO: 'Fecha maxima de pago del estado', SALDO_ESTADO_PENDIENTE: 'Saldo pendiente del estado USD', ESTADO_CUENTA_VENCIDO: 'Estado de tarjeta vencido', ESTADO_CUENTA_PROXIMO: 'Estado de tarjeta proximo a vencer',
  ID: 'Identificador', USERNAME: 'Usuario del registro', OP_ID: 'Operacion vinculada', UPDATED_AT: 'Ultima actualizacion', CREATED_AT: 'Fecha de registro', REQUEST_ID: 'Clave de solicitud', ACTION: 'Accion', ERROR: 'Detalle del error',
  FECHA: 'Fecha', FECHA_VENCIMIENTO: 'Vencimiento', FECHA_PROGRAMADA: 'Fecha programada', INICIO: 'Inicio', FIN: 'Fin', FECHA_APERTURA: 'Fecha de apertura', PRIMER_VENCIMIENTO: 'Primer vencimiento', HOY: 'Hoy',
  NOMBRE: 'Nombre', TITULO: 'Titulo', TIPO: 'Tipo', DESCRIPCION: 'Concepto', MONTO: 'Monto USD', VALOR: 'Valor habitual USD', CUENTA: 'Cuenta', DESTINO: 'Cuenta destino', ORIGEN: 'Cuenta origen', BANCO: 'Banco', TITULAR: 'Titular', IDENTIFICADOR: 'Identificador de cuenta',
  SALDO_INICIAL: 'Saldo inicial USD', SALDO_ACTUAL: 'Saldo actual USD', DEUDA_INICIAL: 'Deuda inicial USD', DEUDA_ACTUAL: 'Deuda actual USD', LIMITE_CREDITO: 'Limite de credito USD', CREDITO_DISPONIBLE: 'Credito disponible USD', DIA_CORTE: 'Dia de corte', DIA_PAGO: 'Dia de pago', PAGO_MINIMO: 'Pago minimo USD', PAGO_TOTAL_ESTADO: 'Total del estado USD',
  ESTADO: 'Estado registrado', ESTADO_ACTUAL: 'Estado actual', OBSERVACIONES: 'Observaciones', BENEFICIARIO: 'Persona o empresa', CATEGORIA: 'Categoria', METODO: 'Metodo de pago', REFERENCIA: 'Referencia', FACTURA: 'Factura', DOCUMENTO: 'Documento', COMPROBANTE_URL: 'Comprobante privado de Drive',
  IDENTIFICACION: 'Identificacion', TELEFONO: 'Telefono', EMAIL: 'Email', BANCO_DESTINO: 'Banco destino', CUENTA_DESTINO: 'Cuenta destino del beneficiario', CONCEPTO: 'Concepto habitual', FRECUENCIA: 'Frecuencia', DIA_VENCIMIENTO: 'Dia de vencimiento', DIA: 'Dia mensual',
  DEFINICION: 'Definicion recurrente', CLAVE_PERIODO: 'Clave del periodo emitido', TARJETA: 'Tarjeta', PAGADO: 'Pagado USD', PENDIENTE: 'Pendiente USD', VENCIDO: 'Vencido', PROXIMO: 'Proximo a vencer', MOVIMIENTO: 'Movimiento vinculado', CUOTA: 'Compromiso vinculado', COMISION: 'Comision USD', ASIENTOS: 'Asientos contables', MOTIVO: 'Motivo auditado', OBSERVADO: 'Saldo observado USD', DIFERENCIA: 'Ajuste USD',
};
export const fieldLabel = (key: string) => labels[key] || key.replaceAll('_', ' ').toLocaleLowerCase('es');
export function displayField(key: string, value: Value | undefined, timeZone: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'Si' : 'No';
  const text = String(value);
  return businessDateFields.has(key) ? displayDate(text) : ['UPDATED_AT', 'CREATED_AT'].includes(key) ? displayTimestamp(text, timeZone) : text;
}
export function rowDisplay(key: string, value: Value | undefined, data: PersonalBootstrap): string {
  if (['CUENTA', 'DESTINO', 'ORIGEN', 'TARJETA'].includes(key)) return label(data.cuentas, value);
  if (key === 'BENEFICIARIO') return label(data.beneficiarios, value);
  if (key === 'CATEGORIA') return label(data.categorias, value);
  if (key === 'CUOTA') return String(data.obligaciones.find(q => q.ID === value)?.TITULO || value || '');
  if (key === 'MOVIMIENTO') return String(data.movimientos.find(m => m.ID === value)?.DESCRIPCION || value || '');
  if (key === 'DEFINICION') return String(data.recurrentes.find(r => r.ID === value)?.TITULO || value || '');
  if (key === 'ASIENTOS') return postings({ ASIENTOS: String(value || '') } as Movement).map(p => `${label(data.cuentas, p.CUENTA)}: ${(p.CENTAVOS / 100).toFixed(2)} USD`).join('; ');
  return displayField(key, value, data.configuracion.TIMEZONE);
}
