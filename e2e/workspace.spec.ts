import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import type { Locator } from '@playwright/test';
import { test, expect, navigate, noPageOverflow, testAccount, accountingFixtures, testUser, testPassword } from './fixtures';

async function fillMovement(dialog: Locator) {
  await dialog.getByRole('combobox', { name: /^Responsable/ }).selectOption('1');
  await dialog.getByRole('combobox', { name: /^Categoría/ }).selectOption('category-1');
  await dialog.getByRole('combobox', { name: /^Forma de pago/ }).selectOption('payment-1');
  await dialog.getByRole('textbox', { name: /^Descripción/ }).fill('Movimiento sintético');
  await dialog.getByLabel('Valor unitario (USD)', { exact: true }).fill('10');
}

test('missing login configuration shows setup warning and no financial workspace', async ({ page, mock }) => {
  mock.configMissing = true;
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Configuración necesaria' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('El acceso con usuario y contraseña todavía no está configurado.');
  for (const variable of ['APP_USERNAME', 'APP_PASSWORD', 'SESSION_SECRET', 'GAS_WEB_APP_URL', 'GAS_API_SECRET']) {
    await expect(page.locator('.setup-guide')).toContainText(variable);
  }
  await expect(page.locator('.setup-guide')).toContainText('entre 8 y 512 caracteres');
  await expect(page.locator('.setup-guide')).toContainText('al menos 32 caracteres');
  await expect(page.locator('.login-page')).not.toContainText(/Google|Gmail|OAuth|ALLOWED_EMAILS/);
  await expect(page.getByRole('form', { name: 'Iniciar sesión' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Verificar de nuevo' })).toBeEnabled();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.locator('.indicator, .movement-table')).toHaveCount(0);
  await noPageOverflow(page);
  expect([...new Set(mock.actions)]).toEqual(['config']);
});

test('password login retains failed credentials, clears password on success and never stores it', async ({ page, mock }) => {
  mock.user = null;
  await page.goto('/');
  const username = page.getByLabel('Usuario', { exact: true });
  const password = page.getByLabel('Contraseña', { exact: true });
  await expect(username).toHaveAttribute('autocomplete', 'username');
  await expect(password).toHaveAttribute('autocomplete', 'current-password');
  await expect(password).toHaveAttribute('type', 'password');
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await username.fill(testUser.username);
  await password.fill('wrong-test-password');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Usuario o contraseña incorrectos');
  await expect(username).toHaveValue(testUser.username);
  await expect(password).toHaveValue('wrong-test-password');
  expect(mock.logins).toEqual([{ username: testUser.username, password: 'wrong-test-password' }]);
  expect([...new Set(mock.actions)]).toEqual(['config', 'session', 'login']);
  expect(await page.evaluate(() => ({ session: { ...sessionStorage }, local: { ...localStorage } }))).toEqual({ session: {}, local: {} });
  await noPageOverflow(page);
  await password.fill(testPassword);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Resumen general' })).toBeVisible();
  expect(mock.logins).toEqual([
    { username: testUser.username, password: 'wrong-test-password' },
    { username: testUser.username, password: testPassword },
  ]);
  await expect(page.locator('.user-card small')).toHaveText(testUser.username);
  const openMenu = page.getByRole('button', { name: 'Abrir navegación', exact: true });
  if (await openMenu.isVisible()) await openMenu.click();
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(username).toHaveValue(testUser.username);
  await expect(password).toHaveValue('');
  expect(mock.user).toBeNull();
  expect(await page.evaluate(() => ({ session: { ...sessionStorage }, local: { ...localStorage } }))).toEqual({ session: {}, local: {} });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
});

test('authenticated empty dashboard has approved catalogs and no seeded finance', async ({ page, mock }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Registra tu primer movimiento' })).toBeVisible();
  await expect(page.locator('.indicator > strong')).toHaveText(Array(5).fill('$0,00'));
  await expect(page.getByRole('heading', { name: 'Franco Becerra' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Josselyn Becerra' })).toBeVisible();
  expect(mock.bootstrap.cuentas).toEqual([]);
  expect(mock.movements).toEqual([]);
  await noPageOverflow(page);
  await navigate(page, 'Movimientos');
  await expect(page.getByRole('heading', { name: 'El registro está vacío' })).toBeVisible();
  await noPageOverflow(page);
  await navigate(page, 'Reportes');
  await expect(page.getByRole('button', { name: 'Descargar Excel' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Descargar PDF' })).toBeDisabled();
  await noPageOverflow(page);
});

test('zero accounts allow a tax-inclusive movement and failed save retains identical retry', async ({ page, mock }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Registra tu primer movimiento' })).toBeVisible();
  await navigate(page, 'Configuración');
  await expect(page.getByRole('tab', { name: /^Cuentas/ })).toHaveCount(0);
  expect(mock.catalogWrites).toEqual([]);
  expect(mock.bootstrap.cuentas).toEqual([]);
  await navigate(page, 'Movimientos');
  await page.getByRole('button', { name: 'Nuevo movimiento', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: /^Responsable/ }).selectOption('1');
  await expect(dialog.getByRole('combobox', { name: /^Cuenta/ })).toHaveCount(0);
  await dialog.getByRole('combobox', { name: /^Categoría/ }).selectOption('category-1');
  await dialog.getByLabel(/^Subcategoría/).fill('Subcategoría de prueba');
  await dialog.getByRole('combobox', { name: /^Forma de pago/ }).selectOption('payment-1');
  await dialog.getByLabel('Cantidad', { exact: true }).fill('2');
  await dialog.getByLabel('Valor unitario (USD)', { exact: true }).fill('10');
  await expect(dialog.getByLabel('Total final (USD)', { exact: true })).toHaveValue('20');
  await expect(dialog.getByRole('textbox', { name: /^Descripción/ })).toHaveAttribute('required', '');
  await dialog.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
  expect(mock.creates).toHaveLength(0);
  await dialog.getByRole('textbox', { name: /^Descripción/ }).fill('Movimiento exclusivamente de prueba');
  mock.failNextCreate = true;
  await dialog.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('No se pudo guardar el movimiento');
  await expect(dialog.getByRole('textbox', { name: /^Descripción/ })).toHaveValue('Movimiento exclusivamente de prueba');
  await expect(dialog.getByRole('textbox', { name: /^Descripción/ })).toBeDisabled();
  await expect(dialog.getByLabel(/^Subcategoría/)).toHaveValue('Subcategoría de prueba');
  await expect(dialog.getByRole('button', { name: 'Reintentar guardado' })).toBeEnabled();
  await noPageOverflow(page);
  await dialog.getByRole('button', { name: 'Cerrar y conservar' }).click();
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([`gerencia-draft:${testUser.username}`]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Registra tu primer movimiento' })).toBeVisible();
  await page.getByRole('button', { name: 'Retomar borrador', exact: true }).last().click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: /^Descripción/ })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Reintentar guardado' }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.creates).toHaveLength(2);
  expect(mock.creates[1]).toEqual(mock.creates[0]);
  expect(mock.creates[0].CLAVE_IDEMPOTENCIA).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(mock.creates[0]).toMatchObject({ TOTAL: 20, PAGADO: 20, CANTIDAD: 2, VALOR_UNITARIO: 10, SUBCATEGORIA: 'Subcategoría de prueba' });
  expect(mock.creates[0].CUENTA || '').toBe('');
  expect(mock.creates[0].CUENTA_DESTINO_ID || '').toBe('');
  expect(mock.creates[0].COMPROBANTE_URL).toBeUndefined();
  expect(mock.movements).toHaveLength(1);
  await navigate(page, 'Movimientos');
  await expect(page.getByRole('cell', { name: 'Categoría: Alimentación / Subcategoría de prueba', exact: false })).toBeVisible();
  await noPageOverflow(page);
});

test('linked payment reduces pending from 25 to 15 while investment stays 30', async ({ page, mock }) => {
  mock.movements = accountingFixtures();
  await page.goto('/');
  const indicator = (title: string) => page.locator('.indicator').filter({ has: page.locator('.indicator-top > span', { hasText: new RegExp(`^${title}$`) }) }).locator('> strong');
  await expect(indicator('Gasto')).toHaveText('$30,00');
  await expect(indicator('Pendiente')).toHaveText('$25,00');
  await expect(indicator('Total invertido')).toHaveText('$30,00');
  await expect(page.locator('.person-investment')).toHaveText(['$30,00', '$0,00']);
  await navigate(page, 'Pendientes');
  await expect(page.locator('.pending-overview strong')).toHaveText('$25,00');
  await page.getByRole('button', { name: 'Pagar', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox', { name: /^Responsable/ })).toBeDisabled();
  await expect(dialog.getByRole('combobox', { name: /^Cuenta/ })).toHaveCount(0);
  await dialog.getByLabel('Valor unitario (USD)', { exact: true }).fill('10');
  await dialog.getByRole('combobox', { name: /^Forma de pago/ }).selectOption('payment-1');
  await dialog.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.creates[0]).toMatchObject({ TIPO: 'Pago', MOVIMIENTO_ORIGEN_ID: 'test-expense', TOTAL: 10, PAGADO: 10 });
  await expect(page.locator('.pending-overview strong')).toHaveText('$15,00');
  await noPageOverflow(page);
  const region = page.getByRole('region', { name: /Obligaciones pendientes, tabla/ });
  if (test.info().project.name === 'mobile') {
    expect(await region.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await region.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    expect(await region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  }
  await navigate(page, 'Resumen');
  await expect(indicator('Gasto')).toHaveText('$30,00');
  await expect(indicator('Pago')).toHaveText('$0,00');
  await expect(indicator('Pendiente')).toHaveText('$15,00');
  await expect(indicator('Total invertido')).toHaveText('$30,00');
  await expect(page.locator('.person-investment')).toHaveText(['$30,00', '$0,00']);
});

test('report buttons download real XLSX and PDF files from test-only movements', async ({ page, mock }, testInfo) => {
  mock.movements = accountingFixtures();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Resumen general' })).toBeVisible();
  await navigate(page, 'Reportes');
  for (const [name, extension] of [['Descargar Excel', 'xlsx'], ['Descargar PDF', 'pdf']]) {
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(new RegExp(`^cuentas-reporte-\\d{4}-\\d{2}-\\d{2}\\.${extension}$`));
    expect(await download.failure()).toBeNull();
    const file = testInfo.outputPath(`test-only-report.${extension}`);
    await download.saveAs(file);
    const bytes = await readFile(file);
    if (extension === 'xlsx') {
      expect(bytes.subarray(0, 2).toString()).toBe('PK');
      const workbook = XLSX.read(bytes, { type: 'buffer', cellDates: true });
      expect(workbook.SheetNames).toEqual(['Movimientos']);
      const sheet = workbook.Sheets.Movimientos;
      expect(sheet.I6.v).toBe(100);
      expect(sheet.I7.v).toBe(30);
      expect(sheet.K7.v).toBe(25);
      expect(sheet.A6.t).toBe('d');
      expect(sheet['!autofilter']?.ref).toBe('A5:M7');
      expect(sheet.C5.v).toBe('Responsable');
      expect(sheet.C7.v).toBe('Franco Becerra');
      expect(sheet.B10.v).toBe(30);
      expect(sheet.A10.v).toBe('Total invertido (incluye pendientes)');
    } else {
      const text = bytes.toString('latin1');
      expect(text).toMatch(/^%PDF-1\./);
      expect(text).toContain('%%EOF');
      expect(text).toContain('/Type /Page');
      expect(text).toContain('CUENTAS / GERENCIA');
    }
    await testInfo.attach(`test-only-${extension}`, { path: file, contentType: extension === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  await noPageOverflow(page);
});

test('receipt is optional, only validated Drive URLs can be saved and no upload exists', async ({ page, mock }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nuevo movimiento', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await fillMovement(dialog);
  await expect(dialog.getByLabel(/^URL del comprobante/)).not.toHaveAttribute('required');
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Subir|Upload/i })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.creates[0].COMPROBANTE_URL).toBeUndefined();

  for (const url of [
    'https://drive.google.com/file/d/test_receipt-1/view?usp=sharing',
    'https://drive.google.com/file/d/test_receipt-2/preview',
    'https://drive.google.com/open?id=test_receipt-3&usp=drive_link',
  ]) {
    await page.getByRole('button', { name: 'Nuevo movimiento', exact: true }).click();
    dialog = page.getByRole('dialog');
    await fillMovement(dialog);
    const receipt = dialog.getByLabel(/^URL del comprobante/);
    for (const invalid of ['https://example.com/receipt.pdf', 'https://drive.google.com.evil.test/file/d/id/view', 'https://drive.google.com/file/d/id/view#fragment']) {
      await receipt.fill(invalid);
      await expect(dialog.getByRole('link', { name: 'Ver comprobante adjunto' })).toHaveCount(0);
      const before = mock.creates.length;
      await dialog.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
      await expect(dialog.getByRole('alert')).toContainText('El comprobante es opcional');
      expect(mock.creates).toHaveLength(before);
    }
    await receipt.fill(url);
    await expect(dialog.getByRole('link', { name: 'Ver comprobante adjunto' })).toHaveAttribute('href', url);
    await dialog.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(mock.creates.at(-1)?.COMPROBANTE_URL).toBe(url);
  }
  expect(mock.actions).not.toContain('upload');
  await noPageOverflow(page);
});

test('new transfers have no accounts, require positive total and do not add investment', async ({ page, mock }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nuevo movimiento', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await fillMovement(dialog);
  await dialog.getByRole('combobox', { name: 'Tipo', exact: true }).selectOption('Transferencia');
  await expect(dialog).toContainText('solo registro; no se incluye en el total invertido');
  await expect(dialog.getByRole('combobox', { name: /^Cuenta/ })).toHaveCount(0);
  await expect(dialog.getByRole('combobox', { name: 'Estado', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('combobox', { name: 'Estado', exact: true })).toHaveValue('Pagado');
  await dialog.getByLabel('Valor unitario (USD)', { exact: true }).fill('0');
  await dialog.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
  expect(mock.creates).toHaveLength(0);
  await dialog.getByLabel('Valor unitario (USD)', { exact: true }).fill('10');
  await dialog.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.creates[0]).toMatchObject({ TIPO: 'Transferencia', TOTAL: 10, PAGADO: 10, ESTADO: 'Pagado' });
  expect(mock.creates[0].CUENTA || '').toBe('');
  expect(mock.creates[0].CUENTA_DESTINO_ID || '').toBe('');
  await expect(page.locator('.indicator.accent > strong')).toHaveText('$0,00');
});

test('historical account metadata and receipt survive editing and identical retry without display', async ({ page, mock }) => {
  mock.bootstrap.cuentas = [testAccount, { ...testAccount, ID: 'historical-destination', NOMBRE: 'Destino histórico' }];
  const original = { ...accountingFixtures()[0], TIPO: 'Transferencia', CUENTA: testAccount.ID, CUENTA_DESTINO_ID: 'historical-destination', COMPROBANTE_URL: 'https://drive.google.com/open?id=historical_receipt&usp=drive_link' };
  mock.movements = [original];
  await page.goto('/');
  await expect(page.locator('.person-grid')).not.toContainText(/cuentas|Disponible|Saldo/);
  await expect(page.getByRole('heading', { name: 'Evolución del disponible' })).toHaveCount(0);
  await navigate(page, 'Movimientos');
  await page.getByRole('button', { name: 'Filtros', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Cuenta', exact: true })).toHaveCount(0);
  await expect(page.locator('.movement-table')).not.toContainText(/Cuenta de prueba|Destino histórico/);
  await page.getByRole('button', { name: `Ver ${original.ID}`, exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.locator('dt').filter({ hasText: /^Cuenta(?: destino)?$/ })).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: 'Abrir comprobante' })).toHaveAttribute('href', original.COMPROBANTE_URL);
  await dialog.getByRole('button', { name: 'Cerrar ventana' }).click();
  await page.getByRole('button', { name: `Editar ${original.ID}`, exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel(/^URL del comprobante/)).toHaveValue(original.COMPROBANTE_URL);
  await dialog.getByRole('textbox', { name: /^Descripción/ }).fill('Descripción editada');
  mock.failNextUpdate = true;
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(dialog.getByRole('alert')).toContainText('No se pudo guardar');
  await dialog.getByRole('button', { name: 'Cerrar y conservar' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Retomar borrador', exact: true }).last().click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Reintentar guardado' }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.updates).toHaveLength(2);
  expect(mock.updates[1]).toEqual(mock.updates[0]);
  expect(mock.updates[0]).toMatchObject({ CUENTA: original.CUENTA, CUENTA_DESTINO_ID: original.CUENTA_DESTINO_ID, COMPROBANTE_URL: original.COMPROBANTE_URL, DESCRIPCION: 'Descripción editada' });
  await noPageOverflow(page);
});

test('deliberate type and responsible changes clear historical account metadata', async ({ page, mock }) => {
  mock.bootstrap.cuentas = [testAccount, { ...testAccount, ID: 'historical-destination' }];
  mock.movements = [{ ...accountingFixtures()[0], TIPO: 'Transferencia', CUENTA: testAccount.ID, CUENTA_DESTINO_ID: 'historical-destination' }];
  await page.goto('/');
  await navigate(page, 'Movimientos');
  await page.getByRole('button', { name: 'Editar test-income', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Tipo', exact: true }).selectOption('Gasto');
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.updates[0]).toMatchObject({ CUENTA: '', CUENTA_DESTINO_ID: '', TIPO: 'Gasto' });
  mock.movements[0] = { ...mock.movements[0], CUENTA: testAccount.ID };
  await page.getByRole('button', { name: 'Actualizar datos' }).click();
  await expect(page.getByRole('button', { name: 'Actualizar datos' })).toBeEnabled();
  await page.getByRole('button', { name: 'Editar test-income', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: /^Responsable/ }).selectOption('2');
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.updates[1]).toMatchObject({ CUENTA: '', CUENTA_DESTINO_ID: '', JEFE: '2' });
  expect(mock.updates[1]).not.toHaveProperty('COMPROBANTE_URL');
});

test('investment includes pending independent expenses only and follows shared filters', async ({ page, mock }) => {
  const expense = accountingFixtures()[1];
  mock.movements = [expense,
    { ...expense, ID: 'purchase', TIPO: 'Compra', TOTAL: 20, PAGADO: 0, ESTADO: 'Pendiente', JEFE: '2' },
    { ...expense, ID: 'payment', TIPO: 'Pago', TOTAL: 10, PAGADO: 10, ESTADO: 'Pagado' },
    ...['Ingreso', 'Reembolso', 'Transferencia', 'Retiro', 'Préstamo', 'Adelanto'].map(TIPO => ({ ...expense, ID: TIPO, TIPO, TOTAL: 100, PAGADO: 100, ESTADO: 'Pagado', DIRECCION: TIPO === 'Préstamo' || TIPO === 'Adelanto' ? 'Entregado' as const : undefined })),
    { ...expense, ID: 'cancelled', TOTAL: 200, ESTADO: 'Anulado' },
    { ...expense, ID: 'linked', TIPO: 'Pago', TOTAL: 10, PAGADO: 10, ESTADO: 'Pagado', MOVIMIENTO_ORIGEN_ID: expense.ID },
  ];
  await page.goto('/');
  await expect(page.locator('.indicator.accent > strong')).toHaveText('$60,00');
  await expect(page.locator('.person-investment')).toHaveText(['$40,00', '$20,00']);
  await page.getByRole('button', { name: 'Filtros', exact: true }).click();
  await page.getByRole('combobox', { name: 'Responsable', exact: true }).selectOption('2');
  await expect(page.locator('.indicator.accent > strong')).toHaveText('$20,00');
  await expect(page.locator('.person-investment')).toHaveText(['$20,00']);
  await navigate(page, 'Reportes');
  await expect(page.locator('.report-summary')).toContainText('Total invertido (incluye pendientes) $20,00');
  await noPageOverflow(page);
});

test('unsafe historical receipts never become links in table, detail or reports', async ({ page, mock }, testInfo) => {
  mock.movements = [{ ...accountingFixtures()[1], COMPROBANTE_URL: 'https://example.com/private.pdf' }];
  await page.goto('/');
  await navigate(page, 'Movimientos');
  await expect(page.getByRole('link', { name: /comprobante/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ver test-expense', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('link', { name: 'Abrir comprobante' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cerrar ventana' }).click();
  await navigate(page, 'Reportes');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar Excel', exact: true }).click();
  const file = testInfo.outputPath('unsafe-receipt.xlsx');
  await (await downloading).saveAs(file);
  const workbook = XLSX.read(await readFile(file), { type: 'buffer' });
  expect(workbook.Sheets.Movimientos.M6?.v || '').toBe('');
});

test('linked payments use only the same responsible and do not inherit historical accounts', async ({ page, mock }) => {
  const original = { ...accountingFixtures()[1], CUENTA: testAccount.ID };
  mock.bootstrap.cuentas = [testAccount];
  mock.movements = [original, { ...original, ID: 'other-responsible', JEFE: '2', CUENTA: '', DESCRIPCION: 'Obligación de otro responsable' }];
  await page.goto('/');
  await page.getByRole('button', { name: 'Nuevo movimiento', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await fillMovement(dialog);
  await dialog.getByRole('combobox', { name: 'Tipo', exact: true }).selectOption('Pago');
  const origins = dialog.getByRole('combobox', { name: /^Obligación de origen/ });
  await expect(origins.locator('option[value="other-responsible"]')).toHaveCount(0);
  await origins.selectOption(original.ID);
  await expect(dialog.getByRole('combobox', { name: /^Responsable/ })).toHaveValue('1');
  await expect(dialog.getByRole('combobox', { name: /^Responsable/ })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.creates[0]).toMatchObject({ JEFE: '1', MOVIMIENTO_ORIGEN_ID: original.ID, TOTAL: 10, PAGADO: 10 });
  expect(mock.creates[0].CUENTA || '').toBe('');
  await expect(page.locator('.indicator.accent > strong')).toHaveText('$60,00');
});
