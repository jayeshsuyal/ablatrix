import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWorkspaceContracts, runWorkspaceQualifierFixture } from './workspace-contracts.ts';

test('current retriever reproduces the condition omission on one frozen fictional packet', async () => {
  const result = await runWorkspaceQualifierFixture();
  assert.equal(result.status, 'completed'); assert.match(result.retrieval.method!, /fts5-bm25\+bge-cosine\+rrf/);
  assert.equal(result.retrieval.embeddingModel, 'injected-workspace-qualifier-contract@v1');
  assert.deepEqual(result.before, { factCovered: true, conditionCovered: false, conflictCovered: true });
  assert.equal(result.after.factCovered, true); assert.equal(result.after.conditionCovered, true); assert.equal(result.after.conflictCovered, true);
  assert.equal(result.after.exactBodyPreserved, true); assert.equal(result.after.originalQuestionPreserved, true); assert.ok(result.after.sourceCharacters <= 12_000);
  assert.equal(result.semanticAssessment, 'not_run'); assert.match(result.fixtureSha256, /^[a-f0-9]{64}$/);
});

test('workspace report includes crash, actual reservation, duplicate and bounded context contracts without network', async () => {
  const previous = globalThis.fetch; let outbound = 0;
  globalThis.fetch = async () => { outbound++; throw new Error('Outbound transport forbidden.'); };
  try {
    const report = await runWorkspaceContracts();
    assert.equal(report.mechanical, 'pass', JSON.stringify(report.cases.filter(item => item.mechanical !== 'pass'), null, 2));
    assert.deepEqual(report.cases.map(item => item.id), ['before_dispatch', 'after_dispatch_intent', 'after_receipt', 'after_answer_persist', 'reserved_unknown_late_response', 'qualifier_context_restoration']);
    assert.equal(report.syntheticTransportAttempts, 3); assert.equal(report.paidProviderCalls, 0); assert.equal(outbound, 0); assert.equal(report.humanDecisions, 0);
    assert.equal(report.semanticAssessment, 'not_run'); assert.equal(report.qualityClaimEligible, false);
    assert.doesNotMatch(JSON.stringify(report), /SYNTHETIC offline placeholder|Authorization|Bearer |\/tmp\/|\/var\//);
  } finally { globalThis.fetch = previous; }
});
