import type { IncomingMessage, ServerResponse } from 'node:http';
import { authenticate, authConfigured, cookieToken, readSession, sessionCookie, signSession, validOrigin } from './security.js';

type Request = IncomingMessage & { body?: unknown };
const READ = new Set(['bootstrap', 'movements', 'statistics']);
const WRITE = new Set(['create', 'update', 'void', 'saveCatalog']);
const PERSONAL_READ = new Set(['personal-bootstrap', 'personal-backup']);
const PERSONAL_WRITE = new Set(['personal-save', 'personal-generate', 'personal-transaction', 'personal-pay', 'personal-void', 'personal-reconcile', 'personal-configure', 'personal-upload', 'personal-resolveOperation']);
const PERSONAL_IDENTITY = { service: 'personal-finance', spreadsheetId: '1WU3UF1gTgut-Yx2dUn51Kk1fu2EHtnQSfxOOdx15-Y0' };
const PERSONAL_CONNECTION_ERROR = 'Configuracion de conexion personal invalida. Verifique el despliegue personal, su documento y PERSONAL_GAS_API_SECRET.';
const MAX_BODY = 7 * 1024 * 1024;
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function send(res: ServerResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(value));
}

function validatePersonalUpload(payload: Record<string, unknown>): Record<string, unknown> {
  const { requestId, filename, mimeType, base64 } = payload;
  if (typeof filename !== 'string' || !filename.trim() || filename.length > 120 || /[\x00-\x1f\x7f-\x9f/\\]/.test(filename) || filename.trim().startsWith('.')) throw new HttpError(400, 'Nombre de archivo invalido');
  if (!['application/pdf', 'image/png', 'image/jpeg'].includes(String(mimeType))) throw new HttpError(400, 'Tipo de archivo no permitido');
  const extension = mimeType === 'application/pdf' ? /\.pdf$/i : mimeType === 'image/png' ? /\.png$/i : /\.jpe?g$/i;
  if (!extension.test(filename.trim())) throw new HttpError(400, 'Tipo de archivo no permitido');
  if (typeof base64 !== 'string' || !base64.length) throw new HttpError(400, 'Archivo base64 invalido');
  const maxBytes = 3 * 1024 * 1024;
  if (base64.length > 4 * Math.ceil(maxBytes / 3)) throw new HttpError(413, 'Archivo supera 3 MiB');
  if (base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(base64)) throw new HttpError(400, 'Archivo base64 invalido');
  const paddingIndex = base64.indexOf('=');
  if (paddingIndex !== -1 && !(
    paddingIndex === base64.length - 1 ||
    (paddingIndex === base64.length - 2 && base64[base64.length - 1] === '=')
  )) throw new HttpError(400, 'Archivo base64 invalido');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > maxBytes) throw new HttpError(413, 'Archivo supera 3 MiB');
  if (bytes.toString('base64') !== base64) throw new HttpError(400, 'Archivo base64 invalido');
  const signature = mimeType === 'application/pdf' ? Buffer.from('%PDF-') : mimeType === 'image/png' ? Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) : Buffer.from([255, 216, 255]);
  if (!bytes.subarray(0, signature.length).equals(signature)) throw new HttpError(400, 'Contenido no coincide con el tipo de archivo');
  // Never forward a client-selected Drive folder or other upload options.
  return { requestId, filename, mimeType, base64 };
}

async function body(req: Request): Promise<Record<string, unknown>> {
  const length = Number(req.headers['content-length'] || 0);
  if (length > MAX_BODY) throw new HttpError(413, 'Solicitud demasiado grande');
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) throw new HttpError(415, 'Use application/json');
  let value = req.body;
  if (value === undefined) {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_BODY) {
        req.resume();
        throw new HttpError(413, 'Solicitud demasiado grande');
      }
      chunks.push(bytes);
    }
    value = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') {
    if (Buffer.byteLength(value) > MAX_BODY) throw new HttpError(413, 'Solicitud demasiado grande');
    try { value = JSON.parse(value); } catch { throw new HttpError(400, 'JSON invalido'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Se requiere un objeto JSON');
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_BODY) throw new HttpError(413, 'Solicitud demasiado grande');
  return value as Record<string, unknown>;
}

export async function handleRequest(req: Request, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://internal');
    const route = url.pathname.match(/^\/api\/(config|session|login|logout)$/);
    if (!route && url.pathname !== '/api/index' && url.pathname !== '/api/index/') throw new HttpError(404, 'Ruta no encontrada');
    const action = route?.[1] || url.searchParams.get('action') || '';
    const method = req.method || 'GET';
    const personal = PERSONAL_READ.has(action) || PERSONAL_WRITE.has(action);
    const isWrite = WRITE.has(action) || PERSONAL_WRITE.has(action) || action === 'login' || action === 'logout';
    if (!isWrite && !READ.has(action) && !PERSONAL_READ.has(action) && !['config', 'session'].includes(action)) throw new HttpError(404, 'Accion desconocida');
    if (method !== (isWrite ? 'POST' : 'GET')) {
      res.setHeader('Allow', isWrite ? 'POST' : 'GET');
      throw new HttpError(405, 'Metodo no permitido');
    }
    if (isWrite && !validOrigin(req)) throw new HttpError(403, 'Origen no permitido');
    if (action === 'config') return send(res, 200, { success: true, data: { authMode: 'password', configured: authConfigured() } });
    if (action === 'logout') {
      res.setHeader('Set-Cookie', sessionCookie(req, '', true));
      return send(res, 200, { success: true, data: { user: null } });
    }
    if (!authConfigured()) throw new HttpError(503, 'Configure APP_USERNAME y APP_PASSWORD o PERSONAL_USERNAME y PERSONAL_PASSWORD (8 a 512 caracteres; usuarios distintos), y SESSION_SECRET (al menos 32 caracteres) en Vercel.');
    if (action === 'login') {
      const payload = await body(req);
      const user = authenticate(payload.username, payload.password);
      if (!user) throw new HttpError(401, 'Usuario o contraseña incorrectos');
      res.setHeader('Set-Cookie', sessionCookie(req, signSession(user)));
      return send(res, 200, { success: true, data: { user } });
    }
    const user = readSession(cookieToken(req));
    if (action === 'session') return send(res, 200, { success: true, data: { user } });
    if (!user) throw new HttpError(401, 'Inicie sesion para continuar');
    if (user.role !== (personal ? 'personal' : 'gerencia')) throw new HttpError(403, 'Accion no permitida para este perfil');
    let payload: Record<string, unknown>;
    if (isWrite) payload = await body(req);
    else if (personal) {
      if ([...url.searchParams.keys()].some(key => key !== 'action')) throw new HttpError(400, 'Parametros no permitidos para esta accion');
      payload = {};
    }
    else {
      const raw = url.searchParams.get('filters');
      try { payload = raw ? { filters: JSON.parse(raw) } : { filters: Object.fromEntries([...url.searchParams].filter(([key]) => key !== 'action')) }; }
      catch { throw new HttpError(400, 'Filtros invalidos'); }
    }
    if (action === 'personal-upload') payload = validatePersonalUpload(payload);
    const endpoint = process.env[personal ? 'PERSONAL_GAS_WEB_APP_URL' : 'GAS_WEB_APP_URL'];
    const secret = process.env[personal ? 'PERSONAL_GAS_API_SECRET' : 'GAS_API_SECRET'];
    if (personal && (!endpoint || !secret || secret.length < 32 || !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(endpoint) || endpoint === process.env.GAS_WEB_APP_URL)) {
      throw new HttpError(503, 'Configure una conexion personal privada: PERSONAL_GAS_WEB_APP_URL (/exec, distinto de GAS_WEB_APP_URL) y PERSONAL_GAS_API_SECRET (al menos 32 caracteres).');
    }
    if (!endpoint || !secret || !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(endpoint)) throw new Error('GAS connection is not configured');
    let result;
    const signal = AbortSignal.timeout(55000);
    // Google occasionally returns a non-JSON response. Retry reads only, within one timeout.
    const attempts = READ.has(action) || PERSONAL_READ.has(action) ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        let upstream: Response;
        try {
          upstream = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, action: personal ? action.slice('personal-'.length) : action, payload, user }), signal, redirect: 'follow' });
        } catch { throw new HttpError(502, 'No se pudo contactar con Google Sheets. Puede reintentar con la misma clave de idempotencia.'); }
        if (personal && upstream.status === 401) throw new HttpError(503, PERSONAL_CONNECTION_ERROR);
        try { result = await upstream.json(); } catch { throw new HttpError(502, 'Respuesta invalida de Google Sheets'); }
        if (personal && (result?.service !== PERSONAL_IDENTITY.service || result?.spreadsheetId !== PERSONAL_IDENTITY.spreadsheetId)) throw new HttpError(503, PERSONAL_CONNECTION_ERROR);
        if (personal && result.success === false && result.status === 401) throw new HttpError(503, PERSONAL_CONNECTION_ERROR);
        if (!upstream.ok || typeof result?.success !== 'boolean') throw new HttpError(502, 'Respuesta invalida de Google Sheets');
        break;
      } catch (error) {
        if (attempt === attempts - 1 || signal.aborted || (error instanceof HttpError && error.status === 503)) throw error;
        await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
    if (!result.success) {
      const status = [400, 401, 403, 404, 409, 413, 503].includes(result.status) ? result.status : 502;
      throw new HttpError(status, typeof result.message === 'string' ? result.message : 'Error de Google Sheets');
    }
    send(res, 200, { success: true, data: result.data });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    send(res, status, { success: false, message: status === 500 ? 'Error interno o configuracion incompleta del servidor' : (error as Error).message });
  }
}
