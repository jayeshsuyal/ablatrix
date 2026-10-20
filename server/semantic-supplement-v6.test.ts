import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { textHash } from './product-corpus.ts';
import type { ProductCorpus, RetrievalResult } from './loop-types.ts';
import type { RetrievalStageTrace } from './product-retrieval.ts';
import { workspaceSourceChunks, type WorkspaceSourceProduct } from './workspace-retrieval-context.ts';
import { semanticV4Inputs } from './semantic-reranker-v4.ts';
import { semanticSupplementContextV5 } from './semantic-supplement-v5.ts';
import { quantifiedCanonicalUnitsV6, semanticSupplementContextV6, SEMANTIC_SUPPLEMENT_V6 } from './semantic-supplement-v6.ts';

type Source = WorkspaceSourceProduct['sources'][number];
function fixture(options: { scope?: string; peerScope?: string; secondUnit?: string; peerText?: string; peerScore?: number; baselineCount?: number; duplicateAnchors?: boolean } = {}) {
  const measuredScope = options.scope === undefined ? {} : { originalQuestion: options.scope };
  const peerScope = options.peerScope === undefined ? measuredScope : { originalQuestion: options.peerScope };
  const sources: Source[] = [
    ...Array.from({ length: options.baselineCount ?? 5 }, (_, i) => ({ id: `base-${i}`, label: 'bullet', text: `SYNTHETIC unchanged baseline observation ${i}.` })),
    { id: 'capacity', label: 'description', text: 'SYNTHETIC includes thirteen ounces and a wide opening.' },
    { id: 'anchor-a', label: 'review', text: 'SYNTHETIC customer reports five to six hrs with conditions unknown.', ...measuredScope },
    { id: 'anchor-b', label: 'description', text: options.duplicateAnchors ? 'SYNTHETIC customer reports five to six hrs with conditions unknown.' : `SYNTHETIC listing claims more than 6 ${options.secondUnit ?? 'hours'} per use.`, ...measuredScope },
    { id: 'peer', label: 'review', text: options.peerText ?? 'SYNTHETIC nearly eight hours before manual stopping, not exhaustion.', ...peerScope },
    { id: 'unrelated', label: 'review', text: 'SYNTHETIC recommended fluid and unrelated styling.' },
  ];
  const product = { id: 'SYNTHETIC-v6', title: 'SYNTHETIC generic apparatus', sources };
  const corpus: ProductCorpus = { version: 'SYNTHETIC-v6', source: 'SYNTHETIC', license: 'test', cases: [], products: [{ id: product.id, title: product.title, split: 'development' }],
    passages: sources.flatMap(s => workspaceSourceChunks(s.text).map((text, i, chunks) => ({ id: chunks.length === 1 ? s.id : `${s.id}-${i + 1}`, productId: product.id, source: s.label, reference: s.label, text, sha256: textHash(text), ...(s.originalQuestion !== undefined ? { originalQuestion: s.originalQuestion } : {}) }))) };
  const retrieval: RetrievalResult = { corpusVersion: corpus.version, embeddingModel: 'SYNTHETIC', method: 'SYNTHETIC', durationMs: 0,
    passages: sources.filter(s => s.id.startsWith('base-')).map((s, i) => ({ ...corpus.passages.find(p => p.id === s.id)!, lexicalRank: i + 1, semanticRank: i + 2, score: .02 })) };
  const trace = { fusion: corpus.passages.map((p, i) => ({ id: p.id, rank: i + 1 })) } as RetrievalStageTrace;
  const scores = new Map(sources.map(s => [s.id, s.id === 'capacity' ? -.5 : s.id === 'anchor-a' ? -3 : s.id === 'anchor-b' ? -3.5 : s.id === 'peer' ? options.peerScore ?? -6.5 : -8]));
  let calls = 0; const scorer = async (query: string, docs: string[]) => {
    calls++; assert.equal(query, `SYNTHETIC pronoun question? ${product.title}`);
    return docs.map(doc => { const s = sources.find(s => semanticV4Inputs(product, 'SYNTHETIC pronoun question?', s).document === doc)!; assert.ok(s); return scores.get(s.id)!; });
  };
  return { product, corpus, retrieval, trace, scores, scorer, calls: () => calls,
    v5: () => semanticSupplementContextV5(product, corpus, retrieval, trace, 'SYNTHETIC pronoun question?', scorer),
    v6: () => semanticSupplementContextV6(product, corpus, retrieval, trace, 'SYNTHETIC pronoun question?', scorer) };
}

test('v6 promotes one quantified peer with exact original scores, scoped anchors and unchanged baseline bounds', async () => {
  const f = fixture(), v5 = await f.v5(), beforeCalls = f.calls(), v6 = await f.v6();
  assert.equal(f.calls() - beforeCalls, 1, 'V6 must reuse the single unchanged v4/v5 scoring invocation.');
  assert.deepEqual(v5.additions.map(a => a.sourceId), ['capacity', 'anchor-a', 'anchor-b']);
  assert.deepEqual(v6.additions.map(a => a.sourceId), ['anchor-a', 'anchor-b', 'peer']);
  assert.deepEqual(v6.passages.slice(0, 5), v5.passages.slice(0, 5)); assert.equal(v6.passages.length, 8);
  assert.deepEqual(v6.proposal.actualInputs, v5.proposal.actualInputs); assert.equal(v6.peerSelection.strictFloor, -5); assert.equal(v6.peerSelection.peerFloor, -7);
  assert.deepEqual(v6.peerSelection.replacedV5SourceIds, ['capacity']); assert.equal(v6.peerSelection.applied!.unit, 'hour');
  assert.equal(v6.peerSelection.applied!.peer.rerankerLogit, -6.5); assert.equal(v6.peerSelection.applied!.peer.rerankerRank, 4);
  assert.ok(v6.passages.find(p => p.id === 'peer')!.text.includes('manual stopping, not exhaustion'));
  assert.equal(v6.qualityClaimEligible, false); assert.equal(v6.contract, SEMANTIC_SUPPLEMENT_V6.contract);
});

test('quantity parser handles aliases, number words, ranges and fractions without merging time units or reading questions', () => {
  assert.deepEqual(quantifiedCanonicalUnitsV6('About five–six hrs; nearly EIGHT hours; twenty-one hours.'), ['hour']);
  assert.deepEqual(quantifiedCanonicalUnitsV6('1 1/2 inches; 2/3 feet; .5 cm; ２ mm.'), ['centimeter', 'foot', 'inch', 'millimeter']);
  assert.deepEqual(quantifiedCanonicalUnitsV6('2 years and twelve months, then 4 hours.'), ['hour', 'month', 'year']);
  assert.deepEqual(quantifiedCanonicalUnitsV6('one in three people; model-2 hours; hours are unknown'), []);
});

test('no peer, one anchor, nonmatching unit, duplicate anchor bodies or below-band peer returns exact v5 passages', async () => {
  for (const options of [{ secondUnit: 'months' }, { peerText: 'SYNTHETIC nearly eight years of unknown age.' }, { peerScore: -7.01 }, { duplicateAnchors: true }]) {
    const f = fixture(options), a = await f.v5(), b = await f.v6(); assert.deepEqual(b.passages, a.passages); assert.deepEqual(b.additions, a.additions); assert.equal(b.peerSelection.fallbackExactlyV5, true);
  }
});

test('two anchors and peer cannot cross literal original-question scopes or use question-only quantities', async () => {
  for (const options of [{ scope: 'Does SYNTHETIC A operate?', peerScope: 'Does SYNTHETIC B operate?' }, { scope: 'Does SYNTHETIC A operate?', peerScope: 'does SYNTHETIC A operate?' }]) {
    const f = fixture(options); assert.deepEqual((await f.v6()).passages, (await f.v5()).passages);
  }
  const f = fixture({ scope: 'Does SYNTHETIC operate for 8 hours?' });
  f.product.sources.find(s => s.id === 'peer')!.text = 'SYNTHETIC yes, under unspecified conditions.';
  const p = f.corpus.passages.find(p => p.id === 'peer')!; p.text = f.product.sources.find(s => s.id === 'peer')!.text; p.sha256 = textHash(p.text);
  assert.equal((await f.v6()).peerSelection.applied, null);
  const split = fixture({ scope: 'SYNTHETIC model A?' });
  split.product.sources.find(s => s.id === 'anchor-b')!.originalQuestion = 'SYNTHETIC model B?';
  split.corpus.passages.find(p => p.id === 'anchor-b')!.originalQuestion = 'SYNTHETIC model B?';
  assert.equal((await split.v6()).peerSelection.applied, null, 'One anchor in each original scope cannot form a two-anchor group.');
});

test('equal-score equal-MMR peers use actual rank deterministically and promote at most one', async () => {
  const f = fixture(), source: Source = { id: 'peer-tie', label: 'review', text: 'exhaustion. not stopping manual before hours eight nearly SYNTHETIC' };
  f.product.sources.push(source); f.scores.set(source.id, -6.5);
  f.corpus.passages.push({ id: source.id, productId: f.product.id, source: source.label, reference: source.label, text: source.text, sha256: textHash(source.text) });
  f.trace.fusion.push({ id: source.id, rank: f.trace.fusion.length + 1, lexicalRank: null, semanticRank: null, score: 0 });
  const a = await f.v6(); f.product.sources.reverse(); const b = await f.v6();
  assert.equal(a.peerSelection.applied!.peer.sourceId, 'peer'); assert.equal(b.peerSelection.applied!.peer.sourceId, 'peer');
  assert.equal(a.additions.filter(a => a.reasons.includes('conditional_quantified_peer')).length, 1);
  assert.deepEqual(a.passages, b.passages);
});

test('same-unit different facets remain a known retrieval risk rather than compatibility or factual proof', async () => {
  const f = fixture({ peerText: 'SYNTHETIC eight hours of warranty administration; this is not operating duration.' });
  const r = await f.v6(); assert.ok(r.passages.some(p => p.id === 'peer'));
  assert.match(r.peerSelection.limitation, /age, warranty and runtime/); assert.equal(r.qualityClaimEligible, false);
});

test('duplicate peer scope, near duplicates, full baseline and oversized sources cannot silently escape bounds', async () => {
  const full = fixture({ baselineCount: 8 }); const old = await full.v5(), result = await full.v6(); assert.deepEqual(result.passages, old.passages); assert.equal(result.passages.length, 8);
  const near = fixture({ peerText: 'SYNTHETIC customer reports five to six hrs with conditions unknown. Really.' });
  assert.equal((await near.v6()).peerSelection.applied, null);
  const duplicate = fixture({ peerText: 'SYNTHETIC customer reports five to six hrs with conditions unknown.' });
  assert.equal((await duplicate.v6()).peerSelection.applied, null);
  const large = fixture({ peerText: 'SYNTHETIC eight hours ' + 'long '.repeat(310) }); await assert.rejects(large.v6(), /bounds|exceeds/);
});

test('v6 fails closed on changed product, source text, original scope, corpus and malformed score inputs', async () => {
  const changed = fixture(); changed.product.sources.find(s => s.id === 'peer')!.text += ' changed'; await assert.rejects(changed.v6(), /parent differs|Expected/);
  const scope = fixture(); scope.product.sources.find(s => s.id === 'peer')!.originalQuestion = 'changed'; await assert.rejects(scope.v6(), /parent differs/);
  const wrong = fixture(); wrong.retrieval.corpusVersion = 'wrong'; await assert.rejects(wrong.v6(), /corpus version/);
  const model = fixture(); model.scores.set('peer', NaN); await assert.rejects(model.v6());
});

test('v6 leaves frozen historical v5 implementation bytes unchanged and no-peer execution is deterministic', async () => {
  const freeze = JSON.parse(readFileSync(new URL('../docs/evidence/retrieval-diagnosis-2026-10-19/semantic-supplement-v5-freeze-v2.json', import.meta.url), 'utf8'));
  assert.equal(textHash(readFileSync(new URL('./semantic-supplement-v5.ts', import.meta.url), 'utf8')), freeze.codeSha256['server/semantic-supplement-v5.ts']);
  const f = fixture({ peerScore: -8 }); assert.deepEqual((await f.v6()).passages, (await f.v6()).passages);
});
