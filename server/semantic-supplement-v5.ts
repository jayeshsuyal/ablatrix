import assert from 'node:assert/strict';
import { textHash } from './product-corpus.ts';
import type { ProductCorpus, RetrievalResult } from './loop-types.ts';
import type { RetrievalStageTrace } from './product-retrieval.ts';
import { workspaceCompleteSourceContext, type WorkspaceSourceProduct } from './workspace-retrieval-context.ts';
import { semanticContextV4, SEMANTIC_RERANKER_V4 } from './semantic-reranker-v4.ts';
import type { PairScorer } from './semantic-reranker.ts';

export const SEMANTIC_SUPPLEMENT_V5 = Object.freeze({
  contract: 'workspace-semantic-supplement-v5-dev',
  proposalContract: SEMANTIC_RERANKER_V4.contract,
  maxAdditions: 3, maxParents: 8, maxParentBodyCharacters: 1500, maxBodyCharacters: 12000,
  baseline: 'Unchanged workspaceCompleteSourceContext prefix; every parent, body, scope, rank and order retained.',
  supplements: 'Only unchanged v4-selected parents, in v4 selection order; no model, input, floor or MMR retuning.',
});
const scopeKey = (text: string, originalQuestion?: string) => JSON.stringify([text, originalQuestion ?? null]);

/** Development only. Scorer can be cached local inference or exact input-bound saved-logit replay. */
export async function semanticSupplementContextV5(
  product: WorkspaceSourceProduct & { title: string }, corpus: ProductCorpus, retrieval: RetrievalResult,
  trace: RetrievalStageTrace, question: string, scorer: PairScorer,
) {
  assert.equal(retrieval.corpusVersion, corpus.version, 'Supplement retrieval must match the frozen corpus version.');
  const baseline = workspaceCompleteSourceContext(product, corpus, retrieval);
  // Reuse v4 validation, literal source checks, tokenization contract and selection unchanged.
  const proposal = await semanticContextV4(product, corpus, retrieval, trace, question, scorer);
  const passages = [...baseline], seenIds = new Set(baseline.map(p => p.id));
  const seenScopes = new Set(baseline.map(p => scopeKey(p.text, p.originalQuestion)));
  const additions: { sourceId: string; sourceBodySha256: string; originalQuestion: string | null; reasons: string[]; rerankerRank: number; rerankerLogit: number }[] = [];
  const decisions: { sourceId: string; reason: string }[] = [];
  let bodyCharacters = baseline.reduce((sum, passage) => sum + passage.text.length, 0);
  for (const candidate of proposal.passages) {
    const literal = product.sources.find(source => source.id === candidate.id);
    assert.ok(literal && candidate.productId === product.id && candidate.text === literal.text && candidate.sha256 === textHash(literal.text) && candidate.source === literal.label && candidate.originalQuestion === literal.originalQuestion, 'Semantic supplement must preserve its exact literal source and original-question scope.');
    const rank = proposal.ranking.find(row => row.sourceId === candidate.id)!;
    assert.ok(rank && Number.isFinite(rank.score) && proposal.actualInputs.documents.some(input => input.sourceId === candidate.id && input.score === rank.score && input.sourceBodySha256 === candidate.sha256 && input.originalQuestion === (candidate.originalQuestion ?? null)));
    const key = scopeKey(candidate.text, candidate.originalQuestion);
    const reason = seenIds.has(candidate.id) ? 'baseline_parent_retained' : seenScopes.has(key) ? 'same_body_and_scope_already_retained' : additions.length >= SEMANTIC_SUPPLEMENT_V5.maxAdditions ? 'three_supplement_limit' : passages.length >= SEMANTIC_SUPPLEMENT_V5.maxParents ? 'eight_parent_limit' : candidate.text.length > SEMANTIC_SUPPLEMENT_V5.maxParentBodyCharacters ? 'parent_length_bound' : bodyCharacters + candidate.text.length > SEMANTIC_SUPPLEMENT_V5.maxBodyCharacters ? 'body_budget' : 'selected_semantic_supplement';
    decisions.push({ sourceId: candidate.id, reason });
    if (reason !== 'selected_semantic_supplement') continue;
    passages.push({ ...candidate, lexicalRank: null, semanticRank: null, score: 0 });
    additions.push({ sourceId: candidate.id, sourceBodySha256: candidate.sha256, originalQuestion: candidate.originalQuestion ?? null,
      reasons: ['selected_by_frozen_v4_semantic_gate'], rerankerRank: rank.rank, rerankerLogit: rank.score });
    bodyCharacters += candidate.text.length; seenIds.add(candidate.id); seenScopes.add(key);
  }
  assert.deepEqual(passages.slice(0, baseline.length), baseline);
  assert.ok(additions.length <= 3 && passages.length <= 8 && passages.every(p => p.text.length <= 1500) && bodyCharacters <= 12000);
  return { contract: SEMANTIC_SUPPLEMENT_V5.contract, passages, additions, decisions, proposal,
    baselinePreservation: { baselineParentIds: baseline.map(p => p.id), baselineContextSha256: textHash(JSON.stringify(baseline)),
      retainedPrefixSha256: textHash(JSON.stringify(passages.slice(0, baseline.length))), allBaselineParentsRetainedInOrder: true },
    bounds: { parents: passages.length, additions: additions.length, bodyCharacters },
    qualityClaimEligible: false, exposure: 'Additive development candidate; source delivery is not answer quality or fresh validation.' };
}
