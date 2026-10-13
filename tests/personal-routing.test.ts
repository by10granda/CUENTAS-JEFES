import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { handleRequest } from '../server/handler.ts';
import { authenticate, authConfigured, readSession, signSession, type Role } from '../server/security.ts';

const reads = ['bootstrap', 'movements', 'statistics'];
const writes = ['create', 'update', 'void', 'saveCatalog'];
const personalReads = ['personal-bootstrap', 'personal-backup'];
const personalWrites = ['personal-save', 'personal-generate', 'personal-transaction', 'personal-pay', 'personal-void', 'personal-reconcile', 'personal-configure', 'personal-upload', 'personal-resolveOperation'];
const user = (role: Role) => ({ username: role === 'gerencia' ? 'test-manager' : 'test-personal', name: role === 'gerencia' ? 'test-manager' : 'test-personal', role });
const personalResponse = (value: Record<string, unknown>) => ({ service: 'personal-finance', spreadsheetId: '1WU3UF1gTgut-Yx2dUn51Kk1fu2EHtnQSfxOOdx15-Y0', ...value });
beforeEach(() => {
  process.env.SESSION_SECRET = 'synthetic-test-session-secret-at-least-32';
  process.env.APP_USERNAME = 'test-manager';
  process.env.APP_PASSWORD = 'synthetic-manager-password';
  process.env.PERSONAL_USERNAME = 'test-personal';
  process.env.PERSONAL_PASSWORD = 'synthetic-personal-password';
  process.env.GAS_WEB_APP_URL = 'https://script.google.com/macros/s/test-manager/exec';
  process.env.GAS_API_SECRET = 'synthetic-manager-api-secret-at-least-32';
  process.env.PERSONAL_GAS_WEB_APP_URL = 'https://script.google.com/macros/s/test-personal/exec';
  process.env.PERSONAL_GAS_API_SECRET = 'synthetic-personal-api-secret-at-least-32';
  process.env.NODE_ENV = 'development';
  delete process.env.APP_ORIGIN;
});

async function withApi(run: (api: (action: string, role?: Role, payload?: unknown, token?: string) => Promise<Response>, calls: { url: string; body: any; signal?: AbortSignal | null }[], mode: { value: string }) => Promise<void>) {
  const realFetch = globalThis.fetch;
  const calls: { url: string; body: any; signal?: AbortSignal | null }[] = [];
  const mode = { value: 'ok' };
  globalThis.fetch = (async (input, init) => {
    if (!String(input).startsWith('https://script.google.com/')) return realFetch(input, init);
    calls.push({ url: String(input), body: JSON.parse(init!.body as string), signal: init?.signal });
    if (mode.value === 'fail' || (mode.value === 'recover' && calls.length === 1)) return new Response('temporary non-JSON');
    const response = String(input) === process.env.PERSONAL_GAS_WEB_APP_URL ? personalResponse : (value: Record<string, unknown>) => value;
    if (mode.value === 'missing-proof') return Response.json({ success: true, data: { movements: ['private-bank-data'] } });
    if (mode.value === 'wrong-service') return Response.json(personalResponse({ service: 'gerencia', success: true, data: { movements: ['private-bank-data'] } }));
    if (mode.value === 'wrong-sheet') return Response.json(personalResponse({ spreadsheetId: 'another-document', success: true, data: { movements: ['private-bank-data'] } }));
    if (mode.value === 'unproven-error') return Response.json({ success: false, status: 409, message: 'private-bank-data' });
    if (mode.value === 'unauthorized') return Response.json(response({ success: false, status: 401, message: 'private-bank-data ' + process.env.PERSONAL_GAS_API_SECRET + ' ' + user('personal').username }));
    if (mode.value === 'http-unauthorized') return new Response('private-bank-data', { status: 401 });
    if (mode.value === 'business') return Response.json(response({ success: false, status: 409, message: 'Conflict' }));
    return Response.json(response({ success: true, data: { real: true } }));
  }) as typeof fetch;
  const server = createServer((req, res) => { void handleRequest(req, res); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const api = (action: string, role?: Role, payload?: unknown, token?: string) => realFetch(base + (action.startsWith('/') ? action : '/api/index?action=' + action), {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json', ...(token || role ? { Cookie: `gerencia_session=${token || signSession(user(role!))}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  try { await run(api, calls, mode); }
  finally {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('both roles login and return strict scoped identity; public config reveals no identity', async () => {
  await withApi(async api => {
    assert.deepEqual(await (await api('config')).json(), { success: true, data: { authMode: 'password', configured: true } });
    for (const role of ['gerencia', 'personal'] as const) {
      const response = await api('login', undefined, { username: user(role).username, password: process.env[role === 'gerencia' ? 'APP_PASSWORD' : 'PERSONAL_PASSWORD'] });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { success: true, data: { user: user(role) } });
      assert.ok(response.headers.get('set-cookie')?.includes('Max-Age=28800'));
      for (const session of ['session', '/api/session']) {
        assert.deepEqual(await (await api(session, role)).json(), { success: true, data: { user: user(role) } });
      }
    }
    process.env.APP_PASSWORD = 'short';
    assert.equal((await api('session')).status, 200);
    process.env.PERSONAL_PASSWORD = 'short';
    assert.equal((await api('session')).status, 503);
    assert.deepEqual(await (await api('config')).json(), { success: true, data: { authMode: 'password', configured: false } });
    const logout = await api('logout', undefined, {});
    assert.equal(logout.status, 200);
    assert.ok(logout.headers.get('set-cookie')?.includes('Max-Age=0'));
  });
});

test('all cross-role actions return 403 without any upstream forwarding', async () => {
  await withApi(async (api, calls) => {
    for (const action of reads) assert.equal((await api(action, 'personal')).status, 403);
    for (const action of writes) assert.equal((await api(action, 'personal', {})).status, 403);
    for (const action of personalReads) assert.equal((await api(action, 'gerencia')).status, 403);
    for (const action of personalWrites) assert.equal((await api(action, 'gerencia', {})).status, 403);
    assert.equal(calls.length, 0);
  });
});

test('each role forwards only its own endpoint, secret, role and whitelisted engine action', async () => {
  await withApi(async (api, calls) => {
    for (const action of [...reads, ...writes, ...personalReads, ...personalWrites.filter(action => action !== 'personal-upload')]) {
      const personal = action.startsWith('personal-');
      const role = personal ? 'personal' : 'gerencia';
      const write = writes.includes(action) || personalWrites.includes(action);
      assert.equal((await api(action, role, write ? { operationId: 'test-only' } : undefined)).status, 200);
      const call = calls.at(-1)!;
      assert.equal(call.url, process.env[personal ? 'PERSONAL_GAS_WEB_APP_URL' : 'GAS_WEB_APP_URL']);
      assert.equal(call.body.secret, process.env[personal ? 'PERSONAL_GAS_API_SECRET' : 'GAS_API_SECRET']);
      assert.deepEqual(call.body.user, user(role));
      assert.equal(call.body.action, personal ? action.slice(9) : action);
      if (personal && !write) assert.deepEqual(call.body.payload, {});
    }
    calls.length = 0;
    assert.equal((await api('personal-unknown', 'personal', {})).status, 404);
    assert.equal(calls.length, 0);
  });
});

test('personal reads reject unsupported query fields without forwarding; gerencia filters stay intact', async () => {
  await withApi(async (api, calls) => {
    for (const action of personalReads) {
      for (const query of ['filters=%7B%7D', 'filters=', 'desde=2026-01-01', 'unknown=value']) {
        assert.equal((await api(action + '&' + query, 'personal')).status, 400);
        assert.equal((await api(action + '&' + query, 'gerencia')).status, 403);
      }
    }
    assert.equal(calls.length, 0);
    for (const action of personalReads) {
      assert.equal((await api(action, 'personal')).status, 200);
      assert.deepEqual(calls.at(-1)!.body.payload, {});
    }
    assert.equal((await api('statistics&desde=2026-01-01', 'gerencia')).status, 200);
    assert.deepEqual(calls.at(-1)!.body.payload, { filters: { desde: '2026-01-01' } });
    assert.equal((await api('statistics&filters=%7B%22desde%22%3A%222026-01-01%22%7D', 'gerencia')).status, 200);
    assert.deepEqual(calls.at(-1)!.body.payload, { filters: { desde: '2026-01-01' } });
  });
});

test('personal connection fails 503 without fallback for missing, invalid or shared endpoint', async () => {
  await withApi(async (api, calls) => {
    for (const [key, value] of [
      ['PERSONAL_GAS_WEB_APP_URL', ''], ['PERSONAL_GAS_API_SECRET', ''],
      ['PERSONAL_GAS_API_SECRET', 'x'.repeat(31)],
      ['PERSONAL_GAS_WEB_APP_URL', 'https://script.google.com/macros/s/test-personal/dev'],
      ['PERSONAL_GAS_WEB_APP_URL', process.env.GAS_WEB_APP_URL!],
    ]) {
      const original = process.env[key];
      process.env[key] = value;
      const response = await api('personal-bootstrap', 'personal');
      assert.equal(response.status, 503);
      assert.match((await response.json()).message, /conexion personal privada/);
      process.env[key] = original;
    }
    assert.equal(calls.length, 0);
    assert.equal((await api('bootstrap', 'gerencia')).status, 200);
  });
});

test('personal namespace proof rejects misrouted data and errors without leaking bodies or retrying', async () => {
  process.env.PERSONAL_GAS_WEB_APP_URL = 'https://script.google.com/macros/s/another-deployment/exec';
  await withApi(async (api, calls, mode) => {
    for (const value of ['missing-proof', 'wrong-service', 'wrong-sheet', 'unproven-error']) {
      mode.value = value;
      for (const action of ['personal-bootstrap', 'personal-backup', 'personal-save']) {
        calls.length = 0;
        const response = await api(action, 'personal', action === 'personal-save' ? {} : undefined);
        assert.equal(response.status, 503);
        const result = await response.json();
        assert.deepEqual(Object.keys(result).sort(), ['message', 'success']);
        assert.equal(result.success, false);
        assert.match(result.message, /Configuracion de conexion personal/);
        assert.ok(!JSON.stringify(result).includes('private-bank-data'));
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, process.env.PERSONAL_GAS_WEB_APP_URL);
        assert.equal(calls[0].body.user.role, 'personal');
      }
    }
    calls.length = 0; mode.value = 'ok';
    process.env.PERSONAL_GAS_API_SECRET = 'x'.repeat(32);
    assert.deepEqual(await (await api('personal-bootstrap', 'personal')).json(), { success: true, data: { real: true } });
    assert.equal(calls.length, 1);
    assert.deepEqual(await (await api('bootstrap', 'gerencia')).json(), { success: true, data: { real: true } });
  });
});

test('personal upstream authentication failures are private configuration errors; expired sessions remain 401', async () => {
  await withApi(async (api, calls, mode) => {
    for (const value of ['unauthorized', 'http-unauthorized']) {
      calls.length = 0; mode.value = value;
      const response = await api('personal-bootstrap', 'personal');
      assert.equal(response.status, 503);
      const result = await response.json();
      assert.match(result.message, /Configuracion de conexion personal/);
      for (const privateValue of ['private-bank-data', process.env.PERSONAL_GAS_API_SECRET!, user('personal').username]) assert.ok(!JSON.stringify(result).includes(privateValue));
      assert.equal(calls.length, 1);
    }
    calls.length = 0;
    const expired = signSession(user('personal'), Date.now() - 8 * 60 * 60 * 1000);
    assert.equal((await api('personal-bootstrap', undefined, undefined, expired)).status, 401);
    assert.equal(calls.length, 0);
  });
});

test('role tampering and old signed roleless cookies are rejected; rotation is per profile', () => {
  const manager = signSession(user('gerencia'));
  const personal = signSession(user('personal'));
  const [encoded, signature] = personal.split('.');
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
  payload.role = 'gerencia';
  assert.equal(readSession(Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + signature), null);
  delete payload.role;
  const legacy = Buffer.from(JSON.stringify(payload)).toString('base64url');
  assert.equal(readSession(legacy + '.' + createHmac('sha256', process.env.SESSION_SECRET!).update(legacy).digest('base64url')), null);
  for (const key of ['PERSONAL_PASSWORD', 'PERSONAL_USERNAME']) {
    const original = process.env[key];
    process.env[key] = 'rotated-synthetic-personal';
    assert.equal(readSession(personal), null);
    assert.deepEqual(readSession(manager), user('gerencia'));
    process.env[key] = original;
  }
  process.env.APP_PASSWORD = 'rotated-synthetic-manager';
  assert.equal(readSession(manager), null);
  assert.deepEqual(readSession(personal), user('personal'));
  process.env.SESSION_SECRET = 'rotated-synthetic-session-secret-at-least-32';
  assert.equal(readSession(personal), null);
});

test('HTTP rejects tampered roles and revoked cookies without forwarding, while the other profile stays signed in', async () => {
  const personal = signSession(user('personal'));
  const manager = signSession(user('gerencia'));
  const [encoded, signature] = personal.split('.');
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
  payload.role = 'gerencia';
  const tampered = Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + signature;
  await withApi(async (api, calls) => {
    assert.equal((await api('bootstrap', undefined, undefined, tampered)).status, 401);
    assert.deepEqual(await (await api('session', undefined, undefined, tampered)).json(), { success: true, data: { user: null } });
    process.env.PERSONAL_PASSWORD = 'rotated-synthetic-personal-password';
    assert.equal((await api('personal-bootstrap', undefined, undefined, personal)).status, 401);
    assert.deepEqual(await (await api('session', undefined, undefined, manager)).json(), { success: true, data: { user: user('gerencia') } });
    assert.equal(calls.length, 0);
  });
});

test('ambiguous valid usernames fail closed regardless of submitted password; invalid profiles do not collide', async () => {
  process.env.PERSONAL_USERNAME = process.env.APP_USERNAME;
  assert.equal(authConfigured(), false);
  assert.equal(authenticate(process.env.APP_USERNAME, process.env.APP_PASSWORD), null);
  assert.equal(authenticate(process.env.PERSONAL_USERNAME, process.env.PERSONAL_PASSWORD), null);
  await withApi(async (api, calls) => {
    assert.equal((await api('login', undefined, { username: process.env.APP_USERNAME, password: process.env.APP_PASSWORD })).status, 503);
    assert.equal(calls.length, 0);
  });
  process.env.PERSONAL_PASSWORD = 'short';
  assert.deepEqual(authenticate(process.env.APP_USERNAME, process.env.APP_PASSWORD), user('gerencia'));
});

test('personal reads retry transient failures three times in one timeout; writes and business errors never retry', async () => {
  await withApi(async (api, calls, mode) => {
    mode.value = 'recover';
    assert.equal((await api('personal-bootstrap', 'personal')).status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].signal, calls[1].signal);
    for (const action of personalReads) {
      calls.length = 0; mode.value = 'fail';
      assert.equal((await api(action, 'personal')).status, 502);
      assert.equal(calls.length, 3);
      assert.ok(calls.every(call => call.signal === calls[0].signal));
    }
    for (const action of personalWrites.filter(action => action !== 'personal-upload')) {
      calls.length = 0;
      assert.equal((await api(action, 'personal', {})).status, 502);
      assert.equal(calls.length, 1);
    }
    calls.length = 0; mode.value = 'business';
    assert.equal((await api('personal-backup', 'personal')).status, 409);
    assert.equal(calls.length, 1);
  });
});

test('personal upload validates canonical base64, MIME signatures and 3 MiB limit before forwarding', async () => {
  await withApi(async (api, calls, mode) => {
    const pdf = Buffer.alloc(3 * 1024 * 1024, 32);
    pdf.write('%PDF-1.7');
    const valid = { requestId: 'b3fe1cd4-768e-4e31-8ad5-7772a8d3c4a1', filename: 'receipt.pdf', mimeType: 'application/pdf', base64: pdf.toString('base64') };
    assert.equal((await api('personal-upload', 'personal', { ...valid, folderId: 'client-folder', secret: 'client-secret' })).status, 200);
    assert.deepEqual(calls[0].body.payload, valid);
    for (const [payload, status] of [
      [{ ...valid, base64: Buffer.concat([pdf, Buffer.from('x')]).toString('base64') }, 413],
      [{ ...valid, base64: 'a'.repeat(4 * 1024 * 1024 + 1) }, 413],
      [{ ...valid, base64: 'data:application/pdf;base64,JVBERi0=' }, 400],
      [{ ...valid, base64: 'JVBERi0=\n' }, 400],
      [{ ...valid, base64: 'JVBERi1=' }, 400],
      [{ ...valid, base64: 'JV=ERi0=' }, 400],
      [{ ...valid, base64: 'JVBER===' }, 400],
      [{ ...valid, base64: 'JVBERi0' }, 400],
      [{ ...valid, mimeType: 'image/png' }, 400],
      [{ ...valid, mimeType: 'text/html' }, 400],
      [{ ...valid, filename: '../receipt.pdf' }, 400],
      [{ ...valid, filename: '.receipt.pdf' }, 400],
      [{ ...valid, filename: 'x'.repeat(117) + '.pdf' }, 400],
      [{ ...valid, filename: 'receipt.png' }, 400],
      [{ requestId: valid.requestId, name: valid.filename, mimeType: valid.mimeType, base64: valid.base64 }, 400],
      [{ ...valid, base64: '' }, 400],
    ] as const) {
      calls.length = 0;
      assert.equal((await api('personal-upload', 'personal', payload)).status, status);
      assert.equal(calls.length, 0);
    }
    for (const [mimeType, signature] of [['image/png', [137, 80, 78, 71, 13, 10, 26, 10]], ['image/jpeg', [255, 216, 255]]] as const) {
      const payload = { requestId: valid.requestId, filename: mimeType === 'image/png' ? 'receipt.png' : 'receipt.jpg', mimeType, base64: Buffer.from(signature).toString('base64') };
      assert.equal((await api('personal-upload', 'personal', payload)).status, 200);
      assert.deepEqual(calls.at(-1)!.body.payload, payload);
    }
    calls.length = 0; mode.value = 'fail';
    assert.equal((await api('personal-upload', 'personal', valid)).status, 502);
    assert.equal(calls.length, 1);
    calls.length = 0;
    assert.equal((await api('personal-save', 'personal', { data: 'x'.repeat(7 * 1024 * 1024) })).status, 413);
    assert.equal(calls.length, 0);
  });
});

test('large PDF base64 validation handles the exact limit and both padding forms without stack overflow', async () => {
  await withApi(async (api, calls) => {
    const maxBytes = 3 * 1024 * 1024;
    for (const size of [maxBytes, maxBytes - 1, maxBytes - 2]) {
      const pdf = Buffer.alloc(size, 32);
      pdf.write('%PDF-1.7\n');
      pdf.write('\n%%EOF\n', size - 7);
      const payload = { requestId: 'b3fe1cd4-768e-4e31-8ad5-7772a8d3c4a1', filename: 'x'.repeat(116) + '.pdf', mimeType: 'application/pdf', base64: pdf.toString('base64') };
      assert.equal(payload.base64.endsWith('=='), size === maxBytes - 2);
      assert.equal(payload.base64.endsWith('='), size !== maxBytes);
      calls.length = 0;
      assert.equal((await api('personal-upload', 'personal', payload)).status, 200);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].body.payload, payload);
    }
    const oversized = Buffer.alloc(maxBytes + 1, 32);
    oversized.write('%PDF-1.7\n');
    calls.length = 0;
    assert.equal((await api('personal-upload', 'personal', { requestId: 'b3fe1cd4-768e-4e31-8ad5-7772a8d3c4a1', filename: 'receipt.pdf', mimeType: 'application/pdf', base64: oversized.toString('base64') })).status, 413);
    assert.equal(calls.length, 0);
  });
});
