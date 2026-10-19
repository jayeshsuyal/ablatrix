import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticPreparation, mockedThreeContext } from '../scripts/three-context-mock.ts';
import { prepareThreeContext, verifyThreeContext, verifyDiagnosticCheckpoint, diagnosticHash, executeThreeContext, recoverDiagnosticReceipts } from './three-context-diagnostic.ts';
import { calibratedAIReview, type SourceCheckedJudgment } from './answer-diagnostic-evaluation.ts';
test('three source contexts share exact answer contract and enforce literal qualified reference scope', () => {
  const p = syntheticPreparation(), manifest = prepareThreeContext(p); assert.equal(manifest.document.slots.length, 3); assert.equal(manifest.document.paidPlan!.maximumNewAttempts, 3);
  assert.equal(manifest.document.paidPlan!.cumulativePlanningLimitUsd, 14.300281);
  for (const mutate of [(v: typeof p) => { v.cases[0]!.contexts.reference[0]!.text = 'Changed report'; }, (v: typeof p) => { v.cases[0]!.contexts.reference[0]!.originalQuestion = 'ZX-2?'; }, (v: typeof p) => { v.ledger.canonicalPath = '/private/tmp/empty.sqlite'; }, (v: typeof p) => { v.ledger.pending = 1; }]) { const copy = structuredClone(p); mutate(copy); assert.throws(() => prepareThreeContext(copy)); }
  const changed = structuredClone(manifest); changed.document.slots[0]!.body.model = 'other'; changed.sha256 = diagnosticHash(changed.document); assert.throws(() => verifyThreeContext(changed));
});
test('identical words in an unrelated source do not hide a missing reviewed fact', () => {
  const p = syntheticPreparation(), item = p.cases[0]!, designated = item.completeSources[1]!;
  const unrelated = { ...structuredClone(designated), id: 'unrelated-variant', originalQuestion: 'How long did model ZX-2 burn?' };
  item.completeSources.push(unrelated); item.contexts.current = [unrelated];
  item.referenceReview.sourcePoolSha256 = diagnosticHash(item.completeSources);
  const manifest = prepareThreeContext(p);
  assert.equal(manifest.document.sourceBenefit, true); assert.deepEqual(manifest.document.deliveredCaseIds, [item.id]);
  assert.equal(manifest.document.paidPlan!.maximumNewAttempts, 3);
  const alreadyDelivered = structuredClone(p); alreadyDelivered.cases[0]!.contexts.current = [structuredClone(designated)];
  assert.equal(prepareThreeContext(alreadyDelivered).document.paidPlan, null);
  const wrongScope = structuredClone(p); wrongScope.cases[0]!.contexts.semantic = [...wrongScope.cases[0]!.contexts.semantic];
  wrongScope.cases[0]!.contexts.semantic[1] = { ...wrongScope.cases[0]!.contexts.semantic[1]!, originalQuestion: unrelated.originalQuestion };
  assert.throws(() => prepareThreeContext(wrongScope), /preserve literal source and question scope/);
});
test('mocked full three-arm path uses existing provider reservations, exact receipts and anonymous review', async () => {
  const r = await mockedThreeContext(); assert.equal(r.calls, 3); assert.equal(r.result.completedAnswers, 3); assert.ok(r.closed);
  assert.equal(r.result.networkDispatches, 3); assert.equal(r.result.retries, 0); assert.equal(r.anonymous.review.cases[0]!.completeSources.length, 3);
  assert.equal(r.anonymous.mapping.length, 3);
  const forbiddenKeys = new Set(['arm', 'operationRunId', 'attemptId', 'model', 'usage', 'contract', 'executionMode', 'policyId', 'policySha256', 'requestSha256', 'systemInstructionsSha256', 'responseSchemaSha256', 'optionSetSha256', 'sourceContextSha256']);
  const inspectReview = (value: unknown): void => {
    if (typeof value === 'string') { for (const slot of r.manifest.document.slots) assert.ok(!value.includes(slot.input.runId)); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) { assert.ok(!forbiddenKeys.has(key), `Execution identity leaked to review: ${key}`); inspectReview(child); }
  };
  inspectReview(r.anonymous.review);
  for (const answer of r.anonymous.review.answers) {
    assert.deepEqual(Object.keys(answer).sort(), ['caseId', 'label', 'output', 'status']);
    assert.deepEqual(Object.keys(answer.output!).sort(), ['answer', 'citations', 'status']);
    const privateEntry = r.anonymous.mapping.find(m => m.label === answer.label)!;
    assert.ok(privateEntry.operationRunId.endsWith(`-${privateEntry.arm}`)); assert.ok(privateEntry.attemptId);
  }
  const interrupted = r.checkpoints.find(c => c.steps[0]!.dispatchIntent && !c.steps[0]!.dispatched)!;
  const observed = verifyDiagnosticCheckpoint(r.manifest, interrupted); assert.equal(observed.networkDispatches, null); assert.equal(observed.unresolvedDispatchIntents, 1);
  const recovery = recoverDiagnosticReceipts(r.manifest, interrupted, [r.checkpoint.steps[0]!.receipt!]); assert.equal(recovery.result.completedAnswers, 1); assert.equal(recovery.result.networkDispatches, null);
  const recovered = verifyDiagnosticCheckpoint(r.manifest, r.checkpoint); assert.equal(recovered.completedAnswers, 3); assert.equal(r.calls, 3);
});
test('failed, invalid, duplicate and drifting model arms stop and retain unattempted arms with zero retries', async () => {
  for (const options of [{ failure: true }, { invalidCitation: true }, { duplicate: true }, { modelDrift: true }]) {
    const r = await mockedThreeContext(options); assert.ok(r.calls <= 2); assert.ok(r.result.completedAnswers < 3); assert.equal(r.result.retries, 0); assert.ok(r.result.outputs.some(o => o.status === 'not_attempted')); assert.ok(r.closed);
  }
});
test('no-benefit and changed bindings reject before constructing any provider', async () => {
  await assert.rejects(mockedThreeContext({ noBenefit: true }), /No-benefit/); await assert.rejects(mockedThreeContext({ tamperBinding: true }), /binding changed/);
  const p = syntheticPreparation(); p.codeReviewPassed = false; const m = prepareThreeContext(p); assert.equal(m.document.paidPlan, null);
});
test('AI calibration requires bound human reference and exposes disagreements without asserting quality', () => {
  const human: SourceCheckedJudgment = { itemId: 'SYNTHETIC', reviewer: 'SYNTHETIC fixture only', provenance: 'source_checked_human', sourcePoolSha256: '0'.repeat(64), answerSha256: '1'.repeat(64), facts: [{ factId: 'manual-stop', status: 'covered', sourceIds: ['report'], rationale: 'SYNTHETIC' }], unsupportedClaims: [], exactApplicability: 'pass', appropriateUncertainty: 'pass', directRelevance: 'pass' };
  const ai = { ...structuredClone(human), provenance: 'ai_provisional' as const, appropriateUncertainty: 'fail' as const };
  const result = calibratedAIReview([human], [ai]); assert.equal(result.disagreementsForFocusedHumanReview.length, 1); assert.equal(result.qualityClaimEligible, false);
  assert.throws(() => calibratedAIReview([ai], [ai])); const changed = { ...ai, answerSha256: '2'.repeat(64) }; assert.throws(() => calibratedAIReview([human], [changed]));
});
