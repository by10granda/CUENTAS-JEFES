import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { test, expect, navigate, noPageOverflow, testAccount, accountingFixtures, testUser, testPassword } from './fixtures';

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
  await expect(page.getByRole('heading', { name: 'Empieza con tus cuentas reales' })).toBeVisible();
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

test('explicit zero-balance account and tax-inclusive movement survive failed save with identical retry', async ({ page, mock }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Empieza con tus cuentas reales' })).toBeVisible();
  await navigate(page, 'Configuración');
  await page.getByRole('tab', { name: /^Cuentas/ }).click();
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre', { exact: true }).fill('Cuenta de prueba');
  await dialog.getByRole('combobox', { name: /^Responsable/ }).selectOption('1');
  await dialog.getByLabel('Saldo inicial (USD)', { exact: true }).fill('0');
  await dialog.getByRole('button', { name: 'Guardar catálogo' }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.catalogWrites).toEqual([{ sheet: 'CUENTAS', row: { NOMBRE: 'Cuenta de prueba', ESTADO: 'Activo', JEFE: '1', SALDO_INICIAL: 0 } }]);
  await navigate(page, 'Movimientos');
  await page.getByRole('button', { name: 'Nuevo movimiento', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: /^Responsable/ }).selectOption('1');
  await dialog.getByRole('combobox', { name: /^Cuenta de origen/ }).selectOption(testAccount.ID);
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
  await expect(page.getByRole('heading', { name: 'Tus cuentas están listas' })).toBeVisible();
  await page.getByRole('button', { name: 'Retomar borrador', exact: true }).last().click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: /^Descripción/ })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Reintentar guardado' }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.creates).toHaveLength(2);
  expect(mock.creates[1]).toEqual(mock.creates[0]);
  expect(mock.creates[0].CLAVE_IDEMPOTENCIA).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(mock.creates[0]).toMatchObject({ TOTAL: 20, PAGADO: 20, CANTIDAD: 2, VALOR_UNITARIO: 10, SUBCATEGORIA: 'Subcategoría de prueba' });
  expect(mock.movements).toHaveLength(1);
  await navigate(page, 'Movimientos');
  await expect(page.getByRole('cell', { name: 'Categoría: Alimentación / Subcategoría de prueba', exact: false })).toBeVisible();
  await noPageOverflow(page);
});

test('linked payment reduces pending from 25 to 15 without double counting expense or balance', async ({ page, mock }) => {
  mock.bootstrap.cuentas = [{ ...testAccount, SALDO_ACTUAL: 95 }];
  mock.movements = accountingFixtures();
  await page.goto('/');
  const indicator = (title: string) => page.locator('.indicator').filter({ has: page.locator('.indicator-top > span', { hasText: new RegExp(`^${title}$`) }) }).locator('> strong');
  await expect(indicator('Gasto')).toHaveText('$30,00');
  await expect(indicator('Pendiente')).toHaveText('$25,00');
  await expect(indicator('Disponible')).toHaveText('$95,00');
  await navigate(page, 'Pendientes');
  await expect(page.locator('.pending-overview strong')).toHaveText('$25,00');
  await page.getByRole('button', { name: 'Pagar', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox', { name: /^Responsable/ })).toBeDisabled();
  await expect(dialog.getByRole('combobox', { name: /^Cuenta de origen/ })).toBeDisabled();
  await dialog.getByLabel('Valor unitario (USD)', { exact: true }).fill('10');
  await dialog.getByRole('combobox', { name: /^Forma de pago/ }).selectOption('payment-1');
  mock.bootstrap.cuentas[0].SALDO_ACTUAL = 85;
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
  await expect(indicator('Disponible')).toHaveText('$85,00');
});

test('report buttons download real XLSX and PDF files from test-only movements', async ({ page, mock }, testInfo) => {
  mock.bootstrap.cuentas = [{ ...testAccount, SALDO_ACTUAL: 95 }];
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
