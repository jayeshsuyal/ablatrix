/** Offline native v4 source workflow. No paid or network dispatch mode exists. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ProductRetriever } from '../server/product-retrieval.ts';
import { cachedCrossEncoder } from '../server/semantic-reranker.ts';
import { freshSeal } from '../server/fresh-validation-v2.ts';
import { canonicalAmazonPqaTextsV1, type AmazonPqaExposureHistory } from '../server/amazon-pqa-source-v1.ts';
import { AmazonPqaReleaseParseErrorV2, parseAmazonPqaReleaseV2, screenAmazonPqaReleaseV2 } from '../server/amazon-pqa-release-v2.ts';
import { withAmazonPqaReleaseAccessV2 } from '../server/amazon-pqa-validation-v2.ts';
import { AMAZON_PQA_V4_REQUIRED_CODE, AMAZON_PQA_RUNTIME_V4, amazonPqaArtifact, freezeAmazonPqaV4, verifyAmazonPqaFreezeV4, reviewAmazonPqaAccessV4,
  amazonPqaEligibilityRequestV4, selectAmazonPqaCasesV4, amazonPqaCorpusV4, prepareAmazonPqaComparisonV4, verifyAmazonPqaComparisonV4, reportAmazonPqaV4,
  type AmazonPqaFreezeV4, type AmazonPqaProtocolV4, type AmazonPqaAccessReviewV4, type AmazonPqaEligibilityReviewV4, type AmazonPqaSelectionV4, type AmazonPqaComparisonV4 } from '../server/amazon-pqa-validation-v4.ts';
import type { AmazonPqaArtifact, AmazonPqaScreening } from '../server/amazon-pqa-validation-v1.ts';

type Ref = { path: string; fileSha256: string };
type Bundle = { format: 'ablatrix-amazon-pqa-workflow-input-v4'; freeze: Ref; accessReviews?: Ref[]; objectFiles?: Record<string, Ref>;
  screening?: Ref; eligibilityReviews?: Ref[]; selection?: Ref; comparison?: Ref };
const repository = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
function file(path: string, root: string, max = 64 * 1024 * 1024) {
  assert.ok(path && !path.includes('\0')); const full = resolve(root, path), stat = lstatSync(full);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && realpathSync(full) === full && stat.size <= max, 'Canonical bounded local file required.'); return full;
}
function read<T = unknown>(path: string, root: string): AmazonPqaArtifact<T> { return amazonPqaArtifact<T>(path, readFileSync(file(path, root), 'utf8')); }
function bound<T = unknown>(ref: Ref, root: string) { assert.ok(ref); const result = read<T>(ref.path, root); assert.equal(result.fileSha256, ref.fileSha256, 'Exact bound artifact bytes changed.'); return result; }
function newOutput(output: string) {
  assert.ok(isAbsolute(output) && !existsSync(output) && realpathSync(dirname(output)) === dirname(output));
}
function save(output: string, value: unknown) {
  newOutput(output);
  writeFileSync(output, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { output, fileSha256: hash(readFileSync(output)), providerCalls: 0, generatedAnswers: 0, paidExecutionAuthorized: false };
}
/** Immutable pre-read custody survives a crash or failed result write. */
export function journalAmazonPqaSemanticAttemptV4(output: string, freeze: AmazonPqaFreezeV4, workflowInput: Ref, freezeRef: Ref, objectFiles: Record<string, Ref>) {
  newOutput(output);
  const journal = { format: 'ablatrix-amazon-pqa-semantic-attempt-v4', recordedAt: new Date().toISOString(),
    phase: 'qualified_before_first_guarded_source_byte_read', workflowInput, freeze: { ...freezeRef, sealSha256: freeze.sha256 },
    sourcePinFileSha256: freeze.sourcePin.fileSha256, sourcePinSha256: freshSeal(freeze.sourcePin.document), sourcePrefixes: freeze.sourcePin.document.objects, objectFiles,
    semanticRowsInspected: null, validDecodedRows: null, wholeFrameConsumed: true, freshReuseEligible: false, nextProtocolMustExcludeThisFrame: true,
    candidateContextInspected: false, answerOutputsInspected: false, providerCalls: 0, generatedAnswers: 0, humanSourceCheckedAnswers: 0,
    qualityClaimEligible: false, activationAuthorized: false, paidExecutionAuthorized: false, paidPlan: null,
    limitation: 'Conservative whole-frame commitment recorded after source-access qualification and before the first byte read. Completion and semantic row count are unknown at entry; the original journal is never rewritten.' };
  return save(`${output}.semantic-attempt.json`, journal);
}
export function amazonPqaImplementationPathsV4(root = repository) {
  const found = new Set<string>(['package.json', 'package-lock.json']), pending = [...AMAZON_PQA_V4_REQUIRED_CODE] as string[];
  while (pending.length) {
    const path = pending.pop()!; if (found.has(path)) continue; found.add(path); const source = readFileSync(file(path, root), 'utf8');
    for (const m of source.matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
      const full = resolve(root, dirname(path), m[1]!), relative = full.slice(resolve(root).length + 1);
      assert.ok(full.startsWith(resolve(root) + '/') && /\.(?:ts|js|json)$/.test(relative)); pending.push(relative);
    }
    if (path.endsWith('.py')) {
      for (const m of source.matchAll(/['"](scripts\/[^'"]+\.(?:py|ts|js))['"]/g)) pending.push(m[1]!);
      for (const m of source.matchAll(/with_name\(['"]([^'"]+\.py)['"]\)/g)) pending.push(`${dirname(path)}/${m[1]}`);
    }
  }
  return [...found].sort();
}
function modelAssets(protocol: AmazonPqaProtocolV4, root: string) {
  for (const [path, expected] of Object.entries(protocol.localModelAssetSha256)) assert.equal(hash(readFileSync(file(path, root, 128 * 1024 * 1024))), expected, 'Prospectively pinned cached model asset changed.');
}
function currentFreeze(ref: Ref, root: string) {
  const freeze = verifyAmazonPqaFreezeV4(bound<AmazonPqaFreezeV4>(ref, root).document);
  for (const a of [freeze.protocol, freeze.sourcePin, freeze.history, ...freeze.historicalInputs]) assert.deepEqual(bound(a, root).document, a.document, 'Embedded metadata differs from exact pinned raw bytes.');
  assert.deepEqual(Object.keys(freeze.implementationSha256).sort(), amazonPqaImplementationPathsV4(root));
  for (const [path, expected] of Object.entries(freeze.implementationSha256)) assert.equal(hash(readFileSync(file(path, root))), expected, 'Frozen v4 implementation changed.');
  modelAssets(freeze.protocol.document, root); return freeze;
}
function screen(f: AmazonPqaFreezeV4, bundle: Bundle, root: string, sourceReadAttempt: () => void): AmazonPqaScreening {
  const access = (bundle.accessReviews ?? []).map(ref => bound<AmazonPqaAccessReviewV4>(ref, root));
  assert.equal(reviewAmazonPqaAccessV4(f, access).sourceAccessAllowed, true, 'Two independent access reviews and bound third adjudication must qualify before source access.');
  const history = f.history.document as AmazonPqaExposureHistory & Record<string, any>;
  assert.equal(history.format, 'ablatrix-amazon-pqa-protected-history-v4'); assert.equal(history.priorConsumedPrefixMappingVerified, true); assert.equal(history.unresolvedPriorSemanticExposure, false);
  const proof = JSON.parse(execFileSync('node', ['--import', 'tsx', 'scripts/amazon-pqa-consumed-history-v4.ts', '--verify-history', '--input', f.history.path],
    { cwd: root, env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 600_000, maxBuffer: 1_048_576 }));
  assert.equal(proof.format, 'ablatrix-amazon-pqa-history-proof-v4'); assert.equal(proof.providerCalls, 0); assert.equal(proof.historyFileSha256, f.history.fileSha256);
  assert.ok(proof.wholeConsumedFramesProtected >= 2); assert.equal(proof.unresolvedPriorSemanticExposure, false); assert.equal(proof.sourceSelectionAllowed, false);
  const profile = canonicalAmazonPqaTextsV1([]).normalization;
  assert.ok(history.normalization);
  assert.equal(profile.pythonVersion, history.normalization.pythonVersion); assert.equal(profile.unicodeVersion, history.normalization.unicodeVersion);
  const pin = f.sourcePin.document; assert.ok(bundle.objectFiles); assert.deepEqual(Object.keys(bundle.objectFiles).sort(), pin.objects.map(o => o.key).sort());
  const objects = withAmazonPqaReleaseAccessV2(history, pin, () => {
    const result = new Map<string, Buffer>(); for (const object of pin.objects) {
      const ref = bundle.objectFiles![object.key]!; assert.equal(ref.fileSha256, object.sha256);
      sourceReadAttempt();
      const bytes = readFileSync(file(ref.path, root)); assert.equal(bytes.length, object.bytes); assert.equal(hash(bytes), object.sha256); result.set(object.key, bytes);
    } return result;
  });
  const p = f.protocol.document, parsed = parseAmazonPqaReleaseV2(pin, objects, p.maxInspectedRecords);
  const projection: AmazonPqaExposureHistory = { ...Object.fromEntries(['productIds', 'canonicalFamilyTitles', 'modelIdentifiers', 'sourceBodyFingerprints', 'sourcePacketFingerprints'].map(k => [k, history[k]])) as AmazonPqaExposureHistory,
    normalization: { id: 'python_nfkc_casefold_whitespace_v1', pythonVersion: history.normalization.pythonVersion, unicodeVersion: history.normalization.unicodeVersion } };
  return screenAmazonPqaReleaseV2({ sourcePin: pin, parsed, history: projection, mode: 'prospective_source_screening', policy: {
    maxInspectedRecords: p.maxInspectedRecords, targetPackets: p.targetPackets, maxParents: p.maxParents, maxBodyUtf16Units: p.maxBodyUtf16Units, maxQuestionUtf16Units: p.maxQuestionUtf16Units, maxTitleUtf16Units: p.maxTitleUtf16Units } }) as unknown as AmazonPqaScreening;
}
/** An attempted source read commits the entire frame even if later machinery
 * fails before a recognized strict-parser projection can be returned. */
export function amazonPqaFailureArtifactV4(freeze: AmazonPqaFreezeV4, error: unknown, sourceReadAttempted: boolean) {
  if (!sourceReadAttempted) return null;
  const typed = error instanceof AmazonPqaReleaseParseErrorV2 ? error : null;
  return { format: 'ablatrix-amazon-pqa-semantic-access-failure-v4', status: typed ? 'source_parse_failed' : 'source_processing_failed', freezeSha256: freeze.sha256,
    sourcePinFileSha256: freeze.sourcePin.fileSha256, nativeSourcePinSha256: freshSeal(freeze.sourcePin.document), sourcePrefixes: freeze.sourcePin.document.objects,
    sourceReadAttempted: true, semanticRowsInspected: typed?.inspectedRows ?? null, validDecodedRows: typed?.validDecodedRows ?? null,
    consumedExposure: typed?.consumedExposure ?? null, normalization: typed?.normalization ?? null,
    withheldAggregateFingerprints: typed?.withheldAggregateFingerprints ?? [], unmappedSemanticExposure: !typed,
    wholePrefixConsumed: true, errorCode: typed?.stage ?? 'unclassified_processing_failure', eligiblePackets: 0, selection: null, contexts: null,
    providerCalls: 0, generatedAnswers: 0, humanSourceCheckedAnswers: 0, qualityClaimEligible: false, activationAuthorized: false, paidExecutionAuthorized: false, paidPlan: null,
    stopReason: 'source_processing_failed_no_replacement', limitation: 'The entire exact third-frame byte commitment is consumed, including every unmapped byte. Infrastructure failure does not permit rescue, reseeding or same-frame fresh reuse. Raw error messages and source bodies are never included.' };
}
function flags(argv: string[]) {
  const parsed = new Map<string, string>(); for (let i = 0; i < argv.length; i += 2) {
    assert.ok(['--input', '--out'].includes(argv[i]!) && argv[i + 1] && !parsed.has(argv[i]!)); parsed.set(argv[i]!, argv[i + 1]!);
  } assert.ok(parsed.has('--input')); return parsed;
}
export async function amazonPqaValidationCliV4(argv: string[], root = repository) {
  if (!argv.length) return { usage: '--freeze|--access-request|--screen|--review-request|--select|--prepare|--report|--verify --input PRIVATE_JSON [--out NEW_ABSOLUTE]', providerCalls: 0, freshInputReads: 0, paidExecutionAuthorized: false };
  const [mode, ...rest] = argv; assert.ok(['--freeze', '--access-request', '--screen', '--review-request', '--select', '--prepare', '--report', '--verify'].includes(mode!));
  const parsed = flags(rest), output = parsed.get('--out'); assert.equal(Boolean(output), mode !== '--verify');
  if (output) { newOutput(output); if (mode === '--screen') newOutput(`${output}.semantic-attempt.json`); }
  const oldFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('Offline APQA v4 cannot download or dispatch.'); };
  try {
    if (mode === '--freeze') {
      const spec = read<{ protocol: string; sourcePin: string; history: string; historicalInputs: string[]; codePaths?: string[] }>(parsed.get('--input')!, root).document;
      const codePaths = amazonPqaImplementationPathsV4(root); if (spec.codePaths) assert.deepEqual([...spec.codePaths].sort(), codePaths);
      const freeze = freezeAmazonPqaV4({ protocol: read<AmazonPqaProtocolV4>(spec.protocol, root), sourcePin: read(spec.sourcePin, root) as AmazonPqaFreezeV4['sourcePin'], history: read(spec.history, root),
        historicalInputs: spec.historicalInputs.map(path => read(path, root)), implementationSha256: Object.fromEntries(codePaths.map(path => [path, hash(readFileSync(file(path, root)))])) });
      for (const a of [freeze.protocol, freeze.sourcePin, freeze.history, ...freeze.historicalInputs]) assert.deepEqual(bound(a, root).document, a.document);
      modelAssets(freeze.protocol.document, root); return save(output!, freeze);
    }
    const bundleArtifact = read<Bundle>(parsed.get('--input')!, root), bundle = bundleArtifact.document;
    assert.equal(bundle.format, 'ablatrix-amazon-pqa-workflow-input-v4'); const freeze = currentFreeze(bundle.freeze, root);
    if (mode === '--access-request') return save(output!, { format: 'ablatrix-amazon-pqa-source-access-request-v4', freezeSha256: freeze.sha256, freeze,
      prospectiveCompleteRowsInspected: 0, executionRuntime: AMAZON_PQA_RUNTIME_V4, providerCalls: 0, humanSourceCheckedAnswers: 0, qualityClaimEligible: false,
      preFreezeBoundaryExclusion: (freeze.protocol.document as AmazonPqaProtocolV4 & { preFreezeBoundaryExclusion?: unknown }).preFreezeBoundaryExclusion ?? null,
      instruction: 'Review exact third-frame native bytes, both consumed whole frames, resolved boundary exclusion, current full code and cached assets. Two independent source-aware AI reviews plus third adjudication precede prospective complete rows. V1 projection is source eligibility only; actual comparison arms are v6 and v7.' });
    let actual: AmazonPqaScreening, sourceReadAttempted = false;
    try { actual = screen(freeze, bundle, root, () => {
      if (mode === '--screen' && !sourceReadAttempted) journalAmazonPqaSemanticAttemptV4(output!, freeze,
        { path: bundleArtifact.path, fileSha256: bundleArtifact.fileSha256 }, bundle.freeze, bundle.objectFiles!);
      sourceReadAttempted = true;
    }); }
    catch (error) {
      const failure = mode === '--screen' ? amazonPqaFailureArtifactV4(freeze, error, sourceReadAttempted) : null;
      if (!failure) throw error;
      return { ...save(output!, failure), failed: true };
    }
    if (mode === '--screen') return save(output!, actual);
    const screening = bound<AmazonPqaScreening>(bundle.screening!, root); assert.deepEqual(screening.document, actual, 'Saved source screening must reconstruct exactly before every later stage.');
    if (mode === '--review-request') return save(output!, amazonPqaEligibilityRequestV4(freeze, screening));
    const reviews = (bundle.eligibilityReviews ?? []).map(ref => bound<AmazonPqaEligibilityReviewV4>(ref, root)), selection = selectAmazonPqaCasesV4(freeze, screening, reviews);
    if (mode === '--select') return save(output!, selection);
    assert.deepEqual(bound<AmazonPqaSelectionV4>(bundle.selection!, root).document, selection);
    if (mode === '--prepare') {
      const retriever = new ProductRetriever(amazonPqaCorpusV4(freeze, screening, selection), ':memory:', { cachedOnly: true });
      try { return save(output!, await prepareAmazonPqaComparisonV4(freeze, screening, reviews, selection, retriever, cachedCrossEncoder())); } finally { retriever.close(); }
    }
    const comparison = bundle.comparison ? bound<AmazonPqaComparisonV4>(bundle.comparison, root).document : undefined;
    if (comparison) await verifyAmazonPqaComparisonV4(freeze, screening, reviews, selection, comparison);
    if (mode === '--verify') return { verified: true, freezeSha256: freeze.sha256, comparisonVerified: Boolean(comparison), providerCalls: 0, paidExecutionAuthorized: false };
    return save(output!, reportAmazonPqaV4(freeze, screening, selection, comparison));
  } finally { globalThis.fetch = oldFetch; }
}
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(await amazonPqaValidationCliV4(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
