import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createApp } from './app.ts';
import { RunStore } from './store.ts';
import { ProductWorkspace } from './product-workspace.ts';
import { PaidAnswerReview } from './paid-answer-review.ts';
import { SapiomFeedbackProvider } from './feedback-provider.ts';
import { FeedbackLoop } from './feedback-loop.ts';
import { PilotRunner, PilotStore } from './pilot.ts';
import type { ProductCorpus, LoopRetriever } from './loop-types.ts';
import type { AnswerRevisions } from './answer-revisions.ts';

type Overview = ReturnType<AnswerRevisions['overview']>;
const retriever = (corpus: ProductCorpus): LoopRetriever => ({
  close() {},
  async retrieve(productId) {
    return { passages: corpus.passages.filter(p => p.productId === productId).map(p => ({ ...p, lexicalRank: 1, semanticRank: null, score: 1 })), durationMs: 1, method: 'synthetic API fixture', embeddingModel: 'synthetic', corpusVersion: corpus.version };
  }
});

test('a failed review write preserves the successful answer response and recovers without another provider call', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-review-handoff-failure-'));
  const reviewPath = join(directory, 'review.sqlite');
  let calls = 0;
  const provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'synthetic-fixture', dbPath: join(directory, 'budget.sqlite'), capUsd: 0.1, allowancePerCallUsd: 0.1, callLimit: 1, fetchImpl: async (_url, init) => {
    calls++;
    const request = JSON.parse(String(init?.body)), input = JSON.parse(request.messages[1].content);
    const name = request.tool_choice.function.name;
    return new Response(JSON.stringify({ model: 'gpt-5.6-luna', choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name, arguments: JSON.stringify({ answer: 'Synthetic fixture: the handle is oak wood.', status: 'answered', citations: [{ quoteId: input.quoteOptions[0].id }] }) } }] } }], usage: { prompt_tokens: 12, completion_tokens: 8 } }), { status: 200 });
  } });
  const workspace = new ProductWorkspace(join(directory, 'workspace.sqlite'), provider, retriever);
  let snapshotReads = 0;
  const readSnapshots = workspace.reviewSnapshots.bind(workspace);
  workspace.reviewSnapshots = () => { snapshotReads++; return readSnapshots(); };
  const corpus: ProductCorpus = { version: 'synthetic-handoff-fixture', source: 'synthetic', license: 'synthetic', products: [], passages: [], cases: [] };
  const loop = new FeedbackLoop(corpus, retriever(corpus), provider, join(directory, 'loop.sqlite'));
  const store = new RunStore(join(directory, 'store.sqlite'));
  const paid = new PaidAnswerReview(reviewPath);
  const server = createApp(store, 'fixture', undefined, new PilotRunner(new PilotStore()), loop, undefined, workspace, paid, true, { answerProvider: provider, reviewDbPath: reviewPath });
  const reviewDb = new DatabaseSync(reviewPath);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    // Fail the real database handoff only after generation has saved its output.
    reviewDb.exec("CREATE TRIGGER fixture_review_unavailable BEFORE INSERT ON workspace_review_answers BEGIN SELECT RAISE(ABORT, 'Synthetic review storage failure'); END");
    const product = workspace.createProduct({ title: 'Synthetic tool', sources: [{ label: 'Synthetic manual', text: 'Synthetic fixture only: this tool has an oak wood handle.' }] });
    const response = await fetch(base + '/api/workspace/questions', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ productId: product.id, question: 'What is the handle made from?', mode: 'live' }) });
    const saved = await response.json();
    assert.equal(response.status, 201, JSON.stringify(saved));
    assert.equal(saved.status, 'completed');
    assert.equal(saved.reviewHandoff, 'pending');
    assert.equal(saved.error, null);
    assert.equal(saved.answer.answer, 'Synthetic fixture: the handle is oak wood.');
    assert.equal(calls, 1);
    assert.equal(provider.receipt(saved.id)?.status, 'completed');
    assert.equal(provider.capacity(1).ready, false, 'the completed answer still consumes its one reserved call');
    const history = await (await fetch(base + '/api/workspace')).json();
    assert.equal(history.runs.find((run: {id:string}) => run.id === saved.id).status, 'completed');
    assert.equal((reviewDb.prepare('SELECT COUNT(*) AS n FROM workspace_review_answers').get() as {n:number}).n, 0);
    reviewDb.exec('DROP TRIGGER fixture_review_unavailable');
    const recoveredResponse = await fetch(base + '/api/workspace/reviews');
    assert.equal(recoveredResponse.status, 200);
    const recovered: Overview = await recoveredResponse.json();
    assert.equal(recovered.cases.length, 1);
    assert.equal(recovered.cases[0].qid, `workspace-${saved.id}`);
    assert.deepEqual(recovered.cases[0].versions[0].answer, saved.answer);
    const readsAfterRecovery = snapshotReads;
    await fetch(base + '/api/workspace/reviews');
    assert.equal(snapshotReads, readsAfterRecovery, 'unchanged polling must not reparse historical snapshots');
    assert.equal((reviewDb.prepare('SELECT COUNT(*) AS n FROM workspace_review_answers').get() as {n:number}).n, 1);
    assert.equal(calls, 1, 'handoff recovery reuses the saved answer and never dispatches again');

    // Another connection can restore historical runs without going through this app.
    const historyDb = new DatabaseSync(join(directory, 'workspace.sqlite'));
    try {
      const insert = historyDb.prepare('INSERT INTO workspace_runs(id,created_at,document) VALUES(?,?,?)');
      for (let i = 0; i < 21; i++) {
        const copy = { ...history.runs[0], id: randomUUID(), createdAt: new Date(Date.UTC(2026, 9, 10, 0, 0, i)).toISOString() };
        insert.run(copy.id, copy.createdAt, JSON.stringify(copy));
      }
    } finally { historyDb.close(); }
    const firstPage: Overview = await (await fetch(base + '/api/workspace/reviews')).json();
    assert.equal(firstPage.cases.length, 20);
    assert.deepEqual(firstPage.pagination, { page: 1, pageSize: 20, total: 22, hasMore: true });
    assert.equal(snapshotReads, readsAfterRecovery + 1, 'external commits trigger one full recovery import');
    const older: Overview = await (await fetch(base + '/api/workspace/reviews?page=2')).json();
    assert.equal(older.cases.length, 2);
    assert.equal(older.pagination?.page, 2);
    const direct: Overview = await (await fetch(base + `/api/workspace/reviews?answer=workspace-${saved.id}`)).json();
    assert.equal(direct.pagination?.page, 2);
    assert.ok(direct.cases.some(item => item.qid === `workspace-${saved.id}`));
    assert.equal(snapshotReads, readsAfterRecovery + 1, 'page navigation reuses the completed import');
    for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=9007199254740992', 'answer=not-a-workspace-id']) {
      assert.equal((await fetch(base + '/api/workspace/reviews?' + query)).status, 400);
    }
    assert.equal(calls, 1, 'polling, pagination and recovery never dispatch another model call');
  } finally {
    reviewDb.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.close(); rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP workspace answer → rejection → background revision → source-checked decision survives restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-workspace-review-api-'));
  let calls = 0;
  // Every provider request is intercepted here. No network model/search call is made.
  const boot = async () => {
    const provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'synthetic-fixture', dbPath: join(directory, 'budget.sqlite'), capUsd: 1, allowancePerCallUsd: 0.1, callLimit: 10, fetchImpl: async (_url, init) => {
      calls++;
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.messages[1].content);
      const kind = request.tool_choice.function.name;
      const revision = kind === 'answer_revision_v1';
      const source = input.evidence[0];
      const output = { answer: revision ? 'Synthetic fixture revision: the handle is oak wood.' : 'Synthetic fixture original: an oak handle.', status: 'answered', citations: kind === 'product_answer_snippet' ? [{ quoteId: input.quoteOptions[0].id }] : [{ passageId: source.id, quote: source.text }] };
      return new Response(JSON.stringify({ model: 'gpt-5.6-luna', choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: kind, arguments: JSON.stringify(output) } }] } }], usage: { prompt_tokens: 12, completion_tokens: 8 } }), { status: 200 });
    } });
    const workspace = new ProductWorkspace(join(directory, 'workspace.sqlite'), provider, retriever);
    const corpus: ProductCorpus = { version: 'synthetic-api-fixture', source: 'synthetic', license: 'synthetic', products: [], passages: [], cases: [] };
    const loop = new FeedbackLoop(corpus, retriever(corpus), provider, join(directory, 'loop.sqlite'));
    const store = new RunStore(join(directory, 'store.sqlite'));
    const paid = new PaidAnswerReview(join(directory, 'reviews.sqlite'));
    const server = createApp(store, 'fixture', undefined, new PilotRunner(new PilotStore()), loop, undefined, workspace, paid, true, { answerProvider: provider, reviewDbPath: join(directory, 'reviews.sqlite') });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    return {
      workspace,
      async get(path: string) { const response = await fetch(base + path); assert.equal(response.status, 200); return response.json(); },
      async post(path: string, value: unknown, expected = 201) { const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(value) }); const body = await response.json(); assert.equal(response.status, expected, JSON.stringify(body)); return body; },
      async close() { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); store.close(); }
    };
  };
  let app: Awaited<ReturnType<typeof boot>> | undefined;
  try {
    app = await boot();
    const product = await app.post('/api/workspace/products', { title: 'Synthetic fixture tool', sources: [{ label: 'Synthetic fixture manual', text: 'Synthetic fixture only: the handle is made from oak wood.', originalQuestion: 'What is this fixture handle made from?' }] });
    await app.post('/api/workspace/questions', { productId: product.id, question: 'What material is the handle?', mode: 'preview' });
    assert.equal((await app.get('/api/workspace/reviews')).cases.length, 0, 'previews have no answer to judge');
    assert.equal(calls, 0);
    const answer = await app.post('/api/workspace/questions', { productId: product.id, question: 'What material is the handle?', mode: 'live' });
    assert.equal(answer.status, 'completed');
    const first: Overview = await app.get('/api/workspace/reviews');
    assert.equal(first.cases.length, 1);
    const item = first.cases[0], original = item.versions[0];
    assert.equal(item.qid, `workspace-${answer.id}`);
    assert.equal(original.context!.question, answer.question);
    assert.equal(original.context!.sources[0].originalQuestion, 'What is this fixture handle made from?');
    const path = `/api/workspace/reviews/${item.qid}`;
    const input = { versionId: original.id, idempotencyKey: 'synthetic-http-reject-1', reviewer: 'Synthetic test reviewer', feedback: 'State the handle material clearly and directly.', issue: 'answer_quality', investigate: true };
    const job = await app.post(path + '/revisions', input, 202);
    assert.equal((await app.post(path + '/revisions', input, 202)).id, job.id);
    await app.post(path + '/revisions', { ...input, feedback: 'A different critique with the same key.' }, 409);
    await app.post(path + '/decisions', { versionId: original.id, reviewer: 'Synthetic test reviewer', decision: 'accept', note: 'Too soon', checkedSourceShas: [original.context!.sources[0].sha256] }, 409);
    let completed = first;
    for (let attempt = 0; attempt < 80; attempt++) {
      completed = await app.get('/api/workspace/reviews');
      if (completed.cases[0].jobs[0].status === 'ready') break;
      await delay(100);
    }
    assert.equal(completed.cases[0].jobs[0].status, 'ready');
    assert.equal(completed.cases[0].versions.length, 2);
    assert.equal(calls, 2, 'one answer plus one revision; duplicate request does not dispatch');
    const latest = completed.cases[0].versions[1];
    const decision = { versionId: latest.id, reviewer: 'Synthetic test reviewer', decision: 'accept', note: 'Checked the synthetic fixture source.', checkedSourceShas: [latest.context!.sources[0].sha256] };
    await app.post(path + '/decisions', { ...decision, versionId: original.id }, 409);
    await app.post(path + '/decisions', { ...decision, checkedSourceShas: ['f'.repeat(64)] }, 409);
    await app.post(path + '/decisions', decision);
    await app.post(path + '/decisions', decision, 409);
    const pinned: Overview = await app.get('/api/paid-review/revisions');
    assert.equal(pinned.cases.length, 20);
    assert.equal(pinned.summary.requested, 0);
    assert.equal((await app.get('/api/paid-review')).summary.reviewed, 0);

    // Simulate the answer having been persisted immediately before the app
    // could register it. Startup must import it without another model call.
    const orphan = await app.workspace.ask({ productId: product.id, question: 'Can you describe the fixture handle material?', mode: 'live' });
    await app.close(); app = undefined;
    app = await boot();
    const restored: Overview = await app.get('/api/workspace/reviews');
    assert.equal(restored.cases.length, 2);
    const saved = restored.cases.find(c => c.qid === item.qid)!;
    assert.equal(saved.jobs[0].status, 'accepted');
    assert.equal(saved.versions.length, 2);
    assert.deepEqual(saved.versions[0], original);
    const recovered = restored.cases.find(c => c.qid === `workspace-${orphan.id}`)!;
    assert.equal(recovered.versions.length, 1);
    await app.post(`/api/workspace/reviews/${recovered.qid}/decisions`, { ...decision, versionId: recovered.versions[0].id, checkedSourceShas: [recovered.versions[0].context!.sources[0].sha256] });
    assert.equal(calls, 3, 'startup and source-checked original decision do not dispatch');
  } finally {
    await app?.close(); rmSync(directory, { recursive: true, force: true });
  }
});
