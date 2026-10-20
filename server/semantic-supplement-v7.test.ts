import test from 'node:test';
import assert from 'node:assert/strict';
import { textHash } from './product-corpus.ts';
import type { ProductCorpus, RetrievalResult } from './loop-types.ts';
import type { RetrievalStageTrace } from './product-retrieval.ts';
import { workspaceSourceChunks, type WorkspaceSourceProduct } from './workspace-retrieval-context.ts';
import { semanticSupplementContextV6 } from './semantic-supplement-v6.ts';
import { semanticSupplementContextV7 } from './semantic-supplement-v7.ts';

function fixture(count = 7, baselineCount = 5) {
  const product: WorkspaceSourceProduct & { title: string } = { id: 'SYNTHETIC', title: 'SYNTHETIC apparatus',
    sources: Array.from({ length: count }, (_, i) => ({ id: `s${i}`, label: i === count - 1 ? 'cqa' : 'bullet',
      text: `SYNTHETIC literal observation ${i}.`, ...(i === count - 1 ? { originalQuestion: 'SYNTHETIC other customer question?' } : {}) })) };
  const corpus: ProductCorpus = { version: 'SYNTHETIC', source: 'SYNTHETIC', license: 'test', cases: [],
    products: [{ id: product.id, title: product.title, split: 'development' }], passages: [] };
  const sync = () => { corpus.passages = product.sources.flatMap(s => workspaceSourceChunks(s.text).map((text, i, chunks) => ({
    id: chunks.length === 1 ? s.id : `${s.id}-${i + 1}`, productId: product.id, source: s.label, reference: s.label,
    text, sha256: textHash(text), ...(s.originalQuestion !== undefined ? { originalQuestion: s.originalQuestion } : {}),
  }))); };
  sync();
  const retrieval: RetrievalResult = { corpusVersion: corpus.version, embeddingModel: 'SYNTHETIC', method: 'SYNTHETIC', durationMs: 0,
    passages: corpus.passages.slice(0, baselineCount).map((p, i) => ({ ...p, lexicalRank: i + 1, semanticRank: i + 1, score: .02 })) };
  const trace = { fusion: corpus.passages.map((p, i) => ({ id: p.id, rank: i + 1 })) } as RetrievalStageTrace;
  let calls = 0; const scores = new Map<string, number>();
  const scorer = async (_query: string, documents: string[]) => { calls++; return documents.map(d => scores.get(d) ?? -11); };
  return { product, corpus, retrieval, trace, sync, scores, calls: () => calls,
    v6: () => semanticSupplementContextV6(product, corpus, retrieval, trace, 'SYNTHETIC question?', scorer),
    v7: () => semanticSupplementContextV7(product, corpus, retrieval, trace, 'SYNTHETIC question?', scorer) };
}

test('v7 completes a small literal packet despite low logits while preserving the entire v6 prefix', async () => {
  const f = fixture(), old = await f.v6(), before = f.calls(), candidate = await f.v7();
  assert.equal(f.calls() - before, 1); assert.deepEqual(candidate.proposal.actualInputs, old.proposal.actualInputs);
  assert.deepEqual(candidate.passages.slice(0, old.passages.length), old.passages);
  assert.equal(candidate.passages.length, 7); assert.equal(candidate.additions.length, 2);
  assert.deepEqual(candidate.packetCompletion.appendedSourceIds, ['s5', 's6']);
  assert.equal(candidate.passages.at(-1)!.originalQuestion, f.product.sources.at(-1)!.originalQuestion);
  assert.equal(candidate.qualityClaimEligible, false);
});

test('v7 falls back atomically when a complete packet exceeds either existing slot bound', async () => {
  for (const [count, baseline] of [[9, 5], [7, 3], [9, 8]]) {
    const f = fixture(count, baseline), old = await f.v6(), candidate = await f.v7();
    assert.deepEqual(candidate.passages, old.passages); assert.deepEqual(candidate.additions, old.additions);
    assert.equal(candidate.packetCompletion.completePacketFits, false);
  }
});

test('completion deduplicates only exact bodies in the same original-question scope', async () => {
  const f = fixture(); f.product.sources[5]!.text = f.product.sources[0]!.text;
  f.product.sources[6]!.text = f.product.sources[0]!.text; f.sync();
  const candidate = await f.v7();
  assert.deepEqual(candidate.packetCompletion.appendedSourceIds, ['s6']);
  assert.equal(candidate.passages.at(-1)!.originalQuestion, 'SYNTHETIC other customer question?');
});

test('completion may restore a validated parent absent from fusion without fabricating a reranker score', async () => {
  const f = fixture(); f.trace.fusion = f.trace.fusion.filter(p => p.id !== 's6');
  const candidate = await f.v7(); const added = candidate.additions.find(a => a.sourceId === 's6')!;
  assert.equal(added.rerankerRank, null); assert.equal(added.rerankerLogit, null);
  assert.equal(candidate.passages.at(-1)!.text, f.product.sources.at(-1)!.text);
});

test('v7 keeps inherited corpus, scope, length and finite-score validation fail-closed', async () => {
  const body = fixture(); body.product.sources[6]!.text += ' changed'; await assert.rejects(body.v7(), /parent differs/);
  const scope = fixture(); scope.product.sources[6]!.originalQuestion = 'changed'; await assert.rejects(scope.v7(), /parent differs/);
  const large = fixture(); large.product.sources[6]!.text = 'SYNTHETIC ' + 'large '.repeat(310); large.sync(); await assert.rejects(large.v7(), /bounds/);
  const wrong = fixture(); wrong.retrieval.corpusVersion = 'wrong'; await assert.rejects(wrong.v7(), /corpus version/);
  for (const value of [NaN, Infinity]) { const f = fixture(); f.scores.set(f.product.sources[0]!.text, value); await assert.rejects(f.v7()); }
});

test('active v6 quantified-peer selection remains exact when full completion cannot fit', async () => {
  const f = fixture(8, 4);
  f.product.sources[4]!.text = 'SYNTHETIC wide opening capacity thirteen ounces.';
  f.product.sources[5]!.text = 'SYNTHETIC five hours until stopping in a room.';
  f.product.sources[6]!.text = 'SYNTHETIC seven hours on one fill with conditions unknown.';
  f.product.sources[7]!.text = 'SYNTHETIC eight hours before manual stopping, not exhaustion.';
  delete f.product.sources[7]!.originalQuestion;
  for (const [index, score] of [[4, -.5], [5, -3], [6, -3.5], [7, -6.5]]) f.scores.set(f.product.sources[index]!.text, score);
  f.sync();
  const old = await f.v6(), candidate = await f.v7();
  assert.equal(old.peerSelection.applied!.peer.sourceId, 's7');
  assert.deepEqual(candidate.passages, old.passages); assert.deepEqual(candidate.additions, old.additions);
  assert.equal(candidate.packetCompletion.reason, 'three_supplement_limit');
});
