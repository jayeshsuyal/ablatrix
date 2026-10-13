import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sourceCitationOptions, resolveSourceCitationIds } from './citation-options.ts';
import { textHash } from './product-corpus.ts';
import { ProductRetriever, EMBEDDING_MODEL, EMBEDDING_REVISION, type EmbeddingFunction } from './product-retrieval.ts';
import type { Passage, ProductCorpus } from './loop-types.ts';

export type RagContractMode = 'injected_contract' | 'pinned_local_bge';
type Checkpoint = { id: string; expected: unknown; observed: unknown; status: 'pass' | 'fail' | 'inconclusive' };
type Fixture = { id: string; question: string; passages: Passage[]; requiredIds: string[]; firstId?: string; orderedIds?: string[]; maxSelected?: number };
const body = 'Yes, it works.';
const passage = (id: string, text: string, originalQuestion?: string, productId = 'fixture-product'): Passage => ({ id, productId, source: originalQuestion ? 'cqa' : 'synthetic-listing', text, sha256: textHash(text), reference: `fixture://${id}`, ...(originalQuestion === undefined ? {} : { originalQuestion }) });
const crowded = (count: number) => Array.from({ length: count }, (_, i) => passage(`scope-${String(i).padStart(2, '0')}`, body, `Does this work with model DEV${1000 + i}?`));

/** Fictional source contracts, not generated answer labels or relevance annotations. */
function fixtures(): Fixture[] {
  return [
    { id: 'scope-beyond-five', question: 'Does it work with model DEV1007?', passages: crowded(8), requiredIds: ['scope-07'], firstId: 'scope-07' },
    { id: 'scope-beyond-twenty', question: 'Does it work with model DEV1024?', passages: crowded(25), requiredIds: ['scope-24'], firstId: 'scope-24' },
    { id: 'unscoped-order-unchanged', question: 'Does this work?', passages: crowded(8), requiredIds: [], orderedIds: ['scope-00', 'scope-01', 'scope-02', 'scope-03', 'scope-04'] },
    { id: 'exact-model-boundaries', question: 'Does this work with model (WK110)?', passages: [
      passage('boundary-00', body, 'Does this work with model WK1100?'),
      passage('boundary-01', body, 'Does this work with model XWK110?'),
      passage('boundary-02', body, 'Does this work with model WK110-PLUS?'),
      passage('boundary-03', body, 'Does this work with models WK110 and ZZ900?'),
      passage('boundary-04', body, 'Does this work with model OTHER900?'),
      passage('boundary-05', body, 'Does this work with model OTHER901?'),
      passage('boundary-06', body, 'Does this work with model WK110?')
    ], requiredIds: ['boundary-06'], firstId: 'boundary-06' },
    { id: 'physical-units-do-not-create-model-scope', question: 'Will a 2-in-1, 5-star, up-to-5, 12-inch, 30L, 10x20 bag fit on the 3rd or 4th shelf?', passages: [
      ...crowded(6), passage('scope-06', body, 'Will a 2-in-1, 12-inch, 30L bag fit?'),
      passage('scope-07', body, 'Will a 2-in-1, 5-star, up-to-5, 12-inch, 30L, 10x20 bag fit on the 3rd or 4th shelf?')
    ], requiredIds: [], orderedIds: ['scope-00', 'scope-01', 'scope-02', 'scope-03', 'scope-04'] },
    { id: 'variant-conflict-is-retained', question: 'Does this work with model DEV7001?', passages: [
      ...crowded(6),
      passage('variant-blue', 'No, the blue variant does not work.', 'Does the blue variant work with model DEV7001?'),
      passage('variant-red', 'Yes, the red variant works.', 'Does the red variant work with model DEV7001?')
    ], requiredIds: ['variant-blue', 'variant-red'] },
    { id: 'numeric-records-and-product-isolation', question: 'What are the item and package dimensions?', passages: [
      passage('item-dimensions', 'item_dimensions: { width: { unit: inches, normalized_value: { unit: inches, value: 11.5 }, value: 115 }, length: { unit: inches, value: 21.0 } }'),
      passage('package-dimensions', 'package_dimensions: { width: { unit: cm, value: 31.75 }, length: { unit: cm, value: 55.0 } }'),
      passage('other-product-dimensions', 'Item and package dimensions: width 999 inches; length 999 inches.', undefined, 'other-product')
    ], requiredIds: ['item-dimensions', 'package-dimensions'] },
    { id: 'context-budget-includes-parent-question', question: 'storage', passages: Array.from({ length: 7 }, (_, i) => passage(`budget-${i}`, `${'storage '.repeat(145)}record ${i}`, `${'context '.repeat(55)}source ${i}?`)), requiredIds: [], maxSelected: 3 },
    { id: 'explicit-short-model-beyond-five', question: 'Does it work with model H5?', passages: ['H50', 'G2', 'M50', 'XH5', 'H5-PLUS', 'G20', 'H5A', 'H5'].map((model, i) => passage(`short-${String(i).padStart(2, '0')}`, body, `Does it work with model ${model}?`)), requiredIds: ['short-07'], firstId: 'short-07' },
    { id: 'bare-numeric-target-with-part-anchor', question: 'Will part PART123 fit 241543917?', passages: [
      'Will part PART123 fit?', 'Will part PART123 fit 241543918?', 'Will part PART123 fit 241543919?',
      'Will part PART123 fit 241543920?', 'Will part PART123 fit 241543921?', 'Will part PART123 fit 241543922?',
      'Will 241543917 fit?', 'Will part PART123 fit 241543917?'
    ].map((originalQuestion, i) => passage(`numeric-${String(i).padStart(2, '0')}`, body, originalQuestion)), requiredIds: ['numeric-07'], firstId: 'numeric-07' },
    { id: 'plural-model-list-requires-all-anchors', question: 'Does it work with models [H5, 12 and 30L]?', passages: [
      'Does it work with model H5?', 'Does it work with model 12?', 'Does it work with model 30L?',
      'Does it work with models H5 and 12?', 'Does it work with models H5 and 30L?', 'Does it work with models 12 and 30L?',
      'Does it work with models H5, 12, 30L and G2?', 'Does it work with models [H5, 12 and 30L]?'
    ].map((originalQuestion, i) => passage(`plural-${String(i).padStart(2, '0')}`, body, originalQuestion)), requiredIds: ['plural-07'], firstId: 'plural-07' }
  ];
}

/** The outer CLI denies network. This entrypoint never creates a provider or opens a real database. */
export async function runRagContracts(options: { mode?: RagContractMode } = {}) {
  const mode = options.mode ?? 'injected_contract';
  if (mode !== 'injected_contract' && mode !== 'pinned_local_bge') throw new Error('Unknown retrieval contract mode.');
  const suite = fixtures(), fixtureSha256 = textHash(JSON.stringify(suite));
  const model = mode === 'injected_contract' ? 'injected-contract-constant' : EMBEDDING_MODEL;
  const revision = mode === 'injected_contract' ? 'synthetic-contract-v1' : EMBEDDING_REVISION;
  const results: { id: string; requiredIds: string[]; rankings: { bm25: string[]; dense: string[]; hybrid: string[] } | null; checkpoints: Checkpoint[] }[] = [];
  // Explicit local preflight prevents optional real mode from downloading assets.
  const missingAssets = mode === 'pinned_local_bge' ? ['tokenizer.json', 'tokenizer_config.json', 'config.json', 'onnx/model_quantized.onnx'].filter(file => !existsSync(fileURLToPath(new URL(`../.data/models/${model}/${revision}/${file}`, import.meta.url)))) : [];
  for (const fixture of suite) {
    const checkpoints: Checkpoint[] = [];
    const check = (id: string, expected: unknown, observed: unknown, passed: boolean) => checkpoints.push({ id, expected, observed, status: passed ? 'pass' : 'fail' });
    const row = { id: fixture.id, requiredIds: fixture.requiredIds, rankings: null as { bm25: string[]; dense: string[]; hybrid: string[] } | null, checkpoints };
    results.push(row);
    if (missingAssets.length) { checkpoints.push({ id: 'cached-embedding-assets', expected: 'All revision-pinned files already cached', observed: { missing: missingAssets }, status: 'inconclusive' }); continue; }
    const corpus: ProductCorpus = { version: `synthetic-rag-contract-${fixture.id}-v1`, source: 'synthetic-contract-only', license: 'test-fixture', products: [{ id: 'fixture-product', title: 'Fictional contract product', split: 'development' }, { id: 'other-product', title: 'Unrelated fictional product', split: 'development' }], passages: fixture.passages, cases: [] };
    const embedded: string[] = [];
    const embed: EmbeddingFunction = async (texts, kind) => { if (kind === 'passage') embedded.push(...texts); return texts.map(() => [1, 0]); };
    const retriever = new ProductRetriever(corpus, ':memory:', { ...(mode === 'injected_contract' ? { embed } : {}), modelId: model, modelRevision: revision });
    try {
      const { result, rankings } = await retriever.compareRankings('fixture-product', fixture.question);
      row.rankings = rankings;
      const ids = result.passages.map(source => source.id), missing = fixture.requiredIds.filter(id => !ids.includes(id));
      check('required-source-coverage', fixture.requiredIds, fixture.requiredIds.filter(id => ids.includes(id)), missing.length === 0);
      if (fixture.firstId) check('scoped-source-priority', fixture.firstId, ids[0] ?? null, ids[0] === fixture.firstId);
      if (fixture.orderedIds) check('baseline-order-preserved', fixture.orderedIds, ids, JSON.stringify(ids) === JSON.stringify(fixture.orderedIds));
      const leaked = result.passages.filter(source => source.productId !== 'fixture-product').map(source => source.id);
      check('product-isolation', [], leaked, leaked.length === 0);
      const changed = result.passages.filter(source => { const original = fixture.passages.find(item => item.id === source.id); return !original || ['text', 'originalQuestion', 'sha256', 'source', 'reference'].some(key => original[key as keyof Passage] !== source[key as keyof Passage]); }).map(source => source.id);
      check('source-bytes-and-scope-preserved', [], changed, changed.length === 0);
      const characters = result.passages.reduce((sum, source) => sum + source.text.length + (source.originalQuestion?.length ?? 0), 0);
      check('bounded-context', { maxSources: fixture.maxSelected ?? 5, maxCharacters: 6000, nonempty: true }, { sources: ids.length, characters }, ids.length > 0 && ids.length <= (fixture.maxSelected ?? 5) && characters <= 6000);
      const scope = { productId: 'fixture-product', question: fixture.question, evidence: result.passages };
      const catalog = sourceCitationOptions(scope), resolved = resolveSourceCitationIds(scope, catalog.map(item => item.id));
      check('literal-citation-body-preserved', result.passages.map(source => ({ passageId: source.id, quote: source.text })), resolved, JSON.stringify(resolved) === JSON.stringify(result.passages.map(source => ({ passageId: source.id, quote: source.text }))));
      if (mode === 'injected_contract') check('answer-only-embedding-input', fixture.passages.filter(source => source.productId === 'fixture-product').map(source => source.text), embedded, JSON.stringify(embedded) === JSON.stringify(fixture.passages.filter(source => source.productId === 'fixture-product').map(source => source.text)));
      check('method-provenance', `${model}@${revision}`, result.embeddingModel, result.embeddingModel === `${model}@${revision}`);
    } catch (error) {
      checkpoints.push({ id: 'retrieval-completed', expected: 'Successful local retrieval and citation resolution', observed: error instanceof Error ? error.message : String(error), status: 'fail' });
    } finally { retriever.close(); }
  }
  const all = results.flatMap(row => row.checkpoints);
  const mechanical: Checkpoint['status'] = all.some(check => check.status === 'fail') ? 'fail' : all.some(check => check.status === 'inconclusive') ? 'inconclusive' : 'pass';
  const requiredCases = results.filter(row => row.requiredIds.length);
  const completed = results.filter(row => row.rankings !== null);
  return { format: 'ablatrix-rag-contracts-v1', synthetic: true, fixtureSha256, mode, engine: { model, revision }, rankingPolicy: 'BM25, dense and hybrid rankings include exact parent-question identifier priority before candidate truncation.', mechanical,
    cases: results, summary: { cases: results.length, completedCases: completed.length, checkpoints: all.length, passed: all.filter(check => check.status === 'pass').length, failed: all.filter(check => check.status === 'fail').length,
      requiredSourceCases: requiredCases.length, casesWithAllRequiredAt5: requiredCases.filter(row => row.rankings && row.requiredIds.every(id => row.rankings!.hybrid.includes(id))).length,
      requiredSources: requiredCases.reduce((sum, row) => sum + row.requiredIds.length, 0), retrievedRequiredSources: requiredCases.reduce((sum, row) => sum + row.requiredIds.filter(id => row.rankings?.hybrid.includes(id)).length, 0) },
    answerQualityMeasured: false, semanticQuality: 'not_measured', newProviderCalls: 0,
    limitations: ['Fictional source contracts measure only the stated retrieval and provenance behavior.', 'Injected constant vectors test selection mechanics, not semantic embedding quality.', 'Matching parent identifiers rank source candidates; they do not prove compatibility or resolve variant/numeric conflicts.', 'These cases do not cover every candidate-crowding or source-scope pattern. No held-out product answers are used.'] };
}
