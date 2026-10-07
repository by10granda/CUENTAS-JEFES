import type { IncomingMessage, ServerResponse } from 'node:http';
import { allowedEmails, cookieToken, readSession, sessionCookie, sessionSecret, signSession, validOrigin, validateUpload } from './security.ts';

type Request = IncomingMessage & { body?: unknown };
const READ = new Set(['bootstrap', 'movements', 'statistics']);
const WRITE = new Set(['create', 'update', 'void', 'saveCatalog', 'upload']);
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
    const isWrite = WRITE.has(action) || action === 'login' || action === 'logout';
    if (!isWrite && !READ.has(action) && !['config', 'session'].includes(action)) throw new HttpError(404, 'Accion desconocida');
    if (method !== (isWrite ? 'POST' : 'GET')) {
      res.setHeader('Allow', isWrite ? 'POST' : 'GET');
      throw new HttpError(405, 'Metodo no permitido');
    }
    if (isWrite && !validOrigin(req)) throw new HttpError(403, 'Origen no permitido');
    if (action === 'config') return send(res, 200, { success: true, data: { googleClientId: process.env.GOOGLE_CLIENT_ID || '' } });
    sessionSecret();
    if (action === 'logout') {
      res.setHeader('Set-Cookie', sessionCookie(req, '', true));
      return send(res, 200, { success: true, data: { user: null } });
    }
    if (action === 'login') {
      const payload = await body(req);
      if (typeof payload.credential !== 'string' || !payload.credential || payload.credential.length > 16000) throw new HttpError(400, 'Credencial invalida');
      if (!process.env.GOOGLE_CLIENT_ID || !allowedEmails().size) throw new Error('Google login is not configured');
      const { OAuth2Client } = await import('google-auth-library');
      let identity;
      try {
        const ticket = await new OAuth2Client(process.env.GOOGLE_CLIENT_ID).verifyIdToken({ idToken: payload.credential, audience: process.env.GOOGLE_CLIENT_ID });
        identity = ticket.getPayload();
      } catch { throw new HttpError(401, 'Credencial de Google invalida'); }
      const email = identity?.email?.toLowerCase();
      if (!email || !identity?.email_verified || !allowedEmails().has(email)) throw new HttpError(403, 'Correo no autorizado');
      const user = { email, name: identity.name || email };
      res.setHeader('Set-Cookie', sessionCookie(req, signSession(user)));
      return send(res, 200, { success: true, data: { user } });
    }
    const user = readSession(cookieToken(req));
    if (action === 'session') return send(res, 200, { success: true, data: { user } });
    if (!user) throw new HttpError(401, 'Inicie sesion para continuar');
    let payload: Record<string, unknown>;
    if (isWrite) payload = await body(req);
    else {
      const raw = url.searchParams.get('filters');
      try { payload = raw ? { filters: JSON.parse(raw) } : { filters: Object.fromEntries([...url.searchParams].filter(([key]) => key !== 'action')) }; }
      catch { throw new HttpError(400, 'Filtros invalidos'); }
    }
    if (action === 'upload') {
      try { validateUpload(payload); } catch (error) { throw new HttpError(400, (error as Error).message); }
    }
    const endpoint = process.env.GAS_WEB_APP_URL;
    const secret = process.env.GAS_API_SECRET;
    if (!endpoint || !secret || !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(endpoint)) throw new Error('GAS connection is not configured');
    let upstream: Response;
    try {
      upstream = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, action, payload, user }), signal: AbortSignal.timeout(55000), redirect: 'follow' });
    } catch { throw new HttpError(502, 'No se pudo contactar con Google Sheets. Puede reintentar con la misma clave de idempotencia.'); }
    let result;
    try { result = await upstream.json(); } catch { throw new HttpError(502, 'Respuesta invalida de Google Sheets'); }
    if (!upstream.ok || typeof result?.success !== 'boolean') throw new HttpError(502, 'Respuesta invalida de Google Sheets');
    if (!result.success) {
      const status = [400, 401, 403, 404, 409, 413, 503].includes(result.status) ? result.status : 502;
      throw new HttpError(status, typeof result.message === 'string' ? result.message : 'Error de Google Sheets');
    }
    send(res, 200, { success: true, data: result.data });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error('API configuration/internal error:', (error as Error).message);
    send(res, status, { success: false, message: status === 500 ? 'Error interno o configuracion incompleta del servidor' : (error as Error).message });
  }
}
