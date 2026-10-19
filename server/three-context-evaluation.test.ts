import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { syntheticPreparation } from '../scripts/three-context-mock.ts';
import { anonymousDiagnosticReview, diagnosticHash, type DiagnosticCheckpoint } from './three-context-diagnostic.ts';
import { sourceCitationOptions } from './citation-options.ts';
import { workspaceGenerationParts } from './workspace-generation.ts';
import { textHash } from './product-corpus.ts';
import { THREE_CONTEXT_LIVE_FILES, prepareThreeContextLive, threeContextLiveResult } from './three-context-live.ts';
import { prepareThreeContextEvaluation, verifyThreeContextEvaluation, importThreeContextReview, reportThreeContextEvaluation, threeContextEvaluationCli,
  type ThreeContextEvaluationPacket, type ThreeContextReviewImport } from './three-context-evaluation.ts';
const encode = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Explicitly synthetic saved receipts. Existing live adapter suites separately
 * test the real provider/temporary-ledger path with mocked transport. */
function fixture(options: { failed?: boolean; unknownUsage?: boolean; legacyCqa?: boolean } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-evaluation-SYNTHETIC-')));
  const write = (path: string, bytes: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); };
  for (const path of THREE_CONTEXT_LIVE_FILES) write(path, path.endsWith('.ts') ? '// SYNTHETIC stub for byte-bound receipt-replay test\n' : '{}\n');
  write('.data/sources.json', '{"provenance":"SYNTHETIC"}\n'); const p = syntheticPreparation();
  if (options.legacyCqa) {
    const item = p.cases[0]!, source = item.completeSources[1]!; source.source = 'cqa'; source.text += ` Question: ${source.originalQuestion}`;
    source.sha256 = textHash(source.text); item.referenceReview.sourcePoolSha256 = diagnosticHash(item.completeSources);
  }
  const hashFile = (path: string) => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
  p.implementationSha256 = Object.fromEntries(THREE_CONTEXT_LIVE_FILES.map(path => [path, hashFile(path)])); p.artifactSha256 = { '.data/sources.json': hashFile('.data/sources.json') };
  const preparation = { repositoryPath: root, outputDirectory: join(root, '.data/execution'), diagnostic: p }, path = join(root, '.data/preparation.json'); writeFileSync(path, encode(preparation));
  const manifest = prepareThreeContextLive(preparation, path);
  const checkpoint: DiagnosticCheckpoint = { planSha256: manifest.diagnostic.sha256, provenance: 'mocked_mechanics_only', stopReason: options.failed ? 'SYNTHETIC failure' : null,
    steps: manifest.diagnostic.document.slots.map((slot, index) => {
      if (options.failed && index === 2) return { index, started: false, dispatched: false };
      const step = { index, started: true, dispatchIntent: true as const, dispatched: true, attemptId: `SYNTHETIC-attempt-${index}` };
      if (options.failed && index === 1) return step;
      const parts = workspaceGenerationParts(slot.input), usage = options.unknownUsage ? null : { inputTokens: 10, outputTokens: 5 };
      const body = { ...slot.binding, promptVersion: slot.binding.contract, mode: 'live', model: 'gpt-luna', accounting: 'local_planning_allowance', usage,
        output: { answer: 'SYNTHETIC nearly eight hours, manually extinguished; population average remains unknown.', status: 'answered', citations: [sourceCitationOptions(parts.scope)[0]!.id] } };
      return { ...step, receipt: { id: step.attemptId, kind: parts.tool, status: 'completed', error_code: null, receipt_json: JSON.stringify(body), model: 'gpt-luna',
        input_tokens: usage?.inputTokens ?? null, output_tokens: usage?.outputTokens ?? null, allowance_usd: .1 } };
    }) };
  const initial: DiagnosticCheckpoint = { planSha256: checkpoint.planSha256, provenance: checkpoint.provenance, stopReason: null, steps: checkpoint.steps.map(s => ({ index: s.index, started: false, dispatched: false })) };
  const checkpoints = [initial, checkpoint], savedResult = threeContextLiveResult(manifest, checkpoint), anonymous = anonymousDiagnosticReview(manifest.diagnostic, checkpoint, 'SYNTHETIC randomized neutral labels');
  const packet = prepareThreeContextEvaluation(manifest, checkpoints, savedResult, anonymous.review);
  return { root, manifest, checkpoint, checkpoints, savedResult, anonymous, packet, write, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
function review(packet: ThreeContextEvaluationPacket, provenance: ThreeContextReviewImport['provenance'] = 'ai_provisional'): ThreeContextReviewImport {
  const answer = packet.answers.find(a => a.status === 'completed')!, item = packet.cases.find(c => c.id === answer.caseId)!, source = item.completeSources.find(s => s.id === item.designatedFacts[0]!.sourceIds[0])!;
  const evidence = [{ sourceId: source.id, quote: source.text, originalQuestion: source.originalQuestion ?? null }];
  const axis = { judgment: 'pass' as const, rationale: 'SYNTHETIC source-checked fixture assertion only.', evidence };
  return { format: 'ablatrix-source-checked-review-v1', packetSha256: packet.sha256, reviewer: `SYNTHETIC-${provenance}`, provenance, purpose: 'independent_review', recordedAt: '2026-10-19T12:00:00Z', sourceChecked: true,
    entries: [{ label: answer.label, sourcePoolSha256: answer.sourcePoolSha256, answerSha256: answer.answerSha256,
      facts: item.designatedFacts.map(f => ({ factId: f.factId, status: 'covered', rationale: 'SYNTHETIC: preserves manual stop qualification.', evidence })),
      unsupportedClaims: [], exactApplicability: structuredClone(axis), appropriateUncertainty: structuredClone(axis), directRelevance: structuredClone(axis),
      unknowns: item.unknowns.map(unknown => ({ unknown, status: 'preserved', rationale: 'SYNTHETIC unknown average is preserved.' })) }] };
}
test('evaluation packet binds replayed live receipts/results and retains full sources without arm identities', () => {
  const f = fixture({ unknownUsage: true });
  try {
    assert.equal(f.savedResult.usage, null); assert.equal(f.packet.answers.length, 3); assert.equal(f.packet.cases[0]!.completeSources.length, 3);
    assert.equal(f.packet.cases[0]!.completeSources[1]!.originalQuestion, 'How long did model ZX-1 burn?');
    assert.match(f.packet.cases[0]!.designatedFacts[0]!.qualification, /Manually extinguished/); assert.equal(f.packet.qualityClaimEligible, false);
    const forbidden = new Set(['arm', 'operationRunId', 'attemptId', 'model', 'usage', 'requestSha256', 'sourceContextSha256', 'lexicalRank', 'semanticRank']);
    function inspect(value: unknown) { if (!value || typeof value !== 'object') return; for (const [key, child] of Object.entries(value)) { assert.ok(!forbidden.has(key), `Leaked ${key}`); inspect(child); } }
    inspect(f.packet);
    const noReview = reportThreeContextEvaluation(f.packet, []); assert.equal(noReview.humanSourceCheckedActualAnswers, 0); assert.equal(noReview.reviewRecords.length, 0); assert.equal(noReview.focusedReview.filter(r => r.needsFocusedHumanReview).length, 3);
    assert.equal(noReview.denominator.completed, 3); assert.equal(noReview.newProviderCalls, 0);
  } finally { f.cleanup(); }
});
test('evaluation rejects altered source scopes, receipt outputs, journal history, saved accounting and anonymous extra fields', () => {
  const f = fixture();
  try {
    const badResult = { ...f.savedResult, completedAnswers: 0 };
    assert.throws(() => prepareThreeContextEvaluation(f.manifest, f.checkpoints, badResult, f.anonymous.review), /full journal/);
    const badReview = structuredClone(f.anonymous.review); badReview.cases[0]!.completeSources[1]!.originalQuestion = 'ZX-2?';
    assert.throws(() => prepareThreeContextEvaluation(f.manifest, f.checkpoints, f.savedResult, badReview), /scope/);
    const answer = structuredClone(f.anonymous.review); answer.answers[0]!.output!.answer += ' CHANGED';
    assert.throws(() => prepareThreeContextEvaluation(f.manifest, f.checkpoints, f.savedResult, answer), /replayed receipt/);
    const leak = structuredClone(f.anonymous.review); Object.assign(leak.answers[0]!, { arm: 'current' });
    assert.throws(() => prepareThreeContextEvaluation(f.manifest, f.checkpoints, f.savedResult, leak));
    const history = [structuredClone(f.checkpoint), structuredClone(f.checkpoint)]; history[1]!.steps[0]!.dispatched = false;
    assert.throws(() => prepareThreeContextEvaluation(f.manifest, history, f.savedResult, f.anonymous.review), /cannot disappear/);
    const leaked = structuredClone(f.checkpoint), receipt = leaked.steps[0]!.receipt!, body = JSON.parse(receipt.receipt_json!);
    body.output.answer += ` ${f.manifest.diagnostic.document.slots[0]!.input.runId}`; receipt.receipt_json = JSON.stringify(body);
    const leakedReview = anonymousDiagnosticReview(f.manifest.diagnostic, leaked, 'SYNTHETIC neutral secret again').review;
    assert.throws(() => prepareThreeContextEvaluation(f.manifest, [leaked], threeContextLiveResult(f.manifest, leaked), leakedReview), /would reveal its arm/);
  } finally { f.cleanup(); }
});
test('legacy CQA citation scope keeps original question and literal saved text without treating the question as the offered answer body', () => {
  const f = fixture({ legacyCqa: true });
  try {
    const item = f.packet.cases[0]!, source = item.completeSources[1]!; assert.match(source.text, /Question: How long/); assert.equal(source.originalQuestion, 'How long did model ZX-1 burn?');
    const citation = f.packet.answers.flatMap(a => a.output?.citations ?? []).find(c => c.passageId === source.id)!;
    assert.equal(citation.quote, source.text.split(' Question:')[0]); verifyThreeContextEvaluation(f.packet); importThreeContextReview(f.packet, review(f.packet));
  } finally { f.cleanup(); }
});
test('failed and unattempted arms stay in evaluation denominator and cannot acquire answer judgments', () => {
  const f = fixture({ failed: true });
  try {
    const report = reportThreeContextEvaluation(f.packet, []); assert.deepEqual(report.denominator, { plannedAnswers: 3, completed: 1, failedOrUnknown: 1, unattempted: 1 });
    const judgment = review(f.packet), failed = f.packet.answers.find(a => a.status === 'failed_or_unknown')!; judgment.entries[0]!.label = failed.label;
    assert.throws(() => importThreeContextReview(f.packet, judgment), /Failed or unattempted/);
    assert.equal(f.packet.answers.find(a => a.status === 'not_attempted')!.literalCitationMatching.status, 'not_assessable');
  } finally { f.cleanup(); }
});
test('source-checked imports bind all axes, qualifications, exact original-question scope and answer bytes', () => {
  const f = fixture();
  try {
    const ai = review(f.packet), imported = importThreeContextReview(f.packet, ai); assert.equal(imported.reviewSha256, diagnosticHash(ai));
    for (const mutate of [
      (r: typeof ai) => { r.entries[0]!.answerSha256 = '0'.repeat(64); },
      (r: typeof ai) => { r.entries[0]!.sourcePoolSha256 = '0'.repeat(64); },
      (r: typeof ai) => { r.entries[0]!.facts[0]!.evidence[0]!.originalQuestion = 'How long did model ZX-2 burn?'; },
      (r: typeof ai) => { r.entries[0]!.facts.push(structuredClone(r.entries[0]!.facts[0]!)); },
      (r: typeof ai) => { r.entries[0]!.unknowns = []; },
      (r: typeof ai) => { r.entries[0]!.unsupportedClaims = [{ claim: 'invented answer text', severity: 'material', rationale: 'SYNTHETIC' }]; },
      (r: typeof ai) => { r.entries[0]!.facts[0]!.evidence = []; },
      (r: typeof ai) => { r.purpose = 'calibration_reference'; },
      (r: typeof ai) => { Object.assign(r, { arm: 'semantic' }); }
    ]) { const changed = structuredClone(ai); mutate(changed); assert.throws(() => importThreeContextReview(f.packet, changed)); }
    const bad = structuredClone(f.packet); bad.cases[0]!.completeSources[0]!.text = 'changed'; const { sha256: _sha, ...document } = bad; bad.sha256 = diagnosticHash(document); assert.throws(() => verifyThreeContextEvaluation(bad));
  } finally { f.cleanup(); }
});
test('focused review and small human calibration remain separate from mechanical citations and quality claims', () => {
  const f = fixture();
  try {
    const human = review(f.packet, 'source_checked_human'); human.purpose = 'calibration_reference'; const ai = review(f.packet); ai.entries[0]!.appropriateUncertainty.judgment = 'fail';
    ai.entries[0]!.unsupportedClaims = [{ claim: 'nearly eight hours', severity: 'material', rationale: 'SYNTHETIC disagreement preserved.' }];
    const a = importThreeContextReview(f.packet, ai), h = importThreeContextReview(f.packet, human), report = reportThreeContextEvaluation(f.packet, [a, h]);
    const assessed = report.focusedReview.find(r => r.label === ai.entries[0]!.label)!;
    assert.deepEqual(assessed.disagreementAxes.sort(), ['appropriateUncertainty', 'unsupportedClaims']); assert.equal(assessed.needsFocusedHumanReview, true);
    assert.equal(report.calibration.length, 1); assert.equal(report.calibration[0]!.calibrationItems, 1); assert.equal(report.calibration[0]!.disagreementsForFocusedHumanReview.length, 2);
    assert.equal(report.reviewRecords[0]!.aiCalibration, 'small_bound_reference_only'); assert.equal(report.reviewRecords[0]!.answers[0]!.literalCitationMatching.status, 'pass');
    assert.equal(report.humanSourceCheckedActualAnswers, 0, 'Synthetic attested human fixtures never become actual human reviews.'); assert.equal(report.qualityClaimEligible, false);
    assert.throws(() => reportThreeContextEvaluation(f.packet, [a, a]), /Duplicate imports/);
    const sameReviewer = structuredClone(ai); sameReviewer.entries[0]!.appropriateUncertainty.judgment = 'pass';
    assert.throws(() => reportThreeContextEvaluation(f.packet, [a, importThreeContextReview(f.packet, sameReviewer)]), /consolidated record/);
    assert.equal(reportThreeContextEvaluation(f.packet, [a]).reviewRecords[0]!.aiCalibration, 'uncalibrated');
  } finally { f.cleanup(); }
});
test('offline evaluation CLI prepares, imports and reports with exclusive output and no credentials or ledger', () => {
  const f = fixture();
  try {
    for (const [path, value] of [['plan.json', f.manifest], ['result.json', f.savedResult], ['review.json', f.anonymous.review]] as const) f.write(`.data/${path}`, encode(value));
    f.write('.data/checkpoint.jsonl', f.checkpoints.map(c => JSON.stringify(c)).join('\n') + '\n'); const path = (name: string) => join(f.root, '.data', name);
    const prepare = ['prepare', '--plan', path('plan.json'), '--checkpoint', path('checkpoint.jsonl'), '--result', path('result.json'), '--review', path('review.json'), '--out', path('packet.json')];
    assert.equal(threeContextEvaluationCli(prepare).newProviderCalls, 0); assert.equal(statSync(path('packet.json')).mode & 0o777, 0o600); assert.throws(() => threeContextEvaluationCli(prepare), /EEXIST/);
    f.write('.data/judgments.json', encode(review(f.packet)));
    threeContextEvaluationCli(['import', '--packet', path('packet.json'), '--judgments', path('judgments.json'), '--out', path('imported.json')]);
    threeContextEvaluationCli(['report', '--packet', path('packet.json'), '--import', path('imported.json'), '--out', path('report.json')]);
    const report = JSON.parse(readFileSync(path('report.json'), 'utf8')); assert.equal(report.reviewRecords[0].provenance, 'ai_provisional'); assert.equal(report.denominator.plannedAnswers, 3); assert.equal(report.newProviderCalls, 0);
    assert.throws(() => threeContextEvaluationCli(['report', '--packet', path('packet.json'), '--out', path('other.json'), '--arm-mapping', 'forbidden']));
  } finally { f.cleanup(); }
});
