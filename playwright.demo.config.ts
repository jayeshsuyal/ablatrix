import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: /ask-product-entry\.spec\.ts|ask-context\.spec\.ts|automatic-check\.spec\.ts|workspace-trace\.spec\.ts/,
  outputDir: 'work/demo-browser-results',
  fullyParallel: false, workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4187', browserName: 'chromium', headless: true },
  webServer: { command: 'node --import tsx server/index.ts --demo --port=4187', url: 'http://127.0.0.1:4187/api/health', reuseExistingServer: false, timeout: 30_000 }
});
