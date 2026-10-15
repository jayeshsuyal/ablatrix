import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { CLAIM_SUPPORT_TOOL, type ClaimSupportInput } from './claim-support.ts';
import { SapiomFeedbackProvider, type FeedbackProviderOptions } from './feedback-provider.ts';
import { confirmNativeQualification, verifyNativeConfirmationMetadata, type NativeQualificationConfirmation } from './grader-qualification-live-authorization.ts';
import { qualificationHash as sha } from './grader-qualification.ts';
import { assertLiveQualificationMerged, assertLiveQualificationStartingLedger, calibrationCredentialOptions, defaultLiveQualificationScope, inspectLiveQualificationBoundary, qualificationLiveCodeHashes, readLiveQualificationLedger, readLiveQualificationReceipts, validateLiveScope, type LiveQualificationBoundary, type LiveQualificationReceipt } from './grader-qualification-live-boundary.ts';
import { appendQualificationJournal, createQualificationJournal, publishQualificationJson, readQualificationJournal, type QualificationJournalBinding } from './grader-qualification-live-journal.ts';
import { inspectQualificationObservations, prepareQualificationLivePlan, qualificationStopReasons, readQualificationLiveSources, verifyQualificationLiveApproval, verifyQualificationLivePlan, type QualificationLiveApproval, type QualificationLivePlan, type QualificationLiveSources } from './grader-qualification-live.ts';

type Guard = NonNullable<FeedbackProviderOptions['operationGuard']>;
type Provider = Pick<SapiomFeedbackProvider, 'executionMode' | 'capacity' | 'gradeClaimSupport' | 'receipt' | 'close'>;
type Receipts = Record<string, LiveQualificationReceipt | null | undefined>;
type Frozen = { plan: QualificationLivePlan; sources: QualificationLiveSources; planFileSha256: string; approval: QualificationLiveApproval; nativeConfirmation?: NativeQualificationConfirmation };
type CoreDependencies = {
  preflight(): void | Promise<void>;
  inspect(boundary: LiveQualificationBoundary): void | Promise<void>;
  createProvider(hooks: { fetchImpl: typeof fetch; operationGuard: Guard }): Provider;
  transport: typeof fetch;
  receipts(): Receipts;
};
const fileHash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function readJson(path: string) {
  assert.ok(isAbsolute(path) && resolve(path) === path && realpathSync(path) === path, 'Qualification input must have a canonical absolute path.');
  const stat = lstatSync(path); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 32 * 1024 * 1024);
  const bytes = readFileSync(path); return { value: JSON.parse(bytes.toString()), sha256: fileHash(bytes) };
}
function scopeFor(plan: QualificationLivePlan) {
  // Use the fixed production caller; a plan cannot choose another ledger, port,
  // review queue, policy store, thread, or cohort consumption directory.
  const expected = { ...defaultLiveQualificationScope(), ledgerInitialSha256: plan.callerScope.ledgerInitialSha256 };
  assert.equal(sha(plan.callerScope), sha(expected), 'Execution plan caller differs from the canonical production scope.');
  return validateLiveScope(expected);
}
function loadPlan(planPath: string) {
  const document = readJson(planPath), plan = document.value as QualificationLivePlan, scope = scopeFor(plan);
  const sources = readQualificationLiveSources(scope.repositoryPath);
  assertLiveQualificationMerged(plan.implementationCommit, scope.repositoryPath);
  verifyQualificationLivePlan(plan, sources, { implementationCommit: plan.implementationCommit, callerScope: scope, codeFileSha256: qualificationLiveCodeHashes(plan.implementationCommit) });
  return { plan, sources, planFileSha256: document.sha256 };
}
function approvalFor(plan: QualificationLivePlan) {
  return verifyQualificationLiveApproval(plan, readJson(plan.paths.approvalPath).value as QualificationLiveApproval);
}
function binding(plan: QualificationLivePlan, transportProvenance: QualificationJournalBinding['transportProvenance']): QualificationJournalBinding {
  return { planSha256: plan.executionPlanSha256, datasetSha256: plan.datasetSha256, ledgerPath: plan.callerScope.budgetPath, claimDirectory: plan.callerScope.claimDirectory, checkpointPath: plan.paths.checkpointPath, reportPath: plan.paths.reportPath, transportProvenance };
}
function exactReceipts(plan: QualificationLivePlan, values: Receipts): Receipts {
  assert.ok(Object.keys(values).every(id => plan.slots.some(slot => slot.runId === id)), 'Reader returned an unapproved operation.');
  return Object.fromEntries(plan.slots.map(slot => [slot.runId, values[slot.runId] ?? null]));
}
async function boundedBody(response: Response, signal: AbortSignal) {
  if (!response.body) return null;
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read(); signal.throwIfAborted();
      if (next.done) break;
      bytes += next.value.byteLength; assert.ok(bytes <= 128 * 1024, 'Router grading response exceeds the existing 128 KiB provider bound.'); chunks.push(next.value);
    }
    return Buffer.concat(chunks, bytes);
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}
function observations(frozen: Frozen, provenance: QualificationJournalBinding['transportProvenance'], receipts: Receipts) {
  const journal = readQualificationJournal(binding(frozen.plan, provenance)), intent = journal.records[0];
  assert.ok(intent && intent.kind === 'intent');
  assert.equal(intent.approvalSha256, frozen.approval.approvalSha256); assert.equal(intent.planFileSha256, frozen.planFileSha256);
  assert.equal(intent.codeManifestSha256, sha(frozen.plan.codeFileSha256)); assert.equal(intent.sourceReviewSha256, frozen.plan.sourceReviewSha256);
  if (provenance === 'live_router') verifyNativeConfirmationMetadata(frozen.plan, intent.nativeConfirmation as NativeQualificationConfirmation);
  return { journal, result: inspectQualificationObservations(frozen.plan, frozen.sources, journal.records, exactReceipts(frozen.plan, receipts)) };
}

/** No credential, provider construction, reservations or network access. */
export function prepareLiveQualification(options: { implementationCommit: string; out: string }) {
  const scope = defaultLiveQualificationScope();
  validateLiveScope({ ...scope, ledgerInitialSha256: '0'.repeat(64) });
  const ledger = readLiveQualificationLedger(scope.budgetPath); assertLiveQualificationStartingLedger(ledger);
  scope.ledgerInitialSha256 = ledger.initialSha256; validateLiveScope(scope);
  assertLiveQualificationMerged(options.implementationCommit, scope.repositoryPath);
  const plan = prepareQualificationLivePlan({ sources: readQualificationLiveSources(scope.repositoryPath), implementationCommit: options.implementationCommit, codeFileSha256: qualificationLiveCodeHashes(options.implementationCommit), callerScope: scope, artifactDirectory: dirname(options.out), createdAt: new Date().toISOString() });
  assert.equal(options.out, resolve(dirname(options.out), 'execution-plan-v1.json'), 'Publish the execution plan at its canonical evidence filename.');
  publishQualificationJson(options.out, plan);
  return { mode: 'offline_preparation', planPath: options.out, executionPlanSha256: plan.executionPlanSha256, budget: plan.budget, newProviderCalls: 0, approval: 'pending', productionActivationQualified: false };
}
export function verifyLiveQualificationPlanFile(planPath: string) {
  const { plan } = loadPlan(planPath), ledger = readLiveQualificationLedger(plan.callerScope.budgetPath);
  assert.equal(ledger.initialSha256, plan.callerScope.ledgerInitialSha256, 'All 102 historical receipt bytes must remain unchanged.');
  return { mode: 'offline_plan_verification', executionPlanSha256: plan.executionPlanSha256, budget: plan.budget, newProviderCalls: 0, productionActivationQualified: false };
}

/** Internal dispatch engine. Its injectable entry point below is permanently
 * mechanics-only. Only the non-injectable production verifier can certify. */
async function executeCore(frozen: Frozen, provenance: QualificationJournalBinding['transportProvenance'], dependencies: CoreDependencies) {
  const { plan, sources } = frozen, ids = plan.slots.map(slot => slot.runId), reservedRunIds: string[] = [];
  let transportCount = 0;
  const inspect = (runId?: string, attemptId?: string) => dependencies.inspect({ ledgerInitialSha256: plan.callerScope.ledgerInitialSha256, allowedRunIds: ids, reservedRunIds: [...reservedRunIds], transportCount, maxCalls: 92, ...(runId ? { runId } : {}), ...(attemptId ? { attemptId } : {}) });
  await dependencies.preflight(); await inspect();
  assert.ok(!existsSync(plan.paths.recordPath), 'Qualification record already exists.');
  assert.ok(Object.values(exactReceipts(plan, dependencies.receipts())).every(r => !r), 'Frozen operation IDs were already attempted.');
  const handle = createQualificationJournal(binding(plan, provenance));
  if (provenance === 'live_router') verifyNativeConfirmationMetadata(plan, frozen.nativeConfirmation!);
  appendQualificationJournal(handle, { kind: 'intent', approvalSha256: frozen.approval.approvalSha256, planFileSha256: frozen.planFileSha256, codeManifestSha256: sha(plan.codeFileSha256), sourceReviewSha256: plan.sourceReviewSha256, ...(frozen.nativeConfirmation ? { nativeConfirmation: frozen.nativeConfirmation } : {}) });
  let active: { index: number; beforeReservation: boolean; attemptId?: string; transported: boolean; startedAt?: number; httpStatus: number | null } | undefined;
  const guard: Guard = async operation => {
    const slot = active && plan.slots[active.index];
    assert.ok(active && slot && operation.kind === CLAIM_SUPPORT_TOOL && operation.runId === slot.runId && operation.requestSha256 === slot.requestSha256, 'Provider attempted an operation outside the active frozen grading request.');
    if (operation.phase === 'before_reservation') {
      assert.ok(!active.beforeReservation && !active.attemptId && !reservedRunIds.includes(slot.runId), 'Slot cannot reserve twice.');
      await inspect(slot.runId); active.beforeReservation = true;
    } else {
      assert.ok(active.beforeReservation && !active.attemptId && operation.attemptId, 'Reservation lacks the sole guarded intent.');
      active.attemptId = operation.attemptId; reservedRunIds.push(slot.runId);
      appendQualificationJournal(handle, { kind: 'slot_reserved', index: slot.index, runId: slot.runId, requestSha256: slot.requestSha256, receiptId: operation.attemptId });
      await inspect(slot.runId, active.attemptId);
    }
  };
  const boundedTransport: typeof fetch = async (url, init) => {
    const requested = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url, slot = active && plan.slots[active.index];
    assert.ok(active && slot && active.beforeReservation && active.attemptId && !active.transported && transportCount < 92 && requested === 'https://router.sapiom.ai/v1/chat/completions' && init?.method === 'POST' && init.body === JSON.stringify(sources.bundle.requests[slot.index].requestBody), 'Transport differs from the exact frozen single-call request.');
    await inspect(slot.runId, active.attemptId); active.transported = true; active.startedAt = Date.now(); transportCount++;
    let response: Response | undefined;
    try {
      const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000);
      response = await dependencies.transport(requested, { ...init, redirect: 'error', signal });
      active.httpStatus = response.status;
      // Guard the full operation, including streamed body consumption, before
      // handing bytes to the provider's receipt parser/commit.
      const body = await boundedBody(response, signal);
      return new Response(body?.byteLength ? body : null, { status: response.status, statusText: response.statusText, headers: response.headers });
    } finally {
      try { await inspect(slot.runId, active.attemptId); } catch (error) { await response?.body?.cancel().catch(() => {}); throw error; }
    }
  };
  const reasons: string[] = []; let provider: Provider | undefined;
  try {
    await inspect();
    provider = dependencies.createProvider({ fetchImpl: boundedTransport, operationGuard: guard });
    assert.equal(provider.executionMode, 'live'); assert.equal(provider.capacity(92).ready, true, 'Provider cannot reserve the exact 92-call bounded allowance.');
    for (const slot of plan.slots) {
      active = { index: slot.index, beforeReservation: false, transported: false, httpStatus: null };
      appendQualificationJournal(handle, { kind: 'slot_started', index: slot.index, runId: slot.runId, requestSha256: slot.requestSha256 });
      try { await provider.gradeClaimSupport(structuredClone(sources.bundle.requests[slot.index].input) as ClaimSupportInput); }
      catch { /* Preserve durable outcome; never retry a throw. */ }
      let boundaryPassed = true;
      try { await inspect(slot.runId, active.attemptId); } catch { boundaryPassed = false; reasons.push('after_operation_boundary_failed'); }
      const receipts = exactReceipts(plan, dependencies.receipts()), receipt = receipts[slot.runId];
      assert.equal(sha(provider.receipt(slot.runId) ?? null), sha(receipt ?? null), 'Provider and independent ledger receipt differ.');
      if (receipt) {
        assert.equal(receipt.id, active.attemptId);
        appendQualificationJournal(handle, { kind: 'slot_observed', index: slot.index, runId: slot.runId, requestSha256: slot.requestSha256, receiptId: receipt.id, receiptSha256: sha(receipt), receipt: structuredClone(receipt), transportCount: active.transported ? 1 : 0, httpStatus: active.httpStatus, durationMs: active.startedAt === undefined ? 0 : Math.max(0, Date.now() - active.startedAt) });
      }
      const outcome = observations(frozen, provenance, receipts).result;
      reasons.push(...qualificationStopReasons(outcome, sources, slot.index));
      if (!boundaryPassed || reasons.length) break;
      active = undefined;
    }
  } catch { reasons.push('execution_guard_failed'); }
  finally { try { provider?.close(); } catch { reasons.push('provider_close_failed'); } }
  // Even a passing prefix or a guard failure after the last body cannot issue
  // a completed record. A failed final check leaves a stopped/inconclusive run.
  try { await inspect(active ? plan.slots[active.index].runId : undefined, active?.attemptId); } catch { reasons.push('before_publication_boundary_failed'); }
  const stopReasons = [...new Set(reasons)];
  appendQualificationJournal(handle, { kind: stopReasons.length ? 'stopped' : 'finished', stopReasons });
  const inspection = observations(frozen, provenance, dependencies.receipts());
  return { ...inspection, stopReasons, stopped: stopReasons.length > 0 };
}

/** Isolated tests may supply transport/providers/receipts. Such evidence can
 * NEVER issue a qualification record, regardless of live-shaped receipt JSON. */
export async function executeQualificationMechanics(options: Frozen, dependencies: CoreDependencies) {
  const frozen = structuredClone(options), result = await executeCore(frozen, 'mocked_mechanics_only', dependencies);
  return { ...result, transportProvenance: 'mocked_mechanics_only' as const, qualified: false as const, productionActivationQualified: false as const, qualityClaimEligible: false as const };
}

function ledgerForReplay(plan: QualificationLivePlan, receipts: Receipts) {
  const ledger = readLiveQualificationLedger(plan.callerScope.budgetPath), fresh = Object.values(receipts).filter((r): r is LiveQualificationReceipt => Boolean(r));
  assert.equal(ledger.initialSha256, plan.callerScope.ledgerInitialSha256, 'Historical receipts changed.');
  assert.equal(sha([...ledger.newRunIds].sort()), sha(plan.slots.filter(s => receipts[s.runId]).map(s => s.runId).sort()), 'Shared ledger has extra operations outside this execution.');
  assert.equal(ledger.attempts, 102 + fresh.length); assert.ok(ledger.attempts <= 194 && fresh.length <= 92);
  assert.equal(ledger.reservedUsd, Number((10.2 + fresh.length * .1).toFixed(6))); assert.ok(ledger.reservedUsd + .200281 <= 20);
  assert.ok(ledger.rows.every(r => r.allowanceUsd === .1)); assert.equal(ledger.pending, fresh.filter(r => r.status === 'pending').length);
  assert.equal(new Set(fresh.map(r => r.id)).size, fresh.length, 'Qualification receipt identities must be unique.');
  return ledger;
}
function deriveProduction(frozen: Frozen) {
  const { plan } = frozen, receipts = readLiveQualificationReceipts(plan.callerScope, plan.slots.map(s => s.runId)), ledger = ledgerForReplay(plan, receipts);
  const { journal, result } = observations(frozen, 'live_router', receipts);
  const terminal = journal.records.at(-1), stopReasons = terminal?.kind === 'stopped' ? terminal.stopReasons : [];
  assert.ok(Array.isArray(stopReasons) && stopReasons.every(reason => typeof reason === 'string' && reason.length > 0 && reason.length <= 200) && new Set(stopReasons).size === stopReasons.length, 'Terminal stop reasons must retain their bounded structured diagnostics.');
  const failedGateReasons = [...new Set(result.slots.filter(s => s.status === 'valid').flatMap(s => qualificationStopReasons(result, frozen.sources, s.index)))];
  const reportBody = { format: 'grader-qualification-live-report-v1', executionPlanSha256: plan.executionPlanSha256, sealedPlanSha256: plan.sealedPlanSha256, datasetSha256: plan.datasetSha256, sourceReviewSha256: plan.sourceReviewSha256, approvalSha256: frozen.approval.approvalSha256, implementationCommit: plan.implementationCommit, codeManifestSha256: sha(plan.codeFileSha256), planFileSha256: frozen.planFileSha256, checkpointTailSha256: terminal?.sha256 ?? null, cohortAnchorTailSha256: journal.anchors.at(-1)!.sha256, transportProvenance: 'live_router_observed_with_local_ledger' as const, ledger: { initialSha256: ledger.initialSha256, attempts: ledger.attempts, pending: ledger.pending, reservedPlanningAllowanceUsd: ledger.reservedUsd }, ...result, stopReasons, failedGateReasons, qualified: false as const };
  const report = { ...reportBody, reportSha256: sha(reportBody) };
  const complete = result.gates.completeExecution && result.gates.allSlotsValid && ledger.pending === 0;
  const qualified = complete && result.gatePassed;
  const recordBody = { format: 'grader-qualification-live-record-v1', executionPlanSha256: plan.executionPlanSha256, datasetSha256: plan.datasetSha256, reportSha256: report.reportSha256, sourceReviewSha256: plan.sourceReviewSha256, approvalSha256: frozen.approval.approvalSha256, implementationCommit: plan.implementationCommit, checkpointTailSha256: report.checkpointTailSha256, cohortAnchorTailSha256: report.cohortAnchorTailSha256, status: qualified ? 'qualified_for_scoped_shadow' as const : complete || failedGateReasons.length ? 'failed' as const : 'inconclusive' as const, qualified, scope: 'constructed_single_unit_source_support_shadow_evaluation', referenceProvenance: 'independent_ai_source_consistency_review_of_fictional_packets', humanGold: false, externalTruth: false, reviewIdentityVerified: false, productionActivationQualified: false, qualityClaimEligible: false, limitations: ['Locally observed Router transport and ledger receipts; no provider-signed billing attestation or upstream weight pinning.', 'Constructed single-unit cases do not establish real-user answer improvement or production activation readiness.'] };
  return { report, record: { ...recordBody, recordSha256: sha(recordBody) }, stopped: result.terminal !== 'finished' };
}

/** Independent, non-injectable, read-only verifier. Does not open credentials,
 * construct a provider, repair checkpoints, dispatch calls or promote policy. */
export function verifyLiveQualification(planPath: string) {
  const loaded = loadPlan(planPath), frozen = { ...loaded, approval: approvalFor(loaded.plan) }, result = deriveProduction(frozen);
  for (const [path, expected] of [[frozen.plan.paths.reportPath, result.report], [frozen.plan.paths.recordPath, result.record]] as const) if (existsSync(path)) assert.equal(sha(readJson(path).value), sha(expected), 'Published qualification artifact differs from independent reconstruction.');
  return { mode: 'read_only_live_qualification_replay', ...result, status: result.record.status, newProviderCalls: 0 };
}

/** The only production dispatch entry point. There are deliberately no hooks
 * for caller-selected transport, credential readers, scope, receipts or mode. */
export async function executeLiveQualification(options: { planPath: string; acknowledgedPlanSha256: string }) {
  const loaded = loadPlan(options.planPath), { plan } = loaded, scope = scopeFor(plan), env = process.env;
  assert.equal(options.acknowledgedPlanSha256, plan.executionPlanSha256, 'Explicit acknowledgement of this exact execution plan is required.');
  const approval = approvalFor(plan), frozen: Frozen = { ...loaded, approval };
  assert.equal(env.ABLATRIX_GRADER_QUALIFICATION_LIVE, '1'); assert.equal(env.ABLATRIX_LOOP_LIVE, '1');
  for (const key of ['ABLATRIX_GRADER_CALIBRATION_LIVE', 'ABLATRIX_REVISION_WEB', 'ABLATRIX_AUTOMATIC_CHECK_LIVE', 'ABLATRIX_ANSWER_POLICY_SHADOW_LIVE', 'ABLATRIX_LANGFUSE_ENABLED']) assert.equal(env[key], '0', `Disable ${key} during isolated qualification.`);
  assert.equal(env.ABLATRIX_LOOP_BUDGET_DB, scope.budgetPath); assert.equal(env.ABLATRIX_LOOP_CALL_LIMIT, '194'); assert.equal(Number(env.ABLATRIX_SPEND_CAP_USD), 20); assert.equal(Number(env.ABLATRIX_LOOP_PRIOR_SPEND_USD), .200281); assert.equal(Number(env.ABLATRIX_LOOP_ALLOWANCE_USD), .1);
  const inspect = (boundary: LiveQualificationBoundary) => {
    assert.equal(readJson(options.planPath).sha256, frozen.planFileSha256, 'Frozen execution plan bytes changed.');
    assert.equal(sha(qualificationLiveCodeHashes()), sha(plan.codeFileSha256), 'Executing adapter/provider bytes changed.');
    readQualificationLiveSources(scope.repositoryPath); assert.equal(sha(approvalFor(plan)), sha(approval), 'Financial approval changed.');
    inspectLiveQualificationBoundary(scope, boundary);
  };
  const preflight = () => { assertLiveQualificationStartingLedger(readLiveQualificationLedger(scope.budgetPath)); calibrationCredentialOptions(env); };
  // Audit JSON is never authority. The production entry point obtains the
  // confirmation directly from the OS after checking scope and stopped workers.
  // Recheck everything after the dialog before claiming the cohort or opening
  // credential contents; Cancel/timeout cannot reserve or construct a provider.
  preflight(); inspect({ ledgerInitialSha256: scope.ledgerInitialSha256, allowedRunIds: plan.slots.map(s => s.runId), reservedRunIds: [], transportCount: 0, maxCalls: 92 });
  frozen.nativeConfirmation = confirmNativeQualification(plan);
  await executeCore(frozen, 'live_router', {
    preflight, inspect,
    createProvider: hooks => {
      preflight(); inspect({ ledgerInitialSha256: scope.ledgerInitialSha256, allowedRunIds: plan.slots.map(s => s.runId), reservedRunIds: [], transportCount: 0, maxCalls: 92 });
      const { apiKey, credentialsFile } = calibrationCredentialOptions(env);
      return new SapiomFeedbackProvider({ enabled: true, apiKey, credentialsFile, dbPath: scope.budgetPath, callLimit: 194, capUsd: 20, priorSpendUsd: .200281, allowancePerCallUsd: .1, ...hooks });
    }, transport: globalThis.fetch, receipts: () => readLiveQualificationReceipts(scope, plan.slots.map(s => s.runId))
  });
  // Re-read every binding and receipt after provider close. Publication cannot
  // turn a caller-supplied JSON report or synthetic run into certification.
  const result = verifyLiveQualification(options.planPath);
  publishQualificationJson(plan.paths.reportPath, result.report); publishQualificationJson(plan.paths.recordPath, result.record);
  return { mode: 'bounded_live_grader_qualification', executionPlanSha256: plan.executionPlanSha256, reportPath: plan.paths.reportPath, recordPath: plan.paths.recordPath, status: result.record.status, stopped: result.stopped, qualified: result.record.qualified, accounting: result.report.accounting, metrics: result.report.metrics, productionActivationQualified: false, qualityClaimEligible: false };
}
