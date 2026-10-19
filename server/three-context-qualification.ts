/** Reviewed proposal preparation only; this module has no execution or credential path. */
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { textHash } from './product-corpus.ts';
import { diagnosticHash, DIAGNOSTIC_LEDGER, prepareThreeContext } from './three-context-diagnostic.ts';
import { checkThreeContextLiveFiles, requiredThreeContextLiveFiles, type ThreeContextLiveManifest, type ThreeContextLivePreparation } from './three-context-live.ts';
import { readLedgerAnchor } from './source-calibration-comparison.ts';
import { REVIEWED_V5_RESULT, verifyReviewedV5DevelopmentResult, buildV5DevelopmentPreparation } from '../scripts/prepare-three-context-v5.ts';
export const QUALIFICATION_FILES = ['server/three-context-qualification.ts', 'scripts/qualify-three-context-v5.ts', 'server/three-context-evaluation.ts', 'scripts/three-context-evaluation.ts', 'scripts/rehearse-three-context-v5.ts'] as const;
export const CODE_QUALIFICATION_CHECKS = ['exact_source_and_question_scope', 'all_gap_cases_retained', 'generation_contract_parity', 'durable_reservation_and_no_retry', 'approval_before_credentials', 'receipt_and_unknown_accounting', 'blind_review_privacy', 'no_default_activation'] as const;
export type ThreeContextCodeReview = {
  format: 'ablatrix-three-context-code-qualification-v1'; reviewedPreparationSha256: string;
  reviewedImplementationSha256: Record<string, string>; reviewedArtifactSha256: Record<string, string>;
  review: { provenance: 'independent_agent_code_review'; reviewer: string; reviewedCommit: string; reportPath: string; reportSha256: string; outcome: 'ready_for_unexecuted_financial_proposal'; checks: Record<typeof CODE_QUALIFICATION_CHECKS[number], true> };
  sourceResult: typeof REVIEWED_V5_RESULT; paidExecutionAuthorized: false; humanAnswerQualityJudgments: 0; qualityClaimEligible: false;
};
const encode = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
function canonicalFile(root: string, path: string) {
  assert.ok(path && !isAbsolute(path) && !path.includes('\\') && !path.split('/').some(x => x === '..' || x === '.'));
  const full = resolve(root, path); assert.ok(lstatSync(full).isFile() && !lstatSync(full).isSymbolicLink() && realpathSync(full) === full, 'Qualification inputs must be canonical regular files.'); return full;
}
function newPrivate(root: string, path: string) { const rel = relative(root, path); assert.ok(rel.startsWith('.data/') && !rel.split('/').includes('..') && !existsSync(path)); assert.equal(realpathSync(dirname(path)), dirname(path)); }
export function qualificationImplementation(root: string, base: ThreeContextLivePreparation) {
  const paths = [...new Set([...Object.keys(base.diagnostic.implementationSha256), ...requiredThreeContextLiveFiles(root), ...QUALIFICATION_FILES])].sort();
  return Object.fromEntries(paths.map(path => [path, textHash(readFileSync(canonicalFile(root, path), 'utf8'))]));
}
export function verifyCodeQualification(base: ThreeContextLivePreparation, baseBytes: string, record: ThreeContextCodeReview, expectedRecordSha256: string, recordBytes: string, root: string) {
  assert.equal(record.format, 'ablatrix-three-context-code-qualification-v1'); assert.match(expectedRecordSha256, /^[a-f0-9]{64}$/); assert.equal(textHash(recordBytes), expectedRecordSha256, 'Use the exact independently reviewed qualification bytes.');
  assert.deepEqual(JSON.parse(baseBytes), base); assert.deepEqual(JSON.parse(recordBytes), record);
  assert.equal(base.diagnostic.validation, undefined, 'This qualifier covers only the complete exposed v5 development gap group.'); assert.equal(base.diagnostic.codeReviewPassed, false, 'Start from a new unqualified preparation, never edit an old reviewed plan.');
  assert.equal(record.reviewedPreparationSha256, textHash(baseBytes)); assert.deepEqual(record.reviewedImplementationSha256, qualificationImplementation(root, base)); assert.deepEqual(record.reviewedArtifactSha256, base.diagnostic.artifactSha256);
  for (const [path, sha] of Object.entries(base.diagnostic.implementationSha256)) assert.equal(record.reviewedImplementationSha256[path], sha, `Unreviewed base code: ${path}`);
  for (const [path, sha] of Object.entries(base.diagnostic.artifactSha256)) assert.equal(textHash(readFileSync(canonicalFile(root, path), 'utf8')), sha, `Unreviewed source bytes: ${path}`);
  assert.equal(record.review.provenance, 'independent_agent_code_review'); assert.ok(record.review.reviewer.trim()); assert.match(record.review.reviewedCommit, /^[a-f0-9]{40}$/); assert.equal(record.review.outcome, 'ready_for_unexecuted_financial_proposal');
  assert.deepEqual(Object.keys(record.review.checks).sort(), [...CODE_QUALIFICATION_CHECKS].sort()); for (const key of CODE_QUALIFICATION_CHECKS) assert.equal(record.review.checks[key], true);
  assert.ok(record.review.reportPath.startsWith('docs/')); 
  const reportBytes = readFileSync(canonicalFile(root, record.review.reportPath), 'utf8');
  assert.equal(textHash(reportBytes), record.review.reportSha256); const report = JSON.parse(reportBytes);
  assert.equal(report.provenance, record.review.provenance); assert.equal(report.reviewer, record.review.reviewer); assert.equal(report.reviewedCommit, record.review.reviewedCommit); assert.equal(report.outcome, record.review.outcome);
  assert.deepEqual(report.reviewedImplementationSha256, record.reviewedImplementationSha256); assert.deepEqual(report.reviewedArtifactSha256, record.reviewedArtifactSha256); assert.equal(report.reviewedPreparationSha256, record.reviewedPreparationSha256); assert.deepEqual(report.checks, record.review.checks);

  assert.deepEqual(record.sourceResult, REVIEWED_V5_RESULT); verifyReviewedV5DevelopmentResult(REVIEWED_V5_RESULT.path, root);
  assert.equal(record.paidExecutionAuthorized, false); assert.equal(record.qualityClaimEligible, false); assert.equal(record.humanAnswerQualityJudgments, 0);
  const context = buildV5DevelopmentPreparation(REVIEWED_V5_RESULT.path, resolve(root, '.data', `qualification-context-probe-${expectedRecordSha256}.json`), root);
  assert.deepEqual(base.diagnostic.cases, context.cases, 'The qualification must cover exact pinned current/v5/reference contexts.'); assert.deepEqual(base.diagnostic.policy, context.policy);
  assert.deepEqual(base.diagnostic.artifactSha256, Object.fromEntries(context.artifactPaths.map(path => [path, context.digest(path)])));
  assert.deepEqual(base.diagnostic.implementationSha256, Object.fromEntries(context.codeFiles.map(path => [path, context.digest(path)])));
  const sourceReview = JSON.parse(readFileSync(canonicalFile(root, 'docs/evidence/retrieval-source-coverage-v2-2026-10-18/source-review-v1.json'), 'utf8'));
  const gapIds = sourceReview.cases.filter((r: any) => ['specification_gap', 'model_detail_gap'].includes(r.sourceGapGroup)).map((r: any) => r.caseId);
  assert.deepEqual(base.diagnostic.cases.map(c => c.id), gapIds, 'Retain every independently designated eligible development gap.');
  return record;
}
export type QualifiedV5Preparation = ThreeContextLivePreparation & { codeQualification: { recordPath: string; recordSha256: string; unqualifiedPreparationPath: string; unqualifiedPreparationSha256: string } };
export function qualificationReviewBindings(root: string, recordPath: string, recordBytes: string, expectedSha256: string, record: ThreeContextCodeReview) {
  assert.equal(textHash(recordBytes), expectedSha256); assert.equal(textHash(readFileSync(canonicalFile(root, recordPath), 'utf8')), expectedSha256, 'Reviewed certificate changed after inspection.');
  assert.equal(textHash(readFileSync(canonicalFile(root, record.review.reportPath), 'utf8')), record.review.reportSha256, 'Independent review report changed after inspection.');
  return { [recordPath]: expectedSha256, [record.review.reportPath]: record.review.reportSha256 };
}
function qualifiedSnapshot(root: string, base: ThreeContextLivePreparation, basePath: string, baseBytes: string, recordPath: string, recordBytes: string, expectedRecordSha256: string, record: ThreeContextCodeReview): QualifiedV5Preparation {
  const qualified: QualifiedV5Preparation = { ...structuredClone(base), codeQualification: { recordPath, recordSha256: expectedRecordSha256, unqualifiedPreparationPath: basePath, unqualifiedPreparationSha256: textHash(baseBytes) } };
  qualified.diagnostic.implementationSha256 = record.reviewedImplementationSha256;
  for (const [path, sha] of Object.entries(qualificationReviewBindings(root, recordPath, recordBytes, expectedRecordSha256, record))) { assert.ok(!Object.hasOwn(qualified.diagnostic.artifactSha256, path)); qualified.diagnostic.artifactSha256[path] = sha; }
  qualified.diagnostic.codeReviewPassed = true; qualified.outputDirectory = resolve(root, '.data', `three-context-v5-reviewed-${expectedRecordSha256.slice(0, 16)}-execution`); return qualified;
}
export function verifyQualifiedV5Preparation(preparation: ThreeContextLivePreparation) {
  const p = preparation as QualifiedV5Preparation, q = p.codeQualification, root = p.repositoryPath; assert.ok(q, 'A fixed-scope v5 financial proposal requires its independently checked qualification.');
  const baseBytes = readFileSync(canonicalFile(root, q.unqualifiedPreparationPath), 'utf8'), recordBytes = readFileSync(canonicalFile(root, q.recordPath), 'utf8'); assert.equal(textHash(baseBytes), q.unqualifiedPreparationSha256);
  const base = JSON.parse(baseBytes), record = JSON.parse(recordBytes); verifyCodeQualification(base, baseBytes, record, q.recordSha256, recordBytes, root);
  assert.deepEqual(p, qualifiedSnapshot(root, base, q.unqualifiedPreparationPath, baseBytes, q.recordPath, recordBytes, q.recordSha256, record)); return p;
}
export function qualifyV5Development(root: string, basePath: string, recordPath: string, expectedRecordSha256: string, outputPath: string) {
  assert.equal(realpathSync(root), root); const baseRelative = relative(root, resolve(root, basePath)), recordRelative = relative(root, resolve(root, recordPath)), output = resolve(root, outputPath); newPrivate(root, output);
  const baseBytes = readFileSync(canonicalFile(root, baseRelative), 'utf8'), recordBytes = readFileSync(canonicalFile(root, recordRelative), 'utf8'), base = JSON.parse(baseBytes) as ThreeContextLivePreparation, record = JSON.parse(recordBytes) as ThreeContextCodeReview;
  assert.equal(base.repositoryPath, root); verifyCodeQualification(base, baseBytes, record, expectedRecordSha256, recordBytes, root);
  const ledger = readLedgerAnchor(DIAGNOSTIC_LEDGER, .200281); const { pathSha256: _path, ...anchor } = ledger; assert.deepEqual(anchor, base.diagnostic.ledger, 'Refresh the canonical ledger before reviewing a new preparation.');
  const qualified = qualifiedSnapshot(root, base, baseRelative, baseBytes, recordRelative, recordBytes, expectedRecordSha256, record);
  assert.ok(!existsSync(qualified.outputDirectory)); const prepared = prepareThreeContext(qualified.diagnostic); assert.ok(prepared.document.paidPlan && prepared.document.stopReason === null);
  newPrivate(root, output); writeFileSync(output, encode(qualified), { flag: 'wx', mode: 0o600 });
  assert.deepEqual(readLedgerAnchor(DIAGNOSTIC_LEDGER, .200281), ledger);
  return { mode: 'review_qualified_unexecuted_preparation', output, codeReviewRecordSha256: expectedRecordSha256, contexts: prepared.document.slots.length, budget: prepared.document.paidPlan, paidExecutionAuthorized: false, newProviderCalls: 0 };
}
export function threeContextFinancialProposal(manifest: ThreeContextLiveManifest, planPath: string) {
  checkThreeContextLiveFiles(manifest, planPath); verifyQualifiedV5Preparation(manifest.preparation); const p = manifest.preparation.diagnostic, budget = manifest.diagnostic.document.paidPlan; assert.ok(budget && !p.validation && p.codeReviewPassed);
  const current = readLedgerAnchor(DIAGNOSTIC_LEDGER, .200281), { pathSha256: _path, ...anchor } = current; assert.deepEqual(anchor, p.ledger);
  const document = { format: 'ablatrix-development-three-context-financial-proposal-v1', privatePlanSha256: manifest.sha256, diagnosticPlanSha256: manifest.diagnostic.sha256, preparationFileSha256: manifest.preparationFileSha256, codeQualification: { recordPath: (manifest.preparation as QualifiedV5Preparation).codeQualification.recordPath, recordSha256: (manifest.preparation as QualifiedV5Preparation).codeQualification.recordSha256 },
    scope: 'all_independently_designated_exposed_development_gap_cases', cases: p.cases.map(c => ({ id: c.id, question: c.question, product: c.product, referenceReview: c.referenceReview, designatedFacts: c.designatedFacts })),
    requests: manifest.diagnostic.document.slots.map((slot, index) => ({ index, caseId: slot.caseId, arm: slot.arm, requestBody: slot.body, binding: slot.binding })), implementationSha256: p.implementationSha256, artifactSha256: p.artifactSha256,
    ledger: { attempts: p.ledger.attempts, reservedUsd: Math.round(p.ledger.reservedUsd * 1e6) / 1e6, priorAdjustmentUsd: p.ledger.priorSpendUsd, combinedPlanningUsd: Math.round((p.ledger.reservedUsd + p.ledger.priorSpendUsd) * 1e6) / 1e6, pending: p.ledger.pending, owners: p.ledger.owners }, budget,
    retries: 0, graderCalls: 0, webCalls: 0, repairCalls: 0, paidExecutionAuthorized: false, actualProviderCharges: 'unavailable', providerEnforcedCap: false, humanAnswerQualityJudgments: 0, qualityClaimEligible: false, activationAllowed: false,
    limitation: 'Exact unexecuted local planning scope. Independent AI code/source review does not establish human answer quality. The parent must obtain fresh financial approval for this privatePlanSha256 before execution.' };
  return { ...document, sha256: diagnosticHash(document) };
}
