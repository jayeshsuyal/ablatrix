/** Re-score all exposed v2 development cases using one frozen input format. No provider, .env or downloads. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { textHash } from '../server/product-corpus.ts';
import { sourceCoverageV2Corpus } from './source-coverage-v2-retrieval.ts';
import { cachedCrossEncoder, SEMANTIC_RERANKER } from '../server/semantic-reranker.ts';
import { semanticContextV4, SEMANTIC_RERANKER_V4 } from '../server/semantic-reranker-v4.ts';
import { diagnoseUsefulSources } from '../server/retrieval-diagnosis.ts';
import type { RetrievalResult } from '../server/loop-types.ts';

const [freezePath, outputPath] = process.argv.slice(2);
assert.ok(freezePath && outputPath, 'Usage: retrieval-diagnosis-v4.ts FREEZE_JSON NEW_OUTPUT_JSON');
const freezeRaw = readFileSync(freezePath, 'utf8'), freeze = JSON.parse(freezeRaw);
assert.equal(freeze.format, 'ablatrix-semantic-input-v4-development-freeze-v1');
assert.deepEqual(freeze.candidate, SEMANTIC_RERANKER_V4);
const verifyBindings = () => {
  for (const [path, hash] of Object.entries({ ...freeze.codeSha256, ...freeze.inputSha256 })) assert.equal(textHash(readFileSync(path, 'utf8')), hash, `Frozen development input changed: ${path}`);
};
verifyBindings();
const directory = 'docs/evidence/retrieval-source-coverage-v2-2026-10-18';
const deckPath = `${directory}/deck-v1.json`, deckRaw = readFileSync(deckPath, 'utf8');
const deck = { path: deckPath, fileSha256: textHash(deckRaw), document: JSON.parse(deckRaw) };
const oldPath = 'docs/evidence/retrieval-diagnosis-2026-10-19/stage-traces-v3-final.json';
const old = JSON.parse(readFileSync(oldPath, 'utf8')), corpus = sourceCoverageV2Corpus(deck);
assert.equal(old.inputBindings.deck, deck.fileSha256);
assert.equal(textHash(readFileSync(`${directory}/source-review-v1.json`, 'utf8')), old.inputBindings.review);
assert.equal(textHash(readFileSync(`${directory}/baseline-v1.json`, 'utf8')), old.inputBindings.baseline);
assert.equal(old.results.length, deck.document.cases.length);
assert.equal(new Set(old.results.map((row: any) => row.caseId)).size, old.results.length);
const scorer = cachedCrossEncoder(), results = [];
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Development diagnosis is cached-local-only; downloads prohibited.'); };
try {
  for (const [index, item] of deck.document.cases.entries()) {
    const prior = old.results[index]; assert.equal(prior.caseId, item.id); assert.equal(prior.question, item.question);
    const product = { ...item.product, sources: item.sources.map((source: any) => ({ ...source, originalQuestion: source.originalQuestion ?? undefined })) };
    assert.deepEqual(prior.product, JSON.parse(JSON.stringify(product)));
    const selected = prior.trace.selection.filter((row: any) => row.selected).map((row: any) => ({ ...corpus.passages.find(p => p.id === row.id)!, ...prior.trace.fusion.find((p: any) => p.id === row.id) }));
    const retrieval: RetrievalResult = { corpusVersion: corpus.version, embeddingModel: 'saved-baseline-diagnostic', method: 'saved-baseline-diagnostic', durationMs: 0, passages: selected };
    const facts = prior.baselineDiagnosis.designated.map(({ sources: _sources, ...fact }: any) => fact);
    const candidate = await semanticContextV4(product, corpus, retrieval, prior.trace, item.question, scorer);
    const diagnosis = diagnoseUsefulSources(product, corpus, retrieval, prior.trace, facts, candidate.passages);
    const delivered = (diagnostic: typeof diagnosis) => diagnostic.designated.filter(f => f.sources.some(s => s.literalFactDelivered)).length;
    const baselineDelivered = delivered(prior.baselineDiagnosis), v3Delivered = delivered(prior.semanticDiagnosis), v4Delivered = delivered(diagnosis);
    results.push({ caseId: item.id, question: item.question, designatedFacts: facts.length, baselineDelivered, v3Delivered, v4Delivered,
      changedFromBaseline: JSON.stringify(prior.baseline.map((p: any) => p.id)) !== JSON.stringify(candidate.passages.map(p => p.id)),
      candidate, diagnosis });
    console.error(`${item.id}: designated source facts baseline=${baselineDelivered}, v3=${v3Delivered}, v4=${v4Delivered}/${facts.length}`);
  }
} finally { globalThis.fetch = previousFetch; }
verifyBindings();
const summary = { cases: results.length, designatedFacts: results.reduce((sum, row) => sum + row.designatedFacts, 0),
  baselineDelivered: results.reduce((sum, row) => sum + row.baselineDelivered, 0), v3Delivered: results.reduce((sum, row) => sum + row.v3Delivered, 0), v4Delivered: results.reduce((sum, row) => sum + row.v4Delivered, 0),
  regressionsAgainstBaseline: results.filter(row => row.v4Delivered < row.baselineDelivered).map(row => row.caseId),
  improvementsAgainstBaseline: results.filter(row => row.v4Delivered > row.baselineDelivered).map(row => row.caseId),
  emptyContexts: results.filter(row => !row.candidate.passages.length).map(row => row.caseId) };
const document = { format: 'ablatrix-semantic-input-v4-development-comparison-v1', freeze: { path: freezePath, fileSha256: textHash(freezeRaw) },
  candidate: SEMANTIC_RERANKER_V4, inheritedSelection: SEMANTIC_RERANKER, summary, results,
  exposure: 'All twelve products are previously exposed development cases; format selected after a torch-only probe. Retains all twelve, including regressions and misses. Not fresh validation.',
  limitations: ['Counts are designated literal fact delivery, not answer correctness or model applicability.', 'No answer generation or quality grading occurred.', 'Preprocessing and selection remain unqualified for activation.'],
  providerCalls: 0, generatedAnswers: 0, qualityClaimEligible: false };
writeFileSync(resolve(outputPath), JSON.stringify(document, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(summary));
