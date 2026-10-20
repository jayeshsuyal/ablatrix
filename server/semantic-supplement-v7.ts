import assert from 'node:assert/strict';
import { textHash } from './product-corpus.ts';
import type { ProductCorpus, RetrievalResult, RetrievedPassage } from './loop-types.ts';
import type { RetrievalStageTrace } from './product-retrieval.ts';
import type { WorkspaceSourceProduct } from './workspace-retrieval-context.ts';
import type { PairScorer } from './semantic-reranker.ts';
import { semanticSupplementContextV6, SEMANTIC_SUPPLEMENT_V6 } from './semantic-supplement-v6.ts';

export const SEMANTIC_SUPPLEMENT_V7 = Object.freeze({
  contract: 'workspace-semantic-supplement-v7-small-packet-dev', inherits: SEMANTIC_SUPPLEMENT_V6.contract,
  maxAdditions: 3, maxParents: 8, maxParentBodyCharacters: 1500, maxBodyCharacters: 12000,
  selection: 'Preserve every v6 passage in order. Append all remaining literal body-and-original-question scopes, in source order, only when the entire packet fits the unchanged baseline-relative limits. Otherwise return exact v6 passages.',
  scope: 'All product parents validated against the frozen chunk corpus; no target answers, designated facts, item identifiers or question terms used to choose completion.',
  limitation: 'Complete packet delivery can include irrelevant or conflicting material. It establishes neither source truth nor answer quality; large packets retain the v6 cutoff and its known misses.',
});
const bodyScope = (source: { text: string; originalQuestion?: string }) => JSON.stringify([source.text, source.originalQuestion ?? null]);

/** Exposed-development candidate. Full small packets avoid a relevance cutoff
 * when every literal parent already fits the existing context ceiling. */
export async function semanticSupplementContextV7(
  product: WorkspaceSourceProduct & { title: string }, corpus: ProductCorpus, retrieval: RetrievalResult,
  trace: RetrievalStageTrace, question: string, scorer: PairScorer,
) {
  // V6 validates every source against its exact indexed body, label and scope.
  const inherited = await semanticSupplementContextV6(product, corpus, retrieval, trace, question, scorer);
  const config = SEMANTIC_SUPPLEMENT_V7, baselineCount = inherited.baselinePreservation.baselineParentIds.length;
  const seen = new Set(inherited.passages.map(bodyScope));
  const missing = product.sources.filter(source => {
    const key = bodyScope(source); if (seen.has(key)) return false; seen.add(key); return true;
  });
  const completeParents = inherited.passages.length + missing.length;
  const completeBodyCharacters = inherited.bounds.bodyCharacters + missing.reduce((n, s) => n + s.text.length, 0);
  const reason = completeParents - baselineCount > config.maxAdditions ? 'three_supplement_limit'
    : completeParents > config.maxParents ? 'eight_parent_limit'
    : missing.some(s => s.text.length > config.maxParentBodyCharacters) ? 'parent_length_bound'
    : completeBodyCharacters > config.maxBodyCharacters ? 'body_budget' : null;
  const appended: RetrievedPassage[] = reason ? [] : missing.map(source => ({
    id: source.id, productId: product.id, source: source.label, reference: source.label,
    text: source.text, sha256: textHash(source.text),
    ...(source.originalQuestion !== undefined ? { originalQuestion: source.originalQuestion } : {}),
    lexicalRank: null, semanticRank: null, score: 0,
  }));
  const passages = [...inherited.passages, ...appended];
  const additions = [...inherited.additions, ...appended.map(passage => {
    const rank = inherited.proposal.ranking.find(row => row.sourceId === passage.id);
    return { sourceId: passage.id, sourceBodySha256: passage.sha256, originalQuestion: passage.originalQuestion ?? null,
      reasons: ['complete_small_source_packet'], rerankerRank: rank?.rank ?? null, rerankerLogit: rank?.score ?? null };
  })];
  assert.deepEqual(passages.slice(0, inherited.passages.length), inherited.passages);
  assert.ok(additions.length <= config.maxAdditions && passages.length <= config.maxParents
    && passages.every(p => p.text.length <= config.maxParentBodyCharacters)
    && passages.reduce((n, p) => n + p.text.length, 0) <= config.maxBodyCharacters);
  return { ...inherited, contract: config.contract, passages, additions,
    decisions: [...inherited.decisions, ...appended.map(p => ({ sourceId: p.id, reason: 'complete_small_source_packet' }))],
    bounds: { parents: passages.length, additions: additions.length, bodyCharacters: passages.reduce((n, p) => n + p.text.length, 0) },
    packetCompletion: { completePacketFits: reason === null, fallbackExactlyV6: appended.length === 0,
      reason: reason ?? (missing.length ? 'complete_small_source_packet' : 'packet_already_complete'),
      appendedSourceIds: appended.map(p => p.id), originalV6PassageIds: inherited.passages.map(p => p.id),
      attemptedParents: completeParents, attemptedAdditions: completeParents - baselineCount,
      attemptedBodyCharacters: completeBodyCharacters, limitation: config.limitation },
    qualityClaimEligible: false, exposure: 'Small-packet completion designed after APQA exposure; development source delivery only. Fresh retrieval gain and answer quality remain unestablished.' };
}
