import test from 'node:test';
import assert from 'node:assert/strict';
import { rehearseV5 } from '../scripts/rehearse-three-context-v5.ts';
test('complete pinned v5 gap group runs through real mocked ledger/journal/receipt/evaluation plumbing', async () => {
  const r = await rehearseV5(); assert.deepEqual(r.sourceCases, ['source-coverage-v2-train-12870']); assert.equal(r.transportCalls, 3); assert.equal(r.result.completedAnswers, 3); assert.deepEqual(r.result.usage, { inputTokens: 30, outputTokens: 15 }); assert.equal(r.result.actualProviderCharges, 'unavailable'); assert.equal(r.evaluation.answers, 3); assert.equal(r.newRealProviderCalls, 0);
});
test('pinned v5 ambiguous failure preserves all unattempted arms and partial known usage', async () => {
  const r = await rehearseV5({ failureAt: 1 }); assert.equal(r.transportCalls, 2); assert.equal(r.result.completedAnswers, 1); assert.equal(r.result.failedOrUnknownAnswers, 1); assert.equal(r.result.unattemptedAnswers, 1); assert.equal(r.result.usage, null); assert.equal(r.result.transportInvocations, 2); assert.equal(r.result.networkDispatches, null); assert.equal(r.result.remoteOutcomeUnknownAttempts, 1); assert.equal(r.result.unresolvedDispatchIntents, 0); assert.deepEqual(r.result.knownUsageSubtotal, { inputTokens: 10, outputTokens: 5 }); assert.equal(r.evaluation.answers, 3); assert.equal(r.newRealProviderCalls, 0);
});
