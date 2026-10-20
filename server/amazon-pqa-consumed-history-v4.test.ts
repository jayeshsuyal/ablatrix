/** Synthetic cached bytes only. No publisher download or provider operation. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { amazonPqaArtifact } from './amazon-pqa-validation-v1.ts';
import { freshSeal } from './fresh-validation-v2.ts';
import { textHash } from './product-corpus.ts';
import { parseAmazonPqaReleaseV2, projectAmazonPqaReleaseExposureV2, type AmazonPqaReleasePinV2 } from './amazon-pqa-release-v2.ts';
import { withAmazonPqaReleaseAccessV2 } from './amazon-pqa-validation-v2.ts';
import { mapAmazonPqaConsumedFrameV4, unionAmazonPqaConsumedHistoryV4, resolveAmazonPqaConsumedHistoryV4, EXPOSURE_FIELDS_V4 } from './amazon-pqa-consumed-history-v4.ts';
import { amazonPqaImplementationPathsRuntimeV3 } from '../scripts/amazon-pqa-validation-runtime-v3.ts';
import { amazonPqaConsumedHistoryCliV4 } from '../scripts/amazon-pqa-consumed-history-v4.ts';
const artifact = <T>(path: string, document: T) => amazonPqaArtifact<T>(path, JSON.stringify(document) + '\n');
function fixture() {
  const row = (i: number) => JSON.stringify({ question_id: `fictional-${i}`, question_text: `What about fictional attribute ${i}?`, asin: `B7${String(i).padStart(8, '0')}`,
    bullet_point1: `Fictional feature ${i} preserves a complete parent.`, bullet_point2: '', bullet_point3: '', bullet_point4: '', bullet_point5: '',
    product_description: `SYNTHETIC PRIVATE BODY CANARY ${i} is not a public report field.`, brand_name: `Brand${i}`, item_name: `Fictional device ${i}`, question_type: 'withheld', answer_aggregated: `annotation-only-${i}`,
    answers: [{ answer_text: `Fictional alternative one for ${i}.` }, { answer_text: `Fictional alternative two for ${i}.` }] });
  const leading = 'already-consumed trailing bytes finish here\n', raw = leading + [row(1), row(2), row(3)].join('\n') + '\n' + row(4).slice(0, 90), start = 10_000;
  const pin: AmazonPqaReleasePinV2 = { format: 'ablatrix-amazon-pqa-release-pin-v2', dataset: 'Amazon-PQA', split: 'unpartitioned', schemaId: 'amazon-pqa-released-fields-v2-jsonl', provenance: 'synthetic_fixture',
    objects: [{ role: 'category_records', key: 'SYNTHETIC-historical.jsonl', versionId: 'SYNTHETIC-immutable', sha256: textHash(raw), bytes: Buffer.byteLength(raw), sourceBytes: 100_000, range: { start, endInclusive: start + Buffer.byteLength(raw) - 1 } }] };
  const sourcePin = artifact('SYNTHETIC-native.json', pin), objects = new Map([[pin.objects[0]!.key, raw]]), first = parseAmazonPqaReleaseV2(pin, objects, 1), observed = projectAmazonPqaReleaseExposureV2(first);
  const leadingBoundary = artifact('SYNTHETIC-leading-boundary.json', { format: 'ablatrix-amazon-pqa-boundary-repair-v2', newCompleteRowsInspected: 0,
    boundary: { resolved: true, bodyExposureComplete: true, currentSourcePinSha256: freshSeal(pin), currentFragmentSha256: textHash(leading), consumedExposure: observed.consumedExposure, withheldAggregateFingerprints: [] } });
  const priorResolvedPrefixProjection = artifact('SYNTHETIC-old-projection.json', { boundaryResolution: { fileSha256: leadingBoundary.fileSha256 } });
  const priorHistory = artifact('SYNTHETIC-prior-history.json', { format: 'ablatrix-amazon-pqa-protected-history-v2', executionRuntime: 'native-release-runtime-v3',
    completeHistoricalUnion: true, priorConsumedPrefixMappingVerified: true, unresolvedPriorSemanticExposure: false, providerCalls: 0, qualityClaimEligible: false,
    contracts: { consumedPrefixProjection: { fileSha256: priorResolvedPrefixProjection.fileSha256 } }, normalization: { id: 'python_nfkc_casefold_whitespace_v1', pythonVersion: observed.normalization.pythonVersion, unicodeVersion: observed.normalization.unicodeVersion },
    ...Object.fromEntries(EXPOSURE_FIELDS_V4.map(field => [field, [...observed.consumedExposure[field]]])), incidentalUnknownFamilyProductIds: ['B000050B6Z'], priorPublicArtifactSha256: {}, priorEmbeddedArtifactSha256: {},
    consumedSourcePrefixes: [{ key: pin.objects[0]!.key, versionId: pin.objects[0]!.versionId, sha256: 'a'.repeat(64), range: { start: 0, endInclusive: start - 1 } }] });
  const screening = artifact('SYNTHETIC-screen.json', { format: 'ablatrix-amazon-pqa-release-screening-v2', mode: 'prospective_source_screening', sourcePinSha256: freshSeal(pin), providerCalls: 0,
    inspection: first.inspection, screeningDenominator: 1, decisions: first.records.map(r => ({ row: r.row, productId: r.product.id })) });
  const consumedFrame = artifact('SYNTHETIC-consumed.json', { format: 'ablatrix-amazon-pqa-consumed-frame-v2', wholeFrameConsumed: true, freshReuseEligible: false, nextProtocolMustExcludeThisFrame: true,
    generatedAnswersUsed: false, sourceEligibilityUsedCandidateOutputs: false, providerCalls: 0, sourcePrefixes: pin.objects, sourceScreeningFileSha256: screening.fileSha256, consumedExposure: observed.consumedExposure });
  const input = { sourcePin, priorHistory, priorResolvedPrefixProjection, leadingBoundary, screening, consumedFrame, implementationSha256: { 'SYNTHETIC-implementation.ts': 'b'.repeat(64) }, input: { path: 'SYNTHETIC-request.json', fileSha256: 'c'.repeat(64) } };
  return { input, objects, pin, fullTailRow: row(4) };
}
test('whole consumed replay maps every complete row and every answer alternative beyond the old finite screening prefix', () => {
  const f = fixture(), map = mapAmazonPqaConsumedFrameV4(f.input, f.objects);
  assert.equal(map.semanticRowsInspected, 3); assert.equal(map.previouslyInspectedRows, 1); assert.equal(map.newlyMappedExposedRows, 2);
  assert.equal(map.inspection.unparsedTail, null); assert.equal(map.unparsedTailExposureResolved, true); assert.equal(map.unresolvedTrailingRow, true); assert.equal(map.completeFrameMapping, false);
  assert.ok(map.consumedExposure.productIds.includes('B700000003'));
  for (const i of [2, 3]) for (const alternative of ['one', 'two']) assert.ok(map.consumedExposure.sourceBodyFingerprints.includes(textHash(JSON.stringify([`fictional alternative ${alternative} for ${i}.`]))));
  const annotation = textHash(JSON.stringify(['annotation-only-3'])); assert.ok(map.withheldAggregateFingerprints.includes(annotation)); assert.equal(map.consumedExposure.sourceBodyFingerprints.includes(annotation), false);
  assert.equal(JSON.stringify(map).includes('SYNTHETIC PRIVATE BODY CANARY'), false); assert.equal(map.sourceSelectionAllowed, false); assert.equal(map.currentSampleFreshReuseEligible, false);
});
test('whole-frame union protects both intervals and keeps unknown final-row exposure closed until exact exclusion repair', () => {
  const f = fixture(), mapped = artifact('SYNTHETIC-full-map.json', mapAmazonPqaConsumedFrameV4(f.input, f.objects));
  const pending = artifact('SYNTHETIC-pending-history.json', unionAmazonPqaConsumedHistoryV4(f.input.priorHistory, mapped, f.input.implementationSha256));
  assert.equal(pending.document.wholeConsumedFramesProtected, 2); assert.equal(pending.document.unresolvedPriorSemanticExposure, true); assert.equal(pending.document.priorConsumedPrefixMappingVerified, false);
  let reads = 0; assert.throws(() => withAmazonPqaReleaseAccessV2(pending.document, f.pin, () => { reads++; }), /Unresolved/); assert.equal(reads, 0);
  const repaired = artifact('SYNTHETIC-resolved-boundary.json', { format: 'ablatrix-amazon-pqa-consumed-boundary-repair-v4', historyFileSha256: pending.fileSha256,
    newCompleteRowsInspected: 0, sourceSelectionAllowed: false, currentSourcePinFileSha256: 'd'.repeat(64), currentLeadingBytesInspected: 12, providerCalls: 0,
    boundary: { resolved: true, bodyExposureComplete: true, boundaryNeverSelectable: true, currentSourcePinSha256: 'e'.repeat(64), currentFragmentSha256: 'f'.repeat(64), reconstructedRowSha256: '1'.repeat(64), reconstructedBytes: 50,
      normalization: f.input.priorHistory.document.normalization,
      consumedExposure: mapped.document.consumedExposure, withheldAggregateFingerprints: ['2'.repeat(64)] } });
  const resolved = resolveAmazonPqaConsumedHistoryV4(pending, repaired, f.input.implementationSha256);
  assert.equal(resolved.unresolvedPriorSemanticExposure, false); assert.equal(resolved.priorConsumedPrefixMappingVerified, true); assert.equal(resolved.consumedSourcePrefixes.length, 2);
  assert.equal(resolved.boundaryExclusionCommitments[0].newCompleteRowsInspected, 0); assert.equal(resolved.sourceSelectionAllowed, false);
  assert.throws(() => withAmazonPqaReleaseAccessV2(resolved, f.pin, () => { reads++; }), /Previously consumed/); assert.equal(reads, 0);
  const invalid = structuredClone(repaired); invalid.document.newCompleteRowsInspected = 1; assert.throws(() => resolveAmazonPqaConsumedHistoryV4(pending, invalid, f.input.implementationSha256));
});
test('changed native bytes or historical/raw-screen bindings cannot enter the consumed mapping', () => {
  const f = fixture(); assert.throws(() => mapAmazonPqaConsumedFrameV4(f.input, new Map([[f.pin.objects[0]!.key, f.objects.get(f.pin.objects[0]!.key)! + 'edited']])));
  const wrong = structuredClone(f.input); wrong.consumedFrame.document.sourceScreeningFileSha256 = '0'.repeat(64); assert.throws(() => mapAmazonPqaConsumedFrameV4(wrong, f.objects));
  const leading = structuredClone(f.input); leading.leadingBoundary.document.boundary.currentFragmentSha256 = '0'.repeat(64); assert.throws(() => mapAmazonPqaConsumedFrameV4(leading, f.objects), /exact previously resolved/);
});
test('synthetic CLI maps, unions, reviews boundary-only access and resolves exact history without touching fresh complete rows', async () => {
  const f = fixture(), root = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-history-v4-SYNTHETIC-')));
  try {
    const put = (path: string, document: unknown) => { const p = join(root, path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(document) + '\n'); return { path, fileSha256: textHash(readFileSync(p, 'utf8')) }; };
    const ref = (path: string) => ({ path, fileSha256: textHash(readFileSync(join(root, path), 'utf8')) });
    const load = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'));
    // Only the prior-proof subprocess boundary is synthetic. The real CLI,
    // native parser, byte bindings, row exposure and every new guard execute.
    for (const path of [...amazonPqaImplementationPathsRuntimeV3(), 'server/amazon-pqa-consumed-history-v4.ts', 'scripts/amazon-pqa-consumed-history-v4.ts']) {
      mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), `SYNTHETIC pinned ${path}`);
    }
    writeFileSync(join(root, 'scripts/prepare-amazon-pqa-history-runtime-v3.py'), 'import hashlib,json,pathlib,sys\np=pathlib.Path(sys.argv[-1]);print(json.dumps({"format":"ablatrix-amazon-pqa-history-proof-v2","historyFileSha256":hashlib.sha256(p.read_bytes()).hexdigest(),"providerCalls":0}))\n');
    const previous = put(f.input.priorHistory.path, f.input.priorHistory.document), projection = put(f.input.priorResolvedPrefixProjection.path, f.input.priorResolvedPrefixProjection.document),
      leading = put(f.input.leadingBoundary.path, f.input.leadingBoundary.document), source = put(f.input.sourcePin.path, f.input.sourcePin.document), consumed = put(f.input.consumedFrame.path, f.input.consumedFrame.document), screening = put(f.input.screening.path, f.input.screening.document);
    writeFileSync(join(root, 'cached.bin'), f.objects.get(f.pin.objects[0]!.key)!);
    put('map-input.json', { format: 'ablatrix-amazon-pqa-consumed-frame-input-v4', priorHistory: previous, priorResolvedPrefixProjection: projection, leadingBoundary: leading, sourcePin: source,
      consumedFrame: consumed, screening, objectFiles: { [f.pin.objects[0]!.key]: { path: 'cached.bin', fileSha256: f.pin.objects[0]!.sha256 } } });
    await amazonPqaConsumedHistoryCliV4(['--map', '--input', 'map-input.json', '--out', join(root, 'mapped.json')], root);
    put('union-input.json', { format: 'ablatrix-amazon-pqa-history-union-input-v4', priorRuntimeHistory: previous, currentConsumedFrameReplay: ref('mapped.json') });
    await amazonPqaConsumedHistoryCliV4(['--union', '--input', 'union-input.json', '--out', join(root, 'pending.json')], root);
    assert.equal(load('pending.json').wholeConsumedFramesProtected, 2); assert.equal(load('pending.json').unresolvedPriorSemanticExposure, true);
    const before = readFileSync(join(root, 'mapped.json'), 'utf8'); await assert.rejects(amazonPqaConsumedHistoryCliV4(['--map', '--input', 'NONEXISTENT-INPUT-MUST-NOT-BE-READ', '--out', join(root, 'mapped.json')], root)); assert.equal(readFileSync(join(root, 'mapped.json'), 'utf8'), before);
    const raw = f.fullTailRow.slice(90) + '\nMALFORMED FRESH COMPLETE ROW MUST NOT BE PARSED\n', object = f.pin.objects[0]!, start = object.range!.endInclusive + 1;
    const nextPin: AmazonPqaReleasePinV2 = { ...f.pin, objects: [{ ...object, sha256: textHash(raw), bytes: Buffer.byteLength(raw), range: { start, endInclusive: start + Buffer.byteLength(raw) - 1 } }] };
    const nextRef = put('next-pin.json', nextPin), boundary = { format: 'ablatrix-amazon-pqa-consumed-boundary-input-v4', history: ref('pending.json'), currentSourcePin: nextRef,
      objectFiles: { [object.key]: { path: 'new-frame-not-present-yet.bin', fileSha256: nextPin.objects[0]!.sha256 } } };
    put('boundary-input.json', boundary); await amazonPqaConsumedHistoryCliV4(['--boundary-request', '--input', 'boundary-input.json', '--out', join(root, 'request.json')], root);
    await assert.rejects(amazonPqaConsumedHistoryCliV4(['--boundary-repair', '--input', 'boundary-input.json', '--out', join(root, 'denied-repair.json')], root), error => error instanceof assert.AssertionError);
    const request = load('request.json'), reviews = [0, 1].map(i => put(`review-${i}.json`, { format: 'ablatrix-amazon-pqa-consumed-boundary-review-v4', reviewSubjectSha256: request.reviewSubjectSha256,
      reviewer: `SYNTHETIC independent reviewer ${i}`, provenance: 'independent_source_review_ai', role: 'independent', independentReviewFileSha256: [], decision: 'eligible',
      sourceEvidence: 'SYNTHETIC exact adjacent native frame pins permit only old boundary-row exclusion; no complete fresh row is inspected.', retainedUncertainty: ['SYNTHETIC strict boundary decoding may still fail.'], providerCalls: 0, humanSourceCheckedAnswers: 0, qualityClaimEligible: false, activationAuthorized: false, paidPlan: null }));
    reviews.push(put('review-2.json', { ...load('review-0.json'), reviewer: 'SYNTHETIC third reviewer', role: 'adjudicator', independentReviewFileSha256: reviews.map(r => r.fileSha256) }));
    put('boundary-input.json', { ...boundary, accessReviews: reviews }); writeFileSync(join(root, 'new-frame-not-present-yet.bin'), raw);
    await amazonPqaConsumedHistoryCliV4(['--boundary-repair', '--input', 'boundary-input.json', '--out', join(root, 'repair.json')], root); assert.equal(load('repair.json').boundary.resolved, true); assert.equal(load('repair.json').newCompleteRowsInspected, 0);
    put('resolve-input.json', { format: 'ablatrix-amazon-pqa-history-resolution-input-v4', pendingHistory: ref('pending.json'), boundaryRepair: ref('repair.json') });
    await amazonPqaConsumedHistoryCliV4(['--resolve-history', '--input', 'resolve-input.json', '--out', join(root, 'resolved.json')], root);
    const proof = await amazonPqaConsumedHistoryCliV4(['--verify-history', '--input', 'resolved.json'], root);
    assert.equal('wholeConsumedFramesProtected' in proof && proof.wholeConsumedFramesProtected, 2); assert.equal('unresolvedPriorSemanticExposure' in proof && proof.unresolvedPriorSemanticExposure, false);
    assert.equal(load('resolved.json').sourceSelectionAllowed, false); await assert.rejects(amazonPqaConsumedHistoryCliV4(['--execute', '--input', 'ignored'], root));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
