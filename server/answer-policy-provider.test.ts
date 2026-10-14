import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SapiomFeedbackProvider } from './feedback-provider.ts';
import { SyntheticAnswerProvider } from './synthetic-answer-provider.ts';
import { RUNTIME_POLICY_CALL_CEILING, RUNTIME_POLICY_PROPOSAL_TOOL, RUNTIME_POLICY_ANSWER_TOOL, runtimeProposalRequestParts, runtimeAnswerRequestParts, replayRuntimeProposalReceipt, replayRuntimeAnswerReceipt, type RuntimeProposalInput, type RuntimeAnswerInput } from './answer-policy-protocol.ts';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const instructions = 'Use only supplied sources. Attribute factual assertions and preserve uncertainty. Cover every supported requested fact.';
const policy = { id: 'fixture-parent-policy', instructions, instructionSha256: sha(instructions), mode: 'live' as const };
const proposal: RuntimeProposalInput = { runId: 'fixture-runtime-proposal', parent: policy, groupId: 'fixture-group', groupSha256: sha('fixture group'), failure: { category: 'unsupported_claim', bindings: [1, 2, 3].map(index => ({ jobId: `fixture-job-${index}`, runId: `fixture-answer-${index}`, answerSha256: sha(`answer ${index}`), sourceContextSha256: sha(`sources ${index}`), assessmentReceiptId: `fixture-assessment-${index}`, policyId: policy.id, policySha256: policy.instructionSha256 })) } };
const answerInput: RuntimeAnswerInput = { runId: 'fixture-runtime-answer', question: 'How many cups does the fictional Nacre kettle hold?', product: { id: 'fictional-nacre', title: 'Fictional Nacre kettle' }, evidence: [{ id: 'nacre-capacity-source', source: 'Synthetic fictional fixture listing', text: 'SYNTHETIC runtime fixture: The fictional Nacre kettle holds twelve cups.' }], policy, validationPacketSha256: sha('fixture independent packet'), caseId: 'nacre-capacity' };
const answer = { answer: 'The fictional Nacre kettle holds twelve cups.', status: 'answered' as const, citations: [{ passageId: answerInput.evidence[0].id, quote: answerInput.evidence[0].text }] };
const addition = { instructions: 'Check each material claim against applicable source text while preserving useful supported facts and appropriate uncertainty.', rationale: 'SYNTHETIC transport fixture only; no demonstrated quality improvement.' };
const options = { enabled: true, apiKey: 'synthetic-placeholder', credentialsFile: '', dbPath: ':memory:', capUsd: 3, allowancePerCallUsd: .1, callLimit: 20 };
function response(kind: string, output: unknown) { return new Response(JSON.stringify({ model: 'gpt-luna', usage: { prompt_tokens: 100, completion_tokens: 50 }, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: kind, arguments: JSON.stringify(output) } }] } }] })); }

test('runtime proposer freezes category/bindings only and reserves exact identity before the sole dispatch', async () => {
  let calls = 0;
  const parts = runtimeProposalRequestParts(proposal);
  const provider: SapiomFeedbackProvider = new SapiomFeedbackProvider({ ...options, callLimit: 1, fetchImpl: async (_url, init): Promise<Response> => {
    calls++;
    assert.deepEqual(JSON.parse(String(init?.body)), parts.body);
    const pending = provider.receipt(proposal.runId)!;
    assert.equal(pending.status, 'pending');
    assert.equal(JSON.parse(pending.receipt_json!).requestSha256, parts.bindings.requestSha256);
    assert.equal(JSON.parse(pending.receipt_json!).policySha256, policy.instructionSha256);
    assert.equal(JSON.parse(String(init?.body)).model, 'gpt-luna');
    assert.ok(!JSON.stringify(parts.payload).includes('referenceAnswer'));
    assert.ok(!JSON.stringify(parts.payload).includes('validationPacket'));
    return response(RUNTIME_POLICY_PROPOSAL_TOOL, addition);
  } });
  try {
    const result = await provider.suggestRuntimePolicy(proposal);
    assert.deepEqual(await provider.suggestRuntimePolicy(proposal), result);
    assert.equal(calls, 1); assert.equal(provider.capacity(1).ready, false);
    await assert.rejects(provider.suggestRuntimePolicy({ ...proposal, groupSha256: sha('changed group') }), /reconciliation/);
    await assert.rejects(provider.suggestRuntimePolicy({ ...proposal, parent: { ...policy, mode: 'synthetic' } }), /mode/);
    assert.equal(calls, 1);
  } finally { provider.close(); }
});

test('runtime answer is independent of later input mutation and binds exact policy, packet, case and sources', async () => {
  const mutable = structuredClone(answerInput), originalParts = runtimeAnswerRequestParts(answerInput);
  let calls = 0;
  const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async (_url, init) => {
    calls++; assert.deepEqual(JSON.parse(String(init?.body)), originalParts.body);
    mutable.evidence[0].text = 'Changed during transport.'; mutable.policy.instructions = 'Changed during transport.';
    return response(RUNTIME_POLICY_ANSWER_TOOL, answer);
  } });
  try {
    const result = await provider.answerRuntimePolicy(mutable);
    assert.equal(result.policySha256, policy.instructionSha256); assert.deepEqual(result.answer, answer);
    assert.deepEqual(await provider.answerRuntimePolicy(answerInput), result);
    for (const changed of [{ ...answerInput, caseId: 'wrong-case' }, { ...answerInput, validationPacketSha256: sha('changed packet') }, { ...answerInput, policy: { ...policy, id: 'changed-policy' } }]) await assert.rejects(provider.answerRuntimePolicy(changed), /reconciliation/);
    const receipt = provider.receipt(answerInput.runId)!;
    await assert.rejects(async () => replayRuntimeAnswerReceipt({ ...answerInput, runId: 'another-run' }, receipt), /reconciliation/);
    for (const altered of [{ ...receipt, id: '' }, { ...receipt, kind: 'product_answer' }, { ...receipt, status: 'interrupted' }, { ...receipt, model: 'unexpected-model' }, { ...receipt, error_code: 'unknown' }]) assert.throws(() => replayRuntimeAnswerReceipt(answerInput, altered), /reconciliation/);
    const document = JSON.parse(receipt.receipt_json!);
    for (const alteration of [{ mode: 'synthetic' }, { accounting: 'no_provider_call' }, { policySha256: sha('other instructions') }, { operationRunId: 'other-run' }]) assert.throws(() => replayRuntimeAnswerReceipt(answerInput, { ...receipt, receipt_json: JSON.stringify({ ...document, ...alteration }) }), /reconciliation/);
    assert.equal(calls, 1);
  } finally { provider.close(); }
});

test('invalid and unknown runtime phases never redispatch, and full thirteen-call capacity is explicit', async () => {
  assert.equal(RUNTIME_POLICY_CALL_CEILING, 13);
  for (const behavior of ['invalid', 'unknown'] as const) {
    let calls = 0;
    const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async () => { calls++; if (behavior === 'unknown') throw new Error('SYNTHETIC lost response'); return response(RUNTIME_POLICY_ANSWER_TOOL, { ...answer, citations: [{ passageId: 'absent-source', quote: 'Invented quote.' }] }); } });
    try {
      assert.equal(provider.capacity(13).ready, true);
      await assert.rejects(provider.answerRuntimePolicy(answerInput));
      await assert.rejects(provider.answerRuntimePolicy(answerInput), /reconciliation/);
      assert.equal(calls, 1); assert.ok(provider.receipt(answerInput.runId));
      assert.equal(provider.capacity(20).ready, false);
    } finally { provider.close(); }
  }
  const exhausted = new SapiomFeedbackProvider({ ...options, callLimit: 12, fetchImpl: async () => { throw new Error('SYNTHETIC forbidden dispatch'); } });
  try { assert.equal(exhausted.capacity(13).ready, false); } finally { exhausted.close(); }
});

test('pending phase excludes simultaneous replay and unknown outcome stays bound across restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-policy-provider-')), dbPath = join(directory, 'ledger.sqlite');
  let release!: () => void, calls = 0;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const provider = new SapiomFeedbackProvider({ ...options, dbPath, fetchImpl: async () => { calls++; await waiting; throw new Error('SYNTHETIC unknown result'); } });
  try {
    const pending = provider.suggestRuntimePolicy(proposal);
    await assert.rejects(provider.suggestRuntimePolicy(proposal), /reconciliation/);
    assert.equal(JSON.parse(provider.receipt(proposal.runId)!.receipt_json!).groupSha256, proposal.groupSha256);
    release(); await assert.rejects(pending);
  } finally { release(); provider.close(); }
  const restarted = new SapiomFeedbackProvider({ ...options, dbPath, enabled: false, fetchImpl: async () => { throw new Error('SYNTHETIC forbidden redispatch'); } });
  try {
    restarted.recoverInterruptedCalls();
    await assert.rejects(restarted.suggestRuntimePolicy(proposal), /reconciliation/); assert.equal(calls, 1);
  } finally { restarted.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('runtime calls use shared provider exclusion and preserve successful replay after restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-policy-shared-ledger-')), dbPath = join(directory, 'ledger.sqlite');
  let calls = 0;
  const first = new SapiomFeedbackProvider({ ...options, dbPath, fetchImpl: async () => { calls++; return response(RUNTIME_POLICY_PROPOSAL_TOOL, addition); } });
  const second = new SapiomFeedbackProvider({ ...options, dbPath, fetchImpl: async () => { throw new Error('SYNTHETIC forbidden second-owner dispatch'); } });
  let result;
  try {
    result = await first.suggestRuntimePolicy(proposal);
    await assert.rejects(second.answerRuntimePolicy(answerInput), /owned by another provider/);
    assert.equal(second.receipt(answerInput.runId), undefined); assert.equal(calls, 1);
  } finally { second.close(); first.close(); }
  const restarted = new SapiomFeedbackProvider({ ...options, dbPath, enabled: false, fetchImpl: async () => { throw new Error('SYNTHETIC forbidden replay dispatch'); } });
  try { assert.deepEqual(await restarted.suggestRuntimePolicy(proposal), result); assert.equal(calls, 1); }
  finally { restarted.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('synthetic policy addition and paired answers have strict labeled replay and frozen fictional controls', async () => {
  const provider = new SyntheticAnswerProvider(':memory:'), syntheticProposal = { ...proposal, parent: { ...policy, mode: 'synthetic' as const } }, syntheticAnswer = { ...answerInput, policy: { ...policy, mode: 'synthetic' as const } };
  try {
    const result = await provider.suggestRuntimePolicy(syntheticProposal);
    assert.deepEqual(await provider.suggestRuntimePolicy(syntheticProposal), result);
    assert.equal(result.model, 'synthetic-fixture'); assert.equal(result.usage, null);
    assert.match(result.rationale, /SYNTHETIC/);
    const old = await provider.answerRuntimePolicy(syntheticAnswer);
    const candidateInstructions = `${instructions}\n\nRuntime answer-policy addition:\n${result.instructions}`;
    const candidate = await provider.answerRuntimePolicy({ ...syntheticAnswer, runId: 'candidate-runtime-answer', policy: { id: 'fixture-candidate-policy', instructions: candidateInstructions, instructionSha256: sha(candidateInstructions), mode: 'synthetic' } });
    assert.match(old.answer.answer, /ten cups/); assert.match(candidate.answer.answer, /twelve cups/);
    const oldGrade = await provider.gradeClaimSupport({ runId: 'old-grade', question: answerInput.question, product: answerInput.product, evidence: answerInput.evidence, answer: old.answer });
    const newGrade = await provider.gradeClaimSupport({ runId: 'new-grade', question: answerInput.question, product: answerInput.product, evidence: answerInput.evidence, answer: candidate.answer });
    assert.equal(oldGrade.assessment.disposition, 'repair'); assert.equal(newGrade.assessment.disposition, 'pass');
    assert.equal(newGrade.assessment.calibration, 'not_measured'); assert.equal(newGrade.assessment.qualityClaimEligible, false);
    const abstention = await provider.gradeClaimSupport({ runId: 'blanket-abstain', question: answerInput.question, product: answerInput.product, evidence: answerInput.evidence, answer: { status: 'insufficient_evidence', answer: 'SYNTHETIC runtime fixture abstention: The requested fact is absent from this fictional source packet.', citations: [] } });
    assert.equal(abstention.assessment.uncertaintyHandling, 'unnecessary_abstention'); assert.equal(abstention.assessment.disposition, 'repair');
    const receipt = provider.receipt(syntheticProposal.runId)!;
    assert.throws(() => replayRuntimeProposalReceipt(syntheticProposal, receipt, 'live'), /reconciliation/);
    await assert.rejects(provider.answerRuntimePolicy(answerInput), /mode/);
  } finally { provider.close(); }
});

test('invalid policy/group bindings fail before provider can reserve or dispatch', async () => {
  let calls = 0;
  const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async () => { calls++; return response(RUNTIME_POLICY_PROPOSAL_TOOL, addition); } });
  try {
    await assert.rejects(provider.suggestRuntimePolicy({ ...proposal, parent: { ...policy, instructionSha256: sha('not these instructions') } }), /instruction hash/);
    await assert.rejects(provider.suggestRuntimePolicy({ ...proposal, failure: { ...proposal.failure, bindings: [...proposal.failure.bindings.slice(0, 2), proposal.failure.bindings[0]] } }), /independent/);
    await assert.rejects(provider.suggestRuntimePolicy({ ...proposal, failure: { ...proposal.failure, bindings: proposal.failure.bindings.map(item => ({ ...item, policyId: 'other-parent' })) } }), /parent policy/);
    assert.equal(provider.receipt(proposal.runId), undefined); assert.equal(calls, 0);
  } finally { provider.close(); }
});
