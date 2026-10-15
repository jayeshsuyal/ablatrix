import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimSupportRequestParts, type ClaimSupportWireOutput } from './claim-support.ts';
import { calibrationFixtureDataset } from './grader-calibration-fixtures.ts';
import { CALIBRATION_CODE_FILES, CALIBRATION_BUDGET, calibrationHash, prepareCalibrationPlan, verifyCalibrationPlan, classifyCalibrationReceipt, deriveCalibrationReport, verifyCalibrationReport, verifyCalibrationCheckpointRecords,
  type CalibrationPreparationOptions, type CalibrationPlan, type CalibrationPlanSlot, type CalibrationCheckpointRecord, type CalibrationBoundReceipt } from './grader-calibration.ts';

function options(): CalibrationPreparationOptions {
  return { codeFileSha256: Object.fromEntries(CALIBRATION_CODE_FILES.map(path => [path, calibrationHash(path)])), implementationCommit: 'c'.repeat(40),
    callerScope: { repositoryPath: '/fictional/repository', budgetPath: '/fictional/data/budget.sqlite', reviewPath: '/fictional/data/reviews.sqlite', appDbPath: '/fictional/data/app.sqlite', loopDbPath: '/fictional/data/loop.sqlite', workspaceDbPath: '/fictional/data/workspace.sqlite', runtimePolicyDbPath: '/fictional/data/policy.sqlite', claimDirectory: '/fictional/claims', configuredPort: '4194', initiatingThreadId: 'fictional-parent-thread', executionAuthority: 'parent_execution_only', ledgerInitialSha256: calibrationHash('fictional initial ledger') } };
}
function wire(slot: CalibrationPlanSlot): ClaimSupportWireOutput {
  const reference = slot.reference, parts = claimSupportRequestParts(slot.input), proof = reference.support === 'supported' ? slot.input.answer.citations.map(citation => ({ sourceId: citation.passageId, quote: citation.quote, relation: 'supports' as const })) : reference.support === 'contradicted' ? reference.spans.filter(span => span.role === 'conflict').map(span => ({ sourceId: span.sourceId, quote: span.quote, relation: 'contradicts' as const })) : [];
  return { units: parts.units.map(unit => ({ unitId: unit.id, verdict: reference.support, evidence: proof, reason: 'Constructed test receipt; not a model judgment.' })), questionCoverage: reference.questionCoverage, answerability: reference.acceptableAxes.answerability[0], correctness: reference.acceptableAxes.correctness[0], uncertaintyHandling: reference.uncertaintyHandling, reason: 'Constructed test receipt; no measured quality claim.' };
}
function receipt(slot: CalibrationPlanSlot, output = wire(slot)): CalibrationBoundReceipt {
  const parts = claimSupportRequestParts(slot.input);
  return { id: `fictional-receipt-${slot.index}`, kind: 'claim_support_v1', status: 'completed', error_code: null, model: 'gpt-luna', allowance_usd: .1, input_tokens: 10, output_tokens: 5,
    receipt_json: JSON.stringify({ output, ...parts.bindings, promptVersion: parts.prompt.promptVersion, assessmentKind: 'ai_claim_support_estimate', model: 'gpt-luna', usage: { inputTokens: 10, outputTokens: 5 } }) };
}
function checkpoints(plan: CalibrationPlan, receipts: Record<string, CalibrationBoundReceipt | undefined>, count = 10, unfinished = false) {
  const records: CalibrationCheckpointRecord[] = [];
  function append(body: Omit<CalibrationCheckpointRecord, 'sequence' | 'previousSha256' | 'planSha256' | 'createdAt' | 'sha256'>) {
    const payload = { ...body, sequence: records.length, previousSha256: records.at(-1)?.sha256 ?? '0'.repeat(64), planSha256: plan.planSha256, createdAt: new Date(Date.UTC(2026, 9, 14, 0, 0, 0, records.length * 100)).toISOString() };
    records.push({ ...payload, sha256: calibrationHash(payload) });
  }
  append({ kind: 'intent' });
  for (const slot of plan.slots.slice(0, count)) {
    append({ kind: 'slot_started', slotIndex: slot.index, runId: slot.input.runId, requestSha256: slot.requestSha256 });
    const result = receipts[slot.input.runId];
    if (!result) break;
    append({ kind: 'slot_reserved', slotIndex: slot.index, runId: slot.input.runId, requestSha256: slot.requestSha256, receiptId: result.id });
    append({ kind: 'slot_observed', slotIndex: slot.index, runId: slot.input.runId, requestSha256: slot.requestSha256, receiptId: result.id, receiptStatus: result.status, receipt: result, receiptSha256: calibrationHash(result), transportCount: 1, durationMs: 25 });
  }
  append({ kind: unfinished ? 'stopped' : 'finished' }); return records;
}
function complete() {
  const settings = options(), plan = prepareCalibrationPlan(settings), receiptsByRunId = Object.fromEntries(plan.slots.map(slot => [slot.input.runId, receipt(slot)])), checkpointRecords = checkpoints(plan, receiptsByRunId);
  const reportOptions = { executionMode: 'live' as const, transportProvenance: 'mocked_mechanics_only' as const, receiptsByRunId, checkpointRecords };
  return { settings, plan, receiptsByRunId, checkpointRecords, reportOptions };
}
function rehashPlan(plan: CalibrationPlan) { const { planSha256: _old, ...body } = plan; plan.planSha256 = calibrationHash(body); }

test('pure plan freezes ten opaque shuffled cases, separate references, exact wire identities and finite budget', () => {
  const settings = options(), first = prepareCalibrationPlan(settings), second = prepareCalibrationPlan(settings);
  assert.deepEqual(first, second); assert.deepEqual(verifyCalibrationPlan(first, settings), first);
  assert.equal(first.slots.length, 10); assert.equal(new Set(first.slots.map(slot => slot.input.runId)).size, 10);
  assert.equal(first.slots.filter(slot => slot.reference.answerQuality === 'good').length, 5); assert.equal(first.slots.filter(slot => slot.reference.answerQuality === 'flawed').length, 5);
  assert.notDeepEqual(first.slots.map(slot => slot.caseId), calibrationFixtureDataset().cases.map(item => item.id));
  assert.deepEqual(first.budget, CALIBRATION_BUDGET); assert.equal(first.budget.startingAttempts + first.budget.newCalls, 96); assert.equal(first.budget.maxPlanningExposureUsd, 9.800281);
  for (const slot of first.slots) {
    const body = JSON.stringify(slot.requestBody), parts = claimSupportRequestParts(slot.input);
    assert.equal(slot.requestSha256, parts.bindings.requestSha256); assert.deepEqual(slot.requestBody, parts.body);
    assert.ok(!body.includes('answerQuality')); assert.ok(!body.includes('acceptableDispositions')); assert.ok(!body.includes(slot.familyId)); assert.ok(!body.includes('pending_parent_source_review'));
    assert.equal(slot.referenceSha256, calibrationHash(slot.reference)); assert.equal(slot.inputSha256, calibrationHash(slot.input));
  }
});

test('verification rejects rehashed changes, label edits, case deletion/swaps, run IDs, caller scope and code drift', () => {
  const settings = options(), plan = prepareCalibrationPlan(settings);
  const mutations: ((copy: CalibrationPlan) => void)[] = [copy => { copy.slots[0].reference.answerQuality = copy.slots[0].reference.answerQuality === 'good' ? 'flawed' : 'good'; }, copy => { copy.slots.splice(0, 1); }, copy => { [copy.slots[0], copy.slots[1]] = [copy.slots[1], copy.slots[0]]; }, copy => { copy.slots[0].input.runId = 'different-opaque-id'; }, copy => { copy.slots[0].input.evidence[0].text += ' Different source.'; }, copy => { copy.slots[0].requestBody.model = 'other-model'; }, copy => { (copy.budget as { absoluteCallLimit: number }).absoluteCallLimit = 97; }, copy => { copy.callerScope = { ...copy.callerScope, budgetPath: '/different/budget.sqlite' }; }, copy => { copy.codeFileSha256[CALIBRATION_CODE_FILES[0]] = 'a'.repeat(64); }, copy => { copy.implementationCommit = 'b'.repeat(40); }, copy => { delete (copy as Partial<CalibrationPlan>).referenceProvenance; }];
  for (const mutate of mutations) { const copy = structuredClone(plan); mutate(copy); rehashPlan(copy); assert.throws(() => verifyCalibrationPlan(copy, settings), /Frozen calibration plan/); }
  assert.throws(() => verifyCalibrationPlan(plan, { ...settings, codeFileSha256: { ...settings.codeFileSha256, [CALIBRATION_CODE_FILES[0]]: 'd'.repeat(64) } }), /Frozen calibration plan/);
  assert.throws(() => prepareCalibrationPlan({ ...settings, callerScope: { ...settings.callerScope, executionAuthority: 'self_approval' } }), /scope/);
  assert.throws(() => prepareCalibrationPlan({ ...settings, codeFileSha256: {} }), /manifest/);
});

test('reference-matching fabricated receipts preserve four raw passes and one good abstention without false rejection', () => {
  const h = complete(), report = deriveCalibrationReport(h.plan, h.reportOptions), overall = report.metrics.overall;
  assert.equal(report.complete, true); assert.equal(report.calibration, 'not_measured_mocked_transport'); assert.equal(report.evidenceMode, 'mocked_transport_mechanics_only'); assert.equal(report.humanGold, false); assert.equal(report.qualityClaimEligible, false);
  assert.equal(overall.expectedGood, 5); assert.equal(overall.expectedBad, 5); assert.equal(overall.expectedRawPass, 4); assert.equal(overall.expectedAppropriateAbstention, 1);
  assert.equal(overall.rawPass, 4); assert.equal(overall.appropriateAbstentions, 1); assert.equal(overall.expectedGoodRejected, 0); assert.equal(overall.expectedBadPassed, 0); assert.equal(overall.referenceAgreements, 10);
  assert.deepEqual(overall.acceptedBadOverExpectedBad, { numerator: 0, denominator: 5, value: 0 }); assert.deepEqual(overall.acceptedBadOverAllAccepted, { numerator: 0, denominator: 4, value: 0 });
  assert.equal(report.metrics.families.length, 5); assert(report.metrics.families.every(family => family.caseCount === 2));
  assert.equal(report.accounting.attemptedSlots, 10); assert.equal(report.accounting.reservedSlots, 10); assert.equal(report.accounting.transportCount, 10); assert.equal(report.accounting.observedPlanningAllowanceUsd, 1); assert.equal(report.accounting.usage.inputTokens, 100); assert.equal(report.accounting.usage.outputTokens, 50);
  assert.equal(report.accounting.latency.observedElapsedMs, 2000); assert(report.slots.every(slot => slot.assessment?.calibration === 'not_measured'));
  assert.deepEqual(verifyCalibrationReport(report, { ...h.settings, ...h.reportOptions }), report);
});

test('a semantically wrong but contract-valid pass stays a valid receipt and exposes both false-approval denominators', () => {
  const h = complete(), flawed = h.plan.slots.find(slot => slot.reference.answerQuality === 'flawed' && slot.input.answer.citations.length)!;
  const badPass = wire(flawed); badPass.units = badPass.units.map(unit => ({ ...unit, verdict: 'supported', evidence: flawed.input.answer.citations.map(citation => ({ sourceId: citation.passageId, quote: citation.quote, relation: 'supports' })) })); badPass.questionCoverage = 'complete'; badPass.answerability = 'answerable'; badPass.correctness = 'consistent_with_sources'; badPass.uncertaintyHandling = 'appropriate';
  h.receiptsByRunId[flawed.input.runId] = receipt(flawed, badPass);
  const good = h.plan.slots.find(slot => slot.reference.answerQuality === 'good' && slot.input.answer.status === 'answered')!, rejectedGood = wire(good); rejectedGood.units = rejectedGood.units.map(unit => ({ ...unit, verdict: 'unsupported', evidence: [] })); rejectedGood.uncertaintyHandling = 'overconfident';
  h.receiptsByRunId[good.input.runId] = receipt(good, rejectedGood); h.reportOptions.checkpointRecords = checkpoints(h.plan, h.receiptsByRunId);
  const report = deriveCalibrationReport(h.plan, h.reportOptions);
  assert.equal(report.slots[flawed.index].status, 'accepted'); assert.equal(report.metrics.overall.expectedBadPassed, 1); assert.equal(report.metrics.overall.expectedGoodRejected, 1); assert.equal(report.metrics.overall.invalid, 0); assert.equal(report.metrics.overall.allAccepted, 4);
  assert.deepEqual(report.metrics.overall.acceptedBadOverExpectedBad, { numerator: 1, denominator: 5, value: .2 }); assert.deepEqual(report.metrics.overall.acceptedBadOverAllAccepted, { numerator: 1, denominator: 4, value: .25 });
});

test('uncertain permissible source correctness remains explicit uncertainty and never a pass', () => {
  const h = complete(), flawed = h.plan.slots.find(slot => slot.reference.answerQuality === 'flawed' && slot.reference.acceptableAxes.correctness.includes('uncertain'))!, output = wire(flawed);
  output.correctness = 'uncertain'; h.receiptsByRunId[flawed.input.runId] = receipt(flawed, output); h.reportOptions.checkpointRecords = checkpoints(h.plan, h.receiptsByRunId);
  const report = deriveCalibrationReport(h.plan, h.reportOptions), slot = report.slots[flawed.index];
  assert.equal(slot.status, 'uncertain'); assert.equal(slot.referenceAgreement?.all, true); assert.equal(report.metrics.overall.uncertain, 1); assert.equal(report.metrics.overall.expectedBadPassed, 0); assert.equal(report.metrics.overall.rawPass, 4);
  assert.equal(slot.referenceAgreement?.support, true); assert.equal(slot.referenceAgreement?.correctness, true); assert.equal(report.metrics.support.uncertain, 0); assert.equal(report.metrics.support.expectedBadPassed, 0);
});

test('exact ten slots retain invalid, unknown, and unattempted outcomes in partial reports', () => {
  const h = complete(), first = h.plan.slots[0], second = h.plan.slots[1];
  const broken = structuredClone(h.receiptsByRunId[first.input.runId]); broken.receipt_json = JSON.stringify({ ...JSON.parse(broken.receipt_json!), requestSha256: '0'.repeat(64) });
  const receipts = { [first.input.runId]: broken }, records = checkpoints(h.plan, receipts, 1, true);
  const report = deriveCalibrationReport(h.plan, { ...h.reportOptions, receiptsByRunId: receipts, checkpointRecords: records });
  assert.equal(report.complete, false); assert.equal(report.slots.length, 10); assert.equal(report.slots[0].status, 'invalid'); assert.equal(report.slots[1].status, 'unattempted'); assert.equal(report.slots[1].receipt, null); assert.equal(report.metrics.overall.unattempted, 9); assert.equal(report.metrics.overall.invalid, 1); assert.equal(report.metrics.overall.unknown, 0);
  assert.equal(report.slots[second.index].assessment, undefined);
  const knownFirst = { [first.input.runId]: h.receiptsByRunId[first.input.runId] }, unknownRecords = checkpoints(h.plan, knownFirst, 2, true), unknown = deriveCalibrationReport(h.plan, { ...h.reportOptions, receiptsByRunId: knownFirst, checkpointRecords: unknownRecords });
  assert.equal(unknown.slots[1].status, 'unknown'); assert.equal(unknown.metrics.overall.unknown, 1); assert.equal(unknown.metrics.overall.unattempted, 8);
  const empty = deriveCalibrationReport(h.plan, { ...h.reportOptions, receiptsByRunId: {}, checkpointRecords: [] }); assert.equal(empty.metrics.overall.unattempted, 10); assert.equal(empty.complete, false);
  assert.throws(() => deriveCalibrationReport(h.plan, { ...h.reportOptions, receiptsByRunId: receipts, checkpointRecords: checkpoints(h.plan, receipts, 2, true) }), /continued after/);
});

test('strict report verification rejects edited summaries, receipts, assessments and checkpoint chain proof', () => {
  const h = complete(), report = deriveCalibrationReport(h.plan, h.reportOptions);
  for (const mutate of [copy => { copy.metrics.overall.expectedBadPassed++; }, copy => { copy.slots[0].status = 'unknown'; }, copy => { copy.slots[0].receipt!.id += '-changed'; }, copy => { copy.slots[0].assessment!.questionCoverage = 'uncertain'; }, copy => { copy.checkpointProof.recordCount--; }, copy => { copy.checkpointProof.records[1].runId = 'changed-run'; }, copy => { copy.slots.splice(0, 1); }] as ((copy: typeof report) => void)[]) {
    const copy = structuredClone(report); mutate(copy); const { reportSha256: _old, ...body } = copy; copy.reportSha256 = calibrationHash(body); assert.throws(() => verifyCalibrationReport(copy, { ...h.settings, ...h.reportOptions }), /report differs/);
  }
  const alteredLedger = structuredClone(h.receiptsByRunId); alteredLedger[h.plan.slots[0].input.runId].id += '-other';
  assert.throws(() => verifyCalibrationReport(report, { ...h.settings, ...h.reportOptions, receiptsByRunId: alteredLedger }), /trusted ledger/);
  const chain = structuredClone(h.checkpointRecords); chain[3].receiptId = 'mismatched'; assert.throws(() => verifyCalibrationCheckpointRecords(h.plan, chain), /chain/);
});

test('receipt scope, invalid usage, uncertain provider outcome and cross-mode replay fail closed', () => {
  const h = complete(), slot = h.plan.slots[0], good = h.receiptsByRunId[slot.input.runId];
  assert.equal(classifyCalibrationReceipt(slot, { ...good, status: 'interrupted' }, 'live').status, 'unknown');
  assert.equal(classifyCalibrationReceipt(slot, { ...good, input_tokens: 999 }, 'live').status, 'invalid');
  assert.equal(classifyCalibrationReceipt(slot, { ...good, allowance_usd: .2 }, 'live').status, 'invalid');
  assert.equal(classifyCalibrationReceipt(slot, good, 'synthetic').status, 'invalid');
  const changed = structuredClone(good); const document = JSON.parse(changed.receipt_json!); document.usage.inputTokens = -1; changed.receipt_json = JSON.stringify(document);
  assert.equal(classifyCalibrationReceipt(slot, changed, 'live').status, 'invalid');
  assert.throws(() => deriveCalibrationReport(h.plan, { ...h.reportOptions, executionMode: 'synthetic', transportProvenance: 'live_router' }), /Synthetic/);
});

test('ten valid observations remain incomplete without a confirmed finished terminal boundary', () => {
  const h = complete(), stoppedRecords = checkpoints(h.plan, h.receiptsByRunId, 10, true), stopped = deriveCalibrationReport(h.plan, { ...h.reportOptions, checkpointRecords: stoppedRecords });
  assert.equal(stopped.complete, false); assert.equal(stopped.terminal.kind, 'stopped'); assert.match(stopped.terminal.reason!, /final boundary/); assert.equal(stopped.accounting.validGrades, 10); assert.equal(stopped.slots.length, 10);
  const interrupted = deriveCalibrationReport(h.plan, { ...h.reportOptions, checkpointRecords: h.checkpointRecords.slice(0, -1) });
  assert.equal(interrupted.complete, false); assert.equal(interrupted.terminal.kind, 'interrupted'); assert.equal(interrupted.accounting.validGrades, 10);
});

test('fully rehashed checkpoint chains cannot omit required reservation records', () => {
  const h = complete(), missingReservations = h.checkpointRecords.filter(record => record.kind !== 'slot_reserved');
  let previousSha256 = '0'.repeat(64);
  const rechained = missingReservations.map((record, sequence) => { const { sha256: _old, ...body } = record; const payload = { ...body, sequence, previousSha256 }, next = { ...payload, sha256: calibrationHash(payload) }; previousSha256 = next.sha256; return next; });
  assert.throws(() => verifyCalibrationCheckpointRecords(h.plan, rechained), /reserved operation/);
  assert.throws(() => deriveCalibrationReport(h.plan, { ...h.reportOptions, checkpointRecords: rechained }), /reserved operation/);
});

test('interruption after reservation leaves actual transport count unknown despite a completed ledger receipt', () => {
  const h = complete(), records = h.checkpointRecords.slice(0, -2), report = deriveCalibrationReport(h.plan, { ...h.reportOptions, checkpointRecords: records });
  assert.equal(records.at(-1)?.kind, 'slot_reserved'); assert.equal(report.complete, false); assert.equal(report.slots[9].status, 'unknown'); assert.equal(report.slots[9].receipt?.status, 'completed');
  assert.equal(report.accounting.transportCountKind, 'observed_checkpoints_only'); assert.equal(report.accounting.transportCount, 9); assert.equal(report.accounting.unknownTransportSlots, 1); assert.equal(report.accounting.exactTransportCount, null);
  assert.equal(report.accounting.reservedSlots, 10); assert.equal(report.accounting.reservedPlanningAllowanceUsd, 1); assert.equal(report.accounting.validGrades, 9);
  const completeReport = deriveCalibrationReport(h.plan, h.reportOptions); assert.equal(completeReport.accounting.unknownTransportSlots, 0); assert.equal(completeReport.accounting.exactTransportCount, 10);
});
