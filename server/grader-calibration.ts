import { createHash } from 'node:crypto';
import { isAbsolute, normalize } from 'node:path';
import { claimSupportPromptIdentity, claimSupportRequestParts, replayClaimSupportReceipt, type ClaimSupportInput, type ClaimSupportReceipt, type ValidatedClaimSupportAssessment } from './claim-support.ts';
import { calibrationFixtureDataset, type CalibrationReference } from './grader-calibration-fixtures.ts';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
/** Shared hash for frozen plans, receipt snapshots and checkpoint chains. */
export const calibrationHash = (value: unknown): string => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex');
export const CALIBRATION_BUDGET = Object.freeze({ startingAttempts: 86, startingPending: 0, startingReservedUsd: 8.6, priorSpendUsd: 0.200281, newCalls: 10, allowancePerCallUsd: 0.1, absoluteCallLimit: 96, spendingCapUsd: 10, maxPlanningExposureUsd: 9.800281 });
export const CALIBRATION_CODE_FILES = Object.freeze(['server/grader-calibration.ts', 'server/grader-calibration-fixtures.ts', 'server/grader-calibration-runner.ts', 'server/grader-calibration-boundary.ts', 'scripts/grader-calibration.ts', 'server/claim-support.ts', 'server/feedback-provider.ts', 'server/citation-options.ts', 'server/source-id-diagnostic.ts']);
export type CalibrationCallerScope = Readonly<Record<string, string>>;
export type CalibrationDataset = ReturnType<typeof calibrationFixtureDataset>;
export type CalibrationPlanSlot = {
  index: number; caseId: string; familyId: string; input: ClaimSupportInput; reference: CalibrationReference;
  inputSha256: string; referenceSha256: string; sourceContextSha256: string; answerSha256: string; fullCaseSha256: string;
  requestSha256: string; responseSchemaSha256: string; systemInstructionsSha256: string; requestBody: ReturnType<typeof claimSupportRequestParts>['body'];
};
export type CalibrationPlan = {
  format: 'grader-calibration-plan-v1'; planSha256: string; createdAt: string; callerScope: CalibrationCallerScope; codeFileSha256: Record<string, string>; implementationCommit: string;
  datasetFormat: string; datasetSha256: string; referenceProvenance: CalibrationDataset['referenceProvenance']; families: CalibrationDataset['families'];
  budget: typeof CALIBRATION_BUDGET; grader: { promptVersion: string; systemInstructionsSha256: string; model: 'gpt-luna'; acceptedModelAliases: ['gpt-luna', 'gpt-5.6-luna']; maxTokens: 4096; reasoningEffort: 'none' };
  slots: CalibrationPlanSlot[]; authorization: 'parent_execution_acknowledgement_required'; productionActivationQualified: false; qualityClaimEligible: false;
};
export type CalibrationCheckpointRecord = {
  sequence: number; previousSha256: string; planSha256: string; kind: 'intent' | 'slot_started' | 'slot_reserved' | 'slot_observed' | 'stopped' | 'finished';
  slotIndex?: number; runId?: string; requestSha256?: string; receiptId?: string; receiptSha256?: string; receiptStatus?: string; receipt?: ClaimSupportReceipt;
  dispatchedAt?: string; durationMs?: number; httpStatus?: number | null; transportCount?: 0 | 1;
  reason?: string;
  stopReasons?: string[];
  createdAt: string; sha256: string;
};
export type CalibrationBoundReceipt = ClaimSupportReceipt & { allowance_usd?: number; input_tokens?: number | null; output_tokens?: number | null; executionMode?: 'live' | 'synthetic'; accounting?: string };
export type CalibrationReceiptClassification = { status: 'accepted' | 'rejected' | 'uncertain' | 'invalid' | 'unknown'; assessment?: ValidatedClaimSupportAssessment; usage?: { inputTokens: number; outputTokens: number } | null; error?: string };
export type CalibrationReportSlot = CalibrationReceiptClassification | { status: 'unattempted'; assessment?: undefined; usage?: undefined; error?: undefined };
export type CalibrationRate = { numerator: number; denominator: number; value: number | null };
export type CalibrationAxisMetrics = { expectedGood: number; expectedBad: number; expectedGoodRejected: number; expectedBadPassed: number; uncertain: number; invalid: number; unknown: number; unattempted: number; acceptedBadOverExpectedBad: CalibrationRate; acceptedBadOverAllAccepted: CalibrationRate; allAccepted: number };
export type CalibrationReferenceAgreement = { disposition: boolean; support: boolean; coverage: boolean; uncertainty: boolean; answerability: boolean; correctness: boolean; all: boolean };
export type CalibrationOverallMetrics = CalibrationAxisMetrics & { expectedRawPass: number; expectedAppropriateAbstention: number; rawPass: number; rawRepair: number; rawAbstain: number; rawUncertain: number; appropriateAbstentions: number; referenceAgreements: number; referenceDisagreements: number };
export type CalibrationReport = {
  format: 'grader-calibration-report-v1'; planSha256: string; plan: CalibrationPlan; executionMode: 'live' | 'synthetic'; transportProvenance: 'live_router' | 'mocked_mechanics_only';
  evidenceMode: 'live_calibration_pilot' | 'mocked_transport_mechanics_only'; calibration: 'measured_on_constructed_pilot' | 'not_measured_mocked_transport'; referenceProvenance: CalibrationDataset['referenceProvenance'];
  complete: boolean; qualityClaimEligible: false; humanGold: false; productionActivationQualified: false;
  terminal: { kind: 'finished' | 'stopped' | 'interrupted' | 'not_started'; reason: string | null; stopReasons: string[] };
  slots: (CalibrationReportSlot & { index: number; caseId: string; familyId: string; runId: string; requestSha256: string; receipt: CalibrationBoundReceipt | null; receiptSha256: string | null; referenceAgreement: CalibrationReferenceAgreement | null })[];
  metrics: { overall: CalibrationOverallMetrics; support: CalibrationAxisMetrics; coverage: CalibrationAxisMetrics; uncertainty: CalibrationAxisMetrics; families: { familyId: string; name: string; caseCount: number; overall: CalibrationOverallMetrics }[] };
  checkpointProof: { planSha256: string; recordCount: number; tailSha256: string; records: CalibrationCheckpointRecord[] };
  accounting: { plannedCallCeiling: 10; attemptedSlots: number; reservedSlots: number; checkpointReservedSlots: number; observedSlots: number; validGrades: number; rawPasses: number; transportCount: number; transportCountKind: 'observed_checkpoints_only'; unknownTransportSlots: number; exactTransportCount: number | null; reservedPlanningAllowanceUsd: number | null; observedPlanningAllowanceUsd: number | null; maxPlanningExposureUsd: 9.800281;
    usage: { inputTokens: number | null; outputTokens: number | null; receiptsWithUsage: number }; latency: { observedElapsedMs: number; slots: { index: number; elapsedMs: number | null; transportDurationMs: number | null }[] }; label: 'local_planning_allowances_not_settled_charges' | 'mocked_mechanics_only' };
  limitations: string[]; reportSha256: string;
};
export type CalibrationPreparationOptions = { dataset?: CalibrationDataset; codeFileSha256: Record<string, string>; callerScope: CalibrationCallerScope; implementationCommit: string; createdAt?: string };
export type CalibrationVerificationOptions = Omit<CalibrationPreparationOptions, 'createdAt'>;
const equal = (left: unknown, right: unknown) => calibrationHash(left) === calibrationHash(right);
const digest = /^[a-f0-9]{64}$/;
function codeIdentity(raw: Record<string, string>) {
  const entries = Object.entries(raw);
  if (entries.length !== CALIBRATION_CODE_FILES.length || entries.some(([path, hash]) => !CALIBRATION_CODE_FILES.includes(path) || !digest.test(hash)) || CALIBRATION_CODE_FILES.some(path => !Object.hasOwn(raw, path))) throw new Error('Calibration requires the complete exact pilot code-file hash manifest.');
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}
function validateDataset(dataset: CalibrationDataset) {
  if (dataset.cases.length !== 10 || dataset.references.length !== 10 || dataset.families.length !== 5 || new Set(dataset.cases.map(item => item.id)).size !== 10 || new Set(dataset.references.map(item => item.caseId)).size !== 10 || new Set(dataset.families.map(item => item.id)).size !== 5 ||
    dataset.references.filter(item => item.answerQuality === 'good').length !== 5 || dataset.references.filter(item => item.answerQuality === 'flawed').length !== 5) throw new Error('Calibration pilot requires ten distinct cases, five paired families and balanced frozen references.');
  if (dataset.referenceProvenance.authorship !== 'ai_authored_constructed_reference' || dataset.referenceProvenance.reviewStatus !== 'pending_parent_source_review') throw new Error('Constructed references must retain pending human source-review provenance.');
  for (const family of dataset.families) {
    const cases = dataset.cases.filter(item => item.familyId === family.id), references = dataset.references.filter(item => item.familyId === family.id);
    if (cases.length !== 2 || references.length !== 2 || references.filter(item => item.answerQuality === 'good').length !== 1 || references.filter(item => item.answerQuality === 'flawed').length !== 1) throw new Error('Each calibration family requires exactly one good and one flawed answer.');
  }
  for (const item of dataset.cases) {
    const reference = dataset.references.find(entry => entry.caseId === item.id);
    if (!reference || reference.familyId !== item.familyId || !dataset.families.some(family => family.id === item.familyId) || !equal(reference.provenance, dataset.referenceProvenance) || !reference.rationale.trim()) throw new Error('Frozen references must bind every exact case and family.');
    for (const span of reference.spans) if (!item.input.evidence.some(source => source.id === span.sourceId && source.text.includes(span.quote))) throw new Error('Constructed reference spans must quote literal frozen source bodies.');
  }
}

/** Pure preparation. No file, credential, transport, ledger or network access. */
export function prepareCalibrationPlan(options: CalibrationPreparationOptions): CalibrationPlan {
  const dataset = structuredClone(options.dataset ?? calibrationFixtureDataset()); validateDataset(dataset);
  const hashes = codeIdentity(options.codeFileSha256), callerScope = options.callerScope;
  const pathKeys = ['repositoryPath', 'budgetPath', 'reviewPath', 'appDbPath', 'loopDbPath', 'workspaceDbPath', 'runtimePolicyDbPath', 'claimDirectory'], scopeKeys = [...pathKeys, 'configuredPort', 'initiatingThreadId', 'executionAuthority', 'ledgerInitialSha256'];
  if (!callerScope || Object.keys(callerScope).length !== scopeKeys.length || scopeKeys.some(key => typeof callerScope[key] !== 'string' || !callerScope[key].trim() || callerScope[key].length > 1000) || pathKeys.some(key => !isAbsolute(callerScope[key]) || normalize(callerScope[key]) !== callerScope[key]) || callerScope.executionAuthority !== 'parent_execution_only' || !digest.test(callerScope.ledgerInitialSha256) || !/^\d+$/.test(callerScope.configuredPort) || +callerScope.configuredPort < 1 || +callerScope.configuredPort > 65535 || !/^[a-f0-9]{40}$/.test(options.implementationCommit)) throw new Error('Calibration caller scope, canonical paths and exact implementation commit must be frozen.');
  const createdAt = options.createdAt ?? '2026-10-14T00:00:00.000Z';
  if (!Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) throw new Error('Calibration plan requires an exact ISO timestamp.');
  const seed = calibrationHash({ dataset, hashes, callerScope, createdAt, implementationCommit: options.implementationCommit, budget: CALIBRATION_BUDGET });
  const ordered = [...dataset.cases].sort((left, right) => calibrationHash([seed, left.id]).localeCompare(calibrationHash([seed, right.id])));
  const slots = ordered.map((item, index): CalibrationPlanSlot => {
    const reference = dataset.references.find(entry => entry.caseId === item.id)!, input: ClaimSupportInput = { runId: `grader-pilot-${calibrationHash([seed, item.id]).slice(0, 40)}`, ...structuredClone(item.input) };
    const parts = claimSupportRequestParts(input);
    return { index, caseId: item.id, familyId: item.familyId, input, reference, inputSha256: calibrationHash(input), referenceSha256: calibrationHash(reference), fullCaseSha256: calibrationHash({ case: item, reference }), ...parts.bindings, requestBody: parts.body };
  });
  const prompt = claimSupportPromptIdentity();
  const body: Omit<CalibrationPlan, 'planSha256'> = { format: 'grader-calibration-plan-v1', createdAt, callerScope, implementationCommit: options.implementationCommit, codeFileSha256: hashes, datasetFormat: dataset.format, datasetSha256: calibrationHash(dataset), referenceProvenance: dataset.referenceProvenance, families: dataset.families,
    budget: { ...CALIBRATION_BUDGET }, grader: { promptVersion: prompt.promptVersion, systemInstructionsSha256: prompt.systemInstructionsSha256, model: 'gpt-luna', acceptedModelAliases: ['gpt-luna', 'gpt-5.6-luna'], maxTokens: 4096, reasoningEffort: 'none' }, slots,
    authorization: 'parent_execution_acknowledgement_required', productionActivationQualified: false, qualityClaimEligible: false };
  return { ...body, planSha256: calibrationHash(body) };
}

/** Verify against current source fixtures and caller-supplied current code hashes,
 * not merely a self-consistent edited JSON document. */
export function verifyCalibrationPlan(plan: CalibrationPlan, options: CalibrationVerificationOptions): CalibrationPlan {
  const expected = prepareCalibrationPlan({ ...options, createdAt: plan.createdAt });
  if (!equal(plan, expected)) throw new Error('Frozen calibration plan differs from exact cases, references, order, caller, code, budget or grader identity.');
  return structuredClone(expected);
}

export function classifyCalibrationReceipt(slot: CalibrationPlanSlot, receipt: CalibrationBoundReceipt, mode: 'live' | 'synthetic'): CalibrationReceiptClassification {
  if (receipt.status !== 'completed') return { status: 'unknown', error: 'The recorded provider outcome is not completed; no semantic judgment is inferred.' };
  try {
    const replayed = replayClaimSupportReceipt(slot.input, receipt, mode), assessment = replayed.assessment;
    if (receipt.allowance_usd !== undefined && (receipt.allowance_usd !== (mode === 'live' ? 0.1 : 0) || !Number.isFinite(receipt.allowance_usd)) ||
      receipt.input_tokens !== undefined && receipt.input_tokens !== (replayed.usage?.inputTokens ?? null) || receipt.output_tokens !== undefined && receipt.output_tokens !== (replayed.usage?.outputTokens ?? null) || receipt.executionMode !== undefined && receipt.executionMode !== mode) throw new Error('receipt_row_metadata');
    return { status: assessment.disposition === 'uncertain' ? 'uncertain' : assessment.disposition === 'pass' ? 'accepted' : 'rejected', assessment, usage: replayed.usage };
  } catch { return { status: 'invalid', error: 'Completed receipt failed exact request, model, prompt, schema, source or grade replay.' }; }
}

/** Checks the complete chain, exact order and bound receipt snapshots. The caller
 * separately supplies read-only trusted ledger receipts for final verification. */
export function verifyCalibrationCheckpointRecords(plan: CalibrationPlan, records: CalibrationCheckpointRecord[]) {
  let previousSha256 = '0'.repeat(64), nextSlot = 0, active: number | null = null, reservedId: string | null = null, terminal = false;
  const started = new Set<number>(), observed = new Map<number, CalibrationCheckpointRecord>(), receiptIds = new Set<string>();
  for (const [index, record] of records.entries()) {
    const { sha256, ...body } = record;
    if (record.stopReasons !== undefined && (record.kind !== 'stopped' || !Array.isArray(record.stopReasons) || !record.stopReasons.length || record.stopReasons.length > 10 || new Set(record.stopReasons).size !== record.stopReasons.length || record.stopReasons.some(reason => typeof reason !== 'string' || !/^[a-z0-9_]{1,100}$/.test(reason)))) throw new Error('Calibration checkpoint stop reasons must be bounded terminal reason codes.');
    if (!['intent', 'slot_started', 'slot_reserved', 'slot_observed', 'stopped', 'finished'].includes(record.kind) || record.sequence !== index || record.planSha256 !== plan.planSha256 || record.previousSha256 !== previousSha256 || sha256 !== calibrationHash(body) || !Number.isFinite(Date.parse(record.createdAt)) || record.reason !== undefined && (typeof record.reason !== 'string' || !record.reason.trim() || record.reason.length > 600 || record.kind !== 'stopped') || record.durationMs !== undefined && (!Number.isFinite(record.durationMs) || record.durationMs < 0) || record.transportCount !== undefined && ![0, 1].includes(record.transportCount) || record.dispatchedAt !== undefined && !Number.isFinite(Date.parse(record.dispatchedAt)) || record.httpStatus !== undefined && record.httpStatus !== null && (!Number.isInteger(record.httpStatus) || record.httpStatus < 100 || record.httpStatus > 599) || terminal) throw new Error('Calibration checkpoint chain has an invalid hash, sequence, plan identity or terminal suffix.');
    if (index === 0 ? record.kind !== 'intent' : record.kind === 'intent') throw new Error('Calibration execution must have exactly one initial durable intent.');
    if (['intent', 'stopped', 'finished'].includes(record.kind) && ['slotIndex', 'runId', 'requestSha256', 'receiptId', 'receiptSha256', 'receiptStatus', 'receipt', 'transportCount', 'durationMs', 'dispatchedAt', 'httpStatus'].some(key => Object.hasOwn(record, key))) throw new Error('Calibration checkpoint terminal and intent records cannot masquerade as slot operations.');
    if (record.kind === 'slot_started' || record.kind === 'slot_reserved' || record.kind === 'slot_observed') {
      const slot = record.slotIndex === undefined ? undefined : plan.slots[record.slotIndex];
      if (!slot || record.runId !== slot.input.runId || record.requestSha256 !== slot.requestSha256) throw new Error('Calibration checkpoint operation differs from its exact frozen slot.');
      if (record.kind === 'slot_started') {
        if (record.slotIndex !== nextSlot || active !== null || started.has(record.slotIndex!)) throw new Error('Calibration checkpoint attempted a duplicate or out-of-order dispatch.');
        active = record.slotIndex!; reservedId = null; started.add(active);
      } else if (record.kind === 'slot_reserved') {
        if (active !== record.slotIndex || reservedId || !record.receiptId?.trim()) throw new Error('Calibration reservation must bind its sole started slot exactly once.');
        reservedId = record.receiptId;
      } else {
        if (active !== record.slotIndex || observed.has(record.slotIndex!) || !record.receipt || !reservedId || record.receiptId !== record.receipt.id || reservedId !== record.receipt.id || record.receiptStatus !== record.receipt.status || record.receiptSha256 !== calibrationHash(record.receipt)) throw new Error('Calibration observation does not match its sole started and reserved operation and exact receipt.');
        if (receiptIds.has(record.receipt.id)) throw new Error('Calibration observations must bind independent unique receipt identities.'); receiptIds.add(record.receipt.id);
        observed.set(record.slotIndex!, record); active = null; reservedId = null; nextSlot++;
      }
    } else if (record.kind === 'finished') {
      if (active !== null || nextSlot !== 10 || observed.size !== 10) throw new Error('Calibration cannot finish before all ten observations.'); terminal = true;
    } else if (record.kind === 'stopped') terminal = true;
    previousSha256 = sha256;
  }
  return { started, observed, tailSha256: previousSha256 };
}

const rate = (numerator: number, denominator: number): CalibrationRate => ({ numerator, denominator, value: denominator ? numerator / denominator : null });
type Axis = 'overall' | 'support' | 'coverage' | 'uncertainty';
function axisExpected(reference: CalibrationReference, axis: Axis) { return axis === 'overall' ? reference.answerQuality === 'good' : axis === 'support' ? ['supported', 'non_factual'].includes(reference.support) : axis === 'coverage' ? reference.questionCoverage === 'complete' : reference.uncertaintyHandling === 'appropriate'; }
function axisObserved(slot: CalibrationReport['slots'][number], axis: Axis): 'good' | 'bad' | 'uncertain' | 'invalid' | 'unknown' | 'unattempted' {
  if (['invalid', 'unknown', 'unattempted'].includes(slot.status)) return slot.status as 'invalid' | 'unknown' | 'unattempted';
  const grade = slot.assessment!;
  if (axis === 'overall') return grade.disposition === 'uncertain' ? 'uncertain' : grade.disposition === 'pass' ? 'good' : 'bad';
  if (axis === 'coverage') return grade.questionCoverage === 'uncertain' ? 'uncertain' : grade.questionCoverage === 'complete' ? 'good' : 'bad';
  if (axis === 'uncertainty') return grade.uncertaintyHandling === 'uncertain' ? 'uncertain' : grade.uncertaintyHandling === 'appropriate' ? 'good' : 'bad';
  return grade.units.some(unit => unit.verdict === 'uncertain') ? 'uncertain' : grade.units.every(unit => ['supported', 'non_factual'].includes(unit.verdict)) ? 'good' : 'bad';
}
function axisMetrics(plan: CalibrationPlan, slots: CalibrationReport['slots'], axis: Axis): CalibrationAxisMetrics {
  let expectedGood = 0, expectedBad = 0, expectedGoodRejected = 0, expectedBadPassed = 0, uncertain = 0, invalid = 0, unknown = 0, unattempted = 0, allAccepted = 0;
  for (const slot of slots) {
    const good = axisExpected(plan.slots[slot.index].reference, axis), outcome = axisObserved(slot, axis);
    if (good) expectedGood++; else expectedBad++;
    if (axis === 'overall' && ['accepted', 'rejected', 'uncertain'].includes(slot.status)) {
      if (slot.status === 'accepted') { allAccepted++; if (!good) expectedBadPassed++; }
      if (slot.status === 'uncertain') uncertain++;
      else if (good && !slot.referenceAgreement?.all) expectedGoodRejected++;
    } else if (outcome === 'good') { allAccepted++; if (!good) expectedBadPassed++; }
    else if (outcome === 'bad') { if (good) expectedGoodRejected++; }
    else if (outcome === 'uncertain') uncertain++;
    else if (outcome === 'invalid') invalid++;
    else if (outcome === 'unknown') unknown++;
    else unattempted++;
  }
  return { expectedGood, expectedBad, expectedGoodRejected, expectedBadPassed, uncertain, invalid, unknown, unattempted, allAccepted, acceptedBadOverExpectedBad: rate(expectedBadPassed, expectedBad), acceptedBadOverAllAccepted: rate(expectedBadPassed, allAccepted) };
}
function referenceAgreement(reference: CalibrationReference, assessment: ValidatedClaimSupportAssessment): CalibrationReferenceAgreement {
  const axes = reference.acceptableAxes, result = { disposition: reference.acceptableDispositions.includes(assessment.disposition), support: assessment.units.every(unit => axes.support.includes(unit.verdict)), coverage: axes.questionCoverage.includes(assessment.questionCoverage), uncertainty: axes.uncertaintyHandling.includes(assessment.uncertaintyHandling), answerability: axes.answerability.includes(assessment.answerability), correctness: axes.correctness.includes(assessment.correctness) };
  return { ...result, all: Object.values(result).every(Boolean) };
}
function overallMetrics(plan: CalibrationPlan, slots: CalibrationReport['slots']): CalibrationOverallMetrics {
  const references = slots.map(slot => plan.slots[slot.index].reference);
  return { ...axisMetrics(plan, slots, 'overall'), expectedRawPass: references.filter(reference => reference.answerQuality === 'good' && reference.acceptableDispositions.includes('pass')).length,
    expectedAppropriateAbstention: references.filter(reference => reference.answerQuality === 'good' && reference.acceptableDispositions.includes('abstain')).length,
    rawPass: slots.filter(slot => slot.assessment?.disposition === 'pass').length, rawRepair: slots.filter(slot => slot.assessment?.disposition === 'repair').length, rawAbstain: slots.filter(slot => slot.assessment?.disposition === 'abstain').length, rawUncertain: slots.filter(slot => slot.assessment?.disposition === 'uncertain').length,
    appropriateAbstentions: slots.filter(slot => plan.slots[slot.index].reference.answerQuality === 'good' && slot.assessment?.disposition === 'abstain' && slot.referenceAgreement?.all).length,
    referenceAgreements: slots.filter(slot => slot.referenceAgreement?.all).length, referenceDisagreements: slots.filter(slot => slot.referenceAgreement && !slot.referenceAgreement.all).length };
}
export type CalibrationReportOptions = { executionMode: 'live' | 'synthetic'; transportProvenance: 'live_router' | 'mocked_mechanics_only'; receiptsByRunId: Record<string, CalibrationBoundReceipt | null | undefined>; checkpointRecords?: CalibrationCheckpointRecord[] };
export function deriveCalibrationReport(plan: CalibrationPlan, options: CalibrationReportOptions): CalibrationReport {
  // A self-hash is still checked here; execute/verify must additionally compare
  // current code and source identity through verifyCalibrationPlan.
  const { planSha256, ...planBody } = plan;
  if (planSha256 !== calibrationHash(planBody) || plan.slots.length !== 10) throw new Error('Calibration report requires its exact frozen ten-slot plan.');
  if (options.executionMode === 'synthetic' && options.transportProvenance === 'live_router') throw new Error('Synthetic receipts cannot establish live Router calibration evidence.');
  const records = structuredClone(options.checkpointRecords ?? []), proof = verifyCalibrationCheckpointRecords(plan, records);
  const slots: CalibrationReport['slots'] = plan.slots.map(slot => {
    const receipt = options.receiptsByRunId[slot.input.runId] ?? null, observation = proof.observed.get(slot.index);
    const reservation = records.find(record => record.kind === 'slot_reserved' && record.slotIndex === slot.index);
    if (reservation && (!receipt || reservation.receiptId !== receipt.id)) throw new Error('Checkpoint reservation differs from its read-only trusted ledger receipt.');
    if (observation && (!receipt || !equal(receipt, observation.receipt))) throw new Error('Checkpoint receipt differs from the read-only trusted ledger receipt.');
    if (!proof.started.has(slot.index) && receipt) throw new Error('A ledger receipt exists without the frozen checkpoint dispatch intent.');
    let result: CalibrationReportSlot;
    if (!proof.started.has(slot.index)) result = { status: 'unattempted' };
    else if (!observation || !receipt) result = { status: 'unknown', error: 'Started slot has no complete durable observation; it cannot be retried or counted as accepted.' };
    else result = classifyCalibrationReceipt(slot, receipt, options.executionMode);
    return { index: slot.index, caseId: slot.caseId, familyId: slot.familyId, runId: slot.input.runId, requestSha256: slot.requestSha256, receipt: receipt ? structuredClone(receipt) : null, receiptSha256: receipt ? calibrationHash(receipt) : null, referenceAgreement: result.assessment ? referenceAgreement(slot.reference, result.assessment) : null, ...result };
  });
  const failure = slots.find(slot => ['invalid', 'unknown'].includes(slot.status));
  if (failure && [...proof.started].some(index => index > failure.index)) throw new Error('Calibration checkpoint dispatch continued after an invalid or unknown outcome.');
  const last = records.at(-1), terminalKind = last?.kind === 'finished' ? 'finished' : last?.kind === 'stopped' ? 'stopped' : records.length ? 'interrupted' : 'not_started';
  if (terminalKind === 'finished' && failure) throw new Error('Calibration cannot declare a finished terminal checkpoint with invalid or unknown outcomes.');
  const latencySlots = plan.slots.map(slot => { const start = records.find(record => record.kind === 'slot_started' && record.slotIndex === slot.index), observed = proof.observed.get(slot.index); return { index: slot.index, elapsedMs: start && observed ? Math.max(0, Date.parse(observed.createdAt) - Date.parse(start.createdAt)) : null, transportDurationMs: observed?.durationMs ?? null }; });
  const usageSlots = slots.filter(slot => slot.usage), reservedSlots = slots.filter(slot => slot.receipt).length;
  const checkpointReservedSlots = records.filter(record => record.kind === 'slot_reserved').length;
  const observedTransportCount = records.reduce((total, record) => total + (record.kind === 'slot_observed' ? record.transportCount ?? 0 : 0), 0);
  const unknownTransportSlots = [...proof.started].filter(index => proof.observed.get(index)?.transportCount === undefined).length;
  const body: Omit<CalibrationReport, 'reportSha256'> = { format: 'grader-calibration-report-v1', planSha256, plan: structuredClone(plan), executionMode: options.executionMode, transportProvenance: options.transportProvenance,
    evidenceMode: options.transportProvenance === 'live_router' ? 'live_calibration_pilot' : 'mocked_transport_mechanics_only', calibration: options.transportProvenance === 'live_router' ? 'measured_on_constructed_pilot' : 'not_measured_mocked_transport', referenceProvenance: structuredClone(plan.referenceProvenance),
    complete: terminalKind === 'finished' && slots.every(slot => ['accepted', 'rejected', 'uncertain'].includes(slot.status)), qualityClaimEligible: false, humanGold: false, productionActivationQualified: false,
    terminal: { kind: terminalKind, reason: terminalKind === 'stopped' ? last?.reason ?? 'Execution stopped before its final boundary was confirmed.' : terminalKind === 'interrupted' ? 'No durable terminal checkpoint confirms execution completion.' : terminalKind === 'not_started' ? 'No execution intent has been recorded.' : null, stopReasons: terminalKind === 'stopped' ? structuredClone(last?.stopReasons ?? []) : [] }, slots,
    metrics: { overall: overallMetrics(plan, slots), support: axisMetrics(plan, slots, 'support'), coverage: axisMetrics(plan, slots, 'coverage'), uncertainty: axisMetrics(plan, slots, 'uncertainty'), families: plan.families.map(family => ({ familyId: family.id, name: family.name, caseCount: slots.filter(slot => slot.familyId === family.id).length, overall: overallMetrics(plan, slots.filter(slot => slot.familyId === family.id)) })) },
    checkpointProof: { planSha256, recordCount: records.length, tailSha256: proof.tailSha256, records },
    accounting: { plannedCallCeiling: 10, attemptedSlots: proof.started.size, reservedSlots, checkpointReservedSlots, observedSlots: proof.observed.size, validGrades: slots.filter(slot => !!slot.assessment).length, rawPasses: slots.filter(slot => slot.assessment?.disposition === 'pass').length,
      transportCount: observedTransportCount, transportCountKind: 'observed_checkpoints_only', unknownTransportSlots, exactTransportCount: unknownTransportSlots ? null : observedTransportCount, reservedPlanningAllowanceUsd: options.executionMode === 'live' ? Number((reservedSlots * 0.1).toFixed(6)) : null,
      observedPlanningAllowanceUsd: options.executionMode === 'live' ? Number(slots.reduce((total, slot) => total + (slot.receipt?.allowance_usd ?? 0), 0).toFixed(6)) : null, maxPlanningExposureUsd: 9.800281,
      usage: { inputTokens: usageSlots.length ? usageSlots.reduce((total, slot) => total + slot.usage!.inputTokens, 0) : null, outputTokens: usageSlots.length ? usageSlots.reduce((total, slot) => total + slot.usage!.outputTokens, 0) : null, receiptsWithUsage: usageSlots.length },
      latency: { observedElapsedMs: latencySlots.reduce((total, slot) => total + (slot.elapsedMs ?? 0), 0), slots: latencySlots }, label: options.transportProvenance === 'mocked_mechanics_only' ? 'mocked_mechanics_only' : 'local_planning_allowances_not_settled_charges' },
    limitations: ['Ten constructed cases across five correlated pairs are descriptive only; no confidence interval or generalization claim is established.', 'Reference labels were AI-authored and await parent source review; they are not human gold judgments.', 'Expected-bad denominator includes all frozen expected-bad cases; unknown, invalid and unattempted slots remain explicit, and partial reports must be read with these counts.', 'Individual assessments retain calibration=not_measured. This pilot does not qualify policy activation, final benchmarks, or a model-quality gain.', options.transportProvenance === 'mocked_mechanics_only' ? 'Mocked transport mechanics only; this report is not a measured live-model calibration result.' : 'Live Router grader pilot on constructed fictional cases only; not production calibration.'] };
  return { ...body, reportSha256: calibrationHash(body) };
}

export function verifyCalibrationReport(report: CalibrationReport, options: CalibrationVerificationOptions & CalibrationReportOptions): CalibrationReport {
  const plan = verifyCalibrationPlan(report.plan, options);
  const expected = deriveCalibrationReport(plan, options);
  if (!equal(report, expected)) throw new Error('Calibration report differs from frozen references, trusted ledger receipts, checkpoint chain or recomputed metrics.');
  return expected;
}
