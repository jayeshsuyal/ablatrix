import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { textHash } from './product-corpus.ts';
import { sourceCoverageV2Corpus } from '../scripts/source-coverage-v2-retrieval.ts';
import { verifySavedDiagnosisRow, verifySavedBm25Rows } from './retrieval-diagnosis-replay.ts';
const directory = 'docs/evidence/retrieval-source-coverage-v2-2026-10-18';
const artifact = (name: string) => { const path = `${directory}/${name}`, raw = readFileSync(path, 'utf8'); return { path, fileSha256: textHash(raw), document: JSON.parse(raw) }; };
const deck = artifact('deck-v1.json'), baseline = artifact('baseline-v1.json'), review = artifact('source-review-v1.json');
const saved = JSON.parse(readFileSync('docs/evidence/retrieval-diagnosis-2026-10-19/stage-traces-v3-final.json', 'utf8'));
const corpus = sourceCoverageV2Corpus(deck), torch = saved.results.findIndex((row: any) => row.caseId === 'source-coverage-v2-train-12870');
const replay = (row: any, index = torch) => verifySavedDiagnosisRow(row, deck.document.cases[index], corpus, baseline.document.results[index], review.document.cases[index].designatedFacts);

test('saved score replay reconstructs all twelve FTS/scope/fusion/selection and semantic decisions without models', async () => {
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('No network or provider belongs in saved replay.'); };
  try { for (const [index, row] of saved.results.entries()) await replay(row, index); }
  finally { globalThis.fetch = originalFetch; }
});

test('raw BM25 replay permits only observed platform rounding while preserving exact IDs, ranks and ordering', () => {
  // Exact values from macOS saved evidence and the Node 24.10 Linux CI build.
  const saved = [-7.729627689178682, -6.676284155796843, -2.1648782916031353, -1.9556096037396151].map((score, i) => ({ id: `source-${i}`, rank: i + 1, score }));
  const linux = [-7.729627689178683, -6.676284155796844, -2.164878291603135, -1.9556096037396156].map((score, i) => ({ id: `source-${i}`, rank: i + 1, score }));
  verifySavedBm25Rows(linux, saved); verifySavedBm25Rows(saved, linux);
  for (const change of [
    (rows: typeof saved) => { rows[0]!.score -= 1e-12; },
    (rows: typeof saved) => { rows[0]!.score = Infinity; },
    (rows: typeof saved) => { rows[0]!.rank = 2; },
    (rows: typeof saved) => { rows[0]!.id = 'different'; },
    (rows: typeof saved) => { rows.reverse(); }
  ]) {
    const changed = structuredClone(linux); change(changed); assert.throws(() => verifySavedBm25Rows(changed, saved));
  }
});

const mutations: [string, (row: any) => void][] = [
  ['a changed score even when its rank stays stable', row => { row.semantic.ranking[0].score += .01; }],
  ['the original all-score corruption reproduction', row => { for (const entry of row.semantic.ranking) entry.score = 1e12; }],
  ['a nonfinite saved score', row => { row.semantic.ranking[0].score = Infinity; }],
  ['a forged consecutive rank', row => { row.semantic.ranking[0].rank = 99999; }],
  ['a duplicate scorer source ID', row => { row.semantic.ranking[1].sourceId = row.semantic.ranking[0].sourceId; }],
  ['a changed MMR skip decision', row => { row.semantic.decisions[0].reason = 'forged'; }],
  ['changed semantic literal text', row => { row.semantic.passages[0].text += ' changed'; }],
  ['changed semantic original model scope', row => { row.semantic.passages[0].originalQuestion = 'Another model ZX-99?'; }],
  ['an invented high score only in the all-source mode', row => { row.allSources.ranking[0].score += .01; }],
  ['a changed scorer query', row => { row.semantic.query += ' burn'; }],
  ['a baseline selected flag', row => { row.trace.selection[0].selected = !row.trace.selection[0].selected; }],
  ['a baseline skip reason', row => { row.trace.selection.at(-1).reason = 'forged'; }],
  ['an invented BM25 score', row => { row.trace.bm25Raw[0].score -= 1; }],
  ['a forged exact-scope promotion', row => { row.trace.denseCandidates[0].scopePromoted = !row.trace.denseCandidates[0].scopePromoted; }],
  ['a changed question', row => { row.question += ' burn'; }],
  ['changed literal product source scope', row => { row.product.sources[0].originalQuestion = 'Other original question?'; }],
  ['a changed designated fact', row => { row.semanticDiagnosis.designated[0].quote += ' forged'; }]
];
for (const [name, mutate] of mutations) test(`saved diagnosis rejects ${name}`, async () => {
  const row = structuredClone(saved.results[torch]); mutate(row); await assert.rejects(replay(row));
});
