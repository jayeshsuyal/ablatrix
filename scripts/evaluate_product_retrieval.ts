import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadProductCorpus } from '../server/product-corpus.ts';
import { ProductRetriever } from '../server/product-retrieval.ts';

// Keep this measurement local. The pinned model must already be cached.
globalThis.fetch = (async () => { throw new Error('Offline retrieval audit requires cached embedding assets.'); }) as typeof fetch;
const corpus = loadProductCorpus();
const retriever = new ProductRetriever(corpus, process.env.ABLATRIX_RETRIEVAL_DB ?? '.data/product-retrieval.sqlite');
const cases = corpus.cases.filter(item => item.split === 'development');
const rows: { caseId: string; productId: string; referenceCount: number; methods: Record<string, { passageIds: string[]; matchedIds: string[]; missingIds: string[] }> }[] = [];
let embeddingModel = '';
let retrievalMethod = '';
try {
  for (const item of cases) {
    const { result, rankings } = await retriever.compareRankings(item.productId, item.question);
    embeddingModel = result.embeddingModel;
    retrievalMethod = result.method;
    const reference = new Set(item.referencePassageIds);
    const methods = Object.fromEntries(Object.entries(rankings).map(([name, ids]) => [name, {
      passageIds: ids,
      matchedIds: ids.filter(id => reference.has(id)),
      missingIds: [...reference].filter(id => !ids.includes(id))
    }]));
    rows.push({ caseId: item.id, productId: item.productId, referenceCount: reference.size, methods });
  }
} finally { retriever.close(); }
const summary = Object.fromEntries(['bm25', 'dense', 'hybrid'].map(name => {
  const matched = rows.reduce((sum, row) => sum + row.methods[name].matchedIds.length, 0);
  return [name, { matchedReferencePassages: matched, totalReferencePassages: rows.reduce((sum, row) => sum + row.referenceCount, 0), casesWithAnyReference: rows.filter(row => row.methods[name].matchedIds.length > 0).length, cases: rows.length }];
}));
const report = { format: 'ablatrix-offline-retrieval-audit-v1', corpusVersion: corpus.version, embeddingModel, retrievalMethod, topK: 5, split: 'development', annotationCaveat: 'Upstream reference passage membership is AI-assisted and contains acknowledged errors. This is passage retrieval coverage, not answer correctness.', summary, cases: rows };
const output = resolve(process.argv[2] ?? 'docs/evidence/retrieval-audit-2026-09-26.json');
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, summary }));
