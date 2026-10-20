/** Offline automatic-review orchestration. No credential, provider or dispatch path. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { textHash } from '../server/product-corpus.ts';
import { reportDevelopmentFile } from '../server/report-uncertainty-development.ts';
import { DIAGNOSTIC_LEDGER, diagnosticHash, verifyDiagnosticCheckpoint, type DiagnosticCheckpoint } from '../server/three-context-diagnostic.ts';
import { checkThreeContextLiveFiles, verifyThreeContextLiveCheckpoints, type ThreeContextLiveManifest } from '../server/three-context-live.ts';
import { verifyQualifiedReportCalibration, type QualifiedReportCalibration } from '../server/report-calibration-qualification.ts';
import { normalizeReportCalibrationEvaluation } from '../server/report-calibration-outcome.ts';
import { prepareThreeContextEvaluation, importThreeContextReview, type ImportedThreeContextReview } from '../server/three-context-evaluation.ts';
import { readSourceCalibrationLedgerState, sourceCalibrationHash } from '../server/source-calibration-comparison.ts';
import { buildAutomaticAdjudicationRequest, verifyAutomaticDevelopmentReview } from '../server/automatic-review-v1.ts';
import { checkAutomaticOutcomeAssertions, checkAutomaticReceiptMapping } from '../server/automatic-review-proof-checks-v1.ts';

type Json = Record<string, any>;
type Ref = { path: string; fileSha256: string };
export type AutomaticReviewInput = { format: 'ablatrix-automatic-review-input-v1'; plan: Ref; checkpoint: Ref; result: Ref; anonymousReview: Ref; mapping: Ref; packet: Ref;
  independentReviews: Ref[]; crossReviews: Ref[]; candidateFreeze: Ref; policyFreeze: Ref; developmentProtocol: Ref };
const repository = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
function read(root: string, path: string) { const bytes = readFileSync(reportDevelopmentFile(root, path), 'utf8'); return { bytes, fileSha256: textHash(bytes), document: JSON.parse(bytes) }; }
function bound(root: string, ref: Ref) { assert.match(ref.fileSha256, /^[a-f0-9]{64}$/); const value = read(root, ref.path); assert.equal(value.fileSha256, ref.fileSha256, `Bound review artifact changed: ${ref.path}`); return value; }
function boundJournal(root: string, ref: Ref) { assert.match(ref.fileSha256, /^[a-f0-9]{64}$/); const bytes = readFileSync(reportDevelopmentFile(root, ref.path), 'utf8'); assert.equal(textHash(bytes), ref.fileSha256); return bytes; }
function save(root: string, path: string, value: unknown) { const full = resolve(root, path), rel = relative(root, full); assert.ok(rel.startsWith('.data/') && !rel.split('/').includes('..') && !existsSync(full)); assert.equal(realpathSync(dirname(full)), dirname(full)); writeFileSync(full, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); return full; }

/** Old approvals/results remain immutable. Later append-only ledger work does
 * not erase this exact historical occurrence and cannot grant a new call. */
export async function verifyAutomaticReviewInputs(root: string, input: AutomaticReviewInput) {
  assert.equal(input.format, 'ablatrix-automatic-review-input-v1');
  const manifest = bound(root, input.plan).document as ThreeContextLiveManifest;
  checkThreeContextLiveFiles(manifest, resolve(root, input.plan.path)); assert.equal(manifest.preparation.repositoryPath, root);
  const preparation = await verifyQualifiedReportCalibration(manifest.preparation as QualifiedReportCalibration);
  const journal = boundJournal(root, input.checkpoint); assert.ok(journal.endsWith('\n'));
  const checkpoints = journal.trimEnd().split('\n').map(line => JSON.parse(line) as DiagnosticCheckpoint), last = checkpoints.at(-1)!;
  const result = verifyThreeContextLiveCheckpoints(manifest, checkpoints); assert.deepEqual(bound(root, input.result).document, result);
  assert.equal(result.transportProvenance, 'live_router'); assert.equal(result.stopReason, null);
  for (const key of ['plannedAnswers', 'completedAnswers', 'newProviderAttempts', 'attemptsWithKnownUsage', 'transportInvocations', 'observedDispatches', 'networkDispatches'] as const) assert.equal(result[key], 24);
  for (const key of ['failedOrUnknownAnswers', 'unattemptedAnswers', 'unresolvedDispatchIntents', 'remoteOutcomeUnknownAttempts', 'retries', 'graderCalls', 'webCalls'] as const) assert.equal(result[key], 0);
  const state = readSourceCalibrationLedgerState(DIAGNOSTIC_LEDGER, .200281, manifest.diagnostic.document.slots.map(s => s.input.runId));
  assert.equal(state.pending, 0); assert.equal(state.owners, 0); assert.equal(state.rows.length, 24);
  const db = new DatabaseSync(DIAGNOSTIC_LEDGER, { readOnly: true }); let all: Json[];
  try { all = db.prepare('SELECT * FROM loop_provider_calls ORDER BY rowid').all() as Json[]; } finally { db.close(); }
  const anchor = preparation.diagnostic.ledger; assert.equal(anchor.attempts, 141);
  assert.equal(sourceCalibrationHash(all.slice(0, anchor.attempts)), anchor.historicalRowsSha256, 'The preapproval history cannot be rewritten.');
  assert.equal(all.length, state.attempts); assert.ok(all.length >= anchor.attempts + 24);
  assert.deepEqual(all.slice(anchor.attempts, anchor.attempts + 24).map(r => r.id).sort(), state.rows.map(r => r.id).sort(), 'Only the approved next24 rows establish this development occurrence.');
  const historicalRunIds = new Set(all.slice(0, anchor.attempts).map(r => r.run_id));
  for (const step of last.steps) {
    const slot = manifest.diagnostic.document.slots[step.index]!, matches = state.rows.filter(r => r.id === step.attemptId); assert.equal(matches.length, 1);
    const row = matches[0]!; assert.ok(step.receipt); assert.equal(row.run_id, slot.input.runId); assert.ok(!historicalRunIds.has(row.run_id)); assert.equal(row.allowance_usd, .1);
    for (const key of ['id', 'kind', 'status', 'error_code', 'receipt_json', 'model', 'input_tokens', 'output_tokens', 'allowance_usd'] as const) assert.deepEqual(row[key], step.receipt[key]);
  }
  const packet = normalizeReportCalibrationEvaluation(prepareThreeContextEvaluation(manifest, checkpoints, result, bound(root, input.anonymousReview).document));
  assert.deepEqual(bound(root, input.packet).document, packet);
  const mapping = bound(root, input.mapping).document; assert.ok(Array.isArray(mapping)); assert.equal(mapping.length, 24);
  const observed = verifyDiagnosticCheckpoint(manifest.diagnostic, last);
  checkAutomaticReceiptMapping({ slots: manifest.diagnostic.document.slots, steps: last.steps, answers: packet.answers, mapping, outputs: observed.outputs });
  assert.equal(input.independentReviews.length, 2); assert.equal(input.crossReviews.length, 2);
  const independentReviews = input.independentReviews.map(ref => { const imported = bound(root, ref).document as ImportedThreeContextReview; assert.deepEqual(importThreeContextReview(packet, imported.review), imported); assert.equal(imported.review.provenance, 'ai_provisional'); assert.equal(imported.review.purpose, 'independent_review'); return imported; });
  const crossReviews = input.crossReviews.map(ref => bound(root, ref).document);
  const candidate = bound(root, input.candidateFreeze), policy = bound(root, input.policyFreeze), development = bound(root, input.developmentProtocol);
  assert.equal(candidate.document.format, 'ablatrix-report-uncertainty-v6-candidate-freeze-v1'); assert.equal(candidate.document.candidate.contract, 'workspace-semantic-supplement-v6-quantified-peer-dev');
  assert.equal(candidate.document.policyPath, input.policyFreeze.path); assert.equal(candidate.document.inputSha256[input.policyFreeze.path], input.policyFreeze.fileSha256);
  assert.equal(policy.document.contract, 'workspace-answer-uncertainty-v2'); assert.equal(development.document.format, 'ablatrix-report-calibration-development-protocol-v1');
  for (const ref of [input.candidateFreeze, input.policyFreeze, input.developmentProtocol]) assert.equal(preparation.diagnostic.artifactSha256[ref.path], ref.fileSha256, 'Automatic review must retain the exact executed candidate/policy/design.');
  return { preparation, packet, mapping, independentReviews, crossReviews, result, ledger: { attempts: state.attempts, pending: 0, owners: 0 },
    receiptProof: { planSha256: manifest.sha256, verifiedActualCompletedAttempts: 24, unchangedHistoricalRows: 141, canonicalReceiptRowsSha256: diagnosticHash(state.rows), newProviderCalls: 0 } };
}

export async function automaticReviewRequest(root: string, inputPath: string) {
  const input = read(root, inputPath), verified = await verifyAutomaticReviewInputs(root, input.document);
  const request = buildAutomaticAdjudicationRequest(verified);
  return { input, verified, request };
}
export async function verifyAutomaticOutcome(root: string, outcomePath: string) {
  const saved = read(root, outcomePath), outcome = saved.document;
  assert.equal(outcome.format, 'ablatrix-automatic-development-outcome-v1');
  const input = bound(root, outcome.input), verified = await verifyAutomaticReviewInputs(root, input.document), request = buildAutomaticAdjudicationRequest(verified);
  const adjudication = bound(root, outcome.adjudication).document;
  const review = verifyAutomaticDevelopmentReview({ ...verified, adjudication });
  checkAutomaticOutcomeAssertions(outcome, { requestSha256: request.sha256, review, receiptProof: verified.receiptProof,
    candidateFreezeFileSha256: input.document.candidateFreeze.fileSha256, policyFreezeFileSha256: input.document.policyFreeze.fileSha256,
    developmentProtocolFileSha256: input.document.developmentProtocol.fileSha256 });
  return { format: 'ablatrix-automatic-development-outcome-proof-v1', outcomeFileSha256: saved.fileSha256, status: review.status, verifiedActualCompletedAttempts: 24,
    automaticReviewComplete: true, humanSourceCheckedAnswers: 0, candidateFreezeFileSha256: outcome.candidateFreezeFileSha256, policyFreezeFileSha256: outcome.policyFreezeFileSha256, developmentProtocolFileSha256: outcome.developmentProtocolFileSha256,
    canonicalActualReceiptsSha256: verified.receiptProof.canonicalReceiptRowsSha256, requestSha256: request.sha256, reviewSha256: diagnosticHash(review), qualityClaimEligible: false, activationAuthorized: false, newProviderCalls: 0 };
}
export async function automaticSourceReviewCli(argv: string[]) {
  if (!argv.length) return { usage: '--request --input PRIVATE --out NEW_PRIVATE | --complete --input PRIVATE --adjudication PRIVATE --out NEW_PRIVATE | --verify-outcome PRIVATE', newProviderCalls: 0, manualReviewRequired: false };
  if (argv[0] === '--verify-outcome') { assert.equal(argv.length, 2); return verifyAutomaticOutcome(repository, argv[1]!); }
  const [mode, ...rest] = argv, keys = mode === '--request' ? ['--input', '--out'] : mode === '--complete' ? ['--input', '--adjudication', '--out'] : undefined; assert.ok(keys);
  const flags = new Map<string, string>(); for (let i = 0; i < rest.length; i += 2) { assert.ok(keys.includes(rest[i]!) && rest[i + 1] && !flags.has(rest[i]!)); flags.set(rest[i]!, rest[i + 1]!); } assert.equal(flags.size, keys.length);
  const { input, verified, request } = await automaticReviewRequest(repository, flags.get('--input')!);
  if (mode === '--request') { const output = save(repository, flags.get('--out')!, request); return { output, requestSha256: request.sha256, manualReviewRequired: false, newProviderCalls: 0 }; }
  const adjudication = read(repository, flags.get('--adjudication')!), review = verifyAutomaticDevelopmentReview({ ...verified, adjudication: adjudication.document });
  const document = { format: 'ablatrix-automatic-development-outcome-v1', status: review.status, input: { path: flags.get('--input')!, fileSha256: input.fileSha256 }, adjudication: { path: flags.get('--adjudication')!, fileSha256: adjudication.fileSha256 }, requestSha256: request.sha256, review, receiptProof: verified.receiptProof,
    verifiedActualCompletedAttempts: 24, automaticReviewComplete: true, candidateFreezeFileSha256: input.document.candidateFreeze.fileSha256, policyFreezeFileSha256: input.document.policyFreeze.fileSha256, developmentProtocolFileSha256: input.document.developmentProtocol.fileSha256,
    humanSourceCheckedAnswers: 0, qualityClaimEligible: false, activationAuthorized: false, paidPlan: null, newProviderCalls: 0 };
  const output = save(repository, flags.get('--out')!, document); const proof = await verifyAutomaticOutcome(repository, flags.get('--out')!); return { output, ...proof };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) { try { console.log(JSON.stringify(await automaticSourceReviewCli(process.argv.slice(2)), null, 2)); } catch (error) { console.error(`Automatic review stopped: ${error instanceof Error ? error.message : 'invalid input'}`); process.exitCode = 1; } }
