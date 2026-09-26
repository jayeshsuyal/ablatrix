import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FeedbackLoop, pairedBootstrapInterval } from './feedback-loop.ts';
import { reserveExternalValidation } from './validation-ledger.ts';
import type { LoopProvider, LoopRetriever, LoopRun, ProductCorpus } from './loop-types.ts';

function setup(overrides: Partial<LoopProvider> = {}, path = ':memory:') {
  const products = Array.from({ length: 9 }, (_, i) => ({ id: `product-${i}`, title: `Test item ${i}`, split: i < 2 ? 'development' as const : i < 8 ? 'validation' as const : 'holdout' as const }));
  const corpus: ProductCorpus = { version: 'test-corpus-v1', source: 'test', license: 'test', products,
    passages: products.map(product => ({ id: `passage-${product.id}`, productId: product.id, source: 'manufacturer', text: `The product handle is oak wood for item ${product.id}.`, reference: 'test-source', sha256: 'test-hash' })),
    cases: products.map(product => ({ id: `case-${product.id}`, productId: product.id, question: `What is the handle material for item ${product.id}?`, split: product.split, referenceAnswer: `SECRET GOLD ${product.id}`, referencePassageIds: [`passage-${product.id}`], labelStatus: 'test-only' })) };
  let retrievalCalls = 0;
  const retriever: LoopRetriever = { close() {}, async retrieve(productId) { retrievalCalls++; return { passages: corpus.passages.filter(item => item.productId === productId).map(item => ({ ...item, lexicalRank: 1, semanticRank: 1, score: 1 })), durationMs: 1, method: 'test-hybrid', embeddingModel: 'test-embedding', corpusVersion: corpus.version }; } };
  const requests: unknown[] = [];
  const provider: LoopProvider = { readiness: () => ({ ready: true, reason: 'test stub' }), async answer(input) { requests.push(input); return { answer: { answer: 'Oak wood.', status: 'answered', citations: [{ passageId: input.passages[0].id, quote: 'oak wood' }] }, model: 'pinned-test-model', usage: { inputTokens: 20, outputTokens: 5 } }; }, async propose(input) { requests.push(input); return { instructions: 'Use manufacturer evidence to answer explicit factual questions, preserve uncertainty, and quote exact supporting passages. Never invent evidence.', rationale: 'Prefer the reviewed evidence handling procedure.' }; }, ...overrides };
  const loop = new FeedbackLoop(corpus, retriever, provider, path);
  const run = (mode: 'fixture' | 'live' = 'fixture', index = 0) => loop.run({ mode, productId: products[index].id, question: corpus.cases[index].question, caseId: corpus.cases[index].id });
  const review = (run: LoopRun, correct = false) => loop.review(run.id, { correct, supported: true, referenceChecked: true, category: correct ? 'none' : 'incomplete_answer', correction: correct ? '' : 'State the material supported by the manufacturer evidence.', sourceIds: [`passage-${run.productId}`], reviewer: 'Test reviewer' });
  return { loop, corpus, provider, retriever, run, review, requests, retrievalCalls: () => retrievalCalls };
}

test('fixture loop promotes synthetic mechanism, keeps live frozen, persists rollback and excludes holdout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'feedback-loop-test-')); const path = join(dir, 'loop.sqlite');
  const f = setup({}, path);
  try {
    const baseline = f.loop.overview().activePolicyIds;
    assert.ok(f.loop.overview().cases.every(item => item.split !== 'holdout'));
    const run = await f.run(); assert.equal(run.model, 'synthetic-fixture/no-model');
    f.review(run); const candidate = await f.loop.propose({ mode: 'fixture', runIds: [run.id] });
    const validation = await f.loop.validate(candidate.id);
    assert.equal(validation.runIds.length, 4); assert.equal(f.retrievalCalls(), 3, 'paired arms reuse one evidence retrieval');
    const accepted = f.loop.decide(validation.id); assert.equal(accepted.status, 'accepted'); assert.equal(accepted.candidateCorrect, 2); assert.match(accepted.reason, /SYNTHETIC/);
    assert.equal(f.loop.overview().activePolicyIds.live, baseline.live); assert.equal(f.requests.length, 0);
    assert.throws(() => f.loop.rollback({ mode: 'live', policyId: candidate.id }), /same mode/);
    assert.equal(f.loop.rollback({ mode: 'fixture', policyId: baseline.fixture }).activePolicyIds.fixture, baseline.fixture);
    f.loop.close(); const reopened = setup({}, path);
    assert.equal(reopened.loop.overview().validations[0].status, 'accepted'); assert.equal(reopened.loop.overview().activePolicyIds.fixture, baseline.fixture); reopened.loop.close();
  } finally { f.loop.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('live promotion requires every human review; provider never sees reference answers or held-out cases', async () => {
  const f = setup();
  try {
    const run = await f.run('live');
    assert.ok(run.timings?.retrievalStartedAt && run.timings.retrievalEndedAt);
    assert.ok(run.timings?.generationStartedAt && run.timings.generationEndedAt);
    assert.equal(run.timings.retrievalReused, false);
    assert.ok(Date.parse(run.timings.retrievalEndedAt) <= Date.parse(run.timings.generationStartedAt));
    f.review(run); const candidate = await f.loop.propose({ mode: 'live', runIds: [run.id] });
    const validation = await f.loop.validate(candidate.id);
    assert.throws(() => f.loop.decide(validation.id), /human reference-checked/);
    for (const run of f.loop.overview().runs.filter(run => run.validationId === validation.id)) {
      assert.equal(run.timings?.retrievalReused, true);
      assert.equal(run.timings?.retrievalStartedAt, undefined, 'shared retrieval must not invent a per-arm retrieval duration');
      f.review(run, run.policyId === candidate.id);
    }
    assert.equal(f.loop.decide(validation.id).status, 'accepted');
    const requests = JSON.stringify(f.requests); assert.ok(!requests.includes('SECRET GOLD')); assert.ok(!requests.includes('product-8'));
    assert.throws(() => f.review(f.loop.overview().runs.find(run => run.validationId === validation.id)!), /frozen/);
  } finally { f.loop.close(); }
});

test('AI development drafts persist separately and cannot satisfy human feedback gates', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'feedback-draft-'));
  const path = join(dir, 'loop.sqlite');
  const f = setup({}, path);
  let reopened: ReturnType<typeof setup> | undefined;
  try {
    const run = await f.run('live');
    const draft = { kind: 'ai_assisted', correct: false, supported: true, category: 'incomplete_answer', correction: 'State the material supported by the manufacturer evidence.', sourceIds: [`passage-${run.productId}`], reviewer: 'AI reviewer (test stub)', rationale: 'AI test assessment: the answer is incomplete relative to the supplied source.', confidence: 'medium' };
    assert.throws(() => f.loop.saveReviewDraft(run.id, { ...draft, kind: 'human' }), /ai_assisted/);
    assert.throws(() => f.loop.saveReviewDraft(run.id, { ...draft, sourceIds: ['passage-product-1'] }), /belong to this product/);
    const saved = f.loop.saveReviewDraft(run.id, draft);
    assert.equal(saved.feedback, null);
    assert.equal(saved.reviewDraft?.kind, 'ai_assisted');
    await assert.rejects(f.loop.propose({ mode: 'live', runIds: [run.id] }), /human-reviewed/);
    assert.equal(f.loop.overview().activePolicyIds.live, 'live-baseline');
    assert.equal(f.requests.length, 1, 'draft creation and rejected proposal make no provider calls');
    f.loop.close(); reopened = setup({}, path);
    const restored = reopened.loop.publicRun(run.id);
    assert.equal(restored.reviewDraft?.id, saved.reviewDraft?.id);
    assert.equal(restored.feedback, null);
    assert.match(JSON.stringify(reopened.loop.export()), /ai_assisted/);
    const human = { correct: false, supported: true, referenceChecked: true, category: 'incomplete_answer', correction: draft.correction, sourceIds: draft.sourceIds, reviewer: 'Human test reviewer' };
    assert.throws(() => reopened!.loop.review(run.id, { ...human, draftId: 'another-draft' }), /does not belong/);
    const reviewed = reopened.loop.review(run.id, human);
    assert.equal(reviewed.feedback?.kind, 'human');
    assert.equal(reviewed.feedback?.draftId, restored.reviewDraft?.id, 'draft exposure provenance survives even if client omits draftId');
    assert.throws(() => reopened!.loop.saveReviewDraft(run.id, draft), /reviewed answer/);
    const candidate = await reopened.loop.propose({ mode: 'live', runIds: [run.id] });
    const validation = await reopened.loop.validate(candidate.id);
    assert.throws(() => reopened!.loop.saveReviewDraft(validation.runIds[0], draft), /development answers/);
    assert.throws(() => reopened!.loop.decide(validation.id), /human reference-checked/);
  } finally { f.loop.close(); reopened?.loop.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('correct development cases become paired regression checks and cannot feed proposals', async () => {
  const f = setup();
  try {
    const bad = await f.run('live'); f.review(bad);
    const good = await f.run('live', 1); f.review(good, true);
    const candidate = await f.loop.propose({ mode: 'live', runIds: [bad.id] });
    await assert.rejects(f.loop.validate(candidate.id, { regressionCaseIds: [bad.caseId!] }), /regression controls must be reviewed correct/);
    const validation = await f.loop.validate(candidate.id, { regressionCaseIds: [good.caseId!] });
    assert.deepEqual(validation.caseIds.slice(-1), [good.caseId]);
    assert.equal(validation.runIds.length, 6);
    for (const run of f.loop.overview().runs.filter(run => run.validationId === validation.id)) f.review(run, run.policyId === candidate.id ? run.productId !== good.productId : run.productId === good.productId);
    const rejected = f.loop.decide(validation.id); assert.equal(rejected.status, 'rejected'); assert.equal(rejected.regressions, 1); assert.equal(rejected.candidateCorrect, 2);
    const leaked = f.loop.overview().runs.find(run => run.validationId && run.split === 'development')!;
    await assert.rejects(f.loop.propose({ mode: 'live', runIds: [leaked.id] }), /current-version development/);
    await assert.rejects(f.loop.run({ mode: 'live', productId: 'product-2', question: 'Question?' }), /development/);
  } finally { f.loop.close(); }
});

test('development controls cannot supply the gain required for promotion', async () => {
  const f = setup();
  try {
    const failure = await f.run('live'); f.review(failure);
    const control = await f.run('live', 1); f.review(control, true);
    const candidate = await f.loop.propose({ mode: 'live', runIds: [failure.id] });
    const validation = await f.loop.validate(candidate.id, { regressionCaseIds: [control.caseId!] });
    for (const run of f.loop.overview().runs.filter(run => run.validationId === validation.id)) {
      f.review(run, run.split === 'validation' || run.policyId === candidate.id);
    }
    const decision = f.loop.decide(validation.id);
    assert.equal(decision.parentCorrect, 2);
    assert.equal(decision.candidateCorrect, 3);
    assert.equal(decision.regressions, 0);
    assert.equal(decision.status, 'rejected');
    assert.equal(f.loop.overview().activePolicyIds.live, 'live-baseline');
    assert.match(decision.reason, /Fresh pairs: 2 parent, 2 candidate/);
  } finally { f.loop.close(); }
});

test('paired bootstrap samples cases independently before declaring a gain', () => {
  const differences = Array.from({ length: 20 }, (_, index) => index % 2 === 0 ? 1 : index < 12 ? -1 : 0);
  const interval = pairedBootstrapInterval(differences, 'frozen-test-manifest');
  assert.deepEqual(interval, pairedBootstrapInterval(differences, 'frozen-test-manifest'), 'reporting is reproducible');
  assert.ok(interval[0] <= 0, 'the interval must include a plausible non-gain');
  assert.ok(interval[1] > 0);
});

test('rejects invalid reviews, cross-mode feedback and forged citation provenance', async () => {
  const f = setup({ async answer() { return { answer: { answer: 'Invented answer', status: 'answered', citations: [{ passageId: 'other-source', quote: 'made up' }] }, model: 'test-model', usage: null }; } });
  try {
    const run = await f.run('fixture');
    assert.throws(() => f.loop.review(run.id, { correct: false }), /Feedback:/);
    assert.throws(() => f.loop.review(run.id, { correct: false, supported: false, referenceChecked: true, category: 'unsupported_claim', correction: '', sourceIds: [`passage-${run.productId}`], reviewer: 'Tester' }), /correction/);
    f.review(run);
    await assert.rejects(f.loop.propose({ mode: 'live', runIds: [run.id] }), /same mode/);
    const live = await f.run('live'); assert.equal(live.status, 'failed'); assert.match(live.error!, /exact supplied passage/);
    assert.equal(live.model, 'test-model');
  } finally { f.loop.close(); }
});

test('positive live reviews require a checked product source at the API boundary', async () => {
  const f = setup();
  try {
    const run = await f.run('live');
    assert.throws(() => f.loop.review(run.id, { correct: true, supported: true, referenceChecked: true, category: 'none', correction: '', sourceIds: [], reviewer: 'Test reviewer' }), /sourceIds/);
    assert.equal(f.loop.publicRun(run.id).feedback, null);
  } finally { f.loop.close(); }
});

test('external live reservations remain visible and cannot be reused by app validation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'feedback-external-validation-')); const path = join(dir, 'loop.sqlite');
  const f = setup({}, path); const db = new DatabaseSync(path);
  try {
    const cases = f.corpus.cases.slice(2, 4);
    reserveExternalValidation(db, f.corpus, 'packet:one', 'a'.repeat(64), cases);
    reserveExternalValidation(db, f.corpus, 'packet:one', 'a'.repeat(64), cases);
    assert.throws(() => reserveExternalValidation(db, f.corpus, 'packet:two', 'b'.repeat(64), cases), /UNIQUE|fresh/);
    assert.deepEqual(f.loop.overview().externalValidationCases.map(item => item.caseId).sort(), cases.map(item => item.id).sort());
    const run = await f.run('live'); f.review(run);
    const candidate = await f.loop.propose({ mode: 'live', runIds: [run.id] });
    const validation = await f.loop.validate(candidate.id);
    assert.deepEqual(validation.caseIds.slice(0, 2), f.corpus.cases.slice(4, 6).map(item => item.id));
    assert.equal((f.loop.export() as { externalValidationCases: unknown[] }).externalValidationCases.length, 2);
  } finally { db.close(); f.loop.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('app uses snippet citations when supported and stops a live validation after one failed call', async () => {
  let calls = 0;
  const f = setup({
    async answer() { throw new Error('copied-quote path should not run'); },
    async answerWithSnippetIds(input) {
      calls++;
      assert.ok(input.runId);
      if (calls === 2) throw new Error('safe provider failure');
      return { answer: { answer: 'Oak wood.', status: 'answered', citations: [{ passageId: input.passages[0].id, quote: 'oak wood' }] }, model: 'pinned-test-model', usage: null };
    }
  });
  try {
    const run = await f.run('live'); f.review(run);
    const candidate = await f.loop.propose({ mode: 'live', runIds: [run.id] });
    const validation = await f.loop.validate(candidate.id);
    assert.equal(validation.status, 'interrupted');
    assert.equal(validation.runIds.length, 1);
    assert.equal(calls, 2);
    assert.equal(f.loop.overview().policies.find(item => item.id === candidate.id)?.status, 'rejected');
  } finally { f.loop.close(); }
});

test('busy lock prevents concurrent requests and freezes active policy during a provider call', async () => {
  let unblock: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { unblock = resolve; });
  const f = setup({ async answer(input) { await pending; return { answer: { answer: 'Oak.', status: 'answered', citations: [{ passageId: input.passages[0].id, quote: 'oak wood' }] }, model: 'test-model', usage: null }; } });
  try {
    const request = f.run('live');
    assert.equal(f.loop.overview().busy, true);
    await assert.rejects(f.run(), /another operation/);
    assert.throws(() => f.loop.rollback({ mode: 'live', policyId: 'live-baseline' }), /another operation/);
    unblock!(); await request; assert.equal(f.loop.overview().busy, false);
  } finally { unblock?.(); f.loop.close(); }
});

test('restart marks in-flight records interrupted and retains consumed validation products', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'feedback-recovery-')); const path = join(dir, 'loop.sqlite');
  const f = setup({}, path);
  try {
    const run = await f.run(); f.review(run); const candidate = await f.loop.propose({ mode: 'fixture', runIds: [run.id] }); const validation = await f.loop.validate(candidate.id); f.loop.close();
    const db = new DatabaseSync(path);
    const row = db.prepare("SELECT document FROM loop_documents WHERE kind='run' AND id=?").get(validation.runIds[0]) as { document: string };
    const doc = JSON.parse(row.document); doc.status = 'running';
    db.prepare("UPDATE loop_documents SET document=? WHERE kind='run' AND id=?").run(JSON.stringify(doc), doc.id);
    validation.status = 'running'; db.prepare("UPDATE loop_documents SET document=? WHERE kind='validation' AND id=?").run(JSON.stringify(validation), validation.id);
    db.prepare("UPDATE loop_meta SET value=? WHERE key='job'").run(JSON.stringify({ kind: 'validation' })); db.close();
    const restarted = setup({}, path);
    assert.equal(restarted.loop.overview().runs.find(run => run.id === doc.id)!.status, 'interrupted');
    assert.equal(restarted.loop.overview().validations[0].status, 'interrupted');
    await assert.rejects(restarted.loop.validate(candidate.id), /only candidates/);
    assert.match(JSON.stringify(restarted.loop.export()), /not automatically retried/); restarted.loop.close();
  } finally { f.loop.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('model identity drift rejects paired validation before any promotion', async () => {
  let count = 0;
  const f = setup({ async answer(input) { return { answer: { answer: 'Oak', status: 'answered', citations: [{ passageId: input.passages[0].id, quote: 'oak wood' }] }, model: `model-${count++}`, usage: null }; } });
  try { const run = await f.run('live'); f.review(run); const policy = await f.loop.propose({ mode: 'live', runIds: [run.id] }); const validation = await f.loop.validate(policy.id); assert.equal(validation.status, 'rejected'); assert.match(validation.reason, /identities changed/); assert.equal(f.loop.overview().activePolicyIds.live, 'live-baseline'); } finally { f.loop.close(); }
});

test('unchanged candidate is rejected and subsequent rounds use new validation products', async () => {
  const f = setup();
  try {
    const first = await f.run(); f.review(first);
    const p1 = await f.loop.propose({ mode: 'fixture', runIds: [first.id] }); const v1 = await f.loop.validate(p1.id); assert.equal(f.loop.decide(v1.id).status, 'accepted');
    const second = await f.run(); f.review(second);
    const p2 = await f.loop.propose({ mode: 'fixture', runIds: [second.id] }); const v2 = await f.loop.validate(p2.id); const decision = f.loop.decide(v2.id);
    assert.equal(decision.status, 'rejected'); assert.equal(decision.parentCorrect, decision.candidateCorrect); assert.ok(v1.caseIds.every(id => !v2.caseIds.includes(id)));
    const p3 = await f.loop.propose({ mode: 'fixture', runIds: [second.id] }); const v3 = await f.loop.validate(p3.id);
    f.loop.rollback({ mode: 'fixture', policyId: 'fixture-baseline' });
    assert.match(f.loop.decide(v3.id).reason, /stale candidate rejected/);
    await assert.rejects(f.loop.propose({ mode: 'fixture', runIds: [first.id] }), /three proposal rounds/);
  } finally { f.loop.close(); }
});

test('candidate guard blocks development product facts while never inspecting validation labels', async () => {
  const f = setup({ async propose() { return { instructions: 'For product-0 always answer oak, then quote the supplied evidence to make this case-specific policy appear well supported.', rationale: 'Deliberately invalid test proposal.' }; } });
  try { const run = await f.run('live'); f.review(run); await assert.rejects(f.loop.propose({ mode: 'live', runIds: [run.id] }), /case-specific facts/); } finally { f.loop.close(); }
  const other = setup({ async propose() { return { instructions: 'SECRET GOLD product-2 appears here only to assert that hidden validation labels do not control candidate selection. Use supplied evidence.', rationale: 'Test isolation from withheld validation labels.' }; } });
  try { const run = await other.run('live'); other.review(run); const candidate = await other.loop.propose({ mode: 'live', runIds: [run.id] }); assert.equal(candidate.status, 'candidate'); } finally { other.loop.close(); }
});

test('full product evidence is clone-safe and seals holdout sources', () => {
  const f = setup();
  try { const passages = f.loop.productEvidence('product-0'); assert.equal(passages.length, 1); passages[0].text = 'modified'; assert.notEqual(f.loop.productEvidence('product-0')[0].text, 'modified'); assert.throws(() => f.loop.productEvidence('product-8'), /sealed/); } finally { f.loop.close(); }
});

test('frozen development batch persists its case manifest and never repeats a policy batch', async () => {
  const f = setup();
  try {
    const batch = await f.loop.batch({ mode: 'fixture' });
    assert.equal(batch.status, 'completed');
    assert.deepEqual(batch.caseIds, ['case-product-0', 'case-product-1']);
    assert.equal(batch.runIds.length, 2);
    assert.match(batch.manifestSha256, /^[a-f0-9]{64}$/);
    assert.ok(f.loop.overview().runs.filter(run => run.batchId === batch.id).every(run => run.policyId === batch.policyId));
    await assert.rejects(f.loop.batch({ mode: 'fixture' }), /one frozen batch/);
    assert.equal(f.loop.overview().batches[0].manifestSha256, batch.manifestSha256);
  } finally { f.loop.close(); }
});

test('public validation cards hide both policy arms until all blind reviews lock', async () => {
  const f = setup();
  try {
    const seed = await f.run('live'); f.review(seed);
    const policy = await f.loop.propose({ mode: 'live', runIds: [seed.id] });
    const validation = await f.loop.validate(policy.id);
    const before = f.loop.publicOverview();
    assert.equal(before.runs.filter(run => run.validationId === validation.id).length, 0);
    const cards = before.reviewCards[validation.id];
    assert.equal(cards.length, 4);
    assert.ok(cards.every(card => card.policyId === '' && /^Answer [AB]$/.test(card.blindLabel ?? '') && card.model === null && card.usage === null));
    assert.ok(!JSON.stringify(before.events).includes(cards[0].id));
    assert.deepEqual(cards.filter(card => card.caseId === validation.caseIds[0]).map(card => card.blindLabel).sort(), ['Answer A', 'Answer B']);
    for (const card of cards) {
      const internal = f.loop.overview().runs.find(run => run.id === card.id)!;
      f.review(internal, internal.policyId === policy.id);
      assert.equal(f.loop.publicRun(card.id).policyId, '');
    }
    assert.equal(f.loop.publicOverview().runs.filter(run => run.validationId === validation.id).length, 0);
    f.loop.decide(validation.id);
    assert.equal(f.loop.publicOverview().runs.filter(run => run.validationId === validation.id).length, 4);
  } finally { f.loop.close(); }
});

test('running paired validation never streams arm identities through the public overview', async () => {
  let block = false, reached!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { reached = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = setup({ async answer(input) { if (block) { reached(); await gate; } return { answer: { answer: 'Oak.', status: 'answered', citations: [{ passageId: input.passages[0].id, quote: 'oak wood' }] }, model: 'pinned-test-model', usage: null }; } });
  try {
    const seed = await f.run('live'); f.review(seed);
    const policy = await f.loop.propose({ mode: 'live', runIds: [seed.id] });
    block = true;
    const pending = f.loop.validate(policy.id);
    await entered;
    const publicState = f.loop.publicOverview();
    const running = publicState.validations.find(item => item.status === 'running')!;
    assert.deepEqual(running.runIds, []);
    assert.equal(publicState.runs.filter(item => item.validationId === running.id).length, 0);
    release(); await pending;
  } finally { release(); f.loop.close(); }
});

test('final set stays sealed until promotion, then yields forty blind paired answers and a synthetic-only report', async () => {
  const f = setup();
  const products = Array.from({ length: 20 }, (_, index) => ({ id: `final-${index}`, title: `Held out item ${index}`, split: 'holdout' as const }));
  const heldout: ProductCorpus = { version: 'synthetic-final-v1', source: 'synthetic final set', license: 'synthetic', products,
    passages: products.map(product => ({ id: `source-${product.id}`, productId: product.id, source: 'manufacturer', text: 'The handle is oak wood.', reference: 'synthetic source', sha256: 'test-hash' })),
    cases: products.map(product => ({ id: `case-${product.id}`, productId: product.id, question: 'What is the handle made of?', split: 'holdout', referenceAnswer: '', referencePassageIds: [], labelStatus: 'unreviewed' })) };
  const heldoutRetriever: LoopRetriever = { close() {}, async retrieve(productId) { return { passages: heldout.passages.filter(item => item.productId === productId).map(item => ({ ...item, lexicalRank: 1, semanticRank: 1, score: 1 })), durationMs: 1, method: 'test-hybrid', embeddingModel: 'test-embedding', corpusVersion: heldout.version }; } };
  const loop = new FeedbackLoop(f.corpus, f.retriever, f.provider, ':memory:', heldout, heldoutRetriever);
  try {
    assert.throws(() => loop.finalEvidence(products[0].id), /sealed/);
    await assert.rejects(loop.startFinal({ mode: 'fixture' }), /promoted/);
    const seed = await loop.run({ mode: 'fixture', productId: 'product-0', caseId: 'case-product-0', question: f.corpus.cases[0].question });
    loop.review(seed.id, { correct: false, supported: true, referenceChecked: true, category: 'unnecessary_abstention', correction: 'The synthetic source supports an extract.', sourceIds: ['passage-product-0'], reviewer: 'Synthetic test' });
    const policy = await loop.propose({ mode: 'fixture', runIds: [seed.id] });
    const validation = await loop.validate(policy.id); assert.equal(loop.decide(validation.id).status, 'accepted');
    const final = await loop.startFinal({ mode: 'fixture' });
    assert.equal(final.status, 'awaiting_review'); assert.equal(final.runIds.length, 40);
    assert.equal(loop.publicOverview().runs.filter(run => run.finalId === final.id).length, 0);
    assert.equal(loop.publicOverview().reviewCards[final.id].length, 40);
    assert.equal(loop.finalEvidence(products[0].id).length, 1);
    const uncertain = loop.overview().runs.find(run => run.finalId === final.id && run.answer?.status === 'insufficient_evidence')!;
    assert.ok(uncertain);
    loop.review(uncertain.id, { correct: false, supported: false, referenceChecked: true, category: 'unsupported_claim', correction: 'This uncertain response contains an unsupported claim.', sourceIds: [`source-${uncertain.productId}`], reviewer: 'Synthetic test', details: [{ detail: 'handle material', evidence: 'listing', response: 'overstated' }] });
    assert.equal(loop.publicRun(uncertain.id).feedback?.details?.[0].response, 'overstated');
    const reported = loop.reportFinal(final.id);
    assert.equal(reported.status, 'reported'); assert.equal(reported.result?.baselineCorrect, 0); assert.equal(reported.result?.candidateCorrect, 20);
    assert.equal(reported.result?.baselineUnsupported, 1, 'unsupported claims count even when the model labels its response insufficient');
    assert.equal(reported.result?.verdict, 'inconclusive'); assert.equal(reported.result?.billedCostUsd, null);
    assert.equal(loop.publicOverview().runs.filter(run => run.finalId === final.id).length, 40);
    await assert.rejects(loop.startFinal({ mode: 'fixture' }), /one final evaluation/);
  } finally { loop.close(); f.loop.close(); }
});
