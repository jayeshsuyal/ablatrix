import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalDemo } from '../server/local-demo.ts';
import { buildWorkspaceObservabilityPreview } from '../server/workspace-observability-v1.ts';
import { buildWorkspaceProof } from '../server/workspace-proof.ts';

async function startDemo() {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-trace-browser-'));
  const demo = await createLocalDemo(directory);
  await new Promise<void>(resolve => demo.server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${(demo.server.address() as { port: number }).port}`,
    async close() { await demo.server.shutdown(); demo.store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

async function waitForSavedWorkspace(page: import('@playwright/test').Page) {
  // Session, selected answer and its automatic check hydrate separately. Their
  // refresh key legitimately aborts a trace read opened during startup.
  await expect(page.getByRole('region', { name: 'Automatic source check' }).getByRole('heading')).toHaveText('Repaired · synthetic check passed');
}

test('saved workflow traces are lazy, inspectable, metadata-only and read-only on desktop and mobile', async ({ page, request }, testInfo) => {
  const demo = await startDemo();
  const mutations: string[] = [], remote: string[] = [], reads: string[] = [];
  page.on('request', item => {
    if (item.method() !== 'GET') mutations.push(item.url());
    if (!item.url().startsWith(demo.origin)) remote.push(item.url());
    if (new URL(item.url()).pathname.startsWith('/api/workspace/observability')) reads.push(item.url());
  });
  try {
    const before = await (await request.get(`${demo.origin}/api/workspace/proof`)).json();
    await page.goto(demo.origin);
    await waitForSavedWorkspace(page);
    await expect(page.getByRole('button', { name: 'Workflow trace', exact: true })).toBeVisible();
    expect(reads).toHaveLength(0);
    await page.getByRole('button', { name: 'Workflow trace', exact: true }).click();
    const trace = page.getByRole('region', { name: 'Saved workflow traces', exact: true });
    await expect(trace).toHaveAttribute('aria-busy', 'false');
    await expect(trace).toContainText('Local preview · not uploaded');
    await expect(trace.locator('.trace-summary')).toContainText('2Workflows');
    await expect(trace.locator('.trace-summary')).toContainText('6Recorded stages');
    await trace.getByRole('button', { name: /Case \d+ Scripted synthetic Unresolved/ }).click();
    const case1 = trace.getByRole('region', { name: /^Case \d+ workflow$/ });
    await expect(case1.getByRole('heading', { name: 'Original generation', exact: true })).toBeVisible();
    await expect(case1).toContainText('Snapshot; stage timing unavailable');
    await expect(case1.locator('.trace-timeline > li')).toHaveCount(2);
    // The uncertain stop remains inspectable alongside the repaired workflow.
    await case1.getByText('Inspect recorded check', { exact: true }).first().click();
    await expect(case1).toContainText('Scripted synthetic check');
    await expect(case1).toContainText('calibration not measured');
    await page.locator('#proof').screenshot({ path: testInfo.outputPath('workflow-trace-desktop.png') });
    await trace.getByRole('button', { name: /Case \d+ Scripted synthetic Improved/ }).click();
    const case2 = trace.getByRole('region', { name: /^Case \d+ workflow$/ });
    for (const name of ['Original generation', 'Check original', 'Repair answer', 'Recheck repair']) await expect(case2.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(case2.locator('.trace-timeline > li')).toHaveCount(4);
    const downloadPromise = page.waitForEvent('download');
    await trace.getByRole('link', { name: 'Download trace metadata' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('ablatrix-workspace-observability-preview.json');
    const payload = readFileSync((await download.path())!, 'utf8'), preview = JSON.parse(payload);
    expect(preview).toMatchObject({ format: 'ablatrix-workspace-observability-preview-v1', privacy: 'metadata_only', providerCalls: 0, exported: false, sourceProofSha256: before.sha256 });
    expect(preview.otlp.resourceSpans[0].scopeSpans[0].spans).toHaveLength(8);
    for (const text of ['Thistle', 'Aster', 'eight cups', 'six cups', 'cork lid', 'maximum temperature']) expect(payload).not.toContain(text);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(case2.getByRole('heading', { name: 'Repair answer', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.locator('#proof').screenshot({ path: testInfo.outputPath('workflow-trace-mobile.png') });
    const after = await (await request.get(`${demo.origin}/api/workspace/proof`)).json();
    expect(after).toEqual(before);
    expect(mutations).toEqual([]); expect(remote).toEqual([]);
    expect(reads).toHaveLength(2);
  } finally { await demo.close(); }
});

test('malformed trace responses show a safe error and retry only the local read', async ({ page }) => {
  const demo = await startDemo();
  let attempts = 0;
  let malformed = true;
  const sensitive = 'PRIVATE-TRACE-ERROR-user@example.invalid';
  const methods: string[] = [];
  await page.route('**/api/workspace/observability', async route => {
    attempts++; methods.push(route.request().method());
    if (malformed) return route.fulfill({ status: 200, contentType: 'application/json', body: sensitive });
    await route.continue();
  });
  try {
    await page.goto(demo.origin);
    await waitForSavedWorkspace(page);
    await page.getByRole('button', { name: 'Workflow trace', exact: true }).click();
    const trace = page.getByRole('region', { name: 'Saved workflow traces', exact: true });
    await expect(trace.getByRole('alert')).toContainText('Saved workflow traces are unavailable.');
    await expect(trace).not.toContainText(sensitive);
    const beforeRetry = attempts;
    malformed = false;
    await trace.getByRole('button', { name: 'Retry inspection' }).click();
    await expect(trace.getByRole('navigation', { name: 'Select a saved workflow' })).toBeVisible();
    expect(attempts).toBe(beforeRetry + 1); expect(methods.every(method => method === 'GET')).toBeTruthy();
  } finally { await demo.close(); }
});

test('empty trace remains accessible without a paired cohort', async ({ page }) => {
  const demo = await startDemo();
  const proof = buildWorkspaceProof([], [], () => undefined);
  const preview = buildWorkspaceObservabilityPreview(proof);
  let reads = 0;
  await page.route('**/api/workspace/proof', route => route.fulfill({ json: proof }));
  await page.route('**/api/workspace/observability', route => { reads++; return route.fulfill({ json: preview }); });
  try {
    await page.goto(demo.origin);
    await waitForSavedWorkspace(page);
    await expect(page.locator('.proof-empty')).toBeVisible();
    await page.getByRole('button', { name: 'Workflow trace', exact: true }).click();
    const trace = page.getByRole('region', { name: 'Saved workflow traces', exact: true });
    await expect(trace).toContainText('No saved workflow traces yet.');
    await trace.getByRole('button', { name: 'Refresh saved traces' }).click();
    await expect(trace).toHaveAttribute('aria-busy', 'false');
    expect(reads).toBe(2);
  } finally { await demo.close(); }
});
