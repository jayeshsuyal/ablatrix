/** Prospective fresh validation v1. No provider, credentials, dataset loader or tuning. */
import assert from 'node:assert/strict';
import { textHash, validateProductCorpus } from './product-corpus.ts';
import type { ProductCorpus, RetrievalResult, RetrievedPassage } from './loop-types.ts';
import type { RetrievalStageTrace } from './product-retrieval.ts';
import { workspaceCompleteSourceContext, workspaceSourceChunks } from './workspace-retrieval-context.ts';
import { semanticSupplementContextV5 } from './semantic-supplement-v5.ts';
import type { PairScorer } from './semantic-reranker.ts';
import { replaySavedStages } from './retrieval-diagnosis-replay.ts';
import type { DiagnosticCase } from './three-context-diagnostic.ts';

export type FreshSource = { id: string; label: string; text: string; originalQuestion: string | null; reference: string; sha256: string };
export type FreshPacket = { id: string; product: { id: string; title: string }; question: string; sources: FreshSource[]; sourcePoolSha256: string };
export type FreshScreening = { format: 'ablatrix-fresh-validation-screening-v1'; screeningSha256: string; screeningDenominator: number; acceptedCaseIds: string[]; decisions: { caseId: string; eligible: boolean; reasons: string[]; packet: FreshPacket }[]; candidateContextInspected: false; generatedAnswersInspected: false; providerCalls: 0; paidExecutionAuthorized: false };
export type FreshBaseline = { format: 'ablatrix-fresh-validation-baseline-v1'; screeningSha256: string; corpusSha256: string; results: { caseId: string; indexRetrieval: RetrievalResult; trace: RetrievalStageTrace; baseline: RetrievedPassage[] }[]; candidateContextInspected: false; providerCalls: 0 };
export type FreshSelection = { format: 'ablatrix-fresh-validation-selection-v1'; screeningSha256: string; baselineSha256: string; sourceReviewSha256: string; screeningDenominator: 24; selectedDenominator: number; selectedCaseIds: string[]; stopReason: string | null; candidateContextInspected: false; candidateMissesRetained: true };
export type FreshSourceAssessment = { caseId: string; sourcePoolSha256: string; tags: string[]; referenceSourceIds: string[]; designatedFacts: { fact: string; quote: string; sourceIds: string[]; qualification: string; applicability: string }[]; unknowns: string[]; applicabilityNotes: string; referenceSufficiencyReviewed: true };
export type FreshSourceReview = { format: 'ablatrix-fresh-validation-source-review-v1'; screeningSha256: string; baselineSha256: string; provenance: 'source_checked_human' | 'independent_source_review_ai'; reviewer: string; candidateContextInspected: false; answerOutputsInspected: false; cases: FreshSourceAssessment[] };
/** Same recursive key order as Python seal(), used only for public document bindings. */
export function freshSeal(value: unknown): string {
  const ordered = (v: any): any => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])])) : v;
  return textHash(JSON.stringify(ordered(value)));
}
const product = (item: FreshPacket) => ({ ...item.product, sources: item.sources.map(s => ({ ...s, originalQuestion: s.originalQuestion ?? undefined })) });
export function freshValidationCorpus(screening: FreshScreening): ProductCorpus {
  assert.equal(screening.format, 'ablatrix-fresh-validation-screening-v1'); assert.equal(screening.screeningDenominator, 24); assert.equal(screening.decisions.length, 24);
  assert.equal(new Set(screening.decisions.map(r => r.caseId)).size, 24); assert.equal(screening.candidateContextInspected, false); assert.equal(screening.generatedAnswersInspected, false); assert.equal(screening.providerCalls, 0); assert.equal(screening.paidExecutionAuthorized, false);
  const cases = screening.decisions.filter(r => r.eligible).map(r => r.packet);
  assert.deepEqual(cases.map(c => c.id), screening.acceptedCaseIds);
  assert.equal(new Set(cases.map(c => c.product.id)).size, cases.length);
  for (const item of cases) {
    assert.equal(item.sourcePoolSha256, textHash(JSON.stringify(item.sources))); assert.ok(item.sources.length > 0 && item.sources.length <= 128);
    assert.equal(new Set(item.sources.map(s => s.id)).size, item.sources.length);
    for (const source of item.sources) { assert.equal(source.sha256, textHash(JSON.stringify([source.id, source.label, source.text, source.originalQuestion, source.reference]))); assert.ok(source.text.length && source.text.length <= 1500 && !source.text.includes('\0')); }
  }
  const corpus: ProductCorpus = { version: `fresh-validation-v1-${screening.screeningSha256.slice(0, 24)}`, source: 'Prospectively screened literal source-only packets', license: 'CDLA-Sharing-1.0', cases: [],
    products: cases.map(c => ({ ...c.product, split: 'validation' })), passages: cases.flatMap(c => c.sources.flatMap(s => workspaceSourceChunks(s.text).map((text, i, chunks) => ({ id: chunks.length === 1 ? s.id : `${s.id}-${i + 1}`, productId: c.product.id, source: s.label, reference: s.label, text, sha256: textHash(text), ...(s.originalQuestion !== null ? { originalQuestion: s.originalQuestion } : {}) })))) };
  validateProductCorpus(corpus); return corpus;
}
export async function freshValidationBaseline(screening: FreshScreening, retriever: { diagnose(id: string, question: string): Promise<{ result: RetrievalResult; trace: RetrievalStageTrace }> }): Promise<FreshBaseline> {
  const corpus = freshValidationCorpus(screening), results: FreshBaseline['results'] = [];
  for (const row of screening.decisions.filter(r => r.eligible)) {
    const item = row.packet, { result, trace } = await retriever.diagnose(item.product.id, item.question);
    assert.equal(result.corpusVersion, corpus.version); assert.ok(result.passages.length <= 5);
    const baseline = workspaceCompleteSourceContext(product(item), corpus, result);
    results.push({ caseId: item.id, indexRetrieval: result, trace, baseline });
  }
  return { format: 'ablatrix-fresh-validation-baseline-v1', screeningSha256: screening.screeningSha256, corpusSha256: freshSeal(corpus), results, candidateContextInspected: false, providerCalls: 0 };
}
/** Replay genuine FTS/scope/fusion/selection from saved dense observations.
 * Raw BM25 alone keeps the existing four-binary64-step tolerance. */
export async function verifyFreshValidationBaseline(screening: FreshScreening, baseline: FreshBaseline) {
  const corpus = freshValidationCorpus(screening);
  assert.equal(baseline.format, 'ablatrix-fresh-validation-baseline-v1'); assert.equal(baseline.screeningSha256, screening.screeningSha256); assert.equal(baseline.corpusSha256, freshSeal(corpus));
  assert.equal(baseline.candidateContextInspected, false); assert.equal(baseline.providerCalls, 0);
  assert.deepEqual(baseline.results.map(r => r.caseId), screening.acceptedCaseIds);
  for (const row of baseline.results) {
    const item = screening.decisions.find(r => r.caseId === row.caseId && r.eligible)!.packet;
    const replay = await replaySavedStages(corpus, item.product.id, item.question, row.trace);
    assert.equal(row.indexRetrieval.corpusVersion, corpus.version);
    assert.deepEqual(replay.passages, row.indexRetrieval.passages, 'Baseline selected chunks must equal actual saved-stage replay.');
    assert.deepEqual(row.baseline, workspaceCompleteSourceContext(product(item), corpus, row.indexRetrieval), 'Baseline restoration must preserve the replayed literal parents and scope.');
  }
  return baseline;
}
/** Requires source-only selected IDs already fixed. Misses never remove cases. */
export async function freshValidationContexts(screening: FreshScreening, baseline: FreshBaseline, sourceReview: FreshSourceReview, selection: FreshSelection, scorer: PairScorer, bindings: { baselineFileSha256: string; sourceReviewFileSha256: string }) {
  const corpus = freshValidationCorpus(screening);
  await verifyFreshValidationBaseline(screening, baseline);
  assert.equal(selection.format, 'ablatrix-fresh-validation-selection-v1'); assert.equal(selection.stopReason, null, 'Finite source-only protocol must qualify before candidate scores are read.');
  assert.equal(selection.screeningDenominator, 24); assert.equal(selection.selectedDenominator, 8); assert.equal(selection.selectedCaseIds.length, 8); assert.equal(new Set(selection.selectedCaseIds).size, 8);
  assert.equal(selection.candidateContextInspected, false); assert.equal(selection.candidateMissesRetained, true);
  assert.equal(selection.screeningSha256, screening.screeningSha256); assert.equal(baseline.screeningSha256, screening.screeningSha256); assert.equal(baseline.corpusSha256, freshSeal(corpus));
  assert.equal(selection.baselineSha256, bindings.baselineFileSha256); assert.equal(selection.sourceReviewSha256, bindings.sourceReviewFileSha256); assert.equal(sourceReview.baselineSha256, bindings.baselineFileSha256);
  assert.equal(sourceReview.candidateContextInspected, false); assert.equal(sourceReview.answerOutputsInspected, false); assert.ok(sourceReview.reviewer.trim());
  assert.deepEqual(sourceReview.cases.map(r => r.caseId), screening.decisions.map(r => r.caseId));
  assert.deepEqual(baseline.results.map(r => r.caseId), screening.acceptedCaseIds);
  const cases: DiagnosticCase[] = [], results = [];
  for (const caseId of selection.selectedCaseIds) {
    const item = screening.decisions.find(r => r.caseId === caseId && r.eligible)?.packet;
    const b = baseline.results.find(r => r.caseId === caseId), review = sourceReview.cases.find(r => r.caseId === caseId);
    assert.ok(item && b && review); assert.equal(review.sourcePoolSha256, item.sourcePoolSha256); assert.equal(review.referenceSufficiencyReviewed, true);
    assert.deepEqual(b.baseline, workspaceCompleteSourceContext(product(item), corpus, b.indexRetrieval));
    const completeSources: RetrievedPassage[] = item.sources.map(s => ({ id: s.id, productId: item.product.id, source: s.label, reference: s.label, text: s.text, sha256: textHash(s.text), lexicalRank: null, semanticRank: null, score: 0, ...(s.originalQuestion !== null ? { originalQuestion: s.originalQuestion } : {}) }));
    const reference = review.referenceSourceIds.map(id => { const source = completeSources.find(s => s.id === id); assert.ok(source); return source; });
    for (const fact of review.designatedFacts) assert.ok(fact.sourceIds.length && fact.sourceIds.every(id => reference.some(s => s.id === id && s.text.includes(fact.quote))) && fact.qualification && fact.applicability, 'Reference must contain exact independently designated bodies, scope and conditions.');
    const candidate = await semanticSupplementContextV5(product(item), corpus, b.indexRetrieval, b.trace, item.question, scorer);
    assert.deepEqual(candidate.passages.slice(0, b.baseline.length), b.baseline);
    cases.push({ id: caseId, product: { ...item.product, split: 'validation' }, question: item.question, completeSources,
      contexts: { current: b.baseline, semantic: candidate.passages, reference }, designatedFacts: review.designatedFacts,
      referenceReview: { provenance: sourceReview.provenance === 'source_checked_human' ? 'source_checked_human' : 'source_checked_ai', reviewer: sourceReview.reviewer, sufficientFor: review.applicabilityNotes, unknowns: review.unknowns, sourcePoolSha256: textHash(JSON.stringify(completeSources)) } });
    const delivered = (context: RetrievedPassage[], fact: FreshSourceAssessment['designatedFacts'][number]) => context.some(s => fact.sourceIds.includes(s.id) && s.text.includes(fact.quote));
    const missing = review.designatedFacts.filter(f => !delivered(b.baseline, f));
    results.push({ caseId, tags: review.tags, candidate, designatedUnits: review.designatedFacts.length, missingUnits: missing.length, recoveredMissingUnits: missing.filter(f => delivered(candidate.passages, f)).length, answerStatus: { current: 'not_attempted', semantic: 'not_attempted', reference: 'not_attempted' } });
  }
  const sourceBenefit = results.some(r => r.recoveredMissingUnits > 0);
  return { format: 'ablatrix-fresh-validation-contexts-v1', screeningSha256: screening.screeningSha256, selectionSha256: freshSeal(selection), cases, results, sourceBenefit,
    stopReason: sourceBenefit ? 'fresh_validation_qualification_pending' : 'no_designated_missing_fact_delivered_by_semantic_context', providerCalls: 0, generatedAnswers: 0, qualityClaimEligible: false, paidExecutionAuthorized: false };
}

/** Recompute literal selection with exact saved query/document-bound logits.
 * This verifies calculations, not the authenticity of model score observations. */
export async function replayFreshValidationContexts(screening: FreshScreening, baseline: FreshBaseline, review: FreshSourceReview, selection: FreshSelection, saved: Awaited<ReturnType<typeof freshValidationContexts>>, bindings: { baselineFileSha256: string; sourceReviewFileSha256: string }) {
  assert.equal(saved.format, 'ablatrix-fresh-validation-contexts-v1'); assert.equal(saved.results.length, 8);
  assert.deepEqual(saved.results.map(r => r.caseId), selection.selectedCaseIds);
  let next = 0;
  const replay = await freshValidationContexts(screening, baseline, review, selection, async (query, documents) => {
    const inputs = saved.results[next++]!.candidate.proposal.actualInputs;
    assert.equal(query, inputs.query); assert.equal(textHash(query), inputs.querySha256);
    const byDocument = new Map<string, number>();
    for (const row of inputs.documents) {
      assert.equal(textHash(row.document), row.documentSha256); assert.ok(Number.isFinite(row.score));
      assert.ok(!byDocument.has(row.document) || byDocument.get(row.document) === row.score, 'One input cannot replay conflicting logits.'); byDocument.set(row.document, row.score);
    }
    assert.deepEqual([...new Set(documents)].sort(), [...byDocument.keys()].sort());
    return documents.map(d => { assert.ok(byDocument.has(d)); return byDocument.get(d)!; });
  }, bindings);
  const comparable = (value: typeof replay) => { const copy = structuredClone(value); for (const row of copy.results) delete (row.candidate.proposal as Partial<typeof row.candidate.proposal>).resources; return copy; };
  assert.deepEqual(comparable(saved), comparable(replay), 'Saved contexts, source delivery and full candidate decisions must equal replay; only runtime resource observations differ.');
  return saved;
}
