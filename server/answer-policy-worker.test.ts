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
import { RuntimeAnswerPolicyStore, runtimePolicyHash, type RuntimeTrialDecision } from './runtime-answer-policy.ts';
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
  const db = new DatabaseSync(path); db.prepare('UPDATE runtime_policy_failure_groups SET status=?,document=?,lease_expires=? WHERE id=?').run(group.status, JSON.stringify(group), lease, group.id); db.close();
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
      h.worker = new AnswerPolicyWorker(wrapped, h.store, h.policyPath); const group = await evaluate(h.worker), operationCount = group.operations.length;
      assert.equal(group.status, behavior === 'unknown_proposal' ? 'reconciliation' : 'failed'); assert.equal(operationCount, behavior === 'unknown_proposal' ? 1 : behavior === 'invalid_answer' ? 2 : 3);
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
