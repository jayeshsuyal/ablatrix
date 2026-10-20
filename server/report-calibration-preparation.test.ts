import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { textHash } from './product-corpus.ts';
import { diagnosticHash, DIAGNOSTIC_LEDGER, prepareThreeContext, type DiagnosticCase } from './three-context-diagnostic.ts';
import { syntheticPreparation } from '../scripts/three-context-mock.ts';
import { buildReportCalibrationPreparation, createReportCalibrationPreparation, REPORT_CALIBRATION_V1, reportCalibrationDevelopmentProtocol, reportCalibrationEvaluationMetadata, reportCalibrationSourceReviewRequests, verifyReportCalibrationSourceReview,
  type ReportCalibrationPins, type ReportCalibrationSourceReview } from '../scripts/prepare-report-calibration-v1.ts';
import { mockReportCalibration } from '../scripts/report-calibration-mock.ts';
const root = realpathSync(fileURLToPath(new URL('../', import.meta.url))), encode = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const pins: ReportCalibrationPins = { v6ReviewedResultPath: 'SYNTHETIC-v6-review.json', expectedV6ReviewedResultSha256: '1'.repeat(64), sourceReviewPath: 'SYNTHETIC-source-review.json', expectedSourceReviewSha256: '2'.repeat(64) };
function fixtureCases() {
  const synthetic = syntheticPreparation(), gap = synthetic.cases[0]!; gap.id = REPORT_CALIBRATION_V1.selectedSourceCaseIds[0];
  const control = structuredClone(gap); control.id = REPORT_CALIBRATION_V1.selectedSourceCaseIds[1]; control.product = { ...control.product, id: 'SYNTHETIC-control' };
  const reparent = (sources: typeof control.completeSources) => sources.map(s => ({ ...s, productId: control.product.id }));
  control.completeSources = reparent(control.completeSources); control.contexts = { current: control.completeSources, semantic: control.completeSources, reference: control.completeSources }; control.referenceReview.sourcePoolSha256 = diagnosticHash(control.completeSources);
  return { sourceCases: [gap, control], policy: synthetic.policy, ledger: { ...synthetic.ledger, attempts: 141, reservedUsd: 14.1 }, bindings: { implementationSha256: synthetic.implementationSha256, artifactSha256: synthetic.artifactSha256 } };
}
function sourceReview(requests: ReturnType<typeof reportCalibrationSourceReviewRequests>): ReportCalibrationSourceReview {
  return { format: 'ablatrix-report-calibration-source-review-v1', provenance: 'independent_ai_source_review', reviewer: 'SYNTHETIC test attestation only; never code or financial qualification', candidateResultsInspected: false, generatedAnswersInspected: false,
    sourceEligibilityReviewFileSha256: requests.sourceEligibilityReviewFileSha256, selectionRule: requests.selectionRule,
    cases: requests.cases.map(c => ({ sourceCaseId: c.sourceCaseId, sourcePoolSha256: c.sourcePoolSha256, referenceContextSha256: c.referenceContextSha256, designatedFactsSha256: c.designatedFactsSha256, questionScopeSha256: c.questionScopeSha256,
      unknowns: c.priorUnknowns ?? [], sufficientFor: 'SYNTHETIC test assertion only: attributed listed quantity, not physical verification.', sourceScopeReviewed: true, originalQuestionsReviewed: true, referenceSufficient: true })), paidExecutionAuthorized: false, qualityClaimEligible: false };
}
test('source-only selection retains all old eligible gaps and the lexicographically first complete control without inspecting v6/answers', () => {
  const requests = reportCalibrationSourceReviewRequests(root); assert.deepEqual(requests.cases.map(c => c.sourceCaseId), [...REPORT_CALIBRATION_V1.selectedSourceCaseIds]); assert.equal(requests.deckCaseIds.length, 12);
  assert.equal(requests.cases[0]!.designatedFacts.length, 3); assert.equal(requests.cases[1]!.designatedFacts.length, 1); assert.match(requests.cases[1]!.designatedFacts[0]!.quote, /65 inches/);
  assert.equal(requests.cases[1]!.reference.length, 5); assert.equal(new Set(requests.cases.map(c => c.product.id)).size, 2);
  verifyReportCalibrationSourceReview(requests, sourceReview(requests));
  const protocol = reportCalibrationDevelopmentProtocol(); assert.deepEqual(JSON.parse(readFileSync(join(root, REPORT_CALIBRATION_V1.protocolPath), 'utf8')), protocol);
  assert.deepEqual(protocol.design.contexts, { current: 'v5', semantic: 'v6', reference: 'independent_curated' }); assert.equal(protocol.design.maximumNewAttempts, 24); assert.equal(protocol.qualityClaimEligible, false);
});
test('factorial instances preserve fixed contexts/policy, two actual products, opaque keyed identities and an unqualified 24-call scope', () => {
  const f = fixtureCases(), create = (key = 'a'.repeat(64)) => createReportCalibrationPreparation(root, f.sourceCases, f.policy, f.ledger, f.bindings, pins, key, join(root, '.data/SYNTHETIC-never-written'));
  const wrapper = create(), manifest = prepareThreeContext(wrapper.diagnostic), metadata = reportCalibrationEvaluationMetadata(wrapper);
  assert.equal(wrapper.diagnostic.codeReviewPassed, false); assert.equal(manifest.document.paidPlan, null); assert.equal(manifest.document.stopReason, 'code_review_pending'); assert.equal(manifest.document.slots.length, 24);
  assert.equal(metadata.actualProducts, 2); assert.equal(metadata.caseInstances, 8); assert.equal(metadata.freshProducts, 0); assert.equal(new Set(wrapper.diagnostic.cases.map(c => c.id)).size, 8);
  assert.deepEqual(create(), wrapper); assert.notDeepEqual(create('b'.repeat(64)).diagnostic.cases.map(c => c.id), wrapper.diagnostic.cases.map(c => c.id));
  assert.ok(!JSON.stringify(metadata).includes('privateCaseIdentityKey')); assert.ok(!JSON.stringify(metadata).includes('caseInstancesPrivate'));
  for (const source of f.sourceCases) for (const repeat of [0, 1]) {
    const instances = wrapper.reportCalibration.caseInstancesPrivate.filter(c => c.sourceCaseId === source.id && c.repeat === repeat); assert.equal(instances.length, 2);
    const cases = instances.map(i => wrapper.diagnostic.cases.find(c => c.id === i.caseId)!); assert.deepEqual(cases[0]!.contexts, cases[1]!.contexts); assert.deepEqual(cases[0]!.contexts, source.contexts);
    assert.notEqual(cases[0]!.generationContract, cases[1]!.generationContract); assert.ok(cases.every(c => !c.id.includes(source.id) && !c.id.includes('uncertainty')));
  }
  const mocked = structuredClone(wrapper.diagnostic); mocked.codeReviewPassed = true; const budget = prepareThreeContext(mocked).document.paidPlan!;
  assert.deepEqual([budget.maximumNewAttempts, budget.planningAllowanceUsd, budget.absoluteCallLimit, budget.cumulativePlanningLimitUsd], [24, 2.4, 165, 16.700281]);
  assert.throws(() => createReportCalibrationPreparation(root, f.sourceCases, f.policy, { ...f.ledger, attempts: 142 }, f.bindings, pins, 'a'.repeat(64), wrapper.outputDirectory));
});
test('candidate no-benefit stop is preserved, rather than qualifying or replacing the selected development cases', () => {
  const f = fixtureCases(); f.sourceCases.forEach(c => { c.contexts.semantic = structuredClone(c.contexts.current); });
  const wrapper = createReportCalibrationPreparation(root, f.sourceCases, f.policy, f.ledger, f.bindings, pins, 'a'.repeat(64), join(root, '.data/SYNTHETIC-never-written'));
  const diagnostic = prepareThreeContext(wrapper.diagnostic); assert.equal(diagnostic.document.paidPlan, null); assert.equal(diagnostic.document.stopReason, 'no_designated_missing_fact_delivered_by_semantic_context'); assert.equal(diagnostic.document.slots.length, 24);
});
test('independent source qualification binds exact source scope/reference/facts/unknowns and cannot silently become code approval', () => {
  const requests = reportCalibrationSourceReviewRequests(root), review = sourceReview(requests);
  for (const mutate of [
    (r: typeof review) => { r.cases[0]!.sourcePoolSha256 = '0'.repeat(64); }, (r: typeof review) => { r.cases[0]!.questionScopeSha256 = '0'.repeat(64); },
    (r: typeof review) => { r.cases[0]!.referenceContextSha256 = '0'.repeat(64); }, (r: typeof review) => { r.cases[0]!.unknowns = []; },
    (r: typeof review) => { r.cases.reverse(); }, (r: typeof review) => { Object.assign(r, { candidateResultsInspected: true }); },
    (r: typeof review) => { Object.assign(r.cases[1]!, { referenceSufficient: false }); }
  ]) { const altered = structuredClone(review); mutate(altered); assert.throws(() => verifyReportCalibrationSourceReview(requests, altered)); }
});
test('preparation rejects changed review bytes, path escapes and symlink output parents before writing anything', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-report-preparation-SYNTHETIC-'))), repository = join(base, 'repository'); mkdirSync(join(repository, '.data'), { recursive: true });
  try {
    for (const path of ['docs/evidence/retrieval-source-coverage-v2-2026-10-18/deck-v1.json', 'docs/evidence/retrieval-source-coverage-v2-2026-10-18/source-review-v1.json', 'docs/evidence/retrieval-source-coverage-v2-2026-10-18/baseline-v1.json', 'docs/evidence/retrieval-diagnosis-2026-10-19/three-context-preparation-final.json', REPORT_CALIBRATION_V1.protocolPath]) { mkdirSync(dirname(join(repository, path)), { recursive: true }); cpSync(join(root, path), join(repository, path)); }
    const requests = reportCalibrationSourceReviewRequests(repository), reviewBytes = encode(sourceReview(requests)), sourcePath = '.data/source-review.json', out = join(repository, '.data/preparation.json'); writeFileSync(join(repository, sourcePath), reviewBytes);
    const selected = { ...pins, sourceReviewPath: sourcePath, expectedSourceReviewSha256: textHash(reviewBytes) }, f = fixtureCases();
    await assert.rejects(buildReportCalibrationPreparation(repository, out, { ...selected, expectedSourceReviewSha256: '0'.repeat(64) }, f.ledger, 'a'.repeat(64)), /Frozen bytes changed/);
    await assert.rejects(buildReportCalibrationPreparation(repository, out, { ...selected, sourceReviewPath: '../outside.json' }, f.ledger, 'a'.repeat(64)));
    writeFileSync(join(repository, sourcePath), reviewBytes + ' '); await assert.rejects(buildReportCalibrationPreparation(repository, out, selected, f.ledger, 'a'.repeat(64)), /Frozen bytes changed/); writeFileSync(join(repository, sourcePath), reviewBytes);
    symlinkSync(base, join(repository, '.data/link')); await assert.rejects(buildReportCalibrationPreparation(repository, join(repository, '.data/link/preparation.json'), selected, f.ledger, 'a'.repeat(64)), /canonical/);
    assert.equal(existsSync(out), false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
test('complete 24-arm mock uses real durable provider/ledger mechanics and anonymous eight-instance evaluation with two synthetic products', async () => {
  const result = await mockReportCalibration(); assert.equal(result.transportCalls, 24); assert.equal(result.newRealProviderCalls, 0); assert.equal(result.result.completedAnswers, 24);
  assert.equal(result.result.newProviderAttempts, 24); assert.equal(result.result.retries, 0); assert.equal(result.budget!.cumulativePlanningLimitUsd, 16.700281);
  assert.equal(result.evaluation.answers, 24); assert.equal(result.evaluation.caseInstances, 8); assert.equal(result.evaluation.actualProducts, 2); assert.equal(result.evaluation.humanJudgments, 0);
  assert.ok(!result.evaluation.anonymousBytes.includes('workspace-answer-uncertainty-v2')); assert.ok(!result.evaluation.anonymousBytes.includes('privateCaseIdentityKey')); assert.ok(!result.evaluation.anonymousBytes.includes('operationRunId'));
});
test('mocked ambiguous failure retains every unattempted answer, unknown receipt outcome/usage and zero retries', async () => {
  const failure = await mockReportCalibration({ failureAt: 5 }); assert.equal(failure.transportCalls, 6); assert.equal(failure.result.completedAnswers, 5); assert.equal(failure.result.failedOrUnknownAnswers, 1); assert.equal(failure.result.unattemptedAnswers, 18);
  assert.equal(failure.result.networkDispatches, null); assert.equal(failure.result.remoteOutcomeUnknownAttempts, 1); assert.equal(failure.result.usage, null); assert.deepEqual(failure.result.knownUsageSubtotal, { inputTokens: 50, outputTokens: 25 }); assert.equal(failure.redispatchAllowed, false);
  const unknown = await mockReportCalibration({ unknownUsageAt: 2 }); assert.equal(unknown.transportCalls, 24); assert.equal(unknown.result.completedAnswers, 24); assert.equal(unknown.result.usage, null); assert.equal(unknown.result.attemptsWithKnownUsage, 23); assert.equal(unknown.result.retries, 0);
});
