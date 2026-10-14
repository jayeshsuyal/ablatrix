import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { ProductWorkspace, type WorkspaceRun } from '../server/product-workspace.ts';
import { SyntheticAnswerProvider } from '../server/synthetic-answer-provider.ts';
import { AutomaticSupport } from '../server/automatic-support.ts';
import { AnswerPolicyWorker } from '../server/answer-policy-worker.ts';
import { RuntimeAnswerPolicyStore, runtimePolicyHash } from '../server/runtime-answer-policy.ts';
import type { LoopProvider, LoopRetriever, ProductCorpus } from '../server/loop-types.ts';

/** Entirely new fictional data and temporary databases. This rehearsal never
 * opens repository evidence, .data, environment files, credentials or holdouts. */
export async function buildRuntimeAnswerPolicyRehearsal() {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-runtime-policy-rehearsal-'));
  const paths = { workspace: join(directory, 'workspace.sqlite'), policy: join(directory, 'policy.sqlite'), automatic: join(directory, 'automatic.sqlite'), receipts: join(directory, 'synthetic-receipts.sqlite') };
  const originalFetch = globalThis.fetch;
  let attemptedNetworkCalls = 0;
  globalThis.fetch = async () => { attemptedNetworkCalls++; throw new Error('Offline rehearsal forbids all network dispatch.'); };
  const dispatchedPolicies: { runId: string; id: string; instructionSha256: string; instructions: string }[] = [];
  class RecordingSyntheticProvider extends SyntheticAnswerProvider {
    override async answer(input: Parameters<LoopProvider['answer']>[0]) {
      dispatchedPolicies.push({ runId: input.runId!, id: input.policy.id, instructionSha256: runtimePolicyHash(input.policy.instructions), instructions: input.policy.instructions });
      return super.answer(input);
    }
  }
  const provider = new RecordingSyntheticProvider(paths.receipts);
  const store = new RuntimeAnswerPolicyStore(paths.policy);
  let blockedRetrieval: { entered: () => void; wait: Promise<void> } | undefined;
  const retrieverFactory = (corpus: ProductCorpus): LoopRetriever => ({ close() {}, async retrieve(productId) {
    assert.equal(corpus.products[0].id, productId);
    const block = blockedRetrieval;
    if (block) { blockedRetrieval = undefined; block.entered(); await block.wait; }
    return { passages: corpus.passages.map(passage => ({ ...passage, lexicalRank: 1, semanticRank: 1, score: 1 })), durationMs: 0, method: 'synthetic_offline_rehearsal', embeddingModel: 'none_no_embedding_call', corpusVersion: corpus.version };
  } });
  const workspace = new ProductWorkspace(paths.workspace, provider, retrieverFactory, store);
  const automatic = new AutomaticSupport(provider, paths.automatic);
  const worker = new AnswerPolicyWorker(provider, store, paths.policy, { canDispatch: () => !workspace.hasActive() });
  let releaseRetrieval: (() => void) | undefined;
  let pendingWorkspaceAsk: Promise<WorkspaceRun> | undefined;
  try {
    const baseline = store.capture('synthetic');
    const product = workspace.createProduct({ title: 'Fictional Thistle flask', sources: [{ label: 'Synthetic fictional listing', text: 'SYNTHETIC fixture: The fictional Thistle flask holds six cups and has a cork lid.' }] });
    const originals = [];
    for (let index = 0; index < 3; index++) {
      const run = await workspace.ask({ productId: product.id, question: 'What capacity and lid are listed for the fictional Thistle flask?', mode: 'synthetic' }, undefined, { automaticCheck: true });
      assert.equal(run.status, 'completed'); assert.equal(run.runtimePolicy?.id, baseline.id);
      const [snapshot] = workspace.reviewSnapshots(run.id);
      assert.ok(snapshot); originals.push(snapshot);
      automatic.enqueue(snapshot); workspace.markAutomaticCheckHandoff(run.id, 'enqueued');
    }
    for (let phase = 0; phase < 9; phase++) await automatic.tick();
    const completed = automatic.overview();
    assert.equal(completed.length, 3);
    assert.ok(completed.every(job => job.status === 'repaired' && job.finishedAt && job.operations.length === 3 && job.operations.every(operation => operation.status === 'completed')));
    assert.ok(completed.every(job => job.assessments.find(item => item.phase === 'original')?.assessment.disposition === 'repair'));
    assert.equal(new Set(completed.map(job => job.original.runId)).size, 3);
    const originalSnapshotHashes = originals.map(snapshot => ({ runId: snapshot.runId, snapshotSha256: runtimePolicyHash(snapshot), answerSha256: runtimePolicyHash(snapshot.answer), sourceContextSha256: runtimePolicyHash(snapshot.context) }));
    const receiptRows = () => {
      const db = new DatabaseSync(paths.receipts, { readOnly: true });
      try { return db.prepare('SELECT run_id,input_sha256,document FROM synthetic_answer_receipts ORDER BY run_id').all() as { run_id: string; input_sha256: string; document: string }[]; }
      finally { db.close(); }
    };
    const protectedReceiptRows = receiptRows();
    assert.equal(protectedReceiptRows.length, 12, 'Three original answers and nine automatic phases have durable synthetic receipts.');
    const protectedReceiptHashes = protectedReceiptRows.map(row => ({ runId: row.run_id, documentSha256: runtimePolicyHash(row.document) }));
    assert.deepEqual(worker.observeCompleted(completed), { observed: 3, eligible: 1 });
    assert.deepEqual(worker.observeCompleted(completed), { observed: 0, eligible: 0 });
    assert.equal(worker.overview().groups.length, 1);
    const groupId = worker.overview().groups[0].id;
    assert.equal(worker.overview().groups[0].callCeiling, 13);
    const phases = [];
    for (let phase = 0; phase < 13; phase++) {
      const before = worker.get(groupId)!;
      assert.equal(before.phase, phase);
      await worker.tick();
      const after = worker.get(groupId)!;
      assert.equal(after.operations.length, phase + 1, 'One finite phase per explicit worker tick.');
      assert.equal(after.operations[phase].status, 'completed');
      phases.push({ phase, runId: after.operations[phase].runId, receiptId: after.operations[phase].receiptId, requestSha256: after.operations[phase].requestSha256 });
    }
    const group = worker.get(groupId)!;
    assert.equal(group.status, 'completed'); assert.ok(group.candidate && group.decisionId);
    const decision = store.getDecision(group.decisionId)!;
    assert.equal(decision.complete, true); assert.equal(decision.verdict, 'eligible_synthetic_trial');
    assert.equal(decision.kind, 'synthetic_scripted_trial'); assert.equal(decision.calibration, 'not_measured'); assert.equal(decision.qualityClaimEligible, false);
    assert.equal(store.capture('synthetic').id, baseline.id, 'Evaluation does not activate itself.');
    const receiptsAfterEvaluation = receiptRows();
    for (let tick = 0; tick < 3; tick++) { await worker.tick(); assert.deepEqual(worker.observeCompleted(completed), { observed: 0, eligible: 0 }); }
    assert.equal(worker.overview().groups.length, 1); assert.deepEqual(receiptRows(), receiptsAfterEvaluation, 'Consumed failures cannot dispatch a second proposal.');

    let retrievalEntered!: () => void;
    const entered = new Promise<void>(resolveEntered => { retrievalEntered = resolveEntered; });
    const wait = new Promise<void>(resolveWait => { releaseRetrieval = resolveWait; });
    blockedRetrieval = { entered: retrievalEntered, wait };
    const pendingAsk = workspace.ask({ productId: product.id, question: 'What lid is listed for the fictional Thistle flask?', mode: 'synthetic' });
    pendingWorkspaceAsk = pendingAsk;
    await entered;
    const capturedRun = workspace.overview().runs.find(run => run.status === 'retrieving')!;
    assert.equal(capturedRun.runtimePolicy?.id, baseline.id); assert.equal(capturedRun.runtimePolicyInstructions, baseline.instructions);
    const candidate = worker.activateTrial(groupId);
    assert.equal(store.capture('synthetic').id, candidate.id);
    assert.equal(candidate.parentId, baseline.id); assert.ok(candidate.instructions.startsWith(`${baseline.instructions}\n\nRuntime answer-policy addition:\n`));
    assert.throws(() => worker.activateTrial(groupId), /stale parent/);
    assert.throws(() => store.activateTrial('live', store.capture('live').id, decision.id), /matching persisted decision and policy modes/);
    assert.ok(releaseRetrieval); releaseRetrieval(); releaseRetrieval = undefined;
    const inFlight = await pendingAsk;
    assert.equal(inFlight.status, 'completed'); assert.equal(inFlight.runtimePolicy?.id, baseline.id);
    assert.equal(inFlight.runtimePolicy?.instructionSha256, baseline.instructionSha256);
    assert.equal(dispatchedPolicies.find(item => item.runId === inFlight.id)?.instructions, baseline.instructions);
    const later = await workspace.ask({ productId: product.id, question: 'What lid is listed for the fictional Thistle flask?', mode: 'synthetic' });
    assert.equal(later.status, 'completed'); assert.equal(later.runtimePolicy?.id, candidate.id);
    const laterDispatch = dispatchedPolicies.find(item => item.runId === later.id)!;
    assert.equal(laterDispatch.instructions, candidate.instructions); assert.equal(laterDispatch.instructionSha256, candidate.instructionSha256);
    const rollback = store.rollback('synthetic', candidate.id);
    assert.equal(rollback.id, baseline.id);
    const afterRollback = await workspace.ask({ productId: product.id, question: 'What lid is listed for the fictional Thistle flask?', mode: 'synthetic' });
    assert.equal(afterRollback.status, 'completed'); assert.equal(afterRollback.runtimePolicy?.id, baseline.id);
    assert.equal(dispatchedPolicies.find(item => item.runId === afterRollback.id)?.instructions, baseline.instructions);
    const active = store.overview('synthetic');
    assert.deepEqual(active.events.map(event => event.action).sort(), ['rollback', 'synthetic_trial_activation']);
    assert.equal(active.versions.length, 2); assert.equal(active.decisions.length, 1);
    for (const original of originals) assert.equal(runtimePolicyHash(workspace.reviewSnapshots(original.runId)[0]), runtimePolicyHash(original), 'Activation and rollback preserve exact original snapshots.');
    const allReceipts = receiptRows();
    for (const protectedRow of protectedReceiptRows) assert.deepEqual(allReceipts.find(row => row.run_id === protectedRow.run_id), protectedRow, 'Original answer and automatic receipts remain byte-identical.');
    assert.ok(allReceipts.every(row => {
      const receipt = JSON.parse(row.document), wire = JSON.parse(receipt.receipt_json);
      return receipt.model === 'synthetic-fixture' && receipt.allowance_usd === 0 && wire.mode === 'synthetic' && wire.accounting === 'no_provider_call';
    }));
    assert.equal(attemptedNetworkCalls, 0); assert.deepEqual(provider.externalReceipts(), []);
    const decisionReceipts = decision.operations.map(operation => ({ runId: operation.runId, requestSha256: operation.requestSha256, receipt: provider.receipt(operation.runId)! }));
    assert.equal(decisionReceipts.length, 13);
    return {
      schemaVersion: 'runtime-answer-policy-offline-rehearsal-v1', createdAt: new Date().toISOString(), mode: 'synthetic' as const,
      evidenceKind: 'synthetic_scripted_workflow_rehearsal', qualityClaimEligible: false, calibration: 'not_measured',
      limitations: ['Fictional scripted controls verify persistence, binding, bounded execution and rollback only.', 'No model correctness or quality improvement is established.', 'Live activation remains closed until a separately qualified calibration and fresh evaluation gate exists.'],
      reproducibility: { command: 'npm run answer-policy:rehearse -- --output <new-output.json>', storage: 'Fresh temporary SQLite databases; removed after rehearsal.', fixturePacketSha256: decision.packetSha256, graderSha256: decision.graderSha256, sourceInputs: [product], paidProviderCalls: 0, attemptedNetworkCalls, humanJudgments: 0, humanAcceptEvents: 0, humanPromotionEvents: 0 },
      summary: { newCompletedFailures: completed.length, deduplicatedGroups: 1, candidates: 1, trialCallCeiling: 13, completedTrialPhases: phases.length, syntheticTrialActivated: true, laterAskReceivedCandidateInstructions: true, inFlightAskRetainedBaseline: true, rollbackRestoredFutureBaseline: true, originalSnapshotsUnchanged: true, originalReceiptBytesUnchanged: true, consumedGroupDidNotRedispatch: true },
      policies: { baseline, candidate, activeAfterRollback: active.active },
      immutableOriginalEvidence: { originalSnapshotHashes, protectedReceiptHashes, snapshots: originals, completedAutomaticChecks: completed },
      exactDecisionEvidence: { decisionSha256: runtimePolicyHash(decision), decision, group, phaseReceipts: decisionReceipts },
      lifecycle: { events: active.events, inFlightAsk: inFlight, laterAsk: later, afterRollbackAsk: afterRollback, dispatchedPolicies },
      newlyCreatedSyntheticReceipts: allReceipts.map(row => ({ runId: row.run_id, inputSha256: row.input_sha256, documentSha256: runtimePolicyHash(row.document), exactDocument: row.document }))
    };
  } finally {
    releaseRetrieval?.();
    await pendingWorkspaceAsk?.catch(() => undefined);
    await worker.pauseAndDrain(); await automatic.pauseAndDrain();
    worker.close(); automatic.close(); workspace.close(); store.close(); provider.close();
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--output' || !args[1])) throw new Error('Usage: npm run answer-policy:rehearse -- [--output <new-output.json>]');
  const output = resolve(args[1] ?? join('/tmp', `runtime-answer-policy-rehearsal-${randomUUID()}.json`));
  const bundle = await buildRuntimeAnswerPolicyRehearsal();
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(bundle, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ output, ...bundle.summary, paidProviderCalls: 0, attemptedNetworkCalls: 0, humanJudgments: 0, qualityClaimEligible: false }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : 'Offline rehearsal failed.'); process.exitCode = 1; });
