import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { SapiomFeedbackProvider, revisionRequestBody, type RevisionInput } from './feedback-provider.ts';
import { SyntheticAnswerProvider } from './synthetic-answer-provider.ts';
import { CLAIM_SUPPORT_TOOL, claimSupportAnswerUnits, claimSupportRequestBody, type ClaimSupportInput } from './claim-support.ts';

const input: ClaimSupportInput = { runId: 'fixture-grade', question: 'What is the listed capacity?', product: { id: 'fixture-bottle', title: 'Synthetic bottle' }, answer: { answer: 'The listing states 600 ml.', status: 'answered', citations: [{ passageId: 'p1', quote: 'This bottle holds 600 ml.' }] }, evidence: [{ id: 'p1', source: 'listing', text: 'This bottle holds 600 ml.' }] };
function gradeOutput(value: ClaimSupportInput = input) { return { units: claimSupportAnswerUnits(value.answer.answer).map(unit => ({ unitId: unit.id, verdict: 'supported', evidence: [{ sourceId: 'p1', quote: value.evidence[0].text, relation: 'supports' }], reason: 'SYNTHETIC mocked assessment.' })), questionCoverage: 'complete', answerability: 'answerable', correctness: 'consistent_with_sources', uncertaintyHandling: 'appropriate', reason: 'SYNTHETIC mocked assessment; no live judge.' }; }
function response(output: unknown, kind = CLAIM_SUPPORT_TOOL) { return new Response(JSON.stringify({ model: 'gpt-luna', usage: { prompt_tokens: 100, completion_tokens: 80 }, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: kind, arguments: JSON.stringify(output) } }] } }] })); }
const options = { enabled: true, apiKey: 'synthetic-placeholder', credentialsFile: '', capUsd: 1, allowancePerCallUsd: .1, callLimit: 3, dbPath: ':memory:' };

test('grade sends the exact bound request once and replays the complete valid receipt', async () => {
  let calls = 0;
  const provider = new SapiomFeedbackProvider({ ...options, callLimit: 1, fetchImpl: async (_url, init) => { calls++; assert.deepEqual(JSON.parse(String(init?.body)), claimSupportRequestBody(input)); return response(gradeOutput()); } });
  try {
    const first = await provider.gradeClaimSupport(input), replay = await provider.gradeClaimSupport(input);
    assert.deepEqual(replay, first); assert.equal(calls, 1); assert.equal(provider.readiness().ready, false);
    const receipt = JSON.parse(provider.receipt(input.runId)!.receipt_json!);
    assert.equal(receipt.requestSha256, first.requestSha256); assert.equal(receipt.answerSha256, first.answerSha256); assert.equal(receipt.assessmentKind, 'ai_claim_support_estimate');
    await assert.rejects(provider.gradeClaimSupport({ ...input, question: 'Different question?' }), /reconciliation/); assert.equal(calls, 1);
  } finally { provider.close(); }
});

test('invalid and unknown grade attempts never redispatch, including concurrent same-run calls', async () => {
  for (const behavior of ['invalid', 'unknown'] as const) {
    let calls = 0;
    const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async () => { calls++; if (behavior === 'unknown') throw new Error('SYNTHETIC lost response'); return response({ ...gradeOutput(), units: [] }); } });
    try { await assert.rejects(provider.gradeClaimSupport(input)); await assert.rejects(provider.gradeClaimSupport(input), /reconciliation/); assert.equal(calls, 1); assert.ok(provider.receipt(input.runId)); } finally { provider.close(); }
  }
  let release!: () => void, calls = 0;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async () => { calls++; await waiting; return response(gradeOutput()); } });
  try { const pending = provider.gradeClaimSupport(input); await assert.rejects(provider.gradeClaimSupport(input), /reconciliation/); release(); await pending; assert.equal(calls, 1); } finally { release(); provider.close(); }
});

test('grade input is frozen across transport and a valid receipt replays after restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'claim-support-restart-')), dbPath = join(directory, 'ledger.sqlite'), mutable = structuredClone(input);
  let calls = 0;
  const provider = new SapiomFeedbackProvider({ ...options, dbPath, fetchImpl: async () => { calls++; mutable.evidence[0].text = 'Changed after dispatch.'; return response(gradeOutput(input)); } });
  let first;
  try { first = await provider.gradeClaimSupport(mutable); assert.equal(first.assessment.disposition, 'pass'); } finally { provider.close(); }
  const restarted = new SapiomFeedbackProvider({ ...options, dbPath, enabled: false, fetchImpl: async () => { throw new Error('SYNTHETIC forbidden redispatch'); } });
  try { assert.deepEqual(await restarted.gradeClaimSupport(input), first); assert.equal(calls, 1); } finally { restarted.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('automatic repair preserves the legacy body, adds exact receipt binding and never repeats uncertain attempts', async () => {
  const revision: RevisionInput = { runId: 'fixture-auto-repair', question: input.question, product: input.product, rejectedAnswer: 'Unsupported capacity.', critique: 'Restate the listed capacity without changing the value.', evidence: input.evidence };
  let calls = 0;
  const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async (_url, init) => { calls++; assert.deepEqual(JSON.parse(String(init?.body)), revisionRequestBody(revision)); return response(input.answer, 'answer_revision_v1' as typeof CLAIM_SUPPORT_TOOL); } });
  try {
    const result = await provider.reviseAutomatic(revision); assert.deepEqual(await provider.reviseAutomatic(revision), result);
    assert.equal(result.requestSha256, createHash('sha256').update(JSON.stringify(revisionRequestBody(revision))).digest('hex'));
    await assert.rejects(provider.reviseAutomatic({ ...revision, critique: 'A changed critique.' }), /reconciliation/); assert.equal(calls, 1);
  } finally { provider.close(); }
  const lost = new SapiomFeedbackProvider({ ...options, fetchImpl: async () => { throw new Error('SYNTHETIC lost repair result'); } });
  try { await assert.rejects(lost.reviseAutomatic(revision)); await assert.rejects(lost.reviseAutomatic(revision), /reconciliation/); } finally { lost.close(); }
});

test('synthetic fixture repair is visibly scripted while ordinary sources remain uncertain', async () => {
  const provider = new SyntheticAnswerProvider(':memory:');
  const fixture: ClaimSupportInput = { ...input, evidence: [{ ...input.evidence[0], text: 'SYNTHETIC fixture: This bottle holds 600 ml and has a twist cap.' }] };
  try {
    const ordinary = await provider.gradeClaimSupport(input); assert.equal(ordinary.assessment.disposition, 'uncertain');
    const draftAnswer = { answer: 'SYNTHETIC draft — scripted source excerpts, not a model-generated answer.', status: 'answered' as const, citations: [{ passageId: 'p1', quote: fixture.evidence[0].text }] };
    const draftInput = { ...fixture, runId: 'fixture-draft-grade', answer: draftAnswer }, draft = await provider.gradeClaimSupport(draftInput);
    assert.equal(draft.assessment.disposition, 'repair'); assert.equal(draft.assessment.assessmentKind, 'synthetic_scripted_claim_support'); assert.equal(draft.assessment.qualityClaimEligible, false);
    assert.deepEqual(await provider.gradeClaimSupport(draftInput), draft);
    const repairInput: RevisionInput = { runId: 'fixture-synthetic-repair', question: fixture.question, product: fixture.product, rejectedAnswer: draftAnswer.answer, critique: 'SYNTHETIC bounded repair workflow control.', evidence: fixture.evidence };
    const repaired = await provider.reviseAutomatic(repairInput), graded = await provider.gradeClaimSupport({ ...fixture, runId: 'fixture-repaired-grade', answer: repaired.answer });
    assert.equal(graded.assessment.disposition, 'pass'); assert.equal(graded.model, 'synthetic-fixture'); assert.equal(graded.usage, null);
    assert.deepEqual(await provider.reviseAutomatic(repairInput), repaired); assert.equal(JSON.parse(provider.receipt(repairInput.runId)!.receipt_json!).requestSha256, repaired.requestSha256);
    await assert.rejects(provider.gradeClaimSupport({ ...draftInput, question: 'Changed?' }), /reconciliation/);
  } finally { provider.close(); }
});
