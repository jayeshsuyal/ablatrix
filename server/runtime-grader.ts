import { createHash } from 'node:crypto';
import { claimSupportPromptIdentity, type ClaimSupportVersion } from './claim-support.ts';
import { CITED_APPLICABILITY_GRADER_VERSION, claimSupportV4ContractIdentity, CLAIM_SUPPORT_V4_SCOPE } from './claim-support-v4.ts';
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type RuntimeGraderBinding = {
  format: 'runtime-grader-binding-v1'; version: ClaimSupportVersion; mode: 'live' | 'synthetic'; systemInstructionsSha256: string; responseSchemaFamilySha256: string;
  requestedModel: 'gpt-luna'; acceptedResponseModels: ['gpt-luna', 'gpt-5.6-luna']; scope: { maxAnswerCharacters: number; maxAnswerUnits: number; maxSourceCharacters: number; maxTotalSourceCharacters: number }; scopeSha256: string;
  qualification: { status: 'legacy_unqualified' | 'pending_independent_qualification' | 'synthetic_mechanics_only'; evidenceId: string | null; evidenceSha256: string | null; liveQualified: false };
  bindingSha256: string;
};
/** New runtime contracts are explicit. This constructor cannot turn a supplied
 * JSON document or a synthetic rehearsal into verified live qualification. */
export function createRuntimeGraderBinding(mode: 'live' | 'synthetic', version: ClaimSupportVersion = 'claim-support-v1'): RuntimeGraderBinding {
  if (!['live', 'synthetic'].includes(mode)) throw new Error('Runtime grader mode is invalid.');
  const identity = claimSupportPromptIdentity(version), v4 = version === CITED_APPLICABILITY_GRADER_VERSION ? claimSupportV4ContractIdentity() : null;
  const scope = v4 ? { maxAnswerCharacters: CLAIM_SUPPORT_V4_SCOPE.maxAnswerCharacters, maxAnswerUnits: CLAIM_SUPPORT_V4_SCOPE.maxAnswerUnits, maxSourceCharacters: CLAIM_SUPPORT_V4_SCOPE.maxSourceCharacters, maxTotalSourceCharacters: CLAIM_SUPPORT_V4_SCOPE.maxTotalSourceCharacters } : { maxAnswerCharacters: 10000, maxAnswerUnits: 20, maxSourceCharacters: 3000, maxTotalSourceCharacters: 12000 };
  const body: Omit<RuntimeGraderBinding, 'bindingSha256'> = { format: 'runtime-grader-binding-v1', version, mode, systemInstructionsSha256: identity.systemInstructionsSha256, responseSchemaFamilySha256: v4?.responseSchemaFamilySha256 ?? sha({ version, contract: 'legacy_claim_support_v1_wire', unitCharacters: 500 }), requestedModel: 'gpt-luna', acceptedResponseModels: ['gpt-luna', 'gpt-5.6-luna'], scope, scopeSha256: sha(scope),
    qualification: v4 ? mode === 'synthetic' ? { status: 'synthetic_mechanics_only', evidenceId: 'synthetic-v4-contract-mechanics-only', evidenceSha256: sha({ version, identity: v4, mode }), liveQualified: false } : { status: 'pending_independent_qualification', evidenceId: null, evidenceSha256: null, liveQualified: false } : { status: 'legacy_unqualified', evidenceId: null, evidenceSha256: null, liveQualified: false } };
  return { ...body, bindingSha256: sha(body) };
}
export function validateRuntimeGraderBinding(binding: RuntimeGraderBinding): RuntimeGraderBinding {
  const expected = createRuntimeGraderBinding(binding.mode, binding.version);
  if (JSON.stringify(binding) !== JSON.stringify(expected)) throw new Error('Runtime grader version, prompt, schema, model, scope or qualification binding is altered or incompatible.');
  return structuredClone(expected);
}
export function runtimeGraderReadiness(binding: RuntimeGraderBinding) {
  validateRuntimeGraderBinding(binding);
  return binding.mode === 'live' && binding.version === CITED_APPLICABILITY_GRADER_VERSION ? { ready: false, reason: 'V4 live runtime checks are closed: independent qualification for this exact prompt, schema, model and 1500-character scope is pending.' } : { ready: true, reason: binding.mode === 'synthetic' ? 'Synthetic grader mechanics only; no live qualification or quality claim.' : 'Explicit historical unqualified grader contract; no verified quality claim.' };
}
