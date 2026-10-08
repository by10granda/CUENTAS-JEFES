import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

test('user manual has complete navigation and real download links', () => {
  const html = readFileSync(new URL('../public/manual-usuario.html', import.meta.url), 'utf8');
  const sections = [...html.matchAll(/<section id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(sections.length, 16);
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(match[1]), `Missing anchor ${match[1]}`);
  assert.ok(html.includes('href="/manual-usuario.pdf"'));
  assert.ok(html.includes('href="/movimientos-demo.xlsx"'));
  assert.ok(html.includes('DEMO-10-POR-JEFE-20261008'));
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

test('public demonstration workbook contains exactly ten fictional records per jefe, never original rows', () => {
  const book = XLSX.read(readFileSync(new URL('../public/movimientos-demo.xlsx', import.meta.url)), { type: 'buffer', cellDates: true });
  assert.deepEqual(book.SheetNames, ['Franco Becerra', 'Josselyn Becerra', 'Resumen de demostracion']);
  const ids = new Set<string>();
  const origins: string[] = [];
  for (const name of book.SheetNames.slice(0, 2)) {
    const sheet = book.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<(string | number | Date)[]>(sheet, { header: 1 });
    const data = rows.slice(5);
    assert.equal(data.length, 10);
    assert.equal(rows[0][0], 'DATOS FICTICIOS DE DEMOSTRACION');
    assert.equal(rows[2][1], 'DEMO-10-POR-JEFE-20261008');
    for (const row of data) {
      assert.equal(row[3], name);
      assert.ok(String(row[6]).startsWith('[DEMO]'));
      assert.ok(String(row[14]).includes('DATOS FICTICIOS PARA PRUEBAS'));
      assert.ok(row[1] instanceof Date);
      for (const column of [7, 8, 9, 10, 11]) assert.equal(typeof row[column], 'number');
      ids.add(String(row[0]));
      if (row[13]) origins.push(String(row[13]));
    }
    assert.equal(sheet['!autofilter']?.ref, 'A5:O15');
  }
  assert.equal(ids.size, 20);
  assert.equal(origins.length, 2);
  assert.ok(origins.every(id => ids.has(id)));
  const totals = XLSX.utils.sheet_to_json<(string | number)[]>(book.Sheets['Resumen de demostracion'], { header: 1 });
  for (const row of totals.slice(5)) assert.deepEqual(row.slice(1), [10, 315, 162, 153]);
});
