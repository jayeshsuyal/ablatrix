import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { COVERAGE_CONFIDENCE_GRADER_VERSION, claimSupportPromptIdentity, claimSupportRequestParts, validateClaimSupportOutput, type ClaimSupportWireOutput } from './claim-support.ts';
import { calibrationFixtureDataset, abstentionCalibrationFixtureDataset, coverageConfidenceCalibrationFixtureDataset } from './grader-calibration-fixtures.ts';
import { qualificationFixtureDataset, type QualificationAxes } from './grader-qualification-fixtures.ts';

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('qualification cohort contains 80 distinct packets, the frozen balance and four transfer categories', () => {
  const dataset = qualificationFixtureDataset();
  assert.equal(dataset.cases.length, 80); assert.equal(dataset.references.length, 80);
  assert.equal(new Set(dataset.cases.map(item => item.id)).size, 80);
  assert.equal(new Set(dataset.cases.map(item => item.productFamilyId)).size, 80);
  assert.equal(new Set(dataset.cases.map(item => item.input.product.id)).size, 80);
  assert.equal(new Set(dataset.cases.map(item => item.input.product.title)).size, 80);
  assert.equal(new Set(dataset.cases.map(item => sha(item.input.evidence))).size, 80);
  assert.equal(new Set(dataset.cases.flatMap(item => item.input.evidence.map(source => source.id))).size, dataset.cases.reduce((count, item) => count + item.input.evidence.length, 0));
  assert.equal(dataset.references.filter(reference => reference.answerQuality === 'flawed').length, 60);
  assert.equal(dataset.references.filter(reference => reference.acceptableKind === 'factual').length, 12);
  assert.equal(dataset.references.filter(reference => reference.acceptableKind === 'qualified').length, 4);
  assert.equal(dataset.references.filter(reference => reference.acceptableKind === 'refusal').length, 4);
  for (const [category, count] of Object.entries(dataset.categoryCounts)) assert.equal(count, category === 'acceptable_factual' ? 12 : category.startsWith('acceptable_') ? 4 : 5);
  for (const category of ['conditional_exceptions', 'temporal_updates', 'comparisons', 'source_instructions']) assert.equal(dataset.cases.filter(item => item.category === category).length, 5);
  assert.deepEqual(dataset, qualificationFixtureDataset());
  dataset.references[0].axes.support.push('uncertain');
  assert.equal(qualificationFixtureDataset().references[0].axes.support.length, 1, 'separate preparations cannot mutate each other');
});

test('case products and full packets do not duplicate prior development cohorts or worked-example prototypes', () => {
  const dataset = qualificationFixtureDataset();
  const priorCases = [calibrationFixtureDataset(), abstentionCalibrationFixtureDataset(), coverageConfidenceCalibrationFixtureDataset()].flatMap(item => item.cases);
  const oldTitles = new Set(priorCases.map(item => item.input.product.title.toLowerCase()));
  const oldIds = new Set(priorCases.map(item => item.id));
  const oldPackets = new Set(priorCases.map(item => sha(item.input.evidence.map(source => source.text))));
  const oldProductNames = new Set(priorCases.map(item => item.input.product.title.replace(/^Fictional /, '').split(' ')[0].toLowerCase()));
  const workedExamples = claimSupportPromptIdentity(COVERAGE_CONFIDENCE_GRADER_VERSION).systemInstructions.split('Worked rubric examples')[1]!;
  for (const item of dataset.cases) {
    assert.ok(!oldTitles.has(item.input.product.title.toLowerCase())); assert.ok(!oldIds.has(item.id));
    assert.ok(!oldPackets.has(sha(item.input.evidence.map(source => source.text))));
    assert.ok(!oldProductNames.has(item.input.product.title.split(' ')[0].toLowerCase()));
    assert.ok(!workedExamples.toLowerCase().includes(item.input.product.title.toLowerCase()));
  }
  assert.equal(claimSupportPromptIdentity(COVERAGE_CONFIDENCE_GRADER_VERSION).systemInstructionsSha256, 'ffae52c2c183f909047f1867a73a505440b1ee22fe8b5db2d9e4a591a86e0067');
  assert.equal(dataset.freshness.productDisjointFromDevelopment, true);
  assert.match(dataset.freshness.limitations.join(' '), /some categories deliberately overlap/i);
  assert.match(dataset.freshness.limitations.join(' '), /not statistical independence/);
});

test('only bounded source-limited input reaches the frozen grader, never labels, rationale or source review', () => {
  const dataset = qualificationFixtureDataset();
  for (const item of dataset.cases) {
    const reference = dataset.references.find(reference => reference.caseId === item.id)!;
    const parts = claimSupportRequestParts({ runId: `qualification-input-test:${item.id}`, ...item.input });
    assert.equal(parts.prompt.promptVersion, COVERAGE_CONFIDENCE_GRADER_VERSION);
    assert.equal(parts.units.length, 1); assert.ok(item.input.answer.answer.length <= 500);
    assert.equal(parts.payload.answerUnits[0].text, item.input.answer.answer);
    const serialized = JSON.stringify(parts.payload);
    for (const privateField of ['answerQuality', 'acceptableKind', 'acceptableDispositions', 'criticalAxes', 'rationale', 'categoryCounts', 'productFamilyId', 'reviewStatus', 'humanGold', 'externalTruthVerified']) assert.ok(!serialized.includes(`"${privateField}":`));
    assert.ok(!serialized.includes(reference.rationale)); assert.ok(!serialized.includes(item.id));
    assert.equal(parts.body.messages[1].content, JSON.stringify(parts.payload));
    for (const span of reference.spans) {
      const source = item.input.evidence.find(source => source.id === span.sourceId);
      assert.ok(source); assert.ok(source.text.includes(span.quote));
    }
    for (const citation of item.input.answer.citations) assert.ok(item.input.evidence.find(source => source.id === citation.passageId)?.text.includes(citation.quote));
  }
  assert.deepEqual(dataset.provenance, { authorship: 'ai_authored_constructed_reference', reviewStatus: 'pending_independent_source_review', humanGold: false, externalTruthVerified: false });
});

test('all declared reference alternatives form valid independent-axis controls with honest dispositions', () => {
  const dataset = qualificationFixtureDataset();
  for (const item of dataset.cases) {
    const reference = dataset.references.find(reference => reference.caseId === item.id)!;
    assert.deepEqual(reference.criticalAxes, ['support', 'questionCoverage', 'uncertaintyHandling']);
    for (const values of Object.values(reference.axes)) { assert.ok(values.length > 0); assert.equal(new Set(values).size, values.length); }
    assert.equal(Boolean(reference.acceptableKind), reference.answerQuality === 'acceptable');
    assert.ok(reference.rationale.trim().length > 40); assert.ok(reference.spans.length > 0);
    // These scripted controls test only schema/route compatibility of the
    // human-readable reference contract. They are not live model judgments.
    for (const correctness of reference.axes.correctness) {
      const input = { runId: `synthetic-reference-contract:${item.id}`, ...item.input }, parts = claimSupportRequestParts(input), verdict = reference.axes.support[0];
      const firstCitation = input.answer.citations[0], firstSpan = reference.spans[0];
      const output: ClaimSupportWireOutput = { units: [{ unitId: parts.units[0].id, verdict, evidence: verdict === 'supported' ? [{ sourceId: firstCitation.passageId, quote: firstCitation.quote, relation: 'supports' }] : verdict === 'contradicted' ? [{ sourceId: firstSpan.sourceId, quote: firstSpan.quote, relation: 'contradicts' }] : [], reason: 'SYNTHETIC reference-schema compatibility control, no model judgment.' }], questionCoverage: reference.axes.questionCoverage[0], answerability: reference.axes.answerability[0], correctness, uncertaintyHandling: reference.axes.uncertaintyHandling[0], reason: 'SYNTHETIC offline reference contract only.' };
      const result = validateClaimSupportOutput(input, output, 'synthetic_scripted_claim_support');
      assert.ok(reference.acceptableDispositions.includes(result.disposition));
      assert.equal(result.qualityClaimEligible, false); assert.equal(result.calibration, 'not_measured');
      if (reference.answerQuality === 'flawed') assert.notEqual(result.disposition, 'pass');
      if (reference.acceptableKind === 'refusal') { assert.equal(result.disposition, 'abstain'); assert.deepEqual(result.units[0].evidence, []); }
      if (reference.acceptableKind === 'factual' || reference.acceptableKind === 'qualified') assert.equal(result.disposition, 'pass');
    }
  }
});

test('citation semantics, missing facets, refusals and certainty remain distinct in references', () => {
  const dataset = qualificationFixtureDataset();
  for (const item of dataset.cases) {
    const reference = dataset.references.find(reference => reference.caseId === item.id)!;
    const expected: Partial<Record<typeof item.category, Partial<QualificationAxes>>> = {
      citation_semantics: { support: ['unsupported', 'supported'], correctness: ['consistent_with_sources'], uncertaintyHandling: ['overconfident', 'appropriate'] },
      partial_coverage: { support: ['supported'], questionCoverage: ['incomplete'], uncertaintyHandling: ['appropriate'] },
      unnecessary_refusal: { support: ['non_factual'], answerability: ['answerable'], questionCoverage: ['incomplete'], uncertaintyHandling: ['unnecessary_abstention'] },
      acceptable_refusal: { support: ['non_factual'], questionCoverage: ['complete'], uncertaintyHandling: ['appropriate'] },
      acceptable_qualified: { support: ['supported'], questionCoverage: ['complete'], uncertaintyHandling: ['appropriate'] },
      mixed_unsupported: { support: ['unsupported'], uncertaintyHandling: ['overconfident'] }
    };
    for (const [axis, values] of Object.entries(expected[item.category] ?? {})) assert.deepEqual(reference.axes[axis as keyof QualificationAxes], values);
    if (item.category === 'wrong_model_context') assert.ok(item.input.evidence.some(source => source.originalQuestion && source.originalQuestion !== item.input.question));
    if (reference.axes.support[0] === 'non_factual') assert.deepEqual(item.input.answer.citations, []);
  }
  const refusals = dataset.references.filter(ref => ref.acceptableKind === 'refusal');
  assert.equal(refusals.filter(ref => ref.axes.answerability[0] === 'conflicting').length, 2);
  assert.equal(refusals.filter(ref => ref.axes.answerability[0] === 'insufficient').length, 2);
});
