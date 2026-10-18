import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AnswerPolicyWorker, type AnswerPolicyProvider } from './answer-policy-worker.ts';
import { AutomaticSupport, type AutomaticSupportJob } from './automatic-support.ts';
import { ProductWorkspace } from './product-workspace.ts';
import { SyntheticAnswerProvider } from './synthetic-answer-provider.ts';
import { RuntimeAnswerPolicyStore } from './runtime-answer-policy.ts';
import { createRuntimeGraderBinding } from './runtime-grader.ts';
import { CITED_APPLICABILITY_GRADER_VERSION } from './claim-support-v4.ts';
import { RUNTIME_POLICY_ANSWER_TOOL, RUNTIME_POLICY_PROPOSAL_TOOL, runtimeAnswerRequestParts, runtimeProposalRequestParts, replayRuntimeAnswerReceipt, replayRuntimeProposalReceipt, type RuntimeAnswerInput } from './answer-policy-protocol.ts';
import type { AnswerRevisionReceipt } from './answer-revisions.ts';
import type { LoopRetriever, ProductCorpus } from './loop-types.ts';

const fictionalRetriever = (corpus: ProductCorpus): LoopRetriever => ({ close() {}, async retrieve(productId) { return { passages: corpus.passages.filter(item => item.productId === productId).map(item => ({ ...item, lexicalRank: 1, semanticRank: null, score: 1 })), durationMs: 0, method: 'synthetic_rejected_policy_fixture', embeddingModel: 'none_no_embedding_download', corpusVersion: corpus.version }; } });

/** Candidate answers are deliberately scripted to abstain from every question.
 * These are new bound fixture receipts, never edits to a completed receipt or a
 * fabricated release decision. The real worker evaluates and rejects them. */
export class RejectedPolicyDemoProvider implements AnswerPolicyProvider {
  readonly executionMode = 'synthetic' as const;
  private readonly db: DatabaseSync;
  private closed = false;
  constructor(private readonly base: SyntheticAnswerProvider, path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('CREATE TABLE IF NOT EXISTS rejected_policy_demo_receipts(run_id TEXT PRIMARY KEY,document TEXT NOT NULL)');
  }
  readiness() { return this.closed ? { ready: false, reason: 'Synthetic rejected-policy fixture is closed.' } : this.base.readiness(); }
  capacity(count: number) { return this.closed ? this.readiness() : this.base.capacity(count); }
  receipt(runId: string): AnswerRevisionReceipt | undefined {
    const row = this.db.prepare('SELECT document FROM rejected_policy_demo_receipts WHERE run_id=?').get(runId) as { document: string } | undefined;
    return row ? JSON.parse(row.document) as AnswerRevisionReceipt : this.base.receipt(runId);
  }
  suggestRuntimePolicy: AnswerPolicyProvider['suggestRuntimePolicy'] = async input => {
    if (this.closed) throw new Error('Synthetic rejected-policy fixture is closed.');
    const parts = runtimeProposalRequestParts(input), previous = this.receipt(input.runId);
    if (previous) return replayRuntimeProposalReceipt(input, previous, 'synthetic');
    const output = { instructions: 'For every product question, abstain and return insufficient_evidence, including when supplied sources contain the requested fact.', rationale: 'SYNTHETIC deliberately defective blanket-abstention candidate. This negative control must be rejected by answerability and available-fact checks.' };
    const receipt = this.insertReceipt(input.runId, RUNTIME_POLICY_PROPOSAL_TOOL, output, parts.prompt.promptVersion, parts.bindings);
    return replayRuntimeProposalReceipt(input, receipt, 'synthetic');
  };
  gradeClaimSupport: AnswerPolicyProvider['gradeClaimSupport'] = input => this.base.gradeClaimSupport(input);
  async answerRuntimePolicy(input: RuntimeAnswerInput) {
    if (this.closed) throw new Error('Synthetic rejected-policy fixture is closed.');
    if (!input.policy.instructions.includes('Runtime answer-policy addition:')) return this.base.answerRuntimePolicy(input);
    const parts = runtimeAnswerRequestParts(input), previous = this.receipt(input.runId);
    if (previous) return replayRuntimeAnswerReceipt(input, previous, 'synthetic');
    const output = { status: 'insufficient_evidence', answer: 'SYNTHETIC runtime fixture abstention: The requested fact is absent from this fictional source packet.', citations: [] };
    const receipt = this.insertReceipt(input.runId, RUNTIME_POLICY_ANSWER_TOOL, output, parts.prompt.promptVersion, parts.bindings);
    return replayRuntimeAnswerReceipt(input, receipt, 'synthetic');
  }
  private insertReceipt(runId: string, kind: string, output: unknown, promptVersion: string, bindings: object): AnswerRevisionReceipt {
    const receipt: AnswerRevisionReceipt = { id: `synthetic-${randomUUID()}`, kind, status: 'completed', error_code: null, model: 'synthetic-fixture', input_tokens: null, output_tokens: null, allowance_usd: 0, executionMode: 'synthetic', accounting: 'no_provider_call',
      receipt_json: JSON.stringify({ output, model: 'synthetic-fixture', usage: null, promptVersion, ...bindings, mode: 'synthetic', accounting: 'no_provider_call' }) };
    this.db.prepare('INSERT INTO rejected_policy_demo_receipts(run_id,document) VALUES(?,?)').run(runId, JSON.stringify(receipt)); return receipt;
  }
  close() { if (!this.closed) { this.closed = true; this.db.close(); } }
}

/** Seeds an actual rejected synthetic trial in a caller-owned fresh demo folder.
 * The policy store remains at baseline. This is no model-quality measurement. */
export async function seedRejectedPolicyDemo(directory: string, provider: SyntheticAnswerProvider, policies: RuntimeAnswerPolicyStore) {
  const baseline = policies.capture('synthetic');
  assert.equal(baseline.status, 'baseline', 'Rejected-policy demo requires a fresh baseline store.');
  const binding = createRuntimeGraderBinding('synthetic', CITED_APPLICABILITY_GRADER_VERSION);
  const support = new AutomaticSupport(provider, join(directory, 'rejected-policy-support.sqlite'), { graderBinding: binding });
  const workspace = new ProductWorkspace(join(directory, 'rejected-policy-workspace.sqlite'), provider, fictionalRetriever, policies);
  const fixtureProvider = new RejectedPolicyDemoProvider(provider, join(directory, 'rejected-policy-receipts.sqlite'));
  let worker: AnswerPolicyWorker | undefined;
  try {
    const jobs: AutomaticSupportJob[] = [];
    for (const name of ['Wisp', 'Mica', 'Pearl']) {
      const product = workspace.createProduct({ title: `Fictional ${name} bowl`, sources: [{ label: 'Synthetic fictional listing', text: `SYNTHETIC fixture: The fictional ${name} bowl holds twelve cups.` }] });
      const run = await workspace.ask({ productId: product.id, question: `How many cups does the fictional ${name} bowl hold?`, mode: 'synthetic' });
      assert.equal(run.status, 'completed'); support.enqueue(workspace.reviewSnapshots(run.id)[0]);
      for (let phase = 0; phase < 3; phase++) await support.tick();
      const job = support.get(`workspace-${run.id}`)!; assert.equal(job.status, 'repaired'); jobs.push(job);
    }
    worker = new AnswerPolicyWorker(fixtureProvider, policies, join(directory, 'runtime-policy.sqlite'), { completedJobs: () => structuredClone(jobs), graderBinding: binding });
    worker.observeCompleted(jobs);
    for (let phase = 0; phase < 13; phase++) await worker.tick();
    const group = worker.overview().groups[0], decision = policies.getDecision(group.decisionId!)!;
    assert.equal(group.status, 'completed'); assert.equal(decision.verdict, 'rejected'); assert.equal(decision.complete, true); assert.equal(decision.operations.length, 13);
    assert.equal(decision.candidateMetrics.usefulSupportedAnswers, 0); assert.equal(decision.candidateMetrics.unnecessaryAbstentions, 2); assert.equal(decision.candidateMetrics.regressions, 1);
    assert.equal(policies.capture('synthetic').id, baseline.id); assert.throws(() => worker!.activateTrial(group.id), /eligible/);
    const closeWorker = worker.close.bind(worker);
    worker.close = () => { closeWorker(); fixtureProvider.close(); };
    return { worker, groupId: group.id, decisionId: decision.id, decision, baselineId: baseline.id, provenance: 'synthetic_scripted_rejection_control' as const,
      providerCalls: 0 as const, qualityClaimEligible: false as const, close: () => worker!.close() };
  } catch (error) { worker?.close(); fixtureProvider.close(); throw error; }
  finally { workspace.close(); support.close(); }
}
