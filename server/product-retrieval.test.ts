import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadFinalProductCorpus, loadProductCorpus, textHash, validateProductCorpus } from './product-corpus.ts';
import { ProductRetriever, cqaAnswerText, reciprocalRankFusion, type EmbeddingFunction } from './product-retrieval.ts';
import type { Passage, ProductCorpus } from './loop-types.ts';

function sample(): ProductCorpus {
  const passage = (id: string, productId: string, text: string): Passage => ({ id, productId, text, sha256: textHash(text), source: 'synthetic-test-only', reference: `test:${id}` });
  return { version: 'synthetic-retrieval-test-v1', source: 'synthetic-test-only', license: 'test',
    products: [{ id: 'a', title: 'Canvas pack', split: 'development' }, { id: 'b', title: 'Different canvas', split: 'validation' }],
    passages: [passage('a-pack', 'a', 'Canvas panels: 12 pieces included.'), passage('a-other', 'a', 'Smooth white primed surface.'), passage('b-pack', 'b', 'Canvas panels: 999 pieces included.')],
    cases: [{ id: 'case-a', productId: 'a', split: 'development', question: 'How many canvases?', referenceAnswer: 'SECRET_REFERENCE_SENTINEL 12', referencePassageIds: ['a-pack'], labelStatus: 'test-only' }]
  };
}
const fakeEmbed: EmbeddingFunction = async texts => texts.map(text => /pieces|many|included/i.test(text) ? [1, 0] : [0, 1]);

test('CQA indexing drops echoed upstream questions while retaining full citation text', async () => {
  const corpus = sample();
  const cqa = { id: 'a-cqa', productId: 'a', text: 'It works with oak. Question: does it include twelve canvas pieces?', sha256: textHash('It works with oak. Question: does it include twelve canvas pieces?'), source: 'cqa', reference: 'test:cqa' };
  corpus.passages.push(cqa);
  assert.equal(cqaAnswerText(cqa), 'It works with oak.');
  const retriever = new ProductRetriever(corpus, ':memory:', { embed: fakeEmbed });
  try {
    const { rankings } = await retriever.compareRankings('a', 'does this include twelve?');
    assert.ok(!rankings.bm25.includes(cqa.id));
    const result = await retriever.retrieve('a', 'oak');
    assert.ok(result.passages.some(passage => passage.id === cqa.id && passage.text === cqa.text));
  } finally { retriever.close(); }
});

test('frozen final corpus is product disjoint, unlabeled, and keeps upstream test untouched', () => {
  const development = loadProductCorpus(), final = loadFinalProductCorpus();
  const used = new Set(development.products.map(item => item.id));
  assert.equal(final.products.length, 20); assert.equal(final.cases.length, 20);
  assert.ok(final.passages.length >= 20);
  assert.ok(final.products.every(item => item.split === 'holdout' && !used.has(item.id)));
  assert.ok(final.cases.every(item => item.split === 'holdout' && item.referenceAnswer === '' && item.referencePassageIds.length === 0));
});

test('hybrid filters both rankings by exact product before top-k and never indexes gold answers', async () => {
  const corpus = sample(), seen: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), 'ablatrix-retrieval-')), path = join(dir, 'vectors.sqlite');
  const retriever = new ProductRetriever(corpus, path, { embed: async (texts, kind) => { seen.push(...texts); return fakeEmbed(texts, kind); } });
  try {
    const result = await retriever.retrieve('a', 'How many canvas panels are included?');
    const comparison = await retriever.compareRankings('a', 'How many canvas panels are included?');
    assert.deepEqual(comparison.rankings.hybrid, result.passages.map(passage => passage.id));
    assert.ok(comparison.rankings.bm25.every(id => id.startsWith('a-')));
    assert.ok(comparison.rankings.dense.every(id => id.startsWith('a-')));
    assert.equal(result.passages[0].id, 'a-pack');
    assert.ok(result.passages.every(passage => passage.productId === 'a'));
    assert.ok(result.passages[0].lexicalRank && result.passages[0].semanticRank);
    assert.ok(!seen.some(text => text.includes('SECRET_REFERENCE_SENTINEL') || text.includes('999')));
    const check = new DatabaseSync(path);
    assert.equal((check.prepare("SELECT count(*) AS n FROM product_passages_fts WHERE product_passages_fts MATCH 'SECRET_REFERENCE_SENTINEL'").get() as { n: number }).n, 0);
    check.close();
    await assert.rejects(retriever.retrieve('unknown', 'panels'), /Unknown product/);
  } finally { retriever.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('RRF rewards agreement, deduplicates ranks, and breaks ties deterministically', () => {
  const fused = reciprocalRankFusion(['lexical-only', 'both', 'both'], ['semantic-only', 'both']);
  assert.equal(fused[0].id, 'both');
  assert.equal(fused[0].score, 2 / 62);
  assert.equal(fused[0].lexicalRank, 2);
  assert.deepEqual(fused.slice(1).map(entry => entry.id), ['lexical-only', 'semantic-only']);
});

test('persistent passage embeddings are reused but model revisions invalidate the cache', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ablatrix-retrieval-cache-')), path = join(dir, 'cache.sqlite');
  let embeddedPassages = 0;
  const embed: EmbeddingFunction = async (texts, kind) => { if (kind === 'passage') embeddedPassages += texts.length; return fakeEmbed(texts, kind); };
  try {
    const first = new ProductRetriever(sample(), path, { embed, modelRevision: 'one' });
    await first.retrieve('a', 'How many pieces?'); first.close(); assert.equal(embeddedPassages, 2);
    const second = new ProductRetriever(sample(), path, { embed, modelRevision: 'one' });
    await second.retrieve('a', 'How many pieces?'); second.close(); assert.equal(embeddedPassages, 2);
    const revised = new ProductRetriever(sample(), path, { embed, modelRevision: 'two' });
    await revised.retrieve('a', 'How many pieces?'); revised.close(); assert.equal(embeddedPassages, 4);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('identical customer answers with different parent questions remain distinct after retrieval and cache reuse', async () => {
  const corpus = sample(), text = 'This OEM part matches your model.';
  const source = { productId: 'a', text, sha256: textHash(text), source: 'customer answer', reference: 'test:customer' };
  corpus.cases = [];
  corpus.passages = [
    { ...source, id: 'answer-kenmore', originalQuestion: 'Will this fit Kenmore 25367889506?' },
    { ...source, id: 'answer-frigidaire', originalQuestion: 'Will this fit Frigidaire FFTR1814TW?' },
    { ...source, id: 'answer-kenmore-copy', originalQuestion: 'Will this fit Kenmore 25367889506?' }
  ];
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-retrieval-context-')), path = join(directory, 'cache.sqlite');
  let embeddedPassages = 0;
  const embed: EmbeddingFunction = async (texts, kind) => { if (kind === 'passage') { embeddedPassages += texts.length; assert.ok(texts.every(item => item === text)); } return texts.map(() => [1, 0]); };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const retriever = new ProductRetriever(corpus, path, { embed });
      try {
        const result = await retriever.retrieve('a', 'Does this OEM part match my model?');
        assert.equal(result.passages.length, 2, 'deduplication compares both answer and original question');
        assert.deepEqual(new Set(result.passages.map(passage => passage.originalQuestion)), new Set(corpus.passages.map(passage => passage.originalQuestion)));
        assert.ok(result.passages.every(passage => passage.text === text));
        const comparison = await retriever.compareRankings('a', '25367889506');
        assert.deepEqual(comparison.rankings.bm25, [], 'upstream questions stay out of answer-only relevance indexing');
      } finally { retriever.close(); }
    }
    assert.equal(embeddedPassages, 3, 'reopening reuses answer embeddings while keeping parent metadata');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('embedding failure remains an error rather than silently reporting BM25 as hybrid', async () => {
  const retriever = new ProductRetriever(sample(), ':memory:', { embed: async () => { throw new Error('Model unavailable'); } });
  try { await assert.rejects(retriever.retrieve('a', 'panels'), /Model unavailable/); }
  finally { retriever.close(); }
});

test('committed corpus has authentic pinned train/dev cases with product-disjoint splits and valid hashes', () => {
  const corpus = loadProductCorpus();
  assert.equal(corpus.products.length, 16);
  assert.equal(corpus.cases.filter(item => item.split === 'development').length, 10);
  assert.equal(corpus.cases.filter(item => item.split === 'validation').length, 6);
  assert.ok(corpus.cases.every(item => !item.id.includes('-test-') && item.labelStatus.includes('pending')));
  assert.ok(corpus.passages.every(passage => passage.reference.includes('cec976cc2f2218aa76e562ecc9c7d79f1f3271bc')));
  const tampered = structuredClone(corpus); tampered.passages[0].text += 'changed';
  assert.throws(() => validateProductCorpus(tampered), /checksum/);
  const leaking = structuredClone(corpus); leaking.cases[0].split = 'validation';
  assert.throws(() => validateProductCorpus(leaking), /split leakage/);
});
