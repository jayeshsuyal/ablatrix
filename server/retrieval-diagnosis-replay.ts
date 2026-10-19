/** Replay saved scores through the unchanged diagnostic algorithms, never a model or provider. */
import assert from 'node:assert/strict';
import { ProductRetriever, cqaAnswerText, type RetrievalStageTrace } from './product-retrieval.ts';
import { semanticContext, type PairScorer } from './semantic-reranker.ts';
import { workspaceCompleteSourceContext } from './workspace-retrieval-context.ts';
import { workspaceSourceCoverageV2Context } from './workspace-source-coverage-v2.ts';
import { diagnoseUsefulSources, type DesignatedFact } from './retrieval-diagnosis.ts';
import type { ProductCorpus, RetrievalResult } from './loop-types.ts';

type Json = Record<string, any>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const close = (actual: number, expected: number) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-12, 'Saved dense score differs from replayed cosine.');

/** Saved dense cosines are inputs, not authenticated BGE outputs. Re-embed them
 * in two dimensions to rerun genuine FTS5, exact scope promotion, fusion and
 * selection. Only floating point normalization error (1e-12) is tolerated. */
export async function replaySavedStages(corpus: ProductCorpus, productId: string, question: string, trace: RetrievalStageTrace) {
  const passages = corpus.passages.filter(p => p.productId === productId);
  assert.equal(trace.denseRaw.length, passages.length, 'Require every product chunk dense score.');
  assert.equal(new Set(trace.denseRaw.map(row => row.id)).size, passages.length);
  const byId = new Map(passages.map(p => [p.id, p])), scoresByText = new Map<string, number>();
  for (const [index, row] of trace.denseRaw.entries()) {
    assert.ok(byId.has(row.id), 'Dense score belongs to another product or unknown chunk.');
    assert.equal(row.rank, index + 1, 'Dense ranks must be consecutive.');
    assert.ok(Number.isFinite(row.score) && row.score >= -1 && row.score <= 1, 'Dense cosine must be finite and bounded.');
    if (index) {
      const previous = trace.denseRaw[index - 1]!;
      assert.ok(previous.score > row.score || previous.score === row.score && previous.id.localeCompare(row.id) <= 0, 'Dense rows must follow score and ID order.');
    }
    const text = cqaAnswerText(byId.get(row.id)!);
    if (scoresByText.has(text)) close(row.score, scoresByText.get(text)!);
    scoresByText.set(text, row.score);
  }
  const retriever = new ProductRetriever(corpus, ':memory:', { embed: async (texts, kind) => texts.map(text => {
    if (kind === 'query') { assert.equal(text, question); return [1, 0]; }
    assert.ok(scoresByText.has(text), 'Scoring requested an unknown literal chunk.');
    const score = scoresByText.get(text)!; return [score, Math.sqrt(Math.max(0, 1 - score * score))];
  }) });
  try {
    const replayed = await retriever.diagnose(productId, question);
    assert.deepEqual(replayed.trace.denseRaw.map(({ score: _s, ...row }) => row), trace.denseRaw.map(({ score: _s, ...row }) => row));
    replayed.trace.denseRaw.forEach((row, index) => close(row.score, trace.denseRaw[index]!.score));
    // All other scores, exact scope flags, candidates, fusion and skip reasons
    // must derive from the indexed corpus, query and saved dense inputs.
    assert.deepEqual({ ...replayed.trace, denseRaw: trace.denseRaw }, trace);
    return replayed.result;
  } finally { retriever.close(); }
}

function semanticFields(value: Json) {
  const { resources: _observationalRuntimeOnly, ...deterministic } = value;
  return deterministic;
}

export async function replaySavedSemantic(product: Json, corpus: ProductCorpus, retrieval: RetrievalResult, trace: RetrievalStageTrace, question: string, saved: Json, mode: 'hybrid_candidates' | 'all_product_sources_development') {
  assert.equal(saved.mode, mode);
  assert.ok(Array.isArray(saved.ranking));
  const scores = new Map<string, number>();
  for (const [index, row] of saved.ranking.entries()) {
    assert.equal(row.rank, index + 1, 'Reranker ranks must be consecutive.');
    assert.ok(typeof row.sourceId === 'string' && !scores.has(row.sourceId), 'Reranker source IDs must be unique.');
    assert.ok(Number.isFinite(row.score), 'Saved reranker scores must be finite.');
    assert.ok(product.sources.some((source: Json) => source.id === row.sourceId), 'Reranker score must belong to a literal product source.');
    scores.set(row.sourceId, row.score);
  }
  const consumed = new Set<string>();
  const scorer: PairScorer = async (query, documents) => {
    assert.equal(query, `Product: ${product.title}\nQuestion: ${question}`);
    return documents.map(document => {
      const source = product.sources.find((s: Json) => document === `Source: ${s.label}\nOriginal customer question: ${s.originalQuestion ?? '(none)'}\nLiteral source: ${s.text}`);
      assert.ok(source && scores.has(source.id) && !consumed.has(source.id), 'Saved scores must cover the exact deduplicated scoring inputs once.');
      consumed.add(source.id); return scores.get(source.id)!;
    });
  };
  const replayed = await semanticContext(product as any, corpus, retrieval, trace, question, scorer, mode);
  assert.equal(consumed.size, scores.size, 'Saved rankings cannot include an unscored source.');
  assert.deepEqual(semanticFields(replayed), semanticFields(saved), 'Semantic ranking, MMR, bounds, decisions and literal contexts must replay exactly.');
  return replayed;
}

/** Bind a case to independent deck/baseline/source review, then replay every
 * selection and delivery claim. A different question is never an allowed retry. */
export async function verifySavedDiagnosisRow(row: Json, item: Json, corpus: ProductCorpus, baseline: Json, facts: DesignatedFact[]) {
  assert.equal(row.caseId, item.id); assert.equal(row.caseId, baseline.caseId);
  assert.equal(row.question, item.question, 'Saved question differs from the frozen deck.');
  const product = { ...item.product, sources: item.sources.map((source: Json) => ({ ...source, originalQuestion: source.originalQuestion ?? undefined })) };
  assert.deepEqual(row.product, json(product), 'Literal product/source/question scope differs from deck.');
  const replayedRetrieval = await replaySavedStages(corpus, product.id, item.question, row.trace);
  assert.deepEqual(replayedRetrieval.passages, baseline.indexRetrieval.passages, 'Saved stage selection must equal the independently saved baseline.');
  const retrieval = baseline.indexRetrieval as RetrievalResult;
  assert.equal(retrieval.corpusVersion, corpus.version);
  const complete = workspaceCompleteSourceContext(product, corpus, retrieval);
  assert.deepEqual(row.baseline, complete); assert.deepEqual(baseline.baseline.passages, complete);
  const v2 = workspaceSourceCoverageV2Context(product, corpus, retrieval, item.question);
  assert.deepEqual(row.v2, v2);
  const semantic = await replaySavedSemantic(product, corpus, retrieval, row.trace, item.question, row.semantic, 'hybrid_candidates');
  const allSources = await replaySavedSemantic(product, corpus, retrieval, row.trace, item.question, row.allSources, 'all_product_sources_development');
  const allScores = new Map(allSources.ranking.map(r => [r.sourceId, r.score]));
  for (const entry of semantic.ranking) assert.equal(entry.score, allScores.get(entry.sourceId), 'The same scoped pair must keep its score across modes.');
  for (const [key, context, supplemental] of [
    ['baselineDiagnosis', complete, []], ['v2Diagnosis', v2.passages, v2.additions],
    ['semanticDiagnosis', semantic.passages, []], ['allSourcesDiagnosis', allSources.passages, []]
  ] as const) assert.deepEqual(diagnoseUsefulSources(product, corpus, retrieval, row.trace, facts, context, [...supplemental]), row[key]);
  return { semantic, allSources };
}
