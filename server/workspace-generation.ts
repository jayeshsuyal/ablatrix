import { createHash } from 'node:crypto';
import { z } from 'zod';
import { flatSourceIdAnswerRequestBody, flatSourceIdAnswerPromptIdentity } from './feedback-provider.ts';
import { resolveSourceCitationIds, sourceCitationOptions, stripSourceIdMarkers, type SourceCitationScope } from './citation-options.ts';
import type { LoopProvider, LoopUsage } from './loop-types.ts';

export const WORKSPACE_GENERATION_CONTRACT = 'workspace-answer-flat-sources-v1' as const;
export const WORKSPACE_GENERATION_TOOL = 'workspace_answer_flat_sources_v1' as const;
export const WORKSPACE_ANSWER_CHARACTERS = 1500;
export type WorkspaceGenerationInput = Parameters<LoopProvider['answer']>[0] & { runId: string };
export type WorkspaceGenerationReceipt = { id: string; kind: string; status: string; error_code: string | null; receipt_json: string | null; model: string | null;
  input_tokens?: number | null; output_tokens?: number | null; executionMode?: 'live' | 'synthetic'; allowance_usd?: number };
const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const outputSchema = z.object({ answer: z.string().trim().min(1).max(WORKSPACE_ANSWER_CHARACTERS), status: z.enum(['answered', 'insufficient_evidence']), citations: z.array(z.string().min(1).max(32)).max(5) }).strict();

/** Additive /ask contract. Historical flat v3, snippet and quote bodies are not edited. */
export function workspaceGenerationParts(raw: WorkspaceGenerationInput) {
  const input = structuredClone(raw);
  if (!input.runId?.trim() || input.runId.length > 200 || input.passages.some(passage => passage.productId !== input.product.id || hash(passage.text) !== passage.sha256)) throw new Error('Workspace generation requires an exact operation and source snapshot.');
  const body = flatSourceIdAnswerRequestBody(input);
  const payload = { ...JSON.parse(body.messages[1]!.content), promptVersion: WORKSPACE_GENERATION_CONTRACT, operationRunId: input.runId,
    runtimePolicy: { id: input.policy.id, instructionSha256: hash(input.policy.instructions), mode: input.policy.mode === 'fixture' ? 'synthetic' : 'live' } };
  const systemInstructions = `${flatSourceIdAnswerPromptIdentity().systemInstructions.replaceAll('product_answer_source_ids_v3', WORKSPACE_GENERATION_TOOL)} Keep the answer at most ${WORKSPACE_ANSWER_CHARACTERS} characters.`;
  const parameters = structuredClone(body.tools[0]!.function.parameters) as { properties: { answer: { maxLength: number } } };
  parameters.properties.answer.maxLength = WORKSPACE_ANSWER_CHARACTERS;
  const requestBody = { ...body, messages: [{ role: 'system', content: systemInstructions }, { role: 'user', content: JSON.stringify(payload) }],
    tools: [{ ...body.tools[0]!, function: { ...body.tools[0]!.function, name: WORKSPACE_GENERATION_TOOL, parameters } }], tool_choice: { type: 'function', function: { name: WORKSPACE_GENERATION_TOOL } } };
  if (requestBody.messages[1]!.content.length > 40_000) throw new Error('Workspace generation exceeds the bounded source context.');
  const scope: SourceCitationScope = { productId: input.product.id, question: input.question, evidence: payload.evidence };
  const binding = { contract: WORKSPACE_GENERATION_CONTRACT, executionMode: payload.runtimePolicy.mode as 'live' | 'synthetic', operationRunId: input.runId,
    policyId: input.policy.id, policySha256: payload.runtimePolicy.instructionSha256, requestSha256: hash(requestBody), systemInstructionsSha256: hash(systemInstructions),
    responseSchemaSha256: hash(parameters), optionSetSha256: hash(sourceCitationOptions(scope)), sourceContextSha256: hash({ question: input.question, product: payload.product, evidence: payload.evidence }) };
  return { input, body: requestBody, payload, parameters, systemInstructions, scope, binding };
}
export type WorkspaceGenerationBinding = ReturnType<typeof workspaceGenerationParts>['binding'];
export function validateWorkspaceGenerationOutput(input: WorkspaceGenerationInput, raw: unknown) {
  const parts = workspaceGenerationParts(input), output = outputSchema.parse(raw), citations = resolveSourceCitationIds(parts.scope, output.citations);
  if (output.status === 'answered' && !citations.length) throw new Error('Workspace answer requires a supplied source ID.');
  return { answer: stripSourceIdMarkers(output.answer, output.citations), status: output.status, citations };
}
export function replayWorkspaceGenerationReceipt(input: WorkspaceGenerationInput, receipt: WorkspaceGenerationReceipt, mode: 'live' | 'synthetic') {
  const parts = workspaceGenerationParts(input);
  try {
    if (!receipt.id || receipt.kind !== WORKSPACE_GENERATION_TOOL || receipt.status !== 'completed' || receipt.error_code || !receipt.receipt_json || parts.binding.executionMode !== mode || receipt.executionMode !== undefined && receipt.executionMode !== mode) throw new Error('receipt_state');
    const document = JSON.parse(receipt.receipt_json);
    if (document.promptVersion !== WORKSPACE_GENERATION_CONTRACT || document.mode !== mode || document.model !== receipt.model || (mode === 'synthetic' ? document.model !== 'synthetic-fixture' || document.accounting !== 'no_provider_call' : !['gpt-luna', 'gpt-5.6-luna'].includes(document.model) || document.accounting !== 'local_planning_allowance')) throw new Error('receipt_provenance');
    for (const [key, value] of Object.entries(parts.binding)) if (document[key] !== value) throw new Error('receipt_identity');
    const usage: LoopUsage = document.usage === null ? null : z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).strict().parse(document.usage);
    if (receipt.input_tokens !== undefined && receipt.input_tokens !== (usage?.inputTokens ?? null) || receipt.output_tokens !== undefined && receipt.output_tokens !== (usage?.outputTokens ?? null)) throw new Error('receipt_usage');
    const answer = validateWorkspaceGenerationOutput(parts.input, document.output);
    if (mode === 'synthetic' && !answer.answer.startsWith('SYNTHETIC')) throw new Error('synthetic_label');
    return { answer, model: document.model as string, usage, attemptId: receipt.id, ...parts.binding };
  } catch { throw new Error('Workspace generation receipt requires reconciliation; it was not redispatched.'); }
}
export interface WorkspaceGenerationProvider {
  answerWorkspace(input: WorkspaceGenerationInput): Promise<ReturnType<typeof replayWorkspaceGenerationReceipt>>;
  receipt(runId: string): WorkspaceGenerationReceipt | undefined;
}
