/** Offline review/receipt gates. Never constructs a provider or reads credentials. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { textHash } from './product-corpus.ts';
import { reportDevelopmentFile } from './report-uncertainty-development.ts';
import { buildReportCalibrationPreparation, reportCalibrationEvaluationMetadata, type ReportCalibrationPreparation } from '../scripts/prepare-report-calibration-v1.ts';
import { DIAGNOSTIC_LEDGER, diagnosticHash, prepareThreeContext, type DiagnosticCheckpoint } from './three-context-diagnostic.ts';
import { checkThreeContextLiveFiles, verifyThreeContextLiveCheckpoints, type ThreeContextLiveManifest } from './three-context-live.ts';
import { prepareThreeContextEvaluation, importThreeContextReview, reportThreeContextEvaluation, type ImportedThreeContextReview } from './three-context-evaluation.ts';
import { readLedgerAnchor, readSourceCalibrationLedgerState } from './source-calibration-comparison.ts';

type Json = Record<string, any>;
export const REPORT_CODE_CHECKS = ['exact_source_and_question_scope', 'all12_replayed_and_two_product_denominator', 'instruction_and_context_factorial_parity', 'private_case_and_arm_identity', 'approval_before_credentials', 'durable_reservation_and_no_retry', 'receipt_unknown_and_failure_accounting', 'no_default_activation'] as const;
const encode = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
function read(root: string, path: string) { const bytes = readFileSync(reportDevelopmentFile(root, path), 'utf8'); return { bytes, sha256: textHash(bytes), document: JSON.parse(bytes) }; }
function newPrivate(root: string, path: string) { const full = resolve(root, path), rel = relative(root, full); assert.ok(rel.startsWith('.data/') && !rel.split('/').includes('..') && !existsSync(full)); assert.equal(realpathSync(dirname(full)), dirname(full)); return full; }
const pinsOf = (p: ReportCalibrationPreparation) => ({ v6ReviewedResultPath: p.reportCalibration.v6ReviewedResultPath, expectedV6ReviewedResultSha256: p.reportCalibration.v6ReviewedResultSha256, sourceReviewPath: p.reportCalibration.sourceReviewPath, expectedSourceReviewSha256: p.reportCalibration.sourceReviewSha256 });
export type ReportCodeReview = { format: 'ablatrix-report-calibration-code-review-v1'; provenance: 'independent_agent_code_review'; reviewer: string; reviewedCommit: string;
  reviewedPreparationSha256: string; implementationSha256: Record<string, string>; artifactSha256: Record<string, string>; checks: Record<typeof REPORT_CODE_CHECKS[number], true>;
  outcome: 'ready_for_unexecuted_financial_proposal'; rationale: string; paidExecutionAuthorized: false; qualityClaimEligible: false };
export type QualifiedReportCalibration = ReportCalibrationPreparation & { reportCodeQualification: { preparationPath: string; preparationSha256: string; reviewPath: string; reviewSha256: string } };

async function reviewBase(root: string, basePath: string, reviewPath: string, reviewSha256: string) {
  const base = read(root, basePath), review = read(root, reviewPath), p = base.document as ReportCalibrationPreparation, r = review.document as ReportCodeReview;
  assert.equal(p.repositoryPath, root); assert.equal(p.diagnostic.codeReviewPassed, false);
  assert.equal(review.sha256, reviewSha256); assert.equal(r.format, 'ablatrix-report-calibration-code-review-v1'); assert.equal(r.provenance, 'independent_agent_code_review');
  assert.ok(r.reviewer.trim() && r.rationale.trim()); assert.match(r.reviewedCommit, /^[a-f0-9]{40}$/); assert.equal(r.outcome, 'ready_for_unexecuted_financial_proposal');
  assert.equal(r.reviewedPreparationSha256, base.sha256); assert.deepEqual(r.implementationSha256, p.diagnostic.implementationSha256); assert.deepEqual(r.artifactSha256, p.diagnostic.artifactSha256);
  for (const map of [r.implementationSha256, r.artifactSha256]) for (const [path, sha] of Object.entries(map)) assert.equal(textHash(readFileSync(reportDevelopmentFile(root, path), 'utf8')), sha);
  assert.deepEqual(Object.keys(r.checks).sort(), [...REPORT_CODE_CHECKS].sort()); for (const key of REPORT_CODE_CHECKS) assert.equal(r.checks[key], true);
  assert.equal(r.paidExecutionAuthorized, false); assert.equal(r.qualityClaimEligible, false);
  const reconstructed = await buildReportCalibrationPreparation(root, resolve(root, '.data', `reconstruction-${base.sha256}.json`), pinsOf(p), p.diagnostic.ledger, p.reportCalibration.privateCaseIdentityKey);
  assert.deepEqual(p, reconstructed, 'Review covers exact source eligibility, contexts, policy variants, repeats, order, private identities and all byte bindings.');
  return { base, review, p, r };
}
function qualified(root: string, basePath: string, reviewPath: string, checked: Awaited<ReturnType<typeof reviewBase>>) {
  const p: QualifiedReportCalibration = { ...structuredClone(checked.p), reportCodeQualification: { preparationPath: basePath, preparationSha256: checked.base.sha256, reviewPath, reviewSha256: checked.review.sha256 } };
  assert.ok(!Object.hasOwn(p.diagnostic.artifactSha256, reviewPath)); p.diagnostic.artifactSha256[reviewPath] = checked.review.sha256;
  p.diagnostic.codeReviewPassed = true; p.outputDirectory = resolve(root, '.data', `report-calibration-reviewed-${checked.review.sha256.slice(0, 16)}-execution`); return p;
}
export async function verifyQualifiedReportCalibration(p: QualifiedReportCalibration) {
  const root = p.repositoryPath, q = p.reportCodeQualification; assert.ok(q);
  const checked = await reviewBase(root, q.preparationPath, q.reviewPath, q.reviewSha256); assert.equal(q.preparationSha256, checked.base.sha256);
  assert.deepEqual(p, qualified(root, q.preparationPath, q.reviewPath, checked)); return p;
}
export async function qualifyReportCalibration(root: string, basePath: string, reviewPath: string, reviewSha256: string, outputPath: string) {
  const output = newPrivate(root, outputPath), checked = await reviewBase(root, basePath, reviewPath, reviewSha256);
  const anchor = readLedgerAnchor(DIAGNOSTIC_LEDGER, .200281), { pathSha256: _path, ...ledger } = anchor;
  assert.deepEqual(ledger, checked.p.diagnostic.ledger, 'Review a new preparation if any canonical reservation changed.');
  const p = qualified(root, basePath, reviewPath, checked), plan = prepareThreeContext(p.diagnostic); assert.ok(plan.document.paidPlan && plan.document.stopReason === null); assert.equal(plan.document.slots.length, 24);
  assert.ok(!existsSync(p.outputDirectory)); writeFileSync(output, encode(p), { flag: 'wx', mode: 0o600 });
  assert.deepEqual(readLedgerAnchor(DIAGNOSTIC_LEDGER, .200281), anchor);
  return { mode: 'qualified_unexecuted_preparation', output, ...reportCalibrationEvaluationMetadata(p), budget: plan.document.paidPlan, paidExecutionAuthorized: false, newProviderCalls: 0 };
}
export async function reportCalibrationFinancialProposal(manifest: ThreeContextLiveManifest, planPath: string) {
  checkThreeContextLiveFiles(manifest, planPath); const p = await verifyQualifiedReportCalibration(manifest.preparation as QualifiedReportCalibration), budget = manifest.diagnostic.document.paidPlan;
  assert.ok(budget && p.diagnostic.codeReviewPassed && !p.diagnostic.validation); const anchor = readLedgerAnchor(DIAGNOSTIC_LEDGER, .200281), { pathSha256: _path, ...ledger } = anchor; assert.deepEqual(ledger, p.diagnostic.ledger);
  return { ...reportCalibrationEvaluationMetadata(p), format: 'ablatrix-report-calibration-financial-proposal-v1', privatePlanSha256: manifest.sha256,
    design: { products: 2, instructionContracts: p.reportCalibration.instructionContracts, repeats: 2, contexts: ['v5', 'v6', 'source_checked_reference'], answers: 24 },
    canonicalLedger: { attempts: ledger.attempts, reservedUsd: Number(ledger.reservedUsd.toFixed(6)), priorAdjustmentUsd: ledger.priorSpendUsd, combinedPlanningUsd: Number((ledger.reservedUsd + ledger.priorSpendUsd).toFixed(6)), pending: ledger.pending, owners: ledger.owners }, budget,
    retries: 0, graderCalls: 0, webCalls: 0, repairCalls: 0, actualProviderCharges: 'unavailable', providerEnforcedCap: false, paidExecutionAuthorized: false, newProviderCalls: 0,
    limitation: 'Exact proposed24 local answer attempts, not a quality claim or approval. Both products were previously exposed. Exact fresh financial approval is required before dispatch.' };
}

/** This gate is intentionally unavailable until the real new24 and their
 * independent source reviews exist. JSON booleans never substitute for replay. */
export async function verifyReportCalibrationOutcome(root: string, outcomePath: string) {
  const saved = read(root, outcomePath), outcome = saved.document as Json;
  assert.equal(outcome.format, 'ablatrix-v6-development-outcome-qualification-v1'); assert.equal(outcome.status, 'independently_reviewed_for_bounded_fresh_preparation');
  const artifacts = new Map<string, ReturnType<typeof read>>();
  const bound = (path: string, sha: string) => { const value = read(root, path); assert.match(sha, /^[a-f0-9]{64}$/); assert.equal(value.sha256, sha); artifacts.set(path, value); return value.document; };
  const manifest = bound(outcome.planPath, outcome.planFileSha256) as ThreeContextLiveManifest;
  checkThreeContextLiveFiles(manifest, resolve(root, outcome.planPath)); const p = await verifyQualifiedReportCalibration(manifest.preparation as QualifiedReportCalibration);
  assert.equal(p.repositoryPath, root); assert.equal(manifest.sha256, outcome.planSha256); assert.equal(p.diagnostic.cases.length, 8);
  const rawJournal = readFileSync(reportDevelopmentFile(root, outcome.checkpointPath), 'utf8'); assert.equal(textHash(rawJournal), outcome.checkpointFileSha256); assert.ok(rawJournal.endsWith('\n'));
  const checkpoints = rawJournal.trimEnd().split('\n').map(line => JSON.parse(line) as DiagnosticCheckpoint), last = checkpoints.at(-1)!;
  const result = verifyThreeContextLiveCheckpoints(manifest, checkpoints);
  assert.deepEqual(bound(outcome.resultPath, outcome.resultFileSha256), result); assert.equal(result.transportProvenance, 'live_router');
  for (const key of ['plannedAnswers', 'newProviderAttempts', 'completedAnswers', 'transportInvocations', 'observedDispatches', 'networkDispatches', 'attemptsWithKnownUsage'] as const) assert.equal(result[key], 24);
  for (const key of ['failedOrUnknownAnswers', 'unattemptedAnswers', 'unresolvedDispatchIntents', 'remoteOutcomeUnknownAttempts'] as const) assert.equal(result[key], 0);
  assert.equal(result.stopReason, null);
  const state = readSourceCalibrationLedgerState(DIAGNOSTIC_LEDGER, .200281, manifest.diagnostic.document.slots.map(s => s.input.runId));
  assert.equal(state.historicalRowsSha256, p.diagnostic.ledger.historicalRowsSha256); assert.equal(state.attempts, p.diagnostic.ledger.attempts + 24); assert.equal(state.rows.length, 24); assert.equal(state.pending, 0); assert.equal(state.owners, 0);
  assert.ok(Math.abs(state.reservedUsd - p.diagnostic.ledger.reservedUsd - 2.4) < 1e-7);
  for (const step of last.steps) {
    const row = state.rows.find(r => r.id === step.attemptId), slot = manifest.diagnostic.document.slots[step.index]!; assert.ok(row && step.receipt);
    assert.equal(row.run_id, slot.input.runId); assert.equal(row.allowance_usd, .1);
    for (const key of ['id', 'kind', 'status', 'error_code', 'receipt_json', 'model', 'input_tokens', 'output_tokens'] as const) assert.deepEqual(row[key], step.receipt[key]);
  }
  const review = bound(outcome.anonymousReviewPath, outcome.anonymousReviewFileSha256);
  const packet = prepareThreeContextEvaluation(manifest, checkpoints, result, review);
  assert.deepEqual(bound(outcome.packetPath, outcome.packetFileSha256), packet);
  assert.ok(Array.isArray(outcome.reviewImports) && outcome.reviewImports.length >= 2);
  const imports = outcome.reviewImports.map((a: Json) => { const actual = bound(a.path, a.fileSha256) as ImportedThreeContextReview; assert.deepEqual(importThreeContextReview(packet, actual.review), actual); return actual; }) as ImportedThreeContextReview[];
  const ai = imports.filter(r => r.review.provenance === 'ai_provisional' && r.review.purpose === 'independent_review');
  assert.ok(ai.length >= 2 && new Set(ai.map(r => r.review.reviewer)).size === ai.length);
  for (const r of ai) assert.deepEqual(r.review.entries.map(e => e.label).sort(), packet.answers.map(a => a.label).sort(), 'Two independent reviewers must judge all24, retaining every unknown, miss, unsupported claim and negative result.');
  const combined = reportThreeContextEvaluation(packet, imports); assert.deepEqual(bound(outcome.combinedEvaluationPath, outcome.combinedEvaluationFileSha256), combined);
  const disagreementReport = reportThreeContextEvaluation(packet, ai);
  const humans = imports.filter(r => r.review.provenance === 'source_checked_human');
  assert.ok(Array.isArray(outcome.humanResolutionArtifacts));
  const humanHashes = new Set(outcome.humanResolutionArtifacts.map((a: Json) => { const h = bound(a.path, a.fileSha256); const raw = h.review ?? h; assert.equal(raw.provenance, 'source_checked_human'); return diagnosticHash(raw); }));
  for (const row of disagreementReport.focusedReview.filter(r => r.needsFocusedHumanReview)) assert.ok(humans.some(h => humanHashes.has(h.reviewSha256) && h.review.entries.some(e => e.label === row.label)), `Focused source-checked human review required: ${row.label}`);
  for (const item of disagreementReport.caseComparisons.flatMap(c => c.disagreements)) assert.ok(humans.some(h => humanHashes.has(h.reviewSha256) && h.review.comparisons?.some(c => c.caseId === item.caseId && [c.firstLabel, c.secondLabel].sort().join('|') === item.labels.join('|'))), 'Resolve every applicable comparison disagreement explicitly.');
  assert.equal(outcome.old3UsedAsQualityEvidence, false, 'This v6 gate treats the old3 solely as exposure/history.');
  assert.equal(outcome.paidPlan, null); assert.equal(outcome.noUnresolvedMaterialRegression, true); assert.ok(outcome.independentReviewer?.trim() && outcome.independentRationale?.trim());
  const independent = bound(outcome.independentOutcomeReviewPath, outcome.independentOutcomeReviewFileSha256);
  assert.equal(independent.format, 'ablatrix-report-calibration-independent-outcome-review-v1'); assert.equal(independent.provenance, 'independent_source_code_review'); assert.equal(independent.reviewer, outcome.independentReviewer);
  assert.equal(independent.packetSha256, packet.sha256); assert.equal(independent.combinedEvaluationFileSha256, outcome.combinedEvaluationFileSha256); assert.equal(independent.rationale, outcome.independentRationale);
  assert.equal(independent.noUnresolvedMaterialRegression, true); assert.equal(independent.outcome, outcome.status); assert.equal(independent.qualityClaimEligible, false);
  for (const key of ['candidateFreezeFileSha256', 'policyFreezeFileSha256', 'developmentProtocolFileSha256']) assert.match(outcome[key], /^[a-f0-9]{64}$/);
  const frozen = read(root, 'docs/evidence/report-uncertainty-v6-2026-10-19/candidate-freeze-v1.json'); assert.equal(outcome.candidateFreezeFileSha256, frozen.sha256);
  assert.equal(outcome.policyFreezeFileSha256, read(root, frozen.document.policyPath).sha256);
  assert.equal(outcome.developmentProtocolFileSha256, read(root, 'docs/evidence/report-uncertainty-v6-2026-10-19/development-protocol-v1.json').sha256);
  assert.equal(outcome.verifiedActualCompletedAttempts, 24); assert.equal(outcome.sourceAwareReviewsComplete, true); assert.equal(outcome.newHumanDisagreementsResolved, true); assert.deepEqual(outcome.unresolvedApplicableHumanAxes, []);
  return { format: 'ablatrix-report-calibration-development-outcome-proof-v1', outcomeFileSha256: saved.sha256, planSha256: manifest.sha256, packetSha256: packet.sha256, verifiedActualCompletedAttempts: 24, sourceAwareReviewsComplete: true, newHumanDisagreementsResolved: true, actualProducts: 2, freshProducts: 0, humanSourceCheckedActualAnswers: combined.humanSourceCheckedActualAnswers, qualityClaimEligible: false, newProviderCalls: 0 };
}
