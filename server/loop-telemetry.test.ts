import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LoopTelemetry } from './loop-telemetry.ts';
import type { LoopFinal, LoopOverview, LoopRun, LoopValidation } from './loop-types.ts';

const env = { ABLATRIX_LANGFUSE_ENABLED: '1', LANGFUSE_BASE_URL: 'https://example.langfuse.test', LANGFUSE_PUBLIC_KEY: 'pk-test-project', LANGFUSE_SECRET_KEY: 'sk-test-private' };
type Request = { url: string; options: RequestInit; body: any };
function transport(handler?: (request: Request, index: number) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const fetchImpl = (async (url: string | URL | Request, options?: RequestInit) => {
    const request = { url: String(url), options: options!, body: JSON.parse(String(options!.body)) };
    requests.push(request);
    if (handler) return handler(request, requests.length - 1);
    return request.url.endsWith('/traces') ? Response.json({}) : Response.json({ successes: request.body.batch.map((event: { id: string }) => ({ id: event.id, status: 201 })), errors: [] }, { status: 207 });
  }) as typeof fetch;
  return { requests, fetchImpl };
}
function run(overrides: Partial<LoopRun> = {}): LoopRun {
  return { id: 'run-1', mode: 'live', productId: 'product-1', caseId: 'case-1', split: 'development', question: 'What material?', policyId: 'policy-1', status: 'completed', answer: { answer: 'Oak.', status: 'answered', citations: [{ passageId: 'p-1', quote: 'oak' }] }, retrieval: { passages: [{ id: 'p-1', productId: 'product-1', source: 'manufacturer', text: 'PRIVATE FULL EVIDENCE', reference: 'PRIVATE SOURCE URL', sha256: 'abc123', lexicalRank: 1, semanticRank: 2, score: 0.8 }], durationMs: 100, method: 'hybrid', embeddingModel: 'bge-small', corpusVersion: 'corpus-1' }, model: 'actual-model-1', usage: { inputTokens: 20, outputTokens: 5 }, durationMs: 2000, error: null, feedback: null, createdAt: '2026-09-24T01:00:00.000Z', validationId: null, finalId: null, ...overrides };
}
function feedback(): NonNullable<LoopRun['feedback']> {
  return { kind: 'human', referenceChecked: true, correct: true, supported: true, category: 'none', correction: '', sourceIds: ['p-1'], reviewer: 'PRIVATE REVIEWER NAME', createdAt: '2026-09-25T01:00:00.000Z', draftId: 'draft-exposed-1' };
}
function overview(runs: LoopRun[] = [run()]): LoopOverview {
  return { products: [], cases: [], corpus: { version: 'corpus-1', source: 'source', license: 'license', passageCount: 1 }, policies: [{ id: 'policy-1', mode: 'live', parentId: null, instructions: 'Answer from supplied evidence.', rationale: 'baseline', feedbackRunIds: [], status: 'baseline', createdAt: '2026-09-24T00:00:00.000Z' }], activePolicyIds: { live: 'policy-1', fixture: 'fixture-baseline' }, runs, batches: [], validations: [], externalValidationCases: [], finals: [], reviewCards: {}, events: [], readiness: { ready: true, reason: 'test' }, busy: false };
}
function validation(id: string, ids: string[], overrides: Partial<LoopValidation> = {}): LoopValidation {
  return { id, candidateId: 'policy-1', parentId: 'parent', mode: 'live', status: 'accepted', caseIds: [], runIds: ids, createdAt: '2026-09-24T00:00:00Z', reason: '', parentCorrect: 1, candidateCorrect: 2, regressions: 0, ...overrides };
}
function final(id: string, ids: string[], overrides: Partial<LoopFinal> = {}): LoopFinal {
  return { id, candidateId: 'policy-1', baselineId: 'parent', mode: 'live', status: 'reported', caseIds: [], runIds: ids, createdAt: '2026-09-24T00:00:00Z', reason: '', corpusVersion: 'c', manifestSha256: 'hash', result: { baselineCorrect: 1, candidateCorrect: 1, wins: 0, losses: 0, ties: 1, regressions: 0, pairedDifferencePoints: 0, interval95: [0, 0], baselineAnswered: 1, candidateAnswered: 1, baselineUnsupported: 0, candidateUnsupported: 0, baselineTokens: 1, candidateTokens: 1, baselineMedianMs: 1, candidateMedianMs: 1, billedCostUsd: null, verdict: 'inconclusive', cases: [] }, ...overrides };
}
function spans(request: Request): any[] { return request.body.resourceSpans[0].scopeSpans[0].spans; }
function attributes(span: any): Record<string, string> { return Object.fromEntries(span.attributes.map((attribute: any) => [attribute.key, attribute.value.stringValue])); }

test('telemetry is inert when disabled or misconfigured; URL credentials and remote plaintext are rejected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'loop-telemetry-disabled-')); const path = join(dir, 'nested', 'export.sqlite');
  const mock = transport();
  try {
    for (const config of [{}, { ...env, ABLATRIX_LANGFUSE_ENABLED: '0' }, { ...env, LANGFUSE_BASE_URL: '' }, { ...env, LANGFUSE_BASE_URL: 'http://remote.test' }, { ...env, LANGFUSE_BASE_URL: 'https://user:secret@remote.test' }, { ...env, LANGFUSE_BASE_URL: 'https://remote.test?token=secret' }]) {
      const exporter = new LoopTelemetry({ env: config, dbPath: path, fetchImpl: mock.fetchImpl });
      assert.equal(exporter.status().ready, false); await exporter.sync(overview()); exporter.close();
    }
    assert.equal(existsSync(path), false); assert.equal(mock.requests.length, 0);
    for (const url of ['http://127.0.0.1:3000', 'http://localhost:3000', 'http://[::1]:3000']) {
      const local = new LoopTelemetry({ env: { ...env, LANGFUSE_BASE_URL: url }, dbPath: ':memory:', fetchImpl: mock.fetchImpl }); assert.equal(local.status().ready, true); local.close();
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('OTLP exports evidence identities and policy with honest historical timing, no secrets, reviewer, AI drafts, or source text', async () => {
  const mock = transport(); const exporter = new LoopTelemetry({ env, dbPath: ':memory:', fetchImpl: mock.fetchImpl });
  const input = run({ question: `What material? ${env.LANGFUSE_SECRET_KEY}`, error: 'PRIVATE PROVIDER ERROR', reviewDraft: { id: 'ai-1', kind: 'ai_assisted', correct: false, supported: false, category: 'missed_evidence', correction: 'AI CORRECTION', sourceIds: ['p-1'], reviewer: 'AI REVIEWER', rationale: 'PRIVATE AI RATIONALE', confidence: 'high', createdAt: '2026-09-24T01:00:00Z' } });
  try {
    const status = await exporter.sync(overview([input])); assert.equal(status.deliveredTraces, 1); assert.equal(status.deliveredScores, 0); assert.equal(status.busy, false);
    const request = mock.requests[0]; const body = JSON.stringify(request.body);
    assert.equal(request.options.redirect, 'error'); assert.ok(request.options.signal); assert.equal((request.options.headers as Record<string, string>)['x-langfuse-ingestion-version'], '4');
    assert.match(body, /abc123/); assert.match(body, /Answer from supplied evidence/); assert.match(body, /actual-model-1/); assert.match(body, /tokenUsage/);
    for (const absent of [env.LANGFUSE_SECRET_KEY, env.LANGFUSE_PUBLIC_KEY, 'PRIVATE PROVIDER ERROR', 'PRIVATE FULL EVIDENCE', 'PRIVATE SOURCE URL', 'PRIVATE AI RATIONALE', 'AI CORRECTION', 'cost_details', 'costDetails']) assert.ok(!body.includes(absent), absent);
    const emitted = spans(request); assert.equal(emitted.length, 2); assert.equal(attributes(emitted[0])['langfuse.observation.type'], 'span'); assert.equal(attributes(emitted[1])['langfuse.observation.type'], 'event');
    assert.equal(BigInt(emitted[0].endTimeUnixNano) - BigInt(emitted[0].startTimeUnixNano), 2_000_000_000n);
    assert.equal(emitted[1].startTimeUnixNano, emitted[1].endTimeUnixNano); assert.equal(emitted[1].parentSpanId, emitted[0].spanId);
    await exporter.sync(overview([input])); assert.equal(mock.requests.length, 1);
  } finally { exporter.close(); }
});

test('recorded stage timestamps produce real retriever/generation spans; reused retrieval remains an event', async () => {
  const mock = transport(); const exporter = new LoopTelemetry({ env, dbPath: ':memory:', fetchImpl: mock.fetchImpl });
  const timings = { retrievalReused: false, retrievalStartedAt: '2026-09-24T01:00:00.000Z', retrievalEndedAt: '2026-09-24T01:00:00.100Z', generationStartedAt: '2026-09-24T01:00:00.100Z', generationEndedAt: '2026-09-24T01:00:02.000Z' };
  try {
    await exporter.sync(overview([run({ timings }), run({ id: 'reused', timings: { ...timings, retrievalReused: true } })]));
    const first = spans(mock.requests[0]); assert.equal(first.length, 3); assert.equal(attributes(first[1])['langfuse.observation.type'], 'retriever'); assert.equal(attributes(first[2])['langfuse.observation.type'], 'generation');
    assert.equal(BigInt(first[2].endTimeUnixNano) - BigInt(first[2].startTimeUnixNano), 1_900_000_000n); assert.equal(attributes(first[2])['langfuse.observation.usage_details'], '{"input":20,"output":5}');
    assert.equal(attributes(spans(mock.requests[1])[1])['langfuse.observation.type'], 'event');
  } finally { exporter.close(); }
});

test('all unresolved comparison variants remain sealed, including rejected or interrupted runs exposed by public projection', async () => {
  const mock = transport(); const exporter = new LoopTelemetry({ env, dbPath: ':memory:', fetchImpl: mock.fetchImpl });
  const data = overview([run({ id: 'dev' }), run({ id: 'fixture', mode: 'fixture' }), run({ id: 'running', status: 'running' }), run({ id: 'failed', status: 'failed', error: 'secret error' }), run({ id: 'interrupted', status: 'interrupted' }), run({ id: 'orphan', validationId: 'missing' }), run({ id: 'undeclared', split: 'holdout' })]);
  for (const [index, status] of (['running', 'awaiting_review', 'interrupted', 'rejected', 'accepted'] as const).entries()) {
    const id = `validation-${index}`; data.runs.push(run({ id, validationId: id })); data.validations.push(validation(id, [id], { status, parentCorrect: null, candidateCorrect: null, regressions: null }));
  }
  data.runs.push(run({ id: 'stripped-id', validationId: null })); data.validations.push(validation('stripped-comparison', ['stripped-id'], { status: 'awaiting_review' }));
  for (const [index, status] of (['running', 'awaiting_review', 'interrupted', 'reported'] as const).entries()) {
    const id = `final-${index}`; data.runs.push(run({ id, finalId: id, split: 'holdout' })); data.finals.push(final(id, [id], { status, result: null }));
  }
  for (const status of ['accepted', 'rejected'] as const) {
    const id = `resolved-${status}`; data.runs.push(run({ id, validationId: id, split: 'validation' })); data.validations.push(validation(id, [id], { status }));
  }
  data.runs.push(run({ id: 'reported', finalId: 'reported', split: 'holdout' })); data.finals.push(final('reported', ['reported']));
  try {
    const status = await exporter.sync(data); assert.equal(status.deliveredTraces, 6);
    const ids = mock.requests.map(item => attributes(spans(item)[0])['langfuse.observation.metadata.runId']);
    assert.deepEqual(ids.sort(), ['dev', 'failed', 'interrupted', 'reported', 'resolved-accepted', 'resolved-rejected'].sort());
  } finally { exporter.close(); }
});

test('verified human feedback alone becomes scores; edited judgments keep remote ID and date stable', async () => {
  const mock = transport(); const exporter = new LoopTelemetry({ env, dbPath: ':memory:', fetchImpl: mock.fetchImpl });
  const input = run({ feedback: feedback() });
  try {
    const status = await exporter.sync(overview([input, run({ id: 'synthetic', feedback: { ...feedback(), kind: 'synthetic' } }), run({ id: 'unchecked', feedback: { ...feedback(), referenceChecked: false } })]));
    assert.equal(status.deliveredTraces, 3); assert.equal(status.deliveredScores, 3);
    const original = mock.requests.filter(item => item.url.endsWith('/ingestion')).map(item => item.body.batch[0]);
    assert.ok(!JSON.stringify(mock.requests).includes('PRIVATE REVIEWER NAME'));
    for (const event of original) { assert.equal(event.timestamp, input.createdAt); assert.equal(event.body.metadata.feedbackCreatedAt, feedback().createdAt); assert.equal(event.body.metadata.draftId, 'draft-exposed-1'); }
    input.feedback = { ...feedback(), createdAt: '2026-09-26T00:00:00Z', correct: false, category: 'incomplete_answer', correction: 'Add the supported detail.' };
    const edited = await exporter.sync(overview([input])); assert.equal(edited.deliveredTraces, 3); assert.equal(edited.deliveredScores, 6);
    const revised = mock.requests.filter(item => item.url.endsWith('/ingestion')).slice(3).map(item => item.body.batch[0]);
    assert.deepEqual(revised.map(item => item.body.id), original.map(item => item.body.id)); assert.deepEqual(revised.map(item => item.timestamp), original.map(item => item.timestamp)); assert.notEqual(revised[0].id, original[0].id);
    await exporter.sync(overview([input])); assert.equal(mock.requests.length, 9);
  } finally { exporter.close(); }
});

test('trace acceptance and ambiguous outcomes persist without replay; target fingerprints isolate destinations', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'loop-telemetry-persist-')); const path = join(dir, 'export.sqlite');
  const mock = transport((_request, index) => { if (index === 0) return Response.json({}); throw new Error(`private upstream ${env.LANGFUSE_SECRET_KEY}`); });
  let exporter = new LoopTelemetry({ env, dbPath: path, fetchImpl: mock.fetchImpl });
  try {
    const data = overview([run(), run({ id: 'ambiguous' })]); const first = await exporter.sync(data); assert.equal(first.deliveredTraces, 1); assert.equal(first.uncertain, 1); assert.ok(!JSON.stringify(first).includes(env.LANGFUSE_SECRET_KEY)); exporter.close();
    exporter = new LoopTelemetry({ env, dbPath: path, fetchImpl: mock.fetchImpl }); assert.equal(exporter.status().lastSyncAt, first.lastSyncAt); await exporter.sync(data); assert.equal(mock.requests.length, 2); exporter.close();
    exporter = new LoopTelemetry({ env: { ...env, LANGFUSE_PUBLIC_KEY: 'other-project' }, dbPath: path, fetchImpl: mock.fetchImpl }); assert.equal(exporter.status().deliveredTraces, 0); await exporter.sync(overview()); assert.equal(mock.requests.length, 3); exporter.close();
    const db = new DatabaseSync(path); db.prepare("UPDATE loop_telemetry_delivery SET state='sending' WHERE kind='trace'").run(); db.close();
    exporter = new LoopTelemetry({ env, dbPath: path, fetchImpl: mock.fetchImpl }); assert.equal(exporter.status().uncertain, 2); await exporter.sync(data); assert.equal(mock.requests.length, 3);
  } finally { exporter.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('HTTP/OTLP partial failures are distinguished, and uncertain score retry preserves the exact event', async () => {
  const responses = [Response.json({ partialSuccess: { rejectedSpans: '1', errorMessage: 'private failure' } }), Response.json({ private: 'server error' }, { status: 500 }), Response.json({}, { status: 401 }), Response.json({ partialSuccess: {} }), Response.json({ partialSuccess: { rejectedSpans: null } })];
  const mock = transport(() => responses.shift() ?? Response.json({})); const exporter = new LoopTelemetry({ env, dbPath: ':memory:', fetchImpl: mock.fetchImpl });
  try {
    const data = overview(Array.from({ length: 5 }, (_, i) => run({ id: `run-${i}` })));
    const status = await exporter.sync(data); assert.equal(status.deliveredTraces, 1); assert.equal(status.rejected, 1); assert.equal(status.uncertain, 3); assert.ok(!JSON.stringify(status).includes('private failure'));
    const retry = await exporter.sync(data); assert.equal(mock.requests.length, 6); assert.equal(retry.deliveredTraces, 2); assert.equal(retry.rejected, 0); assert.equal(retry.uncertain, 3); assert.deepEqual(mock.requests[2].body, mock.requests[5].body);
  } finally { exporter.close(); }
  let attempts = 0;
  const scores = transport(request => {
    if (request.url.endsWith('/traces')) return Response.json({});
    attempts++;
    if (attempts === 1) throw new Error('lost acknowledgement');
    return Response.json({ successes: [{ id: request.body.batch[0].id, status: 201 }], errors: [] }, { status: 207 });
  });
  const second = new LoopTelemetry({ env, dbPath: ':memory:', fetchImpl: scores.fetchImpl });
  try {
    const data = overview([run({ feedback: feedback() })]); const first = await second.sync(data); assert.equal(first.uncertain, 1); assert.equal(first.deliveredScores, 2);
    const final = await second.sync(data); assert.equal(final.uncertain, 0); assert.equal(final.deliveredScores, 3); assert.deepEqual(scores.requests[1].body, scores.requests[4].body);
  } finally { second.close(); }
});

test('Langfuse Cloud queue receipts acknowledge trace batches without replay', async () => {
  const mock = transport(() => Response.json({ name: 'otel-ingestion-job', id: '1234567890', queueQualifiedName: 'langfuse:otel-ingestion', data: { payload: {} }, returnvalue: null }));
  const exporter = new LoopTelemetry({ env, dbPath: ':memory:', fetchImpl: mock.fetchImpl });
  try {
    const data = overview([run()]);
    const first = await exporter.sync(data);
    assert.equal(first.deliveredTraces, 1); assert.equal(first.uncertain, 0);
    await exporter.sync(data); assert.equal(mock.requests.length, 1);
  } finally { exporter.close(); }
});

test('207 per-event score rejection stays visible and is retried only by the next explicit sync', async () => {
  let failedOnce = false;
  const mock = transport(request => {
    if (request.url.endsWith('/traces')) return Response.json({});
    const event = request.body.batch[0];
    if (!failedOnce) { failedOnce = true; return Response.json({ successes: [], errors: [{ id: event.id, status: 400, error: 'private remote error' }] }, { status: 207 }); }
    return Response.json({ successes: [{ id: event.id, status: 201 }], errors: [] }, { status: 207 });
  });
  const exporter = new LoopTelemetry({ env, dbPath: ':memory:', fetchImpl: mock.fetchImpl });
  try {
    const data = overview([run({ feedback: feedback() })]); const first = await exporter.sync(data); assert.equal(first.rejected, 1); assert.equal(first.deliveredScores, 2); assert.ok(!JSON.stringify(first).includes('private remote error'));
    const next = await exporter.sync(data); assert.equal(next.rejected, 0); assert.equal(next.deliveredScores, 3); assert.equal(mock.requests.length, 5); assert.deepEqual(mock.requests[1].body, mock.requests[4].body);
  } finally { exporter.close(); }
});

test('concurrent sync calls share one export and closing aborts transport safely', async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const mock = transport(async () => { await gate; return Response.json({}); });
  const exporter = new LoopTelemetry({ env, dbPath: ':memory:', fetchImpl: mock.fetchImpl });
  try {
    const a = exporter.sync(overview()); const b = exporter.sync(overview()); assert.equal(exporter.status().busy, true); assert.equal(mock.requests.length, 1); release!();
    const results = await Promise.all([a, b]); assert.equal(mock.requests.length, 1); assert.ok(results.every(item => !item.busy));
  } finally { release?.(); exporter.close(); }
  const delayed = transport(request => new Promise((_resolve, reject) => request.options.signal!.addEventListener('abort', () => reject(new Error('abort')), { once: true })));
  const closing = new LoopTelemetry({ env, dbPath: ':memory:', fetchImpl: delayed.fetchImpl });
  const pending = closing.sync(overview()); closing.close(); await pending; assert.equal(closing.status().ready, false);
});

test('bounded export resumes past delivered rows instead of starving the remaining backlog', async () => {
  const mock = transport(); const exporter = new LoopTelemetry({ env, dbPath: ':memory:', fetchImpl: mock.fetchImpl });
  try {
    const data = overview(Array.from({ length: 101 }, (_, i) => run({ id: `backlog-${i}` })));
    const first = await exporter.sync(data); assert.equal(first.deliveredTraces, 100); assert.match(first.reason, /remain/);
    const second = await exporter.sync(data); assert.equal(second.deliveredTraces, 101); assert.equal(mock.requests.length, 101);
  } finally { exporter.close(); }
});
