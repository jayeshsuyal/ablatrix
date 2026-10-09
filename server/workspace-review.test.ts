import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ProductWorkspace } from './product-workspace.ts';
import { PaidAnswerReview } from './paid-answer-review.ts';
import { AnswerRevisions } from './answer-revisions.ts';
import { SapiomFeedbackProvider } from './feedback-provider.ts';
import { textHash } from './product-corpus.ts';
import { investigateRevision } from './revision-investigation.ts';
import { workspaceReviewSourceHash, type ReviewAnswerSnapshot } from './answer-review-source.ts';
import type { LoopProvider, LoopRetriever, ProductCorpus } from './loop-types.ts';

function firstPassage(corpus: ProductCorpus): LoopRetriever {
  return { close() {}, async retrieve() { return { passages: corpus.passages.slice(0, 1).map(passage => ({ ...passage, lexicalRank: 1, semanticRank: 1, score: 1 })), durationMs: 1, method: 'synthetic', embeddingModel: 'synthetic', corpusVersion: corpus.version }; } };
}
const workspaceProvider: LoopProvider = {
  readiness: () => ({ ready: true, reason: 'Synthetic test provider.' }),
  async answer(input) { return { answer: { answer: 'The synthetic listing identifies a nylon shell.', status: 'answered', citations: [{ passageId: input.passages[0].id, quote: input.passages[0].text }] }, model: 'synthetic-model', usage: null }; },
  async propose() { throw new Error('No policy proposal in workspace review tests.'); }
};
function snapshot(): ReviewAnswerSnapshot {
  const runId = randomUUID(), productId = randomUUID();
  const sources = [
    { id: randomUUID(), label: 'Synthetic listing', text: 'The synthetic jacket has a nylon shell and a detachable hood.', originalQuestion: null },
    { id: randomUUID(), label: 'Synthetic customer answer', text: 'The synthetic jacket fits the reported measurements.', originalQuestion: 'Does this synthetic jacket fit model AB-12?' }
  ].map(source => ({ ...source, sha256: workspaceReviewSourceHash(source), origin: 'workspace' as const }));
  return { id: `workspace-${runId}`, runId, context: { question: 'What is the synthetic shell made of?', product: { id: productId, title: 'Synthetic trail jacket' }, sources, clarifications: [] },
    answer: { answer: 'The listing identifies a nylon shell.', status: 'answered', citations: [{ passageId: sources[0].id, quote: 'nylon shell' }] },
    model: 'synthetic-model', promptVersion: 'product-answer-v2-context', createdAt: '2026-10-09T12:00:00.000Z', contextProvenance: 'workspace_source_snapshot', generationSourceIds: [sources[0].id] };
}

test('workspace freezes all source chunks before dispatch and hands off only completed live answers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'workspace-review-snapshot-')), path = join(directory, 'workspace.sqlite');
  let reject = false;
  const provider: LoopProvider = { ...workspaceProvider, async answer(input) {
    const db = new DatabaseSync(path);
    const run = JSON.parse((db.prepare('SELECT document FROM workspace_runs WHERE id=?').get(input.runId!) as {document:string}).document);
    db.close();
    assert.ok(run.reviewContext.sources.length > input.passages.length, 'full source candidates are saved before the model call');
    assert.deepEqual(run.retrieval.passages.map((source: {id:string}) => source.id), input.passages.map(source => source.id));
    if (reject) throw new Error('Synthetic transport failure.');
    return workspaceProvider.answer(input);
  } };
  let workspace = new ProductWorkspace(path, provider, firstPassage);
  try {
    const product = workspace.createProduct({ title: 'Synthetic trail jacket', sources: [
      { label: 'Synthetic listing', text: 'The synthetic jacket has a nylon shell and a detachable hood.' },
      { label: 'Synthetic customer answer', text: 'The synthetic jacket fits the reported measurements. '.repeat(10), originalQuestion: 'Does this synthetic jacket fit model AB-12?' }
    ] });
    await workspace.ask({ productId: product.id, question: 'What is the shell made of?', mode: 'preview' });
    const run = await workspace.ask({ productId: product.id, question: 'What is the shell made of?', mode: 'live' });
    assert.equal(run.status, 'completed');
    const saved = workspace.reviewSnapshots()[0];
    assert.equal(saved.contextProvenance, 'workspace_source_snapshot');
    assert.ok(saved.context.sources.length > 2, 'source chunk boundaries and IDs are retained');
    assert.deepEqual(saved.generationSourceIds, run.retrieval!.passages.map(source => source.id));
    assert.equal(saved.context.sources[1].originalQuestion, 'Does this synthetic jacket fit model AB-12?');
    assert.equal(saved.answer.citations[0].passageId, saved.context.sources[0].id);
    reject = true;
    await workspace.ask({ productId: product.id, question: 'What is the shell made of?', mode: 'live' });
    assert.equal(workspace.reviewSnapshots().length, 1, 'preview and failed attempts never become review answers');
    workspace.close();
    const db = new DatabaseSync(path);
    db.prepare('UPDATE workspace_products SET document=? WHERE id=?').run(JSON.stringify({ ...product, title: 'A later title', sources: [] }), product.id);
    db.close();
    workspace = new ProductWorkspace(path, provider, firstPassage);
    assert.deepEqual(workspace.reviewSnapshots()[0], saved, 'review context is independent of later product records');
    saved.context.sources[0].text = 'Caller mutation';
    assert.notEqual(workspace.reviewSnapshots()[0].context.sources[0].text, saved.context.sources[0].text);
  } finally { workspace.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('interactive history is bounded while full review import and older interrupted-run recovery remain durable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'workspace-review-history-')), path = join(directory, 'workspace.sqlite');
  let workspace = new ProductWorkspace(path, workspaceProvider, firstPassage);
  try {
    const product = workspace.createProduct({ title: 'Synthetic trail jacket', sources: [
      { label: 'Synthetic listing', text: 'The synthetic jacket has a nylon shell and a detachable hood.' },
      { label: 'Never retrieved', text: 'This source was not passed to the synthetic answer model.' }
    ] });
    const original = await workspace.ask({ productId: product.id, question: 'What is the shell made of?', mode: 'live' });
    const { reviewContext: _context, generationProtocol: _protocol, ...legacy } = original;
    workspace.close();
    const db = new DatabaseSync(path), insert = db.prepare('INSERT INTO workspace_runs(id,created_at,document) VALUES(?,?,?)');
    for (let i = 0; i < 101; i++) {
      const value = { ...legacy, id: randomUUID(), createdAt: '2026-09-01T00:00:00.000Z' };
      insert.run(value.id, value.createdAt, JSON.stringify(value));
    }
    const interrupted = { ...legacy, id: randomUUID(), status: 'retrieving', createdAt: '2026-08-01T00:00:00.000Z' };
    insert.run(interrupted.id, interrupted.createdAt, JSON.stringify(interrupted));
    db.close();
    workspace = new ProductWorkspace(path, workspaceProvider, firstPassage);
    assert.equal(workspace.reviewSnapshots().length, 102);
    const fallback = workspace.reviewSnapshots().find(item => item.contextProvenance === 'saved_retrieval_only')!;
    assert.equal(fallback.context.sources.length, 1);
    assert.equal(fallback.context.sources[0].id, original.retrieval!.passages[0].id);
    assert.match(fallback.context.product.title, /original title unavailable/);
    assert.equal(fallback.promptVersion, 'workspace-legacy-protocol-unknown');
    const history = workspace.overview().runs;
    assert.equal(history.length, 100);
    assert.equal(history[0].id, original.id, 'interactive history retains the newest completed answer');
    assert.ok(!history.some(item => item.id === interrupted.id), 'the older recovered run stays outside the newest 100');
    const recovered = new DatabaseSync(path);
    const saved = JSON.parse((recovered.prepare('SELECT document FROM workspace_runs WHERE id=?').get(interrupted.id) as {document:string}).document);
    assert.equal(saved.status, 'failed');
    assert.match(saved.error, /interrupted/);
    // An old malformed document proves interactive history is limited before parsing.
    const malformedId = randomUUID();
    recovered.prepare('INSERT INTO workspace_runs(id,created_at,document) VALUES(?,?,?)').run(malformedId, '2026-07-01T00:00:00.000Z', '{malformed');
    try { assert.equal(workspace.overview().runs.length, 100); }
    finally { recovered.prepare('DELETE FROM workspace_runs WHERE id=?').run(malformedId); recovered.close(); }
    workspace.close();
    workspace = new ProductWorkspace(path, workspaceProvider, firstPassage);
    assert.equal(workspace.overview().runs.length, 100);
    assert.equal(workspace.reviewSnapshots().length, 102, 'import still includes all completed answers after restart');
  } finally { workspace.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('registration is durable, immutable, atomic and isolated from the frozen paid batch', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workspace-review-register-')), path = join(directory, 'review.sqlite');
  const reviews = new PaidAnswerReview(path), provider = new SapiomFeedbackProvider({ enabled: false, dbPath: join(directory, 'ledger.sqlite') });
  let flow = new AnswerRevisions(reviews, provider, path, false);
  try {
    const pinned = flow.overview('pinned'), input = snapshot();
    const registered = flow.registerAnswer(input);
    assert.deepEqual(flow.registerAnswer(structuredClone(input)), registered);
    assert.equal(flow.overview('workspace').cases.length, 1);
    assert.equal(flow.overview().cases.length, 21);
    assert.deepEqual(flow.overview('pinned'), pinned);
    for (const change of [
      { ...input, answer: { ...input.answer, answer: 'Different answer text.' } },
      { ...input, context: { ...input.context, question: 'A different question?' } },
      { ...input, contextProvenance: 'saved_retrieval_only' as const },
      { ...input, generationSourceIds: input.context.sources.map(source => source.id) }
    ]) assert.throws(() => flow.registerAnswer(change), /different snapshot/);
    const invalid = snapshot();
    invalid.context.sources[0].text = 'A changed source without its original digest.';
    assert.throws(() => flow.registerAnswer(invalid), /source provenance/);
    assert.equal(flow.overview('workspace').cases.length, 1, 'invalid handoff cannot leave a partial answer');
    input.context.sources[0].text = 'Caller mutation';
    registered.context!.sources[0].text = 'Caller version mutation';
    flow.close();
    flow = new AnswerRevisions(reviews, provider, path, false);
    const restored = flow.overview('workspace').cases[0];
    assert.equal(restored.versions.length, 1);
    assert.match(restored.versions[0].context!.sources[0].text, /nylon shell/);
    assert.deepEqual(flow.overview('pinned'), pinned);
    assert.equal(reviews.overview().summary.reviewed, 0);
  } finally { flow.close(); provider.close(); reviews.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('workspace review pages load only their answers and preserve older deep links and pinned review', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workspace-review-pages-')), path = join(directory, 'review.sqlite');
  const reviews = new PaidAnswerReview(path), provider = new SapiomFeedbackProvider({ enabled: false, dbPath: join(directory, 'ledger.sqlite') });
  const flow = new AnswerRevisions(reviews, provider, path, false), db = new DatabaseSync(path);
  try {
    const pinned = flow.overview('pinned');
    assert.deepEqual(flow.overview('workspace').pagination, { page: 1, pageSize: 20, total: 0, hasMore: false });
    const inputs = Array.from({ length: 45 }, (_, index) => ({ ...snapshot(), createdAt: new Date(Date.UTC(2026, 9, 9, 12, 0, index)).toISOString() }));
    const originals = inputs.map(input => flow.registerAnswer(input));
    flow.decide(inputs[0].id, { versionId: originals[0].id, reviewer: 'Synthetic pagination reviewer', decision: 'accept', note: 'Checked the oldest synthetic answer.', checkedSourceShas: [inputs[0].context.sources[0].sha256] });
    flow.request(inputs[1].id, { versionId: originals[1].id, idempotencyKey: 'synthetic-old-page-job', reviewer: 'Synthetic pagination reviewer', feedback: 'Investigate the older synthetic answer detail.' });
    const orderedIds = inputs.map(input => input.id).reverse();
    const first = flow.overview('workspace');
    const second = flow.overview('workspace', { page: 2 });
    const third = flow.overview('workspace', { page: 3 });
    assert.deepEqual(first.pagination, { page: 1, pageSize: 20, total: 45, hasMore: true });
    assert.deepEqual(second.pagination, { page: 2, pageSize: 20, total: 45, hasMore: true });
    assert.deepEqual(third.pagination, { page: 3, pageSize: 20, total: 45, hasMore: false });
    assert.deepEqual(first.cases.map(item => item.qid), orderedIds.slice(0, 20));
    assert.deepEqual(second.cases.map(item => item.qid), orderedIds.slice(20, 40));
    assert.deepEqual(third.cases.map(item => item.qid), orderedIds.slice(40));
    assert.equal(first.summary.accepted, 0);
    assert.equal(first.summary.requested, 0);
    assert.equal(first.pending, 0);
    assert.equal(third.summary.accepted, 1, 'summary counts describe only the returned page');
    assert.equal(third.summary.requested, 1);
    assert.equal(third.pending, 1);
    const deepLink = flow.overview('workspace', { page: 1, answer: inputs[0].id });
    assert.deepEqual(deepLink.pagination, third.pagination);
    assert.deepEqual(deepLink.cases, third.cases);
    assert.deepEqual(flow.overview('workspace', { page: 2, answer: `workspace-${randomUUID()}` }).pagination, second.pagination);
    assert.deepEqual(flow.overview('workspace', { page: 99 }).pagination, third.pagination);
    assert.deepEqual(flow.overview('workspace', { page: Number.NaN }).pagination, first.pagination);
    assert.deepEqual(flow.overview('pinned', { page: 3, answer: inputs[0].id }), pinned, 'workspace pages never change the frozen review cohort');
    const originalDocument = (db.prepare('SELECT document FROM answer_versions WHERE id=?').get(originals[0].id) as { document: string }).document;
    db.prepare('UPDATE answer_versions SET document=? WHERE id=?').run('{malformed', originals[0].id);
    try {
      assert.deepEqual(flow.overview('workspace').cases, first.cases, 'off-page version documents must not be parsed');
      assert.deepEqual(flow.overview('workspace', { page: 2 }).cases, second.cases);
      assert.deepEqual(flow.overview('pinned'), pinned);
      assert.throws(() => flow.overview('workspace', { answer: inputs[0].id }), SyntaxError, 'the malformed record is on the deep-linked page');
    } finally { db.prepare('UPDATE answer_versions SET document=? WHERE id=?').run(originalDocument, originals[0].id); }
    assert.equal((db.prepare('SELECT COUNT(*) AS total FROM workspace_review_answers').get() as { total: number }).total, 45, 'pagination never removes older answers');
  } finally { db.close(); flow.close(); provider.close(); reviews.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('workspace pages order saved timestamps across mixed imports, existing rows and later answers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workspace-review-chronology-')), path = join(directory, 'review.sqlite');
  const reviews = new PaidAnswerReview(path), provider = new SapiomFeedbackProvider({ enabled: false, dbPath: join(directory, 'ledger.sqlite') });
  let flow = new AnswerRevisions(reviews, provider, path, false);
  const db = new DatabaseSync(path);
  try {
    const pinned = flow.overview('pinned');
    const inputs = Array.from({ length: 25 }, (_, index) => ({ ...snapshot(), createdAt: ['2026-10-09T12:00:00Z', '2026-10-09T12:00:00.000Z', '2026-10-09T12:00:00.100Z'][index % 3] }));
    const ordered = [...inputs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : -1));
    // Start with the newest answer, then mix newer and older records as recovery may do.
    const importOrder = [...ordered.filter((_, index) => index % 2 === 0), ...ordered.filter((_, index) => index % 2 === 1).reverse()];
    for (const input of importOrder) flow.registerAnswer(input);
    const ids = (page: number) => flow.overview('workspace', { page }).cases.map(item => item.qid);
    assert.deepEqual(ids(1), ordered.slice(0, 20).map(input => input.id));
    assert.deepEqual(ids(2), ordered.slice(20).map(input => input.id));
    const documents = db.prepare('SELECT id,document FROM workspace_review_answers ORDER BY id').all();
    flow.close();
    // Simulate the prior schema: answers exist before the chronology index is added.
    db.exec('DROP INDEX workspace_review_chronology');
    flow = new AnswerRevisions(reviews, provider, path, false);
    assert.deepEqual(ids(1), ordered.slice(0, 20).map(input => input.id));
    assert.deepEqual(ids(2), ordered.slice(20).map(input => input.id));
    for (const input of inputs) flow.registerAnswer(input);
    assert.deepEqual(db.prepare('SELECT id,document FROM workspace_review_answers ORDER BY id').all(), documents, 'restart and idempotent import preserve the original snapshots');
    assert.equal(flow.overview('workspace', { answer: ordered[19].id }).pagination?.page, 1, 'equal-time ID tie resolves the last answer on page one');
    assert.equal(flow.overview('workspace', { answer: ordered[20].id }).pagination?.page, 2, 'equal-time ID tie resolves the first answer on page two');
    assert.equal(flow.overview('workspace', { answer: ordered[24].id }).pagination?.page, 2);
    const newer = { ...snapshot(), createdAt: '2026-10-09T12:00:01.000Z' };
    flow.registerAnswer(newer);
    assert.deepEqual(ids(1), [newer.id, ...ordered.slice(0, 19).map(input => input.id)]);
    assert.deepEqual(ids(2), ordered.slice(19).map(input => input.id));
    const shifted = flow.overview('workspace', { answer: ordered[19].id });
    assert.equal(shifted.pagination?.page, 2, 'a deep link follows its answer across the page boundary after a new answer');
    assert.equal(shifted.cases[0].qid, ordered[19].id);
    assert.deepEqual(flow.overview('pinned'), pinned);
  } finally { db.close(); flow.close(); provider.close(); reviews.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('original workspace decisions require checked answer sources and leave pinned review gates intact', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workspace-review-decide-')), path = join(directory, 'review.sqlite');
  const reviews = new PaidAnswerReview(path), provider = new SapiomFeedbackProvider({ enabled: false, dbPath: join(directory, 'ledger.sqlite') });
  const flow = new AnswerRevisions(reviews, provider, path, false);
  try {
    const input = snapshot(), original = flow.registerAnswer(input);
    const decision = { versionId: original.id, reviewer: 'Synthetic reviewer', decision: 'accept', note: 'Checked the synthetic cited source.', checkedSourceShas: [input.context.sources[0].sha256] };
    assert.throws(() => flow.decide(input.id, { ...decision, checkedSourceShas: ['f'.repeat(64)] }), /belong to this answer/);
    assert.throws(() => flow.decide(input.id, { ...decision, checkedSourceShas: [input.context.sources[1].sha256] }), /source cited/);
    assert.throws(() => flow.decide(input.id, { ...decision, checkedSourceShas: [input.context.sources[0].sha256, input.context.sources[0].sha256] }), /distinct/);
    const saved = flow.decide(input.id, decision);
    assert.equal(saved.reviewKind, 'human');
    assert.equal(flow.overview('workspace').summary.accepted, 1);
    assert.equal(flow.overview('workspace').summary.providerCalls, 0);
    assert.throws(() => flow.decide(input.id, decision), /already has a decision/);
    assert.throws(() => flow.request(input.id, { versionId: original.id, idempotencyKey: 'synthetic-after-accept', reviewer: 'Synthetic reviewer', feedback: 'Rewrite the accepted synthetic answer.' }), /has been accepted/);
    const pinned = flow.overview('pinned').cases[0], source = reviews.overview().cases[0].sources[0];
    assert.throws(() => flow.decide(pinned.qid, { ...decision, versionId: pinned.versions[0].id, checkedSourceShas: [source.sha256] }), /require a revised answer/);
    const uncertain = snapshot(), uncertainVersion = flow.registerAnswer(uncertain);
    flow.decide(uncertain.id, { ...decision, versionId: uncertainVersion.id, decision: 'needs_information', checkedSourceShas: [uncertain.context.sources[0].sha256] });
    assert.equal(flow.overview('workspace').summary.unresolved, 1);
    assert.equal(flow.request(uncertain.id, { versionId: uncertainVersion.id, idempotencyKey: 'synthetic-after-uncertain', reviewer: 'Synthetic reviewer', feedback: 'Address the missing synthetic source detail.' }).status, 'queued');
  } finally { flow.close(); provider.close(); reviews.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('identical customer answers bind review checks to their own source identity and original question', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workspace-review-source-identity-')), path = join(directory, 'review.sqlite');
  const reviews = new PaidAnswerReview(path), provider = new SapiomFeedbackProvider({ enabled: false, dbPath: join(directory, 'ledger.sqlite') });
  const flow = new AnswerRevisions(reviews, provider, path, false);
  try {
    const input = snapshot();
    input.context.sources[0].originalQuestion = 'Does it fit the synthetic model AB-12?';
    input.context.sources[1].originalQuestion = 'Does it fit the synthetic model XY-34?';
    input.context.sources[1].text = input.context.sources[0].text;
    for (const source of input.context.sources) source.sha256 = workspaceReviewSourceHash(source);
    assert.equal(textHash(input.context.sources[0].text), textHash(input.context.sources[1].text));
    assert.notEqual(input.context.sources[0].sha256, input.context.sources[1].sha256);
    const original = flow.registerAnswer(input);
    const decision = { versionId: original.id, reviewer: 'Synthetic reviewer', decision: 'accept', note: 'Checked the exact cited customer question.', checkedSourceShas: [input.context.sources[1].sha256] };
    assert.throws(() => flow.decide(input.id, decision), /source cited/);
    flow.decide(input.id, { ...decision, checkedSourceShas: [input.context.sources[0].sha256] });
    assert.equal(flow.overview('workspace').summary.accepted, 1);
  } finally { flow.close(); provider.close(); reviews.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('investigated workspace revisions preserve a large audit snapshot and bound only the selected model context', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'workspace-review-large-context-')), path = join(directory, 'review.sqlite');
  const reviews = new PaidAnswerReview(path); let calls = 0; let selectedCount = 0;
  const provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'synthetic', dbPath: join(directory, 'ledger.sqlite'), capUsd: 0.1, allowancePerCallUsd: 0.1, callLimit: 1,
    fetchImpl: async (_url, init) => {
      calls++;
      const input = JSON.parse(JSON.parse(String(init?.body)).messages[1].content), source = input.evidence[0];
      selectedCount = input.evidence.length;
      assert.ok(JSON.stringify(input).length < 35_000);
      return new Response(JSON.stringify({ model: 'gpt-5.6-luna', choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: 'answer_revision_v1', arguments: JSON.stringify({ answer: 'The synthetic answer directly states the shell material.', status: 'answered', citations: [{ passageId: source.id, quote: source.text.slice(0, 35) }] }) } }] } }], usage: { prompt_tokens: 12, completion_tokens: 8 } }), { status: 200 });
    } });
  const flow = new AnswerRevisions(reviews, provider, path, false);
  try {
    const input = snapshot(), first = input.context.sources[0];
    input.context.sources = Array.from({ length: 60 }, (_, index) => {
      const source = { ...first, id: index === 0 ? first.id : randomUUID(), text: first.text.padEnd(290, '.'), originalQuestion: 'What material does the synthetic shell use? '.padEnd(490, 'x') };
      return { ...source, sha256: workspaceReviewSourceHash(source) };
    });
    assert.ok(JSON.stringify(input.context).length > 35_000);
    const original = flow.registerAnswer(input);
    const request = { versionId: original.id, idempotencyKey: 'synthetic-large-context', reviewer: 'Synthetic reviewer', feedback: 'State the synthetic supported shell material more clearly.', issue: 'answer_quality' };
    assert.throws(() => flow.request(input.id, { ...request, investigate: false }), /too large/);
    flow.request(input.id, { ...request, investigate: true });
    await flow.tick();
    const state = flow.overview('workspace').cases[0];
    assert.equal(calls, 1);
    assert.equal(selectedCount, 12);
    assert.equal(state.jobs[0].status, 'ready');
    assert.equal(state.jobs[0].context!.sources.length, 60);
    assert.equal(state.versions.at(-1)!.context!.sources.length, 60);
    assert.equal(state.versions.at(-1)!.investigation!.selectedSourceIds.length, 12);
  } finally { flow.close(); provider.close(); reviews.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('external investigation can add bounded selected sources while retaining a large workspace audit context', async () => {
  const input = snapshot(), first = input.context.sources[0];
  input.context.question = 'What material is the jacket shell?';
  input.context.sources = Array.from({ length: 60 }, () => {
    const source = { ...first, id: randomUUID(), text: first.text.padEnd(290, '.'), originalQuestion: 'What material does this synthetic jacket shell use? '.padEnd(490, 'x') };
    return { ...source, sha256: workspaceReviewSourceHash(source) };
  });
  assert.ok(JSON.stringify(input.context).length > 35_000);
  let reads = 0;
  const result = await investigateRevision({ context: input.context, critique: 'The jacket shell material details are missing.', issue: 'missing_evidence', runId: 'synthetic-large-web-context', originalSourceIds: input.context.sources.map(source => source.id) }, {
    readiness: () => ({ ready: true, reason: 'Synthetic search fixture.' }),
    allowed: url => url.startsWith('https://example.test/'),
    async search() { return { results: [{ title: 'Synthetic shell manual', url: 'https://example.test/manual', snippet: 'Synthetic search lead only.' }, { title: 'Synthetic shell care', url: 'https://example.test/care', snippet: 'Synthetic search lead only.' }] }; },
    async read(url) { reads++; return { url, title: 'Synthetic source', text: url.endsWith('/manual') ? 'The synthetic jacket shell material is nylon with a sealed waterproof coating.' : 'The synthetic care instructions say the jacket shell material is treated nylon and permits cold washing.' }; }
  });
  assert.equal(reads, 2);
  assert.equal(result.investigation.status, 'ready_to_revise');
  assert.equal(result.context.sources.length, 62);
  assert.equal(result.investigation.addedSourceIds.length, 2);
  assert.equal(result.investigation.selectedSourceIds.length, 12);
  assert.ok(result.investigation.addedSourceIds.every(id => result.investigation.selectedSourceIds.includes(id)));
});

test('workspace revisions use the existing durable queue and provider receipts with immutable source IDs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'workspace-review-worker-')), path = join(directory, 'review.sqlite');
  const reviews = new PaidAnswerReview(path); let calls = 0; const seen: any[] = [];
  const provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'synthetic', dbPath: join(directory, 'ledger.sqlite'), capUsd: 0.2, allowancePerCallUsd: 0.1, callLimit: 2,
    fetchImpl: async (_url, init) => {
      calls++;
      const input = JSON.parse(JSON.parse(String(init?.body)).messages[1].content); seen.push(input);
      const source = input.evidence[0];
      return new Response(JSON.stringify({ model: 'gpt-5.6-luna', choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: 'answer_revision_v1', arguments: JSON.stringify({ answer: 'The synthetic revision states the listed material directly.', status: 'answered', citations: [{ passageId: source.id, quote: source.text.slice(0, 35) }] }) } }] } }], usage: { prompt_tokens: 12, completion_tokens: 8 } }), { status: 200 });
    } });
  let flow = new AnswerRevisions(reviews, provider, path, false);
  try {
    const input = snapshot(), original = flow.registerAnswer(input);
    const request = { versionId: original.id, idempotencyKey: 'synthetic-workspace-revision', reviewer: 'Synthetic reviewer', feedback: 'The synthetic answer should state the supported material clearly.', investigate: false };
    const job = flow.request(input.id, request);
    assert.equal(flow.request(input.id, request).id, job.id);
    assert.throws(() => flow.request(input.id, { ...request, feedback: 'This is a different synthetic critique.' }), /different request/);
    assert.throws(() => flow.request(input.id, { ...request, idempotencyKey: 'synthetic-duplicate-active' }), /active or unresolved job/);
    flow.close(); flow = new AnswerRevisions(reviews, provider, path, false);
    await flow.tick(); await flow.tick();
    const state = flow.overview('workspace').cases[0], latest = state.versions.at(-1)!;
    assert.equal(calls, 1);
    assert.equal(state.jobs[0].status, 'ready');
    assert.equal(latest.parentId, original.id);
    assert.equal(latest.context!.product.id, input.context.product.id);
    assert.equal(seen[0].evidence[1].originalQuestion, input.context.sources[1].originalQuestion);
    assert.equal(latest.answer.citations[0].passageId, input.context.sources[0].id);
    assert.equal(provider.receipt(job.id)?.status, 'completed');
    assert.equal(flow.overview('pinned').summary.providerCalls, 0);
    assert.equal(flow.overview('workspace').summary.providerCalls, 1);
    const decision = { versionId: latest.id, reviewer: 'Synthetic reviewer', decision: 'accept', note: 'Checked the synthetic revision.', checkedSourceShas: [input.context.sources[0].sha256] };
    assert.throws(() => flow.decide(input.id, { ...decision, versionId: original.id }), /stale/);
    flow.decide(input.id, decision);
    flow.reconcile(); await flow.tick();
    assert.equal(calls, 1);
    assert.equal(flow.overview('workspace').summary.accepted, 1);
    assert.equal(flow.overview('pinned').cases.length, 20);
  } finally { flow.close(); provider.close(); reviews.close(); rmSync(directory, { recursive: true, force: true }); }
});
