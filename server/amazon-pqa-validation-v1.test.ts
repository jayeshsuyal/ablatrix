/** SYNTHETIC E2E mechanics only. No publisher bodies, model downloads or provider. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { textHash } from './product-corpus.ts';
import { ProductRetriever } from './product-retrieval.ts';
import { WORKSPACE_UNCERTAINTY_CONTRACT } from './workspace-uncertainty-policy.ts';
import { freshSeal } from './fresh-validation-v2.ts';
import { AMAZON_PQA_ACCESS_CHECKS, AMAZON_PQA_REQUIRED_CODE, amazonPqaArtifact, freezeAmazonPqaV1, verifyAmazonPqaFreezeV1, reviewAmazonPqaAccessV1,
  withAmazonPqaPrefixAccessV1, amazonPqaParseFailureV1, amazonPqaEligibilityRequestV1, selectAmazonPqaCasesV1, amazonPqaCorpusV1, prepareAmazonPqaComparisonV1, verifyAmazonPqaComparisonV1, reportAmazonPqaV1,
  type AmazonPqaProtocol, type AmazonPqaPacket, type AmazonPqaScreening, type AmazonPqaAccessReview, type AmazonPqaEligibilityReview } from './amazon-pqa-validation-v1.ts';
import { amazonPqaValidationCliV1 } from '../scripts/amazon-pqa-validation-v1.ts';
import { AmazonPqaParseError, parseAmazonPqaObjectsV1, screenAmazonPqaSourceV1, type AmazonPqaSourcePin } from './amazon-pqa-source-v1.ts';

const artifact = <T>(path: string, value: T) => amazonPqaArtifact<T>(path, JSON.stringify(value) + '\n');
function fixture() {
  const historyInput = artifact('SYNTHETIC-prior-exposure.json', { productIds: ['SYNTHETIC-old-product'], evidence: 'SYNTHETIC complete prior public and private exposure inventory.' });
  const protocol = artifact<AmazonPqaProtocol>('SYNTHETIC-protocol.json', { format: 'ablatrix-amazon-pqa-protocol-v1', purpose: 'exploratory_ai_only', dataset: 'Amazon-PQA',
    publisherSplit: 'unpartitioned_release', use: 'prospective_exploratory_validation', sourceOrder: 'ascending_release_row', maxInspectedRecords: 4, targetPackets: 3, selectedProducts: 2, repeats: 1,
    maxParents: 128, maxBodyUtf16Units: 1500, maxQuestionUtf16Units: 1000, maxTitleUtf16Units: 500, control: 'workspace-semantic-supplement-v5-dev', candidate: 'workspace-semantic-supplement-v6-quantified-peer-dev',
    generationContract: WORKSPACE_UNCERTAINTY_CONTRACT, targetAnswersInRetrieval: false, replacementAfterScreening: false, model: 'SYNTHETIC never invoked model',
    policyInstructions: 'SYNTHETIC identical source grounded instructions preserving observed conditions and uncertainty.', expectedHistoryArtifactSha256: [historyInput.fileSha256], localModelAssetSha256: {} });
  const sourcePin = artifact('SYNTHETIC-source-pin.json', { format: 'ablatrix-amazon-pqa-source-pin-v1', dataset: 'Amazon-PQA', split: 'unpartitioned', schemaId: 'amazon-pqa-official-fields-v1-json-array', provenance: 'synthetic_fixture',
    objects: [{ role: 'category_records', key: 'SYNTHETIC-fixture.json', versionId: null, sha256: '1'.repeat(64), bytes: 1, sourceBytes: 1, range: null }] });
  const history = artifact('SYNTHETIC-history.json', { productIds: ['SYNTHETIC-old-product'], evidence: 'SYNTHETIC historical exclusions include all failed and incidental exposures.' });
  const implementationSha256 = Object.fromEntries([...AMAZON_PQA_REQUIRED_CODE, 'package.json', 'package-lock.json'].map(path => [path, textHash(`SYNTHETIC pinned ${path}`)]));
  const freeze = freezeAmazonPqaV1({ protocol, sourcePin, history, historicalInputs: [historyInput], implementationSha256 });
  const access = Array.from({ length: 3 }, (_, i) => artifact<AmazonPqaAccessReview>(`SYNTHETIC-access-${i}.json`, { format: 'ablatrix-amazon-pqa-source-access-review-v1',
    freezeSha256: freeze.sha256, reviewer: `SYNTHETIC independent access reviewer ${i}`, provenance: 'independent_source_review_ai', role: i === 2 ? 'adjudicator' : 'independent',
    independentReviewFileSha256: [], candidateContextInspected: false, answerOutputsInspected: false,
    providerCalls: 0, humanSourceCheckedAnswers: 0, qualityClaimEligible: false, activationAuthorized: false, paidPlan: null,
    checks: AMAZON_PQA_ACCESS_CHECKS.map(id => ({ id, decision: 'eligible', rationale: `SYNTHETIC reviewer ${i} checked ${id} against exact bounded metadata; no quality conclusion.`, evidence: [{ artifactSha256: protocol.fileSha256, quote: 'prospective_exploratory_validation' }], independentAssessmentSha256: [], disagreementResolution: 'independent' })) }));
  access[2] = artifact(access[2]!.path, { ...access[2]!.document, independentReviewFileSha256: access.slice(0, 2).map(x => x.fileSha256), checks: access[2]!.document.checks.map((c, n) => ({ ...c, independentAssessmentSha256: access.slice(0, 2).map(x => freshSeal(x.document.checks[n])), disagreementResolution: 'agree' })) });
  const packets: AmazonPqaPacket[] = Array.from({ length: 4 }, (_, i) => {
    const id = `SYNTHETIC-APQA-${i}`;
    const sources = [
      ...Array.from({ length: 6 }, (_, d) => ({ id: `${id}-base-${d}`, label: 'bullet', text: `SYNTHETIC comparable duration durable detail ${d} on case ${i}.`, originalQuestion: null, reference: 'SYNTHETIC fixture' })),
      { id: `${id}-strict-a`, label: 'review', text: 'SYNTHETIC observed four hours on an early outing.', originalQuestion: null, reference: 'SYNTHETIC fixture' },
      { id: `${id}-strict-b`, label: 'review', text: 'SYNTHETIC a second owner reported five hours in calm conditions.', originalQuestion: null, reference: 'SYNTHETIC fixture' },
      { id: `${id}-peer`, label: 'review', text: 'SYNTHETIC nearly eight hours before manual extinguishing.', originalQuestion: null, reference: 'SYNTHETIC fixture' },
    ].map(s => ({ ...s, sha256: textHash(JSON.stringify([s.id, s.label, s.text, s.originalQuestion, s.reference])) }));
    return { id, product: { id: `B9${String(i).padStart(8, '0')}`, title: `SYNTHETIC Example device ${i}` }, question: 'SYNTHETIC comparable duration?', sources, sourcePoolSha256: textHash(JSON.stringify(sources)) };
  });
  const screening = artifact<AmazonPqaScreening>('SYNTHETIC-screening.json', { format: 'SYNTHETIC bound source screening', decisions: packets.map((p, i) => ({ caseId: p.id, eligible: i !== 3, reasons: i === 3 ? ['historical_product_exposure'] : [], packet: i === 3 ? null : p })) });
  const reviews = Array.from({ length: 3 }, (_, i) => artifact<AmazonPqaEligibilityReview>(`SYNTHETIC-eligibility-${i}.json`, { format: 'ablatrix-amazon-pqa-source-eligibility-review-v1', freezeSha256: freeze.sha256,
    screeningFileSha256: screening.fileSha256, reviewer: `SYNTHETIC independent source reviewer ${i}`, provenance: 'independent_source_review_ai', role: i === 2 ? 'adjudicator' : 'independent', independentReviewFileSha256: [],
    providerCalls: 0, humanSourceCheckedAnswers: 0, qualityClaimEligible: false, activationAuthorized: false, paidPlan: null,
    candidateContextInspected: false, answerOutputsInspected: false, cases: packets.map((p, n) => ({ caseId: p.id, decision: n === 3 ? 'reject' : n === 2 ? 'uncertain' : 'eligible',
      independentAssessmentSha256: [], retainedIndependentUnknowns: [], disagreementResolution: 'independent',
      rationale: `SYNTHETIC reviewer ${i} examined exact source quotes, applicability, and retained uncertainties for row ${n}.`, unknowns: ['SYNTHETIC operating conditions and population average are unestablished.'],
      applicability: 'SYNTHETIC source is an attributed observation on this exact product; comparable conditions unknown.',
      designatedFacts: n === 3 ? [] : [{ fact: 'SYNTHETIC attributed manually stopped duration observation', quote: p.sources.at(-1)!.text, sourceIds: [p.sources.at(-1)!.id],
        qualification: 'SYNTHETIC manually stopped observation is neither fuel exhaustion nor a population average.', applicability: 'SYNTHETIC this product only; exact operating conditions not established.' }] })) }));
  reviews[2] = artifact(reviews[2]!.path, { ...reviews[2]!.document, independentReviewFileSha256: reviews.slice(0, 2).map(x => x.fileSha256), cases: reviews[2]!.document.cases.map((c, n) => ({ ...c,
    independentAssessmentSha256: reviews.slice(0, 2).map(x => freshSeal(x.document.cases[n])), retainedIndependentUnknowns: [...new Set(reviews.slice(0, 2).flatMap(x => x.document.cases[n]!.unknowns))], disagreementResolution: 'agree' })) });
  return { freeze, access, screening, reviews, packets };
}
async function comparisonFixture() {
  const f = fixture(), selection = selectAmazonPqaCasesV1(f.freeze, f.screening, f.reviews), corpus = amazonPqaCorpusV1(f.freeze, f.screening, selection);
  const retriever = new ProductRetriever(corpus, ':memory:', { embed: async (texts, kind) => texts.map(text => {
    if (kind === 'query') return [1, 0]; const score = text.includes('durable') ? .99 - Number(text.match(/detail (\d+)/)?.[1] ?? 0) * .01 : .1;
    return [score, Math.sqrt(1 - score * score)];
  }) });
  try {
    const comparison = await prepareAmazonPqaComparisonV1(f.freeze, f.screening, f.reviews, selection, retriever,
      async (_query, documents) => documents.map(d => d.includes('manual extinguishing') ? -6 : d.includes('hours') ? 2 : -20));
    return { ...f, selection, comparison };
  } finally { retriever.close(); }
}

test('SYNTHETIC offline E2E freezes, reviews, fixes product selection, compares genuine v5/v6 mechanics and reports every denominator', async () => {
  const f = await comparisonFixture(); verifyAmazonPqaFreezeV1(f.freeze);
  assert.equal(reviewAmazonPqaAccessV1(f.freeze, f.access).sourceAccessAllowed, true);
  assert.equal(amazonPqaEligibilityRequestV1(f.freeze, f.screening).cases.length, 4);
  assert.deepEqual(f.selection.selectedCaseIds, f.packets.slice(0, 2).map(x => x.id));
  assert.equal(f.selection.adjudicatedCases.length, 4); assert.equal(f.selection.adjudicatedCases[2]!.decision, 'uncertain'); assert.equal(f.selection.adjudicatedCases[3]!.decision, 'reject');
  assert.equal(f.comparison.cases.length, 2); assert.equal(f.comparison.proposedAnswers, 4); assert.equal(f.comparison.generatedAnswers, 0); assert.equal(f.comparison.paidPlan, null);
  assert.ok(f.comparison.cases.every(c => c.generationContract === WORKSPACE_UNCERTAINTY_CONTRACT));
  await verifyAmazonPqaComparisonV1(f.freeze, f.screening, f.reviews, f.selection, f.comparison);
  const report = reportAmazonPqaV1(f.freeze, f.screening, f.selection, f.comparison);
  assert.equal(report.inspectedQuestions, 4); assert.equal(report.selectedUniqueProducts, 2); assert.equal(report.rejectedOrUncertainQuestions, 2); assert.equal(report.adjudicatedUncertainQuestions, 1);
  assert.equal(report.providerCalls, 0); assert.equal(report.humanSourceCheckedAnswers, 0); assert.equal(report.qualityClaimEligible, false); assert.equal(report.paidExecutionAuthorized, false);
  assert.equal(report.designatedSourceUnits, 2); assert.equal(report.lostUnits, 0);
});
test('access review must include substantive exact evidence and two distinct raw independently bound reviews plus adjudication', () => {
  const f = fixture(); const repeated = [f.access[0]!, f.access[0]!, f.access[2]!]; assert.throws(() => reviewAmazonPqaAccessV1(f.freeze, repeated));
  const changed = structuredClone(f.access); changed[2]!.document.independentReviewFileSha256[0] = '0'.repeat(64); assert.throws(() => reviewAmazonPqaAccessV1(f.freeze, changed));
  const invented = structuredClone(f.access); invented[0]!.document.checks[0]!.evidence[0]!.quote = 'SYNTHETIC invented unsupported metadata'; assert.throws(() => reviewAmazonPqaAccessV1(f.freeze, invented), /exact bound metadata/);
  const pending = structuredClone(f.access); pending[2]!.document.checks[3]!.decision = 'uncertain'; pending[2]!.document.checks[3]!.disagreementResolution = 'unresolved'; assert.equal(reviewAmazonPqaAccessV1(f.freeze, pending).sourceAccessAllowed, false);
});
test('publisher protocol cannot freeze an unpinned model cache or relabel the unpartitioned release as a train split', () => {
  const f = fixture(), sourcePin = artifact(f.freeze.sourcePin.path, { ...f.freeze.sourcePin.document as AmazonPqaSourcePin, provenance: 'publisher_dataset' as const,
    objects: (f.freeze.sourcePin.document as AmazonPqaSourcePin).objects.map(o => ({ ...o, versionId: 'SYNTHETIC-immutable-version' })) });
  assert.throws(() => freezeAmazonPqaV1({ ...f.freeze, sourcePin }), /requires all cached/);
  const badProtocol = artifact(f.freeze.protocol.path, { ...f.freeze.protocol.document, publisherSplit: 'train' } as unknown as AmazonPqaProtocol);
  assert.throws(() => freezeAmazonPqaV1({ ...f.freeze, protocol: badProtocol }));
});
test('strict source failure retains immutable prefix/recognized exposure commitments without masquerading as eligible screening', () => {
  const f = fixture(); const failure = new AmazonPqaParseError(f.freeze.sourcePin.document as AmazonPqaSourcePin, 3, 2,
    { productIds: ['B999999999'], canonicalFamilyTitles: ['fictional brand'], modelIdentifiers: [], sourceBodyFingerprints: [textHash('SYNTHETIC private recognized body')], sourcePacketFingerprints: [], targetQuestionFingerprints: [], targetAnswerFingerprints: [] },
    'strict_schema_rejected', { algorithm: 'python_nfkc_casefold_v1', pythonVersion: 'SYNTHETIC', unicodeVersion: 'SYNTHETIC' });
  const record = amazonPqaParseFailureV1(f.freeze, failure);
  assert.equal(record.status, 'source_parse_failed'); assert.equal(record.semanticRowsInspected, 3); assert.equal(record.validDecodedRows, 2); assert.equal(record.wholePrefixConsumed, true);
  assert.equal(record.eligiblePackets, 0); assert.equal(record.selection, null); assert.equal(record.contexts, null); assert.equal(record.qualityClaimEligible, false);
  assert.equal(JSON.stringify(record).includes('SYNTHETIC private recognized body'), false);
  assert.equal('decisions' in record, false); assert.equal(record.opaquePrefixObjects[0]!.rawSha256, (f.freeze.sourcePin.document as AmazonPqaSourcePin).objects[0]!.sha256);
});
test('consumed overlapping prefixes and unresolved exposure stop before the source-path reader can run', () => {
  const f = fixture(), base = f.freeze.sourcePin.document as AmazonPqaSourcePin;
  const pin: AmazonPqaSourcePin = { ...base, objects: [{ ...base.objects[0]!, bytes: 16, sourceBytes: 100, range: { start: 0, endInclusive: 15 } }] };
  const previous = { key: pin.objects[0]!.key, versionId: null, sha256: 'a'.repeat(64), range: { start: 8, endInclusive: 23 } };
  let sourcePathReads = 0; const openSourcePath = () => { sourcePathReads++; throw new Error('SOURCE PATH MUST NOT BE OPENED'); };
  assert.throws(() => withAmazonPqaPrefixAccessV1({ consumedSourcePrefixes: [previous] }, pin, openSourcePath), /overlaps/);
  assert.throws(() => withAmazonPqaPrefixAccessV1({ consumedSourcePrefixes: [{ ...previous, range: null }] }, pin, openSourcePath), /overlaps/);
  assert.throws(() => withAmazonPqaPrefixAccessV1({ unresolvedPriorSemanticExposure: true }, pin, openSourcePath), /Unresolved prior/);
  assert.equal(sourcePathReads, 0);
  const adjacent = { ...previous, range: { start: 16, endInclusive: 31 } };
  assert.equal(withAmazonPqaPrefixAccessV1({ consumedSourcePrefixes: [adjacent] }, pin, () => { sourcePathReads++; return 'SYNTHETIC disjoint range'; }), 'SYNTHETIC disjoint range');
  assert.equal(sourcePathReads, 1);
});
test('source selection cannot drop uncertain/rejected rows, override exposure rejection, invent quotes or replace cases after scores', async () => {
  const f = await comparisonFixture();
  const short = structuredClone(f.reviews); short[0]!.document.cases.pop(); assert.throws(() => selectAmazonPqaCasesV1(f.freeze, f.screening, short), /every inspected/);
  const override = structuredClone(f.reviews); override[2]!.document.cases[3]!.decision = 'eligible'; override[2]!.document.cases[3]!.disagreementResolution = 'source_resolved'; assert.throws(() => selectAmazonPqaCasesV1(f.freeze, f.screening, override), /cannot override/);
  const invented = structuredClone(f.reviews); invented[1]!.document.cases[0]!.designatedFacts[0]!.quote += ' not in source'; assert.throws(() => selectAmazonPqaCasesV1(f.freeze, f.screening, invented), /exact literal/);
  const swapped = structuredClone(f.selection); swapped.selectedCaseIds.reverse();
  await assert.rejects(prepareAmazonPqaComparisonV1(f.freeze, f.screening, f.reviews, swapped, { diagnose: async () => { throw new Error('must not reach inference'); } }, async () => []), /Selection must replay/);
});
test('saved context replay rejects source-delivery edits and changed dense/reranker observations', async () => {
  const f = await comparisonFixture();
  const changed = structuredClone(f.comparison); changed.cases[0]!.recoveredUnits++;
  await assert.rejects(verifyAmazonPqaComparisonV1(f.freeze, f.screening, f.reviews, f.selection, changed), /must replay/);
  const score = structuredClone(f.comparison); score.cases[0]!.retrieval.control.proposal.actualInputs.documents[0]!.document += ' edited';
  await assert.rejects(verifyAmazonPqaComparisonV1(f.freeze, f.screening, f.reviews, f.selection, score));
  const dense = structuredClone(f.comparison); dense.cases[0]!.retrieval.trace.denseRaw.pop();
  await assert.rejects(verifyAmazonPqaComparisonV1(f.freeze, f.screening, f.reviews, f.selection, dense), /every product chunk/);
});
test('short finite pool produces an honest stopping report rather than selecting replacements', () => {
  const f = fixture(); const protocol = artifact(f.freeze.protocol.path, { ...f.freeze.protocol.document, selectedProducts: 3 });
  const freeze = freezeAmazonPqaV1({ ...f.freeze, protocol }); const reviews = f.reviews.map(r => artifact(r.path, { ...r.document, freezeSha256: freeze.sha256 }));
  reviews[2] = artifact(reviews[2]!.path, { ...reviews[2]!.document, independentReviewFileSha256: reviews.slice(0, 2).map(x => x.fileSha256) });
  const selection = selectAmazonPqaCasesV1(freeze, f.screening, reviews);
  assert.equal(selection.stopReason, 'insufficient_source_eligible_unique_products'); assert.equal(selection.selectedProducts, 2);
  assert.throws(() => amazonPqaCorpusV1(freeze, f.screening, selection)); assert.equal(reportAmazonPqaV1(freeze, f.screening, selection).proposedAnswers, 0);
});
test('CLI has no execution mode and an unqualified access review stops before even statting source object paths', async () => {
  assert.equal((await amazonPqaValidationCliV1([])).providerCalls, 0); await assert.rejects(amazonPqaValidationCliV1(['--execute', '--input', '/SYNTHETIC-must-not-read']));
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-APQA-SYNTHETIC-'))); const f = fixture();
  try {
    const put = (path: string, value: unknown) => { mkdirSync(dirname(join(directory, path)), { recursive: true }); writeFileSync(join(directory, path), JSON.stringify(value) + '\n'); return artifact(path, value); };
    for (const path of [...AMAZON_PQA_REQUIRED_CODE, 'package.json', 'package-lock.json']) { mkdirSync(dirname(join(directory, path)), { recursive: true }); writeFileSync(join(directory, path), `SYNTHETIC pinned ${path}`); }
    for (const a of [f.freeze.protocol, f.freeze.sourcePin, f.freeze.history, ...f.freeze.historicalInputs]) put(a.path, a.document);
    const freeze = put('freeze.json', f.freeze); const bundle = put('bundle.json', { format: 'ablatrix-amazon-pqa-workflow-input-v1', freeze, accessReviews: [], objectFiles: { 'SYNTHETIC': { path: 'BODY-MUST-NOT-BE-STAT-ED', fileSha256: '0'.repeat(64) } } });
    await assert.rejects(amazonPqaValidationCliV1(['--screen', '--input', bundle.path, '--out', join(directory, 'new.json')], directory), error => error instanceof assert.AssertionError && /0 !== 3/.test(error.message) && !error.message.includes('BODY-MUST-NOT'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('SYNTHETIC official JSON bytes flow through finite import, independent source selection, real retrieval and an honest no-benefit report', async () => {
  const f = fixture();
  const names = ['Solvex Cedar Vessel', 'Prython Amber Lantern', 'Velrune Indigo Frame', 'Solvex Cedar Vessel'];
  const raw = JSON.stringify(names.map((title, i) => ({ question_id: `fictional-question-${i}`, question_text: `What does the ${['cedar', 'amber', 'indigo', 'vessel'][i]} surface use?`,
    answer_text: `Fictional withheld reply number ${['one', 'two', 'three', 'four'][i]}.`, asin_id: `B8${String(i === 3 ? 0 : i).padStart(8, '0')}`, bullet_points: `${title} has its own distinct fictional feature.`,
    product_description: `${title} is described with a unique synthetic material statement.`, brand_name: title.split(' ')[0], item_name: title, 'is_yes-no_question': false, 'yes-no_answer': null })));
  const pin: AmazonPqaSourcePin = { format: 'ablatrix-amazon-pqa-source-pin-v1', dataset: 'Amazon-PQA', split: 'unpartitioned', schemaId: 'amazon-pqa-official-fields-v1-json-array', provenance: 'synthetic_fixture',
    objects: [{ role: 'category_records', key: 'SYNTHETIC-full-pipeline.json', versionId: null, sha256: textHash(raw), bytes: Buffer.byteLength(raw), sourceBytes: Buffer.byteLength(raw), range: null }] };
  const history = { productIds: [], canonicalFamilyTitles: [], modelIdentifiers: [], sourceBodyFingerprints: [], sourcePacketFingerprints: [] };
  const freeze = freezeAmazonPqaV1({ ...f.freeze, sourcePin: artifact('SYNTHETIC-real-schema-pin.json', pin), history: artifact('SYNTHETIC-empty-history.json', history) });
  const records = parseAmazonPqaObjectsV1(pin, new Map([[pin.objects[0]!.key, raw]]), 4);
  const actual = screenAmazonPqaSourceV1({ sourcePin: pin, records, history, policy: { maxInspectedRecords: 4, targetPackets: 3, maxParents: 128, maxBodyUtf16Units: 1500, maxQuestionUtf16Units: 1000, maxTitleUtf16Units: 500 } });
  assert.equal(actual.screeningDenominator, 4); assert.equal(actual.acceptedCaseIds.length, 3); assert.equal(actual.decisions[3]!.eligible, false);
  const screening = artifact('SYNTHETIC-imported-screening.json', actual);
  const reviews = Array.from({ length: 3 }, (_, i) => artifact<AmazonPqaEligibilityReview>(`SYNTHETIC-import-review-${i}.json`, { ...f.reviews[i]!.document,
    freezeSha256: freeze.sha256, screeningFileSha256: screening.fileSha256, independentReviewFileSha256: [], cases: actual.decisions.map(d => ({ caseId: d.caseId, decision: d.eligible ? 'eligible' : 'reject',
      rationale: `SYNTHETIC reviewer ${i} checked product info scope and exact description; duplicate product row remains excluded.`, unknowns: [], applicability: 'SYNTHETIC exact product description only; no customer runtime or statistical claim.',
      independentAssessmentSha256: [], retainedIndependentUnknowns: [], disagreementResolution: 'independent',
      designatedFacts: d.packet ? [{ fact: 'SYNTHETIC literal description statement', quote: d.packet.sources[0]!.text, sourceIds: [d.packet.sources[0]!.id], qualification: 'SYNTHETIC listed description rather than independent measured performance.', applicability: 'SYNTHETIC exact fictional product only, preserving literal source body.' }] : [] })) }));
  reviews[2] = artifact(reviews[2]!.path, { ...reviews[2]!.document, independentReviewFileSha256: reviews.slice(0, 2).map(r => r.fileSha256), cases: reviews[2]!.document.cases.map((c, i) => ({ ...c, independentAssessmentSha256: reviews.slice(0, 2).map(r => freshSeal(r.document.cases[i])), disagreementResolution: 'agree' })) });
  const selection = selectAmazonPqaCasesV1(freeze, screening, reviews), corpus = amazonPqaCorpusV1(freeze, screening, selection);
  const retriever = new ProductRetriever(corpus, ':memory:', { embed: async texts => texts.map(() => [1, 0]) });
  try {
    const comparison = await prepareAmazonPqaComparisonV1(freeze, screening, reviews, selection, retriever, async (_query, documents) => documents.map(() => 0));
    await verifyAmazonPqaComparisonV1(freeze, screening, reviews, selection, comparison);
    const report = reportAmazonPqaV1(freeze, screening, selection, comparison);
    assert.equal(report.inspectedUniqueProducts, 3); assert.equal(report.selectedUniqueProducts, 2); assert.equal(report.status, 'no_designated_missing_fact_delivered_by_candidate');
    assert.equal(report.casesExactlyV5Fallback, 2); assert.equal(report.casesWithApplicablePeerAnchors, 0); assert.equal(report.generatedAnswers, 0);
    assert.ok(comparison.cases.every(c => c.completeSources.every(s => !s.text.includes(records.find(r => r.target.question === c.question)!.target.answer))));
  } finally { retriever.close(); }
});
