import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { authenticate, authConfigured, signSession, readSession, validOrigin, driveUrl_, sessionCookie } from '../server/security.ts';
import { handleRequest } from '../server/handler.ts';

beforeEach(() => {
  process.env.SESSION_SECRET = 'a-long-test-secret-with-at-least-32-bytes';
  // Synthetic test-only credentials, never deployment defaults.
  process.env.APP_USERNAME = 'test-only-user';
  process.env.APP_PASSWORD = 'test-only-password-not-for-deployment';
  process.env.NODE_ENV = 'development';
  delete process.env.APP_ORIGIN;
});

const request = (origin?: string, host = 'localhost:3001') => ({ headers: { origin, host }, socket: {} }) as IncomingMessage;
test('credentials are exact, bounded, and fail closed for invalid server configuration', () => {
  const username = process.env.APP_USERNAME!;
  const password = process.env.APP_PASSWORD!;
  assert.deepEqual(authenticate(username, password), { username, name: username });
  for (const [u, p] of [[username.toUpperCase(), password], [username, password + ' '], [username + ' ', password], [null, password], [username, 123], ['', password], [username, ''], ['x'.repeat(101), password], [username, 'x'.repeat(513)], ['test\nuser', password]]) {
    assert.equal(authenticate(u, p), null);
  }
  const token = signSession({ username, name: username });
  for (const [key, values] of [
    ['APP_USERNAME', [undefined, '', ' ', 'x'.repeat(101), 'test\nuser', 'test\x7fuser']],
    ['APP_PASSWORD', [undefined, '', 'short', 'x'.repeat(7), ' '.repeat(8), 'x'.repeat(513)]],
    ['SESSION_SECRET', [undefined, '', 'short']]
  ] as const) {
    const original = process.env[key];
    for (const value of values) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
      assert.equal(authConfigured(), false);
      assert.equal(authenticate(username, password), null);
      assert.equal(readSession(token), null);
      assert.throws(() => signSession({ username, name: username }));
    }
    process.env[key] = original;
  }
  process.env.APP_USERNAME = 'x'.repeat(100);
  process.env.APP_PASSWORD = 'p'.repeat(512);
  assert.ok(authenticate(process.env.APP_USERNAME, process.env.APP_PASSWORD));
  process.env.APP_PASSWORD = 'p'.repeat(8);
  assert.equal(authConfigured(), true);
  assert.ok(authenticate(process.env.APP_USERNAME, process.env.APP_PASSWORD));
});

test('HTTP password login, session, rotation, logout and configuration privacy', async () => {
  const server = createServer((req, res) => { void handleRequest(req, res); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const credentials = { username: process.env.APP_USERNAME!, password: process.env.APP_PASSWORD! };
  const post = (path: string, payload: unknown, origin = 'http://localhost:5173') => fetch(base + path, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' }, body: JSON.stringify(payload)
  });
  try {
    assert.equal((await fetch(base + '/api/login')).status, 405);
    assert.equal((await post('/api/login', credentials, 'https://evil.example')).status, 403);
    for (const payload of [
      {}, { username: '', password: '' }, { username: null, password: credentials.password },
      { ...credentials, username: 'incorrect-test-only-user' }, { ...credentials, password: 'incorrect-test-only-password' },
      { ...credentials, username: 'x'.repeat(101) }, { ...credentials, password: 'x'.repeat(513) },
      { ...credentials, password: [] }, { ...credentials, username: 'test\nuser' }
    ]) {
      const response = await post('/api/login', payload);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { success: false, message: 'Usuario o contraseña incorrectos' });
      assert.equal(response.headers.get('set-cookie'), null);
    }
    for (const path of ['/api/login', '/api/index?action=login']) {
      const response = await post(path, credentials);
      assert.equal(response.status, 200);
      const user = { username: credentials.username, name: credentials.username };
      assert.deepEqual(await response.json(), { success: true, data: { user } });
      const cookie = response.headers.get('set-cookie')!;
      for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=28800']) assert.ok(cookie.includes(attribute));
      const cookieHeader = cookie.split(';')[0];
      const token = cookieHeader.slice(cookieHeader.indexOf('=') + 1);
      const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
      assert.deepEqual(Object.keys(payload).sort(), ['authVersion', 'exp', 'name', 'username']);
      assert.equal(payload.username, credentials.username);
      assert.match(payload.authVersion, /^[A-Za-z0-9_-]{43}$/);
      assert.ok(!JSON.stringify(payload).includes(credentials.password));
      const session = () => fetch(base + '/api/session', { headers: { Cookie: cookieHeader } });
      assert.deepEqual(await (await session()).json(), { success: true, data: { user } });
      process.env.APP_PASSWORD = 'rotated-test-only-password';
      assert.deepEqual(await (await session()).json(), { success: true, data: { user: null } });
      assert.equal((await fetch(base + '/api/index?action=movements', { headers: { Cookie: cookieHeader } })).status, 401);
      process.env.APP_PASSWORD = credentials.password;
      process.env.APP_USERNAME = 'rotated-test-only-user';
      assert.deepEqual(await (await session()).json(), { success: true, data: { user: null } });
      process.env.APP_USERNAME = credentials.username;
      const logout = await post('/api/logout', {});
      assert.equal(logout.status, 200);
      assert.ok(logout.headers.get('set-cookie')?.includes('Max-Age=0'));
    }
    for (const [key, value] of [['APP_USERNAME', ''], ['APP_PASSWORD', ''], ['APP_PASSWORD', 'short'], ['SESSION_SECRET', 'short']]) {
      const original = process.env[key];
      process.env[key] = value;
      const config = await fetch(base + '/api/config');
      assert.equal(config.status, 200);
      assert.deepEqual(await config.json(), { success: true, data: { authMode: 'password', configured: false } });
      const login = await post('/api/login', credentials);
      assert.equal(login.status, 503);
      const result = await login.json();
      assert.match(result.message, /APP_USERNAME.*APP_PASSWORD.*SESSION_SECRET/);
      assert.ok(!JSON.stringify(result).includes(credentials.password));
      assert.equal((await fetch(base + '/api/index?action=movements')).status, 503);
      process.env[key] = original;
    }
    assert.deepEqual(await (await fetch(base + '/api/config')).json(), { success: true, data: { authMode: 'password', configured: true } });
  } finally {
    process.env.APP_USERNAME = credentials.username;
    process.env.APP_PASSWORD = credentials.password;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('HMAC sessions reject tampering, expiry, revoked users and malformed cookies', () => {
  const user = { username: 'test-only-user', name: 'Test Only' };
  const token = signSession(user, 100000);
  assert.deepEqual(readSession(token, 100001), user);
  assert.equal(readSession(token, 100000 + 8 * 3600000), null);
  const parts = token.split('.');
  assert.equal(readSession(Buffer.from('{"username":"test-only-attacker","name":"x","exp":9999999999}').toString('base64url') + '.' + parts[1], 100001), null);
  assert.equal(readSession(token + 'x', 100001), null);
  assert.equal(readSession('malformed', 100001), null);
  process.env.APP_PASSWORD = 'rotated-test-only-password';
  assert.equal(readSession(token, 100001), null);
  process.env.APP_PASSWORD = 'test-only-password-not-for-deployment';
  process.env.APP_USERNAME = 'changed-test-only-user';
  assert.equal(readSession(token, 100001), null);
  process.env.APP_USERNAME = '';
  assert.equal(readSession(token, 100001), null);
});

test('session secret fails closed and cookies are HttpOnly, SameSite, Secure in production', () => {
  process.env.SESSION_SECRET = 'short';
  assert.throws(() => signSession({ username: 'test-only-user', name: '' }), /32/);
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

test('receipt URL validator accepts only optional exact-host Drive file links', () => {
  for (const value of ['',
    'https://drive.google.com/file/d/Ab_12-xy/view',
    'https://drive.google.com/file/d/Ab_12-xy/preview?usp=sharing&resourcekey=0-a+b%3D',
    'https://drive.google.com/file/d/ID/view?usp=drivesdk',
    'https://drive.google.com/file/d/ID/view?usp=drive_link',
    'https://drive.google.com/open?id=ID_-12&usp=sharing&resourcekey=0-key'
  ]) assert.equal(driveUrl_(value), true, value);
  for (const value of [undefined, null, 123, ' ',
    'http://drive.google.com/file/d/ID/view', 'https://drive.google.com.evil/file/d/ID/view',
    'https://user@drive.google.com/file/d/ID/view', 'https://drive.google.com:443/file/d/ID/view',
    'https://drive.google.com/file/d/ID/view#fragment', 'https://drive.google.com/file/d/ID/view\n',
    ' https://drive.google.com/file/d/ID/view', 'https://drive.google.com/file/d/ID/view?x=a b',
    'https://drive.google.com/file/d/ID/view?next=https://evil.example',
    'https://drive.google.com/file/d//view', 'https://drive.google.com/file/d/ID/edit',
    'https://drive.google.com/file/d/ID/view/extra', 'https://drive.google.com/open?id=',
    'https://drive.google.com/open?id=ID/extra', 'https://drive.google.com/open?usp=sharing&id=ID',
    'https://drive.google.com/file/d/ID%20/view', 'https://evil.example'
  ]) assert.equal(driveUrl_(value), false, String(value));
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
       assert.deepEqual(await res.json(), { success: true, data: { authMode: 'password', configured: true } });
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
    const token = signSession({ username: 'test-only-user', name: 'Test Only' });
    const res = await realFetch(base + '/api/index?action=statistics&desde=2026-01-01', { headers: { Cookie: `gerencia_session=${token}` } });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { success: false, message: 'Version en conflicto' });
    assert.deepEqual(forwarded, { secret: 'server-only-secret', action: 'statistics', payload: { filters: { desde: '2026-01-01' } }, user: { username: 'test-only-user', name: 'Test Only' } });
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
  assert.equal((await invoke({ username: '', password: '' })).status, 401);
  assert.equal((await invoke({ username: 'x' }, 'text/plain')).status, 415);
  const oversized = await invoke({ password: 'x'.repeat(7 * 1024 * 1024 + 1) });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.json.success, false);
});

test('removed upload action returns 404 without forwarding to GAS', async () => {
  const realFetch = globalThis.fetch;
  let forwarded = false;
  globalThis.fetch = (async () => { forwarded = true; throw new Error('Must not forward'); }) as typeof fetch;
  try {
    for (const method of ['GET', 'POST']) {
      let output = '';
      const req = { ...request('http://localhost:5173'), method, url: '/api/index?action=upload',
        body: {}, headers: { ...request().headers, origin: 'http://localhost:5173',
          'content-type': 'application/json', cookie: `gerencia_session=${signSession({ username: 'test-only-user', name: 'Test Only' })}` }
      } as IncomingMessage & { body: unknown };
      const res = { statusCode: 0, setHeader() {}, end(value: string) { output = value; } } as unknown as ServerResponse;
      await handleRequest(req, res);
      assert.equal(res.statusCode, 404);
      assert.deepEqual(JSON.parse(output), { success: false, message: 'Accion desconocida' });
    }
    assert.equal(forwarded, false);
  } finally { globalThis.fetch = realFetch; }
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
