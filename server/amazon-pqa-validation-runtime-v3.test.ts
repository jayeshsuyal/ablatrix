/** Native-schema synthetic mechanics only; no publisher bytes or provider calls. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { textHash } from './product-corpus.ts';
import { freshSeal } from './fresh-validation-v2.ts';
import { ProductRetriever } from './product-retrieval.ts';
import { WORKSPACE_UNCERTAINTY_CONTRACT } from './workspace-uncertainty-policy.ts';
import { parseAmazonPqaReleaseV2, screenAmazonPqaReleaseV2, type AmazonPqaReleasePinV2 } from './amazon-pqa-release-v2.ts';
import { amazonPqaArtifact, AMAZON_PQA_ACCESS_CHECKS, AMAZON_PQA_RELEASE_REQUIRED_CODE, AMAZON_PQA_V2_PROJECTION, freezeAmazonPqaV2, verifyAmazonPqaFreezeV2,
  reviewAmazonPqaAccessV2, withAmazonPqaReleaseAccessV2, amazonPqaEligibilityRequestV2, selectAmazonPqaCasesV2, amazonPqaCorpusV2,
  prepareAmazonPqaComparisonV2, verifyAmazonPqaComparisonV2, reportAmazonPqaV2, type AmazonPqaProtocolV2, type AmazonPqaAccessReviewV2, type AmazonPqaEligibilityReviewV2 } from './amazon-pqa-validation-v2.ts';
import { amazonPqaValidationCliV2, amazonPqaImplementationPathsV2 } from '../scripts/amazon-pqa-validation-v2.ts';
import { freezeAmazonPqaV1 } from './amazon-pqa-validation-v1.ts';

const artifact = <T>(path: string, value: T) => amazonPqaArtifact<T>(path, JSON.stringify(value) + '\n');
function fixture() {
  const titles = ['Solvex Cedar Vessel', 'Prython Amber Lantern', 'Velrune Indigo Frame', 'Solvex Cedar Vessel'];
  const raw = titles.map((title, i) => JSON.stringify({ question_id: `fictional-q-${i}`, question_text: `What is its ${['cedar', 'amber', 'indigo', 'vessel'][i]} material?`, asin: `B8${String(i === 3 ? 0 : i).padStart(8, '0')}`,
    bullet_point1: `${title} has a distinct fictional feature.`, bullet_point2: '', bullet_point3: '', bullet_point4: '', bullet_point5: '',
    product_description: `${title} has an exact synthetic description with no performance claim.`, brand_name: title.split(' ')[0], item_name: title, question_type: 'label withheld',
    answer_aggregated: `Fictional aggregate classification ${i}`, answers: [{ answer_text: `Fictional target alternative ${i} first.` }, { answer_text: `Fictional target alternative ${i} second.` }] })).join('\n') + '\n';
  const sourcePin = artifact<AmazonPqaReleasePinV2>('SYNTHETIC-native-pin.json', { format: 'ablatrix-amazon-pqa-release-pin-v2', dataset: 'Amazon-PQA', split: 'unpartitioned', schemaId: 'amazon-pqa-released-fields-v2-jsonl', provenance: 'synthetic_fixture',
    objects: [{ role: 'category_records', key: 'SYNTHETIC-native.json', versionId: null, sha256: textHash(raw), bytes: Buffer.byteLength(raw), sourceBytes: Buffer.byteLength(raw), range: null }] });
  const prior = artifact('SYNTHETIC-prior.json', { evidence: 'SYNTHETIC complete prior immutable exposure mapping.' });
  const history = artifact('SYNTHETIC-history-v2.json', { format: 'ablatrix-amazon-pqa-protected-history-v2', completeHistoricalUnion: true, priorConsumedPrefixMappingVerified: true, productIds: [], canonicalFamilyTitles: [], modelIdentifiers: [], sourceBodyFingerprints: [], sourcePacketFingerprints: [] });
  const protocol = artifact<AmazonPqaProtocolV2>('SYNTHETIC-protocol-v2.json', { format: 'ablatrix-amazon-pqa-protocol-v2', purpose: 'exploratory_ai_only', dataset: 'Amazon-PQA', publisherSplit: 'unpartitioned_release', use: 'prospective_exploratory_validation', sourceOrder: 'ascending_release_row',
    maxInspectedRecords: 4, targetPackets: 3, selectedProducts: 2, repeats: 1, maxParents: 128, maxBodyUtf16Units: 1500, maxQuestionUtf16Units: 1000, maxTitleUtf16Units: 500,
    control: 'workspace-semantic-supplement-v5-dev', candidate: 'workspace-semantic-supplement-v6-quantified-peer-dev', generationContract: WORKSPACE_UNCERTAINTY_CONTRACT,
    targetAnswersInRetrieval: false, replacementAfterScreening: false, model: 'SYNTHETIC never invoked', policyInstructions: 'SYNTHETIC identical instructions to preserve literal evidence and unresolved applicability.', expectedHistoryArtifactSha256: [prior.fileSha256], localModelAssetSha256: {},
    nativeSchemaContract: 'amazon-pqa-released-fields-v2', sourceAccessScope: 'prospective_next_range', consumedFrameNeverFresh: true });
  const freeze = freezeAmazonPqaV2({ protocol, sourcePin, history, historicalInputs: [prior], implementationSha256: Object.fromEntries(AMAZON_PQA_RELEASE_REQUIRED_CODE.map(path => [path, textHash(`SYNTHETIC ${path}`)])) });
  const parsed = parseAmazonPqaReleaseV2(sourcePin.document, new Map([[sourcePin.document.objects[0]!.key, raw]]), 4);
  const screening = artifact('SYNTHETIC-native-screen.json', screenAmazonPqaReleaseV2({ sourcePin: sourcePin.document, parsed, history: history.document, mode: 'prospective_source_screening',
    policy: { maxInspectedRecords: 4, targetPackets: 3, maxParents: 128, maxBodyUtf16Units: 1500, maxQuestionUtf16Units: 1000, maxTitleUtf16Units: 500 } }));
  const access = Array.from({ length: 3 }, (_, i) => artifact<AmazonPqaAccessReviewV2>(`SYNTHETIC-access-v2-${i}.json`, { format: 'ablatrix-amazon-pqa-source-access-review-v2', freezeSha256: freeze.sha256,
    reviewer: `SYNTHETIC native access reviewer ${i}`, provenance: 'independent_source_review_ai', role: i === 2 ? 'adjudicator' : 'independent', independentReviewFileSha256: [],
    candidateContextInspected: false, answerOutputsInspected: false, providerCalls: 0, humanSourceCheckedAnswers: 0, qualityClaimEligible: false, activationAuthorized: false, paidPlan: null,
    checks: AMAZON_PQA_ACCESS_CHECKS.map(id => ({ id, decision: 'eligible', rationale: `SYNTHETIC reviewer ${i} checked exact native metadata for ${id}; old schema is not a publisher claim.`,
      evidence: [{ artifactSha256: sourcePin.fileSha256, quote: sourcePin.document.schemaId }], independentAssessmentSha256: [], disagreementResolution: 'independent' })) }));
  access[2] = artifact(access[2]!.path, { ...access[2]!.document, independentReviewFileSha256: access.slice(0, 2).map(r => r.fileSha256), checks: access[2]!.document.checks.map((c, i) => ({ ...c,
    independentAssessmentSha256: access.slice(0, 2).map(r => freshSeal(r.document.checks[i])), disagreementResolution: 'agree' })) });
  const reviews = Array.from({ length: 3 }, (_, i) => artifact<AmazonPqaEligibilityReviewV2>(`SYNTHETIC-native-review-${i}.json`, { format: 'ablatrix-amazon-pqa-source-eligibility-review-v2', freezeSha256: freeze.sha256,
    screeningFileSha256: screening.fileSha256, reviewer: `SYNTHETIC native source reviewer ${i}`, provenance: 'independent_source_review_ai', role: i === 2 ? 'adjudicator' : 'independent', independentReviewFileSha256: [], candidateContextInspected: false, answerOutputsInspected: false,
    providerCalls: 0, humanSourceCheckedAnswers: 0, qualityClaimEligible: false, activationAuthorized: false, paidPlan: null,
    cases: screening.document.decisions.map(d => ({ caseId: d.caseId, decision: d.eligible ? 'eligible' : 'reject', rationale: `SYNTHETIC reviewer ${i} checked native literal info; duplicate/exposed row remains excluded.`,
      unknowns: [], applicability: 'SYNTHETIC this exact product description only, no broad performance claim.', independentAssessmentSha256: [], retainedIndependentUnknowns: [], disagreementResolution: 'independent',
      designatedFacts: d.packet ? [{ fact: 'SYNTHETIC exact native listing description', quote: d.packet.sources[0]!.text, sourceIds: [d.packet.sources[0]!.id], qualification: 'SYNTHETIC listing claim, rather than independently measured performance.', applicability: 'SYNTHETIC exact fictional product and literal source wording only.' }] : [] })) }));
  reviews[2] = artifact(reviews[2]!.path, { ...reviews[2]!.document, independentReviewFileSha256: reviews.slice(0, 2).map(r => r.fileSha256), cases: reviews[2]!.document.cases.map((c, i) => ({ ...c,
    independentAssessmentSha256: reviews.slice(0, 2).map(r => freshSeal(r.document.cases[i])), disagreementResolution: 'agree' })) });
  return { freeze, parsed, screening, access, reviews, raw };
}

import { AMAZON_PQA_RUNTIME_V3, amazonPqaImplementationPathsRuntimeV3, amazonPqaValidationRuntimeCliV3 } from '../scripts/amazon-pqa-validation-runtime-v3.ts';
test('runtime v3 bridges original CLI exposure verification without rewriting legacy pins and requires an explicit prospective runtime contract', async () => {
  const f = fixture(), directory = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-APQA-v2-BOUNDARY-SYNTHETIC-')));
  try {
    const put = (path: string, document: unknown) => { const full = join(directory, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, JSON.stringify(document) + '\n'); return { path, fileSha256: textHash(readFileSync(full, 'utf8')) }; };
    const load = (path: string) => JSON.parse(readFileSync(join(directory, path), 'utf8'));
    for (const path of [...AMAZON_PQA_RELEASE_REQUIRED_CODE, 'scripts/amazon-pqa-validation-runtime-v3.ts', 'scripts/prepare-amazon-pqa-history-runtime-v3.py', 'package.json', 'package-lock.json']) { mkdirSync(dirname(join(directory, path)), { recursive: true }); writeFileSync(join(directory, path), `SYNTHETIC ${path}`); }
    const lines = f.raw.trimEnd().split('\n'), cut = Math.floor(lines[1]!.length / 2), priorBytes = Buffer.from(lines[0] + '\n' + lines[1]!.slice(0, cut)), nextBytes = Buffer.from(lines[1]!.slice(cut) + '\nMALFORMED FRESH ROW MUST NEVER BE DECODED\n');
    const total = priorBytes.length + nextBytes.length, key = 'SYNTHETIC-adjacent.jsonl';
    const pin = (bytes: Buffer, start: number): AmazonPqaReleasePinV2 => ({ format: 'ablatrix-amazon-pqa-release-pin-v2', dataset: 'Amazon-PQA', split: 'unpartitioned', schemaId: 'amazon-pqa-released-fields-v2-jsonl', provenance: 'synthetic_fixture',
      objects: [{ role: 'category_records', key, versionId: 'SYNTHETIC-version', sha256: textHash(bytes.toString()), bytes: bytes.length, sourceBytes: total, range: { start, endInclusive: start + bytes.length - 1 } }] });
    const priorPin = pin(priorBytes, 0), nextPin = pin(nextBytes, priorBytes.length);
    writeFileSync(join(directory, 'prior.bin'), priorBytes); writeFileSync(join(directory, 'next.bin'), nextBytes);
    const priorNativeRef = put('prior-native.json', priorPin), nextNativeRef = put('next-native.json', nextPin);
    const oldSource = artifact('SYNTHETIC-old-source.json', { ...priorPin, format: 'ablatrix-amazon-pqa-source-pin-v1', schemaId: 'amazon-pqa-official-fields-v1-jsonl' });
    const oldFreeze = freezeAmazonPqaV1({ ...f.freeze, protocol: artifact('SYNTHETIC-old-protocol.json', { ...f.freeze.protocol.document, format: 'ablatrix-amazon-pqa-protocol-v1' as const }), sourcePin: oldSource });
    const oldFreezeRef = put('failed-freeze.json', oldFreeze), failureRef = put('failed.json', { format: 'ablatrix-amazon-pqa-semantic-access-failure-v1', status: 'source_parse_failed', wholePrefixConsumed: true, freezeSha256: oldFreeze.sha256, sourcePinFileSha256: oldSource.fileSha256 });
    put('exposed-input.json', { format: 'ablatrix-amazon-pqa-exposed-replay-input-v2', sourcePin: priorNativeRef, priorFreeze: oldFreezeRef, priorFailure: failureRef,
      objectFiles: { [key]: { path: 'prior.bin', fileSha256: priorPin.objects[0]!.sha256 } } });
    await amazonPqaValidationCliV2(['--exposed-replay', '--input', 'exposed-input.json', '--out', join(directory, 'exposed.json')], directory);
    const exposed = load('exposed.json'); assert.equal(exposed.completeRowsMapped, true); assert.equal(exposed.completePrefixMapping, false); assert.equal(exposed.unresolvedBoundary, true);
    const projectionRef = { path: 'exposed.json', fileSha256: textHash(readFileSync(join(directory, 'exposed.json'), 'utf8')) };
    const boundary = { format: 'ablatrix-amazon-pqa-boundary-repair-input-v2', priorProjection: projectionRef, currentSourcePin: nextNativeRef, objectFiles: { [key]: { path: 'next.bin', fileSha256: nextPin.objects[0]!.sha256 } } };
    put('boundary-input.json', boundary); await amazonPqaValidationCliV2(['--boundary-request', '--input', 'boundary-input.json', '--out', join(directory, 'request.json')], directory);
    const request = load('request.json'), refs = [0, 1].map(i => put(`review-${i}.json`, { format: 'ablatrix-amazon-pqa-boundary-access-review-v2', reviewSubjectSha256: request.reviewSubjectSha256,
      reviewer: `SYNTHETIC boundary reviewer ${i}`, provenance: 'independent_source_review_ai', role: 'independent', independentReviewFileSha256: [], decision: 'eligible', sourceEvidence: 'SYNTHETIC checked exact adjacent native frame metadata; only the old boundary row can be decoded for exclusion.', retainedUncertainty: ['SYNTHETIC the boundary may fail strict native decoding.'], providerCalls: 0, humanSourceCheckedAnswers: 0, qualityClaimEligible: false, activationAuthorized: false, paidPlan: null }));
    refs.push(put('review-2.json', { ...load('review-0.json'), reviewer: 'SYNTHETIC third boundary reviewer', role: 'adjudicator', independentReviewFileSha256: refs.map(r => r.fileSha256) }));
    put('boundary-input.json', { ...boundary, accessReviews: refs }); await amazonPqaValidationCliV2(['--boundary-repair', '--input', 'boundary-input.json', '--out', join(directory, 'repair.json')], directory);
    const repaired = load('repair.json'); assert.equal(repaired.boundary.resolved, true); assert.equal(repaired.newCompleteRowsInspected, 0); assert.ok(repaired.boundary.consumedExposure.productIds.includes('B800000001'));
    const repairRef = { path: 'repair.json', fileSha256: textHash(readFileSync(join(directory, 'repair.json'), 'utf8')) }, input = load('exposed-input.json'); put('resolved-input.json', { ...input, boundaryResolution: repairRef });
    await amazonPqaValidationCliV2(['--exposed-replay', '--input', 'resolved-input.json', '--out', join(directory, 'resolved.json')], directory);
    const resolved = load('resolved.json'); assert.equal(resolved.completePrefixMapping, true); assert.equal(resolved.unresolvedBoundary, false); assert.equal(resolved.sourceEligibilityPassed, false);
    const proof = await amazonPqaValidationCliV2(['--verify-exposed', '--input', 'resolved.json'], directory); assert.equal('verified' in proof && proof.verified, true);
    const oldMappingBytes = readFileSync(join(directory, 'resolved.json'), 'utf8');
    const bridged = await amazonPqaValidationRuntimeCliV3(['--verify-exposed', '--input', 'resolved.json'], directory);
    assert.equal('executionRuntime' in bridged && bridged.executionRuntime, AMAZON_PQA_RUNTIME_V3);
    assert.ok('runtimeBridge' in bridged); const bridge = bridged.runtimeBridge;
    assert.equal(bridge.legacyObservationsRewritten, false); assert.equal(bridge.legacyReconstruction, 'original_frozen_v2_cli');
    assert.equal(bridge.nestedHistoryProofTimeoutMs, 300_000); assert.equal(bridge.exposedReplayChildTimeoutSeconds, 240);
    const oldPaths = amazonPqaImplementationPathsV2(directory), runtimePaths = amazonPqaImplementationPathsRuntimeV3(directory);
    assert.deepEqual(runtimePaths.filter(path => !oldPaths.includes(path)), ['scripts/amazon-pqa-validation-runtime-v3.ts', 'scripts/prepare-amazon-pqa-history-runtime-v3.py']);
    assert.deepEqual(Object.keys(bridge.implementationSha256).sort(), runtimePaths);
    assert.equal(readFileSync(join(directory, 'resolved.json'), 'utf8'), oldMappingBytes);
    assert.equal(Object.keys(resolved.implementationSha256).some(path => path.includes('runtime-v3')), false);
    put('runtime-protocol.json', f.freeze.protocol.document);
    put('missing-runtime-spec.json', { protocol: 'runtime-protocol.json', sourcePin: 'SOURCE-METADATA-MUST-NOT-BE-STAT-ED', history: 'unused', historicalInputs: [] });
    await assert.rejects(amazonPqaValidationRuntimeCliV3(['--freeze', '--input', 'missing-runtime-spec.json', '--out', join(directory, 'must-not-exist.json')], directory), /explicit new protocol binding/);
    const boundaryScope = { oldRowsDecoded: 1, newCompleteRowsInspected: 0, currentLeadingBytesInspected: 123, boundaryArtifactSHA: 'a'.repeat(64) };
    put('runtime-protocol.json', { ...f.freeze.protocol.document, executionRuntime: AMAZON_PQA_RUNTIME_V3, preFreezeBoundaryExclusion: boundaryScope });
    put('native-pin.json', f.freeze.sourcePin.document); put('history.json', f.freeze.history.document);
    for (const previous of f.freeze.historicalInputs) put(previous.path, previous.document);
    put('runtime-spec.json', { protocol: 'runtime-protocol.json', sourcePin: 'native-pin.json', history: 'history.json', historicalInputs: f.freeze.historicalInputs.map(a => a.path) });
    await amazonPqaValidationRuntimeCliV3(['--freeze', '--input', 'runtime-spec.json', '--out', join(directory, 'runtime-freeze.json')], directory);
    const runtimeFreezeRef = { path: 'runtime-freeze.json', fileSha256: textHash(readFileSync(join(directory, 'runtime-freeze.json'), 'utf8')) };
    put('runtime-bundle.json', { format: 'ablatrix-amazon-pqa-workflow-input-v2', freeze: runtimeFreezeRef });
    await amazonPqaValidationRuntimeCliV3(['--access-request', '--input', 'runtime-bundle.json', '--out', join(directory, 'runtime-request.json')], directory);
    const requestV3 = load('runtime-request.json'); assert.equal(requestV3.executionRuntime, AMAZON_PQA_RUNTIME_V3);
    assert.equal(requestV3.semanticReadScope.prospectiveCompleteRowsInspected, 0); assert.deepEqual(requestV3.semanticReadScope.preFreezeBoundaryExclusion, boundaryScope);
    const frozen = load('runtime-freeze.json'), access = [0, 1].map(i => put(`runtime-access-${i}.json`, { ...f.access[i]!.document, freezeSha256: frozen.sha256 }));
    access.push(put('runtime-access-2.json', { ...f.access[2]!.document, freezeSha256: frozen.sha256, independentReviewFileSha256: access.map(r => r.fileSha256) }));
    put('runtime-bundle.json', { format: 'ablatrix-amazon-pqa-workflow-input-v2', freeze: runtimeFreezeRef, accessReviews: access,
      objectFiles: { [f.freeze.sourcePin.document.objects[0]!.key]: { path: 'FRESH-BODY-MUST-NOT-BE-STAT-ED', fileSha256: f.freeze.sourcePin.document.objects[0]!.sha256 } } });
    await assert.rejects(amazonPqaValidationRuntimeCliV3(['--screen', '--input', 'runtime-bundle.json', '--out', join(directory, 'must-not-screen.json')], directory), error => error instanceof assert.AssertionError && error.message.includes('native-release-runtime-v3') && !error.message.includes('FRESH-BODY'));
    writeFileSync(join(directory, 'scripts/prepare-amazon-pqa-history-runtime-v3.py'), 'SYNTHETIC changed helper after prospective pin');
    await assert.rejects(amazonPqaValidationRuntimeCliV3(['--access-request', '--input', 'runtime-bundle.json', '--out', join(directory, 'must-not-request.json')], directory), /frozen native implementation changed/);
    await assert.rejects(amazonPqaValidationRuntimeCliV3(['--execute', '--input', '/SYNTHETIC-must-not-read']));

  } finally { rmSync(directory, { recursive: true, force: true }); }
});
