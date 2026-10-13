import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimSupportAnswerUnits, claimSupportEvidence, claimSupportRequestParts, validateClaimSupportOutput, type ClaimSupportInput, type ClaimSupportWireOutput } from './claim-support.ts';

const fixture: ClaimSupportInput = { runId: 'synthetic-contract-grade', question: 'What capacity is listed for bottle BOT123?', product: { id: 'SYNTHETIC-BOTTLE', title: 'Synthetic bottle BOT123' },
  answer: { answer: 'The listing states a capacity of 600 ml.', status: 'answered', citations: [{ passageId: 'listing', quote: 'This bottle holds 600 ml.' }] },
  evidence: [{ id: 'listing', source: 'listing', text: 'This bottle holds 600 ml. It has a twist cap.' }] };
function output(input = fixture): ClaimSupportWireOutput {
  return { units: claimSupportAnswerUnits(input.answer.answer).map(unit => ({ unitId: unit.id, verdict: 'supported', evidence: [{ sourceId: 'listing', quote: 'This bottle holds 600 ml.', relation: 'supports' }], reason: 'Synthetic validator control; no judge model was run.' })), questionCoverage: 'complete', answerability: 'answerable', correctness: 'consistent_with_sources', uncertaintyHandling: 'appropriate', reason: 'Synthetic structured validator control only.' };
}

test('claim support request binds literal whole answer coverage and exact source/question context', () => {
  const text = `600.5 ml. ${'a'.repeat(1100)}\nUnverified compatibility.`;
  const units = claimSupportAnswerUnits(text);
  assert.equal(units.map(unit => unit.text).join(''), text);
  assert.equal(units[0].start, 0); assert.equal(units.at(-1)!.end, text.length);
  const parts = claimSupportRequestParts(fixture);
  assert.deepEqual(parts.parameters.properties.units.items.properties.unitId.enum, parts.units.map(unit => unit.id));
  assert.deepEqual(parts.parameters.properties.units.items.properties.evidence.items.properties.sourceId.enum, ['listing']);
  assert.equal(parts.body.model, 'gpt-luna'); assert.equal(parts.body.max_tokens, 4096); assert.equal(parts.body.parallel_tool_calls, false);
  assert.notEqual(parts.bindings.sourceContextSha256, claimSupportRequestParts({ ...fixture, evidence: [{ ...fixture.evidence[0], originalQuestion: 'Does BOT999 hold this capacity?' }] }).bindings.sourceContextSha256);
  assert.notEqual(parts.bindings.answerSha256, claimSupportRequestParts({ ...fixture, answer: { ...fixture.answer, answer: '600 ml.' } }).bindings.answerSha256);
});

test('validated support remains an uncalibrated AI estimate, with cited support separate from consistency', () => {
  const assessment = validateClaimSupportOutput(fixture, output());
  assert.equal(assessment.disposition, 'pass'); assert.equal(assessment.assessmentKind, 'ai_claim_support_estimate');
  assert.equal(assessment.calibration, 'not_measured'); assert.equal(assessment.qualityClaimEligible, false);
  const uncited = { ...fixture, evidence: [...fixture.evidence, { id: 'customer', source: 'cqa', text: '600 ml.', originalQuestion: fixture.question }] };
  const control = output(uncited); control.units[0].evidence = [{ sourceId: 'customer', quote: '600 ml.', relation: 'supports' }];
  assert.equal(validateClaimSupportOutput(uncited, control).disposition, 'repair', 'uncited proof cannot establish citation support');
  const differentSpan = output(); differentSpan.units[0].evidence = [{ sourceId: 'listing', quote: 'It has a twist cap.', relation: 'supports' }];
  assert.equal(validateClaimSupportOutput(fixture, differentSpan).disposition, 'repair', 'same source membership cannot substitute for the actual quoted span');
});

test('wire validator rejects omitted/duplicate units and foreign/nonliteral/unsupported proofs', () => {
  const input = { ...fixture, answer: { ...fixture.answer, answer: 'A'.repeat(510) } }, valid = output(input);
  const controls = [
    { ...valid, units: valid.units.slice(0, 1) }, { ...valid, units: [valid.units[0], valid.units[0]] },
    { ...valid, units: [{ ...valid.units[0], unitId: 'foreign' }, valid.units[1]] },
    { ...valid, units: valid.units.map(unit => ({ ...unit, evidence: [{ sourceId: 'foreign', quote: 'This bottle holds 600 ml.', relation: 'supports' }] })) },
    { ...valid, units: valid.units.map(unit => ({ ...unit, evidence: [{ sourceId: 'listing', quote: 'It holds 600 liters.', relation: 'supports' }] })) },
    { ...valid, units: valid.units.map(unit => ({ ...unit, evidence: [] })) }, { ...valid, confidence: 100 }
  ];
  for (const malformed of controls) assert.throws(() => validateClaimSupportOutput(input, malformed));
  const mixed = output(input); mixed.units[1] = { ...mixed.units[1], verdict: 'unsupported', evidence: [], reason: 'Synthetic explicit unsupported second unit control.' };
  assert.equal(validateClaimSupportOutput(input, mixed).disposition, 'repair');
});

test('supported units reject contradictory proofs even when every quote is literal', () => {
  const sameQuote = output(); sameQuote.units[0].evidence.push({ ...sameQuote.units[0].evidence[0], relation: 'contradicts' });
  assert.throws(() => validateClaimSupportOutput(fixture, sameQuote), /cannot include a contradictory proof/);
  const differentQuote = output(); differentQuote.units[0].evidence.push({ sourceId: 'listing', quote: 'It has a twist cap.', relation: 'contradicts' });
  assert.throws(() => validateClaimSupportOutput(fixture, differentQuote), /cannot include a contradictory proof/);
});

test('uncertainty and abstention cannot become an answered pass', () => {
  const grade = output(); grade.units[0].verdict = 'uncertain'; grade.units[0].evidence = [];
  assert.equal(validateClaimSupportOutput(fixture, grade).disposition, 'uncertain');
  const abstention: ClaimSupportInput = { ...fixture, answer: { answer: 'I cannot establish replacement compatibility from these sources.', status: 'insufficient_evidence', citations: [] } };
  const missing = output(abstention); missing.units = missing.units.map(unit => ({ ...unit, verdict: 'non_factual', evidence: [] })); missing.answerability = 'insufficient';
  assert.equal(validateClaimSupportOutput(abstention, missing).disposition, 'abstain');
  missing.answerability = 'answerable'; missing.uncertaintyHandling = 'unnecessary_abstention';
  assert.equal(validateClaimSupportOutput(abstention, missing).disposition, 'repair');
  const noFacts = output(); noFacts.units = noFacts.units.map(unit => ({ ...unit, verdict: 'non_factual', evidence: [] }));
  assert.equal(validateClaimSupportOutput(fixture, noFacts).disposition, 'uncertain');
});

test('unanswerable source packets abstain before repairing failed claims', () => {
  const unsupported = output(); unsupported.units[0] = { ...unsupported.units[0], verdict: 'unsupported', evidence: [] }; unsupported.answerability = 'insufficient';
  assert.equal(validateClaimSupportOutput(fixture, unsupported).disposition, 'abstain');
  unsupported.answerability = 'answerable';
  assert.equal(validateClaimSupportOutput(fixture, unsupported).disposition, 'repair');
  const contradicted = output(); contradicted.units[0].verdict = 'contradicted'; contradicted.units[0].evidence[0].relation = 'contradicts'; contradicted.answerability = 'conflicting'; contradicted.correctness = 'contradicted_by_sources';
  assert.equal(validateClaimSupportOutput(fixture, contradicted).disposition, 'abstain');
  contradicted.answerability = 'answerable';
  assert.equal(validateClaimSupportOutput(fixture, contradicted).disposition, 'repair');
});

test('source questions are context only and legacy multiple quotes per passage remain valid input', () => {
  const input: ClaimSupportInput = { ...fixture, evidence: [{ id: 'listing', source: 'cqa', text: 'Yes. Question: Does BOT123 hold 600 ml?' }], answer: { answer: 'The customer reports yes for BOT123.', status: 'answered', citations: [{ passageId: 'listing', quote: 'Yes.' }] } };
  const parts = claimSupportRequestParts(input);
  assert.equal(parts.normalized.evidence[0].text, 'Yes.'); assert.equal(parts.normalized.evidence[0].originalQuestion, 'Does BOT123 hold 600 ml?');
  const grade = output(input); grade.units[0].evidence[0].quote = 'Does BOT123 hold 600 ml?';
  assert.throws(() => validateClaimSupportOutput(input, grade), /body quote/);
  const twoQuotes = { ...fixture, answer: { ...fixture.answer, citations: [...fixture.answer.citations, { passageId: 'listing', quote: 'It has a twist cap.' }] } };
  assert.deepEqual(claimSupportRequestParts(twoQuotes).payload.citedSourceIds, ['listing']);
  assert.throws(() => claimSupportRequestParts({ ...fixture, answer: { ...fixture.answer, citations: [{ passageId: 'listing', quote: '999 ml' }] } }), /body citations/);
});

test('full fictional workspace packet exceeds generation catalog size without truncation and closes oversized input', () => {
  const evidence = Array.from({ length: 8 }, (_, source) => Array.from({ length: 5 }, (_, chunk) => ({ id: `synthetic-source-${source}-chunk-${chunk}`, source: 'Synthetic listing', text: `SYNTHETIC fixture ${source}/${chunk}: ${'x'.repeat(240)}` }))).flat();
  assert.equal(claimSupportEvidence(evidence).length, 40);
  const input: ClaimSupportInput = { ...fixture, evidence, answer: { ...fixture.answer, citations: [{ passageId: evidence[0].id, quote: evidence[0].text }] } };
  assert.equal(claimSupportRequestParts(input).payload.evidence.length, 40);
  assert.throws(() => claimSupportEvidence(Array.from({ length: 257 }, (_, i) => ({ id: `synthetic-${i}`, source: 'Synthetic', text: 'short' }))));
  assert.throws(() => claimSupportEvidence(Array.from({ length: 5 }, (_, i) => ({ id: `synthetic-${i}`, source: 'Synthetic', text: 'x'.repeat(3000) }))), /12000/);
  const largeContext: ClaimSupportInput = { ...fixture, evidence: Array.from({ length: 80 }, (_, i) => ({ id: `synthetic-${i}`, source: 'Synthetic', text: 'short', originalQuestion: 'q'.repeat(500) })), answer: { answer: 'Cannot confirm.', status: 'insufficient_evidence', citations: [] } };
  assert.throws(() => claimSupportRequestParts(largeContext), /bounded context/);
});
