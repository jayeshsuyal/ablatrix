/** SYNTHETIC 24-packet/8-case future workflow; no real fresh data or provider calls. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { textHash } from '../server/product-corpus.ts';
import { freshSeal, freshValidationBaseline, freshValidationContexts, freshValidationCorpus, type FreshPacket, type FreshScreening, type FreshSourceReview, type FreshSelection } from '../server/fresh-validation-v1.ts';
import { mockedThreeContext, syntheticPreparation } from './three-context-mock.ts';
import { ProductRetriever } from '../server/product-retrieval.ts';

export async function syntheticFreshContexts(noBenefit = false) {
  const packets: FreshPacket[] = Array.from({ length: 24 }, (_, i) => {
    const id = `B9${String(i).padStart(8, '0')}`;
    const sources = [
      ...Array.from({ length: 6 }, (_, d) => ({ id: `${id}-base-${d}`, label: 'bullet', text: `SYNTHETIC durable case ${i} detail ${d}.`, originalQuestion: null, reference: 'SYNTHETIC fixture' })),
      { id: `${id}-report`, label: 'cqa', text: `SYNTHETIC case ${i} report five to six hours under unknown conditions.`, originalQuestion: `SYNTHETIC model CASE-${i} duration?`, reference: 'SYNTHETIC fixture' },
      { id: `${id}-conflict`, label: 'review', text: `SYNTHETIC case ${i} nearly eight hours before manual extinguishing, not fuel exhaustion.`, originalQuestion: null, reference: 'SYNTHETIC fixture' }
    ].map(s => ({ ...s, sha256: textHash(JSON.stringify([s.id, s.label, s.text, s.originalQuestion, s.reference])) }));
    return { id: `SYNTHETIC-fresh-${i}`, product: { id, title: `SYNTHETIC Brand${i} device` }, question: 'Once filled, how long do they last on average?', sources, sourcePoolSha256: textHash(JSON.stringify(sources)) };
  });
  const screening: FreshScreening = { format: 'ablatrix-fresh-validation-screening-v1', screeningSha256: 'a'.repeat(64), screeningDenominator: 24,
    decisions: packets.map(p => ({ caseId: p.id, eligible: true, reasons: [], packet: p })), acceptedCaseIds: packets.map(p => p.id), candidateContextInspected: false, generatedAnswersInspected: false, providerCalls: 0, paidExecutionAuthorized: false };
  const corpus = freshValidationCorpus(screening);
  const retriever = new ProductRetriever(corpus, ':memory:', { embed: async (texts, kind) => texts.map(text => {
    if (kind === 'query') return [1, 0];
    const score = text.includes('durable') ? .99 - Number(text.match(/detail (\d+)/)?.[1] ?? 0) * .01 : text.includes('manual extinguishing') ? .1 : .2;
    return [score, Math.sqrt(1 - score * score)];
  }) });
  let baseline;
  try { baseline = await freshValidationBaseline(screening, retriever); } finally { retriever.close(); }
  const baselineFileSha256 = freshSeal(baseline);
  const review: FreshSourceReview = { format: 'ablatrix-fresh-validation-source-review-v1', screeningSha256: screening.screeningSha256, baselineSha256: baselineFileSha256,
    provenance: 'independent_source_review_ai', reviewer: 'SYNTHETIC source-only reviewer; no quality evidence', candidateContextInspected: false, answerOutputsInspected: false,
    cases: packets.map((p, i) => {
      const control = i === 1 || i === 2, refs = control ? p.sources.slice(0, 1) : p.sources.slice(-2);
      return { caseId: p.id, sourcePoolSha256: p.sourcePoolSha256, tags: [control ? 'baseline_complete_control' : i === 0 ? 'supported_gap' : i === 3 ? 'conflicting_reports' : i === 4 ? 'insufficient_evidence' : 'uncertain'],
        referenceSourceIds: refs.map(s => s.id), designatedFacts: refs.map(s => ({ fact: `SYNTHETIC source report ${s.id}`, quote: s.text, sourceIds: [s.id], qualification: 'SYNTHETIC customer conditions; manual extinguishing is not exhaustion.', applicability: `SYNTHETIC ${p.product.id} scope only` })), unknowns: ['SYNTHETIC population average unknown'], applicabilityNotes: 'SYNTHETIC attributed reports only, preserving conflicting duration/conditions.', referenceSufficiencyReviewed: true as const };
    }) };
  const sourceReviewFileSha256 = freshSeal(review);
  const selection: FreshSelection = { format: 'ablatrix-fresh-validation-selection-v1', screeningSha256: screening.screeningSha256, baselineSha256: baselineFileSha256, sourceReviewSha256: sourceReviewFileSha256,
    screeningDenominator: 24, selectedDenominator: 8, selectedCaseIds: packets.slice(0, 8).map(p => p.id), stopReason: null, candidateContextInspected: false, candidateMissesRetained: true };
  const contexts = await freshValidationContexts(screening, baseline, review, selection, async (query, documents) => {
    assert.ok(query.startsWith('Once filled, how long do they last on average? SYNTHETIC'));
    return documents.map(d => noBenefit || d.includes('durable') ? -20 : 1);
  }, { baselineFileSha256, sourceReviewFileSha256 });
  return { screening, baseline, review, selection, contexts };
}
export async function mockedFreshValidation(options: { noBenefit?: boolean; failure?: boolean } = {}) {
  const fixture = await syntheticFreshContexts(options.noBenefit), preparation = syntheticPreparation();
  preparation.cases = fixture.contexts.cases;
  const keys = ['protocol', 'candidate', 'history', 'source-review', 'development-outcome-review'];
  const hashes = keys.map((_, i) => String(i + 1).repeat(64));
  preparation.artifactSha256 = Object.fromEntries(keys.map((key, i) => [`docs/SYNTHETIC-${key}.json`, hashes[i]!]));
  preparation.validation = { contract: 'ablatrix-fresh-validation-v1', protocolSha256: hashes[0]!, candidateFreezeSha256: hashes[1]!, historyInventorySha256: hashes[2]!, sourceReviewSha256: hashes[3]!, developmentOutcomeReviewSha256: hashes[4]!, selectedDenominator: 8, screeningDenominator: 24, qualificationPassed: true };
  return { fixture, execution: await mockedThreeContext({ failure: options.failure }, preparation) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await mockedFreshValidation(); assert.equal(result.execution.calls, 24); assert.equal(result.execution.result.completedAnswers, 24);
  console.log(JSON.stringify({ provenance: 'SYNTHETIC prospective mechanics only', screenedPackets: 24, selectedCases: 8, completedMockAnswers: 24, realProviderCalls: 0, freshInputReads: 0, retries: 0, qualityClaimEligible: false }));
}
