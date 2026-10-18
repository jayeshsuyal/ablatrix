import { createHash } from 'node:crypto';
import { z } from 'zod';
import { flatSourceIdAnswerRequestBody, flatSourceIdAnswerPromptIdentity } from './feedback-provider.ts';
import { resolveSourceCitationIds, sourceCitationOptions, stripSourceIdMarkers, type SourceCitationScope } from './citation-options.ts';
import type { LoopProvider, LoopUsage } from './loop-types.ts';

export const WORKSPACE_GENERATION_CONTRACT = 'workspace-answer-flat-sources-v1' as const;
export const WORKSPACE_GENERATION_TOOL = 'workspace_answer_flat_sources_v1' as const;
export const WORKSPACE_SOURCE_CALIBRATION_CONTRACT = 'workspace-answer-source-calibration-v2' as const;
export const WORKSPACE_SOURCE_CALIBRATION_TOOL = 'workspace_answer_source_calibration_v2' as const;
export type WorkspaceGenerationContract = typeof WORKSPACE_GENERATION_CONTRACT | typeof WORKSPACE_SOURCE_CALIBRATION_CONTRACT;
export const WORKSPACE_ANSWER_CHARACTERS = 1500;
export type WorkspaceGenerationInput = Parameters<LoopProvider['answer']>[0] & { runId: string; generationContract?: WorkspaceGenerationContract };
export type WorkspaceGenerationReceipt = { id: string; kind: string; status: string; error_code: string | null; receipt_json: string | null; model: string | null;
  input_tokens?: number | null; output_tokens?: number | null; executionMode?: 'live' | 'synthetic'; allowance_usd?: number };
const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const outputSchema = z.object({ answer: z.string().trim().min(1).max(WORKSPACE_ANSWER_CHARACTERS), status: z.enum(['answered', 'insufficient_evidence']), citations: z.array(z.string().min(1).max(32)).max(5) }).strict();

export function workspaceGenerationContract(value: unknown = WORKSPACE_GENERATION_CONTRACT): WorkspaceGenerationContract {
  if (value !== WORKSPACE_GENERATION_CONTRACT && value !== WORKSPACE_SOURCE_CALIBRATION_CONTRACT) throw new Error('Unknown workspace generation contract.');
  return value;
}
/** Experimental instructions, frozen before selecting the separate evaluation
 * packet. V1 and every historical provider prompt remain byte-for-byte intact. */
const sourceCalibrationRules = 'Lead with the direct supported answer, normally in two or three concise sentences. Avoid stock wording such as "the supplied evidence", repeated disclaimers, and unrelated specifications. Prioritize sources about the exact requested product, model, variant and relationship over broader or neighboring-model reports. Report explicit listing specifications, capacities and configurations as attributed listing claims; independent physical testing is not required to report what the listing documents. A configuration absent from a listing is not thereby physically impossible, and a different listed configuration does not establish the requested one. Attribute customer observations as reports, preserving tentative words, conditions and limits; never turn a tentative opinion into a definite yes or no. Distinguish genuinely incompatible claims about the same scope from compatible descriptions or differences in certainty; do not invent a conflict merely because wording differs. State relevant supported facts first, then the specific unresolved relationship when needed. Ask for a model identifier only if it is absent from the question and supplied context; otherwise identify the missing compatibility documentation. Do not infer anything about an image that was not supplied. Keep source quotations in structured citations unless quoting a short phrase is necessary to explain a real conflict. Put answered or insufficient_evidence only in the structured status field, never as answer prose.';
export function workspaceGenerationPromptIdentity(value: WorkspaceGenerationContract = WORKSPACE_GENERATION_CONTRACT) {
  const contract = workspaceGenerationContract(value), tool = contract === WORKSPACE_GENERATION_CONTRACT ? WORKSPACE_GENERATION_TOOL : WORKSPACE_SOURCE_CALIBRATION_TOOL;
  let systemInstructions = flatSourceIdAnswerPromptIdentity().systemInstructions.replaceAll('product_answer_source_ids_v3', tool);
  if (contract === WORKSPACE_SOURCE_CALIBRATION_CONTRACT) {
    systemInstructions = systemInstructions.replace('When that relationship is missing, return insufficient_evidence, state the supported facts, and ask for the specific missing model number or compatibility documentation.', 'When the exact requested relationship is not supported, return status insufficient_evidence and explain that specific gap without inventing a relationship.');
    systemInstructions += ` ${sourceCalibrationRules}`;
  }
  systemInstructions += ` Keep the answer at most ${WORKSPACE_ANSWER_CHARACTERS} characters.`;
  return Object.freeze({ contract, tool, systemInstructions, systemInstructionsSha256: hash(systemInstructions) });
}

/** Additive /ask contract. Historical flat v3, snippet and quote bodies are not edited. */
export function workspaceGenerationParts(raw: WorkspaceGenerationInput) {
  const prompt = workspaceGenerationPromptIdentity(raw.generationContract), input = structuredClone(raw);
  if (prompt.contract === WORKSPACE_GENERATION_CONTRACT) delete input.generationContract;
  if (!input.runId?.trim() || input.runId.length > 200 || input.passages.some(passage => passage.productId !== input.product.id || hash(passage.text) !== passage.sha256)) throw new Error('Workspace generation requires an exact operation and source snapshot.');
  const body = flatSourceIdAnswerRequestBody(input);
  const payload = { ...JSON.parse(body.messages[1]!.content), promptVersion: prompt.contract, operationRunId: input.runId,
    runtimePolicy: { id: input.policy.id, instructionSha256: hash(input.policy.instructions), mode: input.policy.mode === 'fixture' ? 'synthetic' : 'live' } };
  const systemInstructions = prompt.systemInstructions;
  const parameters = structuredClone(body.tools[0]!.function.parameters) as { properties: { answer: { maxLength: number } } };
  parameters.properties.answer.maxLength = WORKSPACE_ANSWER_CHARACTERS;
  const requestBody = { ...body, messages: [{ role: 'system', content: systemInstructions }, { role: 'user', content: JSON.stringify(payload) }],
    tools: [{ ...body.tools[0]!, function: { ...body.tools[0]!.function, name: prompt.tool, parameters } }], tool_choice: { type: 'function', function: { name: prompt.tool } } };
  if (requestBody.messages[1]!.content.length > 40_000) throw new Error('Workspace generation exceeds the bounded source context.');
  const scope: SourceCitationScope = { productId: input.product.id, question: input.question, evidence: payload.evidence };
  const binding = { contract: prompt.contract, executionMode: payload.runtimePolicy.mode as 'live' | 'synthetic', operationRunId: input.runId,
    policyId: input.policy.id, policySha256: payload.runtimePolicy.instructionSha256, requestSha256: hash(requestBody), systemInstructionsSha256: hash(systemInstructions),
    responseSchemaSha256: hash(parameters), optionSetSha256: hash(sourceCitationOptions(scope)), sourceContextSha256: hash({ question: input.question, product: payload.product, evidence: payload.evidence }) };
  return { input, body: requestBody, payload, parameters, systemInstructions, scope, binding, tool: prompt.tool };
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
    if (!receipt.id || receipt.kind !== parts.tool || receipt.status !== 'completed' || receipt.error_code || !receipt.receipt_json || parts.binding.executionMode !== mode || receipt.executionMode !== undefined && receipt.executionMode !== mode) throw new Error('receipt_state');
    const document = JSON.parse(receipt.receipt_json);
    if (document.promptVersion !== parts.binding.contract || document.mode !== mode || document.model !== receipt.model || (mode === 'synthetic' ? document.model !== 'synthetic-fixture' || document.accounting !== 'no_provider_call' : !['gpt-luna', 'gpt-5.6-luna'].includes(document.model) || document.accounting !== 'local_planning_allowance')) throw new Error('receipt_provenance');
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
