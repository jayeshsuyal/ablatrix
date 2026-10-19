import { textHash } from './product-corpus.ts';
import { workspaceReviewSourceHash } from './answer-review-source.ts';
import { WORKSPACE_GENERATION_CONTRACT, workspaceGenerationContract, workspaceGenerationParts, type WorkspaceGenerationContract } from './workspace-generation.ts';
import { WORKSPACE_SOURCE_COVERAGE_CONTRACT } from './workspace-source-coverage.ts';
import { WORKSPACE_SOURCE_COVERAGE_V2_CONTRACT } from './workspace-source-coverage-v2.ts';
import type { WorkspaceRun } from './product-workspace.ts';

export type WorkspaceRetrievalContract = typeof WORKSPACE_SOURCE_COVERAGE_CONTRACT | typeof WORKSPACE_SOURCE_COVERAGE_V2_CONTRACT;

/** Default/explicit v1 keep the historical identity bytes. Experimental
 * requests add their contract so a retry cannot change its generation policy. */
export function workspaceQuestionRequestHash(input: Pick<WorkspaceRun, 'productId' | 'question' | 'mode'>, automaticCheck = false, selected?: WorkspaceGenerationContract, retrievalContract?: WorkspaceRetrievalContract) {
  const contract = workspaceGenerationContract(selected);
  if (retrievalContract !== undefined && retrievalContract !== WORKSPACE_SOURCE_COVERAGE_CONTRACT && retrievalContract !== WORKSPACE_SOURCE_COVERAGE_V2_CONTRACT) throw new Error('Unknown workspace retrieval contract.');
  return textHash(JSON.stringify({ productId: input.productId, question: input.question, mode: input.mode, automaticCheck,
    ...(contract !== WORKSPACE_GENERATION_CONTRACT ? { generationContract: contract } : {}), ...(retrievalContract ? { retrievalContract } : {}) }));
}

/** Pure identity check shared by crash recovery and offline evidence export.
 * An early failed request may have no prepared generation; it cannot assert a
 * generation receipt. Once prepared, every question, policy and source byte is
 * bound to the exact persisted request and the immutable review snapshot. */
export function verifyWorkspaceRunGeneration(run: WorkspaceRun): void {
  const contract = workspaceGenerationContract(run.requestIdentity?.generationContract);
  const retrievalContract = run.requestIdentity?.retrievalContract;
  const requestSha256 = workspaceQuestionRequestHash(run, run.automaticCheckRequested ?? false, contract, retrievalContract);
  if (run.requestIdentity && run.requestIdentity.sha256 !== requestSha256) throw new Error('Saved generation request identity is inconsistent.');
  if (run.sourceCoverage && run.sourceCoverage.contract !== retrievalContract || run.generation && retrievalContract !== undefined && run.sourceCoverage?.contract !== retrievalContract) throw new Error('Saved retrieval contract is inconsistent.');
  const generation = run.generation;
  if (!generation) return;
  const parts = workspaceGenerationParts(generation.input), sources = run.reviewContext?.sources;
  if (generation.contract !== contract || run.generationProtocol !== contract || parts.binding.contract !== contract || textHash(JSON.stringify(parts.body)) !== generation.binding.requestSha256 || JSON.stringify(parts.body) !== JSON.stringify(generation.requestBody) || JSON.stringify(parts.binding) !== JSON.stringify(generation.binding) ||
    run.requestIdentity?.sha256 !== requestSha256 ||
    generation.input.runId !== run.id || generation.input.product.id !== run.productId || generation.input.question !== run.question || generation.binding.executionMode !== run.mode ||
    generation.input.product.id !== run.reviewContext?.product.id || generation.input.product.title !== run.reviewContext?.product.title || generation.input.question !== run.reviewContext.question ||
    generation.binding.policyId !== run.runtimePolicy?.id || generation.binding.policySha256 !== run.runtimePolicy?.instructionSha256 || run.runtimePolicy?.mode !== run.mode || generation.input.policy.instructions !== run.runtimePolicyInstructions ||
    JSON.stringify(generation.input.passages) !== JSON.stringify(run.generationPassages) || !sources || sources.some(source => workspaceReviewSourceHash(source) !== source.sha256) || generation.input.passages.some(passage => !sources.some(source => source.id === passage.id && source.text === passage.text && source.originalQuestion === (passage.originalQuestion ?? null)))) throw new Error('Saved generation identity is inconsistent.');
}
