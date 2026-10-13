# Puesta En Marcha De Personal

Guia del propietario. Personal usa el mismo acceso web que Gerencia, pero un perfil separado, otro proyecto Apps Script y otro libro. Su conector Apps Script es publico y no autenticado. No modifica ni borra las tablas financieras antiguas. El reinicio excepcional descrito para Gerencia en README no pertenece a esta instalacion.

## Estado Y Privacidad

- Libro nuevo: `1WU3UF1gTgut-Yx2dUn51Kk1fu2EHtnQSfxOOdx15-Y0` ([abrir con la cuenta propietaria](https://docs.google.com/spreadsheets/d/1WU3UF1gTgut-Yx2dUn51Kk1fu2EHtnQSfxOOdx15-Y0/edit)). El propietario ya instalo la version anterior y creo los encabezados de las 11 hojas. Esta actualizacion no cambia el esquema ni requiere repetir setup. No se han realizado escrituras de verificacion en ese libro.
- Se recomienda **Compartir > Acceso general > Restringido**, revisar colaboradores y retirar permisos innecesarios. Esto limita el acceso directo al Sheet, **pero no protege el Apps Script publico que ejecuta como propietario**.
- **No uses datos financieros confidenciales.** Cualquier persona con la URL y un username declarado puede leer y editar todo ese namespace financiero y exportar su respaldo. Si hay carpeta Drive configurada, tambien puede subir archivos y consumir almacenamiento y cuotas del propietario. El username y el rol enviados no prueban identidad, incluso con el Sheet restringido.
- Las credenciales del sitio Personal ya estan configuradas en Vercel; no hay accion de usuario final ni nuevas credenciales de acceso que introducir. El sitio mantiene login y roles para elegir paginas y proteger endpoints Node con 403 entre perfiles. Una llamada directa a Apps Script elude esa proteccion.
- La cobertura local usa unidades, Sheets simulados y API interceptada en navegador. No acredita integracion Google, permisos ni persistencia en vivo. Falta publicar el archivo actualizado y configurar/verificar su URL; sin conexion se muestra error real (503), nunca saldos de muestra.

## Conexion Personal

Para conectar Personal, Node necesita **solo `PERSONAL_GAS_WEB_APP_URL`**. Introducirla en `.env` local o el panel de Vercel, no en el frontend ni en Git. No se requiere secreto API ni propiedad de secreto en el proyecto Personal. Conservar sin cambios el login del sitio, `SESSION_SECRET`, el origen y todas las variables de Gerencia; Gerencia sigue requiriendo `GAS_API_SECRET`.

| Variable | Uso |
| --- | --- |
| `PERSONAL_GAS_WEB_APP_URL` | URL del nuevo despliegue `https://script.google.com/macros/s/DEPLOYMENT_ID/exec`, obligatoriamente distinta de `GAS_WEB_APP_URL`. No es URL de biblioteca, editor, Sheet ni `/dev`. |

El perfil de sesion (`gerencia`/`personal`) selecciona el espacio y la API permitidos. La cookie comun dura ocho horas, es HttpOnly, SameSite=Lax y Secure en produccion. No existe interfaz de administracion de usuarios ni atribucion distinta entre quienes compartan unas credenciales. Usuarios iguales entre ambos perfiles invalidan la configuracion de acceso.

**El username Personal es la clave estable del namespace financiero, no un secreto ni una prueba de identidad en GAS.** Cambiarlo requiere migracion no implementada. Rotar solo la contrasena invalida sus sesiones del sitio sin perder datos, pero no impide llamadas directas a GAS. No cambies username para rotar acceso.

## Instalacion Del Propietario

1. Con la cuenta propietaria, abre el proyecto Apps Script Personal **separado** del de Gerencia. Revisa el Sheet y recomienda acceso Restringido, sin confundirlo con proteccion del conector publico. Conserva todas las hojas y datos; no ejecutes Reset ni codigo de Gerencia.
2. **Reemplaza todo el archivo anterior por `apps-script/personal/Code.gs` actualizado**, no solo una funcion o un parche de identidad. Usa el manifiesto `apps-script/personal/appsscript.json` (Sheets y Drive). El ID `1WU3UF1gTgut-Yx2dUn51Kk1fu2EHtnQSfxOOdx15-Y0` ya esta fijado en el codigo. No configures propiedad de secreto API.
3. Autoriza los permisos Google con la cuenta propietaria cuando la plataforma los solicite; esa autorizacion obligatoria no se puede omitir. Puedes ejecutar `inspectPersonalStructure()` para verificar en solo lectura todas las pestanas y encabezados. **Los encabezados de las 11 hojas existentes no cambiaron: no repitas `setupPersonalSpreadsheet()`, no reinicialices ni siembres dinero.** La zona horaria real del Sheet determina `HOY`.
4. En **Implementar > Gestionar implementaciones > Editar**, selecciona **Nueva version > Implementar**, como **Yo (propietario)** y con acceso **Cualquier persona**. Si no hay despliegue, usa **Nueva implementacion > Aplicacion web** con esas mismas opciones. Guardar el editor no actualiza `/exec`; no uses biblioteca ni `/dev`.
5. Entrega la URL real terminada en `/exec` para configurar **solo `PERSONAL_GAS_WEB_APP_URL`** en Node/Vercel. Conserva todas las variables existentes de acceso y de Gerencia. Redespliega Node tras cambiar la variable; localmente reinicia la API.
6. El GET publico de `/exec` consulta el libro real en solo lectura y devuelve salud con `connected` e `initialized` true/false, sin datos financieros. No autentica al visitante. POST es publico: permite operar el namespace indicado por el username declarado.
7. Opcional: configura `DRIVE_FOLDER_ID` con carpeta privada del propietario. Sus permisos y los de los archivos son independientes del conector; habilitar uploads permite a terceros con URL/username consumir almacenamiento y cuotas. Sin carpeta puedes usar URLs Drive externas, cuya privacidad no se garantiza.

Solo para una instalacion nueva sin estructura: inspecciona primero y ejecuta `setupPersonalSpreadsheet()` si faltan destinos compatibles. Prevalida encabezados requeridos, desconocidos, duplicados o incompatibles, conserva datos/hojas ajenas y solo inicializa estructura/preferencias (USD, zona del Sheet, alertas, sobregiro, canal email y metodos), **cero cuentas, bancos, beneficiarios, categorias, obligaciones o movimientos**. Esto no es necesario para la instalacion actual.

## Modelo Y Contrato

Las 11 hojas fisicas, sensibles a mayusculas, son `Cuentas`, `Beneficiarios`, `Categorias`, `Obligaciones`, `Cuotas`, `Movimientos`, `Transferencias`, `Pagos`, `Configuracion`, `Auditoria`, `Operaciones`. `Obligaciones` guarda definiciones recurrentes; `Cuotas` compromisos emitidos. `Pagos` distribuye un movimiento a cuotas, no registra otro gasto. `OperacionDetalle` no se utiliza: el diario contiene un manifiesto acotado. Columnas exactas: `PERSONAL_SCHEMAS` en Code.gs y `backup.schemas`. Contrato fuente: [apps-script/personal/CONTRACT.md](../apps-script/personal/CONTRACT.md).

El navegador llama a `/api/index?action=personal-...`; Node verifica sesion/rol, retira el prefijo y envia POST JSON sin secreto API. `user` procede de la sesion del sitio, pero para GAS es un DTO de identidad declarada (`username`, `name`, `role`), no identidad autenticada. Node lee `personal-bootstrap` y `personal-backup` por GET; las mutaciones son POST con Origin valido y `requestId` UUID. El proxy exige **ambos** marcadores upstream: `service: "personal-finance"` y `spreadsheetId: "1WU3UF1gTgut-Yx2dUn51Kk1fu2EHtnQSfxOOdx15-Y0"`. Respuesta antigua o marcadores ausentes/documento incorrecto producen 503 sin filtrar JSON del libro de Gerencia. Los marcadores validan servicio/documento, **no autentican ni protegen llamadas directas a GAS**. IDs, hashes y claves internas son controles de integridad, no secretos.

Entidades versionadas agregan filas con el mismo ID logico; `USERNAME`, `OP_ID` y `UPDATED_AT` son controlados por el servidor. Lecturas bajo ScriptLock muestran las ultimas versiones de operaciones confirmadas; respaldo conserva historial completo del namespace. Cambios, auditorias y asignaciones se verifican por ID/hash antes del marcador CONFIRMADA. Esto es un protocolo de visibilidad, **no transacciones ACID de Sheets**. Nunca alteres filas financieras manualmente ni ejecutes scripts que eludan el bloqueo.

## Reglas Operativas

- USD exclusivamente, sin conversion de moneda. Fechas de negocio ISO `yyyy-mm-dd`; interfaz/reportes `DD/MM/AAAA`, importes USD con dos decimales. `HOY` procede de la zona del Sheet, no del reloj del navegador.
- Cuentas: Ahorros, Corriente, Efectivo, Otra y Tarjeta de credito. Banco puede quedar vacio; saldo inicial cero es el valor por defecto del formulario, aceptado expresamente al guardar, no una cuenta generada. Tipo/saldos iniciales se bloquean tras asientos confirmados. Credito disponible no es efectivo. Nunca almacenar PAN/CVV; tarjetas solo ultimos cuatro digitos.
- Ingreso aumenta efectivo; gasto directo lo reduce. Ambos requieren categoria activa de su clasificacion. Transferencia entre cuentas distintas no suma ingreso/gasto; comision opcional es gasto separado y exige categoria Gasto. Cuenta y persona/empresa no son la misma entidad.
- Operaciones, pagos y conciliaciones representan dinero ejecutado: fecha real <= `HOY`. Para programar un pago futuro crea Cuotas pendientes; vencimiento puede ser futuro y un pago realizado hoy puede anticiparlo. No hay pagos automaticos.
- Recurrencias: Semanal cada 7 dias, Quincenal cada 15; Mensual/Trimestral/Semestral/Anual conservan fase de Inicio. Dia 31 se ajusta al ultimo dia de cada mes, sin desplazar el ancla siguiente. Emision desde hoy hasta hoy+90 por defecto, maximo hoy+366 inclusive. Inicio antiguo se adelanta matematicamente sin inventar deuda historica impaga; Pago unico permite su fecha pasada explicita. Registra compromisos historicos reales manualmente si procede.
- Maximo **100 cuotas nuevas por operacion entre todas las definiciones**, sin truncamiento ni emision parcial. Si juntas varias recurrencias exceden el limite, genera por definicion o acorta horizonte. Guardar una definicion activa emite su ventana; la primera carga de la interfaz solicita generacion de 90 dias si no hay operaciones/solicitudes inciertas. Bootstrap por si solo no escribe; no hay cron. Suspender/finalizar detiene nuevas emisiones, no cancela las ya emitidas. Claves emitidas, aun anuladas, no se regeneran.
- Cuotas ordinarias permiten cambiar monto siempre que no sea menor que lo pagado. Las de tarjeta tienen monto inmutable tras la compra; titulo, vencimiento y notas siguen editables con token vigente. Cambios de deuda requieren nueva compra o conciliacion auditada.
- Compra con tarjeta aumenta gasto/deuda sin reducir efectivo; hasta 120 cuotas mensuales, reparto exacto de centavos. Pago desde banco/efectivo reduce ambos efectivo y deuda sin nuevo gasto y asigna FIFO a cuotas; no puede superar deuda. No sumar de nuevo las asignaciones, deuda, cuotas y estado declarado como si fueran obligaciones distintas.
- Estado de tarjeta requiere total positivo, fecha concreta de corte y fecha maxima >= corte. El servidor calcula pendiente como minimo de deuda actual y total declarado menos pagos confirmados a esa tarjeta **desde corte inclusive**, limitado a cero; pagos posteriores al vencimiento tambien cuentan, los anteriores al corte no. Compras posteriores no incrementan el total declarado. Dia mensual de corte/pago sin estado real solo genera pronostico azul, nunca deuda vencida. Vencido significa fecha maxima < hoy y pendiente positivo; vence hoy aun es proximo, no vencido.
- Conciliar requiere saldo/deuda observado, fecha real, motivo y `UPDATED_AT` vigente de la misma cuenta. Agrega Ajuste auditado al saldo actual; no reescribe historia ni reconstruye saldo bancario pasado. Asientos modifican el token de cuenta. Edicion obsoleta devuelve 409: recarga y revisa antes de repetir. Movimientos se corrigen anulando la operacion completa y registrando de nuevo; no hay CRUD financiero silencioso ni borrado fisico.
- Metodos: Efectivo, Transferencia bancaria, Tarjeta de credito, Cheque; opcionales en los formularios. No hay conexion bancaria, lectura de email ni notificaciones push. Alertas solo dentro de la plataforma. `CANAL_EMAIL` es etiqueta futura y no envia nada.

## Comprobantes Y Recuperacion

Comprobante opcional: JPG/PNG/PDF <= **3 MiB** si la carpeta privada esta configurada y accesible. Se valida formato y contenido, nunca se hace publico ni se guardan bytes/base64 en Sheets. Una subida fallida despues de crear archivo puede dejar un archivo privado huerfano y diario pendiente: verificar con el propietario, no volver a subir automaticamente.

Alternativa: URL HTTPS `drive.google.com/file/d/ID/view`, `/preview` o `/open?id=ID`, ID minimo 10 caracteres y URL <=300. Se admiten consultas comunes `usp=sharing`, `usp=drive_link`, `resourcekey`; se conserva la URL completa, sin quitar parametros necesarios. No se admiten carpetas, otros hosts, HTTP, fragmentos ni espacios. El visor requiere permisos Google separados; el login no concede acceso Drive.

Una operacion PREPARADA/PENDIENTE_CONCILIACION bloquea **todas las nuevas escrituras** de ese propietario, salvo resolver. Conserva el UUID y contenido exactos ante respuesta incierta. Una operacion confirmada puede recuperarse con solicitud identica; una pendiente reserva el UUID y no se puede repetir. En Configuracion revisa el diario y las filas reales con el propietario; luego descarta explicitamente con motivo, sin confirmar importes parciales. Solo tras verificar el resultado y resolver el diario transcribe la operacion real necesaria con UUID nuevo, evitando duplicar una ya confirmada. Descartar borrador local no resuelve el diario remoto.

Consultas reintentan fallos de transporte/respuesta temporal hasta tres intentos dentro de 55 segundos; escrituras nunca se reintentan automaticamente. Borradores quedan en memoria/sessionStorage por username, no son un libro offline. Configura limites/rate limiting de login en Vercel y considera cuotas Sheets/Drive, tiempo de funcion y limites de solicitudes/respuestas del hosting.

## Verificacion De Entrega

```powershell
npm run build
npm test
npm run test:e2e
```

Ejecuta los comandos sobre la revision actual antes de reportar resultados; no se fijan conteos historicos como evidencia de esta actualizacion. Las pruebas aisladas no llaman al nuevo Google/Vercel. Manual operativo: [public/manual-personal.html](../public/manual-personal.html), con impresion/Guardar como PDF desde el navegador, sin prometer un archivo `manual-personal.pdf` publicado.

Antes de declarar funcional la integracion, el propietario debe verificar login de cada perfil, aislamiento 403 entre APIs Node, salud real y bootstrap del libro correcto. Revisar permisos del Sheet no elimina el acceso publico via GAS. No hacer escrituras de prueba ni insertar datos de muestra en el libro nuevo; cualquier futura operacion real autorizada debe ser no confidencial y verificarse en versiones/asientos, auditoria y marcador CONFIRMADA, recarga y saldos/asignaciones. Verificar permisos independientes del comprobante si se usa y descargar/abrir CSV, XLSX, PDF y respaldo JSON. El respaldo contiene ultimas versiones e historial del namespace declarado, sin variables de entorno, passwords, propiedades secretas ni bytes de archivos; no es privado por el login y no existe restauracion destructiva. Registrar evidencia de esas comprobaciones: la suite mock no las sustituye. La integracion sigue pendiente de publicar la fuente actualizada y verificar su URL.
