import { historicalQualificationTestSources } from './qualification-historical-test-sources.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { claimSupportRequestParts, type ClaimSupportWireOutput } from './claim-support.ts';
import { qualificationHash, rehearseQualification } from './grader-qualification.ts';
import { QUALIFICATION_LIVE_CODE_FILES, type LiveQualificationReceipt, type LiveQualificationScope } from './grader-qualification-live-boundary.ts';
import type { QualificationJournalRecord } from './grader-qualification-live-journal.ts';
import { QUALIFICATION_LIVE_BUDGET, QUALIFICATION_SOURCE_DIRECTORY, QUALIFICATION_SOURCE_HASHES, inspectQualificationObservations, prepareQualificationLivePlan, qualificationStopReasons, readQualificationLiveSources, verifyQualificationLiveApproval, verifyQualificationLivePlan, verifyQualificationLiveSources, type QualificationLiveApproval, type QualificationLivePlan } from './grader-qualification-live.ts';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = historicalQualificationTestSources(repository);
const commit = 'a'.repeat(40);
const codeFileSha256 = Object.fromEntries(QUALIFICATION_LIVE_CODE_FILES.map(path => [path, qualificationHash(`SYNTHETIC adapter code identity: ${path}`)]));
const syntheticRoot = '/private/tmp/ablatrix-qualification-pure-test';
const scope: LiveQualificationScope = {
  repositoryPath: syntheticRoot, budgetPath: `${syntheticRoot}/shared.sqlite`, reviewPath: `${syntheticRoot}/review.sqlite`, appDbPath: `${syntheticRoot}/app.sqlite`, loopDbPath: `${syntheticRoot}/loop.sqlite`, workspaceDbPath: `${syntheticRoot}/workspace.sqlite`, runtimePolicyDbPath: `${syntheticRoot}/policy.sqlite`, claimDirectory: `${syntheticRoot}/.data/grader-qualification-live-claims`, configuredPort: '4194', initiatingThreadId: 'synthetic-pure-mechanics-only', executionAuthority: 'parent_execution_only', ledgerInitialSha256: 'b'.repeat(64)
};
const expected = { implementationCommit: commit, codeFileSha256, callerScope: scope };
function plan() { return prepareQualificationLivePlan({ sources, ...expected, implementationCommit: commit, artifactDirectory: `${syntheticRoot}/docs/evidence/synthetic-live-mechanics`, createdAt: '2026-10-15T22:00:00.000Z' }); }
function rehashPlan(value: QualificationLivePlan) { const { executionPlanSha256: _old, ...body } = value; value.executionPlanSha256 = qualificationHash(body); }
function approval(p: QualificationLivePlan): QualificationLiveApproval {
  const body = { format: 'grader-qualification-user-approval-v1' as const, executionPlanSha256: p.executionPlanSha256, budget: structuredClone(p.budget), authorizationSource: 'direct_user_response' as const, userResponse: 'SYNTHETIC test approval; no real authorization or dispatch.', recordedAt: '2026-10-15T22:01:00.000Z' };
  return { ...body, approvalSha256: qualificationHash(body) };
}

// These are explicitly fabricated in-memory mechanics, never provider evidence.
// Even 92 perfect live-shaped receipts must not certify qualification here.
const scriptedOutputs = rehearseQualification(sources.bundle, { implementationCommit: sources.bundle.plan.implementationCommit, codeFileSha256: sources.bundle.plan.codeFileSha256 }).slots.map(slot => {
  const { units, questionCoverage, answerability, correctness, uncertaintyHandling, reason } = slot.assessment!;
  return structuredClone({ units, questionCoverage, answerability, correctness, uncertaintyHandling, reason }) as ClaimSupportWireOutput;
});
function receipt(index: number, output: unknown = scriptedOutputs[index]): LiveQualificationReceipt {
  const input = sources.bundle.requests[index].input, parts = claimSupportRequestParts(input);
  return { id: `synthetic-mechanics-receipt-${index}`, kind: 'claim_support_v1', status: 'completed', error_code: null, model: 'gpt-luna', allowance_usd: .1, input_tokens: 100, output_tokens: 60,
    receipt_json: JSON.stringify({ ...parts.bindings, promptVersion: parts.prompt.promptVersion, assessmentKind: 'ai_claim_support_estimate', model: 'gpt-luna', usage: { inputTokens: 100, outputTokens: 60 }, output }) };
}
function history(p: QualificationLivePlan, count = 92, overrides: Record<number, LiveQualificationReceipt> = {}, terminal: 'finished' | 'stopped' | null = count === 92 ? 'finished' : 'stopped') {
  const records: QualificationJournalRecord[] = [], receipts: Record<string, LiveQualificationReceipt> = {};
  const event = (body: Record<string, unknown> & { kind: QualificationJournalRecord['kind'] }) => {
    const common = { ...body, format: 'grader-qualification-checkpoint-v1' as const, sequence: records.length, previousSha256: records.at(-1)?.sha256 ?? '0'.repeat(64), createdAt: '2026-10-15T22:02:00.000Z', planSha256: p.executionPlanSha256, datasetSha256: p.datasetSha256, transportProvenance: 'mocked_mechanics_only' as const, authority: 'mocked_mechanics_only' as const };
    records.push({ ...common, sha256: qualificationHash(common) });
  };
  event({ kind: 'intent' });
  for (let index = 0; index < count; index++) {
    const slot = p.slots[index], r = overrides[index] ?? receipt(index); receipts[slot.runId] = r;
    const binding = { index, runId: slot.runId, requestSha256: slot.requestSha256 };
    event({ kind: 'slot_started', ...binding }); event({ kind: 'slot_reserved', ...binding, receiptId: r.id });
    event({ kind: 'slot_observed', ...binding, receiptId: r.id, receiptSha256: qualificationHash(r), receipt: r, transportCount: 1, durationMs: 12, httpStatus: 200 });
  }
  if (terminal) event({ kind: terminal, stopReasons: terminal === 'finished' ? [] : ['invalid_or_unknown_outcome'] });
  return { records, receipts, event };
}

test('execution scope freezes 92 calls, 102-to-194 attempts and honest planning allowance bounds', () => {
  const p = plan(); assert.deepEqual(p, plan()); assert.deepEqual(verifyQualificationLivePlan(p, sources, expected), p);
  assert.deepEqual(p.budget, { startingAttempts: 102, startingReservedUsd: 10.2, newCalls: 92, allowancePerCallUsd: .1, maxAddedPlanningAllowanceUsd: 9.2, absoluteCallLimit: 194, maximumReservedUsd: 19.4, priorSpendUsd: .200281, spendingCapUsd: 20, maximumPlanningUsageUsd: 19.600281 });
  assert.ok(Object.isFrozen(QUALIFICATION_LIVE_BUDGET)); assert.equal(p.slots.length, 92);
  assert.deepEqual(p.slots.map(s => s.requestSha256), sources.bundle.requests.map(r => r.requestSha256));
  assert.deepEqual(p.slots.map(s => s.runId), sources.bundle.requests.map(r => r.runId));
  assert.equal(p.authority, 'explicit_user_approval_of_this_execution_plan_required'); assert.equal(p.productionActivationQualified, false); assert.equal(p.qualityClaimEligible, false);
  assert.equal(p.stopPolicy.retries, 0); assert.equal(p.stopPolicy.resume, false);
});

test('published PR1 seal, source review and scripted replay remain byte-identical and pending', () => {
  for (const [name, expectedHash] of Object.entries(QUALIFICATION_SOURCE_HASHES)) assert.equal(createHash('sha256').update(readFileSync(resolve(repository, QUALIFICATION_SOURCE_DIRECTORY, name))).digest('hex'), expectedHash);
  const replay = rehearseQualification(sources.bundle, { implementationCommit: sources.bundle.plan.implementationCommit, codeFileSha256: sources.bundle.plan.codeFileSha256 });
  assert.equal(createHash('sha256').update(readFileSync(resolve(repository, QUALIFICATION_SOURCE_DIRECTORY, 'offline-rehearsal-v1.json'))).digest('hex'), 'd1be261d73e288d06c775a850f42c3e02e94c06b7d10a89432e8e87a90e14b81');
  assert.deepEqual(replay, JSON.parse(readFileSync(resolve(repository, QUALIFICATION_SOURCE_DIRECTORY, 'offline-rehearsal-v1.json'), 'utf8')));
  assert.equal(sources.bundle.record.qualified, false); assert.equal(sources.bundle.record.status, 'pending_live_evidence'); assert.equal(sources.bundle.record.sourceReview.humanGold, false);
  assert.equal(sources.bundle.plan.proposedBudget.approved, false); assert.equal(sources.bundle.plan.futureExecution.status, 'not_implemented_in_this_offline_contract');
});

test('self-consistent altered source labels, review, model and criteria cannot verify', () => {
  const edits: ((s: typeof sources) => void)[] = [
    s => { s.rawFileSha256['seal-v1/plan.json'] = 'c'.repeat(64); },
    s => { s.bundle.references.items[0].acceptableDispositions = ['pass']; s.bundle.plan.referencesSha256 = qualificationHash(s.bundle.references); },
    s => { s.bundle.plan.grader.requestedModel = 'other-model' as never; },
    s => { (s.bundle.plan.criteria as unknown as { minimumPrimaryFullAxisMatches: number }).minimumPrimaryFullAxisMatches = 1; },
    s => { s.bundle.plan.operatingScope.exclusions = []; },
    s => { s.bundle.plan.implementationCommit = 'd'.repeat(40); },
    s => { s.sourceReview.humanGold = true; const { sourceReviewSha256: _old, ...body } = s.sourceReview; s.sourceReview.sourceReviewSha256 = qualificationHash(body); },
    s => { s.sourceReview.reviewedCases = 79; const { sourceReviewSha256: _old, ...body } = s.sourceReview; s.sourceReview.sourceReviewSha256 = qualificationHash(body); }
  ];
  for (const edit of edits) {
    const changed = structuredClone(sources); edit(changed);
    const { planSha256: _old, ...body } = changed.bundle.plan; changed.bundle.plan.planSha256 = qualificationHash(body);
    assert.throws(() => verifyQualificationLiveSources(changed));
  }
});

test('historical consumed v3 execution sources stay closed when current sealed implementation changes', () => {
  assert.throws(() => readQualificationLiveSources(repository), /Original sealed implementation changed/);
});

test('untrusted source manifest is rejected before it can select any local code path', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'qualification-untrusted-source-')));
  try {
    for (const name of Object.keys(QUALIFICATION_SOURCE_HASHES)) {
      const target = resolve(root, QUALIFICATION_SOURCE_DIRECTORY, name); mkdirSync(dirname(target), { recursive: true });
      copyFileSync(resolve(repository, QUALIFICATION_SOURCE_DIRECTORY, name), target);
    }
    const path = resolve(root, QUALIFICATION_SOURCE_DIRECTORY, 'seal-v1/plan.json');
    const bad = JSON.parse(readFileSync(path, 'utf8')); bad.codeFileSha256 = { '/must-never-open-private-file': 'a'.repeat(64) };
    writeFileSync(path, JSON.stringify(bad));
    assert.throws(() => readQualificationLiveSources(root), /Reviewed source bytes/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('execution plan self hashes cannot weaken budget, code, scope, requests or stop rules', () => {
  const edits: ((p: QualificationLivePlan) => void)[] = [
    p => { (p.budget as unknown as { absoluteCallLimit: number }).absoluteCallLimit = 195; },
    p => { (p.budget as unknown as { spendingCapUsd: number }).spendingCapUsd = 21; },
    p => { p.callerScope.ledgerInitialSha256 = 'c'.repeat(64); },
    p => { p.callerScope.budgetPath = `${syntheticRoot}/different.sqlite`; },
    p => { p.codeFileSha256['server/feedback-provider.ts'] = 'c'.repeat(64); },
    p => { p.implementationCommit = 'd'.repeat(40); },
    p => { p.sourceReviewSha256 = 'c'.repeat(64); },
    p => { p.slots[0].requestSha256 = 'c'.repeat(64); },
    p => { p.slots.reverse(); },
    p => { p.stopPolicy.criticalAxisMiss = false as never; },
    p => { p.stopPolicy.retries = 1 as never; },
    p => { p.paths.checkpointPath = `${syntheticRoot}/.data/other.jsonl`; },
    p => { p.qualityClaimEligible = true as never; }
  ];
  for (const edit of edits) { const changed = plan(); edit(changed); rehashPlan(changed); assert.throws(() => verifyQualificationLivePlan(changed, sources, expected)); }
  assert.throws(() => prepareQualificationLivePlan({ sources, ...expected, codeFileSha256: {}, implementationCommit: commit, artifactDirectory: `${syntheticRoot}/docs/evidence/fresh`, createdAt: '2026-10-15T22:00:00.000Z' }), /every adapter/);
  assert.throws(() => prepareQualificationLivePlan({ sources, ...expected, implementationCommit: commit, artifactDirectory: '/private/tmp/outside-evidence', createdAt: '2026-10-15T22:00:00.000Z' }), /project evidence/);
});

test('approval record binds the exact plan and budget and cannot grant activation', () => {
  const p = plan(), value = approval(p); assert.deepEqual(verifyQualificationLiveApproval(p, value), value);
  for (const mutate of [
    (a: QualificationLiveApproval) => { a.executionPlanSha256 = 'c'.repeat(64); },
    (a: QualificationLiveApproval) => { (a.budget as unknown as { newCalls: number }).newCalls = 93; },
    (a: QualificationLiveApproval) => { a.authorizationSource = 'automatic' as never; },
    (a: QualificationLiveApproval) => { a.userResponse = ' '; },
    (a: QualificationLiveApproval) => { a.recordedAt = 'bad-date'; },
    (a: QualificationLiveApproval) => { (a as unknown as Record<string, unknown>).productionActivationQualified = true; }
  ]) { const changed = approval(p); mutate(changed); const { approvalSha256: _old, ...body } = changed; changed.approvalSha256 = qualificationHash(body); assert.throws(() => verifyQualificationLiveApproval(p, changed)); }
});

test('92 fabricated perfect observations preserve separate denominators and never certify live qualification', () => {
  const p = plan(), h = history(p), result = inspectQualificationObservations(p, sources, h.records, h.receipts);
  assert.equal(result.gatePassed, true); assert.equal(result.metrics.primary.planned, 80); assert.equal(result.metrics.primary.valid, 80); assert.equal(result.metrics.primary.fullAxisMatches, 80);
  assert.deepEqual(result.metrics.primary.flawed, { denominator: 60, rawPasses: 0 }); assert.deepEqual(result.metrics.primary.acceptable, { denominator: 20, dispositionMatches: 20 });
  assert.equal(result.metrics.repeats.planned, 12); assert.equal(result.metrics.repeats.valid, 12); assert.equal(result.metrics.repeats.stable, 12);
  assert.equal(result.accounting.observedTransportCount, 92); assert.equal(result.accounting.reservedPlanningAllowanceUsd, 9.2); assert.deepEqual(result.accounting.usage, { inputTokens: 9200, outputTokens: 5520, receiptsWithUsage: 92, receiptsWithoutUsage: 0 });
  assert.equal(result.qualified, false); assert.equal(result.productionActivationQualified, false); assert.equal(result.qualityClaimEligible, false); assert.equal(result.qualificationAuthority, 'none_receipt_reconstruction_requires_trusted_production_verifier');
  for (let index = 0; index < 92; index++) assert.deepEqual(qualificationStopReasons(result, sources, index), []);
});

test('partial, invalid and unknown execution keep all 92 slots and fail closed', () => {
  const p = plan(), empty = inspectQualificationObservations(p, sources, [], {});
  assert.equal(empty.metrics.unattempted, 92); assert.equal(empty.gatePassed, false); assert.equal(empty.qualified, false);
  for (const outcome of ['invalid', 'unknown'] as const) {
    const r = receipt(1); if (outcome === 'invalid') { const doc = JSON.parse(r.receipt_json!); doc.output.units = []; r.receipt_json = JSON.stringify(doc); } else { r.status = 'unknown'; r.error_code = 'synthetic_transport_uncertain'; }
    const h = history(p, 2, { 1: r }), result = inspectQualificationObservations(p, sources, h.records, h.receipts);
    assert.equal(result.slots[1].status, outcome); assert.equal(result.slots.length, 92); assert.equal(result.metrics.unattempted, 90);
    assert.equal(result.metrics.primary.planned, 80); assert.equal(result.metrics.primary.flawed.denominator, 60); assert.equal(result.metrics.primary.acceptable.denominator, 20); assert.equal(result.metrics.repeats.planned, 12);
    assert.equal(result.accounting.reservedSlots, 2); assert.equal(result.accounting.reservedPlanningAllowanceUsd, .2); assert.equal(result.gatePassed, false); assert.equal(result.qualified, false); assert.ok(qualificationStopReasons(result, sources, 1).includes('invalid_or_unknown_outcome'));
  }
  const interrupted = history(p, 1, {}, null); interrupted.event({ kind: 'slot_started', index: 1, runId: p.slots[1].runId, requestSha256: p.slots[1].requestSha256 });
  const result = inspectQualificationObservations(p, sources, interrupted.records, interrupted.receipts);
  assert.equal(result.slots[1].status, 'unknown'); assert.equal(result.metrics.unattempted, 90); assert.equal(result.terminal, 'interrupted'); assert.equal(result.accounting.unknownTransportSlots, 1); assert.equal(result.gatePassed, false);
});

test('wrong model, request identity, proof, provenance and usage cannot become valid evidence', () => {
  const p = plan();
  for (const mutate of [
    (r: LiveQualificationReceipt) => { r.model = 'wrong-model'; },
    (r: LiveQualificationReceipt) => { const doc = JSON.parse(r.receipt_json!); doc.requestSha256 = 'c'.repeat(64); r.receipt_json = JSON.stringify(doc); },
    (r: LiveQualificationReceipt) => { const doc = JSON.parse(r.receipt_json!); doc.assessmentKind = 'synthetic_scripted_claim_support'; r.receipt_json = JSON.stringify(doc); },
    (r: LiveQualificationReceipt) => { const doc = JSON.parse(r.receipt_json!); doc.responseSchemaSha256 = 'c'.repeat(64); r.receipt_json = JSON.stringify(doc); },
    (r: LiveQualificationReceipt) => { r.input_tokens = 101; },
    (r: LiveQualificationReceipt) => { r.allowance_usd = .2; },
    (r: LiveQualificationReceipt) => { r.error_code = 'recorded_failure'; }
  ]) { const r = receipt(0); mutate(r); const h = history(p, 1, { 0: r }), result = inspectQualificationObservations(p, sources, h.records, h.receipts); assert.equal(result.slots[0].status, 'invalid'); assert.equal(result.gatePassed, false); assert.equal(result.qualified, false); }
  const supportedIndex = scriptedOutputs.findIndex(output => output.units[0].verdict === 'supported');
  const output = structuredClone(scriptedOutputs[supportedIndex]); output.units[0].evidence[0].quote = 'SYNTHETIC invented nonliteral proof';
  const h = history(p, supportedIndex + 1, { [supportedIndex]: receipt(supportedIndex, output) }), result = inspectQualificationObservations(p, sources, h.records, h.receipts);
  assert.equal(result.slots[supportedIndex].status, 'invalid'); assert.equal(result.gatePassed, false);
});

test('false approvals, conservative wrong labels, blanket refusal and repeat instability trigger separate stops', () => {
  const p = plan();
  const partial = sources.bundle.plan.slots.find(s => s.role === 'primary' && s.category === 'partial_coverage')!;
  const output = structuredClone(scriptedOutputs[partial.index]); output.questionCoverage = 'complete';
  const h = history(p, partial.index + 1, { [partial.index]: receipt(partial.index, output) }), result = inspectQualificationObservations(p, sources, h.records, h.receipts);
  assert.equal(result.metrics.primary.flawed.rawPasses, 1); assert.ok(qualificationStopReasons(result, sources, partial.index).includes('flawed_raw_pass')); assert.equal(result.gatePassed, false);
  const mixed = sources.bundle.plan.slots.find(s => s.role === 'primary' && s.category === 'mixed_unsupported')!;
  const conservative = structuredClone(scriptedOutputs[mixed.index]); conservative.uncertaintyHandling = 'appropriate';
  const ch = history(p, mixed.index + 1, { [mixed.index]: receipt(mixed.index, conservative) }), cr = inspectQualificationObservations(p, sources, ch.records, ch.receipts);
  assert.notEqual(cr.slots[mixed.index].assessment?.disposition, 'pass'); assert.ok(qualificationStopReasons(cr, sources, mixed.index).includes('critical_axis_mismatch')); assert.equal(cr.gatePassed, false);
  const acceptable = sources.bundle.plan.slots.find(s => s.role === 'primary' && sources.bundle.references.items.find(r => r.caseId === s.caseId)?.acceptableKind === 'factual')!;
  const refusal = structuredClone(scriptedOutputs[acceptable.index]); refusal.units[0] = { ...refusal.units[0], verdict: 'non_factual', evidence: [] }; refusal.answerability = 'insufficient';
  const ah = history(p, acceptable.index + 1, { [acceptable.index]: receipt(acceptable.index, refusal) }), ar = inspectQualificationObservations(p, sources, ah.records, ah.receipts);
  assert.ok(qualificationStopReasons(ar, sources, acceptable.index).includes('acceptable_control_misrouted')); assert.equal(ar.gatePassed, false);
  const repeat = sources.bundle.plan.slots.find(s => s.role === 'repeat' && s.category === 'partial_coverage')!, unstable = structuredClone(scriptedOutputs[repeat.index]); unstable.questionCoverage = 'complete';
  const rh = history(p, repeat.index + 1, { [repeat.index]: receipt(repeat.index, unstable) }), rr = inspectQualificationObservations(p, sources, rh.records, rh.receipts);
  assert.equal(rr.metrics.primary.fullAxisMatches, 80); assert.equal(rr.metrics.primary.flawed.rawPasses, 0); assert.ok(qualificationStopReasons(rr, sources, repeat.index).includes('repeat_instability')); assert.equal(rr.gatePassed, false);
});

test('journal-to-ledger topology rejects orphan, duplicate, reordered or rewritten observations', () => {
  const p = plan();
  for (const mutate of [
    (h: ReturnType<typeof history>) => { h.records[2].receiptId = 'different-reservation'; },
    (h: ReturnType<typeof history>) => { h.records[3].receiptSha256 = 'c'.repeat(64); },
    (h: ReturnType<typeof history>) => { h.records[1].index = 1; },
    (h: ReturnType<typeof history>) => { h.records[3].requestSha256 = 'c'.repeat(64); },
    (h: ReturnType<typeof history>) => { h.records.splice(2, 1); },
    (h: ReturnType<typeof history>) => { h.records.splice(1, 0, h.records[1]); },
    (h: ReturnType<typeof history>) => { h.receipts['unknown-run'] = receipt(0); },
    (h: ReturnType<typeof history>) => { h.receipts[p.slots[1].runId] = receipt(1); },
    (h: ReturnType<typeof history>) => { h.records.at(-1)!.kind = 'finished'; }
  ]) { const h = history(p, 1); mutate(h); assert.throws(() => inspectQualificationObservations(p, sources, h.records, h.receipts)); }
  const no200 = history(p); no200.records.find(r => r.kind === 'slot_observed')!.httpStatus = 503;
  const result = inspectQualificationObservations(p, sources, no200.records, no200.receipts); assert.equal(result.gates.completeExecution, false); assert.equal(result.gatePassed, false); assert.equal(result.qualified, false);
});

test('replay rejects contradictory terminal reasons and dispatch after a fatal result', () => {
  const p = plan();
  for (const reasons of [['execution_guard_failed'], ['unknown_reason'], ['execution_guard_failed', 'execution_guard_failed']]) {
    const h = history(p); h.records.at(-1)!.stopReasons = reasons;
    assert.throws(() => inspectQualificationObservations(p, sources, h.records, h.receipts), /stop reasons|failure reasons/);
  }
  const stopped = history(p, 1); stopped.records.at(-1)!.stopReasons = [];
  assert.throws(() => inspectQualificationObservations(p, sources, stopped.records, stopped.receipts), /stopped records require/);
  const bad = receipt(0); bad.error_code = 'synthetic_invalid';
  const continued = history(p, 2, { 0: bad });
  assert.throws(() => inspectQualificationObservations(p, sources, continued.records, continued.receipts), /continued after/);
});
