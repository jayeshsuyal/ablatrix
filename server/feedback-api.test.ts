import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createApp } from './app.ts';
import { FeedbackLoop } from './feedback-loop.ts';
import { LoopTelemetry } from './loop-telemetry.ts';
import { RunStore } from './store.ts';
import type { LoopProvider, LoopRetriever, ProductCorpus } from './loop-types.ts';

test('feedback HTTP flow persists reviewed proposal, validation, promotion and rollback with synthetic provenance', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ablatrix-loop-api-'));
  const products = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, title: `Synthetic product ${i}`, split: i === 0 ? 'development' as const : 'validation' as const }));
  const corpus: ProductCorpus = {
    version: 'synthetic-test', source: 'test fixture', license: 'synthetic', products,
    passages: products.map(p => ({ id: `s-${p.id}`, productId: p.id, source: 'synthetic manufacturer', text: 'The handle is made from oak wood.', reference: 'synthetic-test', sha256: 'a'.repeat(64) })),
    cases: products.map(p => ({ id: `c-${p.id}`, productId: p.id, split: p.split, question: 'What material is the handle?', referenceAnswer: 'Oak wood.', referencePassageIds: [`s-${p.id}`], labelStatus: 'synthetic' }))
  };
  const retriever: LoopRetriever = { close() {}, async retrieve(productId) { return { passages: corpus.passages.filter(p => p.productId === productId).map(p => ({ ...p, lexicalRank: 1, semanticRank: 1, score: 1 })), durationMs: 1, method: 'synthetic test', embeddingModel: 'synthetic', corpusVersion: corpus.version }; } };
  const provider: LoopProvider = { readiness: () => ({ ready: false, reason: 'No live calls in test' }), async answer() { throw new Error('unexpected paid call'); }, async propose() { throw new Error('unexpected paid call'); } };
  const store = new RunStore(join(dir, 'legacy.sqlite'));
  const loop = new FeedbackLoop(corpus, retriever, provider, join(dir, 'loop.sqlite'));
  const server = createApp(store, 'fixture', undefined, undefined, loop, new LoopTelemetry({ env: {} }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  async function post(path: string, body: unknown) {
    const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
    const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
  }
  try {
    const initial = await (await fetch(base + '/api/loop')).json();
    assert.equal(initial.readiness.ready, false);
    const telemetry = await (await fetch(base + '/api/loop/telemetry')).json();
    assert.equal(telemetry.enabled, false);
    assert.equal(telemetry.ready, false);
    const beforeSync = loop.export();
    assert.equal((await post('/api/loop/telemetry/sync', {})).deliveredTraces, 0);
    assert.deepEqual(loop.overview().runs, (beforeSync as { runs: unknown[] }).runs);
    const invalidSync = await fetch(base + '/api/loop/telemetry/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseUrl: 'https://example.com' }) });
    assert.equal(invalidSync.status, 400);
    const crossOriginSync = await fetch(base + '/api/loop/telemetry/sync', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.com' }, body: '{}' });
    assert.equal(crossOriginSync.status, 403);
    const run = await post('/api/loop/runs', { mode: 'fixture', productId: 'p0', caseId: 'c-p0', question: 'What material is the handle?' });
    assert.equal(run.mode, 'fixture'); assert.equal(run.status, 'completed');
    const reviewed = await post(`/api/loop/runs/${run.id}/review`, { correct: false, supported: true, referenceChecked: true, category: 'unnecessary_abstention', correction: 'The source identifies the handle material as oak wood. Answer the supported material question.', sourceIds: ['s-p0'], reviewer: 'Synthetic demo reviewer' });
    assert.equal(reviewed.feedback.kind, 'synthetic');
    const policy = await post('/api/loop/proposals', { mode: 'fixture', runIds: [run.id] });
    assert.equal(policy.parentId, run.policyId);
    const validation = await post(`/api/loop/policies/${policy.id}/validate`, {});
    const hidden = await (await fetch(base + '/api/loop')).json();
    assert.equal(hidden.runs.filter((r: { validationId: string }) => r.validationId === validation.id).length, 0);
    assert.equal(hidden.reviewCards[validation.id].length, 4);
    assert.ok(hidden.reviewCards[validation.id].every((r: { policyId: string }) => r.policyId === ''));
    assert.ok(hidden.reviewCards[validation.id].every((r: Record<string, unknown>) => !('timings' in r)));
    const decision = await post(`/api/loop/validations/${validation.id}/decide`, {});
    assert.equal(decision.status, 'accepted');
    const changed = await (await fetch(base + '/api/loop')).json();
    assert.equal(changed.activePolicyIds.fixture, policy.id);
    assert.equal(changed.activePolicyIds.live, initial.activePolicyIds.live);
    assert.ok(changed.runs.filter((r: { validationId: string }) => r.validationId === validation.id).every((r: { feedback: { kind: string } }) => r.feedback.kind === 'synthetic'));
    const rolled = await post('/api/loop/rollback', { mode: 'fixture', policyId: run.policyId });
    assert.equal(rolled.activePolicyIds.fixture, run.policyId);
    const report = await fetch(base + '/api/loop/export');
    assert.match(report.headers.get('content-disposition')!, /attachment/);
    assert.equal((await report.json()).format, 'ablatrix-feedback-loop-v0.3');
    const batch = await post('/api/loop/batches', { mode: 'fixture' });
    assert.equal(batch.runIds.length, 1);
    const hostile = await fetch(base + '/api/loop/proposals', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.com' }, body: '{}' });
    assert.equal(hostile.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('Langfuse HTTP sync exports saved live traces and later human feedback without another model call', async () => {
  const requests: { path: string; body: any }[] = [];
  const collector = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Basic ${Buffer.from('test-public:test-secret').toString('base64')}`);
    let raw = ''; for await (const chunk of req) raw += chunk;
    const payload = JSON.parse(raw); requests.push({ path: req.url!, body: payload });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/public/otel/v1/traces') { res.statusCode = 200; res.end('{}'); }
    else { res.statusCode = 207; res.end(JSON.stringify({ successes: payload.batch.map((event: { id: string }) => ({ id: event.id, status: 201 })), errors: [] })); }
  });
  collector.listen(0, '127.0.0.1'); await once(collector, 'listening');
  const address = collector.address(); assert.ok(address && typeof address !== 'string');
  const product = { id: 'synthetic-product', title: 'Synthetic test product', split: 'development' as const };
  const passage = { id: 'synthetic-source', productId: product.id, text: 'Synthetic oak wood handle.', source: 'Synthetic manufacturer', reference: 'Synthetic test', sha256: 'a'.repeat(64) };
  const corpus: ProductCorpus = { version: 'synthetic-telemetry-api', source: 'Synthetic test', license: 'Synthetic', products: [product], passages: [passage], cases: [] };
  let modelCalls = 0;
  const provider: LoopProvider = { readiness: () => ({ ready: true, reason: 'Injected synthetic provider' }), async answer() { modelCalls++; return { model: 'synthetic-test-model', usage: { inputTokens: 12, outputTokens: 4 }, answer: { status: 'answered', answer: 'Synthetic oak wood.', citations: [{ passageId: passage.id, quote: 'oak wood' }] } }; }, async propose() { throw new Error('No proposals in this test'); } };
  const retriever: LoopRetriever = { close() {}, async retrieve() { return { passages: [{ ...passage, lexicalRank: 1, semanticRank: 1, score: 1 }], durationMs: 1, method: 'synthetic', embeddingModel: 'synthetic', corpusVersion: corpus.version }; } };
  const loop = new FeedbackLoop(corpus, retriever, provider, ':memory:');
  const store = new RunStore(':memory:');
  const telemetry = new LoopTelemetry({ dbPath: ':memory:', env: { ABLATRIX_LANGFUSE_ENABLED: '1', LANGFUSE_BASE_URL: `http://127.0.0.1:${address.port}`, LANGFUSE_PUBLIC_KEY: 'test-public', LANGFUSE_SECRET_KEY: 'test-secret' } });
  const app = createApp(store, 'fixture', undefined, undefined, loop, telemetry);
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  const appAddress = app.address(); assert.ok(appAddress && typeof appAddress !== 'string');
  const base = `http://127.0.0.1:${appAddress.port}`;
  const post = async (path: string, value: unknown = {}) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
    assert.equal(response.status, 200); return response.json();
  };
  try {
    const run = await loop.run({ mode: 'live', productId: product.id, question: 'What is the synthetic handle material?' });
    const stateBeforeSync = loop.overview();
    const first = await post('/api/loop/telemetry/sync');
    assert.equal(first.deliveredTraces, 1); assert.equal(first.deliveredScores, 0);
    assert.equal(modelCalls, 1); assert.deepEqual(loop.overview(), stateBeforeSync);
    assert.equal(requests.length, 1);
    const spans = requests[0].body.resourceSpans[0].scopeSpans[0].spans;
    assert.ok(spans.some((span: { attributes: { key: string; value: { stringValue: string } }[] }) => span.attributes.some(attribute => attribute.key === 'langfuse.observation.type' && attribute.value.stringValue === 'generation')));
    await post(`/api/loop/runs/${run.id}/review`, { correct: true, supported: true, referenceChecked: true, category: 'none', correction: '', sourceIds: [passage.id], reviewer: 'Synthetic HTTP reviewer' });
    const reviewed = await post('/api/loop/telemetry/sync');
    assert.equal(reviewed.deliveredTraces, 1); assert.ok(reviewed.deliveredScores >= 2);
    const sent = requests.length; await post('/api/loop/telemetry/sync');
    assert.equal(requests.length, sent, 'unchanged sync must not duplicate accepted records');
    assert.equal(modelCalls, 1);
    const statusText = JSON.stringify(await (await fetch(base + '/api/loop/telemetry')).json());
    assert.ok(!statusText.includes('test-secret') && !statusText.includes('test-public'));
    assert.ok(!JSON.stringify(requests).includes('Synthetic HTTP reviewer'));
  } finally {
    await new Promise<void>(resolve => app.close(() => resolve())); store.close();
    await new Promise<void>(resolve => collector.close(() => resolve()));
  }
});
