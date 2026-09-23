import { expect, test } from '@playwright/test';

test('empty desk explains the workflow without inventing results', async ({ page }) => {
  await page.route('**/api/runs', route => route.fulfill({ json: { runs: [] } }));
  await page.route('**/api/experiments', route => route.fulfill({ json: { experiments: [] } }));
  await page.route('**/api/optimizations', route => route.fulfill({ json: { optimizations: [] } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Better, by evidence.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A clean starting point.' })).toBeVisible();
  await expect(page.getByText('Demonstration, not a benchmark.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Propose candidate' })).toBeDisabled();
  await expect(page.getByText('The reference.', { exact: true })).toBeVisible();
  await expect(page.getByText('The hypothesis.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Candidate config', exact: true })).toHaveCount(0);
  const options = await page.getByLabel('Curated evaluation task').locator('option').allTextContents();
  expect(new Set(options).size).toBe(options.length);
  await page.getByRole('navigation', { name: 'Workspace sections' }).getByRole('link', { name: '03 Evidence' }).click();
  await expect(page).toHaveURL(/#evidence$/);
  await expect(page.getByText('DETERMINISTIC CHECKS ≠ VERIFIED TRUTH')).toBeVisible();
});

test('run index filters, recovers from an empty search, and selects a saved run', async ({ page, request }) => {
  const response = await request.post('/api/runs', { data: { entity: 'Desk search probe', question: 'What does this company make?' } });
  expect(response.status()).toBe(201);
  await page.goto('/');
  const search = page.getByRole('searchbox', { name: 'Search run history' });
  await search.fill('desk search probe');
  const run = page.getByRole('button', { name: /Desk search probe completed/ }).first();
  await expect(run).toBeVisible();
  await run.click();
  await expect(page.getByRole('region', { name: 'Selected run' }).getByRole('heading', { name: 'Desk search probe' })).toBeVisible();
  await search.fill('not-a-real-run');
  await expect(page.getByRole('status')).toHaveText('No runs match “not-a-real-run”.');
  await expect(page.locator('.run-list button')).toHaveCount(0);
  await search.clear();
  await expect(run).toBeVisible();
});

test('desk remains usable across desktop, tablet and mobile without page overflow', async ({ page }) => {
  await page.goto('/');
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('button', { name: 'Run baseline', exact: true })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search run history' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  }
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to workbench' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#workbench$/);
});
