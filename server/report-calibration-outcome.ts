/** Substantive review gate only. Actual journal/provider-origin and canonical
 * receipt verification belongs to the caller; this module never dispatches. */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { REPORT_CALIBRATION_V1, type ReportCalibrationPreparation } from '../scripts/prepare-report-calibration-v1.ts';
import { prepareThreeContext, diagnosticHash, type anonymousDiagnosticReview } from './three-context-diagnostic.ts';
import { importThreeContextReview, verifyThreeContextEvaluation, type ImportedThreeContextReview, type ThreeContextEvaluationPacket } from './three-context-evaluation.ts';
import { sourceCitationEvidence } from './citation-options.ts';
import { WORKSPACE_GENERATION_CONTRACT } from './workspace-generation.ts';
import { WORKSPACE_UNCERTAINTY_CONTRACT } from './workspace-uncertainty-policy.ts';

type Mapping = ReturnType<typeof anonymousDiagnosticReview>['mapping'];
type Review = ImportedThreeContextReview['review'];
type Entry = Review['entries'][number];
type Comparison = NonNullable<Review['comparisons']>[number];
type Preference = 'candidate_preferred' | 'control_preferred' | 'tie' | 'uncertain';
type Pair = { key: string; kind: 'retrieval' | 'instruction' | 'reference_diagnostic'; sourceCaseId: string; repeat: number; arm?: Mapping[number]['arm']; control: string; candidate: string; missingUnits: string[] };
const crossSchema = z.object({ format: z.literal('ablatrix-report-calibration-cross-instruction-review-v1'), packetSha256: z.string().regex(/^[a-f0-9]{64}$/), reviewer: z.string().trim().min(1),
  provenance: z.enum(['ai_provisional', 'source_checked_human']), sourceReviewSha256: z.string().regex(/^[a-f0-9]{64}$/),
  comparisons: z.array(z.object({ firstLabel: z.string().min(1), secondLabel: z.string().min(1), outcome: z.enum(['first_preferred', 'second_preferred', 'tie', 'uncertain']), rationale: z.string().trim().min(20) }).strict()).min(1) }).strict();
export type ReportCalibrationCrossReview = z.infer<typeof crossSchema>;
const pairKey = (a: string, b: string) => JSON.stringify([a, b].sort());
const ordered = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
/** Remove preparation/execution ordering from the reviewer artifact before its
 * hash is bound by any review. Generic historical packets remain unchanged. */
export function normalizeReportCalibrationEvaluation(packet: ThreeContextEvaluationPacket): ThreeContextEvaluationPacket {
  verifyThreeContextEvaluation(packet); const { sha256: _old, ...document } = structuredClone(packet);
  document.cases.sort((a, b) => ordered(a.id, b.id)); document.answers.sort((a, b) => ordered(a.label, b.label));
  return { ...document, sha256: diagnosticHash(document) };
}
const preference = (c: Pick<Comparison, 'firstLabel' | 'secondLabel' | 'outcome'>, candidate: string): Preference => c.outcome === 'tie' || c.outcome === 'uncertain' ? c.outcome : (c.outcome === 'first_preferred' ? c.firstLabel : c.secondLabel) === candidate ? 'candidate_preferred' : 'control_preferred';
const claimKeys = (e: Entry) => e.unsupportedClaims.map(c => JSON.stringify([c.claim, c.severity])).sort();
const signature = (e: Entry) => JSON.stringify({ facts: e.facts.map(f => [f.factId, f.status]).sort(), unsupportedClaims: claimKeys(e), exactApplicability: e.exactApplicability.judgment,
  appropriateUncertainty: e.appropriateUncertainty.judgment, directRelevance: e.directRelevance.judgment, unknowns: e.unknowns.map(u => [u.unknown, u.status]).sort() });
const uncertain = (e: Entry) => e.facts.some(f => f.status === 'uncertain') || [e.exactApplicability, e.appropriateUncertainty, e.directRelevance].some(a => a.judgment === 'uncertain');

function checkedDesign(p: ReportCalibrationPreparation, packet: ThreeContextEvaluationPacket, mapping: Mapping) {
  assert.deepEqual(packet, normalizeReportCalibrationEvaluation(packet), 'Use a normalized report-calibration packet before binding source-aware reviews.'); assert.equal(packet.scope, 'exposed_development_only'); assert.equal(packet.transportProvenance, 'live_router'); assert.equal(packet.answers.length, 24);
  assert.ok(packet.answers.every(a => a.status === 'completed' && a.literalCitationMatching.status === 'pass'), 'All24 actual answer arms must complete before outcome qualification.');
  const manifest = prepareThreeContext(p.diagnostic), instances = p.reportCalibration.caseInstancesPrivate;
  assert.equal(manifest.document.slots.length, 24); assert.equal(p.diagnostic.cases.length, 8); assert.equal(instances.length, 8);
  assert.deepEqual(p.reportCalibration.selectedSourceCaseIds, [...REPORT_CALIBRATION_V1.selectedSourceCaseIds]); assert.equal(p.reportCalibration.actualProducts, 2); assert.equal(p.reportCalibration.freshProducts, 0);
  assert.equal(new Set(instances.map(i => i.caseId)).size, 8); assert.equal(new Set(instances.map(i => JSON.stringify([i.sourceCaseId, i.generationContract, i.repeat]))).size, 8);
  for (const sourceCaseId of REPORT_CALIBRATION_V1.selectedSourceCaseIds) for (const generationContract of REPORT_CALIBRATION_V1.instructionContracts) for (const repeat of [0, 1]) {
    const instance = instances.find(i => i.sourceCaseId === sourceCaseId && i.generationContract === generationContract && i.repeat === repeat); assert.ok(instance, 'Every declared factorial cell must exist.');
    const expectedId = `rci-${createHmac('sha256', Buffer.from(p.reportCalibration.privateCaseIdentityKey, 'hex')).update(JSON.stringify([REPORT_CALIBRATION_V1.format, sourceCaseId, generationContract, repeat])).digest('hex').slice(0, 24)}`;
    assert.equal(instance.caseId, expectedId); const c = p.diagnostic.cases.find(c => c.id === instance.caseId); assert.ok(c); assert.equal(c.generationContract, generationContract); assert.equal(c.product.id, instance.productId);
    const publicCase = packet.cases.find(c => c.id === instance.caseId); assert.ok(publicCase); assert.deepEqual(publicCase.product, c.product); assert.equal(publicCase.question, c.question); assert.deepEqual(publicCase.unknowns, c.referenceReview.unknowns);
    assert.deepEqual(publicCase.designatedFacts.map(({ factId: _fact, ...fact }) => fact), c.designatedFacts);
    const expectedSources = c.completeSources.map(({ lexicalRank: _l, semanticRank: _r, score: _s, ...source }) => { const scoped = sourceCitationEvidence([source])[0]!; return { ...source, ...(scoped.originalQuestion !== undefined ? { originalQuestion: scoped.originalQuestion } : {}) }; });
    assert.deepEqual(publicCase.completeSources, expectedSources);
  }
  assert.equal(new Set(instances.map(i => i.productId)).size, 2);
  assert.equal(mapping.length, 24); assert.equal(new Set(mapping.map(m => m.label)).size, 24); assert.equal(new Set(mapping.map(m => m.operationRunId)).size, 24); assert.equal(new Set(mapping.map(m => m.attemptId)).size, 24);
  assert.deepEqual(mapping.map(m => m.label).sort(), packet.answers.map(a => a.label).sort());
  for (const m of mapping) {
    assert.ok(m.attemptId?.trim()); const slot = manifest.document.slots.find(s => s.input.runId === m.operationRunId); assert.ok(slot, 'Arm mapping must cover the exact frozen operations.');
    assert.equal(slot.caseId, m.caseId); assert.equal(slot.arm, m.arm); assert.equal(packet.answers.find(a => a.label === m.label)!.caseId, m.caseId);
  }
  return { manifest, instances };
}
function pairedDesign(p: ReportCalibrationPreparation, packet: ThreeContextEvaluationPacket, mapping: Mapping) {
  const { instances } = checkedDesign(p, packet, mapping), pairs: Pair[] = [];
  const label = (caseId: string, arm: Mapping[number]['arm']) => { const row = mapping.find(m => m.caseId === caseId && m.arm === arm); assert.ok(row); return row.label; };
  for (const instance of instances) {
    const c = p.diagnostic.cases.find(c => c.id === instance.caseId)!, control = label(c.id, 'current'), candidate = label(c.id, 'semantic');
    const delivered = (context: typeof c.contexts.current, fact: typeof c.designatedFacts[number]) => context.some(s => fact.sourceIds.includes(s.id) && s.text.includes(fact.quote));
    const publicFacts = packet.cases.find(c => c.id === instance.caseId)!.designatedFacts;
    const missingUnits = c.designatedFacts.flatMap((f, i) => !delivered(c.contexts.current, f) && delivered(c.contexts.semantic, f) ? [publicFacts[i]!.factId] : []);
    pairs.push({ key: pairKey(control, candidate), kind: 'retrieval', sourceCaseId: instance.sourceCaseId, repeat: instance.repeat, control, candidate, missingUnits });
  }
  for (const sourceCaseId of REPORT_CALIBRATION_V1.selectedSourceCaseIds) for (const repeat of [0, 1]) {
    const old = instances.find(i => i.sourceCaseId === sourceCaseId && i.repeat === repeat && i.generationContract === WORKSPACE_GENERATION_CONTRACT)!;
    const next = instances.find(i => i.sourceCaseId === sourceCaseId && i.repeat === repeat && i.generationContract === WORKSPACE_UNCERTAINTY_CONTRACT)!;
    for (const arm of ['current', 'semantic', 'reference'] as const) {
      const control = label(old.caseId, arm), candidate = label(next.caseId, arm), a = p.diagnostic.cases.find(c => c.id === old.caseId)!, b = p.diagnostic.cases.find(c => c.id === next.caseId)!;
      assert.deepEqual(a.contexts[arm], b.contexts[arm], 'Instruction pairs must use the exact same context.');
      pairs.push({ key: pairKey(control, candidate), kind: 'instruction', sourceCaseId, repeat, arm, control, candidate, missingUnits: [] });
    }
  }
  assert.equal(pairs.filter(p => p.kind === 'retrieval').length, 8); assert.equal(pairs.filter(p => p.kind === 'instruction').length, 12); return pairs;
}
/** Safe reviewer task list. Label ordering is neutral and does not encode the
 * old/new instruction or retrieval condition. Never publish the private map. */
export function reportCalibrationNeutralComparisonPairs(p: ReportCalibrationPreparation, packet: ThreeContextEvaluationPacket, mapping: Mapping) {
  const pairs = pairedDesign(p, packet, mapping), neutral = (pair: Pair) => { const [firstLabel, secondLabel] = [pair.control, pair.candidate].sort(); return { firstLabel: firstLabel!, secondLabel: secondLabel! }; };
  const withinInstancePairs = packet.cases.flatMap(c => {
    const labels = packet.answers.filter(a => a.caseId === c.id).map(a => a.label).sort();
    return labels.flatMap((firstLabel, index) => labels.slice(index + 1).map(secondLabel => ({ caseId: c.id, firstLabel, secondLabel })));
  }).sort((a, b) => ordered(pairKey(a.firstLabel, a.secondLabel), pairKey(b.firstLabel, b.secondLabel)));
  return { format: 'ablatrix-report-calibration-neutral-pairs-v1', packetSha256: packet.sha256,
    withinInstancePairs,
    crossInstructionPairs: pairs.filter(p => p.kind === 'instruction').map(neutral).sort((a, b) => ordered(pairKey(a.firstLabel, a.secondLabel), pairKey(b.firstLabel, b.secondLabel))),
    instruction: 'Judge each listed pair from the complete saved sources and individual six-axis reviews; preserve ties and uncertainty. Pair order does not identify a condition. AI review remains provisional.', qualityClaimEligible: false };
}
function differences(control: Entry, candidate: Entry) {
  const regressions: string[] = [], improvements: string[] = [], rank = { pass: 0, uncertain: 1, fail: 2 };
  for (const f of control.facts) { const other = candidate.facts.find(n => n.factId === f.factId)!;
    if (f.status === 'covered' && other.status !== 'covered' || other.status === 'distorted' && f.status !== 'distorted') regressions.push(`fact:${f.factId}`);
    if (other.status === 'covered' && f.status !== 'covered') improvements.push(`fact:${f.factId}`);
  }
  const oldClaims = new Set(claimKeys(control)), newClaims = new Set(claimKeys(candidate));
  if ([...newClaims].some(c => !oldClaims.has(c))) regressions.push('unsupportedClaims');
  if ([...oldClaims].some(c => !newClaims.has(c))) improvements.push('unsupportedClaims');
  for (const axis of ['exactApplicability', 'appropriateUncertainty', 'directRelevance'] as const) {
    if (rank[candidate[axis].judgment] > rank[control[axis].judgment]) regressions.push(axis);
    if (rank[candidate[axis].judgment] < rank[control[axis].judgment]) improvements.push(axis);
  }
  for (const u of control.unknowns) { const next = candidate.unknowns.find(n => n.unknown === u.unknown)!;
    if (next.status === 'contradicted' && u.status !== 'contradicted' || u.status === 'preserved' && next.status !== 'preserved' || next.status === 'missing' && u.status === 'not_relevant') regressions.push(`unknown:${u.unknown}`);
    if (next.status === 'preserved' && (u.status === 'missing' || u.status === 'contradicted')) improvements.push(`unknown:${u.unknown}`);
  }
  return { regressions, improvements };
}
export class ReportCalibrationOutcomeBlocked extends Error {
  readonly summary: ReturnType<typeof outcomeSummary>;
  constructor(summary: ReturnType<typeof outcomeSummary>) { super(`Report calibration outcome remains blocked: ${summary.blockers.join('; ')}`); this.name = 'ReportCalibrationOutcomeBlocked'; this.summary = summary; }
}
type Assessment = { reviewer: string; provenance: Review['provenance']; preference: Preference; rationale: string; control: Entry; candidate: Entry };
function outcomeSummary(decisions: { pair: Pair; assessments: Assessment[]; humanAxes: { reviewer: string; reviewSha256: string; entry: Entry }[]; resolvedBy: string[]; finalPreference: Preference | 'unresolved'; regressions: string[]; improvements: string[]; missingUnitGain: boolean }[], blockers: string[], reviewerCount: number) {
  const gap = REPORT_CALIBRATION_V1.selectedSourceCaseIds[0];
  const retrievalSignals = decisions.filter(d => d.pair.kind === 'retrieval' && d.pair.sourceCaseId === gap && d.finalPreference === 'candidate_preferred' && d.missingUnitGain && !d.regressions.length);
  const policySignals = decisions.filter(d => d.pair.kind === 'instruction' && d.pair.sourceCaseId === gap && d.pair.arm === 'semantic' && d.finalPreference === 'candidate_preferred' && d.improvements.some(a => a === 'appropriateUncertainty' || a === 'exactApplicability' || a === 'unsupportedClaims' || a.startsWith('unknown:')) && !d.regressions.length);
  if (!retrievalSignals.length) blockers.push('No reviewed missing-unit retrieval benefit on the exposed gap case.');
  if (!policySignals.length) blockers.push('No reviewed uncertainty/applicability/support instruction benefit at fixed v6 context on the exposed gap case.');
  const pairResult = (d: typeof decisions[number]) => ({ kind: d.pair.kind, sourceCaseId: d.pair.sourceCaseId, repeat: d.pair.repeat, ...(d.pair.arm ? { context: d.pair.arm } : {}), labels: [d.pair.control, d.pair.candidate].sort(),
    reviewerVerdicts: d.assessments.map(a => ({ reviewer: a.reviewer, provenance: a.provenance, preference: a.preference, rationale: a.rationale, ...differences(a.control, a.candidate) })), resolvedByHumanReviewers: d.resolvedBy,
    suppliedHumanAxisFindings: d.humanAxes.map(h => ({ reviewer: h.reviewer, sourceReviewSha256: h.reviewSha256, label: h.entry.label, answerSha256: h.entry.answerSha256,
      facts: h.entry.facts.map(f => ({ factId: f.factId, status: f.status })), unsupportedClaims: h.entry.unsupportedClaims, exactApplicability: h.entry.exactApplicability.judgment,
      appropriateUncertainty: h.entry.appropriateUncertainty.judgment, directRelevance: h.entry.directRelevance.judgment, unknowns: h.entry.unknowns })),
    finalPreference: d.finalPreference, regressionAxes: d.regressions, improvementAxes: d.improvements, missingUnitGain: d.missingUnitGain });
  return { format: 'ablatrix-report-calibration-comparison-proof-v1', status: blockers.length ? 'blocked' : 'reviewed_development_signal_supports_bounded_fresh_preparation', blockers: [...new Set(blockers)], actualProducts: 2, freshProducts: 0,
    aiReviewers: reviewerCount, matchedWithinInstancePairs: 8, matchedInstructionPairs: 12, pairResults: decisions.map(pairResult),
    retrievalBenefitPairs: retrievalSignals.map(pairResult), instructionBenefitPairs: policySignals.map(pairResult),
    interpretation: 'Explicit source-aware preferences plus separate observed fact/uncertainty/support changes on two exposed products. Every repeat and negative result is retained. AI judgments remain provisional; human provenance is a saved source-checking attestation. This is a bounded prospective-preparation gate, not ground truth, a composite quality score or evidence of general improvement.',
    qualityClaimEligible: false, activationAllowed: false, freshExecutionAuthorized: false, newProviderCalls: 0 };
}

export function verifyReportCalibrationComparisons(p: ReportCalibrationPreparation, packet: ThreeContextEvaluationPacket, imports: ImportedThreeContextReview[], mapping: Mapping, rawCrossReviews: unknown[]) {
  const mandatory = pairedDesign(p, packet, mapping), records = imports.map(r => { assert.deepEqual(importThreeContextReview(packet, r.review), r); return r; });
  assert.equal(new Set(records.map(r => r.review.reviewer)).size, records.length, 'One consolidated source-aware record per reviewer.');
  const ai = records.filter(r => r.review.provenance === 'ai_provisional' && r.review.purpose === 'independent_review'), human = records.filter(r => r.review.provenance === 'source_checked_human');
  assert.ok(ai.length >= 2, 'At least two independent provisional AI source-aware reviews are required.');
  for (const r of ai) assert.deepEqual(r.review.entries.map(e => e.label).sort(), packet.answers.map(a => a.label).sort(), 'Every independent AI reviewer must inspect all24 answers.');
  const cross = rawCrossReviews.map(raw => crossSchema.parse(raw)); assert.equal(new Set(cross.map(c => c.reviewer)).size, cross.length, 'One consolidated cross-instruction record per reviewer.');
  for (const c of cross) {
    assert.equal(c.packetSha256, packet.sha256); const source = records.find(r => r.review.reviewer === c.reviewer); assert.ok(source); assert.equal(c.sourceReviewSha256, source.reviewSha256); assert.equal(c.provenance, source.review.provenance);
    const seen = new Set<string>(); for (const pair of c.comparisons) {
      const key = pairKey(pair.firstLabel, pair.secondLabel); assert.ok(pair.firstLabel !== pair.secondLabel && mandatory.some(p => p.kind === 'instruction' && p.key === key), 'Only exact matched source-case/repeat/context instruction pairs are permitted.');
      assert.ok(!seen.has(key), 'Duplicate or reversed cross-instruction pair.'); seen.add(key);
      for (const label of [pair.firstLabel, pair.secondLabel]) assert.ok(source.review.entries.some(e => e.label === label), 'Both compared labels need bound individual source-aware judgments.');
    }
  }
  for (const r of ai) { const c = cross.find(c => c.reviewer === r.review.reviewer); assert.ok(c && c.comparisons.length === 12, 'Each independent AI reviewer must explicitly judge all12 matched instruction pairs.'); }
  const comparisonFor = (r: ImportedThreeContextReview, pair: Pair) => pair.kind === 'instruction' ? cross.find(c => c.reviewer === r.review.reviewer)?.comparisons.find(c => pairKey(c.firstLabel, c.secondLabel) === pair.key)
    : r.review.comparisons?.find(c => pairKey(c.firstLabel, c.secondLabel) === pair.key);
  const requiredWithin = packet.cases.flatMap(c => {
    const labels = packet.answers.filter(a => a.caseId === c.id).map(a => a.label).sort();
    return labels.flatMap((first, i) => labels.slice(i + 1).map(second => pairKey(first, second)));
  }).sort();
  for (const r of ai) assert.deepEqual((r.review.comparisons ?? []).map(c => pairKey(c.firstLabel, c.secondLabel)).sort(), requiredWithin,
    'Each independent AI reviewer must judge all24 unordered pairs, including every within-instance v5/v6 pair and all reference diagnostics.');
  for (const r of ai) for (const pair of mandatory.filter(p => p.kind === 'retrieval')) assert.ok(comparisonFor(r, pair), 'Each independent AI reviewer must judge every within-instance v5/v6 pair.');
  // Additional reference comparisons remain diagnostic. Uncertainty or reviewer
  // disagreement still needs explicit human resolution, without treating an
  // expected reference advantage as a production regression.
  const pairs = [...mandatory], seen = new Set(pairs.map(p => p.key));
  for (const r of [...ai, ...human]) for (const c of r.review.comparisons ?? []) {
    const key = pairKey(c.firstLabel, c.secondLabel); if (seen.has(key)) continue; seen.add(key);
    const instance = p.reportCalibration.caseInstancesPrivate.find(i => i.caseId === c.caseId)!;
    pairs.push({ key, kind: 'reference_diagnostic', sourceCaseId: instance.sourceCaseId, repeat: instance.repeat, control: c.firstLabel, candidate: c.secondLabel, missingUnits: [] });
  }
  const blockers: string[] = [], decisions: Parameters<typeof outcomeSummary>[0] = [];
  for (const pair of pairs) {
    const assess = (record: ImportedThreeContextReview): Assessment | undefined => {
      const c = comparisonFor(record, pair), a = record.review.entries.find(e => e.label === pair.control), b = record.review.entries.find(e => e.label === pair.candidate); if (!c || !a || !b) return undefined;
      return { reviewer: record.review.reviewer, provenance: record.review.provenance, preference: preference(c, pair.candidate), rationale: c.rationale, control: a, candidate: b };
    };
    const assessments = ai.map(assess).filter((a): a is Assessment => !!a), values = assessments.map(a => a.preference), resolutions = human.map(assess).filter((a): a is Assessment => !!a);
    const humanAxes = human.flatMap(h => h.review.entries.filter(e => e.label === pair.control || e.label === pair.candidate).map(entry => ({ reviewer: h.review.reviewer, reviewSha256: h.reviewSha256, entry })));
    const humanControlEntries = human.flatMap(h => h.review.entries.filter(e => e.label === pair.control)), humanCandidateEntries = human.flatMap(h => h.review.entries.filter(e => e.label === pair.candidate));
    const requiresHuman = assessments.some(a => uncertain(a.control) || uncertain(a.candidate) || a.preference === 'uncertain') || new Set(values).size > 1
      || new Set(assessments.map(a => signature(a.control))).size > 1 || new Set(assessments.map(a => signature(a.candidate))).size > 1
      || pair.kind !== 'reference_diagnostic' && assessments.some(a => a.preference === 'control_preferred' || differences(a.control, a.candidate).regressions.length)
      || humanControlEntries.length > 0 || humanCandidateEntries.length > 0;
    let chosen = assessments[0] ?? resolutions[0]; assert.ok(chosen); let resolvedBy: string[] = [], finalPreference: Preference | 'unresolved' = chosen.preference;
    if (requiresHuman) {
      // Supplied human evidence is never contingent on an AI raising a flag.
      // Partial entries also force an actual pair resolution, and conflicting
      // human records cannot be bypassed by choosing the favorable record.
      if (!resolutions.length || [...humanControlEntries, ...humanCandidateEntries].some(uncertain)
        || new Set(humanControlEntries.map(signature)).size !== 1 || new Set(humanCandidateEntries.map(signature)).size !== 1
        || resolutions.some(h => h.preference === 'uncertain') || new Set(resolutions.map(h => JSON.stringify([h.preference, signature(h.control), signature(h.candidate)]))).size !== 1) {
        blockers.push(`Explicit non-uncertain source-checked human resolution required for ${pair.kind} pair ${pair.key}.`); finalPreference = 'unresolved';
      } else { chosen = resolutions[0]!; resolvedBy = resolutions.map(h => h.reviewer); finalPreference = chosen.preference; }
    }
    assessments.push(...resolutions);
    const delta = differences(chosen.control, chosen.candidate), regressions = pair.kind === 'reference_diagnostic' ? [] : delta.regressions;
    if (finalPreference !== 'unresolved' && pair.kind !== 'reference_diagnostic') {
      if (regressions.length) blockers.push(`Confirmed regression in ${pair.kind} pair ${pair.key}: ${regressions.join(', ')}.`);
      if (finalPreference === 'control_preferred') blockers.push(`Confirmed control preference in ${pair.kind} pair ${pair.key}.`);
    }
    const missingUnitGain = pair.missingUnits.some(id => chosen.control.facts.find(f => f.factId === id)?.status !== 'covered' && chosen.candidate.facts.find(f => f.factId === id)?.status === 'covered');
    decisions.push({ pair, assessments, humanAxes, resolvedBy, finalPreference, regressions, improvements: delta.improvements, missingUnitGain });
  }
  const summary = outcomeSummary(decisions, blockers, ai.length); if (summary.blockers.length) throw new ReportCalibrationOutcomeBlocked(summary); return summary;
}
