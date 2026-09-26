import { readFileSync, writeFileSync } from 'node:fs';
import { loadProductCorpus } from '../server/product-corpus.ts';
import { ProductRetriever } from '../server/product-retrieval.ts';

globalThis.fetch = (async () => { throw new Error('Offline candidate audit requires cached embedding assets.'); }) as typeof fetch;
const corpus = loadProductCorpus();
const baseline = JSON.parse(readFileSync('docs/evidence/retrieval-audit-before-cqa-2026-09-26.json', 'utf8')) as { corpusVersion: string; cases: { caseId: string; methods: { hybrid: { passageIds: string[]; matchedIds: string[] } } }[] };
if (baseline.corpusVersion !== corpus.version) throw new Error('Baseline retrieval packet uses another corpus.');
const retriever = new ProductRetriever(corpus, ':memory:', { cqaAnswerOnly: true });
const rows: { caseId: string; baselineHits: number; candidateHits: number; baselineFirst: string | null; candidateFirst: string | null; candidateIds: string[] }[] = [];
try {
  for (const item of corpus.cases.filter(item => item.split === 'development')) {
    const result = await retriever.retrieve(item.productId, item.question);
    const selected = result.passages.map(passage => passage.id);
    const previous = baseline.cases.find(row => row.caseId === item.id)!;
    rows.push({ caseId: item.id, baselineHits: previous.methods.hybrid.matchedIds.length, candidateHits: selected.filter(id => item.referencePassageIds.includes(id)).length, baselineFirst: previous.methods.hybrid.passageIds[0] ?? null, candidateFirst: selected[0] ?? null, candidateIds: selected });
  }
} finally { retriever.close(); }
const report = { format: 'ablatrix-cqa-answer-index-comparison-v1', corpusVersion: corpus.version, split: 'development', annotationCaveat: 'AI-assisted passage membership is an imperfect retrieval proxy; answer correctness was not measured.', baselineHits: rows.reduce((sum, row) => sum + row.baselineHits, 0), candidateHits: rows.reduce((sum, row) => sum + row.candidateHits, 0), cases: rows };
writeFileSync('docs/evidence/retrieval-cqa-comparison-2026-09-26.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ baselineHits: report.baselineHits, candidateHits: report.candidateHits, changedCases: rows.filter(row => row.baselineHits !== row.candidateHits || row.baselineFirst !== row.candidateFirst).map(row => row.caseId) }));
