import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from './app.ts';
import { RunStore } from './store.ts';
import { PilotRunner, PilotStore } from './pilot.ts';
import { ProductWorkspace } from './product-workspace.ts';
import { SyntheticAnswerProvider } from './synthetic-answer-provider.ts';
import { AutomaticSupport } from './automatic-support.ts';
import { RuntimeAnswerPolicyStore } from './runtime-answer-policy.ts';
import { AnswerPolicyWorker } from './answer-policy-worker.ts';
import { syntheticRetriever } from './hosted-demo.ts';

test('HTTP exact policy evidence and synthetic release/rollback affect future answers without human decisions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ablatrix-policy-api-'));
  const provider = new SyntheticAnswerProvider(join(dir, 'receipts.sqlite'));
  const policies = new RuntimeAnswerPolicyStore(join(dir, 'policies.sqlite'));
  const workspace = new ProductWorkspace(join(dir, 'workspace.sqlite'), provider, syntheticRetriever, policies);
  const checks = new AutomaticSupport(provider, join(dir, 'reviews.sqlite'));
  const worker = new AnswerPolicyWorker(provider, policies, join(dir, 'policies.sqlite'), { completedJobs: () => checks.overview() });
  const store = new RunStore(join(dir, 'runs.sqlite'));
  const baseline = policies.capture('synthetic');
  const originals: string[] = [];
  const products = Array.from({ length: 3 }, (_, i) => workspace.createProduct({ title: `SYNTHETIC fictional bottle ${i}`, sources: [{ label: 'SYNTHETIC fixture manual', text: 'SYNTHETIC fixture: This fictional bottle holds 600 ml and has a twist cap.' }] }));
  for (const product of products) {
    const run = await workspace.ask({ productId: product.id, question: 'How much does this bottle hold?', mode: 'synthetic' });
    checks.enqueue(workspace.reviewSnapshots(run.id)[0]);
    for (let phase = 0; phase < 3; phase++) await checks.tick();
    originals.push(JSON.stringify(workspace.reviewSnapshots(run.id)[0]));
  }
  for (let phase = 0; phase < 13; phase++) await worker.tick();
  const group = worker.overview().groups[0];
  assert.equal(group.status, 'completed'); assert.ok(group.decisionId);
  const decision = policies.getDecision(group.decisionId); assert.ok(decision);
  assert.equal(decision.verdict, 'eligible_synthetic_trial');
  const server = createApp(store, 'fixture', undefined, new PilotRunner(new PilotStore(':memory:')), undefined, undefined, workspace, undefined, false, { answerProvider: provider, reviewDbPath: join(dir, 'reviews.sqlite'), runtimePolicyStore: policies, answerPolicyWorker: worker });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  const post = async (path: string, input: unknown, expected = 200) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(input) });
    const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value;
  };
  const readsFail = async (paths: string[], error: string) => {
    for (const path of paths) {
      const response = await fetch(base + path);
      assert.equal(response.status, 409);
      assert.equal(response.headers.get('content-disposition'), null, 'Corrupt evidence is never offered as a download.');
      assert.deepEqual(await response.json(), { error });
    }
  };
  try {
    const before = JSON.stringify(worker.overview());
    const exported = await (await fetch(base + '/api/workspace/answer-policy/export')).json();
    assert.equal(exported.policies.active.id, baseline.id);
    assert.deepEqual(exported.policies.decisions[0], decision);
    assert.deepEqual(exported.improvement.groups[0].packet, group.packet);
    assert.equal(exported.improvement.phaseReceipts.length, 13);
    assert.ok(exported.improvement.phaseReceipts.every((item: { verification: string }) => item.verification === 'replayed_completed_phase'));
    assert.equal(exported.improvement.originalChecks.length, 3);
    assert.deepEqual(exported.improvement.phaseReceipts[0].receipt, provider.receipt(group.operations[0].runId));
    assert.equal(exported.policies.decisions[0].qualityClaimEligible, false);
    await fetch(base + '/api/workspace/answer-policy');
    assert.equal(JSON.stringify(worker.overview()), before, 'inspection never aggregates or dispatches');
    await post('/api/workspace/answer-policy/rollback', { expectedActiveId: baseline.id, humanApproved: true }, 400);
    const activated = await post(`/api/workspace/answer-policy/trials/${group.decisionId}/activate`, {});
    assert.equal(activated.id, group.candidate!.id, 'prefixed persisted decision ID is routable');
    await post(`/api/workspace/answer-policy/trials/${group.decisionId}/activate`, {}, 409);
    const input = { productId: products[0].id, question: 'How much does this bottle hold?', mode: 'synthetic' };
    const after = await post('/api/workspace/questions', input, 201);
    assert.equal(after.runtimePolicy.id, activated.id); assert.equal(after.runtimePolicyInstructions, activated.instructions);
    await post('/api/workspace/answer-policy/rollback', { expectedActiveId: baseline.id }, 409);
    const rolledBack = await post('/api/workspace/answer-policy/rollback', { expectedActiveId: activated.id }); assert.equal(rolledBack.id, baseline.id);
    const later = await post('/api/workspace/questions', input, 201); assert.equal(later.runtimePolicy.id, baseline.id);
    for (const original of originals) assert.equal(JSON.stringify(workspace.reviewSnapshots(JSON.parse(original).runId)[0]), original);
    const reviews = await (await fetch(base + '/api/workspace/reviews/export')).json();
    assert.equal(reviews.cases.flatMap((item: {events: unknown[]}) => item.events).length, 0);
    assert.equal(policies.overview('synthetic').events.length, 2);
    const changedReceipt = new DatabaseSync(join(dir, 'receipts.sqlite'));
    const receiptRow = changedReceipt.prepare('SELECT document FROM synthetic_answer_receipts WHERE run_id=?').get(group.operations[1].runId) as { document: string };
    try {
      const receipt = JSON.parse(receiptRow.document), wire = JSON.parse(receipt.receipt_json);
      wire.output.answer = 'SYNTHETIC changed completed answer text'; receipt.receipt_json = JSON.stringify(wire);
      changedReceipt.prepare('UPDATE synthetic_answer_receipts SET document=? WHERE run_id=?').run(JSON.stringify(receipt), group.operations[1].runId);
      await readsFail(['/api/workspace/answer-policy/export'], 'Runtime policy export: A completed phase no longer matches its frozen request and saved result.');
    } finally { changedReceipt.prepare('UPDATE synthetic_answer_receipts SET document=? WHERE run_id=?').run(receiptRow.document, group.operations[1].runId); changedReceipt.close(); }
    const changedCheck = new DatabaseSync(join(dir, 'reviews.sqlite'));
    const checkRow = changedCheck.prepare('SELECT document FROM automatic_support_jobs WHERE id=?').get(group.bindings[0].jobId) as { document: string };
    try {
      const job = JSON.parse(checkRow.document); job.original.answer.answer = 'SYNTHETIC changed originating answer text';
      changedCheck.prepare('UPDATE automatic_support_jobs SET document=? WHERE id=?').run(JSON.stringify(job), group.bindings[0].jobId);
      await readsFail(['/api/workspace/answer-policy/export'], 'Runtime policy export: An originating automatic check no longer matches its consumed failure binding.');
    } finally { changedCheck.prepare('UPDATE automatic_support_jobs SET document=? WHERE id=?').run(checkRow.document, group.bindings[0].jobId); changedCheck.close(); }
    const corrupt = new DatabaseSync(join(dir, 'policies.sqlite'));
    try {
      corrupt.prepare('UPDATE runtime_answer_policy_decisions SET document=? WHERE id=?').run(JSON.stringify({ ...decision, candidateMetrics: { ...decision.candidateMetrics, usefulSupportedAnswers: 999 } }), decision.id);
    } finally { corrupt.close(); }
    assert.throws(() => policies.getDecision(decision.id), /immutable hash/);
    assert.throws(() => policies.overview('synthetic'), /immutable hash/);
    const inspectionFails = (error: string) => readsFail(['/api/workspace/answer-policy', '/api/workspace/answer-policy/export'], error);
    await inspectionFails('Trial evidence no longer matches its immutable hash.');
    const candidateVersion = policies.get(group.candidate!.id)!;
    const corruptVersion = new DatabaseSync(join(dir, 'policies.sqlite'));
    try {
      corruptVersion.prepare('UPDATE runtime_answer_policy_decisions SET document=? WHERE id=?').run(JSON.stringify(decision), decision.id);
      corruptVersion.prepare('UPDATE runtime_answer_policies SET document=? WHERE id=?').run(JSON.stringify({ ...candidateVersion, instructions: 'SYNTHETIC corrupted inactive instructions' }), candidateVersion.id);
    } finally { corruptVersion.close(); }
    assert.throws(() => policies.get(candidateVersion.id), /invalid immutable identity/);
    await inspectionFails('Runtime policy has an invalid immutable identity.');
    const corruptGroup = new DatabaseSync(join(dir, 'policies.sqlite'));
    try {
      corruptGroup.prepare('UPDATE runtime_answer_policies SET document=? WHERE id=?').run(JSON.stringify(candidateVersion), candidateVersion.id);
      corruptGroup.prepare('UPDATE runtime_policy_failure_groups SET document=? WHERE id=?').run(JSON.stringify({ ...group, decision: { ...decision, candidateMetrics: { ...decision.candidateMetrics, usefulSupportedAnswers: 999 } } }), group.id);
    } finally { corruptGroup.close(); }
    assert.deepEqual(policies.getDecision(decision.id), decision, 'Authentic policy decision remains independent of corrupt group data.');
    assert.throws(() => worker.get(group.id), /matching stored hash/);
    assert.throws(() => worker.overview(), /matching stored hash/);
    assert.throws(() => worker.exportEvidence(), /matching stored hash/);
    assert.throws(() => worker.activateTrial(group.decisionId!), /matching stored hash/);
    await inspectionFails('Runtime policy group evidence has no matching stored hash; reconciliation is required.');
    const corruptIndex = new DatabaseSync(join(dir, 'policies.sqlite'));
    try { corruptIndex.prepare('UPDATE runtime_policy_failure_groups SET document=?,category=? WHERE id=?').run(JSON.stringify(group), group.category === 'source_conflict' ? 'incomplete_answer' : 'source_conflict', group.id); }
    finally { corruptIndex.close(); }
    await inspectionFails('Runtime policy group indexed metadata no longer matches its verified document; reconciliation is required.');
    assert.equal(policies.capture('synthetic').id, baseline.id);
    const unchanged = new DatabaseSync(join(dir, 'policies.sqlite'), { readOnly: true });
    try { assert.equal((JSON.parse((unchanged.prepare('SELECT document FROM runtime_policy_failure_groups WHERE id=?').get(group.id) as { document: string }).document)).operations.length, 13, 'Failed inspection dispatches no new phase.'); }
    finally { unchanged.close(); }
  } finally { await checks.pauseAndDrain(); checks.close(); await server.shutdown(); store.close(); rmSync(dir, { recursive: true, force: true }); }
});
