import test from 'node:test';
import assert from 'node:assert/strict';
import { textHash } from './product-corpus.ts';
import { ProductRetriever, type RetrievalStageTrace } from './product-retrieval.ts';
import { workspaceSourceChunks } from './workspace-retrieval-context.ts';
import { workspaceSourceCoverageV2Context } from './workspace-source-coverage-v2.ts';
import { workspaceSourceCoverageV3Context } from './workspace-source-coverage-v3.ts';
import { semanticContext, cachedCrossEncoder } from './semantic-reranker.ts';
import { diagnoseUsefulSources } from './retrieval-diagnosis.ts';
import type { ProductCorpus, RetrievalResult } from './loop-types.ts';
function fixture() {
  const product = { id: 'synthetic', title: 'SYNTHETIC torch ZX-1', sources: [{ id: 'base', label: 'review', text: 'A durable synthetic item.' }, { id: 'a-combined', label: 'attribute', text: '{"color":"red","material":"steel"}' }, { id: 'b-color', label: 'attribute', text: '{"color":"red"}' }, { id: 'c-material', label: 'attribute', text: '{"material":"steel"}' }, { id: 'z-capacity', label: 'attribute', text: '{"capacity":"10 litres"}' }, { id: 'duration', label: 'cqa', text: 'Nearly eight hours before I manually extinguished it.', originalQuestion: 'How long does model ZX-2 burn?' }] };
  const corpus: ProductCorpus = { version: 'synthetic-trace', source: 'synthetic', license: 'test', products: [{ id: product.id, title: product.title, split: 'development' }], cases: [], passages: product.sources.flatMap(s => workspaceSourceChunks(s.text).map((text, i, chunks) => ({ id: chunks.length === 1 ? s.id : `${s.id}-${i + 1}`, productId: product.id, text, sha256: textHash(text), source: s.label, reference: s.label, ...(s.originalQuestion ? { originalQuestion: s.originalQuestion } : {}) }))) };
  const retrieval: RetrievalResult = { corpusVersion: corpus.version, embeddingModel: 'synthetic', method: 'synthetic', durationMs: 0, passages: [{ ...corpus.passages[0]!, lexicalRank: 1, semanticRank: 1, score: 1 }] };
  return { product, corpus, retrieval };
}
test('stage pools expose pre-budget ranks and selection losses without changing output or product isolation', async () => {
  const f = fixture(); f.corpus.products.push({ id: 'other', title: 'Other', split: 'development' }); f.corpus.passages.push({ ...f.corpus.passages[0]!, id: 'foreign', productId: 'other' });
  const r = new ProductRetriever(f.corpus, ':memory:', { embed: async texts => texts.map(() => [1, 0]) });
  try {
    const diagnosed = await r.diagnose(f.product.id, 'What is the capacity?');
    const ordinary = await r.retrieve(f.product.id, 'What is the capacity?'); assert.deepEqual(diagnosed.result.passages, ordinary.passages);
    assert.equal(diagnosed.trace.denseRaw.length, 6); assert.ok(diagnosed.trace.fusion.length > diagnosed.result.passages.length);
    assert.ok(diagnosed.trace.selection.some(s => s.reason === 'five_chunk_limit'));
    assert.ok(!JSON.stringify(diagnosed.trace).includes('foreign')); assert.ok(diagnosed.trace.bm25Raw.every(x => typeof x.score === 'number'));
    const fact = { fact: 'SYNTHETIC scoped duration', quote: 'Nearly eight hours', sourceIds: ['duration'], qualification: 'ZX-2 manual stop, not ZX-1 compatibility.' };
    const d = diagnoseUsefulSources(f.product, f.corpus, diagnosed.result, diagnosed.trace, [fact], []); assert.equal(d.designated[0]!.sources[0]!.literalFactDelivered, false); assert.equal(d.designated[0]!.sources[0]!.originalQuestion, f.product.sources.at(-1)!.originalQuestion);
  } finally { r.close(); }
});
test('v3 facet selection reproduces and corrects v2 crowding while preserving frozen v2 behavior', () => {
  const f = fixture(), question = 'What are its color, material, and capacity?';
  const old = workspaceSourceCoverageV2Context(f.product, f.corpus, f.retrieval, question), next = workspaceSourceCoverageV3Context(f.product, f.corpus, f.retrieval, question);
  assert.ok(!old.passages.some(p => p.id === 'z-capacity')); assert.ok(next.passages.some(p => p.id === 'z-capacity'));
  assert.deepEqual(next.passages[0], old.passages[0]); assert.equal(next.additions.length, 2);
});
test('semantic pairs use pronoun question plus title and keep exact original model scope; no invented retrieval ranks', async () => {
  const f = fixture(); let query = '', documents: string[] = [];
  const trace = { fusion: f.corpus.passages.map((p, i) => ({ id: p.id, rank: i + 1 })) } as RetrievalStageTrace;
  const result = await semanticContext(f.product, f.corpus, f.retrieval, trace, 'Once filled, how long do they last?', async (q, docs) => { query = q; documents = docs; return docs.map(d => d.includes('Nearly eight') ? 10 : -10); });
  assert.ok(query.includes(f.product.title) && query.includes('how long do they last')); assert.ok(documents.some(d => d.includes('model ZX-2 burn?')));
  assert.equal(result.passages[0]!.id, 'duration'); assert.equal(result.passages[0]!.lexicalRank, null); assert.equal(result.passages[0]!.semanticRank, null); assert.equal(result.ranking[0]!.rank, 1); assert.equal(result.passages[0]!.originalQuestion, 'How long does model ZX-2 burn?');
  const changed = structuredClone(f.product); changed.sources.at(-1)!.text = 'Changed body'; await assert.rejects(semanticContext(changed, f.corpus, f.retrieval, trace, 'How long?', async (_q, docs) => docs.map(() => 1)), /parent differs|Expected values/);
});
test('missing cross-encoder cache fails clearly without downloads', async () => {
  await assert.rejects(cachedCrossEncoder('/private/tmp/ablatrix-intentionally-missing-cache')('question', ['source']), /cache missing/);
});
