import test from 'node:test';
import assert from 'node:assert/strict';
import { textHash } from './product-corpus.ts';
import { workspaceSourceChunks, workspaceCompleteSourceContext, type WorkspaceSourceProduct } from './workspace-retrieval-context.ts';
import { WORKSPACE_SOURCE_COVERAGE_V2_CONTRACT, workspaceSourceCoverageV2Context } from './workspace-source-coverage-v2.ts';
import type { ProductCorpus, RetrievalResult } from './loop-types.ts';

type Source = WorkspaceSourceProduct['sources'][number];
// All data below are synthetic engineering fixtures, not empirical quality results.
const source = (id: string, label: string, text: string, originalQuestion?: string): Source => ({ id, label, text, ...(originalQuestion !== undefined ? { originalQuestion } : {}) });
function setup(sources: Source[], baselineIds: string[] = ['baseline']) {
  const product = { id: 'synthetic-product', sources };
  const corpus: ProductCorpus = { version: 'synthetic-source-coverage-v2', source: 'synthetic fixtures', license: 'test', cases: [], products: [{ id: product.id, title: 'Synthetic product', split: 'development' }],
    passages: sources.flatMap(parent => workspaceSourceChunks(parent.text).map((text, index, chunks) => ({ id: chunks.length === 1 ? parent.id : `${parent.id}-${index + 1}`, productId: product.id,
      source: parent.label, text, reference: parent.label, sha256: textHash(text), ...(parent.originalQuestion !== undefined ? { originalQuestion: parent.originalQuestion } : {}) }))) };
  const retrieval: RetrievalResult = { passages: baselineIds.map((id, index) => ({ ...corpus.passages.find(p => p.id === id)!, lexicalRank: index + 1, semanticRank: index + 2, score: 1 / (60 + index) })), durationMs: 1, method: 'synthetic ranking fixture', embeddingModel: 'none', corpusVersion: corpus.version };
  return { product, corpus, retrieval, run: (question: string) => workspaceSourceCoverageV2Context(product, corpus, retrieval, question) };
}
const baseline = () => source('baseline', 'review', 'A synthetic report, unchanged.');
const ids = (result: ReturnType<ReturnType<typeof setup>['run']>) => result.additions.map(addition => addition.sourceId);

test('synthetic nested component specs reach a dimensions request without package measurements', () => {
  const f = setup([baseline(),
    source('band', 'attribute', 'band: { material:[{value:"leather"}], size:[{value:"8 inches"}], width:[{unit:millimeters,value:17}] }'),
    source('case', 'attribute', 'case: {diameter:[{unit:millimeters,value:36}],thickness:[{unit:millimeters,value:10}]}'),
    source('package', 'attribute', 'package: {dimensions:{width:{value:20,unit:centimeters},height:{value:12}}}'),
    source('color', 'attribute', 'color:{value:"red"}'),
  ]);
  assert.equal(f.run('What are the dimensions of this item?').contract, WORKSPACE_SOURCE_COVERAGE_V2_CONTRACT);
  assert.deepEqual(ids(f.run('What are the dimensions of this item?')), ['band', 'case']);
  assert.deepEqual(ids(f.run('What are its package dimensions?')), ['package']);
  const result = f.run('How wide is the band?');
  assert.equal(result.additions[0]!.sourceId, 'band');
  assert.ok(result.additions[0]!.reasons.includes('structured_path:band.width'));
  assert.equal(result.passages[1]!.text, f.product.sources[1]!.text);
});

test('synthetic nested JSON, single quotes and field scopes are read without rewriting values', () => {
  for (const body of ['{"case":{"thickness":{"value":9,"unit":"mm"}}}', "{'case':{'thickness':{'value':9,'unit':'mm'}}}", 'case:{thickness:{value:9,unit:mm}}']) {
    const f = setup([baseline(), source('nested', 'attribute', body)]);
    const added = f.run('What is the thickness?').passages[1]!;
    assert.equal(added.text, body); assert.equal(added.sha256, textHash(body));
  }
  const f = setup([baseline(), source('nested-package', 'attribute', '{"shipping":{"item_dimensions":{"width":40}}}'), source('item', 'attribute', 'item_dimensions:{width:30}')]);
  assert.deepEqual(ids(f.run('What are item dimensions?')), ['item']);
  assert.deepEqual(ids(f.run('What are shipping dimensions?')), ['nested-package']);
});

test('synthetic attribute values cannot masquerade as nested specification keys', () => {
  const f = setup([baseline(), source('quoted', 'attribute', 'comment:{value:"band: {width:17}"}'), source('broken', 'attribute', 'band:{width:{value:17}')]);
  assert.deepEqual(ids(f.run('What is the width?')), []);
});

test('synthetic coordinated item/package requests retain the established v1 scopes', () => {
  const f = setup([baseline(), source('item', 'attribute', 'item_dimensions:{width:10}'), source('package', 'attribute', 'item_package_dimensions:{width:12}')]);
  for (const question of [
    'What are the dimensions of the product as well as its package?',
    'What are the dimensions of the package as well as its product?',
    'Compare the dimensions of the product compared with the package.',
    'Compare the dimensions of the box compared to its item.',
    'What are the dimensions of the product and of its package?',
    'What are the dimensions of the package and also of this product?',
    'What are the package/product dimensions?',
    'How large are the product and its package?',
    "What are the product's and package's dimensions?",
  ]) assert.deepEqual(ids(f.run(question)), ['item', 'package'], question);
  assert.deepEqual(ids(f.run('I have the product and its package; what are the package dimensions?')), ['package']);
  assert.deepEqual(ids(f.run('What are the package dimensions of this product?')), ['package']);
});

test('synthetic conditional narrative load ranges retain the whole condition and do not establish model fit', () => {
  const condition = 'Supports microphones weighing between 600g and 1.2kg when combined with the shock mount. Check thread adapters separately.';
  const f = setup([source('baseline', 'cqa', 'Yes, with a separate adapter.', 'Will it hold the AB-42 microphone?'),
    source('load', 'description', condition), source('own-weight', 'description', 'The arm weighs 700g.'), source('unquantified', 'bullet', 'Supports microphones.'), source('irrelevant', 'review', 'I hold it while moving furniture.')]);
  const result = f.run('Will this hold an AB-42 microphone?');
  assert.deepEqual(ids(result), ['load']);
  assert.equal(result.passages[1]!.text, condition);
  assert.deepEqual(result.passages.slice(0, 1), workspaceCompleteSourceContext(f.product, f.corpus, f.retrieval));
  assert.ok(!result.additions[0]!.reasons.some(reason => /confirmed|compatible|fits/.test(reason)));
});

test('synthetic fluid capacity and nested facets stay relevant to the requested question', () => {
  const f = setup([baseline(), source('capacity', 'description', 'The jug holds 1.7 liters, provided the lid is seated.'),
    source('shell', 'attribute', 'shell:{material:{value:"glass"},color:{value:"blue"}}'), source('weight', 'attribute', 'item_weight:{value:2,unit:kg}')]);
  assert.deepEqual(ids(f.run('How much does it hold?')), ['capacity']);
  assert.deepEqual(ids(f.run('What is it made of?')), ['shell']);
  assert.deepEqual(ids(f.run('What color is it?')), ['shell']);
  assert.deepEqual(ids(f.run('How much does it cost?')), []);
});

test('synthetic operation timings supplement duration questions without item dimensions or warranty duration', () => {
  const report = 'The front scan button produces a 2400 dpi scan of one slide in about a half a minute.';
  const f = setup([source('baseline', 'cqa', 'At 3600 dpi a full scan takes two minutes on this machine.', 'How long does one scan take?'),
    source('timing', 'review', report), source('dimensions', 'attribute', 'item_dimensions:{length:12,width:5,unit:inches}'),
    source('warranty', 'review', 'The scanner warranty lasts 24 months.'), source('warmup', 'review', 'The heater takes 2 minutes to warm up.'),
    source('vague', 'review', 'The scanner is really fast.'), source('dpi', 'bullet', 'Scan at 7200 dpi maximum resolution.')]);
  const result = f.run('How long does it take to scan at the best and lowest resolution?');
  assert.deepEqual(ids(result), ['timing']);
  assert.equal(result.passages[1]!.text, report);
  assert.ok(result.additions[0]!.reasons.includes('shared_operation:scan'));
  assert.ok(!result.additions[0]!.reasons.some(reason => /highest|lowest|equivalent|endpoint/.test(reason)));
  assert.deepEqual(ids(f.run('How long is the item?')), ['dimensions']);
});

test('synthetic short CQA timing retains its original workflow question', () => {
  const question = 'How long does it take to scan one negative at 1800 dpi on an older laptop?';
  const f = setup([baseline(), source('timing', 'cqa', 'About 45 seconds, with multi exposure disabled.', question), source('printing', 'cqa', 'About 45 seconds.', 'How long does a print take?')]);
  const result = f.run('How long does scanning take at different resolutions?');
  assert.deepEqual(ids(result), ['timing']);
  assert.equal(result.passages[1]!.originalQuestion, question);
  assert.equal(result.passages[1]!.source, 'cqa');
});

test('synthetic model-specific CQA uses literal originalQuestion identifiers, including negative answers', () => {
  const question = 'Will this fit ZX-123?';
  const f = setup([baseline(), source('exact', 'cqa', 'No, not without a different adapter.', question),
    source('near', 'cqa', 'Yes.', 'Will this fit ZX123?'), source('other', 'cqa', 'Yes.', 'Will this fit ZX-124?'),
    source('body-only', 'review', 'ZX-123 works on my bench.'), source('no-scope', 'cqa', 'Yes. ZX-123.')]);
  const result = f.run('Will it fit model ZX-123?');
  assert.deepEqual(ids(result), ['exact']);
  assert.equal(result.passages[1]!.originalQuestion, question);
  assert.equal(result.passages[1]!.text, 'No, not without a different adapter.');
  assert.ok(result.additions[0]!.reasons.includes('question_scoped_report_context_only'));
  assert.deepEqual(ids(f.run('Will it fit model ZX123?')), ['near']);
  assert.deepEqual(ids(f.run('My model ZX-123 is known. What is its color?')), []);
});

test('synthetic exact model listing and bare family remain context, never aliases or a compatibility conclusion', () => {
  const f = setup([baseline(), source('exact', 'bullet', 'Not for FAM-123.'), source('family', 'description', 'FAM appliance family, check your exact model.'),
    source('near', 'bullet', 'Fits FAM123.'), source('identity', 'attribute', 'model_number:{value:"FAM-124"}')]);
  const result = f.run('Will it fit FAM-123?');
  assert.deepEqual(ids(result), ['exact', 'identity', 'family']);
  assert.ok(result.additions.find(addition => addition.sourceId === 'family')!.reasons.includes('identifier_family_context_only:FAM'));
  assert.ok(result.additions.find(addition => addition.sourceId === 'identity')!.reasons.every(reason => !reason.startsWith('exact_identifier_context:')));
});

test('synthetic requested facets are not crowded out by known background dimensions', () => {
  const f = setup([baseline(), source('dimensions', 'attribute', 'item_dimensions:{width:20}'), source('color', 'attribute', 'color:{value:"red"}'),
    source('material', 'attribute', 'material:{value:"glass"}'), source('capacity', 'attribute', 'capacity:{value:12,unit:cups}')]);
  for (const question of ['I know its dimensions. What are its color, material and capacity?', 'Color, material and capacity, can you tell me?']) {
    assert.deepEqual(ids(f.run(question)), ['capacity', 'color', 'material']);
  }
});

test('synthetic supplementation preserves full baseline order, duplicate-chunk deduplication and Unicode originals', () => {
  const report = source('baseline', 'cqa', `${'Synthetic customer report é. '.repeat(15)}Only for the smaller variant.`, 'Does it fit AB.123?');
  const f = setup([report, source('second', 'review', 'A contrary synthetic report.'), source('model', 'cqa', 'No; use an adapter.', 'Does it fit AB.123?')], ['baseline-2', 'second', 'baseline-1']);
  const snapshot = structuredClone({ product: f.product, corpus: f.corpus, retrieval: f.retrieval });
  const result = f.run('Does it fit AB.123?');
  assert.deepEqual(result.passages.slice(0, 2), workspaceCompleteSourceContext(f.product, f.corpus, f.retrieval));
  assert.equal(result.passages[0]!.text, report.text); assert.equal(result.passages[0]!.originalQuestion, report.originalQuestion);
  assert.deepEqual(ids(result), ['model']);
  assert.deepEqual({ product: f.product, corpus: f.corpus, retrieval: f.retrieval }, snapshot);
  assert.ok(result.passages.slice(2).every(passage => passage.lexicalRank === null && passage.semanticRank === null && passage.score === 0 && passage.sha256 === textHash(passage.text)));
});

test('synthetic deterministic selection is bounded to three additions and eight total parents', () => {
  const f = setup([baseline(), ...['d', 'b', 'a', 'c'].map(id => source(id, 'attribute', `color:{value:"${id}"}`))]);
  const result = f.run('What color is it?');
  assert.deepEqual(ids(result), ['a', 'b', 'c']);
  f.product.sources.reverse(); assert.deepEqual(f.run('What color is it?'), result);
  const reports = Array.from({ length: 8 }, (_, index) => source(`r${index}`, 'review', `Synthetic baseline ${index}`));
  const full = setup([...reports, source('color', 'attribute', 'color:{value:"red"}')], reports.map(report => report.id));
  assert.deepEqual(ids(full.run('What color is it?')), []);
  const one = setup([...reports.slice(0, 7), source('a-color', 'attribute', 'color:{value:"red"}'), source('b-color', 'attribute', 'color:{value:"blue"}')], reports.slice(0, 7).map(report => report.id));
  assert.deepEqual(ids(one.run('What color is it?')), ['a-color']);
});

test('synthetic long parents are skipped, and additions retain full Unicode text without clipping', () => {
  const parent = source('color', 'attribute', `color:{value:"青"}; ${'literal é qualifier '.repeat(40)}`);
  const f = setup([baseline(), parent, source('large', 'attribute', `color:{value:"${'x'.repeat(1500)}"}`)]);
  assert.ok(f.corpus.passages.filter(passage => passage.id.startsWith('color-')).length > 1);
  const result = f.run('What color is it?');
  assert.deepEqual(ids(result), ['color']); assert.equal(result.passages[1]!.text, parent.text);
  assert.ok(f.corpus.passages.filter(passage => passage.id.startsWith('color-')).every(passage => Buffer.byteLength(passage.text) <= 300));
});

test('synthetic wrong corpus bindings and tampered supplemental or baseline parents fail closed', () => {
  for (const mutate of [
    (f: ReturnType<typeof setup>) => { f.corpus.passages[1]!.source = 'description'; },
    (f: ReturnType<typeof setup>) => { f.product.sources[1]!.text = 'color:{value:"changed"}'; },
    (f: ReturnType<typeof setup>) => { f.product.sources[0]!.text = 'Changed baseline body.'; },
    (f: ReturnType<typeof setup>) => { f.product.sources[1]!.originalQuestion = 'Changed scope?'; },
    (f: ReturnType<typeof setup>) => { f.corpus.products.push({ id: 'other', title: 'Other', split: 'development' }); f.corpus.passages[1]!.productId = 'other'; },
    (f: ReturnType<typeof setup>) => { f.retrieval.corpusVersion = 'wrong'; },
    (f: ReturnType<typeof setup>) => { f.retrieval.passages.push({ ...f.retrieval.passages[0]! }); },
    (f: ReturnType<typeof setup>) => { f.product.sources.push({ ...f.product.sources[1]! }); },
  ]) {
    const f = setup([baseline(), source('color', 'attribute', 'color:{value:"red"}')]); mutate(f); assert.throws(() => f.run('What color is it?'));
  }
});
