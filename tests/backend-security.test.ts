import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { signSession, readSession, validOrigin, validateUpload, sessionCookie } from '../server/security.ts';
import { handleRequest } from '../server/handler.ts';

beforeEach(() => {
  process.env.SESSION_SECRET = 'a-long-test-secret-with-at-least-32-bytes';
  process.env.ALLOWED_EMAILS = 'allowed@example.com, SECOND@example.com';
  process.env.GOOGLE_CLIENT_ID = 'client-id';
  process.env.NODE_ENV = 'development';
  delete process.env.APP_ORIGIN;
});

const request = (origin?: string, host = 'localhost:3001') => ({ headers: { origin, host }, socket: {} }) as IncomingMessage;
test('HMAC sessions reject tampering, expiry, revoked users and malformed cookies', () => {
  const user = { email: 'allowed@example.com', name: 'Allowed' };
  const token = signSession(user, 100000);
  assert.deepEqual(readSession(token, 100001), user);
  assert.equal(readSession(token, 100000 + 8 * 3600000), null);
  const parts = token.split('.');
  assert.equal(readSession(Buffer.from('{"email":"evil@example.com","name":"x","exp":9999999999}').toString('base64url') + '.' + parts[1], 100001), null);
  assert.equal(readSession(token + 'x', 100001), null);
  assert.equal(readSession('malformed', 100001), null);
  process.env.ALLOWED_EMAILS = '';
  assert.equal(readSession(token, 100001), null);
});

test('session secret fails closed and cookies are HttpOnly, SameSite, Secure in production', () => {
  process.env.SESSION_SECRET = 'short';
  assert.throws(() => signSession({ email: 'allowed@example.com', name: '' }), /32/);
  process.env.NODE_ENV = 'production';
  const cookie = sessionCookie(request(), 'token');
  for (const attribute of ['HttpOnly', 'SameSite=Lax', 'Secure', 'Path=/']) assert.ok(cookie.includes(attribute));
  assert.ok(sessionCookie(request(), '', true).includes('Max-Age=0'));
});

test('Origin policy is exact: same host, configured origin, localhost 5173 only in dev', () => {
  assert.equal(validOrigin(request('http://localhost:5173')), true);
  assert.equal(validOrigin(request('http://localhost:3001')), true);
  for (const origin of [undefined, 'null', 'https://evil.example', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://localhost:5173/']) assert.equal(validOrigin(request(origin)), false);
  process.env.APP_ORIGIN = 'https://app.example';
  process.env.NODE_ENV = 'production';
  assert.equal(validOrigin(request('https://app.example')), true);
  assert.equal(validOrigin(request('https://app.example.evil')), false);
  assert.equal(validOrigin(request('http://localhost:5173')), false);
  assert.equal(validOrigin(request('https://app.example', 'app.example')), true);
});

test('upload validates strict base64, size, MIME and magic bytes', () => {
  for (const [mimeType, bytes] of [
    ['image/jpeg', Buffer.from([255, 216, 255, 0])],
    ['image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ['application/pdf', Buffer.from('%PDF-1.7')]
  ] as const) validateUpload({ fileName: 'receipt', mimeType, base64: bytes.toString('base64') });
  for (const p of [
    { fileName: '../evil.pdf', mimeType: 'application/pdf', base64: 'JVBERi0=' },
    { fileName: 'x', mimeType: 'image/jpeg', base64: 'JVBERi0=' },
    { fileName: 'x', mimeType: 'application/pdf', base64: 'JVBERi0=\n' },
    { fileName: 'x', mimeType: 'application/pdf', base64: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64') },
    { fileName: 'x', mimeType: 'text/html', base64: 'JVBERi0=' }
  ]) assert.throws(() => validateUpload(p));
});

test('HTTP contract: config public and minimal, private reads unauthorized, writes CSRF protected', async () => {
  const server = createServer((req, res) => { void handleRequest(req, res); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const path of ['/api/config', '/api/index?action=config']) {
      const res = await fetch(base + path);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { success: true, data: { googleClientId: 'client-id' } });
    }
    const session = await fetch(base + '/api/index?action=session');
    assert.deepEqual(await session.json(), { success: true, data: { user: null } });
    const privateRead = await fetch(base + '/api/index?action=movements');
    assert.equal(privateRead.status, 401);
    assert.equal((await privateRead.json()).success, false);
    const blocked = await fetch(base + '/api/index?action=logout', { method: 'POST' });
    assert.equal(blocked.status, 403);
    const logout = await fetch(base + '/api/index?action=logout', { method: 'POST', headers: { Origin: 'http://localhost:5173' } });
    assert.equal(logout.status, 200);
    assert.ok(logout.headers.get('set-cookie')?.includes('Max-Age=0'));
    assert.equal((await fetch(base + '/api/index?action=create')).status, 405);
    assert.equal((await fetch(base + '/api/index?action=unknown')).status, 404);
    const login = await fetch(base + '/api/index?action=login', { method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(login.status, 400);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('authenticated proxy forwards server-only secret/user, filters and GAS conflict errors', async () => {
  process.env.GAS_WEB_APP_URL = 'https://script.google.com/macros/s/test-deployment/exec';
  process.env.GAS_API_SECRET = 'server-only-secret';
  const realFetch = globalThis.fetch;
  let forwarded: Record<string, any> | undefined;
  globalThis.fetch = (async (input, init) => {
    if (String(input).startsWith('https://script.google.com/')) {
      forwarded = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ success: false, status: 409, message: 'Version en conflicto' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  const server = createServer((req, res) => { void handleRequest(req, res); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const token = signSession({ email: 'allowed@example.com', name: 'Allowed' });
    const res = await realFetch(base + '/api/index?action=statistics&desde=2026-01-01', { headers: { Cookie: `gerencia_session=${token}` } });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { success: false, message: 'Version en conflicto' });
    assert.deepEqual(forwarded, { secret: 'server-only-secret', action: 'statistics', payload: { filters: { desde: '2026-01-01' } }, user: { email: 'allowed@example.com', name: 'Allowed' } });
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.GAS_WEB_APP_URL;
    delete process.env.GAS_API_SECRET;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('Vercel parsed bodies get the same JSON, content-type and size validation', async () => {
  const invoke = async (body: unknown, contentType = 'application/json') => {
    let result = '';
    const req = { ...request('http://localhost:5173'), method: 'POST', url: '/api/index?action=login', body } as IncomingMessage & { body: unknown };
    req.headers['content-type'] = contentType;
    const res = { statusCode: 0, setHeader() {}, end(value: string) { result = value; } } as unknown as ServerResponse;
    await handleRequest(req, res);
    return { status: res.statusCode, json: JSON.parse(result) };
  };
  assert.equal((await invoke([])).status, 400);
  assert.equal((await invoke(null)).status, 400);
  assert.equal((await invoke({ credential: '' })).status, 400);
  assert.equal((await invoke({ credential: 'x' }, 'text/plain')).status, 415);
  const oversized = await invoke({ credential: 'x'.repeat(7 * 1024 * 1024 + 1) });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.json.success, false);
});

test('maximum local 5 MiB upload accepted; noncanonical base64 is rejected', () => {
  const bytes = Buffer.alloc(5 * 1024 * 1024);
  bytes.write('%PDF-');
  validateUpload({ fileName: 'max.pdf', mimeType: 'application/pdf', base64: bytes.toString('base64') });
  assert.throws(() => validateUpload({ fileName: 'x.pdf', mimeType: 'application/pdf', base64: 'JVBERi1=' }));
});

test('oversized chunked HTTP body returns JSON 413 without destroying the response socket', async () => {
  const server = createServer((req, res) => { void handleRequest(req, res); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: (server.address() as { port: number }).port, path: '/api/index?action=login', method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, res => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode!, body }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end(Buffer.alloc(7 * 1024 * 1024 + 1024, 'x'));
    });
    assert.equal(result.status, 413);
    assert.equal(JSON.parse(result.body).success, false);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
