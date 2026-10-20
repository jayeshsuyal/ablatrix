/** Fresh native v6/v7 comparison. V1 is reused for SOURCE eligibility only. */
import assert from 'node:assert/strict';
import { freshSeal } from './fresh-validation-v2.ts';
import { textHash, validateProductCorpus } from './product-corpus.ts';
import { freezeAmazonPqaV1, reviewAmazonPqaAccessV1, amazonPqaEligibilityRequestV1, selectAmazonPqaCasesV1, amazonPqaCorpusV1,
  type AmazonPqaArtifact, type AmazonPqaProtocol, type AmazonPqaFreeze, type AmazonPqaAccessReview, type AmazonPqaEligibilityReview, type AmazonPqaScreening } from './amazon-pqa-validation-v1.ts';
import { AMAZON_PQA_RELEASE_REQUIRED_CODE, withAmazonPqaReleaseAccessV2 } from './amazon-pqa-validation-v2.ts';
import { validateAmazonPqaReleasePinV2, projectAmazonPqaReleaseGuardPinV2, type AmazonPqaReleasePinV2 } from './amazon-pqa-release-v2.ts';
import { semanticSupplementContextV6, SEMANTIC_SUPPLEMENT_V6 } from './semantic-supplement-v6.ts';
import { semanticSupplementContextV7, SEMANTIC_SUPPLEMENT_V7 } from './semantic-supplement-v7.ts';
import { workspaceCompleteSourceContext } from './workspace-retrieval-context.ts';
import { replaySavedStages } from './retrieval-diagnosis-replay.ts';
import type { PairScorer } from './semantic-reranker.ts';
import type { RetrievalResult, RetrievedPassage } from './loop-types.ts';
import type { RetrievalStageTrace } from './product-retrieval.ts';

export { amazonPqaArtifact, AMAZON_PQA_MODEL_ASSETS, AMAZON_PQA_ACCESS_CHECKS } from './amazon-pqa-validation-v1.ts';
export const AMAZON_PQA_RUNTIME_V4 = 'native-release-v4-v6-v7' as const;
export const AMAZON_PQA_V4_PROJECTION = 'source-eligibility-only-v4-to-immutable-v1-in-memory' as const;
export const AMAZON_PQA_V4_REQUIRED_CODE = [...AMAZON_PQA_RELEASE_REQUIRED_CODE, 'scripts/amazon-pqa-validation-runtime-v3.ts', 'scripts/prepare-amazon-pqa-history-runtime-v3.py',
  'server/semantic-supplement-v7.ts', 'server/amazon-pqa-validation-v4.ts', 'scripts/amazon-pqa-validation-v4.ts',
  'server/amazon-pqa-consumed-history-v4.ts', 'scripts/amazon-pqa-consumed-history-v4.ts', 'scripts/acquire-amazon-pqa-v4.py'] as const;
export type AmazonPqaProtocolV4 = Omit<AmazonPqaProtocol, 'format' | 'control' | 'candidate'> & {
  format: 'ablatrix-amazon-pqa-protocol-v4'; control: typeof SEMANTIC_SUPPLEMENT_V6.contract; candidate: typeof SEMANTIC_SUPPLEMENT_V7.contract;
  executionRuntime: typeof AMAZON_PQA_RUNTIME_V4; nativeSchemaContract: 'amazon-pqa-released-fields-v2'; sourceAccessScope: 'prospective_third_fixed_range'; consumedFramesNeverFresh: true;
};
export type AmazonPqaFreezeV4 = Omit<AmazonPqaFreeze, 'format' | 'protocol' | 'sourcePin'> & {
  format: 'ablatrix-amazon-pqa-freeze-v4'; protocol: AmazonPqaArtifact<AmazonPqaProtocolV4>; sourcePin: AmazonPqaArtifact<AmazonPqaReleasePinV2>;
  sourceOnlyProjectionContract: typeof AMAZON_PQA_V4_PROJECTION;
};
export type AmazonPqaAccessReviewV4 = Omit<AmazonPqaAccessReview, 'format'> & { format: 'ablatrix-amazon-pqa-source-access-review-v4' };
export type AmazonPqaEligibilityReviewV4 = Omit<AmazonPqaEligibilityReview, 'format'> & { format: 'ablatrix-amazon-pqa-source-eligibility-review-v4' };
type FreezeInput = Pick<AmazonPqaFreezeV4, 'protocol' | 'sourcePin' | 'history' | 'historicalInputs' | 'implementationSha256'>;
const SHA = /^[a-f0-9]{64}$/;
function memory<T>(path: string, document: T): AmazonPqaArtifact<T> { return { path: `IN_MEMORY_SOURCE_ELIGIBILITY_ONLY/${path}`, fileSha256: freshSeal(document), document }; }
/** Old arm labels appear only in this never-persisted source-eligibility guard. */
function sourceEligibilityFreeze(input: FreezeInput) {
  const historicalInputs = [...new Map([...input.historicalInputs, input.protocol, input.sourcePin].map(a => [a.fileSha256, a])).values()];
  const protocol = { ...input.protocol.document, format: 'ablatrix-amazon-pqa-protocol-v1' as const,
    control: 'workspace-semantic-supplement-v5-dev' as const, candidate: 'workspace-semantic-supplement-v6-quantified-peer-dev' as const,
    expectedHistoryArtifactSha256: historicalInputs.map(a => a.fileSha256) };
  return freezeAmazonPqaV1({ ...input, historicalInputs, protocol: memory('source-eligibility-protocol.json', protocol),
    sourcePin: memory('normalized-native-guard-pin.json', projectAmazonPqaReleaseGuardPinV2(input.sourcePin.document)) });
}
function nativeInput(input: FreezeInput) {
  const p = input.protocol.document, h = input.history.document as Record<string, any>;
  assert.equal(p.format, 'ablatrix-amazon-pqa-protocol-v4'); assert.equal(p.executionRuntime, AMAZON_PQA_RUNTIME_V4);
  assert.equal(p.control, SEMANTIC_SUPPLEMENT_V6.contract); assert.equal(p.candidate, SEMANTIC_SUPPLEMENT_V7.contract);
  assert.equal(p.nativeSchemaContract, 'amazon-pqa-released-fields-v2'); assert.equal(p.sourceAccessScope, 'prospective_third_fixed_range'); assert.equal(p.consumedFramesNeverFresh, true);
  validateAmazonPqaReleasePinV2(input.sourcePin.document);
  assert.deepEqual([...p.expectedHistoryArtifactSha256].sort(), input.historicalInputs.map(a => a.fileSha256).sort());
  AMAZON_PQA_V4_REQUIRED_CODE.forEach(path => assert.match(input.implementationSha256[path] ?? '', SHA));
  if (input.sourcePin.document.provenance === 'publisher_dataset') {
    const o = input.sourcePin.document.objects[0]!;
    assert.deepEqual(o.range, { start: 32 * 1024 * 1024, endInclusive: 48 * 1024 * 1024 - 1 }); assert.equal(o.bytes, 16 * 1024 * 1024);
    assert.equal(p.maxInspectedRecords, 4096); assert.equal(p.targetPackets, 32); assert.equal(p.selectedProducts, 16); assert.equal(p.repeats, 1);
    assert.equal(h.format, 'ablatrix-amazon-pqa-protected-history-v4'); assert.equal(h.completeHistoricalUnion, true);
    assert.equal(h.priorConsumedCompleteRowsMappingVerified, true); assert.equal(h.priorConsumedPrefixMappingVerified, true); assert.equal(h.unresolvedPriorSemanticExposure, false);
    assert.equal(h.unresolvedTrailingBoundary, null);
    for (const start of [0, 16 * 1024 * 1024]) assert.ok(h.consumedSourcePrefixes.some((x: any) => x.key === o.key && x.versionId === o.versionId
      && x.range?.start === start && x.range?.endInclusive === start + 16 * 1024 * 1024 - 1), 'Both complete consumed frames must stay protected.');
    assert.ok(Array.isArray(h.boundaryExclusionCommitments) && h.boundaryExclusionCommitments.some((x: any) =>
      x.currentSourcePinSha256 === freshSeal(input.sourcePin.document) && x.currentSourcePinFileSha256 === input.sourcePin.fileSha256
      && x.boundaryNeverSelectable === true && x.newCompleteRowsInspected === 0),
    'Resolved old-tail exclusion must bind this exact prospective native pin and its raw bytes.');
  }
  withAmazonPqaReleaseAccessV2(h, input.sourcePin.document, () => undefined);
}
export function freezeAmazonPqaV4(input: FreezeInput): AmazonPqaFreezeV4 {
  nativeInput(input); sourceEligibilityFreeze(input);
  const body = { format: 'ablatrix-amazon-pqa-freeze-v4' as const, ...structuredClone(input), sourceOnlyProjectionContract: AMAZON_PQA_V4_PROJECTION,
    sourceBodiesInspected: false as const, candidateContextInspected: false as const, providerCalls: 0 as const, humanSourceCheckedAnswers: 0 as const,
    qualityClaimEligible: false as const, activationAuthorized: false as const, paidExecutionAuthorized: false as const };
  return { ...body, sha256: freshSeal(body) };
}
export function verifyAmazonPqaFreezeV4(f: AmazonPqaFreezeV4) {
  assert.deepEqual(f, freezeAmazonPqaV4({ protocol: f.protocol, sourcePin: f.sourcePin, history: f.history, historicalInputs: f.historicalInputs, implementationSha256: f.implementationSha256 })); return f;
}
function reviewBindings<T extends AmazonPqaAccessReviewV4 | AmazonPqaEligibilityReviewV4>(f: AmazonPqaFreezeV4, reviews: AmazonPqaArtifact<T>[], format: T['format']) {
  verifyAmazonPqaFreezeV4(f); assert.equal(reviews.length, 3); assert.equal(new Set(reviews.map(x => x.fileSha256)).size, 3);
  assert.equal(new Set(reviews.map(x => x.document.reviewer.trim().toLowerCase())).size, 3);
  const kind = format.includes('eligibility') ? 'cases' : 'checks';
  reviews.forEach(({ document: r, fileSha256 }, i) => {
    assert.match(fileSha256, SHA); assert.equal(r.format, format); assert.equal(r.freezeSha256, f.sha256); assert.equal(r.role, i === 2 ? 'adjudicator' : 'independent');
    assert.deepEqual(r.independentReviewFileSha256, i === 2 ? reviews.slice(0, 2).map(x => x.fileSha256) : []);
    const rows = (r as unknown as Record<string, any>)[kind]; assert.ok(Array.isArray(rows));
    for (const [n, row] of rows.entries()) {
      const independent = i === 2 ? reviews.slice(0, 2).map(x => (x.document as unknown as Record<string, any>)[kind][n]) : [];
      assert.deepEqual(row.independentAssessmentSha256, independent.map(freshSeal), 'Native assessment hashes must bind before projection.');
      if (i < 2) assert.equal(row.disagreementResolution, 'independent');
      else { assert.ok(['agree', 'source_resolved', 'unresolved'].includes(row.disagreementResolution)); if (row.disagreementResolution === 'agree') assert.ok(independent.every(x => x.decision === row.decision)); if (row.disagreementResolution === 'unresolved') assert.equal(row.decision, 'uncertain'); }
      if (kind === 'cases') assert.deepEqual(row.retainedIndependentUnknowns, [...new Set(independent.flatMap(x => x.unknowns))]);
    }
  });
}
export function reviewAmazonPqaAccessV4(f: AmazonPqaFreezeV4, reviews: AmazonPqaArtifact<AmazonPqaAccessReviewV4>[]) {
  reviewBindings(f, reviews, 'ablatrix-amazon-pqa-source-access-review-v4'); const calc = sourceEligibilityFreeze(f);
  for (const r of reviews) for (const c of r.document.checks) for (const e of c.evidence) {
    const a = [f.protocol, f.sourcePin, f.history, ...f.historicalInputs].find(x => x.fileSha256 === e.artifactSha256);
    assert.ok(a && e.quote.trim().length >= 5 && JSON.stringify(a.document).includes(e.quote), 'Quote exact native bound metadata.');
  }
  const result = reviewAmazonPqaAccessV1(calc, reviews.map(r => ({ ...r, document: { ...r.document, format: 'ablatrix-amazon-pqa-source-access-review-v1' as const, freezeSha256: calc.sha256 } })));
  return { ...result, format: 'ablatrix-amazon-pqa-source-access-outcome-v4', freezeSha256: f.sha256, sourceOnlyProjectionContract: AMAZON_PQA_V4_PROJECTION };
}
function nativeScreening(f: AmazonPqaFreezeV4, s: AmazonPqaArtifact<AmazonPqaScreening>) {
  verifyAmazonPqaFreezeV4(f); assert.equal(s.document.format, 'ablatrix-amazon-pqa-release-screening-v2'); assert.equal(s.document.mode, 'prospective_source_screening');
  assert.equal(s.document.sourcePinSha256, freshSeal(f.sourcePin.document));
  const { screeningSha256, ...body } = s.document; assert.equal(screeningSha256, freshSeal(body));
  const p = f.protocol.document, h = f.history.document as Record<string, any>;
  assert.equal(s.document.policySha256, freshSeal(Object.fromEntries(['maxInspectedRecords', 'targetPackets', 'maxParents', 'maxBodyUtf16Units', 'maxQuestionUtf16Units', 'maxTitleUtf16Units'].map(k => [k, p[k as keyof typeof p]]))));
  const history = { ...Object.fromEntries(['productIds', 'canonicalFamilyTitles', 'modelIdentifiers', 'sourceBodyFingerprints', 'sourcePacketFingerprints'].map(k => [k, h[k]])),
    ...(h.normalization ? { normalization: { id: 'python_nfkc_casefold_whitespace_v1', pythonVersion: h.normalization.pythonVersion, unicodeVersion: h.normalization.unicodeVersion } } : {}) };
  assert.equal(s.document.historySha256, freshSeal(history));
}
export function amazonPqaEligibilityRequestV4(f: AmazonPqaFreezeV4, s: AmazonPqaArtifact<AmazonPqaScreening>) {
  nativeScreening(f, s); const request = amazonPqaEligibilityRequestV1(sourceEligibilityFreeze(f), s);
  return { ...request, format: 'ablatrix-amazon-pqa-source-eligibility-request-v4', freezeSha256: f.sha256,
    control: f.protocol.document.control, candidate: f.protocol.document.candidate, sourceOnlyProjectionContract: AMAZON_PQA_V4_PROJECTION };
}
export function selectAmazonPqaCasesV4(f: AmazonPqaFreezeV4, s: AmazonPqaArtifact<AmazonPqaScreening>, reviews: AmazonPqaArtifact<AmazonPqaEligibilityReviewV4>[]) {
  nativeScreening(f, s); reviewBindings(f, reviews, 'ablatrix-amazon-pqa-source-eligibility-review-v4'); const calc = sourceEligibilityFreeze(f);
  for (const r of reviews) { assert.equal(r.document.screeningFileSha256, s.fileSha256); assert.deepEqual(r.document.cases.map(x => x.caseId), s.document.decisions.map(x => x.caseId)); }
  const sourceOnlyEligibilityCalculation = selectAmazonPqaCasesV1(calc, s, reviews.map(r => ({ ...r, document: { ...r.document,
    format: 'ablatrix-amazon-pqa-source-eligibility-review-v1' as const, freezeSha256: calc.sha256 } })));
  return { format: 'ablatrix-amazon-pqa-selection-v4' as const, freezeSha256: f.sha256, screeningFileSha256: s.fileSha256,
    control: f.protocol.document.control, candidate: f.protocol.document.candidate, sourceOnlyProjectionContract: AMAZON_PQA_V4_PROJECTION, sourceOnlyEligibilityCalculation };
}
export type AmazonPqaSelectionV4 = ReturnType<typeof selectAmazonPqaCasesV4>;
export function amazonPqaCorpusV4(f: AmazonPqaFreezeV4, s: AmazonPqaArtifact<AmazonPqaScreening>, selection: AmazonPqaSelectionV4) {
  nativeScreening(f, s); assert.equal(selection.freezeSha256, f.sha256); assert.equal(selection.screeningFileSha256, s.fileSha256);
  const corpus = amazonPqaCorpusV1(sourceEligibilityFreeze(f), s, selection.sourceOnlyEligibilityCalculation);
  corpus.version = `amazon-pqa-v4-${freshSeal([f.sha256, selection]).slice(0, 24)}`; validateProductCorpus(corpus); return corpus;
}
type Retriever = { diagnose(productId: string, question: string): Promise<{ result: RetrievalResult; trace: RetrievalStageTrace }> };
function replayScorer(inputs: Awaited<ReturnType<typeof semanticSupplementContextV6>>['proposal']['actualInputs']): PairScorer {
  return async (query, documents) => { assert.equal(query, inputs.query); assert.equal(textHash(query), inputs.querySha256);
    const scores = new Map(inputs.documents.map(x => { assert.equal(textHash(x.document), x.documentSha256); assert.ok(Number.isFinite(x.score)); return [x.document, x.score] as const; }));
    assert.deepEqual([...new Set(documents)].sort(), [...scores.keys()].sort()); return documents.map(x => scores.get(x)!); };
}
export async function prepareAmazonPqaComparisonV4(f: AmazonPqaFreezeV4, s: AmazonPqaArtifact<AmazonPqaScreening>, reviews: AmazonPqaArtifact<AmazonPqaEligibilityReviewV4>[], selection: AmazonPqaSelectionV4, retriever: Retriever, scorer: PairScorer) {
  assert.deepEqual(selection, selectAmazonPqaCasesV4(f, s, reviews)); const source = selection.sourceOnlyEligibilityCalculation;
  assert.equal(source.stopReason, null); const corpus = amazonPqaCorpusV4(f, s, selection), cases = [];
  for (const caseId of source.selectedCaseIds) {
    const packet = s.document.decisions.find(x => x.caseId === caseId)!.packet!, review = source.adjudicatedCases.find(x => x.caseId === caseId)!;
    const product = { ...packet.product, sources: packet.sources.map(x => ({ ...x, originalQuestion: x.originalQuestion ?? undefined })) };
    const { result, trace } = await retriever.diagnose(product.id, packet.question); assert.equal(result.corpusVersion, corpus.version);
    const baseline = workspaceCompleteSourceContext(product, corpus, result);
    const control = await semanticSupplementContextV6(product, corpus, result, trace, packet.question, scorer);
    const candidate = await semanticSupplementContextV7(product, corpus, result, trace, packet.question, replayScorer(control.proposal.actualInputs));
    assert.equal(control.contract, f.protocol.document.control); assert.equal(candidate.contract, f.protocol.document.candidate);
    assert.deepEqual(control.proposal.actualInputs, candidate.proposal.actualInputs); assert.deepEqual(candidate.passages.slice(0, control.passages.length), control.passages);
    assert.deepEqual(control.passages.slice(0, baseline.length), baseline);
    const delivered = (context: RetrievedPassage[], fact: typeof review.designatedFacts[number]) => context.some(x => fact.sourceIds.includes(x.id) && x.text.includes(fact.quote));
    const designatedFacts = review.designatedFacts.map(x => ({ ...x, controlDelivered: delivered(control.passages, x), candidateDelivered: delivered(candidate.passages, x) }));
    cases.push({ caseId, product: packet.product, question: packet.question, completeSources: packet.sources, generationContract: f.protocol.document.generationContract,
      policyInstructions: f.protocol.document.policyInstructions, model: f.protocol.document.model, contexts: { control: control.passages, candidate: candidate.passages },
      retrieval: { result, trace, control, candidate }, designatedFacts, unknowns: review.unknowns, applicability: review.applicability,
      recoveredUnits: designatedFacts.filter(x => !x.controlDelivered && x.candidateDelivered).length, lostUnits: designatedFacts.filter(x => x.controlDelivered && !x.candidateDelivered).length,
      answerStatus: { control: 'not_attempted', candidate: 'not_attempted' } });
  }
  const sourceBenefit = cases.some(x => x.recoveredUnits > 0) && cases.every(x => x.lostUnits === 0);
  return { format: 'ablatrix-amazon-pqa-comparison-preparation-v4' as const, freezeSha256: f.sha256, selectionSha256: freshSeal(selection), corpusSha256: freshSeal(corpus),
    control: f.protocol.document.control, candidate: f.protocol.document.candidate, cases, proposedAnswers: cases.length * 2 * f.protocol.document.repeats, repeats: f.protocol.document.repeats,
    sourceBenefit, stopReason: cases.some(x => x.lostUnits > 0) ? 'designated_control_fact_lost' : sourceBenefit ? null : 'no_designated_missing_fact_delivered_by_candidate',
    providerCalls: 0 as const, generatedAnswers: 0 as const, humanSourceCheckedAnswers: 0 as const, qualityClaimEligible: false as const, activationAuthorized: false as const, paidExecutionAuthorized: false as const, paidPlan: null };
}
export type AmazonPqaComparisonV4 = Awaited<ReturnType<typeof prepareAmazonPqaComparisonV4>>;
export async function verifyAmazonPqaComparisonV4(f: AmazonPqaFreezeV4, s: AmazonPqaArtifact<AmazonPqaScreening>, reviews: AmazonPqaArtifact<AmazonPqaEligibilityReviewV4>[], selection: AmazonPqaSelectionV4, saved: AmazonPqaComparisonV4) {
  const corpus = amazonPqaCorpusV4(f, s, selection);
  const replay = await prepareAmazonPqaComparisonV4(f, s, reviews, selection, { async diagnose(productId, question) {
    const row = saved.cases.find(x => x.product.id === productId && x.question === question); assert.ok(row);
    const result = await replaySavedStages(corpus, productId, question, row.retrieval.trace); assert.deepEqual(result.passages, row.retrieval.result.passages);
    return { result: row.retrieval.result, trace: row.retrieval.trace };
  } }, async (query, documents) => { const row = saved.cases.find(x => x.retrieval.control.proposal.actualInputs.query === query); assert.ok(row); return replayScorer(row.retrieval.control.proposal.actualInputs)(query, documents); });
  const deterministic = (value: AmazonPqaComparisonV4) => { const clone = structuredClone(value); for (const c of clone.cases) for (const arm of [c.retrieval.control, c.retrieval.candidate]) delete (arm.proposal as Partial<typeof arm.proposal>).resources; return clone; };
  assert.deepEqual(deterministic(saved), deterministic(replay), 'Every fixed source, input, stage, context, uncertainty and designated unit must replay.'); return saved;
}
export function reportAmazonPqaV4(f: AmazonPqaFreezeV4, s: AmazonPqaArtifact<AmazonPqaScreening>, selection: AmazonPqaSelectionV4, comparison?: AmazonPqaComparisonV4) {
  nativeScreening(f, s); const source = selection.sourceOnlyEligibilityCalculation;
  assert.equal(selection.freezeSha256, f.sha256); assert.equal(selection.screeningFileSha256, s.fileSha256);
  if (comparison) { assert.equal(comparison.freezeSha256, f.sha256); assert.equal(comparison.selectionSha256, freshSeal(selection)); assert.deepEqual(comparison.cases.map(x => x.caseId), source.selectedCaseIds); }
  const facts = comparison?.cases.flatMap(x => x.designatedFacts) ?? [], rejectionReasons: Record<string, number> = {};
  for (const d of s.document.decisions) for (const reason of d.reasons) rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
  return { format: 'ablatrix-amazon-pqa-offline-report-v4', freezeSha256: f.sha256, control: f.protocol.document.control, candidate: f.protocol.document.candidate,
    status: source.stopReason ?? comparison?.stopReason ?? (comparison ? 'offline_comparison_prepared' : 'source_selection_complete'), inspectedQuestions: source.inspectedQuestions,
    inspectedUniqueProducts: new Set(s.document.decisions.flatMap(x => x.productId ? [x.productId] : x.packet ? [x.packet.product.id] : [])).size,
    automaticEligibleQuestions: s.document.decisions.filter(x => x.eligible).length, sourceEligibleQuestions: source.eligibleQuestions, selectedUniqueProducts: source.selectedProducts,
    rejectedOrUncertainQuestions: source.inspectedQuestions - source.eligibleQuestions,
    rejectionReasons, adjudicatedUncertainQuestions: source.adjudicatedCases.filter(x => x.decision === 'uncertain').length,
    selectedCasesWithUnknowns: source.adjudicatedCases.filter(x => source.selectedCaseIds.includes(x.caseId) && x.unknowns.length > 0).length,
    designatedSourceUnits: facts.length, controlDeliveredUnits: facts.filter(x => x.controlDelivered).length, candidateDeliveredUnits: facts.filter(x => x.candidateDelivered).length,
    recoveredUnits: facts.filter(x => !x.controlDelivered && x.candidateDelivered).length, lostUnits: facts.filter(x => x.controlDelivered && !x.candidateDelivered).length,
    completePacketCases: comparison?.cases.filter(x => x.retrieval.candidate.packetCompletion.completePacketFits).length ?? 0,
    casesExactlyV6Fallback: comparison?.cases.filter(x => x.retrieval.candidate.packetCompletion.fallbackExactlyV6).length ?? 0,
    casesAllDesignatedUnitsDeliveredByControl: comparison?.cases.filter(x => x.designatedFacts.every(f => f.controlDelivered)).length ?? 0,
    casesAllDesignatedUnitsDeliveredByCandidate: comparison?.cases.filter(x => x.designatedFacts.every(f => f.candidateDelivered)).length ?? 0,
    proposedAnswers: comparison?.proposedAnswers ?? 0, generatedAnswers: 0, providerCalls: 0, humanSourceCheckedAnswers: 0, qualityClaimEligible: false, activationAuthorized: false, paidExecutionAuthorized: false, paidPlan: null,
    limitation: 'Freshness is relative to the bound exposure inventory. Exact designated source/quote delivery is not semantic answer correctness. AI-only source review and offline retrieval do not establish answer-quality improvement; model pretraining overlap is unknown.' };
}
