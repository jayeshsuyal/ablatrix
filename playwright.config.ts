import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4174', browserName: 'chromium', headless: true },
  webServer: {
    command: 'mkdir -p work && rm -f work/e2e.sqlite* && PORT=4174 ABLATRIX_DB=work/e2e.sqlite ABLATRIX_MODE=fixture npm start',
    url: 'http://127.0.0.1:4174/api/health',
    reuseExistingServer: false,
    timeout: 30_000
  }
});
