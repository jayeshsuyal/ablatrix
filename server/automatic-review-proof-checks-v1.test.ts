import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAutomaticOutcomeAssertions, checkAutomaticReceiptMapping, type AutomaticOutcomeReplayFacts, type AutomaticReceiptMappingFacts } from './automatic-review-proof-checks-v1.ts';

/** Everything below is SYNTHETIC. No live ledger, private run, dataset,
 * environment credential or provider is read by these proof-mutation tests. */
function outcomeFixture(status = 'eligible_for_automated_exploratory_fresh_preparation') {
  const actual: AutomaticOutcomeReplayFacts = {
    requestSha256: 'a'.repeat(64),
    review: { status, provenance: 'SYNTHETIC replayed automatic review', retainedUncertainty: [{ axis: 'directRelevance', disposition: 'remains_uncertain' }], allPairs: ['SYNTHETIC pair 1', 'SYNTHETIC pair 2'] },
    receiptProof: { planSha256: 'b'.repeat(64), verifiedActualCompletedAttempts: 24, unchangedHistoricalRows: 141, canonicalReceiptRowsSha256: 'c'.repeat(64), newProviderCalls: 0 },
    candidateFreezeFileSha256: 'd'.repeat(64), policyFreezeFileSha256: 'e'.repeat(64), developmentProtocolFileSha256: 'f'.repeat(64)
  };
  const saved: Record<string, any> = { format: 'ablatrix-automatic-development-outcome-v1', status,
    requestSha256: actual.requestSha256, review: structuredClone(actual.review), receiptProof: structuredClone(actual.receiptProof),
    verifiedActualCompletedAttempts: 24, automaticReviewComplete: true, candidateFreezeFileSha256: actual.candidateFreezeFileSha256,
    policyFreezeFileSha256: actual.policyFreezeFileSha256, developmentProtocolFileSha256: actual.developmentProtocolFileSha256,
    humanSourceCheckedAnswers: 0, qualityClaimEligible: false, activationAuthorized: false, paidPlan: null, newProviderCalls: 0 };
  return { actual, saved };
}

test('a complete automatic outcome retains the replayed uncertainty and a blocked outcome stays blocked', () => {
  for (const status of ['eligible_for_automated_exploratory_fresh_preparation', 'blocked']) {
    const { actual, saved } = outcomeFixture(status), unchanged = structuredClone(saved);
    checkAutomaticOutcomeAssertions(saved, actual); assert.deepEqual(saved, unchanged);
  }
  const { actual, saved } = outcomeFixture('blocked'); saved.status = 'eligible_for_automated_exploratory_fresh_preparation';
  assert.throws(() => checkAutomaticOutcomeAssertions(saved, actual), /blocked automatic decision/);
});

test('newProviderCalls must explicitly be zero in both saved outcome and actual replay proof', () => {
  for (const value of [undefined, null, '0', 1, -1]) {
    const { actual, saved } = outcomeFixture(); saved.newProviderCalls = value;
    assert.throws(() => checkAutomaticOutcomeAssertions(saved, actual));
  }
  const { actual, saved } = outcomeFixture(); actual.receiptProof.newProviderCalls = 1; saved.receiptProof = structuredClone(actual.receiptProof);
  assert.throws(() => checkAutomaticOutcomeAssertions(saved, actual));
});

test('bare completion flags and an edited favorable review cannot replace the entire replayed decision', () => {
  for (const edit of [
    (saved: Record<string, any>) => { delete saved.review; },
    (saved: Record<string, any>) => { saved.review.retainedUncertainty = []; },
    (saved: Record<string, any>) => { saved.review.allPairs.pop(); },
    (saved: Record<string, any>) => { saved.status = 'reviewed'; },
    (saved: Record<string, any>) => { saved.automaticReviewComplete = false; }
  ]) { const { actual, saved } = outcomeFixture(); edit(saved); assert.throws(() => checkAutomaticOutcomeAssertions(saved, actual)); }
  const { actual, saved } = outcomeFixture(); actual.review.status = 'unrecognized'; saved.status = 'unrecognized'; saved.review = structuredClone(actual.review);
  assert.throws(() => checkAutomaticOutcomeAssertions(saved, actual), /Unknown replayed automatic decision/);
});

test('request, executed candidate/policy/design and canonical receipt digests are individually pinned', () => {
  for (const field of ['requestSha256', 'candidateFreezeFileSha256', 'policyFreezeFileSha256', 'developmentProtocolFileSha256']) {
    const { actual, saved } = outcomeFixture(); saved[field] = '0'.repeat(64);
    assert.throws(() => checkAutomaticOutcomeAssertions(saved, actual));
  }
  for (const field of ['planSha256', 'canonicalReceiptRowsSha256', 'verifiedActualCompletedAttempts', 'unchangedHistoricalRows']) {
    const { actual, saved } = outcomeFixture(); saved.receiptProof[field] = typeof saved.receiptProof[field] === 'number' ? 0 : '0'.repeat(64);
    assert.throws(() => checkAutomaticOutcomeAssertions(saved, actual), /canonical receipt proof/);
  }
  const { actual, saved } = outcomeFixture(); actual.requestSha256 = 'not-a-digest'; saved.requestSha256 = actual.requestSha256;
  assert.throws(() => checkAutomaticOutcomeAssertions(saved, actual));
});

test('automatic review never manufactures human judgments, promotion, funding or completed calls', () => {
  for (const [field, value] of [['humanSourceCheckedAnswers', 1], ['qualityClaimEligible', true], ['activationAuthorized', true], ['paidPlan', { calls: 24 }], ['verifiedActualCompletedAttempts', 23]] as const) {
    const { actual, saved } = outcomeFixture(); saved[field] = value;
    assert.throws(() => checkAutomaticOutcomeAssertions(saved, actual));
  }
});

function mappingFixture(): AutomaticReceiptMappingFacts & { mapping: Record<string, any>[] } {
  const arms = ['current', 'semantic', 'reference'];
  const slots = Array.from({ length: 6 }, (_, index) => ({ caseId: `SYNTHETIC-case-${Math.floor(index / 3)}`, arm: arms[index % 3]!, input: { runId: `SYNTHETIC-run-${index}` } }));
  const steps = slots.map((_, index) => ({ attemptId: `SYNTHETIC-attempt-${index}` }));
  const outputs = slots.map((_, index) => ({ status: 'completed', output: { answer: { answer: `SYNTHETIC exact output ${index}`, citations: [`SYNTHETIC-citation-${index}`] } } }));
  const mapping = slots.map((slot, index) => ({ label: `SYNTHETIC opaque label ${6 - index}`, caseId: slot.caseId, arm: slot.arm, operationRunId: slot.input.runId, attemptId: steps[index]!.attemptId })).reverse();
  const answers = mapping.map(row => { const index = slots.findIndex(slot => slot.input.runId === row.operationRunId); return { label: row.label, caseId: row.caseId, status: outputs[index]!.status, output: structuredClone(outputs[index]!.output.answer) }; });
  return { slots, steps, outputs, mapping, answers };
}

test('opaque mapping order can differ while every label retains its exact operation, receipt and output', () => {
  const f = mappingFixture(), before = structuredClone(f); checkAutomaticReceiptMapping(f); assert.deepEqual(f, before);
});

test('duplicate, omitted, unknown or remapped operation/receipt/label identities fail closed', () => {
  for (const field of ['label', 'operationRunId', 'attemptId']) {
    const f = mappingFixture(); f.mapping[0]![field] = f.mapping[1]![field];
    assert.throws(() => checkAutomaticReceiptMapping(f), /exactly once/);
  }
  const missing = mappingFixture(); missing.mapping.pop(); assert.throws(() => checkAutomaticReceiptMapping(missing));
  const unknown = mappingFixture(); unknown.mapping[0]!.operationRunId = 'SYNTHETIC-unplanned'; assert.throws(() => checkAutomaticReceiptMapping(unknown), /frozen plan/);
  const transposed = mappingFixture(); [transposed.mapping[0]!.attemptId, transposed.mapping[1]!.attemptId] = [transposed.mapping[1]!.attemptId, transposed.mapping[0]!.attemptId];
  assert.throws(() => checkAutomaticReceiptMapping(transposed), /actual receipt/);
  for (const field of ['caseId', 'arm']) { const f = mappingFixture(); f.mapping[0]![field] = 'SYNTHETIC-other'; assert.throws(() => checkAutomaticReceiptMapping(f)); }
});

test('preserving the answer multiset cannot conceal output swaps within one product case', () => {
  const f = mappingFixture(); assert.equal(f.answers[0]!.caseId, f.answers[1]!.caseId);
  [f.answers[0]!.output, f.answers[1]!.output] = [f.answers[1]!.output, f.answers[0]!.output];
  assert.throws(() => checkAutomaticReceiptMapping(f), /exact replayed receipt output/);
  const status = mappingFixture(); status.answers[0]!.status = 'failed_or_unknown'; assert.throws(() => checkAutomaticReceiptMapping(status));
});
