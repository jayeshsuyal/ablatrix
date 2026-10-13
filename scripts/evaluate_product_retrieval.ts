import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadProductCorpus } from '../server/product-corpus.ts';
import { ProductRetriever } from '../server/product-retrieval.ts';

const [flag, outputArgument, ...rest] = process.argv.slice(2);
if (flag !== '--out' || !outputArgument || rest.length) throw new Error('Usage: npm run feedback:retrieval-audit -- --out <new-file.json>');
const output = resolve(outputArgument);
if (existsSync(output)) throw new Error('Output already exists; choose a new file to preserve historical audits.');

// Keep this measurement local and isolate its index from the application.
// The pinned model must already be cached.
globalThis.fetch = (async () => { throw new Error('Offline retrieval audit requires cached embedding assets.'); }) as typeof fetch;
const corpus = loadProductCorpus();
const retriever = new ProductRetriever(corpus, ':memory:');
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
const report = { format: 'ablatrix-offline-retrieval-audit-v1', corpusVersion: corpus.version, embeddingModel, retrievalMethod, rankingPolicy: 'BM25, dense and hybrid rankings include exact parent-question identifier priority before candidate truncation.', topK: 5, split: 'development', annotationCaveat: 'Upstream reference passage membership is AI-assisted and contains acknowledged errors. This is passage retrieval coverage, not answer correctness.', summary, cases: rows };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ output, summary }));
