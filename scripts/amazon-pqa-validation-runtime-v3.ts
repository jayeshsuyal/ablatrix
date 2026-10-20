/** Runtime v3: unchanged native v2 semantics with bounded long proof waits. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ProductRetriever } from '../server/product-retrieval.ts';
import { cachedCrossEncoder } from '../server/semantic-reranker.ts';
import { canonicalAmazonPqaTextsV1, type AmazonPqaExposureHistory } from '../server/amazon-pqa-source-v1.ts';
import { AmazonPqaReleaseParseErrorV2, parseAmazonPqaReleaseV2, screenAmazonPqaReleaseV2 } from '../server/amazon-pqa-release-v2.ts';
import { amazonPqaValidationCliV2 as legacyAmazonPqaCliV2 } from './amazon-pqa-validation-v2.ts';
export const AMAZON_PQA_RUNTIME_V3 = 'native-release-runtime-v3' as const;
import { AMAZON_PQA_RELEASE_REQUIRED_CODE, AMAZON_PQA_V2_PROJECTION, amazonPqaArtifact, freezeAmazonPqaV2, verifyAmazonPqaFreezeV2, reviewAmazonPqaAccessV2,
  withAmazonPqaReleaseAccessV2, amazonPqaEligibilityRequestV2, selectAmazonPqaCasesV2, amazonPqaCorpusV2, prepareAmazonPqaComparisonV2, verifyAmazonPqaComparisonV2, reportAmazonPqaV2,
  type AmazonPqaFreezeV2, type AmazonPqaProtocolV2, type AmazonPqaAccessReviewV2, type AmazonPqaEligibilityReviewV2, type AmazonPqaSelectionV2 } from '../server/amazon-pqa-validation-v2.ts';
import type { AmazonPqaArtifact, AmazonPqaScreening } from '../server/amazon-pqa-validation-v1.ts';

type Ref = { path: string; fileSha256: string };
type Bundle = { format: 'ablatrix-amazon-pqa-workflow-input-v2'; freeze: Ref; accessReviews?: Ref[]; objectFiles?: Record<string, Ref>;
  screening?: Ref; eligibilityReviews?: Ref[]; selection?: Ref; comparison?: Ref };
const repository = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function file(path: string, root: string, max = 64 * 1024 * 1024) {
  const full = resolve(root, path); assert.ok(path && !path.includes('\0')); const stat = lstatSync(full);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && realpathSync(full) === full && stat.size <= max, 'Canonical bounded local file required.'); return full;
}
function read<T = unknown>(path: string, root: string): AmazonPqaArtifact<T> { return amazonPqaArtifact<T>(path, readFileSync(file(path, root), 'utf8')); }
function bound<T = unknown>(ref: Ref, root: string) { assert.ok(ref); const result = read<T>(ref.path, root); assert.equal(result.fileSha256, ref.fileSha256, 'Exact native artifact bytes changed.'); return result; }
function save(output: string, value: unknown) {
  assert.ok(isAbsolute(output) && !existsSync(output) && realpathSync(dirname(output)) === dirname(output)); writeFileSync(output, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { output, fileSha256: hash(readFileSync(output)), providerCalls: 0, generatedAnswers: 0, paidExecutionAuthorized: false };
}
export function amazonPqaImplementationPathsRuntimeV3(root = repository) {
  const found = new Set<string>(['package.json', 'package-lock.json']), pending = [...AMAZON_PQA_RELEASE_REQUIRED_CODE, 'scripts/amazon-pqa-validation-runtime-v3.ts', 'scripts/prepare-amazon-pqa-history-runtime-v3.py'] as string[];
  while (pending.length) {
    const path = pending.pop()!; if (found.has(path)) continue; found.add(path); const source = readFileSync(file(path, root), 'utf8');
    for (const m of source.matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
      const full = resolve(root, dirname(path), m[1]!), relative = full.slice(resolve(root).length + 1); assert.ok(full.startsWith(resolve(root) + '/') && /\.(?:ts|js|json)$/.test(relative)); pending.push(relative);
    }
    if (path.endsWith('.py')) {
      for (const m of source.matchAll(/['"](scripts\/[^'"]+\.(?:py|ts|js))['"]/g)) pending.push(m[1]!);
      for (const m of source.matchAll(/with_name\(['"]([^'"]+\.py)['"]\)/g)) pending.push(`${dirname(path)}/${m[1]}`);
    }
  }
  return [...found].sort();
}
function currentFreeze(ref: Ref, root: string) {
  const freeze = verifyAmazonPqaFreezeV2(bound<AmazonPqaFreezeV2>(ref, root).document);
  assertRuntimeProtocol(freeze.protocol.document);
  for (const artifact of [freeze.protocol, freeze.sourcePin, freeze.history, ...freeze.historicalInputs]) assert.deepEqual(bound(artifact, root).document, artifact.document, 'Embedded native metadata differs from raw pinned bytes.');
  assert.deepEqual(Object.keys(freeze.implementationSha256).sort(), amazonPqaImplementationPathsRuntimeV3(root));
  for (const [path, expected] of Object.entries(freeze.implementationSha256)) assert.equal(hash(readFileSync(file(path, root))), expected, 'Prospectively frozen native implementation changed.'); return freeze;
}
function assertRuntimeProtocol(protocol: AmazonPqaProtocolV2) {
  assert.equal((protocol as AmazonPqaProtocolV2 & { executionRuntime: string }).executionRuntime, AMAZON_PQA_RUNTIME_V3, 'This runtime requires an explicit new protocol binding; frozen v2 observations remain unchanged.');
}
function runtimeBridge(root: string) {
  const implementationSha256 = Object.fromEntries(amazonPqaImplementationPathsRuntimeV3(root).map(path => [path, hash(readFileSync(file(path, root)))]));
  return { contract: AMAZON_PQA_RUNTIME_V3, nativeSemanticContract: 'native-release-v2', legacyObservationsRewritten: false,
    legacyReconstruction: 'original_frozen_v2_cli', implementationSha256, nestedHistoryProofTimeoutMs: 300_000, exposedReplayChildTimeoutSeconds: 240 };
}
function modelAssets(protocol: AmazonPqaProtocolV2, root: string) {
  for (const [path, expected] of Object.entries(protocol.localModelAssetSha256)) assert.equal(hash(readFileSync(file(path, root, 128 * 1024 * 1024))), expected);
}
function screen(freeze: AmazonPqaFreezeV2, bundle: Bundle, root: string): AmazonPqaScreening {
  const access = (bundle.accessReviews ?? []).map(ref => bound<AmazonPqaAccessReviewV2>(ref, root)); assert.equal(reviewAmazonPqaAccessV2(freeze, access).sourceAccessAllowed, true, 'Native source-access review must qualify before source-path access.');
  const history = freeze.history.document as AmazonPqaExposureHistory & Record<string, unknown> & { normalization: { pythonVersion: string; unicodeVersion: string } };
  assert.equal(history.format, 'ablatrix-amazon-pqa-protected-history-v2'); assert.equal(history.priorConsumedPrefixMappingVerified, true);
  assert.equal(history.executionRuntime, AMAZON_PQA_RUNTIME_V3);
  const proof = JSON.parse(execFileSync('python3', ['-I', 'scripts/prepare-amazon-pqa-history-runtime-v3.py', '--verify', freeze.history.path], { cwd: root, env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 300_000, maxBuffer: 1_048_576 }));
  assert.equal(proof.providerCalls, 0); assert.equal(proof.historyFileSha256, freeze.history.fileSha256);
  const profile = canonicalAmazonPqaTextsV1([]).normalization; assert.equal(profile.pythonVersion, history.normalization.pythonVersion); assert.equal(profile.unicodeVersion, history.normalization.unicodeVersion);
  const pin = freeze.sourcePin.document; assert.ok(bundle.objectFiles); assert.deepEqual(Object.keys(bundle.objectFiles).sort(), pin.objects.map(o => o.key).sort());
  const objects = withAmazonPqaReleaseAccessV2(history, pin, () => {
    const result = new Map<string, Buffer>(); for (const object of pin.objects) { const ref: Ref = bundle.objectFiles![object.key]!; assert.equal(ref.fileSha256, object.sha256);
      const bytes = readFileSync(file(ref.path, root)); assert.equal(bytes.length, object.bytes); assert.equal(hash(bytes), object.sha256); result.set(object.key, bytes); } return result;
  });
  const p = freeze.protocol.document, parsed = parseAmazonPqaReleaseV2(pin, objects, p.maxInspectedRecords);
  const projection: AmazonPqaExposureHistory = { ...Object.fromEntries(['productIds', 'canonicalFamilyTitles', 'modelIdentifiers', 'sourceBodyFingerprints', 'sourcePacketFingerprints'].map(k => [k, history[k]])) as AmazonPqaExposureHistory,
    normalization: { id: 'python_nfkc_casefold_whitespace_v1', pythonVersion: history.normalization.pythonVersion, unicodeVersion: history.normalization.unicodeVersion } };
  return screenAmazonPqaReleaseV2({ sourcePin: pin, parsed, history: projection, mode: 'prospective_source_screening', policy: { maxInspectedRecords: p.maxInspectedRecords, targetPackets: p.targetPackets,
    maxParents: p.maxParents, maxBodyUtf16Units: p.maxBodyUtf16Units, maxQuestionUtf16Units: p.maxQuestionUtf16Units, maxTitleUtf16Units: p.maxTitleUtf16Units } }) as unknown as AmazonPqaScreening;
}
function parseFlags(argv: string[]) {
  const result = new Map<string, string>(); for (let i = 0; i < argv.length; i += 2) { assert.ok(['--input', '--out'].includes(argv[i]!) && argv[i + 1] && !result.has(argv[i]!)); result.set(argv[i]!, argv[i + 1]!); } assert.ok(result.has('--input')); return result;
}
export async function amazonPqaValidationRuntimeCliV3(argv: string[], root = repository) {
  if (!argv.length) return { usage: '--exposed-replay|--verify-exposed|--boundary-request|--boundary-repair|--verify-boundary|--freeze|--access-request|--screen|--review-request|--select|--prepare|--report|--verify --input PRIVATE_JSON [--out NEW_ABSOLUTE]', providerCalls: 0, freshInputReads: 0, paidExecutionAuthorized: false };
  const [mode, ...rest] = argv; assert.ok(['--exposed-replay', '--verify-exposed', '--boundary-request', '--boundary-repair', '--verify-boundary', '--freeze', '--access-request', '--screen', '--review-request', '--select', '--prepare', '--report', '--verify'].includes(mode!));
  const flags = parseFlags(rest), output = flags.get('--out'); assert.equal(Boolean(output), !['--verify', '--verify-exposed', '--verify-boundary'].includes(mode!));
  // Historical observations retain their original implementation pins and raw
  // review/subject bindings. The frozen v2 entry point reconstructs them; this
  // wrapper separately records the complete current runtime closure.
  if (['--exposed-replay', '--verify-exposed', '--boundary-request', '--boundary-repair', '--verify-boundary'].includes(mode!)) {
    const result = await legacyAmazonPqaCliV2(argv, root);
    return { ...result, executionRuntime: AMAZON_PQA_RUNTIME_V3, runtimeBridge: runtimeBridge(root) };
  }
  if (mode === '--freeze') {
    const spec = read<{ protocol: string; sourcePin: string; history: string; historicalInputs: string[]; codePaths?: string[] }>(flags.get('--input')!, root).document;
    const codePaths = amazonPqaImplementationPathsRuntimeV3(root); if (spec.codePaths) assert.deepEqual([...spec.codePaths].sort(), codePaths);
    const protocol = read<AmazonPqaProtocolV2>(spec.protocol, root); assertRuntimeProtocol(protocol.document);
    const freeze = freezeAmazonPqaV2({ protocol, sourcePin: read(spec.sourcePin, root) as AmazonPqaFreezeV2['sourcePin'], history: read(spec.history, root), historicalInputs: spec.historicalInputs.map(path => read(path, root)),
      implementationSha256: Object.fromEntries(codePaths.map(path => [path, hash(readFileSync(file(path, root)))])) }); modelAssets(freeze.protocol.document, root); return save(output!, freeze);
  }
  const bundle = read<Bundle>(flags.get('--input')!, root).document; assert.equal(bundle.format, 'ablatrix-amazon-pqa-workflow-input-v2'); const freeze = currentFreeze(bundle.freeze, root);
  if (mode === '--access-request') return save(output!, { format: 'ablatrix-amazon-pqa-source-access-request-v2', freezeSha256: freeze.sha256, freeze, semanticRowsInspected: 0,
    executionRuntime: AMAZON_PQA_RUNTIME_V3, semanticReadScope: { prospectiveCompleteRowsInspected: 0,
      preFreezeBoundaryExclusion: (freeze.protocol.document as AmazonPqaProtocolV2 & { preFreezeBoundaryExclusion?: unknown }).preFreezeBoundaryExclusion ?? null,
      note: 'The sourceBodiesInspected flag applies to prospective complete cases. The already reviewed boundary row was read solely for historical exclusion and remains bound in the protected history.' },
    instruction: 'Inspect exact native release schema, next fixed interval and verified prior consumed-prefix mapping. The old interval is development exposure, never fresh. Review two independent source-access records plus third adjudication before any new row access.', providerCalls: 0, humanSourceCheckedAnswers: 0, qualityClaimEligible: false });
  const oldFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('Offline native APQA preparation cannot download or dispatch.'); };
  try {
    const actual = screen(freeze, bundle, root); if (mode === '--screen') return save(output!, actual);
    const screening = bound<AmazonPqaScreening>(bundle.screening!, root); assert.deepEqual(screening.document, actual, 'Native screening must replay exactly from original byte/schema/history pins.');
    if (mode === '--review-request') return save(output!, amazonPqaEligibilityRequestV2(freeze, screening));
    const reviews = (bundle.eligibilityReviews ?? []).map(ref => bound<AmazonPqaEligibilityReviewV2>(ref, root)), selection = selectAmazonPqaCasesV2(freeze, screening, reviews);
    if (mode === '--select') return save(output!, selection);
    assert.deepEqual(bound<AmazonPqaSelectionV2>(bundle.selection!, root).document, selection);
    if (mode === '--prepare') { modelAssets(freeze.protocol.document, root); const retriever = new ProductRetriever(amazonPqaCorpusV2(freeze, screening, selection), ':memory:', { cachedOnly: true });
      try { return save(output!, await prepareAmazonPqaComparisonV2(freeze, screening, reviews, selection, retriever, cachedCrossEncoder())); } finally { retriever.close(); } }
    const comparison = bundle.comparison ? bound<Awaited<ReturnType<typeof prepareAmazonPqaComparisonV2>>>(bundle.comparison, root).document : undefined;
    if (comparison) await verifyAmazonPqaComparisonV2(freeze, screening, reviews, selection, comparison);
    if (mode === '--verify') return { verified: true, freezeSha256: freeze.sha256, nativeSchema: freeze.sourcePin.document.schemaId, comparisonVerified: Boolean(comparison), providerCalls: 0, paidExecutionAuthorized: false };
    return save(output!, reportAmazonPqaV2(freeze, screening, selection, comparison));
  } catch (error) {
    if (mode === '--screen' && error instanceof AmazonPqaReleaseParseErrorV2) return { ...save(output!, { format: 'ablatrix-amazon-pqa-semantic-access-failure-v2', status: 'source_parse_failed',
      freezeSha256: freeze.sha256, nativeSchema: freeze.sourcePin.document.schemaId, nativeSourcePinFileSha256: freeze.sourcePin.fileSha256, nativeSourcePinSha256: error.sourcePinSha256,
      sourcePrefixes: freeze.sourcePin.document.objects.map(o => ({ ...o })), semanticRowsInspected: error.inspectedRows, validDecodedRows: error.validDecodedRows,
      consumedExposure: error.consumedExposure, normalization: error.normalization, wholePrefixConsumed: true, errorCode: error.stage, eligiblePackets: 0, selection: null, contexts: null,
      calculationProjectionContract: AMAZON_PQA_V2_PROJECTION, providerCalls: 0, generatedAnswers: 0, humanSourceCheckedAnswers: 0, qualityClaimEligible: false, activationAuthorized: false, paidExecutionAuthorized: false, paidPlan: null }), status: 'source_parse_failed' };
    throw error;
  } finally { globalThis.fetch = oldFetch; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await amazonPqaValidationRuntimeCliV3(process.argv.slice(2)), null, 2)); }
  catch { console.error('Native APQA preparation stopped: invalid, changed, unqualified or unavailable offline input. No provider calls were made.'); process.exitCode = 1; }
}
