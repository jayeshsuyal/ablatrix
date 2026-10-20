/** Native Amazon-PQA release compatibility. Frozen v1 files remain unchanged.
 * Native labels are never retrieval evidence. This module has no transport. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { textHash } from './product-corpus.ts';
import { canonicalAmazonPqaTextsV1, screenAmazonPqaSourceV1, type AmazonPqaExposure, type AmazonPqaExposureHistory, type AmazonPqaRecord, type AmazonPqaScreening, type AmazonPqaScreeningPolicy, type AmazonPqaSourcePin } from './amazon-pqa-source-v1.ts';

export type AmazonPqaReleasePinV2 = {
  format: 'ablatrix-amazon-pqa-release-pin-v2'; dataset: 'Amazon-PQA'; split: 'unpartitioned';
  schemaId: 'amazon-pqa-released-fields-v2-json-array' | 'amazon-pqa-released-fields-v2-jsonl';
  provenance: 'publisher_dataset' | 'synthetic_fixture';
  objects: { role: 'category_records'; key: string; versionId: string | null; sha256: string; bytes: number; sourceBytes: number; range: { start: number; endInclusive: number } | null }[];
};
export type AmazonPqaReleaseFragmentV2 = { start: number; endExclusive: number; bytes: number; sha256: string; quarantine: 'incomplete_transport_row' | 'unparsed_tail' };
export type AmazonPqaReleaseParseV2 = {
  records: AmazonPqaRecord[];
  /** Private source-only taints; never placed in a retrieval packet. */
  targetTaints: { row: number; answers: string[]; aggregate: string }[];
  inspection: { format: 'ablatrix-amazon-pqa-release-inspection-v2'; sourcePinSha256: string; completeRows: number; physicalRowOffsets: number[];
    skippedInitialPartialLine: boolean; ignoredTrailingPartialLine: boolean; leadingFragment: AmazonPqaReleaseFragmentV2 | null; trailingFragment: AmazonPqaReleaseFragmentV2 | null;
    unparsedTail: AmazonPqaReleaseFragmentV2 | null; completePrefixCoverage: boolean; freshness: 'not_established'; providerCalls: 0 };
};
export const amazonPqaReleaseSealV2 = (value: unknown): string => {
  const ordered = (v: any): any => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])])) : v;
  return textHash(JSON.stringify(ordered(value)));
};
const seal = amazonPqaReleaseSealV2, MAX_BYTES = 64 * 1024 * 1024, DIGEST = /^[a-f0-9]{64}$/;
function keys(v: unknown, names: string[], label: string): asserts v is Record<string, unknown> { assert.ok(v && typeof v === 'object' && !Array.isArray(v), `${label}: object required`); assert.deepEqual(Object.keys(v).sort(), [...names].sort(), `${label}: strict schema`); }
function literal(v: unknown): asserts v is string { assert.equal(typeof v, 'string', 'Literal string required.'); assert.ok(!(v as string).includes('\0') && [...v as string].every(c => c.codePointAt(0)! < 0xd800 || c.codePointAt(0)! > 0xdfff), 'Well-formed literal Unicode required.'); }
function bound(v: unknown, min: number, max: number): asserts v is number { assert.ok(Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max, 'Finite integer bound required.'); }
export function validateAmazonPqaReleasePinV2(v: unknown): asserts v is AmazonPqaReleasePinV2 {
  keys(v, ['format', 'dataset', 'split', 'schemaId', 'provenance', 'objects'], 'native release pin');
  assert.equal(v.format, 'ablatrix-amazon-pqa-release-pin-v2'); assert.equal(v.dataset, 'Amazon-PQA'); assert.equal(v.split, 'unpartitioned');
  assert.ok(['amazon-pqa-released-fields-v2-json-array', 'amazon-pqa-released-fields-v2-jsonl'].includes(String(v.schemaId)), 'Unsupported native release schema.');
  assert.ok(['publisher_dataset', 'synthetic_fixture'].includes(String(v.provenance))); assert.ok(Array.isArray(v.objects) && v.objects.length === 1);
  for (const o of v.objects) {
    keys(o, ['role', 'key', 'versionId', 'sha256', 'bytes', 'sourceBytes', 'range'], 'native object'); assert.equal(o.role, 'category_records'); literal(o.key); assert.ok(o.key && !o.key.startsWith('/') && !o.key.includes('\\') && !o.key.split('/').some((p: string) => !p || p === '.' || p === '..'));
    assert.ok(o.versionId === null || typeof o.versionId === 'string' && o.versionId.length > 0); if (v.provenance === 'publisher_dataset') assert.ok(typeof o.versionId === 'string' && o.versionId.length > 0, 'Native publisher object must be versioned.');
    assert.ok(typeof o.sha256 === 'string' && DIGEST.test(o.sha256)); bound(o.bytes, 1, MAX_BYTES); bound(o.sourceBytes, o.bytes, Number.MAX_SAFE_INTEGER);
    if (o.range === null) assert.equal(o.bytes, o.sourceBytes);
    else { keys(o.range, ['start', 'endInclusive'], 'native range'); bound(o.range.start, 0, o.sourceBytes - 1); bound(o.range.endInclusive, o.range.start, o.sourceBytes - 1); assert.equal(o.range.endInclusive - o.range.start + 1, o.bytes); if (v.schemaId === 'amazon-pqa-released-fields-v2-json-array') assert.equal(o.range.start, 0, 'A nonzero native array range has no established row boundary.'); }
  }
}
/** An explicit in-memory calculation projection, never a claim that the native
 * release uses v1's published-field schema or whole-object transport. No parser
 * or loader is permitted to use this projected key. */
export function projectAmazonPqaReleaseGuardPinV2(pin: AmazonPqaReleasePinV2): AmazonPqaSourcePin {
  validateAmazonPqaReleasePinV2(pin); const o = pin.objects[0];
  return { format: 'ablatrix-amazon-pqa-source-pin-v1', dataset: 'Amazon-PQA', split: 'unpartitioned', schemaId: pin.schemaId.endsWith('-jsonl') ? 'amazon-pqa-official-fields-v1-jsonl' : 'amazon-pqa-official-fields-v1-json-array', provenance: pin.provenance,
    objects: [{ role: 'category_records', key: `calculation-projection/${seal(pin)}`, versionId: o.versionId, sha256: o.sha256, bytes: o.bytes, sourceBytes: o.bytes, range: null }] };
}

type NativeRow = { question_id: string; question_text: string; asin: string; bullet_point1: string; bullet_point2: string; bullet_point3: string; bullet_point4: string; bullet_point5: string; product_description: string; brand_name: string; item_name: string; question_type: string; answer_aggregated: string; answers: { answer_text: string }[] };
const FIELDS = ['question_id', 'question_text', 'asin', 'bullet_point1', 'bullet_point2', 'bullet_point3', 'bullet_point4', 'bullet_point5', 'product_description', 'brand_name', 'item_name', 'question_type', 'answer_aggregated', 'answers'];
function decodeNative(raw: string): NativeRow {
  // Native values are strings or a flat answer-object array; count top-level
  // keys lexically before JSON.parse can hide duplicate native fields.
  let depth = 0, quoted = false, escaped = false, key = false, start = 0;
  const names = new Map<number, Set<string>>(), expectKeys = new Map<number, boolean>();
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') { quoted = false; if (key) { const value = JSON.parse(raw.slice(start, i + 1)), scope = names.get(depth)!; assert.ok(!scope.has(value), 'Duplicate native field.'); scope.add(value); key = false; } } }
    else if (c === '"') { quoted = true; start = i; key = expectKeys.get(depth) ?? false; }
    else if (c === '{' || c === '[') { depth++; if (c === '{') { names.set(depth, new Set()); expectKeys.set(depth, true); } else expectKeys.set(depth, false); }
    else if (c === '}' || c === ']') { names.delete(depth); expectKeys.delete(depth); depth--; }
    else if (c === ':' && names.has(depth)) expectKeys.set(depth, false);
    else if (c === ',' && names.has(depth)) expectKeys.set(depth, true);
  }
  const value: unknown = JSON.parse(raw); keys(value, FIELDS, 'native released row');
  for (const name of FIELDS.filter(n => n !== 'answers')) literal(value[name]); assert.ok((value.question_id as string).trim()); assert.match(value.asin as string, /^[A-Z0-9]{10}$/);
  assert.ok(Array.isArray(value.answers) && value.answers.length <= 10_000, 'Finite native answer list required.');
  for (const answer of value.answers) { keys(answer, ['answer_text'], 'native answer'); literal(answer.answer_text); }
  return value as NativeRow;
}
const emptyExposure = (): AmazonPqaExposure => ({ productIds: [], canonicalFamilyTitles: [], modelIdentifiers: [], sourceBodyFingerprints: [], sourcePacketFingerprints: [], targetQuestionFingerprints: [], targetAnswerFingerprints: [] });
function mergeExposure(a: AmazonPqaExposure, b: AmazonPqaExposure) { for (const key of Object.keys(a) as (keyof AmazonPqaExposure)[]) a[key] = [...new Set([...a[key], ...b[key]])].sort(); }
const family = (s: string) => s.replace(/^(?:(?:genuine|oem|original|authentic|official|new)\s+)+/, '');
function models(s: string): string[] { return [...new Set((s.match(/\b[a-z0-9]+(?:[-/][a-z0-9]+)*\b/g) ?? []).map(v => v.replace(/[^a-z0-9]/g, '')).filter(v => v.length >= 4 && /\d/.test(v) && !/^\d+(?:gal(?:lons?)?|g|oz|qt|pint|l|ml|cl|dl|yd|yards?|in|inch(?:es)?|ft|feet|cm|mm|xh|gbs|mbps|gbps|meters?|metres?|gb|tb|mah|watts?|volts?|amps?|w|v|a|cc|rpm|lbs?|grams?|kilograms?|colors?|packs?|pieces?|speed)$/.test(v) && !/^\d+x\d+$/.test(v) && (/[a-z]/.test(v) || v.length >= 5)))].sort(); }

export class AmazonPqaReleaseParseErrorV2 extends Error {
  readonly wholePrefixConsumed = true; readonly eligiblePackets = 0; readonly providerCalls = 0; readonly qualityClaimEligible = false;
  constructor(readonly sourcePinSha256: string, readonly inspectedRows: number, readonly validDecodedRows: number, readonly consumedExposure: AmazonPqaExposure,
    readonly stage: 'invalid_utf8' | 'unsupported_envelope' | 'strict_schema_rejected', readonly normalization: AmazonPqaScreening['normalization'], readonly withheldAggregateFingerprints: string[] = []) { super(`Amazon-PQA native v2 ${stage}; whole pinned range consumed.`); this.name = 'AmazonPqaReleaseParseErrorV2'; }
}
function recognizedFailureExposure(values: unknown[]) {
  const textValues: string[] = [], rows: { asin: string; title: string; brand: string; question: string; answers: string[]; sources: string[] }[] = [];
  const safeString = (v: unknown) => { try { literal(v); return v; } catch { return ''; } };
  for (const raw of values) {
    const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const row = { asin: safeString(o.asin), title: safeString(o.item_name), brand: safeString(o.brand_name), question: safeString(o.question_text),
      answers: (Array.isArray(o.answers) ? o.answers.map(a => safeString(a && typeof a === 'object' ? a.answer_text : undefined)) : []).filter(Boolean),
      sources: [safeString(o.product_description), ...[1, 2, 3, 4, 5].map(i => safeString(o[`bullet_point${i}`]))].filter(Boolean) };
    rows.push(row); textValues.push(row.asin, row.title, row.brand, row.question, ...row.answers, ...row.sources);
  }
  const aggregates = values.flatMap(v => v && typeof v === 'object' && !Array.isArray(v) ? [safeString((v as Record<string, unknown>).answer_aggregated)] : []).filter(Boolean);
  textValues.push(...aggregates);
  const norm = canonicalAmazonPqaTextsV1(textValues), normalized = (s: string) => norm.get(s)!, body = (s: string) => textHash(JSON.stringify([normalized(s)])); const exposure = emptyExposure();
  for (const r of rows) {
    const e = emptyExposure(); if (/^[A-Z0-9]{10}$/.test(r.asin)) e.productIds.push(r.asin);
    e.canonicalFamilyTitles = [family(normalized(r.title)), ...(r.brand && r.title ? [family(`${normalized(r.brand)} ${normalized(r.title)}`)] : [])].filter(Boolean);
    e.modelIdentifiers = models([r.title, r.brand, r.question, ...r.answers, ...r.sources].map(normalized).join(' '));
    e.sourceBodyFingerprints = [...r.answers, ...r.sources].filter(s => normalized(s)).map(body); e.targetQuestionFingerprints = normalized(r.question) ? [body(r.question)] : []; e.targetAnswerFingerprints = r.answers.filter(s => normalized(s)).map(body);
    e.sourcePacketFingerprints = [...r.sources.map(s => textHash(JSON.stringify([normalized(s), '']))), ...r.answers.map(s => textHash(JSON.stringify([normalized(s), normalized(r.question)])))]; mergeExposure(exposure, e);
  }
  return { exposure, normalization: norm.normalization, withheldAggregateFingerprints: [...new Set(aggregates.map(body))].sort() };
}

export function parseAmazonPqaReleaseV2(sourcePin: AmazonPqaReleasePinV2, objectBytes: Map<string, Buffer | string>, maximumRows: number): AmazonPqaReleaseParseV2 {
  validateAmazonPqaReleasePinV2(sourcePin); bound(maximumRows, 1, 100_000); const object = sourcePin.objects[0]; assert.deepEqual([...objectBytes.keys()], [object.key], 'Exact native object set required.');
  const provided = objectBytes.get(object.key)!, bytes = typeof provided === 'string' ? Buffer.from(provided) : provided;
  assert.equal(bytes.length, object.bytes, 'Native byte length differs.'); assert.equal(createHash('sha256').update(bytes).digest('hex'), object.sha256, 'Native raw checksum differs.');
  const rows: NativeRow[] = [], offsets: number[] = []; let stage: AmazonPqaReleaseParseErrorV2['stage'] = 'invalid_utf8', failing: unknown, attempts = 0;
  const base = object.range?.start ?? 0;
  const fragment = (start: number, end: number, quarantine: AmazonPqaReleaseFragmentV2['quarantine']): AmazonPqaReleaseFragmentV2 | null => start === end ? null : ({ start: base + start, endExclusive: base + end, bytes: end - start, sha256: createHash('sha256').update(bytes.subarray(start, end)).digest('hex'), quarantine });
  let leading: AmazonPqaReleaseFragmentV2 | null = null, trailing: AmazonPqaReleaseFragmentV2 | null = null, tail: AmazonPqaReleaseFragmentV2 | null = null;
  const decode = (slice: Buffer, start: number) => {
    attempts++;
    stage = 'invalid_utf8'; const raw = new TextDecoder('utf-8', { fatal: true }).decode(slice); stage = 'strict_schema_rejected';
    try { failing = JSON.parse(raw); } catch { failing = undefined; }
    const row = decodeNative(raw); rows.push(row); offsets.push(base + start); failing = undefined;
  };
  try {
    if (sourcePin.schemaId.endsWith('-jsonl')) {
      let offset = 0;
      if (base > 0) { const newline = bytes.indexOf(10); const end = newline === -1 ? bytes.length : newline + 1; leading = fragment(0, end, 'incomplete_transport_row'); offset = end; }
      while (offset < bytes.length && rows.length < maximumRows) {
        const newline = bytes.indexOf(10, offset);
        if (newline === -1 && object.range !== null) { trailing = fragment(offset, bytes.length, 'incomplete_transport_row'); offset = bytes.length; break; }
        const end = newline === -1 ? bytes.length : newline; decode(bytes.subarray(offset, end), offset); offset = newline === -1 ? end : end + 1;
      }
      if (offset < bytes.length) tail = fragment(offset, bytes.length, 'unparsed_tail');
    } else {
      stage = 'invalid_utf8'; const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: object.range !== null }); let offset = 0;
      const ws = () => { while (offset < raw.length && /\s/.test(raw[offset])) offset++; };
      stage = 'unsupported_envelope'; ws(); assert.equal(raw[offset++], '['); ws();
      while (offset < raw.length && raw[offset] !== ']' && rows.length < maximumRows) {
        stage = 'strict_schema_rejected'; assert.equal(raw[offset], '{'); const start = offset; let depth = 0, quoted = false, escaped = false;
        for (; offset < raw.length; offset++) { const c = raw[offset]; if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; } else if (c === '"') quoted = true; else if (c === '{' || c === '[') depth++; else if (c === '}' || c === ']') { depth--; if (depth === 0) { offset++; break; } } }
        const byteStart = Buffer.byteLength(raw.slice(0, start));
        if (depth !== 0 && object.range !== null && offset === raw.length) { trailing = fragment(byteStart, bytes.length, 'incomplete_transport_row'); break; }
        assert.equal(depth, 0); decode(Buffer.from(raw.slice(start, offset)), byteStart); ws();
        if (offset === raw.length && object.range !== null) break;
        assert.ok(raw[offset] === ',' || raw[offset] === ']'); if (raw[offset] === ',') { offset++; ws(); assert.notEqual(raw[offset], ']'); } else break;
      }
      if (rows.length === maximumRows && raw[offset] !== ']' && offset < raw.length) tail = fragment(Buffer.byteLength(raw.slice(0, offset)), bytes.length, 'unparsed_tail');
      else if (!trailing && !(offset === raw.length && object.range !== null)) { assert.equal(raw[offset++], ']'); ws(); assert.equal(offset, raw.length); }
    }
  } catch {
    const failure = recognizedFailureExposure([...rows, ...(failing === undefined ? [] : [failing])]);
    throw new AmazonPqaReleaseParseErrorV2(seal(sourcePin), attempts, rows.length, failure.exposure, stage, failure.normalization, failure.withheldAggregateFingerprints);
  }
  const pinHash = seal(sourcePin), records = rows.map((row, i): AmazonPqaRecord => {
    const id = (field: string, answer?: number) => `apqa-v2-${textHash(JSON.stringify([pinHash, offsets[i], row.asin, field, answer ?? null])).slice(0, 24)}`;
    const sources: AmazonPqaRecord['sources'] = [];
    for (const field of ['product_description', 'bullet_point1', 'bullet_point2', 'bullet_point3', 'bullet_point4', 'bullet_point5'] as const) if (row[field].trim()) sources.push({ id: id(field), productId: row.asin, kind: field === 'product_description' ? 'product_description' : 'product_feature', text: row[field], originalQuestion: null, reference: `${object.key}#byte=${offsets[i]};field=${field}` });
    row.answers.forEach((answer, a) => { if (answer.answer_text.trim() && row.question_text.trim()) sources.push({ id: id('answer_text', a), productId: row.asin, kind: 'customer_qa', text: answer.answer_text, originalQuestion: row.question_text, reference: `${object.key}#byte=${offsets[i]};question_id=${encodeURIComponent(row.question_id)};answer=${a}` }); });
    return { row: i + 1, product: { id: row.asin, title: row.item_name, family: row.brand_name.trim() ? `${row.brand_name} ${row.item_name}` : null, modelIdentifiers: [] }, target: { id: row.question_id, question: row.question_text, answer: row.answers[0]?.answer_text ?? '' }, sources };
  });
  return { records, targetTaints: rows.map((r, i) => ({ row: i + 1, answers: r.answers.map(a => a.answer_text), aggregate: r.answer_aggregated })), inspection: { format: 'ablatrix-amazon-pqa-release-inspection-v2', sourcePinSha256: pinHash, completeRows: rows.length, physicalRowOffsets: offsets, skippedInitialPartialLine: leading !== null, ignoredTrailingPartialLine: trailing !== null, leadingFragment: leading, trailingFragment: trailing, unparsedTail: tail, completePrefixCoverage: tail === null, freshness: 'not_established', providerCalls: 0 } };
}

export function projectAmazonPqaReleaseExposureV2(parsed: AmazonPqaReleaseParseV2) {
  assert.equal(parsed.records.length, parsed.targetTaints.length); const byRow = new Map(parsed.targetTaints.map(t => [t.row, t]));
  const values = parsed.records.flatMap(r => [r.product.title, r.product.family ?? '', r.target.question, r.target.answer, ...r.sources.flatMap(s => [s.text, s.originalQuestion ?? '']), ...(byRow.get(r.row)?.answers ?? []), byRow.get(r.row)?.aggregate ?? '']);
  const canonical = canonicalAmazonPqaTextsV1(values), norm = (s: string) => canonical.get(s)!, body = (s: string) => textHash(JSON.stringify([norm(s)])); const consumedExposure = emptyExposure();
  const rowExposures = parsed.records.map(r => { const t = byRow.get(r.row)!; assert.ok(t); const e = emptyExposure();
    e.productIds = [...new Set([r.product.id, ...r.sources.map(s => s.productId)])].sort(); e.canonicalFamilyTitles = [family(norm(r.product.title)), ...(r.product.family ? [family(norm(r.product.family))] : [])].filter(Boolean);
    e.modelIdentifiers = models([r.product.title, r.product.family ?? '', r.target.question, ...t.answers, ...r.sources.flatMap(s => [s.text, s.originalQuestion ?? ''])].map(norm).join(' '));
    e.sourceBodyFingerprints = [...new Set([...r.sources.map(s => s.text), ...t.answers].filter(s => norm(s)).map(body))].sort();
    e.sourcePacketFingerprints = [...new Set(r.sources.flatMap(s => [textHash(JSON.stringify([norm(s.text), norm(s.originalQuestion ?? '')])), textHash(JSON.stringify([s.text.trim().toLowerCase().replace(/\s+/g, ' '), (s.originalQuestion ?? '').trim().toLowerCase().replace(/\s+/g, ' ')]))]))].sort();
    e.targetQuestionFingerprints = norm(r.target.question) ? [body(r.target.question)] : []; e.targetAnswerFingerprints = [...new Set(t.answers.filter(s => norm(s)).map(body))].sort(); mergeExposure(consumedExposure, e); return e;
  });
  const withheldAggregateFingerprints = [...new Set(parsed.targetTaints.map(t => t.aggregate).filter(s => norm(s)).map(body))].sort();
  return { consumedExposure, rowExposures, withheldAggregateFingerprints, normalization: canonical.normalization, canonical };
}

export function screenAmazonPqaReleaseV2(input: { sourcePin: AmazonPqaReleasePinV2; parsed: AmazonPqaReleaseParseV2; policy: AmazonPqaScreeningPolicy; history: AmazonPqaExposureHistory; mode: 'exposed_development_replay' | 'prospective_source_screening' }) {
  const { sourcePin, parsed, policy, history, mode } = input; validateAmazonPqaReleasePinV2(sourcePin); assert.ok(['exposed_development_replay', 'prospective_source_screening'].includes(mode)); assert.equal(parsed.inspection.sourcePinSha256, seal(sourcePin)); assert.equal(parsed.records.length, parsed.inspection.completeRows);
  const exposure = projectAmazonPqaReleaseExposureV2(parsed); if (history.normalization) { assert.equal(history.normalization.pythonVersion, exposure.normalization.pythonVersion); assert.equal(history.normalization.unicodeVersion, exposure.normalization.unicodeVersion); } else assert.equal(sourcePin.provenance, 'synthetic_fixture');
  const guardPin = projectAmazonPqaReleaseGuardPinV2(sourcePin), projection = { contract: 'native_v2_to_frozen_v1_calculation_only' as const, nativeSourcePinSha256: seal(sourcePin), guardPinSha256: seal(guardPin), nativeSchemaClaim: false as const };
  if (mode === 'exposed_development_replay') {
    const decisions: AmazonPqaScreening['decisions'] = parsed.records.map((r, i) => ({ caseId: `apqa-v2-case-${textHash(JSON.stringify([seal(sourcePin), parsed.inspection.physicalRowOffsets[i], r.product.id, r.target.id])).slice(0, 24)}`, row: r.row, productId: r.product.id, eligible: false, reasons: ['previously_exposed_development_only'], packet: null, exposure: exposure.rowExposures[i], targetAnswerWithheld: true, excludedParents: [], familySeparation: 'requires_independent_source_review' }));
    const result = { format: 'ablatrix-amazon-pqa-release-screening-v2' as const, sourcePinSha256: seal(sourcePin), policySha256: seal(policy), historySha256: seal(history), screeningDenominator: decisions.length, acceptedCaseIds: [] as string[], decisions, consumedExposure: exposure.consumedExposure, withheldAggregateFingerprints: exposure.withheldAggregateFingerprints, normalization: exposure.normalization, inspection: parsed.inspection, guardProjection: projection, mode, stopReason: 'exposed_development_only' as const,
      provenance: 'source_only_exploratory' as const, sourceProvenance: sourcePin.provenance, candidateContextInspected: false as const, generatedAnswersInspected: false as const, providerCalls: 0 as const, humanSourceCheckedAnswers: 0 as const, qualityClaimEligible: false as const, activationAuthorized: false as const, paidExecutionAuthorized: false as const };
    return { ...result, screeningSha256: seal(result) };
  }
  assert.ok(parsed.records.length > 0 && parsed.records.length <= 10_000, 'Native prospective prefix must fit the frozen finite guard bound.');
  const guard = screenAmazonPqaSourceV1({ sourcePin: guardPin, records: parsed.records, policy: { ...policy, targetPackets: policy.maxInspectedRecords }, history });
  const norm = (s: string) => exposure.canonical.get(s)!, key = (s: string) => norm(s).replace(/[^\p{L}\p{N}]/gu, ''); let accepted = 0;
  
  const decisions = guard.decisions.map((saved, i) => {
    const decision = structuredClone(saved), record = parsed.records[i]; mergeExposure(decision.exposure, exposure.rowExposures[i]);
    // The aggregate field is withheld as an annotation. Its VALUE cannot alter
    // source selection, freshness or eligibility. Genuine answers remain taints.
    const equivalents = parsed.records.filter(r => r.product.id === record.product.id && (r.target.id === record.target.id || key(r.target.question) === key(record.target.question)));
    const taints = new Set(equivalents.flatMap(r => parsed.targetTaints[r.row - 1].answers.map(key).filter(Boolean)));
    if (decision.packet) {
      decision.packet.sources = decision.packet.sources.filter(s => {
        if (![...taints].some(t => key(s.text).includes(t))) return true;
        decision.excludedParents.push({ sourceId: s.id, reason: 'native_target_answer_text_in_parent', bodySha256: textHash(JSON.stringify([norm(s.text)])), scopedSha256: textHash(JSON.stringify([norm(s.text), norm(s.originalQuestion ?? '')])) }); return false;
      });
      if (!decision.packet.sources.length) decision.reasons.push('no_target_free_source_parents');
      decision.packet.sourcePoolSha256 = textHash(JSON.stringify(decision.packet.sources));
    }
    if (decision.packet && !decision.reasons.length && accepted >= policy.targetPackets) decision.reasons.push('fixed_pool_capacity_reached');
    decision.eligible = !!decision.packet && decision.reasons.length === 0;
    if (!decision.eligible) decision.packet = null; else accepted++;
    return decision;
  });
  const { screeningSha256: _old, ...base } = guard; const result = { ...base, format: 'ablatrix-amazon-pqa-release-screening-v2' as const, sourcePinSha256: seal(sourcePin), policySha256: seal(policy), decisions, acceptedCaseIds: decisions.filter(d => d.eligible).map(d => d.caseId), consumedExposure: exposure.consumedExposure, withheldAggregateFingerprints: exposure.withheldAggregateFingerprints, normalization: exposure.normalization,
    inspection: parsed.inspection, guardProjection: projection, mode, stopReason: accepted < policy.targetPackets ? 'finite_prefix_shortfall' as const : 'source_review_required' as const };
  return { ...result, screeningSha256: seal(result) };
}

/** Hash-only boundary projection. Fragment identities are claimed only from
 * explicit complete native key/string pairs. An unknown ASIN or family remains
 * unresolved; neither a fragment nor its reconstructed guess can qualify. */
export function projectAmazonPqaReleaseFragmentsV2(sourcePin: AmazonPqaReleasePinV2, objectBytes: Map<string, Buffer | string>, parsed: AmazonPqaReleaseParseV2) {
  validateAmazonPqaReleasePinV2(sourcePin); assert.equal(parsed.inspection.sourcePinSha256, seal(sourcePin));
  const object = sourcePin.objects[0], supplied = objectBytes.get(object.key); assert.ok(supplied !== undefined); const bytes = typeof supplied === 'string' ? Buffer.from(supplied) : supplied;
  assert.equal(bytes.length, object.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), object.sha256);
  const base = object.range?.start ?? 0, fullProducts = new Map(parsed.records.filter(r => r.product.title.trim()).map(r => [r.product.id, r.product.title]));
  const project = (fragment: AmazonPqaReleaseFragmentV2 | null) => {
    if (!fragment) return null;
    const raw = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(fragment.start - base, fragment.endExclusive - base));
    const recognized: Record<string, string> = {}, answers: { answer_text: string }[] = [], duplicates = new Set<string>(), variants: Record<string, string>[] = [];
    // Escaped quotes inside JSON strings cannot start this boundary pattern.
    const pair = /(?:^|[,{])\s*"(asin|question_id|question_text|bullet_point[1-5]|product_description|brand_name|item_name|answer_aggregated|answer_text)"\s*:\s*("(?:\\.|[^"\\])*")/g;
    for (const match of raw.matchAll(pair)) { try { const value: unknown = JSON.parse(match[2]); literal(value); if (match[1] === 'answer_text') answers.push({ answer_text: value }); else if (!(match[1] in recognized)) recognized[match[1]] = value; else { duplicates.add(match[1]); variants.push({ [match[1]]: value }); } } catch { /* Incomplete fields stay quarantined. */ } }
    const row = { ...recognized, answers }; const result = recognizedFailureExposure([row, ...variants.map(v => ({ ...recognized, ...v, answers }))]);
    const productIds = result.exposure.productIds;
    const unknownFamilyProductIds = productIds.filter(id => !fullProducts.has(id) && !recognized.item_name?.trim());
    return { ...fragment, recognizedProductIds: productIds, unknownFamilyProductIds, recognizedNativeFieldCount: Object.keys(recognized).length + answers.length,
      consumedExposure: result.exposure, withheldAggregateFingerprints: result.withheldAggregateFingerprints,
      ambiguousFields: [...duplicates].sort(), bodyExposureComplete: false as const,
      unresolved: productIds.length === 0 || unknownFamilyProductIds.length > 0 || duplicates.size > 0 };
  };
  const leading = project(parsed.inspection.leadingFragment), trailing = project(parsed.inspection.trailingFragment), consumedExposure = emptyExposure();
  if (leading) mergeExposure(consumedExposure, leading.consumedExposure); if (trailing) mergeExposure(consumedExposure, trailing.consumedExposure);
  return { format: 'ablatrix-amazon-pqa-release-fragments-v2' as const, sourcePinSha256: seal(sourcePin), leading, trailing, consumedExposure,
    withheldAggregateFingerprints: [...new Set([...(leading?.withheldAggregateFingerprints ?? []), ...(trailing?.withheldAggregateFingerprints ?? [])])].sort(),
    allFragmentsQuarantined: true as const, unresolvedBoundary: !!leading?.unresolved || !!trailing?.unresolved,
    completeRowsMapped: parsed.inspection.completePrefixCoverage, providerCalls: 0 as const, qualityClaimEligible: false as const };
}

/** Reconstruct exactly one quarantined cross-frame row for exclusion only.
 * Both fixed frames must already be committed; no bytes are fetched here. */
export function projectAmazonPqaReleaseBoundaryV2(prior: { sourcePin: AmazonPqaReleasePinV2; objects: Map<string, Buffer | string>; parsed: AmazonPqaReleaseParseV2 }, current: { sourcePin: AmazonPqaReleasePinV2; objects: Map<string, Buffer | string> }) {
  const bytesFor = (part: { sourcePin: AmazonPqaReleasePinV2; objects: Map<string, Buffer | string> }) => { validateAmazonPqaReleasePinV2(part.sourcePin); const object = part.sourcePin.objects[0]; const input = part.objects.get(object.key); assert.ok(input !== undefined); const bytes = typeof input === 'string' ? Buffer.from(input) : input; assert.equal(bytes.length, object.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), object.sha256); return { object, bytes }; };
  assert.equal(prior.parsed.inspection.sourcePinSha256, seal(prior.sourcePin));
  const previous = bytesFor(prior), next = bytesFor(current);
  assert.ok(prior.sourcePin.schemaId.endsWith('-jsonl') && current.sourcePin.schemaId.endsWith('-jsonl'), 'Cross-frame reconstruction supports the frozen JSONL schema only.');
  assert.equal(previous.object.key, next.object.key); assert.equal(previous.object.versionId, next.object.versionId); assert.ok(previous.object.versionId || prior.sourcePin.provenance === 'synthetic_fixture'); assert.equal(previous.object.sourceBytes, next.object.sourceBytes);
  assert.ok(previous.object.range && next.object.range); assert.equal(previous.object.range.endInclusive + 1, next.object.range.start, 'Only adjacent committed source frames can reconstruct a boundary.');
  const trailing = prior.parsed.inspection.trailingFragment;
  assert.ok(trailing && trailing.bytes > 0, 'Boundary repair requires a real incomplete old row.');
  assert.equal(trailing.endExclusive, next.object.range.start);
  assert.ok(trailing.start >= previous.object.range.start && trailing.start < trailing.endExclusive);
  assert.equal(trailing.bytes, trailing.endExclusive - trailing.start);
  assert.equal(createHash('sha256').update(previous.bytes.subarray(trailing.start - previous.object.range.start)).digest('hex'), trailing.sha256);
  // Locate only the next physical delimiter in opaque bytes. No fresh complete
  // row after it is decoded or required to reconstruct the old boundary.
  const newline = next.bytes.indexOf(10), leadingEnd = newline === -1 ? next.bytes.length : newline + 1;
  const leading = { start: next.object.range.start, endExclusive: next.object.range.start + leadingEnd, sha256: createHash('sha256').update(next.bytes.subarray(0, leadingEnd)).digest('hex') };
  assert.equal(leading.start, next.object.range.start);
  const reconstructed = Buffer.concat([previous.bytes.subarray(trailing.start - previous.object.range.start), next.bytes.subarray(0, leading.endExclusive - next.object.range.start)]);
  const commitment = { format: 'ablatrix-amazon-pqa-release-boundary-v2' as const, priorSourcePinSha256: seal(prior.sourcePin), currentSourcePinSha256: seal(current.sourcePin), priorFragmentSha256: trailing?.sha256 ?? null, currentFragmentSha256: leading.sha256, reconstructedRowSha256: createHash('sha256').update(reconstructed).digest('hex'), reconstructedBytes: reconstructed.length, boundaryNeverSelectable: true as const, eligiblePackets: 0 as const, providerCalls: 0 as const, qualityClaimEligible: false as const };
  try {
    assert.ok(newline !== -1, 'The fixed current frame does not complete its quarantined boundary row.');
    const row = decodeNative(new TextDecoder('utf-8', { fatal: true }).decode(reconstructed)); const mapped = recognizedFailureExposure([row]);
    return { ...commitment, resolved: true as const, bodyExposureComplete: true as const, consumedExposure: mapped.exposure, withheldAggregateFingerprints: mapped.withheldAggregateFingerprints, normalization: mapped.normalization };
  } catch {
    return { ...commitment, resolved: false as const, bodyExposureComplete: false as const, consumedExposure: emptyExposure(), withheldAggregateFingerprints: [] as string[], stopReason: 'quarantined_boundary_native_schema_unresolved' as const };
  }
}
