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
    password.length >= 8 && password.length <= 512 && !!password.trim();
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

export function driveUrl_(value: unknown): boolean {
  return typeof value === 'string' && !/\s/.test(value) && (value === '' ||
    /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/(?:view|preview)(?:\?[A-Za-z0-9_=%&.~+\-]*)?$/.test(value) ||
    /^https:\/\/drive\.google\.com\/open\?id=[A-Za-z0-9_-]+(?:&[A-Za-z0-9_=%&.~+\-]*)?$/.test(value));
}
