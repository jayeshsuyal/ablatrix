import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimSupportRequestParts, validateClaimSupportOutput, replayClaimSupportReceipt, type ClaimSupportInput } from './claim-support.ts';
import { CITED_APPLICABILITY_GRADER_VERSION as VERSION, CLAIM_SUPPORT_V4_TOOL, claimSupportV4ContractIdentity, type ClaimSupportV4WireOutput } from './claim-support-v4.ts';
import { createRuntimeGraderBinding, runtimeGraderReadiness, validateRuntimeGraderBinding } from './runtime-grader.ts';
import { SapiomFeedbackProvider } from './feedback-provider.ts';
import { SyntheticAnswerProvider } from './synthetic-answer-provider.ts';

function input(answer = 'The fictional Vela jug holds six cups.'): ClaimSupportInput {
  return { runId: 'synthetic-v4-case', graderVersion: VERSION, question: 'How many cups does the fictional Vela jug hold?', product: { id: 'fictional-vela', title: 'Fictional Vela jug' }, answer: { status: 'answered', answer, citations: [{ passageId: 'vela-spec', quote: 'The fictional Vela jug holds six cups.' }] }, evidence: [{ id: 'vela-spec', source: 'Fictional specification', text: 'The fictional Vela jug holds six cups. Its lid is cork.' }] };
}
function wire(value: ClaimSupportInput): ClaimSupportV4WireOutput {
  const parts = claimSupportRequestParts(value);
  return { units: parts.units.map(unit => ({ unitId: unit.id, factualConsistency: 'consistent', citedSupport: 'supported', applicability: 'applicable', evidence: [{ sourceId: 'vela-spec', quote: 'The fictional Vela jug holds six cups.', relation: 'supports' }], citedCitationIndexes: [0], reason: 'Fictional deterministic contract control.' })), questionCoverage: 'complete', answerability: 'answerable', uncertaintyHandling: 'appropriate', reason: 'Fictional deterministic contract control only.' };
}
test('v4 separates full-packet factual support from actual citation support without altering legacy defaults', () => {
  const value = input(); value.evidence.push({ id: 'irrelevant', source: 'Fictional unrelated clause', text: 'The handle is green.' }); value.answer.citations = [{ passageId: 'irrelevant', quote: 'The handle is green.' }];
  const output = wire(value); output.units[0].citedSupport = 'unsupported'; output.units[0].citedCitationIndexes = [0];
  const grade = validateClaimSupportOutput(value, output), explicit = grade as ReturnType<typeof validateClaimSupportOutput> & { v4: ClaimSupportV4WireOutput };
  assert.equal(grade.correctness, 'consistent_with_sources'); assert.equal(explicit.v4.units[0].factualConsistency, 'consistent'); assert.equal(explicit.v4.units[0].citedSupport, 'unsupported'); assert.equal(grade.disposition, 'repair');
  assert.equal(claimSupportRequestParts({ ...value, graderVersion: undefined }).prompt.promptVersion, 'claim-support-v1'); assert.equal(claimSupportRequestParts(value).tool, CLAIM_SUPPORT_V4_TOOL);
});
test('explicitly wrong variants are definite missing applicability while genuinely ambiguous scope remains uncertain', () => {
  const value = input(), wrong = wire(value); wrong.units[0] = { ...wrong.units[0], factualConsistency: 'not_established', citedSupport: 'unsupported', applicability: 'wrong_variant', evidence: [], citedCitationIndexes: [0] }; wrong.uncertaintyHandling = 'overconfident';
  const rejected = validateClaimSupportOutput(value, wrong); assert.equal(rejected.disposition, 'repair'); assert.equal(rejected.correctness, 'uncertain');
  const ambiguous = structuredClone(wrong); ambiguous.units[0].factualConsistency = 'uncertain'; ambiguous.units[0].applicability = 'ambiguous_scope'; assert.equal(validateClaimSupportOutput(value, ambiguous).disposition, 'uncertain');
});
test('mixed refusals retain factual failures, justified refusals abstain, and unnecessary refusal repairs', () => {
  const mixed = input('I cannot determine its warranty. It withstands 200 psi.'); mixed.answer.status = 'insufficient_evidence';
  const output = wire(mixed); output.units[0] = { ...output.units[0], factualConsistency: 'not_established', citedSupport: 'unsupported', applicability: 'applicable', evidence: [], citedCitationIndexes: [] }; output.answerability = 'insufficient'; output.uncertaintyHandling = 'overconfident';
  const grade = validateClaimSupportOutput(mixed, output); assert.equal(grade.units[0].verdict, 'unsupported'); assert.equal(grade.disposition, 'abstain'); assert.equal(grade.uncertaintyHandling, 'overconfident');
  const refusal = input('I cannot determine the absent warranty.'); refusal.answer = { ...refusal.answer, status: 'insufficient_evidence', citations: [] };
  const pure = wire(refusal); pure.units[0] = { ...pure.units[0], factualConsistency: 'non_factual', citedSupport: 'non_factual', applicability: 'not_applicable', evidence: [], citedCitationIndexes: [] }; pure.answerability = 'insufficient'; assert.equal(validateClaimSupportOutput(refusal, pure).disposition, 'abstain');
  pure.answerability = 'answerable'; pure.questionCoverage = 'incomplete'; pure.uncertaintyHandling = 'unnecessary_abstention'; assert.equal(validateClaimSupportOutput(refusal, pure).disposition, 'repair');
});
test('three units and boundary-spanning assertions are in scope; omissions, long answers and response overflow are closed', () => {
  const value = input('x'.repeat(489) + 'six cups only when the cork lid is closed. ' + 'x'.repeat(1500 - 489 - 41));
  value.answer.answer = value.answer.answer.padEnd(1500, 'x').slice(0, 1500); const parts = claimSupportRequestParts(value), output = wire(value);
  assert.equal(parts.units.length, 3); assert('preflight' in parts); assert(parts.preflight.canonicalBytes <= 4096); assert.match(parts.prompt.systemInstructions, /crosses a unit boundary/);
  assert.equal(validateClaimSupportOutput(value, output).disposition, 'pass'); assert.throws(() => validateClaimSupportOutput(value, { ...output, units: output.units.slice(0, 2) }), /omitted|cover/);
  assert.throws(() => claimSupportRequestParts(input('x'.repeat(1501))), /1500/);
  const tooLongReason = wire(input()); tooLongReason.units[0].reason = '😀'.repeat(30); assert.throws(() => validateClaimSupportOutput(input(), tooLongReason), /bounds/);
});
test('long actual cited spans use exact compact indexes and cannot be replaced, duplicated or invented', () => {
  const value = input(); const text = value.evidence[0].text + ' Fictional padding.'.repeat(70); value.evidence[0].text = text; value.answer.citations = [{ passageId: 'vela-spec', quote: text }];
  const output = wire(value), grade = validateClaimSupportOutput(value, output); assert.equal(grade.disposition, 'pass'); assert(grade.units[0].evidence.some(proof => proof.quote === text));
  for (const indexes of [[1], [0, 0], []]) { const invalid = structuredClone(output); invalid.units[0].citedCitationIndexes = indexes; assert.throws(() => validateClaimSupportOutput(value, invalid), /indexes|own proof/); }
  const factualWrong = structuredClone(output); factualWrong.units[0].evidence[0].quote = 'not in any body'; assert.throws(() => validateClaimSupportOutput(value, factualWrong), /literal/);
});
test('runtime bindings cannot promote pending, altered, incompatible or synthetic qualification into live authority', async () => {
  const live = createRuntimeGraderBinding('live', VERSION), synthetic = createRuntimeGraderBinding('synthetic', VERSION); assert.equal(runtimeGraderReadiness(live).ready, false); assert.equal(runtimeGraderReadiness(synthetic).ready, true);
  const altered = structuredClone(live); altered.qualification.liveQualified = true as false; assert.throws(() => validateRuntimeGraderBinding(altered), /altered/);
  const cross = { ...synthetic, mode: 'live' as const }; assert.throws(() => validateRuntimeGraderBinding(cross), /altered/);
  assert.equal(claimSupportV4ContractIdentity().qualification, 'not_qualified'); let calls = 0;
  const provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'synthetic-placeholder', dbPath: ':memory:', capUsd: 1, allowancePerCallUsd: .1, callLimit: 3, fetchImpl: async () => { calls++; throw new Error('Forbidden transport'); } });
  try { await assert.rejects(provider.gradeClaimSupport(input()), /independently verified qualification/); assert.equal(calls, 0); assert.equal(provider.receipt(input().runId), undefined); } finally { provider.close(); }
});
test('synthetic v4 receipts replay exact version/schema/scope bindings and cannot become v1 or live receipts', async () => {
  const provider = new SyntheticAnswerProvider(':memory:');
  try {
    const value = input(); value.answer.answer = 'SYNTHETIC revision — scripted source excerpts, not a model-generated answer.'; value.evidence[0].text = 'SYNTHETIC fixture: The fictional Vela jug holds six cups.'; value.answer.citations = [{ passageId: 'vela-spec', quote: value.evidence[0].text }];
    value.graderBindingSha256 = createRuntimeGraderBinding('synthetic', VERSION).bindingSha256;
    const result = await provider.gradeClaimSupport(value), receipt = provider.receipt(value.runId)!;
    assert.equal(receipt.kind, CLAIM_SUPPORT_V4_TOOL); assert.equal(result.assessment.disposition, 'pass'); assert.deepEqual(replayClaimSupportReceipt(value, receipt, 'synthetic').assessment, result.assessment);
    assert.throws(() => replayClaimSupportReceipt({ ...value, graderVersion: undefined }, receipt, 'synthetic'), /reconciliation/); assert.throws(() => replayClaimSupportReceipt(value, receipt, 'live'), /reconciliation/);
    assert.throws(() => replayClaimSupportReceipt({ ...value, graderBindingSha256: '0'.repeat(64) }, receipt, 'synthetic'), /reconciliation/);
  } finally { provider.close(); }
});
