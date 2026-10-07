# Cuentas Gerencia

Aplicacion administrativa para Franco Becerra y Josselyn Becerra. React 19 + TypeScript + Vite, API Node local/Vercel, Google Apps Script y Google Sheets. No utiliza una base de datos propia.

## Estado De La Entrega

Frontend, servidor, script y pruebas implementados. La conexion real NO esta activada ni verificada: el propietario debe autorizar Apps Script, desplegarlo y configurar OAuth y las variables privadas. Sin esa configuracion el sistema deniega el acceso y muestra instrucciones, nunca datos financieros de ejemplo.

Se reviso el documento por lectura: la hoja predeterminada no devolvio filas ni encabezados. El propietario confirmo que solo existe una hoja y autorizo crear la estructura. No se ha escrito en el documento remoto.

## Funciones

- Dashboard general y por responsable, gastos por categoria/persona/mes, distribucion de pagos, evolucion de gastos y del disponible.
- Crear, consultar, editar y anular los nueve tipos de movimiento. No existe borrado fisico en la API.
- Prestamos y adelantos recibidos/entregados; reembolsos que vuelven al fondo.
- Pagos parciales y pagos vinculados a una obligacion; validacion de sobrepago y aislamiento por jefe/cuenta.
- Busqueda por ID, descripcion, proveedor, factura y observaciones; filtros compartidos y reportes diarios/semanales/mensuales/rango.
- Descarga real de Excel con fechas/importes numericos y PDF horizontal paginado con totales contables.
- Comprobantes privados en Drive; solo la URL se almacena en Sheets.
- Catalogos editables, bloqueo optimista, idempotencia de creacion, auditoria de valores anteriores y posteriores.
- Formulario conservado en memoria y sessionStorage del navegador, separado por correo. No es una base de datos ni un modo offline. No almacena una copia local del libro financiero.

## Arquitectura Y Seguridad

```text
Navegador React
    -> /api/index (Node local o funcion de Vercel)
    -> Google Apps Script (secreto servidor a servidor)
    -> Google Sheets / Drive
```

La capa Node es necesaria para un frontend independiente sin exponer secretos y para evitar el problema de CORS de Apps Script. La API comprueba el ID token de Google y limita el acceso a `ALLOWED_EMAILS`. Usa cookie HttpOnly, SameSite=Lax, Secure en produccion, de ocho horas. Revalida la lista de correos en cada solicitud y valida Origin en escrituras. El correo auditado procede de la sesion verificada, no de un campo editable del formulario.

El ID del cliente OAuth es publico por diseno; no es una clave privada. Todos los otros secretos se mantienen en `.env` o variables del servidor. No uses prefijos `VITE_` para secretos. No publiques `.env` en Git. Todos los correos autorizados pueden administrar los catalogos; no hay roles adicionales.

IMPORTANTE: el Spreadsheet suministrado era legible sin iniciar sesion. Antes de guardar finanzas reales, cambia **Compartir > Acceso general > Restringido** y conserva unicamente los permisos de quienes lo necesiten. La autenticacion de la aplicacion no protege un documento que siga siendo publico por separado.

## 1. Configurar Sheets Y Apps Script

1. Abre el Spreadsheet con su cuenta propietaria: https://docs.google.com/spreadsheets/d/1waRuU63wJjxNJP8usUtHkl5mV-WM7E099dz-4llwJrI/edit
2. Abre **Extensiones > Apps Script**. El codigo completo esta en `apps-script/Code.gs`.
3. En la configuracion del editor activa la visualizacion de `appsscript.json`; utiliza el manifiesto de `apps-script/appsscript.json`. La zona UTC del manifiesto no cambia las fechas/horas locales ingresadas en el formulario. Configura la zona del Spreadsheet si vas a editar fechas directamente alli.
4. En **Configuracion del proyecto > Propiedades de la secuencia de comandos**, agrega `GAS_API_SECRET` con un secreto aleatorio largo. No es la contrasena de Google.
5. Crea una carpeta privada en Drive para comprobantes y registra su ID como `DRIVE_FOLDER_ID`. Es el segmento posterior a `/folders/` en su URL. Puedes terminar esta parte posteriormente, pero las cargas no funcionaran sin ella.
6. Ejecuta `inspectStructure` desde el editor y revisa el registro de ejecucion. Esto es de solo lectura.
7. Ejecuta `setupSpreadsheet` y autoriza Sheets y Drive con la cuenta propietaria. El script inspecciona todos los destinos antes de modificarlos y rechaza encabezados incompatibles. No elimina ni renombra la hoja original.

Se crean estas hojas: `MOVIMIENTOS`, `JEFES`, `CUENTAS`, `CATEGORIAS`, `FORMAS_PAGO`, `ESTADOS`, `AUDITORIA`, `CONFIGURACION`.

Solo se inicializan los dos nombres autorizados, las 15 categorias y seis formas de pago solicitadas, los cuatro estados contables y USD/IVA cero. No se crean cuentas, proveedores, facturas, movimientos ni fondos. La inicializacion es repetible y no sobrescribe nombres ni filas existentes.

La estructura conserva los datos funcionales solicitados. Nombres canonicos usados por esta API: `TIPO` equivale a `TIPO_MOVIMIENTO`, `VALOR_UNITARIO` a `PRECIO_UNITARIO`, `JEFE` en cuentas al ID del jefe. Incluye `SUBTOTAL`, `IVA`, `TOTAL`, `SUBCATEGORIA`, `PROVEEDOR`, `NUMERO_FACTURA`, `COMPROBANTE_URL`, `OBSERVACIONES`, `USUARIO_REGISTRO`, `CREATED_AT`, `UPDATED_AT` y columnas de pagos, direccion, vinculacion y control. La lista exacta esta en `SCHEMA` de `Code.gs`. No cambies encabezados manualmente: ante una estructura distinta se requiere una adaptacion explicita.

## 2. Desplegar La Web App

1. En Apps Script selecciona **Implementar > Nueva implementacion > Aplicacion web**.
2. **Ejecutar como: Yo**, la cuenta propietaria con acceso al documento y la carpeta.
3. **Quien tiene acceso: Cualquier persona**. La funcion es accesible para el servidor de Vercel, pero NO publica datos: cada POST exige el secreto; GET siempre responde no autorizado.
4. Autoriza y copia la URL que termina en `/exec`.
5. Registra esa URL en `GAS_WEB_APP_URL` del servidor. No uses `/dev` ni la URL de Sheets.
6. Tras cambios de codigo, edita la implementacion y selecciona **Nueva version**; mantener el mismo despliegue evita cambiar la URL.

El secreto del script y `GAS_API_SECRET` de Node deben ser identicos. No se necesitan service accounts ni claves privadas de Google.

## 3. Configurar El Acceso Con Gmail

1. En https://console.cloud.google.com/ crea o selecciona un proyecto.
2. Configura **Google Auth Platform** / pantalla de consentimiento. Para Gmail personal utiliza audiencia **Externa**. Si esta en modo prueba, agrega el Gmail del secretario como usuario de prueba. Configura nombre de la app y correos de soporte que realmente correspondan.
3. Crea un cliente OAuth de tipo **Aplicacion web**.
4. Agrega como origen JavaScript autorizado `http://localhost:5173`. Para produccion agrega el origen exacto `https://TU-PROYECTO.vercel.app` o tu dominio real, sin rutas ni barra final. Esta integracion utiliza Google Identity Services con ID token, no una ruta de callback propia.
5. Coloca el **ID del cliente** en `GOOGLE_CLIENT_ID` del servidor. El secreto del cliente OAuth no se utiliza en esta integracion y no debe ponerse en el frontend.
6. Coloca el Gmail real autorizado en `ALLOWED_EMAILS`. Para varios usuarios, separa los correos con comas. Una lista vacia deniega todos los accesos.

## 4. Probar Localmente

Requisito: Node 22.12 o superior. Dependencias instaladas y bloqueo de versiones en `package-lock.json`.

Crea `.env` a partir de la plantilla `.env.example` y completa estos valores exclusivamente en el servidor:

| Variable | Valor |
| --- | --- |
| `GOOGLE_CLIENT_ID` | ID del cliente OAuth web |
| `ALLOWED_EMAILS` | Gmail real del secretario |
| `SESSION_SECRET` | Secreto aleatorio de al menos 32 caracteres |
| `GAS_WEB_APP_URL` | URL `/exec` de Apps Script |
| `GAS_API_SECRET` | Mismo secreto configurado en Apps Script |
| `APP_ORIGIN` | `http://localhost:5173` |
| `PORT` | `3001` |

Para generar cada secreto de forma independiente, ejecuta:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

```powershell
npm install
npm run dev
```

Abre **http://localhost:5173**. `npm run dev` inicia Vite y la API en el puerto 3001. Como alternativa, ejecuta `npm run dev:api` y `npm run dev:web` en dos terminales. Usa `localhost`, no `127.0.0.1`, en el navegador porque el origen OAuth/CSRF debe coincidir. Reinicia la API al cambiar `.env`.

`npm run preview` solo sirve el bundle, no inicia la API ni sustituye la prueba local conectada.

## 5. Probar Un Registro Real

1. Inicia sesion con el Gmail autorizado. Deben aparecer Franco y Josselyn y los catalogos iniciales desde Sheets.
2. En **Configuracion > Cuentas**, crea una cuenta real, selecciona su jefe y especifica expresamente el saldo inicial real. Si no existen fondos iniciales y asi corresponde, ingresa cero. No registres el mismo fondo otra vez como ingreso.
3. En **Nuevo movimiento**, selecciona jefe, cuenta, fecha, hora, tipo, categoria, forma de pago y descripcion. Ingresa una operacion real autorizada y su precio final con IVA incluido.
4. Comprueba el subtotal y el total. Si corresponde, activa total manual. No se suma IVA.
5. Guarda. Debe mostrarse **Movimiento registrado correctamente.**
6. Verifica la fila en `MOVIMIENTOS`: ID unico, usuario de registro y timestamps. Verifica una entrada `CREAR` en `AUDITORIA`.
7. Recarga el navegador. El movimiento debe seguir apareciendo porque se consulta Sheets, no una lista de demostracion.

Si deseas usar un dato ficticio de prueba, hazlo SOLO en un Spreadsheet de pruebas independiente: cambia `SPREADSHEET_ID` en una copia del script y despliega otra Web App. No insertes fixtures de las pruebas automatizadas en el libro financiero real.

## 6. Probar Consultas Y Pagos

1. Abre **Movimientos** y busca el ID o factura del registro anterior.
2. Aplica filtros de fecha, jefe, categoria, tipo, estado y forma de pago; verifica dashboard y reportes.
3. En herramientas de desarrollo del navegador, la solicitud `/api/index?action=movements` debe responder `{success:true,data:[...]}`. Sin sesion debe responder 401.
4. Para una obligacion real pendiente, usa **Pendientes > Pagar**. El pago queda vinculado al original; disminuye el pendiente y el fondo, pero no suma un nuevo gasto.
5. Edita un registro sin pagos vinculados y verifica nueva auditoria y `UPDATED_AT`. Si otro usuario ya lo modifico, se exige recargar.
6. Anula solo cuando corresponda. La fila permanece en el historial y deja de afectar los totales. Para anular/editar un original con pagos vinculados, primero deben anularse dichos pagos.
7. Descarga Excel y PDF desde Reportes. Los totales excluyen anulados y separan obligaciones de egresos para no duplicar pagos.

## 7. Publicar Con Git Y Vercel

El proyecto no se ha inicializado, enviado ni publicado en Git automaticamente. Revisa los archivos antes de crear tu repositorio; `.gitignore` excluye secretos, dependencias y resultados de pruebas.

1. Importa tu repositorio Git en Vercel. Framework Vite; Build `npm run build`; salida `dist`. `vercel.json` contiene la configuracion.
2. Selecciona Node 22 o superior. Las rutas `api/*.ts` se despliegan como funciones Node.
3. Configura las cinco variables privadas de la tabla y `APP_ORIGIN` con el origen HTTPS real. En produccion `NODE_ENV` debe ser `production` (Vercel lo establece normalmente).
4. Autoriza ese mismo origen en Google OAuth.
5. Despliega o vuelve a desplegar tras modificar las variables. Comprueba la sesion y repite la prueba de consulta/registro.

**No debes colocar la URL de Apps Script en el JavaScript del frontend.** Va en `GAS_WEB_APP_URL` de Vercel/`.env`. El navegador utiliza exclusivamente `/api/index` del mismo dominio. Tampoco hay tokens de acceso secretos en el cliente.

Cada dominio de preview tiene su propio origen y necesitaria autorizacion OAuth; utiliza un dominio estable para las pruebas conectadas. No amplifiques permisos con comodines.

## Reglas Contables

- USD, precios finales con IVA incluido. `IVA` y `IVA_PORCENTAJE` permanecen en cero; cero significa que la app no agrega impuesto, no que la factura carezca de IVA.
- Saldo de cada cuenta = saldo inicial + ingresos/reembolsos/prestamos o adelantos recibidos - pagos efectivos/gastos pagados/retiros/prestamos o adelantos entregados, con transferencias entre cuentas.
- Pendientes no reducen el fondo hasta el desembolso. Pago parcial reduce solo el importe pagado.
- Un pago vinculado liquida una obligacion, no crea otro gasto. No se permiten sobrepagos ni vinculos entre jefes o cuentas diferentes.
- Transferencias solo entre cuentas diferentes del mismo jefe. Transferencias entre jefes requieren una ampliacion contable explicita; no estan implementadas.
- Disponible considera el historial hasta la fecha final y responde a jefe/cuenta. No se recalcula como un saldo artificial por categoria o busqueda. Pendiente es el saldo actual, incluyendo pagos posteriores al periodo seleccionado.
- El estado actual mostrado/filtrado en el frontend se deriva de los pagos. Se conserva el estado registrado original en Sheets y en los reportes. El endpoint `statistics` filtra el estado registrado.
- Estados contables actuales: Pagado, Pendiente, Pago parcial, Anulado. Se cargan de Sheets; no se permiten estados personalizados sin definir antes su efecto financiero.
- No se impiden saldos negativos; se muestran tal como resultan del libro. Las cuentas con historial no permiten cambiar jefe/saldo inicial. Corrige mediante operaciones auditadas, no modificando la base financiera.

## Comprobantes

La interfaz permite JPG/JPEG/PNG/PDF hasta **3 MiB** para mantenerse por debajo del limite de solicitudes de Vercel despues de codificar base64. La API admite 5 MiB localmente, pero no se promete ese tamano en Vercel. Para mas tamano se necesita otra estrategia de carga, no implementada.

Las firmas de archivo y el tipo se validan en Node y Apps Script. Esto no sustituye un antivirus. La carpeta debe ser privada; no se publican archivos con acceso para cualquiera. Comparte expresamente la carpeta/archivos con los Gmail que necesiten abrirlos: estar autorizado en la app no concede permisos de Drive.

Un archivo cargado antes de guardar o descartar un movimiento puede quedar sin asociar en Drive, con su registro de carga en auditoria. No existe limpieza automatica para evitar borrar comprobantes importantes.

## Errores Y Limites

Si falla la conexion, aparece **No se pudo conectar con el servidor de datos.** Si falla guardar, aparece **No se pudo guardar el movimiento. Verifique la conexion.** con detalles cuando corresponda. El formulario no se borra.

Una respuesta incierta bloquea el borrador para reintentar exactamente el mismo UUID y contenido. No crees otro registro para el mismo movimiento sin verificar primero el historial. El descarte requiere confirmacion. Las ediciones usan bloqueo optimista: si la respuesta de una edicion se pierde, recarga y revisa la auditoria antes de volver a editar.

Sheets no ofrece transacciones ACID: el script usa LockService y restauracion de mejor esfuerzo cuando falla la escritura/auditoria. Una terminacion de ejecucion o fallo de restauracion requiere conciliacion manual. No edites movimientos directamente en Sheets: se omiten validaciones y auditoria.

La consulta trae el libro completo y las tablas paginan en el navegador. Para libros grandes se necesita paginacion desde el servidor y procesamiento incremental. Aplican cuotas de Apps Script/Drive, el limite de respuesta de Vercel y un timeout de 55 segundos. No se afirma soporte ilimitado ni trabajo offline.

## Pruebas

```powershell
npm run build
npm test
npm audit
npx playwright install chromium
npm run test:e2e
```

Las pruebas unitarias/HTTP usan servicios aislados y un runtime simulado de Apps Script; no escriben en Google. Playwright intercepta todas las solicitudes de datos y usa fixtures exclusivamente de prueba. Comprueba escritorio y movil, formulario, reintento tras recarga, pagos vinculados y archivos Excel/PDF reales. No equivale a una prueba de OAuth/Sheets/Drive en vivo.

Verificacion de esta entrega: build correcto; 34 pruebas unitarias/HTTP aprobadas; 10 pruebas de navegador aprobadas; `npm audit` sin vulnerabilidades reportadas. Se comprobo tambien el arranque conjunto local: frontend y API respondieron HTTP 200. No se verifico un despliegue real de Vercel o Google.

## Archivos

| Ruta | Responsabilidad |
| --- | --- |
| `src/App.tsx`, `src/styles.css` | Sesion, navegacion, pantallas y diseno responsive |
| `src/MovementForm.tsx`, `src/components.tsx` | Formularios, filtros, tablas, detalle y modales |
| `src/Dashboard.tsx`, `src/finance.ts` | Indicadores, graficos y reglas financieras |
| `src/Catalogs.tsx`, `src/reports.ts` | Catalogos y exportaciones |
| `src/api.ts`, `src/types.ts` | Cliente API y contrato tipado |
| `server/handler.ts`, `server/security.ts`, `server/dev.ts` | API, autenticacion y servidor local |
| `api/*.ts` | Entradas de funciones Vercel |
| `apps-script/Code.gs`, `apps-script/appsscript.json` | API Sheets/Drive, configuracion y auditoria |
| `server/CONTRACT.md` | Contrato detallado de endpoints, campos y limites |
| `tests/`, `e2e/`, `playwright.config.ts` | Pruebas automatizadas |
| `.env.example`, `vercel.json`, `vite.config.ts` | Configuracion local y despliegue |
| `scripts/dev.mjs`, `package.json`, `package-lock.json`, `tsconfig*.json` | Ejecucion, dependencias y compilacion |

## Que Falta Para Activar La Conexion Real

El propietario debe proporcionar/configurar: Gmail autorizado, ID publico del cliente OAuth, URL `/exec`, secreto compartido y secreto de sesion en variables privadas, carpeta Drive y autorizacion de ejecucion. No compartas contrasenas, secretos o tokens por chat. Puedes comunicar la URL publica del despliegue y el ID publico de OAuth si necesitas ayuda; configura los secretos directamente en tu entorno.
