import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimSupportRequestParts, type ClaimSupportWireOutput } from './claim-support.ts';
import { qualificationFixtureDataset } from './grader-qualification-fixtures.ts';
import { QUALIFICATION_CODE_FILES, qualificationHash, sealQualification, verifyQualification, rehearseQualification, type QualificationBundle } from './grader-qualification.ts';

const options = { implementationCommit: 'a'.repeat(40), codeFileSha256: Object.fromEntries(QUALIFICATION_CODE_FILES.map(path => [path, 'b'.repeat(64)])) };
const prepare = () => sealQualification({ ...options, createdAt: '2026-10-15T18:00:00.000Z' });
function scripted(bundle: QualificationBundle) { const r = rehearseQualification(bundle, options); return r.slots.map(s => { const { units, questionCoverage, answerability, correctness, uncertaintyHandling, reason } = s.assessment!; return { slotId: s.slotId, output: structuredClone({ units, questionCoverage, answerability, correctness, uncertaintyHandling, reason }) as ClaimSupportWireOutput }; }); }
function rehashPlan(bundle: QualificationBundle) { const { planSha256: _sha, ...body } = bundle.plan; bundle.plan.planSha256 = qualificationHash(body); }

test('seal binds exact v3 requests with separate references and 80 primary / 12 repeated slots', () => {
  const bundle = prepare(); assert.deepEqual(bundle, prepare()); assert.deepEqual(verifyQualification(bundle, options), bundle);
  assert.equal(bundle.plan.slots.length, 92); assert.equal(new Set(bundle.requests.map(r => r.runId)).size, 92); assert.equal(new Set(bundle.plan.slots.map(s => s.caseId)).size, 80);
  assert.equal(bundle.references.items.filter(r => r.answerQuality === 'flawed').length, 60);
  for (const slot of bundle.plan.slots) {
    const request = bundle.requests[slot.index], parts = claimSupportRequestParts(request.input);
    assert.deepEqual(request.requestBody, parts.body); assert.equal(slot.requestSha256, parts.bindings.requestSha256);
    const payload = JSON.parse(request.requestBody.messages[1].content);
    assert.deepEqual(Object.keys(payload).sort(), ['promptVersion', 'question', 'product', 'answer', 'evidence', 'clarifications', 'answerUnits', 'citedSourceIds'].sort());
    const ref = bundle.references.items.find(r => r.caseId === slot.caseId)!; assert.ok(!JSON.stringify(request.requestBody).includes(ref.rationale));
    if (slot.role === 'repeat') {
      const primary = bundle.plan.slots.find(p => p.slotId === slot.primarySlotId)!;
      assert.equal(primary.role, 'primary'); assert.equal(primary.caseId, slot.caseId);
      assert.deepEqual(request.requestBody, bundle.requests[primary.index].requestBody);
      assert.notEqual(request.runId, bundle.requests[primary.index].runId);
    }
  }
  const repeats = bundle.plan.slots.slice(80).map(s => bundle.references.items.find(r => r.caseId === s.caseId)!);
  assert.equal(repeats.filter(r => r.answerQuality === 'flawed').length, 8);
  assert.equal(repeats.filter(r => r.acceptableKind === 'factual').length, 2);
  assert.equal(repeats.filter(r => r.acceptableKind === 'qualified').length, 1);
  assert.equal(repeats.filter(r => r.acceptableKind === 'refusal').length, 1);
});

test('even a perfect scripted rehearsal cannot issue qualification or financial authority', () => {
  const bundle = prepare(), r = rehearseQualification(bundle, options);
  assert.equal(r.engineeringGateMechanics, 'passed'); assert.equal(r.metrics.primary.valid, 80); assert.equal(r.metrics.primary.fullAxisMatches, 80); assert.equal(r.metrics.repeats.stable, 12);
  assert.deepEqual(r.metrics.primary.flawed, { denominator: 60, rawPasses: 0 }); assert.deepEqual(r.metrics.primary.acceptable, { denominator: 20, dispositionMatches: 20 });
  assert.equal(r.liveProviderCalls, 0); assert.equal(r.qualified, false); assert.equal(r.productionActivationQualified, false); assert.equal(r.qualityClaimEligible, false);
  assert.equal(r.qualificationRecord.status, 'pending_live_evidence'); assert.equal(r.qualificationRecord.scope, 'none'); assert.equal(r.qualificationRecord.liveEvidence, null); assert.equal(r.qualificationRecord.qualified, false);
  assert.equal(bundle.plan.proposedBudget.approved, false); assert.equal(bundle.plan.proposedBudget.maxAddedPlanningAllowanceUsd, 9.2);
  assert.equal(bundle.plan.futureExecution.status, 'not_implemented_in_this_offline_contract');
  assert.ok(r.slots.every(s => s.assessment!.assessmentKind === 'synthetic_scripted_claim_support'));
});

test('self-consistent edited labels, wire bodies, identities, scope and thresholds do not verify', () => {
  const edits: ((b: QualificationBundle) => void)[] = [
    b => { b.references.items[0].acceptableDispositions = ['pass']; b.plan.referencesSha256 = qualificationHash(b.references); },
    b => { b.requests[0].requestBody.model = 'different-model'; b.plan.requestsSha256 = qualificationHash(b.requests); },
    b => { b.requests[0].input.graderVersion = 'claim-support-v1'; b.plan.requestsSha256 = qualificationHash(b.requests); },
    b => { b.plan.slots[80].primarySlotId = b.plan.slots[1].slotId; },
    b => { (b.plan.criteria as unknown as { minimumPrimaryFullAxisMatches: number }).minimumPrimaryFullAxisMatches = 1; },
    b => { (b.plan.criteria as unknown as { flawedRawPassesAllowed: number }).flawedRawPassesAllowed = 60; },
    b => { (b.record as unknown as { qualified: boolean }).qualified = true; },
    b => { (b.plan.proposedBudget as unknown as { approved: boolean }).approved = true; },
    b => { b.plan.review.status = 'completed' as never; },
    b => { b.plan.grader.systemInstructionsSha256 = 'c'.repeat(64); },
    b => { b.plan.implementationCommit = 'd'.repeat(40); }
  ];
  for (const edit of edits) { const b = prepare(); edit(b); rehashPlan(b); assert.throws(() => verifyQualification(b, options), /differs/); }
  assert.throws(() => verifyQualification(prepare(), { ...options, codeFileSha256: { ...options.codeFileSha256, 'server/claim-support.ts': 'f'.repeat(64) } }), /differs/);
});

test('a false approval and a conservative missed critical label fail independently of overall agreement', () => {
  const bundle = prepare(), observations = scripted(bundle);
  const partial = bundle.plan.slots.find(s => s.role === 'primary' && s.category === 'partial_coverage')!;
  observations[partial.index].output.questionCoverage = 'complete';
  const falsePass = rehearseQualification(bundle, options, observations);
  assert.equal(falsePass.slots[partial.index].assessment!.disposition, 'pass'); assert.equal(falsePass.metrics.primary.flawed.rawPasses, 1); assert.equal(falsePass.gates.zeroFlawedPasses, false); assert.equal(falsePass.engineeringGateMechanics, 'failed');
  const conservative = scripted(bundle), mixed = bundle.plan.slots.find(s => s.role === 'primary' && s.category === 'mixed_unsupported')!;
  conservative[mixed.index].output.uncertaintyHandling = 'appropriate';
  const missed = rehearseQualification(bundle, options, conservative);
  assert.notEqual(missed.slots[mixed.index].assessment!.disposition, 'pass'); assert.equal(missed.metrics.primary.flawed.rawPasses, 0); assert.equal(missed.gates.allCriticalAxesMatch, false); assert.equal(missed.engineeringGateMechanics, 'failed');
});

test('always-refuse and always-uncertain strategies cannot satisfy the useful-answer gate', () => {
  const bundle = prepare();
  for (const strategy of ['refuse', 'uncertain']) {
    const observations = bundle.requests.map(request => ({ slotId: request.slotId, output: { units: claimSupportRequestParts(request.input).units.map(u => ({ unitId: u.id, verdict: strategy === 'refuse' ? 'non_factual' : 'uncertain', evidence: [], reason: 'SYNTHETIC blanket non-pass adversary.' })), questionCoverage: 'complete', answerability: strategy === 'refuse' ? 'insufficient' : 'uncertain', correctness: strategy === 'refuse' ? 'consistent_with_sources' : 'uncertain', uncertaintyHandling: 'appropriate', reason: 'SYNTHETIC blanket non-pass adversary.' } }));
    const r = rehearseQualification(bundle, options, observations); assert.equal(r.metrics.primary.flawed.rawPasses, 0); assert.equal(r.engineeringGateMechanics, 'failed'); assert.equal(r.gates.acceptableDispositionMatches, false); assert.equal(r.gates.allCriticalAxesMatch, false);
  }
});

test('repeats measure stability without inflating primary denominators or concealing instability', () => {
  const bundle = prepare(), observations = scripted(bundle), repeat = bundle.plan.slots.find(s => s.role === 'repeat' && s.category === 'partial_coverage')!;
  observations[repeat.index].output.questionCoverage = 'complete';
  const r = rehearseQualification(bundle, options, observations);
  assert.deepEqual(r.metrics.primary.flawed, { denominator: 60, rawPasses: 0 }); assert.equal(r.metrics.primary.fullAxisMatches, 80);
  assert.equal(r.metrics.repeats.stable, 11); assert.equal(r.gates.repeatsStable, false); assert.equal(r.engineeringGateMechanics, 'failed');
});

test('missing, invalid and duplicate scripted observations preserve full denominators and fail closed', () => {
  const bundle = prepare(), observations = scripted(bundle);
  const missing = rehearseQualification(bundle, options, observations.slice(0, 4)); assert.equal(missing.metrics.primary.planned, 80); assert.equal(missing.metrics.primary.unattempted, 76); assert.equal(missing.metrics.repeats.planned, 12); assert.equal(missing.engineeringGateMechanics, 'failed');
  const bad = structuredClone(observations); bad[0].output.units = [];
  const invalid = rehearseQualification(bundle, options, bad); assert.equal(invalid.metrics.primary.invalid, 1); assert.equal(invalid.engineeringGateMechanics, 'failed'); assert.equal(invalid.qualified, false);
  assert.throws(() => rehearseQualification(bundle, options, [observations[0], observations[0]]), /distinct known/);
  assert.throws(() => rehearseQualification(bundle, options, [{ slotId: 'unknown-slot', output: observations[0].output }]), /distinct known/);
});

test('irrelevant citations require repair under both predeclared support representations', () => {
  const bundle = prepare(), observations = scripted(bundle);
  const slot = bundle.plan.slots.find(s => s.role === 'primary' && s.category === 'citation_semantics')!, input = bundle.requests[slot.index].input;
  const literalBody = input.evidence[0].text;
  assert.ok(input.answer.citations.every(c => c.quote !== literalBody));
  observations[slot.index].output.units[0] = { unitId: observations[slot.index].output.units[0].unitId, verdict: 'supported', evidence: [{ sourceId: input.evidence[0].id, quote: literalBody, relation: 'supports' }], reason: 'SYNTHETIC correct body fact with uncited proof.' };
  observations[slot.index].output.uncertaintyHandling = 'appropriate';
  const r = rehearseQualification(bundle, options, observations);
  assert.equal(r.slots[slot.index].assessment!.disposition, 'repair'); assert.equal(r.slots[slot.index].agreement!.all, true); assert.equal(r.qualified, false);
});

test('sealing rejects altered balances, unbound case IDs, weakened critical axes and incomplete code bindings', () => {
  const data = qualificationFixtureDataset(); data.cases[0].input.question += ' edited';
  assert.throws(() => sealQualification({ ...options, createdAt: '2026-10-15T18:00:00.000Z', dataset: data }), /identity/);
  const weakened = qualificationFixtureDataset(); weakened.references[0].criticalAxes = ['support'];
  assert.throws(() => sealQualification({ ...options, createdAt: '2026-10-15T18:00:00.000Z', dataset: weakened }), /critical axes/);
  assert.throws(() => sealQualification({ ...options, codeFileSha256: {}, createdAt: '2026-10-15T18:00:00.000Z' }), /exact code manifest/);
});
