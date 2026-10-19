import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProductWorkspace, verifyWorkspaceRunGeneration } from './product-workspace.ts';
import { SapiomFeedbackProvider } from './feedback-provider.ts';
import { WORKSPACE_GENERATION_CONTRACT, workspaceGenerationPromptIdentity } from './workspace-generation.ts';
import { workspaceQuestionRequestHash } from './workspace-generation-identity.ts';
import { DatabaseSync } from 'node:sqlite';
import { WORKSPACE_SOURCE_COVERAGE_CONTRACT } from './workspace-source-coverage.ts';
import { WORKSPACE_SOURCE_COVERAGE_V2_CONTRACT } from './workspace-source-coverage-v2.ts';
import type { ProductCorpus, LoopRetriever } from './loop-types.ts';

// Injected ranking/transport establish the actual workspace receipt boundary,
// not natural retrieval coverage or answer quality. No network or real key.
const oneParent = (corpus: ProductCorpus): LoopRetriever => ({ close() {}, async retrieve() {
  return { passages: [{ ...corpus.passages[0], lexicalRank: 1, semanticRank: 1, score: 1 }], durationMs: 0, method: 'SYNTHETIC one-parent fixture', embeddingModel: 'none', corpusVersion: corpus.version };
} });

for (const option of [true, 'v2'] as const) test(`opt-in source coverage ${option} reaches generation and survives receipt recovery`, async () => {
  const selectedContract = option === 'v2' ? WORKSPACE_SOURCE_COVERAGE_V2_CONTRACT : WORKSPACE_SOURCE_COVERAGE_CONTRACT;
  const directory = mkdtempSync(join(tmpdir(), 'workspace-source-coverage-')), dbPath = join(directory, 'workspace.sqlite');
  const bodies: any[] = [];
  const provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'SYNTHETIC-TEST-ONLY', credentialsFile: '', dbPath: join(directory, 'ledger.sqlite'), capUsd: 2, callLimit: 10,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body)); bodies.push(body); const payload = JSON.parse(body.messages[1].content);
      return new Response(JSON.stringify({ model: 'gpt-luna', usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: body.tool_choice.function.name, arguments: JSON.stringify({ answer: 'SYNTHETIC scripted answer; quality is not measured.', status: 'answered', citations: [payload.quoteOptions.at(-1).id] }) } }] } }] }));
    }
  });
  let workspace = new ProductWorkspace(dbPath, provider, oneParent);
  try {
    const product = workspace.createProduct({ title: 'SYNTHETIC ZX-100 replacement item', sources: [
      { label: 'review', text: 'SYNTHETIC customer report: this did not fit my other device.', originalQuestion: 'Will this fit model ZX-300?' },
      { label: 'attribute', text: '{"item_dimensions":{"width":8,"length":11.7,"height":1.8,"unit":"inches"}}' },
      { label: 'attribute', text: '{"model_name":"SYNTHETIC ZX-100 model name"}' },
      { label: 'attribute', text: '{"model_number":"SYNTHETIC ZX-200 model number"}' }
    ] });
    const input = { productId: product.id, question: 'What are its dimensions, and is model ZX-100 the same as model ZX-200?', mode: 'live' };
    const original = await workspace.ask(input, undefined, { idempotencyKey: 'baseline' });
    assert.equal(original.status, 'completed'); assert.equal(original.sourceCoverage, undefined); assert.equal(original.generationPassages!.length, 1);
    workspace.close();
    workspace = new ProductWorkspace(dbPath, provider, oneParent, undefined, { sourceCoverage: option, fault(boundary) { if (boundary === 'after_receipt') throw new Error('SYNTHETIC receipt interruption'); } });
    await assert.rejects(workspace.ask({ ...input, mode: 'preview' }), /source coverage requires/);
    await assert.rejects(workspace.ask(input, undefined, { idempotencyKey: 'candidate' }), /SYNTHETIC receipt interruption/);
    const interrupted = workspace.proofRuns().find(run => run.requestIdentity?.idempotencyKey === 'candidate')!;
    assert.equal(interrupted.sourceCoverage?.contract, selectedContract); assert.equal(interrupted.generationPassages!.length, 4);
    assert.deepEqual(interrupted.generationPassages![0], original.generationPassages![0]);
    assert.equal(interrupted.generationProtocol, WORKSPACE_GENERATION_CONTRACT);
    const payload = JSON.parse(bodies[1].messages[1].content);
    for (const source of product.sources) assert.ok(payload.evidence.some((s: any) => s.id === source.id && s.text === source.text));
    assert.equal(bodies[0].messages[0].content, bodies[1].messages[0].content);
    assert.equal(interrupted.generation!.binding.systemInstructionsSha256, workspaceGenerationPromptIdentity().systemInstructionsSha256);
    const receiptId = provider.receipt(interrupted.id)!.id;
    workspace.close(); workspace = new ProductWorkspace(dbPath, provider, oneParent);
    await assert.rejects(workspace.ask(input, undefined, { idempotencyKey: 'candidate' }), /different question request/);
    const recovered = workspace.proofRuns().find(run => run.id === interrupted.id)!;
    workspace.close(); workspace = new ProductWorkspace(dbPath, provider, oneParent, undefined, { sourceCoverage: option });
    assert.equal((await workspace.ask(input, undefined, { idempotencyKey: 'candidate' })).id, recovered.id);
    await assert.rejects(workspace.ask(input, undefined, { idempotencyKey: 'baseline' }), /different question request/);
    workspace.close(); workspace = new ProductWorkspace(dbPath, provider, oneParent, undefined, { sourceCoverage: option === 'v2' ? true : 'v2' });
    await assert.rejects(workspace.ask(input, undefined, { idempotencyKey: 'candidate' }), /different question request/);
    workspace.close(); workspace = new ProductWorkspace(dbPath, provider, oneParent, undefined, { sourceCoverage: option });
    assert.equal(recovered.requestIdentity?.retrievalContract, selectedContract);
    assert.equal(recovered.id, interrupted.id); assert.equal(recovered.status, 'completed'); assert.equal(recovered.generation?.recovered, true);
    assert.equal(provider.receipt(recovered.id)?.id, receiptId); assert.equal(bodies.length, 2); verifyWorkspaceRunGeneration(recovered);
    assert.deepEqual(recovered.sourceCoverage, interrupted.sourceCoverage); assert.deepEqual(recovered.generationPassages, interrupted.generationPassages);
    assert.equal(recovered.answer!.citations[0].quote, product.sources.find(s => s.id === recovered.answer!.citations[0].passageId)!.text);
    const db = new DatabaseSync(dbPath); try { db.prepare('DELETE FROM workspace_question_requests').run(); } finally { db.close(); }
    assert.equal((await workspace.ask(input, undefined, { idempotencyKey: 'candidate' })).id, recovered.id);
    workspace.close(); workspace = new ProductWorkspace(dbPath, provider, oneParent);
    await assert.rejects(workspace.ask(input, undefined, { idempotencyKey: 'candidate' }), /saved request identity/);
    const nextDefault = await workspace.ask(input, undefined, { idempotencyKey: 'next-default' });
    assert.equal(nextDefault.sourceCoverage, undefined); assert.equal(nextDefault.generationPassages!.length, 1); assert.equal(bodies.length, 3);
    await assert.rejects(workspace.ask({ ...input, sourceCoverage: true }), /Unrecognized key/); assert.equal(bodies.length, 3);
  } finally { workspace.close(); provider.close(); rmSync(directory, { recursive: true, force: true }); }
});


test('retrieval contract identity is additive, strict and cannot alter historical default request bytes', () => {
  const input = { productId: 'synthetic-identity', question: 'SYNTHETIC dimensions?', mode: 'live' as const };
  const plain = workspaceQuestionRequestHash(input);
  assert.equal(plain, workspaceQuestionRequestHash(input, false, WORKSPACE_GENERATION_CONTRACT));
  assert.notEqual(plain, workspaceQuestionRequestHash(input, false, WORKSPACE_GENERATION_CONTRACT, WORKSPACE_SOURCE_COVERAGE_CONTRACT));
  const v2 = workspaceQuestionRequestHash(input, false, WORKSPACE_GENERATION_CONTRACT, WORKSPACE_SOURCE_COVERAGE_V2_CONTRACT);
  assert.notEqual(plain, v2);
  assert.notEqual(v2, workspaceQuestionRequestHash(input, false, WORKSPACE_GENERATION_CONTRACT, WORKSPACE_SOURCE_COVERAGE_CONTRACT));
  assert.throws(() => workspaceQuestionRequestHash(input, false, WORKSPACE_GENERATION_CONTRACT, 'unknown' as typeof WORKSPACE_SOURCE_COVERAGE_CONTRACT), /Unknown workspace retrieval/);
});
