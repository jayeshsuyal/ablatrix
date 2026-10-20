/** SYNTHETIC source mechanics only; no fresh product data, inference or network. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withFreshSelectionReplay } from '../scripts/fresh-validation-contexts-v2.ts';
import { textHash } from './product-corpus.ts';
import { ProductRetriever } from './product-retrieval.ts';
import { freshSeal, freshValidationBaseline, freshValidationContexts, freshValidationCorpus, verifyFreshValidationBaseline, replayFreshValidationContexts, type FreshPacket, type FreshScreening, type FreshSourceReview, type FreshSelection } from './fresh-validation-v2.ts';
async function fixture() {
  const packets: FreshPacket[] = Array.from({ length: 24 }, (_, i) => {
    const id = `B9${String(i).padStart(8, '0')}`;
    const sources = [
      ...Array.from({ length: 6 }, (_, d) => ({ id: `${id}-base-${d}`, label: 'bullet', text: `SYNTHETIC durable case ${i} detail ${d}.`, originalQuestion: null, reference: 'SYNTHETIC fixture' })),
      { id: `${id}-report`, label: 'cqa', text: `SYNTHETIC case ${i} report five to six hours under unknown conditions.`, originalQuestion: `SYNTHETIC model CASE-${i} duration?`, reference: 'SYNTHETIC fixture' },
      { id: `${id}-conflict`, label: 'review', text: `SYNTHETIC case ${i} nearly eight hours before manual extinguishing, not fuel exhaustion.`, originalQuestion: null, reference: 'SYNTHETIC fixture' }
    ].map(s => ({ ...s, sha256: textHash(JSON.stringify([s.id, s.label, s.text, s.originalQuestion, s.reference])) }));
    return { id: `SYNTHETIC-fresh-${i}`, product: { id, title: `SYNTHETIC Brand${i} device` }, question: 'Once filled, how long do they last on average?', sources, sourcePoolSha256: textHash(JSON.stringify(sources)) };
  });
  const screening: FreshScreening = { format: 'ablatrix-fresh-validation-screening-v2', screeningSha256: 'a'.repeat(64), screeningDenominator: 24,
    decisions: packets.map(p => ({ caseId: p.id, eligible: true, reasons: [], packet: p })), acceptedCaseIds: packets.map(p => p.id), candidateContextInspected: false, generatedAnswersInspected: false, providerCalls: 0, paidExecutionAuthorized: false };
  const corpus = freshValidationCorpus(screening);
  const retriever = new ProductRetriever(corpus, ':memory:', { embed: async (texts, kind) => texts.map(text => {
    if (kind === 'query') return [1, 0];
    const score = text.includes('durable') ? .99 - Number(text.match(/detail (\d+)/)?.[1] ?? 0) * .01 : text.includes('manual extinguishing') ? .1 : .2;
    return [score, Math.sqrt(1 - score * score)];
  }) });
  let baseline;
  try { baseline = await freshValidationBaseline(screening, retriever, async (_query, documents) => documents.map(d => d.includes('durable') ? -20 : 1)); } finally { retriever.close(); }
  const baselineFileSha256 = freshSeal(baseline);
  const review: FreshSourceReview = { format: 'ablatrix-fresh-validation-source-review-v2', screeningSha256: screening.screeningSha256, baselineSha256: baselineFileSha256,
    provenance: 'independent_source_review_ai', reviewer: 'SYNTHETIC source-only reviewer; no quality evidence', candidateContextInspected: false, answerOutputsInspected: false,
    cases: packets.map((p, i) => {
      const control = i === 1 || i === 2, refs = control ? p.sources.slice(0, 1) : p.sources.slice(-2);
      return { caseId: p.id, sourcePoolSha256: p.sourcePoolSha256, tags: [control ? 'baseline_complete_control' : i === 0 ? 'supported_gap' : i === 3 ? 'conflicting_reports' : i === 4 ? 'insufficient_evidence' : 'uncertain'],
        referenceSourceIds: refs.map(s => s.id), designatedFacts: refs.map(s => ({ fact: `SYNTHETIC source report ${s.id}`, quote: s.text, sourceIds: [s.id], qualification: 'SYNTHETIC customer conditions; manual extinguishing is not exhaustion.', applicability: `SYNTHETIC ${p.product.id} scope only` })), unknowns: ['SYNTHETIC population average unknown'], applicabilityNotes: 'SYNTHETIC attributed reports only, preserving conflicting duration/conditions.', referenceSufficiencyReviewed: true as const };
    }) };
  const sourceReviewFileSha256 = freshSeal(review);
  const selection: FreshSelection = { format: 'ablatrix-fresh-validation-selection-v2', screeningSha256: screening.screeningSha256, baselineSha256: baselineFileSha256, sourceReviewSha256: sourceReviewFileSha256,
    screeningDenominator: 24, selectedDenominator: 8, selectedCaseIds: packets.slice(0, 8).map(p => p.id), stopReason: null, candidateContextInspected: false, candidateMissesRetained: true };
  const contexts = await freshValidationContexts(screening, baseline, review, selection, { baselineFileSha256, sourceReviewFileSha256 });
  return { screening, baseline, review, selection, contexts };
}
test('v2 freezes all24 v5 control contexts before source-only eight-case selection and uses one shared uncertainty policy', async () => {
  const f = await fixture();
  assert.equal(f.baseline.results.length, 24); assert.equal(f.baseline.controlContext, 'frozen_v5');
  assert.equal(f.contexts.results.length, 8); assert.equal(f.contexts.sharedGenerationContract, 'workspace-answer-uncertainty-v2');
  assert.ok(f.contexts.cases.every(c => c.generationContract === f.contexts.sharedGenerationContract));
  assert.equal(f.contexts.sourceBenefit, false, 'Identical v5/v6 fixture must not credit historical v5 gains to v6.');
  assert.deepEqual(f.contexts.sourceRegressions, []); assert.ok(f.contexts.results.every(r => r.lostBaselineUnits === 0 && r.baselineDeliveredUnits === r.candidateDeliveredUnits && r.baselineDeliveredFacts.length === r.baselineDeliveredUnits));
  assert.equal(f.contexts.stopReason, 'no_designated_missing_fact_delivered_by_semantic_context');
  await verifyFreshValidationBaseline(f.screening, f.baseline);
  await replayFreshValidationContexts(f.screening, f.baseline, f.review, f.selection, f.contexts, { baselineFileSha256: f.selection.baselineSha256, sourceReviewFileSha256: f.selection.sourceReviewSha256 });
});
test('v2 cannot manufacture a v5 gap by dropping a frozen control parent or changing saved score input', async () => {
  const f = await fixture(), changed = structuredClone(f.baseline);
  changed.results[0]!.baseline.pop();
  await assert.rejects(verifyFreshValidationBaseline(f.screening, changed));
  const scores = structuredClone(f.baseline); scores.results[0]!.control.proposal.actualInputs.documents[0]!.document += ' changed';
  await assert.rejects(verifyFreshValidationBaseline(f.screening, scores));
});
test('v2 replay retains all selected misses and rejects source delivery or scoped context edits', async () => {
  const f = await fixture(), changed = structuredClone(f.contexts);
  changed.results[0]!.recoveredMissingUnits++;
  await assert.rejects(replayFreshValidationContexts(f.screening, f.baseline, f.review, f.selection, changed, { baselineFileSha256: f.selection.baselineSha256, sourceReviewFileSha256: f.selection.sourceReviewSha256 }));
  const selection = structuredClone(f.selection); selection.selectedCaseIds[0] = selection.selectedCaseIds[1]!;
  await assert.rejects(freshValidationContexts(f.screening, f.baseline, f.review, selection, { baselineFileSha256: selection.baselineSha256, sourceReviewFileSha256: selection.sourceReviewSha256 }));
  const review = { ...f.review, screeningSha256: 'changed' };
  await assert.rejects(freshValidationContexts(f.screening, f.baseline, review, f.selection, { baselineFileSha256: f.selection.baselineSha256, sourceReviewFileSha256: f.selection.sourceReviewSha256 }));
});
test('failed selection and later context validation clean temporary replay files so a corrected retry succeeds', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'ablatrix-fresh-selection-cleanup-'));
  try {
    for (const failure of ['selection differs', 'later context validation']) {
      await assert.rejects(withFreshSelectionReplay(parent, async replayPath => { writeFileSync(replayPath, '{"synthetic":true}', { flag: 'wx' }); throw new Error(failure); }), new RegExp(failure));
      assert.deepEqual(readdirSync(parent), []);
    }
    const replayed = await withFreshSelectionReplay(parent, replayPath => { writeFileSync(replayPath, '{"synthetic":true}', { flag: 'wx' }); return JSON.parse(readFileSync(replayPath, 'utf8')); });
    assert.deepEqual(replayed, { synthetic: true }); assert.deepEqual(readdirSync(parent), []);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
