# Cuentas Gerencia

Aplicacion administrativa para Franco Becerra y Josselyn Becerra. React 19 + TypeScript + Vite, API Node local/Vercel, Google Apps Script y Google Sheets. No utiliza una base de datos propia.

## Manual De Usuario

Guia completa de 16 secciones: [manual en linea](https://cuentas-jefes.vercel.app/manual-usuario.html) y [manual PDF](https://cuentas-jefes.vercel.app/manual-usuario.pdf). El enlace tambien aparece en la pagina de acceso y en el pie de la aplicacion. La fuente es `public/manual-usuario.html`; regenera su PDF con `npm run manual:pdf` despues de modificarla (requiere Chromium de Playwright).

La demostracion autorizada ha concluido y queda como antecedente de validacion, no como contenido activo para el cliente. Se retiraron el Excel publico de demostracion y la utilidad de carga ficticia. La seccion 15 del manual describe la primera puesta en marcha sin volver a insertar datos de ejemplo.

## Estado De La Entrega

Aplicacion desplegada en https://cuentas-jefes.vercel.app con acceso por usuario/contrasena, movimientos sin cuentas y comprobantes opcionales por URL. Durante la demostracion se comprobaron el login, las consultas protegidas y la persistencia en Sheets, incluidos pagos vinculados y pagos parciales. Las credenciales se mantienen exclusivamente en variables privadas. La aplicacion no genera datos de ejemplo automaticamente al abrirla o desplegarla.

El propietario ahora autoriza expresamente borrar TODOS los datos financieros actualmente almacenados, incluidos los originales y los agregados posteriormente, tras un respaldo, para iniciar el cliente desde cero. El procedimiento de reinicio esta preparado, pero el borrado remoto sigue pendiente: solo el propietario puede ejecutarlo desde el editor de Apps Script. La ultima lectura conectada reporto 22 movimientos, una cuenta historica, 16 categorias y dos jefes. Hasta ejecutar y verificar el reinicio, esos datos permanecen y no se garantiza una API vacia ni totales en cero.

### Reinicio Excepcional Del Cliente

1. Coordina una pausa de escrituras. Con la cuenta propietaria, incorpora `apps-script/Reset.gs` al mismo proyecto de Apps Script conectado y ejecuta `reiniciarDatosCliente()` desde el editor. Es una operacion administrativa excepcional, no un endpoint de la API ni una accion de la interfaz. No exige republicar la aplicacion web, migrar la instalacion o cambiar su URL.
2. Antes de borrar, la funcion crea un Google Spreadsheet privado en la cuenta propietaria con respaldo de todas las hojas definidas en `SCHEMA`. Conserva y verifica el enlace mostrado en el registro de ejecucion; no lo publiques. El respaldo conserva los datos previos fuera del libro operativo.
3. Se vacian exclusivamente las filas de datos de `MOVIMIENTOS`, `CUENTAS` y `AUDITORIA`, manteniendo los encabezados. Se conservan `JEFES`, `CATEGORIAS`, `FORMAS_PAGO`, `ESTADOS` y `CONFIGURACION`, incluidos IDs, metadatos y cambios del usuario. No se crean cuentas, asignaciones de fondos ni movimientos ficticios.
4. Tras la ejecucion, verifica las tres hojas financieras vacias. Actualiza la aplicacion, limpia busqueda y TODOS los filtros, descarta borradores de las pruebas y verifica cero movimientos e indicadores en cero, con los catalogos conservados y sin errores de carga. Retirar archivos del repositorio no sustituye esta verificacion remota.
5. Registra directamente el primer movimiento real autorizado, con comprobante opcional y sin cuentas ni saldo inicial. Recarga para comprobar persistencia en Sheets y nueva auditoria; exporta desde Reportes, verifica el archivo y guardalo en una ubicacion autorizada. No uses nuevos registros ficticios para validar el inicio.

El reinicio no cambia credenciales. Antes de entregar acceso al cliente, rota por separado las credenciales en las variables privadas del servidor y verifica el acceso; nunca publiques contrasenas, secretos ni tokens. Fuera de este reinicio explicitamente autorizado, sigue vigente la anulacion con historial y no existe borrado fisico financiero en la interfaz normal ni en la API.

## Funciones

- Dashboard general y por responsable, total invertido actualizado con los movimientos consultados y todos los filtros compartidos, gastos por categoria/persona/mes, distribucion de pagos y evolucion de gastos.
- Crear, consultar, editar y anular los nueve tipos de movimiento. No existe borrado fisico en la API.
- Prestamos y adelantos recibidos/entregados; reembolsos que vuelven al fondo.
- Pagos parciales y pagos vinculados a una obligacion; validacion de sobrepago y aislamiento por jefe, sin exigir igualdad de cuenta.
- Busqueda por ID, descripcion, proveedor, factura y observaciones; filtros compartidos y reportes diarios/semanales/mensuales/rango.
- Descarga real de Excel con fechas/importes numericos y PDF horizontal paginado con totales contables.
- Comprobantes opcionales mediante enlaces HTTPS de Drive; solo la URL se almacena en Sheets, sin cargas de archivos.
- Registro directo por jefe, sin crear, seleccionar ni mostrar cuentas. Las hojas y referencias historicas de cuentas se conservan.
- Catalogos editables, bloqueo optimista, idempotencia de creacion, auditoria de valores anteriores y posteriores.
- Formulario conservado en memoria y sessionStorage del navegador, separado por username. No es una base de datos ni un modo offline. No almacena una copia local del libro financiero.

## Arquitectura Y Seguridad

```text
Navegador React
    -> /api/index (Node local o funcion de Vercel)
    -> Google Apps Script (secreto servidor a servidor)
    -> Google Sheets
```

La capa Node es necesaria para un frontend independiente sin exponer secretos y para evitar el problema de CORS de Apps Script. El enlace de la aplicacion es publico: cualquier persona con el usuario y la contrasena compartidos definidos por el propietario puede iniciar sesion. Este es el acceso previsto para la asignacion; no requiere Gmail, OAuth ni Google Cloud. La API valida `APP_USERNAME` y `APP_PASSWORD` del servidor y entrega una cookie firmada de ocho horas, HttpOnly, SameSite=Lax y Secure en produccion. La sesion devuelve `{username, name}` y se revalida en cada solicitud; cambiar usuario, contrasena o `SESSION_SECRET` invalida las sesiones anteriores. Las escrituras validan Origin.

El username auditado procede de la sesion verificada, no del formulario. Todos los usuarios de estas credenciales comparten la misma identidad y pueden administrar catalogos; no hay roles ni atribucion por persona. Las nuevas auditorias usan el username compartido; se conservan los correos de registros y auditorias historicos, sin reescribirlos.

La contrasena y los secretos viven exclusivamente en `.env` local o variables privadas del servidor, nunca en Sheets ni en el bundle/configuracion publica del frontend. Los datos financieros y las URLs se almacenan exclusivamente en Sheets; la app no crea ni administra comprobantes de Drive. El respaldo privado del reinicio excepcional se crea por separado desde el editor del propietario, no desde la app. No uses prefijos `VITE_` para secretos ni publiques `.env` en Git. `/api/config` solo publica `{authMode: "password", configured: true/false}`, sin usuario, contrasena ni secretos.

No hay bloqueo distribuido ni limite de intentos de contrasena implementado. El endpoint publico de login permite intentos repetidos sin limite propio; validar Origin no impide ataques desde clientes externos. Para produccion real, configura y verifica reglas de firewall/rate limiting en Vercel para `/api/login` y `/api/index?action=login`, y utiliza una contrasena aleatoria fuerte. Esta proteccion es una recomendacion pendiente, no una capacidad ya implementada.

IMPORTANTE: el Spreadsheet suministrado era legible sin iniciar sesion. Antes de guardar finanzas reales, cambia **Compartir > Acceso general > Restringido** y conserva unicamente los permisos de quienes lo necesiten. La autenticacion de la aplicacion no protege un documento que siga siendo publico por separado.

## 1. Configurar Sheets Y Apps Script

1. Abre el Spreadsheet con su cuenta propietaria: https://docs.google.com/spreadsheets/d/1waRuU63wJjxNJP8usUtHkl5mV-WM7E099dz-4llwJrI/edit
2. Abre **Extensiones > Apps Script**. El codigo completo esta en `apps-script/Code.gs`.
3. En la configuracion del editor activa la visualizacion de `appsscript.json`; utiliza el manifiesto de `apps-script/appsscript.json`. La zona UTC del manifiesto no cambia las fechas/horas locales ingresadas en el formulario. Configura la zona del Spreadsheet si vas a editar fechas directamente alli.
4. En **Configuracion del proyecto > Propiedades de la secuencia de comandos**, agrega `GAS_API_SECRET` con un secreto aleatorio largo. No es la contrasena de Google.
5. Ejecuta `inspectStructure` desde el editor y revisa el registro de ejecucion. Esto es de solo lectura. `DRIVE_FOLDER_ID` es obsoleto y no se utiliza.
6. Para la configuracion inicial, ejecuta `setupSpreadsheet` y autoriza Sheets con la cuenta propietaria. El manifiesto actual solo solicita el alcance de Sheets, no Drive. El script inspecciona todos los destinos antes de modificarlos y rechaza encabezados incompatibles. No elimina ni renombra la hoja original.

Se crean estas hojas: `MOVIMIENTOS`, `JEFES`, `CUENTAS`, `CATEGORIAS`, `FORMAS_PAGO`, `ESTADOS`, `AUDITORIA`, `CONFIGURACION`.

Solo se inicializan los dos nombres autorizados, las 15 categorias y seis formas de pago solicitadas, los cuatro estados contables y USD/IVA cero. No se crean cuentas, proveedores, facturas, movimientos ni fondos. La inicializacion es repetible y no sobrescribe nombres ni filas existentes.

La estructura conserva los datos funcionales solicitados. Nombres canonicos usados por esta API: `TIPO` equivale a `TIPO_MOVIMIENTO`, `VALOR_UNITARIO` a `PRECIO_UNITARIO`, `JEFE` en cuentas al ID del jefe. Incluye `SUBTOTAL`, `IVA`, `TOTAL`, `SUBCATEGORIA`, `PROVEEDOR`, `NUMERO_FACTURA`, `COMPROBANTE_URL`, `OBSERVACIONES`, `USUARIO_REGISTRO`, `CREATED_AT`, `UPDATED_AT` y columnas de pagos, direccion, vinculacion y control. La lista exacta esta en `SCHEMA` de `Code.gs`. No cambies encabezados manualmente: ante una estructura distinta se requiere una adaptacion explicita.

## 2. Desplegar La Web App

1. En Apps Script selecciona **Implementar > Nueva implementacion > Aplicacion web**.
2. **Ejecutar como: Yo**, la cuenta propietaria con acceso al documento.
3. **Quien tiene acceso: Cualquier persona**. La funcion es accesible para el servidor de Vercel, pero NO publica datos: cada POST exige el secreto; GET siempre responde no autorizado.
4. Autoriza y copia la URL que termina en `/exec`.
5. Registra esa URL en `GAS_WEB_APP_URL` del servidor. No uses `/dev` ni la URL de Sheets.
6. Tras cambios de codigo, edita la implementacion y selecciona **Nueva version**; mantener el mismo despliegue evita cambiar la URL.

El secreto del script y `GAS_API_SECRET` de Node deben ser identicos. No se necesitan service accounts ni claves privadas de Google.

### Actualizacion Obligatoria Del Script Existente

Carga el archivo completo mas reciente `apps-script/Code.gs` y el manifiesto actual en el proyecto existente. Usa **Implementar > Gestionar implementaciones > Editar > Nueva version > Implementar**, conservando la misma URL `/exec`, `GAS_API_SECRET` y todas las tablas y filas existentes. Guardar el editor no actualiza la version publicada.

La actualizacion ya no es solo email a username: incluye `CUENTA` opcional en `normalize_`, preservacion de referencias historicas al editar, vinculos por el mismo jefe sin igualdad de cuenta, transferencias sin cuentas, `CUENTAS` de solo lectura y comprobantes por URL sin uploads. Un parche antiguo que solo cambia identidad es insuficiente; como minimo el nuevo normalizador es obligatorio, y se debe usar el archivo completo para mantener todas las reglas coherentes.

Si al guardar aparece exactamente **`ID requerido CUENTAS`**, el `/exec` remoto sigue ejecutando el normalizador antiguo que exige cuenta. Actualiza y republica **Nueva version** en ese mismo despliegue y reintenta. **Nunca crees una cuenta ficticia para evitar el error.**

Esta actualizacion no agrega ni cambia encabezados: conserva `CUENTAS`, `CUENTA` y `CUENTA_DESTINO_ID` para el historial, aunque los movimientos nuevos omitan o dejen vacia la cuenta. Con el esquema ya compatible no hace falta repetir `setupSpreadsheet`, reinicializar ni borrar datos. Si la API pide setup por una estructura anterior, inspecciona primero; el setup existente agrega solo columnas opcionales compatibles sin borrar filas. GET publico a `/exec` siempre devuelve `No autorizado`; es el comportamiento previsto, no una prueba fallida de conexion.

## 3. Configurar El Acceso Compartido En Vercel

En el proyecto Vercel configura estas seis variables para Production, directamente en su panel privado. No envies contrasenas, secretos ni tokens por chat.

| Variable | Valor |
| --- | --- |
| `APP_USERNAME` | Usuario compartido no vacio, hasta 100 caracteres, sin caracteres de control |
| `APP_PASSWORD` | Contrasena fuerte compartida de 8 a 512 caracteres, no solo espacios |
| `SESSION_SECRET` | Secreto aleatorio independiente de al menos 32 caracteres |
| `GAS_WEB_APP_URL` | URL `/exec` de la implementacion actualizada de Apps Script |
| `GAS_API_SECRET` | Mismo secreto privado configurado en Apps Script |
| `APP_ORIGIN` | `https://cuentas-jefes.vercel.app` |

Usuario y contrasena se comparan exactamente, sin normalizar mayusculas ni espacios. Configura las credenciales posteriormente y compartelas solo por un canal privado con quienes deban acceder. Las variables de login no cambian. No se necesitan nuevas credenciales Google, cliente OAuth de Drive ni configuracion de Google Cloud; solo la autorizacion de Sheets por la cuenta propietaria del script. Abrir un comprobante privado requiere por separado acceso de su visor en Google.

## 4. Probar Localmente

Requisito: Node 22.12 o superior. Dependencias instaladas y bloqueo de versiones en `package-lock.json`.

Crea `.env` a partir de la plantilla `.env.example` y completa estos valores exclusivamente en el servidor. La plantilla conserva el origen local, no el de produccion:

| Variable | Valor |
| --- | --- |
| `APP_USERNAME` | Usuario compartido, hasta 100 caracteres |
| `APP_PASSWORD` | Contrasena fuerte de 8 a 512 caracteres |
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

Abre **http://localhost:5173**. `npm run dev` inicia Vite y la API en el puerto 3001. Como alternativa, ejecuta `npm run dev:api` y `npm run dev:web` en dos terminales. Usa `localhost`, no `127.0.0.1`, en el navegador porque el origen de las escrituras debe coincidir. Reinicia la API al cambiar `.env`.

`npm run preview` solo sirve el bundle, no inicia la API ni sustituye la prueba local conectada.

## 5. Probar Un Registro Real

1. Inicia sesion con el usuario y la contrasena compartidos. Deben aparecer Franco y Josselyn y los catalogos iniciales desde Sheets, una vez actualizado y republicado el script.
2. Abre **Nuevo movimiento** directamente; no necesitas cuentas ni saldo inicial.
3. Selecciona jefe, fecha, hora, tipo, categoria, forma de pago y descripcion. Ingresa una operacion real autorizada y su precio final con IVA incluido; si corresponde, agrega una URL opcional de comprobante.
4. Comprueba el subtotal y el total. Si corresponde, activa total manual. No se suma IVA.
5. Guarda. Debe mostrarse **Movimiento registrado correctamente.**
6. Verifica la fila en `MOVIMIENTOS`: ID unico, usuario de registro y timestamps. Verifica una entrada `CREAR` en `AUDITORIA`.
7. Recarga el navegador. El movimiento debe seguir apareciendo porque se consulta Sheets, no una lista de demostracion.

Para practicar, usa un Spreadsheet de pruebas separado. La demostracion de esta entrega ya concluyo; no insertes fixtures de las pruebas automatizadas ni nuevos datos ficticios en el almacenamiento del cliente.

## 6. Probar Consultas Y Pagos

1. Abre **Movimientos** y busca el ID o factura del registro anterior.
2. Aplica filtros de fecha, jefe, categoria, tipo, estado y forma de pago; verifica dashboard y reportes.
3. En herramientas de desarrollo del navegador, la solicitud `/api/index?action=movements` debe responder `{success:true,data:[...]}`. Sin sesion debe responder 401.
4. Para una obligacion real pendiente, usa **Pendientes > Pagar**. El pago queda vinculado al original del mismo jefe; disminuye el pendiente y registra el egreso efectivo, pero no suma un nuevo gasto ni inversion.
5. Edita un registro sin pagos vinculados y verifica nueva auditoria y `UPDATED_AT`. Si otro usuario ya lo modifico, se exige recargar.
6. Anula solo cuando corresponda. La fila permanece en el historial y deja de afectar los totales. Para anular/editar un original con pagos vinculados, primero deben anularse dichos pagos.
7. Descarga Excel y PDF desde Reportes. Los totales excluyen anulados y separan obligaciones de egresos para no duplicar pagos.

## 7. Publicar Con Git Y Vercel

Repositorio existente: https://github.com/by10granda/CUENTAS-JEFES, rama `main`. Despliegue existente: https://cuentas-jefes.vercel.app. `.gitignore` excluye secretos, dependencias y resultados de pruebas. Los cambios enviados a `main` generan un nuevo despliegue mediante la integracion con Vercel.

1. Comprueba la vinculacion del repositorio y la rama `main` en Vercel. Framework Vite; Build `npm run build`; salida `dist`. `vercel.json` contiene la configuracion.
2. Selecciona Node 22 o superior. Las rutas `api/*.ts` se despliegan como funciones Node.
3. Configura las seis variables de la seccion 3. En produccion `NODE_ENV` debe ser `production` (Vercel lo establece normalmente).
4. Actualiza el `Code.gs` completo y el manifiesto; republica Apps Script como **Nueva version** antes de probar movimientos sin cuentas y comprobantes por URL.
5. Envia los cambios a `main` y despliega; vuelve a desplegar tras modificar variables. Comprueba login, sesion, rotacion de contrasena y consultas/escrituras protegidas. Estas pruebas financieras en vivo siguen pendientes.

**No debes colocar la URL de Apps Script en el JavaScript del frontend.** Va en `GAS_WEB_APP_URL` de Vercel/`.env`. El navegador utiliza exclusivamente `/api/index` del mismo dominio. Tampoco hay tokens de acceso secretos en el cliente.

Cada dominio de preview tiene su propio origen y configuracion de variables; utiliza un dominio estable para las pruebas conectadas y configura el origen exacto cuando corresponda. No amplifiques permisos con comodines.

## Reglas Contables

- USD, precios finales con IVA incluido. `IVA` y `IVA_PORCENTAJE` permanecen en cero; cero significa que la app no agrega impuesto, no que la factura carezca de IVA.
- Total invertido = suma de `TOTAL` de Gasto, Compra y Pago independientes vigentes, incluidos pendientes y pagos parciales completos. Excluye anulados y pagos vinculados para no duplicar. Responde a todos los filtros compartidos y se desglosa por jefe; no depende de cuentas ni saldos iniciales.
- Inversion no equivale a efectivo desembolsado: los egresos usan lo efectivamente pagado, incluidos abonos vinculados. Pendiente usa el total menos el pago propio y todos los pagos vinculados vigentes, incluso posteriores al periodo seleccionado.
- Reembolsos son ingresos efectivos y no restan inversion. Prestamos, adelantos, ingresos, transferencias y retiros no suman inversion; solo anular excluye una obligacion del total, ademas de los filtros aplicados.
- Un pago vinculado liquida una obligacion, no crea otro gasto. No se permiten sobrepagos ni vinculos entre jefes diferentes; las cuentas pueden diferir o estar vacias.
- Transferencias nuevas sin cuentas: registro positivo y Pagado, sin inversion, ingreso/egreso ni redistribucion de dinero. Referencias historicas de transferencias se conservan; si se informan cuentas, deben ser dos distintas del mismo jefe. No se implementan transferencias entre jefes.
- Los saldos legacy de la API solo cubren saldo inicial y registros asociados a cuentas: ingresos/reembolsos/prestamos o adelantos recibidos menos desembolsos/retiros/prestamos o adelantos entregados, con debito/credito de transferencias contabilizadas. No representan el conjunto completo de movimientos sin cuentas ni el total invertido, y no se muestran como disponible actual en la UI.
- El estado actual mostrado/filtrado en el frontend se deriva de los pagos. Se conserva el estado registrado original en Sheets y en los reportes. El endpoint `statistics` filtra el estado registrado.
- Estados contables actuales: Pagado, Pendiente, Pago parcial, Anulado. Se cargan de Sheets; no se permiten estados personalizados sin definir antes su efecto financiero.
- `CUENTAS` permanece de solo lectura para compatibilidad historica; `saveCatalog` sobre esa hoja responde 403. No hay creacion, edicion ni visualizacion de cuentas en la UI, ni cuentas predeterminadas ficticias. No se impiden saldos legacy negativos.

## Comprobantes

`COMPROBANTE_URL` es opcional, hasta 300 caracteres. Vacio es valido; omitirlo al editar conserva el valor existente y enviar `""` lo borra. Solo se aceptan estas expresiones exactas, sin espacios ni fragmentos:

```regex
^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/(?:view|preview)(?:\?[A-Za-z0-9_=%&.~+\-]*)?$
^https:\/\/drive\.google\.com\/open\?id=[A-Za-z0-9_-]+(?:&[A-Za-z0-9_=%&.~+\-]*)?$
```

Esto admite enlaces comunes como `/file/d/ID/view?usp=sharing`, `/preview` y `/open?id=ID&usp=sharing`. No hay selector de archivos ni carga en frontend, Node o Apps Script; la accion `upload` se rechaza con 404. No existe limite de tamano de archivo porque solo se registra una URL, no su contenido. El script y manifiesto actuales no incluyen API de carga ni permiso Drive; `DRIVE_FOLDER_ID` es obsoleto.

Validar el formato de una URL no acredita que el archivo exista, sea privado, seguro o accesible. Su propietario controla los permisos en Drive; las credenciales de la app no conceden acceso Google. Para abrir archivos privados, el visor necesita permisos Google por separado. Las URLs historicas inseguras no se convierten en enlaces en tablas, detalle o reportes.

## Errores Y Limites

Si falla la conexion, aparece **No se pudo conectar con el servidor de datos.** Si falla guardar, aparece **No se pudo guardar el movimiento. Verifique la conexion.** con detalles cuando corresponda. El formulario no se borra.

Una respuesta incierta bloquea el borrador para reintentar exactamente el mismo UUID y contenido. No crees otro registro para el mismo movimiento sin verificar primero el historial. El descarte requiere confirmacion. Las ediciones usan bloqueo optimista: si la respuesta de una edicion se pierde, recarga y revisa la auditoria antes de volver a editar.

Sheets no ofrece transacciones ACID: el script usa LockService y restauracion de mejor esfuerzo cuando falla la escritura/auditoria. Una terminacion de ejecucion o fallo de restauracion requiere conciliacion manual. No edites movimientos directamente en Sheets: se omiten validaciones y auditoria.

La consulta trae el libro completo y las tablas paginan en el navegador. Para libros grandes se necesita paginacion desde el servidor y procesamiento incremental. Aplican cuotas de Apps Script/Sheets, los limites de solicitud/respuesta de Vercel y un timeout de 55 segundos. Node conserva el limite legacy de 7 MiB por solicitud JSON; no es un limite de comprobantes ni capacidad de carga. Vercel puede rechazar una solicitud antes del handler con su propio limite (comunmente 4.5 MB). No se afirma soporte ilimitado ni trabajo offline.

## Pruebas

```powershell
npm run build
npm test
npm audit
npx playwright install chromium
npm run test:e2e
```

Las pruebas unitarias/HTTP usan servicios aislados y un runtime simulado de Apps Script; no escriben en Google. Playwright intercepta todas las solicitudes de API y usa fixtures exclusivamente de prueba. Comprueba escritorio y movil, login por contrasena, movimientos sin cuentas, reintentos, pagos vinculados, filtros de inversion, comprobantes por URL, preservacion historica y archivos Excel/PDF reales. No equivale a una prueba de autenticacion/Sheets ni de acceso a comprobantes en vivo.

Verificacion: build correcto y 51 pruebas unitarias/HTTP aprobadas. La suite de navegador conserva sus 26 casos de uso. Se verifican el manual y PDF, la ausencia de los recursos de demostracion, el respaldo previo, la conservacion de encabezados/catalogos y la restauracion ante fallos del reinicio. Las pruebas locales no acreditan que el propietario haya ejecutado el borrado remoto.

La API reintenta hasta tres veces las consultas cuando Google devuelve una respuesta temporal invalida o falla el transporte, dentro de un unico plazo de 55 segundos. No reintenta automaticamente escrituras ni errores de validacion del script. Si falla un guardado, conserva el borrador y su clave de idempotencia.

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
| `apps-script/Code.gs`, `apps-script/appsscript.json` | API Sheets, configuracion y auditoria, sin cargas ni alcance Drive |
| `apps-script/Reset.gs` | Reinicio excepcional solo desde el editor por el propietario: respaldo privado y vaciado financiero, conservando encabezados y catalogos |
| `server/CONTRACT.md` | Contrato detallado de endpoints, campos y limites |
| `tests/`, `e2e/`, `playwright.config.ts` | Pruebas automatizadas |
| `.env.example`, `vercel.json`, `vite.config.ts` | Configuracion local y despliegue |
| `scripts/dev.mjs`, `package.json`, `package-lock.json`, `tsconfig*.json` | Ejecucion, dependencias y compilacion |

## Configuracion De Otra Instalacion

Para otra instalacion, configura el usuario/contrasena y las variables privadas de la seccion 3, incorpora `Code.gs` y su manifiesto, publica una version y autoriza Sheets. La instalacion actual ya esta conectada; agregar el manual no exige actualizar la API de Apps Script. Conserva las tablas y datos salvo el reinicio financiero excepcional autorizado y descrito arriba; no crees cuentas para activar el registro. El acceso a comprobantes se controla por separado en Google. Antes de produccion real, rota por separado las credenciales del cliente y verifica firewall/rate limiting de login. No compartas contrasenas, secretos o tokens por chat; configura los valores en tu entorno o panel privado de Vercel.
