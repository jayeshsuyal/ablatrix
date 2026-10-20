import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { syntheticPreparation } from '../scripts/three-context-mock.ts';
import { createReportCalibrationPreparation, REPORT_CALIBRATION_V1 } from '../scripts/prepare-report-calibration-v1.ts';
import { anonymousDiagnosticReview, diagnosticHash, type DiagnosticCheckpoint } from './three-context-diagnostic.ts';
import { sourceCitationOptions } from './citation-options.ts';
import { workspaceGenerationParts } from './workspace-generation.ts';
import { WORKSPACE_UNCERTAINTY_CONTRACT } from './workspace-uncertainty-policy.ts';
import { prepareThreeContextLive, threeContextLiveResult, THREE_CONTEXT_LIVE_FILES } from './three-context-live.ts';
import { importThreeContextReview, prepareThreeContextEvaluation, type ThreeContextReviewImport } from './three-context-evaluation.ts';
import { normalizeReportCalibrationEvaluation, reportCalibrationNeutralComparisonPairs } from './report-calibration-outcome.ts';
import { textHash } from './product-corpus.ts';
import { buildAutomaticAdjudicationRequest, verifyAutomaticDevelopmentReview, type AutomaticAdjudication, type AutomaticCrossReview } from './automatic-review-v1.ts';

/** All answers, receipts, sources and reviewer attestations here are SYNTHETIC.
 * These fixtures test mechanics and decision rules, never answer quality. */
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-auto-review-SYNTHETIC-'))), write = (path: string, value: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  for (const path of THREE_CONTEXT_LIVE_FILES) write(path, '// SYNTHETIC execution stub\n'); write('.data/source.json', '{"provenance":"SYNTHETIC"}\n');
  const s = syntheticPreparation(), gap = s.cases[0]!; gap.id = REPORT_CALIBRATION_V1.selectedSourceCaseIds[0];
  gap.designatedFacts.push({ fact: 'SYNTHETIC shorter observation', quote: 'five to six hours', sourceIds: ['conflict'], qualification: 'Conditions unknown.' }, { fact: 'SYNTHETIC housing', quote: 'durable housing', sourceIds: ['base'], qualification: 'Report only.' });
  gap.contexts.current = gap.completeSources.filter(s => s.id !== 'duration');
  gap.contexts.reference = gap.completeSources;
  const control = structuredClone(gap); control.id = REPORT_CALIBRATION_V1.selectedSourceCaseIds[1]; control.product.id = 'SYNTHETIC-control';
  control.completeSources.forEach(s => { s.productId = control.product.id; }); control.designatedFacts = [control.designatedFacts[2]!];
  control.contexts = { current: control.completeSources, semantic: control.completeSources, reference: control.completeSources }; control.referenceReview.sourcePoolSha256 = diagnosticHash(control.completeSources);
  const digest = (path: string) => textHash(readFileSync(join(root, path), 'utf8'));
  const p = createReportCalibrationPreparation(root, [gap, control], s.policy, { ...s.ledger, attempts: 141, reservedUsd: 14.1 },
    { implementationSha256: Object.fromEntries(THREE_CONTEXT_LIVE_FILES.map(path => [path, digest(path)])), artifactSha256: { '.data/source.json': digest('.data/source.json') } },
    { v6ReviewedResultPath: '.data/source.json', expectedV6ReviewedResultSha256: '1'.repeat(64), sourceReviewPath: '.data/source.json', expectedSourceReviewSha256: '2'.repeat(64) }, 'a'.repeat(64), join(root, '.data/execution'));
  p.diagnostic.codeReviewPassed = true; const prep = join(root, '.data/preparation.json'); writeFileSync(prep, JSON.stringify(p) + '\n'); const manifest = prepareThreeContextLive(p, prep);
  const checkpoint: DiagnosticCheckpoint = { planSha256: manifest.diagnostic.sha256, provenance: 'live_router', stopReason: null, steps: manifest.diagnostic.document.slots.map((slot, index) => {
    const parts = workspaceGenerationParts(slot.input), id = `SYNTHETIC-attempt-${index}`, usage = { inputTokens: 10, outputTokens: 5 };
    return { index, started: true, dispatchIntent: true, dispatched: true, attemptId: id, receipt: { id, kind: parts.tool, status: 'completed', error_code: null, allowance_usd: .1, model: 'gpt-luna', input_tokens: 10, output_tokens: 5,
      receipt_json: JSON.stringify({ ...slot.binding, promptVersion: slot.binding.contract, mode: 'live', accounting: 'local_planning_allowance', model: 'gpt-luna', usage,
        output: { answer: `SYNTHETIC observation ${index}; manual stopping and conditions remain distinct.`, status: 'answered', citations: [sourceCitationOptions(parts.scope)[0]!.id] } }) } };
  }) };
  const anon = anonymousDiagnosticReview(manifest.diagnostic, checkpoint, 'SYNTHETIC anonymous fixture order'), packet = normalizeReportCalibrationEvaluation(prepareThreeContextEvaluation(manifest, [checkpoint], threeContextLiveResult(manifest, checkpoint), anon.review)), mapping = anon.mapping;
  const neutral = reportCalibrationNeutralComparisonPairs(p, packet, mapping), condition = (label: string) => { const m = mapping.find(m => m.label === label)!, instance = p.reportCalibration.caseInstancesPrivate.find(i => i.caseId === m.caseId)!; return { ...instance, arm: m.arm }; };
  const literalEvidence = (label: string) => { const c = packet.cases.find(c => c.id === packet.answers.find(a => a.label === label)!.caseId)!, source = c.completeSources[0]!; return [{ sourceId: source.id, quote: source.text, originalQuestion: source.originalQuestion ?? null }]; };
  function rawReview(reviewer: string): ThreeContextReviewImport {
    return { format: 'ablatrix-source-checked-review-v1', packetSha256: packet.sha256, reviewer, provenance: 'ai_provisional', purpose: 'independent_review', recordedAt: '2026-10-19T12:00:00Z', sourceChecked: true,
      entries: packet.answers.map(answer => {
        const c = packet.cases.find(c => c.id === answer.caseId)!, v = condition(answer.label), axis = () => ({ judgment: 'pass' as const, rationale: 'SYNTHETIC source assessment; not an empirical quality observation.', evidence: literalEvidence(answer.label) });
        return { label: answer.label, sourcePoolSha256: answer.sourcePoolSha256, answerSha256: answer.answerSha256,
          facts: c.designatedFacts.map((f, i) => ({ factId: f.factId, status: v.sourceCaseId === REPORT_CALIBRATION_V1.selectedSourceCaseIds[0] && v.arm === 'current' && i === 0 ? 'missing' as const : 'covered' as const,
            rationale: 'SYNTHETIC fact qualification assessed from complete literal sources.', evidence: f.sourceIds.map(id => { const source = c.completeSources.find(s => s.id === id)!; return { sourceId: id, quote: source.text, originalQuestion: source.originalQuestion ?? null }; }) })),
          unsupportedClaims: [], exactApplicability: axis(), appropriateUncertainty: axis(), directRelevance: axis(), unknowns: c.unknowns.map(unknown => ({ unknown, status: 'preserved' as const, rationale: 'SYNTHETIC unknown preserved, not measured quality.' })) };
      }), comparisons: neutral.withinInstancePairs.map(pair => ({ ...pair, outcome: 'tie', rationale: 'SYNTHETIC explicit pair assessment from source content, without an aggregate score.' })) };
  }
  const raw = [rawReview('SYNTHETIC-alpha'), rawReview('SYNTHETIC-beta')], third = rawReview('SYNTHETIC-independent-adjudicator');
  const crossReview = (r: ReturnType<typeof importThreeContextReview>): AutomaticCrossReview => ({ format: 'ablatrix-report-calibration-cross-instruction-review-v1', packetSha256: packet.sha256, reviewer: r.review.reviewer, provenance: 'ai_provisional', sourceReviewSha256: r.reviewSha256,
    comparisons: neutral.crossInstructionPairs.map(pair => ({ ...pair, outcome: 'tie', rationale: 'SYNTHETIC matched-instruction pair assessment with source evidence.' })) });
  function records() {
    const independentReviews = raw.map(r => importThreeContextReview(packet, r)), crossReviews = independentReviews.map(crossReview), input = { preparation: p, packet, mapping, independentReviews, crossReviews }, request = buildAutomaticAdjudicationRequest(input), adjudicatorReview = importThreeContextReview(packet, third), adjudicatorCrossReview = crossReview(adjudicatorReview);
    const a: AutomaticAdjudication = { format: 'ablatrix-automatic-source-adjudication-v1', packetSha256: packet.sha256, requestSha256: request.sha256, adjudicator: third.reviewer, provenance: 'ai_source_adjudication', recordedAt: '2026-10-19T13:00:00Z', independentlyAuthored: true, sourceChecked: true,
      independentReviewSha256: request.independentReviews.map(r => r.reviewSha256), independentCrossReviewSha256: request.crossReviews.map(r => diagnosticHash(r)), adjudicatorReview, adjudicatorCrossReview,
      axisResolutions: request.disputedAxes.map(t => { const e = third.entries.find(e => e.label === t.label)!; const value = t.axis.startsWith('fact:') ? e.facts.find(f => `fact:${f.factId}` === t.axis)!.status : t.axis.startsWith('unknown:') ? e.unknowns.find(u => `unknown:${u.unknown}` === t.axis)!.status : t.axis === 'unsupportedClaims' ? 'claims' : e[t.axis as 'exactApplicability'].judgment;
        return { label: t.label, axis: t.axis, disposition: value === 'uncertain' ? 'remains_uncertain' : 'source_resolved', rationale: 'SYNTHETIC third source inspection, not a majority vote or actual quality evidence.', evidence: literalEvidence(t.label), answerQuotes: [{ label: t.label, quote: 'SYNTHETIC' }] }; }),
      pairResolutions: request.pairs.map(pair => ({ ...pair, outcome: 'tie', rationale: 'SYNTHETIC independently source-checked pair resolution, without a majority vote.', evidence: literalEvidence(pair.firstLabel), answerQuotes: [pair.firstLabel, pair.secondLabel].map(label => ({ label, quote: 'SYNTHETIC' })) })),
      humanAnswerQualityJudgments: 0, qualityClaimEligible: false, activationAllowed: false, freshExecutionAuthorized: false };
    return { ...input, adjudication: a, request };
  }
  const primaryLabel = (arm: 'current' | 'semantic', source: string = REPORT_CALIBRATION_V1.selectedSourceCaseIds[0]) => packet.answers.find(a => { const v = condition(a.label); return v.generationContract === WORKSPACE_UNCERTAINTY_CONTRACT && v.arm === arm && v.sourceCaseId === source && v.repeat === 0; })!.label;
  return { raw, third, packet, mapping, p, condition, records, primaryLabel, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('automated source review retains all36 pairs and48 fact units without human provenance or majority scoring', () => {
  const f = fixture(); try {
    const r = f.records(), publicTask = JSON.stringify(r.request); assert.ok(!publicTask.includes('privateCaseIdentityKey')); assert.ok(!publicTask.includes('operationRunId')); assert.ok(!publicTask.includes('generationContract'));
    const proof = verifyAutomaticDevelopmentReview(r); assert.equal(proof.status, 'eligible_for_automated_exploratory_fresh_preparation'); assert.equal(proof.primaryPairs.length, 4); assert.equal(proof.pairResults.length, 36); assert.equal(proof.originalReviews.length, 2);
    assert.equal(proof.designatedFactJudgmentsPerReviewer, 48); assert.equal(proof.humanAnswerQualityJudgments, 0); assert.equal(proof.qualityClaimEligible, false); assert.equal(proof.activationAllowed, false); assert.equal(proof.freshExecutionAuthorized, false);
    assert.equal(proof.primaryPairs.filter(p => p.sourceSupportedMissingFactGain.length).length, 2, 'Source fact gain is retained even when all explicit preferences are ties; no composite winner is manufactured.');
  } finally { f.cleanup(); }
});
test('source adjudicator keeps nonmaterial uncertainty visible and can reject a two-reviewer consensus from source evidence', () => {
  const f = fixture(); try {
    const label = f.primaryLabel('semantic'); f.raw[0]!.entries.find(e => e.label === label)!.directRelevance.judgment = 'uncertain'; f.third.entries.find(e => e.label === label)!.directRelevance.judgment = 'uncertain';
    let r = f.records(), proof = verifyAutomaticDevelopmentReview(r); assert.equal(proof.status, 'eligible_for_automated_exploratory_fresh_preparation'); assert.ok(proof.unresolvedAxesCarriedForward.some(a => a.label === label && a.axis === 'directRelevance'));
    f.third.entries.find(e => e.label === label)!.unsupportedClaims = [{ claim: 'SYNTHETIC', severity: 'material', rationale: 'SYNTHETIC third review discovers material support failure missed by both first reviewers.' }];
    r = f.records(); proof = verifyAutomaticDevelopmentReview(r); assert.equal(proof.status, 'blocked'); assert.ok(proof.blockers.some(b => b.includes('unsupportedClaims')));
  } finally { f.cleanup(); }
});
test('confirmed new-policy control qualifier/applicability regressions stop that candidate path while negative old-flat diagnostics remain', () => {
  const f = fixture(); try {
    for (const review of [...f.raw, f.third]) for (const e of review.entries) if (f.condition(e.label).generationContract !== WORKSPACE_UNCERTAINTY_CONTRACT && f.condition(e.label).arm === 'semantic') e.unsupportedClaims = [{ claim: 'SYNTHETIC', severity: 'material', rationale: 'SYNTHETIC old flat diagnostic regression intentionally retained.' }];
    let proof = verifyAutomaticDevelopmentReview(f.records()); assert.equal(proof.status, 'eligible_for_automated_exploratory_fresh_preparation'); assert.ok(proof.originalReviews.every(r => r.review.entries.some(e => e.unsupportedClaims.length)));
    const control = f.primaryLabel('semantic', REPORT_CALIBRATION_V1.selectedSourceCaseIds[1]); f.third.entries.find(e => e.label === control)!.facts[0]!.status = 'distorted';
    proof = verifyAutomaticDevelopmentReview(f.records()); assert.equal(proof.status, 'blocked'); assert.ok(proof.primaryPairs.some(p => p.candidate === control && p.confirmedMaterialRegressions.some(a => a.startsWith('fact:'))));
    f.third.entries.find(e => e.label === control)!.facts[0]!.status = 'covered'; f.third.entries.find(e => e.label === control)!.exactApplicability.judgment = 'fail';
    assert.equal(verifyAutomaticDevelopmentReview(f.records()).status, 'blocked');
    f.third.entries.find(e => e.label === control)!.exactApplicability.judgment = 'pass'; f.third.entries.find(e => e.label === control)!.unknowns[0]!.status = 'missing';
    proof = verifyAutomaticDevelopmentReview(f.records()); assert.equal(proof.status, 'eligible_for_automated_exploratory_fresh_preparation'); assert.ok(proof.primaryPairs.find(p => p.candidate === control)!.nonmaterialUnknownOmissions.length, 'An omitted unknown is visible without inventing an affirmative unsupported assertion.');
    f.third.entries.find(e => e.label === control)!.unknowns[0]!.status = 'contradicted'; assert.equal(verifyAutomaticDevelopmentReview(f.records()).status, 'blocked');
  } finally { f.cleanup(); }
});
test('an uncertain adjudication cannot clear a possible material source-scope regression', () => {
  const f = fixture(); try {
    const label = f.primaryLabel('semantic'); f.raw.forEach(r => { r.entries.find(e => e.label === label)!.exactApplicability.judgment = 'fail'; }); f.third.entries.find(e => e.label === label)!.exactApplicability.judgment = 'uncertain';
    const r = f.records(), proof = verifyAutomaticDevelopmentReview(r); assert.equal(proof.status, 'blocked'); assert.ok(proof.primaryPairs.some(p => p.unresolvedMaterialConcerns.includes('exactApplicability')));
    const axis = r.adjudication.axisResolutions.find(a => a.label === label && a.axis === 'exactApplicability')!; axis.disposition = 'source_resolved'; assert.throws(() => verifyAutomaticDevelopmentReview(r), /uncertain source adjudication/);
  } finally { f.cleanup(); }
});
test('all complete/partial-review, exact matched-pair and independent-identity requirements fail closed', () => {
  const f = fixture(); try {
    let r = f.records(); r.independentReviews[0]!.review.entries.pop(); assert.throws(() => verifyAutomaticDevelopmentReview(r));
    r = f.records(); r.crossReviews[0]!.comparisons[0]!.secondLabel = f.primaryLabel('semantic'); assert.throws(() => verifyAutomaticDevelopmentReview(r));
    r = f.records(); r.adjudication.pairResolutions[0] = structuredClone(r.adjudication.pairResolutions[1]!); assert.throws(() => verifyAutomaticDevelopmentReview(r), /36 exact pairs/);
    r = f.records(); r.adjudication.adjudicator = r.independentReviews[0]!.review.reviewer; assert.throws(() => verifyAutomaticDevelopmentReview(r));
    r = f.records(); r.adjudication.requestSha256 = '0'.repeat(64); assert.throws(() => verifyAutomaticDevelopmentReview(r));
    r = f.records(); Object.assign(r.adjudication, { humanAxisReviewResolved: true }); assert.throws(() => verifyAutomaticDevelopmentReview(r));
  } finally { f.cleanup(); }
});
test('literal source, answer, originalQuestion evidence and every disputed axis are bound exactly', () => {
  const f = fixture(); try {
    const label = f.primaryLabel('semantic'); f.raw[0]!.entries.find(e => e.label === label)!.appropriateUncertainty.judgment = 'uncertain';
    let r = f.records(); r.adjudication.axisResolutions.pop(); assert.throws(() => verifyAutomaticDevelopmentReview(r), /every disputed/);
    r = f.records(); r.adjudication.axisResolutions[0]!.evidence[0]!.originalQuestion = 'Different product question'; assert.throws(() => verifyAutomaticDevelopmentReview(r), /originalQuestion scope/);
    r = f.records(); r.adjudication.pairResolutions[0]!.answerQuotes[0]!.quote = 'absent invented quote'; assert.throws(() => verifyAutomaticDevelopmentReview(r), /answer quotes/);
    r = f.records(); r.adjudication.adjudicatorReview.reviewSha256 = '0'.repeat(64); assert.throws(() => verifyAutomaticDevelopmentReview(r));
  } finally { f.cleanup(); }
});
test('explicit preference and reviewer agreement cannot invent the missing-report gain', () => {
  const f = fixture(); try {
    for (const review of [...f.raw, f.third]) for (const e of review.entries) e.facts.forEach(f => { f.status = 'covered'; });
    const proof = verifyAutomaticDevelopmentReview(f.records()); assert.equal(proof.status, 'blocked'); assert.ok(proof.blockers.some(b => b.includes('No source-supported missing-report gain')));
  } finally { f.cleanup(); }
});
