import { expect, test } from '@playwright/test';
import type { PilotOverview, PilotPublicRun, PilotReviewCard } from '../server/pilot-types.ts';

test('pilot demo completes, stays synthetic, exports, and survives reload on mobile', async ({ page, request }) => {
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto('/pilot');
  await expect(page.getByRole('heading', { name: 'Does the extra search earn its keep?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run live experiment' })).toBeDisabled();
  await expect(page.locator('#pilot-live-reason')).not.toBeEmpty();
  await page.getByRole('button', { name: 'Run local demo' }).click();
  await expect(page.getByText('32/32 runs complete')).toBeVisible();
  await expect(page.locator('.pilot-verdict')).toContainText('Synthetic demo');
  await expect(page.locator('.pilot-verdict')).toContainText('does not establish a quality improvement or savings');
  await expect(page.locator('.pilot-comparison-table tbody tr')).toHaveCount(8);
  await expect(page.locator('.pilot-scorecard')).toContainText('No measured latency reduction');
  await expect(page.locator('.pilot-scorecard')).toContainText('No provider calls made');

  const exportUrl = await page.getByRole('link', { name: 'Export report' }).getAttribute('href');
  const exported = await request.get(exportUrl!);
  expect(exported.ok()).toBeTruthy();
  expect(exported.headers()['content-disposition']).toContain('attachment');
  const artifact = await exported.json();
  expect(artifact.mode).toBe('fixture');
  expect(artifact.attempts).toHaveLength(32);
  expect(artifact.summary.decision).toBe('inconclusive');
  expect(artifact.summary.baseline.medianMs).toBeNull();
  expect(artifact.summary.candidate.costUsd).toBeNull();
  expect(artifact.attempts.every((attempt: { review: { kind: string } }) => attempt.review.kind === 'synthetic')).toBeTruthy();
  expect(artifact.patch.before).toEqual({ model: 'gpt-luna', searchEnabled: true });
  expect(artifact.patch.after).toEqual({ model: 'gpt-luna', searchEnabled: false });

  const reviewResponse = await request.get(exportUrl!.replace('/export', '/review'));
  const review = await reviewResponse.json();
  expect(review.cards).toHaveLength(32);
  expect(review.cards.every((card: object) => !('arm' in card) && !('costUsd' in card) && !('durationMs' in card))).toBeTruthy();

  await page.reload();
  await expect(page.getByText('32/32 runs complete')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Export report' })).toHaveAttribute('href', exportUrl!);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Run local demo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run live experiment' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await expect(page.locator('.pilot-comparison-table tbody tr').first().locator('td').nth(1)).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test('blind review requires explicit answers and sends reference validation', async ({ page, request }) => {
  // Reuse the synthetic artifact as a browser fixture; this test never starts a live run.
  const created = await request.post('/api/pilot/runs', { data: { mode: 'fixture' } });
  const started = await created.json() as PilotPublicRun;
  await expect.poll(async () => (await (await request.get(`/api/pilot/runs/${started.id}`)).json()).status).toBe('completed');
  const overview = await (await request.get('/api/pilot')).json() as PilotOverview;
  const completed = overview.runs.find(run => run.id === started.id)!;
  const review = await (await request.get(`/api/pilot/runs/${started.id}/review`)).json() as { cards: PilotReviewCard[] };
  const anonymous = { ...review.cards[0], review: null };
  const pending: PilotPublicRun = { ...completed, mode: 'live', reviewComplete: false, reviewCount: 0, reviewsNeeded: 1, rows: [], exportReady: false, reason: 'Blind review is needed.' };
  let submitted: Record<string, unknown> | null = null;

  await page.route('**/api/pilot', route => route.fulfill({ json: { ...overview, runs: [pending] } }));
  await page.route(`**/api/pilot/runs/${started.id}/review`, async route => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON();
      await route.fulfill({ json: { ...completed, mode: 'live', reviewCount: 1, reviewsNeeded: 1, reviewComplete: true } });
    } else {
      await route.fulfill({ json: { cards: submitted ? [] : [anonymous] } });
    }
  });
  await page.goto('/pilot');
  await expect(page.getByRole('heading', { name: 'Judge the answer before the workflow.' })).toBeVisible();
  await expect(page.locator('.pilot-review-answer')).toContainText(anonymous.answer.answer);
  await expect(page.locator('.pilot-comparison-table')).toHaveCount(0);
  const submit = page.getByRole('button', { name: 'Save & review next' });
  await expect(submit).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'I checked the reference answer against the excerpt' })).not.toBeChecked();
  await page.locator('fieldset').filter({ hasText: 'Is the answer correct?' }).getByLabel('Yes').check();
  await expect(submit).toBeDisabled();
  await page.locator('fieldset').filter({ hasText: 'Does the cited evidence support it?' }).getByLabel('Yes').check();
  await page.getByRole('checkbox', { name: 'I checked the reference answer against the excerpt' }).check();
  await page.getByPlaceholder('Any missing facts or unsupported claims…').fill('The reference and citation match the excerpt.');
  await submit.click();
  await expect(page.getByRole('heading', { name: 'Judge the answer before the workflow.' })).toHaveCount(0);
  expect(submitted).toEqual({ cardId: anonymous.id, correct: true, supported: true, referenceCorrect: true, notes: 'The reference and citation match the excerpt.' });
  await expect(page.locator('.pilot-comparison-table tbody tr')).toHaveCount(8);
});
