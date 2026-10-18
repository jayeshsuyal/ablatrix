import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ProductWorkspace, verifyWorkspaceRunGeneration, type WorkspaceFaultBoundary } from './product-workspace.ts';
import { SapiomFeedbackProvider, flatSourceIdAnswerRequestBody } from './feedback-provider.ts';
import { SyntheticAnswerProvider } from './synthetic-answer-provider.ts';
import { sourceCitationOptions } from './citation-options.ts';
import { textHash } from './product-corpus.ts';
import { WORKSPACE_GENERATION_CONTRACT, WORKSPACE_GENERATION_TOOL, workspaceGenerationParts, replayWorkspaceGenerationReceipt, type WorkspaceGenerationInput } from './workspace-generation.ts';
import { workspaceSourceChunks, workspaceCompleteSourceContext } from './workspace-retrieval-context.ts';
import type { LoopRetriever, ProductCorpus } from './loop-types.ts';

const retriever = (corpus: ProductCorpus): LoopRetriever => ({ close() {}, async retrieve() { return { passages: corpus.passages.map(item => ({ ...item, lexicalRank: 1, semanticRank: 1, score: 1 })), durationMs: 1, method: 'synthetic-contract', embeddingModel: 'injected-no-model', corpusVersion: corpus.version }; } });
const text = 'SYNTHETIC fixture: The fictional Neral jug holds 2.75 liters and has a removable lid.';
function response(output: unknown) { return new Response(JSON.stringify({ model: 'gpt-luna', usage: { prompt_tokens: 17, completion_tokens: 11 }, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: WORKSPACE_GENERATION_TOOL, arguments: JSON.stringify(output) } }] } }] })); }
function liveHarness(output?: (payload: any) => unknown, fault?: (boundary: WorkspaceFaultBoundary) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'workspace-generation-')), path = join(directory, 'workspace.sqlite'); let calls = 0;
  const provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'SYNTHETIC offline transport placeholder', credentialsFile: '', dbPath: join(directory, 'ledger.sqlite'), capUsd: 10, callLimit: 20, fetchImpl: async (_url, init) => {
    calls++; const body = JSON.parse(String(init?.body)), payload = JSON.parse(body.messages[1].content), db = new DatabaseSync(path);
    try { const saved = JSON.parse((db.prepare('SELECT document FROM workspace_runs WHERE id=?').get(payload.operationRunId) as { document: string }).document);
      assert.equal(saved.generation.phase, 'dispatching'); assert.deepEqual(saved.generation.requestBody, body); assert.equal(saved.generation.binding.requestSha256, textHash(JSON.stringify(body)));
    } finally { db.close(); }
    return response(output ? output(payload) : { answer: 'The fictional jug holds 2.75 liters.', status: 'answered', citations: [payload.quoteOptions[0].id] });
  } });
  let workspace = new ProductWorkspace(path, provider, retriever, undefined, { fault: boundary => fault?.(boundary) });
  const product = workspace.createProduct({ title: 'Fictional Neral jug', sources: [{ label: 'Manual', text }] });
  const input = { productId: product.id, question: 'How much does the fictional jug hold?', mode: 'live' };
  return { directory, path, provider, product, input, get workspace() { return workspace; }, calls: () => calls,
    reopen() { workspace.close(); workspace = new ProductWorkspace(path, provider, retriever); return workspace; },
    close() { workspace.close(); provider.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('actual workspace path binds flat IDs, decimal bodies, policy and request before its one dispatch', async () => {
  const h = liveHarness();
  try {
    const run = await h.workspace.ask(h.input, undefined, { idempotencyKey: 'decimal-request', automaticCheck: true });
    assert.equal(run.status, 'completed'); assert.equal(run.generationProtocol, WORKSPACE_GENERATION_CONTRACT); assert.equal(run.generation?.phase, 'completed');
    assert.equal(run.answer?.citations[0].quote, text); assert.ok(run.answer?.citations[0].quote.includes('2.75'));
    assert.equal(h.calls(), 1); assert.equal(run.reviewHandoff, 'pending'); assert.equal(run.automaticCheckHandoff, 'pending');
    assert.ok(run.finishedAt); assert.ok(run.durationMs! >= 0); assert.equal(h.workspace.proofRuns().length, 1);
    const captured = run.generation!.input, prior = flatSourceIdAnswerRequestBody(captured), parts = workspaceGenerationParts(captured);
    assert.notEqual(parts.binding.requestSha256, textHash(JSON.stringify(prior))); assert.deepEqual(flatSourceIdAnswerRequestBody(captured), prior, 'new generation never mutates historical flat v3 bytes');
    assert.equal((prior.tools[0].function.parameters as any).properties.answer.maxLength, 10_000);
    assert.equal((parts.body.tools[0].function.parameters as any).properties.answer.maxLength, 1500);
    const receipt = h.provider.receipt(run.id)!;
    assert.deepEqual(replayWorkspaceGenerationReceipt(captured, receipt, 'live').answer, run.answer);
    assert.throws(() => replayWorkspaceGenerationReceipt({ ...captured, runId: 'different-operation' }, receipt, 'live'), /reconciliation/);
    assert.throws(() => replayWorkspaceGenerationReceipt(captured, receipt, 'synthetic'), /reconciliation/);
    for (const change of [{ kind: 'product_answer' }, { model: 'unexpected' }, { status: 'interrupted' }, { error_code: 'invalid' }]) assert.throws(() => replayWorkspaceGenerationReceipt(captured, { ...receipt, ...change }, 'live'), /reconciliation/);
    assert.equal((await h.workspace.ask(h.input, undefined, { idempotencyKey: 'decimal-request', automaticCheck: true })).id, run.id);
    assert.equal(h.calls(), 1);
    await assert.rejects(h.workspace.ask({ ...h.input, question: 'A different question?' }, undefined, { idempotencyKey: 'decimal-request', automaticCheck: true }), /different question/);
    await assert.rejects(h.workspace.ask(h.input, undefined, { idempotencyKey: 'decimal-request', automaticCheck: false }), /different question/);
  } finally { h.close(); }
});

test('before dispatch, after intent, after receipt, and after answer persistence have explicit restart states', async () => {
  for (const boundary of ['before_dispatch', 'after_dispatch_intent', 'after_receipt', 'after_answer_persist'] as const) {
    const h = liveHarness(undefined, current => { if (current === boundary) throw new Error(`SYNTHETIC crash at ${boundary}`); });
    try {
      await assert.rejects(h.workspace.ask(h.input, undefined, { idempotencyKey: `request-${boundary}`, automaticCheck: true }), /SYNTHETIC crash/);
      const before = h.workspace.proofRuns()[0]; assert.equal(h.calls(), ['before_dispatch', 'after_dispatch_intent'].includes(boundary) ? 0 : 1);
      h.reopen(); const recovered = h.workspace.proofRuns()[0];
      assert.equal(recovered.id, before.id); assert.equal(h.calls(), ['before_dispatch', 'after_dispatch_intent'].includes(boundary) ? 0 : 1, 'opening a workspace never dispatches');
      if (boundary === 'before_dispatch' || boundary === 'after_dispatch_intent') {
        assert.equal(recovered.status, 'failed'); assert.equal(recovered.answer, null); assert.match(recovered.error!, /not retried/);
      } else {
        assert.equal(recovered.status, 'completed'); assert.equal(recovered.generation?.phase, 'completed');
        assert.equal(recovered.generation?.recovered, boundary === 'after_receipt' ? true : undefined);
        assert.equal(h.workspace.pendingReviewSnapshots().length, 1); assert.equal(h.workspace.automaticCheckSnapshots().length, 1);
        const snapshot = JSON.stringify(h.workspace.reviewSnapshots());
        h.workspace.markReviewHandoff(recovered.id); h.workspace.markAutomaticCheckHandoff(recovered.id, 'enqueued');
        assert.equal(h.workspace.pendingReviewSnapshots().length, 0); assert.equal(h.workspace.automaticCheckSnapshots().length, 0);
        assert.equal(JSON.stringify(h.workspace.reviewSnapshots()), snapshot, 'handoff markers preserve the immutable answer snapshot');
      }
      assert.equal((await h.workspace.ask(h.input, undefined, { idempotencyKey: `request-${boundary}`, automaticCheck: true })).id, recovered.id);
    } finally { h.close(); }
  }
});

test('invalid flat citations and malformed response shapes remain failed receipts without hidden retry', async () => {
  for (const behavior of ['wrong_context', 'duplicate', 'object_shape', 'unknown_field', 'empty', 'oversize'] as const) {
    const h = liveHarness(payload => {
      const output = { answer: 'The fictional jug holds 2.75 liters.', status: 'answered', citations: [payload.quoteOptions[0].id] };
      if (behavior === 'wrong_context') output.citations = [sourceCitationOptions({ productId: payload.product.id, question: 'Another requested context?', evidence: payload.evidence })[0].id];
      if (behavior === 'duplicate') output.citations.push(output.citations[0]);
      if (behavior === 'object_shape') return { ...output, citations: [{ quoteId: output.citations[0] }] };
      if (behavior === 'unknown_field') return { ...output, selectedSource: output.citations[0] };
      if (behavior === 'empty') output.citations = [];
      if (behavior === 'oversize') output.answer = 'x'.repeat(1501);
      return output;
    });
    try {
      const run = await h.workspace.ask(h.input, undefined, { idempotencyKey: 'one-invalid-request' });
      assert.equal(run.status, 'failed'); assert.equal(run.answer, null); assert.equal(run.generation?.phase, 'reconciliation'); assert.equal(h.calls(), 1);
      assert.equal(h.provider.receipt(run.id)?.error_code, 'output_validation');
      h.reopen(); assert.equal(h.workspace.proofRuns()[0].status, 'failed');
      assert.equal((await h.workspace.ask(h.input, undefined, { idempotencyKey: 'one-invalid-request' })).id, run.id); assert.equal(h.calls(), 1);
    } finally { h.close(); }
  }
});

test('unknown reservation and overlapping recovery consume uncertainty permanently', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'workspace-generation-overlap-')), path = join(directory, 'workspace.sqlite');
  let release!: () => void, entered!: () => void, calls = 0; const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'SYNTHETIC offline placeholder', credentialsFile: '', dbPath: join(directory, 'ledger.sqlite'), capUsd: 2, callLimit: 10, fetchImpl: async (_url, init) => {
    calls++; entered(); const payload = JSON.parse(JSON.parse(String(init?.body)).messages[1].content); await gate;
    return response({ answer: 'The fictional jug holds 2.75 liters.', status: 'answered', citations: [payload.quoteOptions[0].id] });
  } });
  const workspace = new ProductWorkspace(path, provider, retriever); let second: ProductWorkspace | undefined;
  try {
    const product = workspace.createProduct({ title: 'Fictional Neral jug', sources: [{ label: 'Manual', text }] }), input = { productId: product.id, question: 'What is the jug capacity?', mode: 'live' };
    const pending = workspace.ask(input, undefined, { idempotencyKey: 'overlap-key' });
    await started; assert.equal(calls, 1);
    const duplicate = await workspace.ask(input, undefined, { idempotencyKey: 'overlap-key' }); assert.equal(duplicate.status, 'retrieving'); assert.equal(calls, 1);
    second = new ProductWorkspace(path, provider, retriever);
    assert.equal(second.proofRuns()[0].status, 'failed'); assert.equal(second.proofRuns()[0].generation?.phase, 'reconciliation');
    release(); const late = await pending;
    assert.equal(late.status, 'failed'); assert.equal(late.answer, null); assert.equal(provider.receipt(late.id)?.status, 'completed');
    assert.equal((await second.ask(input, undefined, { idempotencyKey: 'overlap-key' })).status, 'failed'); assert.equal(calls, 1);
  } finally { release(); second?.close(); workspace.close(); provider.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('constructed 300-byte qualifier loss is reproduced before bounded complete-body restoration', async () => {
  const qualified = `${'Catalog note. '.repeat(17)}The Neral liner is dishwasher safe. This applies only when the red gasket is removed first.`;
  const chunks = workspaceSourceChunks(qualified);
  assert.ok(chunks.length >= 2); assert.ok(chunks[0].includes('dishwasher safe')); assert.ok(!chunks[0].includes('red gasket is removed'));
  assert.ok(chunks.slice(1).join(' ').includes('red gasket is removed'), 'the unmodified indexing boundary separates the claim and its condition');
  const provider = new SyntheticAnswerProvider(':memory:'); let capturedCorpus: ProductCorpus | undefined;
  const workspace = new ProductWorkspace(':memory:', provider, corpus => { capturedCorpus = corpus; return { close() {}, async retrieve() {
    const chosen = [corpus.passages[0], corpus.passages.find(passage => passage.source === 'Conflicting report')!];
    return { passages: chosen.map(item => ({ ...item, lexicalRank: 1, semanticRank: 1, score: 1 })), durationMs: 1, method: 'synthetic-boundary-selection', embeddingModel: 'injected-no-model', corpusVersion: corpus.version };
  } }; });
  try {
    const product = workspace.createProduct({ title: 'Fictional Neral liner', sources: [{ label: 'Manual', text: qualified, originalQuestion: 'Does this apply to model NR-2?' }, { label: 'Conflicting report', text: 'A customer reports that the NR-2 liner warped despite removing the red gasket before washing.' }] });
    const run = await workspace.ask({ productId: product.id, question: 'Can I wash the NR-2 liner with the gasket attached?', mode: 'synthetic' });
    assert.equal(run.status, 'completed'); assert.equal(run.retrieval?.passages.length, 2);
    assert.ok(!run.retrieval!.passages[0].text.includes('red gasket is removed'));
    assert.equal(run.generationPassages?.[0].text, qualified); assert.equal(run.generationPassages?.[0].originalQuestion, 'Does this apply to model NR-2?');
    assert.equal(run.generationPassages?.[1].text, product.sources[1].text, 'restoration never drops a selected conflicting report');
    assert.equal(run.answer?.citations[0].quote, qualified); assert.ok(!run.answer?.citations[0].quote.includes('Does this apply'));
    assert.equal(run.reviewContext?.sources[0].text, qualified); assert.equal(run.generation?.binding.sourceContextSha256, workspaceGenerationParts(run.generation!.input).binding.sourceContextSha256);
    assert.equal(run.generationPassages!.reduce((sum, item) => sum + item.text.length, 0) <= 12_000, true);
    assert.throws(() => workspaceCompleteSourceContext(product, capturedCorpus!, { ...run.retrieval!, passages: [run.retrieval!.passages[0], run.retrieval!.passages[0]] }), /duplicate/);
    assert.throws(() => workspaceCompleteSourceContext(product, capturedCorpus!, { ...run.retrieval!, passages: [{ ...run.retrieval!.passages[0], id: 'foreign-context' }] }), /frozen indexing/);
  } finally { workspace.close(); provider.close(); }
});

test('saved request identity prevents redispatch after lookup loss and closes changed generation snapshots', async () => {
  const h = liveHarness();
  try {
    const run = await h.workspace.ask(h.input, undefined, { idempotencyKey: 'retained-key' });
    const db = new DatabaseSync(h.path);
    try { db.prepare('DELETE FROM workspace_question_requests').run(); } finally { db.close(); }
    assert.equal((await h.workspace.ask(h.input, undefined, { idempotencyKey: 'retained-key' })).id, run.id); assert.equal(h.calls(), 1);
    await assert.rejects(h.workspace.ask({ ...h.input, question: 'Changed request?' }, undefined, { idempotencyKey: 'retained-key' }), /saved request identity/);
  } finally { h.close(); }
  for (const tamper of ['request', 'instructions', 'body', 'source', 'receipt'] as const) {
    const h = liveHarness(undefined, boundary => { if (boundary === 'after_receipt') throw new Error('SYNTHETIC interrupted answer persistence.'); });
    try {
      await assert.rejects(h.workspace.ask(h.input, undefined, { idempotencyKey: 'bound-request' }), /SYNTHETIC interrupted/);
      const run = h.workspace.proofRuns()[0], db = new DatabaseSync(h.path);
      try {
        if (tamper === 'request') run.requestIdentity!.sha256 = '0'.repeat(64);
        if (tamper === 'instructions') run.runtimePolicyInstructions += ' Changed instructions.';
        if (tamper === 'body') (run.generation!.requestBody as any).model = 'another-model';
        if (tamper === 'source') run.generationPassages![0].text += ' Changed source.';
        if (tamper !== 'receipt') db.prepare('UPDATE workspace_runs SET document=? WHERE id=?').run(JSON.stringify(run), run.id);
      } finally { db.close(); }
      if (tamper === 'receipt') {
        const ledger = new DatabaseSync(join(h.directory, 'ledger.sqlite'));
        try { ledger.prepare('UPDATE loop_provider_calls SET receipt_json=? WHERE run_id=?').run(JSON.stringify({}), run.id); } finally { ledger.close(); }
      }
      h.reopen(); const failed = h.workspace.proofRuns()[0];
      assert.equal(failed.status, 'failed'); assert.equal(failed.answer, null); assert.equal(failed.generation?.phase, 'reconciliation'); assert.equal(h.calls(), 1);
    } finally { h.close(); }
  }
});

test('captured-policy verification and check preflight fail before retrieval or generation dispatch', async () => {
  const h = liveHarness();
  try {
    h.workspace.attachRuntimePolicyVerifier(() => { throw new Error('SYNTHETIC missing activation support.'); });
    await assert.rejects(h.workspace.ask(h.input, undefined, { idempotencyKey: 'closed-capture' }), /missing activation support/);
    assert.equal(h.workspace.proofRuns().length, 0); assert.equal(h.calls(), 0);
  } finally { h.close(); }
  const p = liveHarness();
  try {
    const run = await p.workspace.ask(p.input, undefined, { idempotencyKey: 'closed-check', automaticCheck: true, automaticCheckPreflight(context, runId) {
      assert.equal(context.sources[0].text, text); assert.ok(runId); throw new Error('SYNTHETIC unqualified answer scope.');
    } });
    assert.equal(run.status, 'failed'); assert.equal(run.retrieval, null); assert.equal(p.calls(), 0);
    assert.equal((await p.workspace.ask(p.input, undefined, { idempotencyKey: 'closed-check', automaticCheck: true })).id, run.id); assert.equal(p.calls(), 0);
  } finally { p.close(); }
});

test('pure generation verification binds completed no-check runs to their question, policy, request and source snapshots', async () => {
  const h = liveHarness();
  try {
    const run = await h.workspace.ask(h.input); assert.equal(run.status, 'completed'); assert.doesNotThrow(() => verifyWorkspaceRunGeneration(run));
    for (const tamper of ['question', 'product', 'source', 'policy', 'mode', 'request', 'prepared_body'] as const) {
      const changed = structuredClone(run);
      if (tamper === 'question') { changed.question = 'What voltage is listed?'; changed.reviewContext!.question = changed.question; }
      if (tamper === 'product') changed.reviewContext!.product.title = 'Fictional another product';
      if (tamper === 'source') { changed.reviewContext!.sources[0].text = 'SYNTHETIC changed source: the jug is gold.'; }
      if (tamper === 'policy') changed.runtimePolicyInstructions += ' Changed policy.';
      if (tamper === 'mode') changed.runtimePolicy!.mode = 'synthetic';
      if (tamper === 'request') changed.requestIdentity!.sha256 = '0'.repeat(64);
      if (tamper === 'prepared_body') (changed.generation!.requestBody as any).model = 'another-model';
      assert.throws(() => verifyWorkspaceRunGeneration(changed), /identity/);
    }
  } finally { h.close(); }
});
