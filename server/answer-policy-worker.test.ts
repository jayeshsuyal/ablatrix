import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AutomaticSupport, type AutomaticSupportJob } from './automatic-support.ts';
import { SyntheticAnswerProvider } from './synthetic-answer-provider.ts';
import { ProductWorkspace } from './product-workspace.ts';
import type { ProductCorpus, LoopRetriever } from './loop-types.ts';
import { AnswerPolicyWorker, SYNTHETIC_RUNTIME_VALIDATION_PACKET, type AnswerPolicyProvider, type AnswerPolicyGroup, type RuntimeValidationCase } from './answer-policy-worker.ts';
import { RuntimeAnswerPolicyStore, runtimeBaselinePolicy, runtimePolicyHash, type RuntimeTrialDecision } from './runtime-answer-policy.ts';
import type { RuntimeAnswerInput } from './answer-policy-protocol.ts';

const retriever = (corpus: ProductCorpus): LoopRetriever => ({ close() {}, async retrieve() { return { passages: corpus.passages.map(passage => ({ ...passage, lexicalRank: 1, semanticRank: 1, score: 1 })), durationMs: 1, method: 'synthetic-test', embeddingModel: 'no-model', corpusVersion: corpus.version }; } });
function harness() {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-answer-policy-')), policyPath = join(directory, 'policy.sqlite'), receiptsPath = join(directory, 'receipts.sqlite');
  const provider = new SyntheticAnswerProvider(receiptsPath), store = new RuntimeAnswerPolicyStore(policyPath), support = new AutomaticSupport(provider, join(directory, 'support.sqlite'));
  const workspace = new ProductWorkspace(join(directory, 'workspace.sqlite'), provider, retriever, store);
  const worker = new AnswerPolicyWorker(provider, store, policyPath);
  return { directory, policyPath, receiptsPath, provider, store, support, workspace, worker,
    async failures() {
      const jobs: AutomaticSupportJob[] = [];
      for (const name of ['Wisp', 'Mica', 'Pearl']) {
        const product = workspace.createProduct({ title: `Fictional ${name} bowl`, sources: [{ label: 'Synthetic fictional listing', text: `SYNTHETIC fixture: The fictional ${name} bowl holds twelve cups.` }] });
        const answer = await workspace.ask({ productId: product.id, question: `How many cups does the fictional ${name} bowl hold?`, mode: 'synthetic' });
        support.enqueue(workspace.reviewSnapshots(answer.id)[0]);
        for (let phase = 0; phase < 3; phase++) await support.tick();
        const job = support.get(`workspace-${answer.id}`)!; assert.equal(job.status, 'repaired'); jobs.push(job);
      }
      return jobs;
    },
    cleanup() { worker.close(); workspace.close(); support.close(); store.close(); provider.close(); rmSync(directory, { recursive: true, force: true }); }
  };
}
async function evaluate(worker: AnswerPolicyWorker) { for (let phase = 0; phase < 13; phase++) await worker.tick(); return worker.overview().groups[0]; }
function writeGroup(path: string, group: AnswerPolicyGroup, lease = 0) {
  const document = JSON.stringify(group), db = new DatabaseSync(path); db.prepare('UPDATE runtime_policy_failure_groups SET status=?,document=?,document_sha256=?,lease_expires=? WHERE id=?').run(group.status, document, runtimePolicyHash(document), lease, group.id); db.close();
}
function changeReceipt(path: string, runId: string, change: (document: any) => void) {
  const db = new DatabaseSync(path), row = db.prepare('SELECT document FROM synthetic_answer_receipts WHERE run_id=?').get(runId) as { document: string }, receipt = JSON.parse(row.document);
  const body = JSON.parse(receipt.receipt_json); change(body); receipt.receipt_json = JSON.stringify(body);
  db.prepare('UPDATE synthetic_answer_receipts SET document=? WHERE run_id=?').run(JSON.stringify(receipt), runId); db.close();
}

test('frozen packet rejects missing mandatory controls and empty reference quotes before opening its database', () => {
  const h = harness();
  try {
    const missingControl = structuredClone(SYNTHETIC_RUNTIME_VALIDATION_PACKET);
    missingControl.cases[2] = { ...structuredClone(missingControl.cases[0]), id: 'other-control', role: 'other_control' as RuntimeValidationCase['role'] };
    assert.throws(() => new AnswerPolicyWorker(h.provider, h.store, ':memory:', { validationPacket: missingControl }), /three distinct/);
    for (const quote of ['', '   ']) {
      const emptyReference = structuredClone(SYNTHETIC_RUNTIME_VALIDATION_PACKET);
      emptyReference.cases[0].requiredFacts[0].quote = quote;
      assert.throws(() => new AnswerPolicyWorker(h.provider, h.store, ':memory:', { validationPacket: emptyReference }), /literal independent source text/);
    }
    assert.equal(h.worker.overview().groups.length, 0);
    assert.equal(h.store.capture('synthetic').status, 'baseline');
  } finally { h.cleanup(); }
});

test('corrupt queued group data cannot be inspected or dispatched', async () => {
  const h = harness();
  try {
    h.worker.observeCompleted(await h.failures());
    const group = h.worker.overview().groups[0], db = new DatabaseSync(h.policyPath);
    try { db.prepare('UPDATE runtime_policy_failure_groups SET document=? WHERE id=?').run(JSON.stringify({ ...group, error: 'SYNTHETIC corrupted stored state' }), group.id); }
    finally { db.close(); }
    assert.throws(() => h.worker.get(group.id), /matching stored hash/);
    await assert.rejects(h.worker.tick(), /matching stored hash/);
    assert.equal(h.provider.receipt(`runtime-policy:${group.id}:0`), undefined);
    assert.equal(h.store.capture('synthetic').status, 'baseline');
  } finally { h.cleanup(); }
});

test('each indexed group identity and routing field must match the hashed document before reuse', async () => {
  const h = harness();
  try {
    h.worker.observeCompleted(await h.failures());
    const group = h.worker.overview().groups[0];
    const originals = { id: group.id, status: group.status, mode: group.mode, parent_id: group.parent.id, category: group.category };
    const corrupted = { id: 'synthetic-corrupt-group-index', status: 'completed', mode: 'live', parent_id: 'synthetic-other-parent', category: group.category === 'source_conflict' ? 'incomplete_answer' : 'source_conflict' };
    for (const column of Object.keys(corrupted) as (keyof typeof corrupted)[]) {
      const db = new DatabaseSync(h.policyPath), rowId = column === 'id' ? corrupted.id : group.id;
      try {
        db.prepare(`UPDATE runtime_policy_failure_groups SET ${column}=? WHERE id=?`).run(corrupted[column], group.id);
        assert.throws(() => h.worker.get(rowId), /indexed metadata/);
        assert.throws(() => h.worker.overview(), /indexed metadata/);
        await assert.rejects(h.worker.tick(), /indexed metadata/);
        assert.equal(h.provider.receipt(`runtime-policy:${group.id}:0`), undefined);
        assert.equal(h.store.capture('synthetic').status, 'baseline');
      } finally { db.prepare(`UPDATE runtime_policy_failure_groups SET ${column}=? WHERE id=?`).run(originals[column], rowId); db.close(); }
    }
    assert.equal(h.worker.get(group.id)?.operations.length, 0);
  } finally { h.cleanup(); }
});

test('policy and decision indexed modes and decision IDs cannot cross verified history boundaries', async () => {
  const h = harness();
  try {
    h.worker.observeCompleted(await h.failures());
    const group = await evaluate(h.worker), db = new DatabaseSync(h.policyPath);
    try {
      db.prepare("UPDATE runtime_answer_policies SET mode='live' WHERE id=?").run(group.candidate!.id);
      assert.throws(() => h.store.get(group.candidate!.id), /invalid immutable identity/);
      assert.throws(() => h.store.overview('live'), /invalid immutable identity/);
      db.prepare("UPDATE runtime_answer_policies SET mode='synthetic' WHERE id=?").run(group.candidate!.id);
      db.prepare("UPDATE runtime_answer_policy_decisions SET mode='live' WHERE id=?").run(group.decisionId!);
      assert.throws(() => h.store.getDecision(group.decisionId!), /indexed identity/);
      assert.throws(() => h.store.overview('live'), /indexed identity/);
      db.prepare("UPDATE runtime_answer_policy_decisions SET mode='synthetic' WHERE id=?").run(group.decisionId!);
      db.prepare("UPDATE runtime_answer_policy_decisions SET id='synthetic-other-decision' WHERE id=?").run(group.decisionId!);
      assert.throws(() => h.store.getDecision('synthetic-other-decision'), /indexed identity/);
      assert.throws(() => h.store.overview('synthetic'), /indexed identity/);
      db.prepare("UPDATE runtime_answer_policy_decisions SET id=? WHERE id='synthetic-other-decision'").run(group.decisionId!);
      assert.equal(h.store.getDecision(group.decisionId!)?.id, group.decisionId);
      assert.equal(h.store.capture('live').status, 'baseline');
      assert.equal(h.store.capture('synthetic').status, 'baseline');
    } finally { db.close(); }
  } finally { h.cleanup(); }
});

test('complete policy hashes protect rollback lineage and event hashes protect both modes of history', async () => {
  const h = harness();
  try {
    h.worker.observeCompleted(await h.failures());
    const group = await evaluate(h.worker), baseline = h.store.capture('synthetic'), active = h.worker.activateTrial(group.id);
    const unrelated = h.store.createCandidate(baseline, 'SYNTHETIC unqualified candidate fixture: use no release or quality authority.', 'synthetic-unqualified-lineage');
    const db = new DatabaseSync(h.policyPath);
    try {
      const policyRow = db.prepare('SELECT document FROM runtime_answer_policies WHERE id=?').get(active.id) as { document: string };
      db.prepare('UPDATE runtime_answer_policies SET document=? WHERE id=?').run(JSON.stringify({ ...active, parentId: unrelated.id }), active.id);
      assert.throws(() => h.store.rollback('synthetic', active.id), /matching stored hash/);
      assert.equal((db.prepare("SELECT policy_id FROM runtime_answer_policy_active WHERE mode='synthetic'").get() as { policy_id: string }).policy_id, active.id);
      db.prepare('UPDATE runtime_answer_policies SET document=? WHERE id=?').run(policyRow.document, active.id);
      const event = h.store.overview('synthetic').events[0], eventRow = db.prepare('SELECT document FROM runtime_answer_policy_events WHERE id=?').get(event.id) as { document: string };
      db.prepare('UPDATE runtime_answer_policy_events SET document=? WHERE id=?').run(JSON.stringify({ ...event, toId: unrelated.id }), event.id);
      assert.throws(() => h.store.overview('synthetic'), /event has no matching stored hash/);
      db.prepare('UPDATE runtime_answer_policy_events SET document=? WHERE id=?').run(eventRow.document, event.id);
      db.prepare("UPDATE runtime_answer_policy_events SET mode='live' WHERE id=?").run(event.id);
      assert.throws(() => h.store.overview('live'), /event indexed identity/);
      db.prepare("UPDATE runtime_answer_policy_events SET mode='synthetic' WHERE id=?").run(event.id);
      db.prepare("UPDATE runtime_answer_policy_events SET id='synthetic-other-event' WHERE id=?").run(event.id);
      assert.throws(() => h.store.overview('synthetic'), /event indexed identity/);
      db.prepare("UPDATE runtime_answer_policy_events SET id=? WHERE id='synthetic-other-event'").run(event.id);
      assert.equal(h.store.rollback('synthetic', active.id).id, baseline.id);
      assert.equal(h.store.overview('synthetic').events.length, 2);
      assert.equal(h.store.overview('live').events.length, 0);
    } finally { db.close(); }
  } finally { h.cleanup(); }
});

test('policy/event schema upgrade verifies only the independently defined baseline and leaves other old records untrusted', () => {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-policy-legacy-')), path = join(directory, 'legacy.sqlite'), legacy = new DatabaseSync(path);
  const baseline = runtimeBaselinePolicy('synthetic'); let store: RuntimeAnswerPolicyStore | undefined;
  try {
    legacy.exec('CREATE TABLE runtime_answer_policies(id TEXT PRIMARY KEY,mode TEXT NOT NULL,document TEXT NOT NULL); CREATE TABLE runtime_answer_policy_events(id TEXT PRIMARY KEY,mode TEXT NOT NULL,document TEXT NOT NULL)');
    legacy.prepare('INSERT INTO runtime_answer_policies VALUES(?,?,?)').run(baseline.id, 'synthetic', JSON.stringify(baseline));
    legacy.prepare('INSERT INTO runtime_answer_policies VALUES(?,?,?)').run('synthetic-unhashed-candidate', 'synthetic', JSON.stringify({ ...baseline, id: 'synthetic-unhashed-candidate', parentId: baseline.id, status: 'candidate' }));
    legacy.prepare('INSERT INTO runtime_answer_policy_events VALUES(?,?,?)').run('synthetic-unhashed-event', 'synthetic', JSON.stringify({ id: 'synthetic-unhashed-event', mode: 'synthetic', action: 'rollback' }));
    store = new RuntimeAnswerPolicyStore(path);
    assert.deepEqual(store.get(baseline.id), baseline);
    assert.throws(() => store!.get('synthetic-unhashed-candidate'), /matching stored hash/);
    assert.equal((legacy.prepare("SELECT document_sha256 FROM runtime_answer_policies WHERE id='synthetic-unhashed-candidate'").get() as { document_sha256: unknown }).document_sha256, null);
    legacy.prepare("DELETE FROM runtime_answer_policies WHERE id='synthetic-unhashed-candidate'").run();
    assert.throws(() => store!.overview('synthetic'), /event has no matching stored hash/);
    assert.equal((legacy.prepare("SELECT document_sha256 FROM runtime_answer_policy_events WHERE id='synthetic-unhashed-event'").get() as { document_sha256: unknown }).document_sha256, null);
  } finally { store?.close(); legacy.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('active pointer corruption cannot bypass closed live capture or unqualified synthetic history', () => {
  const h = harness(), db = new DatabaseSync(h.policyPath);
  try {
    for (const mode of ['live', 'synthetic'] as const) {
      const baseline = h.store.capture(mode), candidate = h.store.createCandidate(baseline, 'SYNTHETIC unqualified pointer fixture: no accepted trial or activation authority.', `synthetic-unqualified-pointer-${mode}`);
      db.prepare('UPDATE runtime_answer_policy_active SET policy_id=? WHERE mode=?').run(candidate.id, mode);
      assert.throws(() => h.store.capture(mode), /pointer has no matching stored hash/);
      db.prepare('UPDATE runtime_answer_policy_active SET binding_sha256=? WHERE mode=?').run(runtimePolicyHash({ mode, policyId: candidate.id }), mode);
      assert.throws(() => h.store.capture(mode), mode === 'live' ? /Live runtime policy capture is closed/ : /verified transition history/);
      db.prepare('UPDATE runtime_answer_policy_active SET policy_id=?,binding_sha256=? WHERE mode=?').run(baseline.id, runtimePolicyHash({ mode, policyId: baseline.id }), mode);
      assert.equal(h.store.capture(mode).id, baseline.id);
    }
  } finally { db.close(); h.cleanup(); }
});

test('schema upgrade leaves old unhashed group records unverified instead of blessing or redispatching them', async () => {
  const h = harness(); let upgraded: AnswerPolicyWorker | undefined;
  try {
    h.worker.observeCompleted(await h.failures());
    const group = h.worker.overview().groups[0], path = join(h.directory, 'legacy-policy.sqlite'), legacy = new DatabaseSync(path);
    try {
      legacy.exec('CREATE TABLE runtime_policy_failure_groups(id TEXT PRIMARY KEY,status TEXT NOT NULL,mode TEXT NOT NULL,parent_id TEXT NOT NULL,category TEXT NOT NULL,document TEXT NOT NULL,lease_expires INTEGER)');
      legacy.prepare('INSERT INTO runtime_policy_failure_groups(id,status,mode,parent_id,category,document) VALUES(?,?,?,?,?,?)').run(group.id, group.status, group.mode, group.parent.id, group.category, JSON.stringify(group));
    } finally { legacy.close(); }
    upgraded = new AnswerPolicyWorker(h.provider, h.store, path);
    assert.throws(() => upgraded!.overview(), /matching stored hash/);
    await assert.rejects(upgraded.tick(), /matching stored hash/);
    assert.equal(h.provider.receipt(`runtime-policy:${group.id}:0`), undefined);
    const saved = new DatabaseSync(path, { readOnly: true });
    try {
      assert.deepEqual({ ...saved.prepare('SELECT document,document_sha256 FROM runtime_policy_failure_groups WHERE id=?').get(group.id) }, { document: JSON.stringify(group), document_sha256: null });
    } finally { saved.close(); }
  } finally { upgraded?.close(); h.cleanup(); }
});

test('scripted durable failures produce one finite trial, later asks capture candidate, and rollback restores baseline', async () => {
  const h = harness();
  try {
    const baseline = h.store.capture('synthetic'), failures = await h.failures(), originals = JSON.stringify(failures);
    assert.deepEqual(h.worker.observeCompleted(failures), { observed: 3, eligible: 1 });
    assert.deepEqual(h.worker.observeCompleted(failures), { observed: 0, eligible: 0 });
    assert.equal(h.worker.overview().groups.length, 1);
    const group = await evaluate(h.worker), decision = h.store.getDecision(group.decisionId!)!;
    assert.equal(group.status, 'completed'); assert.equal(group.operations.length, 13); assert.equal(decision.verdict, 'eligible_synthetic_trial');
    assert.equal(decision.baseline.usefulSupportedAnswers, 1); assert.equal(decision.candidateMetrics.usefulSupportedAnswers, 2);
    assert.equal(decision.candidateMetrics.unsupportedClaims, 0); assert.equal(decision.candidateMetrics.regressions, 0);
    assert.equal(decision.calibration, 'not_measured'); assert.equal(decision.qualityClaimEligible, false); assert.equal(decision.candidateMetrics.planningAllowanceUsd, null);
    assert.equal(decision.packetSha256, runtimePolicyHash(decision.validationPacket));
    assert.equal(h.store.capture('synthetic').id, baseline.id, 'Shadow evaluation alone does not move the pointer.');
    const candidate = h.worker.activateTrial(decision.id), product = h.workspace.overview().products[0];
    const next = await h.workspace.ask({ productId: product.id, question: 'What does the fictional listing state?', mode: 'synthetic' });
    assert.equal(next.runtimePolicy?.id, candidate.id); assert.equal(next.runtimePolicy?.instructionSha256, candidate.instructionSha256);
    assert.equal(next.runtimePolicyInstructions, candidate.instructions); assert.match(next.runtimePolicyInstructions!, /Runtime answer-policy addition:/);
    const generated = h.provider.receipt(next.id)!; assert.equal(generated.kind, 'synthetic_answer');
    h.store.rollback('synthetic', candidate.id);
    const restored = await h.workspace.ask({ productId: product.id, question: 'What does the fictional listing state?', mode: 'synthetic' });
    assert.equal(restored.runtimePolicy?.id, baseline.id); assert.equal(restored.runtimePolicyInstructions, baseline.instructions);
    assert.equal(JSON.stringify(failures), originals, 'Original completed jobs remain immutable.');
    for (let phase = 0; phase < 3; phase++) await h.worker.tick();
    assert.equal(h.worker.overview().groups[0].operations.length, 13, 'Consumed groups never re-propose.');
    const db = new DatabaseSync(h.policyPath); assert.equal((db.prepare("SELECT name FROM sqlite_master WHERE name IN ('loop_human_events','answer_review_events','loop_provider_calls')").all()).length, 0); db.close();
  } finally { h.cleanup(); }
});

test('activation during actual asynchronous retrieval preserves captured policy for that request', async () => {
  const h = harness(); let waitingWorkspace: ProductWorkspace | undefined;
  try {
    h.worker.observeCompleted(await h.failures()); const group = await evaluate(h.worker), baseline = h.store.capture('synthetic');
    let resolve!: () => void; const wait = new Promise<void>(value => { resolve = value; });
    waitingWorkspace = new ProductWorkspace(':memory:', h.provider, corpus => ({ close() {}, async retrieve(...args) { await wait; return retriever(corpus).retrieve(...args); } }), h.store);
    const product = waitingWorkspace.createProduct({ title: 'Fictional Quartz cup', sources: [{ label: 'Synthetic listing', text: 'SYNTHETIC fixture: The fictional Quartz cup is made of steel.' }] });
    const pending = waitingWorkspace.ask({ productId: product.id, question: 'What material is the cup made of?', mode: 'synthetic' });
    const candidate = h.worker.activateTrial(group.id); resolve(); const captured = await pending;
    assert.equal(captured.runtimePolicy?.id, baseline.id); assert.equal(captured.runtimePolicyInstructions, baseline.instructions);
    const later = await waitingWorkspace.ask({ productId: product.id, question: 'What material is the cup made of?', mode: 'synthetic' }); assert.equal(later.runtimePolicy?.id, candidate.id);
    h.store.rollback('synthetic', candidate.id);
  } finally { waitingWorkspace?.close(); h.cleanup(); }
});

test('malformed, unknown, historically unbound and duplicate evidence cannot form a consumed failure group', async () => {
  const h = harness();
  try {
    const failures = await h.failures(), original = structuredClone(failures[0]);
    const variants = [structuredClone(original), structuredClone(original), structuredClone(original), structuredClone(original), structuredClone(original)];
    delete variants[0].original.runtimePolicy; variants[1].operations[0].status = 'unknown'; variants[2].originalAnswerSha256 = '0'.repeat(64); variants[3].assessments[0].assessment.units[0].verdict = 'uncertain'; variants[4].operations.push(structuredClone(variants[4].operations[0]));
    assert.deepEqual(h.worker.observeCompleted(variants), { observed: 0, eligible: 0 }); assert.equal(h.worker.overview().groups.length, 0);
    assert.deepEqual(h.worker.observeCompleted([original, original, original]), { observed: 1, eligible: 0 });
    assert.equal(h.worker.overview().groups[0].status, 'collecting'); await h.worker.tick(); assert.equal(h.worker.overview().groups[0].operations.length, 0);
    const tampered = structuredClone(failures[1]); tampered.original.runtimePolicy = { ...h.store.capture('live') }; tampered.originalSnapshotSha256 = runtimePolicyHash(tampered.original);
    assert.deepEqual(h.worker.observeCompleted([tampered]), { observed: 0, eligible: 0 });
  } finally { h.cleanup(); }
});

test('always abstaining candidate fails independent answerability controls even when checker supports non-factual units', async () => {
  const h = harness();
  try {
    h.worker.observeCompleted(await h.failures()); h.worker.close();
    const wrapped: AnswerPolicyProvider = { executionMode: 'synthetic', readiness: h.provider.readiness.bind(h.provider), capacity: h.provider.capacity.bind(h.provider), receipt: h.provider.receipt.bind(h.provider), suggestRuntimePolicy: h.provider.suggestRuntimePolicy.bind(h.provider), gradeClaimSupport: h.provider.gradeClaimSupport.bind(h.provider),
      async answerRuntimePolicy(input: RuntimeAnswerInput) { const output = await h.provider.answerRuntimePolicy(input); if (input.policy.instructions.includes('Runtime answer-policy addition:')) changeReceipt(h.receiptsPath, input.runId, document => { document.output = { status: 'insufficient_evidence', answer: 'SYNTHETIC runtime fixture abstention: The requested fact is absent from this fictional source packet.', citations: [] }; }); return output; } };
    h.worker = new AnswerPolicyWorker(wrapped, h.store, h.policyPath); const group = await evaluate(h.worker), decision = h.store.getDecision(group.decisionId!)!;
    assert.equal(decision.verdict, 'rejected'); assert.equal(decision.candidateMetrics.usefulSupportedAnswers, 0); assert.equal(decision.candidateMetrics.unnecessaryAbstentions, 2); assert.equal(decision.candidateMetrics.regressions, 1);
    assert.throws(() => h.worker.activateTrial(group.id), /eligible/); assert.equal(h.store.capture('synthetic').status, 'baseline');
  } finally { h.cleanup(); }
});

test('cross-mode, missing calibration, stale parent and changed durable receipts close activation', async () => {
  const h = harness();
  try {
    h.worker.observeCompleted(await h.failures()); const group = await evaluate(h.worker), decision = h.store.getDecision(group.decisionId!)!;
    assert.throws(() => h.store.activateTrial('live', h.store.capture('live').id, decision.id), /matching.*modes/);
    const live = h.store.capture('live'), liveCandidate = h.store.createCandidate(live, 'SYNTHETIC gate fixture only: preserve useful supported facts and exact source applicability.', 'synthetic-live-gate-contract');
    // A deliberately incomplete fictional live-mode contract record exercises
    // the hard calibration closure; it makes no live evaluation judgment.
    const liveDecision: RuntimeTrialDecision = { ...decision, id: 'synthetic-live-gate-contract', mode: 'live', complete: false, parent: { id: live.id, mode: 'live', instructionSha256: live.instructionSha256 }, candidate: { id: liveCandidate.id, mode: 'live', instructionSha256: liveCandidate.instructionSha256 }, kind: 'automated_shadow_trial', gate: 'unqualified_ai', verdict: 'inconclusive' };
    h.store.recordDecision(liveDecision); assert.throws(() => h.store.activateTrial('live', live.id, liveDecision.id), /calibration.*missing/);
    const candidate = h.worker.activateTrial(group.id); assert.throws(() => h.worker.activateTrial(group.id), /stale parent/); assert.throws(() => h.store.rollback('synthetic', liveCandidate.id), /current candidate/);
    h.store.rollback('synthetic', candidate.id);
    changeReceipt(h.receiptsPath, group.operations[5].runId, document => { document.requestSha256 = '0'.repeat(64); });
    assert.throws(() => h.worker.activateTrial(group.id), /reconciliation/); assert.equal(h.store.capture('synthetic').status, 'baseline');
  } finally { h.cleanup(); }
});

test('capacity ceiling, shared-provider exclusion and paused drain forbid hidden dispatch', async () => {
  const h = harness();
  try {
    h.worker.observeCompleted(await h.failures()); h.worker.close(); let calls = 0, free = false; const allowances: number[] = [];
    const wrapped: AnswerPolicyProvider = { executionMode: 'synthetic', readiness: h.provider.readiness.bind(h.provider), capacity: count => { allowances.push(count); return { ready: false, reason: 'SYNTHETIC exhausted allowance fixture.' }; }, receipt: h.provider.receipt.bind(h.provider), gradeClaimSupport: h.provider.gradeClaimSupport.bind(h.provider), answerRuntimePolicy: h.provider.answerRuntimePolicy.bind(h.provider), async suggestRuntimePolicy(input) { calls++; return h.provider.suggestRuntimePolicy(input); } };
    h.worker = new AnswerPolicyWorker(wrapped, h.store, h.policyPath, { canDispatch: () => free });
    await h.worker.tick(); assert.equal(calls, 0); assert.deepEqual(allowances, []);
    free = true; await h.worker.tick(); assert.equal(calls, 0); assert.deepEqual(allowances, [13]);
    assert.equal(h.worker.overview().groups[0].status, 'failed'); assert.equal(h.store.capture('synthetic').status, 'baseline');
    await h.worker.pauseAndDrain(); h.worker.observeCompleted(await h.failures()); await h.worker.tick(); assert.equal(calls, 0);
  } finally { h.cleanup(); }
});

test('completed receipt recovery advances exactly one phase without redispatch and missing receipt remains consumed', async () => {
  for (const missing of [false, true]) {
    const h = harness();
    try {
      h.worker.observeCompleted(await h.failures()); await h.worker.tick(); await h.worker.tick();
      const group = h.worker.overview().groups[0], recoveredAnswer = structuredClone(group.results[0]);
      group.phase = 1; group.status = 'running'; group.results = []; group.operations[1].status = 'started';
      h.worker.close(); writeGroup(h.policyPath, group);
      if (missing) { const db = new DatabaseSync(h.receiptsPath); db.prepare('DELETE FROM synthetic_answer_receipts WHERE run_id=?').run(group.operations[1].runId); db.close(); }
      h.worker = new AnswerPolicyWorker(h.provider, h.store, h.policyPath);
      const recovered = h.worker.get(group.id)!;
      if (missing) { assert.equal(recovered.status, 'reconciliation'); for (let i = 0; i < 4; i++) await h.worker.tick(); assert.equal(h.worker.get(group.id)?.operations.length, 2); assert.throws(() => h.worker.activateTrial(group.id), /complete/); }
      else { assert.equal(recovered.phase, 2); assert.deepEqual(recovered.results[0], recoveredAnswer); for (let i = 0; i < 11; i++) await h.worker.tick(); assert.equal(h.worker.get(group.id)?.status, 'completed'); }
    } finally { h.cleanup(); }
  }
});

test('trial snapshot and decision survive restart and read-only overview never proposes', async () => {
  const h = harness();
  try {
    h.worker.observeCompleted(await h.failures()); const group = await evaluate(h.worker), before = h.store.getDecision(group.decisionId!);
    h.worker.close(); h.worker = new AnswerPolicyWorker(h.provider, h.store, h.policyPath);
    assert.deepEqual(h.store.getDecision(group.decisionId!), before);
    for (let i = 0; i < 5; i++) { h.worker.overview(); h.store.overview('synthetic'); h.worker.readiness(); }
    assert.equal(h.worker.get(group.id)?.operations.length, 13); assert.equal(h.store.overview('synthetic').events.length, 0);
    const candidate = h.worker.activateTrial(group.decisionId!); h.store.rollback('synthetic', candidate.id);
    assert.equal(h.store.overview('synthetic').events.length, 2);
  } finally { h.cleanup(); }
});

test('incomplete or contradicted unanswerable control cannot be offset by a targeted improvement', async () => {
  for (const field of ['questionCoverage', 'correctness'] as const) {
    const h = harness();
    try {
      h.worker.observeCompleted(await h.failures()); h.worker.close();
      const wrapped: AnswerPolicyProvider = { executionMode: 'synthetic', readiness: h.provider.readiness.bind(h.provider), capacity: h.provider.capacity.bind(h.provider), receipt: h.provider.receipt.bind(h.provider), suggestRuntimePolicy: h.provider.suggestRuntimePolicy.bind(h.provider), answerRuntimePolicy: h.provider.answerRuntimePolicy.bind(h.provider),
        async gradeClaimSupport(input) { const result = await h.provider.gradeClaimSupport(input); if (input.runId.endsWith(':12')) changeReceipt(h.receiptsPath, input.runId, document => { document.output[field] = field === 'questionCoverage' ? 'incomplete' : 'contradicted_by_sources'; }); return result; } };
      h.worker = new AnswerPolicyWorker(wrapped, h.store, h.policyPath); const group = await evaluate(h.worker), decision = h.store.getDecision(group.decisionId!)!;
      assert.equal(group.status, 'completed'); assert.equal(decision.candidateMetrics.usefulSupportedAnswers, 2, 'Targeted answer still improves in this scripted fixture.');
      assert.equal(decision.candidateMetrics.regressions, 1); assert.equal(decision.verdict, 'rejected'); assert.throws(() => h.worker.activateTrial(group.id), /eligible/);
    } finally { h.cleanup(); }
  }
});

test('unknown proposal and malformed paired answers/checks consume the attempt across restart', async () => {
  for (const behavior of ['unknown_proposal', 'invalid_answer', 'invalid_grade'] as const) {
    const h = harness();
    try {
      h.worker.observeCompleted(await h.failures()); h.worker.close();
      const wrapped: AnswerPolicyProvider = { executionMode: 'synthetic', readiness: h.provider.readiness.bind(h.provider), capacity: h.provider.capacity.bind(h.provider),
        receipt(runId) { const receipt = h.provider.receipt(runId); return receipt && behavior === 'unknown_proposal' && runId.startsWith('runtime-policy:') && runId.endsWith(':0') ? { ...receipt, status: 'interrupted' } : receipt; },
        suggestRuntimePolicy: h.provider.suggestRuntimePolicy.bind(h.provider),
        async answerRuntimePolicy(input) { const result = await h.provider.answerRuntimePolicy(input); if (behavior === 'invalid_answer' && input.runId.endsWith(':1')) changeReceipt(h.receiptsPath, input.runId, document => { document.requestSha256 = '0'.repeat(64); }); return result; },
        async gradeClaimSupport(input) { const result = await h.provider.gradeClaimSupport(input); if (behavior === 'invalid_grade' && input.runId.endsWith(':2')) changeReceipt(h.receiptsPath, input.runId, document => { document.output.units = []; }); return result; } };
      h.worker = new AnswerPolicyWorker(wrapped, h.store, h.policyPath, { completedJobs: () => h.support.overview() }); const group = await evaluate(h.worker), operationCount = group.operations.length;
      assert.equal(group.status, behavior === 'unknown_proposal' ? 'reconciliation' : 'failed'); assert.equal(operationCount, behavior === 'unknown_proposal' ? 1 : behavior === 'invalid_answer' ? 2 : 3);
      const exported = h.worker.exportEvidence();
      assert.equal(exported.originalChecks.length, 3);
      assert.equal(exported.phaseReceipts.at(-1)?.verification, 'unaccepted_diagnostic');
      assert.ok(exported.phaseReceipts.slice(0, -1).every(item => item.verification === 'replayed_completed_phase'));
      h.worker.close(); h.worker = new AnswerPolicyWorker(h.provider, h.store, h.policyPath); for (let i = 0; i < 5; i++) await h.worker.tick();
      assert.equal(h.worker.get(group.id)?.operations.length, operationCount); assert.throws(() => h.worker.activateTrial(group.id), /complete/); assert.equal(h.store.capture('synthetic').status, 'baseline');
    } finally { h.cleanup(); }
  }
});

test('parent activation closes remaining phases of an already proposed stale trial', async () => {
  const h = harness();
  try {
    h.worker.observeCompleted(await h.failures()); const first = await evaluate(h.worker);
    h.worker.observeCompleted(await h.failures()); await h.worker.tick(); const second = h.worker.overview().groups[0]; assert.equal(second.phase, 1);
    const candidate = h.worker.activateTrial(first.id); await h.worker.tick();
    const stopped = h.worker.get(second.id)!; assert.equal(stopped.status, 'failed'); assert.equal(stopped.operations.length, 1); assert.match(stopped.error!, /stale/);
    assert.equal(h.store.getDecision(stopped.decisionId!)?.verdict, 'inconclusive'); assert.throws(() => h.worker.activateTrial(second.id), /complete/);
    h.store.rollback('synthetic', candidate.id);
  } finally { h.cleanup(); }
});

test('a late receipt cannot revive an expired unknown lease, and shutdown drains its sole phase', async () => {
  const h = harness(); let recovery: AnswerPolicyWorker | undefined;
  try {
    h.worker.observeCompleted(await h.failures()); h.worker.close(); let release!: () => void, calls = 0; const waiting = new Promise<void>(resolve => { release = resolve; });
    const wrapped: AnswerPolicyProvider = { executionMode: 'synthetic', readiness: h.provider.readiness.bind(h.provider), capacity: h.provider.capacity.bind(h.provider), receipt: h.provider.receipt.bind(h.provider), answerRuntimePolicy: h.provider.answerRuntimePolicy.bind(h.provider), gradeClaimSupport: h.provider.gradeClaimSupport.bind(h.provider),
      async suggestRuntimePolicy(input) { calls++; await waiting; return h.provider.suggestRuntimePolicy(input); } };
    h.worker = new AnswerPolicyWorker(wrapped, h.store, h.policyPath); const pending = h.worker.tick(); assert.equal(h.worker.hasActive(), true);
    const started = h.worker.overview().groups[0]; assert.equal(started.status, 'running'); writeGroup(h.policyPath, started);
    recovery = new AnswerPolicyWorker(h.provider, h.store, h.policyPath); assert.equal(recovery.get(started.id)?.status, 'reconciliation');
    const drain = h.worker.pauseAndDrain(); assert.deepEqual(h.worker.observeCompleted(await h.failures()), { observed: 0, eligible: 0 });
    release(); await pending; await drain; assert.equal(calls, 1); assert.equal(h.worker.hasActive(), false);
    assert.equal(h.worker.get(started.id)?.status, 'reconciliation'); assert.equal(h.worker.get(started.id)?.candidate, undefined);
    assert.throws(() => h.worker.activateTrial(started.id), /complete/); assert.equal(h.store.capture('synthetic').status, 'baseline');
  } finally { recovery?.close(); h.cleanup(); }
});
