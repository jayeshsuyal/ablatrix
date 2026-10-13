import test from 'node:test';
import assert from 'node:assert/strict';
import { runRagContracts } from './rag-contracts.ts';
import { ProductRetriever } from './product-retrieval.ts';
import { textHash } from './product-corpus.ts';
import type { ProductCorpus } from './loop-types.ts';

test('synthetic report covers scope truncation, conflicts, literal numbers and budgets without network', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network in contract tests'); });
  const report = await runRagContracts();
  assert.equal(report.mechanical, 'pass');
  assert.equal(report.synthetic, true);
  assert.equal(report.mode, 'injected_contract');
  assert.equal(report.answerQualityMeasured, false);
  assert.equal(report.newProviderCalls, 0);
  assert.equal(report.summary.cases, 8);
  assert.equal(report.summary.requiredSources, 7);
  assert.equal(report.summary.retrievedRequiredSources, 7);
  assert.equal(report.cases.find(row => row.id === 'scope-beyond-twenty')!.rankings!.hybrid[0], 'scope-24');
  assert.equal(report.cases.find(row => row.id === 'scope-beyond-twenty')!.rankings!.bm25[0], 'scope-24', 'scope rescue occurs before the lexical candidate limit too');
  assert.deepEqual(report.cases.find(row => row.id === 'unscoped-order-unchanged')!.rankings!.hybrid, ['scope-00', 'scope-01', 'scope-02', 'scope-03', 'scope-04']);
  const conflict = report.cases.find(row => row.id === 'variant-conflict-is-retained')!.rankings!.hybrid;
  assert.ok(conflict.includes('variant-red') && conflict.includes('variant-blue'));
  const numbers = report.cases.find(row => row.id === 'numeric-records-and-product-isolation')!.checkpoints.find(check => check.id === 'literal-citation-body-preserved')!.observed;
  assert.match(JSON.stringify(numbers), /11\.5/);
  assert.match(JSON.stringify(numbers), /115/);
  assert.doesNotMatch(JSON.stringify(numbers), /999/);
  const replay = await runRagContracts();
  assert.equal(report.fixtureSha256, replay.fixtureSha256);
  assert.deepEqual(report, replay, 'the injected contract report excludes variable timings');
});

test('contract report fails a lost required source instead of counting available distractors as coverage', async t => {
  const compare = ProductRetriever.prototype.compareRankings;
  t.mock.method(ProductRetriever.prototype, 'compareRankings', async function (this: ProductRetriever, productId: string, question: string) {
    const output = await compare.call(this, productId, question);
    if (question.includes('DEV1024')) {
      output.result.passages = output.result.passages.filter(source => source.id !== 'scope-24');
      output.rankings.hybrid = output.rankings.hybrid.filter(id => id !== 'scope-24');
    }
    return output;
  });
  const report = await runRagContracts();
  assert.equal(report.mechanical, 'fail');
  assert.equal(report.summary.retrievedRequiredSources, 6);
  assert.equal(report.cases.find(row => row.id === 'scope-beyond-twenty')!.checkpoints.find(check => check.id === 'required-source-coverage')!.status, 'fail');
});

test('explicit numeric and dimension-shaped model labels rank exact scope while legacy question bytes stay intact', async () => {
  for (const [question, parent] of [
    ['Does model 123456 fit?', 'Does model 123456 fit?'],
    ['Does model 12-INCH fit?', 'Does model 12-INCH fit?'],
    ['Does (WK110) fit?', 'Does model wk110 fit?']
  ]) {
    const text = 'Yes, it works.';
    const passages = Array.from({ length: 7 }, (_, i) => {
      const originalQuestion = i === 6 ? parent : `Does model DEV${1000 + i} fit?`;
      const sourceText = `${text} Question: ${originalQuestion}`;
      return { id: `legacy-${i}`, productId: 'p', source: 'cqa', text: sourceText, reference: `fixture:${i}`, sha256: textHash(sourceText) };
    });
    const corpus: ProductCorpus = { version: 'synthetic-legacy-scope', source: 'synthetic-test-only', license: 'test', products: [{ id: 'p', title: 'Synthetic product', split: 'development' }], passages, cases: [] };
    const seen: string[] = [];
    const retriever = new ProductRetriever(corpus, ':memory:', { embed: async (texts, kind) => { if (kind === 'passage') seen.push(...texts); return texts.map(() => [1, 0]); } });
    try {
      const result = await retriever.retrieve('p', question);
      assert.equal(result.passages[0].id, 'legacy-6', question);
      assert.equal(result.passages[0].text, passages[6].text);
      assert.equal(result.passages[0].originalQuestion, undefined, 'legacy context is not silently rewritten');
      assert.ok(seen.every(value => value === text), 'the parent question never enters passage embeddings');
    } finally { retriever.close(); }
  }
});

test('a shared part does not prioritize a missing or different target, including unlabeled numeric device IDs', async () => {
  const parents = [
    'Will part PART123 fit?',
    'Will part PART123 fit model 241543918?',
    'Will part PART123 fit 241543918?',
    'Will part PART123 fit model OTHER900?',
    'Will part PART123 fit model OTHER901?',
    'Will part PART123 fit model OTHER902?',
    'Will part PART123 fit 241543917?'
  ];
  const passages = parents.map((originalQuestion, i) => ({ id: `scope-${i}`, productId: 'p', source: 'cqa', text: 'Yes, it works.', sha256: textHash('Yes, it works.'), originalQuestion, reference: `fixture:${i}` }));
  const corpus: ProductCorpus = { version: 'synthetic-part-scope', source: 'synthetic-test-only', license: 'test', products: [{ id: 'p', title: 'Synthetic part', split: 'development' }], passages, cases: [] };
  const retriever = new ProductRetriever(corpus, ':memory:', { embed: async texts => texts.map(() => [1, 0]) });
  try {
    const result = await retriever.retrieve('p', 'Will part PART123 fit model 241543917?');
    assert.equal(result.passages[0].id, 'scope-6');
    assert.ok(result.passages.some(source => source.id === 'scope-0'), 'ranking does not discard sources or certify the relationship');
  } finally { retriever.close(); }
});
