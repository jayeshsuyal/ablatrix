import { createHash } from 'node:crypto';
import { claimSupportPromptIdentity, claimSupportRequestParts, validateClaimSupportOutput, COVERAGE_CONFIDENCE_GRADER_VERSION, type ClaimSupportInput, type ClaimSupportWireOutput, type ValidatedClaimSupportAssessment } from './claim-support.ts';
import { qualificationFixtureDataset, type QualificationFixtureDataset, type QualificationReference } from './grader-qualification-fixtures.ts';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export const qualificationHash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex');
const equal = (a: unknown, b: unknown) => qualificationHash(a) === qualificationHash(b);
const digest = /^[a-f0-9]{64}$/;
const pinnedSystemSha256 = 'ffae52c2c183f909047f1867a73a505440b1ee22fe8b5db2d9e4a591a86e0067';
const repeatCategories = Object.freeze(['conditional_exceptions', 'temporal_updates', 'comparisons', 'source_instructions', 'wrong_model_context', 'citation_semantics', 'partial_coverage', 'unnecessary_refusal']);
export const QUALIFICATION_CODE_FILES = Object.freeze(['server/grader-qualification.ts', 'server/grader-qualification-fixtures.ts', 'scripts/grader-qualification.ts', 'server/claim-support.ts', 'server/citation-options.ts', 'server/source-id-diagnostic.ts', 'package.json', 'package-lock.json']);
export const QUALIFICATION_CRITERIA = Object.freeze({ primaryCases: 80, flawedCases: 60, acceptableCases: 20, repeatChecks: 12, allSlotsValid: true, flawedRawPassesAllowed: 0, allCriticalAxesMatch: true, acceptableDispositionMatchesRequired: 20, minimumPrimaryFullAxisMatches: 76, allRepeatAxesAndDispositionsStable: true, interpretation: 'engineering_gate_for_future_scoped_shadow_evaluation_only' });
export const QUALIFICATION_PROPOSED_BUDGET = Object.freeze({ newGradingCalls: 92, allowancePerCallUsd: 0.1, maxAddedPlanningAllowanceUsd: 9.2, approved: false, accounting: 'local_planning_allowances_not_settled_charges' });
type Axis = 'support' | 'questionCoverage' | 'answerability' | 'correctness' | 'uncertaintyHandling';
type GraderBody = ReturnType<typeof claimSupportRequestParts>['body'];
export type QualificationRequest = { slotId: string; caseId: string; runId: string; input: ClaimSupportInput; requestBody: GraderBody; requestSha256: string; responseSchemaSha256: string; systemInstructionsSha256: string; answerSha256: string; sourceContextSha256: string };
export type QualificationPlan = {
  format: 'sealed-grader-qualification-plan-v1'; createdAt: string; implementationCommit: string; codeFileSha256: Record<string, string>;
  datasetSha256: string; referencesSha256: string; requestsSha256: string; criteria: typeof QUALIFICATION_CRITERIA; proposedBudget: typeof QUALIFICATION_PROPOSED_BUDGET;
  grader: { version: typeof COVERAGE_CONFIDENCE_GRADER_VERSION; systemInstructionsSha256: string; requestedModel: 'gpt-luna'; acceptedResponseModels: ['gpt-luna', 'gpt-5.6-luna']; maxTokens: 4096; reasoningEffort: 'none' };
  categories: QualificationFixtureDataset['categoryCounts'];
  operatingScope: { caseConstruction: 'ai_authored_fictional_packets'; answerUnits: 1; sourceConflictControls: 2; exclusions: string[]; freshnessHistory: 'author_attestation_not_independently_authenticated' };
  slots: { index: number; slotId: string; caseId: string; role: 'primary' | 'repeat'; primarySlotId: string; productFamilyId: string; category: string; requestSha256: string }[];
  review: { status: 'pending_independent_source_review'; authorship: 'ai_authored_constructed_reference'; humanGold: false; externalTruthVerified: false; reviewIdentityVerified: false };
  futureExecution: { status: 'not_implemented_in_this_offline_contract'; approved: false; trustedLiveVerifierRequired: true };
  productionActivationQualified: false; qualityClaimEligible: false; planSha256: string;
};
export type QualificationRecord = {
  format: 'grader-qualification-record-v1'; planSha256: string; datasetSha256: string; referencesSha256: string; implementationCommit: string; grader: QualificationPlan['grader'];
  status: 'pending_live_evidence'; qualified: false; scope: 'none'; liveEvidence: null; sourceReview: QualificationPlan['review'];
  blockers: string[]; productionActivationQualified: false; qualityClaimEligible: false; recordSha256: string;
};
export type QualificationBundle = { plan: QualificationPlan; requests: QualificationRequest[]; references: { provenance: QualificationFixtureDataset['provenance']; freshness: QualificationFixtureDataset['freshness']; items: QualificationReference[] }; record: QualificationRecord };
export type QualificationSealOptions = { implementationCommit: string; codeFileSha256: Record<string, string>; createdAt: string; dataset?: QualificationFixtureDataset };

function validatedDataset(data: QualificationFixtureDataset) {
  if (data.format !== 'constructed-grader-qualification-v1' || data.cases.length !== 80 || data.references.length !== 80 || new Set(data.cases.map(c => c.id)).size !== 80 || new Set(data.references.map(r => r.caseId)).size !== 80 || new Set(data.cases.map(c => c.productFamilyId)).size !== 80 || new Set(data.cases.map(c => c.input.product.id)).size !== 80) throw new Error('Qualification requires 80 unique source/product-family packets and references.');
  if (data.provenance.authorship !== 'ai_authored_constructed_reference' || data.provenance.reviewStatus !== 'pending_independent_source_review' || data.provenance.humanGold !== false || data.provenance.externalTruthVerified !== false) throw new Error('Constructed provenance cannot certify human gold or completed review.');
  const refs = data.references;
  if (refs.filter(r => r.answerQuality === 'flawed').length !== 60 || refs.filter(r => r.answerQuality === 'acceptable').length !== 20 || refs.filter(r => r.acceptableKind === 'factual').length !== 12 || refs.filter(r => r.acceptableKind === 'qualified').length !== 4 || refs.filter(r => r.acceptableKind === 'refusal').length !== 4) throw new Error('Qualification balance must remain 60 flawed, 12 factual, four qualified and four refusal controls.');
  const counts: Record<string, number> = {};
  for (const item of data.cases) {
    const ref = refs.find(r => r.caseId === item.id);
    const parts = claimSupportRequestParts({ runId: `qualification-validate-${item.id.slice(0, 32)}`, ...item.input });
    if (item.id !== createHash('sha256').update(JSON.stringify(item.input)).digest('hex') || !digest.test(item.productFamilyId) || item.input.graderVersion !== COVERAGE_CONFIDENCE_GRADER_VERSION || parts.units.length !== 1 || !item.category.trim() || !ref || !ref.rationale.trim() || !equal([...ref.criticalAxes].sort(), ['questionCoverage', 'support', 'uncertaintyHandling'])) throw new Error('Qualification case identity, version, reference or critical axes are invalid.');
    if (ref.answerQuality === 'flawed' && (ref.acceptableKind !== undefined || ref.acceptableDispositions.includes('pass')) || ref.answerQuality === 'acceptable' && (ref.acceptableKind === undefined || ref.acceptableDispositions.length !== 1 || ref.acceptableDispositions[0] !== (ref.acceptableKind === 'refusal' ? 'abstain' : 'pass'))) throw new Error('Qualification references cannot relabel flawed approvals or acceptable controls.');
    for (const key of ['support', 'questionCoverage', 'answerability', 'correctness', 'uncertaintyHandling'] as const) if (!Array.isArray(ref.axes[key]) || !ref.axes[key].length || new Set(ref.axes[key]).size !== ref.axes[key].length) throw new Error('Each frozen reference axis requires explicit distinct permitted labels.');
    if (!ref.spans.length || ref.spans.some(s => !s.quote.trim() || !item.input.evidence.some(e => e.id === s.sourceId && e.text.includes(s.quote)))) throw new Error('Reference proofs must quote literal frozen source bodies.');
    counts[item.category] = (counts[item.category] ?? 0) + 1;
    // Validate every declared reference label through the real proof/schema contract.
    const scripted = scriptedReferenceOutput({ ...item.input, runId: 'reference-contract' }, ref);
    const validated = validateClaimSupportOutput({ ...item.input, runId: 'reference-contract' }, scripted, 'synthetic_scripted_claim_support');
    if (!ref.acceptableDispositions.includes(validated.disposition)) throw new Error('Reference labels cannot produce the declared routing disposition.');
  }
  if (Object.keys(counts).length < 10 || !equal(counts, data.categoryCounts)) throw new Error('Qualification category inventory must match its frozen cases.');
  return structuredClone(data);
}

/** Frozen references are used ONLY by offline scripted mechanics, never by requests. */
function scriptedReferenceOutput(input: ClaimSupportInput, ref: QualificationReference): ClaimSupportWireOutput {
  const parts = claimSupportRequestParts(input), verdict = ref.axes.support[0];
  const proof = verdict === 'supported' ? input.answer.citations[0] : ref.spans[0] && { passageId: ref.spans[0].sourceId, quote: ref.spans[0].quote };
  return { units: parts.units.map(u => ({ unitId: u.id, verdict, evidence: verdict === 'supported' || verdict === 'contradicted' ? [{ sourceId: proof.passageId, quote: proof.quote, relation: verdict === 'supported' ? 'supports' : 'contradicts' }] : [], reason: 'SYNTHETIC reference-scripted mechanics; no model judgment.' })), questionCoverage: ref.axes.questionCoverage[0], answerability: ref.axes.answerability[0], correctness: ref.axes.correctness[0], uncertaintyHandling: ref.axes.uncertaintyHandling[0], reason: 'SYNTHETIC reference-scripted mechanics; this does not measure grader accuracy.' };
}

export function pendingQualificationRecord(plan: QualificationPlan): QualificationRecord {
  const body = { format: 'grader-qualification-record-v1' as const, planSha256: plan.planSha256, datasetSha256: plan.datasetSha256, referencesSha256: plan.referencesSha256, implementationCommit: plan.implementationCommit, grader: structuredClone(plan.grader), status: 'pending_live_evidence' as const, qualified: false as const, scope: 'none' as const, liveEvidence: null, sourceReview: structuredClone(plan.review), blockers: ['No trusted live execution verifier or real execution evidence is attached.', 'Independent source review is pending; review assertions are not authenticated human gold.', 'The new paid scope is unapproved; offline preparation grants no dispatch authority.', 'Candidate answer-policy validation and activation are separate, unimplemented gates.'], productionActivationQualified: false as const, qualityClaimEligible: false as const };
  return { ...body, recordSha256: qualificationHash(body) };
}

/** Pure offline sealing. No transport, credential, provider or ledger capability. */
export function sealQualification(options: QualificationSealOptions): QualificationBundle {
  const data = validatedDataset(options.dataset ?? qualificationFixtureDataset());
  if (!/^[a-f0-9]{40}$/.test(options.implementationCommit) || !Number.isFinite(Date.parse(options.createdAt)) || new Date(options.createdAt).toISOString() !== options.createdAt || Object.keys(options.codeFileSha256).length !== QUALIFICATION_CODE_FILES.length || QUALIFICATION_CODE_FILES.some(p => !digest.test(options.codeFileSha256[p] ?? ''))) throw new Error('Qualification needs the exact code manifest, commit and timestamp.');
  const prompt = claimSupportPromptIdentity(COVERAGE_CONFIDENCE_GRADER_VERSION);
  if (prompt.systemInstructionsSha256 !== pinnedSystemSha256) throw new Error('V3 changed after benchmark design; this qualification contract is consumed.');
  const references = { provenance: structuredClone(data.provenance), freshness: structuredClone(data.freshness), items: structuredClone(data.references) };
  const seed = qualificationHash({ data, code: options.codeFileSha256, commit: options.implementationCommit, createdAt: options.createdAt, criteria: QUALIFICATION_CRITERIA });
  const sorted = [...data.cases].sort((a, b) => qualificationHash([seed, a.id]).localeCompare(qualificationHash([seed, b.id])));
  const byKind = (kind: string) => sorted.filter(c => data.references.find(r => r.caseId === c.id)?.acceptableKind === kind);
  const bad = sorted.filter(c => data.references.find(r => r.caseId === c.id)?.answerQuality === 'flawed');
  const selected: typeof sorted = [];
  for (const category of repeatCategories) { const anchor = bad.find(c => c.category === category); if (!anchor) throw new Error('A required repeat category has no flawed anchor.'); selected.push(anchor); }
  selected.push(...byKind('factual').slice(0, 2), byKind('qualified')[0], byKind('refusal')[0]);
  if (selected.length !== 12 || new Set(selected.map(c => c.id)).size !== 12) throw new Error('Repeat plan requires eight flawed and four acceptable distinct anchors.');
  const requests: QualificationRequest[] = [], primaryIds = new Map<string, string>();
  const slots = [...sorted, ...selected].map((item, index) => {
    const role = index < 80 ? 'primary' as const : 'repeat' as const, slotId = qualificationHash([seed, item.id, role, index]);
    const runId = `qualification-v3-${slotId.slice(0, 40)}`;
    // Only normal source/question/answer inputs cross the grader boundary.
    const initial = claimSupportRequestParts({ ...item.input, runId });
    const input: ClaimSupportInput = { runId, graderVersion: COVERAGE_CONFIDENCE_GRADER_VERSION, ...structuredClone(initial.normalized) };
    const parts = claimSupportRequestParts(input);
    requests.push({ slotId, caseId: item.id, runId, input, requestBody: parts.body, ...parts.bindings });
    if (role === 'primary') primaryIds.set(item.id, slotId);
    return { index, slotId, caseId: item.id, role, primarySlotId: primaryIds.get(item.id)!, productFamilyId: item.productFamilyId, category: item.category, requestSha256: parts.bindings.requestSha256 };
  });
  const body: Omit<QualificationPlan, 'planSha256'> = { format: 'sealed-grader-qualification-plan-v1', createdAt: options.createdAt, implementationCommit: options.implementationCommit, codeFileSha256: structuredClone(options.codeFileSha256), datasetSha256: qualificationHash(data), referencesSha256: qualificationHash(references), requestsSha256: qualificationHash(requests), criteria: { ...QUALIFICATION_CRITERIA }, proposedBudget: { ...QUALIFICATION_PROPOSED_BUDGET }, grader: { version: COVERAGE_CONFIDENCE_GRADER_VERSION, systemInstructionsSha256: prompt.systemInstructionsSha256, requestedModel: 'gpt-luna', acceptedResponseModels: ['gpt-luna', 'gpt-5.6-luna'], maxTokens: 4096, reasoningEffort: 'none' }, categories: structuredClone(data.categoryCounts), operatingScope: { caseConstruction: 'ai_authored_fictional_packets', answerUnits: 1, sourceConflictControls: 2, exclusions: ['multi_unit_long_answers', 'production_domain_error_rate', 'retrieval_and_generation_quality', 'answer_policy_improvement_or_activation', 'upstream_model_weight_identity'], freshnessHistory: 'author_attestation_not_independently_authenticated' }, slots, review: { status: 'pending_independent_source_review', authorship: 'ai_authored_constructed_reference', humanGold: false, externalTruthVerified: false, reviewIdentityVerified: false }, futureExecution: { status: 'not_implemented_in_this_offline_contract', approved: false, trustedLiveVerifierRequired: true }, productionActivationQualified: false, qualityClaimEligible: false };
  const plan = { ...body, planSha256: qualificationHash(body) };
  return { plan, requests, references, record: pendingQualificationRecord(plan) };
}

/** Reconstruct against trusted current fixtures/code, not editable self hashes. */
export function verifyQualification(bundle: QualificationBundle, options: Omit<QualificationSealOptions, 'createdAt' | 'dataset'>): QualificationBundle {
  const expected = sealQualification({ ...options, createdAt: bundle.plan.createdAt });
  if (!equal(bundle, expected)) throw new Error('Sealed qualification differs from current committed code, frozen cases, requests, references, schedule, criteria or pending record.');
  return expected;
}

type Match = Record<Axis | 'disposition', boolean> & { all: boolean; critical: boolean };
function agreement(assessment: ValidatedClaimSupportAssessment, ref: QualificationReference): Match {
  const axes = { support: assessment.units.every(u => ref.axes.support.includes(u.verdict)), questionCoverage: ref.axes.questionCoverage.includes(assessment.questionCoverage), answerability: ref.axes.answerability.includes(assessment.answerability), correctness: ref.axes.correctness.includes(assessment.correctness), uncertaintyHandling: ref.axes.uncertaintyHandling.includes(assessment.uncertaintyHandling), disposition: ref.acceptableDispositions.includes(assessment.disposition) };
  return { ...axes, all: Object.values(axes).every(Boolean), critical: ref.criticalAxes.every(a => axes[a]) };
}
function axisVector(a: ValidatedClaimSupportAssessment) { return { support: a.units.map(u => u.verdict), questionCoverage: a.questionCoverage, answerability: a.answerability, correctness: a.correctness, uncertaintyHandling: a.uncertaintyHandling, disposition: a.disposition }; }
export type QualificationRehearsal = ReturnType<typeof rehearseQualification>;
/** Even caller-supplied real-looking grades remain OFFLINE mechanics. No live certificate path. */
export function rehearseQualification(bundle: QualificationBundle, options: Omit<QualificationSealOptions, 'createdAt' | 'dataset'>, scripted?: { slotId: string; output: unknown }[]) {
  verifyQualification(bundle, options);
  if (scripted && (new Set(scripted.map(x => x.slotId)).size !== scripted.length || scripted.some(x => !bundle.plan.slots.some(s => s.slotId === x.slotId)))) throw new Error('Scripted observations require distinct known slot identities.');
  const observations = scripted ?? bundle.requests.map(request => ({ slotId: request.slotId, output: scriptedReferenceOutput(request.input, bundle.references.items.find(r => r.caseId === request.caseId)!) }));
  const slots = bundle.plan.slots.map(slot => {
    const observation = observations.find(o => o.slotId === slot.slotId), request = bundle.requests[slot.index], ref = bundle.references.items.find(r => r.caseId === slot.caseId)!;
    let assessment: ValidatedClaimSupportAssessment | null = null, error: string | null = null;
    if (observation) { try { assessment = validateClaimSupportOutput(request.input, observation.output, 'synthetic_scripted_claim_support'); } catch { error = 'Scripted grade failed strict schema, unit or literal-proof validation.'; } }
    return { index: slot.index, slotId: slot.slotId, role: slot.role, caseId: slot.caseId, status: !observation ? 'unattempted' as const : assessment ? 'valid' as const : 'invalid' as const, assessment, agreement: assessment ? agreement(assessment, ref) : null, error };
  });
  const primary = slots.slice(0, 80), repeats = slots.slice(80);
  const getRef = (caseId: string) => bundle.references.items.find(r => r.caseId === caseId)!;
  const flawed = primary.filter(s => getRef(s.caseId).answerQuality === 'flawed'), acceptable = primary.filter(s => getRef(s.caseId).answerQuality === 'acceptable');
  const repeatResults = repeats.map(s => { const p = primary.find(p => p.caseId === s.caseId)!; return { slotId: s.slotId, primarySlotId: p.slotId, stable: Boolean(s.assessment && p.assessment && equal(axisVector(s.assessment), axisVector(p.assessment))) }; });
  const metrics = { primary: { planned: 80, valid: primary.filter(s => s.status === 'valid').length, fullAxisMatches: primary.filter(s => s.agreement?.all).length, criticalAxisMatches: primary.filter(s => s.agreement?.critical).length, flawed: { denominator: 60, rawPasses: flawed.filter(s => s.assessment?.disposition === 'pass').length }, acceptable: { denominator: 20, dispositionMatches: acceptable.filter(s => s.agreement?.disposition).length }, invalid: primary.filter(s => s.status === 'invalid').length, unattempted: primary.filter(s => s.status === 'unattempted').length }, repeats: { planned: 12, valid: repeats.filter(s => s.status === 'valid').length, stable: repeatResults.filter(s => s.stable).length, results: repeatResults }, categories: Object.fromEntries(Object.keys(bundle.plan.categories).sort().map(category => { const cases = primary.filter(s => bundle.plan.slots[s.index].category === category); return [category, { planned: cases.length, valid: cases.filter(s => s.status === 'valid').length, fullAxisMatches: cases.filter(s => s.agreement?.all).length }]; })) };
  const criteria = bundle.plan.criteria;
  const gates = { allSlotsValid: slots.every(s => s.status === 'valid'), zeroFlawedPasses: metrics.primary.flawed.rawPasses === 0, allCriticalAxesMatch: metrics.primary.criticalAxisMatches === 80, acceptableDispositionMatches: metrics.primary.acceptable.dispositionMatches === criteria.acceptableDispositionMatchesRequired, primaryFullAxisThreshold: metrics.primary.fullAxisMatches >= criteria.minimumPrimaryFullAxisMatches, repeatsStable: metrics.repeats.stable === 12 };
  const body = { format: 'grader-qualification-mechanics-rehearsal-v1', planSha256: bundle.plan.planSha256, executionProvenance: 'offline_reference_scripted_mechanics_only', liveProviderCalls: 0, qualified: false, productionActivationQualified: false, qualityClaimEligible: false, humanGold: false, engineeringGateMechanics: Object.values(gates).every(Boolean) ? 'passed' : 'failed', gates, metrics, slots, qualificationRecord: pendingQualificationRecord(bundle.plan), limitations: ['Reference-scripted outputs exercise the evaluator and do not test the model.', 'Primary cases and repeats have separate denominators; no statistical production error bound is claimed.', 'Self hashes establish byte consistency, not independent authorship, authenticated review or live provider execution.', 'A future trusted live execution verifier and separately approved financial scope are required; this rehearsal cannot qualify or activate v3.'] };
  return { ...body, rehearsalSha256: qualificationHash(body) };
}
