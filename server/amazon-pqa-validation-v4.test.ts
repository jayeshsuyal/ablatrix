/** Synthetic v4 mechanics only. No publisher bytes, providers or model downloads. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { freshSeal } from './fresh-validation-v2.ts';
import { textHash } from './product-corpus.ts';
import { ProductRetriever } from './product-retrieval.ts';
import { WORKSPACE_UNCERTAINTY_CONTRACT } from './workspace-uncertainty-policy.ts';
import { parseAmazonPqaReleaseV2, screenAmazonPqaReleaseV2, type AmazonPqaReleasePinV2 } from './amazon-pqa-release-v2.ts';
import { amazonPqaArtifact, AMAZON_PQA_ACCESS_CHECKS, AMAZON_PQA_MODEL_ASSETS, AMAZON_PQA_V4_REQUIRED_CODE, AMAZON_PQA_RUNTIME_V4, freezeAmazonPqaV4, verifyAmazonPqaFreezeV4,
  reviewAmazonPqaAccessV4, amazonPqaEligibilityRequestV4, selectAmazonPqaCasesV4, amazonPqaCorpusV4, prepareAmazonPqaComparisonV4, verifyAmazonPqaComparisonV4, reportAmazonPqaV4,
  type AmazonPqaProtocolV4, type AmazonPqaAccessReviewV4, type AmazonPqaEligibilityReviewV4 } from './amazon-pqa-validation-v4.ts';
import { amazonPqaValidationCliV4, amazonPqaFailureArtifactV4, journalAmazonPqaSemanticAttemptV4 } from '../scripts/amazon-pqa-validation-v4.ts';
const artifact = <T>(path: string, value: T) => amazonPqaArtifact<T>(path, JSON.stringify(value) + '\n');
function fixture(targetPackets = 2) {
  const titles = ['Solvex Cedar Vessel', 'Prython Amber Lantern'];
  const raw = titles.flatMap((title, i) => [0, 1].map(j => JSON.stringify({ question_id: `SYNTHETIC-q-${i}-${j}`, question_text: j ? 'How marquetry?' : 'Can zephyr work?', asin: `B8${String(i).padStart(8, '0')}`,
    item_name: title, brand_name: title.split(' ')[0], product_description: `${title} description is a literal fictional parent.`,
    bullet_point1: `${title} cedar layer.`, bullet_point2: `${title} amber trim.`, bullet_point3: `${title} indigo thread.`, bullet_point4: `${title} crimson foot.`, bullet_point5: `${title} violet clasp.`,
    question_type: 'withheld', answer_aggregated: 'withheld annotation', answers: [{ answer_text: `SYNTHETIC ${title} ${j ? 'marquetry report' : 'target answer never retrieved'}.` }] }))).join('\n') + '\n';
  const sourcePin = artifact<AmazonPqaReleasePinV2>('SYNTHETIC-native-pin.json', { format: 'ablatrix-amazon-pqa-release-pin-v2', dataset: 'Amazon-PQA', split: 'unpartitioned', schemaId: 'amazon-pqa-released-fields-v2-jsonl', provenance: 'synthetic_fixture',
    objects: [{ role: 'category_records', key: 'SYNTHETIC-native.jsonl', versionId: null, sha256: textHash(raw), bytes: Buffer.byteLength(raw), sourceBytes: Buffer.byteLength(raw), range: null }] });
  const prior = artifact('SYNTHETIC-prior.json', { evidence: 'SYNTHETIC complete prior exposure mapping and boundary exclusion.' });
  const history = artifact('SYNTHETIC-history-v4.json', { format: 'ablatrix-amazon-pqa-protected-history-v4', completeHistoricalUnion: true, priorConsumedCompleteRowsMappingVerified: true, priorConsumedPrefixMappingVerified: true, unresolvedPriorSemanticExposure: false,
    productIds: [], canonicalFamilyTitles: [], modelIdentifiers: [], sourceBodyFingerprints: [], sourcePacketFingerprints: [] });
  const protocol = artifact<AmazonPqaProtocolV4>('SYNTHETIC-protocol-v4.json', { format: 'ablatrix-amazon-pqa-protocol-v4', purpose: 'exploratory_ai_only', dataset: 'Amazon-PQA', publisherSplit: 'unpartitioned_release', use: 'prospective_exploratory_validation', sourceOrder: 'ascending_release_row',
    maxInspectedRecords: 4, targetPackets, selectedProducts: 2, repeats: 1, maxParents: 128, maxBodyUtf16Units: 1500, maxQuestionUtf16Units: 1000, maxTitleUtf16Units: 500,
    control: 'workspace-semantic-supplement-v6-quantified-peer-dev', candidate: 'workspace-semantic-supplement-v7-small-packet-dev', generationContract: WORKSPACE_UNCERTAINTY_CONTRACT,
    targetAnswersInRetrieval: false, replacementAfterScreening: false, model: 'SYNTHETIC never invoked', policyInstructions: 'SYNTHETIC identical instructions retain attributed sources, qualifications and unresolved applicability.', expectedHistoryArtifactSha256: [prior.fileSha256], localModelAssetSha256: {},
    executionRuntime: AMAZON_PQA_RUNTIME_V4, nativeSchemaContract: 'amazon-pqa-released-fields-v2', sourceAccessScope: 'prospective_third_fixed_range', consumedFramesNeverFresh: true });
  const freeze = freezeAmazonPqaV4({ protocol, sourcePin, history, historicalInputs: [prior], implementationSha256: Object.fromEntries(AMAZON_PQA_V4_REQUIRED_CODE.map(path => [path, textHash(`SYNTHETIC ${path}`)])) });
  const parsed = parseAmazonPqaReleaseV2(sourcePin.document, new Map([[sourcePin.document.objects[0]!.key, raw]]), 4);
  const screening = artifact('SYNTHETIC-screen.json', screenAmazonPqaReleaseV2({ sourcePin: sourcePin.document, parsed,
    history: { productIds: [], canonicalFamilyTitles: [], modelIdentifiers: [], sourceBodyFingerprints: [], sourcePacketFingerprints: [] }, mode: 'prospective_source_screening',
    policy: { maxInspectedRecords: 4, targetPackets, maxParents: 128, maxBodyUtf16Units: 1500, maxQuestionUtf16Units: 1000, maxTitleUtf16Units: 500 } }));
  const access = [0, 1, 2].map(i => artifact<AmazonPqaAccessReviewV4>(`SYNTHETIC-access-${i}.json`, { format: 'ablatrix-amazon-pqa-source-access-review-v4', freezeSha256: freeze.sha256, reviewer: `SYNTHETIC access ${i}`, provenance: 'independent_source_review_ai', role: i === 2 ? 'adjudicator' : 'independent', independentReviewFileSha256: [],
    candidateContextInspected: false, answerOutputsInspected: false, providerCalls: 0, humanSourceCheckedAnswers: 0, qualityClaimEligible: false, activationAuthorized: false, paidPlan: null,
    checks: AMAZON_PQA_ACCESS_CHECKS.map(id => ({ id, decision: 'eligible', rationale: `SYNTHETIC source-aware assessment ${i} checks native metadata and explicit new v6/v7 arms for ${id}.`, evidence: [{ artifactSha256: sourcePin.fileSha256, quote: sourcePin.document.schemaId }], independentAssessmentSha256: [], disagreementResolution: 'independent' })) }));
  access[2] = artifact(access[2]!.path, { ...access[2]!.document, independentReviewFileSha256: access.slice(0, 2).map(x => x.fileSha256), checks: access[2]!.document.checks.map((c, n) => ({ ...c, independentAssessmentSha256: access.slice(0, 2).map(x => freshSeal(x.document.checks[n])), disagreementResolution: 'agree' })) });
  const reviews = [0, 1, 2].map(i => artifact<AmazonPqaEligibilityReviewV4>(`SYNTHETIC-eligibility-${i}.json`, { format: 'ablatrix-amazon-pqa-source-eligibility-review-v4', freezeSha256: freeze.sha256, screeningFileSha256: screening.fileSha256, reviewer: `SYNTHETIC source ${i}`, provenance: 'independent_source_review_ai', role: i === 2 ? 'adjudicator' : 'independent', independentReviewFileSha256: [],
    candidateContextInspected: false, answerOutputsInspected: false, providerCalls: 0, humanSourceCheckedAnswers: 0, qualityClaimEligible: false, activationAuthorized: false, paidPlan: null,
    cases: screening.document.decisions.map(d => ({ caseId: d.caseId, decision: d.eligible ? 'eligible' : 'reject', rationale: 'SYNTHETIC complete literal source review before either context; automatic rejections remain fixed.', unknowns: [`SYNTHETIC reviewer ${i < 2 ? i : 0} uncertainty remains explicit.`], applicability: 'SYNTHETIC exact fictional item only; no complete compatibility or performance claim.', independentAssessmentSha256: [], retainedIndependentUnknowns: [], disagreementResolution: 'independent',
      designatedFacts: d.packet ? d.packet.sources.slice(-2).map(s => ({ fact: 'SYNTHETIC useful partial literal claim.', quote: s.text, sourceIds: [s.id], qualification: 'SYNTHETIC attributed listing/report only, not independent truth.', applicability: 'SYNTHETIC exact fictional product and original question scope only.' })) : [] })) }));
  reviews[2] = artifact(reviews[2]!.path, { ...reviews[2]!.document, independentReviewFileSha256: reviews.slice(0, 2).map(x => x.fileSha256), cases: reviews[2]!.document.cases.map((c, n) => ({ ...c,
    unknowns: reviews.slice(0, 2).flatMap(x => x.document.cases[n]!.unknowns), retainedIndependentUnknowns: [...new Set(reviews.slice(0, 2).flatMap(x => x.document.cases[n]!.unknowns))],
    independentAssessmentSha256: reviews.slice(0, 2).map(x => freshSeal(x.document.cases[n])), disagreementResolution: 'agree' })) });
  return { freeze, screening, reviews, access };
}

test('v4 source-only bridge preserves explicit v6/v7 arms, fixed cases, unknowns and real full-stage replay', async () => {
  const f = fixture(); verifyAmazonPqaFreezeV4(f.freeze); assert.equal(reviewAmazonPqaAccessV4(f.freeze, f.access).sourceAccessAllowed, true);
  assert.equal(amazonPqaEligibilityRequestV4(f.freeze, f.screening).control, 'workspace-semantic-supplement-v6-quantified-peer-dev');
  const selection = selectAmazonPqaCasesV4(f.freeze, f.screening, f.reviews), corpus = amazonPqaCorpusV4(f.freeze, f.screening, selection);
  assert.equal(selection.sourceOnlyEligibilityCalculation.selectedProducts, 2);
  const scoreByText = new Map(corpus.products.flatMap(product => corpus.passages.filter(x => x.productId === product.id).map((p, i) => [p.text, i < 5 ? .9 : .1] as const)));
  const retriever = new ProductRetriever(corpus, ':memory:', { embed: async (texts, kind) => texts.map(text => { const cosine = kind === 'query' ? 1 : scoreByText.get(text)!; return [cosine, Math.sqrt(1 - cosine * cosine)]; }) });
  let calls = 0;
  try {
    const comparison = await prepareAmazonPqaComparisonV4(f.freeze, f.screening, f.reviews, selection, retriever, async (_q, documents) => { calls++; return documents.map(() => -11); });
    assert.equal(calls, 2, 'Only the control invokes the original scorer once per case.');
    assert.equal(comparison.control, f.freeze.protocol.document.control); assert.equal(comparison.candidate, f.freeze.protocol.document.candidate);
    assert.equal(comparison.cases.length, 2); assert.ok(comparison.cases.every(c => c.retrieval.candidate.passages.length === 7));
    assert.ok(comparison.cases.every(c => c.designatedFacts.every(f => f.candidateDelivered))); assert.ok(comparison.sourceBenefit);
    await verifyAmazonPqaComparisonV4(f.freeze, f.screening, f.reviews, selection, comparison);
    const report = reportAmazonPqaV4(f.freeze, f.screening, selection, comparison); assert.equal(report.providerCalls, 0); assert.equal(report.qualityClaimEligible, false); assert.ok(report.recoveredUnits > 0);
    const removed = structuredClone(comparison); removed.cases.pop(); await assert.rejects(verifyAmazonPqaComparisonV4(f.freeze, f.screening, f.reviews, selection, removed));
    const corrupted = structuredClone(comparison); corrupted.cases[0]!.retrieval.candidate.passages[0]!.text += ' forged'; await assert.rejects(verifyAmazonPqaComparisonV4(f.freeze, f.screening, f.reviews, selection, corrupted));
  } finally { retriever.close(); }
});

test('native binding, adjudication and exact source gates fail before source inference', () => {
  const f = fixture(), wrong = structuredClone(f.freeze); (wrong.protocol.document as { control: string }).control = 'workspace-semantic-supplement-v5-dev'; assert.throws(() => verifyAmazonPqaFreezeV4(wrong));
  const bad = structuredClone(f.access); bad[2]!.document.checks[0]!.independentAssessmentSha256.reverse(); assert.throws(() => reviewAmazonPqaAccessV4(f.freeze, bad));
  const omitted = structuredClone(f.reviews); omitted[2]!.document.cases[0]!.retainedIndependentUnknowns.pop(); assert.throws(() => selectAmazonPqaCasesV4(f.freeze, f.screening, omitted));
  const leaked = artifact('SYNTHETIC-development.json', { ...f.screening.document, mode: 'exposed_development_replay' }); assert.throws(() => amazonPqaEligibilityRequestV4(f.freeze, leaked));
  const forged = structuredClone(f.reviews); forged[0]!.document.cases[0]!.designatedFacts[0]!.quote += ' invented'; assert.throws(() => selectAmazonPqaCasesV4(f.freeze, f.screening, forged));
  const unresolved = { ...f.freeze.history, document: { ...f.freeze.history.document as object, unresolvedPriorSemanticExposure: true } }; assert.throws(() => freezeAmazonPqaV4({ ...f.freeze, history: unresolved }));
});

test('v4 CLI cannot accept a paid dispatch mode or silently remove the fixed source pool', async () => {
  assert.equal((await amazonPqaValidationCliV4([])).providerCalls, 0); await assert.rejects(amazonPqaValidationCliV4(['--execute', '--input', '/SYNTHETIC-must-not-open']));
  const f = fixture(), reviews = structuredClone(f.reviews); reviews[0]!.document.cases.pop(); assert.throws(() => selectAmazonPqaCasesV4(f.freeze, f.screening, reviews));
});

test('publisher metadata requires exact third range, both prior frames and a pin-bound exclusion-only boundary repair', () => {
  const f = fixture(), size = 16 * 1024 * 1024;
  const sourcePin = artifact<AmazonPqaReleasePinV2>('SYNTHETIC-publisher-shaped-pin.json', { ...f.freeze.sourcePin.document, provenance: 'publisher_dataset',
    objects: [{ ...f.freeze.sourcePin.document.objects[0]!, key: 'amazon_pqa_accessories.json', versionId: 'SYNTHETIC-version-only', bytes: size, sourceBytes: 4 * size, range: { start: 2 * size, endInclusive: 3 * size - 1 } }] });
  const protocol = artifact<AmazonPqaProtocolV4>('SYNTHETIC-publisher-shaped-protocol.json', { ...f.freeze.protocol.document, maxInspectedRecords: 4096, targetPackets: 32, selectedProducts: 16,
    localModelAssetSha256: Object.fromEntries(AMAZON_PQA_MODEL_ASSETS.map(path => [path, 'a'.repeat(64)])) });
  const historyDocument = { ...f.freeze.history.document as Record<string, unknown>, unresolvedTrailingBoundary: null,
    consumedSourcePrefixes: [0, size].map(start => ({ key: sourcePin.document.objects[0]!.key, versionId: sourcePin.document.objects[0]!.versionId, range: { start, endInclusive: start + size - 1 } })),
    boundaryExclusionCommitments: [{ currentSourcePinFileSha256: sourcePin.fileSha256, currentSourcePinSha256: freshSeal(sourcePin.document), boundaryNeverSelectable: true, newCompleteRowsInspected: 0 }] };
  const history = artifact('SYNTHETIC-publisher-shaped-history.json', historyDocument), input = { ...f.freeze, protocol, sourcePin, history };
  assert.equal(freezeAmazonPqaV4(input).protocol.document.control, f.freeze.protocol.document.control);
  assert.throws(() => freezeAmazonPqaV4({ ...input, history: artifact(history.path, { ...historyDocument, boundaryExclusionCommitments: [] }) }), /exact prospective/);
  assert.throws(() => freezeAmazonPqaV4({ ...input, history: artifact(history.path, { ...historyDocument, consumedSourcePrefixes: historyDocument.consumedSourcePrefixes.slice(0, 1) }) }), /Both complete/);
  assert.throws(() => freezeAmazonPqaV4({ ...input, sourcePin: artifact(sourcePin.path, { ...sourcePin.document, objects: [{ ...sourcePin.document.objects[0]!, range: { start: size, endInclusive: 2 * size - 1 } }] }) }));
});

test('a finite mechanical pool shortfall cannot become a smaller convenient comparison', async () => {
  const f = fixture(3), selection = selectAmazonPqaCasesV4(f.freeze, f.screening, f.reviews);
  assert.equal(selection.sourceOnlyEligibilityCalculation.selectedProducts, 2);
  assert.equal(selection.sourceOnlyEligibilityCalculation.stopReason, 'finite_screening_pool_shortfall');
  let inferenceCalls = 0;
  await assert.rejects(prepareAmazonPqaComparisonV4(f.freeze, f.screening, f.reviews, selection, { async diagnose() { inferenceCalls++; throw new Error('SYNTHETIC should not infer'); } }, async () => { inferenceCalls++; return []; }));
  assert.equal(inferenceCalls, 0);
});

test('CLI metadata access opens no source and a changed helper blocks before a prospective path can open', async () => {
  const f = fixture(), root = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-APQA-v4-SYNTHETIC-')));
  const put = (path: string, doc: unknown) => { const full = join(root, path); mkdirSync(dirname(full), { recursive: true }); const raw = JSON.stringify(doc) + '\n'; writeFileSync(full, raw); return { path, fileSha256: textHash(raw) }; };
  try {
    for (const path of [...AMAZON_PQA_V4_REQUIRED_CODE, 'package.json', 'package-lock.json']) { const full = join(root, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, `SYNTHETIC code ${path}`); }
    for (const a of [f.freeze.protocol, f.freeze.sourcePin, f.freeze.history, ...f.freeze.historicalInputs]) put(a.path, a.document);
    put('freeze-input.json', { protocol: f.freeze.protocol.path, sourcePin: f.freeze.sourcePin.path, history: f.freeze.history.path, historicalInputs: f.freeze.historicalInputs.map(a => a.path) });
    await amazonPqaValidationCliV4(['--freeze', '--input', 'freeze-input.json', '--out', join(root, 'freeze.json')], root);
    const frozenRaw = readFileSync(join(root, 'freeze.json'), 'utf8');
    put('bundle.json', { format: 'ablatrix-amazon-pqa-workflow-input-v4', freeze: { path: 'freeze.json', fileSha256: textHash(frozenRaw) },
      objectFiles: { [f.freeze.sourcePin.document.objects[0]!.key]: { path: 'SYNTHETIC-PROSPECTIVE-MUST-NOT-OPEN.bin', fileSha256: f.freeze.sourcePin.document.objects[0]!.sha256 } } });
    await amazonPqaValidationCliV4(['--access-request', '--input', 'bundle.json', '--out', join(root, 'access-request.json')], root);
    assert.equal(JSON.parse(readFileSync(join(root, 'access-request.json'), 'utf8')).prospectiveCompleteRowsInspected, 0);
    writeFileSync(join(root, 'server/semantic-supplement-v7.ts'), 'SYNTHETIC changed helper');
    await assert.rejects(amazonPqaValidationCliV4(['--screen', '--input', 'bundle.json', '--out', join(root, 'must-not-exist.json')], root), /Frozen v4 implementation changed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('unexpected processing failure after source access commits the whole frame without disclosing the exception body', () => {
  const f = fixture(), error = new Error('SYNTHETIC-PRIVATE-BODY-CANARY');
  assert.equal(amazonPqaFailureArtifactV4(f.freeze, error, false), null);
  const failure = amazonPqaFailureArtifactV4(f.freeze, error, true)!;
  assert.equal(failure.wholePrefixConsumed, true); assert.equal(failure.unmappedSemanticExposure, true); assert.equal(failure.semanticRowsInspected, null);
  assert.deepEqual(failure.sourcePrefixes, f.freeze.sourcePin.document.objects); assert.equal(failure.eligiblePackets, 0); assert.equal(failure.qualityClaimEligible, false);
  assert.equal(failure.nativeSourcePinSha256, freshSeal(f.freeze.sourcePin.document));
  assert.ok(!JSON.stringify(failure).includes('SYNTHETIC-PRIVATE-BODY-CANARY'));
});

test('a body-free pre-read journal commits exact inputs and survives without a result or source read', () => {
  const f = fixture(), root = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-APQA-v4-JOURNAL-SYNTHETIC-'))), output = join(root, 'screen.json');
  try {
    const workflowInput = { path: 'SYNTHETIC-workflow.json', fileSha256: '1'.repeat(64) }, freezeRef = { path: 'SYNTHETIC-freeze.json', fileSha256: '2'.repeat(64) };
    const o = f.freeze.sourcePin.document.objects[0]!, refs = { [o.key]: { path: 'SYNTHETIC-MUST-NOT-OPEN.bin', fileSha256: o.sha256 } };
    journalAmazonPqaSemanticAttemptV4(output, f.freeze, workflowInput, freezeRef, refs);
    const path = `${output}.semantic-attempt.json`, raw = readFileSync(path, 'utf8'), record = JSON.parse(raw);
    assert.equal(statSync(path).mode & 0o777, 0o600); assert.equal(existsSync(output), false);
    assert.deepEqual(record.workflowInput, workflowInput); assert.equal(record.freeze.sealSha256, f.freeze.sha256);
    assert.deepEqual(record.sourcePrefixes, f.freeze.sourcePin.document.objects); assert.equal(record.sourcePinSha256, freshSeal(f.freeze.sourcePin.document));
    assert.equal(record.semanticRowsInspected, null); assert.equal(record.freshReuseEligible, false); assert.equal(record.wholeFrameConsumed, true);
    assert.throws(() => journalAmazonPqaSemanticAttemptV4(output, f.freeze, workflowInput, freezeRef, refs)); assert.equal(readFileSync(path, 'utf8'), raw);
    assert.ok(!raw.includes('target answer never retrieved'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
