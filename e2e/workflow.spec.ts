import { expect, test } from '@playwright/test';

test('fixture baseline, experiment, optimizer, export, and reload', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByText('Fixture responses are for testing the workflow.')).toBeVisible();
  await page.getByLabel('Curated evaluation task').selectOption('github-platform-v1');
  await page.getByRole('button', { name: 'Run baseline' }).click();
  await expect(page.getByRole('heading', { name: 'GitHub' })).toBeVisible();
  await expect(page.getByText(/Fixture research for GitHub/)).toBeVisible();
  await page.getByRole('button', { name: 'Run experiment' }).click();
  await expect(page.getByText('Experiment completed.')).toBeVisible();
  await page.getByRole('button', { name: 'Propose candidate' }).click();
  await expect(page.getByRole('heading', { name: 'Baseline vs candidate' })).toBeVisible();
  await expect(page.getByText(/Unvalidated candidate export/)).toBeVisible();
  await page.getByRole('button', { name: 'Run final fixture holdout' }).click();
  await expect(page.getByText(/Final holdout: 0\/2 passed deterministic checks/)).toBeVisible();
  const manifestUrl = await page.getByRole('link', { name: 'Reproducibility data' }).getAttribute('href');
  const response = await request.get(manifestUrl!);
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest.mode).toBe('fixture');
  expect(manifest.baselineExperiment.runs.length).toBe(4);
  expect(manifest.candidateExperiment.runs.length).toBe(4);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Baseline vs candidate' })).toBeVisible();
  await expect(page.getByText(/Final holdout: 0\/2 passed deterministic checks/)).toBeVisible();
  await expect(page.getByRole('button', { name: /GitHub completed/ }).first()).toBeVisible();
});

test('provider failure is shown, bounded API rejects unknown tasks, and history works on mobile', async ({ page, request }) => {
  const seeded = await request.post('/api/runs', { data: { entity: 'GitHub', question: 'What does GitHub provide for software teams?' } });
  expect(seeded.status()).toBe(201);
  await page.goto('/');
  await page.route('**/api/runs', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Research unavailable.' }) })
    : route.continue());
  await page.getByRole('button', { name: 'Run baseline' }).click();
  await expect(page.getByRole('alert')).toHaveText('Research unavailable.');
  const invalid = await request.post('/api/experiments', { data: { taskIds: ['hidden-holdout-v1'] } });
  expect(invalid.status()).toBe(400);
  const directLive = await request.get('/api/tasks');
  expect(JSON.stringify(await directLive.json())).not.toContain('mozilla');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: /GitHub completed/ }).first()).toBeVisible();
});

test('cancelled fixture experiment persists and does not start another task', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Fixture pacing').selectOption('2000');
  await page.getByRole('button', { name: 'Run experiment' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Experiment cancelled.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Experiment cancelled.')).toBeVisible();
  const cancelled = page.locator('.experiment').first();
  await expect(cancelled).not.toContainText('Starting cloudflare-workers-v1');
});

test('live readiness clearly blocks paid controls without verified accounting', async ({ page }) => {
  await page.route('**/api/health', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, mode: 'live' }) }));
  await page.goto('/');
  await expect(page.getByText('Live spending blocked')).toBeVisible();
  await expect(page.getByText(/Remote cap: not verified/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run experiment' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Propose candidate' })).toBeDisabled();
});
