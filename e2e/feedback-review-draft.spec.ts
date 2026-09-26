import { expect, test } from '@playwright/test';
import type { LoopFeedback, LoopOverview, LoopRun, Passage } from '../server/loop-types.ts';

test('AI draft requires personal source review and preserves assistance provenance', async ({ page }) => {
  const createdAt = '2026-09-24T12:00:00.000Z';
  const passages: Passage[] = [
    { id: 'draft-source-1', productId: 'draft-product', source: 'Synthetic package description', text: 'This synthetic example is a pack of two panels.', reference: 'Synthetic browser test source', sha256: 'a'.repeat(64) },
    { id: 'draft-source-2', productId: 'draft-product', source: 'Synthetic package contents', text: 'The synthetic package contains two panels.', reference: 'Synthetic browser test source', sha256: 'b'.repeat(64) },
  ];
  const run: LoopRun = {
    id: 'draft-run', mode: 'live', productId: 'draft-product', caseId: 'draft-case', split: 'development',
    question: 'How many panels are included in this synthetic example?', policyId: 'live-baseline', status: 'completed',
    answer: { answer: 'There is one panel in this synthetic example.', status: 'answered', citations: [] },
    retrieval: { passages: passages.map((passage, index) => ({ ...passage, lexicalRank: index + 1, semanticRank: index + 1, score: 1 / (index + 1) })), durationMs: 1, method: 'synthetic', embeddingModel: 'synthetic browser test', corpusVersion: 'synthetic-draft-corpus' },
    model: 'synthetic browser test', usage: null, durationMs: 1, error: null, feedback: null, createdAt, validationId: null,
    reviewDraft: { id: 'review-draft-1', kind: 'ai_assisted', correct: false, supported: false, category: 'unsupported_claim', correction: 'The synthetic package contains two panels.', sourceIds: [passages[0].id], reviewer: 'Synthetic AI reviewer', rationale: 'The saved answer says one panel; the package evidence says two.', confidence: 'high', createdAt },
  };
  const overview: LoopOverview = {
    products: [{ id: run.productId, title: 'Synthetic panel pack', split: 'development' }],
    cases: [{ id: run.caseId!, productId: run.productId, question: run.question, split: 'development', referenceAnswer: 'Two panels in this synthetic example.', referencePassageIds: passages.map(passage => passage.id), labelStatus: 'Synthetic browser test reference' }],
    corpus: { version: 'synthetic-draft-corpus', source: 'Synthetic browser test', license: 'Synthetic', passageCount: passages.length },
    policies: ['fixture', 'live'].map(mode => ({ id: `${mode}-baseline`, parentId: null, instructions: 'Synthetic browser test policy.', rationale: 'Synthetic baseline.', feedbackRunIds: [], status: 'baseline' as const, mode: mode as 'fixture' | 'live', createdAt })),
    activePolicyIds: { fixture: 'fixture-baseline', live: 'live-baseline' }, runs: [run], batches: [], validations: [], externalValidationCases: [], finals: [], reviewCards: {}, events: [],
    readiness: { ready: false, reason: 'Synthetic browser test. No model calls are available.' }, busy: false,
  };
  let submitted: Partial<LoopFeedback> | undefined;
  const unexpectedApiRequests: string[] = [];
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  // Every experiment request is mocked; this test never reads or writes experiment state.
  await page.route('**/api/loop{,/**}', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/loop' && route.request().method() === 'GET') return route.fulfill({ json: overview });
    if (url.pathname === `/api/loop/products/${run.productId}/evidence`) return route.fulfill({ json: { passages } });
    if (url.pathname === `/api/loop/runs/${run.id}/review` && route.request().method() === 'POST') {
      submitted = route.request().postDataJSON() as Partial<LoopFeedback>;
      run.feedback = { ...submitted, draftId: run.reviewDraft!.id, kind: 'human', createdAt } as LoopFeedback;
      return route.fulfill({ json: run });
    }
    unexpectedApiRequests.push(`${route.request().method()} ${url.pathname}`);
    return route.abort();
  });

  await page.goto('/loop?mode=live');
  await expect(page.getByRole('button', { name: 'Live experiment', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const draft = page.locator('.fl-review-draft');
  const savedAnswer = page.locator('.fl-saved-runs button').filter({ hasText: run.question });
  const save = page.locator('.fl-form-footer button');
  const correct = page.getByRole('group', { name: 'Is the answer correct?', exact: true });
  const supported = page.getByRole('group', { name: 'Is it supported by the evidence?', exact: true });
  const sourceChecks = page.locator('.fl-source-checks');
  const referenceCheck = page.locator('.fl-reference-check input');
  const reviewer = page.locator('.fl-reviewer-name input');

  await expect(draft.getByText('View AI assessment · separate from your review')).toBeVisible();
  await expect(savedAnswer).toContainText('AI draft ready');
  await expect(correct.locator('input:checked')).toHaveCount(0);
  await expect(supported.locator('input:checked')).toHaveCount(0);
  await expect(sourceChecks.locator('input:checked')).toHaveCount(0);
  await expect(referenceCheck).not.toBeChecked();
  await expect(reviewer).toHaveValue('');
  await expect(save).toBeDisabled();
  await draft.locator(':scope > summary').click();
  await expect(draft.getByRole('heading')).toHaveText('AI review draft — awaiting your review');
  await draft.locator('.fl-draft-more > summary').click();
  await draft.locator('summary').filter({ hasText: passages[0].id }).click();
  await expect(draft.getByText(passages[0].text, { exact: true })).toBeVisible();

  await draft.getByRole('button', { name: 'Use suggested judgments' }).click();
  await expect(correct.getByRole('radio', { name: 'No', exact: true })).toBeChecked();
  await expect(supported.getByRole('radio', { name: 'No', exact: true })).toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Issue category', exact: true })).toHaveValue('unsupported_claim');
  await expect(page.getByPlaceholder('Describe the supported answer and what the agent missed…')).toHaveValue(run.reviewDraft!.correction);
  await expect(sourceChecks.locator('input:checked')).toHaveCount(0);
  await expect(referenceCheck).not.toBeChecked();
  await expect(reviewer).toHaveValue('');
  await expect(save).toBeDisabled();

  const humanCorrection = 'I checked the package contents: this synthetic example includes two panels.';
  await page.getByPlaceholder('Describe the supported answer and what the agent missed…').fill(humanCorrection);
  await page.getByRole('button', { name: 'Continue to checked evidence' }).click();
  // Choose a different valid source from the suggestion to verify the selection stays personal.
  await sourceChecks.locator('.fl-more-sources > summary').click();
  await sourceChecks.getByRole('checkbox', { name: new RegExp(passages[1].id) }).check();
  await expect(save).toBeDisabled();
  await referenceCheck.check();
  await expect(save).toBeDisabled();
  await page.getByRole('button', { name: 'Continue to confirmation' }).click();
  await reviewer.fill('Synthetic human reviewer');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.locator('.fl-notice')).toContainText('Feedback saved');
  expect(submitted).toEqual({ correct: false, supported: false, referenceChecked: true, category: 'unsupported_claim', correction: humanCorrection, sourceIds: [passages[1].id], reviewer: 'Synthetic human reviewer', draftId: run.reviewDraft!.id });
  await expect(savedAnswer).toContainText('Reviewed · AI-assisted');
  await expect(page.locator('.fl-review-provenance')).toContainText('AI-assisted review · confirmed by Synthetic human reviewer');

  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(unexpectedApiRequests).toEqual([]);
  expect(browserErrors).toEqual([]);
});
