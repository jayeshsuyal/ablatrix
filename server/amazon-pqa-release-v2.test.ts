import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { textHash } from './product-corpus.ts';
import { AmazonPqaReleaseParseErrorV2, parseAmazonPqaReleaseV2, projectAmazonPqaReleaseBoundaryV2, projectAmazonPqaReleaseExposureV2, projectAmazonPqaReleaseFragmentsV2, projectAmazonPqaReleaseGuardPinV2, screenAmazonPqaReleaseV2, type AmazonPqaReleasePinV2 } from './amazon-pqa-release-v2.ts';
import type { AmazonPqaExposureHistory, AmazonPqaScreeningPolicy } from './amazon-pqa-source-v1.ts';

/** Invented native-shape fixtures only. No dataset body, transport or provider. */
const raw = (overrides: Record<string, unknown> = {}) => ({ question_id: 'SYNTHETIC-target', question_text: 'Can this invented bottle retain heat overnight?', asin: 'SYNTH00001', bullet_point1: 'Invented insulated steel body.', bullet_point2: 'Invented optional lid.', bullet_point3: '', bullet_point4: '', bullet_point5: '', product_description: 'Invented bottle intended for camping.', brand_name: 'Thistle', item_name: 'Thistle insulated bottle', question_type: 'SYNTHETIC CLASSIFIER LABEL', answer_aggregated: 'SYNTHETIC AGGREGATE ANNOTATION', answers: [{ answer_text: 'SYNTHETIC FIRST WITHHELD answer' }, { answer_text: 'SYNTHETIC SECOND WITHHELD answer' }], ...overrides });
const policy: AmazonPqaScreeningPolicy = { maxInspectedRecords: 40, targetPackets: 2, maxParents: 128, maxBodyUtf16Units: 1500, maxQuestionUtf16Units: 1000, maxTitleUtf16Units: 240 };
const history = (): AmazonPqaExposureHistory => ({ productIds: [], canonicalFamilyTitles: [], modelIdentifiers: [], sourceBodyFingerprints: [], sourcePacketFingerprints: [] });
function fixture(rows: unknown[], array = false) { return sliceFixture(Buffer.from(array ? JSON.stringify(rows) : rows.map(r => JSON.stringify(r)).join('\n') + '\n'), 0, null, array); }
function sliceFixture(all: Buffer, start: number, end: number | null = null, array = false) {
  const bytes = all.subarray(start, end ?? all.length), key = 'SYNTHETIC/amazon_pqa_accessories.json';
  const pin: AmazonPqaReleasePinV2 = { format: 'ablatrix-amazon-pqa-release-pin-v2', dataset: 'Amazon-PQA', split: 'unpartitioned', schemaId: `amazon-pqa-released-fields-v2-${array ? 'json-array' : 'jsonl'}`, provenance: 'synthetic_fixture', objects: [{ role: 'category_records', key, versionId: 'SYNTHETIC-immutable-version', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, sourceBytes: all.length, range: start || end !== null ? { start, endInclusive: start + bytes.length - 1 } : null }] };
  const objects = new Map([[key, bytes]]), parse = (max = 40) => parseAmazonPqaReleaseV2(pin, objects, max);
  return { pin, objects, parse, bytes };
}

test('native multiple answers stay separate complete parents; all target answers and equivalent questions are excluded', () => {
  const f = fixture([
    raw({ bullet_point3: 'Wrapper SYNTHETIC SECOND WITHHELD answer additional condition.', product_description: 'Invented published bottle for hiking.' }),
    raw({ question_id: 'SYNTHETIC-other-question', question_text: 'Is its optional lid included?', answers: [{ answer_text: 'A customer bought the lid separately and used the bottle outside.' }] }),
    raw({ question_id: 'SYNTHETIC-question-variant', question_text: ' CAN THIS INVENTED BOTTLE RETAIN HEAT OVERNIGHT!!! ', answers: [{ answer_text: 'SYNTHETIC EQUIVALENT QUESTION WITHHELD' }] }),
    raw({ question_id: 'SYNTHETIC-duplicate-body', question_text: 'Different invented customer question.', answers: [{ answer_text: 'SYNTHETIC SECOND WITHHELD answer' }] }),
  ]);
  const parsed = f.parse(); assert.equal(parsed.records[0].sources.filter(s => s.kind === 'customer_qa').length, 2); assert.ok(!JSON.stringify(parsed.records).includes('CLASSIFIER LABEL')); assert.ok(!JSON.stringify(parsed.records).includes('AGGREGATE ANNOTATION'));
  const result = screenAmazonPqaReleaseV2({ sourcePin: f.pin, parsed, policy, history: history(), mode: 'prospective_source_screening' });
  const packet = result.decisions[0].packet!; assert.ok(packet); const body = JSON.stringify(packet);
  for (const taint of ['FIRST WITHHELD', 'SECOND WITHHELD', 'EQUIVALENT QUESTION WITHHELD', 'AGGREGATE ANNOTATION', 'CLASSIFIER LABEL']) assert.ok(!body.includes(taint));
  assert.ok(packet.sources.some(s => s.label === 'cqa' && s.originalQuestion === 'Is its optional lid included?')); assert.ok(packet.sources.some(s => s.label === 'bullet_points' && s.text === 'Invented optional lid.'));
  assert.equal(result.format, 'ablatrix-amazon-pqa-release-screening-v2'); assert.equal(result.guardProjection.nativeSchemaClaim, false); assert.equal(result.guardProjection.nativeSourcePinSha256, result.sourcePinSha256); assert.equal(result.providerCalls, 0);
});

test('aggregate annotations have a separate commitment namespace; genuine short customer answers remain protected bodies', () => {
  const f = fixture([raw({ answer_aggregated: 'Yes', answers: [{ answer_text: 'No' }] })]); const parsed = f.parse(), exposed = projectAmazonPqaReleaseExposureV2(parsed);
  const yes = textHash(JSON.stringify(['yes'])), no = textHash(JSON.stringify(['no']));
  assert.ok(exposed.withheldAggregateFingerprints.includes(yes)); assert.ok(!exposed.consumedExposure.sourceBodyFingerprints.includes(yes)); assert.ok(exposed.consumedExposure.sourceBodyFingerprints.includes(no));
  assert.ok(exposed.consumedExposure.targetAnswerFingerprints.includes(no));
  const h = history(); h.sourceBodyFingerprints.push(no); const result = screenAmazonPqaReleaseV2({ sourcePin: f.pin, parsed, policy, history: h, mode: 'prospective_source_screening' }); assert.ok(result.decisions[0].reasons.includes('historical_or_within_prefix_body'));
});

test('complete old consumed-prefix replay maps beyond the old 4096-row limit and can never qualify fresh cases', () => {
  const rows = Array.from({ length: 4097 }, (_, i) => raw({ question_id: `SYNTHETIC-exposed-${i}`, asin: `SYNTH${String(i).padStart(5, '0')}` }));
  const f = fixture(rows), parsed = f.parse(100_000); assert.equal(parsed.records.length, 4097); assert.equal(parsed.inspection.completePrefixCoverage, true);
  const result = screenAmazonPqaReleaseV2({ sourcePin: f.pin, parsed, policy, history: history(), mode: 'exposed_development_replay' });
  assert.equal(result.screeningDenominator, 4097); assert.deepEqual(result.acceptedCaseIds, []); assert.ok(result.decisions.every(d => !d.eligible && d.packet === null)); assert.equal(result.stopReason, 'exposed_development_only');
  const bounded = f.parse(10); assert.equal(bounded.inspection.completePrefixCoverage, false); assert.ok(bounded.inspection.unparsedTail);
});

test('native offset ranges quarantine the first partial physical line, drop the last partial line and expose hash-only boundaries', () => {
  const first = JSON.stringify(raw()), second = JSON.stringify(raw({ question_id: 'SYNTHETIC-boundary', asin: 'SYNTH00002', item_name: 'Meadow invented kettle', brand_name: 'Meadow' })), third = JSON.stringify(raw({ question_id: 'SYNTHETIC-third', asin: 'SYNTH00003', item_name: 'Aster invented cup', brand_name: 'Aster' }));
  const all = Buffer.from(first + '\n' + second + '\n' + third + '\n'), cut = Buffer.byteLength(first + '\n') + Math.floor(Buffer.byteLength(second) / 2);
  const prior = sliceFixture(all, 0, cut), next = sliceFixture(all, cut), p = prior.parse(), n = next.parse(); assert.equal(p.records.length, 1); assert.equal(n.records.length, 1); assert.equal(n.records[0].product.id, 'SYNTH00003');
  assert.ok(p.inspection.trailingFragment); assert.ok(n.inspection.leadingFragment); assert.equal(n.inspection.skippedInitialPartialLine, true); assert.ok(n.inspection.physicalRowOffsets[0] > cut);
  const fragments = projectAmazonPqaReleaseFragmentsV2(prior.pin, prior.objects, p); assert.equal(fragments.allFragmentsQuarantined, true); assert.ok(!JSON.stringify(fragments).includes('Meadow invented kettle'));
  const boundary = projectAmazonPqaReleaseBoundaryV2({ sourcePin: prior.pin, objects: prior.objects, parsed: p }, { sourcePin: next.pin, objects: next.objects });
  assert.equal(boundary.resolved, true); assert.equal(boundary.bodyExposureComplete, true); assert.equal(boundary.boundaryNeverSelectable, true); assert.deepEqual(boundary.consumedExposure.productIds, ['SYNTH00002']); assert.equal(boundary.eligiblePackets, 0);
  const changed = structuredClone(next.pin); changed.objects[0].versionId = 'SYNTHETIC-other-version'; assert.throws(() => projectAmazonPqaReleaseBoundaryV2({ sourcePin: prior.pin, objects: prior.objects, parsed: p }, { sourcePin: changed, objects: next.objects }));
});

test('native schema, duplicate answer keys and invalid decoded rows fail with protected exposure and sanitized errors', () => {
  const valid = JSON.stringify(raw()), duplicateAnswer = valid.replace('"answer_text":"SYNTHETIC FIRST WITHHELD answer"', '"answer_text":"SYNTHETIC PRIVATE FIRST","answer_text":"SYNTHETIC PRIVATE OVERWRITE"');
  for (const line of [duplicateAnswer, JSON.stringify(raw({ unknown_outcome: 'SYNTHETIC PRIVATE OUTCOME' }))]) {
    const f = sliceFixture(Buffer.from(valid + '\n' + line + '\n'), 0); let failure: AmazonPqaReleaseParseErrorV2 | undefined;
    try { f.parse(); } catch (error) { assert.ok(error instanceof AmazonPqaReleaseParseErrorV2); failure = error; }
    assert.ok(failure); assert.equal(failure.inspectedRows, 2); assert.equal(failure.validDecodedRows, 1); assert.equal(failure.wholePrefixConsumed, true); assert.ok(failure.consumedExposure.productIds.includes('SYNTH00001')); assert.ok(!JSON.stringify(failure).includes('SYNTHETIC PRIVATE')); assert.equal(failure.qualityClaimEligible, false);
  }
  const invalid = sliceFixture(Buffer.from('{not valid JSON}\n'), 0); assert.throws(() => invalid.parse(), (e: unknown) => e instanceof AmazonPqaReleaseParseErrorV2 && e.inspectedRows === 1 && e.validDecodedRows === 0);
  const invalidUtf8 = sliceFixture(Buffer.from([0xff, 0x0a]), 0); assert.throws(() => invalidUtf8.parse(), (e: unknown) => e instanceof AmazonPqaReleaseParseErrorV2 && e.inspectedRows === 1 && e.stage === 'invalid_utf8');
});

test('native envelopes are explicit, byte pins stay exact and internal v1 projection is never a native schema assertion', () => {
  const f = fixture([raw()], true); assert.equal(f.parse().records.length, 1); const pin = projectAmazonPqaReleaseGuardPinV2(f.pin); assert.match(pin.objects[0].key, /^calculation-projection\//); assert.equal(pin.objects[0].range, null);
  const changed = Buffer.concat([f.bytes, Buffer.from(' ')]); assert.throws(() => parseAmazonPqaReleaseV2(f.pin, new Map([[f.pin.objects[0].key, changed]]), 40), /byte length/);
  const wrapper = sliceFixture(Buffer.from(JSON.stringify({ data: [raw()] })), 0, null, true); assert.throws(() => wrapper.parse(), (e: unknown) => e instanceof AmazonPqaReleaseParseErrorV2 && e.stage === 'unsupported_envelope');
  const offsetArray = sliceFixture(Buffer.from(JSON.stringify([raw()])), 1, null, true); assert.throws(() => offsetArray.parse(), /row boundary/);
});

test('boundary reconstruction never decodes a fresh complete row after the first physical delimiter', () => {
  const boundary = JSON.stringify(raw({ question_id: 'SYNTHETIC-old-boundary' }));
  const all = Buffer.from(boundary + '\n{MALFORMED FRESH COMPLETE ROW MUST REMAIN UNREAD}\n'), cut = Math.floor(Buffer.byteLength(boundary) / 2);
  const prior = sliceFixture(all, 0, cut), current = sliceFixture(all, cut), parsed = prior.parse();
  const result = projectAmazonPqaReleaseBoundaryV2({ sourcePin: prior.pin, objects: prior.objects, parsed }, { sourcePin: current.pin, objects: current.objects });
  assert.equal(result.resolved, true); assert.equal(result.bodyExposureComplete, true); assert.equal(result.eligiblePackets, 0);
  const missingTail = structuredClone(parsed); missingTail.inspection.trailingFragment = null;
  assert.throws(() => projectAmazonPqaReleaseBoundaryV2({ sourcePin: prior.pin, objects: prior.objects, parsed: missingTail }, { sourcePin: current.pin, objects: current.objects }), /real incomplete old row/);
  assert.throws(() => current.parse(), (e: unknown) => e instanceof AmazonPqaReleaseParseErrorV2);
});

test('aggregate prediction values cannot change native source eligibility or delivered parent texts', () => {
  const run = (aggregate: string) => { const f = fixture([raw({ answer_aggregated: aggregate, product_description: 'Nominal bottle, not a machine; polyester carrying sleeve.' })]); return screenAmazonPqaReleaseV2({ sourcePin: f.pin, parsed: f.parse(), policy, history: history(), mode: 'prospective_source_screening' }); };
  const yes = run('Yes'), no = run('No');
  assert.deepEqual(yes.decisions.map(d => [d.row, d.productId, d.eligible, d.reasons]), no.decisions.map(d => [d.row, d.productId, d.eligible, d.reasons]));
  assert.deepEqual(yes.decisions[0].packet?.sources.map(s => [s.label, s.text, s.originalQuestion]), no.decisions[0].packet?.sources.map(s => [s.label, s.text, s.originalQuestion]));
  assert.notDeepEqual(yes.withheldAggregateFingerprints, no.withheldAggregateFingerprints);
});
