import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimSupportRequestParts } from './claim-support.ts';
import { CITED_APPLICABILITY_GRADER_VERSION as VERSION } from './claim-support-v4.ts';
import { V4_QUALIFICATION_CODE_FILES, v4ExposureLedger, v4ExposureFingerprints, assertV4Freshness, prepareV4QualificationPlan, verifyV4QualificationPlan, v4QualificationHash as sha, type V4QualificationCase } from './grader-v4-qualification.ts';

function fictionalDevelopmentCases(): V4QualificationCase[] {
  // These newly constructed, immediately exposed fixtures exercise plan
  // mechanics. They are not an unseen qualification cohort or human gold.
  return Array.from({ length: 12 }, (_, index) => {
    const source = { id: `development-source-${index}`, source: 'New fictional development specification', text: `Fictional vessel ${index} holds six cups and has a cork lid.` }, flawed = index % 2 === 1, length = [100, 700, 1500][index % 3], claim = `Fictional vessel ${index} holds ${flawed ? 'ninety' : 'six'} cups. `;
    const answer = claim.repeat(Math.ceil(length / claim.length)).slice(0, length);
    const input: V4QualificationCase['input'] = { graderVersion: VERSION, question: `How many cups does fictional vessel ${index} hold?`, product: { id: `development-product-${index}`, title: `Fictional vessel ${index}` }, answer: { answer, status: 'answered', citations: [{ passageId: source.id, quote: source.text }] }, evidence: [source] };
    const parts = claimSupportRequestParts({ ...input, runId: `development-${index}` });
    return { id: `development-case-${index}`, input, productFamilyKeys: [`canonical development family ${index}`], reference: { answerQuality: flawed ? 'flawed' : 'acceptable', output: { units: parts.units.map(unit => ({ unitId: unit.id, factualConsistency: flawed ? 'not_established' : 'consistent', citedSupport: flawed ? 'unsupported' : 'supported', applicability: 'applicable', evidence: flawed ? [] : [{ sourceId: source.id, quote: source.text, relation: 'supports' }], citedCitationIndexes: [0], reason: 'New exposed fictional development control.' })), questionCoverage: 'complete', answerability: 'answerable', uncertaintyHandling: flawed ? 'overconfident' : 'appropriate', reason: 'Offline development mechanics; not a qualification result.' }, acceptableDispositions: [flawed ? 'repair' : 'pass'], boundarySpanningAssertion: length > 500, rationale: 'Constructed development reference, pending independent review.', provenance: 'constructed_reference_pending_independent_review' } };
  });
}
function options() { return { cohortId: 'exposed-development-plan-mechanics', cases: fictionalDevelopmentCases(), exposureHistory: v4ExposureLedger(), implementationCommit: 'a'.repeat(40), codeFileSha256: Object.fromEntries(V4_QUALIFICATION_CODE_FILES.map(path => [path, sha(path)])) }; }

test('prospective v4 scope covers every runtime unit count and maximum while remaining pending and unapproved', () => {
  const settings = options(), result = prepareV4QualificationPlan(settings), plan = result.plan;
  assert.equal(plan.proposedCalls, 15); assert.equal(plan.proposedAdditionalAllowanceUsd, 1.5); assert.equal(plan.paidExecutionApproved, false); assert.equal(plan.liveQualified, false); assert.equal(plan.qualificationStatus, 'pending'); assert.equal(plan.sourceReview, 'pending_independent_source_and_family_alias_review');
  assert.deepEqual(plan.operatingScope.coveredUnitCounts, [1, 2, 3]); assert.equal(plan.operatingScope.maximumAnswerCharacters, 1500); assert.equal(plan.operatingScope.includesBoundarySpanningAssertion, true); assert.equal(plan.slots.filter(slot => slot.role === 'repeat').length, 3);
  assert.equal(result.exposureHistory.entries.length, 12); assert(result.exposureHistory.entries.every(entry => entry.status === 'reserved')); assert.deepEqual(verifyV4QualificationPlan(plan, settings), plan);
  for (const slot of plan.slots) { const item = plan.cases.find(item => item.id === slot.caseId)!, body = JSON.stringify(claimSupportRequestParts({ ...item.input, runId: slot.runId }).body); assert(!body.includes('answerQuality')); assert(!body.includes('acceptableDispositions')); assert(!body.includes(item.reference.rationale)); }
});
test('case/source/family exposure survives renaming, regrouping and alternate identifiers', () => {
  const original = fictionalDevelopmentCases()[0], fingerprint = v4ExposureFingerprints(original.input, original.productFamilyKeys), history = v4ExposureLedger([{ cohortId: 'already-exposed-development', ...fingerprint, status: 'consumed' }]);
  const renamed = structuredClone(original); renamed.id = 'new-case-group'; renamed.productFamilyKeys = ['renamed family alias']; renamed.input.product = { id: 'renamed-product', title: 'Renamed product label' }; renamed.input.evidence[0].id = 'renamed-source'; renamed.input.evidence[0].source = 'Renamed source label'; renamed.input.answer.citations[0].passageId = 'renamed-source';
  assert.throws(() => assertV4Freshness(v4ExposureFingerprints(renamed.input, renamed.productFamilyKeys), history), /already reserved or exposed/);
  const related = fictionalDevelopmentCases()[1]; assert.throws(() => assertV4Freshness(v4ExposureFingerprints(related.input, original.productFamilyKeys), history), /related product family/);
  assert.throws(() => prepareV4QualificationPlan({ ...options(), exposureHistory: history }), /already reserved or exposed/);
});
test('plans reject erased units, short-only scope, changed references and changed history or code', () => {
  const settings = options(), plan = prepareV4QualificationPlan(settings).plan;
  const shortOnly = options(); shortOnly.cases = shortOnly.cases.map(item => { const copy = structuredClone(item); copy.input.answer.answer = copy.input.answer.answer.slice(0, 100); const units = claimSupportRequestParts({ ...copy.input, runId: 'short-scope' }).units; copy.reference.output.units = units.map(unit => ({ ...copy.reference.output.units[0], unitId: unit.id })); return copy; });
  assert.throws(() => prepareV4QualificationPlan(shortOnly), /one, two and three unit/);
  const omitted = options(); omitted.cases[2].reference.output.units.pop(); assert.throws(() => prepareV4QualificationPlan(omitted), /omitted/);
  const edited = structuredClone(plan); edited.cases[0].reference.rationale += ' Changed after freeze.'; edited.planSha256 = sha({ ...edited, planSha256: undefined }); assert.throws(() => verifyV4QualificationPlan(edited, settings), /differs from frozen/);
  const changedCode = { ...settings, codeFileSha256: { ...settings.codeFileSha256, [V4_QUALIFICATION_CODE_FILES[0]]: 'b'.repeat(64) } }; assert.throws(() => verifyV4QualificationPlan(plan, changedCode), /differs from frozen/);
});
