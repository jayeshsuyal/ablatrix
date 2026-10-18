import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalDemo } from '../server/local-demo.ts';

test('product answers are the root entry and research is secondary', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Answers you can trace.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run baseline' })).toHaveCount(0);
  await page.locator('.ask-research-nav summary').click();
  await expect(page.getByRole('link', { name: 'Research archive' })).toHaveAttribute('href', '/research');
});

test('a lost question response reuses its browser request identity across reload', async ({ page }) => {
  const intents: Record<string, unknown>[] = [];
  const product = { id: 'fixture-product', title: 'Fictional local flask', sources: [], createdAt: '2026-10-17T00:00:00.000Z' };
  const readiness = { ready: true, reason: 'Browser fixture; no dispatch.' };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { hosted: false, providerMode: 'local', actor: null } });
    if (path === '/api/workspace') return route.fulfill({ json: { products: [product], runs: [], readiness, automaticCheckReadiness: readiness, busy: false } });
    if (path === '/api/workspace/questions') {
      const payload = route.request().postDataJSON(); intents.push(payload);
      if (intents.length === 1) return route.abort('failed');
      return route.fulfill({ json: { id: 'saved-fixture-run', productId: product.id, question: payload.question, mode: 'live', status: 'completed', retrieval: null, answer: { answer: 'The supplied listing states six cups.', status: 'answered', citations: [] }, model: 'scripted-browser-model', usage: null, createdAt: product.createdAt, error: null } });
    }
    if (path === '/api/workspace/automatic-checks') return route.fulfill({ json: { checks: [], readiness } });
    return route.fulfill({ status: 404, json: { error: 'Not part of the browser fixture.' } });
  });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Question', exact: true }).fill('What is the listed capacity?');
  await page.getByRole('button', { name: 'Generate cited answer' }).click();
  await expect(page.locator('.ask-main>.ask-alert[role="alert"]')).toContainText('request identity is saved');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue('What is the listed capacity?');
  await page.getByRole('button', { name: 'Generate cited answer' }).click();
  await expect(page.locator('.ask-answer')).toContainText('six cups');
  expect(intents).toHaveLength(2); expect(intents[0].idempotencyKey).toMatch(/^[a-f0-9-]{36}$/); expect(intents[1]).toEqual(intents[0]);
});

test('fresh isolated demo exposes recovery, bounded correction, safe stop, sources and exact proof export', async ({ page, request }, testInfo) => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-product-demo-browser-'));
  const demo = await createLocalDemo(directory);
  await new Promise<void>(resolve => demo.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(demo.server.address() as { port: number }).port}`;
  try {
    await page.goto(origin);
    await expect(page.locator('.ask-local')).toHaveText('SYNTHETIC DEMO');
    await expect(page.locator('.ask-recovery-note')).toContainText('no additional generation call');
    const checked = page.getByRole('region', { name: 'Automatic source check' });
    await expect(checked.getByRole('heading')).toHaveText('Repaired · synthetic check passed');
    await checked.locator('.automatic-check-original summary').click();
    await expect(checked.locator('.automatic-check-original')).toContainText('eight cups');
    await expect(checked.locator('.automatic-check-answer')).toContainText('six cups');
    await page.locator('.ask-sources-details>summary').click();
    await expect(page.locator('.ask-evidence')).toContainText('cork lid');
    await page.screenshot({ path: testInfo.outputPath('product-demo-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: /maximum temperature rating of the Aster box/ }).click();
    await expect(checked).toContainText('Check inconclusive');
    await expect(checked.locator('.automatic-check-answer')).toContainText('could not confirm');
    await page.getByRole('button', { name: 'Quality · time · allowance', exact: true }).click();
    await expect(page.locator('.proof-resources')).toContainText('Provider attempts / recorded operations');
    const response = await request.get(`${origin}/api/workspace/proof/export`), proof = await response.json();
    expect(response.ok()).toBeTruthy(); expect(proof.cohort.planned).toBe(2); expect(proof.paired).toMatchObject({ wins: 1, unresolved: 1 }); expect(proof.accounting.calls).toBe(0);
    await page.locator('.ask-policy>summary').click();
    await expect(page.locator('.ask-policy-decision')).toContainText('rejected');
    await expect(page.locator('.ask-policy-decision')).toContainText('13/13');
    await page.getByText('Replay one recorded live answer', { exact: false }).click();
    await expect(page.locator('.historical-replay')).toContainText('Evidence is conflicting.');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath('product-demo-mobile.png'), fullPage: true });
  } finally { await demo.server.shutdown(); demo.store.close(); rmSync(directory, { recursive: true, force: true }); }
});
