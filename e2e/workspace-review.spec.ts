import { expect, test } from '@playwright/test';

// Browser-only synthetic answers; these routes never reach a paid provider.
const createdAt = '2026-10-09T12:00:00.000Z';
const runId = '10000000-0000-4000-8000-000000000001';
const qid = `workspace-${runId}`;
const source = { id: 'fixture-source', label: 'Synthetic jacket specification', text: 'This synthetic jacket has taped seams and a waterproof outer shell.', sha256: 'a'.repeat(64), originalQuestion: null, origin: 'workspace' };
function reviewCase(id: string, question: string) {
  return { qid: id, generationAttempts: 0, versions: [{ id: `original-${id}`, parentId: null as string | null, createdAt, model: 'synthetic-browser-model', answer: { status: 'answered', answer: 'Synthetic answer: the jacket has a waterproof shell.', citations: [{ passageId: source.id, quote: 'waterproof outer shell' }] }, context: { question, product: { id: 'synthetic-product', title: 'Synthetic trail jacket' }, sources: [source], clarifications: [] } }], jobs: [] as { id: string; status: string; feedback: string; createdAt: string; versionId?: string }[], events: [] as { kind: string; versionId: string; note: string; reviewer: string }[] };
}
function packet() {
  return { cases: [reviewCase(qid, 'Will this synthetic jacket keep rain out?'), reviewCase('workspace-20000000-0000-4000-8000-000000000002', 'Does this synthetic jacket have taped seams?')], ready: 0, pending: 0, readiness: { ready: true, reason: 'Synthetic browser test; no paid dispatch.' }, investigationReadiness: { ready: false, reason: 'External discovery disabled for this synthetic test.' }, summary: { requested: 0, accepted: 0, unresolved: 0, providerCalls: 0, planningAllowanceUsd: 0, actualProviderCharges: 'unavailable' } };
}

test('new answer links to review; rejected answer returns while the reviewer continues', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const data = packet();
  let requestPayload: Record<string, unknown> | undefined;
  let decisionPayload: Record<string, unknown> | undefined;
  await page.route('**/api/workspace', route => route.fulfill({ json: { products: [], runs: [{ id: runId, productId: 'synthetic-product', question: data.cases[0].versions[0].context.question, mode: 'live', status: 'completed', answer: data.cases[0].versions[0].answer, model: 'synthetic-browser-model', retrieval: { passages: [{ ...source, reference: source.label }] }, usage: { inputTokens: 0, outputTokens: 0 }, createdAt }], readiness: { ready: false, reason: 'Synthetic browser fixture; no live calls are available.' }, busy: false } }));
  await page.route('**/api/workspace/reviews', route => route.fulfill({ json: data }));
  await page.route(`**/api/workspace/reviews/${qid}/revisions`, async route => {
    requestPayload = route.request().postDataJSON();
    data.cases[0].jobs.push({ id: 'synthetic-job', status: 'queued', feedback: String(requestPayload!.feedback), createdAt });
    data.pending = 1; data.summary.requested = 1;
    await route.fulfill({ json: data.cases[0].jobs[0] });
  });
  await page.route(`**/api/workspace/reviews/${qid}/decisions`, async route => {
    decisionPayload = route.request().postDataJSON();
    data.cases[0].events.push({ kind: String(decisionPayload!.decision), versionId: String(decisionPayload!.versionId), note: String(decisionPayload!.note), reviewer: String(decisionPayload!.reviewer) });
    data.ready = 0; data.summary.accepted = 1;
    await route.fulfill({ json: data.cases[0].events[0] });
  });
  await page.goto('/ask');
  await expect(page.locator('.ask-answer')).toContainText('synthetic-browser-model');
  await page.getByRole('link', { name: 'Review this answer' }).click();
  await expect(page).toHaveURL(`/review?answer=${qid}`);
  await expect(page.locator('.pr-detail-head')).toContainText(data.cases[0].versions[0].context.question);
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Pinned evaluation' })).toHaveAttribute('href', '/paid-review');
  const decision = page.getByRole('form', { name: 'Review answer decision' });
  await expect(decision.getByRole('button', { name: 'Accept answer', exact: true })).toBeDisabled();
  const request = page.getByRole('form', { name: 'Request answer revision' });
  await request.getByRole('textbox', { name: 'What is wrong or missing?' }).fill('The answer misses the taped seams in the supplied specification.');
  await request.getByRole('textbox', { name: 'Revision reviewer name' }).fill('Synthetic browser reviewer');
  await request.getByRole('button', { name: 'Investigate and revise' }).click();
  await expect(page.locator('.pr-job')).toContainText('queued');
  expect(requestPayload?.versionId).toBe(`original-${qid}`);
  expect(requestPayload?.idempotencyKey).toEqual(expect.any(String));
  await page.locator('.pr-queue button').nth(1).click();
  const secondQuestion = data.cases[1].versions[0].context.question;
  await expect(page.locator('.pr-detail-head')).toContainText(secondQuestion);

  const original = data.cases[0].versions[0];
  data.cases[0].versions.push({ ...original, id: 'synthetic-revision', parentId: original.id, answer: { status: 'answered', answer: 'Synthetic revised answer: the jacket has a waterproof outer shell and taped seams.', citations: [{ passageId: source.id, quote: 'taped seams and a waterproof outer shell' }] } });
  data.cases[0].jobs[0].status = 'ready'; data.cases[0].jobs[0].versionId = 'synthetic-revision'; data.cases[0].generationAttempts = 1;
  data.pending = 0; data.ready = 1;
  await expect(page.getByRole('button', { name: `Recheck: ${original.context.question}` })).toBeVisible({ timeout: 7000 });
  await expect(page.locator('.pr-detail-head')).toContainText(secondQuestion);
  await page.getByRole('button', { name: `Recheck: ${original.context.question}` }).click();
  await expect(page.locator('.pr-compare')).toContainText('Synthetic revised answer');
  await expect(page.locator('.pr-compare mark')).toContainText('taped seams');
  await expect(page.locator('.pr-sources')).toContainText(source.text);
  await decision.getByRole('textbox', { name: 'Revision reviewer name' }).fill('Synthetic browser reviewer');
  await decision.getByRole('checkbox', { name: source.label, exact: true }).check();
  await decision.getByRole('button', { name: 'Accept revision', exact: true }).click();
  expect(decisionPayload).toMatchObject({ versionId: 'synthetic-revision', decision: 'accept', checkedSourceShas: [source.sha256] });
  await expect(page.locator('.pr-queue button').first()).toContainText('ACCEPTED');
  await expect(page.getByRole('button', { name: `Recheck: ${original.context.question}` })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.pr-detail-head')).toContainText('ACCEPTED');
  await page.setViewportSize({ width: 360, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});

test('preview-only workspace has an empty review queue', async ({ page }) => {
  await page.route('**/api/workspace/reviews', route => route.fulfill({ json: { ...packet(), cases: [] } }));
  await page.goto('/review');
  await expect(page.getByRole('heading', { name: 'No answers to review yet.' })).toBeVisible();
  await expect(page.getByText('Retrieval previews do not create an answer or enter this queue.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Investigate and revise' })).toHaveCount(0);
});


test('an insufficient-evidence revision needs information instead of a ready notification', async ({ page }) => {
  const data = packet();
  const item = data.cases[0];
  const original = item.versions[0];
  item.versions.push({ ...original, id: 'synthetic-abstention', parentId: original.id, answer: { status: 'insufficient_evidence', answer: 'Synthetic revision: a waterproof rating is missing from the supplied specification.', citations: [] } });
  item.jobs.push({ id: 'synthetic-abstention-job', status: 'needs_information', feedback: 'Find a waterproof rating.', createdAt, versionId: 'synthetic-abstention' });
  await page.route('**/api/workspace/reviews', route => route.fulfill({ json: data }));
  await page.goto(`/review?answer=${qid}`);
  await expect(page.locator('.pr-detail-head')).toContainText('NEEDS INFORMATION');
  await expect(page.locator('.pr-queue button').first()).toContainText('NEEDS INFORMATION');
  await expect(page.locator('.wr-status')).toContainText('0 ready to recheck');
  await expect(page.getByRole('button', { name: /^Recheck:/ })).toHaveCount(0);
});

test('saved answer remains visible when review handoff and history refresh are unavailable', async ({ page }) => {
  const question = 'Will this synthetic jacket keep rain out?';
  const saved = { id: runId, productId: 'synthetic-product', question, mode: 'live', status: 'completed', answer: packet().cases[0].versions[0].answer, model: 'synthetic-browser-model', retrieval: { passages: [{ ...source, reference: source.label }] }, usage: { inputTokens: 0, outputTokens: 0 }, createdAt, reviewHandoff: 'pending' };
  let questionPosts = 0;
  let overviewRequests = 0;
  await page.route('**/api/workspace', route => {
    overviewRequests++;
    if (overviewRequests > 1) return route.fulfill({ status: 500, json: { error: 'Synthetic saved-history outage.' } });
    return route.fulfill({ json: { products: [{ id: 'synthetic-product', title: 'Synthetic trail jacket', sources: [source], createdAt }], runs: Array.from({ length: 100 }, (_, i) => ({ ...saved, id: `older-synthetic-run-${i}`, mode: 'preview', status: 'evidence_ready', answer: null, question: `Earlier synthetic preview ${i}` })), readiness: { ready: true, reason: 'Synthetic browser routes; no paid calls.' }, busy: false } });
  });
  await page.route('**/api/workspace/questions', route => {
    questionPosts++;
    expect(route.request().method()).toBe('POST');
    return route.fulfill({ status: 201, json: saved });
  });
  await page.goto('/ask');
  await page.getByRole('textbox', { name: 'Question', exact: true }).fill(question);
  await page.getByRole('button', { name: 'Generate cited answer' }).click();
  await expect(page.getByRole('status')).toHaveText('Answer saved. Review is temporarily unavailable; try opening its review again later.');
  await expect(page.locator('.ask-answer')).toContainText(saved.answer.answer);
  await expect(page.getByRole('link', { name: 'Review this answer' })).toHaveAttribute('href', `/review?answer=${qid}`);
  await expect(page.locator('.ask-history button[aria-pressed="true"]')).toContainText(question);
  await expect(page.locator('.ask-history button')).toHaveCount(100);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Generate cited answer' })).toBeEnabled();
  expect(questionPosts).toBe(1);
  expect(overviewRequests).toBe(2);
});
