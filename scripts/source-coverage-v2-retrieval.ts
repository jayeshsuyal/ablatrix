/** Source-only evaluation. This CLI has no provider, execute mode or .env load. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { textHash, validateProductCorpus } from '../server/product-corpus.ts';
import { contextComparisonHash as hash } from '../server/context-comparison.ts';
import { workspaceReviewSourceHash } from '../server/answer-review-source.ts';
import { ProductRetriever } from '../server/product-retrieval.ts';
import { workspaceCompleteSourceContext, workspaceSourceChunks } from '../server/workspace-retrieval-context.ts';
import { workspaceSourceCoverageV2Context, WORKSPACE_SOURCE_COVERAGE_V2_CONTRACT } from '../server/workspace-source-coverage-v2.ts';
import type { ProductCorpus, RetrievalResult, RetrievedPassage } from '../server/loop-types.ts';

type Json = Record<string, any>;
type Artifact = { path: string; fileSha256: string; document: Json };
const repository = resolve(fileURLToPath(new URL('../', import.meta.url)));
const encode = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
export const SOURCE_COVERAGE_V2_FILES = [
  'package-lock.json', 'scripts/prepare-correction-cohort.py', 'scripts/prepare-flat-source-cohort.py',
  'scripts/prepare-retrieval-coverage-cohort.py', 'scripts/prepare-source-calibration-cohort.py',
  'scripts/prepare-source-coverage-v2-deck.py', 'scripts/prepare-source-id-cohort.py',
  'scripts/source-coverage-v2-retrieval.test.ts', 'scripts/source-coverage-v2-retrieval.ts',
  'scripts/test_prepare_source_coverage_v2_deck.py', 'server/answer-review-source.ts',
  'server/citation-options.ts', 'server/context-comparison.ts', 'server/feedback-provider.ts',
  'server/loop-types.ts', 'server/product-corpus.ts', 'server/product-retrieval.ts',
  'server/product-workspace.ts', 'server/workspace-generation-identity.ts', 'server/workspace-generation.ts',
  'server/workspace-retrieval-context.ts', 'server/workspace-source-coverage-integration.test.ts',
  'server/workspace-source-coverage-v2.test.ts', 'server/workspace-source-coverage-v2.ts', 'server/workspace-source-coverage.ts'
] as const;
export function verifyV2Implementation(values: Record<string, string>) {
  assert.deepEqual(Object.keys(values).sort(), [...SOURCE_COVERAGE_V2_FILES].sort(), 'Require the complete exact v2 implementation map.');
  for (const path of SOURCE_COVERAGE_V2_FILES) {
    assert.match(values[path]!, /^[a-f0-9]{64}$/);
    assert.equal(textHash(readFileSync(resolve(repository, path), 'utf8')), values[path], `Frozen implementation changed: ${path}`);
  }
}

const contextHash = (item: Json, passages: RetrievedPassage[]) => hash({ product: item.product, question: item.question,
  passages: passages.map(({ lexicalRank: _l, semanticRank: _s, score: _r, ...p }) => p) });
function checkedSeal(document: Json, key: string) {
  assert.equal(document[key], hash(Object.fromEntries(Object.entries(document).filter(([name]) => name !== key))), `Invalid ${key}.`);
}
export function sourceCoverageV2Corpus(deck: Artifact): ProductCorpus {
  const cases = deck.document.cases;
  assert.equal(cases.length, 12, 'Retain the whole fixed twelve-product deck.');
  assert.equal(new Set(cases.map((c: Json) => c.id)).size, 12);
  assert.equal(new Set(cases.map((c: Json) => c.product.id.toUpperCase())).size, 12);
  for (const item of cases) {
    assert.ok(item.question.trim() && item.product.title.trim());
    assert.equal(item.sourcePoolSha256, hash(item.sources));
    assert.ok(item.sources.length && item.sources.length <= 128);
    assert.equal(new Set(item.sources.map((s: Json) => s.id)).size, item.sources.length);
    for (const source of item.sources) {
      assert.equal(source.sha256, workspaceReviewSourceHash(source));
      assert.ok(source.text.length > 0 && source.text.length <= 1500 && !source.text.includes('\u0000'));
      assert.ok(source.originalQuestion === null || typeof source.originalQuestion === 'string');
    }
  }
  const corpus: ProductCorpus = { version: `source-coverage-v2-${deck.fileSha256.slice(0, 24)}`,
    source: 'Frozen pinned ePQA train source-only selection', license: 'CDLA-Sharing-1.0', cases: [],
    products: cases.map((c: Json) => ({ ...c.product, split: 'validation' })),
    passages: cases.flatMap((c: Json) => c.sources.flatMap((s: Json) => workspaceSourceChunks(s.text).map((text, index, chunks) => ({
      id: chunks.length === 1 ? s.id : `${s.id}-${index + 1}`, productId: c.product.id, source: s.label, text, reference: s.label,
      sha256: textHash(text), ...(s.originalQuestion !== null ? { originalQuestion: s.originalQuestion } : {})
    })))) };
  validateProductCorpus(corpus); return corpus;
}
function product(item: Json) { return { ...item.product, sources: item.sources.map((s: Json) => ({ ...s, originalQuestion: s.originalQuestion ?? undefined })) }; }
export async function baselineV2(deck: Artifact, retriever: { retrieve(id: string, question: string): Promise<RetrievalResult> }) {
  const corpus = sourceCoverageV2Corpus(deck), results = [];
  for (const item of deck.document.cases) {
    const indexRetrieval = structuredClone(await retriever.retrieve(item.product.id, item.question));
    assert.equal(indexRetrieval.corpusVersion, corpus.version); assert.ok(indexRetrieval.passages.length <= 5);
    const passages = workspaceCompleteSourceContext(product(item), corpus, indexRetrieval);
    assert.ok(passages.length > 0);
    results.push({ caseId: item.id, indexRetrieval, baseline: { ...indexRetrieval, passages }, baselineContextSha256: contextHash(item, passages) });
  }
  const body = { format: 'ablatrix-source-coverage-v2-baseline-v1', deckFileSha256: deck.fileSha256, corpusSha256: hash(corpus), results,
    providerCalls: 0, generationPerformed: false, candidateContextInspected: false };
  return { ...body, sha256: hash(body) };
}
/** Requires the complete independent source review before inspecting candidates.
 * Eligibility is based on baseline/full-source facts. Every candidate miss stays. */
export function compareV2(deck: Artifact, baseline: Artifact, review: Artifact) {
  const corpus = sourceCoverageV2Corpus(deck), rows = baseline.document.results;
  checkedSeal(baseline.document, 'sha256');
  assert.equal(baseline.document.format, 'ablatrix-source-coverage-v2-baseline-v1');
  assert.equal(baseline.document.deckFileSha256, deck.fileSha256);
  assert.equal(baseline.document.corpusSha256, hash(corpus));
  assert.equal(baseline.document.candidateContextInspected, false);
  assert.equal(baseline.document.generationPerformed, false);
  assert.equal(baseline.document.providerCalls, 0);
  const r = review.document;
  assert.equal(r.format, 'ablatrix-source-coverage-v2-source-review-v1');
  assert.equal(r.status, 'completed'); assert.equal(r.provenance, 'independent_ai_source_gap_review');
  assert.equal(r.deckFileSha256, deck.fileSha256); assert.equal(r.baselineFileSha256, baseline.fileSha256);
  assert.equal(r.candidateContextInspected, false); assert.equal(r.modelOutputsInspected, false);
  assert.deepEqual(rows.map((row: Json) => row.caseId), deck.document.cases.map((c: Json) => c.id));
  assert.deepEqual(r.cases.map((row: Json) => row.caseId), deck.document.cases.map((c: Json) => c.id));
  // Validate every designation before calling the candidate even once.
  for (const [index, item] of deck.document.cases.entries()) {
    const b = rows[index], assessed = r.cases[index];
    const expected = workspaceCompleteSourceContext(product(item), corpus, b.indexRetrieval);
    assert.equal(b.indexRetrieval.corpusVersion, corpus.version);
    assert.deepEqual(b.baseline, { ...b.indexRetrieval, passages: expected });
    assert.equal(b.baselineContextSha256, contextHash(item, expected));
    assert.equal(assessed.baselineContextSha256, b.baselineContextSha256);
    assert.equal(assessed.sourcePoolSha256, item.sourcePoolSha256);
    assert.equal(assessed.sourceScopeReviewed, true); assert.equal(assessed.baselineAndTitleReviewed, true); assert.equal(assessed.originalQuestionsReviewed, true);
    assert.ok(['specification_gap', 'model_detail_gap', 'baseline_complete_control', 'ineligible_or_uncertain'].includes(assessed.sourceGapGroup));
    assert.ok(Array.isArray(assessed.designatedFacts));
    const gap = ['specification_gap', 'model_detail_gap'].includes(assessed.sourceGapGroup), control = assessed.sourceGapGroup === 'baseline_complete_control';
    if (gap) { assert.equal(assessed.noEquivalentFactInBaseline, true); assert.equal(assessed.baselineComplete, false); assert.ok(assessed.designatedFacts.length > 0); }
    if (control) { assert.equal(assessed.baselineComplete, true); assert.ok(assessed.designatedFacts.length > 0); }
    for (const fact of assessed.designatedFacts) {
      assert.ok(typeof fact.fact === 'string' && fact.fact.trim() && typeof fact.qualification === 'string');
      assert.ok(typeof fact.quote === 'string' && fact.quote.trim().length >= 5);
      assert.ok(Array.isArray(fact.sourceIds) && fact.sourceIds.length && new Set(fact.sourceIds).size === fact.sourceIds.length);
      for (const id of fact.sourceIds) assert.ok(item.sources.some((s: Json) => s.id === id && s.text.includes(fact.quote)), 'Designation must quote its literal source body.');
      if (gap) assert.ok(!item.product.title.includes(fact.quote) && !expected.some(p => p.text.includes(fact.quote)), 'The literal designated fact is already supplied by baseline.');
      if (control) assert.ok(expected.some(p => fact.sourceIds.includes(p.id) && p.text.includes(fact.quote)));
    }
  }
  const results = deck.document.cases.map((item: Json, index: number) => {
    const b = rows[index], assessed = r.cases[index], candidate = workspaceSourceCoverageV2Context(product(item), corpus, b.indexRetrieval, item.question);
    assert.deepEqual(candidate.passages.slice(0, b.baseline.passages.length), b.baseline.passages);
    const added = candidate.passages.slice(b.baseline.passages.length);
    const facts = assessed.designatedFacts.map((fact: Json) => ({ ...fact, deliveredByAddedSource: added.some(p => fact.sourceIds.includes(p.id) && p.text.includes(fact.quote) &&
      (p.originalQuestion ?? null) === (item.sources.find((s: Json) => s.id === p.id)?.originalQuestion ?? null)) }));
    return { caseId: item.id, sourceGapGroup: assessed.sourceGapGroup, baseline: b.baseline, indexRetrieval: b.indexRetrieval,
      candidate: { ...b.indexRetrieval, passages: candidate.passages }, additions: candidate.additions, designatedFacts: facts };
  });
  const gaps = results.filter((r: Json) => ['specification_gap', 'model_detail_gap'].includes(r.sourceGapGroup)), controls = results.filter((r: Json) => r.sourceGapGroup === 'baseline_complete_control');
  const delivered = gaps.flatMap((r: Json) => r.designatedFacts.filter((f: Json) => f.deliveredByAddedSource));
  const body = { format: 'ablatrix-source-coverage-v2-comparison-v1', deckFileSha256: deck.fileSha256, baselineFileSha256: baseline.fileSha256, reviewFileSha256: review.fileSha256,
    contract: WORKSPACE_SOURCE_COVERAGE_V2_CONTRACT, corpusSha256: hash(corpus), results,
    summary: { products: 12, changedContexts: results.filter((r: Json) => r.additions.length).length, gapCases: gaps.length, completeControls: controls.length,
      designatedMissingFacts: gaps.reduce((sum: number, r: Json) => sum + r.designatedFacts.length, 0), deliveredMissingFacts: delivered.length,
      gapCasesWithFactDelivered: gaps.filter((r: Json) => r.designatedFacts.some((f: Json) => f.deliveredByAddedSource)).length,
      sourceOnlyPaidEligibility: gaps.length >= 1 && controls.length >= 2 && delivered.length > 0 },
    providerCalls: 0, generationPerformed: false, answerQualityMeasured: false, qualityClaimEligible: false, paidExecutionAuthorized: false };
  return { ...body, sha256: hash(body) };
}
function inside(argument: string) {
  const path = resolve(argument), rel = relative(repository, path);
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel)); return path;
}
function artifact(argument: string): Artifact {
  const path = inside(argument); assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() && realpathSync(path) === path);
  const raw = readFileSync(path, 'utf8'); return { path: relative(repository, path), fileSha256: textHash(raw), document: JSON.parse(raw) };
}
function freezeInputs(deck: Artifact): Artifact[] {
  assert.equal(deck.document.format, 'ablatrix-source-coverage-v2-deck-v1'); checkedSeal(deck.document, 'deckSha256');
  const f = deck.document.candidateFreeze; assert.deepEqual(artifact(f.path), f);
  assert.equal(f.document.format, 'ablatrix-source-coverage-v2-candidate-freeze-v1'); assert.equal(f.document.retrievalContract, WORKSPACE_SOURCE_COVERAGE_V2_CONTRACT);
  assert.equal(f.document.frozen, true); assert.equal(f.document.qualityClaimEligible, false);
  verifyV2Implementation(f.document.implementationSha256);
  // Reuse the producer's canonical verifier: it checks the prospective protocol,
  // exact 8+4 recipe, pinned train identity, all source-only protections, raw
  // artifact bindings and absence of prior candidate/generation inspection.
  const verification = JSON.parse(execFileSync('python3', ['-I', 'scripts/prepare-source-coverage-v2-deck.py', '--verify-deck', deck.path],
    { cwd: repository, env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 30_000, maxBuffer: 1_048_576 }));
  assert.equal(verification.mode, 'verified_source_only_deck'); assert.equal(verification.newProviderCalls, 0);
  assert.equal(verification.deckFileSha256, deck.fileSha256);
  return [deck, f];
}
export async function sourceCoverageV2Cli(argv: string[]) {
  if (!argv.length) return { usage: ['--baseline --deck FILE --out NEW', '--compare --deck FILE --baseline FILE --review FILE --out NEW'], providerCalls: 0 };
  const [mode, ...rest] = argv, keys = mode === '--baseline' ? ['--deck', '--out'] : mode === '--compare' ? ['--deck', '--baseline', '--review', '--out'] : undefined;
  assert.ok(keys, 'Choose one source-only mode.'); const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) { assert.ok(keys.includes(rest[i]) && rest[i + 1] && !rest[i + 1].startsWith('--') && !flags.has(rest[i])); flags.set(rest[i], rest[i + 1]); }
  assert.equal(flags.size, keys.length);
  const deck = artifact(flags.get('--deck')!), inputs = freezeInputs(deck), output = inside(flags.get('--out')!);
  assert.ok(!existsSync(output), 'Preserve all existing snapshots.');
  const previousFetch = globalThis.fetch; globalThis.fetch = (async () => { throw new Error('Offline source evaluation requires cached embeddings; network is disabled.'); }) as typeof fetch;
  try {
    let document: Json;
    if (mode === '--baseline') {
      const retriever = new ProductRetriever(sourceCoverageV2Corpus(deck), ':memory:');
      try { document = await baselineV2(deck, retriever); } finally { retriever.close(); }
    } else {
      const baseline = artifact(flags.get('--baseline')!), review = artifact(flags.get('--review')!); inputs.push(baseline, review);
      document = compareV2(deck, baseline, review);
    }
    for (const input of inputs) assert.deepEqual(artifact(input.path), input, 'A bound source-only input changed.'); freezeInputs(deck);
    mkdirSync(dirname(output), { recursive: true }); assert.equal(realpathSync(dirname(output)), dirname(output));
    writeFileSync(output, encode(document), { flag: 'wx', mode: 0o600 });
    return { mode, cases: document.results.length, sha256: document.sha256, summary: document.summary, providerCalls: 0, generationPerformed: false };
  } finally { globalThis.fetch = previousFetch; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await sourceCoverageV2Cli(process.argv.slice(2)))); }
  catch (error) { console.error(`Offline v2 evaluation stopped: ${error instanceof Error ? error.message : 'invalid input'}`); process.exitCode = 1; }
}
