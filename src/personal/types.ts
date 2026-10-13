export type Value = string | number | boolean | null;
export interface Row { ID: string; UPDATED_AT: string; USERNAME?: string; OP_ID?: string; [key: string]: Value | undefined }
export interface Account extends Row { NOMBRE: string; TIPO: string; ESTADO: string; SALDO_INICIAL: number; DEUDA_INICIAL: number; SALDO_ACTUAL: number | null; DEUDA_ACTUAL: number | null; CREDITO_DISPONIBLE: number | null; FECHA_CORTE?: string; FECHA_MAXIMA_PAGO?: string; SALDO_ESTADO_PENDIENTE?: number | null; ESTADO_CUENTA_VENCIDO?: boolean; ESTADO_CUENTA_PROXIMO?: boolean }
export interface Movement extends Row { FECHA: string; TIPO: string; MONTO: number; CUENTA: string; ASIENTOS: string; ESTADO: string }
export interface Quota extends Row { TITULO: string; MONTO: number; FECHA_VENCIMIENTO: string; PAGADO: number; PENDIENTE: number; ESTADO_ACTUAL: string; VENCIDO: boolean; PROXIMO: boolean }
export interface Payment extends Row { CUOTA: string; MOVIMIENTO: string; MONTO: number; FECHA: string; ESTADO: string }
export interface PersonalBootstrap {
  cuentas: Account[]; beneficiarios: Row[]; categorias: Row[]; recurrentes: Row[]; obligaciones: Quota[];
  movimientos: Movement[]; transferencias: Row[]; pagos: Payment[]; operacionesPendientes: Row[];
  configuracion: { MONEDA: 'USD'; TIMEZONE: string; DIAS_ALERTA: number; PERMITIR_SOBREGIRO: boolean; METODOS: string[]; CANAL_EMAIL: string; UPLOAD_ENABLED: boolean; HOY: string }; hoy: string;
}
export type Sheet = 'Cuentas' | 'Beneficiarios' | 'Categorias' | 'Obligaciones' | 'Cuotas';
export type WriteAction = 'save' | 'generate' | 'transaction' | 'pay' | 'void' | 'reconcile' | 'configure' | 'upload' | 'resolveOperation';
export interface Field { key: string; label: string; type?: 'text' | 'number' | 'date' | 'select' | 'checkbox'; required?: boolean; options?: { value: string; label: string }[]; min?: number; max?: number; step?: number; readOnly?: boolean; maxLength?: number }
export interface Draft { title: string; action: WriteAction; fields: Field[]; values: Record<string, Value>; fixed: Record<string, unknown>; sheet?: Sheet; requestId: string; retryPayload?: Record<string, unknown>; error?: string; uploadUncertain?: string }
