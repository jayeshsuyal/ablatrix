import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { textHash } from './product-corpus.ts';
import { SapiomFeedbackProvider } from './feedback-provider.ts';
import { sourceCitationOptions } from './citation-options.ts';
import { WORKSPACE_GENERATION_CONTRACT, WORKSPACE_SOURCE_CALIBRATION_CONTRACT, workspaceGenerationContract, workspaceGenerationParts,
  workspaceGenerationPromptIdentity, replayWorkspaceGenerationReceipt, type WorkspaceGenerationInput } from './workspace-generation.ts';
import { WORKSPACE_UNCERTAINTY_CONTRACT, WORKSPACE_UNCERTAINTY_TOOL, WORKSPACE_UNCERTAINTY_RULES, workspaceUncertaintyInstructions } from './workspace-uncertainty-policy.ts';
import { diagnosticHash, prepareThreeContext, verifyThreeContext } from './three-context-diagnostic.ts';
import { syntheticPreparation } from '../scripts/three-context-mock.ts';

const observedText = 'SYNTHETIC: I switched it off after three hours; it was still working.';
const fixtureInput: WorkspaceGenerationInput = {
  runId: 'SYNTHETIC-uncertainty-contract', question: 'How long does it last on average?',
  product: { id: 'SYNTHETIC-Arven-L7', title: 'SYNTHETIC Arven L7 task light', split: 'development' },
  policy: { id: 'SYNTHETIC-policy', parentId: null, instructions: 'SYNTHETIC shared policy: state only source-supported facts and preserve source conditions.', rationale: 'SYNTHETIC protocol fixture', feedbackRunIds: [], status: 'baseline', mode: 'live', createdAt: '2026-10-19T00:00:00Z' },
  passages: [{ id: 'SYNTHETIC-observation', productId: 'SYNTHETIC-Arven-L7', source: 'cqa', reference: 'SYNTHETIC source', text: observedText,
    originalQuestion: 'How long did the Arven L7 light operate?', sha256: textHash(observedText), lexicalRank: 1, semanticRank: null, score: 1 }]
};
const candidateInput = (): WorkspaceGenerationInput => ({ ...structuredClone(fixtureInput), generationContract: WORKSPACE_UNCERTAINTY_CONTRACT });

test('pre-change Git output bytes remain exact for default v1, explicit v1 and historical calibration v2', () => {
  // Recorded by executing the unchanged Git HEAD d9e59966361466860a8130e1b2d0b24406a56e0b
  // before this change. These complete-return/body hashes do not need Git ancestry at replay.
  const baseline = workspaceGenerationParts(fixtureInput), calibration = workspaceGenerationParts({ ...fixtureInput, generationContract: WORKSPACE_SOURCE_CALIBRATION_CONTRACT });
  assert.equal(textHash(JSON.stringify(baseline)), 'd05513a4158545fb86c88866bdae3b92ae68e6a56257a25541161128c5d1615b');
  assert.equal(textHash(JSON.stringify(baseline.body)), '46f53321b2e702862bd36254ed512f7fcaff0adf19b4b8e1c6d1609defee1274');
  assert.equal(textHash(JSON.stringify(calibration)), 'e61c7db196ae766b208e8c6ee35e9f92658d54fdb79279d4ffb00e2ed905f789');
  assert.equal(textHash(JSON.stringify(calibration.body)), '9cabf51c12de9aa4ec635789bbef2102c98db09638b1e08050512bdd7a725d7d');
  assert.deepEqual(workspaceGenerationParts({ ...fixtureInput, generationContract: WORKSPACE_GENERATION_CONTRACT }), baseline);
  assert.equal(workspaceGenerationContract(), WORKSPACE_GENERATION_CONTRACT);
});
test('uncertainty opt-in changes declared instruction/tool identity with identical source, schema, budget, model and runtime policy', () => {
  const baseline = workspaceGenerationParts(fixtureInput), candidate = workspaceGenerationParts(candidateInput());
  assert.equal(candidate.tool, WORKSPACE_UNCERTAINTY_TOOL); assert.equal(candidate.binding.contract, WORKSPACE_UNCERTAINTY_CONTRACT);
  assert.notEqual(candidate.binding.systemInstructionsSha256, baseline.binding.systemInstructionsSha256); assert.notEqual(candidate.binding.requestSha256, baseline.binding.requestSha256);
  for (const key of ['sourceContextSha256', 'optionSetSha256', 'responseSchemaSha256', 'policySha256', 'operationRunId'] as const) assert.equal(candidate.binding[key], baseline.binding[key]);
  const normalize = (body: typeof candidate.body) => {
    const copy = structuredClone(body), payload = JSON.parse(copy.messages[1]!.content); delete payload.promptVersion;
    copy.messages[1]!.content = JSON.stringify(payload); copy.messages[0]!.content = '<separately-versioned-system>';
    copy.tools[0]!.function.name = baseline.tool; copy.tool_choice.function.name = baseline.tool; return copy;
  };
  assert.deepEqual(normalize(candidate.body), normalize(baseline.body));
  assert.equal(candidate.payload.evidence[0]!.originalQuestion, fixtureInput.passages[0]!.originalQuestion);
  assert.equal(candidate.body.max_tokens, baseline.body.max_tokens); assert.equal(candidate.body.model, baseline.body.model);
});
test('generic uncertainty instructions contain no fixture facts and fail clearly if the historical rule anchor changes', () => {
  const other = candidateInput(); other.product = { ...other.product, id: 'SYNTHETIC-unrelated', title: 'SYNTHETIC unrelated hand pump' };
  other.question = 'Does this fit model K9?'; other.passages = other.passages.map(p => ({ ...p, productId: other.product.id }));
  assert.equal(workspaceGenerationParts(other).systemInstructions, workspaceGenerationParts(candidateInput()).systemInstructions, 'Instructions do not specialize to the exposed product/question.');
  assert.ok(!WORKSPACE_UNCERTAINTY_RULES.includes(observedText)); assert.ok(!WORKSPACE_UNCERTAINTY_RULES.includes(fixtureInput.product.title));
  assert.doesNotMatch(WORKSPACE_UNCERTAINTY_RULES, /SYNTHETIC|B0171UWG3A|torch|\d/);
  assert.throws(() => workspaceUncertaintyInstructions('Unrecognized historical instructions.'), /exact historical scope-rule anchor/);
});

function harness(behavior: 'valid' | 'wrong_scope' | 'malformed' = 'valid') {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-uncertainty-SYNTHETIC-')), dbPath = join(directory, 'ledger.sqlite');
  let calls = 0, captured: ReturnType<typeof workspaceGenerationParts>['body'] | undefined;
  const options = { enabled: true, apiKey: 'SYNTHETIC-offline-placeholder', credentialsFile: '', dbPath, capUsd: 1, priorSpendUsd: 0, allowancePerCallUsd: .1, callLimit: 3,
    fetchImpl: async (_url: string | URL | Request, init?: RequestInit) => {
      calls++; captured = JSON.parse(String(init?.body)); const body = captured!, payload = JSON.parse(body.messages[1]!.content);
      const wrong = sourceCitationOptions({ productId: payload.product.id, question: 'Another original request?', evidence: payload.evidence })[0]!.id;
      const output = behavior === 'malformed' ? { answer: 'SYNTHETIC invalid output.', status: 'answered', citations: [{ id: payload.quoteOptions[0].id }] }
        : { answer: 'SYNTHETIC one report ended when its user stopped the device; a representative average is not established.', status: 'insufficient_evidence', citations: [behavior === 'wrong_scope' ? wrong : payload.quoteOptions[0].id] };
      return new Response(JSON.stringify({ model: 'gpt-luna', usage: { prompt_tokens: 17, completion_tokens: 9 }, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: body.tools[0]!.function.name, arguments: JSON.stringify(output) } }] } }] }));
    } };
  let provider = new SapiomFeedbackProvider(options);
  return { get provider() { return provider; }, get calls() { return calls; }, get captured() { return captured; }, reopen() { provider.close(); provider = new SapiomFeedbackProvider(options); }, close() { provider.close(); rmSync(directory, { recursive: true, force: true }); } };
}
test('actual provider with mocked transport binds new contract and scoped citation, then replays a durable receipt with no second dispatch', async () => {
  const h = harness(), input = candidateInput(), parts = workspaceGenerationParts(input);
  try {
    const output = await h.provider.answerWorkspace(input), receipt = h.provider.receipt(input.runId)!;
    assert.deepEqual(h.captured, parts.body); assert.equal(h.calls, 1); assert.equal(receipt.kind, WORKSPACE_UNCERTAINTY_TOOL);
    assert.equal(output.answer.citations[0]!.quote, observedText); assert.deepEqual(output.usage, { inputTokens: 17, outputTokens: 9 });
    const body = JSON.parse(receipt.receipt_json!); for (const [key, value] of Object.entries(parts.binding)) assert.equal(body[key], value);
    h.reopen(); assert.deepEqual(await h.provider.answerWorkspace(input), output); assert.equal(h.calls, 1);
    for (const contract of [WORKSPACE_GENERATION_CONTRACT, WORKSPACE_SOURCE_CALIBRATION_CONTRACT]) {
      await assert.rejects(h.provider.answerWorkspace({ ...input, generationContract: contract }), /reconciliation/);
      assert.throws(() => replayWorkspaceGenerationReceipt({ ...input, generationContract: contract }, receipt, 'live'), /reconciliation/);
    }
    const changed = structuredClone(input); changed.passages[0]!.originalQuestion = 'Does the Arven L8 fit model K9?';
    await assert.rejects(h.provider.answerWorkspace(changed), /reconciliation/);
    assert.equal(h.calls, 1); assert.equal(h.provider.receipt(input.runId)!.id, receipt.id);
  } finally { h.close(); }
});
test('wrong-context IDs and malformed outputs remain recorded failures without retry; unsupported contracts never dispatch', async () => {
  for (const behavior of ['wrong_scope', 'malformed'] as const) {
    const h = harness(behavior), input = candidateInput();
    try {
      await assert.rejects(h.provider.answerWorkspace(input), /failed exact flat source-ID validation/); assert.equal(h.calls, 1);
      assert.equal(h.provider.receipt(input.runId)?.error_code, 'output_validation'); h.reopen();
      await assert.rejects(h.provider.answerWorkspace(input), /reconciliation/); assert.equal(h.calls, 1);
    } finally { h.close(); }
  }
  const h = harness();
  try {
    const input = { ...candidateInput(), generationContract: 'unknown-contract' as typeof WORKSPACE_UNCERTAINTY_CONTRACT };
    await assert.rejects(h.provider.answerWorkspace(input), /Unknown workspace generation contract/); assert.equal(h.calls, 0); assert.equal(h.provider.receipt(input.runId), undefined);
  } finally { h.close(); }
});
test('omitted three-context preparation is byte-identical to Git pre-change while opt-in uses one uniform prompt in every arm', () => {
  const historical = prepareThreeContext(syntheticPreparation());
  assert.equal(historical.sha256, '82dab32ccf2c73d57d0c0091a6aaeb1e137d3f6517c6f6349e4ad482e9a24978');
  assert.equal(textHash(JSON.stringify(historical)), 'ac412352682a6016dae2307a20b5851e71c1aa57d88558159fe080dcf988ee71');
  assert.ok(historical.document.slots.every(s => !Object.hasOwn(s.input, 'generationContract')));
  const p = syntheticPreparation(); p.generationContract = WORKSPACE_UNCERTAINTY_CONTRACT; const opted = prepareThreeContext(p);
  for (const slot of opted.document.slots) {
    assert.equal(slot.input.generationContract, WORKSPACE_UNCERTAINTY_CONTRACT); assert.equal(slot.binding.contract, WORKSPACE_UNCERTAINTY_CONTRACT);
    assert.equal(slot.binding.systemInstructionsSha256, workspaceGenerationPromptIdentity(WORKSPACE_UNCERTAINTY_CONTRACT).systemInstructionsSha256);
    assert.equal(slot.body.tools[0]!.function.name, WORKSPACE_UNCERTAINTY_TOOL);
  }
  assert.equal(new Set(opted.document.slots.map(s => s.body.messages[0]!.content)).size, 1); verifyThreeContext(opted);
  const mixed = structuredClone(opted); mixed.document.slots[0]!.input.generationContract = WORKSPACE_GENERATION_CONTRACT; mixed.sha256 = diagnosticHash(mixed.document);
  assert.throws(() => verifyThreeContext(mixed));
  p.generationContract = 'unsupported' as typeof WORKSPACE_UNCERTAINTY_CONTRACT; assert.throws(() => prepareThreeContext(p), /Unknown workspace generation contract/);
});
test('case instruction overrides remain uniform within their three contexts and fall back to the global contract without changing runtime policy or source contexts', () => {
  const p = syntheticPreparation(); p.generationContract = WORKSPACE_UNCERTAINTY_CONTRACT;
  const overridden = structuredClone(p.cases[0]!); overridden.id = 'SYNTHETIC-controlled-case-instance'; overridden.generationContract = WORKSPACE_GENERATION_CONTRACT; p.cases.push(overridden);
  const manifest = prepareThreeContext(p), inheritedRows = manifest.document.slots.filter(s => s.caseId === p.cases[0]!.id), overriddenRows = manifest.document.slots.filter(s => s.caseId === overridden.id);
  assert.equal(inheritedRows.length, 3); assert.equal(overriddenRows.length, 3);
  assert.ok(inheritedRows.every(s => s.binding.contract === WORKSPACE_UNCERTAINTY_CONTRACT)); assert.ok(overriddenRows.every(s => s.binding.contract === WORKSPACE_GENERATION_CONTRACT));
  assert.equal(new Set(overriddenRows.map(s => s.body.messages[0]!.content)).size, 1);
  for (const row of inheritedRows) {
    const control = overriddenRows.find(s => s.arm === row.arm)!;
    assert.deepEqual(row.input.passages, control.input.passages); assert.deepEqual(row.input.policy, control.input.policy);
    for (const key of ['sourceContextSha256', 'optionSetSha256', 'responseSchemaSha256', 'policySha256'] as const) assert.equal(row.binding[key], control.binding[key]);
  }
  verifyThreeContext(manifest);
  p.cases[1]!.generationContract = 'unsupported-case-contract' as typeof WORKSPACE_UNCERTAINTY_CONTRACT;
  assert.throws(() => prepareThreeContext(p), /Unknown workspace generation contract/);
});
