import { expect, test } from '@playwright/test';
import { createServer, request as proxyRequest, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createApp } from '../server/app.ts';
import { DemoAccess, type DemoAccessConfig } from '../server/demo-access.ts';
import { ProductWorkspace } from '../server/product-workspace.ts';
import { SyntheticAnswerProvider } from '../server/synthetic-answer-provider.ts';
import { syntheticRetriever } from '../server/hosted-demo.ts';
import { RunStore } from '../server/store.ts';
import { PilotRunner, PilotStore } from '../server/pilot.ts';

// Test-only identity gateway. The real backend still verifies signatures, configured
// Host/Origin, roles and synthetic-only execution. No production auth bypass exists.
let directory: string, origin: string, app: ReturnType<typeof createApp>, gateway: Server, store: RunStore;
const config: DemoAccessConfig = {
  origin: 'https://browser-demo.example.test', issuer: 'https://browser-identity.example.test',
  audience: 'browser-demo', jwksUrl: 'https://browser-identity.example.test/certs',
  members: ['viewer', 'reviewer', 'operator'].map(role => ({ subject: `test-${role}`, role: role as 'viewer' | 'reviewer' | 'operator', name: `Browser ${role}` }))
};
const sourceText = 'The synthetic jacket has a nylon shell and a detachable hood.';
const addedText = 'The synthetic jacket uses taped seams and a waterproof nylon shell.';

test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'ablatrix-hosted-browser-'));
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const demoAccess = new DemoAccess(config, { keyResolver: createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'browser-test', alg: 'RS256' }] }) });
  const tokens = new Map(await Promise.all(config.members.map(async member => [member.role, await new SignJWT({ sub: member.subject }).setIssuer(config.issuer).setAudience(config.audience).setIssuedAt().setExpirationTime('10m').setProtectedHeader({ alg: 'RS256', kid: 'browser-test' }).sign(privateKey)] as const)));
  const provider = new SyntheticAnswerProvider(join(directory, 'receipts.sqlite'));
  const workspace = new ProductWorkspace(join(directory, 'workspace.sqlite'), provider, syntheticRetriever);
  store = new RunStore(join(directory, 'runs.sqlite'));
  app = createApp(store, 'fixture', undefined, new PilotRunner(new PilotStore(join(directory, 'pilot.sqlite'))), undefined, undefined, workspace, undefined, true, {
    demoAccess, answerProvider: provider, reviewDbPath: join(directory, 'reviews.sqlite'), comparisonDbPath: join(directory, 'comparisons.sqlite')
  });
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
  const backendPort = (app.address() as { port: number }).port;
  gateway = createServer((req, res) => {
    const role = /(?:^|;\s*)test-role=(viewer|reviewer|operator)(?:;|$)/.exec(req.headers.cookie ?? '')?.[1] ?? 'viewer';
    const forwarded = proxyRequest({ hostname: '127.0.0.1', port: backendPort, path: req.url, method: req.method, headers: {
      ...req.headers, host: new URL(config.origin).host, origin: config.origin, 'cf-access-jwt-assertion': tokens.get(role as 'viewer')!
    } }, response => { res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res); });
    forwarded.on('error', error => { res.writeHead(502); res.end(error.message); });
    req.pipe(forwarded);
  });
  await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(gateway.address() as { port: number }).port}`;
});

test.afterAll(async () => {
  if (gateway) await new Promise<void>((resolve, reject) => gateway.close(error => error ? reject(error) : resolve()));
  await app?.shutdown(); store?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test('invited roles run a clearly synthetic answer, background correction, human decision and export', async ({ page, context, browser }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.addCookies([{ name: 'test-role', value: 'operator', url: origin }]);
  await page.goto(`${origin}/ask`);
  await expect(page.locator('.demo-session-banner')).toContainText('Browser operator');
  await expect(page.getByRole('button', { name: 'Generate cited answer' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Product name' }).fill('Synthetic browser jacket');
  await page.getByRole('textbox', { name: 'Evidence text', exact: true }).fill(sourceText);
  await page.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Product', exact: true })).not.toHaveValue('');
  await page.getByRole('textbox', { name: 'Question', exact: true }).fill('What material is the synthetic jacket shell?');
  const questionResponse = page.waitForResponse(response => response.url().endsWith('/api/workspace/questions') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Generate synthetic answer', exact: true }).click();
  const saved = await (await questionResponse).json();
  expect(saved).toMatchObject({ mode: 'synthetic', model: 'synthetic-fixture', status: 'completed', usage: null });
  await expect(page.locator('.ask-answer')).toContainText('SYNTHETIC draft');
  await expect(page.locator('.ask-answer')).toContainText('no model tokens or charges');
  await page.getByRole('link', { name: 'Review this answer' }).click();
  await expect(page.locator('.pr-detail-head')).toContainText('SYNTHETIC');
  const reviewPath = `/review?answer=workspace-${saved.id}`;
  const revision = page.getByRole('form', { name: 'Request answer revision' });
  await expect(revision.getByRole('textbox', { name: 'Revision reviewer name' })).toHaveJSProperty('readOnly', true);
  await expect(revision.getByRole('textbox', { name: 'Revision reviewer name' })).toHaveValue(/^subject:[a-f0-9]{64}$/);
  await revision.getByRole('textbox', { name: 'What is wrong or missing?' }).fill('Include the missing waterproof shell and taped seam details.');
  await revision.getByText('Add missing information or a source', { exact: true }).click();
  await revision.getByRole('textbox', { name: 'New source label', exact: true }).fill('Synthetic waterproof specification');
  await revision.getByRole('textbox', { name: 'New source text', exact: true }).fill(addedText);
  await revision.getByRole('button', { name: 'Investigate and revise', exact: true }).click();
  await expect(page.locator('.pr-compare')).toContainText('SYNTHETIC revision', { timeout: 10_000 });
  await expect(page.locator('.pr-compare')).toContainText(addedText);
  await expect(page.locator('.pr-revision')).toContainText('excluded from live quality claims');
  await page.screenshot({ path: testInfo.outputPath('hosted-synthetic-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('hosted-synthetic-mobile.png'), fullPage: true });

  const reviewerContext = await browser.newContext();
  const viewerContext = await browser.newContext();
  try {
    await reviewerContext.addCookies([{ name: 'test-role', value: 'reviewer', url: origin }]);
    const reviewer = await reviewerContext.newPage();
    await reviewer.goto(`${origin}${reviewPath}`);
    await expect(reviewer.getByRole('form', { name: 'Request answer revision' })).toHaveCount(0);
    const decision = reviewer.getByRole('form', { name: 'Review answer decision' });
    await expect(decision.getByRole('textbox', { name: 'Revision reviewer name' })).toHaveJSProperty('readOnly', true);
    for (const checkbox of await decision.getByRole('checkbox').all()) await checkbox.check();
    await decision.getByRole('textbox', { name: 'Review note' }).fill('Checked these scripted excerpts in the synthetic demo.');
    await decision.getByRole('button', { name: 'Accept revision', exact: true }).click();
    await expect(reviewer.locator('.pr-detail-head')).toContainText('ACCEPTED');
    await reviewer.reload();
    await expect(reviewer.locator('.pr-detail-head')).toContainText('ACCEPTED');
    const downloaded = reviewer.waitForEvent('download');
    await reviewer.getByRole('link', { name: 'Export workspace review history' }).click();
    const file = await downloaded;
    const exported = JSON.parse(readFileSync((await file.path())!, 'utf8'));
    expect(exported).toMatchObject({ providerMode: 'synthetic', scope: 'workspace' });
    expect(exported.cases[0]).toMatchObject({ mode: 'synthetic', qualityClaimEligible: false });
    expect(exported.cases[0].versions).toHaveLength(2);
    expect(exported.cases[0].events.at(-1)).toMatchObject({ kind: 'accept', mode: 'synthetic', reviewKind: 'human', qualityClaimEligible: false });
    expect(exported.cases[0].jobs[0].usage).toMatchObject({ executionMode: 'synthetic', accounting: 'no_provider_call', planningAllowanceUsd: null });

    await viewerContext.addCookies([{ name: 'test-role', value: 'viewer', url: origin }]);
    const viewer = await viewerContext.newPage();
    await viewer.goto(`${origin}/ask`);
    await expect(viewer.getByRole('button', { name: 'Save product', exact: true })).toBeDisabled();
    await expect(viewer.getByRole('button', { name: 'Generate synthetic answer', exact: true })).toBeDisabled();
    await expect(viewer.getByRole('button', { name: 'Preview evidence', exact: true })).toBeDisabled();
    await viewer.goto(`${origin}${reviewPath}`);
    await expect(viewer.locator('.pr-compare')).toContainText('SYNTHETIC revision');
    await expect(viewer.getByRole('form', { name: 'Review answer decision' })).toHaveCount(0);
    await expect(viewer.getByRole('form', { name: 'Request answer revision' })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await reviewerContext.close(); await viewerContext.close(); }
});
