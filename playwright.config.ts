import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4174', browserName: 'chromium', headless: true },
  webServer: {
    command: 'mkdir -p work && rm -f work/e2e.sqlite* work/e2e-pilot.sqlite* work/e2e-feedback.sqlite* work/e2e-feedback-budget.sqlite* work/e2e-paid-review.sqlite* && PORT=4174 ABLATRIX_DB=work/e2e.sqlite ABLATRIX_PILOT_DB=work/e2e-pilot.sqlite ABLATRIX_LOOP_DB=work/e2e-feedback.sqlite ABLATRIX_LOOP_BUDGET_DB=work/e2e-feedback-budget.sqlite ABLATRIX_PAID_REVIEW_DB=work/e2e-paid-review.sqlite ABLATRIX_RETRIEVAL_DB=work/e2e-retrieval.sqlite ABLATRIX_FINAL_RETRIEVAL_DB=work/e2e-final-retrieval.sqlite ABLATRIX_LANGFUSE_ENABLED=0 ABLATRIX_LOOP_LIVE=0 ABLATRIX_MODE=fixture npm start',
    url: 'http://127.0.0.1:4174/api/health',
    reuseExistingServer: false,
    timeout: 30_000
  }
});
