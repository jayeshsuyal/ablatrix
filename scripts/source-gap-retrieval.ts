import assert from 'node:assert/strict';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ProductRetriever } from '../server/product-retrieval.ts';
import { workspaceCompleteSourceContext } from '../server/workspace-retrieval-context.ts';
import { workspaceSourceCoverageContext } from '../server/workspace-source-coverage.ts';
import { WORKSPACE_SOURCE_COVERAGE_CONTRACT } from '../server/workspace-source-coverage.ts';
import { WORKSPACE_GENERATION_CONTRACT, workspaceGenerationPromptIdentity } from '../server/workspace-generation.ts';
import { contextComparisonHash } from '../server/context-comparison.ts';
import {
  SOURCE_GAP_CODE_FILES, SOURCE_GAP_PARTIAL_CODE_FILES, SOURCE_GAP_SEED, isSourceGapPartial, verifySourceGapCounts, verifySourceGapPartialPool, sourceGapPartialInputArtifacts, retrievalCoverageCorpus, sourceCalibrationHash as hash,
  sourceGapBaselineContextHash, verifySourceGapAssemblyAudit, verifySourceGapBaseline,
  type SourceCalibrationArtifact,
} from '../server/source-calibration-comparison.ts';
import type { RetrievalResult } from '../server/loop-types.ts';

type Json = Record<string, any>;
export type SourceGapBaselineScope = 'screening_deck' | 'screening_pool' | 'selected_cohort';
type LocalRetriever = { retrieve(productId: string, question: string): Promise<RetrievalResult> };
const encode = (document: unknown) => `${JSON.stringify(document, null, 2)}\n`;
const repository = resolve(fileURLToPath(new URL('../', import.meta.url)));
function implementation(values: Record<string, string>, partial = false) {
  const files = partial ? SOURCE_GAP_PARTIAL_CODE_FILES : SOURCE_GAP_CODE_FILES;
  assert.deepEqual(Object.keys(values).sort(), [...new Set(files)].sort(), 'The complete source-gap implementation map is required.');
  for (const path of files) assert.match(values[path] ?? '', /^[a-f0-9]{64}$/, `Missing implementation binding: ${path}`);
}
function verifyEmbeddedFreeze(input: SourceCalibrationArtifact, current: Record<string, string>) {
  const partial = isSourceGapPartial(input.document); implementation(current, partial);
  if (partial) verifySourceGapPartialPool(input.document.format === 'ablatrix-source-gap-exposed-pool-v1' ? input : input.document.selection.inputArtifacts.pool, current);
  const frozen = input.document.candidateFreeze;
  assert.ok(frozen && typeof frozen === 'object', 'Missing embedded candidate freeze.');
  assert.deepEqual(Object.keys(frozen).sort(), ['path', 'fileSha256', 'document'].sort(), 'Invalid embedded candidate freeze artifact.');
  assert.ok(typeof frozen.path === 'string' && frozen.path && !isAbsolute(frozen.path) && !frozen.path.split('/').includes('..') && !frozen.path.includes('\\'), 'Invalid embedded candidate freeze path.');
  assert.match(frozen.fileSha256, /^[a-f0-9]{64}$/, 'Invalid embedded candidate freeze hash.');
  const { createdAt, implementationSha256, ...fields } = frozen.document;
  assert.deepEqual(fields, { format: partial ? 'ablatrix-source-gap-partial-candidate-freeze-v1' : 'ablatrix-source-gap-candidate-freeze-v1', frozen: true, status: 'experimental_not_promoted',
    retrievalContract: WORKSPACE_SOURCE_COVERAGE_CONTRACT, generationContract: WORKSPACE_GENERATION_CONTRACT,
    systemInstructionsSha256: workspaceGenerationPromptIdentity(WORKSPACE_GENERATION_CONTRACT).systemInstructionsSha256,
    selectionSeed: SOURCE_GAP_SEED, qualityClaimEligible: false }, 'The embedded candidate freeze differs from the fixed source-gap contract.');
  const timestamp = typeof createdAt === 'string' ? createdAt.match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/) : null;
  assert.ok(timestamp && Number.isFinite(Date.parse(createdAt)) && Number(timestamp[2]) >= 1 && Number(timestamp[2]) <= 12 &&
    Number(timestamp[3]) >= 1 && Number(timestamp[3]) <= new Date(Date.UTC(Number(timestamp[1]), Number(timestamp[2]), 0)).getUTCDate(), 'The embedded candidate freeze needs a valid ISO timestamp with timezone.');
  assert.deepEqual(implementationSha256, current, 'The embedded candidate freeze implementation changed before local retrieval or assembly.');
}
function inputCases(input: SourceCalibrationArtifact, scope: SourceGapBaselineScope): Json[] {
  assert.ok(scope === 'screening_deck' || scope === 'screening_pool' || scope === 'selected_cohort');
  const document = input.document, partial = isSourceGapPartial(document), seal = scope === 'screening_pool' ? 'poolSha256' : scope === 'screening_deck' ? 'deckSha256' : 'cohortSha256';
  assert.equal(document.format, scope === 'screening_pool' ? 'ablatrix-source-gap-exposed-pool-v1' : scope === 'screening_deck' ? 'ablatrix-source-gap-deck-v1' : partial ? 'ablatrix-source-gap-partial-cohort-v1' : 'ablatrix-source-gap-cohort-v1');
  assert.equal(document[seal], contextComparisonHash(Object.fromEntries(Object.entries(document).filter(([key]) => key !== seal))), 'Source-gap input seal changed.');
  assert.match(input.fileSha256, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(document.cases));
  if (scope === 'screening_pool') assert.ok(document.cases.length >= 4 && document.cases.length < 64); else if (!partial) assert.equal(document.cases.length, scope === 'screening_deck' ? 64 : 8);
  assert.equal(new Set(document.cases.map((item: Json) => item.id)).size, document.cases.length);
  assert.equal(new Set(document.cases.map((item: Json) => item.product.id.toUpperCase())).size, document.cases.length);
  if (scope === 'selected_cohort') verifySourceGapCounts(document.cases, partial);
  for (const item of document.cases) {
    assert.ok(typeof item.id === 'string' && item.id.length > 0 && typeof item.question === 'string' && item.question.trim().length > 0);
    assert.ok(Array.isArray(item.sources) && item.sources.length > 0 && item.sources.length <= 128);
    assert.equal(item.sourcePoolSha256, contextComparisonHash(item.sources));
  }
  return document.cases;
}
function sourceProduct(item: Json) { return { ...item.product, sources: item.sources.map((source: Json) => ({ ...source, originalQuestion: source.originalQuestion ?? undefined })) }; }

/** Baseline-only local ranking. No candidate function is invoked in either
 * screening or final-baseline mode; the selected corpus is ranked afresh. */
export async function freezeSourceGapBaseline(input: SourceCalibrationArtifact, scope: SourceGapBaselineScope, implementationSha256: Record<string, string>, retriever: LocalRetriever) {
  verifyEmbeddedFreeze(input, implementationSha256);
  const frozen = structuredClone(input), bindings = structuredClone(implementationSha256);
  const cases = inputCases(frozen, scope); implementation(bindings, isSourceGapPartial(frozen.document));
  const corpus = retrievalCoverageCorpus(frozen), results = [];
  for (const item of cases) {
    const indexRetrieval = structuredClone(await retriever.retrieve(item.product.id, item.question));
    assert.equal(indexRetrieval.corpusVersion, corpus.version);
    const passages = workspaceCompleteSourceContext(sourceProduct(item), corpus, indexRetrieval);
    assert.ok(passages.length > 0 && indexRetrieval.passages.length <= 5);
    const baseline = { ...indexRetrieval, passages };
    results.push({ caseId: item.id, indexRetrieval, baseline, baselineContextSha256: sourceGapBaselineContextHash(item.product, item.question, passages) });
  }
  const body = { format: 'ablatrix-source-gap-baseline-v1', scope, inputFileSha256: frozen.fileSha256, corpusSha256: hash(corpus), implementationSha256: bindings, results,
    providerCalls: 0, generationPerformed: false, candidateContextInspected: false };
  const document = { ...body, sha256: hash(body) };
  verifySourceGapBaseline(frozen, { path: 'baseline.json', fileSha256: hash(encode(document)), document }, bindings);
  return document;
}

/** Assembly reuses the saved final index retrieval. The passed independent
 * audit is checked before the first candidate call; no ranking is rerun. */
export function assembleSourceGapCandidate(cohort: SourceCalibrationArtifact, finalBaseline: SourceCalibrationArtifact, familyAudit: SourceCalibrationArtifact, implementationSha256: Record<string, string>) {
  verifyEmbeddedFreeze(cohort, implementationSha256);
  const packet = structuredClone(cohort), saved = structuredClone(finalBaseline), audit = structuredClone(familyAudit), bindings = structuredClone(implementationSha256);
  const cases = inputCases(packet, 'selected_cohort'); implementation(bindings, isSourceGapPartial(packet.document));
  verifySourceGapBaseline(packet, saved, bindings);
  verifySourceGapAssemblyAudit(packet, saved, audit);
  const corpus = retrievalCoverageCorpus(packet);
  const results = cases.map((item, index) => {
    const row = saved.document.results[index]; assert.equal(row.caseId, item.id);
    const product = sourceProduct(item), baseline = workspaceCompleteSourceContext(product, corpus, row.indexRetrieval);
    assert.deepEqual(row.baseline, { ...row.indexRetrieval, passages: baseline });
    const candidate = workspaceSourceCoverageContext(product, corpus, row.indexRetrieval, item.question);
    assert.deepEqual(candidate.passages.slice(0, baseline.length), baseline);
    return { caseId: item.id, indexRetrieval: structuredClone(row.indexRetrieval), baseline: structuredClone(row.baseline),
      candidate: { ...row.indexRetrieval, passages: candidate.passages }, additions: candidate.additions, contract: candidate.contract };
  });
  const body = { format: isSourceGapPartial(packet.document) ? 'source-gap-partial-retrieval-v1' : 'source-gap-retrieval-v1', cohortFileSha256: packet.fileSha256, implementationSha256: bindings, corpusSha256: hash(corpus), familyAuditFileSha256: audit.fileSha256,
    inputArtifacts: { finalBaseline: saved }, results, providerCalls: 0, semanticAssessment: 'not_run', generationPerformed: false };
  return { ...body, sha256: hash(body) };
}

function inside(path: string) { const value = resolve(path), rel = relative(repository, value); assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Artifact must remain in this repository.'); return value; }
function readArtifact(argument: string): SourceCalibrationArtifact {
  const path = inside(argument); assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() && realpathSync(path) === path, 'Use canonical regular artifact files.');
  const raw = readFileSync(path); return { path: relative(repository, path), fileSha256: hash(raw), document: JSON.parse(raw.toString()) };
}
function codeHashes(partial = false) { return Object.fromEntries((partial ? SOURCE_GAP_PARTIAL_CODE_FILES : SOURCE_GAP_CODE_FILES).map(path => [path, hash(readFileSync(resolve(repository, path)))])); }
function writeNew(argument: string, document: unknown) {
  const path = inside(argument); assert.ok(!existsSync(path), 'Preserve existing source-gap snapshots.');
  let ancestor = dirname(path); while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  assert.equal(realpathSync(ancestor), ancestor, 'Output ancestors must be canonical.');
  mkdirSync(dirname(path), { recursive: true }); assert.equal(realpathSync(dirname(path)), dirname(path));
  const fd = openSync(path, 'wx', 0o600); try { writeFileSync(fd, encode(document)); fsyncSync(fd); } finally { closeSync(fd); }
  const directory = openSync(dirname(path), 'r'); try { fsyncSync(directory); } finally { closeSync(directory); }
}

/** No execute command, environment-file loading, provider or download fallback. */
export async function sourceGapRetrievalCli(argv: string[]) {
  if (!argv.length) return { mode: 'offline_help', usage: [
    '--screening-baseline --deck FILE --out NEW_FILE', '--pool-baseline --pool FILE --out NEW_FILE', '--final-baseline --cohort FILE --out NEW_FILE',
    '--assemble --cohort FILE --baseline FILE --family-audit FILE --out NEW_FILE',
  ], providerCalls: 0, generationPerformed: false };
  const [mode, ...rest] = argv, required = mode === '--pool-baseline' ? ['--pool', '--out'] : mode === '--screening-baseline' ? ['--deck', '--out'] : mode === '--final-baseline' ? ['--cohort', '--out'] : mode === '--assemble' ? ['--cohort', '--baseline', '--family-audit', '--out'] : undefined;
  assert.ok(required, 'Choose one explicit offline source-gap mode.');
  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    assert.ok(required.includes(rest[index]) && rest[index + 1] && !rest[index + 1].startsWith('--') && !flags.has(rest[index]), 'Missing, duplicate or unsupported source-gap arguments.');
    flags.set(rest[index], rest[index + 1]);
  }
  assert.equal(flags.size, required.length);
  const inputs = mode === '--assemble' ? [readArtifact(flags.get('--cohort')!), readArtifact(flags.get('--baseline')!), readArtifact(flags.get('--family-audit')!)] : [readArtifact(flags.get(mode === '--pool-baseline' ? '--pool' : mode === '--screening-baseline' ? '--deck' : '--cohort')!)];
  assert.ok(!existsSync(inside(flags.get('--out')!)), 'Preserve existing source-gap snapshots.');
  const partial = isSourceGapPartial(inputs[0].document), bindings = codeHashes(partial); verifyEmbeddedFreeze(inputs[0], bindings);
  const freezeArtifact = readArtifact(inputs[0].document.candidateFreeze.path);
  assert.deepEqual(freezeArtifact, inputs[0].document.candidateFreeze, 'The original candidate freeze file changed.');
  const boundInputs = [...inputs, freezeArtifact, ...(partial ? sourceGapPartialInputArtifacts(inputs[0]) : [])], previousFetch = globalThis.fetch;
  for (const input of boundInputs) assert.deepEqual(readArtifact(input.path), input, 'A source-exposed input changed before local freezing.');
  globalThis.fetch = (async () => { throw new Error('Source-gap retrieval requires cached local embedding assets; network and provider calls are disabled.'); }) as typeof fetch;
  try {
    let document: Json;
    if (mode === '--assemble') document = assembleSourceGapCandidate(inputs[0], inputs[1], inputs[2], bindings);
    else {
      const scope = mode === '--pool-baseline' ? 'screening_pool' : mode === '--screening-baseline' ? 'screening_deck' : 'selected_cohort';
      inputCases(inputs[0], scope);
      const retriever = new ProductRetriever(retrievalCoverageCorpus(inputs[0]), ':memory:');
      try { document = await freezeSourceGapBaseline(inputs[0], scope, bindings, retriever); } finally { retriever.close(); }
    }
    for (const input of boundInputs) assert.deepEqual(readArtifact(input.path), input, 'An input changed during local freezing.');
    assert.deepEqual(codeHashes(partial), bindings, 'Implementation changed during local freezing.');
    writeNew(flags.get('--out')!, document);
    return { mode, cases: document.results.length, sha256: document.sha256, providerCalls: 0, generationPerformed: false,
      candidateContextInspected: mode === '--assemble', selectedSourceCounts: document.results.map((row: Json) => mode === '--assemble' ? { baseline: row.baseline.passages.length, candidate: row.candidate.passages.length } : row.baseline.passages.length) };
  } finally { globalThis.fetch = previousFetch; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await sourceGapRetrievalCli(process.argv.slice(2)))); }
  catch { console.error('Offline source-gap freezing stopped. No provider call or replacement was attempted.'); process.exitCode = 1; }
}
