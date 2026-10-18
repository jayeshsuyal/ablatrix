import test from 'node:test';
import assert from 'node:assert/strict';
import { textHash } from './product-corpus.ts';
import { workspaceSourceChunks, workspaceCompleteSourceContext, type WorkspaceSourceProduct } from './workspace-retrieval-context.ts';
import { WORKSPACE_SOURCE_COVERAGE_CONTRACT, workspaceSourceCoverageContext } from './workspace-source-coverage.ts';
import type { ProductCorpus, RetrievalResult } from './loop-types.ts';

type Source = WorkspaceSourceProduct['sources'][number];
const source = (id: string, label: string, text: string, originalQuestion?: string): Source => ({ id, label, text, ...(originalQuestion !== undefined ? { originalQuestion } : {}) });
function setup(sources: Source[], baselineIds: string[]) {
  const product = { id: 'product', sources };
  const corpus: ProductCorpus = { version: 'coverage-fixture-v1', source: 'synthetic fixtures', license: 'test', cases: [], products: [{ id: product.id, title: 'Fixture', split: 'development' }],
    passages: sources.flatMap(parent => workspaceSourceChunks(parent.text).map((text, index, chunks) => ({ id: chunks.length === 1 ? parent.id : `${parent.id}-${index + 1}`, productId: product.id,
      source: parent.label, text, reference: chunks.length === 1 ? parent.label : `${parent.label} (part ${index + 1})`, sha256: textHash(text), ...(parent.originalQuestion !== undefined ? { originalQuestion: parent.originalQuestion } : {}) }))) };
  const retrieval: RetrievalResult = { passages: baselineIds.map((id, index) => ({ ...corpus.passages.find(p => p.id === id)!, lexicalRank: index + 1, semanticRank: index + 2, score: 1 / (60 + index) })),
    durationMs: 1, method: 'synthetic ranking fixture', embeddingModel: 'none', corpusVersion: corpus.version };
  return { product, corpus, retrieval, run: (question: string) => workspaceSourceCoverageContext(product, corpus, retrieval, question) };
}

test('Toyota development gap: adds item dimensions and product identity without inventing a YZZ01 comparison', () => {
  const f = setup([
    source('report', 'cqa', '17801-yzz02 does fit a 2014 camry se 2.5l engine', 'Does it fit a 2014 Camry?'),
    source('model-name', 'attribute', 'model_name: { value:"17801-yzz02" }'),
    source('item-dimensions', 'attribute', 'item_dimensions: { width:8, length:11.7, height:1.8, unit:inches }'),
    source('model-number', 'attribute', 'model_number: { value:"178010h050" }'),
    source('package', 'attribute', 'item_package_dimensions: { width:8, length:12, height:2, unit:inches }'),
    source('year', 'attribute', 'model_year: { value:2007 }'),
  ], ['report', 'model-name']);
  const before = structuredClone({ product: f.product, corpus: f.corpus, retrieval: f.retrieval });
  const result = f.run('Comparing 17801-yzz01 to 17801-yzz02: different dimensions. Which fits a 2014 Camry?');
  assert.equal(result.contract, WORKSPACE_SOURCE_COVERAGE_CONTRACT);
  assert.deepEqual(result.passages.slice(0, 2), workspaceCompleteSourceContext(f.product, f.corpus, f.retrieval));
  assert.deepEqual(result.additions.map(a => a.sourceId), ['item-dimensions', 'model-number']);
  assert.deepEqual({ product: f.product, corpus: f.corpus, retrieval: f.retrieval }, before);
  assert.ok(result.additions.every(a => a.reasons.length > 0));
  assert.ok(result.passages.slice(2).every(p => p.lexicalRank === null && p.semanticRank === null && p.score === 0 && p.sha256 === textHash(p.text)));
});

test('Viking development gap: retains qualified and negative reports and adds literal part/family context', () => {
  const f = setup([
    source('negative', 'review', 'Unfortunately these do not fit my Viking stove as advertised.'),
    source('qualified', 'review', 'A "good enough" fit for my Viking 5 series gas rangetop (VGRT).'),
    source('family', 'bullet', 'pd040035 pd040075 ap5316217 vgsu'),
    source('part', 'attribute', 'part_number: { value:"rntls-pn-732128002" }'),
    source('dimensions', 'attribute', 'item_dimensions: { width:0.3, length:0.34, height:0.34 }'),
  ], ['negative', 'qualified']);
  const result = f.run('I have a Viking model VGSU1646BBK. Will these fit?');
  assert.deepEqual(result.passages.slice(0, 2), workspaceCompleteSourceContext(f.product, f.corpus, f.retrieval));
  assert.deepEqual(result.additions.map(a => a.sourceId), ['part', 'family']);
  assert.deepEqual(result.additions.find(a => a.sourceId === 'family')!.reasons, ['identifier_family_context_only:VGSU']);
  assert.ok(!result.passages.some(p => p.id === 'dimensions'));
  assert.ok(!result.additions.some(a => a.reasons.some(reason => /confirmed|compatible|fit$/.test(reason))));
});

test('marble development gap: rescues the explicit color field while leaving contrary customer observations intact', () => {
  const f = setup([
    source('shade', 'review', 'The blue and green marbles and white and beige ones are hard to tell apart.'),
    source('other-report', 'review', 'The colors are muted, but it is not difficult to tell which marble is which.'),
    source('color', 'attribute', 'color: { standardized_values:["multicolor"], value:"multicolor" }'),
    source('material', 'attribute', 'material: { value:"wood" }'),
  ], ['shade', 'other-report']);
  const result = f.run('What are the colors of the marbles?');
  assert.deepEqual(result.additions.map(a => a.sourceId), ['color']);
  assert.equal(result.passages[0].text, f.product.sources[0].text);
  assert.equal(result.passages[1].text, f.product.sources[1].text);
});

test('item and package dimensions remain separate, and unrelated fields do not become supplements', () => {
  const f = setup([
    source('report', 'review', 'It fits on my shelf.'),
    source('item', 'attribute', 'item_dimensions: { width:8, height:12 }'),
    source('package', 'attribute', 'item_package_dimensions: { width:10, height:14 }'),
    source('color', 'attribute', 'color: { value:"blue" }'),
    source('identity', 'attribute', 'model_number: { value:"ABC123" }'),
  ], ['report']);
  assert.deepEqual(f.run('What are its dimensions?').additions.map(a => a.sourceId), ['item']);
  assert.deepEqual(f.run('What are its package dimensions?').additions.map(a => a.sourceId), ['package']);
  assert.deepEqual(f.run('What are the package dimensions of this product?').additions.map(a => a.sourceId), ['package']);
  for (const question of ["What are the package's dimensions of this product?", 'What are the package’s dimensions of this product?']) {
    assert.deepEqual(f.run(question).additions.map(a => a.sourceId), ['package']);
  }
  for (const question of ['What are the product and package dimensions?', 'What are the item dimensions and the package dimensions?', 'What are the package and product dimensions?',
    'What are the dimensions of the product and its package?', 'What are the dimensions of the item and its box?',
    "What are the item's dimensions and the package's dimensions?", 'What are the item’s dimensions and the package’s dimensions?',
    "What are the product's and package's dimensions?", 'What are the product’s and package’s dimensions?']) {
    const combined = f.run(question);
    assert.deepEqual(combined.additions.map(a => a.sourceId), ['item', 'package']);
    assert.ok(combined.additions[0].reasons.includes('question_intent:item_dimensions'));
    assert.ok(combined.additions[1].reasons.includes('question_intent:package_dimensions'));
  }
  assert.deepEqual(f.run('Was this useful?').additions, []);
});

test('explicit material and capacity intents rescue only their corresponding structured fields', () => {
  const f = setup([source('report', 'review', 'A useful container.'), source('material', 'attribute', 'material: { value:"glass" }'),
    source('capacity', 'attribute', 'capacity: { value:12, unit:cups }'), source('color', 'attribute', 'color: { value:"blue" }')], ['report']);
  assert.deepEqual(f.run('What is it made of?').additions.map(a => a.sourceId), ['material']);
  assert.deepEqual(f.run('How many cups does it hold?').additions.map(a => a.sourceId), ['capacity']);
  assert.deepEqual(f.run('Is it blue?').additions.map(a => a.sourceId), ['color']);
});

test('exact identifiers preserve separators, and near-model strings are not standalone family matches', () => {
  const f = setup([
    source('report', 'cqa', 'No; this is for the other model.', 'Does it fit VGSU1646BBL?'),
    source('exact', 'bullet', 'Not compatible with VGSU1646BBK.'),
    source('punctuated', 'bullet', 'For VGSU-1646BBK.'),
    source('near', 'bullet', 'Fits VGSU1646BBL.'),
    source('prefix', 'description', 'These are for VGSUMAX parts.'),
    source('scope', 'bullet', 'VGSU appliance family; consult exact model documentation.'),
    source('unrelated', 'review', 'VGSU1646BBK model_number: yes.'),
  ], ['report']);
  const result = f.run('Will these fit model VGSU1646BBK?');
  assert.deepEqual(result.additions.map(a => a.sourceId), ['exact', 'scope']);
  assert.ok(result.additions[0].reasons.includes('exact_identifier_context:VGSU1646BBK'));
  assert.equal(result.passages.find(p => p.id === 'exact')!.text, 'Not compatible with VGSU1646BBK.');
  assert.deepEqual(f.run('Will it fit a 12cm shelf?').additions, []);
  const punctuation = setup([source('report', 'review', 'A report.'), source('hyphen', 'bullet', 'For ZX-100.'),
    source('plain', 'bullet', 'For zx100.'), source('listed', 'attribute', 'model_number: { value:"ZX-100" }')], ['report']);
  const exact = punctuation.run('Will these fit ZX100?');
  assert.deepEqual(exact.additions.map(a => a.sourceId), ['plain', 'listed']);
  assert.ok(exact.additions[0].reasons.includes('exact_identifier_context:ZX100'));
  assert.ok(exact.additions[1].reasons.every(reason => !reason.startsWith('exact_identifier_context:')));
});

test('quoted JSON first keys and original ePQA field syntax are recognized without rewriting values', () => {
  for (const body of ['{"item_dimensions":{"width":8,"unit":"inches"}}',
    "{'item_dimensions': {width:8,unit:'inches'}}", 'item_dimensions: { width:8, unit:inches }']) {
    const f = setup([source('report', 'review', 'A report.'), source('dimensions', 'attribute', body)], ['report']);
    const result = f.run('What are the item dimensions?');
    assert.deepEqual(result.additions.map(a => a.sourceId), ['dimensions']);
    assert.equal(result.passages[1].text, body); assert.equal(result.passages[1].sha256, textHash(body));
  }
});

test('selection is deterministic by relevance then source ID, with at most three additions', () => {
  const f = setup([source('report', 'review', 'Mixed customer reports.'), ...['d', 'b', 'c', 'a'].map(id => source(id, 'attribute', `color: { value:"${id}" }`))], ['report']);
  const first = f.run('What color is it?');
  f.product.sources.reverse();
  assert.deepEqual(f.run('What color is it?'), first);
  assert.deepEqual(first.additions.map(a => a.sourceId), ['a', 'b', 'c']);
});

test('eight-parent and source length bounds preserve baseline parents without clipping', () => {
  const reports = Array.from({ length: 8 }, (_, i) => source(`report${i}`, 'review', `Report ${i}: ${'x'.repeat(1480)}`));
  const extra = source('color', 'attribute', 'color: { value:"blue" }');
  const f = setup([...reports, extra], []);
  f.retrieval.passages = reports.map(parent => ({ ...f.corpus.passages.find(p => p.id === `${parent.id}-1`)!, lexicalRank: 1, semanticRank: 1, score: .1 }));
  assert.equal(f.run('What color is it?').passages.length, 8);
  assert.deepEqual(f.run('What color is it?').additions, []);
  const oneRoom = setup([...reports.slice(0, 7), extra, source('color2', 'attribute', 'color: { value:"red" }')], []);
  oneRoom.retrieval.passages = reports.slice(0, 7).map(parent => ({ ...oneRoom.corpus.passages.find(p => p.id === `${parent.id}-1`)!, lexicalRank: 1, semanticRank: 1, score: .1 }));
  assert.equal(oneRoom.run('What color is it?').additions.length, 1);
  const large = setup([source('report', 'review', 'A report.'), source('large', 'attribute', `color: ${'b'.repeat(1500)}`)], ['report']);
  assert.deepEqual(large.run('What color is it?').additions, []);
});

test('full multi-byte parents and original questions remain exact through 300-byte indexing chunks', () => {
  const parent = source('color', 'attribute', `color: { value:"青" }; ${'qualifier é '.repeat(45)}`, 'Which original variant was described?');
  const f = setup([source('report', 'review', 'A report.'), parent], ['report']);
  assert.ok(f.corpus.passages.filter(p => p.id.startsWith('color-')).every(p => Buffer.byteLength(p.text) <= 300));
  const added = f.run('What color is it?').passages[1];
  assert.equal(added.text, parent.text); assert.equal(added.originalQuestion, parent.originalQuestion);
  assert.equal(added.reference, parent.label); assert.equal(added.sha256, textHash(parent.text));
});

test('duplicate source/index/retrieval IDs and invalid corpus bindings fail before supplementation', () => {
  for (const mutate of [
    (f: ReturnType<typeof setup>) => f.product.sources.push({ ...f.product.sources[1] }),
    (f: ReturnType<typeof setup>) => f.corpus.passages.push({ ...f.corpus.passages[0] }),
    (f: ReturnType<typeof setup>) => f.retrieval.passages.push({ ...f.retrieval.passages[0] }),
    (f: ReturnType<typeof setup>) => { f.retrieval.corpusVersion = 'other'; },
    (f: ReturnType<typeof setup>) => { f.product.sources[1].text = 'color: { value:"changed" }'; },
    (f: ReturnType<typeof setup>) => { f.corpus.products.push({ id: 'other', title: 'Other', split: 'development' }); f.corpus.passages[1].productId = 'other'; },
  ]) {
    const f = setup([source('report', 'review', 'A report.'), source('color', 'attribute', 'color: { value:"blue" }')], ['report']);
    mutate(f); assert.throws(() => f.run('What color is it?'));
  }
});

test('duplicate chunks from a baseline parent do not consume supplementation slots or erase its qualifiers', () => {
  const parent = source('report', 'cqa', `${'Customer report. '.repeat(30)}Only for the smaller model; not the requested variant.`, 'Does it fit ABC123?');
  const f = setup([parent, source('id', 'attribute', 'model_number: { value:"ABC123" }')], ['report-1', 'report-2']);
  const result = f.run('Will it fit ABC123?');
  assert.equal(result.passages.length, 2); assert.equal(result.passages[0].text, parent.text);
  assert.equal(result.passages[0].originalQuestion, parent.originalQuestion);
  assert.deepEqual(result.additions.map(a => a.sourceId), ['id']);
});
