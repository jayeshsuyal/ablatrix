import { expect, test } from '@playwright/test';
import type { LoopOverview } from '../server/loop-types.ts';

const overview: LoopOverview = {
  products: [], cases: [], policies: [], runs: [], batches: [], validations: [], externalValidationCases: [], finals: [], reviewCards: {}, events: [],
  activePolicyIds: { fixture: 'fixture-baseline', live: 'live-baseline' },
  corpus: { version: 'synthetic-telemetry-test', source: 'Synthetic browser test', license: 'Synthetic', passageCount: 0 },
  readiness: { ready: false, reason: 'Synthetic browser test; no model calls.' }, busy: false,
};
const disabledStatus = {
  enabled: false, ready: false, busy: false, reason: 'Langfuse sync is disabled.', destination: null,
  deliveredTraces: 0, deliveredScores: 0, uncertain: 0, rejected: 0, lastSyncAt: null as string | null,
};

test('Langfuse status loads only in History and unconfigured sync stays disabled', async ({ page }) => {
  const requests: string[] = [];
  // All experiment and telemetry requests are synthetic; nothing reaches an external project.
  await page.route('**/api/loop{,/**}', async route => {
    const path = new URL(route.request().url()).pathname;
    requests.push(`${route.request().method()} ${path}`);
    if (path === '/api/loop') return route.fulfill({ json: overview });
    if (path === '/api/loop/telemetry') return route.fulfill({ json: disabledStatus });
    return route.abort();
  });
  await page.goto('/loop');
  await expect(page.getByRole('heading', { name: 'Evidence to decision' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Langfuse integration' })).toHaveCount(0);
  expect(requests).not.toContain('GET /api/loop/telemetry');
  await page.getByRole('navigation', { name: 'Feedback loop stages' }).getByRole('button', { name: 'History' }).click();
  const card = page.getByRole('region', { name: 'Langfuse integration' });
  await expect(card.getByText('Not connected', { exact: true })).toBeVisible();
  await expect(card).toContainText('Configure the Langfuse project on this server to enable sync.');
  await expect(card.getByRole('button', { name: 'Sync to Langfuse', exact: true })).toBeDisabled();
  expect(requests.filter(value => value === 'GET /api/loop/telemetry')).toHaveLength(1);
  expect(requests.some(value => value.startsWith('POST'))).toBe(false);
});

test('explicit Langfuse sync displays accepted counts and preserves uncertain delivery after a failure', async ({ page }) => {
  let status = { ...disabledStatus, enabled: true, ready: true, reason: 'Ready for explicit sync.', destination: 'https://synthetic-project.example.test' };
  let posts = 0;
  const unexpectedRequests: string[] = [];
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.route('**/api/loop{,/**}', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/loop' && request.method() === 'GET') return route.fulfill({ json: overview });
    if (path === '/api/loop/telemetry' && request.method() === 'GET') return route.fulfill({ json: status });
    if (path === '/api/loop/telemetry/sync' && request.method() === 'POST') {
      expect(request.postDataJSON()).toEqual({});
      posts += 1;
      if (posts === 1) {
        status = { ...status, deliveredTraces: 10, deliveredScores: 6, reason: 'Saved events accepted by ingestion.', lastSyncAt: '2026-09-24T12:00:00.000Z' };
        return route.fulfill({ json: status });
      }
      status = { ...status, uncertain: 1, rejected: 1, reason: 'Some events need attention.' };
      return route.fulfill({ status: 503, json: { error: 'Synthetic sync interruption; delivery could not be confirmed.' } });
    }
    unexpectedRequests.push(`${request.method()} ${path}`);
    return route.abort();
  });
  await page.goto('/loop');
  await page.getByRole('navigation', { name: 'Feedback loop stages' }).getByRole('button', { name: 'History' }).click();
  const card = page.getByRole('region', { name: 'Langfuse integration' });
  const sync = card.getByRole('button', { name: 'Sync to Langfuse', exact: true });
  await expect(sync).toBeEnabled();
  expect(posts).toBe(0);
  await expect(card).toContainText('AI review drafts are excluded. Sync makes no new model calls.');
  await sync.click();
  await expect(card.getByRole('status')).toHaveText('Saved events accepted by ingestion.');
  await expect(card.locator('dl > div').filter({ hasText: 'Accepted traces' }).locator('dd')).toHaveText('10');
  await expect(card.locator('dl > div').filter({ hasText: 'Accepted scores' }).locator('dd')).toHaveText('6');
  await expect(card).toContainText('records may take time to appear in Langfuse');
  expect(posts).toBe(1);
  await sync.click();
  await expect(card.getByRole('alert')).toHaveText('Synthetic sync interruption; delivery could not be confirmed.');
  await expect(card.locator('dl > div').filter({ hasText: 'Unconfirmed events' }).locator('dd')).toHaveText('1');
  await expect(card.locator('dl > div').filter({ hasText: 'Rejected events' }).locator('dd')).toHaveText('1');
  await expect(sync).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(posts).toBe(2);
  expect(unexpectedRequests).toEqual([]);
  expect(browserErrors).toEqual([]);
});

test('Langfuse sync waits for the active experiment', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/loop{,/**}', async route => {
    const path = new URL(route.request().url()).pathname;
    requests.push(`${route.request().method()} ${path}`);
    if (path === '/api/loop') return route.fulfill({ json: { ...overview, busy: true } });
    if (path === '/api/loop/telemetry') return route.fulfill({ json: { ...disabledStatus, enabled: true, ready: true } });
    return route.abort();
  });
  await page.goto('/loop');
  await page.getByRole('navigation', { name: 'Feedback loop stages' }).getByRole('button', { name: 'History' }).click();
  const card = page.getByRole('region', { name: 'Langfuse integration' });
  await expect(card.getByText('Ready to sync', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Sync to Langfuse', exact: true })).toBeDisabled();
  await expect(card).toContainText('Available when the experiment finishes.');
  expect(requests.some(value => value.startsWith('POST'))).toBe(false);
});
