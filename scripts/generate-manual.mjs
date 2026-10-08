import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const source = new URL('../public/manual-usuario.html', import.meta.url);
const output = fileURLToPath(new URL('../public/manual-usuario.pdf', import.meta.url));

// Playwright honors PLAYWRIGHT_BROWSERS_PATH; no machine-specific executable path.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(source.href, { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: output,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: '18mm', right: '15mm', bottom: '20mm', left: '15mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div style="width:100%;padding:0 15mm;font:8px Arial;color:#536b73;">CUENTAS / GERENCIA &middot; MANUAL DE USUARIO</div>',
    footerTemplate: '<div style="width:100%;padding:0 15mm;font:8px Arial;color:#536b73;display:flex;justify-content:space-between;"><span>Gu&iacute;a operativa &middot; USD</span><span>P&aacute;gina <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>',
  });
  console.log(`PDF generado: ${output}`);
} finally {
  await browser.close();
}
