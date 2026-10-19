import type { ThreeContextManifest } from '../server/three-context-diagnostic.ts';
/** Future fresh wrapper around the existing actual adapter. No execution or credential path. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { textHash } from '../server/product-corpus.ts';
import { prepareThreeContext, verifyDiagnosticCheckpoint, DIAGNOSTIC_LEDGER, type DiagnosticPreparation, type DiagnosticCheckpoint } from '../server/three-context-diagnostic.ts';
import { requiredThreeContextLiveFiles, verifyThreeContextLiveCheckpoints, type ThreeContextLivePreparation } from '../server/three-context-live.ts';
import { prepareThreeContextEvaluation, reportThreeContextEvaluation } from '../server/three-context-evaluation.ts';
import { readLedgerAnchor, readSourceCalibrationLedgerState, type SourceCalibrationLedgerState } from '../server/source-calibration-comparison.ts';
import { replayFreshValidationContexts } from '../server/fresh-validation-v1.ts';
import { assertFreshSnapshotBindings } from './fresh-validation-contexts-v1.ts';

type Json = Record<string, any>;
const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const encode = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
export type FreshPreparationInputs = { format: 'ablatrix-fresh-validation-preparation-inputs-v1'; freezeDirectory: string; qualificationPath: string; poolPath: string; screeningPath: string; baselinePath: string; sourceReviewPath: string; selectionPath: string; contextsPath: string; contextReviewPath: string; development: { planPath: string; journalPath: string; resultPath: string; anonymousReviewPath: string; armMappingPath: string; evaluationPacketPath: string; importedReviewPaths: string[]; outcomeReviewPath: string } };
function file(name: string, repository = root) {
  assert.ok(name && !isAbsolute(name) && !name.includes('\\') && !name.split('/').some(p => p === '.' || p === '..'));
  const path = resolve(repository, name); assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() && realpathSync(path) === path); return path;
}
function raw(name: string) { const bytes = readFileSync(file(name), 'utf8'); return { path: name, bytes, fileSha256: textHash(bytes) }; }
function artifact(name: string) { const value = raw(name); return { ...value, document: JSON.parse(value.bytes) as Json }; }
function newPrivate(output: string) {
  const path = resolve(root, output), rel = relative(root, path);
  assert.ok(rel.startsWith('.data/') && !rel.split('/').includes('..') && !existsSync(path)); assert.equal(realpathSync(dirname(path)), dirname(path)); return path;
}
export function bindReviewedFreshContexts(snapshot: { fileSha256: string; document: unknown }, review: Json) {
  assert.equal(review.format, 'ablatrix-fresh-validation-context-review-v1'); assert.equal(review.status, 'passed_mechanical_and_source_review');
  assert.equal(review.contextsFileSha256, snapshot.fileSha256, 'Every literal output row must have independent exact-byte review.');
  assert.ok(review.reviewer?.trim() && review.reviewEvidence?.trim()); assert.equal(review.provenance, 'independent_agent_source_and_replay_review');
  for (const key of ['allEightSelectedCasesRetained', 'completeSourceScopeReviewed', 'originalQuestionsReviewed', 'referenceQualificationsReviewed', 'unknownsPreserved', 'savedStageAndSemanticReplayPassed']) assert.equal(review[key], true);
  assert.equal(review.answerQualityMeasured, false); assert.equal(review.paidExecutionAuthorized, false); assert.equal(review.qualityClaimEligible, false);
  return snapshot.document;
}
/** The development outcome decision is independent review of real bound
 * receipts/source judgments. A mocked run cannot unlock prospective spend. */
export function verifyFreshDevelopmentOutcome(record: Json, actual: { planSha256: string; resultFileSha256: string; evaluationPacketSha256: string; importedReviewFileSha256: string[]; result: Json; report: Json; labels: { current: string; semantic: string; reference: string } }) {
  assert.equal(record.format, 'ablatrix-development-outcome-for-fresh-validation-v1'); assert.equal(record.status, 'supports_prospective_validation_preparation');
  assert.equal(record.planSha256, actual.planSha256); assert.equal(record.resultFileSha256, actual.resultFileSha256); assert.equal(record.evaluationPacketSha256, actual.evaluationPacketSha256);
  assert.deepEqual(record.importedReviewFileSha256, actual.importedReviewFileSha256); assert.ok(record.reviewer?.trim() && record.rationale?.trim());
  assert.ok(['source_checked_human', 'independent_source_review_ai'].includes(record.provenance));
  assert.equal(actual.result.transportProvenance, 'live_router', 'Mocked development answers cannot qualify fresh financial planning.');
  assert.equal(actual.result.plannedAnswers, 3); assert.equal(actual.result.completedAnswers, 3); assert.equal(actual.result.failedOrUnknownAnswers, 0); assert.equal(actual.result.unattemptedAnswers, 0); assert.equal(actual.result.retries, 0);
  assert.equal(actual.report.transportProvenance, 'live_router'); assert.equal(actual.report.scope, 'exposed_development_only');
  assert.equal(actual.report.focusedReview.length, 3);
  for (const row of actual.report.focusedReview) { assert.ok(row.reviewers.length > 0, 'Review all three development diagnostic answers before choosing whether validation is warranted.'); if (row.disagreementAxes.length) assert.equal(row.humanSourceChecked, true, 'Source-check substantive reviewer disagreements before a fresh paid proposal.'); }
  for (const comparison of actual.report.caseComparisons ?? []) if (comparison.disagreements?.length) {
    assert.equal(record.provenance, 'source_checked_human', 'Comparative reviewer disagreement needs a source-checked human outcome resolution.');
    assert.ok(record.comparativeDisagreementResolution?.trim(), 'Preserve an explicit human rationale resolving comparative disagreement.');
    for (const disagreement of comparison.disagreements) {
      assert.ok(comparison.reviewerVerdicts.some((v: Json) => v.provenance === 'source_checked_human' && disagreement.labels.every((label: string) => [v.firstLabel, v.secondLabel].includes(label))), 'Save the focused human comparison rather than borrowing unrelated human axis checks.');
    }
  }
  assert.deepEqual(record.armLabels, actual.labels, 'Outcome review must use the exact private mapping after anonymous judgments are saved.');
  const pair = actual.report.caseComparisons?.flatMap((c: Json) => c.reviewerVerdicts).filter((v: Json) => new Set([v.firstLabel, v.secondLabel]).has(actual.labels.current) && new Set([v.firstLabel, v.secondLabel]).has(actual.labels.semantic)) ?? [];
  assert.ok(pair.length, 'Source-axis reviews alone do not establish a current-versus-candidate preference; save explicit anonymous comparisons.');
  const wins = pair.filter((v: Json) => v.preferredLabel === actual.labels.semantic).length;
  const losses = pair.filter((v: Json) => v.preferredLabel === actual.labels.current).length;
  const ties = pair.filter((v: Json) => v.outcome === 'tie').length;
  const verdict = losses && !wins ? 'regression' : wins && !losses ? 'useful_benefit_demonstrated' : ties === pair.length ? 'tie' : 'uncertain';
  assert.equal(record.candidateVsCurrentVerdict, verdict); assert.notEqual(verdict, 'regression', 'A preferred baseline stops fresh paid planning; preserve the negative development result.');
  let materialRegressions = 0;
  for (const reviewer of actual.report.reviewRecords) {
    const before = reviewer.answers.find((a: Json) => a.label === actual.labels.current), after = reviewer.answers.find((a: Json) => a.label === actual.labels.semantic);
    if (before && after && (after.unsupportedClaims.material > before.unsupportedClaims.material || (after.exactApplicability === 'fail' && before.exactApplicability !== 'fail'))) materialRegressions++;
  }
  assert.equal(materialRegressions, 0, 'Known unsupported-claim/applicability regression blocks a fresh paid proposal.');
  assert.equal(record.noUnresolvedMaterialRegression, true);
  if (verdict === 'tie' || verdict === 'uncertain') {
    assert.equal(record.decision, 'allow_bounded_exploratory_validation'); assert.ok(record.exploratoryRationale?.trim(), 'A tie or uncertainty needs an explicit independent reason to justify a separate bounded exploratory comparison.');
  } else assert.equal(record.decision, 'allow_prospective_validation_preparation');
  assert.equal(record.qualityClaimEligible, false); assert.equal(record.paidExecutionAuthorized, false);
  return record;
}
/** Verify canonical local occurrence, not cryptographic provider authenticity. */
export function verifyActualDevelopmentLedger(diagnostic: ThreeContextManifest, checkpoint: DiagnosticCheckpoint, state: SourceCalibrationLedgerState) {
  assert.equal(checkpoint.provenance, 'live_router'); const observed = verifyDiagnosticCheckpoint(diagnostic, checkpoint); assert.equal(observed.completedAnswers, 3); assert.equal(diagnostic.document.scope, 'exposed_development_only');
  const anchor = diagnostic.document.preparation.ledger; assert.equal(state.canonicalPath, DIAGNOSTIC_LEDGER); assert.equal(state.priorSpendUsd, .200281); assert.equal(state.pending, 0); assert.equal(state.owners, 0);
  assert.equal(state.historicalRowsSha256, anchor.historicalRowsSha256, 'Changed non-development ledger history needs separate read-only reconciliation, never rerun the diagnostic.');
  assert.equal(state.rows.length, diagnostic.document.slots.length, 'Every actual development attempt must occur in the canonical shared ledger.'); assert.equal(state.attempts, anchor.attempts + state.rows.length); assert.ok(Math.abs(state.reservedUsd - anchor.reservedUsd - state.rows.length * .1) < 1e-8);
  for (const [index, slot] of diagnostic.document.slots.entries()) {
    const step = checkpoint.steps[index]!, rows = state.rows.filter(row => row.run_id === slot.input.runId); assert.equal(rows.length, 1); const row = rows[0]!; assert.ok(step.receipt && row.status === 'completed' && !row.error_code);
    for (const key of ['id', 'kind', 'status', 'error_code', 'receipt_json', 'model', 'input_tokens', 'output_tokens', 'allowance_usd'] as const) assert.equal(row[key], step.receipt[key], 'Saved development receipt must equal its actual canonical ledger row.');
    assert.equal(row.id, step.attemptId);
  }
  return { verifiedActualDevelopmentAttempts: state.rows.length, canonicalLocalOccurrenceVerified: true, providerOriginIndependentlyAuthenticated: false };
}
export function mergeFreshBindings(...maps: Record<string, string>[]) {
  const result: Record<string, string> = {};
  for (const map of maps) for (const [path, digest] of Object.entries(map)) {
    assert.match(digest, /^[a-f0-9]{64}$/);
    if (Object.hasOwn(result, path)) assert.equal(result[path], digest, 'Conflicting duplicate artifact byte bindings cannot be hidden by map merges.');
    result[path] = digest;
  }
  return result;
}
function checkCodeReview(record: Json, recordBytes: string, expectedSha: string, implementation: Record<string, string>, artifacts: Record<string, string>, inputsFileSha256: string) {
  assert.match(expectedSha, /^[a-f0-9]{64}$/); assert.equal(textHash(recordBytes), expectedSha); assert.deepEqual(JSON.parse(recordBytes), record);
  assert.equal(record.format, 'ablatrix-fresh-validation-code-qualification-v1'); assert.equal(record.status, 'ready_for_unexecuted_financial_proposal');
  assert.equal(record.inputsFileSha256, inputsFileSha256); assert.deepEqual(record.implementationSha256, implementation); assert.deepEqual(record.artifactSha256, artifacts);
  assert.equal(record.provenance, 'independent_agent_code_review'); assert.ok(record.reviewer?.trim() && record.reviewEvidence?.trim()); assert.match(record.reviewedCommit, /^[a-f0-9]{40}$/);
  for (const key of ['protocolBeforeFreshReads', 'completeHistoricalAndWithinDeckProtection', 'sourceReviewBeforeCandidate', 'exactContextReplay', 'actualDevelopmentOutcomeReviewed', 'sameGenerationContractAcrossArms', 'durableReservationAndZeroRetry', 'separateExactFreshFinancialApproval', 'blindReviewPrivacy', 'noAutomaticActivation']) assert.equal(record.checks?.[key], true);
  assert.equal(record.paidExecutionAuthorized, false); assert.equal(record.qualityClaimEligible, false);
}
export async function prepareFreshThreeContext(inputsPath: string, output: string, codeReviewPath?: string, codeReviewSha256?: string) {
  const destination = newPrivate(output), inputsArtifact = artifact(inputsPath), i = inputsArtifact.document as FreshPreparationInputs;
  assert.equal(i.format, 'ablatrix-fresh-validation-preparation-inputs-v1');
  // This guard runs before reading ANY fresh packet/context. A pending protocol
  // qualification still fails before the selector reads/stats its pool path.
  const base = ['--freeze-dir', i.freezeDirectory, '--qualification', i.qualificationPath, '--pool', i.poolPath, '--screening', i.screeningPath];
  const initial = JSON.parse(execFileSync('python3', ['-I', 'scripts/prepare-fresh-validation-v1.py', 'verify-screen', ...base], { cwd: root, env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 30_000, maxBuffer: 1_048_576 }));
  const screening = artifact(i.screeningPath), baseline = artifact(i.baselinePath), sourceReview = artifact(i.sourceReviewPath), selection = artifact(i.selectionPath), contexts = artifact(i.contextsPath), contextReview = artifact(i.contextReviewPath);
  assertFreshSnapshotBindings([screening], initial.artifactSha256);
  const replaySelectionPath = `${destination}.selection-replay`;
  const checked = JSON.parse(execFileSync('python3', ['-I', 'scripts/prepare-fresh-validation-v1.py', 'select', ...base, '--baseline', i.baselinePath, '--review', i.sourceReviewPath, '--out', replaySelectionPath], { cwd: root, env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 30_000, maxBuffer: 1_048_576 }));
  assert.equal(checked.stopReason, null); assertFreshSnapshotBindings([screening, baseline, sourceReview], checked.artifactSha256);
  const replaySelection = JSON.parse(readFileSync(replaySelectionPath, 'utf8')); assert.deepEqual(selection.document, replaySelection);
  bindReviewedFreshContexts(contexts, contextReview.document);
  const context = await replayFreshValidationContexts(screening.document as any, baseline.document as any, sourceReview.document as any, selection.document as any, contexts.document as any, { baselineFileSha256: baseline.fileSha256, sourceReviewFileSha256: sourceReview.fileSha256 });
  const d = i.development, plan = artifact(d.planPath), journal = raw(d.journalPath), result = artifact(d.resultPath), anonymous = artifact(d.anonymousReviewPath), mapping = artifact(d.armMappingPath), evaluation = artifact(d.evaluationPacketPath), imported = d.importedReviewPaths.map(artifact), outcome = artifact(d.outcomeReviewPath);
  const checkpoints = journal.bytes.trim().split('\n').map(line => JSON.parse(line) as DiagnosticCheckpoint);
  const actualResult = verifyThreeContextLiveCheckpoints(plan.document as any, checkpoints); assert.deepEqual(result.document, actualResult);
  assert.equal(plan.document.diagnostic.document.scope, 'exposed_development_only');
  verifyActualDevelopmentLedger(plan.document.diagnostic, checkpoints.at(-1)!, readSourceCalibrationLedgerState(DIAGNOSTIC_LEDGER, .200281, plan.document.diagnostic.document.slots.map((s: Json) => s.input.runId)));
  const expectedEvaluation = prepareThreeContextEvaluation(plan.document as any, checkpoints, actualResult, anonymous.document as any); assert.deepEqual(evaluation.document, expectedEvaluation);
  const report = reportThreeContextEvaluation(evaluation.document as any, imported.map(v => v.document) as any);
  const observed = verifyDiagnosticCheckpoint(plan.document.diagnostic, checkpoints.at(-1)!);
  const labels: Record<string, string> = {};
  assert.ok(Array.isArray(mapping.document)); assert.equal(mapping.document.length, 3); assert.equal(new Set(mapping.document.map((r: Json) => r.label)).size, 3);
  for (const row of mapping.document as any) {
    const index = plan.document.diagnostic.document.slots.findIndex((slot: Json) => slot.caseId === row.caseId && slot.arm === row.arm && slot.input.runId === row.operationRunId);
    assert.ok(index >= 0 && ['current', 'semantic', 'reference'].includes(row.arm)); assert.equal(row.attemptId, checkpoints.at(-1)!.steps[index]!.attemptId);
    const answer = anonymous.document.answers.find((a: Json) => a.label === row.label && a.caseId === row.caseId); assert.ok(answer); assert.deepEqual(answer.output, observed.outputs[index]!.output!.answer);
    assert.ok(!labels[row.arm]); labels[row.arm] = row.label;
  }
  verifyFreshDevelopmentOutcome(outcome.document, { planSha256: plan.document.sha256, resultFileSha256: result.fileSha256, evaluationPacketSha256: evaluation.document.sha256, importedReviewFileSha256: imported.map(v => v.fileSha256), result: actualResult, report, labels: labels as { current: string; semantic: string; reference: string } });
  const freeze = artifact(`${i.freezeDirectory}/candidate-freeze-v1.json`), protocol = artifact(`${i.freezeDirectory}/protocol-v1.json`), history = artifact(`${i.freezeDirectory}/history-inventory-v1.json`);
  assertFreshSnapshotBindings([freeze, protocol, history], checked.artifactSha256);
  const paths = [...new Set([...requiredThreeContextLiveFiles(root), ...Object.keys(freeze.document.implementationSha256), 'scripts/prepare-three-context-fresh-v1.ts', 'server/three-context-evaluation.ts', 'server/retrieval-diagnosis-replay.ts'])].sort();
  const implementation = Object.fromEntries(paths.map(p => [p, textHash(readFileSync(file(p), 'utf8'))]));
  const snapshots = [inputsArtifact, screening, baseline, sourceReview, selection, contexts, contextReview, plan, journal, result, anonymous, mapping, evaluation, ...imported, outcome, freeze, protocol, history];
  let artifacts = mergeFreshBindings(checked.artifactSha256, history.document.artifactSha256, Object.fromEntries(snapshots.map(v => [v.path, v.fileSha256])));
  let codeReviewPassed = false;
  if (codeReviewPath || codeReviewSha256) {
    assert.ok(codeReviewPath && codeReviewSha256); const code = artifact(codeReviewPath);
    checkCodeReview(code.document, code.bytes, codeReviewSha256, implementation, artifacts, inputsArtifact.fileSha256);
    artifacts = mergeFreshBindings(artifacts, { [code.path]: code.fileSha256 }); snapshots.push(code); codeReviewPassed = true;
  }
  const ledger = readLedgerAnchor(DIAGNOSTIC_LEDGER, .200281), { pathSha256: _privatePathDigest, ...anchor } = ledger;
  const diagnostic: DiagnosticPreparation = { cases: context.cases, policy: plan.document.preparation.diagnostic.policy, implementationSha256: implementation, artifactSha256: artifacts, ledger: anchor, codeReviewPassed,
    validation: { contract: 'ablatrix-fresh-validation-v1', protocolSha256: protocol.fileSha256, candidateFreezeSha256: freeze.fileSha256, historyInventorySha256: history.fileSha256, sourceReviewSha256: sourceReview.fileSha256, developmentOutcomeReviewSha256: outcome.fileSha256, selectedDenominator: 8, screeningDenominator: 24, qualificationPassed: codeReviewPassed } };
  const prepared = prepareThreeContext(diagnostic);
  const wrapper: ThreeContextLivePreparation = { repositoryPath: root, outputDirectory: resolve(root, '.data', `fresh-validation-${textHash(inputsArtifact.bytes).slice(0, 20)}-${codeReviewPassed ? 'reviewed' : 'unqualified'}-execution`), diagnostic };
  // Recheck the actual snapshots used, rather than borrowing later read hashes.
  for (const value of snapshots) assert.equal(textHash(readFileSync(file(value.path), 'utf8')), value.fileSha256);
  for (const [p, digest] of Object.entries(artifacts)) assert.equal(textHash(readFileSync(file(p), 'utf8')), digest);
  for (const [p, digest] of Object.entries(implementation)) assert.equal(textHash(readFileSync(file(p), 'utf8')), digest);
  assert.deepEqual(readLedgerAnchor(DIAGNOSTIC_LEDGER, .200281), ledger);
  newPrivate(destination); writeFileSync(destination, encode(wrapper), { flag: 'wx', mode: 0o600 });
  return { mode: 'future_fresh_validation_preparation', screeningDenominator: 24, selectedCases: 8, contexts: 24, codeReviewPassed, stopReason: prepared.document.stopReason, proposedBudget: prepared.document.paidPlan, paidExecutionAuthorized: false, providerCalls: 0, output: destination };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [inputs, output, codeReviewPath, codeReviewSha256] = process.argv.slice(2);
  if (!inputs) console.log(JSON.stringify({ usage: 'prepare-three-context-fresh-v1.ts INPUTS_JSON NEW_PRIVATE_PREPARATION_JSON [EXACT_CODE_REVIEW_JSON REVIEW_RAW_SHA256]', providerCalls: 0, freshInputReads: 0 }));
  else console.log(JSON.stringify(await prepareFreshThreeContext(inputs, output!, codeReviewPath, codeReviewSha256)));
}
