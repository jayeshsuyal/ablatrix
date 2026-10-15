import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { claimSupportAnswerUnits, claimSupportRequestParts, validateClaimSupportOutput, type ClaimSupportWireOutput } from './claim-support.ts';
import { calibrationFixtureDataset, type CalibrationReference } from './grader-calibration-fixtures.ts';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const parts = (input: ReturnType<typeof calibrationFixtureDataset>['cases'][number]) => claimSupportRequestParts({ runId: `calibration-fixture:${input.id}`, ...input.input });

test('ten constructed cases form five opaque paired families with five good and five flawed source references', () => {
  const data = calibrationFixtureDataset();
  assert.equal(data.format, 'constructed-grader-pilot-v1');
  assert.equal(data.cases.length, 10); assert.equal(data.references.length, 10); assert.equal(data.families.length, 5);
  assert.equal(new Set(data.cases.map(item => item.id)).size, 10);
  assert.equal(new Set(data.families.map(item => item.id)).size, 5);
  assert.deepEqual(data.referenceProvenance, { authorship: 'ai_authored_constructed_reference', reviewStatus: 'pending_parent_source_review' });
  for (const item of data.cases) {
    assert.match(item.id, /^[a-f0-9]{64}$/); assert.match(item.familyId, /^[a-f0-9]{64}$/);
    assert.equal(item.id, sha(JSON.stringify(item.input)), 'case identity binds only the input, not an expected outcome');
    const reference = data.references.find(value => value.caseId === item.id)!;
    assert.ok(reference); assert.equal(reference.familyId, item.familyId);
    assert.deepEqual(reference.provenance, data.referenceProvenance);
    assert.ok(reference.acceptableDispositions.length >= 1);
    if (reference.answerQuality === 'flawed') assert.ok(!reference.acceptableDispositions.includes('pass'), 'a flawed answer can never receive accepted raw approval');
    assert.ok(reference.acceptableAxes.support.includes(reference.support));
    assert.ok(reference.acceptableAxes.questionCoverage.includes(reference.questionCoverage));
    assert.ok(reference.acceptableAxes.uncertaintyHandling.includes(reference.uncertaintyHandling));
    for (const span of reference.spans) {
      const source = item.input.evidence.find(source => source.id === span.sourceId);
      assert.ok(source?.text.includes(span.quote), 'every reference span is literal source-body evidence, including limits and context');
    }
  }
  assert.equal(data.references.filter(item => item.answerQuality === 'good').length, 5);
  assert.equal(data.references.filter(item => item.answerQuality === 'flawed').length, 5);
  assert.equal(data.references.filter(item => item.answerQuality === 'good' && item.acceptableDispositions.includes('pass')).length, 4);
  assert.equal(data.references.filter(item => item.answerQuality === 'good' && item.acceptableDispositions.includes('abstain')).length, 1);
  for (const family of data.families) {
    const paired = data.references.filter(item => item.familyId === family.id);
    assert.equal(paired.length, 2); assert.deepEqual(paired.map(item => item.answerQuality).sort(), ['flawed', 'good']);
    assert.ok(family.name.trim()); assert.ok(family.pattern.trim());
  }
});

test('all inputs fit the unchanged grader contract with literal citations and no hidden reference labels', () => {
  const data = calibrationFixtureDataset();
  for (const item of data.cases) {
    const request = parts(item), payload = JSON.stringify(request.payload);
    assert.ok(payload.length < 4_000, 'each newly constructed packet has substantial bounded context headroom');
    assert.equal(request.body.model, 'gpt-luna');
    assert.ok(!payload.includes(item.id)); assert.ok(!payload.includes(item.familyId));
    for (const family of data.families) { assert.ok(!payload.includes(family.name)); assert.ok(!payload.includes(family.pattern)); }
    for (const hidden of ['answerQuality', 'acceptableDispositions', 'acceptableAxes', 'referenceProvenance', 'pending_parent_source_review', 'ai_authored_constructed_reference', 'rationale', 'familyId']) assert.ok(!payload.includes(hidden), `${hidden} cannot enter grader user content`);
    const visible = JSON.stringify({ product: item.input.product, question: item.input.question, answer: item.input.answer, evidence: item.input.evidence });
    assert.doesNotMatch(visible, /\b(?:good|bad|flawed|correct|incorrect|expected|fixture|synthetic|calibration)\b/i, 'ordinary product/source/answer wording contains no correctness or fixture hints');
    for (const citation of item.input.answer.citations) assert.ok(item.input.evidence.some(source => source.id === citation.passageId && source.text.includes(citation.quote)));
    if (item.input.answer.status === 'answered') assert.ok(item.input.answer.citations.length);
  }
  const before = data.cases.map(item => parts(item).bindings.requestSha256);
  data.references[0].rationale = 'A later source review can change this reference explanation.';
  data.references[0].answerQuality = 'flawed'; data.families[0].name = 'A later family label';
  assert.deepEqual(data.cases.map(item => parts(item).bindings.requestSha256), before, 'reference metadata cannot change frozen grader requests');
});

test('compound numerical assertion and model-context distractor retain literal but semantically insufficient citations', () => {
  const data = calibrationFixtureDataset();
  const numeric = data.cases.find(item => item.input.answer.answer.includes('microwave'))!;
  const units = claimSupportAnswerUnits(numeric.input.answer.answer);
  assert.equal(units.length, 1); assert.equal(units[0].text, numeric.input.answer.answer);
  assert.ok(units[0].text.includes('750 milliliters') && units[0].text.includes('microwave'));
  assert.ok(numeric.input.answer.citations.every(citation => !citation.quote.includes('microwave')));
  assert.ok(numeric.input.evidence.every(source => !source.text.includes('microwave')));
  const numericReference = data.references.find(item => item.caseId === numeric.id)!;
  assert.equal(numericReference.support, 'unsupported'); assert.equal(numericReference.questionCoverage, 'complete');
  assert.ok(!numericReference.acceptableAxes.support.includes('contradicted'));

  const model = data.cases.find(item => item.input.answer.answer === 'The insert fits model VX-24 without an adapter.')!;
  assert.ok(model.input.question.includes('VX-24'));
  const customer = model.input.evidence.find(source => source.originalQuestion)!;
  assert.ok(customer.originalQuestion!.includes('VX-60'));
  assert.ok(model.input.answer.citations.some(citation => citation.passageId === customer.id && citation.quote === customer.text));
  assert.ok(!customer.text.includes('VX-24'));
  const modelReference = data.references.find(item => item.caseId === model.id)!;
  assert.equal(modelReference.support, 'unsupported'); assert.ok(!modelReference.acceptableAxes.support.includes('contradicted'));
  assert.deepEqual(modelReference.acceptableAxes.correctness, ['consistent_with_sources', 'uncertain'], 'uncertain source correctness is defensible for an unsupported relationship without an explicit contradiction');
});

test('references distinguish supported omissions, explicit report contradictions, and absent specifications', () => {
  const data = calibrationFixtureDataset();
  const partial = data.cases.find(item => item.input.answer.answer === 'The base is aluminum.')!;
  const partialReference = data.references.find(item => item.caseId === partial.id)!;
  assert.equal(partialReference.support, 'supported'); assert.equal(partialReference.questionCoverage, 'incomplete');
  assert.ok(partial.input.question.includes('base and shade')); assert.ok(partial.input.evidence.some(source => source.text.includes('Its shade is fabric.')));

  const report = data.cases.find(item => item.input.answer.answer.startsWith('Both customers'))!;
  const reportReference = data.references.find(item => item.caseId === report.id)!;
  assert.equal(reportReference.support, 'contradicted'); assert.equal(reportReference.uncertaintyHandling, 'overconfident');
  assert.ok(reportReference.spans.some(span => span.role === 'conflict' && span.quote.includes('leaked into my bag')));
  assert.ok(report.input.answer.citations.every(citation => !citation.quote.includes('leaked into my bag')));

  const missing = data.cases.find(item => item.input.answer.answer.includes('100°C'))!;
  const missingReference = data.references.find(item => item.caseId === missing.id)!;
  assert.equal(missingReference.support, 'unsupported'); assert.deepEqual(missingReference.acceptableAxes.answerability, ['insufficient']);
  assert.ok(missing.input.evidence.every(source => !source.text.includes('temperature') && !source.text.includes('100')));
  assert.ok(missing.input.answer.citations.some(citation => citation.quote === 'a 2-liter capacity'), 'irrelevant evidence is still a literal-valid body quote');
  const abstention = data.references.find(item => item.familyId === missing.familyId && item.answerQuality === 'good')!;
  assert.equal(abstention.support, 'non_factual'); assert.equal(abstention.uncertaintyHandling, 'appropriate'); assert.deepEqual(abstention.acceptableDispositions, ['abstain']);
});

test('constructed reference axes route consistently without pretending a good abstention is a runtime pass', () => {
  const data = calibrationFixtureDataset();
  for (const item of data.cases) {
    const reference = data.references.find(value => value.caseId === item.id)!;
    const request = parts(item);
    const proofFor = (ref: CalibrationReference): ClaimSupportWireOutput['units'][number]['evidence'] => ref.support === 'supported'
      ? item.input.answer.citations.map(citation => ({ sourceId: citation.passageId, quote: citation.quote, relation: 'supports' as const })).slice(0, 3)
      : ref.support === 'contradicted' ? ref.spans.filter(span => span.role === 'conflict').map(span => ({ sourceId: span.sourceId, quote: span.quote, relation: 'contradicts' as const })) : [];
    const scripted: ClaimSupportWireOutput = { units: request.units.map(unit => ({ unitId: unit.id, verdict: reference.support, evidence: proofFor(reference), reason: 'Constructed reference contract check; no semantic model assessment.' })), questionCoverage: reference.questionCoverage,
      answerability: reference.acceptableAxes.answerability[0]!, correctness: reference.acceptableAxes.correctness[0]!, uncertaintyHandling: reference.uncertaintyHandling, reason: 'Constructed source-limited reference contract check, pending independent source review.' };
    const assessed = validateClaimSupportOutput({ runId: `fixture:${item.id}`, ...item.input }, scripted, 'synthetic_scripted_claim_support');
    assert.ok(reference.acceptableDispositions.includes(assessed.disposition));
    assert.equal(assessed.calibration, 'not_measured'); assert.equal(assessed.qualityClaimEligible, false);
    if (reference.answerQuality === 'flawed') assert.notEqual(assessed.disposition, 'pass');
    if (item.input.answer.status === 'insufficient_evidence') assert.equal(assessed.disposition, 'abstain');
  }
});

test('dataset calls and paired cases return independent mutable copies with deterministic identities', () => {
  const first = calibrationFixtureDataset(), pristine = calibrationFixtureDataset(), original = JSON.stringify(pristine);
  assert.deepEqual(first, pristine);
  const pairedBefore = JSON.stringify(first.cases[1]);
  first.cases[0].input.evidence[0].text = 'Caller mutation'; first.cases[0].input.product.title = 'Caller mutation'; first.cases[0].input.answer.citations[0].quote = 'Caller mutation';
  first.references[0].spans[0].quote = 'Caller mutation'; first.references[0].acceptableAxes.support.push('uncertain');
  assert.equal(JSON.stringify(first.cases[1]), pairedBefore, 'one case never aliases its paired input');
  assert.equal(JSON.stringify(pristine), original); assert.equal(JSON.stringify(calibrationFixtureDataset()), original);
});
