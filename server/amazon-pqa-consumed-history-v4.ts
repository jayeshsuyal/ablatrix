/** Whole consumed-frame custody. This module can create exposure history only;
 * it has no fresh selection, candidate inference, transport or provider path. */
import assert from 'node:assert/strict';
import { freshSeal } from './fresh-validation-v2.ts';
import { parseAmazonPqaReleaseV2, projectAmazonPqaReleaseExposureV2, projectAmazonPqaReleaseFragmentsV2, validateAmazonPqaReleasePinV2,
  type AmazonPqaReleasePinV2 } from './amazon-pqa-release-v2.ts';
import type { AmazonPqaArtifact } from './amazon-pqa-validation-v1.ts';
import type { AmazonPqaExposure } from './amazon-pqa-source-v1.ts';

export const CONSUMED_HISTORY_V4 = 'amazon-pqa-whole-consumed-frame-history-v4' as const;
export const EXPOSURE_FIELDS_V4 = ['productIds', 'canonicalFamilyTitles', 'modelIdentifiers', 'sourceBodyFingerprints', 'sourcePacketFingerprints'] as const;
type Json = Record<string, any>;
export type ConsumedFrameInputV4 = { priorHistory: AmazonPqaArtifact<Json>; priorResolvedPrefixProjection: AmazonPqaArtifact<Json>; leadingBoundary: AmazonPqaArtifact<Json>;
  sourcePin: AmazonPqaArtifact<AmazonPqaReleasePinV2>; consumedFrame: AmazonPqaArtifact<Json>; screening: AmazonPqaArtifact<Json>; implementationSha256: Record<string, string>; input: { path: string; fileSha256: string } };
const sha = (value: unknown) => assert.ok(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'Exact raw SHA256 binding required.');
function artifact(value: AmazonPqaArtifact) { assert.ok(value.path); sha(value.fileSha256); }
function flags(value: Json) { assert.equal(value.providerCalls, 0); if ('qualityClaimEligible' in value) assert.equal(value.qualityClaimEligible, false); }
function mergeExposure(...values: AmazonPqaExposure[]): AmazonPqaExposure {
  const fields = [...EXPOSURE_FIELDS_V4, 'targetQuestionFingerprints', 'targetAnswerFingerprints'] as const;
  return Object.fromEntries(fields.map(key => [key, [...new Set(values.flatMap(value => value[key] ?? []))].sort()])) as AmazonPqaExposure;
}
export function mapAmazonPqaConsumedFrameV4(input: ConsumedFrameInputV4, objects: Map<string, Buffer | string>) {
  for (const a of [input.priorHistory, input.priorResolvedPrefixProjection, input.leadingBoundary, input.sourcePin, input.consumedFrame, input.screening]) artifact(a);
  Object.values(input.implementationSha256).forEach(sha); assert.ok(Object.keys(input.implementationSha256).length > 0);
  const history = input.priorHistory.document, consumed = input.consumedFrame.document, saved = input.screening.document, pin = input.sourcePin.document;
  validateAmazonPqaReleasePinV2(pin); flags(history); flags(consumed); flags(saved);
  assert.equal(history.format, 'ablatrix-amazon-pqa-protected-history-v2'); assert.equal(history.executionRuntime, 'native-release-runtime-v3');
  assert.equal(history.completeHistoricalUnion, true); assert.equal(history.priorConsumedPrefixMappingVerified, true); assert.equal(history.unresolvedPriorSemanticExposure, false);
  assert.equal(consumed.format, 'ablatrix-amazon-pqa-consumed-frame-v2'); assert.equal(consumed.wholeFrameConsumed, true);
  assert.equal(consumed.freshReuseEligible, false); assert.equal(consumed.nextProtocolMustExcludeThisFrame, true); assert.equal(consumed.generatedAnswersUsed, false);
  assert.equal(consumed.sourceEligibilityUsedCandidateOutputs, false); assert.deepEqual(consumed.sourcePrefixes, pin.objects, 'The entire consumed transport interval must remain identical.');
  assert.equal(consumed.sourceScreeningFileSha256, input.screening.fileSha256); assert.equal(saved.format, 'ablatrix-amazon-pqa-release-screening-v2');
  assert.equal(saved.mode, 'prospective_source_screening'); assert.equal(saved.sourcePinSha256, freshSeal(pin));
  assert.equal(history.contracts.consumedPrefixProjection.fileSha256, input.priorResolvedPrefixProjection.fileSha256);
  assert.equal(input.priorResolvedPrefixProjection.document.boundaryResolution.fileSha256, input.leadingBoundary.fileSha256);
  const boundary = input.leadingBoundary.document;
  assert.equal(boundary.boundary.resolved, true); assert.equal(boundary.boundary.bodyExposureComplete, true); assert.equal(boundary.newCompleteRowsInspected, 0);
  assert.equal(boundary.boundary.currentSourcePinSha256, freshSeal(pin));
  if (pin.provenance === 'publisher_dataset') {
    assert.deepEqual(pin.objects[0]!.range, { start: 16 * 1024 * 1024, endInclusive: 32 * 1024 * 1024 - 1 });
    assert.equal(pin.objects[0]!.bytes, 16 * 1024 * 1024);
  }
  // Parse every complete physical row of the already consumed frame. A finite
  // row ceiling is a stop condition, never permission to omit an unseen tail.
  const parsed = parseAmazonPqaReleaseV2(pin, objects, 100_000);
  assert.equal(parsed.inspection.completePrefixCoverage, true); assert.equal(parsed.inspection.unparsedTail, null, 'Whole-frame exposure mapping cannot truncate complete rows.');
  assert.deepEqual(parsed.inspection.physicalRowOffsets.slice(0, saved.inspection.completeRows), saved.inspection.physicalRowOffsets);
  assert.equal(saved.screeningDenominator, saved.inspection.completeRows); assert.ok(saved.screeningDenominator <= parsed.records.length);
  assert.deepEqual(saved.decisions.map((row: Json) => [row.row, row.productId]), parsed.records.slice(0, saved.screeningDenominator).map(row => [row.row, row.product.id]));
  assert.ok(parsed.inspection.leadingFragment && parsed.inspection.leadingFragment.sha256 === boundary.boundary.currentFragmentSha256, 'The skipped leading row must be the exact previously resolved historical boundary.');
  const rows = projectAmazonPqaReleaseExposureV2(parsed), fragments = projectAmazonPqaReleaseFragmentsV2(pin, objects, parsed);
  assert.equal(rows.normalization.pythonVersion, history.normalization.pythonVersion); assert.equal(rows.normalization.unicodeVersion, history.normalization.unicodeVersion);
  const exposure = mergeExposure(rows.consumedExposure, fragments.consumedExposure, boundary.boundary.consumedExposure);
  for (const field of EXPOSURE_FIELDS_V4) {
    const protectedValues = new Set([...history[field], ...exposure[field]]);
    assert.ok(consumed.consumedExposure[field].every((value: string) => protectedValues.has(value)), 'Full replay must contain every previously mapped source identity/hash: ' + field);
  }
  const unresolved = parsed.inspection.trailingFragment !== null;
  const bindings = Object.fromEntries([input.priorHistory, input.priorResolvedPrefixProjection, input.leadingBoundary, input.sourcePin, input.consumedFrame, input.screening].map(a => [a.path, a.fileSha256]));
  const document = { format: 'ablatrix-amazon-pqa-consumed-frame-replay-v4' as const, contract: CONSUMED_HISTORY_V4, input: input.input,
    artifactSha256: bindings, implementationSha256: input.implementationSha256, sourcePrefixes: structuredClone(pin.objects), nativeSchema: pin.schemaId,
    semanticRowsInspected: parsed.records.length, previouslyInspectedRows: saved.screeningDenominator, newlyMappedExposedRows: parsed.records.length - saved.screeningDenominator,
    inspection: parsed.inspection, consumedExposure: exposure, normalization: rows.normalization,
    withheldAggregateFingerprints: [...new Set([...rows.withheldAggregateFingerprints, ...fragments.withheldAggregateFingerprints, ...(boundary.boundary.withheldAggregateFingerprints ?? [])])].sort(),
    fragments, completeRowsMapped: true, completeFrameMapping: !unresolved, unresolvedTrailingRow: unresolved, unparsedTailExposureResolved: true,
    nextRequiredBoundary: parsed.inspection.trailingFragment ? { objectKey: pin.objects[0]!.key, versionId: pin.objects[0]!.versionId,
      nextByte: pin.objects[0]!.range!.endInclusive + 1, trailingFragment: parsed.inspection.trailingFragment, purpose: 'adjacent_row_exclusion_only' } : null,
    wholeFrameConsumed: true, developmentOnly: true, currentSampleFreshReuseEligible: false, sourceSelectionAllowed: false,
    candidateContextInspectedByReplay: false, answerOutputsInspected: false, providerCalls: 0, generatedAnswers: 0, humanSourceCheckedAnswers: 0,
    qualityClaimEligible: false, activationAuthorized: false, paidExecutionAuthorized: false, paidPlan: null };
  return { ...document, replaySha256: freshSeal(document) };
}
export type ConsumedFrameReplayV4 = ReturnType<typeof mapAmazonPqaConsumedFrameV4>;
function prefixes(history: Json, mapped: ConsumedFrameReplayV4) {
  const all = [...(history.priorConsumedSourcePrefixes ?? []), ...(history.consumedSourcePrefixes ?? []), ...mapped.sourcePrefixes];
  const byIdentity = new Map<string, Json>();
  for (const source of all) {
    sha(source.sha256); assert.ok(source.range && Number.isSafeInteger(source.range.start) && Number.isSafeInteger(source.range.endInclusive));
    const key = JSON.stringify([source.key, source.versionId, source.range]);
    if (byIdentity.has(key)) assert.equal(byIdentity.get(key)!.sha256, source.sha256, 'A consumed interval cannot acquire another checksum.');
    byIdentity.set(key, { key: source.key, versionId: source.versionId, sha256: source.sha256, range: source.range });
  }
  return [...byIdentity.values()].sort((a, b) => a.key.localeCompare(b.key) || String(a.versionId).localeCompare(String(b.versionId)) || a.range.start - b.range.start);
}
export function unionAmazonPqaConsumedHistoryV4(prior: AmazonPqaArtifact<Json>, frame: AmazonPqaArtifact<ConsumedFrameReplayV4>, implementationSha256: Record<string, string>) {
  artifact(prior); artifact(frame); const previous = prior.document, mapped = frame.document;
  assert.equal(previous.completeHistoricalUnion, true); assert.equal(mapped.format, 'ablatrix-amazon-pqa-consumed-frame-replay-v4');
  const body = { ...mapped } as Partial<ConsumedFrameReplayV4>; delete body.replaySha256; assert.equal(mapped.replaySha256, freshSeal(body));
  assert.equal(mapped.artifactSha256[prior.path], prior.fileSha256); assert.equal(mapped.unparsedTailExposureResolved, true); assert.equal(mapped.developmentOnly, true);
  const all = prefixes(previous, mapped); assert.ok(all.length >= 2, 'Both separately committed whole frames must remain protected.');
  const protectedExposure = Object.fromEntries(EXPOSURE_FIELDS_V4.map(field => [field, [...new Set([...(previous[field] as string[]), ...mapped.consumedExposure[field]])].sort()]));
  const document = { format: 'ablatrix-amazon-pqa-protected-history-v4' as const, contract: CONSUMED_HISTORY_V4,
    contracts: { priorRuntimeHistory: { path: prior.path, fileSha256: prior.fileSha256 }, currentConsumedFrameReplay: { path: frame.path, fileSha256: frame.fileSha256 } },
    implementationSha256, ...protectedExposure, normalization: previous.normalization, incidentalUnknownFamilyProductIds: previous.incidentalUnknownFamilyProductIds,
    priorPublicArtifactSha256: previous.priorPublicArtifactSha256, priorEmbeddedArtifactSha256: previous.priorEmbeddedArtifactSha256,
    priorConsumedSourcePrefixes: all, consumedSourcePrefixes: all, completeHistoricalUnion: true,
    priorConsumedCompleteRowsMappingVerified: true, priorConsumedPrefixMappingVerified: !mapped.unresolvedTrailingRow,
    unresolvedPriorSemanticExposure: mapped.unresolvedTrailingRow, unresolvedTrailingBoundary: mapped.nextRequiredBoundary,
    unparsedTailExposureResolved: true, wholeConsumedFramesProtected: all.length, currentSampleWasExposed: true, currentSampleFreshReuseEligible: false,
    sourceSelectionAllowed: false, withheldAggregateFingerprints: [...new Set([...(previous.withheldAggregateFingerprints ?? []), ...mapped.withheldAggregateFingerprints])].sort(),
    targetQuestionFingerprints: [...new Set([...(previous.targetQuestionFingerprints ?? []), ...mapped.consumedExposure.targetQuestionFingerprints])].sort(),
    targetAnswerFingerprints: [...new Set([...(previous.targetAnswerFingerprints ?? []), ...mapped.consumedExposure.targetAnswerFingerprints])].sort(),
    candidateOutputsUsedForHistoricalIdentity: false, generatedAnswersUsed: false, providerCalls: 0, humanSourceCheckedAnswers: 0,
    qualityClaimEligible: false, activationAuthorized: false, paidExecutionAuthorized: false, paidPlan: null };
  return { ...document, historySha256: freshSeal(document) };
}
export function resolveAmazonPqaConsumedHistoryV4(pending: AmazonPqaArtifact<Json>, repair: AmazonPqaArtifact<Json>, implementationSha256: Record<string, string>): Json {
  artifact(pending); artifact(repair); const p = pending.document, r = repair.document;
  assert.equal(p.format, 'ablatrix-amazon-pqa-protected-history-v4'); assert.equal(p.unresolvedPriorSemanticExposure, true);
  assert.equal(r.format, 'ablatrix-amazon-pqa-consumed-boundary-repair-v4'); assert.equal(r.historyFileSha256, pending.fileSha256);
  assert.equal(r.newCompleteRowsInspected, 0); assert.equal(r.sourceSelectionAllowed, false); assert.equal(r.boundary.resolved, true); assert.equal(r.boundary.bodyExposureComplete, true);
  assert.equal(r.boundary.boundaryNeverSelectable, true); flags(r);
  assert.equal(r.boundary.normalization.pythonVersion, p.normalization.pythonVersion); assert.equal(r.boundary.normalization.unicodeVersion, p.normalization.unicodeVersion);
  const priorBody = { ...p }; delete priorBody.historySha256; assert.equal(p.historySha256, freshSeal(priorBody));
  const union = Object.fromEntries(EXPOSURE_FIELDS_V4.map(field => [field, [...new Set([...(p[field] as string[]), ...r.boundary.consumedExposure[field]])].sort()]));
  const document: Json = { ...p, contracts: { pendingHistory: { path: pending.path, fileSha256: pending.fileSha256 }, boundaryRepair: { path: repair.path, fileSha256: repair.fileSha256 } },
    implementationSha256, ...union, priorConsumedPrefixMappingVerified: true, unresolvedPriorSemanticExposure: false, unresolvedTrailingBoundary: null,
    boundaryExclusionCommitments: [...(p.boundaryExclusionCommitments ?? []), { repairFileSha256: repair.fileSha256, currentSourcePinFileSha256: r.currentSourcePinFileSha256,
      currentSourcePinSha256: r.boundary.currentSourcePinSha256, currentFragmentSha256: r.boundary.currentFragmentSha256,
      reconstructedRowSha256: r.boundary.reconstructedRowSha256, reconstructedBytes: r.boundary.reconstructedBytes,
      currentLeadingBytesInspected: r.currentLeadingBytesInspected, boundaryNeverSelectable: true, newCompleteRowsInspected: 0 }],
    withheldAggregateFingerprints: [...new Set([...(p.withheldAggregateFingerprints ?? []), ...r.boundary.withheldAggregateFingerprints])].sort(),
    targetQuestionFingerprints: [...new Set([...(p.targetQuestionFingerprints ?? []), ...r.boundary.consumedExposure.targetQuestionFingerprints])].sort(),
    targetAnswerFingerprints: [...new Set([...(p.targetAnswerFingerprints ?? []), ...r.boundary.consumedExposure.targetAnswerFingerprints])].sort(),
    futureCompleteRowSourceAccessStillRequiresIndependentQualification: true, sourceSelectionAllowed: false };
  delete document.historySha256;
  return { ...document, historySha256: freshSeal(document) };
}
