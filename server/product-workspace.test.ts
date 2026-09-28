import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ProductWorkspace } from './product-workspace.ts';
import type { LoopProvider, LoopRetriever, ProductCorpus } from './loop-types.ts';

function retrieverFor(corpus: ProductCorpus): LoopRetriever {
  return { close() {}, async retrieve(productId, question) {
    assert.equal(corpus.products.length, 1, 'user products are indexed separately');
    assert.equal(corpus.products[0].id, productId);
    assert.ok(question);
    return { passages: corpus.passages.map(passage => ({ ...passage, lexicalRank: 1, semanticRank: 1, score: 1 })), durationMs: 1, method: 'test-hybrid', embeddingModel: 'test-embedding', corpusVersion: corpus.version };
  } };
}

test('product evidence and question previews persist without model calls or evaluation leakage', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-workspace-'));
  const path = join(directory, 'workspace.sqlite');
  let calls = 0;
  const provider: LoopProvider = { readiness: () => ({ ready: false, reason: 'Local live mode disabled.' }), async answer() { calls++; throw new Error('No live answer expected.'); }, async propose() { throw new Error('No proposal expected.'); } };
  let workspace = new ProductWorkspace(path, provider, retrieverFor);
  try {
    const first = workspace.createProduct({ title: 'Trail jacket', sources: [{ label: 'Listing', text: 'The jacket has a waterproof nylon shell with a detachable hood.' }] });
    const second = workspace.createProduct({ title: 'Phone case', sources: [{ label: 'Listing', text: 'The case fits iPhone 4S and has a soft silicone outer layer.' }] });
    assert.throws(() => workspace.createProduct({ title: 'Invalid', sources: [{ label: 'X', text: 'short' }] }), /too_small|Too small|Invalid/);
    const preview = await workspace.ask({ productId: first.id, question: 'What material is the shell?', mode: 'preview' });
    assert.equal(preview.status, 'evidence_ready');
    assert.equal(preview.answer, null);
    assert.equal(preview.retrieval?.passages.length, 1);
    assert.equal(preview.retrieval?.passages[0].productId, first.id);
    assert.equal(calls, 0);
    await assert.rejects(workspace.ask({ productId: second.id, question: 'What material is the case?', mode: 'live' }), /Local live mode disabled/);
    workspace.close();
    const db = new DatabaseSync(path);
    const interrupted = { ...preview, id: 'interrupted-preview', status: 'retrieving', retrieval: null, error: null };
    db.prepare('INSERT INTO workspace_runs(id,created_at,document) VALUES(?,?,?)').run(interrupted.id, interrupted.createdAt, JSON.stringify(interrupted));
    db.close();
    workspace = new ProductWorkspace(path, provider, retrieverFor);
    assert.equal(workspace.overview().products.length, 2);
    assert.ok(workspace.overview().runs.some(item => item.id === preview.id && item.status === 'evidence_ready'));
    assert.equal(workspace.overview().runs.find(item => item.id === interrupted.id)?.status, 'failed');
  } finally { workspace.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('live workspace answers require exact citations and retain failed attempts', async () => {
  const passage = 'The jacket has a waterproof nylon shell with a detachable hood.';
  let fabricated = false;
  const provider: LoopProvider = { readiness: () => ({ ready: true, reason: 'Test provider ready.' }), async answer(input) {
    return { answer: { answer: 'The shell is nylon.', status: 'answered', citations: [{ passageId: input.passages[0].id, quote: fabricated ? 'Invented quote' : 'waterproof nylon shell' }] }, model: 'test-model', usage: { inputTokens: 20, outputTokens: 5 } };
  }, async propose() { throw new Error('No proposal expected.'); } };
  const workspace = new ProductWorkspace(':memory:', provider, retrieverFor);
  try {
    const product = workspace.createProduct({ title: 'Trail jacket', sources: [{ label: 'Listing', text: passage }] });
    const good = await workspace.ask({ productId: product.id, question: 'What material is the shell?', mode: 'live' });
    assert.equal(good.status, 'completed');
    assert.equal(good.answer?.citations[0].quote, 'waterproof nylon shell');
    fabricated = true;
    const bad = await workspace.ask({ productId: product.id, question: 'What material is the shell?', mode: 'live' });
    assert.equal(bad.status, 'failed'); assert.equal(bad.answer, null);
    assert.equal(workspace.overview().runs.length, 2);
  } finally { workspace.close(); }
});

test('long multibyte sources become bounded passages before retrieval', async () => {
  const provider: LoopProvider = { readiness: () => ({ ready: false, reason: 'Disabled.' }), async answer() { throw new Error('Unexpected answer.'); }, async propose() { throw new Error('Unexpected proposal.'); } };
  const workspace = new ProductWorkspace(':memory:', provider, corpus => {
    assert.ok(corpus.passages.length > 1);
    assert.ok(corpus.passages.every(passage => Buffer.byteLength(passage.text) <= 300));
    assert.ok(corpus.passages.every(passage => passage.source === 'Specification'));
    return retrieverFor(corpus);
  });
  try {
    const product = workspace.createProduct({ title: 'Multibyte listing', sources: [{ label: 'Specification', text: '防水素材と軽量設計。'.repeat(100) }] });
    const run = await workspace.ask({ productId: product.id, question: 'What does the specification say?', mode: 'preview' });
    assert.equal(run.status, 'evidence_ready');
  } finally { workspace.close(); }
});

test('many short evidence lines use exact-quote answering when snippet options exceed the bound', async () => {
  let direct = 0;
  const provider: LoopProvider = { readiness: () => ({ ready: true, reason: 'Ready.' }), async answer(input) {
    direct++;
    return { answer: { answer: 'The listing says Line.', status: 'answered', citations: [{ passageId: input.passages[0].id, quote: 'Line.' }] }, model: 'test-model', usage: null };
  }, async answerWithSnippetIds() { throw new Error('Too many snippet options.'); }, async propose() { throw new Error('Unexpected proposal.'); } };
  const workspace = new ProductWorkspace(':memory:', provider, retrieverFor);
  try {
    const product = workspace.createProduct({ title: 'Bullet listing', sources: [{ label: 'Listing', text: 'Line.\n'.repeat(80) }] });
    const run = await workspace.ask({ productId: product.id, question: 'What does the listing say?', mode: 'live' });
    assert.equal(run.status, 'completed'); assert.equal(direct, 1);
  } finally { workspace.close(); }
});
