import test from 'node:test';
import assert from 'node:assert/strict';
import { textHash } from './product-corpus.ts';
import { semanticContextV4, semanticV4Inputs } from './semantic-reranker-v4.ts';
import { workspaceSourceChunks } from './workspace-retrieval-context.ts';
import type { ProductCorpus, RetrievalResult } from './loop-types.ts';
import type { RetrievalStageTrace } from './product-retrieval.ts';

function fixture() {
  const product = { id: 'synthetic-v4', title: 'SYNTHETIC torch 64-inch bright red pack', sources: [
    { id: 'base', label: 'description', text: 'Nearly 5-6 hours after lighting. Literal source: this text is part of the unchanged body.' },
    { id: 'scope-a', label: 'cqa', text: 'Yes.\nOriginal customer question: this is literal answer text.', originalQuestion: 'Does model ZX-2 support adapter A?' },
    { id: 'scope-b', label: 'cqa', text: 'Yes.\nOriginal customer question: this is literal answer text.', originalQuestion: 'Does model ZX-3 support adapter B?' },
  ] };
  const corpus: ProductCorpus = { version: 'synthetic-v4', source: 'synthetic', license: 'test', products: [{ id: product.id, title: product.title, split: 'development' }], cases: [],
    passages: product.sources.flatMap(source => workspaceSourceChunks(source.text).map((text, i, chunks) => ({ id: chunks.length === 1 ? source.id : `${source.id}-${i + 1}`, productId: product.id, source: source.label, reference: source.label, text, sha256: textHash(text), ...(source.originalQuestion !== undefined ? { originalQuestion: source.originalQuestion } : {}) }))) };
  const retrieval: RetrievalResult = { corpusVersion: corpus.version, embeddingModel: 'synthetic', method: 'synthetic', durationMs: 0, passages: [] };
  const trace = { fusion: corpus.passages.map((passage, i) => ({ id: passage.id, rank: i + 1 })) } as RetrievalStageTrace;
  return { product, corpus, retrieval, trace };
}

test('v4 sends the question first and literal source first without parsing source-like metadata', async () => {
  const f = fixture(), question = 'Once filled, how long do they last?'; let actualQuery = '', actualDocuments: string[] = [];
  const result = await semanticContextV4(f.product, f.corpus, f.retrieval, f.trace, question, async (query, documents) => {
    actualQuery = query; actualDocuments = documents; return documents.map((_, index) => 10 - index);
  });
  assert.equal(actualQuery, `${question} ${f.product.title}`);
  assert.deepEqual(actualDocuments, f.product.sources.map(source => source.text + (source.originalQuestion === undefined ? '' : `\nOriginal customer question: ${source.originalQuestion}`)));
  assert.ok(actualDocuments[0]!.startsWith('Nearly 5-6 hours'));
  assert.deepEqual(result.passages.map(p => [p.id, p.text, p.originalQuestion]), f.product.sources.map(s => [s.id, s.text, s.originalQuestion]));
  assert.equal(result.actualInputs.query, actualQuery); assert.equal(result.actualInputs.querySha256, textHash(actualQuery));
  for (const input of result.actualInputs.documents) {
    assert.equal(input.documentSha256, textHash(input.document));
    assert.equal(input.document, semanticV4Inputs(f.product, question, f.product.sources.find(s => s.id === input.sourceId)!).document);
  }
  assert.equal(result.query, actualQuery); assert.equal(result.qualityClaimEligible, false);
});

test('v4 keeps the inherited relevance gate and reports rejected sources', async () => {
  const f = fixture();
  const result = await semanticContextV4(f.product, f.corpus, f.retrieval, f.trace, 'How long?', async (_query, docs) => docs.map((_, i) => i === 0 ? 0 : -6));
  assert.deepEqual(result.passages.map(p => p.id), ['base']);
  assert.ok(result.decisions.filter(d => d.sourceId !== 'base').every(d => d.reason === 'outside_relevance_band'));
  assert.equal(result.actualInputs.documents.length, 3);
});

test('v4 refuses ambiguous absent-question sentinel before scoring', async () => {
  const f = fixture(); f.product.sources.push({ ...f.product.sources[0]!, id: 'ambiguous', originalQuestion: '(none)' });
  await assert.rejects(semanticContextV4(f.product, f.corpus, f.retrieval, f.trace, 'How long?', async () => { throw new Error('must not score'); }), /Ambiguous v3 document wrapper/);
});
