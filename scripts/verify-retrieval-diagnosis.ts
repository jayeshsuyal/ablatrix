/** Public saved-evidence replay, no model cache, Git ancestry or network required. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { textHash } from '../server/product-corpus.ts';
import { sourceCoverageV2Corpus } from './source-coverage-v2-retrieval.ts';
import { SEMANTIC_RERANKER } from '../server/semantic-reranker.ts';
import { verifySavedDiagnosisRow } from '../server/retrieval-diagnosis-replay.ts';
import { verifyThreeContext } from '../server/three-context-diagnostic.ts';
const directory = 'docs/evidence/retrieval-diagnosis-2026-10-19';
const saved = JSON.parse(readFileSync(`${directory}/stage-traces-v3-final.json`, 'utf8'));
for (const [path, hash] of Object.entries(saved.implementationSha256)) assert.equal(textHash(readFileSync(path, 'utf8')), hash, `Current development code changed: ${path}. Replay the evidence commit for its code bindings.`);
const originalDirectory = 'docs/evidence/retrieval-source-coverage-v2-2026-10-18';
const artifact = (name: string) => {
  const path = `${originalDirectory}/${name}`, raw = readFileSync(path, 'utf8');
  return { path, fileSha256: textHash(raw), document: JSON.parse(raw) };
};
const deck = artifact('deck-v1.json'), baseline = artifact('baseline-v1.json'), review = artifact('source-review-v1.json');
assert.deepEqual(saved.inputBindings, { deck: deck.fileSha256, review: review.fileSha256, baseline: baseline.fileSha256 });
assert.deepEqual(saved.model, SEMANTIC_RERANKER);
assert.equal(saved.providerCalls, 0); assert.equal(saved.generatedAnswers, 0); assert.equal(saved.qualityClaimEligible, false);
const corpus = sourceCoverageV2Corpus(deck);
assert.deepEqual(saved.results.map((row: any) => row.caseId), deck.document.cases.map((item: any) => item.id));
assert.deepEqual(review.document.cases.map((row: any) => row.caseId), saved.results.map((row: any) => row.caseId));
assert.deepEqual(baseline.document.results.map((row: any) => row.caseId), saved.results.map((row: any) => row.caseId));
let gapDelivered = 0;
for (const [index, row] of saved.results.entries()) {
  const { semantic } = await verifySavedDiagnosisRow(row, deck.document.cases[index], corpus, baseline.document.results[index], review.document.cases[index].designatedFacts);
  if (row.caseId === 'source-coverage-v2-train-12870') gapDelivered = review.document.cases[index].designatedFacts.filter((fact: any) => semantic.passages.some(source => fact.sourceIds.includes(source.id) && source.text.includes(fact.quote))).length;
}
const manifest = JSON.parse(readFileSync(`${directory}/three-context-preparation-final.json`, 'utf8'));
verifyThreeContext(manifest); assert.equal(manifest.document.paidPlan, null); assert.equal(gapDelivered, 0);
console.log(JSON.stringify({ retainedExposedCases: 12, torchSemanticFactDelivery: '0/3', threeContextsPrepared: manifest.document.slots.length, paidPlan: null, providerCalls: 0, replayed: 'FTS5, exact scope, fusion, five-chunk selection, saved-score semantic ranking/MMR/bounds, literal contexts and designated facts', limitation: 'Dense cosines and cross-encoder logits are saved inputs, not recomputed or independently authenticated model outputs. Runtime resource observations are not replayed.' }));
