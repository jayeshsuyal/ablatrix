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
import { textHash } from './product-corpus.ts';
import { reportCalibrationNeutralComparisonPairs, normalizeReportCalibrationEvaluation, verifyReportCalibrationComparisons, ReportCalibrationOutcomeBlocked, type ReportCalibrationCrossReview } from './report-calibration-outcome.ts';

/** Explicitly synthetic receipt/source-review fixtures. The caller's actual
 * canonical receipt check is intentionally outside this pure review-gate test. */
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-outcome-SYNTHETIC-'))), write = (path: string, value: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  for (const path of THREE_CONTEXT_LIVE_FILES) write(path, '// SYNTHETIC execution-binding stub\n'); write('.data/synthetic-sources.json', '{"provenance":"SYNTHETIC"}\n');
  const s = syntheticPreparation(), gap = s.cases[0]!; gap.id = REPORT_CALIBRATION_V1.selectedSourceCaseIds[0]; const control = structuredClone(gap); control.id = REPORT_CALIBRATION_V1.selectedSourceCaseIds[1];
  control.product = { ...control.product, id: 'SYNTHETIC-control' }; control.completeSources = control.completeSources.map(p => ({ ...p, productId: control.product.id }));
  control.contexts = { current: control.completeSources, semantic: control.completeSources, reference: control.completeSources }; control.referenceReview.sourcePoolSha256 = diagnosticHash(control.completeSources);
  const hash = (path: string) => textHash(readFileSync(join(root, path), 'utf8'));
  const p = createReportCalibrationPreparation(root, [gap, control], s.policy, { ...s.ledger, attempts: 141, reservedUsd: 14.1 },
    { implementationSha256: Object.fromEntries(THREE_CONTEXT_LIVE_FILES.map(path => [path, hash(path)])), artifactSha256: { '.data/synthetic-sources.json': hash('.data/synthetic-sources.json') } },
    { v6ReviewedResultPath: '.data/synthetic-sources.json', expectedV6ReviewedResultSha256: '1'.repeat(64), sourceReviewPath: '.data/synthetic-sources.json', expectedSourceReviewSha256: '2'.repeat(64) }, 'a'.repeat(64), join(root, '.data/execution'));
  p.diagnostic.codeReviewPassed = true; const prep = join(root, '.data/preparation.json'); writeFileSync(prep, JSON.stringify(p, null, 2) + '\n'); const manifest = prepareThreeContextLive(p, prep);
  const checkpoint: DiagnosticCheckpoint = { planSha256: manifest.diagnostic.sha256, provenance: 'live_router', stopReason: null, steps: manifest.diagnostic.document.slots.map((slot, index) => {
    const parts = workspaceGenerationParts(slot.input), id = `SYNTHETIC-attempt-${index}`, usage = { inputTokens: 10, outputTokens: 5 };
    return { index, started: true, dispatchIntent: true, dispatched: true, attemptId: id, receipt: { id, kind: parts.tool, status: 'completed', error_code: null, allowance_usd: .1, model: 'gpt-luna', input_tokens: 10, output_tokens: 5,
      receipt_json: JSON.stringify({ ...slot.binding, promptVersion: slot.binding.contract, mode: 'live', accounting: 'local_planning_allowance', model: 'gpt-luna', usage,
        output: { answer: `SYNTHETIC source report for fixture observation ${index}; limitations are not established by generated fixtures.`, status: 'answered', citations: [sourceCitationOptions(parts.scope)[0]!.id] } }) } };
  }) };
  const anonymous = anonymousDiagnosticReview(manifest.diagnostic, checkpoint, 'SYNTHETIC neutral review ordering'), packet = normalizeReportCalibrationEvaluation(prepareThreeContextEvaluation(manifest, [checkpoint], threeContextLiveResult(manifest, checkpoint), anonymous.review)), mapping = anonymous.mapping;
  const neutral = reportCalibrationNeutralComparisonPairs(p, packet, mapping);
  const condition = (label: string) => { const m = mapping.find(m => m.label === label)!, instance = p.reportCalibration.caseInstancesPrivate.find(i => i.caseId === m.caseId)!; return { ...instance, arm: m.arm }; };
  const outcome = (a: string, b: string, kind: 'instruction' | 'retrieval', negative = false) => {
    if (condition(a).sourceCaseId !== REPORT_CALIBRATION_V1.selectedSourceCaseIds[0]) return 'tie' as const;
    const candidate = kind === 'instruction' ? condition(a).generationContract === WORKSPACE_UNCERTAINTY_CONTRACT ? a : b : condition(a).arm === 'semantic' ? a : b;
    const preferred = negative ? candidate === a ? b : a : candidate; return preferred === a ? 'first_preferred' as const : 'second_preferred' as const;
  };
  function rawReview(reviewer: string, provenance: ThreeContextReviewImport['provenance'] = 'ai_provisional', negative = false): ThreeContextReviewImport {
    return { format: 'ablatrix-source-checked-review-v1', packetSha256: packet.sha256, reviewer, provenance, purpose: provenance === 'ai_provisional' ? 'independent_review' : 'focused_disagreement', recordedAt: '2026-10-19T12:00:00Z', sourceChecked: true,
      entries: packet.answers.map(answer => {
        const c = packet.cases.find(c => c.id === answer.caseId)!, v = condition(answer.label), isGap = v.sourceCaseId === REPORT_CALIBRATION_V1.selectedSourceCaseIds[0], newer = v.generationContract === WORKSPACE_UNCERTAINTY_CONTRACT;
        const evidence = (ids: string[]) => ids.map(id => { const s = c.completeSources.find(s => s.id === id)!; return { sourceId: id, quote: s.text, originalQuestion: s.originalQuestion ?? null }; });
        const axis = (judgment: 'pass' | 'fail') => ({ judgment, rationale: 'SYNTHETIC source-checked fixture assertion, not an actual human/model measurement.', evidence: evidence(c.designatedFacts[0]!.sourceIds) });
        return { label: answer.label, sourcePoolSha256: answer.sourcePoolSha256, answerSha256: answer.answerSha256,
          facts: c.designatedFacts.map(f => ({ factId: f.factId, status: isGap && v.arm === 'current' ? 'missing' : 'covered', rationale: 'SYNTHETIC designated fact/qualification fixture assessment.', evidence: evidence(f.sourceIds) })),
          unsupportedClaims: negative && isGap && v.arm === 'semantic' ? [{ claim: 'SYNTHETIC', severity: 'material', rationale: 'SYNTHETIC deliberately negative support fixture.' }] : [],
          exactApplicability: axis('pass'), appropriateUncertainty: axis(isGap && (!newer || negative) ? 'fail' : 'pass'), directRelevance: axis('pass'),
          unknowns: c.unknowns.map(unknown => ({ unknown, status: isGap && (!newer || negative) ? 'missing' : 'preserved', rationale: 'SYNTHETIC uncertainty preservation fixture only.' })) };
      }), comparisons: neutral.withinInstancePairs.map(pair => ({ ...pair, outcome: outcome(pair.firstLabel, pair.secondLabel, 'retrieval', negative), rationale: 'SYNTHETIC explicit source-aware fixture preference; no empirical quality claim.' })) };
  }
  function records(raw: ThreeContextReviewImport[]) {
    const imports = raw.map(r => importThreeContextReview(packet, r));
    const cross: ReportCalibrationCrossReview[] = imports.map(r => ({ format: 'ablatrix-report-calibration-cross-instruction-review-v1', packetSha256: packet.sha256, reviewer: r.review.reviewer, provenance: r.review.provenance, sourceReviewSha256: r.reviewSha256,
      comparisons: neutral.crossInstructionPairs.map(pair => ({ ...pair, outcome: outcome(pair.firstLabel, pair.secondLabel, 'instruction', r.review.entries.some(e => e.unsupportedClaims.length > 0)), rationale: 'SYNTHETIC explicit matched-instruction fixture verdict, not a quality measurement.' })) }));
    return { imports, cross };
  }
  return { p, packet, mapping, neutral, condition, rawReview, records, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
function blocked(run: () => unknown) { try { run(); assert.fail('Expected substantive gate rejection.'); } catch (error) { assert.ok(error instanceof ReportCalibrationOutcomeBlocked); return error.summary; } }
test('neutral matched-pair constructor retains all36 required and diagnostic comparisons without revealing conditions', () => {
  const f = fixture();
  try {
    assert.equal(f.neutral.withinInstancePairs.length, 24); assert.equal(f.neutral.crossInstructionPairs.length, 12);
    for (const c of f.packet.cases) { const pairs = f.neutral.withinInstancePairs.filter(p => p.caseId === c.id); assert.equal(pairs.length, 3); assert.equal(new Set(pairs.flatMap(p => [p.firstLabel, p.secondLabel])).size, 3, 'No omitted third answer may reveal the reference condition.'); }
    const publicText = JSON.stringify(f.neutral); assert.ok(!publicText.includes('workspace-answer')); assert.ok(!publicText.includes('privateCaseIdentityKey')); assert.ok(!publicText.includes('semantic'));
    for (const pair of [...f.neutral.withinInstancePairs, ...f.neutral.crossInstructionPairs]) assert.ok(pair.firstLabel < pair.secondLabel, 'Pair order depends only on anonymous labels.');
    for (const pairs of [f.neutral.withinInstancePairs, f.neutral.crossInstructionPairs]) { const keys = pairs.map(p => JSON.stringify([p.firstLabel, p.secondLabel])); assert.deepEqual(keys, [...keys].sort(), 'Pair-list order cannot retain execution/context triples.'); }
    assert.deepEqual(f.packet.cases.map(c => c.id), f.packet.cases.map(c => c.id).sort()); assert.deepEqual(f.packet.answers.map(a => a.label), f.packet.answers.map(a => a.label).sort());
    const r = f.records([f.rawReview('SYNTHETIC-ai-alpha'), f.rawReview('SYNTHETIC-ai-beta')]);
    const proof = verifyReportCalibrationComparisons(f.p, f.packet, r.imports, f.mapping, r.cross);
    assert.equal(proof.status, 'reviewed_development_signal_supports_bounded_fresh_preparation'); assert.equal(proof.pairResults.length, 36); assert.equal(proof.retrievalBenefitPairs.length, 4); assert.equal(proof.instructionBenefitPairs.length, 2);
    assert.equal(proof.actualProducts, 2); assert.equal(proof.freshProducts, 0); assert.equal(proof.qualityClaimEligible, false); assert.equal(proof.freshExecutionAuthorized, false);
  } finally { f.cleanup(); }
});
test('normalization removes private preparation order before review hashes and is enforced by the checker', () => {
  const f = fixture();
  try {
    const altered = structuredClone(f.packet); altered.cases.reverse(); altered.answers.reverse(); const { sha256: _hash, ...document } = altered; altered.sha256 = diagnosticHash(document);
    assert.deepEqual(normalizeReportCalibrationEvaluation(altered), f.packet);
    const r = f.records([f.rawReview('SYNTHETIC-ai-alpha'), f.rawReview('SYNTHETIC-ai-beta')]);
    assert.throws(() => verifyReportCalibrationComparisons(f.p, altered, r.imports, f.mapping, r.cross), /normalized report-calibration packet/);
    assert.deepEqual(reportCalibrationNeutralComparisonPairs(f.p, f.packet, [...f.mapping].reverse()), f.neutral);
  } finally { f.cleanup(); }
});
test('positive AI consensus never suppresses supplied negative human axes, preferences or partial uncertain entries', () => {
  const f = fixture();
  try {
    const ai = [f.rawReview('SYNTHETIC-ai-alpha'), f.rawReview('SYNTHETIC-ai-beta')], negativeHuman = f.rawReview('SYNTHETIC-human-negative-fixture', 'source_checked_human', true);
    const negative = f.records([...ai, negativeHuman]), proof = blocked(() => verifyReportCalibrationComparisons(f.p, f.packet, negative.imports, f.mapping, negative.cross));
    assert.ok(proof.blockers.some(b => b.includes('Confirmed regression'))); assert.ok(proof.blockers.some(b => b.includes('Confirmed control preference')));
    assert.ok(proof.pairResults.some(p => p.reviewerVerdicts.some(r => r.provenance === 'source_checked_human' && r.preference === 'control_preferred')));
    const partial = f.rawReview('SYNTHETIC-partial-human-fixture', 'source_checked_human'); partial.entries = partial.entries.slice(0, 1); partial.entries[0]!.exactApplicability.judgment = 'uncertain'; partial.comparisons = [];
    const onlyPartial = f.records([...ai, partial]); onlyPartial.cross = onlyPartial.cross.filter(r => r.provenance === 'ai_provisional');
    const unresolved = blocked(() => verifyReportCalibrationComparisons(f.p, f.packet, onlyPartial.imports, f.mapping, onlyPartial.cross)); assert.ok(unresolved.blockers.some(b => b.includes('human resolution')));
    assert.ok(unresolved.pairResults.some(p => p.suppliedHumanAxisFindings.some(h => h.reviewer === partial.reviewer && h.label === partial.entries[0]!.label && h.exactApplicability === 'uncertain')));
    const positiveHuman = f.rawReview('SYNTHETIC-human-positive-fixture', 'source_checked_human'); partial.entries[0]!.exactApplicability.judgment = 'fail';
    const conflict = f.records([...ai, partial, positiveHuman]); conflict.cross = conflict.cross.filter(r => r.reviewer !== partial.reviewer);
    blocked(() => verifyReportCalibrationComparisons(f.p, f.packet, conflict.imports, f.mapping, conflict.cross));
  } finally { f.cleanup(); }
});
test('unanimous negative AI evidence cannot qualify, and a human who confirms the negative cannot waive it', () => {
  const f = fixture();
  try {
    const raw = [f.rawReview('SYNTHETIC-ai-alpha', 'ai_provisional', true), f.rawReview('SYNTHETIC-ai-beta', 'ai_provisional', true)];
    const r = f.records(raw), negative = blocked(() => verifyReportCalibrationComparisons(f.p, f.packet, r.imports, f.mapping, r.cross));
    assert.equal(negative.status, 'blocked'); assert.equal(negative.retrievalBenefitPairs.length, 0); assert.equal(negative.instructionBenefitPairs.length, 0); assert.ok(negative.blockers.some(b => b.includes('human resolution')));
    const withHuman = f.records([...raw, f.rawReview('SYNTHETIC-human-negative-fixture', 'source_checked_human', true)]);
    const confirmed = blocked(() => verifyReportCalibrationComparisons(f.p, f.packet, withHuman.imports, f.mapping, withHuman.cross)); assert.ok(confirmed.blockers.some(b => b.includes('Confirmed regression'))); assert.ok(confirmed.blockers.some(b => b.includes('Confirmed control preference')));
  } finally { f.cleanup(); }
});
test('explicit preferences alone cannot manufacture missing-unit retrieval or uncertainty-policy benefit', () => {
  const f = fixture();
  try {
    const raw = [f.rawReview('SYNTHETIC-ai-alpha'), f.rawReview('SYNTHETIC-ai-beta')];
    for (const review of raw) for (const e of review.entries) { e.facts.forEach(f => { f.status = 'covered'; }); e.appropriateUncertainty.judgment = 'pass'; e.unknowns.forEach(u => { u.status = 'preserved'; }); }
    const r = f.records(raw), proof = blocked(() => verifyReportCalibrationComparisons(f.p, f.packet, r.imports, f.mapping, r.cross));
    assert.ok(proof.blockers.some(b => b.includes('No reviewed missing-unit'))); assert.ok(proof.blockers.some(b => b.includes('No reviewed uncertainty')));
  } finally { f.cleanup(); }
});
test('new material claims require source-aware human correction, not a positive preference or presence-only human record', () => {
  const f = fixture();
  try {
    const raw = [f.rawReview('SYNTHETIC-ai-alpha'), f.rawReview('SYNTHETIC-ai-beta')];
    for (const review of raw) for (const entry of review.entries) if (f.condition(entry.label).sourceCaseId === REPORT_CALIBRATION_V1.selectedSourceCaseIds[0] && f.condition(entry.label).arm === 'semantic' && f.condition(entry.label).generationContract === WORKSPACE_UNCERTAINTY_CONTRACT) entry.unsupportedClaims = [{ claim: 'SYNTHETIC', severity: 'material', rationale: 'SYNTHETIC new unsupported claim fixture.' }];
    const r = f.records(raw); blocked(() => verifyReportCalibrationComparisons(f.p, f.packet, r.imports, f.mapping, r.cross));
    const human = f.rawReview('SYNTHETIC-human-correction-fixture', 'source_checked_human'), presence = f.records([...raw, { ...human, comparisons: [] }]); presence.cross = presence.cross.filter(c => c.provenance === 'ai_provisional');
    blocked(() => verifyReportCalibrationComparisons(f.p, f.packet, presence.imports, f.mapping, presence.cross));
    const corrected = f.records([...raw, human]); const proof = verifyReportCalibrationComparisons(f.p, f.packet, corrected.imports, f.mapping, corrected.cross);
    assert.ok(proof.pairResults.some(p => p.resolvedByHumanReviewers.includes(human.reviewer))); assert.equal(proof.qualityClaimEligible, false);
  } finally { f.cleanup(); }
});
test('any reviewer uncertainty or disagreement needs an explicit non-uncertain bound human pair resolution', () => {
  const f = fixture();
  try {
    const raw = [f.rawReview('SYNTHETIC-ai-alpha'), f.rawReview('SYNTHETIC-ai-beta')], label = raw[1]!.entries[0]!.label;
    raw[1]!.entries[0]!.exactApplicability.judgment = 'uncertain'; const r = f.records(raw);
    const proof = blocked(() => verifyReportCalibrationComparisons(f.p, f.packet, r.imports, f.mapping, r.cross)); assert.ok(proof.blockers.some(b => b.includes('human resolution')));
    const human = f.rawReview('SYNTHETIC-human-resolution-fixture', 'source_checked_human'), resolved = f.records([...raw, human]);
    assert.ok(verifyReportCalibrationComparisons(f.p, f.packet, resolved.imports, f.mapping, resolved.cross).pairResults.some(p => p.labels.includes(label) && p.resolvedByHumanReviewers.length));
    human.entries.find(e => e.label === label)!.exactApplicability.judgment = 'uncertain'; const stillUnknown = f.records([...raw, human]); blocked(() => verifyReportCalibrationComparisons(f.p, f.packet, stillUnknown.imports, f.mapping, stillUnknown.cross));
  } finally { f.cleanup(); }
});
test('crossed source/repeat/context pairs, duplicate pairs, incomplete reviewer coverage and unbound review claims are rejected', () => {
  const f = fixture();
  try {
    const make = () => f.records([f.rawReview('SYNTHETIC-ai-alpha'), f.rawReview('SYNTHETIC-ai-beta')]);
    const crossed = make(); crossed.cross[0]!.comparisons[0]!.secondLabel = f.packet.answers.find(a => f.condition(a.label).productId !== f.condition(crossed.cross[0]!.comparisons[0]!.firstLabel).productId)!.label;
    assert.throws(() => verifyReportCalibrationComparisons(f.p, f.packet, crossed.imports, f.mapping, crossed.cross), /exact matched/);
    const duplicated = make(); const first = duplicated.cross[0]!.comparisons[0]!; duplicated.cross[0]!.comparisons.push({ ...first, firstLabel: first.secondLabel, secondLabel: first.firstLabel });
    assert.throws(() => verifyReportCalibrationComparisons(f.p, f.packet, duplicated.imports, f.mapping, duplicated.cross), /Duplicate or reversed/);
    const incomplete = make(); incomplete.cross[0]!.comparisons.pop(); assert.throws(() => verifyReportCalibrationComparisons(f.p, f.packet, incomplete.imports, f.mapping, incomplete.cross), /all12/);
    const unbound = make(); unbound.cross[0]!.sourceReviewSha256 = '0'.repeat(64); assert.throws(() => verifyReportCalibrationComparisons(f.p, f.packet, unbound.imports, f.mapping, unbound.cross));
    const asserted = make(); Object.assign(asserted.cross[0]!, { noUnresolvedMaterialRegression: true }); assert.throws(() => verifyReportCalibrationComparisons(f.p, f.packet, asserted.imports, f.mapping, asserted.cross));
    const missing = f.rawReview('SYNTHETIC-ai-beta'), index = missing.comparisons!.findIndex(c => new Set([f.condition(c.firstLabel).arm, f.condition(c.secondLabel).arm]).has('current') && new Set([f.condition(c.firstLabel).arm, f.condition(c.secondLabel).arm]).has('semantic'));
    missing.comparisons!.splice(index, 1); const noWithin = f.records([f.rawReview('SYNTHETIC-ai-alpha'), missing]); assert.throws(() => verifyReportCalibrationComparisons(f.p, f.packet, noWithin.imports, f.mapping, noWithin.cross), /every within-instance/);
    const omittedReference = f.rawReview('SYNTHETIC-ai-beta'), referenceIndex = omittedReference.comparisons!.findIndex(c => f.condition(c.firstLabel).arm === 'reference' || f.condition(c.secondLabel).arm === 'reference');
    omittedReference.comparisons!.splice(referenceIndex, 1); const noReference = f.records([f.rawReview('SYNTHETIC-ai-alpha'), omittedReference]);
    assert.throws(() => verifyReportCalibrationComparisons(f.p, f.packet, noReference.imports, f.mapping, noReference.cross), /all24 unordered pairs/);
  } finally { f.cleanup(); }
});
test('control fact regressions stay blocked after human confirmation and exact mapping/factorial cells are enforced', () => {
  const f = fixture();
  try {
    const raw = [f.rawReview('SYNTHETIC-ai-alpha'), f.rawReview('SYNTHETIC-ai-beta'), f.rawReview('SYNTHETIC-human-negative-control-fixture', 'source_checked_human')];
    for (const r of raw) for (const e of r.entries) if (f.condition(e.label).sourceCaseId === REPORT_CALIBRATION_V1.selectedSourceCaseIds[1] && f.condition(e.label).generationContract === WORKSPACE_UNCERTAINTY_CONTRACT) e.facts.forEach(f => { f.status = 'missing'; });
    const changed = f.records(raw), proof = blocked(() => verifyReportCalibrationComparisons(f.p, f.packet, changed.imports, f.mapping, changed.cross)); assert.ok(proof.blockers.some(b => b.includes('Confirmed regression')));
    const good = f.records([f.rawReview('SYNTHETIC-ai-alpha'), f.rawReview('SYNTHETIC-ai-beta')]), brokenMap = structuredClone(f.mapping); brokenMap[0]!.operationRunId = 'wrong-operation';
    assert.throws(() => verifyReportCalibrationComparisons(f.p, f.packet, good.imports, brokenMap, good.cross), /exact frozen operations/);
    const brokenCells = structuredClone(f.p); brokenCells.reportCalibration.caseInstancesPrivate[0]!.repeat = 7; assert.throws(() => verifyReportCalibrationComparisons(brokenCells, f.packet, good.imports, f.mapping, good.cross), /factorial cell/);
  } finally { f.cleanup(); }
});
