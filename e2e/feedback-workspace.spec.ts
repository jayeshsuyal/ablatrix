import { expect, test } from '@playwright/test';
import type { LoopOverview, LoopRun, Passage } from '../server/loop-types.ts';

test('deep links preserve live mode, anonymous cards, source quotes, and narrow layout', async ({ page }) => {
  const passage: Passage = { id: 'saved-source', productId: 'product-one', source: 'Saved product listing', text: 'The recorded listing says the package contains two panels.', reference: 'Saved local source', sha256: 'a'.repeat(64) };
  const base = { mode: 'live' as const, productId: 'product-one', caseId: 'case-one', split: 'validation' as const, question: 'How many panels are included?', status: 'completed' as const, retrieval: { passages: [{ ...passage, lexicalRank: 1, semanticRank: 2, score: 0.0323 }], durationMs: 12, method: 'BM25 + semantic RRF', embeddingModel: 'saved test embedding', corpusVersion: 'saved-test' }, model: null, usage: null, durationMs: null, error: null, feedback: null, createdAt: '2026-09-25T12:00:00Z', validationId: 'card-one' };
  const cards: LoopRun[] = [
    { ...base, id: 'answer-one', policyId: '', blindLabel: 'Answer A', answer: { answer: 'The package has two panels.', status: 'answered', citations: [{ passageId: passage.id, quote: 'package contains two panels' }] } },
    { ...base, id: 'answer-two', policyId: '', blindLabel: 'Answer B', answer: { answer: 'The package may have two panels.', status: 'answered', citations: [{ passageId: passage.id, quote: 'contains two panels' }] } },
  ];
  const overview: LoopOverview = {
    products: [{ id: 'product-one', title: 'Synthetic browser test panel pack', split: 'validation' }],
    cases: [{ id: 'case-one', productId: 'product-one', question: base.question, split: 'validation', referenceAnswer: 'Two.', referencePassageIds: [passage.id], labelStatus: 'Synthetic browser test reference' }],
    corpus: { version: 'saved-test', source: 'Synthetic browser test', license: 'Synthetic', passageCount: 1 },
    policies: [{ id: 'live-baseline', parentId: null, instructions: 'Saved baseline.', rationale: 'Synthetic browser test.', feedbackRunIds: [], status: 'baseline', mode: 'live', createdAt: base.createdAt }, { id: 'candidate-one', parentId: 'live-baseline', instructions: 'Saved candidate.', rationale: 'Synthetic browser test.', feedbackRunIds: [], status: 'candidate', mode: 'live', createdAt: base.createdAt }],
    activePolicyIds: { fixture: 'fixture-baseline', live: 'live-baseline' }, runs: [], batches: [], externalValidationCases: [],
    validations: [{ id: 'card-one', candidateId: 'candidate-one', parentId: 'live-baseline', mode: 'live', status: 'awaiting_review', caseIds: ['case-one'], runIds: cards.map(item => item.id), createdAt: base.createdAt, reason: 'Synthetic browser test pair.', parentCorrect: null, candidateCorrect: null, regressions: null }],
    finals: [], reviewCards: { 'card-one': cards }, events: [], readiness: { ready: false, reason: 'Synthetic browser test; no calls.' }, busy: false,
  };
  let current = overview;
  await page.route('**/api/loop{,/**}', route => route.request().url().endsWith('/api/loop') ? route.fulfill({ json: current }) : route.fulfill({ json: { passages: [passage] } }));
  await page.goto('/loop?mode=live&card=card-one&case=case-one');
  await expect(page.getByRole('button', { name: 'Live experiment', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.fl-comparison-cards article')).toHaveCount(2);
  await expect(page.locator('.fl-comparison-cards')).toContainText('Answer A');
  await expect(page.locator('.fl-comparison-cards')).toContainText('Answer B');
  await expect(page.locator('.fl-comparison-cards')).not.toContainText('candidate-one');
  await expect(page.locator('.fl-comparison-cards')).not.toContainText('live-baseline');
  await expect(page.locator('.fl-quality-empty')).toContainText('No completed human reviewed comparison');
  await page.getByRole('button', { name: 'saved-source · saved quote ↗' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Source saved-source' }).locator('mark')).toHaveText('package contains two panels');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close source' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Source saved-source' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'saved-source · saved quote ↗' }).first()).toBeFocused();
  current = { ...overview, runs: cards.map((item, index) => ({ ...item, policyId: index === 0 ? 'live-baseline' : 'candidate-one', blindLabel: undefined })), reviewCards: {}, validations: [{ ...overview.validations[0], status: 'rejected', reason: 'Execution stopped before a quality decision.' }] };
  await page.goto('/loop');
  await expect(page.getByRole('button', { name: 'Live experiment', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.fl-comparison')).toContainText('Execution stopped before a quality decision.');
  await expect(page.getByRole('region', { name: 'Recorded experiments' })).toContainText('Official policy round · rejected');
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.goto('/loop?mode=live&run=missing-run');
  await expect(page.getByRole('alert')).toContainText('saved answer is unavailable');
  await expect(page.getByRole('button', { name: 'Live experiment', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
