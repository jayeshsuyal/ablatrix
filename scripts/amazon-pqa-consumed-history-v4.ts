/** Offline historical custody only. No source acquisition or fresh selection. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { amazonPqaArtifact, type AmazonPqaArtifact } from '../server/amazon-pqa-validation-v1.ts';
import { AmazonPqaReleaseParseErrorV2, validateAmazonPqaReleasePinV2, projectAmazonPqaReleaseBoundaryV2, type AmazonPqaReleasePinV2, type AmazonPqaReleaseParseV2 } from '../server/amazon-pqa-release-v2.ts';
import { amazonPqaImplementationPathsRuntimeV3 } from './amazon-pqa-validation-runtime-v3.ts';
import { mapAmazonPqaConsumedFrameV4, unionAmazonPqaConsumedHistoryV4, resolveAmazonPqaConsumedHistoryV4, type ConsumedFrameReplayV4 } from '../server/amazon-pqa-consumed-history-v4.ts';
type Json = Record<string, any>;
type Ref = { path: string; fileSha256: string };
type Input = { format: 'ablatrix-amazon-pqa-consumed-frame-input-v4'; priorHistory: Ref; priorResolvedPrefixProjection: Ref; leadingBoundary: Ref;
  sourcePin: Ref; consumedFrame: Ref; screening: Ref; objectFiles: Record<string, Ref> };
const repository = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const digest = (raw: Buffer | string) => createHash('sha256').update(raw).digest('hex');
function file(root: string, name: string, maximum = 128 * 1024 * 1024) {
  const full = resolve(root, name), rel = relative(root, full); assert.ok(rel && !isAbsolute(rel) && !rel.split(/[\\/]/).includes('..'), 'Artifacts and code must stay inside the exact checkout.');
  const stat = lstatSync(full); assert.ok(stat.isFile() && !stat.isSymbolicLink() && realpathSync(full) === full && stat.size <= maximum, 'Canonical bounded regular files required.'); return full;
}
function read<T = Json>(root: string, path: string): AmazonPqaArtifact<T> { return amazonPqaArtifact<T>(path, readFileSync(file(root, path), 'utf8')); }
function bound<T = Json>(root: string, ref: Ref) { assert.ok(ref && /^[a-f0-9]{64}$/.test(ref.fileSha256)); const result = read<T>(root, ref.path); assert.equal(result.fileSha256, ref.fileSha256, 'Historical raw artifact bytes changed.'); return result; }
export function amazonPqaConsumedHistoryPathsV4(root = repository) {
  return [...new Set([...amazonPqaImplementationPathsRuntimeV3(root), 'server/amazon-pqa-consumed-history-v4.ts', 'scripts/amazon-pqa-consumed-history-v4.ts'])].sort();
}
function implementation(root: string) { return Object.fromEntries(amazonPqaConsumedHistoryPathsV4(root).map(path => [path, digest(readFileSync(file(root, path)))])); }
function checkedImplementation(root: string, saved: Record<string, string>) { assert.deepEqual(saved, implementation(root), 'The exact historical replay implementation closure changed.'); }
function priorHistoryProof(root: string, prior: AmazonPqaArtifact<Json>) {
  const proof = JSON.parse(execFileSync('python3', ['-I', 'scripts/prepare-amazon-pqa-history-runtime-v3.py', '--verify', prior.path], {
    cwd: root, env: { PATH: process.env.PATH ?? '' }, timeout: 300_000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' }));
  assert.equal(proof.format, 'ablatrix-amazon-pqa-history-proof-v2'); assert.equal(proof.historyFileSha256, prior.fileSha256); assert.equal(proof.providerCalls, 0); return proof;
}
export function mapAmazonPqaConsumedFilesV4(root: string, input: AmazonPqaArtifact<Input>) {
  assert.equal(input.document.format, 'ablatrix-amazon-pqa-consumed-frame-input-v4'); const d = input.document;
  const implementationSha256 = implementation(root);
  const priorHistory = bound(root, d.priorHistory), sourcePin = bound<AmazonPqaReleasePinV2>(root, d.sourcePin), consumedFrame = bound(root, d.consumedFrame), screening = bound(root, d.screening),
    priorResolvedPrefixProjection = bound(root, d.priorResolvedPrefixProjection), leadingBoundary = bound(root, d.leadingBoundary);
  priorHistoryProof(root, priorHistory);
  // The prior proof precedes any cached source path read. These exact bytes are
  // already whole-frame exposure; no later caller may reinterpret them as fresh.
  validateAmazonPqaReleasePinV2(sourcePin.document); assert.equal(consumedFrame.document.wholeFrameConsumed, true); assert.equal(consumedFrame.document.freshReuseEligible, false);
  assert.equal(consumedFrame.document.sourceScreeningFileSha256, screening.fileSha256);
  assert.deepEqual(consumedFrame.document.sourcePrefixes, sourcePin.document.objects);
  assert.deepEqual(Object.keys(d.objectFiles).sort(), sourcePin.document.objects.map(o => o.key).sort());
  const objects = new Map<string, Buffer>(); for (const object of sourcePin.document.objects) {
    const ref = d.objectFiles[object.key]!; assert.equal(ref.fileSha256, object.sha256); const raw = readFileSync(file(root, ref.path, 64 * 1024 * 1024));
    assert.equal(raw.length, object.bytes); assert.equal(digest(raw), object.sha256); objects.set(object.key, raw);
  }
  const mapped = mapAmazonPqaConsumedFrameV4({ priorHistory, priorResolvedPrefixProjection, leadingBoundary, sourcePin, consumedFrame, screening, implementationSha256,
    input: { path: input.path, fileSha256: input.fileSha256 } }, objects);
  checkedImplementation(root, implementationSha256); return mapped;
}
function verifyMap(root: string, ref: Ref) {
  const saved = bound<ConsumedFrameReplayV4>(root, ref); checkedImplementation(root, saved.document.implementationSha256);
  const actual = mapAmazonPqaConsumedFilesV4(root, bound<Input>(root, saved.document.input)); assert.deepEqual(saved.document, actual, 'Whole consumed-frame mapping must replay exactly.'); return saved;
}
type BoundaryInput = { format: 'ablatrix-amazon-pqa-consumed-boundary-input-v4'; history: Ref; currentSourcePin: Ref; objectFiles: Record<string, Ref>; accessReviews?: Ref[] };
function boundaryMetadata(root: string, request: AmazonPqaArtifact<BoundaryInput>) {
  const d = request.document; assert.equal(d.format, 'ablatrix-amazon-pqa-consumed-boundary-input-v4');
  const history = bound(root, d.history), current = bound<AmazonPqaReleasePinV2>(root, d.currentSourcePin); validateAmazonPqaReleasePinV2(current.document);
  assert.equal(history.document.format, 'ablatrix-amazon-pqa-protected-history-v4'); assert.equal(history.document.completeHistoricalUnion, true);
  assert.equal(history.document.unresolvedPriorSemanticExposure, true); assert.equal(history.document.priorConsumedCompleteRowsMappingVerified, true);
  const frame = bound<ConsumedFrameReplayV4>(root, history.document.contracts.currentConsumedFrameReplay);
  const input = bound<Input>(root, frame.document.input), prior = bound<AmazonPqaReleasePinV2>(root, input.document.sourcePin); validateAmazonPqaReleasePinV2(prior.document);
  const previous = prior.document.objects[0]!, next = current.document.objects[0]!, trailing = frame.document.inspection.trailingFragment;
  assert.equal(frame.document.unresolvedTrailingRow, true); assert.ok(trailing && trailing.bytes > 0 && previous.range && next.range && trailing.endExclusive === next.range.start);
  assert.equal(previous.key, next.key); assert.equal(previous.versionId, next.versionId); assert.equal(previous.sourceBytes, next.sourceBytes); assert.equal(previous.range.endInclusive + 1, next.range.start);
  if (current.document.provenance === 'publisher_dataset') {
    assert.equal(previous.range.start, 16 * 1024 * 1024); assert.equal(previous.range.endInclusive, 32 * 1024 * 1024 - 1);
    assert.equal(next.range.start, 32 * 1024 * 1024); assert.equal(next.range.endInclusive, 48 * 1024 * 1024 - 1);
  }
  assert.deepEqual(Object.keys(d.objectFiles).sort(), current.document.objects.map(o => o.key).sort());
  const subject = { history: d.history, currentSourcePin: d.currentSourcePin, objectFiles: d.objectFiles, previousFrameReplay: history.document.contracts.currentConsumedFrameReplay,
    boundaryOnly: true, maximumCurrentLeadingBytes: 1024 * 1024, newCompleteRowsInspected: 0 };
  return { history, current, frame, input, prior, subject, reviewSubjectSha256: digest(JSON.stringify(subject)) };
}
function boundaryReviews(root: string, d: BoundaryInput, subjectSha256: string) {
  const reviews = (d.accessReviews ?? []).map(ref => bound(root, ref)); assert.equal(reviews.length, 3);
  assert.equal(new Set(reviews.map(r => r.fileSha256)).size, 3); assert.equal(new Set(reviews.map(r => String(r.document.reviewer).trim().toLowerCase())).size, 3);
  reviews.forEach((r, i) => { const v = r.document; assert.equal(v.format, 'ablatrix-amazon-pqa-consumed-boundary-review-v4'); assert.equal(v.reviewSubjectSha256, subjectSha256);
    assert.equal(v.provenance, 'independent_source_review_ai'); assert.equal(v.role, i === 2 ? 'adjudicator' : 'independent');
    assert.deepEqual(v.independentReviewFileSha256, i === 2 ? reviews.slice(0, 2).map(r => r.fileSha256) : []); assert.equal(v.decision, 'eligible');
    assert.ok(typeof v.sourceEvidence === 'string' && v.sourceEvidence.trim().length >= 40); assert.ok(Array.isArray(v.retainedUncertainty) && v.retainedUncertainty.every((x: unknown) => typeof x === 'string' && x.trim().length >= 5));
    if (i === 2) assert.ok(reviews.slice(0, 2).every(r => r.document.retainedUncertainty.every((x: string) => v.retainedUncertainty.includes(x))));
    assert.equal(v.providerCalls, 0); assert.equal(v.humanSourceCheckedAnswers, 0); assert.equal(v.qualityClaimEligible, false); assert.equal(v.activationAuthorized, false); assert.equal(v.paidPlan, null); }); return reviews;
}
function pinnedObjects(root: string, pin: AmazonPqaReleasePinV2, refs: Record<string, Ref>) {
  assert.deepEqual(Object.keys(refs).sort(), pin.objects.map(o => o.key).sort()); const result = new Map<string, Buffer>();
  for (const o of pin.objects) { assert.equal(refs[o.key]!.fileSha256, o.sha256); const bytes = readFileSync(file(root, refs[o.key]!.path, 64 * 1024 * 1024)); assert.equal(bytes.length, o.bytes); assert.equal(digest(bytes), o.sha256); result.set(o.key, bytes); } return result;
}
function repairBoundary(root: string, input: AmazonPqaArtifact<BoundaryInput>, alreadyVerified?: AmazonPqaArtifact<Json>): Json {
  const state = boundaryMetadata(root, input), reviews = boundaryReviews(root, input.document, state.reviewSubjectSha256);
  if (alreadyVerified) { assert.equal(alreadyVerified.fileSha256, state.history.fileSha256); assert.deepEqual(alreadyVerified.document, state.history.document); }
  else verifyHistory(root, input.document.history);
  const priorObjects = pinnedObjects(root, state.prior.document, state.input.document.objectFiles);
  // The mapped inspection is already replay-verified. The immutable projector
  // consumes only its exact trailing commitment and the new first physical line.
  const priorParsed: AmazonPqaReleaseParseV2 = { records: [], targetTaints: [], inspection: state.frame.document.inspection };
  const currentObjects = pinnedObjects(root, state.current.document, input.document.objectFiles), bytes = currentObjects.get(state.current.document.objects[0]!.key)!;
  const lf = bytes.indexOf(10); assert.ok(lf >= 0 && lf + 1 <= 1024 * 1024, 'The fixed frame must complete its leading boundary within one MiB.');
  const boundary = projectAmazonPqaReleaseBoundaryV2({ sourcePin: state.prior.document, objects: priorObjects, parsed: priorParsed }, { sourcePin: state.current.document, objects: currentObjects });
  return { format: 'ablatrix-amazon-pqa-consumed-boundary-repair-v4', input: { path: input.path, fileSha256: input.fileSha256 }, implementationSha256: implementation(root),
    historyFileSha256: state.history.fileSha256, currentSourcePinFileSha256: state.current.fileSha256, reviewSubjectSha256: state.reviewSubjectSha256, reviewFileSha256: reviews.map(r => r.fileSha256),
    boundary, currentLeadingBytesInspected: lf + 1, maximumCurrentLeadingBytes: 1024 * 1024, newCompleteRowsInspected: 0, boundaryNeverSelectable: true, sourceSelectionAllowed: false,
    providerCalls: 0, generatedAnswers: 0, humanSourceCheckedAnswers: 0, qualityClaimEligible: false, activationAuthorized: false, paidExecutionAuthorized: false, paidPlan: null };
}
function verifiedRepair(root: string, ref: Ref, alreadyVerified?: AmazonPqaArtifact<Json>) {
  const saved = bound(root, ref); checkedImplementation(root, saved.document.implementationSha256);
  assert.deepEqual(saved.document, repairBoundary(root, bound<BoundaryInput>(root, saved.document.input), alreadyVerified)); return saved;
}
function verifyHistory(root: string, ref: Ref): AmazonPqaArtifact<Json> {
  const saved = bound(root, ref); checkedImplementation(root, saved.document.implementationSha256); const c = saved.document.contracts;
  let history: Json;
  if (c.pendingHistory) { const pending = verifyHistory(root, c.pendingHistory); history = resolveAmazonPqaConsumedHistoryV4(pending, verifiedRepair(root, c.boundaryRepair, pending), implementation(root)); }
  else history = unionAmazonPqaConsumedHistoryV4(bound(root, c.priorRuntimeHistory), verifyMap(root, c.currentConsumedFrameReplay), implementation(root));
  assert.deepEqual(saved.document, history, 'The full prior union and all consumed boundary commitments must replay.'); return saved;
}
function outputPath(root: string, name: string) {
  const full = resolve(root, name), rel = relative(root, full); assert.ok(isAbsolute(name) && rel && !rel.split(/[\\/]/).includes('..') && !existsSync(full) && realpathSync(dirname(full)) === dirname(full));
  return full;
}
function save(root: string, name: string, document: unknown) {
  const full = outputPath(root, name);
  writeFileSync(full, JSON.stringify(document, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); return { output: full, fileSha256: digest(readFileSync(full)), providerCalls: 0, freshSelectionAllowed: false };
}
export async function amazonPqaConsumedHistoryCliV4(argv: string[], root = repository) {
  if (!argv.length) return { usage: '--map|--verify-map|--union|--verify-history|--boundary-request|--boundary-repair|--verify-repair|--resolve-history --input PRIVATE_JSON [--out NEW_ABSOLUTE]', providerCalls: 0, freshInputReads: 0, sourceSelectionAllowed: false };
  const [mode, ...rest] = argv; assert.ok(['--map', '--verify-map', '--union', '--verify-history', '--boundary-request', '--boundary-repair', '--verify-repair', '--resolve-history'].includes(mode!)); const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) { assert.ok(['--input', '--out'].includes(rest[i]!) && rest[i + 1] && !flags.has(rest[i]!)); flags.set(rest[i]!, rest[i + 1]!); }
  assert.ok(flags.has('--input')); assert.equal(flags.has('--out'), !['--verify-map', '--verify-history', '--verify-repair'].includes(mode!));
  if (flags.has('--out')) outputPath(root, flags.get('--out')!);
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('Consumed history preparation cannot acquire or dispatch.'); };
  try {
    if (mode === '--boundary-request') { const input = read<BoundaryInput>(root, flags.get('--input')!), state = boundaryMetadata(root, input);
      return save(root, flags.get('--out')!, { format: 'ablatrix-amazon-pqa-consumed-boundary-request-v4', reviewSubjectSha256: state.reviewSubjectSha256, subject: state.subject,
        priorHistory: state.history, currentSourcePin: state.current, instruction: 'Authorize only exclusion mapping of the already consumed second-frame trailing row joined to the third-frame first physical line, at most one MiB. No fresh complete row is selectable or decoded.', providerCalls: 0, sourceSelectionAllowed: false }); }
    if (mode === '--boundary-repair') return save(root, flags.get('--out')!, repairBoundary(root, read<BoundaryInput>(root, flags.get('--input')!)));
    if (mode === '--verify-repair') { const input = read(root, flags.get('--input')!), saved = verifiedRepair(root, input); return { format: 'ablatrix-amazon-pqa-consumed-boundary-proof-v4',
      fileSha256: saved.fileSha256, resolved: saved.document.boundary.resolved, newCompleteRowsInspected: 0, providerCalls: 0, sourceSelectionAllowed: false }; }
    if (mode === '--resolve-history') { const input = read(root, flags.get('--input')!); assert.equal(input.document.format, 'ablatrix-amazon-pqa-history-resolution-input-v4');
      const pending = verifyHistory(root, input.document.pendingHistory), repair = verifiedRepair(root, input.document.boundaryRepair, pending);
      return save(root, flags.get('--out')!, resolveAmazonPqaConsumedHistoryV4(pending, repair, implementation(root))); }
    if (mode === '--map') {
      const input = read<Input>(root, flags.get('--input')!);
      try { return save(root, flags.get('--out')!, mapAmazonPqaConsumedFilesV4(root, input)); }
      catch (error) { if (!(error instanceof AmazonPqaReleaseParseErrorV2)) throw error;
        return { ...save(root, flags.get('--out')!, { format: 'ablatrix-amazon-pqa-consumed-frame-failure-v4', input: { path: input.path, fileSha256: input.fileSha256 },
          sourcePinSha256: error.sourcePinSha256, semanticRowsInspected: error.inspectedRows, validDecodedRows: error.validDecodedRows, consumedExposure: error.consumedExposure,
          withheldAggregateFingerprints: error.withheldAggregateFingerprints, normalization: error.normalization, errorCode: error.stage, wholeFrameConsumed: true,
          unresolvedPriorSemanticExposure: true, sourceSelectionAllowed: false, providerCalls: 0, qualityClaimEligible: false, activationAuthorized: false, paidPlan: null }), status: 'strict_consumed_frame_mapping_failed' }; }
    }
    if (mode === '--verify-map') { const raw = read<ConsumedFrameReplayV4>(root, flags.get('--input')!), saved = verifyMap(root, raw);
      return { format: 'ablatrix-amazon-pqa-consumed-frame-proof-v4', fileSha256: saved.fileSha256, semanticRowsInspected: saved.document.semanticRowsInspected, completeRowsMapped: true,
        unresolvedTrailingRow: saved.document.unresolvedTrailingRow, providerCalls: 0, sourceSelectionAllowed: false }; }
    const input = read(root, flags.get('--input')!);
    if (mode === '--verify-history') { const history = verifyHistory(root, input).document;
      return { format: 'ablatrix-amazon-pqa-history-proof-v4', historyFileSha256: input.fileSha256, wholeConsumedFramesProtected: history.wholeConsumedFramesProtected,
        unresolvedPriorSemanticExposure: history.unresolvedPriorSemanticExposure, priorConsumedPrefixMappingVerified: history.priorConsumedPrefixMappingVerified,
        counts: Object.fromEntries(['productIds','canonicalFamilyTitles','modelIdentifiers','sourceBodyFingerprints','sourcePacketFingerprints'].map(k => [k, history[k].length])), providerCalls: 0, sourceSelectionAllowed: false }; }
    const refs = mode === '--union' ? input.document : input.document.contracts;
    if (mode === '--union') assert.equal(refs.format, 'ablatrix-amazon-pqa-history-union-input-v4');
    const prior = bound(root, refs.priorRuntimeHistory), frame = verifyMap(root, refs.currentConsumedFrameReplay);
    const history = unionAmazonPqaConsumedHistoryV4(prior, frame, implementation(root));
    if (mode === '--union') return save(root, flags.get('--out')!, history);
    throw new Error('Unsupported historical operation.');
  } finally { globalThis.fetch = originalFetch; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await amazonPqaConsumedHistoryCliV4(process.argv.slice(2)), null, 2)); }
  catch { console.error('Consumed APQA history stopped: changed, incomplete or unsupported historical evidence. No fresh source selection or provider call occurred.'); process.exitCode = 1; }
}
