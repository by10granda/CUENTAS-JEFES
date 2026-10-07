# Backend Integration Contract

## Runtime And Environment

The frontend calls `/api/index?action=ACTION` on its own origin with cookies enabled. Shared password login requires no Gmail, OAuth client IDs, or Google Cloud configuration. Credentials and secrets belong only in private server environment variables, never Sheets, public config, or `VITE_*` variables. Financial data is stored solely in Sheets; private receipt files are in Drive. Run the development API with `npx tsx server/dev.ts`; it loads the root `.env` and listens on `127.0.0.1:3001`.

| Node environment variable | Required | Value |
| --- | --- | --- |
| `APP_USERNAME` | Login | Shared username, nonblank, at most 100 characters, no control characters. Exact comparison, no trimming or case normalization. |
| `APP_PASSWORD` | Login | Strong shared password, 8 to 512 characters, not whitespace-only. Exact comparison. Rotation invalidates existing sessions. |
| `SESSION_SECRET` | Session/private API | Random secret with at least 32 characters. Changing it invalidates existing sessions. |
| `GAS_WEB_APP_URL` | Private API | `https://script.google.com/macros/s/DEPLOYMENT_ID/exec`. Use the deployed web app, not `/dev`. |
| `GAS_API_SECRET` | Private API | Strong random shared secret; identical to the Apps Script property. |
| `APP_ORIGIN` | Production configuration | `https://cuentas-jefes.vercel.app`. Same-host writes also work without this. Local `.env.example` retains `http://localhost:5173`. |
| `NODE_ENV` | Production | Set to `production` outside local development. Production cookies are `Secure` and localhost dev origins are disabled. |
| `PORT` | Optional | Development API port; default `3001`. |

Configure the frontend-owned Vite proxy as `server.proxy['/api'] = { target: 'http://127.0.0.1:3001', changeOrigin: true }`. The only extra development Origin accepted is `http://localhost:5173`. `127.0.0.1:5173`, other ports and origin-less writes are not accepted. Run the frontend at `http://localhost:5173`. No CORS wildcard is provided; production frontend and API should share an origin.

Vercel uses `api/index.ts` as the handler. The public aliases also have Vercel entry files: `/api/config`, `/api/session`, `/api/login`, `/api/logout`. No rewrite is needed for `/api/index?action=...`. The repository owner controls build configuration and package scripts; this backend does not create or change them.

Configure these six variables privately in Vercel: `APP_USERNAME`, `APP_PASSWORD`, `SESSION_SECRET`, `GAS_WEB_APP_URL`, `GAS_API_SECRET`, and `APP_ORIGIN=https://cuentas-jefes.vercel.app`. The owner will configure shared credentials later; do not send passwords, secrets, or tokens through chat. Repository: https://github.com/by10granda/CUENTAS-JEFES, branch `main`. The public deployment exists, but the new password-login deployment is pending until changes are pushed and deployed; protected financial integration is not yet validated.

## Authentication And Envelope

Every response is JSON, disables caching, and has one of these shapes:

```json
{ "success": true, "data": {} }
```

```json
{ "success": false, "message": "Human-readable error" }
```

HTTP status is meaningful: 400 validation, 401 unauthenticated/incorrect credentials, 403 disallowed origin, 404 unknown endpoint/record, 405 wrong method, 409 optimistic/idempotency conflict, 413 oversized request, 415 incorrect content type, 502 upstream failure, 503 unconfigured login or storage busy/failure. Unexpected server configuration errors are 500 and do not expose secrets. Apps Script errors include an internal `status` field because ContentService itself does not set HTTP status; the Node proxy converts it to an HTTP status and strips that field from the response.

| Action | Method | Body / response data |
| --- | --- | --- |
| `config` | GET, public | `{authMode: 'password', configured: boolean}` only; no credentials or secrets. |
| `session` | GET, public | `{user: null}` or `{user: {username, name}}`; 503 if login is unconfigured. |
| `login` | POST, public | Body `{username: string, password: string}`. Data `{user: {username, name}}`; `name` is the shared username. Incorrect credentials return 401; unconfigured login returns 503. |
| `logout` | POST, public | No body required. Data `{user: null}`. |
| `bootstrap` | GET, authenticated | Catalog/bootstrap object below. |
| `movements` | GET, authenticated | Full movement array, including void records, not filtered. |
| `statistics` | GET, authenticated | Filtered statistics below. |
| `create` | POST, authenticated | `{movement: MovementInput}`; data is committed movement. |
| `update` | POST, authenticated | `{movement: MovementInput + ID + UPDATED_AT}`; data is committed movement. |
| `void` | POST, authenticated | `{id: string, updatedAt: string}`; data is voided movement. |
| `saveCatalog` | POST, authenticated | `{sheet: string, row: CatalogInput}`; data is committed row. |
| `upload` | POST, authenticated | `{fileName, mimeType, base64}`; data `{fileId, url, fileName, mimeType, size}`. |

Use `Content-Type: application/json` for JSON writes. The browser must send an exact allowed `Origin`, including login and logout. The session is an HMAC-SHA256 signed, HttpOnly, SameSite=Lax, eight-hour cookie named `gerencia_session`, Secure in production. Every authenticated request rechecks the current username and a credential-version signature. Changing `APP_USERNAME`, `APP_PASSWORD`, or `SESSION_SECRET` invalidates previous sessions once the running server uses the new values. Unconfigured login makes `config.configured` false; `config` and `logout` remain available, while other actions return 503.

The public application link is intentionally usable by anyone with the shared username/password. All such users can manage catalogs under one shared identity; there is no per-person attribution or separate administrator role. Client-supplied user/username fields do not set the audit identity. New audit entries use the authenticated shared username; historical audit emails and creator identities are preserved.

No distributed brute-force lockout or application-level attempt limit is implemented. The public password endpoint allows repeated attempts; Origin validation does not prevent non-browser attackers. For real production, configure and verify Vercel firewall/rate limits covering both `/api/login` and `/api/index?action=login`, and use a strong random password. This is pending operational hardening, not a delivered protection.

## Bootstrap And Catalogs

`bootstrap` data has exactly these top-level keys:

```ts
{
  jefes: CatalogRow[],
  cuentas: AccountRow[],
  categorias: CatalogRow[],
  formasPago: CatalogRow[],
  estados: CatalogRow[],
  tipos: string[],
  configuracion: { MONEDA: 'USD', IVA_PORCENTAJE: 0 }
}
```

Catalog rows use uppercase fields `ID`, `NOMBRE`, `ESTADO`, `UPDATED_AT`. `JEFES` and `CUENTAS` additionally accept optional text `TIPO` (maximum 100 characters); omitting it on update preserves the existing value, and an explicit empty string clears it. Catalog `ESTADO` is exactly `Activo` or `Inactivo`. Account rows additionally use `JEFE` (jefe ID), numeric `SALDO_INICIAL`, and computed numeric `SALDO_ACTUAL`. IDs and reference columns read as numeric cells from Sheets are normalized to strings, including the seeded jefe IDs `'1'` and `'2'`. Bootstrap includes inactive rows so historical records can still resolve their labels. A new or edited movement must reference active rows.

`saveCatalog.sheet` is restricted to `JEFES`, `CUENTAS`, `CATEGORIAS`, `FORMAS_PAGO`, `ESTADOS`. New rows omit `ID` and `UPDATED_AT`; IDs are generated by the server. Existing rows must include the current `ID` and `UPDATED_AT`. Allowed input fields are `ID`, `NOMBRE`, `ESTADO`, `UPDATED_AT`, plus optional `TIPO` for jefes/accounts and `JEFE` and `SALDO_INICIAL` for accounts. `SALDO_ACTUAL` is read-only and must be omitted. Extra fields and deletion are rejected. Names are unique within a catalog, case-insensitively. Used accounts cannot change jefe or initial balance. There is no overdraft restriction. Account initial balances are explicit user input, never seeded.

The state catalog contains `Pagado`, `Pendiente`, `Pago parcial`, `Anulado`, each with its own ID. Those accounting names cannot be renamed or deactivated. Creating custom states is rejected with a clear validation error because only these four have defined accounting semantics. A movement's `ESTADO` accepts a state name or active state ID and is stored/returned as its Spanish name. `tipos` is `Gasto`, `Compra`, `Pago`, `Transferencia`, `Préstamo`, `Adelanto`, `Reembolso`, `Ingreso`, `Retiro`.

## Movement Fields And Accounting

```ts
type MovementInput = {
  FECHA: string;                 // yyyy-mm-dd, real calendar date
  HORA: string;                  // HH:mm, 24-hour
  TIPO: string;                  // exact entry from bootstrap.tipos
  JEFE: string;                  // catalog ID, not display name
  CUENTA: string;                // catalog ID belonging to JEFE
  CATEGORIA: string;             // active catalog ID
  FORMA_PAGO: string;            // active catalog ID
  DESCRIPCION: string;             // nonempty, required
  SUBCATEGORIA?: string;         // free text, maximum 200 characters
  PROVEEDOR?: string;            // maximum 200 characters
  NUMERO_FACTURA?: string;       // maximum 100 characters
  FACTURA?: string;              // current frontend alias for NUMERO_FACTURA
  OBSERVACIONES?: string;        // maximum 2000 characters
  CANTIDAD: number;
  VALOR_UNITARIO: number;
  TOTAL: number;
  TOTAL_MANUAL: boolean;
  ESTADO: string;
  PAGADO?: number;
  DIRECCION?: 'Recibido' | 'Entregado';
  MOVIMIENTO_ORIGEN_ID?: string;
  CUENTA_DESTINO_ID?: string;
  COMPROBANTE_URL?: string;
  CLAVE_IDEMPOTENCIA: string;     // crypto.randomUUID(), REQUIRED on create
};
```

Monetary inputs must be finite, nonnegative numbers with at most two decimals and at most 1,000,000,000. Quantity must be a finite, nonnegative number within the same limit. `SUBTOTAL` is computed by the server as quantity times unit price rounded to cents, using the same rounding as the frontend, and must also fit the monetary limit. Without `TOTAL_MANUAL`, `TOTAL` must match `SUBTOTAL`; with manual total enabled they may differ. The total remains tax-inclusive. Client `SUBTOTAL`, `IVA`, and `IVA_PORCENTAJE` do not control server calculations; IVA fields are always zero. Normalized output includes numeric monetary fields and a boolean `TOTAL_MANUAL`. Older rows with an empty newly appended `SUBTOTAL` column return the computed subtotal without rewriting historical cells.

`SUBCATEGORIA`, `PROVEEDOR`, `NUMERO_FACTURA`, and `OBSERVACIONES` are optional, trimmed text with type, length and control-character validation. Omitting them on update preserves existing values; explicit empty strings clear them. They are persisted in Sheets, returned by the API, and included in full before/after audits and create idempotency checks. The current frontend sends and displays `FACTURA`, so the backend accepts that concrete alias and returns it on movement reads/create/update/void, while persisting only canonical `NUMERO_FACTURA`. Supplying both names with different values is rejected. User strings are written as literal text, never executable Sheets formulas.

Only unlinked `Gasto`, `Compra`, and `Pago` may be `Pendiente` or `Pago parcial`. `Pagado` sets `PAGADO = TOTAL`; if supplied, it must match. `Pendiente` sets `PAGADO = 0`; if supplied, it must be zero. `Pago parcial` requires an explicit `0 < PAGADO < TOTAL`. All other types require `Pagado`.

A linked payment is `TIPO = Pago`, `ESTADO = Pagado`, with a positive total and `MOVIMIENTO_ORIGEN_ID` pointing to a live, unlinked expense. It must use the same jefe and account as the original. Original own paid amount plus all live linked payments cannot exceed the original total. Updates exclude the payment being edited when checking the cap. Original movements with live linked payments cannot be updated or voided; void the payments first. Linked payments are cash outflows, NOT new independent expenses.

`movements` additionally returns `PAGADO_VINCULADO` and `SALDO_PENDIENTE`. `PAGADO` remains the original record's own cash payment; it is NOT increased by linked payments. The original stored `ESTADO` is not silently rewritten when linked payments settle it. Use `SALDO_PENDIENTE` to determine the current obligation. Derived fields are not persisted and are ignored on movement updates. Void records retain historical amounts but contribute nothing to balances or obligations.

For loans/advances, `DIRECCION` is mandatory and must be `Recibido` or `Entregado`. It is rejected for other types. Transfers require a positive total, `Pagado`, and `CUENTA_DESTINO_ID` naming a distinct active account of the same jefe. Other types reject a destination account. Cross-jefe transfers are not supported.

Balances are calculated from the explicit initial account balance plus cash incomes, reimbursements and received loans/advances, minus actual paid expenses, linked payments, withdrawals and delivered loans/advances. Transfers debit the source and credit the destination. Pending obligations have no cash outflow. No database, invented balance, account, or transaction is used.

`ID`, `CREATED_AT`, `CREADO_POR`, `USUARIO_REGISTRO`, `CLAVE_IDEMPOTENCIA`, and `SOLICITUD_HASH` are immutable server fields. `USUARIO_REGISTRO` is the authenticated creator's shared username, not a client-supplied value; edits preserve that registration identity (including historical emails) and record the current username in `ACTUALIZADO_POR` and the audit `USUARIO`. Older rows with an empty registration-user column use the previously authenticated `CREADO_POR`. Updates set `UPDATED_AT` and `ACTUALIZADO_POR` from the server. `UPDATED_AT` is an opaque optimistic-lock token; preserve it exactly, do not format or regenerate it. Updates and voids reject missing/stale tokens. Creates require a UUID idempotency key retained across network retries. The same user, key, and input returns the original committed record (including later edits/voids) without duplicate writes or audit entries; changed input or another user gets 409. Editing is done with `update`, not by reusing `create`.

## Statistics

Send filters as query parameters, e.g. `/api/index?action=statistics&desde=2026-10-01&jefe=ID`, or as one JSON-encoded `filters` query parameter. Allowed fields: `desde`, `hasta` (inclusive calendar dates), `jefe`, `cuenta`, `categoria` (catalog IDs), `tipo`, `estado` (stored Spanish names). Unknown fields and invalid date ranges are rejected. A cuenta filter also selects transfers into that account.

```ts
{
  resumen: {
    cantidad: number, ingresos: number, egresos: number,
    gastos: number, pendiente: number, transferencias: number, neto: number
  },
  porCategoria: { CATEGORIA: string, TOTAL: number }[],
  saldos: { CUENTA: string, JEFE: string, SALDO: number }[]
}
```

`gastos`/`porCategoria` count unlinked expense totals once, not linked payments. `pendiente` is the currently remaining obligation on the selected original expenses after ALL live linked payments, even payments outside the date filter. Cash `ingresos`/`egresos` use the selected records' actual paid amounts. Transfers are separate, not income/expense. `neto = ingresos - egresos`. `saldos` are lifetime/current balances restricted by jefe/cuenta, not date-range balances. All void records are excluded. Frontend calculations should use the same rules.

## Apps Script Setup

1. Create the Apps Script project, add `Code.gs` and the manifest from `apps-script/appsscript.json`, and authorize Sheets/Drive access as the spreadsheet owner.
2. Set Script Properties `GAS_API_SECRET` and `DRIVE_FOLDER_ID`. The latter is an existing, private Drive folder owned by the execution account. No credentials were supplied with this implementation.
3. Run `inspectStructure`, inspect the report, then run `setupSpreadsheet`. The spreadsheet ID is fixed to `1waRuU63wJjxNJP8usUtHkl5mV-WM7E099dz-4llwJrI`.
4. Deploy a versioned web app executing as the owner, accessible to anyone so the Node server can reach it. Public `doGet` always returns unauthorized; `doPost` needs the constant-time-checked shared secret. After code changes, publish a new deployment version.
5. Supply the deployment URL and matching shared secret to Node, and configure the password-login variables and exact application origin privately. No Google Cloud or OAuth setup is required.
6. Setup inserts the authorized jefes, categories and payment methods listed below. Create real accounts with explicitly approved balances through authenticated catalog operations; setup never creates accounts or financial data.

Target sheets: `JEFES`, `CUENTAS`, `CATEGORIAS`, `FORMAS_PAGO`, `ESTADOS`, `MOVIMIENTOS`, `AUDITORIA`, `CONFIGURACION`. `Hoja1` and unrelated sheets are preserved. Before ANY setup change, every existing nonempty target must have all required headers, no unknown headers, and no duplicate headers. Otherwise setup refuses without changing any sheet. Compatible existing targets receive only missing optional headers at the end, including the newly added form fields and catalog `TIPO`; setup does not reorder columns, overwrite data, or migrate historical transactions. Empty targets receive full headers. Run `inspectStructure` and `setupSpreadsheet` again when upgrading an existing deployment to this schema.

The password-login identity migration itself does not change this field schema and requires no setup rerun or reset when the schema is already current. Updating the remote script is mandatory: the old deployed `doPost` validates `request.user.email` and cannot accept the new `{username, name}` identity. The exact validation replacement and all five invocation replacements (`create`, `update`, `void`, `saveCatalog`, `upload`) are shown in the root README under **Actualizacion Obligatoria Del Script Existente**. Prefer loading the latest full `apps-script/Code.gs`, then edit the existing deployment and publish **Nueva version**, retaining the same `/exec` URL and Script Properties. Saving code alone does not update the deployed version. Public `/exec` GET is always unauthorized by design, even with a valid application session.

Authorized seed catalogs:

- `JEFES`: ID `'1'`, Franco Becerra, `TIPO = Jefe`, `ESTADO = Activo`; ID `'2'`, Josselyn Becerra, `TIPO = Jefa`, `ESTADO = Activo`.
- `CATEGORIAS`: Alimentación, Transporte, Combustible, Hospedaje, Compras, Servicios, Salud, Entretenimiento, Viajes, Mantenimiento, Tecnología, Oficina, Representación, Impuestos, Otros.
- `FORMAS_PAGO`: Efectivo, Transferencia, Tarjeta de crédito, Tarjeta de débito, Depósito, Otro.
- `ESTADOS`: Pagado, Pendiente, Pago parcial, Anulado; `CONFIGURACION`: USD and zero IVA.

All newly seeded catalog rows are active. Setup inserts only missing names (trimmed/case-insensitive comparison), never overwrites an existing row's ID, type, active state, or other data, and falls back to a collision-checked UUID when the preferred ID is already occupied. It is repeatable and never seeds accounts, balances, movements, or audit transactions.

Authenticated reads and writes take one ScriptLock so a request cannot read another request's half-completed mutation. Every successful catalog/movement write appends full before/after JSON and the authenticated shared username to `AUDITORIA`; historical emails remain unchanged. Audit entries are append-only through the API. Writes and audit are committed together with snapshot-based best-effort rollback; a failed audit is NOT success. Sheets is not an ACID database: an execution termination or failed rollback can require manual reconciliation. Error messages flag failed restoration. Manual edits and unrelated scripts do not obey this application's lock or audit, so restrict spreadsheet editing accordingly.

## Private Receipts And Limits

Upload accepts strict raw base64, NOT a data URL. Allowed MIME values: `image/jpeg`, `image/png`, `application/pdf`. Node AND GAS validate the decoded size (maximum 5 MiB), MIME and magic bytes. Magic checks identify the format signature, not antivirus or complete document validity. File names cannot contain control characters or path separators. Comprobante links must use the returned private Drive URL.

Files are never published with an anyone link. Public/shared-link folders are rejected and each created file is explicitly set private. Upload is audited; a failed audit attempts to trash the new file. Shared application credentials do NOT grant Drive access. The Drive owner must explicitly share receipts or the private folder with intended viewers' Google accounts through Drive; the application never makes documents public automatically. Users without a Drive permission will see an access-denied/request-access page at the URL.

The local handler accepts a 7 MiB JSON request, sufficient for a 5 MiB file as base64. Vercel imposes its own request/response limit (commonly 4.5 MB), which is smaller than that encoded payload and may produce a platform 413 before this handler runs. Large uploads require running this same proxy on a host with an adequate request limit, or a separately designed chunked-upload flow; chunked uploads are NOT silently claimed to be implemented. Large full movement responses also remain subject to host limits. The GAS call timeout is 55 seconds; the Vercel project's function duration must allow that. Retry creates with the same idempotency key after transport failures, never a fresh key.

## Verification

With Node 24, run `node --test tests/backend-security.test.ts tests/backend-apps-script.test.mjs`. Older Node versions can use `npx tsx --test tests/backend-security.test.ts tests/backend-apps-script.test.mjs`. Tests use Node's test runner, a VM-hosted Apps Script runtime, mock Sheets/Drive, and local HTTP requests. Latest agent-reported results: 38 unit/HTTP tests and 12 browser tests passed; the main agent will rerun final verification. This documentation-only edit does not certify another run. The existing Vercel public web/API was previously checked, but the new login deployment is pending push/deploy and live protected financial integration with Sheets/Drive has not been validated.
