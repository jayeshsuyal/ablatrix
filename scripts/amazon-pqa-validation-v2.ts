/** Native-release prospective boundary. Offline only; no replay can earn freshness. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ProductRetriever } from '../server/product-retrieval.ts';
import { cachedCrossEncoder } from '../server/semantic-reranker.ts';
import { canonicalAmazonPqaTextsV1, type AmazonPqaExposureHistory, type AmazonPqaExposure } from '../server/amazon-pqa-source-v1.ts';
import { AmazonPqaReleaseParseErrorV2, validateAmazonPqaReleasePinV2, parseAmazonPqaReleaseV2, projectAmazonPqaReleaseExposureV2, projectAmazonPqaReleaseFragmentsV2, projectAmazonPqaReleaseBoundaryV2, screenAmazonPqaReleaseV2, type AmazonPqaReleasePinV2, type AmazonPqaReleaseParseV2 } from '../server/amazon-pqa-release-v2.ts';
import { verifyAmazonPqaFreezeV1, type AmazonPqaFreeze } from '../server/amazon-pqa-validation-v1.ts';
import { freshSeal } from '../server/fresh-validation-v2.ts';
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
export function amazonPqaImplementationPathsV2(root = repository) {
  const found = new Set<string>(['package.json', 'package-lock.json']), pending = [...AMAZON_PQA_RELEASE_REQUIRED_CODE] as string[];
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
  for (const artifact of [freeze.protocol, freeze.sourcePin, freeze.history, ...freeze.historicalInputs]) assert.deepEqual(bound(artifact, root).document, artifact.document, 'Embedded native metadata differs from raw pinned bytes.');
  assert.deepEqual(Object.keys(freeze.implementationSha256).sort(), amazonPqaImplementationPathsV2(root));
  for (const [path, expected] of Object.entries(freeze.implementationSha256)) assert.equal(hash(readFileSync(file(path, root))), expected, 'Prospectively frozen native implementation changed.'); return freeze;
}
function modelAssets(protocol: AmazonPqaProtocolV2, root: string) {
  for (const [path, expected] of Object.entries(protocol.localModelAssetSha256)) assert.equal(hash(readFileSync(file(path, root, 128 * 1024 * 1024))), expected);
}
type ExposedReplayInput = { format: 'ablatrix-amazon-pqa-exposed-replay-input-v2'; sourcePin: Ref; priorFreeze: Ref; priorFailure: Ref; objectFiles: Record<string, Ref>; boundaryResolution?: Ref };
type ExposedReplayOutput = { format: 'ablatrix-amazon-pqa-exposed-prefix-replay-v2'; input: Ref; nativeSourcePin: AmazonPqaArtifact<AmazonPqaReleasePinV2>;
  consumedExposure: AmazonPqaExposure; inspection: AmazonPqaReleaseParseV2['inspection']; completeRowsMapped: true; completePrefixMapping: boolean; unresolvedBoundary: boolean; [key: string]: unknown };
type BoundaryInput = { format: 'ablatrix-amazon-pqa-boundary-repair-input-v2'; priorProjection: Ref; currentSourcePin: Ref; objectFiles: Record<string, Ref>; accessReviews?: Ref[] };
export type AmazonPqaBoundaryAccessReviewV2 = { format: 'ablatrix-amazon-pqa-boundary-access-review-v2'; reviewSubjectSha256: string; reviewer: string; provenance: 'independent_source_review_ai';
  role: 'independent' | 'adjudicator'; independentReviewFileSha256: string[]; decision: 'eligible' | 'reject' | 'uncertain'; sourceEvidence: string;
  retainedUncertainty: string[]; providerCalls: 0; humanSourceCheckedAnswers: 0; qualityClaimEligible: false; activationAuthorized: false; paidPlan: null };
function boundarySubject(input: BoundaryInput, root: string) {
  assert.equal(input.format, 'ablatrix-amazon-pqa-boundary-repair-input-v2');
  const prior = bound<ExposedReplayOutput>(input.priorProjection, root), current = bound<AmazonPqaReleasePinV2>(input.currentSourcePin, root);
  assert.equal(prior.document.format, 'ablatrix-amazon-pqa-exposed-prefix-replay-v2'); assert.equal(prior.document.developmentOnly, true); assert.equal(prior.document.completeRowsMapped, true);
  validateAmazonPqaReleasePinV2(prior.document.nativeSourcePin.document); validateAmazonPqaReleasePinV2(current.document);
  const previous = prior.document.nativeSourcePin.document.objects[0]!, next = current.document.objects[0]!;
  assert.equal(previous.key, next.key); assert.equal(previous.versionId, next.versionId); assert.equal(previous.sourceBytes, next.sourceBytes);
  assert.ok(previous.range && next.range && previous.range.endInclusive + 1 === next.range.start && prior.document.inspection.trailingFragment !== null, 'Only the already consumed trailing row and its exact adjacent committed interval can be repaired.');
  assert.equal(prior.document.unresolvedBoundary, true); assert.ok((prior.document.trailingFragmentBytes as number) > 0 && prior.document.inspection.trailingFragment.bytes > 0 && prior.document.inspection.trailingFragment.endExclusive === next.range.start, 'A nonempty consumed trailing fragment must reach the current interval before boundary-only access.');
  if (current.document.provenance === 'publisher_dataset') { assert.equal(previous.range.start, 0); assert.equal(previous.range.endInclusive, 16 * 1024 * 1024 - 1); assert.equal(next.range.start, 16 * 1024 * 1024); assert.equal(next.range.endInclusive, 32 * 1024 * 1024 - 1); }
  const subject = { priorProjection: input.priorProjection, currentSourcePin: input.currentSourcePin, objectFiles: input.objectFiles, boundaryOnly: true, maximumCurrentLeadingBytes: 1024 * 1024, newCompleteRows: 0 };
  return { prior, current, subject, reviewSubjectSha256: freshSeal(subject) };
}
function boundaryReviews(input: BoundaryInput, subjectSha256: string, root: string) {
  const reviews = (input.accessReviews ?? []).map(ref => bound<AmazonPqaBoundaryAccessReviewV2>(ref, root)); assert.equal(reviews.length, 3);
  assert.equal(new Set(reviews.map(r => r.fileSha256)).size, 3); assert.equal(new Set(reviews.map(r => r.document.reviewer.trim().toLowerCase())).size, 3);
  reviews.forEach((r, i) => { const d = r.document; assert.equal(d.format, 'ablatrix-amazon-pqa-boundary-access-review-v2'); assert.equal(d.reviewSubjectSha256, subjectSha256);
    assert.equal(d.provenance, 'independent_source_review_ai'); assert.equal(d.role, i === 2 ? 'adjudicator' : 'independent'); assert.deepEqual(d.independentReviewFileSha256, i === 2 ? reviews.slice(0, 2).map(r => r.fileSha256) : []);
    assert.equal(d.providerCalls, 0); assert.equal(d.humanSourceCheckedAnswers, 0); assert.equal(d.qualityClaimEligible, false); assert.equal(d.activationAuthorized, false); assert.equal(d.paidPlan, null);
    assert.ok(d.sourceEvidence.trim().length >= 40); assert.equal(d.decision, 'eligible', 'All independent boundary-only access judgments must qualify; disagreement stays closed.');
    assert.ok(Array.isArray(d.retainedUncertainty) && d.retainedUncertainty.every(x => typeof x === 'string' && x.trim().length >= 5));
    if (i === 2) assert.ok(reviews.slice(0, 2).every(r => r.document.retainedUncertainty.every(x => d.retainedUncertainty.includes(x))), 'Third review must retain every independent uncertainty.'); });
  return reviews;
}
function pinnedObjects(pin: AmazonPqaReleasePinV2, refs: Record<string, Ref>, root: string) {
  assert.deepEqual(Object.keys(refs).sort(), pin.objects.map(o => o.key).sort()); const objects = new Map<string, Buffer>();
  for (const object of pin.objects) { const ref = refs[object.key]!; assert.equal(ref.fileSha256, object.sha256); const bytes = readFileSync(file(ref.path, root)); assert.equal(bytes.length, object.bytes); assert.equal(hash(bytes), object.sha256); objects.set(object.key, bytes); } return objects;
}
export function repairAmazonPqaBoundaryV2(input: AmazonPqaArtifact<BoundaryInput>, root = repository) {
  const state = boundarySubject(input.document, root); const reviews = boundaryReviews(input.document, state.reviewSubjectSha256, root);
  const baseInput = bound<ExposedReplayInput>(state.prior.document.input, root); assert.equal(baseInput.document.boundaryResolution, undefined, 'Boundary repair starts from the original unresolved replay.');
  const replay = replayAmazonPqaExposedPrefixV2(baseInput, root); assert.deepEqual(state.prior.document, replay);
  const previous = bound<AmazonPqaReleasePinV2>(baseInput.document.sourcePin, root), previousObjects = pinnedObjects(previous.document, baseInput.document.objectFiles, root);
  const priorParsed = parseAmazonPqaReleaseV2(previous.document, previousObjects, 100_000);
  // Hash the next fixed frame opaquely, then decode only its first physical line
  // as part of the old row. No complete new-frame case is parsed here.
  const currentObjects = pinnedObjects(state.current.document, input.document.objectFiles, root), object = state.current.document.objects[0]!, bytes = currentObjects.get(object.key)!;
  assert.ok(object.range && object.range.start > 0); const newline = bytes.indexOf(10); assert.ok(newline >= 0, 'Boundary line must terminate within the frozen frame.');
  const leadingBytes = newline + 1; assert.ok(leadingBytes <= 1024 * 1024, 'Boundary-only semantic access is limited to the first 1 MiB physical line.');
  const boundary = projectAmazonPqaReleaseBoundaryV2({ sourcePin: previous.document, objects: previousObjects, parsed: priorParsed }, { sourcePin: state.current.document, objects: currentObjects });
  return { format: 'ablatrix-amazon-pqa-boundary-repair-v2' as const, input: { path: input.path, fileSha256: input.fileSha256 }, reviewSubjectSha256: state.reviewSubjectSha256,
    reviewFileSha256: reviews.map(r => r.fileSha256), priorProjectionFileSha256: state.prior.fileSha256, currentSourcePinFileSha256: state.current.fileSha256, boundary,
    newCompleteRowsInspected: 0, currentLeadingBytesInspected: leadingBytes, maximumCurrentLeadingBytes: 1024 * 1024, boundaryNeverSelectable: true,
    sourceEligibilityPassed: false, candidateContextInspected: false, answerOutputsInspected: false, providerCalls: 0, generatedAnswers: 0, qualityClaimEligible: false, activationAuthorized: false, paidExecutionAuthorized: false, paidPlan: null };
}
function verifiedBoundary(ref: Ref, root: string) {
  const saved = bound<ReturnType<typeof repairAmazonPqaBoundaryV2>>(ref, root), current = repairAmazonPqaBoundaryV2(bound<BoundaryInput>(saved.document.input, root), root);
  assert.deepEqual(saved.document, current, 'Boundary repair must replay from exact adjacent committed bytes and independent source reviews.'); return saved;
}
export function replayAmazonPqaExposedPrefixV2(input: AmazonPqaArtifact<ExposedReplayInput>, root = repository): ExposedReplayOutput {
  assert.equal(input.document.format, 'ablatrix-amazon-pqa-exposed-replay-input-v2');
  const source = bound<AmazonPqaReleasePinV2>(input.document.sourcePin, root), oldFreeze = bound<AmazonPqaFreeze>(input.document.priorFreeze, root), failed = bound<Record<string, unknown>>(input.document.priorFailure, root);
  verifyAmazonPqaFreezeV1(oldFreeze.document); assert.equal(failed.document.format, 'ablatrix-amazon-pqa-semantic-access-failure-v1'); assert.equal(failed.document.status, 'source_parse_failed');
  assert.equal(failed.document.wholePrefixConsumed, true); assert.equal(failed.document.freezeSha256, oldFreeze.document.sha256); assert.equal(failed.document.sourcePinFileSha256, oldFreeze.document.sourcePin.fileSha256);
  const nativeObjects = source.document.objects, previous = (oldFreeze.document.sourcePin.document as { objects: unknown[] }).objects;
  assert.deepEqual(nativeObjects, previous, 'Exposed replay can only reinterpret exactly the already consumed object/version/range/raw bytes.');
  assert.equal(nativeObjects[0]!.range?.start, 0); assert.ok(nativeObjects[0]!.bytes <= 16 * 1024 * 1024);
  assert.deepEqual(Object.keys(input.document.objectFiles).sort(), nativeObjects.map(o => o.key).sort());
  const objects = new Map<string, Buffer>(); for (const object of nativeObjects) { const ref = input.document.objectFiles[object.key]!; assert.equal(ref.fileSha256, object.sha256);
    const bytes = readFileSync(file(ref.path, root)); assert.equal(hash(bytes), object.sha256); assert.equal(bytes.length, object.bytes); objects.set(object.key, bytes); }
  const parsed = parseAmazonPqaReleaseV2(source.document, objects, 100_000), exposure = projectAmazonPqaReleaseExposureV2(parsed);
  assert.equal(parsed.inspection.unparsedTail, null, 'Full historical replay may not silently truncate an unparsed tail.');
  const fragment = parsed.inspection.trailingFragment, fragments = projectAmazonPqaReleaseFragmentsV2(source.document, objects, parsed);
  const consumedExposure = Object.fromEntries(Object.keys(exposure.consumedExposure).map(key => [key,
    [...new Set([...(exposure.consumedExposure[key as keyof typeof exposure.consumedExposure]), ...fragments.consumedExposure[key as keyof typeof fragments.consumedExposure]])].sort()])) as typeof exposure.consumedExposure;
  // Incomplete native rows stay quarantined. No unestablished identity can be
  // silently treated as mapped; a later verified boundary resolution is required.
  let unresolvedBoundary = fragment !== null;
  const aggregateAnnotations = new Set([...exposure.withheldAggregateFingerprints, ...fragments.withheldAggregateFingerprints]);
  const resolution = input.document.boundaryResolution ? verifiedBoundary(input.document.boundaryResolution, root) : undefined;
  if (resolution) { const repairInput = bound<BoundaryInput>(resolution.document.input, root); const original = bound<ExposedReplayOutput>(repairInput.document.priorProjection, root);
    assert.equal(original.document.nativeSourcePin.fileSha256, source.fileSha256); assert.equal(resolution.document.boundary.priorSourcePinSha256, freshSeal(source.document));
    assert.equal(resolution.document.boundary.resolved, true); assert.equal(resolution.document.boundary.bodyExposureComplete, true);
    for (const key of Object.keys(consumedExposure) as (keyof typeof consumedExposure)[]) consumedExposure[key] = [...new Set([...consumedExposure[key], ...resolution.document.boundary.consumedExposure[key]])].sort();
    resolution.document.boundary.withheldAggregateFingerprints.forEach(hash => aggregateAnnotations.add(hash));
    unresolvedBoundary = false;
  }
  const implementationSha256 = Object.fromEntries(amazonPqaImplementationPathsV2(root).map(path => [path, hash(readFileSync(file(path, root)))]));
  return { format: 'ablatrix-amazon-pqa-exposed-prefix-replay-v2' as const, input: { path: input.path, fileSha256: input.fileSha256 }, nativeSourcePin: source,
    priorFreezeFileSha256: oldFreeze.fileSha256, priorFailureFileSha256: failed.fileSha256, implementationSha256,
    sourcePrefixes: nativeObjects.map(o => ({ key: o.key, versionId: o.versionId, sha256: o.sha256, range: o.range })), consumedExposure, withheldAggregateFingerprints: [...aggregateAnnotations].sort(), normalization: exposure.normalization,
    semanticRowsInspected: parsed.inspection.completeRows, validDecodedRows: parsed.inspection.completeRows, inspection: parsed.inspection,
    completePrefixMapping: !unresolvedBoundary, completeRowsMapped: true, boundaryProjection: fragments, boundaryResolution: resolution ? { path: resolution.path, fileSha256: resolution.fileSha256 } : null,
    trailingFragmentBytes: fragment?.bytes ?? 0, recognizedBoundaryProductIds: fragments.trailing?.recognizedProductIds ?? [], unresolvedBoundary,
    developmentOnly: true, priorAttemptFailed: true, sourceEligibilityPassed: false, wholePrefixConsumed: true,
    candidateContextInspected: false, answerOutputsInspected: false, providerCalls: 0, generatedAnswers: 0, humanSourceCheckedAnswers: 0, qualityClaimEligible: false, activationAuthorized: false, paidExecutionAuthorized: false, paidPlan: null,
    calculationProjectionContract: AMAZON_PQA_V2_PROJECTION, mappingSha256: freshSeal([source.fileSha256, consumedExposure, parsed.inspection, fragments]) };
}
function screen(freeze: AmazonPqaFreezeV2, bundle: Bundle, root: string): AmazonPqaScreening {
  const access = (bundle.accessReviews ?? []).map(ref => bound<AmazonPqaAccessReviewV2>(ref, root)); assert.equal(reviewAmazonPqaAccessV2(freeze, access).sourceAccessAllowed, true, 'Native source-access review must qualify before source-path access.');
  const history = freeze.history.document as AmazonPqaExposureHistory & Record<string, unknown> & { normalization: { pythonVersion: string; unicodeVersion: string } };
  assert.equal(history.format, 'ablatrix-amazon-pqa-protected-history-v2'); assert.equal(history.priorConsumedPrefixMappingVerified, true);
  const proof = JSON.parse(execFileSync('python3', ['-I', 'scripts/prepare-amazon-pqa-history-v2.py', '--verify', freeze.history.path], { cwd: root, env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 30_000, maxBuffer: 1_048_576 }));
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
export async function amazonPqaValidationCliV2(argv: string[], root = repository) {
  if (!argv.length) return { usage: '--exposed-replay|--verify-exposed|--boundary-request|--boundary-repair|--verify-boundary|--freeze|--access-request|--screen|--review-request|--select|--prepare|--report|--verify --input PRIVATE_JSON [--out NEW_ABSOLUTE]', providerCalls: 0, freshInputReads: 0, paidExecutionAuthorized: false };
  const [mode, ...rest] = argv; assert.ok(['--exposed-replay', '--verify-exposed', '--boundary-request', '--boundary-repair', '--verify-boundary', '--freeze', '--access-request', '--screen', '--review-request', '--select', '--prepare', '--report', '--verify'].includes(mode!));
  const flags = parseFlags(rest), output = flags.get('--out'); assert.equal(Boolean(output), !['--verify', '--verify-exposed', '--verify-boundary'].includes(mode!));
  if (mode === '--boundary-request') { const input = read<BoundaryInput>(flags.get('--input')!, root), state = boundarySubject(input.document, root);
    return save(output!, { format: 'ablatrix-amazon-pqa-boundary-access-request-v2', reviewSubjectSha256: state.reviewSubjectSha256, subject: state.subject,
      priorProjection: state.prior, currentSourcePin: state.current, instruction: 'Authorize only joining the consumed prior tail to the next committed first physical line, at most 1 MiB. No complete new-frame cases may be decoded. Native boundary is exclusion-only and never selectable.',
      newCompleteRowsInspected: 0, providerCalls: 0, humanSourceCheckedAnswers: 0, qualityClaimEligible: false }); }
  if (mode === '--boundary-repair') return save(output!, repairAmazonPqaBoundaryV2(read<BoundaryInput>(flags.get('--input')!, root), root));
  if (mode === '--verify-boundary') { const saved = read<ReturnType<typeof repairAmazonPqaBoundaryV2>>(flags.get('--input')!, root), actual = repairAmazonPqaBoundaryV2(bound<BoundaryInput>(saved.document.input, root), root);
    assert.deepEqual(saved.document, actual); return { format: 'ablatrix-amazon-pqa-boundary-proof-v2', boundaryFileSha256: saved.fileSha256, resolved: actual.boundary.resolved, bodyExposureComplete: actual.boundary.bodyExposureComplete, newCompleteRowsInspected: 0, sourceEligibilityPassed: false, providerCalls: 0 }; }
  if (mode === '--exposed-replay') return save(output!, replayAmazonPqaExposedPrefixV2(read<ExposedReplayInput>(flags.get('--input')!, root), root));
  if (mode === '--verify-exposed') { const saved = read<ReturnType<typeof replayAmazonPqaExposedPrefixV2>>(flags.get('--input')!, root), actual = replayAmazonPqaExposedPrefixV2(bound<ExposedReplayInput>(saved.document.input, root), root);
    assert.deepEqual(saved.document, actual, 'Complete exposed-prefix mapping must reconstruct from exact native bytes and code.');
    return { verified: true, format: 'ablatrix-amazon-pqa-exposed-prefix-proof-v2', projectionFileSha256: saved.fileSha256, completePrefixMapping: actual.completePrefixMapping, unresolvedBoundary: actual.unresolvedBoundary, semanticRowsInspected: actual.semanticRowsInspected, sourceEligibilityPassed: false, providerCalls: 0 }; }
  if (mode === '--freeze') {
    const spec = read<{ protocol: string; sourcePin: string; history: string; historicalInputs: string[]; codePaths?: string[] }>(flags.get('--input')!, root).document;
    const codePaths = amazonPqaImplementationPathsV2(root); if (spec.codePaths) assert.deepEqual([...spec.codePaths].sort(), codePaths);
    const freeze = freezeAmazonPqaV2({ protocol: read<AmazonPqaProtocolV2>(spec.protocol, root), sourcePin: read(spec.sourcePin, root) as AmazonPqaFreezeV2['sourcePin'], history: read(spec.history, root), historicalInputs: spec.historicalInputs.map(path => read(path, root)),
      implementationSha256: Object.fromEntries(codePaths.map(path => [path, hash(readFileSync(file(path, root)))])) }); modelAssets(freeze.protocol.document, root); return save(output!, freeze);
  }
  const bundle = read<Bundle>(flags.get('--input')!, root).document; assert.equal(bundle.format, 'ablatrix-amazon-pqa-workflow-input-v2'); const freeze = currentFreeze(bundle.freeze, root);
  if (mode === '--access-request') return save(output!, { format: 'ablatrix-amazon-pqa-source-access-request-v2', freezeSha256: freeze.sha256, freeze, semanticRowsInspected: 0,
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
  try { console.log(JSON.stringify(await amazonPqaValidationCliV2(process.argv.slice(2)), null, 2)); }
  catch { console.error('Native APQA preparation stopped: invalid, changed, unqualified or unavailable offline input. No provider calls were made.'); process.exitCode = 1; }
}
