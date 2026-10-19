import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { modelCachePath, type RetrievalStageTrace } from './product-retrieval.ts';
import { textHash } from './product-corpus.ts';
import { workspaceCompleteSourceContext, workspaceSourceChunks, type WorkspaceSourceProduct } from './workspace-retrieval-context.ts';
import type { ProductCorpus, RetrievalResult, RetrievedPassage } from './loop-types.ts';

export const SEMANTIC_RERANKER = Object.freeze({ contract: 'workspace-semantic-reranker-v3-dev', model: 'Xenova/ms-marco-MiniLM-L-6-v2', revision: 'a09144355adeed5f58c8ed011d209bf8ee5a1fec', upstream: 'cross-encoder/ms-marco-MiniLM-L6-v2', license: 'Apache-2.0', dtype: 'q8', maxTokens: 512, maxParents: 128, maxSelected: 8, maxBodyCharacters: 12000 });
export const RERANKER_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'] as const;
export const RERANKER_ASSET_SHA256 = { 'config.json': 'd827779a72d27ae68cf878a6fc2e954542663fe21ca515d9f4783fc96be2d37e', 'tokenizer.json': 'd241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66', 'tokenizer_config.json': '0b29c7bfc889e53b36d9dd3e686dd4300f6525110eaa98c76a5dafceb2029f53', 'onnx/model_quantized.onnx': 'e9d8ebf845c413e981c175bfe49a3bfa9b3dcce2a3ba54875ee5df5a58639fbe' } as const;
export type PairScorer = (query: string, documents: string[]) => Promise<number[]>;
/** Local files only, explicit components: pipeline factory metadata discovery can ignore revision flags. */
export function cachedCrossEncoder(cacheRoot = modelCachePath): PairScorer {
  let loaded: Promise<{ tokenizer: any; model: any }> | undefined;
  return async (query, documents) => {
    loaded ??= (async () => {
      const directory = resolve(cacheRoot, SEMANTIC_RERANKER.model, SEMANTIC_RERANKER.revision);
      const manifestPath = resolve(directory, 'asset-sha256.json');
      assert.ok(existsSync(manifestPath), 'Reranker cache missing. Run: node --import tsx scripts/prepare-semantic-model.ts');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      assert.deepEqual(manifest, RERANKER_ASSET_SHA256);
      for (const file of RERANKER_FILES) assert.equal(createHash('sha256').update(readFileSync(resolve(directory, file))).digest('hex'), manifest[file], `Cached reranker asset changed: ${file}`);
      const { AutoTokenizer, AutoModelForSequenceClassification } = await import('@huggingface/transformers');
      return { tokenizer: await AutoTokenizer.from_pretrained(directory, { local_files_only: true }), model: await AutoModelForSequenceClassification.from_pretrained(directory, { dtype: 'q8', device: 'cpu', local_files_only: true }) };
    })();
    const { tokenizer, model } = await loaded, scores: number[] = [];
    // Serial pairs bound peak memory and avoid padding-dependent batch behavior.
    for (const document of documents) {
      const inputs = tokenizer(query, { text_pair: document, truncation: false, padding: false });
      assert.ok(inputs.input_ids.size <= SEMANTIC_RERANKER.maxTokens, `Cross-encoder pair exceeds 512 tokens (${inputs.input_ids.size}); no truncation permitted.`);
      const output = await model(inputs), values = output.logits.tolist().flat();
      assert.equal(values.length, 1); assert.ok(Number.isFinite(values[0])); scores.push(values[0]);
    }
    return scores;
  };
}
const scopeKey = (source: WorkspaceSourceProduct['sources'][number]) => JSON.stringify([source.text, source.originalQuestion ?? null]);
const tokens = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]+(?:[-.][a-z0-9]+)*/g) ?? []);
const similarity = (a: Set<string>, b: Set<string>) => [...a].filter(x => b.has(x)).length / Math.max(1, new Set([...a, ...b]).size);
export async function semanticContext(product: WorkspaceSourceProduct & { title: string }, corpus: ProductCorpus, retrieval: RetrievalResult, trace: RetrievalStageTrace, question: string, scorer: PairScorer, mode: 'hybrid_candidates' | 'all_product_sources_development' = 'hybrid_candidates') {
  assert.ok(question.trim() && product.sources.length <= 128 && new Set(product.sources.map(s => s.id)).size === product.sources.length);
  // Validate every literal parent against the chunk corpus before any scoring.
  const parents = product.sources.map(source => {
    const chunks = corpus.passages.filter(p => p.productId === product.id && (p.id === source.id || p.id.startsWith(`${source.id}-`) && /^\d+$/.test(p.id.slice(source.id.length + 1))));
    const expected = workspaceSourceChunks(source.text);
    assert.equal(chunks.length, expected.length);
    for (const [index, text] of expected.entries()) {
      const id = expected.length === 1 ? source.id : `${source.id}-${index + 1}`, indexed = chunks.find(p => p.id === id);
      assert.ok(indexed && indexed.text === text && indexed.sha256 === textHash(text) && indexed.source === source.label && indexed.originalQuestion === source.originalQuestion, 'Reranker parent differs from literal indexed source scope.');
    }
    assert.ok(chunks.length); workspaceCompleteSourceContext(product, corpus, { ...retrieval, passages: chunks.map(p => ({ ...p, lexicalRank: null, semanticRank: null, score: 0 })) });
    return source;
  });
  const candidateIds = new Set(trace.fusion.map(row => row.id));
  const candidates = parents.filter(source => mode === 'all_product_sources_development' || corpus.passages.some(p => p.productId === product.id && candidateIds.has(p.id) && (p.id === source.id || p.id.startsWith(`${source.id}-`) && /^\d+$/.test(p.id.slice(source.id.length + 1)))));
  const seen = new Set<string>(), deduplication: { sourceId: string; retained: boolean }[] = [];
  const unique = candidates.filter(source => { const key = scopeKey(source), retained = !seen.has(key); seen.add(key); deduplication.push({ sourceId: source.id, retained }); return retained; });
  const query = `Product: ${product.title}\nQuestion: ${question}`;
  const start = performance.now(), cpu = process.cpuUsage();
  const scores = await scorer(query, unique.map(s => `Source: ${s.label}\nOriginal customer question: ${s.originalQuestion ?? '(none)'}\nLiteral source: ${s.text}`));
  assert.equal(scores.length, unique.length); assert.ok(scores.every(Number.isFinite));
  const ranked = unique.map((s, i) => ({ source: s, score: scores[i]!, terms: tokens(s.text) })).sort((a, b) => b.score - a.score || a.source.id.localeCompare(b.source.id));
  const remaining = [...ranked], selected: typeof ranked = [], decisions: { sourceId: string; reason: string; utility?: number }[] = [];
  // Relevant-band MMR: raw logit >= max(-5, best-8); same-scope near-duplicates cannot occupy all slots.
  const floor = Math.max(-5, (ranked[0]?.score ?? 0) - 8);
  while (remaining.length && selected.length < 8) {
    const choices = remaining.map(row => ({ row, utility: row.score - 3 * Math.max(0, ...selected.map(s => similarity(row.terms, s.terms))) })).sort((a, b) => b.utility - a.utility || a.row.source.id.localeCompare(b.row.source.id));
    const { row, utility } = choices[0]!; remaining.splice(remaining.indexOf(row), 1);
    const reason = row.score < floor ? 'outside_relevance_band' : row.source.text.length > 1500 ? 'parent_length_bound' : selected.reduce((n, r) => n + r.source.text.length, 0) + row.source.text.length > 12000 ? 'body_budget' : selected.some(s => (s.source.originalQuestion ?? null) === (row.source.originalQuestion ?? null) && similarity(s.terms, row.terms) > .85) ? 'same_scope_near_duplicate' : 'selected';
    decisions.push({ sourceId: row.source.id, reason, utility }); if (reason === 'selected') selected.push(row);
  }
  decisions.push(...remaining.map(r => ({ sourceId: r.source.id, reason: 'eight_parent_limit' })));
  const passages: RetrievedPassage[] = selected.map(({ source }) => ({ id: source.id, productId: product.id, source: source.label, reference: source.label, text: source.text, sha256: textHash(source.text), ...(source.originalQuestion !== undefined ? { originalQuestion: source.originalQuestion } : {}), lexicalRank: null, semanticRank: null, score: 0 }));
  return { contract: SEMANTIC_RERANKER.contract, mode, passages, query, deduplication, ranking: ranked.map((r, i) => ({ sourceId: r.source.id, score: r.score, rank: i + 1 })), decisions,
    scoreDefinition: 'Raw cross-encoder single output logit, higher is better; not a probability or compatibility proof. Passage BM25/dense ranks remain null; reranker ranks live only here.', resources: { elapsedMs: performance.now() - start, cpuMicroseconds: process.cpuUsage(cpu), rssBytes: process.memoryUsage().rss, peakRssBytes: process.resourceUsage().maxRSS * 1024 }, qualityClaimEligible: false };
}
