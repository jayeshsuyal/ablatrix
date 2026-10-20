/** Native-release v2 boundary. Immutable v1 calculations are reused only through
 * explicitly named in-memory projections, never as a publisher schema claim. */
import assert from 'node:assert/strict';
import { freshSeal } from './fresh-validation-v2.ts';
import { freezeAmazonPqaV1, reviewAmazonPqaAccessV1, amazonPqaEligibilityRequestV1, selectAmazonPqaCasesV1, amazonPqaCorpusV1,
  prepareAmazonPqaComparisonV1, verifyAmazonPqaComparisonV1, reportAmazonPqaV1, AMAZON_PQA_REQUIRED_CODE,
  type AmazonPqaArtifact, type AmazonPqaProtocol, type AmazonPqaFreeze, type AmazonPqaAccessReview, type AmazonPqaEligibilityReview, type AmazonPqaScreening } from './amazon-pqa-validation-v1.ts';
import { validateAmazonPqaReleasePinV2, projectAmazonPqaReleaseGuardPinV2, type AmazonPqaReleasePinV2 } from './amazon-pqa-release-v2.ts';

export { AMAZON_PQA_MODEL_ASSETS, AMAZON_PQA_ACCESS_CHECKS, amazonPqaArtifact } from './amazon-pqa-validation-v1.ts';
export const AMAZON_PQA_V2_PROJECTION = 'native-release-v2-to-immutable-v1-calculation-only' as const;
export const AMAZON_PQA_RELEASE_REQUIRED_CODE = [...AMAZON_PQA_REQUIRED_CODE, 'server/amazon-pqa-release-v2.ts', 'server/amazon-pqa-validation-v2.ts',
  'scripts/amazon-pqa-validation-v2.ts', 'scripts/prepare-amazon-pqa-history-v2.py', 'scripts/acquire-amazon-pqa-v2.py'] as const;
export type AmazonPqaProtocolV2 = Omit<AmazonPqaProtocol, 'format'> & { format: 'ablatrix-amazon-pqa-protocol-v2';
  nativeSchemaContract: 'amazon-pqa-released-fields-v2'; sourceAccessScope: 'prospective_next_range'; consumedFrameNeverFresh: true };
export type AmazonPqaFreezeV2 = Omit<AmazonPqaFreeze, 'format' | 'protocol' | 'sourcePin'> & { format: 'ablatrix-amazon-pqa-freeze-v2'; protocol: AmazonPqaArtifact<AmazonPqaProtocolV2>;
  sourcePin: AmazonPqaArtifact<AmazonPqaReleasePinV2>; calculationProjectionContract: typeof AMAZON_PQA_V2_PROJECTION };
export type AmazonPqaAccessReviewV2 = Omit<AmazonPqaAccessReview, 'format'> & { format: 'ablatrix-amazon-pqa-source-access-review-v2' };
export type AmazonPqaEligibilityReviewV2 = Omit<AmazonPqaEligibilityReview, 'format'> & { format: 'ablatrix-amazon-pqa-source-eligibility-review-v2' };
type FreezeInput = Pick<AmazonPqaFreezeV2, 'protocol' | 'sourcePin' | 'history' | 'historicalInputs' | 'implementationSha256'>;
function internalArtifact<T>(name: string, document: T): AmazonPqaArtifact<T> {
  return { path: `IN_MEMORY_CALCULATION_ONLY/${name}`, fileSha256: freshSeal(document), document };
}
function calculationFreeze(input: FreezeInput) {
  // The old validator sees a guard contract on normalized records. This pin is
  // never used to read bytes, and its synthetic key commits the native schema,
  // source identity, range and exact source pin together.
  const pin = projectAmazonPqaReleaseGuardPinV2(input.sourcePin.document);
  assert.ok(pin.objects.every(o => o.key.includes(freshSeal(input.sourcePin.document))), 'Calculation guard identity must bind the complete native source pin.');
  const historicalInputs = [...new Map([...input.historicalInputs, input.protocol, input.sourcePin].map(a => [a.fileSha256, a])).values()];
  return freezeAmazonPqaV1({ ...input, historicalInputs, protocol: internalArtifact('protocol-header-v1.json', { ...input.protocol.document, format: 'ablatrix-amazon-pqa-protocol-v1', expectedHistoryArtifactSha256: historicalInputs.map(a => a.fileSha256) }),
    sourcePin: internalArtifact('normalized-record-guard-pin-v1.json', pin) });
}
function nativeInput(input: FreezeInput) {
  assert.equal(input.protocol.document.format, 'ablatrix-amazon-pqa-protocol-v2');
  assert.equal(input.protocol.document.nativeSchemaContract, 'amazon-pqa-released-fields-v2');
  assert.equal(input.protocol.document.sourceAccessScope, 'prospective_next_range'); assert.equal(input.protocol.document.consumedFrameNeverFresh, true);
  assert.deepEqual([...input.protocol.document.expectedHistoryArtifactSha256].sort(), input.historicalInputs.map(a => a.fileSha256).sort());
  validateAmazonPqaReleasePinV2(input.sourcePin.document);
  AMAZON_PQA_RELEASE_REQUIRED_CODE.forEach(path => assert.match(input.implementationSha256[path] ?? '', /^[a-f0-9]{64}$/));
  if (input.sourcePin.document.provenance === 'publisher_dataset') {
    const object = input.sourcePin.document.objects[0]!;
    assert.equal(object.range?.start, 16 * 1024 * 1024, 'V2 freezes the next interval, never the failed consumed prefix.');
    assert.equal(object.range?.endInclusive, 32 * 1024 * 1024 - 1); assert.equal(object.bytes, 16 * 1024 * 1024);
    const history = input.history.document as Record<string, unknown>;
    assert.equal(history.format, 'ablatrix-amazon-pqa-protected-history-v2'); assert.equal(history.completeHistoricalUnion, true);
    assert.equal(history.priorConsumedPrefixMappingVerified, true, 'Map all recognized exposure from the consumed first interval before fresh access.');
    assert.equal(history.unresolvedPriorSemanticExposure, false, 'A verified complete boundary resolution is required before prospective semantic access.');
  }
}
export function freezeAmazonPqaV2(input: FreezeInput): AmazonPqaFreezeV2 {
  nativeInput(input); calculationFreeze(input);
  const document = { format: 'ablatrix-amazon-pqa-freeze-v2' as const, ...structuredClone({ protocol: input.protocol, sourcePin: input.sourcePin, history: input.history, historicalInputs: input.historicalInputs, implementationSha256: input.implementationSha256 }), calculationProjectionContract: AMAZON_PQA_V2_PROJECTION,
    sourceBodiesInspected: false as const, candidateContextInspected: false as const, providerCalls: 0 as const, humanSourceCheckedAnswers: 0 as const,
    qualityClaimEligible: false as const, activationAuthorized: false as const, paidExecutionAuthorized: false as const };
  return { ...document, sha256: freshSeal(document) };
}
export function verifyAmazonPqaFreezeV2(freeze: AmazonPqaFreezeV2) {
  assert.deepEqual(freeze, freezeAmazonPqaV2({ protocol: freeze.protocol, sourcePin: freeze.sourcePin, history: freeze.history, historicalInputs: freeze.historicalInputs, implementationSha256: freeze.implementationSha256 })); return freeze;
}
export function withAmazonPqaReleaseAccessV2<T>(history: Record<string, unknown>, pin: AmazonPqaReleasePinV2, openSourceFiles: () => T): T {
  validateAmazonPqaReleasePinV2(pin);
  assert.ok(history.unresolvedPriorSemanticExposure === undefined || history.unresolvedPriorSemanticExposure === false, 'Unresolved prior semantic exposure blocks source access.');
  const prior = [...(history.priorConsumedSourcePrefixes as unknown[] ?? []), ...(history.consumedSourcePrefixes as unknown[] ?? [])];
  const interval = (value: unknown): [number, number] => { if (value === null) return [0, Infinity]; const r = value as { start: number; endInclusive: number };
    assert.ok(r && Number.isSafeInteger(r.start) && r.start >= 0 && Number.isSafeInteger(r.endInclusive) && r.endInclusive >= r.start); return [r.start, r.endInclusive]; };
  for (const previous of prior) {
    const p = previous as { key: string; versionId: string | null; range: unknown }; assert.ok(typeof p.key === 'string' && (p.versionId === null || typeof p.versionId === 'string'));
    const [a, b] = interval(p.range);
    for (const object of pin.objects) { const [x, y] = interval(object.range); assert.ok(!(p.key === object.key && p.versionId === object.versionId && a <= y && x <= b), 'Previously consumed native object/version range cannot re-enter fresh validation.'); }
  }
  return openSourceFiles();
}
function nativeReviews<T extends { format: string; freezeSha256: string; reviewer: string; independentReviewFileSha256: string[]; role: string }>(freeze: AmazonPqaFreezeV2, reviews: AmazonPqaArtifact<T>[], format: string) {
  verifyAmazonPqaFreezeV2(freeze); assert.equal(reviews.length, 3);
  assert.equal(new Set(reviews.map(r => r.fileSha256)).size, 3); assert.equal(new Set(reviews.map(r => r.document.reviewer.trim().toLowerCase())).size, 3);
  reviews.forEach((r, i) => { assert.match(r.fileSha256, /^[a-f0-9]{64}$/); assert.equal(r.document.format, format); assert.equal(r.document.freezeSha256, freeze.sha256);
    assert.equal(r.document.role, i === 2 ? 'adjudicator' : 'independent'); assert.deepEqual(r.document.independentReviewFileSha256, i === 2 ? reviews.slice(0, 2).map(x => x.fileSha256) : []);
    const document = r.document as unknown as Record<string, unknown>;
    for (const key of ['providerCalls', 'humanSourceCheckedAnswers']) assert.equal(document[key], 0);
    for (const key of ['qualityClaimEligible', 'activationAuthorized', 'candidateContextInspected', 'answerOutputsInspected']) assert.equal(document[key], false);
    assert.equal(document.provenance, 'independent_source_review_ai'); assert.equal(document.paidPlan, null);
    const kind = format.includes('eligibility') ? 'cases' : 'checks', rows = document[kind]; assert.ok(Array.isArray(rows));
    for (const [index, value] of rows.entries()) {
      const row = value as { decision: string; rationale: string; independentAssessmentSha256: string[]; disagreementResolution: string; unknowns?: string[]; retainedIndependentUnknowns?: string[] };
      assert.ok(['eligible', 'reject', 'uncertain'].includes(row.decision) && row.rationale.trim().length >= 20);
      const independent = i === 2 ? reviews.slice(0, 2).map(review => (review.document as unknown as Record<string, unknown[]>)[kind]![index] as typeof row) : [];
      assert.deepEqual(row.independentAssessmentSha256, independent.map(freshSeal), 'Native per-case/check review bindings must verify before projection.');
      if (i < 2) assert.equal(row.disagreementResolution, 'independent');
      else { assert.ok(['agree', 'source_resolved', 'unresolved'].includes(row.disagreementResolution)); if (row.disagreementResolution === 'agree') assert.ok(independent.every(x => x.decision === row.decision)); if (row.disagreementResolution === 'unresolved') assert.equal(row.decision, 'uncertain'); }
      if (kind === 'cases') { assert.ok(Array.isArray(row.unknowns)); assert.deepEqual(row.retainedIndependentUnknowns, [...new Set(independent.flatMap(x => x.unknowns!))]); }
    }
  });
}
function nativeScreening(freeze: AmazonPqaFreezeV2, screening: AmazonPqaArtifact<AmazonPqaScreening>) {
  assert.equal(screening.document.format, 'ablatrix-amazon-pqa-release-screening-v2'); assert.equal(screening.document.mode, 'prospective_source_screening', 'Development replay cannot become fresh qualification.');
  assert.equal(screening.document.sourcePinSha256, freshSeal(freeze.sourcePin.document));
}
export function reviewAmazonPqaAccessV2(freeze: AmazonPqaFreezeV2, reviews: AmazonPqaArtifact<AmazonPqaAccessReviewV2>[]) {
  nativeReviews(freeze, reviews, 'ablatrix-amazon-pqa-source-access-review-v2');
  const calc = calculationFreeze(freeze);
  // Exact native metadata quotes are checked before header projection. The old
  // guard then verifies the unchanged per-check conclusions/hash resolutions.
  const artifacts = [freeze.protocol, freeze.sourcePin, freeze.history, ...freeze.historicalInputs];
  for (const r of reviews) for (const check of r.document.checks) for (const e of check.evidence) {
    const source = artifacts.find(a => a.fileSha256 === e.artifactSha256); assert.ok(source && e.quote.trim().length >= 5 && JSON.stringify(source.document).includes(e.quote), 'Access evidence must quote exact bound native metadata.');
  }
  const evidenceProjection = reviews.map(r => ({ ...r, document: { ...r.document, format: 'ablatrix-amazon-pqa-source-access-review-v1' as const, freezeSha256: calc.sha256 } }));
  const projected = reviewAmazonPqaAccessV1(calc, evidenceProjection);
  return { ...projected, format: 'ablatrix-amazon-pqa-source-access-outcome-v2', freezeSha256: freeze.sha256, nativeSourcePinFileSha256: freeze.sourcePin.fileSha256,
    nativeSchema: freeze.sourcePin.document.schemaId, calculationProjectionContract: AMAZON_PQA_V2_PROJECTION, checks: reviews.map(r => r.document.checks) };
}
function eligibilityProjection(freeze: AmazonPqaFreezeV2, screening: AmazonPqaArtifact<AmazonPqaScreening>, reviews: AmazonPqaArtifact<AmazonPqaEligibilityReviewV2>[]) {
  nativeScreening(freeze, screening);
  nativeReviews(freeze, reviews, 'ablatrix-amazon-pqa-source-eligibility-review-v2'); const calc = calculationFreeze(freeze);
  reviews.forEach(r => assert.equal(r.document.screeningFileSha256, screening.fileSha256));
  return { calc, reviews: reviews.map(r => ({ ...r, document: { ...r.document, format: 'ablatrix-amazon-pqa-source-eligibility-review-v1' as const, freezeSha256: calc.sha256 } })) };
}
export function amazonPqaEligibilityRequestV2(freeze: AmazonPqaFreezeV2, screening: AmazonPqaArtifact<AmazonPqaScreening>) {
  verifyAmazonPqaFreezeV2(freeze); nativeScreening(freeze, screening); const request = amazonPqaEligibilityRequestV1(calculationFreeze(freeze), screening);
  return { ...request, format: 'ablatrix-amazon-pqa-source-eligibility-request-v2', freezeSha256: freeze.sha256, nativeSchema: freeze.sourcePin.document.schemaId,
    nativeSourcePinFileSha256: freeze.sourcePin.fileSha256, calculationProjectionContract: AMAZON_PQA_V2_PROJECTION };
}
export function selectAmazonPqaCasesV2(freeze: AmazonPqaFreezeV2, screening: AmazonPqaArtifact<AmazonPqaScreening>, reviews: AmazonPqaArtifact<AmazonPqaEligibilityReviewV2>[]) {
  const projected = eligibilityProjection(freeze, screening, reviews), calculation = selectAmazonPqaCasesV1(projected.calc, screening, projected.reviews);
  return { format: 'ablatrix-amazon-pqa-selection-v2' as const, freezeSha256: freeze.sha256, screeningFileSha256: screening.fileSha256, nativeSchema: freeze.sourcePin.document.schemaId,
    nativeSourcePinFileSha256: freeze.sourcePin.fileSha256, calculationProjectionContract: AMAZON_PQA_V2_PROJECTION, calculation };
}
export type AmazonPqaSelectionV2 = ReturnType<typeof selectAmazonPqaCasesV2>;
export function amazonPqaCorpusV2(freeze: AmazonPqaFreezeV2, screening: AmazonPqaArtifact<AmazonPqaScreening>, selection: AmazonPqaSelectionV2) {
  verifyAmazonPqaFreezeV2(freeze); nativeScreening(freeze, screening); assert.equal(selection.freezeSha256, freeze.sha256); assert.equal(selection.nativeSourcePinFileSha256, freeze.sourcePin.fileSha256);
  return amazonPqaCorpusV1(calculationFreeze(freeze), screening, selection.calculation);
}
export async function prepareAmazonPqaComparisonV2(freeze: AmazonPqaFreezeV2, screening: AmazonPqaArtifact<AmazonPqaScreening>, reviews: AmazonPqaArtifact<AmazonPqaEligibilityReviewV2>[], selection: AmazonPqaSelectionV2,
  retriever: Parameters<typeof prepareAmazonPqaComparisonV1>[4], scorer: Parameters<typeof prepareAmazonPqaComparisonV1>[5]) {
  assert.deepEqual(selection, selectAmazonPqaCasesV2(freeze, screening, reviews)); const projected = eligibilityProjection(freeze, screening, reviews);
  const calculation = await prepareAmazonPqaComparisonV1(projected.calc, screening, projected.reviews, selection.calculation, retriever, scorer);
  return { format: 'ablatrix-amazon-pqa-comparison-preparation-v2' as const, freezeSha256: freeze.sha256, selectionSha256: freshSeal(selection),
    nativeSchema: freeze.sourcePin.document.schemaId, nativeSourcePinFileSha256: freeze.sourcePin.fileSha256, calculationProjectionContract: AMAZON_PQA_V2_PROJECTION, calculation };
}
export async function verifyAmazonPqaComparisonV2(freeze: AmazonPqaFreezeV2, screening: AmazonPqaArtifact<AmazonPqaScreening>, reviews: AmazonPqaArtifact<AmazonPqaEligibilityReviewV2>[], selection: AmazonPqaSelectionV2,
  saved: Awaited<ReturnType<typeof prepareAmazonPqaComparisonV2>>) {
  assert.equal(saved.format, 'ablatrix-amazon-pqa-comparison-preparation-v2'); assert.equal(saved.freezeSha256, freeze.sha256); assert.equal(saved.selectionSha256, freshSeal(selection));
  assert.equal(saved.nativeSchema, freeze.sourcePin.document.schemaId); assert.equal(saved.nativeSourcePinFileSha256, freeze.sourcePin.fileSha256); assert.equal(saved.calculationProjectionContract, AMAZON_PQA_V2_PROJECTION);
  assert.deepEqual(selection, selectAmazonPqaCasesV2(freeze, screening, reviews)); const projected = eligibilityProjection(freeze, screening, reviews);
  await verifyAmazonPqaComparisonV1(projected.calc, screening, projected.reviews, selection.calculation, saved.calculation); return saved;
}
export function reportAmazonPqaV2(freeze: AmazonPqaFreezeV2, screening: AmazonPqaArtifact<AmazonPqaScreening>, selection: AmazonPqaSelectionV2, comparison?: Awaited<ReturnType<typeof prepareAmazonPqaComparisonV2>>) {
  verifyAmazonPqaFreezeV2(freeze); if (comparison) { assert.equal(comparison.freezeSha256, freeze.sha256); assert.equal(comparison.selectionSha256, freshSeal(selection)); }
  const report = reportAmazonPqaV1(calculationFreeze(freeze), screening, selection.calculation, comparison?.calculation);
  return { ...report, format: 'ablatrix-amazon-pqa-offline-report-v2', freezeSha256: freeze.sha256, nativeSchema: freeze.sourcePin.document.schemaId,
    nativeSourcePinFileSha256: freeze.sourcePin.fileSha256, calculationProjectionContract: AMAZON_PQA_V2_PROJECTION, sourceAccessScope: 'prospective_next_range', consumedFrameEligibleForFreshClaims: false };
}
