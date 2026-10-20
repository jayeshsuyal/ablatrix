/** Bounded, source-only Amazon-PQA adapter. No provider, transport or quality labels. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { textHash } from './product-corpus.ts';

export type AmazonPqaSourcePin = {
  format: 'ablatrix-amazon-pqa-source-pin-v1'; dataset: 'Amazon-PQA'; split: 'unpartitioned';
  schemaId: 'amazon-pqa-official-fields-v1-json-array' | 'amazon-pqa-official-fields-v1-jsonl';
  provenance: 'publisher_dataset' | 'synthetic_fixture';
  objects: { role: 'category_records'; key: string; versionId: string | null; sha256: string; bytes: number; sourceBytes: number; range: { start: 0; endInclusive: number } | null }[];
};
export type AmazonPqaSource = { id: string; productId: string; kind: 'product_description' | 'product_feature' | 'customer_qa'; text: string; originalQuestion: string | null; reference: string };
export type AmazonPqaRecord = {
  row: number; product: { id: string; title: string; family: string | null; modelIdentifiers: string[] };
  target: { id: string; question: string; answer: string }; sources: AmazonPqaSource[];
};
export type AmazonPqaScreeningPolicy = { maxInspectedRecords: number; targetPackets: number; maxParents: number; maxBodyUtf16Units: number; maxQuestionUtf16Units: number; maxTitleUtf16Units: number };
export type AmazonPqaExposureHistory = { productIds: string[]; canonicalFamilyTitles: string[]; modelIdentifiers: string[]; sourceBodyFingerprints: string[]; sourcePacketFingerprints: string[];
  normalization?: { id: 'python_nfkc_casefold_whitespace_v1'; pythonVersion: string; unicodeVersion: string }; [metadata: string]: unknown };
export type AmazonPqaPacket = { id: string; product: { id: string; title: string }; question: string; sources: { id: string; label: string; text: string; originalQuestion: string | null; reference: string; sha256: string }[]; sourcePoolSha256: string };
export type AmazonPqaExposure = Pick<AmazonPqaExposureHistory, 'productIds' | 'canonicalFamilyTitles' | 'modelIdentifiers' | 'sourceBodyFingerprints' | 'sourcePacketFingerprints'> & { targetQuestionFingerprints: string[]; targetAnswerFingerprints: string[] };
export type AmazonPqaScreening = {
  format: 'ablatrix-amazon-pqa-screening-v1'; sourcePinSha256: string; policySha256: string; historySha256: string;
  screeningDenominator: number; acceptedCaseIds: string[];
  decisions: { caseId: string; row: number; productId: string; eligible: boolean; reasons: string[]; packet: AmazonPqaPacket | null; exposure: AmazonPqaExposure;
    targetAnswerWithheld: true; excludedParents: { sourceId: string; reason: string; bodySha256: string; scopedSha256: string }[]; familySeparation: 'requires_independent_source_review' }[];
  consumedExposure: AmazonPqaExposure; stopReason: 'source_review_required' | 'finite_prefix_shortfall';
  normalization: { algorithm: 'python_nfkc_casefold_v1'; pythonVersion: string; unicodeVersion: string };
  provenance: 'source_only_exploratory'; sourceProvenance: AmazonPqaSourcePin['provenance']; candidateContextInspected: false; generatedAnswersInspected: false;
  providerCalls: 0; humanSourceCheckedAnswers: 0; qualityClaimEligible: false; activationAuthorized: false; paidExecutionAuthorized: false; screeningSha256: string;
};

const DIGEST = /^[a-f0-9]{64}$/;
const MAX_BYTES = 64 * 1024 * 1024;
const seal = (value: unknown): string => {
  const ordered = (v: any): any => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])])) : v;
  return textHash(JSON.stringify(ordered(value)));
};
function keys(value: unknown, expected: string[], label: string): asserts value is Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label}: object required`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label}: strict schema`);
}
function text(value: unknown, label: string): asserts value is string {
  assert.equal(typeof value, 'string', `${label}: string required`);
  assert.ok(!(value as string).includes('\0') && [...value as string].every(c => c.codePointAt(0)! < 0xd800 || c.codePointAt(0)! > 0xdfff), `${label}: literal Unicode text required`);
}
function strings(value: unknown, label: string): asserts value is string[] {
  assert.ok(Array.isArray(value), `${label}: array required`); for (const item of value) text(item, label);
}
function integer(value: unknown, minimum: number, maximum: number, label: string): asserts value is number {
  assert.ok(Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum, `${label}: finite bound required`);
}
export function validateAmazonPqaSourcePinV1(value: unknown): asserts value is AmazonPqaSourcePin {
  keys(value, ['format', 'dataset', 'split', 'schemaId', 'provenance', 'objects'], 'source pin');
  assert.equal(value.format, 'ablatrix-amazon-pqa-source-pin-v1'); assert.equal(value.dataset, 'Amazon-PQA'); assert.equal(value.split, 'unpartitioned');
  assert.ok(['amazon-pqa-official-fields-v1-json-array', 'amazon-pqa-official-fields-v1-jsonl'].includes(String(value.schemaId)), 'unsupported_schema');
  assert.ok(['publisher_dataset', 'synthetic_fixture'].includes(String(value.provenance)));
  assert.ok(Array.isArray(value.objects) && value.objects.length === 1, 'Exactly one finite category object must be frozen.');
  for (const item of value.objects) {
    keys(item, ['role', 'key', 'versionId', 'sha256', 'bytes', 'sourceBytes', 'range'], 'source object'); assert.equal(item.role, 'category_records');
    text(item.key, 'object key'); assert.ok(item.key.length > 0 && item.key.length <= 1024 && !item.key.startsWith('/') && !item.key.includes('\\') && !item.key.split('/').some((p: string) => !p || p === '.' || p === '..'));
    assert.ok(item.versionId === null || typeof item.versionId === 'string' && item.versionId.length > 0 && item.versionId.length <= 1024);
    assert.ok(typeof item.sha256 === 'string' && DIGEST.test(item.sha256)); integer(item.bytes, 1, MAX_BYTES, 'source bytes');
    integer(item.sourceBytes, item.bytes, Number.MAX_SAFE_INTEGER, 'full source bytes');
    if (item.range === null) assert.equal(item.sourceBytes, item.bytes, 'Whole object byte length must match.');
    else { keys(item.range, ['start', 'endInclusive'], 'source range'); assert.equal(item.range.start, 0); integer(item.range.endInclusive, 0, MAX_BYTES - 1, 'source range end'); assert.equal(item.range.endInclusive + 1, item.bytes); assert.ok(item.bytes < item.sourceBytes, 'A prefix range must end before the full object.'); }
    if (value.provenance === 'publisher_dataset') assert.ok(typeof item.versionId === 'string' && item.versionId.length > 0, 'Publisher source requires an immutable version ID.');
  }
}

/** Python's NFKC + casefold is the historical fingerprint contract. Keeping the
 * fixed, bounded bridge avoids silently substituting JavaScript lowercasing.
 * Input is JSON on stdin, never code or arguments; no files or network are used. */
export function canonicalAmazonPqaTextsV1(values: string[]): Map<string, string> & { normalization: AmazonPqaScreening['normalization'] } {
  strings(values, 'canonicalization batch');
  const distinct = [...new Set(values)];
  assert.ok(distinct.length <= 100_000 && distinct.reduce((n, v) => n + Buffer.byteLength(v), 0) <= MAX_BYTES, 'Canonicalization batch exceeds finite bound.');
  const code = 'import json,sys,unicodedata,platform\nvalues=json.load(sys.stdin)\njson.dump({"pythonVersion":platform.python_version(),"unicodeVersion":unicodedata.unidata_version,"values":[" ".join(unicodedata.normalize("NFKC",v).casefold().split()) for v in values]},sys.stdout,ensure_ascii=False,separators=(",",":"))\n';
  const result = spawnSync('python3', ['-I', '-c', code], { input: JSON.stringify(distinct), encoding: 'utf8', env: { PATH: process.env.PATH ?? '' }, timeout: 30_000, maxBuffer: 4 * MAX_BYTES });
  assert.ok(!result.error && result.status === 0, 'Canonical Python normalization unavailable; screening stopped.');
  const output: unknown = JSON.parse(result.stdout); keys(output, ['pythonVersion', 'unicodeVersion', 'values'], 'canonicalization result'); strings(output.values, 'canonicalization values'); assert.equal(output.values.length, distinct.length); text(output.pythonVersion, 'Python version'); text(output.unicodeVersion, 'Unicode version');
  const normalized = output.values;
  return Object.assign(new Map(distinct.map((v, i) => [v, normalized[i]])), { normalization: { algorithm: 'python_nfkc_casefold_v1' as const, pythonVersion: output.pythonVersion, unicodeVersion: output.unicodeVersion } });
}

const RAW_FIELDS = ['question_id', 'question_text', 'answer_text', 'asin_id', 'bullet_points', 'product_description', 'brand_name', 'item_name', 'is_yes-no_question', 'yes-no_answer'];
type RawRow = { question_id: string; question_text: string; answer_text: string; asin_id: string; bullet_points: string; product_description: string; brand_name: string; item_name: string };
function fieldBody(value: unknown, label: string): string {
  if (value === null) return '';
  if (Array.isArray(value)) { strings(value, label); return value.join('\n'); }
  text(value, label); return value;
}
function rawRow(value: unknown): RawRow {
  keys(value, RAW_FIELDS, 'Amazon-PQA row');
  assert.ok(typeof value.question_id === 'string' && value.question_id.trim() || typeof value.question_id === 'number' && Number.isSafeInteger(value.question_id), 'Question ID must be a nonempty string or finite integer.');
  if (typeof value.question_id === 'string') text(value.question_id, 'question id');
  for (const key of ['question_text', 'answer_text', 'asin_id']) text(value[key], key);
  assert.ok(/^[A-Z0-9]{10}$/.test(value.asin_id as string), 'ASIN must be explicit and canonical.');
  for (const key of ['is_yes-no_question', 'yes-no_answer']) assert.ok(value[key] === null || ['string', 'boolean', 'number'].includes(typeof value[key]) && (typeof value[key] !== 'number' || Number.isFinite(value[key])), 'Prediction labels must be scalar; they are discarded.');
  return { question_id: String(value.question_id), question_text: value.question_text as string, answer_text: value.answer_text as string, asin_id: value.asin_id as string,
    bullet_points: fieldBody(value.bullet_points, 'bullet_points'), product_description: fieldBody(value.product_description, 'product_description'),
    brand_name: fieldBody(value.brand_name, 'brand_name'), item_name: fieldBody(value.item_name, 'item_name') };
}
/** Detect duplicate top-level keys before JSON.parse can overwrite one. */
function parseRowJson(raw: string): RawRow {
  let depth = 0, quoted = false, escaped = false, start = 0, keyString = false, expectsKey = false;
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') { quoted = false; if (keyString) { const key = JSON.parse(raw.slice(start, i + 1)); assert.ok(!seen.has(key), 'Duplicate JSON row field.'); seen.add(key); keyString = false; } }
    } else if (c === '"') { quoted = true; start = i; keyString = depth === 1 && expectsKey; }
    else if (c === '{' || c === '[') { depth++; if (depth === 1) expectsKey = true; }
    else if (c === '}' || c === ']') depth--;
    else if (c === ':' && depth === 1) expectsKey = false;
    else if (c === ',' && depth === 1) expectsKey = true;
  }
  return rawRow(JSON.parse(raw));
}

/** A failed strict parse is still exposure. Only commitments and recognized
 * source-field projections escape the failure path; no raw strings or errors. */
export class AmazonPqaParseError extends Error {
  readonly sourcePinSha256: string;
  readonly wholePrefixConsumed = true;
  readonly eligiblePackets = 0;
  readonly providerCalls = 0;
  readonly qualityClaimEligible = false;
  constructor(sourcePin: AmazonPqaSourcePin, readonly inspectedRows: number, readonly validDecodedRows: number,
    readonly consumedExposure: AmazonPqaExposure, readonly stage: 'invalid_utf8' | 'unsupported_envelope' | 'strict_schema_rejected',
    readonly normalization: AmazonPqaScreening['normalization']) {
    super(`Amazon-PQA ${stage}; whole pinned prefix consumed.`); this.name = 'AmazonPqaParseError'; this.sourcePinSha256 = seal(sourcePin);
  }
}
function failedRecognizedExposure(values: unknown[]): { exposure: AmazonPqaExposure; normalization: AmazonPqaScreening['normalization'] } {
  const recognized = values.map(value => {
    const object = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const field = (key: string) => { const v = object[key]; return typeof v === 'string' ? v : Array.isArray(v) && v.every(s => typeof s === 'string') ? v.join('\n') : ''; };
    return { asin: field('asin_id'), title: field('item_name'), brand: field('brand_name'), question: field('question_text'), answer: field('answer_text'), description: field('product_description'), bullets: field('bullet_points') };
  });
  const safe = (s: string) => !s.includes('\0') && [...s].every(c => c.codePointAt(0)! < 0xd800 || c.codePointAt(0)! > 0xdfff);
  const all = recognized.flatMap(v => Object.values(v)).filter(safe), canonical = canonicalAmazonPqaTextsV1(all), exposure = emptyExposure();
  const norm = (s: string) => canonical.get(s) ?? '', body = (s: string) => textHash(JSON.stringify([norm(s)]));
  for (const value of recognized) {
    if (/^[A-Z0-9]{10}$/.test(value.asin)) exposure.productIds.push(value.asin);
    for (const title of [value.title, value.brand && value.title ? `${value.brand} ${value.title}` : '']) if (title && safe(title)) {
      const parts = title === value.title ? norm(title) : `${norm(value.brand)} ${norm(value.title)}`; exposure.canonicalFamilyTitles.push(canonicalFamily(parts));
    }
    exposure.modelIdentifiers.push(...modelIds(Object.values(value).filter(safe).map(norm).join(' ')));
    for (const source of [value.answer, value.description, value.bullets]) if (safe(source) && norm(source)) exposure.sourceBodyFingerprints.push(body(source));
    if (safe(value.answer) && safe(value.question) && norm(value.answer)) exposure.sourcePacketFingerprints.push(textHash(JSON.stringify([norm(value.answer), norm(value.question)])));
    for (const source of [value.description, value.bullets]) if (safe(source) && norm(source)) exposure.sourcePacketFingerprints.push(textHash(JSON.stringify([norm(source), ''])));
    if (safe(value.answer) && norm(value.answer)) exposure.targetAnswerFingerprints.push(body(value.answer));
    if (safe(value.question) && norm(value.question)) exposure.targetQuestionFingerprints.push(body(value.question));
  }
  for (const key of Object.keys(exposure) as (keyof AmazonPqaExposure)[]) exposure[key] = [...new Set(exposure[key])].sort();
  return { exposure, normalization: canonical.normalization };
}
/** Only the frozen prefix is decoded. Remaining bytes are checksum input, not a
 * silently inspected candidate tail. Neither envelope nor field shapes are inferred. */
export function parseAmazonPqaObjectsV1(sourcePin: AmazonPqaSourcePin, objectBytes: Map<string, Buffer | string>, maximumRows: number): AmazonPqaRecord[] {
  validateAmazonPqaSourcePinV1(sourcePin); integer(maximumRows, 1, 10_000, 'maximum rows');
  assert.deepEqual([...objectBytes.keys()].sort(), sourcePin.objects.map(o => o.key).sort(), 'Exact pinned object set required.');
  const object = sourcePin.objects[0], supplied = objectBytes.get(object.key)!;
  const bytes = typeof supplied === 'string' ? Buffer.from(supplied, 'utf8') : supplied;
  assert.equal(bytes.length, object.bytes, 'Source object byte count differs from pin.');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), object.sha256, 'Source object checksum differs from pin.');
  const rows: RawRow[] = [], inspectedRaw: string[] = [];
  let stage: AmazonPqaParseError['stage'] = 'invalid_utf8';
  try {
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: object.range !== null });
  stage = 'unsupported_envelope';
  const decode = (slice: string) => { inspectedRaw.push(slice); stage = 'strict_schema_rejected'; return parseRowJson(slice); };
  if (sourcePin.schemaId.endsWith('-jsonl')) {
    let offset = 0;
    while (offset < raw.length && rows.length < maximumRows) {
      const end = raw.indexOf('\n', offset), next = end === -1 ? raw.length : end;
      const line = raw.slice(offset, next); assert.ok(line.trim(), 'Blank JSONL rows are not an inferred format.');
      if (end === -1 && object.range !== null) break;
      rows.push(decode(line)); offset = next + 1;
    }
  } else {
    let offset = 0; const whitespace = () => { while (/\s/.test(raw[offset] ?? '') && offset < raw.length) offset++; };
    whitespace(); assert.equal(raw[offset++], '[', 'Pinned JSON array envelope required.'); whitespace();
    while (rows.length < maximumRows && raw[offset] !== ']' && offset < raw.length) {
      assert.equal(raw[offset], '{', 'Array rows must be objects.');
      const start = offset; let depth = 0, quoted = false, escaped = false;
      for (; offset < raw.length; offset++) {
        const c = raw[offset];
        if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
        else if (c === '"') quoted = true;
        else if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']') { depth--; if (depth === 0) { offset++; break; } }
      }
      if (depth !== 0 && object.range !== null && offset === raw.length) break;
      assert.equal(depth, 0, 'Incomplete source row.'); rows.push(decode(raw.slice(start, offset))); whitespace();
      if (offset === raw.length && object.range !== null) break;
      assert.ok(raw[offset] === ',' || raw[offset] === ']', 'Array row delimiter required.');
      if (raw[offset] === ',') { offset++; whitespace(); assert.notEqual(raw[offset], ']', 'Trailing array comma.'); }
      else break;
    }
    if ((rows.length < maximumRows || raw[offset] === ']') && !(object.range !== null && offset === raw.length)) { assert.equal(raw[offset++], ']'); whitespace(); assert.equal(offset, raw.length, 'Unexpected trailing source envelope.'); }
  }
  } catch {
    const recognized: unknown[] = [...rows];
    if (inspectedRaw.length > rows.length) { try { recognized.push(JSON.parse(inspectedRaw.at(-1)!)); } catch { /* Invalid JSON stays wholly consumed; no invented field mapping. */ } }
    const failed = failedRecognizedExposure(recognized);
    throw new AmazonPqaParseError(sourcePin, inspectedRaw.length, rows.length, failed.exposure, stage, failed.normalization);
  }
  const pinHash = seal(sourcePin);
  return rows.map((row, index) => {
    const id = (kind: string, sourceRow: number) => `apqa-${textHash(JSON.stringify([pinHash, row.asin_id, sourceRow, kind])).slice(0, 24)}`;
    const sources: AmazonPqaSource[] = [];
    for (const [kind, body] of [['product_description', row.product_description], ['product_feature', row.bullet_points]] as const) if (body.trim()) sources.push({ id: id(kind, index + 1), productId: row.asin_id, kind, text: body, originalQuestion: null, reference: `${object.key}#row=${index + 1};field=${kind === 'product_feature' ? 'bullet_points' : kind}` });
    // Keep every raw row once. Screening groups same-product customer answers
    // without constructing a quadratic all-targets/all-answers snapshot.
    if (row.answer_text.trim() && row.question_text.trim()) sources.push({ id: id('customer_qa', index + 1), productId: row.asin_id, kind: 'customer_qa', text: row.answer_text, originalQuestion: row.question_text, reference: `${object.key}#row=${index + 1};question_id=${encodeURIComponent(row.question_id)}` });
    return { row: index + 1, product: { id: row.asin_id, title: row.item_name, family: row.brand_name.trim() ? `${row.brand_name} ${row.item_name}` : null, modelIdentifiers: [] }, target: { id: row.question_id, question: row.question_text, answer: row.answer_text }, sources };
  });
}

const emptyExposure = (): AmazonPqaExposure => ({ productIds: [], canonicalFamilyTitles: [], modelIdentifiers: [], sourceBodyFingerprints: [], sourcePacketFingerprints: [], targetQuestionFingerprints: [], targetAnswerFingerprints: [] });
const unionExposure = (target: AmazonPqaExposure, other: AmazonPqaExposure) => { for (const key of Object.keys(target) as (keyof AmazonPqaExposure)[]) target[key] = [...new Set([...target[key], ...other[key]])].sort(); };
const canonicalFamily = (s: string) => s.replace(/^(?:(?:genuine|oem|original|authentic|official|new)\s+)+/, '');
function familyConflict(a: string, b: string): boolean {
  const brand = (s: string) => (s.split(' ')[0] ?? '').replace(/[^a-z0-9]/g, '').split('nutone')[0];
  const words = (s: string) => new Set((s.match(/[a-z0-9]+/g) ?? []).filter(w => w.length > 2));
  const x = words(a), y = words(b), shared = [...x].filter(w => y.has(w)).length;
  return !!a && !!b && (a === b || !!brand(a) && brand(a) === brand(b) || shared / Math.max(1, new Set([...x, ...y]).size) >= .45);
}
function modelIds(s: string): string[] {
  return [...new Set((s.match(/\b[a-z0-9]+(?:[-/][a-z0-9]+)*\b/g) ?? []).map(v => v.replace(/[^a-z0-9]/g, '')).filter(v => v.length >= 4 && /\d/.test(v) && !/^\d+(?:gal(?:lons?)?|g|oz|qt|pint|l|ml|cl|dl|yd|yards?|in|inch(?:es)?|ft|feet|cm|mm|xh|gbs|mbps|gbps|meters?|metres?|gb|tb|mah|watts?|volts?|amps?|w|v|a|cc|rpm|lbs?|grams?|kilograms?|colors?|packs?|pieces?|speed)$/.test(v) && !/^\d+x\d+$/.test(v) && (/[a-z]/.test(v) || v.length >= 5)))].sort();
}
function modelConflict(a: string[], b: string[]): boolean {
  return a.some(x => b.some(y => x === y || x.length >= 6 && y.length >= 6 && (x.slice(0, 6) === y.slice(0, 6) || x.length === y.length && [...x].filter((c, i) => c !== y[i]).length <= 1)));
}
function validateRecord(record: unknown): asserts record is AmazonPqaRecord {
  keys(record, ['row', 'product', 'target', 'sources'], 'normalized record'); integer(record.row, 1, 10_000, 'row');
  keys(record.product, ['id', 'title', 'family', 'modelIdentifiers'], 'product'); text(record.product.id, 'product id'); assert.match(record.product.id, /^[A-Z0-9]{10}$/); text(record.product.title, 'product title'); assert.ok(record.product.family === null || typeof record.product.family === 'string'); strings(record.product.modelIdentifiers, 'model identifiers');
  keys(record.target, ['id', 'question', 'answer'], 'target'); for (const key of ['id', 'question', 'answer']) text(record.target[key], `target ${key}`);
  assert.ok(Array.isArray(record.sources) && record.sources.length <= 20_002, 'Finite source parent count required.');
  for (const source of record.sources) {
    keys(source, ['id', 'productId', 'kind', 'text', 'originalQuestion', 'reference'], 'source'); for (const key of ['id', 'productId', 'text', 'reference']) text(source[key], `source ${key}`);
    assert.match(source.productId as string, /^[A-Z0-9]{10}$/); assert.ok(['product_description', 'product_feature', 'customer_qa'].includes(String(source.kind)));
    assert.ok(source.originalQuestion === null || typeof source.originalQuestion === 'string'); if (source.originalQuestion !== null) text(source.originalQuestion, 'original question');
    assert.equal(source.kind === 'customer_qa', source.originalQuestion !== null, 'Customer answers require exact original question scope.');
  }
  assert.equal(new Set(record.sources.map(s => s.id)).size, record.sources.length, 'Duplicate source IDs are not permitted.');
}

export function screenAmazonPqaSourceV1(input: { sourcePin: AmazonPqaSourcePin; records: AmazonPqaRecord[]; policy: AmazonPqaScreeningPolicy; history: AmazonPqaExposureHistory }): AmazonPqaScreening {
  keys(input, ['sourcePin', 'records', 'policy', 'history'], 'screen input'); const { sourcePin, records, policy, history } = input;
  validateAmazonPqaSourcePinV1(sourcePin); keys(policy, ['maxInspectedRecords', 'targetPackets', 'maxParents', 'maxBodyUtf16Units', 'maxQuestionUtf16Units', 'maxTitleUtf16Units'], 'screen policy');
  integer(policy.maxInspectedRecords, 1, 10_000, 'inspection limit'); integer(policy.targetPackets, 1, policy.maxInspectedRecords, 'target packets'); integer(policy.maxParents, 1, 128, 'source parent limit'); integer(policy.maxBodyUtf16Units, 1, 1500, 'source body limit'); integer(policy.maxQuestionUtf16Units, 1, 2000, 'question limit'); integer(policy.maxTitleUtf16Units, 1, 500, 'title limit');
  assert.ok(history && typeof history === 'object' && !Array.isArray(history), 'Historical exclusions require a bound object.');
  const historyKeys = ['productIds', 'canonicalFamilyTitles', 'modelIdentifiers', 'sourceBodyFingerprints', 'sourcePacketFingerprints'] as const;
  for (const key of historyKeys) { strings(history[key], `history ${key}`); assert.equal(new Set(history[key]).size, history[key].length, 'Historical exclusions cannot contain duplicate identities.'); }
  for (const key of ['sourceBodyFingerprints', 'sourcePacketFingerprints'] as const) assert.ok(history[key].every(v => DIGEST.test(v)), 'Historical fingerprints must be SHA256 values.');
  assert.ok(Array.isArray(records) && records.length > 0 && records.length <= policy.maxInspectedRecords, 'Only the finite inspected prefix is accepted.');
  records.forEach((r, i) => { validateRecord(r); assert.equal(r.row, i + 1, 'Fixed source row order must be consecutive from one.'); });
  const normalized = canonicalAmazonPqaTextsV1(records.flatMap(r => [r.product.title, r.product.family ?? '', ...r.product.modelIdentifiers, r.target.question, r.target.answer, ...r.sources.flatMap(s => [s.text, s.originalQuestion ?? ''])]));
  if (history.normalization !== undefined) {
    keys(history.normalization, ['id', 'pythonVersion', 'unicodeVersion'], 'historical normalization'); assert.equal(history.normalization.id, 'python_nfkc_casefold_whitespace_v1');
    assert.equal(history.normalization.pythonVersion, normalized.normalization.pythonVersion, 'Historical Python normalization version differs.'); assert.equal(history.normalization.unicodeVersion, normalized.normalization.unicodeVersion, 'Historical Unicode normalization version differs.');
  } else assert.equal(sourcePin.provenance, 'synthetic_fixture', 'Publisher screening requires exact historical normalization versions.');
  const norm = (s: string) => { const v = normalized.get(s); assert.notEqual(v, undefined, 'Only bound source text may be normalized.'); return v!; };
  // Exclusion is deliberately conservative: punctuation/spacing variants of a
  // target must not re-enter as a differently formatted customer answer.
  const targetKey = (s: string) => norm(s).replace(/[^\p{L}\p{N}]/gu, '');
  const protectedExposure: AmazonPqaExposure = { ...Object.fromEntries(historyKeys.map(key => [key, [...history[key]]])) as Pick<AmazonPqaExposure, typeof historyKeys[number]>, targetQuestionFingerprints: [], targetAnswerFingerprints: [] };
  const consumedExposure = emptyExposure(), decisions: AmazonPqaScreening['decisions'] = [];
  const groups = new Map<string, AmazonPqaRecord[]>(); for (const record of records) groups.set(record.product.id, [...(groups.get(record.product.id) ?? []), record]);
  const seenProducts = new Set<string>();
  const pinHash = seal(sourcePin); let accepted = 0;
  for (const record of records) {
    const group = groups.get(record.product.id)!;
    const sources = seenProducts.has(record.product.id) ? record.sources : [...new Map([...record.sources, ...group.flatMap(r => r.sources.filter(s => s.kind === 'customer_qa'))].map(s => [s.id, s])).values()];
    seenProducts.add(record.product.id);
    const caseId = `apqa-case-${textHash(JSON.stringify([pinHash, record.row, record.product.id, record.target.id])).slice(0, 24)}`;
    const bodyHash = (s: string) => textHash(JSON.stringify([norm(s)]));
    const scopedHash = (s: AmazonPqaSource) => textHash(JSON.stringify([norm(s.text), norm(s.originalQuestion ?? '')]));
    const legacyHash = (s: AmazonPqaSource) => textHash(JSON.stringify([s.text.trim().toLowerCase().replace(/\s+/g, ' '), (s.originalQuestion ?? '').trim().toLowerCase().replace(/\s+/g, ' ')]));
    const family = canonicalFamily(norm(record.product.title));
    const exposure = emptyExposure(); exposure.productIds = [...new Set([record.product.id, ...sources.map(s => s.productId)])].sort();
    exposure.canonicalFamilyTitles = [...new Set([family, ...(record.product.family ? [canonicalFamily(norm(record.product.family))] : [])].filter(Boolean))].sort();
    exposure.modelIdentifiers = [...new Set([...record.product.modelIdentifiers.map(v => norm(v)), ...modelIds([norm(record.product.title), norm(record.product.family ?? ''), norm(record.target.question), norm(record.target.answer), ...sources.flatMap(s => [norm(s.text), norm(s.originalQuestion ?? '')])].join(' '))])].sort();
    exposure.sourceBodyFingerprints = [...new Set([record.target.answer, ...sources.map(s => s.text)].filter(s => norm(s)).map(bodyHash))].sort();
    exposure.sourcePacketFingerprints = [...new Set(sources.flatMap(s => [scopedHash(s), legacyHash(s)]))].sort();
    exposure.targetQuestionFingerprints = [bodyHash(record.target.question)]; exposure.targetAnswerFingerprints = [bodyHash(record.target.answer)];
    const reasons: string[] = [];
    if (exposure.productIds.some(v => protectedExposure.productIds.includes(v))) reasons.push('historical_or_within_prefix_product');
    if (exposure.canonicalFamilyTitles.some(v => protectedExposure.canonicalFamilyTitles.some(p => familyConflict(v, p)))) reasons.push('historical_or_within_prefix_family');
    if (modelConflict(exposure.modelIdentifiers, protectedExposure.modelIdentifiers)) reasons.push('historical_or_within_prefix_model');
    if (exposure.sourceBodyFingerprints.some(v => protectedExposure.sourceBodyFingerprints.includes(v))) reasons.push('historical_or_within_prefix_body');
    if (exposure.sourcePacketFingerprints.some(v => protectedExposure.sourcePacketFingerprints.includes(v))) reasons.push('historical_or_within_prefix_body_and_original_question');
    if (!record.product.title.trim() || record.product.title.length > policy.maxTitleUtf16Units) reasons.push('missing_or_out_of_bounds_title');
    if (new Set(group.map(r => norm(r.product.title))).size !== 1) reasons.push('inconsistent_same_product_title');
    if (!record.target.question.trim() || record.target.question.length > policy.maxQuestionUtf16Units) reasons.push('missing_or_out_of_bounds_question');
    if (sources.some(s => s.productId !== record.product.id)) reasons.push('peer_source_applicability_unresolved');
    if (sources.some(s => !s.text.trim() || s.text.length > policy.maxBodyUtf16Units || s.originalQuestion !== null && (!s.originalQuestion.trim() || s.originalQuestion.length > policy.maxQuestionUtf16Units))) reasons.push('complete_parent_out_of_bounds');
    if (sources.length > policy.maxParents) reasons.push('parent_count_overflow');
    const sameQuestionAnswers = new Set([targetKey(record.target.answer), ...group.filter(r => r.target.id === record.target.id || targetKey(r.target.question) === targetKey(record.target.question)).map(r => targetKey(r.target.answer)), ...sources.filter(s => s.originalQuestion !== null && targetKey(s.originalQuestion) === targetKey(record.target.question)).map(s => targetKey(s.text))].filter(Boolean));
    const equivalentSourceIds = new Set(group.filter(r => r.target.id === record.target.id || targetKey(r.target.question) === targetKey(record.target.question)).flatMap(r => r.sources.filter(s => s.kind === 'customer_qa').map(s => s.id)));
    const excludedParents: AmazonPqaScreening['decisions'][number]['excludedParents'] = [];
    const selected: AmazonPqaRecord['sources'] = [];
    const seenParents = new Set<string>();
    for (const source of sources) {
      const body = targetKey(source.text), scope = source.originalQuestion === null ? '' : targetKey(source.originalQuestion);
      let reason: string | null = equivalentSourceIds.has(source.id) || scope && scope === targetKey(record.target.question) ? 'target_equivalent_question' : [...sameQuestionAnswers].some(answer => body.includes(answer)) ? 'target_answer_text_in_parent' : null;
      const fp = scopedHash(source);
      if (!reason && seenParents.has(fp)) reason = 'duplicate_literal_parent';
      if (reason) excludedParents.push({ sourceId: source.id, reason, bodySha256: bodyHash(source.text), scopedSha256: fp });
      else { selected.push(source); seenParents.add(fp); }
    }
    if (!selected.length) reasons.push('no_target_free_source_parents');
    if (accepted >= policy.targetPackets) reasons.push('fixed_pool_capacity_reached');
    let packet: AmazonPqaPacket | null = null;
    if (!reasons.length) {
      const sources = selected.map(s => { const label = s.kind === 'customer_qa' ? 'cqa' : s.kind === 'product_feature' ? 'bullet_points' : 'product_description'; const value = { id: s.id, label, text: s.text, originalQuestion: s.originalQuestion, reference: s.reference }; return { ...value, sha256: textHash(JSON.stringify([value.id, value.label, value.text, value.originalQuestion, value.reference])) }; });
      packet = { id: caseId, product: { id: record.product.id, title: record.product.title }, question: record.target.question, sources, sourcePoolSha256: textHash(JSON.stringify(sources)) }; accepted++;
    }
    decisions.push({ caseId, row: record.row, productId: record.product.id, eligible: packet !== null, reasons, packet, exposure, targetAnswerWithheld: true, excludedParents, familySeparation: 'requires_independent_source_review' });
    // Rejections, excluded target parents and overflow bodies all remain exposed.
    unionExposure(consumedExposure, exposure); unionExposure(protectedExposure, exposure);
  }
  const result = { format: 'ablatrix-amazon-pqa-screening-v1' as const, sourcePinSha256: pinHash, policySha256: seal(policy), historySha256: seal(history), screeningDenominator: records.length,
    acceptedCaseIds: decisions.filter(r => r.eligible).map(r => r.caseId), decisions, consumedExposure, normalization: normalized.normalization,
    stopReason: accepted < policy.targetPackets ? 'finite_prefix_shortfall' as const : 'source_review_required' as const,
    provenance: 'source_only_exploratory' as const, sourceProvenance: sourcePin.provenance, candidateContextInspected: false as const, generatedAnswersInspected: false as const,
    providerCalls: 0 as const, humanSourceCheckedAnswers: 0 as const, qualityClaimEligible: false as const, activationAuthorized: false as const, paidExecutionAuthorized: false as const };
  return { ...result, screeningSha256: seal(result) };
}
