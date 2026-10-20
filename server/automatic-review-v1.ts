/** Versioned exploratory review rule. This never dispatches, promotes a policy,
 * creates human provenance, or changes a previously frozen review decision. */
import assert from 'node:assert/strict';
import { z } from 'zod';
import { REPORT_CALIBRATION_V1, type ReportCalibrationPreparation } from '../scripts/prepare-report-calibration-v1.ts';
import { diagnosticHash, type anonymousDiagnosticReview } from './three-context-diagnostic.ts';
import { importThreeContextReview, type ImportedThreeContextReview, type ThreeContextEvaluationPacket } from './three-context-evaluation.ts';
import { reportCalibrationNeutralComparisonPairs } from './report-calibration-outcome.ts';
import { WORKSPACE_UNCERTAINTY_CONTRACT } from './workspace-uncertainty-policy.ts';

type Mapping = ReturnType<typeof anonymousDiagnosticReview>['mapping'];
type Entry = ImportedThreeContextReview['review']['entries'][number];
type Within = NonNullable<ImportedThreeContextReview['review']['comparisons']>[number];
const hash = z.string().regex(/^[a-f0-9]{64}$/), text = z.string().trim().min(1);
const evidence = z.object({ sourceId: text, quote: text, originalQuestion: z.string().nullable() }).strict();
const comparison = z.object({ firstLabel: text, secondLabel: text, outcome: z.enum(['first_preferred', 'second_preferred', 'tie', 'uncertain']), rationale: z.string().trim().min(20) }).strict();
export const automaticCrossReviewSchema = z.object({ format: z.literal('ablatrix-report-calibration-cross-instruction-review-v1'), packetSha256: hash,
  reviewer: text, provenance: z.literal('ai_provisional'), sourceReviewSha256: hash, comparisons: z.array(comparison).length(12) }).strict();
export type AutomaticCrossReview = z.infer<typeof automaticCrossReviewSchema>;
const resolution = { rationale: z.string().trim().min(20), evidence: z.array(evidence).min(1), answerQuotes: z.array(z.object({ label: text, quote: text }).strict()) };
export const automaticAdjudicationSchema = z.object({ format: z.literal('ablatrix-automatic-source-adjudication-v1'), packetSha256: hash, requestSha256: hash,
  adjudicator: text, provenance: z.literal('ai_source_adjudication'), recordedAt: z.iso.datetime(), independentlyAuthored: z.literal(true), sourceChecked: z.literal(true),
  independentReviewSha256: z.array(hash).length(2), independentCrossReviewSha256: z.array(hash).length(2),
  adjudicatorReview: z.object({ format: z.literal('ablatrix-imported-source-review-v1'), packetSha256: hash, reviewSha256: hash, review: z.unknown() }).strict(),
  adjudicatorCrossReview: automaticCrossReviewSchema,
  axisResolutions: z.array(z.object({ label: text, axis: text, disposition: z.enum(['source_resolved', 'remains_uncertain']), ...resolution }).strict()),
  pairResolutions: z.array(z.object({ firstLabel: text, secondLabel: text, outcome: comparison.shape.outcome, ...resolution }).strict()).length(36),
  humanAnswerQualityJudgments: z.literal(0), qualityClaimEligible: z.literal(false), activationAllowed: z.literal(false), freshExecutionAuthorized: z.literal(false) }).strict();
export type AutomaticAdjudication = z.infer<typeof automaticAdjudicationSchema>;
export type AutomaticReviewInputs = { preparation: ReportCalibrationPreparation; packet: ThreeContextEvaluationPacket; mapping: Mapping;
  independentReviews: ImportedThreeContextReview[]; crossReviews: unknown[] };
const key = (a: string, b: string) => JSON.stringify([a, b].sort());
const axisValues = (e: Entry): Record<string, string> => ({ ...Object.fromEntries(e.facts.map(f => [`fact:${f.factId}`, f.status])),
  unsupportedClaims: JSON.stringify(e.unsupportedClaims.map(c => [c.claim, c.severity]).sort()), exactApplicability: e.exactApplicability.judgment,
  appropriateUncertainty: e.appropriateUncertainty.judgment, directRelevance: e.directRelevance.judgment, ...Object.fromEntries(e.unknowns.map(u => [`unknown:${u.unknown}`, u.status])) });
const uncertainValue = (value: string) => value === 'uncertain';
const negativeAxes = (e: Entry) => new Set([...e.facts.filter(f => f.status === 'missing' || f.status === 'distorted').map(f => `fact:${f.factId}`),
  ...e.unsupportedClaims.some(c => c.severity === 'material') ? ['unsupportedClaims'] : [],
  ...(['exactApplicability', 'appropriateUncertainty', 'directRelevance'] as const).filter(a => e[a].judgment === 'fail'),
  ...e.unknowns.filter(u => u.status === 'missing' || u.status === 'contradicted').map(u => `unknown:${u.unknown}`)]);
function checkedReview(packet: ThreeContextEvaluationPacket, raw: ImportedThreeContextReview) {
  const r = importThreeContextReview(packet, raw.review); assert.deepEqual(r, raw);
  assert.equal(r.review.provenance, 'ai_provisional', 'Automated records keep their actual AI provenance.'); assert.equal(r.review.purpose, 'independent_review');
  assert.equal(r.review.entries.length, 24); assert.deepEqual(r.review.entries.map(e => e.label).sort(), packet.answers.map(a => a.label).sort());
  return r;
}
function checkedCross(packet: ThreeContextEvaluationPacket, raw: unknown, review: ImportedThreeContextReview, pairs: { firstLabel: string; secondLabel: string }[]) {
  const c = automaticCrossReviewSchema.parse(raw); assert.equal(c.packetSha256, packet.sha256); assert.equal(c.reviewer, review.review.reviewer); assert.equal(c.sourceReviewSha256, review.reviewSha256);
  assert.deepEqual(c.comparisons.map(p => key(p.firstLabel, p.secondLabel)).sort(), pairs.map(p => key(p.firstLabel, p.secondLabel)).sort(), 'Exactly the twelve matched cross-instruction pairs are required.');
  return c;
}
function checkedInputs(input: AutomaticReviewInputs) {
  const { preparation: p, packet, mapping } = input, neutral = reportCalibrationNeutralComparisonPairs(p, packet, mapping);
  assert.equal(input.independentReviews.length, 2, 'This version requires exactly two independent full reviews, retaining both.');
  const reviews = input.independentReviews.map(r => checkedReview(packet, r)).sort((a, b) => a.review.reviewer.localeCompare(b.review.reviewer));
  assert.equal(new Set(reviews.map(r => r.review.reviewer)).size, 2, 'Independent reviewer identities must differ.'); assert.equal(new Set(reviews.map(r => r.reviewSha256)).size, 2);
  for (const r of reviews) assert.deepEqual((r.review.comparisons ?? []).map(p => key(p.firstLabel, p.secondLabel)).sort(), neutral.withinInstancePairs.map(p => key(p.firstLabel, p.secondLabel)).sort(), 'Every reviewer must supply all 24 within-instance comparisons.');
  assert.equal(input.crossReviews.length, 2);
  const cross = reviews.map(r => { const matches = input.crossReviews.filter(c => typeof c === 'object' && c !== null && 'reviewer' in c && c.reviewer === r.review.reviewer); assert.equal(matches.length, 1); return checkedCross(packet, matches[0], r, neutral.crossInstructionPairs); });
  // The source-only factorial design has 3 gap facts and 1 control fact, each
  // judged under two instructions, two repeats and three contexts: 48 units.
  assert.equal(packet.cases.reduce((n, c) => n + c.designatedFacts.length * 3, 0), 48, 'The frozen 48 designated fact judgments must all remain present.');
  return { neutral, reviews, cross };
}
const entry = (r: ImportedThreeContextReview, label: string) => r.review.entries.find(e => e.label === label)!;
const verdicts = (r: ImportedThreeContextReview, c: AutomaticCrossReview) => [...r.review.comparisons ?? [], ...c.comparisons];
const preferredLabel = (p: Pick<Within, 'firstLabel' | 'secondLabel' | 'outcome'>) => p.outcome === 'first_preferred' ? p.firstLabel : p.outcome === 'second_preferred' ? p.secondLabel : p.outcome;

/** No private condition/mapping or execution identity is exposed in this task.
 * The third reviewer must inspect sources and answers, not vote on preferences. */
export function buildAutomaticAdjudicationRequest(input: AutomaticReviewInputs) {
  const { neutral, reviews, cross } = checkedInputs(input), { packet } = input;
  const disputedAxes = packet.answers.flatMap(a => {
    const values = reviews.map(r => axisValues(entry(r, a.label)));
    return Object.keys(values[0]!).filter(axis => new Set(values.map(v => v[axis])).size > 1 || values.some(v => uncertainValue(v[axis]!)) || reviews.some(r => negativeAxes(entry(r, a.label)).has(axis))).sort().map(axis => ({ label: a.label, axis,
      originalJudgments: reviews.map((r, i) => ({ reviewer: r.review.reviewer, reviewSha256: r.reviewSha256, value: values[i]![axis] })) }));
  });
  const pairs = [...neutral.withinInstancePairs.map(({ firstLabel, secondLabel }) => ({ firstLabel, secondLabel })), ...neutral.crossInstructionPairs]
    .sort((a, b) => key(a.firstLabel, a.secondLabel).localeCompare(key(b.firstLabel, b.secondLabel)));
  assert.equal(new Set(pairs.map(p => key(p.firstLabel, p.secondLabel))).size, 36);
  const document = { format: 'ablatrix-automatic-adjudication-request-v1', rule: 'ablatrix-automatic-exploratory-review-rule-v1', packetSha256: packet.sha256,
    packet: structuredClone(packet), independentReviews: structuredClone(reviews), crossReviews: structuredClone(cross), disputedAxes, pairs,
    instruction: 'Independently judge all 24 answers and all 36 exact anonymous pairs from complete sources and originalQuestion scope. Create a third full AI review and cross review, plus one literal-source-evidenced resolution per disputed axis and per pair. Resolve by source evidence rather than majority vote. Preserve uncertainty if sources or answers do not settle it; do not treat a citation as entailment. Keep advertised claims, individual reports, manual stopping, unknown conditions and statistics distinct. Give no human provenance or promotion claim.',
    humanAnswerQualityJudgments: 0, qualityClaimEligible: false, activationAllowed: false, freshExecutionAuthorized: false };
  return { ...document, sha256: diagnosticHash(document) };
}

function checkEvidence(packet: ThreeContextEvaluationPacket, labels: string[], r: { evidence: z.infer<typeof evidence>[]; answerQuotes: { label: string; quote: string }[] }) {
  const cases = labels.map(label => packet.cases.find(c => c.id === packet.answers.find(a => a.label === label)!.caseId)!);
  for (const e of r.evidence) assert.ok(cases.every(c => c.completeSources.some(s => s.id === e.sourceId && s.text.includes(e.quote) && (s.originalQuestion ?? null) === e.originalQuestion)), 'Adjudication evidence must preserve literal source bodies and originalQuestion scope for every compared answer.');
  assert.deepEqual(r.answerQuotes.map(q => q.label).sort(), [...labels].sort(), 'Each resolved answer requires exactly one literal answer quote.');
  for (const q of r.answerQuotes) assert.ok(q.quote.trim() && labels.includes(q.label) && packet.answers.find(a => a.label === q.label)!.output!.answer.includes(q.quote), 'Adjudication answer quotes must be literal and belong to this resolution.');
}
function delta(control: Entry, candidate: Entry) {
  const material: string[] = [], uncertainty: string[] = [], improvements: string[] = [], omissions: string[] = [];
  for (const f of candidate.facts) {
    const old = control.facts.find(o => o.factId === f.factId)!;
    if (f.status === 'distorted' || old.status === 'covered' && f.status === 'missing') material.push(`fact:${f.factId}`);
    if (f.status === 'uncertain' || old.status === 'uncertain') uncertainty.push(`fact:${f.factId}`);
    if (f.status === 'covered' && old.status !== 'covered') improvements.push(`fact:${f.factId}`);
  }
  if (candidate.unsupportedClaims.some(c => c.severity === 'material')) material.push('unsupportedClaims');
  for (const axis of ['exactApplicability', 'appropriateUncertainty', 'directRelevance'] as const) {
    if (candidate[axis].judgment === 'fail' && (axis === 'exactApplicability' || control[axis].judgment !== 'fail')) material.push(axis);
    if (candidate[axis].judgment === 'uncertain' || control[axis].judgment === 'uncertain') uncertainty.push(axis);
    if (candidate[axis].judgment === 'pass' && control[axis].judgment !== 'pass') improvements.push(axis);
  }
  for (const u of candidate.unknowns) {
    const old = control.unknowns.find(o => o.unknown === u.unknown)!;
    // Omitting an unknown does not itself assert a measurement, average or
    // endpoint. Keep that omission visible; contradictory claims and lost
    // designated qualifications are assessed separately and remain material.
    if (u.status === 'contradicted') material.push(`unknown:${u.unknown}`);
    if (u.status === 'missing') omissions.push(u.unknown);
    if (u.status === 'preserved' && (old.status === 'missing' || old.status === 'contradicted')) improvements.push(`unknown:${u.unknown}`);
  }
  return { confirmedMaterialRegressions: [...new Set(material)], unresolvedUncertainty: [...new Set(uncertainty)], nonmaterialUnknownOmissions: omissions, improvements };
}

/** Actual execution/canonical receipt provenance remains a separate mandatory
 * caller check. A structurally valid AI attestation is not semantic ground truth. */
export function verifyAutomaticDevelopmentReview(input: AutomaticReviewInputs & { adjudication: unknown }) {
  const { preparation: p, packet, mapping } = input, request = buildAutomaticAdjudicationRequest(input), { reviews, cross, neutral } = checkedInputs(input);
  const a = automaticAdjudicationSchema.parse(input.adjudication); assert.equal(a.packetSha256, packet.sha256); assert.equal(a.requestSha256, request.sha256);
  assert.deepEqual(a.independentReviewSha256, reviews.map(r => r.reviewSha256)); assert.deepEqual(a.independentCrossReviewSha256, cross.map(c => diagnosticHash(c)));
  const third = checkedReview(packet, a.adjudicatorReview as ImportedThreeContextReview); assert.equal(third.review.reviewer, a.adjudicator); assert.ok(!reviews.some(r => r.review.reviewer === a.adjudicator), 'The adjudicator must differ from both independent reviewers.');
  assert.deepEqual((third.review.comparisons ?? []).map(c => key(c.firstLabel, c.secondLabel)).sort(), neutral.withinInstancePairs.map(c => key(c.firstLabel, c.secondLabel)).sort());
  const thirdCross = checkedCross(packet, a.adjudicatorCrossReview, third, neutral.crossInstructionPairs);
  assert.deepEqual(a.axisResolutions.map(r => JSON.stringify([r.label, r.axis])).sort(), request.disputedAxes.map(r => JSON.stringify([r.label, r.axis])).sort(), 'Resolve every disputed or uncertain axis exactly once.');
  for (const r of a.axisResolutions) {
    checkEvidence(packet, [r.label], r); const value = axisValues(entry(third, r.label))[r.axis]; assert.ok(value !== undefined);
    if (uncertainValue(value)) assert.equal(r.disposition, 'remains_uncertain', 'An uncertain source adjudication cannot be labelled resolved.');
  }
  assert.deepEqual(a.pairResolutions.map(r => key(r.firstLabel, r.secondLabel)).sort(), request.pairs.map(r => key(r.firstLabel, r.secondLabel)).sort(), 'All 36 exact pairs must be adjudicated once.');
  const thirdVerdicts = verdicts(third, thirdCross);
  for (const r of a.pairResolutions) { checkEvidence(packet, [r.firstLabel, r.secondLabel], r); const v = thirdVerdicts.find(v => key(v.firstLabel, v.secondLabel) === key(r.firstLabel, r.secondLabel))!; assert.equal(preferredLabel(r), preferredLabel(v), 'Pair resolution must agree with its third independent source judgment.'); }
  const condition = (label: string) => { const m = mapping.find(m => m.label === label)!; return { ...p.reportCalibration.caseInstancesPrivate.find(i => i.caseId === m.caseId)!, arm: m.arm }; };
  const primaryInstances = p.reportCalibration.caseInstancesPrivate.filter(i => i.generationContract === WORKSPACE_UNCERTAINTY_CONTRACT);
  const primary = primaryInstances.map(i => {
    const control = mapping.find(m => m.caseId === i.caseId && m.arm === 'current')!.label, candidate = mapping.find(m => m.caseId === i.caseId && m.arm === 'semantic')!.label;
    const before = entry(third, control), after = entry(third, candidate), c = p.diagnostic.cases.find(c => c.id === i.caseId)!, publicCase = packet.cases.find(c => c.id === i.caseId)!;
    const missing = c.designatedFacts.flatMap((f, index) => !c.contexts.current.some(s => f.sourceIds.includes(s.id) && s.text.includes(f.quote)) && c.contexts.semantic.some(s => f.sourceIds.includes(s.id) && s.text.includes(f.quote)) ? [publicCase.designatedFacts[index]!.factId] : []);
    const d = delta(before, after), gain = missing.filter(id => before.facts.find(f => f.factId === id)!.status === 'missing' && after.facts.find(f => f.factId === id)!.status === 'covered'
      && !a.axisResolutions.some(r => [control, candidate].includes(r.label) && r.axis === `fact:${id}` && r.disposition === 'remains_uncertain')
      && reviews.some(r => entry(r, candidate).facts.find(f => f.factId === id)!.status === 'covered'));
    // A third reviewer may resolve a negative, but an explicitly uncertain
    // material concern cannot be waived merely because exploration is allowed.
    const unresolvedMaterial = request.disputedAxes.filter(t => t.label === candidate).flatMap(t => {
      const r = a.axisResolutions.find(r => r.label === t.label && r.axis === t.axis)!;
      if (r.disposition !== 'remains_uncertain') return [];
      const entries = reviews.map(r => entry(r, candidate));
      return entries.some(e => t.axis === 'unsupportedClaims' ? e.unsupportedClaims.some(c => c.severity === 'material') : t.axis.startsWith('fact:') ? e.facts.some(f => `fact:${f.factId}` === t.axis && (f.status === 'distorted' || f.status === 'missing' && before.facts.find(o => o.factId === f.factId)?.status === 'covered')) : t.axis === 'exactApplicability' || t.axis === 'appropriateUncertainty' || t.axis === 'directRelevance' ? axisValues(e)[t.axis] === 'fail' : t.axis.startsWith('unknown:') && axisValues(e)[t.axis] === 'contradicted') ? [t.axis] : [];
    });
    return { sourceCaseId: i.sourceCaseId, repeat: i.repeat, generationContract: i.generationContract, control, candidate, ...d, unresolvedMaterialConcerns: unresolvedMaterial, missingContextFactIds: missing, sourceSupportedMissingFactGain: gain,
      adjudicatedPreference: preferredLabel(thirdVerdicts.find(v => key(v.firstLabel, v.secondLabel) === key(control, candidate))!) };
  });
  assert.equal(primary.length, 4); const blockers = primary.flatMap(p => [...p.confirmedMaterialRegressions, ...p.unresolvedMaterialConcerns].map(axis => `Primary new-policy candidate ${p.candidate}: ${axis}.`));
  const gap = REPORT_CALIBRATION_V1.selectedSourceCaseIds[0], gains = primary.filter(p => p.sourceCaseId === gap && p.sourceSupportedMissingFactGain.length);
  if (!gains.length) blockers.push('No source-supported missing-report gain for v6 versus v5 under the same new uncertainty policy.');
  const pairResults = request.pairs.map(pair => ({ ...pair, conditionsPrivate: [condition(pair.firstLabel), condition(pair.secondLabel)],
    originalReviewerVerdicts: reviews.map((r, i) => ({ reviewer: r.review.reviewer, reviewSha256: r.reviewSha256, judgment: verdicts(r, cross[i]!).find(v => key(v.firstLabel, v.secondLabel) === key(pair.firstLabel, pair.secondLabel))! })),
    adjudication: a.pairResolutions.find(r => key(r.firstLabel, r.secondLabel) === key(pair.firstLabel, pair.secondLabel))! }));
  const document = { format: 'ablatrix-automatic-development-review-proof-v1', rule: request.rule,
    status: blockers.length ? 'blocked' : 'eligible_for_automated_exploratory_fresh_preparation', blockers, packetSha256: packet.sha256, requestSha256: request.sha256, adjudicationSha256: diagnosticHash(a),
    actualProducts: 2, freshProducts: 0, completedAnswers: 24, designatedFactJudgmentsPerReviewer: 48, independentAIReviewers: 2, independentAIAdjudicators: 1,
    primaryComparison: 'v6 versus v5 under the same workspace-answer-uncertainty-v2 policy', primaryPairs: primary, pairResults,
    originalReviews: reviews, originalCrossReviews: cross, adjudication: a, unresolvedAxesCarriedForward: a.axisResolutions.filter(r => r.disposition === 'remains_uncertain'),
    interpretation: 'A source-evidenced automated exploratory decision after exposed development, not a human review, calibration, ground truth, policy promotion or final answer-quality claim. All flat-policy and reference diagnostics, negative results, original disagreements and uncertainty remain retained. No composite score or majority vote is used. Canonical actual receipt verification remains mandatory before fresh-source access.',
    humanAnswerQualityJudgments: 0, qualityClaimEligible: false, activationAllowed: false, freshExecutionAuthorized: false, newProviderCalls: 0 };
  return { ...document, sha256: diagnosticHash(document) };
}
