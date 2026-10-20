import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AmazonPqaParseError, canonicalAmazonPqaTextsV1, parseAmazonPqaObjectsV1, screenAmazonPqaSourceV1, type AmazonPqaExposureHistory, type AmazonPqaScreeningPolicy, type AmazonPqaSourcePin } from './amazon-pqa-source-v1.ts';
import { textHash } from './product-corpus.ts';

/** Every publisher-shaped row below is invented. No dataset bodies, model cache,
 * network, credentials, actual provider or paid ledger are opened by this suite. */
const raw = (overrides: Record<string, unknown> = {}) => ({ question_id: 'SYNTHETIC-question-1', question_text: 'SYNTHETIC can it retain a drink overnight?', answer_text: 'SYNTHETIC WITHHELD ANSWER secret outcome', asin_id: 'SYNTH00001', bullet_points: ['SYNTHETIC insulated steel body.', 'SYNTHETIC capacity depends on the lid.'], product_description: 'SYNTHETIC bottle with an optional lid.', brand_name: 'SYNTHETIC Thistle', item_name: 'SYNTHETIC Thistle insulated bottle', 'is_yes-no_question': true, 'yes-no_answer': 'SYNTHETIC PREDICTION MUST NEVER LEAK', ...overrides });
const policy: AmazonPqaScreeningPolicy = { maxInspectedRecords: 20, targetPackets: 2, maxParents: 128, maxBodyUtf16Units: 1500, maxQuestionUtf16Units: 1000, maxTitleUtf16Units: 240 };
const history = (): AmazonPqaExposureHistory => ({ productIds: [], canonicalFamilyTitles: [], modelIdentifiers: [], sourceBodyFingerprints: [], sourcePacketFingerprints: [] });
function fixture(rows: unknown[], format: 'json-array' | 'jsonl' = 'json-array', tail = '', range = false) {
  const contents = (format === 'json-array' ? JSON.stringify(rows) : rows.map(r => JSON.stringify(r)).join('\n') + '\n') + tail;
  return fromBytes(Buffer.from(contents), format, range);
}
function fromBytes(bytes: Buffer, format: 'json-array' | 'jsonl', range = false) {
  const key = 'SYNTHETIC/amazon_pqa_accessories.json';
  const pin: AmazonPqaSourcePin = { format: 'ablatrix-amazon-pqa-source-pin-v1', dataset: 'Amazon-PQA', split: 'unpartitioned', schemaId: `amazon-pqa-official-fields-v1-${format}`, provenance: 'synthetic_fixture', objects: [{ role: 'category_records', key, versionId: null, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, sourceBytes: bytes.length + (range ? 1000 : 0), range: range ? { start: 0, endInclusive: bytes.length - 1 } : null }] };
  const records = (maximum = 20) => parseAmazonPqaObjectsV1(pin, new Map([[key, bytes]]), maximum);
  const screen = (h = history(), p = policy) => screenAmazonPqaSourceV1({ sourcePin: pin, records: records(p.maxInspectedRecords), policy: p, history: h });
  return { bytes, key, pin, records, screen };
}

test('official-field synthetic parsing preserves complete parents, discards predictions and excludes every target-equivalent answer', () => {
  const f = fixture([
    raw({ product_description: 'SYNTHETIC published wrapper SYNTHETIC WITHHELD ANSWER secret outcome with conditions.' }),
    raw({ question_id: 'SYNTHETIC-q2', question_text: '  SYNTHETIC CAN IT RETAIN A DRINK OVERNIGHT!!!  ', answer_text: 'SYNTHETIC ALTERNATIVE WITHHELD answer' }),
    raw({ question_id: 'SYNTHETIC-q3', question_text: 'SYNTHETIC is the lid optional?', answer_text: 'SYNTHETIC lid is sold separately; a customer used it outdoors.' }),
    raw({ question_id: 'SYNTHETIC-q4', question_text: 'SYNTHETIC differently scoped question', answer_text: 'SYNTHETIC ALTERNATIVE WITHHELD answer' }),
    raw({ question_id: 'SYNTHETIC-question-1', question_text: 'SYNTHETIC same-ID conflicting question', answer_text: 'SYNTHETIC SAME ID WITHHELD' }),
  ]);
  const records = f.records(); assert.equal(records.length, 5); assert.ok(!JSON.stringify(records).includes('PREDICTION MUST NEVER LEAK'));
  const result = f.screen(), decision = result.decisions[0], packet = decision.packet!;
  assert.equal(decision.eligible, true); assert.equal(packet.sources.length, 2);
  assert.deepEqual(packet.sources.map(s => s.label).sort(), ['bullet_points', 'cqa']);
  assert.equal(packet.sources.find(s => s.label === 'bullet_points')!.text, 'SYNTHETIC insulated steel body.\nSYNTHETIC capacity depends on the lid.');
  const cqa = packet.sources.find(s => s.label === 'cqa')!; assert.equal(cqa.originalQuestion, 'SYNTHETIC is the lid optional?'); assert.match(cqa.reference, /row=3/);
  const serialized = JSON.stringify(packet); for (const secret of ['secret outcome', 'ALTERNATIVE WITHHELD', 'SAME ID WITHHELD', 'PREDICTION MUST NEVER LEAK']) assert.ok(!serialized.includes(secret));
  assert.ok(decision.excludedParents.some(p => p.reason === 'target_answer_text_in_parent')); assert.ok(decision.excludedParents.filter(p => p.reason === 'target_equivalent_question').length >= 3);
  assert.ok(result.decisions.slice(1).every(d => !d.eligible && d.reasons.includes('historical_or_within_prefix_product')));
  assert.equal(result.normalization.algorithm, 'python_nfkc_casefold_v1'); assert.ok(result.normalization.unicodeVersion); assert.equal(result.providerCalls, 0); assert.equal(result.qualityClaimEligible, false);
});

test('canonical body hashes agree with historical Python NFKC/casefold for Unicode and ignore original-question changes', () => {
  const values = canonicalAmazonPqaTextsV1(['Straße', 'STRASSE', 'ΟΣ', 'οσ', 'ος', 'cafe\u0301', 'café', 'Ａ  Ｂ']);
  assert.equal(values.get('Straße'), values.get('STRASSE')); assert.equal(values.get('ΟΣ'), values.get('οσ')); assert.equal(values.get('ος'), values.get('οσ')); assert.equal(values.get('cafe\u0301'), values.get('café')); assert.equal(values.get('Ａ  Ｂ'), 'a b');
  const h = history(); h.sourceBodyFingerprints.push(textHash(JSON.stringify(['strasse'])));
  const f = fixture([raw({ product_description: 'Straße' })]); const result = f.screen(h);
  assert.equal(result.decisions[0].eligible, false); assert.ok(result.decisions[0].reasons.includes('historical_or_within_prefix_body'));
  const other = fixture([raw({ question_id: 'SYNTHETIC-q2', question_text: 'SYNTHETIC unrelated scope', product_description: 'STRASSE' })]).screen(h);
  assert.ok(other.decisions[0].reasons.includes('historical_or_within_prefix_body'));
});

test('every inspected rejection and overflow parent contributes protected exposure before later decisions', () => {
  const oversized = 'SYNTHETIC oversized source ' + 'x'.repeat(1501);
  const f = fixture([
    raw({ item_name: '', product_description: oversized }),
    raw({ asin_id: 'SYNTH00002', item_name: 'SYNTHETIC Meadow camping kettle', brand_name: 'SYNTHETIC Meadow', question_id: 'SYNTHETIC-new-target', answer_text: 'SYNTHETIC other target answer', product_description: oversized, bullet_points: null }),
  ]);
  const result = f.screen(); assert.equal(result.screeningDenominator, 2); assert.deepEqual(result.acceptedCaseIds, []);
  assert.ok(result.decisions[0].reasons.includes('missing_or_out_of_bounds_title')); assert.ok(result.decisions[0].reasons.includes('complete_parent_out_of_bounds'));
  assert.ok(result.decisions[1].reasons.includes('historical_or_within_prefix_body'));
  const expected = textHash(JSON.stringify([oversized.toLowerCase()])); assert.ok(result.consumedExposure.sourceBodyFingerprints.includes(expected)); assert.deepEqual(result.consumedExposure.productIds, ['SYNTH00001', 'SYNTH00002']);
  assert.equal(result.stopReason, 'finite_prefix_shortfall');
});

test('finite decoder parses only the declared prefix and does not rescue malformed schema or infer a wrapper', () => {
  const valid = JSON.stringify(raw());
  const array = fromBytes(Buffer.from(`[${valid},{"unexpected":"UNREAD TAIL"}]`), 'json-array'); assert.equal(array.records(1).length, 1); assert.throws(() => array.records(2), /strict_schema_rejected/);
  const lines = fromBytes(Buffer.from(valid + '\n{"unexpected":"UNREAD TAIL"}\n'), 'jsonl'); assert.equal(lines.records(1).length, 1); assert.throws(() => lines.records(2), /strict_schema_rejected/);
  assert.throws(() => fromBytes(Buffer.from(JSON.stringify({ data: [raw()] })), 'json-array').records(), /unsupported_envelope/);
  assert.throws(() => fromBytes(Buffer.from(`[${valid.slice(0, -1)},"question_text":"overwrite"}]`), 'json-array').records(), /strict_schema_rejected/);
  assert.throws(() => fixture([raw({ quality_score: 1 })]).records(), /strict_schema_rejected/);
});

test('immutable range permits only an incomplete final transport row, never an inspected malformed complete row', () => {
  const valid = JSON.stringify(raw());
  for (const format of ['json-array', 'jsonl'] as const) {
    const prefix = format === 'json-array' ? `[${valid},{"question_id":"SYNTHETIC truncated` : valid + '\n{"question_id":"SYNTHETIC truncated';
    const result = fromBytes(Buffer.from(prefix), format, true).records(); assert.equal(result.length, 1);
    assert.throws(() => fromBytes(Buffer.from(prefix), format).records());
  }
  assert.throws(() => fromBytes(Buffer.from(`[${valid},{"unknown":"complete"},`), 'json-array', true).records(), /strict_schema_rejected/);
  const bytes = Buffer.concat([Buffer.from(`[${valid},{"question_id":"`), Buffer.from([0xe2, 0x82])]); assert.equal(fromBytes(bytes, 'json-array', true).records().length, 1);
});

test('raw byte pins, fixed row order, source scope, missing title and peer applicability fail closed', () => {
  const f = fixture([raw()]); const altered = Buffer.concat([f.bytes, Buffer.from(' ')]);
  assert.throws(() => parseAmazonPqaObjectsV1(f.pin, new Map([[f.key, altered]]), 20), /byte count/);
  const modified = Buffer.from(f.bytes); modified[modified.length - 2] ^= 1; assert.throws(() => parseAmazonPqaObjectsV1(f.pin, new Map([[f.key, modified]]), 20), /checksum/);
  const records = f.records(); records[0].row = 2; assert.throws(() => screenAmazonPqaSourceV1({ sourcePin: f.pin, records, policy, history: history() }), /Fixed source row order/);
  const peer = f.records(); peer[0].sources[0].productId = 'SYNTH00999'; const result = screenAmazonPqaSourceV1({ sourcePin: f.pin, records: peer, policy, history: history() }); assert.ok(result.decisions[0].reasons.includes('peer_source_applicability_unresolved')); assert.ok(result.consumedExposure.productIds.includes('SYNTH00999'));
  const missingScope = f.records(); missingScope[0].sources.find(s => s.kind === 'customer_qa')!.originalQuestion = null; assert.throws(() => screenAmazonPqaSourceV1({ sourcePin: f.pin, records: missingScope, policy, history: history() }), /exact original question scope/);
  assert.ok(fixture([raw({ item_name: null })]).screen().decisions[0].reasons.includes('missing_or_out_of_bounds_title'));
});

test('replay is deterministic, no model outputs select cases, and complete info-only parents keep truthful labels', () => {
  const f = fixture([raw()]); const a = f.screen(), b = f.screen(); assert.deepEqual(a, b); assert.equal(a.sourceProvenance, 'synthetic_fixture');
  const packet = a.decisions[0].packet!; assert.ok(packet.sources.length > 0); assert.ok(packet.sources.every(s => s.label !== 'review' && s.label !== 'cqa')); assert.equal(a.decisions[0].familySeparation, 'requires_independent_source_review');
  const changed = fixture([raw({ 'is_yes-no_question': false, 'yes-no_answer': 'SYNTHETIC opposite prediction', answer_text: 'SYNTHETIC different unused target response' })]).screen();
  assert.deepEqual(a.decisions.map(d => [d.row, d.productId, d.eligible, d.reasons]), changed.decisions.map(d => [d.row, d.productId, d.eligible, d.reasons]));
  assert.equal(a.activationAuthorized, false); assert.equal(a.paidExecutionAuthorized, false); assert.equal(a.humanSourceCheckedAnswers, 0); assert.equal(a.generatedAnswersInspected, false);
});

test('parent-count overflow and historical metadata/version mismatches cannot silently qualify a packet', () => {
  const f = fixture([raw()]); const lowCap = f.screen(history(), { ...policy, maxParents: 1 });
  assert.ok(lowCap.decisions[0].reasons.includes('parent_count_overflow')); assert.equal(lowCap.decisions[0].packet, null); assert.ok(lowCap.consumedExposure.sourceBodyFingerprints.length >= 3);
  const runtime = canonicalAmazonPqaTextsV1([]).normalization;
  const h = { ...history(), format: 'SYNTHETIC-bound-history', completeHistoricalUnion: true, normalization: { id: 'python_nfkc_casefold_whitespace_v1' as const, pythonVersion: runtime.pythonVersion, unicodeVersion: runtime.unicodeVersion } };
  assert.equal(f.screen(h).decisions[0].eligible, true);
  assert.throws(() => f.screen({ ...h, normalization: { ...h.normalization, unicodeVersion: 'SYNTHETIC wrong version' } }), /Historical Unicode normalization version differs/);
  const publisher = structuredClone(f.pin); publisher.provenance = 'publisher_dataset'; publisher.objects[0].versionId = 'SYNTHETIC-version';
  assert.throws(() => screenAmazonPqaSourceV1({ sourcePin: publisher, records: f.records(), policy, history: history() }), /exact historical normalization versions/);
});

test('strict parse failures retain prior and recognized failing-row exposure without raw canaries or schema rescue', () => {
  const canary = 'SYNTHETIC PRIVATE BODY CANARY';
  const f = fixture([raw(), raw({ asin_id: 'SYNTH00002', question_text: 'SYNTHETIC failing recognized question', answer_text: canary, item_name: 'SYNTHETIC Failing title', unsupported_outcome: 'SYNTHETIC unknown outcome' })]);
  let failure: AmazonPqaParseError | undefined;
  try { f.records(); } catch (error) { assert.ok(error instanceof AmazonPqaParseError); failure = error; }
  assert.ok(failure); assert.equal(failure.inspectedRows, 2); assert.equal(failure.validDecodedRows, 1); assert.equal(failure.wholePrefixConsumed, true); assert.equal(failure.eligiblePackets, 0);
  assert.deepEqual(failure.consumedExposure.productIds, ['SYNTH00001', 'SYNTH00002']); assert.ok(failure.consumedExposure.sourceBodyFingerprints.includes(textHash(JSON.stringify([canary.toLowerCase()]))));
  assert.ok(!JSON.stringify(failure).includes(canary)); assert.ok(!failure.message.includes(canary)); assert.equal(failure.stage, 'strict_schema_rejected'); assert.equal(failure.sourcePinSha256.length, 64);
  const envelope = fromBytes(Buffer.from('{"unqualified":"SYNTHETIC unknown wrapper"}'), 'json-array');
  assert.throws(() => envelope.records(), (error: unknown) => error instanceof AmazonPqaParseError && error.wholePrefixConsumed && error.stage === 'unsupported_envelope' && error.validDecodedRows === 0);
  assert.throws(() => fromBytes(Buffer.from([0xff, 0xfe]), 'json-array').records(), (error: unknown) => error instanceof AmazonPqaParseError && error.stage === 'invalid_utf8' && error.wholePrefixConsumed);
});
