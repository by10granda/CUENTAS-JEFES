export interface CatalogRow {
  ID: string;
  NOMBRE: string;
  ESTADO: 'Activo' | 'Inactivo';
  UPDATED_AT: string;
}
export interface AccountRow extends CatalogRow {
  JEFE: string;
  SALDO_INICIAL: number;
  SALDO_ACTUAL: number;
}
export interface Bootstrap {
  jefes: CatalogRow[];
  cuentas: AccountRow[];
  categorias: CatalogRow[];
  formasPago: CatalogRow[];
  estados: CatalogRow[];
  tipos: string[];
  configuracion: { MONEDA: 'USD'; IVA_PORCENTAJE: number };
}
export interface MovementInput {
  FECHA: string;
  HORA: string;
  TIPO: string;
  JEFE: string;
  CUENTA: string;
  CATEGORIA: string;
  SUBCATEGORIA?: string;
  FORMA_PAGO: string;
  DESCRIPCION: string;
  PROVEEDOR?: string;
  NUMERO_FACTURA?: string;
  FACTURA?: string;
  OBSERVACIONES?: string;
  CANTIDAD: number;
  VALOR_UNITARIO: number;
  TOTAL: number;
  TOTAL_MANUAL: boolean;
  ESTADO: string;
  PAGADO: number;
  DIRECCION?: 'Recibido' | 'Entregado';
  MOVIMIENTO_ORIGEN_ID?: string;
  CUENTA_DESTINO_ID?: string;
  COMPROBANTE_URL?: string;
  CLAVE_IDEMPOTENCIA: string;
}
export interface Movement extends MovementInput {
  ID: string;
  UPDATED_AT: string;
  CREATED_AT?: string;
  CREADO_POR?: string;
  USUARIO_REGISTRO?: string;
  SUBTOTAL?: number;
  ACTUALIZADO_POR?: string;
  PAGADO_VINCULADO?: number;
  SALDO_PENDIENTE?: number;
}
export interface User { email: string; name: string }
export interface Filters {
  desde: string;
  hasta: string;
  jefe: string;
  cuenta: string;
  categoria: string;
  tipo: string;
  estado: string;
  formaPago: string;
  proveedor: string;
  buscar: string;
}
export type CatalogSheet = 'JEFES' | 'CUENTAS' | 'CATEGORIAS' | 'FORMAS_PAGO' | 'ESTADOS';
