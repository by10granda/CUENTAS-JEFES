import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const COOKIE_NAME = 'gerencia_session';
export const SESSION_SECONDS = 8 * 60 * 60;
export type User = { username: string; name: string };

export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET || '';
  if (secret.length < 32 || Buffer.byteLength(secret) < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
  return secret;
}

export function authConfigured(): boolean {
  const username = process.env.APP_USERNAME || '';
  const password = process.env.APP_PASSWORD || '';
  try { sessionSecret(); } catch { return false; }
  return !!username.trim() && username.length <= 100 && !/[\x00-\x1f\x7f-\x9f]/.test(username) &&
    password.length >= 12 && password.length <= 512 && !!password.trim();
}

export function authenticate(username: unknown, password: unknown): User | null {
  if (!authConfigured() || typeof username !== 'string' || !username.trim() || username.length > 100 ||
      /[\x00-\x1f\x7f-\x9f]/.test(username) || typeof password !== 'string' || !password || password.length > 512) return null;
  // Raw credentials live only in server env; there is no password-hash database. Use a strong random password.
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const usernameMatches = timingSafeEqual(digest(username), digest(process.env.APP_USERNAME!));
  const passwordMatches = timingSafeEqual(digest(password), digest(process.env.APP_PASSWORD!));
  return usernameMatches && passwordMatches ? { username, name: username } : null;
}

function authVersion(): string {
  return createHmac('sha256', sessionSecret()).update(JSON.stringify([process.env.APP_USERNAME, process.env.APP_PASSWORD])).digest('base64url');
}

export function signSession(user: User, now = Date.now()): string {
  sessionSecret();
  if (!authConfigured() || user.username !== process.env.APP_USERNAME) throw new Error('Password login is not configured or user is invalid');
  const payload = Buffer.from(JSON.stringify({ username: user.username, name: user.name, exp: Math.floor(now / 1000) + SESSION_SECONDS, authVersion: authVersion() })).toString('base64url');
  return `${payload}.${createHmac('sha256', sessionSecret()).update(payload).digest('base64url')}`;
}

export function readSession(token: string | undefined, now = Date.now()): User | null {
  if (!authConfigured() || !token || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const expected = createHmac('sha256', sessionSecret()).update(parts[0]).digest();
  const supplied = Buffer.from(parts[1], 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!Number.isSafeInteger(value.exp) || value.exp <= Math.floor(now / 1000) ||
        typeof value.username !== 'string' || typeof value.name !== 'string' || value.username !== process.env.APP_USERNAME ||
        typeof value.authVersion !== 'string') return null;
    const version = Buffer.from(value.authVersion, 'base64url');
    const current = Buffer.from(authVersion(), 'base64url');
    if (version.length !== current.length || !timingSafeEqual(version, current)) return null;
    return { username: value.username, name: value.name };
  } catch { return null; }
}

export function cookieToken(req: IncomingMessage): string | undefined {
  return req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
}

export function isSecure(req: IncomingMessage): boolean {
  return process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https' || Boolean((req.socket as { encrypted?: boolean }).encrypted);
}

export function sessionCookie(req: IncomingMessage, token: string, clear = false): string {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : SESSION_SECONDS}${isSecure(req) ? '; Secure' : ''}`;
}

export function validOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin === 'null') return false;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) return false;
    if (process.env.APP_ORIGIN && origin === new URL(process.env.APP_ORIGIN).origin) return true;
    const protocol = isSecure(req) ? 'https' : 'http';
    if (req.headers.host && origin === `${protocol}://${req.headers.host}`) return true;
    return process.env.NODE_ENV !== 'production' && origin === 'http://localhost:5173';
  } catch { return false; }
}

export function validateUpload(payload: Record<string, unknown>): void {
  const { fileName, mimeType, base64 } = payload;
  if (typeof fileName !== 'string' || !fileName.trim() || fileName.length > 200 || /[\x00-\x1f/\\]/.test(fileName)) throw new Error('Nombre de archivo invalido');
  if (typeof base64 !== 'string' || !base64 || base64.length > 6990508 || base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(base64)) throw new Error('Archivo base64 invalido');
  const padding = base64.indexOf('=');
  if (padding >= 0 && (padding < base64.length - 2 || !/^={1,2}$/.test(base64.slice(padding)))) throw new Error('Archivo base64 invalido');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > 5 * 1024 * 1024 || bytes.toString('base64') !== base64) throw new Error('El archivo supera 5 MB o es invalido');
  const valid = mimeType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 :
    mimeType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) :
    mimeType === 'application/pdf' ? bytes.subarray(0, 5).toString('ascii') === '%PDF-' : false;
  if (!valid) throw new Error('Solo se permiten JPG, PNG o PDF con contenido valido');
}
