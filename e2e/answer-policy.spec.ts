import { expect, test } from '@playwright/test';

const baseline = { id: 'workspace-baseline-v2-context-synthetic', instructionSha256: 'a'.repeat(64), mode: 'synthetic', parentId: null, status: 'baseline', instructions: 'SYNTHETIC baseline instructions', provenance: 'workspace_baseline' };
const candidate = { ...baseline, id: 'runtime-policy-fictional', parentId: baseline.id, status: 'candidate', instructionSha256: 'b'.repeat(64), instructions: 'SYNTHETIC candidate instructions', provenance: 'synthetic_instruction_proposal' };
const decision = { id: 'runtime-trial-10000000-0000-4000-8000-000000000036', mode: 'synthetic', parent: baseline, candidate, complete: true, verdict: 'eligible_synthetic_trial', callCeiling: 13, operations: Array.from({ length: 13 }, (_, phase) => ({ phase, status: 'completed' })), reasons: ['Synthetic fixture mechanics only.'], baseline: { usefulSupportedAnswers: 1 }, candidateMetrics: { usefulSupportedAnswers: 2, regressions: 0 } };

test('synthetic policy status shows exact evidence, activates a trial and rolls back at mobile width', async ({ page }) => {
  let active = baseline;
  const posts: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { hosted: true, providerMode: 'synthetic', actor: { role: 'operator' } } });
    if (path === '/api/workspace') return route.fulfill({ json: { products: [], runs: [], readiness: { ready: true, reason: 'Synthetic only.' }, busy: false } });
    if (path.endsWith('/activate')) { posts.push(path); expect(route.request().postDataJSON()).toEqual({}); active = candidate; return route.fulfill({ json: active }); }
    if (path.endsWith('/rollback')) { posts.push(path); expect(route.request().postDataJSON()).toEqual({ expectedActiveId: candidate.id }); active = baseline; return route.fulfill({ json: active }); }
    if (path === '/api/workspace/answer-policy') return route.fulfill({ json: { mode: 'synthetic', policies: { active, versions: [candidate, baseline], decisions: [decision] }, readiness: { ready: true, reason: 'Scripted worker only; no provider calls.' } } });
    return route.fulfill({ status: 404, json: { error: 'Unexpected synthetic route.' } });
  });
  await page.goto('/ask');
  const panel = page.getByLabel('Runtime answer policy');
  await panel.locator('> summary').click();
  await expect(panel).toContainText('Scripted results do not establish answer quality');
  await expect(panel.getByRole('link', { name: 'Export exact trial evidence' })).toHaveAttribute('href', '/api/workspace/answer-policy/export');
  await panel.getByRole('button', { name: 'Activate synthetic trial' }).click();
  await expect(panel).toContainText(candidate.id);
  await expect(panel.locator('> summary')).toContainText('automated synthetic trial');
  await panel.getByRole('button', { name: 'Roll back to parent policy' }).click();
  await expect(panel.locator('> summary')).toContainText('workspace baseline');
  await expect(panel.getByRole('button', { name: 'Roll back to parent policy' })).toHaveCount(0);
  await page.setViewportSize({ width: 360, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: '/tmp/ablatrix-runtime-policy-mobile.png', fullPage: true });
  expect(posts).toHaveLength(2); expect(errors).toEqual([]);
});

test('live policy inspection explains calibration gate and never offers activation', async ({ page }) => {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { hosted: false, providerMode: 'local', actor: null } });
    if (path === '/api/workspace') return route.fulfill({ json: { products: [], runs: [], readiness: { ready: false, reason: 'Live disabled.' }, busy: false } });
    if (path === '/api/workspace/answer-policy') return route.fulfill({ json: { mode: 'live', policies: { active: { ...baseline, mode: 'live' }, versions: [], decisions: [{ ...decision, mode: 'live', verdict: 'shadow_candidate' }] }, readiness: { ready: false, reason: 'Live policy shadow requires explicit opt-in and frozen validation.' } } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/ask');
  const panel = page.getByLabel('Runtime answer policy'); await panel.locator('> summary').click();
  await expect(panel).toContainText('Live activation is closed'); await expect(panel).toContainText('no measured calibration');
  await expect(panel.getByRole('button', { name: /Activate/ })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/ablatrix-runtime-policy-desktop.png', fullPage: true });
});

test('a hosted viewer can inspect the policy but cannot activate or roll back', async ({ page }) => {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { hosted: true, providerMode: 'synthetic', actor: { role: 'viewer' } } });
    if (path === '/api/workspace') return route.fulfill({ json: { products: [], runs: [], readiness: { ready: true, reason: 'Synthetic only.' }, busy: false } });
    return route.fulfill({ json: { mode: 'synthetic', policies: { active: candidate, versions: [candidate, baseline], decisions: [decision] }, readiness: { ready: true, reason: 'Synthetic only.' } } });
  });
  await page.goto('/ask'); const panel = page.getByLabel('Runtime answer policy'); await panel.locator('> summary').click();
  await expect(panel.getByRole('button', { name: 'Roll back to parent policy' })).toBeDisabled();
});

test('malformed policy inspection remains a panel error and leaves the question form usable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { hosted: false, providerMode: 'local', actor: null } });
    // Deliberately return the wrong successful payload for policy inspection.
    return route.fulfill({ json: { products: [], runs: [], readiness: { ready: false, reason: 'Synthetic only.' }, busy: false } });
  });
  await page.goto('/ask');
  const panel = page.getByLabel('Runtime answer policy'); await panel.locator('> summary').click();
  await expect(panel.getByRole('alert')).toHaveText('Policy status is unavailable: invalid response.');
  const productName = page.getByRole('textbox', { name: 'Product name', exact: true });
  await productName.fill('Fictional usable product');
  await expect(productName).toHaveValue('Fictional usable product');
  await expect(panel.getByRole('button', { name: /Activate|Roll back/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});
