import { expect, test } from '@playwright/test';

test('fixture single run, suite, candidate, export, holdout, and reload stay accessible', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Standalone runs' }).click();
  await page.getByRole('button', { name: 'New single run' }).click();
  await page.getByLabel('Curated evaluation task').selectOption('github-platform-v1');
  await page.getByRole('button', { name: 'Run single task' }).click();
  await expect(page.getByRole('heading', { name: 'GitHub' })).toBeVisible();
  await expect(page.getByText(/Fixture research for GitHub/)).toBeVisible();
  await page.getByRole('button', { name: 'New experiment' }).click();
  await page.getByRole('button', { name: 'Run experiment' }).click();
  await expect(page.locator('.baseline-decision strong')).toHaveText('Completed');
  await page.getByRole('button', { name: 'Propose candidate' }).click();
  await expect(page.locator('.decision strong')).toHaveText('No Improvement');
  await expect(page.locator('.diff-line')).toHaveCount(2);
  await expect(page.locator('.board tbody tr')).toHaveCount(4);
  await page.getByRole('button', { name: /Inspect GitHub github-platform-v1/ }).click();
  await expect(page.getByRole('complementary', { name: 'Paired task inspector' }).getByText(/Fixture research for GitHub/)).toHaveCount(2);
  await page.getByRole('button', { name: 'Close task inspector' }).click();
  const manifestUrl = await page.getByRole('link', { name: 'Export bundle' }).getAttribute('href');
  const bundle = await (await request.get(manifestUrl!)).json();
  expect(bundle.manifest.mode).toBe('fixture');
  expect(bundle.manifest.baselineExperiment.runs).toHaveLength(4);
  expect(bundle.manifest.candidateExperiment.runs).toHaveLength(4);
  await page.getByRole('button', { name: 'Run final fixture holdout' }).click();
  await expect(page.getByText(/Paired synthetic holdout/)).toBeVisible();
  const hash = await page.evaluate(() => location.hash);
  await page.reload();
  await expect(page).toHaveURL(new RegExp(hash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await expect(page.getByText(/Paired synthetic holdout/)).toBeVisible();
  await expect(page.locator('.board tbody tr')).toHaveCount(4);
});

test('provider failure, hidden task refusal, and standalone history on mobile', async ({ page, request }) => {
  const seeded = await request.post('/api/runs', { data: { entity: 'GitHub', question: 'What does GitHub provide for software teams?' } });
  expect(seeded.status()).toBe(201);
  await page.goto('/#runs');
  await page.route('**/api/runs', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Research unavailable.' }) })
    : route.continue());
  await page.getByRole('button', { name: 'New single run' }).click();
  await page.getByRole('button', { name: 'Run single task' }).click();
  await expect(page.getByRole('alert')).toContainText('Research unavailable.');
  const invalid = await request.post('/api/experiments', { data: { taskIds: ['hidden-holdout-v1'] } });
  expect(invalid.status()).toBe(400);
  const publicTasks = await (await request.get('/api/tasks')).json();
  expect(JSON.stringify(publicTasks)).not.toContain('mozilla');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: 'Standalone run history' }).getByRole('button', { name: /GitHub/ }).first()).toBeVisible();
});

test('cancelled fixture experiment persists and starts no further task', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New experiment' }).click();
  await page.getByText('Advanced bounds').click();
  await page.getByLabel('Fixture pacing').selectOption('2000');
  await page.getByRole('button', { name: 'Run experiment' }).click();
  await page.getByRole('button', { name: 'Cancel remaining tasks' }).click();
  await expect(page.locator('.baseline-decision strong')).toHaveText('Cancelled');
  await page.reload();
  await expect(page.locator('.baseline-decision strong')).toHaveText('Cancelled');
  await expect(page.locator('.events')).not.toContainText('Starting cloudflare-workers-v1');
});

test('live readiness blocks paid controls and shows cap reason', async ({ page }) => {
  await page.route('**/api/health', route => route.fulfill({ json: { ok: true, mode: 'live' } }));
  await page.goto('/');
  await expect(page.getByText('LIVE BLOCKED')).toBeVisible();
  await page.getByText('Mode & budget').click();
  await expect(page.getByText(/Sapiom agents.run and Router/)).toBeVisible();
  await page.getByRole('button', { name: 'New experiment' }).click();
  await expect(page.getByRole('button', { name: 'Live spending blocked' })).toBeDisabled();
});
