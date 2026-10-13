import { expect, test } from '@playwright/test';

// Browser-only response fixtures. Every API route is intercepted; no provider dispatch occurs.
const runId = '10000000-0000-4000-8000-000000000035';
const qid = `workspace-${runId}`;
const createdAt = '2026-10-12T12:00:00.000Z';
const source = { id: 'synthetic-jacket-source', label: 'Synthetic jacket specification', text: 'This synthetic jacket has taped seams and a waterproof outer shell.', originalQuestion: null, sha256: 'a'.repeat(64), origin: 'workspace' };
const originalAnswer = { status: 'answered', answer: 'Synthetic original: the jacket is waterproof and withstands 20,000 mm of water.', citations: [{ passageId: source.id, quote: 'waterproof outer shell' }] };
const repairedAnswer = { status: 'answered', answer: 'Synthetic repair: the jacket has a waterproof outer shell and taped seams. A waterproof rating is not provided.', citations: [{ passageId: source.id, quote: source.text }] };
const original = { id: qid, runId, context: { question: 'Does the synthetic jacket keep rain out?', product: { id: 'synthetic-product', title: 'Synthetic trail jacket' }, sources: [source], clarifications: [] }, answer: originalAnswer, model: 'synthetic-browser-model', promptVersion: 'synthetic-browser-fixture', createdAt, contextProvenance: 'workspace_source_snapshot', generationSourceIds: [source.id] };
const run = { id: runId, productId: 'synthetic-product', question: original.context.question, mode: 'live', status: 'completed', retrieval: { passages: [{ ...source, reference: source.label }], method: 'synthetic-browser-retrieval', durationMs: 1 }, answer: originalAnswer, model: original.model, usage: { inputTokens: 0, outputTokens: 0 }, error: null, createdAt };
function checkFixture(status = 'queued') {
  return { id: 'synthetic-check', qid, originalId: 'synthetic-original-version', mode: 'live', status, phase: 'grade_original', original, sourceContextSha256: 'b'.repeat(64), originalAnswerSha256: 'c'.repeat(64), assessments: [] as object[], delivery: undefined as { answer: typeof originalAnswer; versionId: string | null; origin: string } | undefined, error: undefined as string | undefined, createdAt, assessmentKind: 'ai_claim_support_estimate', qualityClaimEligible: false };
}
const readiness = { ready: true, reason: 'Synthetic browser fixtures only; no real model calls.' };

test('automatic source check repairs once, keeps the original, and stops polling on delivery', async ({ page }) => {
  await page.clock.install();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const job = checkFixture();
  const extraSource = { ...source, id: 'synthetic-unretrieved-source', label: 'Synthetic care manual', text: 'The synthetic care manual confirms taped seams and a waterproof shell. It does not specify a waterproof rating.', sha256: 'd'.repeat(64) };
  job.original = { ...original, context: { ...original.context, sources: [source, extraSource] } };
  let generated = false, checks = 0, questionPosts = 0;
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/session') return route.fulfill({ json: { hosted: false, providerMode: 'local', actor: null } });
    if (url.pathname === '/api/workspace/questions') {
      expect(route.request().postDataJSON()).toMatchObject({ automaticCheck: true, mode: 'live' });
      generated = true; questionPosts++;
      return route.fulfill({ status: 201, json: { ...run, automaticCheck: job } });
    }
    if (url.pathname === '/api/workspace/automatic-checks') {
      expect(url.searchParams.get('answer')).toBe(qid);
      checks++;
      return route.fulfill({ json: { checks: [job], readiness } });
    }
    if (url.pathname === '/api/workspace') return route.fulfill({ json: { products: [{ id: 'synthetic-product', title: 'Synthetic trail jacket', sources: [source], createdAt }], runs: generated ? [run] : [], readiness, automaticCheckReadiness: readiness, busy: false } });
    return route.fulfill({ status: 404, json: { error: 'Unexpected synthetic browser route.' } });
  });
  await page.goto('/ask');
  const option = page.getByRole('checkbox', { name: 'Automatically check sources and repair once' });
  await expect(option).not.toBeChecked();
  await option.check();
  await expect(page.locator('.ask-check-help')).toContainText('at most 3 additional model calls');
  await page.getByRole('textbox', { name: 'Question', exact: true }).fill(original.context.question);
  await page.getByRole('button', { name: 'Generate cited answer' }).click();
  const panel = page.getByRole('region', { name: 'Automatic source check' });
  await expect(panel.getByRole('heading')).toHaveText('Source check queued');
  await expect(page.locator('.ask-answer')).toHaveCount(0);
  job.status = 'repairing'; job.phase = 'repair';
  await page.clock.runFor(2100);
  await expect(panel.getByRole('heading')).toHaveText('Repairing once');
  job.status = 'rechecking'; job.phase = 'grade_repair';
  await page.clock.runFor(2100);
  await expect(panel.getByRole('heading')).toHaveText('Checking the repair');
  job.status = 'repaired';
  job.delivery = { answer: { ...repairedAnswer, citations: [{ passageId: extraSource.id, quote: extraSource.text }] }, versionId: 'synthetic-repair-version', origin: 'repair' };
  await page.clock.runFor(2100);
  await expect(panel.getByRole('heading')).toHaveText('Repaired · AI check passed');
  await expect(panel.locator('.automatic-check-answer')).toContainText(repairedAnswer.answer);
  await expect(panel).toContainText('does not verify whether the sources are true');
  await panel.locator('.automatic-check-original summary').click();
  await expect(panel.locator('.automatic-check-original')).toContainText(originalAnswer.answer);
  await expect(panel.locator('.automatic-check-answer a')).toHaveAttribute('href', `#source-${extraSource.id}`);
  await panel.locator('.automatic-check-answer a').click();
  await expect(page.locator(`[id="source-${extraSource.id}"]`)).toContainText(extraSource.text);
  const finalChecks = checks;
  await page.clock.runFor(5000);
  expect(checks).toBe(finalChecks);
  expect(questionPosts).toBe(1);
  await page.reload();
  await expect(panel.getByRole('heading')).toHaveText('Repaired · AI check passed');
  await page.setViewportSize({ width: 360, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});

for (const status of ['abstained', 'inconclusive', 'reconciliation']) {
  test(`${status} keeps the original accessible without presenting it as checked`, async ({ page }) => {
    await page.clock.install();
    const job = checkFixture(status);
    if (status === 'abstained') job.delivery = { answer: { status: 'insufficient_evidence', answer: 'The saved sources do not establish a waterproof rating.', citations: [] }, versionId: null, origin: 'safe_abstention' };
    let checks = 0;
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/session') return route.fulfill({ json: { hosted: false, providerMode: 'local', actor: null } });
      if (path === '/api/workspace') return route.fulfill({ json: { products: [], runs: [run], readiness, automaticCheckReadiness: readiness, busy: false } });
      if (path === '/api/workspace/automatic-checks') { checks++; return route.fulfill({ json: { checks: [job], readiness } }); }
      return route.fulfill({ status: 404, json: { error: 'Unexpected synthetic browser route.' } });
    });
    await page.goto('/ask');
    const panel = page.getByRole('region', { name: 'Automatic source check' });
    await expect(panel.getByRole('heading')).toHaveText(status === 'abstained' ? 'Cannot support an answer' : status === 'reconciliation' ? 'Check interrupted · outcome uncertain' : 'Check inconclusive');
    await expect(page.locator('.ask-answer')).toHaveCount(0);
    if (status !== 'abstained') await expect(panel.locator('.automatic-check-answer')).toHaveCount(0);
    await panel.locator('.automatic-check-original summary').click();
    await expect(panel.locator('.automatic-check-original')).toContainText(originalAnswer.answer);
    await expect(panel.locator('.automatic-check-original summary')).toContainText('not cleared for use');
    const finalChecks = checks;
    await page.clock.runFor(5000);
    expect(checks).toBe(finalChecks);
  });
}

test('workspace review shows the automatic estimate without manufacturing a human decision', async ({ page }) => {
  const job = checkFixture('supported');
  job.delivery = { answer: originalAnswer, versionId: job.originalId, origin: 'original' };
  const item = { qid, generationAttempts: 0, versions: [{ id: job.originalId, parentId: null, answer: originalAnswer, model: original.model, createdAt, context: original.context }], jobs: [], events: [] };
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { hosted: false, providerMode: 'local', actor: null } });
    if (path === '/api/workspace/automatic-checks') return route.fulfill({ json: { checks: [job], readiness } });
    if (path === '/api/workspace/reviews') return route.fulfill({ json: { cases: [item], ready: 0, pending: 0, readiness, summary: { requested: 0, accepted: 0, unresolved: 0, providerCalls: 0, planningAllowanceUsd: 0, actualProviderCharges: 'unavailable' } } });
    return route.fulfill({ status: 404, json: { error: 'Unexpected synthetic browser route.' } });
  });
  await page.goto(`/review?answer=${qid}`);
  const panel = page.getByRole('region', { name: 'Automatic source check' });
  await expect(panel.getByRole('heading')).toHaveText('AI check passed');
  await expect(panel.locator('.automatic-check-answer a')).toHaveAttribute('href', `#source-${source.sha256}`);
  await expect(page.locator('.wr-status')).toContainText('0 accepted');
  await expect(page.getByRole('button', { name: 'Accept answer', exact: true })).toBeDisabled();
  await expect(page.locator('.pr-event')).toHaveCount(0);
});

test('automatic check handoff failure preserves the saved answer without another generation', async ({ page }) => {
  let generated = false, questionPosts = 0;
  const automaticCheckError = 'Automatic checking is unavailable for this saved answer. Its original was preserved.';
  const savedRun = { ...run, automaticCheckRequested: true, automaticCheckHandoff: 'unavailable', automaticCheckError };
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { hosted: false, providerMode: 'local', actor: null } });
    if (path === '/api/workspace/questions') { questionPosts++; generated = true; return route.fulfill({ status: 201, json: savedRun }); }
    if (path === '/api/workspace') return route.fulfill({ json: { products: [{ id: 'synthetic-product', title: 'Synthetic trail jacket', sources: [source], createdAt }], runs: generated ? [savedRun] : [], readiness, automaticCheckReadiness: readiness, busy: false } });
    if (path === '/api/workspace/automatic-checks') return route.fulfill({ json: { checks: [], readiness } });
    return route.fulfill({ status: 404, json: { error: 'Unexpected synthetic browser route.' } });
  });
  await page.goto('/ask');
  await page.getByRole('checkbox', { name: 'Automatically check sources and repair once' }).check();
  await page.getByRole('textbox', { name: 'Question', exact: true }).fill(original.context.question);
  await page.getByRole('button', { name: 'Generate cited answer' }).click();
  await expect(page.locator('.ask-notice[role="status"]')).toContainText(automaticCheckError);
  await expect(page.locator('.ask-answer')).toContainText('AUTOMATIC CHECK UNAVAILABLE');
  await expect(page.locator('.ask-answer')).toContainText(originalAnswer.answer);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Automatic source check' })).toContainText(automaticCheckError);
  await expect(page.locator('.ask-answer')).toContainText('AUTOMATIC CHECK UNAVAILABLE');
  expect(questionPosts).toBe(1);
});
