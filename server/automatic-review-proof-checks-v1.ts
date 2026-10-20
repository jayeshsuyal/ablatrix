/** Pure checks used after actual journal/canonical-ledger and source-review
 * replay. These checks cannot establish receipt origin or semantic quality. */
import assert from 'node:assert/strict';

type ObjectRecord = Record<string, unknown>;
const object = (value: unknown): ObjectRecord => {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as ObjectRecord;
};
const nonempty = (value: unknown): string => { assert.ok(typeof value === 'string' && value.trim()); return value; };
const digest = (value: unknown): string => { const result = nonempty(value); assert.match(result, /^[a-f0-9]{64}$/); return result; };
const unique = (values: string[], message: string) => assert.equal(new Set(values).size, values.length, message);

export type AutomaticOutcomeReplayFacts = {
  requestSha256: string;
  review: { status: string } & ObjectRecord;
  receiptProof: {
    planSha256: string; verifiedActualCompletedAttempts: number; unchangedHistoricalRows: number;
    canonicalReceiptRowsSha256: string; newProviderCalls: number;
  };
  candidateFreezeFileSha256: string;
  policyFreezeFileSha256: string;
  developmentProtocolFileSha256: string;
};

/** A saved Boolean or favorable status cannot replace the caller's independently
 * recomputed source-review decision and exact canonical receipt proof. Blocked
 * outcomes remain valid records of a blocked decision. */
export function checkAutomaticOutcomeAssertions(raw: unknown, actual: AutomaticOutcomeReplayFacts) {
  const saved = object(raw);
  assert.equal(saved.format, 'ablatrix-automatic-development-outcome-v1');
  assert.ok(['blocked', 'eligible_for_automated_exploratory_fresh_preparation'].includes(actual.review.status), 'Unknown replayed automatic decision.');
  assert.equal(saved.requestSha256, digest(actual.requestSha256), 'Saved outcome must bind its actual adjudication request.');
  assert.deepEqual(saved.review, actual.review, 'Saved source-review decision must equal complete independent replay.');
  assert.deepEqual(saved.receiptProof, actual.receiptProof, 'Saved canonical receipt proof must equal actual replay.');
  digest(actual.receiptProof.planSha256); digest(actual.receiptProof.canonicalReceiptRowsSha256);
  assert.equal(actual.receiptProof.verifiedActualCompletedAttempts, 24);
  assert.equal(actual.receiptProof.unchangedHistoricalRows, 141);
  assert.equal(actual.receiptProof.newProviderCalls, 0);
  assert.equal(saved.status, actual.review.status, 'A blocked automatic decision cannot be relabelled eligible.');
  assert.equal(saved.verifiedActualCompletedAttempts, 24);
  assert.equal(saved.automaticReviewComplete, true);
  for (const field of ['candidateFreezeFileSha256', 'policyFreezeFileSha256', 'developmentProtocolFileSha256'] as const) {
    assert.equal(saved[field], digest(actual[field]), 'Saved outcome must retain the exact executed candidate, policy and development design.');
  }
  assert.equal(saved.humanSourceCheckedAnswers, 0);
  assert.equal(saved.qualityClaimEligible, false);
  assert.equal(saved.activationAuthorized, false);
  assert.equal(saved.paidPlan, null);
  assert.equal(saved.newProviderCalls, 0);
}

export type AutomaticReceiptMappingFacts = {
  slots: readonly { caseId: string; arm: string; input: { runId: string } }[];
  steps: readonly { attemptId?: string | null }[];
  answers: readonly { label: string; caseId: string; status: string; output: unknown }[];
  mapping: unknown;
  outputs: readonly { status: string; output?: { answer?: unknown } | null }[];
};

/** Bind each opaque label to one exact executed operation, receipt and output.
 * Multiset equality alone would allow swapping two outputs within a case. */
export function checkAutomaticReceiptMapping(facts: AutomaticReceiptMappingFacts) {
  const { slots, steps, answers, outputs } = facts;
  assert.ok(slots.length > 0 && Array.isArray(facts.mapping));
  const mapping = facts.mapping.map(object);
  assert.equal(steps.length, slots.length); assert.equal(outputs.length, slots.length);
  assert.equal(answers.length, slots.length); assert.equal(mapping.length, slots.length);
  unique(slots.map(slot => nonempty(slot.input.runId)), 'Every planned operation must be unique.');
  unique(steps.map(step => nonempty(step.attemptId)), 'Every actual receipt must be unique.');
  unique(answers.map(answer => nonempty(answer.label)), 'Every neutral answer label must be unique.');
  for (const field of ['label', 'operationRunId', 'attemptId'] as const) {
    unique(mapping.map(row => nonempty(row[field])), `Every mapped ${field} must occur exactly once.`);
  }
  assert.deepEqual(mapping.map(row => row.label).sort(), answers.map(answer => answer.label).sort(), 'Mapping must retain every neutral answer.');
  for (const row of mapping) {
    const index = slots.findIndex(slot => slot.input.runId === row.operationRunId);
    assert.ok(index >= 0, 'Mapped operation must be present in the frozen plan.');
    const slot = slots[index]!, answer = answers.find(answer => answer.label === row.label)!;
    assert.equal(row.caseId, slot.caseId); assert.equal(row.arm, slot.arm);
    assert.equal(row.attemptId, steps[index]!.attemptId, 'Mapped attempt must be this operation\'s actual receipt.');
    assert.equal(answer.caseId, slot.caseId);
    assert.equal(answer.status, outputs[index]!.status);
    assert.deepEqual(answer.output, outputs[index]!.output?.answer ?? null, 'Each neutral label must bind this exact replayed receipt output.');
  }
}
