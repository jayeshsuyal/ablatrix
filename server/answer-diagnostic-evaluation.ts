import assert from 'node:assert/strict';
/** Semantic judgments require source checking. These records are measurements, never automatic truth. */
export const ANSWER_DIAGNOSTIC_RUBRIC = Object.freeze({
  usefulFactCompleteness: 'For each predesignated useful fact: covered / missing / distorted / uncertain; retain its source qualification. Report covered/count, without rewarding irrelevant specifications.',
  unsupportedClaims: 'List every substantive claim lacking a supporting source and exact quotation. Report count and material severity, including invented averages or relationships.',
  exactApplicability: 'pass / fail / uncertain for exact model, part, variant and workflow. Identifier overlap alone is not compatibility proof.',
  appropriateUncertainty: 'pass / fail / uncertain; preserve conflicting reports, tentative language, manual stop versus exhaustion and unknown conditions. Do not require a universal average from anecdotal reports.',
  directRelevance: 'pass / fail / uncertain for answering the actual question with useful supported facts and the specific remaining gap.',
  literalCitationMatching: 'Mechanical source ID and quote equality to the exact offered body; separate from whether that quote supports the claim.'
});
export type SourceCheckedJudgment = { itemId: string; reviewer: string; provenance: 'source_checked_human' | 'ai_provisional'; sourcePoolSha256: string; answerSha256: string; facts: { factId: string; status: 'covered' | 'missing' | 'distorted' | 'uncertain'; sourceIds: string[]; rationale: string }[]; unsupportedClaims: { claim: string; severity: 'material' | 'minor'; rationale: string }[]; exactApplicability: 'pass' | 'fail' | 'uncertain'; appropriateUncertainty: 'pass' | 'fail' | 'uncertain'; directRelevance: 'pass' | 'fail' | 'uncertain' };
export function calibratedAIReview(reference: SourceCheckedJudgment[], predicted: SourceCheckedJudgment[]) {
  assert.ok(reference.length && reference.every(r => r.provenance === 'source_checked_human'));
  assert.equal(new Set(reference.map(r => r.itemId)).size, reference.length); assert.equal(predicted.length, reference.length);
  const disagreements: { itemId: string; axis: string }[] = []; let axes = 0;
  for (const human of reference) {
    const ai = predicted.find(p => p.itemId === human.itemId); assert.ok(ai && ai.provenance === 'ai_provisional');
    assert.equal(ai.sourcePoolSha256, human.sourcePoolSha256); assert.equal(ai.answerSha256, human.answerSha256);
    for (const axis of ['exactApplicability', 'appropriateUncertainty', 'directRelevance'] as const) { axes++; if (human[axis] !== ai[axis]) disagreements.push({ itemId: human.itemId, axis }); }
    assert.equal(new Set(ai.facts.map(f => f.factId)).size, ai.facts.length); assert.equal(ai.facts.length, human.facts.length);
    for (const fact of human.facts) { const other = ai.facts.find(f => f.factId === fact.factId); assert.ok(other); axes++; if (fact.status !== other.status) disagreements.push({ itemId: human.itemId, axis: `fact:${fact.factId}` }); }
    axes++; if (JSON.stringify(human.unsupportedClaims.map(c => [c.claim, c.severity]).sort()) !== JSON.stringify(ai.unsupportedClaims.map(c => [c.claim, c.severity]).sort())) disagreements.push({ itemId: human.itemId, axis: 'unsupportedClaims' });
  }
  return { calibrationItems: reference.length, axisAgreement: (axes - disagreements.length) / axes, disagreementsForFocusedHumanReview: disagreements, label: 'AI calibration agreement on a small human source-checked reference set; not population accuracy or ground truth', qualityClaimEligible: false };
}
