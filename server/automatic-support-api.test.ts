import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from './app.ts';
import { RunStore } from './store.ts';
import { ProductWorkspace } from './product-workspace.ts';
import { PaidAnswerReview } from './paid-answer-review.ts';
import { SyntheticAnswerProvider } from './synthetic-answer-provider.ts';
import { SapiomFeedbackProvider } from './feedback-provider.ts';
import { PilotRunner, PilotStore } from './pilot.ts';
import type { ProductCorpus, LoopRetriever } from './loop-types.ts';

const retriever = (corpus: ProductCorpus): LoopRetriever => ({ close() {}, async retrieve(productId) {
  return { passages: corpus.passages.filter(p => p.productId === productId).map(p => ({ ...p, lexicalRank: 1, semanticRank: null, score: 1 })), durationMs: 1, method: 'SYNTHETIC API fixture', embeddingModel: 'synthetic', corpusVersion: corpus.version };
} });

test('HTTP automatic source check repairs once, retains the original, and records no human decision', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-auto-support-api-'));
  const reviews = join(directory, 'reviews.sqlite');
  const provider = new SyntheticAnswerProvider(join(directory, 'synthetic.sqlite'));
  const workspace = new ProductWorkspace(join(directory, 'workspace.sqlite'), provider, retriever);
  const store = new RunStore(join(directory, 'store.sqlite'));
  const server = createApp(store, 'fixture', undefined, new PilotRunner(new PilotStore()), undefined, undefined, workspace, new PaidAnswerReview(reviews), false, { answerProvider: provider, reviewDbPath: reviews });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const post = async (path: string, input: unknown, expected = 201) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(input) });
    const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value;
  };
  try {
    const product = workspace.createProduct({ title: 'SYNTHETIC bottle', sources: [{ label: 'SYNTHETIC manual', text: 'SYNTHETIC fixture: This bottle holds 600 ml and has a twist cap.' }] });
    const plain = await post('/api/workspace/questions', { productId: product.id, question: 'How much does this bottle hold?', mode: 'synthetic' });
    assert.deepEqual((await (await fetch(base + `/api/workspace/automatic-checks?answer=workspace-${plain.id}`)).json()).checks, [], 'reading an old answer never enqueues grading');
    await post('/api/workspace/questions', { productId: product.id, question: 'How much does this bottle hold?', mode: 'synthetic', automaticCheck: 'yes' }, 400);
    await post('/api/workspace/questions', { productId: product.id, question: 'How much does this bottle hold?', mode: 'preview', automaticCheck: true }, 400);
    const run = await post('/api/workspace/questions', { productId: product.id, question: 'How much does this bottle hold?', mode: 'synthetic', automaticCheck: true, idempotencyKey: 'api-idempotency-checked-v1' });
    const duplicate = await post('/api/workspace/questions', { productId: product.id, question: 'How much does this bottle hold?', mode: 'synthetic', automaticCheck: true, idempotencyKey: 'api-idempotency-checked-v1' }, 200);
    assert.equal(duplicate.id, run.id);
    assert.equal(duplicate.automaticCheck.id, run.automaticCheck.id);
    await post('/api/workspace/questions', { productId: product.id, question: 'A different question cannot reuse that key.', mode: 'synthetic', automaticCheck: true, idempotencyKey: 'api-idempotency-checked-v1' }, 409);
    assert.equal(run.automaticCheck.status, 'queued');
    assert.equal(run.automaticCheckRequested, true);
    assert.equal(run.automaticCheckHandoff, 'enqueued');
    const path = `/api/workspace/automatic-checks?answer=workspace-${run.id}`;
    let check;
    const deadline = Date.now() + 12_000;
    do {
      check = (await (await fetch(base + path)).json()).checks[0];
      if (['repaired', 'inconclusive', 'reconciliation', 'abstained'].includes(check.status)) break;
      await delay(100);
    } while (Date.now() < deadline);
    assert.equal(check.status, 'repaired', JSON.stringify(check));
    assert.equal(check.operations.length, 3);
    assert.deepEqual(check.operations.map((op: {phase:string}) => op.phase), ['grade_original', 'repair', 'grade_repair']);
    assert.equal(check.assessments.length, 2);
    assert.equal(check.qualityClaimEligible, false);
    assert.equal(check.graderBinding.version, 'claim-support-v4-cited-applicability');
    assert.equal(check.graderBinding.qualification.liveQualified, false);
    assert.equal(check.assessmentKind, 'synthetic_scripted_claim_support');
    assert.equal(check.delivery.origin, 'repair');
    assert.deepEqual(check.original.answer, run.answer);
    const exported = await (await fetch(base + '/api/workspace/reviews/export')).json();
    assert.deepEqual(exported.automaticChecks, [check]);
    assert.equal(exported.cases.find((item: {qid:string}) => item.qid === check.qid).events.length, 0);
    const saved = workspace.overview().runs.find(item => item.id === run.id)!;
    assert.deepEqual(saved.answer, run.answer, 'the immutable original is not replaced');
    const db = new DatabaseSync(reviews);
    try {
      assert.equal((db.prepare('SELECT COUNT(*) AS n FROM answer_review_events').get() as {n:number}).n, 0);
      const before = JSON.stringify(check);
      await delay(1600);
      assert.equal(JSON.stringify((await (await fetch(base + path)).json()).checks[0]), before, 'terminal polling cannot start another operation');
    } finally { db.close(); }
    assert.equal((await fetch(base + '/api/workspace/automatic-checks?answer=invalid')).status, 400);
  } finally { await server.shutdown(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('live automatic checks fail before generation without their independent opt-in', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-auto-opt-in-'));
  const prior = process.env.ABLATRIX_AUTOMATIC_CHECK_LIVE;
  process.env.ABLATRIX_AUTOMATIC_CHECK_LIVE = '0';
  let dispatches = 0;
  const provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'SYNTHETIC fixture only', dbPath: join(directory, 'budget.sqlite'), capUsd: 1, callLimit: 10, fetchImpl: async () => { dispatches++; throw new Error('Forbidden synthetic test dispatch'); } });
  const workspace = new ProductWorkspace(join(directory, 'workspace.sqlite'), provider, retriever);
  const store = new RunStore(join(directory, 'store.sqlite'));
  const server = createApp(store, 'fixture', undefined, new PilotRunner(new PilotStore()), undefined, undefined, workspace, new PaidAnswerReview(join(directory, 'reviews.sqlite')), false, { answerProvider: provider, reviewDbPath: join(directory, 'reviews.sqlite') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const product = workspace.createProduct({ title: 'SYNTHETIC tool', sources: [{ label: 'SYNTHETIC manual', text: 'SYNTHETIC fixture: This tool has an oak wood handle.' }] });
    const response = await fetch(base + '/api/workspace/questions', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ productId: product.id, question: 'What is the handle made from?', mode: 'live', automaticCheck: true }) });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /independent opt-in/);
    assert.equal(dispatches, 0);
    assert.equal(workspace.overview().runs.length, 0);
  } finally {
    await server.shutdown(); store.close(); rmSync(directory, { recursive: true, force: true });
    if (prior === undefined) delete process.env.ABLATRIX_AUTOMATIC_CHECK_LIVE; else process.env.ABLATRIX_AUTOMATIC_CHECK_LIVE = prior;
  }
});

test('startup recovers saved check intent only, and a failed enqueue remains visible after history reload', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-auto-handoff-'));
  const reviews = join(directory, 'reviews.sqlite');
  const syntheticPath = join(directory, 'synthetic.sqlite'), workspacePath = join(directory, 'workspace.sqlite');
  let provider = new SyntheticAnswerProvider(syntheticPath);
  let workspace = new ProductWorkspace(workspacePath, provider, retriever);
  const product = workspace.createProduct({ title: 'SYNTHETIC recovery bottle', sources: [{ label: 'SYNTHETIC manual', text: 'SYNTHETIC fixture: This bottle holds 600 ml and has a twist cap.' }] });
  const input = { productId: product.id, question: 'How much does this bottle hold?', mode: 'synthetic' };
  const unflagged = await workspace.ask(input);
  const pending = await workspace.ask(input, undefined, { automaticCheck: true });
  assert.equal(pending.automaticCheckHandoff, 'pending');
  const original = JSON.stringify(workspace.reviewSnapshots(pending.id)[0]);
  workspace.close(); provider.close();
  // Reopen the databases across the generation-to-enqueue crash boundary.
  provider = new SyntheticAnswerProvider(syntheticPath);
  workspace = new ProductWorkspace(workspacePath, provider, retriever);
  const store = new RunStore(join(directory, 'store.sqlite'));
  const server = createApp(store, 'fixture', undefined, new PilotRunner(new PilotStore()), undefined, undefined, workspace, new PaidAnswerReview(reviews), true, { answerProvider: provider, reviewDbPath: reviews });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const read = async (id: string) => (await (await fetch(base + `/api/workspace/automatic-checks?answer=workspace-${id}`)).json()).checks;
  const db = new DatabaseSync(reviews);
  try {
    assert.deepEqual(await read(unflagged.id), [], 'unflagged history cannot be backfilled');
    const checks = await read(pending.id);
    assert.equal(checks.length, 1);
    assert.equal(workspace.overview().runs.find(run => run.id === pending.id)?.automaticCheckHandoff, 'enqueued');
    assert.equal(JSON.stringify(workspace.reviewSnapshots(pending.id)[0]), original);
    const deadline = Date.now() + 12_000;
    while ((await read(pending.id))[0].status !== 'repaired' && Date.now() < deadline) await delay(100);
    assert.equal((await read(pending.id))[0].status, 'repaired');
    db.exec("CREATE TRIGGER fixture_auto_unavailable BEFORE INSERT ON automatic_support_jobs BEGIN SELECT RAISE(ABORT, 'SYNTHETIC storage failure'); END");
    const response = await fetch(base + '/api/workspace/questions', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ ...input, automaticCheck: true }) });
    const saved = await response.json();
    assert.equal(response.status, 201, JSON.stringify(saved));
    assert.equal(saved.status, 'completed');
    assert.equal(saved.automaticCheckHandoff, 'unavailable');
    assert.match(saved.automaticCheckError, /original was preserved/);
    assert.deepEqual(await read(saved.id), []);
    const history = await (await fetch(base + '/api/workspace')).json();
    assert.equal(history.runs.find((run: {id:string}) => run.id === saved.id).automaticCheckHandoff, 'unavailable');
    assert.deepEqual(history.runs.find((run: {id:string}) => run.id === saved.id).answer, saved.answer);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM automatic_support_jobs').get() as {n:number}).n, 1);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM answer_review_events').get() as {n:number}).n, 0);
  } finally { db.close(); await server.shutdown(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a successful enqueue is returned even when its workspace handoff marker cannot be saved', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-auto-marker-'));
  const reviews = join(directory, 'reviews.sqlite');
  const provider = new SyntheticAnswerProvider(join(directory, 'synthetic.sqlite'));
  const workspace = new ProductWorkspace(join(directory, 'workspace.sqlite'), provider, retriever);
  const store = new RunStore(join(directory, 'store.sqlite'));
  const server = createApp(store, 'fixture', undefined, new PilotRunner(new PilotStore()), undefined, undefined, workspace, new PaidAnswerReview(reviews), true, { answerProvider: provider, reviewDbPath: reviews });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const mark = workspace.markAutomaticCheckHandoff.bind(workspace);
  let unavailableWrites = 0;
  workspace.markAutomaticCheckHandoff = (id, state, error) => {
    if (state === 'enqueued') throw new Error('SYNTHETIC workspace storage lock');
    unavailableWrites++; return mark(id, state, error);
  };
  try {
    const product = workspace.createProduct({ title: 'SYNTHETIC marker bottle', sources: [{ label: 'SYNTHETIC manual', text: 'SYNTHETIC fixture: This bottle holds 600 ml and has a twist cap.' }] });
    const response = await fetch(base + '/api/workspace/questions', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ productId: product.id, question: 'How much does this bottle hold?', mode: 'synthetic', automaticCheck: true }) });
    const run = await response.json();
    assert.equal(response.status, 201, JSON.stringify(run));
    assert.equal(run.automaticCheck.status, 'queued');
    assert.equal(run.automaticCheckHandoff, 'pending');
    assert.equal(run.automaticCheckError, undefined);
    assert.equal(unavailableWrites, 0, 'a successful job cannot be marked unavailable');
    const path = `/api/workspace/automatic-checks?answer=workspace-${run.id}`;
    const read = async () => (await (await fetch(base + path)).json()).checks[0];
    assert.equal((await read()).id, run.automaticCheck.id);
    const deadline = Date.now() + 12_000;
    while ((await read()).status !== 'repaired' && Date.now() < deadline) await delay(100);
    const checked = await read();
    assert.equal(checked.status, 'repaired');
    assert.equal(checked.operations.length, 3);
    assert.deepEqual(checked.original.answer, run.answer);
    assert.equal(unavailableWrites, 0);
    assert.equal(workspace.automaticCheckSnapshots()[0].runId, run.id, 'pending marker can later replay the existing job');
  } finally { workspace.markAutomaticCheckHandoff = mark; await server.shutdown(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});
