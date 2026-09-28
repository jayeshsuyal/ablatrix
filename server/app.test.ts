import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.ts';
import { RunStore } from './store.ts';
import { ProductWorkspace } from './product-workspace.ts';

test('baseline request persists a fixture result and survives reopening', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-'));
  const path = join(directory, 'runs.sqlite');
  const store = new RunStore(path);
  const app = createApp(store, 'fixture');
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
  try {
    const address = app.address();
    assert(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const invalid = await fetch(`${base}/api/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entity: 'X', question: 'short' })
    });
    assert.equal(invalid.status, 400);
    const response = await fetch(`${base}/api/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entity: 'Example Company', question: 'What does it make?', taskId: 'sample-1' })
    });
    assert.equal(response.status, 201);
    const run = await response.json();
    assert.equal(run.mode, 'fixture');
    assert.equal(run.taskId, 'sample-1');
    assert.equal(run.costStatus, 'fixture');
    assert.match(run.output.answer, /synthetic/i);
    assert.equal(run.output.sources.length, 1);
    store.close();
    const reopened = new RunStore(path);
    assert.equal(reopened.get(run.id)?.output?.answer, run.output.answer);
    reopened.close();
  } finally {
    await new Promise<void>(resolve => app.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('product workspace API saves user evidence and returns a model-free preview', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-workspace-api-'));
  const store = new RunStore(join(directory, 'runs.sqlite'));
  const workspace = new ProductWorkspace(join(directory, 'workspace.sqlite'), {
    readiness: () => ({ ready: false, reason: 'Live not configured.' }),
    async answer() { throw new Error('Preview must not call a model.'); },
    async propose() { throw new Error('No proposal expected.'); }
  }, corpus => ({ close() {}, async retrieve(productId) { return { passages: corpus.passages.filter(item => item.productId === productId).map(item => ({ ...item, lexicalRank: 1, semanticRank: 1, score: 1 })), durationMs: 1, method: 'test-hybrid', embeddingModel: 'test-embedding', corpusVersion: corpus.version }; } }));
  const app = createApp(store, 'fixture', undefined, undefined, undefined, undefined, workspace);
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
  try {
    const address = app.address(); assert(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const saved = await fetch(`${base}/api/workspace/products`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Trail jacket', sources: [{ label: 'Listing', text: 'The jacket has a waterproof nylon shell with a detachable hood.' }] }) });
    assert.equal(saved.status, 201);
    const product = await saved.json();
    const asked = await fetch(`${base}/api/workspace/questions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: product.id, question: 'What material is the shell?', mode: 'preview' }) });
    assert.equal(asked.status, 201);
    const preview = await asked.json(); assert.equal(preview.status, 'evidence_ready'); assert.equal(preview.answer, null);
    const overview = await (await fetch(`${base}/api/workspace`)).json();
    assert.equal(overview.products.length, 1); assert.equal(overview.runs.length, 1);
    assert.equal(overview.readiness.ready, false);
    const escaped = await fetch(`${base}/api/workspace/products`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Eight excerpt listing', sources: Array.from({ length: 8 }, (_, index) => ({ label: `Source ${index + 1}`, text: 'x\n'.repeat(750) })) }) });
    assert.equal(escaped.status, 201);
  } finally { await new Promise<void>(resolve => app.close(() => resolve())); store.close(); rmSync(directory, { recursive: true, force: true }); }
});
