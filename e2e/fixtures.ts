import { test as base, expect, type Page } from '@playwright/test';
import type { AccountRow, Bootstrap, CatalogRow, Movement, MovementInput, User } from '../src/types';

export const testUser: User = { username: 'browser-test', name: 'Usuario de prueba' };
export const testPassword = 'test-only-password-123';

const timestamp = '2026-10-07T12:00:00.000Z';
const rows = (names: string[], prefix: string): CatalogRow[] => names.map((NOMBRE, index) => ({
  ID: `${prefix}${index + 1}`, NOMBRE, ESTADO: 'Activo', UPDATED_AT: timestamp,
}));

// Approved catalog seeds only. Financial records are opt-in synthetic test inputs.
export function emptyBootstrap(): Bootstrap {
  return {
    jefes: rows(['Franco Becerra', 'Josselyn Becerra'], ''),
    cuentas: [],
    categorias: rows(['Alimentación', 'Transporte', 'Combustible', 'Hospedaje', 'Compras', 'Servicios', 'Salud', 'Entretenimiento', 'Viajes', 'Mantenimiento', 'Tecnología', 'Oficina', 'Representación', 'Impuestos', 'Otros'], 'category-'),
    formasPago: rows(['Efectivo', 'Transferencia', 'Tarjeta de crédito', 'Tarjeta de débito', 'Depósito', 'Otro'], 'payment-'),
    estados: rows(['Pagado', 'Pendiente', 'Pago parcial', 'Anulado'], 'state-'),
    tipos: ['Gasto', 'Compra', 'Pago', 'Transferencia', 'Préstamo', 'Adelanto', 'Reembolso', 'Ingreso', 'Retiro'],
    configuracion: { MONEDA: 'USD', IVA_PORCENTAJE: 0 },
  };
}

export const testAccount: AccountRow = {
  ID: 'test-account', NOMBRE: 'Cuenta de prueba', JEFE: '1', ESTADO: 'Activo',
  SALDO_INICIAL: 0, SALDO_ACTUAL: 0, UPDATED_AT: timestamp,
};

export function normalizedMovement(input: MovementInput, ID: string): Movement {
  return {
    ...input, CUENTA: input.CUENTA || '', ID, SUBTOTAL: Math.round(input.CANTIDAD * input.VALOR_UNITARIO * 100) / 100,
    NUMERO_FACTURA: input.FACTURA || '', UPDATED_AT: timestamp, CREATED_AT: timestamp,
    CREADO_POR: testUser.username, USUARIO_REGISTRO: testUser.username,
  };
}

export function accountingFixtures(): Movement[] {
  const common: MovementInput = {
    FECHA: '2026-10-07', HORA: '12:00', TIPO: 'Ingreso', JEFE: '1',
    CATEGORIA: 'category-1', FORMA_PAGO: 'payment-1', DESCRIPCION: 'Ingreso de prueba',
    CANTIDAD: 1, VALOR_UNITARIO: 100, TOTAL: 100, TOTAL_MANUAL: false, ESTADO: 'Pagado', PAGADO: 100,
    CLAVE_IDEMPOTENCIA: '11111111-1111-4111-8111-111111111111',
  };
  return [normalizedMovement(common, 'test-income'), normalizedMovement({
    ...common, TIPO: 'Gasto', DESCRIPCION: 'Obligación de prueba', VALOR_UNITARIO: 30,
    TOTAL: 30, ESTADO: 'Pago parcial', PAGADO: 5,
    CLAVE_IDEMPOTENCIA: '22222222-2222-4222-8222-222222222222',
  }, 'test-expense')];
}

interface MockState {
  configMissing: boolean;
  user: User | null;
  logins: { username: string; password: string }[];
  actions: string[];
  bootstrap: Bootstrap;
  movements: Movement[];
  creates: MovementInput[];
  updates: (MovementInput & { ID: string; UPDATED_AT: string })[];
  catalogWrites: { sheet: string; row: Record<string, unknown> }[];
  failNextCreate: boolean;
  failNextUpdate: boolean;
  unexpected: string[];
}

export const test = base.extend<{ mock: MockState }>({
  mock: async ({ page }, use) => {
    const state: MockState = {
      configMissing: false, user: testUser, logins: [], actions: [], bootstrap: emptyBootstrap(), movements: [], creates: [], updates: [],
      catalogWrites: [], failNextCreate: false, failNextUpdate: false, unexpected: [],
    };
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.hostname === 'fonts.googleapis.com') {
        await route.fulfill({ contentType: 'text/css', body: '' });
        return;
      }
      if (url.origin !== 'http://localhost:5173') {
        state.unexpected.push(request.url());
        await route.abort();
        return;
      }
      if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
      const action = url.searchParams.get('action');
      const reads = ['config', 'session', 'bootstrap', 'movements'];
      const writes = ['login', 'logout', 'saveCatalog', 'create', 'update'];
      if (!action || ![...reads, ...writes].includes(action) || request.method() !== (writes.includes(action) ? 'POST' : 'GET')) {
        state.unexpected.push(`API ${request.method()} ${request.url()}`); await route.abort(); return;
      }
      state.actions.push(action);
      if (state.configMissing && !['config', 'logout'].includes(action)) {
        await route.fulfill({ status: 503, json: { success: false, message: 'Configuracion incompleta' } }); return;
      }
      if (!state.user && !['config', 'session', 'login', 'logout'].includes(action)) {
        await route.fulfill({ status: 401, json: { success: false, message: 'Inicie sesion para continuar' } }); return;
      }
      let data: unknown;
      switch (action) {
        case 'config': data = { authMode: 'password', configured: !state.configMissing }; break;
        case 'session': data = { user: state.user }; break;
        case 'login': {
          const body = request.postDataJSON();
          state.logins.push(body);
          if (body.username !== testUser.username || body.password !== testPassword) {
            await route.fulfill({ status: 401, json: { success: false, message: 'Usuario o contraseña incorrectos' } }); return;
          }
          state.user = testUser;
          data = { user: state.user }; break;
        }
        case 'logout': state.user = null; data = { user: null }; break;
        case 'bootstrap': data = state.bootstrap; break;
        case 'movements': data = state.movements; break;
        case 'saveCatalog': {
          const body = request.postDataJSON();
          state.catalogWrites.push(body);
          if (body.sheet === 'CUENTAS') {
            await route.fulfill({ status: 403, json: { success: false, message: 'Catalogo historico de solo lectura' } }); return;
          }
          state.unexpected.push(`catalog ${body.sheet}`); await route.abort(); return;
        }
        case 'create': {
          const input = request.postDataJSON().movement as MovementInput;
          state.creates.push(input);
          if (state.failNextCreate) {
            state.failNextCreate = false;
            await route.fulfill({ status: 502, json: { success: false, message: 'Fallo temporal de prueba' } });
            return;
          }
          data = normalizedMovement(input, `test-created-${state.movements.length + 1}`);
          state.movements.push(data as Movement);
          break;
        }
        case 'update': {
          const input = request.postDataJSON().movement as MockState['updates'][number];
          state.updates.push(input);
          if (state.failNextUpdate) {
            state.failNextUpdate = false;
            await route.fulfill({ status: 502, json: { success: false, message: 'Fallo temporal de prueba' } }); return;
          }
          const previous = state.movements.find(m => m.ID === input.ID)!;
          data = normalizedMovement({ ...previous, ...input }, input.ID);
          state.movements = state.movements.map(m => m.ID === input.ID ? data as Movement : m);
          break;
        }
        default: state.unexpected.push(`API ${request.method()} ${request.url()}`); await route.abort(); return;
      }
      await route.fulfill({ json: { success: true, data } });
    });
    await use(state);
    expect(state.unexpected, 'No unmocked API or external Google requests').toEqual([]);
  },
});

export { expect };

export async function navigate(page: Page, name: string) {
  const open = page.getByRole('button', { name: 'Abrir navegación', exact: true });
  if (await open.isVisible()) await open.click();
  await page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('button', { name, exact: true }).click();
}

export async function noPageOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}
