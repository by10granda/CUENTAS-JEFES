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
        if (this.statusCode !== 200 || !value.success || typeof value.data.googleClientId !== 'string') {
          throw new Error('Unexpected config response: ' + body);
        }
        console.log('Compiled API config OK');
      }};
      await handler(req,res);
    `;
    const runtime = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root, encoding: 'utf8',
    });
    assert.equal(runtime.status, 0, runtime.stdout + runtime.stderr);
    assert.match(runtime.stdout, /Compiled API config OK/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
