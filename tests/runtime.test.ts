import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

test('compiled API runs in plain Node without TypeScript source files or a TS loader', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = mkdtempSync(join(root, '.runtime-test-'));
  try {
    const compile = spawnSync(process.execPath, [
      join(root, 'node_modules/typescript/bin/tsc'),
      '-p', 'tsconfig.server.json', '--noEmit', 'false',
      '--outDir', output, '--rootDir', root,
    ], { cwd: root, encoding: 'utf8' });
    assert.equal(compile.status, 0, compile.stdout + compile.stderr);
    const entries = ['index', 'config', 'session', 'login', 'logout'].map(name =>
      pathToFileURL(join(output, 'api', name + '.js')).href);
    const script = `
      const entries = ${JSON.stringify(entries)};
      for (const entry of entries) {
        const module = await import(entry);
        if (typeof module.default !== 'function') throw new Error('Missing handler: ' + entry);
      }
      const {default: handler} = await import(entries[0]);
      const req = {url:'/api/index?action=config',method:'GET',headers:{}};
      const res = {statusCode:0,setHeader(){},end(body){
        const value = JSON.parse(body);
        if (this.statusCode !== 200 || !value.success || value.data.authMode !== 'password' || typeof value.data.configured !== 'boolean' || Object.keys(value.data).length !== 2) {
          throw new Error('Unexpected config response: ' + body);
        }
        console.log('Compiled API config OK');
      }};
      await handler(req,res);
      process.env.NODE_ENV = 'production';
      process.env.SESSION_SECRET = 'synthetic-runtime-session-secret-at-least-32';
      delete process.env.APP_USERNAME;
      delete process.env.APP_PASSWORD;
      process.env.PERSONAL_USERNAME = 'synthetic-runtime-personal';
      process.env.PERSONAL_PASSWORD = 'synthetic-runtime-password';
      let response;
      let cookie;
      const capture = {statusCode:0,setHeader(key,value){if(key === 'Set-Cookie') cookie = value;},end(body){response = JSON.parse(body);}};
      await handler(req,capture);
      if (capture.statusCode !== 200 || response.data.configured !== true || Object.keys(response.data).length !== 2) throw new Error('Personal-only config failed');
      await handler({url:'/api/login',method:'POST',socket:{},headers:{origin:'https://runtime.example',host:'runtime.example','content-type':'application/json'},body:{username:process.env.PERSONAL_USERNAME,password:process.env.PERSONAL_PASSWORD}},capture);
      if (capture.statusCode !== 200 || response.data.user.role !== 'personal' || !cookie.includes('Secure')) throw new Error('Production personal login failed');
      await handler({url:'/api/session',method:'GET',headers:{cookie:cookie.split(';')[0]}},capture);
      if (capture.statusCode !== 200 || response.data.user.role !== 'personal') throw new Error('Production personal session failed');
      console.log('Compiled production personal API OK');
    `;
    const runtime = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root, encoding: 'utf8',
    });
    assert.equal(runtime.status, 0, runtime.stdout + runtime.stderr);
    assert.match(runtime.stdout, /Compiled API config OK/);
    assert.match(runtime.stdout, /Compiled production personal API OK/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
