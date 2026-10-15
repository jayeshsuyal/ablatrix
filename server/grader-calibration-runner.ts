import { closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ClaimSupportReceipt } from './claim-support.ts';
import { CLAIM_SUPPORT_TOOL } from './claim-support.ts';
import type { FeedbackProviderOptions, SapiomFeedbackProvider } from './feedback-provider.ts';
import { calibrationHash, classifyCalibrationReceipt, deriveCalibrationReport, verifyCalibrationCheckpointRecords, verifyCalibrationPlan, type CalibrationCheckpointRecord, type CalibrationPlan, type CalibrationPlanSlot, type CalibrationReport } from './grader-calibration.ts';

type Verification = Parameters<typeof verifyCalibrationPlan>[1];
type Provenance = 'live_router' | 'mocked_mechanics_only';
type Provider = Pick<SapiomFeedbackProvider, 'gradeClaimSupport' | 'receipt' | 'capacity' | 'close' | 'executionMode'>;
type OperationGuard = NonNullable<FeedbackProviderOptions['operationGuard']>;
export type CalibrationBoundary = {
  phase: 'preflight' | 'before_reservation' | 'after_reservation' | 'before_transport' | 'after_transport' | 'after_operation' | 'before_report_publish';
  planSha256: string; slotIndex: number | null; runId: string | null; attemptId?: string; reservedRunIds: string[]; transportCount: number;
};
export type CalibrationExecutionOptions = {
  plan: CalibrationPlan; execute: boolean; liveOptIn: boolean; acknowledgedPlanSha256: string;
  ledgerPath: string; claimDirectory: string; checkpointPath: string; reportPath: string; transportProvenance: Provenance;
};
export type CalibrationExecutionDependencies = {
  verification: Verification;
  preflight(plan: CalibrationPlan, options: CalibrationExecutionOptions): void | Promise<void>;
  inspectBoundary(boundary: CalibrationBoundary): void | Promise<void>;
  createProvider(hooks: { fetchImpl: typeof fetch; operationGuard: OperationGuard }): Provider;
  transport: typeof fetch;
  /** Read only these newly approved opaque run IDs from the existing ledger. */
  readLedgerReceipts(plan: CalibrationPlan): Record<string, ClaimSupportReceipt | null | undefined>;
};
export type CalibrationExecutionResult = { report: CalibrationReport; reportPath: string; checkpointPath: string; claimPath: string; stopped: boolean;
  checkpointInspection?: { state: 'one_record_append_window'; anchoredRecordCount: number; unanchoredTail: CalibrationCheckpointRecord; explanation: string } };
type ClaimAnchor = {
  format: 'grader-calibration-claim-v1'; sequence: number; previousSha256: string; planSha256: string;
  checkpointPath: string; reportPath: string; ledgerPath: string; transportProvenance: Provenance;
  acknowledgedPlanSha256: string; authority: 'parent_authorized_bounded_pilot' | 'mocked_mechanics_only'; referenceReview: 'parent_source_review_acknowledged' | 'mocked_acknowledgement_only';
  recordCount: number; tailSha256: string; createdAt: string; sha256: string;
};
const ZERO = '0'.repeat(64);
const MAX_JOURNAL_BYTES = 4 * 1024 * 1024;
function paths(options: Pick<CalibrationExecutionOptions, 'plan' | 'ledgerPath' | 'claimDirectory' | 'checkpointPath' | 'reportPath'>) {
  const result = { ledgerPath: resolve(options.ledgerPath), claimPath: join(resolve(options.claimDirectory), `${options.plan.planSha256}.claim.jsonl`), checkpointPath: resolve(options.checkpointPath), reportPath: resolve(options.reportPath) };
  if (result.ledgerPath !== options.plan.callerScope.budgetPath || resolve(options.claimDirectory) !== options.plan.callerScope.claimDirectory) throw new Error('Calibration ledger and canonical claim directory must match the frozen caller scope.');
  if (new Set(Object.values(result)).size !== 4 || result.checkpointPath === resolve(options.claimDirectory) || result.reportPath === resolve(options.claimDirectory)) throw new Error('Calibration paths must identify separate ledger, private claim, checkpoint and report files.');
  return result;
}
function syncDirectory(path: string) { const fd = openSync(dirname(path), 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
function exclusive(path: string, content: string, mode = 0o600) {
  const fd = openSync(path, 'wx', mode);
  try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
  syncDirectory(path);
}
function append(path: string, value: unknown) {
  // No O_CREAT: deletion cannot silently create a new execution journal.
  const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
  try { writeFileSync(fd, `${JSON.stringify(value)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
}
function readLines<T>(path: string, allowEmpty = false): T[] {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_JOURNAL_BYTES || (!allowEmpty && metadata.size < 1)) throw new Error('Calibration checkpoint file is missing, replaced or outside its size bound.');
  const content = readFileSync(path, 'utf8');
  if (allowEmpty && content === '') return [];
  if (!content.endsWith('\n') || content.includes('\r')) throw new Error('Calibration checkpoint has an incomplete or altered record.');
  return content.slice(0, -1).split('\n').map(line => JSON.parse(line) as T);
}
function anchorBody(options: CalibrationExecutionOptions, frozenPaths: ReturnType<typeof paths>, count: number, tail: string, anchors: ClaimAnchor[]): Omit<ClaimAnchor, 'sha256'> {
  return { format: 'grader-calibration-claim-v1', sequence: anchors.length, previousSha256: anchors.at(-1)?.sha256 ?? ZERO,
    planSha256: options.plan.planSha256, checkpointPath: frozenPaths.checkpointPath, reportPath: frozenPaths.reportPath, ledgerPath: frozenPaths.ledgerPath, transportProvenance: options.transportProvenance,
    acknowledgedPlanSha256: options.acknowledgedPlanSha256, authority: options.transportProvenance === 'live_router' ? 'parent_authorized_bounded_pilot' : 'mocked_mechanics_only', referenceReview: options.transportProvenance === 'live_router' ? 'parent_source_review_acknowledged' : 'mocked_acknowledgement_only',
    recordCount: count, tailSha256: tail, createdAt: new Date().toISOString() };
}
function verifyAnchors(options: CalibrationExecutionOptions, frozenPaths: ReturnType<typeof paths>, records: CalibrationCheckpointRecord[], anchors: ClaimAnchor[]) {
  if (anchors.length !== records.length + 1) throw new Error('Canonical calibration claim and journal have different durable record counts.');
  let previous = ZERO;
  for (const [index, anchor] of anchors.entries()) {
    const { sha256, ...body } = anchor;
    if (anchor.format !== 'grader-calibration-claim-v1' || anchor.sequence !== index || anchor.previousSha256 !== previous || sha256 !== calibrationHash(body) || anchor.planSha256 !== options.plan.planSha256 || anchor.checkpointPath !== frozenPaths.checkpointPath || anchor.reportPath !== frozenPaths.reportPath || anchor.ledgerPath !== frozenPaths.ledgerPath || anchor.transportProvenance !== options.transportProvenance || anchor.acknowledgedPlanSha256 !== options.plan.planSha256 || anchor.authority !== (options.transportProvenance === 'live_router' ? 'parent_authorized_bounded_pilot' : 'mocked_mechanics_only') || anchor.referenceReview !== (options.transportProvenance === 'live_router' ? 'parent_source_review_acknowledged' : 'mocked_acknowledgement_only') || anchor.recordCount !== index || anchor.tailSha256 !== (index ? records[index - 1].sha256 : ZERO) || !Number.isFinite(Date.parse(anchor.createdAt))) throw new Error('Canonical calibration claim no longer matches its exact journal, paths or provenance.');
    previous = sha256;
  }
}
function exactReceipts(plan: CalibrationPlan, receipts: ReturnType<CalibrationExecutionDependencies['readLedgerReceipts']>) {
  const allowed = new Set(plan.slots.map(slot => slot.input.runId));
  if (Object.keys(receipts).some(runId => !allowed.has(runId))) throw new Error('Calibration receipt reader returned an unapproved run identity.');
  return Object.fromEntries(plan.slots.map(slot => [slot.input.runId, receipts[slot.input.runId] ?? null]));
}

/** Reconstruct every denominator and result from current exact ledger receipts,
 * frozen references and independently anchored private checkpoints. Never opens
 * a provider, reserves an allowance, creates files or resumes dispatch. */
export function verifyGraderCalibrationCheckpoint(options: CalibrationExecutionOptions, dependencies: Pick<CalibrationExecutionDependencies, 'verification' | 'readLedgerReceipts'>): CalibrationExecutionResult {
  const plan = verifyCalibrationPlan(options.plan, dependencies.verification), frozen = { ...options, plan }, locations = paths(frozen);
  const records = readLines<CalibrationCheckpointRecord>(locations.checkpointPath, true), anchors = readLines<ClaimAnchor>(locations.claimPath);
  verifyCalibrationCheckpointRecords(plan, records);
  // The journal is fsynced before its independent anchor. A crash can leave
  // exactly one complete tail unanchored. Inspect it without repairing files,
  // trusting its result/timing, or reopening dispatch. A published report still
  // requires the complete original anchor chain.
  const appendWindow = anchors.length > 0 && anchors.length === records.length && !existsSync(locations.reportPath);
  const anchoredRecords = appendWindow ? records.slice(0, -1) : records;
  verifyAnchors(frozen, locations, anchoredRecords, anchors);
  const receiptsByRunId = exactReceipts(plan, dependencies.readLedgerReceipts(plan));
  if (appendWindow) deriveCalibrationReport(plan, { executionMode: 'live', transportProvenance: frozen.transportProvenance, receiptsByRunId, checkpointRecords: records }); // Validate tail receipt binding only.
  const report = deriveCalibrationReport(plan, { executionMode: 'live', transportProvenance: frozen.transportProvenance, receiptsByRunId, checkpointRecords: anchoredRecords });
  if (existsSync(locations.reportPath)) {
    const current = JSON.parse(readFileSync(locations.reportPath, 'utf8'));
    if (calibrationHash(current) !== calibrationHash(report)) throw new Error('Immutable calibration report differs from the exact current ledger, plan or checkpoints.');
  }
  return { report, reportPath: locations.reportPath, checkpointPath: locations.checkpointPath, claimPath: locations.claimPath, stopped: !report.complete,
    ...(appendWindow ? { checkpointInspection: { state: 'one_record_append_window' as const, anchoredRecordCount: anchoredRecords.length, unanchoredTail: structuredClone(records.at(-1)!), explanation: 'One complete journal tail lacks its independent anchor. This may be an interrupted append or anchor deletion; only the anchored prefix contributes grades and transport counts. Trusted ledger reservations remain counted. No files were repaired and dispatch cannot resume.' } } : {}) };
}

/** Only an explicitly acknowledged fresh plan can enter this function. All
 * production OS, merged-code, history and current-ledger checks are injected
 * by the CLI and run before even constructing the credential-owning provider. */
export async function executeGraderCalibration(options: CalibrationExecutionOptions, dependencies: CalibrationExecutionDependencies): Promise<CalibrationExecutionResult> {
  if (options.execute !== true || options.liveOptIn !== true || options.acknowledgedPlanSha256 !== options.plan.planSha256 || !/^[a-f0-9]{64}$/.test(options.acknowledgedPlanSha256)) throw new Error('Calibration execution requires --execute, its independent live opt-in and the exact frozen plan SHA acknowledgement.');
  const plan = verifyCalibrationPlan(options.plan, dependencies.verification), frozen: CalibrationExecutionOptions = { ...options, plan }, locations = paths(frozen);
  if (!['live_router', 'mocked_mechanics_only'].includes(frozen.transportProvenance)) throw new Error('Calibration transport provenance is required.');
  for (const path of [locations.claimPath, locations.checkpointPath, locations.reportPath]) if (existsSync(path)) throw new Error('This calibration has an existing durable intent or output. It cannot dispatch again; verify its exact receipts instead.');
  const prior = exactReceipts(plan, dependencies.readLedgerReceipts(plan));
  if (Object.values(prior).some(Boolean)) throw new Error('Frozen calibration run IDs already have ledger attempts. Execution cannot resume or redispatch.');
  const reservedRunIds: string[] = [];
  let transportCount = 0;
  const inspect = (phase: CalibrationBoundary['phase'], slot?: CalibrationPlanSlot, attemptId?: string) => {
    verifyCalibrationPlan(plan, dependencies.verification);
    return dependencies.inspectBoundary({ phase, planSha256: plan.planSha256, slotIndex: slot?.index ?? null, runId: slot?.input.runId ?? null, ...(attemptId ? { attemptId } : {}), reservedRunIds: [...reservedRunIds], transportCount });
  };
  await dependencies.preflight(plan, frozen); await inspect('preflight');
  // Recheck output exclusivity and approved run IDs after potentially slow OS
  // checks and before the first durable intent. No credential has been opened.
  for (const path of [locations.claimPath, locations.checkpointPath, locations.reportPath]) if (existsSync(path)) throw new Error('Calibration intent changed during preflight; no provider was constructed.');
  if (Object.values(exactReceipts(plan, dependencies.readLedgerReceipts(plan))).some(Boolean)) throw new Error('Calibration ledger changed during preflight; no provider was constructed.');
  mkdirSync(resolve(frozen.claimDirectory), { recursive: true, mode: 0o700 }); mkdirSync(dirname(locations.checkpointPath), { recursive: true, mode: 0o700 }); mkdirSync(dirname(locations.reportPath), { recursive: true });
  const anchors: ClaimAnchor[] = [], records: CalibrationCheckpointRecord[] = [];
  const firstBody = anchorBody(frozen, locations, 0, ZERO, anchors), initialAnchor = { ...firstBody, sha256: calibrationHash(firstBody) };
  exclusive(locations.claimPath, `${JSON.stringify(initialAnchor)}\n`); anchors.push(initialAnchor);
  exclusive(locations.checkpointPath, '');
  const checkpoint = (kind: CalibrationCheckpointRecord['kind'], extra: Partial<CalibrationCheckpointRecord> = {}) => {
    if (records.length) {
      const onDisk = readLines<CalibrationCheckpointRecord>(locations.checkpointPath), onDiskAnchors = readLines<ClaimAnchor>(locations.claimPath);
      if (calibrationHash(onDisk) !== calibrationHash(records) || calibrationHash(onDiskAnchors) !== calibrationHash(anchors)) throw new Error('Calibration journal or canonical claim changed during execution.');
      verifyAnchors(frozen, locations, onDisk, onDiskAnchors);
    }
    const body = { ...extra, sequence: records.length, previousSha256: records.at(-1)?.sha256 ?? ZERO, planSha256: plan.planSha256, kind, createdAt: new Date().toISOString() };
    const record = { ...body, sha256: calibrationHash(body) } as CalibrationCheckpointRecord;
    append(locations.checkpointPath, record); records.push(record);
    const anchor = anchorBody(frozen, locations, records.length, record.sha256, anchors), committed = { ...anchor, sha256: calibrationHash(anchor) };
    append(locations.claimPath, committed); anchors.push(committed);
  };
  checkpoint('intent');
  let active: { slot: CalibrationPlanSlot; attemptId?: string; beforeReservation: boolean; transported: boolean; dispatchedAt?: string; httpStatus?: number | null } | undefined;
  let provider: Provider | undefined;
  const operationGuard: OperationGuard = async operation => {
    if (!active || operation.kind !== CLAIM_SUPPORT_TOOL || operation.runId !== active.slot.input.runId || operation.requestSha256 !== active.slot.requestSha256) throw new Error('Provider operation differs from the sole frozen active calibration slot.');
    if (operation.phase === 'before_reservation') {
      if (active.beforeReservation || active.attemptId || reservedRunIds.includes(operation.runId!)) throw new Error('A calibration slot cannot reserve twice.');
      await inspect('before_reservation', active.slot); active.beforeReservation = true;
    } else {
      if (!active.beforeReservation || active.attemptId || !operation.attemptId) throw new Error('Calibration reservation lacks its sole guarded intent.');
      active.attemptId = operation.attemptId; reservedRunIds.push(active.slot.input.runId);
      checkpoint('slot_reserved', { slotIndex: active.slot.index, runId: active.slot.input.runId, requestSha256: active.slot.requestSha256, receiptId: operation.attemptId });
      await inspect('after_reservation', active.slot, operation.attemptId);
    }
  };
  const boundedTransport: typeof fetch = async (url, init) => {
    const requested = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (!active || !active.attemptId || !active.beforeReservation || active.transported || transportCount >= plan.budget.newCalls || requested !== 'https://router.sapiom.ai/v1/chat/completions' || init?.method !== 'POST' || typeof init.body !== 'string' || init.body !== JSON.stringify(active.slot.requestBody)) throw new Error('Calibration transport differs from its exact frozen single-call slot.');
    const slot = active.slot, attemptId = active.attemptId;
    await inspect('before_transport', slot, attemptId); active.transported = true; active.dispatchedAt = new Date().toISOString(); active.httpStatus = null; transportCount++;
    let response: Response | undefined;
    try { response = await dependencies.transport(requested, { ...init, redirect: 'error', signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000) }); if (active) active.httpStatus = response.status; return response; }
    finally {
      try { await inspect('after_transport', slot, attemptId); }
      catch (error) { await response?.body?.cancel(); throw error; }
    }
  };
  const stopReasons: string[] = [];
  try {
    provider = dependencies.createProvider({ fetchImpl: boundedTransport, operationGuard });
    if (provider.executionMode !== 'live' || !provider.capacity(plan.budget.newCalls).ready) throw new Error('The existing shared provider cannot reserve this exact finite planning allowance.');
    for (const slot of plan.slots) {
      active = { slot, beforeReservation: false, transported: false };
      checkpoint('slot_started', { slotIndex: slot.index, runId: slot.input.runId, requestSha256: slot.requestSha256 });
      try { await provider.gradeClaimSupport(structuredClone(slot.input)); }
      catch { /* Exact durable receipts decide the result; a throw never retries. */ }
      let operationBoundaryPassed = true;
      try { await inspect('after_operation', slot, active.attemptId); }
      catch { operationBoundaryPassed = false; stopReasons.push('after_operation_boundary_failed'); }
      const trusted = exactReceipts(plan, dependencies.readLedgerReceipts(plan)), receipt = trusted[slot.input.runId], current = provider.receipt(slot.input.runId);
      if (calibrationHash(current ?? null) !== calibrationHash(receipt ?? null)) throw new Error('Provider receipt differs from the current shared ledger receipt.');
      if (receipt) {
        if (receipt.id !== active.attemptId) throw new Error('Calibration receipt does not match its sole reserved provider attempt.');
        checkpoint('slot_observed', { slotIndex: slot.index, runId: slot.input.runId, requestSha256: slot.requestSha256, receiptId: receipt.id, receiptSha256: calibrationHash(receipt), receiptStatus: receipt.status, receipt: structuredClone(receipt), transportCount: active.transported ? 1 : 0,
          ...(active.dispatchedAt ? { dispatchedAt: active.dispatchedAt, durationMs: Math.max(0, Date.now() - Date.parse(active.dispatchedAt)), httpStatus: active.httpStatus ?? null } : {}) });
      }
      const classification = receipt ? classifyCalibrationReceipt(slot, receipt, 'live') : { status: 'unknown' as const };
      if (!['accepted', 'rejected', 'uncertain'].includes(classification.status)) { stopReasons.push('recorded_outcome_invalid_or_unknown'); break; }
      if (!operationBoundaryPassed) break;
      active = undefined;
    }
  } catch {
    stopReasons.push('execution_guard_failed');
  } finally {
    try { provider?.close(); } catch { stopReasons.push('provider_close_failed'); }
  }
  // Header arrival is not operation completion: body reads, validation and the
  // receipt commit can still overlap an external state change. No completed
  // terminal or immutable report is published until this final scan passes.
  try { await inspect('before_report_publish', active?.slot, active?.attemptId); }
  catch { stopReasons.push('before_report_publish_boundary_failed'); }
  const uniqueStopReasons = [...new Set(stopReasons)];
  checkpoint(uniqueStopReasons.length ? 'stopped' : 'finished', uniqueStopReasons.length ? { reason: uniqueStopReasons.join('; '), stopReasons: uniqueStopReasons } : {});
  const result = verifyGraderCalibrationCheckpoint(frozen, dependencies);
  exclusive(locations.reportPath, `${JSON.stringify(result.report, null, 2)}\n`, 0o444);
  chmodSync(locations.reportPath, 0o444);
  return result;
}
