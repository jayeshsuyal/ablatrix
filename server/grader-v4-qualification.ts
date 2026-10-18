import { createHash } from 'node:crypto';
import { claimSupportRequestParts, type ClaimSupportInput } from './claim-support.ts';
import { CITED_APPLICABILITY_GRADER_VERSION, claimSupportV4ContractIdentity, validateClaimSupportV4Output, type ClaimSupportV4WireOutput } from './claim-support-v4.ts';

function canonical(value: unknown): unknown { return Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value; }
export const v4QualificationHash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
type Fingerprints = { caseSha256: string; sourcePacketSha256: string; familySha256s: string[] };
export type V4ExposureEntry = Fingerprints & { cohortId: string; status: 'reserved' | 'exposed' | 'consumed' };
export type V4ExposureLedger = { format: 'grader-v4-exposure-ledger-v1'; entries: V4ExposureEntry[]; ledgerSha256: string };
export type V4QualificationCase = { id: string; input: Omit<ClaimSupportInput, 'runId'>; productFamilyKeys: string[]; reference: { answerQuality: 'acceptable' | 'flawed'; output: ClaimSupportV4WireOutput; acceptableDispositions: ('pass' | 'repair' | 'abstain' | 'uncertain')[]; boundarySpanningAssertion: boolean; rationale: string; provenance: 'constructed_reference_pending_independent_review' } };
export const V4_QUALIFICATION_CODE_FILES = Object.freeze(['server/claim-support.ts', 'server/claim-support-v4.ts', 'server/runtime-grader.ts', 'server/grader-v4-qualification.ts', 'server/feedback-provider.ts', 'server/citation-options.ts']);
const digest = /^[a-f0-9]{64}$/;
export function v4ExposureLedger(entries: V4ExposureEntry[] = []): V4ExposureLedger {
  if (entries.some(entry => !entry.cohortId.trim() || !['reserved', 'exposed', 'consumed'].includes(entry.status) || !digest.test(entry.caseSha256) || !digest.test(entry.sourcePacketSha256) || !entry.familySha256s.length || entry.familySha256s.some(hash => !digest.test(hash)))) throw new Error('V4 exposure history requires exact case, source-packet and canonical family fingerprints.');
  const body = { format: 'grader-v4-exposure-ledger-v1' as const, entries: structuredClone(entries) }; return { ...body, ledgerSha256: v4QualificationHash(body) };
}
/** IDs, labels, cohort names and group assignments do not establish freshness.
 * Canonical family keys must come from independently reviewed alias history. */
export function v4ExposureFingerprints(input: Omit<ClaimSupportInput, 'runId'>, familyKeys: string[]): Fingerprints {
  if (!familyKeys.length || familyKeys.length > 10 || familyKeys.some(key => !key.trim() || key.length > 200)) throw new Error('Canonical related-product family keys are required.');
  const normalized = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  const packet = input.evidence.map(source => ({ text: source.text, originalQuestion: source.originalQuestion ?? null })).sort((a, b) => v4QualificationHash(a).localeCompare(v4QualificationHash(b)));
  const citationSources = new Map(input.evidence.map(source => [source.id, v4QualificationHash({ text: source.text, originalQuestion: source.originalQuestion ?? null })]));
  return { sourcePacketSha256: v4QualificationHash(packet), familySha256s: [...new Set(familyKeys.map(key => v4QualificationHash(normalized(key))))].sort(), caseSha256: v4QualificationHash({ question: input.question, answer: { status: input.answer.status, answer: input.answer.answer, citations: input.answer.citations.map(citation => ({ sourcePacketMember: citationSources.get(citation.passageId), quote: citation.quote })) }, packet, clarifications: input.clarifications ?? [] }) };
}
export function assertV4Freshness(fingerprints: Fingerprints, history: V4ExposureLedger) {
  if (JSON.stringify(history) !== JSON.stringify(v4ExposureLedger(history.entries))) throw new Error('V4 exposure history was altered.');
  if (history.entries.some(entry => entry.caseSha256 === fingerprints.caseSha256 || entry.sourcePacketSha256 === fingerprints.sourcePacketSha256 || entry.familySha256s.some(family => fingerprints.familySha256s.includes(family)))) throw new Error('V4 case, source packet or related product family is already reserved or exposed; renaming cannot establish freshness.');
}
export type V4QualificationPlan = {
  format: 'pending-grader-v4-qualification-plan-v1'; cohortId: string; implementationCommit: string; codeFileSha256: Record<string, string>; grader: ReturnType<typeof claimSupportV4ContractIdentity>;
  operatingScope: { maximumAnswerCharacters: 1500; maximumAnswerUnits: 3; coveredUnitCounts: number[]; includesScopeMaximum: true; includesBoundarySpanningAssertion: true; responsePreflight: 'canonical_utf8_byte_upper_bound' };
  exposureHistorySha256: string; sourceReview: 'pending_independent_source_and_family_alias_review'; qualificationStatus: 'pending'; liveQualified: false; productionActivationQualified: false; qualityClaimEligible: false;
  stoppingRules: { stopOnInvalidOrUnknown: true; stopOnFalseApprovalOrCriticalAxisMismatch: true; incompleteOrFailedRemainsUnqualified: true; repeatsAreNotIndependentProducts: true };
  proposedCalls: number; proposedAllowancePerCallUsd: 0.1; proposedAdditionalAllowanceUsd: number; paidExecutionApproved: false;
  cases: { id: string; fingerprints: Fingerprints; inputSha256: string; referenceSha256: string; input: Omit<ClaimSupportInput, 'runId'>; reference: V4QualificationCase['reference'] }[];
  slots: { index: number; role: 'primary' | 'repeat'; caseId: string; runId: string; requestSha256: string; responseSchemaSha256: string }[]; planSha256: string;
};
/** A prospective plan only. No cohort is generated/read here, no references are
 * sent to a model, and no plan, self-hash or offline result grants qualification. */
export function prepareV4QualificationPlan(options: { cohortId: string; cases: V4QualificationCase[]; exposureHistory: V4ExposureLedger; implementationCommit: string; codeFileSha256: Record<string, string> }) {
  if (!options.cohortId.trim() || options.cases.length < 12 || options.cases.length > 97 || new Set(options.cases.map(item => item.id)).size !== options.cases.length || !/^[a-f0-9]{40}$/.test(options.implementationCommit) || Object.keys(options.codeFileSha256).length !== V4_QUALIFICATION_CODE_FILES.length || V4_QUALIFICATION_CODE_FILES.some(path => !digest.test(options.codeFileSha256[path] ?? ''))) throw new Error('V4 requires a bounded new cohort, exact implementation and code manifest.');
  const familyHashes = new Set<string>(), packetHashes = new Set<string>(), caseHashes = new Set<string>(), counts = new Set<number>(), qualityScope = new Set<string>(); let maximum = false, boundary = false;
  const cases = options.cases.map(item => {
    if (item.input.graderVersion !== CITED_APPLICABILITY_GRADER_VERSION || item.reference.provenance !== 'constructed_reference_pending_independent_review' || !item.reference.rationale.trim() || !item.reference.acceptableDispositions.length) throw new Error('V4 cases require frozen new-contract references awaiting independent review.');
    const parts = claimSupportRequestParts({ ...item.input, runId: 'offline-v4-plan-validation' });
    const assessment = validateClaimSupportV4Output({ ...item.input, runId: 'offline-v4-plan-validation' }, item.reference.output, parts as Parameters<typeof validateClaimSupportV4Output>[2], 'synthetic_scripted_claim_support');
    if (!item.reference.acceptableDispositions.includes(assessment.disposition) || !['acceptable', 'flawed'].includes(item.reference.answerQuality) || (item.reference.answerQuality === 'flawed' ? item.reference.acceptableDispositions.includes('pass') : !['pass', 'abstain'].includes(assessment.disposition))) throw new Error('V4 reference output does not produce its frozen acceptable/flawed disposition.');
    const fingerprints = v4ExposureFingerprints(item.input, item.productFamilyKeys); assertV4Freshness(fingerprints, options.exposureHistory);
    if (caseHashes.has(fingerprints.caseSha256) || packetHashes.has(fingerprints.sourcePacketSha256) || fingerprints.familySha256s.some(hash => familyHashes.has(hash))) throw new Error('V4 primary cases require distinct products, related families and source packets.');
    caseHashes.add(fingerprints.caseSha256); packetHashes.add(fingerprints.sourcePacketSha256); fingerprints.familySha256s.forEach(hash => familyHashes.add(hash)); counts.add(parts.units.length); qualityScope.add(`${parts.units.length}:${item.reference.answerQuality}`);
    maximum ||= item.input.answer.answer.length === 1500; boundary ||= item.reference.boundarySpanningAssertion && parts.units.length > 1;
    return { id: item.id, fingerprints, inputSha256: v4QualificationHash(item.input), referenceSha256: v4QualificationHash(item.reference), input: structuredClone(item.input), reference: structuredClone(item.reference) };
  });
  if (![1, 2, 3].every(count => counts.has(count) && ['acceptable', 'flawed'].every(quality => qualityScope.has(`${count}:${quality}`))) || !maximum || !boundary) throw new Error('V4 qualification must cover acceptable and flawed one, two and three unit answers, the 1500-character maximum and a boundary-spanning assertion.');
  const seed = v4QualificationHash({ cases, exposure: options.exposureHistory.ledgerSha256, implementation: options.implementationCommit, code: options.codeFileSha256 }), sorted = [...cases].sort((a, b) => v4QualificationHash([seed, a.id]).localeCompare(v4QualificationHash([seed, b.id])));
  const repeated = [1, 2, 3].map(count => sorted.find(item => claimSupportRequestParts({ ...item.input, runId: 'offline-scope-count' }).units.length === count)!);
  const slots = [...sorted, ...repeated].map((item, index) => { const runId = `qualification-v4-${v4QualificationHash([seed, item.id, index]).slice(0, 40)}`, parts = claimSupportRequestParts({ ...item.input, runId }); return { index, role: index < cases.length ? 'primary' as const : 'repeat' as const, caseId: item.id, runId, requestSha256: parts.bindings.requestSha256, responseSchemaSha256: parts.bindings.responseSchemaSha256 }; });
  const body: Omit<V4QualificationPlan, 'planSha256'> = { format: 'pending-grader-v4-qualification-plan-v1', cohortId: options.cohortId, implementationCommit: options.implementationCommit, codeFileSha256: structuredClone(options.codeFileSha256), grader: claimSupportV4ContractIdentity(), operatingScope: { maximumAnswerCharacters: 1500, maximumAnswerUnits: 3, coveredUnitCounts: [...counts].sort(), includesScopeMaximum: true, includesBoundarySpanningAssertion: true, responsePreflight: 'canonical_utf8_byte_upper_bound' }, exposureHistorySha256: options.exposureHistory.ledgerSha256, sourceReview: 'pending_independent_source_and_family_alias_review', qualificationStatus: 'pending', liveQualified: false, productionActivationQualified: false, qualityClaimEligible: false, stoppingRules: { stopOnInvalidOrUnknown: true, stopOnFalseApprovalOrCriticalAxisMismatch: true, incompleteOrFailedRemainsUnqualified: true, repeatsAreNotIndependentProducts: true }, proposedCalls: slots.length, proposedAllowancePerCallUsd: 0.1, proposedAdditionalAllowanceUsd: Number((slots.length * 0.1).toFixed(6)), paidExecutionApproved: false, cases, slots };
  const plan = { ...body, planSha256: v4QualificationHash(body) }, exposureHistory = v4ExposureLedger([...options.exposureHistory.entries, ...cases.map(item => ({ cohortId: options.cohortId, ...item.fingerprints, status: 'reserved' as const }))]);
  return { plan, exposureHistory };
}
export function verifyV4QualificationPlan(plan: V4QualificationPlan, options: Parameters<typeof prepareV4QualificationPlan>[0]) {
  const expected = prepareV4QualificationPlan(options).plan;
  if (v4QualificationHash(plan) !== v4QualificationHash(expected)) throw new Error('V4 qualification plan differs from frozen cases, references, exposure history, scope, code or stopping rules.');
  return expected;
}
