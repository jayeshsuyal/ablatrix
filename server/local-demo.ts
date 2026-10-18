import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from './app.ts';
import { AutomaticSupport } from './automatic-support.ts';
import { SyntheticAnswerProvider } from './synthetic-answer-provider.ts';
import { ProductWorkspace } from './product-workspace.ts';
import { RunStore } from './store.ts';
import { RuntimeAnswerPolicyStore } from './runtime-answer-policy.ts';
import { PilotRunner, PilotStore } from './pilot.ts';
import type { LoopRetriever, ProductCorpus } from './loop-types.ts';
import { createRuntimeGraderBinding } from './runtime-grader.ts';
import { CITED_APPLICABILITY_GRADER_VERSION } from './claim-support-v4.ts';
import { seedRejectedPolicyDemo } from './rejected-policy-demo-fixture.ts';

/** Source selection is deliberately scripted: no BGE download or model call.
 * Demo evidence never enters the product/research corpora. */
export const localDemoRetriever = (corpus: ProductCorpus): LoopRetriever => ({ close() {}, async retrieve(productId) {
  return { passages: corpus.passages.filter(passage => passage.productId === productId).map((passage, index) => ({ ...passage, lexicalRank: index + 1, semanticRank: null, score: 0 })), durationMs: 0, method: 'synthetic_demo_all_saved_sources', embeddingModel: 'none_no_embedding_download', corpusVersion: corpus.version };
} });

/** Each launch owns a fresh directory. It cannot adopt a live/hosted ledger or
 * mutate environment settings. The caller binds this server to loopback only. */
export async function createLocalDemo(rootDirectory = resolve('work/demo')) {
  mkdirSync(rootDirectory, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(join(rootDirectory, 'session-'));
  const provider = new SyntheticAnswerProvider(join(directory, 'synthetic-receipts.sqlite'), { workspaceFixture: 'thistle-capacity-demo' });
  const policies = new RuntimeAnswerPolicyStore(join(directory, 'runtime-policy.sqlite'));
  const workspacePath = join(directory, 'workspace.sqlite'), reviewPath = join(directory, 'reviews.sqlite');
  let interrupted = false;
  let workspace = new ProductWorkspace(workspacePath, provider, localDemoRetriever, policies, { fault(boundary) {
    if (boundary === 'after_receipt' && !interrupted) { interrupted = true; throw new Error('SYNTHETIC demo interruption after the durable original receipt.'); }
  } });
  const flask = workspace.createProduct({ title: 'Thistle flask · fictional demo', sources: [{ label: 'Fictional product specification', text: 'SYNTHETIC fixture: The Thistle flask holds six cups and has a cork lid. The body is stainless steel.' }] });
  await assert.rejects(workspace.ask({ productId: flask.id, question: 'What capacity and lid are listed for the Thistle flask?', mode: 'synthetic' }, undefined, { automaticCheck: true, idempotencyKey: 'demo-recovered-original-v1' }), /SYNTHETIC demo interruption/);
  const interruptedRun = workspace.overview().runs[0];
  assert.ok(interruptedRun); const originalReceiptId = provider.receipt(interruptedRun.id)?.id;
  assert.ok(originalReceiptId); workspace.close();
  workspace = new ProductWorkspace(workspacePath, provider, localDemoRetriever, policies);
  const recovered = workspace.overview().runs.find(run => run.id === interruptedRun.id)!;
  assert.equal(recovered.status, 'completed'); assert.equal(provider.receipt(recovered.id)?.id, originalReceiptId);
  const stopProduct = workspace.createProduct({ title: 'Aster storage box · stop example', sources: [{ label: 'Fictional listing with missing rating', text: 'SYNTHETIC stop fixture: The Aster storage box has a snap-on lid and a two-liter capacity. No temperature rating is supplied.' }] });
  const stopped = await workspace.ask({ productId: stopProduct.id, question: 'What is the maximum temperature rating of the Aster box?', mode: 'synthetic' }, undefined, { automaticCheck: true, idempotencyKey: 'demo-safe-stop-v1' });
  assert.equal(stopped.status, 'completed');
  const automatic = new AutomaticSupport(provider, reviewPath, { graderBinding: createRuntimeGraderBinding('synthetic', CITED_APPLICABILITY_GRADER_VERSION) });
  for (const snapshot of workspace.automaticCheckSnapshots()) { automatic.enqueue(snapshot); workspace.markAutomaticCheckHandoff(snapshot.runId, 'enqueued'); }
  for (let phase = 0; phase < 6; phase++) await automatic.tick();
  const completed = automatic.overview();
  assert.equal(completed.find(job => job.original.runId === recovered.id)?.status, 'repaired');
  assert.equal(completed.find(job => job.original.runId === stopped.id)?.delivery?.origin, 'safe_abstention');
  await automatic.pauseAndDrain(); automatic.close();
  const rejected = await seedRejectedPolicyDemo(directory, provider, policies);
  assert.equal(rejected.decision.verdict, 'rejected');
  writeFileSync(join(directory, 'demo.json'), JSON.stringify({ schemaVersion: 'local-synthetic-demo-v1', provenance: 'synthetic_scripted_workflow_only', recoveredRunId: recovered.id, originalReceiptId, stoppedRunId: stopped.id, rejectedPolicyDecisionId: rejected.decisionId, providerCalls: 0, embeddingDownloads: 0, qualityClaimEligible: false }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const store = new RunStore(join(directory, 'research.sqlite'));
  const server = createApp(store, 'fixture', undefined, new PilotRunner(new PilotStore(join(directory, 'pilot.sqlite'))), undefined, undefined, workspace, undefined, true, {
    answerProvider: provider, runtimePolicyStore: policies, runtimePolicyDbPath: join(directory, 'runtime-policy.sqlite'), answerPolicyWorker: rejected.worker, reviewDbPath: reviewPath, comparisonDbPath: join(directory, 'comparisons.sqlite'), localDemo: { label: 'Fresh isolated synthetic demonstration' }
  });
  return { server, store, directory, seeded: { recovered: recovered.id, stopped: stopped.id }, providerCalls: 0 as const };
}
