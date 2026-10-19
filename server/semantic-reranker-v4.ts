import assert from 'node:assert/strict';
import { textHash } from './product-corpus.ts';
import type { ProductCorpus, RetrievalResult } from './loop-types.ts';
import type { RetrievalStageTrace } from './product-retrieval.ts';
import type { WorkspaceSourceProduct } from './workspace-retrieval-context.ts';
import { semanticContext, SEMANTIC_RERANKER, type PairScorer } from './semantic-reranker.ts';

/** Exposed development candidate: changes input formatting only, never the v3 selector. */
export const SEMANTIC_RERANKER_V4 = Object.freeze({
  ...SEMANTIC_RERANKER,
  contract: 'workspace-semantic-reranker-v4-input-dev',
  inputFormat: 'question-space-title__literal-body-then-original-question-v1',
  inheritsSelection: SEMANTIC_RERANKER.contract,
});

export function semanticV4Inputs(product: WorkspaceSourceProduct & { title: string }, question: string, source: WorkspaceSourceProduct['sources'][number]) {
  return {
    query: `${question} ${product.title}`,
    document: source.text + (source.originalQuestion !== undefined ? `\nOriginal customer question: ${source.originalQuestion}` : ''),
  };
}

// Full string equality is intentional. Never split a literal body on a metadata marker.
const v3Document = (source: WorkspaceSourceProduct['sources'][number]) => `Source: ${source.label}\nOriginal customer question: ${source.originalQuestion ?? '(none)'}\nLiteral source: ${source.text}`;

export async function semanticContextV4(
  product: WorkspaceSourceProduct & { title: string }, corpus: ProductCorpus, retrieval: RetrievalResult,
  trace: RetrievalStageTrace, question: string, scorer: PairScorer,
  mode: 'hybrid_candidates' | 'all_product_sources_development' = 'hybrid_candidates',
) {
  const query = `${question} ${product.title}`;
  const lookup = new Map<string, string>();
  for (const source of product.sources) {
    const key = v3Document(source), document = semanticV4Inputs(product, question, source).document;
    // v3's sentinel can represent both an absent question and a literal '(none)'.
    // An ambiguous wrapper must fail before scoring instead of losing the scope.
    assert.ok(!lookup.has(key) || lookup.get(key) === document, 'Ambiguous v3 document wrapper; original-question scopes must not be collapsed.');
    lookup.set(key, document);
  }
  const scored = new Map<string, { document: string; score: number }>();
  const inherited = await semanticContext(product, corpus, retrieval, trace, question, async (wrappedQuery, wrappedDocuments) => {
    assert.equal(wrappedQuery, `Product: ${product.title}\nQuestion: ${question}`, 'Inherited query wrapper changed.');
    const documents = wrappedDocuments.map(wrapped => {
      const document = lookup.get(wrapped);
      assert.notEqual(document, undefined, 'Inherited document must exactly match a literal product source wrapper.');
      return document!;
    });
    const scores = await scorer(query, documents);
    assert.equal(scores.length, documents.length);
    for (const [index, wrapped] of wrappedDocuments.entries()) scored.set(wrapped, { document: documents[index]!, score: scores[index]! });
    return scores;
  }, mode);
  const actualInputs = inherited.ranking.map(row => {
    const source = product.sources.find(source => source.id === row.sourceId)!;
    const input = scored.get(v3Document(source));
    assert.ok(input && input.score === row.score && input.document === semanticV4Inputs(product, question, source).document);
    return { sourceId: row.sourceId, sourceBodySha256: textHash(source.text), originalQuestion: source.originalQuestion ?? null,
      document: input.document, documentSha256: textHash(input.document), score: row.score, rank: row.rank };
  });
  return { ...inherited, contract: SEMANTIC_RERANKER_V4.contract, query,
    inputFormat: SEMANTIC_RERANKER_V4.inputFormat, inheritedSelectionContract: SEMANTIC_RERANKER.contract,
    actualInputs: { query, querySha256: textHash(query), documents: actualInputs },
    exposure: 'Development input candidate; no unseen validation or answer-quality claim.', qualityClaimEligible: false };
}
