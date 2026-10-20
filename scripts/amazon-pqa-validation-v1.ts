/** Offline Amazon-PQA custody/preparation CLI. No credentials or execution mode. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { textHash } from '../server/product-corpus.ts';
import { ProductRetriever } from '../server/product-retrieval.ts';
import { cachedCrossEncoder } from '../server/semantic-reranker.ts';
import { AmazonPqaParseError, canonicalAmazonPqaTextsV1, parseAmazonPqaObjectsV1, screenAmazonPqaSourceV1, type AmazonPqaSourcePin, type AmazonPqaExposureHistory } from '../server/amazon-pqa-source-v1.ts';
import { AMAZON_PQA_REQUIRED_CODE, amazonPqaArtifact, freezeAmazonPqaV1, verifyAmazonPqaFreezeV1, reviewAmazonPqaAccessV1,
  withAmazonPqaPrefixAccessV1, amazonPqaParseFailureV1, amazonPqaEligibilityRequestV1, selectAmazonPqaCasesV1, amazonPqaCorpusV1, prepareAmazonPqaComparisonV1, verifyAmazonPqaComparisonV1, reportAmazonPqaV1,
  type AmazonPqaArtifact, type AmazonPqaProtocol, type AmazonPqaFreeze, type AmazonPqaAccessReview, type AmazonPqaEligibilityReview, type AmazonPqaScreening, type AmazonPqaSelection } from '../server/amazon-pqa-validation-v1.ts';

type Ref = { path: string; fileSha256: string };
type Bundle = { format: 'ablatrix-amazon-pqa-workflow-input-v1'; freeze: Ref; accessReviews?: Ref[]; objectFiles?: Record<string, Ref>;
  screening?: Ref; eligibilityReviews?: Ref[]; selection?: Ref; comparison?: Ref };
const repository = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const bytesHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function file(path: string, root: string, maxBytes = 64 * 1024 * 1024) {
  const full = resolve(root, path); assert.ok(path && !path.includes('\0'));
  const stat = lstatSync(full); assert.ok(stat.isFile() && !stat.isSymbolicLink() && realpathSync(full) === full && stat.size <= maxBytes, 'Use a canonical regular bounded local file.'); return full;
}
function read<T = unknown>(path: string, root: string): AmazonPqaArtifact<T> { return amazonPqaArtifact<T>(path, readFileSync(file(path, root), 'utf8')); }
function bound<T = unknown>(ref: Ref, root: string): AmazonPqaArtifact<T> { assert.ok(ref); const value = read<T>(ref.path, root); assert.equal(value.fileSha256, ref.fileSha256, 'Exact raw artifact bytes changed.'); return value; }
function save(output: string, document: unknown) {
  assert.ok(isAbsolute(output) && !existsSync(output) && realpathSync(dirname(output)) === dirname(output), 'Use a new absolute output path with a canonical existing parent.');
  writeFileSync(output, JSON.stringify(document, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return { output, fileSha256: bytesHash(readFileSync(output)), providerCalls: 0, generatedAnswers: 0, paidExecutionAuthorized: false };
}
function currentFreeze(ref: Ref, root: string) {
  const freeze = verifyAmazonPqaFreezeV1(bound<AmazonPqaFreeze>(ref, root).document);
  for (const pin of [freeze.protocol, freeze.sourcePin, freeze.history, ...freeze.historicalInputs]) assert.deepEqual(bound(pin, root).document, pin.document, 'Embedded metadata differs from exact pinned raw bytes.');
  assert.deepEqual(Object.keys(freeze.implementationSha256).sort(), amazonPqaImplementationPathsV1(root).sort(), 'All transitively imported local code and dependency manifests must be frozen.');
  for (const [path, hash] of Object.entries(freeze.implementationSha256)) assert.equal(bytesHash(readFileSync(file(path, root))), hash, 'Executed source differs from prospective code freeze.');
  return freeze;
}
function modelAssets(protocol: AmazonPqaProtocol, root: string) {
  for (const [path, expected] of Object.entries(protocol.localModelAssetSha256)) assert.equal(bytesHash(readFileSync(file(path, root, 128 * 1024 * 1024))), expected, 'Cached local model asset changed after the prospective pin.');
}
export function amazonPqaImplementationPathsV1(root = repository) {
  const found = new Set<string>(['package.json', 'package-lock.json']);
  const pending = [...AMAZON_PQA_REQUIRED_CODE] as string[];
  while (pending.length) {
    const path = pending.pop()!; if (found.has(path)) continue; found.add(path);
    const source = readFileSync(file(path, root), 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
      const dependency = resolve(root, dirname(path), match[1]!); const relativePath = dependency.slice(resolve(root).length + 1);
      assert.ok(dependency.startsWith(resolve(root) + '/') && /\.(?:ts|js|json)$/.test(relativePath), 'Local implementation import must resolve inside the repository.'); pending.push(relativePath);
    }
    if (path.endsWith('.py')) {
      for (const match of source.matchAll(/['"](scripts\/[^'"]+\.(?:py|ts|js))['"]/g)) pending.push(match[1]!);
      for (const match of source.matchAll(/with_name\(['"]([^'"]+\.py)['"]\)/g)) pending.push(`${dirname(path)}/${match[1]}`);
    }
  }
  return [...found].sort();
}
function flags(argv: string[]) {
  const result = new Map<string, string>(); for (let i = 0; i < argv.length; i += 2) { assert.ok(['--input', '--out'].includes(argv[i]!) && argv[i + 1] && !result.has(argv[i]!)); result.set(argv[i]!, argv[i + 1]!); }
  assert.ok(result.has('--input')); return result;
}
function screen(freeze: AmazonPqaFreeze, bundle: Bundle, root: string) {
  const access = (bundle.accessReviews ?? []).map(r => bound<AmazonPqaAccessReview>(r, root));
  assert.equal(reviewAmazonPqaAccessV1(freeze, access).sourceAccessAllowed, true, 'Independent source-access review has not qualified. No source body may be opened.');
  const history = freeze.history.document as AmazonPqaExposureHistory & { format: string; completeHistoricalUnion: boolean; normalization: { pythonVersion: string; unicodeVersion: string }; consumedSourcePrefixes?: unknown; unresolvedPriorSemanticExposure?: unknown };
  assert.equal(history.format, 'ablatrix-amazon-pqa-protected-history-v1'); assert.equal(history.completeHistoricalUnion, true);
  const historyProof = JSON.parse(execFileSync('python3', ['-I', 'scripts/prepare-amazon-pqa-history-v1.py', '--verify', freeze.history.path], {
    cwd: root, env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 30_000, maxBuffer: 1_048_576 }));
  assert.equal(historyProof.providerCalls, 0); assert.equal(historyProof.historyFileSha256, freeze.history.fileSha256, 'Complete prior exposure must reconstruct before source access.');
  const profile = canonicalAmazonPqaTextsV1([]).normalization;
  assert.equal(profile.pythonVersion, history.normalization.pythonVersion); assert.equal(profile.unicodeVersion, history.normalization.unicodeVersion, 'Historical and new fingerprint Unicode contracts differ.');
  const pin = freeze.sourcePin.document as AmazonPqaSourcePin;
  assert.ok(bundle.objectFiles); assert.deepEqual(Object.keys(bundle.objectFiles).sort(), pin.objects.map(o => o.key).sort());
  const objects = withAmazonPqaPrefixAccessV1(history, pin, () => {
    const opened = new Map<string, Buffer>();
    for (const object of pin.objects) {
      const ref: Ref = bundle.objectFiles![object.key]!; assert.equal(ref.fileSha256, object.sha256);
      const bytes = readFileSync(file(ref.path, root)); assert.equal(bytes.length, object.bytes); assert.equal(bytesHash(bytes), object.sha256, 'Opaque source bytes differ from the sealed preinspection pin.'); opened.set(object.key, bytes);
    }
    return opened;
  });
  const p = freeze.protocol.document;
  const records = parseAmazonPqaObjectsV1(pin, objects, p.maxInspectedRecords);
  const historyProjection: AmazonPqaExposureHistory = { ...Object.fromEntries(['productIds', 'canonicalFamilyTitles', 'modelIdentifiers', 'sourceBodyFingerprints', 'sourcePacketFingerprints'].map(key => [key, history[key as keyof AmazonPqaExposureHistory]])) as AmazonPqaExposureHistory,
    normalization: { id: 'python_nfkc_casefold_whitespace_v1', pythonVersion: history.normalization.pythonVersion, unicodeVersion: history.normalization.unicodeVersion } };
  const screening = screenAmazonPqaSourceV1({ sourcePin: pin, records, history: historyProjection,
    policy: { maxInspectedRecords: p.maxInspectedRecords, targetPackets: p.targetPackets, maxParents: p.maxParents, maxBodyUtf16Units: p.maxBodyUtf16Units, maxQuestionUtf16Units: p.maxQuestionUtf16Units, maxTitleUtf16Units: p.maxTitleUtf16Units } });
  return screening as unknown as AmazonPqaScreening;
}

/** Optional root only supports isolated synthetic CLI tests; the executable uses its repository. */
export async function amazonPqaValidationCliV1(argv: string[], root = repository) {
  if (!argv.length) return { usage: '--freeze|--access-request|--screen|--review-request|--select|--prepare|--report|--verify --input PRIVATE_JSON [--out NEW_ABSOLUTE]',
    providerCalls: 0, freshInputReads: 0, manualReviewRequired: false, paidExecutionAuthorized: false };
  const [mode, ...rest] = argv; assert.ok(['--freeze', '--access-request', '--screen', '--review-request', '--select', '--prepare', '--report', '--verify'].includes(mode!));
  const options = flags(rest), output = options.get('--out'); assert.equal(Boolean(output), mode !== '--verify');
  if (mode === '--freeze') {
    const spec = read<{ protocol: string; sourcePin: string; history: string; historicalInputs: string[]; codePaths?: string[] }>(options.get('--input')!, root).document;
    const codePaths = amazonPqaImplementationPathsV1(root); if (spec.codePaths) assert.deepEqual([...spec.codePaths].sort(), codePaths);
    const implementationSha256 = Object.fromEntries(codePaths.map(path => [path, bytesHash(readFileSync(file(path, root)))]));
    const freeze = freezeAmazonPqaV1({ protocol: read<AmazonPqaProtocol>(spec.protocol, root), sourcePin: read(spec.sourcePin, root), history: read(spec.history, root), historicalInputs: spec.historicalInputs.map(path => read(path, root)), implementationSha256 });
    modelAssets(freeze.protocol.document, root); return save(output!, freeze);
  }
  const bundle = read<Bundle>(options.get('--input')!, root).document; assert.equal(bundle.format, 'ablatrix-amazon-pqa-workflow-input-v1');
  const freeze = currentFreeze(bundle.freeze, root);
  if (mode === '--access-request') return save(output!, { format: 'ablatrix-amazon-pqa-source-access-request-v1', freezeSha256: freeze.sha256,
    instruction: 'Independently inspect all bound metadata, code/history pins, unpartitioned publisher release, finite prefix bounds, and target-answer exclusions before semantic row access. Cite exact metadata. Two independent AI records and a third adjudication are required; agreement is provisional.',
    freeze, providerCalls: 0, semanticRowsInspected: 0, qualityClaimEligible: false, humanSourceCheckedAnswers: 0 });
  // Source access, raw source hash and finite source screening replay precede all
  // review/selection/context operations. A bad access review never opens bodies.
  const oldFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('Offline Amazon-PQA preparation cannot download or dispatch.'); };
  try {
    const actual = screen(freeze, bundle, root);
    if (mode === '--screen') return save(output!, actual);
    const screening = bound<AmazonPqaScreening>(bundle.screening!, root); assert.deepEqual(screening.document, actual, 'Saved screening must replay from exact pinned source bytes and historical exclusions.');
    if (mode === '--review-request') return save(output!, amazonPqaEligibilityRequestV1(freeze, screening));
    const reviews = (bundle.eligibilityReviews ?? []).map(r => bound<AmazonPqaEligibilityReview>(r, root));
    const selection = selectAmazonPqaCasesV1(freeze, screening, reviews);
    if (mode === '--select') return save(output!, selection);
    assert.deepEqual(bound<AmazonPqaSelection>(bundle.selection!, root).document, selection, 'Fixed selection cannot be replaced after candidate inspection.');
    if (mode === '--prepare') {
      modelAssets(freeze.protocol.document, root);
      const retriever = new ProductRetriever(amazonPqaCorpusV1(freeze, screening, selection), ':memory:', { cachedOnly: true });
      try { return save(output!, await prepareAmazonPqaComparisonV1(freeze, screening, reviews, selection, retriever, cachedCrossEncoder())); } finally { retriever.close(); }
    }
    const comparison = bundle.comparison ? bound<Awaited<ReturnType<typeof prepareAmazonPqaComparisonV1>>>(bundle.comparison, root).document : undefined;
    if (comparison) await verifyAmazonPqaComparisonV1(freeze, screening, reviews, selection, comparison);
    if (mode === '--verify') return { verified: true, freezeSha256: freeze.sha256, inspectedQuestions: selection.inspectedQuestions, selectedUniqueProducts: selection.selectedProducts, comparisonVerified: Boolean(comparison), providerCalls: 0, paidExecutionAuthorized: false };
    return save(output!, reportAmazonPqaV1(freeze, screening, selection, comparison));
  } catch (error) {
    if (mode === '--screen' && error instanceof AmazonPqaParseError) return { ...save(output!, amazonPqaParseFailureV1(freeze, error)), status: 'source_parse_failed', sourceEligibilityPassed: false, errorCode: error.stage };
    throw error;
  } finally { globalThis.fetch = oldFetch; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await amazonPqaValidationCliV1(process.argv.slice(2)), null, 2)); }
  catch { console.error('Amazon-PQA preparation stopped: invalid, changed, unqualified or unavailable offline input. No provider calls were made.'); process.exitCode = 1; }
}
