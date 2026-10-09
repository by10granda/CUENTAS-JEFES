import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('user manual has complete navigation and real download links', () => {
  const html = readFileSync(new URL('../public/manual-usuario.html', import.meta.url), 'utf8');
  const sections = [...html.matchAll(/<section id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(sections.length, 16);
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(match[1]), `Missing anchor ${match[1]}`);
  assert.ok(html.includes('href="/manual-usuario.pdf"'));
  assert.ok(html.includes('Primera puesta en marcha del cliente'));
  assert.ok(html.includes('reiniciarDatosCliente()'));
  assert.ok(!html.includes('movimientos-demo.xlsx'));
  assert.ok(!html.includes('[DEMO]'));
  assert.ok(!html.includes('DEMO-10-POR-JEFE-20261008'));
  assert.ok(html.includes('window.print()'));
});

test('generated user manual is a complete multipage PDF', () => {
  const pdf = readFileSync(new URL('../public/manual-usuario.pdf', import.meta.url));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const source = pdf.toString('latin1');
  assert.ok(source.trimEnd().endsWith('%%EOF'));
  assert.ok([...source.matchAll(/\/Type\s*\/Page\b/g)].length >= 10);
  assert.ok(pdf.length > 50000);
});

test('client delivery excludes the public demonstration workbook and seed utility', () => {
  assert.equal(existsSync(new URL('../public/movimientos-demo.xlsx', import.meta.url)), false);
  assert.equal(existsSync(new URL('../scripts/seed-demo.mjs', import.meta.url)), false);
});
