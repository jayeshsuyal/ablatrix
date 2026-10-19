import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { textHash } from '../server/product-corpus.ts';
import { baselineV2, compareV2, sourceCoverageV2Corpus, sourceCoverageV2Cli, SOURCE_COVERAGE_V2_FILES, verifyV2Implementation } from './source-coverage-v2-retrieval.ts';
import { contextComparisonHash as hash } from '../server/context-comparison.ts';
import { workspaceReviewSourceHash } from '../server/answer-review-source.ts';
import type { ProductCorpus } from '../server/loop-types.ts';

type Json = Record<string, any>;
const artifact = (document: Json) => ({ path: 'SYNTHETIC-only.json', fileSha256: hash(document), document });
function packet() {
  const cases = Array.from({ length: 12 }, (_, i) => ({ id: `synthetic-${i}`, product: { id: `SYNTH${String(i).padStart(5, '0')}`, title: `SYNTHETIC device ${i}` },
    question: 'What are the item dimensions?', sources: [
      { id: `base-${i}`, label: 'review', text: 'SYNTHETIC customer report: it is easy to use.', originalQuestion: null, reference: 'review' },
      { id: `spec-${i}`, label: 'attribute', text: 'SYNTHETIC dimensions: { width: 18, unit: millimeters }', originalQuestion: null, reference: 'attribute' }
    ].map(s => ({ ...s, sha256: workspaceReviewSourceHash(s) })) }));
  return artifact({ format: 'ablatrix-source-coverage-v2-deck-v1', cases: cases.map(c => ({ ...c, sourcePoolSha256: hash(c.sources) })) });
}
const ranker = (corpus: ProductCorpus, includeSpecs = false) => ({ async retrieve(id: string) {
  return { corpusVersion: corpus.version, durationMs: 0, method: 'SYNTHETIC injected ranking; no natural quality measured', embeddingModel: 'none',
    passages: corpus.passages.filter(p => p.productId === id && (includeSpecs || p.id.startsWith('base-'))).map(p => ({ ...p, score: 1, lexicalRank: 1, semanticRank: null })) };
} });
async function inputs(includeSpecs = false) {
  const deck = packet(), corpus = sourceCoverageV2Corpus(deck), baseline = artifact(await baselineV2(deck, ranker(corpus, includeSpecs)));
  const cases = deck.document.cases.map((item: Json, index: number) => ({ caseId: item.id, baselineContextSha256: baseline.document.results[index].baselineContextSha256,
    sourcePoolSha256: item.sourcePoolSha256, sourceScopeReviewed: true, baselineAndTitleReviewed: true, originalQuestionsReviewed: true,
    sourceGapGroup: index === 0 && !includeSpecs ? 'specification_gap' : 'baseline_complete_control', noEquivalentFactInBaseline: index === 0 && !includeSpecs,
    baselineComplete: !(index === 0 && !includeSpecs), designatedFacts: index === 0 && !includeSpecs
      ? [{ fact: 'SYNTHETIC missing width', sourceIds: [`spec-${index}`], quote: 'width: 18', qualification: 'SYNTHETIC fixture only' }]
      : [{ fact: 'SYNTHETIC ease of use', sourceIds: [`base-${index}`], quote: 'it is easy to use.', qualification: 'SYNTHETIC fixture only' }] }));
  const review = artifact({ format: 'ablatrix-source-coverage-v2-source-review-v1', status: 'completed', provenance: 'independent_ai_source_gap_review',
    deckFileSha256: deck.fileSha256, baselineFileSha256: baseline.fileSha256, candidateContextInspected: false, modelOutputsInspected: false, cases });
  return { deck, baseline, review };
}
test('SYNTHETIC baseline freezes all twelve products before a candidate is consulted', async () => {
  const { deck, baseline } = await inputs(); assert.equal(baseline.document.results.length, 12);
  assert.equal(baseline.document.candidateContextInspected, false); assert.equal(baseline.document.providerCalls, 0);
  assert.ok(baseline.document.results.every((r: Json) => r.baseline.passages.length === 1));
  const shrunk = structuredClone(deck); shrunk.document.cases.pop(); assert.throws(() => sourceCoverageV2Corpus(shrunk), /twelve/);
});
test('SYNTHETIC comparison retains every case and baseline parent and measures literal fact delivery separately', async () => {
  const { deck, baseline, review } = await inputs(), result = compareV2(deck, baseline, review);
  assert.equal(result.results.length, 12); assert.equal(result.answerQualityMeasured, false); assert.equal(result.paidExecutionAuthorized, false);
  for (const row of result.results) assert.deepEqual(row.candidate.passages.slice(0, row.baseline.passages.length), row.baseline.passages);
  assert.equal(result.summary.designatedMissingFacts, 1);
});
test('SYNTHETIC zero independently missing facts cannot qualify for paid execution', async () => {
  const { deck, baseline, review } = await inputs(true), result = compareV2(deck, baseline, review);
  assert.equal(result.summary.gapCases, 0); assert.equal(result.summary.deliveredMissingFacts, 0); assert.equal(result.summary.sourceOnlyPaidEligibility, false);
});
test('review scope, complete denominator, literal designation and immutable baseline bindings are required', async () => {
  for (const mutate of [
    (r: Json) => { r.candidateContextInspected = true; },
    (r: Json) => { r.modelOutputsInspected = true; },
    (r: Json) => { r.deckFileSha256 = '0'.repeat(64); },
    (r: Json) => { r.cases.pop(); },
    (r: Json) => { r.cases.reverse(); },
    (r: Json) => { r.cases[0].sourcePoolSha256 = '0'.repeat(64); },
    (r: Json) => { r.cases[0].designatedFacts[0].quote = 'not present'; },
    (r: Json) => { r.cases[0].designatedFacts[0].sourceIds = ['other-product']; },
    (r: Json) => { r.cases[0].designatedFacts[0] = { fact: 'already provided', sourceIds: ['base-0'], quote: 'it is easy to use.', qualification: 'fixture' }; },
    (r: Json) => { r.cases[0].originalQuestionsReviewed = false; }
  ]) { const { deck, baseline, review } = await inputs(); mutate(review.document); assert.throws(() => compareV2(deck, baseline, review)); }
});
test('offline CLI rejects paid modes, unexpected and duplicate flags', async () => {
  assert.equal((await sourceCoverageV2Cli([])).providerCalls, 0);
  for (const args of [['--execute'], ['--baseline', '--deck', 'x', '--deck', 'y'], ['--baseline', '--deck', 'x', '--unknown', 'y']]) await assert.rejects(sourceCoverageV2Cli(args));
});

test('every candidate and source-binding dependency is required even if a smaller map is self-consistent', () => {
  const current = Object.fromEntries(SOURCE_COVERAGE_V2_FILES.map(path => [path, textHash(readFileSync(path, 'utf8'))]));
  verifyV2Implementation(current);
  for (const missing of ['server/workspace-source-coverage-v2.ts', 'server/answer-review-source.ts', 'scripts/prepare-source-coverage-v2-deck.py']) {
    const altered = { ...current }; delete altered[missing]; assert.throws(() => verifyV2Implementation(altered), /complete exact/);
  }
  assert.throws(() => verifyV2Implementation({ ...current, 'server/loop-types.ts': '0'.repeat(64) }), /Frozen implementation/);
});
