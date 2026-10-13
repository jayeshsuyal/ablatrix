import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnswerRevisions } from './answer-revisions.ts';
import { runHarnessContracts } from './harness-contracts.ts';

test('offline harness report exercises production failure boundaries using synthetic temporary records and zero network', async () => {
  const previous = globalThis.fetch; let outbound = 0;
  globalThis.fetch = async () => { outbound++; throw new Error('Outbound transport is forbidden in this fixture.'); };
  try {
    const report = await runHarnessContracts();
    assert.equal(report.mechanical, 'pass', JSON.stringify(report.cases.filter(c => c.mechanical !== 'pass'), null, 2));
    assert.deepEqual(report.cases.map(c => c.id), ['invalid_citation', 'uncertain_receipt_restart', 'missing_information', 'exhausted_allowance']);
    assert.equal(outbound, 0); assert.equal(report.paidProviderCalls, 0); assert.equal(report.syntheticTransportAttempts, 2); assert.equal(report.humanDecisions, 0);
    assert.equal(report.provenance, 'synthetic_scripted_transport'); assert.equal(report.semanticAssessment, 'not_run'); assert.equal(report.qualityClaimEligible, false);
    assert.equal(report.contract.exercised, 'legacy_workspace_passage_quotes'); assert.equal(report.contract.sourceIdsV3Exercised, false);
    const checkpoint = (caseId: string, id: string) => report.cases.find(c => c.id === caseId)!.checkpoints.find(c => c.id === id)!;
    assert.equal(checkpoint('invalid_citation', 'output_validation_error').observed, 'output_validation');
    assert.equal(checkpoint('invalid_citation', 'queue_rejects_invalid_output').observed, 'needs_information');
    assert.equal(checkpoint('uncertain_receipt_restart', 'uncertain_state_after_reopen').observed, 'reconciliation');
    assert.equal(checkpoint('uncertain_receipt_restart', 'no_redispatch_after_reopen').observed, 1);
    for (const id of ['missing_information', 'exhausted_allowance']) { assert.equal(checkpoint(id, 'no_generation_receipt').observed, null); assert.equal(checkpoint(id, 'generation_transport_count').observed, 0); }
    const serialized = JSON.stringify(report); assert.deepEqual(JSON.parse(serialized), report); assert.doesNotMatch(serialized, /synthetic-offline-placeholder|Authorization|Bearer |\/var\/|\/tmp\//);
  } finally { globalThis.fetch = previous; }
});

test('unexpected worker failure produces a full failed checkpoint report instead of throwing away observations', async () => {
  const original = AnswerRevisions.prototype.tick;
  AnswerRevisions.prototype.tick = async function () { throw new Error('Synthetic worker failure containing text that must not enter the report.'); };
  try {
    const report = await runHarnessContracts(); assert.equal(report.mechanical, 'fail'); assert.equal(report.cases.length, 4); assert.equal(report.syntheticTransportAttempts, 0);
    for (const item of report.cases) { assert.equal(item.mechanical, 'fail'); assert.deepEqual(item.checkpoints.find(c => c.id === 'scenario_execution'), { id: 'scenario_execution', expected: 'completed', observed: 'Error', status: 'fail' }); }
    assert.equal(report.paidProviderCalls, 0); assert.equal(report.qualityClaimEligible, false); assert.doesNotMatch(JSON.stringify(report), /text that must not enter/);
  } finally { AnswerRevisions.prototype.tick = original; }
});
