import { expect, test, type Locator } from '@playwright/test';
import type { ContextComparisonDetail, ContextComparisonReview } from '../server/context-comparison.ts';

async function assess(form: Locator, label: 'A' | 'B', negative = false) {
  await form.getByRole('combobox', { name: `Answer ${label} correctness`, exact: true }).selectOption(negative ? 'incorrect' : 'correct');
  await form.getByRole('combobox', { name: `Answer ${label} claim support`, exact: true }).selectOption(negative ? 'unsupported' : 'supported');
  await form.getByRole('combobox', { name: `Answer ${label} adequacy`, exact: true }).selectOption(negative ? 'inadequate' : 'adequate');
  if (negative) await form.getByRole('textbox', { name: `Answer ${label} review note`, exact: true }).fill('The supplied customer answer concerns a different model.');
}

test('synthetic setup makes no provider calls and keeps frozen source reviews separate from quality results', async ({ page }) => {
  const errors: string[] = [];
  const mutations: { url: string; payload: unknown }[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST') mutations.push({ url: new URL(request.url()).pathname, payload: request.postDataJSON() }); });
  await page.goto('/compare');
  await expect(page.getByRole('heading', { name: 'Compare the same question.' })).toBeVisible();
  await page.getByRole('button', { name: 'Load synthetic example (no model calls)', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic context-preservation rehearsal' })).toBeVisible();
  const detail = await (await page.request.get('/api/context-comparisons/synthetic-context-demo-v1')).json() as ContextComparisonDetail;
  expect(detail.mode).toBe('fixture');
  await expect(page.locator('.cc-progress')).toContainText(`0/${detail.reviewableAnswers} answers reviewed`);
  const sources = page.getByRole('region', { name: 'Frozen source context' });
  await expect(sources).toContainText('Original customer question:');
  await expect(sources).toContainText(detail.cases[0].sources[0].originalQuestion!);
  await expect(page.getByRole('region', { name: 'Comparison results' })).toContainText('Results wait for the reviews.');
  await expect(page.getByRole('button', { name: 'Export reviewed result', exact: true })).toBeDisabled();
  expect((await page.request.get('/api/context-comparisons/synthetic-context-demo-v1/export')).ok()).toBe(false);
  let savedCount = 0;
  for (const item of detail.cases) {
    await page.getByRole('complementary', { name: 'Comparison pair queue' }).getByRole('button').filter({ hasText: item.question }).click();
    await page.getByRole('textbox', { name: 'Synthetic reviewer label' }).fill('Synthetic browser reviewer');
    for (const label of ['A', 'B'] as const) {
      const form = page.getByRole('form', { name: `Review answer ${label}`, exact: true });
      const answer = item.answers.find(answer => answer.label === label)!;
      await assess(form, label, answer.answer!.answer.includes('this replacement fits XY-200.'));
      await form.getByRole('checkbox').check();
      if (label === 'A') {
        await expect(form.getByRole('button', { name: `Save synthetic review for ${label}`, exact: true })).toBeDisabled();
        for (const source of item.sources) await sources.getByRole('checkbox', { name: `Checked source: ${source.label}`, exact: true }).check();
      }
      await form.getByRole('button', { name: `Save synthetic review for ${label}`, exact: true }).click();
      await expect(page.getByRole('region', { name: `Saved answer ${label} review`, exact: true })).toContainText('Synthetic review saved');
      const posted = mutations.filter(entry => entry.url.endsWith('/reviews')).at(-1)!.payload as Record<string, unknown>;
      expect(posted).toMatchObject({ manifestSha256: detail.manifestSha256, caseId: item.id, versionId: answer.versionId, checkedSourceShas: item.sources.map(source => source.sha256), referenceChecked: true });
      expect(posted).not.toHaveProperty('independentReview');
      savedCount++;
      await expect(page.locator('.cc-progress')).toContainText(`${savedCount}/${detail.reviewableAnswers} answers reviewed`);
      if (savedCount < detail.reviewableAnswers) await expect(page.getByRole('region', { name: 'Comparison results' })).toContainText('Results wait for the reviews.');
    }
  }
  const results = page.getByRole('region', { name: 'Comparison results' });
  await expect(results).toContainText('Practice packet complete.');
  await expect(results).toContainText('do not measure model quality');
  await expect(page.getByLabel('Paired quality outcomes')).toHaveCount(0);
  const first = await page.request.get('/api/context-comparisons/synthetic-context-demo-v1/export');
  const firstText = await first.text();
  const exported = JSON.parse(firstText);
  expect(exported.report.quality).toBeNull();
  expect(exported.reviews.every((review: ContextComparisonReview) => review.kind === 'synthetic')).toBe(true);
  expect(await (await page.request.get('/api/context-comparisons/synthetic-context-demo-v1/export')).text()).toBe(firstText);
  expect(mutations.every(item => item.url.startsWith('/api/context-comparisons/'))).toBe(true);
  await page.reload();
  await expect(page.locator('.cc-progress')).toContainText(`${detail.reviewableAnswers}/${detail.reviewableAnswers} answers reviewed`);
  await expect(results).toContainText('Practice packet complete.');
  await page.setViewportSize({ width: 360, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});

function simulatedLiveDetail(): ContextComparisonDetail {
  const source = { id: 'browser-source', label: 'Synthetic source for browser test', text: 'This synthetic part fits model AB-100 only.', originalQuestion: 'Does this synthetic part fit model AB-100?', sha256: 'b'.repeat(64), reference: 'Synthetic browser fixture' };
  return { id: 'browser-live-protocol', title: 'Synthetic browser simulation of live review', mode: 'live', manifestSha256: 'a'.repeat(64), caseCount: 1, reviewedAnswers: 0, reviewableAnswers: 2, attempts: { completed: 2, failed: 0, uncertain: 0 }, reportAvailable: false, qualityStatus: 'pending', hypothesis: 'preserve_original_customer_question', provenance: { kind: 'imported_live', note: 'Synthetic browser responses exercise live-review controls; no provider call occurs.', sourcePacketSha256: null }, cases: [{ id: 'browser-case', product: { id: 'browser-product', title: 'Synthetic browser product' }, question: 'Does this synthetic part fit AB-100?', sources: [source], answers: (['A', 'B'] as const).map((label, index) => ({ label, versionId: `v-${String(index + 1).repeat(32)}`, status: 'completed', answer: { status: 'answered', answer: `SYNTHETIC browser answer ${label}: it fits AB-100 only.`, citations: [{ passageId: source.id, quote: 'fits model AB-100 only' }] }, citationCheck: { matching: 1, total: 1, answeredHasCitation: true }, review: null })) }] };
}

test('live review requires explicit independent source checks before revealing paired results', async ({ page }) => {
  const detail = simulatedLiveDetail();
  const posts: Record<string, unknown>[] = [];
  let reports = 0;
  await page.route(/\/api\/context-comparisons(?:\/[^?]*)?$/, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/reviews')) {
      const payload = route.request().postDataJSON();
      posts.push(payload);
      const answer = detail.cases[0].answers.find(answer => answer.versionId === payload.versionId)!;
      answer.review = { ...payload, kind: 'human', createdAt: '2026-10-09T00:00:00.000Z' };
      detail.reviewedAnswers++;
      detail.reportAvailable = detail.reviewedAnswers === 2;
      detail.qualityStatus = detail.reportAvailable ? 'ready' : 'pending';
      return route.fulfill({ json: answer.review });
    }
    if (path.endsWith('/report')) {
      reports++;
      const counts = { correct: 1, supported: 1, adequate: 1, good: 1 };
      const citations = { matching: 1, total: 1, completed: 1, answeredWithCitation: 1 };
      return route.fulfill({ json: { ...detail, status: 'complete', quality: { totalPairs: 1, eligiblePairs: 1, uncertainPairs: 0, baseline: counts, candidate: counts, wins: 0, losses: 0, ties: 1, regressions: 0, interval95: [0, 0], verdict: 'inconclusive' }, citationMatching: { baseline: citations, candidate: citations }, timing: { definition: 'Synthetic browser timing; no provider calls.', baselineMedianMs: 1, candidateMedianMs: 1 }, billedCostUsd: null, limitations: ['Synthetic browser simulation; not a measured quality result.'], cases: [{ id: detail.cases[0].id, product: detail.cases[0].product, question: detail.cases[0].question, arms: { baseline: detail.cases[0].answers[0], candidate: detail.cases[0].answers[1] } }] } });
    }
    return route.fulfill({ json: path === '/api/context-comparisons' ? { comparisons: [detail] } : detail });
  });
  await page.goto(`/compare?packet=${detail.id}`);
  await expect(page.locator('.cc-progress')).toContainText('0/2 answers reviewed');
  await expect(page.getByText('Withheld during blind review; included in the reviewed export.')).toBeHidden();
  expect(reports).toBe(0);
  await page.getByRole('textbox', { name: 'Reviewer name', exact: true }).fill('Synthetic human-control tester');
  await page.getByRole('checkbox', { name: 'Checked source: Synthetic source for browser test' }).check();
  for (const label of ['A', 'B'] as const) {
    const form = page.getByRole('form', { name: `Review answer ${label}`, exact: true });
    await assess(form, label);
    const save = form.getByRole('button', { name: `Save human review for ${label}`, exact: true });
    await expect(save).toBeDisabled();
    await form.getByRole('checkbox', { name: `I personally checked the selected sources for answer ${label} without AI review suggestions.`, exact: true }).check();
    await save.click();
    await expect(page.getByRole('region', { name: `Saved answer ${label} review` })).toContainText('Human review saved');
    expect(posts.at(-1)).toMatchObject({ manifestSha256: detail.manifestSha256, caseId: 'browser-case', versionId: detail.cases[0].answers.find(answer => answer.label === label)!.versionId, referenceChecked: true, independentReview: true });
    if (label === 'A') { expect(reports).toBe(0); await expect(page.getByLabel('Paired quality outcomes')).toHaveCount(0); }
  }
  await expect(page.getByLabel('Paired quality outcomes')).toContainText('Candidate wins');
  await expect(page.getByRole('region', { name: 'Comparison results' })).toContainText('Verdict: inconclusive');
  expect(reports).toBe(1);
  await page.setViewportSize({ width: 360, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test('a late review refresh cannot replace the completed packet with an older pending view', async ({ page }) => {
  const detail = { ...simulatedLiveDetail(), mode: 'fixture' as const, provenance: { kind: 'synthetic_fixture' as const, note: 'Synthetic browser refresh race; no provider calls.', sourcePacketSha256: null } };
  let holdFirstReviewRefresh = true;
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  let held!: () => void;
  const refreshHeld = new Promise<void>(resolve => { held = resolve; });
  let finished!: () => void;
  const lateFinished = new Promise<void>(resolve => { finished = resolve; });
  await page.route(/\/api\/context-comparisons(?:\/[^?]*)?$/, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/reviews')) {
      const payload = route.request().postDataJSON();
      const answer = detail.cases[0].answers.find(answer => answer.versionId === payload.versionId)!;
      answer.review = { ...payload, kind: 'synthetic', createdAt: '2026-10-09T00:00:00.000Z' };
      detail.reviewedAnswers++;
      detail.reportAvailable = detail.reviewedAnswers === 2;
      return route.fulfill({ json: answer.review });
    }
    if (path.endsWith('/report')) return route.fulfill({ json: { ...detail, status: 'synthetic_only', quality: null, citationMatching: { baseline: { matching: 1, total: 1 }, candidate: { matching: 1, total: 1 } }, timing: { definition: 'Synthetic browser timing.' }, billedCostUsd: null, limitations: ['Synthetic responses only.'], cases: [{ ...detail.cases[0], arms: { baseline: detail.cases[0].answers[0], candidate: detail.cases[0].answers[1] } }] } });
    if (path === '/api/context-comparisons') return route.fulfill({ json: { comparisons: [detail] } });
    if (detail.reviewedAnswers === 1 && holdFirstReviewRefresh) {
      holdFirstReviewRefresh = false;
      const stale = JSON.stringify(detail);
      held(); await released;
      await route.fulfill({ contentType: 'application/json', body: stale });
      finished(); return;
    }
    return route.fulfill({ json: detail });
  });
  await page.goto(`/compare?packet=${detail.id}`);
  await page.getByRole('textbox', { name: 'Synthetic reviewer label' }).fill('Synthetic concurrency tester');
  await page.getByRole('checkbox', { name: 'Checked source: Synthetic source for browser test' }).check();
  for (const label of ['A', 'B'] as const) {
    const form = page.getByRole('form', { name: `Review answer ${label}`, exact: true });
    await assess(form, label);
    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: `Save synthetic review for ${label}`, exact: true }).click();
    if (label === 'A') await refreshHeld;
  }
  await expect(page.locator('.cc-progress')).toContainText('2/2 answers reviewed');
  await expect(page.getByRole('region', { name: 'Comparison results' })).toContainText('Practice packet complete.');
  release(); await lateFinished;
  await expect(page.locator('.cc-progress')).toContainText('2/2 answers reviewed');
  await expect(page.getByRole('region', { name: 'Comparison results' })).toContainText('Practice packet complete.');
});
