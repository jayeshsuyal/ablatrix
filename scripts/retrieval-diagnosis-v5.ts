/** All exposed cases, exact frozen v4 input/logit replay, baseline-preserving supplementation. No downloads or providers. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { textHash } from '../server/product-corpus.ts';
import { sourceCoverageV2Corpus } from './source-coverage-v2-retrieval.ts';
import { SEMANTIC_RERANKER_V4 } from '../server/semantic-reranker-v4.ts';
import { semanticSupplementContextV5, SEMANTIC_SUPPLEMENT_V5 } from '../server/semantic-supplement-v5.ts';
import { diagnoseUsefulSources } from '../server/retrieval-diagnosis.ts';
import type { RetrievalResult } from '../server/loop-types.ts';

const [freezePath, outputPath] = process.argv.slice(2);
assert.ok(freezePath && outputPath, 'Usage: retrieval-diagnosis-v5.ts FREEZE_JSON NEW_OUTPUT_JSON');
const freezeRaw = readFileSync(freezePath, 'utf8'), freeze = JSON.parse(freezeRaw);
assert.equal(freeze.format, 'ablatrix-semantic-supplement-v5-development-freeze-v1'); assert.deepEqual(freeze.candidate, SEMANTIC_SUPPLEMENT_V5);
const verifyBindings = () => {
  for (const [path, hash] of Object.entries({ ...freeze.codeSha256, ...freeze.inputSha256 })) assert.equal(textHash(readFileSync(path, 'utf8')), hash, `Frozen development input changed: ${path}`);
};
verifyBindings();
const directory = 'docs/evidence/retrieval-source-coverage-v2-2026-10-18', evidence = 'docs/evidence/retrieval-diagnosis-2026-10-19';
const deckPath = `${directory}/deck-v1.json`, deckRaw = readFileSync(deckPath, 'utf8');
const deck = { path: deckPath, fileSha256: textHash(deckRaw), document: JSON.parse(deckRaw) }, corpus = sourceCoverageV2Corpus(deck);
const prior = JSON.parse(readFileSync(`${evidence}/stage-traces-v3-final.json`, 'utf8'));
const savedV4 = JSON.parse(readFileSync(`${evidence}/semantic-input-v4-development-v1.json`, 'utf8'));
assert.equal(savedV4.format, 'ablatrix-semantic-input-v4-development-comparison-v1'); assert.deepEqual(savedV4.candidate, SEMANTIC_RERANKER_V4);
assert.equal(prior.inputBindings.deck, deck.fileSha256);
const v4FreezeRaw = readFileSync(savedV4.freeze.path, 'utf8'); assert.equal(textHash(v4FreezeRaw), savedV4.freeze.fileSha256);
const v4Freeze = JSON.parse(v4FreezeRaw);
for (const [path, hash] of Object.entries({ ...v4Freeze.codeSha256, ...v4Freeze.inputSha256 })) assert.equal(textHash(readFileSync(path, 'utf8')), hash, `Historical v4 input changed: ${path}`);
assert.equal(prior.results.length, deck.document.cases.length); assert.equal(savedV4.results.length, deck.document.cases.length);
assert.equal(new Set(prior.results.map((row: any) => row.caseId)).size, prior.results.length);
const results = [], previousFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Development replay cannot download or call providers.'); };
try {
  for (const [index, item] of deck.document.cases.entries()) {
    const old = prior.results[index], oldV4 = savedV4.results[index]; assert.equal(old.caseId, item.id); assert.equal(oldV4.caseId, item.id); assert.equal(old.question, item.question);
    const product = { ...item.product, sources: item.sources.map((source: any) => ({ ...source, originalQuestion: source.originalQuestion ?? undefined })) };
    assert.deepEqual(old.product, JSON.parse(JSON.stringify(product)));
    const selected = old.trace.selection.filter((row: any) => row.selected).map((row: any) => {
      const { rank: _traceOnlyRank, ...fusion } = old.trace.fusion.find((p: any) => p.id === row.id);
      return { ...corpus.passages.find(p => p.id === row.id)!, ...fusion };
    });
    const retrieval: RetrievalResult = { corpusVersion: corpus.version, embeddingModel: 'saved-baseline-diagnostic', method: 'saved-baseline-diagnostic', durationMs: 0, passages: selected };
    const inputs = oldV4.candidate.actualInputs, scoreByDocument = new Map<string, number>(), consumed = new Set<string>();
    assert.equal(textHash(inputs.query), inputs.querySha256);
    for (const input of inputs.documents) {
      assert.equal(textHash(input.document), input.documentSha256); assert.ok(Number.isFinite(input.score));
      assert.ok(!scoreByDocument.has(input.document) || scoreByDocument.get(input.document) === input.score, 'One exact input cannot replay conflicting logits.');
      scoreByDocument.set(input.document, input.score);
    }
    const result = await semanticSupplementContextV5(product, corpus, retrieval, old.trace, item.question, async (query, documents) => {
      assert.equal(query, inputs.query, 'Saved scores are only reusable with exactly the original query.');
      return documents.map(document => { const score = scoreByDocument.get(document); assert.notEqual(score, undefined, 'Document input changed; cannot reuse saved score.'); consumed.add(document); return score!; });
    });
    assert.equal(consumed.size, scoreByDocument.size); assert.deepEqual(result.proposal.actualInputs, inputs);
    assert.deepEqual(result.proposal.passages, oldV4.candidate.passages); assert.deepEqual(result.proposal.ranking, oldV4.candidate.ranking); assert.deepEqual(result.proposal.decisions, oldV4.candidate.decisions);
    assert.deepEqual(result.passages.slice(0, old.baseline.length), old.baseline);
    const facts = old.baselineDiagnosis.designated.map(({ sources: _sources, ...fact }: any) => fact);
    const diagnosis = diagnoseUsefulSources(product, corpus, retrieval, old.trace, facts, result.passages, result.additions);
    const delivered = (diagnostic: typeof diagnosis) => diagnostic.designated.filter(f => f.sources.some(s => s.literalFactDelivered)).length;
    const baselineDelivered = delivered(old.baselineDiagnosis), v5Delivered = delivered(diagnosis);
    assert.ok(v5Delivered >= baselineDelivered, 'Baseline source-fact coverage must not regress.');
    results.push({ caseId: item.id, question: item.question, designatedFacts: facts.length, baselineDelivered, v3Delivered: oldV4.v3Delivered, v4Delivered: oldV4.v4Delivered, v5Delivered,
      candidate: result, diagnosis });
    console.error(`${item.id}: baseline=${baselineDelivered}, additive-v5=${v5Delivered}/${facts.length}, additions=${result.additions.length}`);
  }
} finally { globalThis.fetch = previousFetch; }
verifyBindings();
const summary = { cases: results.length, designatedFacts: results.reduce((sum, row) => sum + row.designatedFacts, 0), baselineDelivered: results.reduce((sum, row) => sum + row.baselineDelivered, 0),
  v3Delivered: results.reduce((sum, row) => sum + row.v3Delivered, 0), v4Delivered: results.reduce((sum, row) => sum + row.v4Delivered, 0), v5Delivered: results.reduce((sum, row) => sum + row.v5Delivered, 0),
  baselinePrefixesRetained: results.filter(row => row.candidate.baselinePreservation.allBaselineParentsRetainedInOrder).length,
  regressionsAgainstBaseline: results.filter(row => row.v5Delivered < row.baselineDelivered).map(row => row.caseId), improvementsAgainstBaseline: results.filter(row => row.v5Delivered > row.baselineDelivered).map(row => row.caseId),
  emptyContexts: results.filter(row => !row.candidate.passages.length).map(row => row.caseId) };
const document = { format: 'ablatrix-semantic-supplement-v5-development-comparison-v1', freeze: { path: freezePath, fileSha256: textHash(freezeRaw) }, candidate: SEMANTIC_SUPPLEMENT_V5,
  scoreMode: 'Exact query/document byte-bound replay of previously cached local CPU v4 logits. No new inference, scoring fit or threshold changes. Resources in the proposal measure replay/selection, not inference latency.',
  summary, results, exposure: 'All twelve products previously exposed. V5 designed after v4 regressions were observed. Development result, not fresh validation.',
  limitations: ['Designated literal source-fact delivery is not answer correctness or source applicability.', 'Retaining baseline sources can retain baseline errors/noise and does not guarantee a better answer.', 'Bounded additions cannot guarantee every requested facet or source disagreement reaches the answer.', 'No answer generation, judging, human calibration, paid calls or activation occurred.'],
  providerCalls: 0, generatedAnswers: 0, qualityClaimEligible: false };
writeFileSync(resolve(outputPath), JSON.stringify(document, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(summary));
