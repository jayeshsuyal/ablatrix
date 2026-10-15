import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { replayClaimSupportReceipt, type ValidatedClaimSupportAssessment } from './claim-support.ts';
import { QUALIFICATION_CODE_FILES, qualificationHash as sha, verifyQualification, type QualificationBundle } from './grader-qualification.ts';
import { QUALIFICATION_LIVE_CODE_FILES, type LiveQualificationReceipt, type LiveQualificationScope } from './grader-qualification-live-boundary.ts';
import type { QualificationJournalRecord } from './grader-qualification-live-journal.ts';

export const QUALIFICATION_LIVE_BUDGET = Object.freeze({ startingAttempts: 102, startingReservedUsd: 10.2, newCalls: 92, allowancePerCallUsd: .1, maxAddedPlanningAllowanceUsd: 9.2, absoluteCallLimit: 194, maximumReservedUsd: 19.4, priorSpendUsd: .200281, spendingCapUsd: 20, maximumPlanningUsageUsd: 19.600281 });
export const QUALIFICATION_SOURCE_DIRECTORY = 'docs/evidence/grader-qualification-2026-10-15';
export const QUALIFICATION_SOURCE_HASHES = Object.freeze({
  'seal-v1/plan.json': '2269174e8213bf1313eb5c1c5fee7a34268a8310b801b548cdb262cc1735e5ce',
  'seal-v1/requests.json': '52e60afac31274efc8b31556d088b335bc40f0a045284fcde53990d39be078ec',
  'seal-v1/references.json': 'cd12a1ea95e70a4b497b285fe41d726549923fd6c98d852fac3702b81c1217d3',
  'seal-v1/record.json': '2a7aea6402883dd5af4880948a766622408b9701e2191df3e8539bb2a2a925c6',
  'source-review-v1.json': '6aa4128de6c0feef2c5eafc7be5b64d497021c52b9f632ae8584e199c974adc9'
});
export type QualificationLiveSources = { bundle: QualificationBundle; sourceReview: Record<string, unknown>; rawFileSha256: Record<string, string> };
const equal = (a: unknown, b: unknown) => sha(a) === sha(b);
const digest = /^[a-f0-9]{64}$/;
const stopCodes = new Set(['invalid_or_unknown_outcome', 'critical_axis_mismatch', 'flawed_raw_pass', 'acceptable_control_misrouted', 'repeat_instability', 'full_axis_failure_allowance_exceeded', 'after_operation_boundary_failed', 'execution_guard_failed', 'provider_close_failed', 'before_publication_boundary_failed']);

/** Public, fixed artifacts only. No credential, environment or private ledger read. */
export function readQualificationLiveSources(repository: string): QualificationLiveSources {
  const values: Record<string, unknown> = {}, hashes: Record<string, string> = {};
  for (const name of Object.keys(QUALIFICATION_SOURCE_HASHES)) {
    const path = resolve(repository, QUALIFICATION_SOURCE_DIRECTORY, name), stat = lstatSync(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 8 * 1024 * 1024 && realpathSync(path) === path, 'Qualification source must be a bounded canonical regular file.');
    const bytes = readFileSync(path); hashes[name] = createHash('sha256').update(bytes).digest('hex'); values[name] = JSON.parse(bytes.toString());
  }
  const bundle = { plan: values['seal-v1/plan.json'], requests: values['seal-v1/requests.json'], references: values['seal-v1/references.json'], record: values['seal-v1/record.json'] } as QualificationBundle;
  const sources = { bundle, sourceReview: values['source-review-v1.json'] as Record<string, unknown>, rawFileSha256: hashes };
  // Authenticate every source byte and the exact manifest before letting any
  // manifest value select a local file. A tampered plan cannot name private or
  // unrelated paths, even during an offline command that ultimately rejects.
  verifyQualificationLiveSources(sources);
  assert.ok(equal(Object.keys(bundle.plan.codeFileSha256).sort(), [...QUALIFICATION_CODE_FILES].sort()));
  for (const file of QUALIFICATION_CODE_FILES) {
    const path = resolve(repository, file), stat = lstatSync(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && realpathSync(path) === path, 'Original sealed code files cannot traverse symlinks.');
    assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), bundle.plan.codeFileSha256[file], `Original sealed implementation changed: ${file}`);
  }
  return sources;
}
export function verifyQualificationLiveSources(sources: QualificationLiveSources) {
  assert.ok(equal(sources.rawFileSha256, QUALIFICATION_SOURCE_HASHES), 'Reviewed source bytes do not match the published immutable cohort.');
  const bundle = verifyQualification(sources.bundle, { implementationCommit: sources.bundle.plan.implementationCommit, codeFileSha256: sources.bundle.plan.codeFileSha256 });
  const { sourceReviewSha256, ...review } = sources.sourceReview;
  assert.equal(sourceReviewSha256, sha(review)); assert.equal(sourceReviewSha256, '06aa3c4eb10b27c5858bd9fa78140c3b845b6b84cf7edcbc1d6bb7ba83db8649');
  assert.equal(review.status, 'completed_ai_source_consistency_review'); assert.equal(review.planSha256, bundle.plan.planSha256); assert.equal(review.datasetSha256, bundle.plan.datasetSha256); assert.equal(review.referencesSha256, bundle.plan.referencesSha256);
  assert.equal(review.humanGold, false); assert.equal(review.reviewIdentityVerified, false); assert.equal(review.reviewedCases, 80); assert.equal(review.reviewedRepeatBindings, 12);
  assert.ok(equal(review.cases, bundle.references.items.map(ref => ({ caseId: ref.caseId, referenceSha256: sha(ref), sourceConsistency: 'reviewed' }))), 'Source review does not bind every frozen reference.');
  return structuredClone(sources);
}

export type QualificationLivePlan = {
  format: 'grader-qualification-execution-plan-v1'; createdAt: string; implementationCommit: string; codeFileSha256: Record<string, string>;
  sealedPlanSha256: string; datasetSha256: string; sourceReviewSha256: string; sourceArtifactSha256: Record<string, string>;
  callerScope: LiveQualificationScope; budget: typeof QUALIFICATION_LIVE_BUDGET;
  paths: { checkpointPath: string; reportPath: string; recordPath: string; approvalPath: string };
  slots: { index: number; slotId: string; caseId: string; runId: string; requestSha256: string; responseSchemaSha256: string }[];
  stopPolicy: { invalidOrUnknown: true; criticalAxisMiss: true; flawedPass: true; acceptableMisrouting: true; repeatInstability: true; exceededFullAxisFailureAllowance: true; retries: 0; resume: false };
  authority: 'explicit_user_approval_of_this_execution_plan_required'; productionActivationQualified: false; qualityClaimEligible: false; executionPlanSha256: string;
};
export type QualificationLivePreparation = { sources: QualificationLiveSources; implementationCommit: string; codeFileSha256: Record<string, string>; callerScope: LiveQualificationScope; artifactDirectory: string; createdAt: string };
export function prepareQualificationLivePlan(options: QualificationLivePreparation): QualificationLivePlan {
  const sources = verifyQualificationLiveSources(options.sources), sealed = sources.bundle.plan, scope = options.callerScope;
  assert.match(options.implementationCommit, /^[a-f0-9]{40}$/); assert.ok(Number.isFinite(Date.parse(options.createdAt)) && new Date(options.createdAt).toISOString() === options.createdAt);
  assert.ok(Object.keys(options.codeFileSha256).length === QUALIFICATION_LIVE_CODE_FILES.length && QUALIFICATION_LIVE_CODE_FILES.every(f => digest.test(options.codeFileSha256[f] ?? '')), 'Execution requires every adapter/provider/guard code hash.');
  assert.equal(scope.executionAuthority, 'parent_execution_only'); assert.ok(digest.test(scope.ledgerInitialSha256));
  for (const key of ['repositoryPath', 'budgetPath', 'reviewPath', 'appDbPath', 'loopDbPath', 'workspaceDbPath', 'runtimePolicyDbPath', 'claimDirectory']) assert.ok(isAbsolute(scope[key]) && resolve(scope[key]) === scope[key], 'Execution scope paths must be canonical absolute paths.');
  assert.equal(scope.claimDirectory, resolve(scope.repositoryPath, '.data/grader-qualification-live-claims'), 'Cohort consumption directory is fixed across execution plans.');
  const dir = options.artifactDirectory, rel = relative(resolve(scope.repositoryPath, 'docs/evidence'), dir);
  assert.ok(isAbsolute(dir) && resolve(dir) === dir && rel && !rel.startsWith('..') && !isAbsolute(rel), 'Execution outputs must have a distinct project evidence directory.');
  const body: Omit<QualificationLivePlan, 'executionPlanSha256'> = { format: 'grader-qualification-execution-plan-v1', createdAt: options.createdAt, implementationCommit: options.implementationCommit, codeFileSha256: structuredClone(options.codeFileSha256), sealedPlanSha256: sealed.planSha256, datasetSha256: sealed.datasetSha256, sourceReviewSha256: sources.sourceReview.sourceReviewSha256 as string, sourceArtifactSha256: structuredClone(sources.rawFileSha256), callerScope: structuredClone(scope), budget: { ...QUALIFICATION_LIVE_BUDGET },
    paths: { checkpointPath: resolve(scope.repositoryPath, '.data/grader-qualification-live', `${sealed.datasetSha256}.jsonl`), reportPath: resolve(dir, 'live-report-v1.json'), recordPath: resolve(dir, 'live-qualification-record-v1.json'), approvalPath: resolve(dir, 'execution-authorization-v1.json') },
    slots: sources.bundle.requests.map((r, index) => ({ index, slotId: r.slotId, caseId: r.caseId, runId: r.runId, requestSha256: r.requestSha256, responseSchemaSha256: r.responseSchemaSha256 })),
    stopPolicy: { invalidOrUnknown: true, criticalAxisMiss: true, flawedPass: true, acceptableMisrouting: true, repeatInstability: true, exceededFullAxisFailureAllowance: true, retries: 0, resume: false }, authority: 'explicit_user_approval_of_this_execution_plan_required', productionActivationQualified: false, qualityClaimEligible: false };
  return { ...body, executionPlanSha256: sha(body) };
}
export function verifyQualificationLivePlan(plan: QualificationLivePlan, sources: QualificationLiveSources, expected: { implementationCommit: string; codeFileSha256: Record<string, string>; callerScope: LiveQualificationScope }) {
  const actual = prepareQualificationLivePlan({ sources, ...expected, artifactDirectory: resolve(plan.paths.reportPath, '..'), createdAt: plan.createdAt });
  assert.ok(equal(plan, actual), 'Execution plan differs from frozen sources, budget, code, caller, schedule, paths or stop rules.'); return actual;
}
export type QualificationLiveApproval = { format: 'grader-qualification-user-approval-v1'; executionPlanSha256: string; budget: typeof QUALIFICATION_LIVE_BUDGET; authorizationSource: 'direct_user_response'; userResponse: string; recordedAt: string; approvalSha256: string };
export function verifyQualificationLiveApproval(plan: QualificationLivePlan, value: QualificationLiveApproval) {
  const { approvalSha256, ...body } = value;
  assert.equal(value.format, 'grader-qualification-user-approval-v1'); assert.equal(value.executionPlanSha256, plan.executionPlanSha256); assert.ok(equal(value.budget, plan.budget)); assert.equal(value.authorizationSource, 'direct_user_response');
  assert.ok(typeof value.userResponse === 'string' && value.userResponse.trim().length > 0 && value.userResponse.length <= 1000 && Number.isFinite(Date.parse(value.recordedAt))); assert.equal(approvalSha256, sha(body));
  assert.ok(equal(Object.keys(body).sort(), ['format', 'executionPlanSha256', 'budget', 'authorizationSource', 'userResponse', 'recordedAt'].sort()));
  return value;
}

type Agreement = { support: boolean; questionCoverage: boolean; answerability: boolean; correctness: boolean; uncertaintyHandling: boolean; disposition: boolean; all: boolean; critical: boolean };
export type QualificationLiveSlot = { index: number; role: 'primary' | 'repeat'; caseId: string; runId: string; status: 'valid' | 'invalid' | 'unknown' | 'unattempted'; receipt: LiveQualificationReceipt | null; receiptSha256: string | null; assessment: ValidatedClaimSupportAssessment | null; agreement: Agreement | null; transportCount: number | null; httpStatus: number | null };
function vector(a: ValidatedClaimSupportAssessment) { return { support: a.units.map(u => u.verdict), questionCoverage: a.questionCoverage, answerability: a.answerability, correctness: a.correctness, uncertaintyHandling: a.uncertaintyHandling, disposition: a.disposition }; }

/** Checks topology and binds observed journal receipts to the independently read ledger. */
export function inspectQualificationObservations(plan: QualificationLivePlan, sources: QualificationLiveSources, records: QualificationJournalRecord[], receipts: Record<string, LiveQualificationReceipt | null | undefined>) {
  const allowed = new Set(plan.slots.map(s => s.runId)); assert.ok(Object.keys(receipts).every(id => allowed.has(id)));
  let next = 0, active: number | null = null, reserved: string | null = null, terminal: 'finished' | 'stopped' | 'interrupted' | 'not_started' = records.length ? 'interrupted' : 'not_started';
  let stopReasons: string[] = [];
  const started = new Set<number>(), observed = new Map<number, QualificationJournalRecord>(), ids = new Set<string>();
  for (const [index, event] of records.entries()) {
    assert.equal(event.planSha256, plan.executionPlanSha256); assert.equal(event.datasetSha256, plan.datasetSha256);
    if (event.kind === 'intent') { assert.equal(index, 0); continue; }
    assert.ok(index > 0 && records[0].kind === 'intent' && !['finished', 'stopped'].includes(terminal), 'Journal must have one intent and one final terminal.');
    if (event.kind === 'finished' || event.kind === 'stopped') {
      assert.equal(index, records.length - 1); if (event.kind === 'finished') assert.ok(next === 92 && active === null);
      assert.ok(Array.isArray(event.stopReasons) && event.stopReasons.every(reason => typeof reason === 'string' && stopCodes.has(reason)) && new Set(event.stopReasons).size === event.stopReasons.length, 'Terminal must retain distinct predeclared stop reasons.');
      stopReasons = event.stopReasons as string[];
      assert.equal(stopReasons.length === 0, event.kind === 'finished', 'Finished records cannot carry failure reasons; stopped records require them.');
      terminal = event.kind; continue;
    }
    assert.ok(Number.isInteger(event.index) && Number(event.index) >= 0 && Number(event.index) < 92); const slot = plan.slots[Number(event.index)];
    assert.equal(event.runId, slot.runId); assert.equal(event.requestSha256, slot.requestSha256);
    if (event.kind === 'slot_started') { assert.equal(active, null); assert.equal(slot.index, next); active = slot.index; started.add(slot.index); reserved = null; }
    else if (event.kind === 'slot_reserved') { assert.equal(active, slot.index); assert.equal(reserved, null); assert.ok(typeof event.receiptId === 'string' && event.receiptId && !ids.has(event.receiptId)); reserved = event.receiptId; ids.add(reserved); assert.equal(receipts[slot.runId]?.id, reserved); }
    else if (event.kind === 'slot_observed') {
      assert.equal(active, slot.index); assert.ok(reserved); const receipt = receipts[slot.runId]; assert.ok(receipt && receipt.id === reserved && event.receiptId === reserved && event.receiptSha256 === sha(receipt) && equal(event.receipt, receipt));
      assert.ok(event.transportCount === 0 || event.transportCount === 1); if (event.transportCount === 1) assert.ok(Number.isFinite(event.durationMs) && Number(event.durationMs) >= 0 && (event.httpStatus === null || Number.isInteger(event.httpStatus)));
      observed.set(slot.index, event); active = null; reserved = null; next++;
    } else throw new Error('Unexpected qualification journal phase.');
  }
  for (const slot of plan.slots) if (receipts[slot.runId]) assert.ok(started.has(slot.index), 'A trusted reservation has no corresponding started slot.');
  const slots: QualificationLiveSlot[] = plan.slots.map(slot => {
    const original = sources.bundle.plan.slots[slot.index], receipt = receipts[slot.runId] ?? null, event = observed.get(slot.index);
    let status: QualificationLiveSlot['status'] = started.has(slot.index) ? 'unknown' : 'unattempted', assessment: ValidatedClaimSupportAssessment | null = null;
    if (event && receipt) {
      if (receipt.status === 'completed') {
        try { const result = replayClaimSupportReceipt(sources.bundle.requests[slot.index].input, receipt, 'live'); assert.equal(receipt.allowance_usd, .1); assert.equal(receipt.input_tokens, result.usage?.inputTokens ?? null); assert.equal(receipt.output_tokens, result.usage?.outputTokens ?? null); assessment = result.assessment; status = 'valid'; } catch { status = 'invalid'; }
      } else status = 'unknown';
    }
    const ref = sources.bundle.references.items.find(r => r.caseId === slot.caseId)!;
    const axes = assessment ? { support: assessment.units.every(u => ref.axes.support.includes(u.verdict)), questionCoverage: ref.axes.questionCoverage.includes(assessment.questionCoverage), answerability: ref.axes.answerability.includes(assessment.answerability), correctness: ref.axes.correctness.includes(assessment.correctness), uncertaintyHandling: ref.axes.uncertaintyHandling.includes(assessment.uncertaintyHandling), disposition: ref.acceptableDispositions.includes(assessment.disposition) } : null;
    const agreement = axes ? { ...axes, all: Object.values(axes).every(Boolean), critical: ref.criticalAxes.every(a => axes[a]) } : null;
    return { index: slot.index, role: original.role, caseId: slot.caseId, runId: slot.runId, status, receipt, receiptSha256: receipt ? sha(receipt) : null, assessment, agreement, transportCount: event ? Number(event.transportCount) : null, httpStatus: event ? event.httpStatus as number | null : null };
  });
  const primary = slots.slice(0, 80), repeats = slots.slice(80), reference = (id: string) => sources.bundle.references.items.find(r => r.caseId === id)!;
  const repeatResults = repeats.map(s => { const p = primary.find(p => p.caseId === s.caseId)!; return { index: s.index, primaryIndex: p.index, stable: Boolean(s.assessment && p.assessment && equal(vector(s.assessment), vector(p.assessment))) }; });
  // Re-enforce the frozen stop schedule during independent replay too. An
  // internally rehashed journal cannot keep dispatching after a fatal result.
  const firstFatal = slots.findIndex(s => {
    if (!observed.has(s.index)) return false;
    const ref = reference(s.caseId);
    return s.status !== 'valid' || s.agreement?.critical === false || ref.answerQuality === 'flawed' && s.assessment?.disposition === 'pass' || ref.answerQuality === 'acceptable' && s.agreement?.disposition === false || s.role === 'repeat' && !repeatResults.find(r => r.index === s.index)?.stable || primary.slice(0, Math.min(s.index + 1, 80)).filter(p => p.agreement?.all === false).length > 4;
  });
  assert.ok(firstFatal < 0 || !slots.some(s => s.index > firstFatal && started.has(s.index)), 'Journal continued after the first frozen fatal outcome.');
  assert.ok(firstFatal < 0 || terminal !== 'finished', 'A frozen fatal outcome must terminate as stopped.');
  const metrics = { primary: { planned: 80, valid: primary.filter(s => s.status === 'valid').length, fullAxisMatches: primary.filter(s => s.agreement?.all).length, criticalAxisMatches: primary.filter(s => s.agreement?.critical).length, flawed: { denominator: 60, rawPasses: primary.filter(s => reference(s.caseId).answerQuality === 'flawed' && s.assessment?.disposition === 'pass').length }, acceptable: { denominator: 20, dispositionMatches: primary.filter(s => reference(s.caseId).answerQuality === 'acceptable' && s.agreement?.disposition).length } }, repeats: { planned: 12, valid: repeats.filter(s => s.status === 'valid').length, stable: repeatResults.filter(r => r.stable).length, results: repeatResults }, invalid: slots.filter(s => s.status === 'invalid').length, unknown: slots.filter(s => s.status === 'unknown').length, unattempted: slots.filter(s => s.status === 'unattempted').length };
  const rawUsage = Object.values(receipts).filter((r): r is LiveQualificationReceipt => Boolean(r));
  const hasUsage = rawUsage.filter(r => Number.isSafeInteger(r.input_tokens) && Number(r.input_tokens) >= 0 && Number.isSafeInteger(r.output_tokens) && Number(r.output_tokens) >= 0);
  const accounting = { reservedSlots: rawUsage.length, observedSlots: observed.size, validGrades: slots.filter(s => s.status === 'valid').length, reservedPlanningAllowanceUsd: Math.round(rawUsage.reduce((sum, r) => sum + r.allowance_usd, 0) * 1e6) / 1e6, observedTransportCount: slots.reduce((sum, s) => sum + (s.transportCount ?? 0), 0), unknownTransportSlots: slots.filter(s => s.status === 'unknown' && s.transportCount === null).length, usage: { inputTokens: hasUsage.reduce((sum, r) => sum + Number(r.input_tokens), 0), outputTokens: hasUsage.reduce((sum, r) => sum + Number(r.output_tokens), 0), receiptsWithUsage: hasUsage.length, receiptsWithoutUsage: rawUsage.length - hasUsage.length }, label: 'local_planning_allowances_not_settled_charges' };
  const gates = { completeExecution: terminal === 'finished' && slots.length === 92 && slots.every(s => s.transportCount === 1 && s.httpStatus === 200), allSlotsValid: slots.every(s => s.status === 'valid'), zeroFlawedPasses: metrics.primary.flawed.rawPasses === 0, allCriticalAxesMatch: metrics.primary.criticalAxisMatches === 80, acceptableDispositionMatches: metrics.primary.acceptable.dispositionMatches === 20, primaryFullAxisThreshold: metrics.primary.fullAxisMatches >= sources.bundle.plan.criteria.minimumPrimaryFullAxisMatches, repeatsStable: metrics.repeats.stable === 12 };
  return { slots, metrics, accounting, terminal, stopReasons, gates, gatePassed: Object.values(gates).every(Boolean), qualificationAuthority: 'none_receipt_reconstruction_requires_trusted_production_verifier' as const, qualified: false as const, productionActivationQualified: false as const, qualityClaimEligible: false as const };
}
export function qualificationStopReasons(observations: ReturnType<typeof inspectQualificationObservations>, sources: QualificationLiveSources, index: number) {
  const s = observations.slots[index], ref = sources.bundle.references.items.find(r => r.caseId === s.caseId)!;
  const reasons: string[] = [];
  if (s.status !== 'valid') reasons.push('invalid_or_unknown_outcome');
  if (s.agreement && !s.agreement.critical) reasons.push('critical_axis_mismatch');
  if (ref.answerQuality === 'flawed' && s.assessment?.disposition === 'pass') reasons.push('flawed_raw_pass');
  if (ref.answerQuality === 'acceptable' && s.agreement && !s.agreement.disposition) reasons.push('acceptable_control_misrouted');
  if (index >= 80 && !observations.metrics.repeats.results.find(r => r.index === index)?.stable) reasons.push('repeat_instability');
  if (observations.slots.slice(0, Math.min(index + 1, 80)).filter(s => s.agreement && !s.agreement.all).length > 4) reasons.push('full_axis_failure_allowance_exceeded');
  return reasons;
}
