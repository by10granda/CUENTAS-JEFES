# Mocked Browser Tests

Install Chromium with `npx playwright install chromium`, then run `npm run test:e2e`. The config starts Vite at http://localhost:5173 or reuses an existing development server there. No API process is required because all API responses are intercepted. If you use a custom browser install directory, set `PLAYWRIGHT_BROWSERS_PATH` to that directory when installing and running tests.

These tests exercise the real frontend with intercepted `/api/index` responses using the documented API envelope. They are not live OAuth, backend, Sheets, or Drive integration tests and need no credentials. Unexpected API actions and external requests fail the tests.

Google Fonts CSS is intercepted with an empty stylesheet so tests use local fallback fonts without network access. No OAuth scripts are needed because authenticated sessions are mocked before the workspace renders.

The default bootstrap contains only approved catalogs, with empty accounts and movements. Account creation explicitly supplies a zero opening balance. Income, expense, and payment amounts exist only in opt-in synthetic fixtures under this directory and are never written to production services.

Both desktop and mobile Chromium run setup-warning, empty-dashboard, account/movement retry, linked-payment accounting, and actual XLSX/PDF download checks. Screenshots and traces are retained on failure. Downloads and runner artifacts are generated under `e2e/test-results/`.
