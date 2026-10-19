import test from 'node:test';
import assert from 'node:assert/strict';
import { freshValidationContexts, freshSeal, replayFreshValidationContexts, freshValidationCorpus } from './fresh-validation-v1.ts';
import { mockedFreshValidation, syntheticFreshContexts } from '../scripts/fresh-validation-mock.ts';
import { freshValidationCli, assertFreshSnapshotBindings } from '../scripts/fresh-validation-contexts-v1.ts';
import { bindReviewedFreshContexts, verifyFreshDevelopmentOutcome, mergeFreshBindings } from '../scripts/prepare-three-context-fresh-v1.ts';

test('fresh baseline/source-reference/candidate bridge preserves validation scope, eight misses and all24 screening rows', async () => {
  const f = await syntheticFreshContexts();
  assert.equal(f.screening.decisions.length, 24); assert.equal(f.baseline.results.length, 24); assert.equal(f.review.cases.length, 24); assert.equal(f.contexts.cases.length, 8);
  assert.ok(f.contexts.cases.every(c => c.product.split === 'validation' && c.referenceReview.unknowns.length));
  assert.ok(f.contexts.results.every(r => r.answerStatus.reference === 'not_attempted'));
  assert.ok(f.contexts.cases.some(c => c.contexts.reference.some(s => s.text.includes('manual extinguishing'))));
  assert.ok(f.contexts.cases.every(c => JSON.stringify(c.contexts.semantic.slice(0, c.contexts.current.length)) === JSON.stringify(c.contexts.current)));
});

test('zero-delivery fresh candidate preserves all selected cases and stops future paid path', async () => {
  const f = await syntheticFreshContexts(true);
  assert.equal(f.contexts.sourceBenefit, false); assert.equal(f.contexts.stopReason, 'no_designated_missing_fact_delivered_by_semantic_context'); assert.equal(f.contexts.results.length, 8);
  await assert.rejects(mockedFreshValidation({ noBenefit: true }), /No-benefit|unreviewed/);
});

test('fresh context bridge rejects changed selected IDs, source scope or reference bytes before candidate use', async () => {
  const f = await syntheticFreshContexts(); let calls = 0;
  const scorer = async (_q: string, docs: string[]) => { calls++; return docs.map(() => 1); };
  const bindings = { baselineFileSha256: f.selection.baselineSha256, sourceReviewFileSha256: f.selection.sourceReviewSha256 };
  const changed = structuredClone(f.selection); changed.selectedCaseIds[0] = changed.selectedCaseIds[1]!;
  await assert.rejects(freshValidationContexts(f.screening, f.baseline, f.review, changed, scorer, bindings)); assert.equal(calls, 0);
  const review = structuredClone(f.review); review.cases[0]!.referenceSourceIds = ['wrong-source'];
  const selection = { ...f.selection, sourceReviewSha256: freshSeal(review) };
  await assert.rejects(freshValidationContexts(f.screening, f.baseline, review, selection, scorer, { ...bindings, sourceReviewFileSha256: freshSeal(review) })); assert.equal(calls, 0);
});

test('fresh24-arm workflow reuses actual bounded provider, durable temporary ledger and receipt/checkpoint verification', async () => {
  const { execution } = await mockedFreshValidation();
  assert.equal(execution.calls, 24); assert.equal(execution.result.completedAnswers, 24); assert.equal(execution.result.observedDispatches, 24); assert.equal(execution.result.networkDispatches, 24);
  assert.equal(execution.manifest.document.scope, 'prospective_fresh_validation'); assert.equal(execution.manifest.document.format, 'ablatrix-three-context-fresh-validation-v1');
  assert.ok(execution.closed); assert.equal(execution.anonymous.review.answers.length, 24);
  const serialized = JSON.stringify(execution.anonymous.review); assert.ok(!serialized.includes('operationRunId') && !serialized.includes('attemptId') && !serialized.includes('"arm":'));
});

test('failed fresh arm remains failed and later23 arms unattempted without retries', async () => {
  const { execution } = await mockedFreshValidation({ failure: true });
  assert.equal(execution.calls, 1); assert.equal(execution.result.completedAnswers, 0);
  assert.equal(execution.result.outputs[0]!.status, 'failed_or_unknown'); assert.equal(execution.result.outputs.filter(r => r.status === 'not_attempted').length, 23);
});

test('fresh CLI help has no fresh-source, model, ledger or provider side effects', async () => {
  assert.deepEqual(await freshValidationCli([]), { usage: ['--baseline --freeze-dir DIR --qualification FILE --pool FILE --screening FILE --out NEW', '--contexts --freeze-dir DIR --qualification FILE --pool FILE --screening FILE --baseline FILE --review FILE --selection FILE --out NEW'], providerCalls: 0, freshInputReads: 0 });
});

test('fresh baseline cannot invent a gap by changing restored parents and chunk selection while keeping trace ranks', async () => {
  const f = await syntheticFreshContexts(), baseline = structuredClone(f.baseline);
  baseline.results[0]!.indexRetrieval.passages = baseline.results[0]!.indexRetrieval.passages.slice(1);
  baseline.results[0]!.baseline = baseline.results[0]!.baseline.slice(1);
  const baselineFileSha256 = freshSeal(baseline), review = { ...f.review, baselineSha256: baselineFileSha256 }, sourceReviewFileSha256 = freshSeal(review);
  const selection = { ...f.selection, baselineSha256: baselineFileSha256, sourceReviewSha256: sourceReviewFileSha256 };
  let scores = 0;
  await assert.rejects(freshValidationContexts(f.screening, baseline, review, selection, async (_q, d) => { scores++; return d.map(() => 1); }, { baselineFileSha256, sourceReviewFileSha256 }), /saved-stage replay/);
  assert.equal(scores, 0);
});

test('fresh context replay checks all output rows and rejects arbitrary literal-source append or delivery edits', async () => {
  const f = await syntheticFreshContexts(), bindings = { baselineFileSha256: f.selection.baselineSha256, sourceReviewFileSha256: f.selection.sourceReviewSha256 };
  await replayFreshValidationContexts(f.screening, f.baseline, f.review, f.selection, f.contexts, bindings);
  const edited = structuredClone(f.contexts); edited.results[0]!.recoveredMissingUnits++;
  await assert.rejects(replayFreshValidationContexts(f.screening, f.baseline, f.review, f.selection, edited, bindings), /full candidate decisions/);
  const appended = structuredClone(f.contexts), item = appended.cases[0]!;
  const missing = item.completeSources.find(s => !item.contexts.semantic.some(p => p.id === s.id));
  assert.ok(missing); item.contexts.semantic.push(missing);
  await assert.rejects(replayFreshValidationContexts(f.screening, f.baseline, f.review, f.selection, appended, bindings), /full candidate decisions/);
});

test('parsed input snapshots cannot borrow hashes from later independently verified file reads', () => {
  const first = { path: 'screening.json', fileSha256: '1'.repeat(64), document: { case: 'first bytes' } };
  assert.doesNotThrow(() => assertFreshSnapshotBindings([first], { 'screening.json': first.fileSha256 }));
  assert.throws(() => assertFreshSnapshotBindings([first], { 'screening.json': '2'.repeat(64) }), /parsed snapshot/);
});

test('fresh wrapper requires exact reviewed output bytes and refuses mocked development outcome', () => {
  const review = { format: 'ablatrix-fresh-validation-context-review-v1', status: 'passed_mechanical_and_source_review', contextsFileSha256: '1'.repeat(64), reviewer: 'SYNTHETIC independent', reviewEvidence: 'SYNTHETIC source check', provenance: 'independent_agent_source_and_replay_review', allEightSelectedCasesRetained: true, completeSourceScopeReviewed: true, originalQuestionsReviewed: true, referenceQualificationsReviewed: true, unknownsPreserved: true, savedStageAndSemanticReplayPassed: true, answerQualityMeasured: false, paidExecutionAuthorized: false, qualityClaimEligible: false };
  assert.deepEqual(bindReviewedFreshContexts({ fileSha256: '1'.repeat(64), document: { rows: 8 } }, review), { rows: 8 });
  assert.throws(() => bindReviewedFreshContexts({ fileSha256: '2'.repeat(64), document: { rows: 8 } }, review), /exact-byte review/);
  const record = { format: 'ablatrix-development-outcome-for-fresh-validation-v1', status: 'supports_prospective_validation_preparation', planSha256: 'a', resultFileSha256: 'b', evaluationPacketSha256: 'c', importedReviewFileSha256: ['d'], reviewer: 'SYNTHETIC', rationale: 'SYNTHETIC mechanics', provenance: 'independent_source_review_ai' };
  assert.throws(() => verifyFreshDevelopmentOutcome(record, { planSha256: 'a', resultFileSha256: 'b', evaluationPacketSha256: 'c', importedReviewFileSha256: ['d'], result: { transportProvenance: 'mocked_mechanics_only' }, report: {}, labels: { current: 'Answer 1', semantic: 'Answer 2', reference: 'Answer 3' } }), /Mocked development/);
});

test('fresh raw artifact binding map rejects a conflicting duplicate rather than overwriting a reviewed hash', () => {
  assert.deepEqual(mergeFreshBindings({ 'source.json': '1'.repeat(64) }, { 'source.json': '1'.repeat(64) }), { 'source.json': '1'.repeat(64) });
  assert.throws(() => mergeFreshBindings({ 'source.json': '1'.repeat(64) }, { 'source.json': '2'.repeat(64) }), /Conflicting duplicate/);
});

test('development preference gate retains ties and regressions and requires an explicit exploratory rationale', () => {
  const labels = { current: 'Answer 1', semantic: 'Answer 2', reference: 'Answer 3' };
  const record: any = { format: 'ablatrix-development-outcome-for-fresh-validation-v1', status: 'supports_prospective_validation_preparation', planSha256: 'a', resultFileSha256: 'b', evaluationPacketSha256: 'c', importedReviewFileSha256: ['d'], reviewer: 'SYNTHETIC', rationale: 'SYNTHETIC reviewed diagnostic', provenance: 'independent_source_review_ai', armLabels: labels, noUnresolvedMaterialRegression: true, candidateVsCurrentVerdict: 'tie', decision: 'allow_bounded_exploratory_validation', qualityClaimEligible: false, paidExecutionAuthorized: false };
  const actual: any = { planSha256: 'a', resultFileSha256: 'b', evaluationPacketSha256: 'c', importedReviewFileSha256: ['d'], labels,
    result: { transportProvenance: 'live_router', plannedAnswers: 3, completedAnswers: 3, failedOrUnknownAnswers: 0, unattemptedAnswers: 0, retries: 0 },
    report: { transportProvenance: 'live_router', scope: 'exposed_development_only', focusedReview: Object.values(labels).map(label => ({ label, reviewers: [{ reviewer: 'SYNTHETIC' }], disagreementAxes: [] })), reviewRecords: [], caseComparisons: [{ reviewerVerdicts: [{ firstLabel: labels.current, secondLabel: labels.semantic, outcome: 'tie', preferredLabel: null }] }] } };
  assert.throws(() => verifyFreshDevelopmentOutcome(record, actual), /explicit independent reason/);
  record.exploratoryRationale = 'SYNTHETIC explicit bounded exploration reason; no gain claim.';
  assert.equal(verifyFreshDevelopmentOutcome(record, actual), record);
  actual.report.caseComparisons[0].reviewerVerdicts[0] = { firstLabel: labels.current, secondLabel: labels.semantic, outcome: 'first_preferred', preferredLabel: labels.current };
  record.candidateVsCurrentVerdict = 'regression';
  assert.throws(() => verifyFreshDevelopmentOutcome(record, actual), /preferred baseline stops/);
});
