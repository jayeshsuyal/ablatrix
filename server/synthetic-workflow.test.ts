import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SyntheticAnswerProvider } from './synthetic-answer-provider.ts';
import { ProductWorkspace } from './product-workspace.ts';
import { AnswerRevisions } from './answer-revisions.ts';
import { PaidAnswerReview } from './paid-answer-review.ts';
import type { LoopRetriever, ProductCorpus } from './loop-types.ts';

const retrieve = (corpus: ProductCorpus): LoopRetriever => ({ close() {}, async retrieve(productId) { return { passages: corpus.passages.filter(passage => passage.productId === productId).map(passage => ({ ...passage, lexicalRank: 1, semanticRank: null, score: 1 })), durationMs: 0, method: 'synthetic corpus lookup', embeddingModel: 'none', corpusVersion: corpus.version }; } });
const sourceText = 'The synthetic jacket has a nylon shell and a detachable hood.';
const addedText = 'The synthetic jacket uses taped seams and a waterproof nylon shell.';
const critique = { reviewer: 'Human demo tester', feedback: 'Please include the missing waterproof material detail.', issue: 'missing_evidence', investigate: true, additionalSources: [{ label: 'Reviewer supplied specification', text: addedText }] };

test('explicit synthetic answers use the durable async correction workflow without provider calls or live quality claims', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-synthetic-flow-'));
  const providerPath = join(directory, 'synthetic.sqlite'), reviewPath = join(directory, 'reviews.sqlite'), workspacePath = join(directory, 'workspace.sqlite');
  let provider = new SyntheticAnswerProvider(providerPath), workspace = new ProductWorkspace(workspacePath, provider, retrieve), reviews = new PaidAnswerReview(reviewPath), worker = new AnswerRevisions(reviews, provider, reviewPath, false);
  let external = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { external++; throw new Error('Synthetic flow must not use network.'); };
  try {
    const product = workspace.createProduct({ title: 'Synthetic demo jacket', sources: [{ label: 'Customer answer', text: sourceText, originalQuestion: 'What is the synthetic jacket shell made from?' }] });
    await assert.rejects(workspace.ask({ productId: product.id, question: 'What material is the shell?', mode: 'live' }), /does not match/);
    const preview = await workspace.ask({ productId: product.id, question: 'What material is the shell?', mode: 'preview' });
    assert.equal(preview.answer, null);
    const run = await workspace.ask({ productId: product.id, question: 'What material is the shell?', mode: 'synthetic' }, () => { throw new Error('No live dispatch hook for synthetic answers.'); });
    assert.equal(run.status, 'completed'); assert.equal(run.mode, 'synthetic'); assert.equal(run.model, 'synthetic-fixture'); assert.equal(run.usage, null);
    assert.match(run.answer!.answer, /^SYNTHETIC draft/);
    assert.equal(provider.receipt(run.id)?.accounting, 'no_provider_call');
    assert.equal(provider.receipt(run.id)?.input_tokens, null);
    const [snapshot] = workspace.reviewSnapshots();
    assert.equal(snapshot.mode, 'synthetic');
    const original = worker.registerAnswer(snapshot);
    const request = { ...critique, versionId: original.id, idempotencyKey: 'synthetic-first-revision' };
    const job = worker.request(snapshot.id, request);
    assert.equal(worker.request(snapshot.id, request).id, job.id);
    await worker.tick();
    let state = worker.overview('workspace').cases[0];
    assert.equal(state.versions.length, 2); assert.equal(state.jobs[0].status, 'ready'); assert.equal(state.mode, 'synthetic');
    assert.match(state.versions[1].answer.answer, /^SYNTHETIC revision/);
    assert.ok(state.versions[1].answer.citations.some(citation => citation.quote === addedText));
    assert.equal(state.jobs[0].externalUsage.length, 0);
    assert.equal(state.jobs[0].usage?.planningAllowanceUsd, null);
    assert.equal(state.events[0].reviewKind, 'human'); assert.equal(state.events[0].qualityClaimEligible, false);
    worker.request(snapshot.id, { ...critique, issue: 'answer_quality', additionalSources: [], versionId: state.versions[1].id, idempotencyKey: 'synthetic-second-revision' });
    await worker.tick();
    state = worker.overview('workspace').cases[0];
    assert.equal(state.generationAttempts, 2);
    assert.throws(() => worker.request(snapshot.id, { ...critique, versionId: state.versions[2].id, idempotencyKey: 'synthetic-third-revision' }), /two generation attempts/);
    const latest = state.versions.at(-1)!;
    const decision = worker.decide(snapshot.id, { versionId: latest.id, reviewer: 'Human demo tester', decision: 'accept', note: 'Checked the illustrative source excerpts.', checkedSourceShas: latest.context!.sources.map(source => source.sha256) });
    assert.equal(decision.reviewKind, 'human'); assert.equal(decision.mode, 'synthetic'); assert.equal(decision.qualityClaimEligible, false);
    const summary = worker.overview('workspace').summary;
    assert.equal(summary.providerCalls, 0); assert.equal(summary.syntheticOperations, 2); assert.equal(summary.liveAccepted, 0); assert.equal(summary.syntheticAccepted, 1);
    assert.equal(summary.actualProviderCharges, 'not_applicable_no_provider_calls');
    assert.equal(external, 0);
    await worker.pauseAndDrain(); worker.close(); workspace.close(); reviews.close(); provider.close();
    provider = new SyntheticAnswerProvider(providerPath); workspace = new ProductWorkspace(workspacePath, provider, retrieve); reviews = new PaidAnswerReview(reviewPath); worker = new AnswerRevisions(reviews, provider, reviewPath, false);
    assert.equal(worker.registerAnswer(workspace.reviewSnapshots()[0]).id, original.id);
    state = worker.overview('workspace').cases[0];
    assert.equal(state.versions.length, 3); assert.equal(state.jobs.at(-1)?.status, 'accepted'); assert.equal(state.versions.at(-1)?.mode, 'synthetic');
  } finally { globalThis.fetch = previousFetch; await worker.pauseAndDrain(); worker.close(); workspace.close(); reviews.close(); provider.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('synthetic receipt replay is stable and binds to the request input', async () => {
  const provider = new SyntheticAnswerProvider(':memory:');
  const input = { runId: 'demo-receipt', question: 'What is the material?', product: { id: 'demo', title: 'Demo jacket' }, rejectedAnswer: 'Synthetic draft', critique: 'Include the shell material.', evidence: [{ id: 'source', source: 'Specification', text: sourceText }] };
  try {
    const first = await provider.revise(input), repeated = await provider.revise(input);
    assert.deepEqual(repeated, first);
    await assert.rejects(provider.revise({ ...input, critique: 'A different request must not reuse the same receipt.' }), /different request/);
    assert.deepEqual(provider.externalReceipts(), []);
  } finally { provider.close(); }
});

test('draining stops future ticks and waits for an active synthetic correction before SQLite is closed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-synthetic-drain-')), reviewPath = join(directory, 'review.sqlite');
  const provider = new SyntheticAnswerProvider(join(directory, 'receipts.sqlite')), workspace = new ProductWorkspace(':memory:', provider, retrieve), reviews = new PaidAnswerReview(reviewPath);
  let started!: () => void, release!: () => void;
  const running = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const revise = provider.revise.bind(provider);
  provider.revise = async input => { started(); await gate; return revise(input); };
  const forbiddenSearch = { readiness: () => ({ ready: true, reason: 'Must never run.' }), allowed: () => true, async search() { throw new Error('Synthetic web search attempted.'); }, async read() { throw new Error('Synthetic page read attempted.'); } };
  const worker = new AnswerRevisions(reviews, provider, reviewPath, false, () => true, forbiddenSearch);
  try {
    const product = workspace.createProduct({ title: 'Synthetic drain jacket', sources: [{ label: 'Specification', text: sourceText }] });
    for (let i = 0; i < 2; i++) {
      const run = await workspace.ask({ productId: product.id, question: `What material is the shell, case ${i}?`, mode: 'synthetic' });
      const snapshot = workspace.reviewSnapshots().find(item => item.runId === run.id)!;
      const original = worker.registerAnswer(snapshot);
      worker.request(snapshot.id, { ...critique, issue: 'answer_quality', versionId: original.id, idempotencyKey: `synthetic-drain-${i}` });
    }
    const tick = worker.tick(); await running;
    let drained = false;
    const drain = worker.pauseAndDrain().then(() => { drained = true; });
    await Promise.resolve();
    assert.equal(drained, false); assert.equal(worker.hasActive(), true);
    assert.throws(() => worker.close(), /pauseAndDrain/);
    await worker.tick();
    release(); await tick; await drain;
    assert.equal(worker.hasActive(), false);
    const states = worker.overview('workspace').cases.flatMap(item => item.jobs);
    assert.equal(states.filter(job => job.status === 'ready').length, 1);
    assert.equal(states.filter(job => job.status === 'queued').length, 1);
    assert.equal(worker.overview('workspace').investigationReadiness.ready, false);
  } finally { release(); await worker.pauseAndDrain(); worker.close(); workspace.close(); reviews.close(); provider.close(); rmSync(directory, { recursive: true, force: true }); }
});
