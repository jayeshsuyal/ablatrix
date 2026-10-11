import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceCitationOptions, sourceCitationEvidence, resolveSourceCitationIds, stripSourceIdMarkers, type SourceCitationScope } from './citation-options.ts';

// Failed Q7794's supplied attribute body; no successful fresh comparison answers are read.
const dimensions = 'item_dimensions:  { width:{ unit:inches, normalized_value:{ unit:inches, value:11. }, value:11. }, length:{ unit:inches, normalized_value:{ unit:inches, value:21. }, value:21. }, height:{ unit:inches, normalized_value:{ unit:inches, value:12. }, value:12. } }';
const scope: SourceCitationScope = { productId: 'B000UZI26E', question: 'is 21" length or height?', evidence: [{ id: 'dimensions', source: 'attribute', text: dimensions, reference: 'fixture://failed-original-7794' }] };

test('source IDs preserve the complete failed-Q7794 dimensions record, decimal values and literal spacing', () => {
  const options = sourceCitationOptions(scope);
  assert.equal(options.length, 1);
  assert.deepEqual(options, sourceCitationOptions(structuredClone(scope)));
  assert.equal(options[0].quote, dimensions);
  assert.match(options[0].id, /^src_[a-f0-9]{24}$/);
  assert.deepEqual(resolveSourceCitationIds(scope, [options[0].id]), [{ passageId: 'dimensions', quote: dimensions }]);
  const decimal = { ...scope, evidence: [{ ...scope.evidence[0], text: 'The body measures 21.5 inches by 10.25 inches. It weighs 2.75 lb.' }] };
  assert.equal(sourceCitationOptions(decimal)[0].quote, decimal.evidence[0].text);
});

test('source IDs bind product, question, ordered evidence and source context; foreign IDs cannot be reused', () => {
  const base = { ...scope, evidence: [...scope.evidence, { id: 'customer', source: 'cqa', text: 'Yes, it fits.', originalQuestion: 'Does it fit model AB100?' }] };
  const offered = sourceCitationOptions(base), selected = offered[0].id;
  const changed: SourceCitationScope[] = [
    { ...base, productId: 'other-product' }, { ...base, question: 'Will this fit a shelf?' },
    { ...base, evidence: [...base.evidence].reverse() }, { ...base, evidence: base.evidence.slice(0, 1) },
    ...(['id', 'source', 'text', 'originalQuestion', 'reference', 'origin'] as const).map(key => ({ ...base, evidence: base.evidence.map((source, index) => index ? { ...source, [key]: 'changed-value' } : source) }))
  ];
  for (const other of changed) assert.throws(() => resolveSourceCitationIds(other, [selected]), /not offered/);
  assert.throws(() => resolveSourceCitationIds(base, ['invented']), /not offered/);
  assert.throws(() => resolveSourceCitationIds(base, [selected, selected]), /distinct/);
});

test('customer questions remain contextual metadata, with no quotable question option', () => {
  const evidence = [{ id: 'cqa', source: 'cqa', text: 'Yes, it fits. Question: Does it fit model AB100?' }];
  const normalized = sourceCitationEvidence(evidence);
  assert.deepEqual(normalized, [{ id: 'cqa', source: 'cqa', text: 'Yes, it fits.', originalQuestion: 'Does it fit model AB100?' }]);
  const inline = sourceCitationOptions({ ...scope, evidence });
  assert.deepEqual(inline, sourceCitationOptions({ ...scope, evidence: normalized }));
  assert.equal(inline[0].quote, 'Yes, it fits.');
  assert.throws(() => sourceCitationOptions({ ...scope, evidence: [{ ...evidence[0], originalQuestion: 'Does it fit model OTHER?' }] }), /conflicting/);
  assert.throws(() => sourceCitationOptions({ ...scope, evidence: [{ ...evidence[0], text: 'Question: Does it fit model AB100?' }] }), /conflicting/);
  assert.throws(() => sourceCitationOptions({ ...scope, evidence: [{ ...evidence[0], text: 'Yes. Question: First? Question: Second?' }] }), /unambiguous/);
});

test('source options fail closed on duplicate IDs and bounds rather than silently dropping or truncating sources', () => {
  for (const evidence of [[], [scope.evidence[0], scope.evidence[0]], [{ ...scope.evidence[0], text: 'x'.repeat(3001) }],
    Array.from({ length: 13 }, (_, i) => ({ id: `s${i}`, source: 'attribute', text: 'Literal body.' })),
    Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, source: 'attribute', text: 'x'.repeat(2500) }))]) {
    assert.throws(() => sourceCitationOptions({ ...scope, evidence }), /Source-ID/);
  }
  const maximum = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, source: 'attribute', text: 'x'.repeat(3000) }));
  assert.equal(sourceCitationOptions({ ...scope, evidence: maximum }).length, 4);
});

test('only selected bracketed source IDs are removed, and unresolved IDs never reach answer text', () => {
  const id = sourceCitationOptions(scope)[0].id;
  assert.equal(stripSourceIdMarkers(`The listing gives the length. [${id}]`, [id]), 'The listing gives the length.');
  assert.throws(() => stripSourceIdMarkers('The listing gives the length. [src_invented]', [id]), /unselected/);
  assert.throws(() => stripSourceIdMarkers(`The listing gives the length. ${id}`, [id]), /unresolved/);
  assert.throws(() => stripSourceIdMarkers(`[${id}]`, [id]), /no readable text/);
  assert.equal(stripSourceIdMarkers('The listing gives the length. [manufacturer]', [id]), 'The listing gives the length. [manufacturer]');
});
