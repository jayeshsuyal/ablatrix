import test from 'node:test';
import assert from 'node:assert/strict';
import { textHash } from './product-corpus.ts';
import { workspaceCompleteSourceContext, workspaceSourceChunks, type WorkspaceSourceProduct } from './workspace-retrieval-context.ts';
import { semanticSupplementContextV5 } from './semantic-supplement-v5.ts';
import type { ProductCorpus, RetrievalResult } from './loop-types.ts';
import type { RetrievalStageTrace } from './product-retrieval.ts';

function fixture() {
  const product: WorkspaceSourceProduct & { title: string } = { id: 'synthetic-v5', title: 'SYNTHETIC device', sources: [
    { id: 'base', label: 'cqa', text: 'Yes, when paired with adapter A.', originalQuestion: 'Does model ZX-1 fit?' },
    ...Array.from({ length: 5 }, (_, i) => ({ id: `extra-${i}`, label: 'review', text: `SYNTHETIC runtime ${i + 4} hours.` })),
    { id: 'duplicate', label: 'cqa', text: 'Yes, when paired with adapter A.', originalQuestion: 'Does model ZX-1 fit?' },
    { id: 'other-scope', label: 'cqa', text: 'Yes, when paired with adapter A.', originalQuestion: 'Does model ZX-2 fit?' },
  ] };
  const corpus: ProductCorpus = { version: 'synthetic-v5', source: 'synthetic', license: 'test', products: [{ id: product.id, title: product.title, split: 'development' }], cases: [], passages: product.sources.flatMap(s => workspaceSourceChunks(s.text).map((text, i, chunks) => ({ id: chunks.length === 1 ? s.id : `${s.id}-${i + 1}`, productId: product.id, source: s.label, reference: s.label, text, sha256: textHash(text), ...(s.originalQuestion !== undefined ? { originalQuestion: s.originalQuestion } : {}) }))) };
  const retrieval: RetrievalResult = { corpusVersion: corpus.version, embeddingModel: 'synthetic', method: 'synthetic', durationMs: 0, passages: [{ ...corpus.passages[0]!, lexicalRank: 4, semanticRank: 2, score: .02 }] };
  const trace = { fusion: corpus.passages.map((p, i) => ({ id: p.id, rank: i + 1 })) } as RetrievalStageTrace;
  return { product, corpus, retrieval, trace };
}

test('v5 retains the entire baseline with original ranks/scope even when semantic scoring rejects it', async () => {
  const f = fixture(), baseline = workspaceCompleteSourceContext(f.product, f.corpus, f.retrieval);
  const result = await semanticSupplementContextV5(f.product, f.corpus, f.retrieval, f.trace, 'How long?', async (_query, docs) => docs.map(d => d.startsWith('SYNTHETIC runtime') ? 1 : -10));
  assert.deepEqual(result.passages.slice(0, baseline.length), baseline);
  assert.equal(result.additions.length, 3); assert.equal(result.passages.length, 4);
  assert.ok(result.decisions.some(d => d.reason === 'three_supplement_limit'));
  for (const addition of result.additions) {
    const passage = result.passages.find(p => p.id === addition.sourceId)!;
    assert.equal(passage.lexicalRank, null); assert.equal(passage.semanticRank, null); assert.equal(passage.score, 0);
    assert.ok(addition.rerankerRank > 0 && addition.rerankerLogit === 1);
  }
  assert.equal(result.baselinePreservation.baselineContextSha256, result.baselinePreservation.retainedPrefixSha256);
});

test('v5 distinguishes identical yes answers by original question and deduplicates identical scopes', async () => {
  const f = fixture();
  const result = await semanticSupplementContextV5(f.product, f.corpus, f.retrieval, f.trace, 'Does model ZX-2 fit?', async (_query, docs) => docs.map(d => d.includes('Does model ZX-2 fit?') ? 5 : -10));
  assert.deepEqual(result.passages.map(p => p.id), ['base', 'other-scope']);
  assert.equal(result.passages[1]!.originalQuestion, 'Does model ZX-2 fit?');
  assert.equal(result.passages[0]!.originalQuestion, 'Does model ZX-1 fit?');
});

test('v5 fails closed on wrong corpus, source body and question scope', async () => {
  const f = fixture(), scorer = async (_query: string, docs: string[]) => docs.map(() => 1);
  await assert.rejects(semanticSupplementContextV5(f.product, f.corpus, { ...f.retrieval, corpusVersion: 'other' }, f.trace, 'How long?', scorer), /corpus version/);
  const changed = structuredClone(f.product); changed.sources[1]!.text = 'Changed after indexing';
  await assert.rejects(semanticSupplementContextV5(changed, f.corpus, f.retrieval, f.trace, 'How long?', scorer), /parent differs|Expected values/);
  const changedScope = structuredClone(f.product); changedScope.sources[0]!.originalQuestion = 'Does model ZX-99 fit?';
  await assert.rejects(semanticSupplementContextV5(changedScope, f.corpus, f.retrieval, f.trace, 'How long?', scorer), /parent differs/);
});
