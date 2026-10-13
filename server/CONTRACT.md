# Backend Integration Contract

## Runtime And Environment

The frontend calls `/api/index?action=ACTION` on its own origin with cookies enabled. Password login requires no Gmail, OAuth client IDs, or Google Cloud configuration. Gerencia retains its existing environment variables and Sheet; Personal adds a separate profile/project described below. Credentials and secrets belong only in private server environment variables, never Sheets, public config, or `VITE_*` variables. Gerencia stores financial data and optional receipt URLs solely in Sheets and does not upload/manage Drive files; Personal has optional private uploads. Opening a private receipt requires the viewer's separate Google access. Run the development API with `npx tsx server/dev.ts`; it loads the root `.env` and listens on `127.0.0.1:3001`.

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

Configure these six variables privately in Vercel: `APP_USERNAME`, `APP_PASSWORD`, `SESSION_SECRET`, `GAS_WEB_APP_URL`, `GAS_API_SECRET`, and `APP_ORIGIN=https://cuentas-jefes.vercel.app`. The owner will configure shared credentials later; do not send passwords, secrets, or tokens through chat. Repository: https://github.com/by10granda/CUENTAS-JEFES, branch `main`. The public deployment exists, but the current frontend/server changes (password login, optional accounts and URL-only receipts) are pending push to `main` and deployment; protected financial integration is not yet validated.

## Authentication And Envelope

Every response is JSON, disables caching, and has one of these shapes:

```json
{ "success": true, "data": {} }
```

```json
{ "success": false, "message": "Human-readable error" }
```

HTTP status is meaningful: 400 validation, 401 unauthenticated/incorrect credentials, 403 disallowed origin or writes to historical `CUENTAS`, 404 unknown endpoint/record (including removed `upload` action), 405 wrong method, 409 optimistic/idempotency conflict, 413 oversized request, 415 incorrect content type, 502 upstream failure, 503 unconfigured login or storage busy/failure. Unexpected server configuration errors are 500 and do not expose secrets. Apps Script errors include an internal `status` field because ContentService itself does not set HTTP status; the Node proxy converts it to an HTTP status and strips that field from the response.

| Action | Method | Body / response data |
| --- | --- | --- |
| `config` | GET, public | `{authMode: 'password', configured: boolean}` only; no credentials or secrets. |
| `session` | GET, public | `{user: null}` or `{user: {username, name, role}}`; role is `gerencia` or `personal`; 503 if all login profiles are unconfigured. |
| `login` | POST, public | Body `{username: string, password: string}`. Data `{user: {username, name, role}}`; `name` is the authenticated username. Incorrect credentials return 401; unconfigured login returns 503. |
| `logout` | POST, public | No body required. Data `{user: null}`. |
| `bootstrap` | GET, authenticated | Catalog/bootstrap object below. |
| `movements` | GET, authenticated | Full movement array, including void records, not filtered. |
| `statistics` | GET, authenticated | Filtered statistics below. |
| `create` | POST, authenticated | `{movement: MovementInput}`; data is committed movement. |
| `update` | POST, authenticated | `{movement: MovementInput + ID + UPDATED_AT}`; data is committed movement. |
| `void` | POST, authenticated | `{id: string, updatedAt: string}`; data is voided movement. |
| `saveCatalog` | POST, authenticated | `{sheet: string, row: CatalogInput}`; data is committed row. |

There is no upload endpoint in Node or Apps Script. `action=upload` is unknown and returns 404, not an upload response.

Use `Content-Type: application/json` for JSON writes. The browser must send an exact allowed `Origin`, including login and logout. The session is an HMAC-SHA256 signed, HttpOnly, SameSite=Lax, eight-hour cookie named `gerencia_session`, Secure in production. Every authenticated request rechecks the current role, username and credential-version signature. Changing a profile's username/password invalidates its sessions; changing `SESSION_SECRET` invalidates all sessions once the running server uses the new values. When no profile is configured, `config.configured` is false; `config` and `logout` remain available, while other actions return 503.

The public application link is intentionally usable by anyone with authorized profile credentials. People sharing Gerencia credentials manage its catalogs under one identity, without per-person attribution or a separate administrator. Session roles isolate Gerencia and Personal pages and Node APIs; there is no user-management interface. Client-supplied user/username fields do not set audit identity through Node. Direct Personal GAS calls bypass website authentication and can claim that identity. New Gerencia audit entries use its authenticated username; historical audit emails and creator identities are preserved.

## Personal Profile And Routing

Owner installation guide: `docs/PERSONAL_SETUP.md`; exact financial/action/schema contract: `apps-script/personal/CONTRACT.md`. The remaining accounting/setup/receipt sections in this document describe **Gerencia only**. Personal never uses the old book or Gerencia setup/reset.

Personal website credentials are already configured in Vercel; no end-user action or additional login credentials are needed. Keep existing website session/origin configuration and all Gerencia variables unchanged. Personal Node connection requires **only `PERSONAL_GAS_WEB_APP_URL`**, an independent deployed `/exec`, never equal to `GAS_WEB_APP_URL`. Personal GAS requires no shared API secret or secret Script Property. Gerencia still requires `GAS_API_SECRET`. Exact username equality between profiles disables login configuration. A valid single profile can log in even when the other is absent. Credentials alone enable website login, not financial connectivity; missing Personal route/setup yields real errors, not sample balances.

Cookie name/lifetime/flags remain shared. Each Node request rechecks its role and profile credential version. Password rotation invalidates that profile's website sessions without data loss; common SESSION_SECRET rotation invalidates all. Personal username is the stable namespace key, not a secret or proof of identity in GAS: changing it requires a migration that is not implemented. Do not use username changes as password rotation; password rotation does not protect direct public GAS calls.

GET `personal-bootstrap` and `personal-backup`; POST `personal-save`, `personal-generate`, `personal-transaction`, `personal-pay`, `personal-void`, `personal-reconcile`, `personal-configure`, `personal-upload`, `personal-resolveOperation`. All Node endpoints require the personal session; cross-role calls return 403 before upstream access. Node removes `personal-` and forwards POST JSON with `user` from the website session, without an API secret. GAS sees `user` (`username`, `name`, `role`) as a caller-claimed identity DTO, not authenticated identity; direct clients can supply it too. Write payloads include UUID `requestId`; business fields/optimistic tokens are defined in the source contract. Internal IDs/hashes/keys enforce integrity, not authentication, and are not secrets.

Before forwarding any upstream data, Node requires exact `service: "personal-finance"` and `spreadsheetId: "1WU3UF1gTgut-Yx2dUn51Kk1fu2EHtnQSfxOOdx15-Y0"`, including error envelopes. Missing/mismatched markers return 503 without exposing old-book JSON. These markers validate the expected service/document, **not authentication**. Personal public `doGet` reads actual connection/structure health and returns `connected` and `initialized` booleans, with no financial data. An old private deployment rejecting requests yields a configuration error and must be replaced/republished.

Personal is a separate **public, unauthenticated** execute-as-owner/Anyone web app using `apps-script/personal/Code.gs` and its own manifest (Sheets and Drive scopes). **Do not use confidential financial information.** Anyone with its URL and a claimed username can read/edit that entire financial namespace and export its backup; with `DRIVE_FOLDER_ID` configured, callers can upload files and consume owner storage/quotas. Restricting the Sheet remains advisable, but does not protect access via public GAS running as its owner. Private Drive file permissions remain independent, and external receipt URLs carry no privacy guarantee. Optional JPG/PNG/PDF uploads are <=3 MiB; URL-only receipts remain usable without folder configuration and preserve valid shared query parameters.

The owner already installed the previous private source and created the 11 tables' headers. Replace the **complete updated Personal file**, authorize mandatory Google permissions as owner when prompted, and publish **Nueva version** of the web app as **Yo**, access **Cualquier persona** (create a new deployment if none exists). Saving the editor does not update `/exec`. Supply the actual `/exec` URL to Node. This update has **no schema change and needs no setup rerun**, reset or financial seeds. For a genuinely new installation only, inspect all tabs readonly with `inspectPersonalStructure` before `setupPersonalSpreadsheet`; setup preserves cells/tabs and seeds only system preferences, zero financial/catalog examples. The destination ID is already fixed in the source.

Physical tables: Cuentas, Beneficiarios, Categorias, Obligaciones, Cuotas, Movimientos, Transferencias, Pagos, Configuracion, Auditoria, Operaciones. Append-only versions and bounded manifests expose only confirmed operations under lock; backup contains personal-scoped latest versions and full raw history, never properties/env secrets/passwords/file bytes. No destructive restore or identity migration. Pending operations block fresh writes except explicit resolution; verify actual rows, discard with reason, then use a fresh UUID only for the verified necessary operation. Reads retry transport/temporary non-JSON failures up to three attempts; writes never automatically retry. Executed transaction/pay/reconcile dates must be <= Sheet HOY; future plans are Cuotas, never automatically posted money. Full recurrence, card statement, adjustment and allocation semantics are in the source contract and manual.

Connected integration remains pending publication of the updated source and verification of its actual URL; local unit/browser mocks are not evidence of deployment, Google permissions or persistence. No verification writes have been made to the new live Sheet, and automated tests insert no real financial data. Any later authorized real, nonconfidential operation must be checked against Sheet transaction/audit/CONFIRMADA and exports before declaring financial integration functional. Do not seed money or use live test writes to validate this documentation change; report test results only after running the current revision, without fixed historical counts.

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

Catalog rows use uppercase fields `ID`, `NOMBRE`, `ESTADO`, `UPDATED_AT`. `JEFES` accepts optional text `TIPO` (maximum 100 characters); omission on update preserves it, and an explicit empty string clears it. Historical `CUENTAS` retains `TIPO`, `JEFE` (jefe ID), numeric `SALDO_INICIAL`, and computed numeric `SALDO_ACTUAL`, but is read-only. Catalog `ESTADO` is exactly `Activo` or `Inactivo`. IDs and reference columns read as numeric cells from Sheets are normalized to strings, including the seeded jefe IDs `'1'` and `'2'`. Bootstrap includes inactive rows for historical references. New or changed references must be active; unchanged historical references may be retained on edit.

`saveCatalog.sheet` permits only `JEFES`, `CATEGORIAS`, `FORMAS_PAGO`, `ESTADOS`. All writes targeting `CUENTAS` return 403 with `CUENTAS es un catalogo historico de solo lectura`, including creation and updates. New rows omit `ID` and `UPDATED_AT`; IDs are generated by the server. Existing rows must include the current `ID` and `UPDATED_AT`. Allowed input fields are `ID`, `NOMBRE`, `ESTADO`, `UPDATED_AT`, plus optional `TIPO` for jefes. Extra fields and deletion are rejected. Names are unique within a catalog, case-insensitively. Bootstrap account fields remain solely for historical compatibility; no accounts or balances are seeded, and the frontend has no account creation, selection, filter or display UI. An empty account catalog must not block movement registration or be replaced by fake default accounts.

The state catalog contains `Pagado`, `Pendiente`, `Pago parcial`, `Anulado`, each with its own ID. Those accounting names cannot be renamed or deactivated. Creating custom states is rejected with a clear validation error because only these four have defined accounting semantics. A movement's `ESTADO` accepts a state name or active state ID and is stored/returned as its Spanish name. `tipos` is `Gasto`, `Compra`, `Pago`, `Transferencia`, `Préstamo`, `Adelanto`, `Reembolso`, `Ingreso`, `Retiro`.

## Movement Fields And Accounting

```ts
type MovementInput = {
  FECHA: string;                 // yyyy-mm-dd, real calendar date
  HORA: string;                  // HH:mm, 24-hour
  TIPO: string;                  // exact entry from bootstrap.tipos
  JEFE: string;                  // catalog ID, not display name
  CUENTA?: string;               // optional legacy catalog ID belonging to JEFE; blank allowed
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
  CUENTA_DESTINO_ID?: string;     // optional legacy transfer destination; blank allowed
  COMPROBANTE_URL?: string;       // optional validated HTTPS Drive URL, max 300 characters
  CLAVE_IDEMPOTENCIA: string;     // crypto.randomUUID(), REQUIRED on create
};
```

Monetary inputs must be finite, nonnegative numbers with at most two decimals and at most 1,000,000,000. Quantity must be a finite, nonnegative number within the same limit. `SUBTOTAL` is computed by the server as quantity times unit price rounded to cents, using the same rounding as the frontend, and must also fit the monetary limit. Without `TOTAL_MANUAL`, `TOTAL` must match `SUBTOTAL`; with manual total enabled they may differ. The total remains tax-inclusive. Client `SUBTOTAL`, `IVA`, and `IVA_PORCENTAJE` do not control server calculations; IVA fields are always zero. Normalized output includes numeric monetary fields and a boolean `TOTAL_MANUAL`. Older rows with an empty newly appended `SUBTOTAL` column return the computed subtotal without rewriting historical cells.

`SUBCATEGORIA`, `PROVEEDOR`, `NUMERO_FACTURA`, and `OBSERVACIONES` are optional, trimmed text with type, length and control-character validation. Omitting them on update preserves existing values; explicit empty strings clear them. They are persisted in Sheets, returned by the API, and included in full before/after audits and create idempotency checks. The current frontend sends and displays `FACTURA`, so the backend accepts that concrete alias and returns it on movement reads/create/update/void, while persisting only canonical `NUMERO_FACTURA`. Supplying both names with different values is rejected. User strings are written as literal text, never executable Sheets formulas.

Only unlinked `Gasto`, `Compra`, and `Pago` may be `Pendiente` or `Pago parcial`. `Pagado` sets `PAGADO = TOTAL`; if supplied, it must match. `Pendiente` sets `PAGADO = 0`; if supplied, it must be zero. `Pago parcial` requires an explicit `0 < PAGADO < TOTAL`. All other types require `Pagado`.

A linked payment is `TIPO = Pago`, `ESTADO = Pagado`, with a positive total and `MOVIMIENTO_ORIGEN_ID` pointing to a live, unlinked expense. It must use the same jefe as the original; account equality is not required, and either account may be blank. The frontend's new linked payments do not inherit historical accounts. Original own paid amount plus all live linked payments cannot exceed the original total. Updates exclude the payment being edited when checking the cap. Original movements with live linked payments cannot be updated or voided; void the payments first. Linked payments are cash outflows, NOT new independent expenses or additional investment.

`movements` additionally returns `PAGADO_VINCULADO` and `SALDO_PENDIENTE`. `PAGADO` remains the original record's own cash payment; it is NOT increased by linked payments. The original stored `ESTADO` is not silently rewritten when linked payments settle it. Use `SALDO_PENDIENTE` to determine the current obligation. Derived fields are not persisted and are ignored on movement updates. Void records retain historical amounts but contribute nothing to balances or obligations.

For loans/advances, `DIRECCION` is mandatory and must be `Recibido` or `Entregado`. It is rejected for other types. Transfers require a positive total and `Pagado`. With both accounts blank, a transfer is recorded only: no investment, income/expense or money redistribution. If either account is supplied, both are required and must name distinct accounts of the same jefe (active for new/changed references). Other types reject a nonblank destination account. Cross-jefe transfers are not supported.

New frontend movements omit `CUENTA` and `CUENTA_DESTINO_ID` or send blank values; normalized Sheets fields remain blank. On update, omitting either field preserves its historical value only when the jefe is unchanged; explicit blank clears it, and omission after a jefe change clears it. The edit form carries historical metadata without displaying it; deliberate type or jefe changes clear both account fields. A supplied account must belong to the movement's jefe. Keep the `CUENTAS` sheet and account columns, even when all new records are accountless.

Legacy balances are calculated from existing initial balances plus cash incomes, reimbursements and received loans/advances, minus actual paid expenses, linked payments, withdrawals and delivered loans/advances, only for records with `CUENTA`. Accounted transfers debit the source and credit the destination. Pending obligations have no cash outflow. These balances exclude accountless records, do not represent the complete dataset or investment, and are not displayed as current available funds in the UI. No database, invented balance, account, or transaction is used.

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

`gastos`/`porCategoria` sum full `TOTAL` for live independent `Gasto`, `Compra` and `Pago`, including pending and partially paid obligations, once each. Linked payments never add investment. This is the frontend's **Total invertido**, distinct from actual disbursement, and independent of accounts/opening balances. Reimbursements do not reduce investment; loans, advances, income, transfers and withdrawals do not add it. Voiding excludes an obligation from investment, as do selection filters.

`cantidad` counts all selected live records, including linked payments, transfers and income, not only investment-bearing records; the `jefe` filter restricts both count and monetary totals. `pendiente` is the currently remaining obligation on selected originals after ALL live linked payments, even outside the date filter. Cash `ingresos`/`egresos` use selected records' actual paid amounts. Transfers are separate (`transferencias` includes accountless positive paid transfers), not income/expense. `neto = ingresos - egresos`. `saldos` are lifetime/current legacy balances restricted by jefe/cuenta, not date-range balances or complete-dataset cash totals. All void records are excluded.

The frontend computes these totals from the full `movements` response, refreshes after writes/reloads and applies shared date, jefe, category, type, current-state, payment-method, provider and search filters, with investment cards per jefe. It does not use an account filter. The `statistics` API retains the narrower filter contract above, including historical `cuenta`, and filters stored state rather than frontend-derived current state.

## Apps Script Setup

1. Create the Apps Script project, add the latest complete `Code.gs` and manifest from `apps-script/appsscript.json`, and authorize Sheets access as the spreadsheet owner. The current manifest has only the spreadsheets scope, no Drive scope or file-upload API.
2. Set Script Property `GAS_API_SECRET`. `DRIVE_FOLDER_ID` is obsolete and unused; no Drive folder or Drive OAuth configuration is required. No credentials were supplied with this implementation.
3. Run `inspectStructure`, inspect the report, then run `setupSpreadsheet`. The spreadsheet ID is fixed to `1waRuU63wJjxNJP8usUtHkl5mV-WM7E099dz-4llwJrI`.
4. Deploy a versioned web app executing as the owner, accessible to anyone so the Node server can reach it. Public `doGet` always returns unauthorized; `doPost` needs the constant-time-checked shared secret. After code changes, publish a new deployment version.
5. Supply the deployment URL and matching shared secret to Node, and configure the password-login variables and exact application origin privately. No Google Cloud or OAuth setup is required.
6. Setup inserts the authorized jefes, categories and payment methods listed below, never accounts or financial data. Register a movement directly by choosing jefe and movement data; no opening balance or account creation is required or available.

Target sheets: `JEFES`, `CUENTAS`, `CATEGORIAS`, `FORMAS_PAGO`, `ESTADOS`, `MOVIMIENTOS`, `AUDITORIA`, `CONFIGURACION`. Preserve all existing tables/data, including historical account sheets and fields; never erase or reset them for this upgrade. `Hoja1` and unrelated sheets are preserved. Before ANY setup change, every existing nonempty target must have all required headers, no unknown headers, and no duplicate headers. Otherwise setup refuses without changing any sheet. The existing compatibility setup appends only missing optional headers at the end, without reordering columns, overwriting data or migrating historical transactions. Empty targets receive full headers. This optional-account/URL-only upgrade introduces no new schema or header changes; an already compatible setup needs no rerun. For an older incomplete schema, inspect first and use the existing compatibility setup only as needed.

Updating the remote script is mandatory, not just the former email-to-username migration. Load the latest full `apps-script/Code.gs` and manifest, then edit the existing deployment and publish **Nueva version**, retaining the same `/exec` URL and shared secret. The update must include the new `normalize_` allowing blank accounts, same-jefe linked payments without account equality, accountless transfers, read-only `CUENTAS` and URL-only receipts with no uploads. An identity-only patch leaves the old required-account behavior. The exact runtime error `ID requerido CUENTAS` on an accountless save indicates an old deployed normalizer: replace and republish the script, never create a fake account to bypass it. Saving code alone does not update the deployed version. Public `/exec` GET is always unauthorized by design, even with a valid application session.

Authorized seed catalogs:

- `JEFES`: ID `'1'`, Franco Becerra, `TIPO = Jefe`, `ESTADO = Activo`; ID `'2'`, Josselyn Becerra, `TIPO = Jefa`, `ESTADO = Activo`.
- `CATEGORIAS`: Alimentación, Transporte, Combustible, Hospedaje, Compras, Servicios, Salud, Entretenimiento, Viajes, Mantenimiento, Tecnología, Oficina, Representación, Impuestos, Otros.
- `FORMAS_PAGO`: Efectivo, Transferencia, Tarjeta de crédito, Tarjeta de débito, Depósito, Otro.
- `ESTADOS`: Pagado, Pendiente, Pago parcial, Anulado; `CONFIGURACION`: USD and zero IVA.

All newly seeded catalog rows are active. Setup inserts only missing names (trimmed/case-insensitive comparison), never overwrites an existing row's ID, type, active state, or other data, and falls back to a collision-checked UUID when the preferred ID is already occupied. It is repeatable and never seeds accounts, balances, movements, or audit transactions.

Authenticated reads and writes take one ScriptLock so a request cannot read another request's half-completed mutation. Every successful catalog/movement write appends full before/after JSON and the authenticated shared username to `AUDITORIA`; historical emails remain unchanged. Audit entries are append-only through the API. Writes and audit are committed together with snapshot-based best-effort rollback; a failed audit is NOT success. Sheets is not an ACID database: an execution termination or failed rollback can require manual reconciliation. Error messages flag failed restoration. Manual edits and unrelated scripts do not obey this application's lock or audit, so restrict spreadsheet editing accordingly.

## Receipt URLs And Limits

`COMPROBANTE_URL` is optional with a maximum length of 300 characters. Empty string is valid; omission on update preserves the previous URL and explicit `""` clears it. Validation requires a string without whitespace matching exactly one of these expressions (or empty string):

```regex
^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/(?:view|preview)(?:\?[A-Za-z0-9_=%&.~+\-]*)?$
^https:\/\/drive\.google\.com\/open\?id=[A-Za-z0-9_-]+(?:&[A-Za-z0-9_=%&.~+\-]*)?$
```

Common shared queries such as `/view?usp=sharing` and `/open?id=ID&usp=sharing` are accepted. HTTP, other hosts/paths, fragments and whitespace are not. The frontend uses the same safe-link allowlist for tables, detail and reports, so unsafe historical values never become clickable links. URL validation cannot attest existence, privacy, file safety or viewer permissions, and no file contents are inspected. Drive owners control sharing independently; shared app credentials do not grant Google access to private receipts. The application requires no Drive OAuth or folder ID.

No frontend, Node or Apps Script upload exists; `upload` is rejected with 404. There is no receipt file-size limit because only a URL is submitted. Node retains its legacy 7 MiB JSON request limit, not an advertised file capacity. Vercel imposes its own request/response limit (commonly 4.5 MB) and may return platform 413 before the handler runs. Full movement responses remain subject to host limits, and Apps Script/Sheets quotas still apply. The GAS call timeout is 55 seconds; the Vercel project's function duration must allow that. Retry creates with the same idempotency key after transport failures, never a fresh key.

## Verification

Run `npm test` for the full unit/HTTP suite; backend-only tests can be run with `npx tsx --test tests/backend-security.test.ts tests/backend-apps-script.test.mjs`. Tests use Node's test runner, a VM-hosted Apps Script runtime, mock Sheets and local HTTP requests, without Google writes. Run `npm run build` and `npm run test:e2e` for build/browser verification; report current results only after rerunning, not historical suite counts. Earlier connected Gerencia reads and read-only account enforcement were checked on its updated Apps Script, without inserting synthetic movements or modifying existing rows. That evidence does not cover the new Personal Sheet.

The proxy retries transport/non-JSON failures for reads only, with at most three attempts sharing one 55-second timeout. Script validation/business errors and all write operations are never retried automatically. Failed creates must retain the original client idempotency key.
