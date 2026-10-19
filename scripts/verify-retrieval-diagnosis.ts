/** Public saved-evidence replay, no model cache or network required. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { textHash } from '../server/product-corpus.ts';
import { sourceCoverageV2Corpus } from './source-coverage-v2-retrieval.ts';
import { workspaceCompleteSourceContext } from '../server/workspace-retrieval-context.ts';
import { reciprocalRankFusion } from '../server/product-retrieval.ts';
import { diagnoseUsefulSources } from '../server/retrieval-diagnosis.ts';
import { verifyThreeContext } from '../server/three-context-diagnostic.ts';
const directory = 'docs/evidence/retrieval-diagnosis-2026-10-19';
const saved = JSON.parse(readFileSync(`${directory}/stage-traces-v3-final.json`, 'utf8'));
for (const [path, hash] of Object.entries(saved.implementationSha256)) assert.equal(textHash(readFileSync(path, 'utf8')), hash, `Current development code changed: ${path}. Replay the evidence commit for its code bindings.`);
const path = 'docs/evidence/retrieval-source-coverage-v2-2026-10-18/deck-v1.json', raw = readFileSync(path, 'utf8'), deck = { path, fileSha256: textHash(raw), document: JSON.parse(raw) }, corpus = sourceCoverageV2Corpus(deck);
assert.equal(saved.inputBindings.deck, deck.fileSha256); assert.equal(saved.results.length, 12);
let gapDelivered = 0;
for (const row of saved.results) {
  const trace = row.trace, scope = new Set([...trace.bm25Candidates, ...trace.denseCandidates].filter((r: any) => r.scopePromoted).map((r: any) => r.id));
  const fused = reciprocalRankFusion(trace.bm25Candidates.map((r: any) => r.id), trace.denseCandidates.map((r: any) => r.id)).sort((a, b) => Number(scope.has(b.id)) - Number(scope.has(a.id)));
  assert.deepEqual(trace.fusion, fused.map((r, i) => ({ ...r, rank: i + 1 })));
  const item = deck.document.cases.find((c: any) => c.id === row.caseId); assert.equal(row.question, item.question); assert.deepEqual(row.product, JSON.parse(JSON.stringify({ ...item.product, sources: item.sources.map((s: any) => ({ ...s, originalQuestion: s.originalQuestion ?? undefined })) })));
  const indexRetrieval = { corpusVersion: corpus.version, embeddingModel: 'saved-diagnostic', method: 'saved-replay', durationMs: 0, passages: trace.selection.filter((r: any) => r.selected).map((r: any) => ({ ...corpus.passages.find(p => p.id === r.id)!, ...fused.find(f => f.id === r.id)! })) };
  assert.deepEqual(workspaceCompleteSourceContext(row.product, corpus, indexRetrieval), row.baseline);
  const facts = row.baselineDiagnosis.designated.map(({ sources: _s, ...f }: any) => f);
  for (const [key, context] of [['baselineDiagnosis', row.baseline], ['semanticDiagnosis', row.semantic.passages], ['allSourcesDiagnosis', row.allSources.passages]] as const) {
    assert.deepEqual(diagnoseUsefulSources(row.product, corpus, indexRetrieval, trace, facts, context), row[key]);
  }
  if (row.caseId === 'source-coverage-v2-train-12870') gapDelivered = row.semanticDiagnosis.designated.filter((f: any) => f.sources.some((s: any) => s.literalFactDelivered)).length;
}
const manifest = JSON.parse(readFileSync(`${directory}/three-context-preparation-final.json`, 'utf8')); verifyThreeContext(manifest); assert.equal(manifest.document.paidPlan, null); assert.equal(gapDelivered, 0);
console.log(JSON.stringify({ retainedExposedCases: 12, torchSemanticFactDelivery: '0/3', threeContextsPrepared: manifest.document.slots.length, paidPlan: null, providerCalls: 0, limitation: 'Saved score and source replay; recomputing model logits requires explicitly prepared cached models.' }));
