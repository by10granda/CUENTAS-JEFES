# Puesta En Marcha De Personal

Guia del propietario. Personal usa el mismo acceso web que Gerencia, pero un perfil privado, otro proyecto Apps Script y otro libro. No modifica ni borra las tablas financieras antiguas. El reinicio excepcional descrito para Gerencia en README no pertenece a esta instalacion.

## Estado Y Privacidad

- Libro nuevo: `1WU3UF1gTgut-Yx2dUn51Kk1fu2EHtnQSfxOOdx15-Y0` ([abrir con la cuenta propietaria](https://docs.google.com/spreadsheets/d/1WU3UF1gTgut-Yx2dUn51Kk1fu2EHtnQSfxOOdx15-Y0/edit)). La observacion disponible fue una hoja visible `Hoja 1` con `rows: []`; no demuestra ausencia de hojas ocultas ni permisos de escritura. No se han realizado escrituras de verificacion en ese libro.
- El documento era legible publicamente. **Antes de guardar datos financieros, el propietario debe cambiar Compartir > Acceso general > Restringido**, revisar los colaboradores y retirar permisos innecesarios. El login de la app no protege un Sheet publico.
- El login Personal esta disponible cuando sus credenciales privadas estan configuradas. Leer/escribir finanzas exige ademas que el propietario instale, autorice y publique el nuevo backend y configure su ruta. Sin ello se muestra un error real de conexion/configuracion (503), instrucciones de instalacion y ningun saldo de muestra.
- La cobertura local usa unidades, Sheets simulados y API interceptada en navegador. No acredita integracion con el nuevo Sheet, autorizacion Google, permisos Drive ni persistencia financiera en vivo. Falta desplegar el Apps Script personal y configurar su URL y secreto coincidente.

## Variables Privadas

Completar exclusivamente en `.env` local o el panel privado de Vercel; no enviar valores por chat, guardarlos en Git/Sheets ni usar `VITE_*`. La plantilla `.env.example` enumera las variables sin credenciales.

| Variable | Uso |
| --- | --- |
| `APP_USERNAME`, `APP_PASSWORD` | Conservar el acceso existente de Gerencia, sin sustituirlo por Personal. |
| `GAS_WEB_APP_URL`, `GAS_API_SECRET` | Conservar el proyecto y libro antiguos de Gerencia. |
| `PERSONAL_USERNAME` | Identidad privada Personal; no vacia, hasta 100 caracteres, sin controles y distinta de `APP_USERNAME`. Comparacion exacta, sin normalizar espacios ni mayusculas. |
| `PERSONAL_PASSWORD` | Contrasena fuerte de 8 a 512 caracteres, no solo espacios. |
| `SESSION_SECRET` | Secreto comun de sesiones, aleatorio, al menos 32 caracteres. No reemplazarlo inadvertidamente: rotarlo invalida todas las sesiones. |
| `PERSONAL_GAS_WEB_APP_URL` | URL del nuevo despliegue `https://script.google.com/macros/s/DEPLOYMENT_ID/exec`, obligatoriamente distinta de `GAS_WEB_APP_URL`. No es URL de biblioteca, editor, Sheet ni `/dev`. |
| `PERSONAL_GAS_API_SECRET` | Secreto aleatorio de al menos 32 caracteres; coincide con `GAS_API_SECRET` en las propiedades del proyecto Personal. Se recomienda que sea independiente del secreto de Gerencia. |
| `APP_ORIGIN` | Origen exacto comun del frontend/API; local `http://localhost:5173`, produccion el dominio autorizado. |
| `NODE_ENV`, `PORT` | Produccion: `production`; API local: puerto `3001` por defecto. |

El propietario elige las credenciales y secretos y los introduce por separado en Propiedades del script y Vercel, no en mensajes. Para generar cada secreto independientemente, puede ejecutar localmente:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

El perfil de sesion (`gerencia`/`personal`) selecciona el espacio y la API permitidos. La cookie comun dura ocho horas, es HttpOnly, SameSite=Lax y Secure en produccion. No existe interfaz de administracion de usuarios ni atribucion distinta entre quienes compartan unas credenciales. Usuarios iguales entre ambos perfiles invalidan la configuracion de acceso.

**El username Personal es el propietario del namespace financiero y debe permanecer estable.** Cambiarlo requiere migracion de identidad; no existe migracion implementada. Rotar solo la contrasena invalida sus sesiones sin perder sus datos. No cambies username para rotar acceso.

## Instalacion Del Propietario

1. Restringe el nuevo Sheet y revisa todas sus pestanas, incluidas ocultas, con la cuenta propietaria. Conserva `Hoja1`, datos existentes y hojas ajenas; no ejecutes Reset ni codigo de Gerencia en este libro.
2. Crea un proyecto Apps Script **separado**, asociado al nuevo Sheet. Instala el archivo completo `apps-script/personal/Code.gs` y el manifiesto `apps-script/personal/appsscript.json`, no los archivos de la raiz `apps-script/`. El ID del destino esta fijado en el codigo. El manifiesto incluye Sheets y Drive; configura la zona horaria real del Spreadsheet, que determina `HOY`.
3. En Configuracion del proyecto > Propiedades de la secuencia de comandos, establece `GAS_API_SECRET` con el nuevo secreto privado, minimo 32 caracteres. No es la contrasena de Google ni de la app.
4. Ejecuta `inspectPersonalStructure()` y autoriza con la cuenta propietaria. Es de **solo lectura** y reporta todas las pestanas reales, sus encabezados/compatibilidad y todos los destinos, incluidos faltantes. Revisa el informe antes de aprobar setup. Una observacion publica de `Hoja1` no sustituye esta inspeccion.
5. Ejecuta `setupPersonalSpreadsheet()` solo despues de revisar compatibilidad. Prevalida todos los destinos antes de escribir; rechaza encabezados requeridos faltantes, desconocidos, duplicados o reordenados incompatibles. Inicializa destinos vacios y agrega al final solo columnas opcionales conocidas faltantes. No borra, renombra, reordena ni reinicia datos existentes. Solo inserta preferencias del sistema: USD, zona del Sheet, alertas 7 dias, sobregiro desactivado, canal email vacio y cuatro metodos. Genera **cero cuentas, bancos, beneficiarios, categorias, obligaciones y movimientos**. Repetirlo con el mismo esquema es idempotente.
6. Opcional: configura `DRIVE_FOLDER_ID` con una carpeta privada del propietario, sin acceso publico ni por enlace, para subir comprobantes. Sin carpeta, usa URLs externas de Drive; no es necesario habilitar uploads para operar finanzas. Configurar el ID no verifica por si mismo acceso/permisos de la carpeta.
7. Implementar > Nueva implementacion > Aplicacion web: **Ejecutar como Yo (propietario)** y **Acceso: Cualquier persona** para que Node pueda llamar al servicio. Esto no publica las finanzas: GET sin autenticacion siempre responde no autorizado y POST exige el secreto servidor a servidor. No uses una publicacion como biblioteca.
8. Introduce el nuevo `/exec` en `PERSONAL_GAS_WEB_APP_URL` y su secreto coincidente en `PERSONAL_GAS_API_SECRET`, junto con las credenciales Personal, en el panel privado de Vercel. Conserva las variables de Gerencia. Redespliega tras modificar variables; localmente reinicia la API.
9. Tras cambios del script, publica **Nueva version** del despliegue Personal. Guardar el editor no actualiza `/exec`. Antes de la primera operacion financiera usa esta revision completa e inspeccion/setup compatibles. No mezcles revisiones de esquema despues de iniciar finanzas: no hay migracion automatica de hashes/historiales.

## Modelo Y Contrato

Las 11 hojas fisicas, sensibles a mayusculas, son `Cuentas`, `Beneficiarios`, `Categorias`, `Obligaciones`, `Cuotas`, `Movimientos`, `Transferencias`, `Pagos`, `Configuracion`, `Auditoria`, `Operaciones`. `Obligaciones` guarda definiciones recurrentes; `Cuotas` compromisos emitidos. `Pagos` distribuye un movimiento a cuotas, no registra otro gasto. `OperacionDetalle` no se utiliza: el diario contiene un manifiesto acotado. Columnas exactas: `PERSONAL_SCHEMAS` en Code.gs y `backup.schemas`. Contrato fuente: [apps-script/personal/CONTRACT.md](../apps-script/personal/CONTRACT.md).

El navegador llama a `/api/index?action=personal-...`; Node verifica el rol, retira el prefijo y envia POST JSON al proyecto Personal con identidad autenticada y secreto. Lee `personal-bootstrap` y `personal-backup` por GET; las mutaciones son POST con Origin valido y `requestId` UUID. El proxy exige **ambos** marcadores upstream: `service: "personal-finance"` y `spreadsheetId: "1WU3UF1gTgut-Yx2dUn51Kk1fu2EHtnQSfxOOdx15-Y0"`. Una URL distinta no basta: respuesta antigua, marcadores ausentes/documento incorrecto o secreto rechazado producen 503, sin filtrar JSON financiero del libro de Gerencia.

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

Verificacion local: build correcto, 144 pruebas unitarias/HTTP y 86 pruebas de navegador aprobadas. Estas pruebas aisladas no llaman al nuevo Google/Vercel. Manual operativo: [public/manual-personal.html](../public/manual-personal.html), con impresion/Guardar como PDF desde el navegador, sin prometer un archivo `manual-personal.pdf` publicado.

Antes de declarar funcional la integracion, el propietario debe verificar login de cada perfil, aislamiento 403 entre APIs, bootstrap del libro correcto y privacidad del Sheet. Crear solo la primera operacion **real autorizada**, nunca datos de muestra; comprobar en el Sheet las versiones/asientos, auditoria y marcador CONFIRMADA, recargar y comparar saldos/asignaciones. Verificar comprobante privado si se usa, y descargar/abrir CSV, XLSX, PDF y respaldo JSON. Respaldo es personal, con ultimas versiones e historial completo, sin variables de entorno, passwords, propiedades secretas ni bytes de archivos; no existe restauracion destructiva. Registrar evidencia privada de esas comprobaciones: la suite mock no las sustituye.
