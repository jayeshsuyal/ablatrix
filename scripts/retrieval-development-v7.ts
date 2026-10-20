/** Exact saved-score development replay. No downloads, credentials or provider path. */
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { textHash } from '../server/product-corpus.ts';
import { REPORT_DEVELOPMENT_PATHS, reportDevelopmentImplementation, replayReportUncertaintyDevelopment } from '../server/report-uncertainty-development.ts';
import { amazonPqaCorpusV2, verifyAmazonPqaComparisonV2 } from '../server/amazon-pqa-validation-v2.ts';
import { semanticSupplementContextV7, SEMANTIC_SUPPLEMENT_V7 } from '../server/semantic-supplement-v7.ts';
import { replaySavedStages } from '../server/retrieval-diagnosis-replay.ts';
import { sourceCoverageV2Corpus } from './source-coverage-v2-retrieval.ts';
import { diagnoseUsefulSources } from '../server/retrieval-diagnosis.ts';
import type { PairScorer } from '../server/semantic-reranker.ts';
import type { ProductCorpus, RetrievalResult } from '../server/loop-types.ts';

type Json = Record<string, any>;
type Ref = { path: string; fileSha256: string };
type Inputs = { legacyFreeze: Ref; legacyDeck: Ref; legacyStages: Ref; legacyResult: Ref;
  apqaFreeze: Ref; apqaScreening: Ref; apqaReviews: Ref[]; apqaSelection: Ref; apqaComparison: Ref };
const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
function read(ref: Ref, repository = root): any {
  const path = resolve(repository, ref.path); assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() && realpathSync(path) === path);
  const raw = readFileSync(path, 'utf8'); assert.equal(textHash(raw), ref.fileSha256, 'Frozen development artifact changed.'); return JSON.parse(raw);
}
function artifact(ref: Ref) { return { ...ref, document: read(ref) }; }
function implementation() {
  return reportDevelopmentImplementation(root, ['scripts/retrieval-development-v7.ts', 'server/semantic-supplement-v7.ts', 'package.json', 'package-lock.json']);
}
function save(path: string, value: unknown) {
  assert.ok(isAbsolute(path) && !existsSync(path) && realpathSync(dirname(path)) === dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { path, fileSha256: textHash(readFileSync(path, 'utf8')) };
}
function scorer(inputs: Json): PairScorer {
  assert.equal(textHash(inputs.query), inputs.querySha256);
  const scores = new Map<string, number>();
  for (const row of inputs.documents) {
    assert.equal(textHash(row.document), row.documentSha256); assert.ok(Number.isFinite(row.score));
    assert.ok(!scores.has(row.document) || scores.get(row.document) === row.score); scores.set(row.document, row.score);
  }
  return async (query, documents) => {
    assert.equal(query, inputs.query); assert.deepEqual([...new Set(documents)].sort(), [...scores.keys()].sort());
    return documents.map(d => scores.get(d)!);
  };
}
function deterministic(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, item) => key === 'resources' ? undefined : item));
}
function summary(rows: Json[]) {
  return { cases: rows.length, designatedUnits: rows.reduce((n, r) => n + r.units.length, 0),
    controlDelivered: rows.flatMap(r => r.units).filter(f => f.controlDelivered).length,
    candidateDelivered: rows.flatMap(r => r.units).filter(f => f.candidateDelivered).length,
    recoveredUnits: rows.flatMap(r => r.units).filter(f => !f.controlDelivered && f.candidateDelivered).length,
    lostUnits: rows.flatMap(r => r.units).filter(f => f.controlDelivered && !f.candidateDelivered).length,
    v6PrefixesRetained: rows.filter(r => r.v6PrefixRetained).length,
    completedPackets: rows.filter(r => r.candidate.packetCompletion.completePacketFits).length,
    changedCases: rows.filter(r => r.candidate.packetCompletion.appendedSourceIds.length).length,
    appendedParents: rows.reduce((n, r) => n + r.candidate.packetCompletion.appendedSourceIds.length, 0),
    appendedBodyCharacters: rows.reduce((n, r) => n + r.candidate.passages.slice(r.originalV6Parents).reduce((a: number, p: Json) => a + p.text.length, 0), 0) };
}
async function candidateRow(corpus: ProductCorpus, product: Json, question: string, result: RetrievalResult, trace: any, old: Json, caseId: string) {
  const replay = await replaySavedStages(corpus, product.id, question, trace); assert.deepEqual(replay.passages, result.passages);
  const candidate = await semanticSupplementContextV7(product as any, corpus, result, trace, question, scorer(old.proposal.actualInputs));
  assert.deepEqual(candidate.passages.slice(0, old.passages.length), old.passages);
  assert.deepEqual(candidate.proposal.actualInputs, old.proposal.actualInputs);
  return { caseId, originalV6Parents: old.passages.length, v6PrefixRetained: true, candidate };
}
export async function replayDevelopmentV7(freeze: Json) {
  assert.equal(freeze.format, 'ablatrix-retrieval-v7-development-freeze-v1'); assert.deepEqual(freeze.candidate, SEMANTIC_SUPPLEMENT_V7);
  assert.deepEqual(freeze.implementationSha256, implementation());
  const i = freeze.inputs as Inputs, previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Development replay forbids network or paid provider access.'); };
  try {
    const old = await replayReportUncertaintyDevelopment(i.legacyFreeze.path);
    assert.deepEqual(deterministic(old), deterministic(read(i.legacyResult)));
    const legacyFreeze = read(i.legacyFreeze);
    const legacySourceReview = read({ path: REPORT_DEVELOPMENT_PATHS.sourceReview, fileSha256: legacyFreeze.inputSha256[REPORT_DEVELOPMENT_PATHS.sourceReview] });
    const deck = artifact(i.legacyDeck), stages = read(i.legacyStages), corpus = sourceCoverageV2Corpus(deck), legacy: Json[] = [];
    assert.equal(stages.results.length, old.results.length);
    for (const [index, item] of deck.document.cases.entries()) {
      const previous = old.results[index]!, stage = stages.results[index]; assert.equal(item.id, previous.caseId); assert.equal(stage.caseId, item.id);
      const product = { ...item.product, sources: item.sources.map((s: Json) => ({ ...s, originalQuestion: s.originalQuestion ?? undefined })) };
      const result = { corpusVersion: corpus.version, embeddingModel: 'saved-baseline-diagnostic', method: 'saved-baseline-diagnostic', durationMs: 0, passages: (await replaySavedStages(corpus, product.id, item.question, stage.trace)).passages };
      const row = await candidateRow(corpus, product, item.question, result, stage.trace, previous.candidate, item.id);
      const facts = previous.diagnosis.designated.map(({ sources: _sources, ...f }: Json) => f);
      const diagnosis = diagnoseUsefulSources(product, corpus, result, stage.trace, facts, row.candidate.passages, row.candidate.additions as any);
      const units = diagnosis.designated.map((f, n) => ({ ...facts[n], controlDelivered: previous.diagnosis.designated[n].sources.some((s: Json) => s.literalFactDelivered), candidateDelivered: f.sources.some(s => s.literalFactDelivered) }));
      const sourceAssessment = legacySourceReview.cases[index]; assert.equal(sourceAssessment.caseId, item.id);
      legacy.push({ ...row, units, sourceAssessment });
    }
    const af = artifact(i.apqaFreeze), screen = artifact(i.apqaScreening), reviews = i.apqaReviews.map(artifact), selected = read(i.apqaSelection), compared = read(i.apqaComparison);
    for (const [path, sha] of Object.entries(af.document.implementationSha256)) assert.equal(textHash(readFileSync(resolve(root, path), 'utf8')), sha);
    await verifyAmazonPqaComparisonV2(af.document, screen, reviews, selected, compared);
    const apqaCorpus = amazonPqaCorpusV2(af.document, screen, selected), apqa: Json[] = [];
    for (const item of compared.calculation.cases) {
      const product = { ...item.product, sources: item.completeSources.map((s: Json) => ({ id: s.id, label: s.source, text: s.text, ...(s.originalQuestion !== undefined ? { originalQuestion: s.originalQuestion } : {}) })) };
      const row = await candidateRow(apqaCorpus, product, item.question, item.retrieval.result, item.retrieval.trace, item.retrieval.candidate, item.caseId);
      const units = item.designatedFacts.map((f: Json) => ({ ...f, controlDelivered: f.candidateDelivered,
        candidateDelivered: row.candidate.passages.some(p => f.sourceIds.includes(p.id) && p.text.includes(f.quote)) }));
      apqa.push({ ...row, units, unknowns: item.unknowns, applicability: item.applicability });
    }
    assert.deepEqual(freeze.implementationSha256, implementation());
    return { format: 'ablatrix-retrieval-v7-development-result-v1', freezeSha256: textHash(JSON.stringify(freeze)),
      summary: { legacy: summary(legacy), apqa: summary(apqa), combined: summary([...legacy, ...apqa]) }, legacy, apqa,
      scoreMode: 'Input-bound saved BGE dense observations and MiniLM logits, with genuine lexical/fusion/selection replay; not independent fresh inference.',
      exposure: 'All 28 products exposed before v7 design. APQA exact designated-source matching counts one redundant bow-dimension bullet although the description already supplied equivalent dimensions.',
      providerCalls: 0, generatedAnswers: 0, freshCases: 0, humanSourceCheckedAnswers: 0,
      qualityClaimEligible: false, activationAuthorized: false, paidExecutionAuthorized: false, paidPlan: null };
  } finally { globalThis.fetch = previousFetch; }
}
export async function developmentV7Cli(argv: string[]) {
  const [mode, input, output] = argv;
  if (!mode) return { usage: '--freeze INPUTS_JSON NEW_FREEZE | --run FREEZE NEW_RESULT | --verify FREEZE RESULT', providerCalls: 0, freshInputReads: 0 };
  assert.ok(input && output && argv.length === 3);
  const raw = readFileSync(resolve(input), 'utf8'), document = JSON.parse(raw);
  if (mode === '--freeze') {
    for (const ref of Object.values(document as Inputs).flat()) read(ref);
    return save(output, { format: 'ablatrix-retrieval-v7-development-freeze-v1', createdAt: new Date().toISOString(),
      candidate: SEMANTIC_SUPPLEMENT_V7, inputs: document, implementationSha256: implementation(),
      exposure: 'All fixed legacy 12 and APQA 16 development cases; no filtering on candidate changes or outcomes.', providerCalls: 0, paidExecutionAuthorized: false, qualityClaimEligible: false });
  }
  const result = await replayDevelopmentV7(document);
  if (mode === '--verify') { assert.deepEqual(deterministic(JSON.parse(readFileSync(output, 'utf8'))), deterministic(result)); return { verified: true, summary: result.summary, providerCalls: 0 }; }
  assert.equal(mode, '--run'); return { ...save(output, result), summary: result.summary };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(await developmentV7Cli(process.argv.slice(2)), null, 2));
