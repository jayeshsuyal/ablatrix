/** Prospective Amazon-PQA preparation. Offline source mechanics, never paid dispatch. */
import assert from 'node:assert/strict';
import { textHash, validateProductCorpus } from './product-corpus.ts';
import { freshSeal } from './fresh-validation-v2.ts';
import { semanticSupplementContextV5 } from './semantic-supplement-v5.ts';
import { semanticSupplementContextV6 } from './semantic-supplement-v6.ts';
import { workspaceCompleteSourceContext, workspaceSourceChunks } from './workspace-retrieval-context.ts';
import { WORKSPACE_UNCERTAINTY_CONTRACT } from './workspace-uncertainty-policy.ts';
import type { ProductCorpus, RetrievalResult, RetrievedPassage } from './loop-types.ts';
import type { RetrievalStageTrace } from './product-retrieval.ts';
import type { PairScorer } from './semantic-reranker.ts';
import { replaySavedStages } from './retrieval-diagnosis-replay.ts';
import { validateAmazonPqaSourcePinV1, AmazonPqaParseError, type AmazonPqaSourcePin } from './amazon-pqa-source-v1.ts';
import { EMBEDDING_MODEL, EMBEDDING_REVISION } from './product-retrieval.ts';
import { SEMANTIC_RERANKER, RERANKER_FILES } from './semantic-reranker.ts';

export type AmazonPqaArtifact<T = unknown> = { path: string; fileSha256: string; document: T };
export type AmazonPqaProtocol = {
  format: 'ablatrix-amazon-pqa-protocol-v1'; purpose: 'exploratory_ai_only'; dataset: 'Amazon-PQA'; publisherSplit: 'unpartitioned_release'; use: 'prospective_exploratory_validation';
  sourceOrder: 'ascending_release_row'; maxInspectedRecords: number; targetPackets: number; selectedProducts: number; repeats: number;
  maxParents: number; maxBodyUtf16Units: number; maxQuestionUtf16Units: number; maxTitleUtf16Units: number;
  control: 'workspace-semantic-supplement-v5-dev'; candidate: 'workspace-semantic-supplement-v6-quantified-peer-dev';
  generationContract: typeof WORKSPACE_UNCERTAINTY_CONTRACT; targetAnswersInRetrieval: false; replacementAfterScreening: false;
  model: string; policyInstructions: string; expectedHistoryArtifactSha256: string[]; localModelAssetSha256: Record<string, string>;
};
export type AmazonPqaFreeze = {
  format: 'ablatrix-amazon-pqa-freeze-v1'; protocol: AmazonPqaArtifact<AmazonPqaProtocol>; sourcePin: AmazonPqaArtifact;
  history: AmazonPqaArtifact; historicalInputs: AmazonPqaArtifact[]; implementationSha256: Record<string, string>;
  sourceBodiesInspected: false; candidateContextInspected: false; providerCalls: 0; humanSourceCheckedAnswers: 0;
  qualityClaimEligible: false; activationAuthorized: false; paidExecutionAuthorized: false; sha256: string;
};
export const AMAZON_PQA_ACCESS_CHECKS = ['declared_release_partition', 'target_answer_exclusion', 'source_pin_integrity', 'historical_exclusion', 'finite_bounds'] as const;
type Decision = 'eligible' | 'reject' | 'uncertain';
type Evidence = { artifactSha256: string; quote: string };
export type AmazonPqaAccessReview = {
  format: 'ablatrix-amazon-pqa-source-access-review-v1'; freezeSha256: string; reviewer: string;
  provenance: 'independent_source_review_ai'; role: 'independent' | 'adjudicator'; independentReviewFileSha256: string[];
  candidateContextInspected: false; answerOutputsInspected: false;
  providerCalls: 0; humanSourceCheckedAnswers: 0; qualityClaimEligible: false; activationAuthorized: false; paidPlan: null;
  checks: { id: typeof AMAZON_PQA_ACCESS_CHECKS[number]; decision: Decision; rationale: string; evidence: Evidence[];
    independentAssessmentSha256: string[]; disagreementResolution: 'independent' | 'agree' | 'source_resolved' | 'unresolved' }[];
};
export type AmazonPqaPacket = { id: string; product: { id: string; title: string }; question: string;
  sources: { id: string; label: string; text: string; originalQuestion: string | null; reference: string; sha256: string }[]; sourcePoolSha256: string };
export type AmazonPqaScreening = {
  format: string; decisions: { caseId: string; productId?: string; row?: number; eligible: boolean; reasons: string[]; packet?: AmazonPqaPacket | null }[];
  [key: string]: unknown;
};
export type AmazonPqaEligibilityReview = {
  format: 'ablatrix-amazon-pqa-source-eligibility-review-v1'; freezeSha256: string; screeningFileSha256: string;
  reviewer: string; provenance: 'independent_source_review_ai'; role: 'independent' | 'adjudicator'; independentReviewFileSha256: string[];
  candidateContextInspected: false; answerOutputsInspected: false;
  providerCalls: 0; humanSourceCheckedAnswers: 0; qualityClaimEligible: false; activationAuthorized: false; paidPlan: null;
  cases: { caseId: string; decision: Decision; rationale: string; unknowns: string[]; applicability: string;
    independentAssessmentSha256: string[]; retainedIndependentUnknowns: string[]; disagreementResolution: 'independent' | 'agree' | 'source_resolved' | 'unresolved';
    designatedFacts: { fact: string; quote: string; sourceIds: string[]; qualification: string; applicability: string }[] }[];
};
export type AmazonPqaSelection = ReturnType<typeof selectAmazonPqaCasesV1>;
const SHA = /^[a-f0-9]{64}$/;
export const AMAZON_PQA_REQUIRED_CODE = ['server/amazon-pqa-source-v1.ts', 'server/amazon-pqa-validation-v1.ts', 'scripts/amazon-pqa-validation-v1.ts',
  'scripts/acquire-amazon-pqa-v1.py', 'scripts/prepare-amazon-pqa-history-v1.py', 'scripts/prepare-fresh-validation-v1.py', 'scripts/prepare-fresh-validation-v2.py', 'scripts/prepare-fresh-validation-v3.py',
  'server/product-retrieval.ts', 'server/product-corpus.ts', 'server/workspace-retrieval-context.ts', 'server/semantic-reranker.ts',
  'server/semantic-supplement-v5.ts', 'server/semantic-supplement-v6.ts', 'server/workspace-uncertainty-policy.ts', 'server/retrieval-diagnosis-replay.ts'] as const;
export const AMAZON_PQA_MODEL_ASSETS = [
  ...['tokenizer.json', 'tokenizer_config.json', 'config.json', 'onnx/model_quantized.onnx'].map(name => `.data/models/${EMBEDDING_MODEL}/${EMBEDDING_REVISION}/${name}`),
  ...[...RERANKER_FILES, 'asset-sha256.json'].map(name => `.data/models/${SEMANTIC_RERANKER.model}/${SEMANTIC_RERANKER.revision}/${name}`),
] as const;
function sha(value: string) { assert.match(value, SHA); }
function prose(value: string, minimum = 20) { assert.equal(typeof value, 'string'); assert.ok(value.trim().length >= minimum, 'Substantive source reasoning is required.'); }
function unique(values: string[]) { assert.equal(new Set(values).size, values.length); }
export function amazonPqaArtifact<T>(path: string, raw: string): AmazonPqaArtifact<T> { return { path, fileSha256: textHash(raw), document: JSON.parse(raw) }; }
function validArtifact(value: AmazonPqaArtifact) { assert.ok(value.path && !value.path.includes('\0')); sha(value.fileSha256); }

export function freezeAmazonPqaV1(input: Omit<AmazonPqaFreeze, 'format' | 'sourceBodiesInspected' | 'candidateContextInspected' | 'providerCalls' | 'humanSourceCheckedAnswers' | 'qualityClaimEligible' | 'activationAuthorized' | 'paidExecutionAuthorized' | 'sha256'>): AmazonPqaFreeze {
  [input.protocol, input.sourcePin, input.history, ...input.historicalInputs].forEach(validArtifact);
  validateAmazonPqaSourcePinV1(input.sourcePin.document);
  const p = input.protocol.document;
  assert.equal(p.format, 'ablatrix-amazon-pqa-protocol-v1'); assert.equal(p.purpose, 'exploratory_ai_only'); assert.equal(p.dataset, 'Amazon-PQA'); assert.equal(p.publisherSplit, 'unpartitioned_release'); assert.equal(p.use, 'prospective_exploratory_validation');
  assert.equal(p.sourceOrder, 'ascending_release_row'); assert.equal(p.control, 'workspace-semantic-supplement-v5-dev');
  assert.equal(p.candidate, 'workspace-semantic-supplement-v6-quantified-peer-dev'); assert.equal(p.generationContract, WORKSPACE_UNCERTAINTY_CONTRACT);
  assert.equal(p.targetAnswersInRetrieval, false); assert.equal(p.replacementAfterScreening, false);
  for (const key of ['maxInspectedRecords', 'targetPackets', 'selectedProducts', 'repeats', 'maxParents', 'maxBodyUtf16Units', 'maxQuestionUtf16Units', 'maxTitleUtf16Units'] as const) assert.ok(Number.isSafeInteger(p[key]) && p[key] > 0);
  assert.ok(p.maxInspectedRecords <= 4096 && p.selectedProducts <= p.targetPackets && p.targetPackets <= p.maxInspectedRecords && p.selectedProducts <= 24 && p.repeats <= 3);
  assert.ok(p.maxParents <= 128 && p.maxBodyUtf16Units <= 1500 && p.maxQuestionUtf16Units <= 1000 && p.maxTitleUtf16Units <= 500);
  prose(p.policyInstructions, 40); prose(p.model, 2);
  assert.ok(p.localModelAssetSha256 && typeof p.localModelAssetSha256 === 'object');
  for (const [path, hash] of Object.entries(p.localModelAssetSha256)) { assert.ok(AMAZON_PQA_MODEL_ASSETS.some(expected => expected === path), 'Only canonical revision-pinned cached assets are allowed.'); sha(hash); }
  if (input.sourcePin.document.provenance === 'publisher_dataset' || Object.keys(p.localModelAssetSha256).length) assert.deepEqual(Object.keys(p.localModelAssetSha256).sort(), [...AMAZON_PQA_MODEL_ASSETS].sort(), 'Publisher preparation requires all cached BGE and cross-encoder asset hashes before semantic access.');
  unique(p.expectedHistoryArtifactSha256); assert.ok(p.expectedHistoryArtifactSha256.length > 0);
  assert.deepEqual(input.historicalInputs.map(x => x.fileSha256).sort(), [...p.expectedHistoryArtifactSha256].sort(), 'Every prospectively enumerated private and public exposure artifact must be bound.');
  assert.ok(Object.keys(input.implementationSha256).length >= 3); Object.entries(input.implementationSha256).forEach(([path, hash]) => { assert.ok(path && !path.startsWith('/') && !path.split('/').includes('..')); sha(hash); });
  AMAZON_PQA_REQUIRED_CODE.forEach(path => assert.ok(input.implementationSha256[path], `Missing executed implementation pin: ${path}`));
  const document = { format: 'ablatrix-amazon-pqa-freeze-v1' as const, ...structuredClone({ protocol: input.protocol, sourcePin: input.sourcePin, history: input.history, historicalInputs: input.historicalInputs, implementationSha256: input.implementationSha256 }), sourceBodiesInspected: false as const, candidateContextInspected: false as const,
    providerCalls: 0 as const, humanSourceCheckedAnswers: 0 as const, qualityClaimEligible: false as const, activationAuthorized: false as const, paidExecutionAuthorized: false as const };
  return { ...document, sha256: freshSeal(document) };
}
export function verifyAmazonPqaFreezeV1(freeze: AmazonPqaFreeze) {
  const replay = freezeAmazonPqaV1({ protocol: freeze.protocol, sourcePin: freeze.sourcePin, history: freeze.history, historicalInputs: freeze.historicalInputs, implementationSha256: freeze.implementationSha256 });
  assert.deepEqual(freeze, replay, 'Prospective protocol, history and code freeze cannot be rewritten.'); return freeze;
}
/** The callback is the only source-file access boundary. Prefix protection is
 * checked before it can stat, open, hash or decode a proposed source file. */
export function withAmazonPqaPrefixAccessV1<T>(history: { consumedSourcePrefixes?: unknown; unresolvedPriorSemanticExposure?: unknown }, pin: AmazonPqaSourcePin, openSourceFiles: () => T): T {
  validateAmazonPqaSourcePinV1(pin);
  assert.ok(history.unresolvedPriorSemanticExposure === undefined || history.unresolvedPriorSemanticExposure === false, 'Unresolved prior semantic exposure blocks every new source read until a verified resolution.');
  const consumed = history.consumedSourcePrefixes ?? []; assert.ok(Array.isArray(consumed), 'Consumed source prefixes require an explicit array.');
  const range = (value: unknown): [number, number] => {
    if (value === null) return [0, Infinity];
    assert.ok(value && typeof value === 'object'); const r = value as { start: number; endInclusive: number };
    assert.ok(Number.isSafeInteger(r.start) && Number.isSafeInteger(r.endInclusive) && r.start >= 0 && r.endInclusive >= r.start, 'Consumed source ranges must be explicit finite byte intervals.');
    return [r.start, r.endInclusive];
  };
  for (const previous of consumed) {
    assert.ok(previous && typeof previous === 'object'); const p = previous as { key: string; versionId: string | null; sha256: string; range: unknown };
    assert.ok(typeof p.key === 'string' && p.key.length > 0 && (p.versionId === null || typeof p.versionId === 'string' && p.versionId.length > 0)); sha(p.sha256);
    const [priorStart, priorEnd] = range(p.range);
    for (const object of pin.objects) {
      const [start, end] = range(object.range);
      assert.ok(!(p.key === object.key && p.versionId === object.versionId && start <= priorEnd && priorStart <= end), 'A consumed source object/version overlaps the proposed range; fresh re-entry is forbidden.');
    }
  }
  return openSourceFiles();
}
export function amazonPqaParseFailureV1(freeze: AmazonPqaFreeze, failure: AmazonPqaParseError) {
  verifyAmazonPqaFreezeV1(freeze); assert.equal(failure.sourcePinSha256, freshSeal(freeze.sourcePin.document));
  const pin = freeze.sourcePin.document; validateAmazonPqaSourcePinV1(pin);
  return { format: 'ablatrix-amazon-pqa-semantic-access-failure-v1', status: 'source_parse_failed', freezeSha256: freeze.sha256,
    sourcePinFileSha256: freeze.sourcePin.fileSha256, sourcePinSha256: failure.sourcePinSha256,
    opaquePrefixObjects: pin.objects.map(o => ({ key: o.key, versionId: o.versionId, rawSha256: o.sha256, bytes: o.bytes, sourceBytes: o.sourceBytes, range: o.range })),
    errorCode: failure.stage, semanticRowsInspected: failure.inspectedRows, validDecodedRows: failure.validDecodedRows,
    consumedExposure: structuredClone(failure.consumedExposure), normalization: failure.normalization, wholePrefixConsumed: true,
    eligiblePackets: 0, sourceEligibilityPassed: false, selection: null, contexts: null, providerCalls: 0, generatedAnswers: 0,
    humanSourceCheckedAnswers: 0, qualityClaimEligible: false, activationAuthorized: false, paidExecutionAuthorized: false, paidPlan: null,
    stopReason: 'strict_source_schema_or_envelope_failed_no_rescue_or_replacement',
    limitation: 'The exact raw prefix is consumed. Only source fields recognized before strict rejection have mapped identities; unmapped bytes remain protected by the whole-prefix commitment.' };
}
function reviewSet<T extends { reviewer: string; role: string; independentReviewFileSha256: string[]; provenance: string; candidateContextInspected: boolean; answerOutputsInspected: boolean; providerCalls: number; humanSourceCheckedAnswers: number; qualityClaimEligible: boolean; activationAuthorized: boolean; paidPlan: unknown }>(reviews: AmazonPqaArtifact<T>[]) {
  assert.equal(reviews.length, 3); reviews.forEach(validArtifact); unique(reviews.map(x => x.fileSha256)); unique(reviews.map(x => x.document.reviewer.trim().toLowerCase()));
  reviews.forEach(({ document: r }, i) => { prose(r.reviewer, 3); assert.equal(r.provenance, 'independent_source_review_ai'); assert.equal(r.candidateContextInspected, false); assert.equal(r.answerOutputsInspected, false);
    assert.equal(r.providerCalls, 0); assert.equal(r.humanSourceCheckedAnswers, 0); assert.equal(r.qualityClaimEligible, false); assert.equal(r.activationAuthorized, false); assert.equal(r.paidPlan, null);
    assert.equal(r.role, i < 2 ? 'independent' : 'adjudicator'); assert.deepEqual(r.independentReviewFileSha256, i < 2 ? [] : reviews.slice(0, 2).map(x => x.fileSha256)); });
}
function resolution(row: { decision: Decision; independentAssessmentSha256: string[]; disagreementResolution: string }, inputs: { decision: Decision }[], adjudicator: boolean) {
  assert.deepEqual(row.independentAssessmentSha256, adjudicator ? inputs.map(freshSeal) : []);
  if (!adjudicator) { assert.equal(row.disagreementResolution, 'independent'); return; }
  assert.ok(['agree', 'source_resolved', 'unresolved'].includes(row.disagreementResolution));
  if (row.disagreementResolution === 'agree') assert.ok(inputs.every(x => x.decision === row.decision), 'Agreement cannot hide an independent disagreement.');
  if (row.disagreementResolution === 'unresolved') assert.equal(row.decision, 'uncertain', 'Unresolved disagreements remain uncertain.');
}
export function reviewAmazonPqaAccessV1(freeze: AmazonPqaFreeze, reviews: AmazonPqaArtifact<AmazonPqaAccessReview>[]) {
  verifyAmazonPqaFreezeV1(freeze); reviewSet(reviews);
  const evidence = [freeze.protocol, freeze.sourcePin, freeze.history, ...freeze.historicalInputs];
  for (const [reviewIndex, { document: r }] of reviews.entries()) {
    assert.equal(r.format, 'ablatrix-amazon-pqa-source-access-review-v1'); assert.equal(r.freezeSha256, freeze.sha256);
    assert.deepEqual(r.checks.map(x => x.id), AMAZON_PQA_ACCESS_CHECKS);
    for (const [checkIndex, check] of r.checks.entries()) {
      assert.ok(['eligible', 'reject', 'uncertain'].includes(check.decision)); prose(check.rationale); assert.ok(check.evidence.length);
      for (const e of check.evidence) { const source = evidence.find(x => x.fileSha256 === e.artifactSha256); assert.ok(source); prose(e.quote, 5); assert.ok(JSON.stringify(source.document).includes(e.quote), 'Review evidence must quote exact bound metadata.'); }
      resolution(check, reviewIndex === 2 ? reviews.slice(0, 2).map(r => r.document.checks[checkIndex]!) : [], reviewIndex === 2);
    }
  }
  // The third review must account explicitly for every disagreement. Negative and
  // uncertain independent findings remain attached even when adjudicated eligible.
  const decisions = reviews[2]!.document.checks.map((c, i) => ({ id: c.id, decision: c.decision,
    independentDecisions: reviews.slice(0, 2).map(r => r.document.checks[i]!.decision), rationale: c.rationale }));
  return { format: 'ablatrix-amazon-pqa-source-access-outcome-v1', freezeSha256: freeze.sha256, reviewFileSha256: reviews.map(x => x.fileSha256), decisions,
    sourceAccessAllowed: decisions.every(x => x.decision === 'eligible'), providerCalls: 0, humanSourceCheckedAnswers: 0, qualityClaimEligible: false, paidExecutionAuthorized: false };
}
function checkPackets(screening: AmazonPqaScreening) {
  unique(screening.decisions.map(x => x.caseId));
  for (const row of screening.decisions) {
    assert.ok(row.caseId && Array.isArray(row.reasons)); if (!row.eligible) continue;
    const p = row.packet; assert.ok(p && p.id === row.caseId && p.sources.length > 0 && p.sources.length <= 128); unique(p.sources.map(x => x.id));
    assert.equal(p.sourcePoolSha256, textHash(JSON.stringify(p.sources)));
    for (const s of p.sources) assert.equal(s.sha256, textHash(JSON.stringify([s.id, s.label, s.text, s.originalQuestion, s.reference])));
  }
}
export function amazonPqaEligibilityRequestV1(freeze: AmazonPqaFreeze, screening: AmazonPqaArtifact<AmazonPqaScreening>) {
  verifyAmazonPqaFreezeV1(freeze); validArtifact(screening); checkPackets(screening.document);
  return { format: 'ablatrix-amazon-pqa-source-eligibility-request-v1', freezeSha256: freeze.sha256, screeningFileSha256: screening.fileSha256,
    instruction: 'Review every inspected row against exact literal sources. Target answers are withheld, not evidence or gold. Preserve applicability, conflicts, uncertainty and rejected rows. Do not inspect candidate contexts or generated answers.',
    cases: screening.document.decisions, providerCalls: 0, candidateContextInspected: false, answerOutputsInspected: false, qualityClaimEligible: false };
}
export function selectAmazonPqaCasesV1(freeze: AmazonPqaFreeze, screening: AmazonPqaArtifact<AmazonPqaScreening>, reviews: AmazonPqaArtifact<AmazonPqaEligibilityReview>[]) {
  amazonPqaEligibilityRequestV1(freeze, screening); reviewSet(reviews);
  for (const [reviewIndex, { document: r }] of reviews.entries()) {
    assert.equal(r.format, 'ablatrix-amazon-pqa-source-eligibility-review-v1'); assert.equal(r.freezeSha256, freeze.sha256); assert.equal(r.screeningFileSha256, screening.fileSha256);
    assert.deepEqual(r.cases.map(c => c.caseId), screening.document.decisions.map(c => c.caseId), 'Reviews must retain every inspected rejection and uncertain case.');
    for (const [caseIndex, c] of r.cases.entries()) {
      assert.ok(['eligible', 'reject', 'uncertain'].includes(c.decision)); prose(c.rationale); prose(c.applicability); assert.ok(Array.isArray(c.unknowns)); c.unknowns.forEach(x => prose(x, 5));
      const inspected = screening.document.decisions.find(x => x.caseId === c.caseId)!;
      const independent = reviewIndex === 2 ? reviews.slice(0, 2).map(r => r.document.cases[caseIndex]!) : [];
      resolution(c, independent, reviewIndex === 2);
      assert.deepEqual(c.retainedIndependentUnknowns, [...new Set(independent.flatMap(x => x.unknowns))], 'Adjudication must preserve every independent unknown.');
      if (!inspected.eligible) assert.notEqual(c.decision, 'eligible', 'Source reviewers cannot override automatic exposure/leakage/bounds exclusions.');
      if (c.decision === 'eligible') assert.ok(c.designatedFacts.length > 0);
      for (const fact of c.designatedFacts) {
        prose(fact.fact, 5); prose(fact.quote, 5); prose(fact.qualification); prose(fact.applicability); assert.ok(fact.sourceIds.length); unique(fact.sourceIds);
        assert.ok(fact.sourceIds.every(id => inspected.packet?.sources.some(s => s.id === id && s.text.includes(fact.quote))), 'Every designated fact requires exact literal source quotes.');
      }
    }
  }
  const adjudicated = reviews[2]!.document.cases;
  const eligible = adjudicated.filter(c => c.decision === 'eligible');
  const selected = eligible.slice(0, freeze.protocol.document.selectedProducts);
  const selectedPackets = selected.map(c => screening.document.decisions.find(x => x.caseId === c.caseId)!.packet!);
  unique(selectedPackets.map(p => p.product.id));
  assert.ok(screening.document.decisions.length <= freeze.protocol.document.maxInspectedRecords);
  const automaticEligible = screening.document.decisions.filter(x => x.eligible).length;
  assert.ok(automaticEligible <= freeze.protocol.document.targetPackets);
  const stopReason = automaticEligible < freeze.protocol.document.targetPackets ? 'finite_screening_pool_shortfall' : selected.length < freeze.protocol.document.selectedProducts ? 'insufficient_source_eligible_unique_products' : null;
  return { format: 'ablatrix-amazon-pqa-selection-v1' as const, freezeSha256: freeze.sha256, screeningFileSha256: screening.fileSha256,
    reviewFileSha256: reviews.map(x => x.fileSha256), inspectedQuestions: screening.document.decisions.length,
    eligibleQuestions: eligible.length, selectedProducts: selected.length, selectedCaseIds: selected.map(c => c.caseId),
    adjudicatedCases: structuredClone(adjudicated), independentDecisions: reviews.slice(0, 2).map(r => r.document.cases.map(c => ({ caseId: c.caseId, decision: c.decision, unknowns: c.unknowns }))),
    stopReason, candidateContextInspected: false as const, answerOutputsInspected: false as const, candidateMissesRetained: true as const,
    providerCalls: 0 as const, humanSourceCheckedAnswers: 0 as const, qualityClaimEligible: false as const, activationAuthorized: false as const, paidExecutionAuthorized: false as const };
}
export function amazonPqaCorpusV1(freeze: AmazonPqaFreeze, screening: AmazonPqaArtifact<AmazonPqaScreening>, selection: AmazonPqaSelection): ProductCorpus {
  verifyAmazonPqaFreezeV1(freeze); checkPackets(screening.document); assert.equal(selection.freezeSha256, freeze.sha256); assert.equal(selection.screeningFileSha256, screening.fileSha256); assert.equal(selection.stopReason, null);
  const packets = selection.selectedCaseIds.map(id => { const p = screening.document.decisions.find(d => d.caseId === id && d.eligible)?.packet; assert.ok(p); return p; });
  const corpus: ProductCorpus = { version: `amazon-pqa-v1-${freshSeal([freeze.sha256, selection]).slice(0, 24)}`, source: 'Prospectively screened Amazon-PQA source-only unpartitioned-release packets', license: 'CDLA-Permissive-1.0', cases: [],
    products: packets.map(p => ({ ...p.product, split: 'validation' })), passages: packets.flatMap(p => p.sources.flatMap(s => workspaceSourceChunks(s.text).map((text, i, chunks) => ({
      id: chunks.length === 1 ? s.id : `${s.id}-${i + 1}`, productId: p.product.id, source: s.label, reference: s.label, text, sha256: textHash(text), ...(s.originalQuestion !== null ? { originalQuestion: s.originalQuestion } : {}) })))) };
  validateProductCorpus(corpus); return corpus;
}
/** The source-only fixed selection precedes both arms. No misses can remove cases. */
export async function prepareAmazonPqaComparisonV1(freeze: AmazonPqaFreeze, screening: AmazonPqaArtifact<AmazonPqaScreening>, reviews: AmazonPqaArtifact<AmazonPqaEligibilityReview>[], selection: AmazonPqaSelection,
  retriever: { diagnose(productId: string, question: string): Promise<{ result: RetrievalResult; trace: RetrievalStageTrace }> }, scorer: PairScorer) {
  assert.deepEqual(selection, selectAmazonPqaCasesV1(freeze, screening, reviews), 'Selection must replay before candidate inference.');
  const corpus = amazonPqaCorpusV1(freeze, screening, selection), cases = [];
  for (const caseId of selection.selectedCaseIds) {
    const packet = screening.document.decisions.find(x => x.caseId === caseId)!.packet!, review = selection.adjudicatedCases.find(c => c.caseId === caseId)!;
    const product = { ...packet.product, sources: packet.sources.map(s => ({ ...s, originalQuestion: s.originalQuestion ?? undefined })) };
    const { result, trace } = await retriever.diagnose(packet.product.id, packet.question); assert.equal(result.corpusVersion, corpus.version);
    const indexBaseline = workspaceCompleteSourceContext(product, corpus, result);
    const control = await semanticSupplementContextV5(product, corpus, result, trace, packet.question, scorer);
    // Both selectors receive exactly the v5-observed query/document scores.
    const inputs = control.proposal.actualInputs;
    const replayScorer: PairScorer = async (query, documents) => { assert.equal(query, inputs.query); assert.equal(textHash(query), inputs.querySha256);
      const scores = new Map(inputs.documents.map(d => { assert.equal(textHash(d.document), d.documentSha256); return [d.document, d.score] as const; }));
      assert.deepEqual([...new Set(documents)].sort(), [...scores.keys()].sort()); return documents.map(d => scores.get(d)!); };
    const candidate = await semanticSupplementContextV6(product, corpus, result, trace, packet.question, replayScorer);
    assert.deepEqual(control.passages.slice(0, indexBaseline.length), indexBaseline); assert.deepEqual(candidate.passages.slice(0, indexBaseline.length), indexBaseline);
    const completeSources: RetrievedPassage[] = packet.sources.map(s => ({ id: s.id, productId: packet.product.id, source: s.label, reference: s.label, text: s.text, sha256: textHash(s.text), lexicalRank: null, semanticRank: null, score: 0, ...(s.originalQuestion !== null ? { originalQuestion: s.originalQuestion } : {}) }));
    const delivered = (context: RetrievedPassage[], fact: typeof review.designatedFacts[number]) => context.some(s => fact.sourceIds.includes(s.id) && s.text.includes(fact.quote));
    const facts = review.designatedFacts.map(f => ({ ...f, currentDelivered: delivered(control.passages, f), candidateDelivered: delivered(candidate.passages, f) }));
    cases.push({ caseId, product: packet.product, question: packet.question, completeSources, generationContract: freeze.protocol.document.generationContract,
      policyInstructions: freeze.protocol.document.policyInstructions, model: freeze.protocol.document.model, contexts: { current: control.passages, semantic: candidate.passages },
      retrieval: { result, trace, control, candidate }, designatedFacts: facts, unknowns: review.unknowns, applicability: review.applicability,
      recoveredUnits: facts.filter(f => !f.currentDelivered && f.candidateDelivered).length, lostUnits: facts.filter(f => f.currentDelivered && !f.candidateDelivered).length,
      quantifiedPeerApplicability: { eligibleSourceLabels: packet.sources.filter(s => s.label === 'review' || s.label === 'cqa').length,
        anchorGroups: candidate.peerSelection.anchorGroups.length, fallbackExactlyV5: candidate.peerSelection.fallbackExactlyV5 },
      answerStatus: { current: 'not_attempted', semantic: 'not_attempted' } });
  }
  const sourceBenefit = cases.some(c => c.recoveredUnits > 0) && cases.every(c => c.lostUnits === 0);
  return { format: 'ablatrix-amazon-pqa-comparison-preparation-v1' as const, freezeSha256: freeze.sha256, selectionSha256: freshSeal(selection), corpusSha256: freshSeal(corpus),
    selection, cases, proposedAnswers: cases.length * 2 * freeze.protocol.document.repeats, repeats: freeze.protocol.document.repeats,
    sourceBenefit, stopReason: cases.some(c => c.lostUnits > 0) ? 'designated_control_fact_lost' : sourceBenefit ? null : 'no_designated_missing_fact_delivered_by_candidate',
    providerCalls: 0 as const, generatedAnswers: 0 as const, humanSourceCheckedAnswers: 0 as const, qualityClaimEligible: false as const,
    activationAuthorized: false as const, paidExecutionAuthorized: false as const, paidPlan: null };
}
/** Saved dense/logit observations are replay inputs, not authenticated model output. */
export async function verifyAmazonPqaComparisonV1(freeze: AmazonPqaFreeze, screening: AmazonPqaArtifact<AmazonPqaScreening>, reviews: AmazonPqaArtifact<AmazonPqaEligibilityReview>[], selection: AmazonPqaSelection,
  saved: Awaited<ReturnType<typeof prepareAmazonPqaComparisonV1>>) {
  const corpus = amazonPqaCorpusV1(freeze, screening, selection);
  const scorer: PairScorer = async (query, documents) => {
    const inputs = saved.cases.map(c => c.retrieval.control.proposal.actualInputs).find(x => x.query === query); assert.ok(inputs);
    const scores = new Map(inputs.documents.map(d => { assert.equal(textHash(d.document), d.documentSha256); return [d.document, d.score] as const; }));
    assert.deepEqual([...new Set(documents)].sort(), [...scores.keys()].sort()); return documents.map(d => scores.get(d)!);
  };
  const retriever = { async diagnose(productId: string, question: string) {
    const row = saved.cases.find(c => c.product.id === productId && c.question === question); assert.ok(row);
    const replay = await replaySavedStages(corpus, productId, question, row.retrieval.trace); assert.deepEqual(replay.passages, row.retrieval.result.passages);
    return { result: row.retrieval.result, trace: row.retrieval.trace };
  } };
  const replay = await prepareAmazonPqaComparisonV1(freeze, screening, reviews, selection, retriever, scorer);
  const deterministic = (value: typeof replay) => { const clone = structuredClone(value); for (const c of clone.cases) { delete (c.retrieval.control.proposal as Partial<typeof c.retrieval.control.proposal>).resources; delete (c.retrieval.candidate.proposal as Partial<typeof c.retrieval.candidate.proposal>).resources; } return clone; };
  assert.deepEqual(deterministic(saved), deterministic(replay), 'Source contexts, scores, designated units and every fixed selected miss must replay.'); return saved;
}
export function reportAmazonPqaV1(freeze: AmazonPqaFreeze, screening: AmazonPqaArtifact<AmazonPqaScreening>, selection: AmazonPqaSelection, comparison?: Awaited<ReturnType<typeof prepareAmazonPqaComparisonV1>>) {
  verifyAmazonPqaFreezeV1(freeze); assert.equal(selection.freezeSha256, freeze.sha256); assert.equal(selection.screeningFileSha256, screening.fileSha256);
  if (comparison) { assert.equal(comparison.freezeSha256, freeze.sha256); assert.equal(comparison.selectionSha256, freshSeal(selection)); assert.deepEqual(comparison.cases.map(c => c.caseId), selection.selectedCaseIds); }
  const reasons: Record<string, number> = {}; for (const d of screening.document.decisions) for (const reason of d.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
  const facts = comparison?.cases.flatMap(c => c.designatedFacts) ?? [];
  return { format: 'ablatrix-amazon-pqa-offline-report-v1', freezeSha256: freeze.sha256, status: selection.stopReason ?? comparison?.stopReason ?? (comparison ? 'offline_comparison_prepared' : 'source_selection_complete'),
    inspectedQuestions: selection.inspectedQuestions, automaticEligibleQuestions: screening.document.decisions.filter(x => x.eligible).length,
    inspectedUniqueProducts: new Set(screening.document.decisions.flatMap(x => x.productId ? [x.productId] : x.packet ? [x.packet.product.id] : [])).size,
    sourceEligibleQuestions: selection.eligibleQuestions, selectedUniqueProducts: selection.selectedProducts, rejectedOrUncertainQuestions: selection.inspectedQuestions - selection.eligibleQuestions,
    rejectionReasons: reasons, adjudicatedUncertainQuestions: selection.adjudicatedCases.filter(c => c.decision === 'uncertain').length,
    selectedCasesWithUnknowns: selection.adjudicatedCases.filter(c => selection.selectedCaseIds.includes(c.caseId) && c.unknowns.length > 0).length,
    designatedSourceUnits: facts.length, currentDeliveredUnits: facts.filter(f => f.currentDelivered).length, candidateDeliveredUnits: facts.filter(f => f.candidateDelivered).length,
    recoveredUnits: facts.filter(f => !f.currentDelivered && f.candidateDelivered).length, lostUnits: facts.filter(f => f.currentDelivered && !f.candidateDelivered).length,
    casesWithApplicablePeerAnchors: comparison?.cases.filter(c => c.quantifiedPeerApplicability.anchorGroups > 0).length ?? 0,
    casesExactlyV5Fallback: comparison?.cases.filter(c => c.quantifiedPeerApplicability.fallbackExactlyV5).length ?? 0,
    proposedAnswers: comparison?.proposedAnswers ?? 0, generatedAnswers: 0, providerCalls: 0, humanSourceCheckedAnswers: 0,
    qualityClaimEligible: false, activationAuthorized: false, paidExecutionAuthorized: false, paidPlan: null,
    limitation: 'AI-only source review and offline retrieval delivery do not establish answer-quality improvement. Freshness is relative to the bound exposure inventory; model pretraining overlap is unknown.' };
}
