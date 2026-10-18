import { textHash } from './product-corpus.ts';
import { workspaceReviewSourceHash } from './answer-review-source.ts';
import { WORKSPACE_GENERATION_CONTRACT, workspaceGenerationParts } from './workspace-generation.ts';
import type { WorkspaceRun } from './product-workspace.ts';

/** Pure identity check shared by crash recovery and offline evidence export.
 * An early failed request may have no prepared generation; it cannot assert a
 * generation receipt. Once prepared, every question, policy and source byte is
 * bound to the exact persisted request and the immutable review snapshot. */
export function verifyWorkspaceRunGeneration(run: WorkspaceRun): void {
  const requestSha256 = textHash(JSON.stringify({ productId: run.productId, question: run.question, mode: run.mode, automaticCheck: run.automaticCheckRequested ?? false }));
  if (run.requestIdentity && run.requestIdentity.sha256 !== requestSha256) throw new Error('Saved generation request identity is inconsistent.');
  const generation = run.generation;
  if (!generation) return;
  const parts = workspaceGenerationParts(generation.input), sources = run.reviewContext?.sources;
  if (generation.contract !== WORKSPACE_GENERATION_CONTRACT || run.generationProtocol !== WORKSPACE_GENERATION_CONTRACT || textHash(JSON.stringify(parts.body)) !== generation.binding.requestSha256 || JSON.stringify(parts.body) !== JSON.stringify(generation.requestBody) || JSON.stringify(parts.binding) !== JSON.stringify(generation.binding) ||
    run.requestIdentity?.sha256 !== requestSha256 ||
    generation.input.runId !== run.id || generation.input.product.id !== run.productId || generation.input.question !== run.question || generation.binding.executionMode !== run.mode ||
    generation.input.product.id !== run.reviewContext?.product.id || generation.input.product.title !== run.reviewContext?.product.title || generation.input.question !== run.reviewContext.question ||
    generation.binding.policyId !== run.runtimePolicy?.id || generation.binding.policySha256 !== run.runtimePolicy?.instructionSha256 || run.runtimePolicy?.mode !== run.mode || generation.input.policy.instructions !== run.runtimePolicyInstructions ||
    JSON.stringify(generation.input.passages) !== JSON.stringify(run.generationPassages) || !sources || sources.some(source => workspaceReviewSourceHash(source) !== source.sha256) || generation.input.passages.some(passage => !sources.some(source => source.id === passage.id && source.text === passage.text && source.originalQuestion === (passage.originalQuestion ?? null)))) throw new Error('Saved generation identity is inconsistent.');
}
