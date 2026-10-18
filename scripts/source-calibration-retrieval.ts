import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ProductRetriever } from '../server/product-retrieval.ts';
import { textHash } from '../server/product-corpus.ts';
import { workspaceReviewSourceHash } from '../server/answer-review-source.ts';
import { workspaceSourceChunks, workspaceCompleteSourceContext } from '../server/workspace-retrieval-context.ts';
import type { ProductCorpus } from '../server/loop-types.ts';

const [flag, cohortArgument, outFlag, outputArgument, ...rest] = process.argv.slice(2);
assert.ok(flag === '--cohort' && cohortArgument && outFlag === '--out' && outputArgument && !rest.length,
  'Usage: node --import tsx scripts/source-calibration-retrieval.ts --cohort <cohort.json> --out <new-retrieval.json>');
const output = resolve(outputArgument), raw = readFileSync(resolve(cohortArgument));
assert.ok(!existsSync(output), 'Preserve existing retrieval snapshots.');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
type Source = { id: string; label: string; text: string; originalQuestion: string | null; reference: string; sha256: string };
type Case = { id: string; product: { id: string; title: string }; question: string; sources: Source[] };
const cohort = JSON.parse(raw.toString()) as { cases: Case[] };
assert.equal(cohort.cases.length, 8);
assert.equal(new Set(cohort.cases.map(item => item.product.id)).size, 8);
// This uses the workspace's existing indexing and complete-parent restoration.
// Generation receives the same frozen selected bodies in both comparison arms.
const corpus: ProductCorpus = {
  version: `source-calibration-${hash(raw).slice(0, 24)}`, source: 'Frozen pinned ePQA train source-only selection', license: 'CDLA-Sharing-1.0', cases: [],
  products: cohort.cases.map(item => ({ ...item.product, split: 'validation' })),
  passages: cohort.cases.flatMap(item => item.sources.flatMap(source => {
    assert.equal(source.sha256, workspaceReviewSourceHash(source));
    assert.ok(source.text.length <= 1500 && !source.text.includes('\u0000'));
    return workspaceSourceChunks(source.text).map((text, index, chunks) => ({
      id: chunks.length === 1 ? source.id : `${source.id}-${index + 1}`, productId: item.product.id,
      source: source.label, text, reference: chunks.length === 1 ? source.label : `${source.label} (part ${index + 1})`, sha256: textHash(text),
      ...(source.originalQuestion ? { originalQuestion: source.originalQuestion } : {})
    }));
  }))
};
// No downloads or model/API fallback. Pinned local embedding assets must exist.
globalThis.fetch = (async () => { throw new Error('Source calibration retrieval requires cached local embedding assets.'); }) as typeof fetch;
const retriever = new ProductRetriever(corpus, ':memory:');
const results = [];
try {
  for (const item of cohort.cases) {
    const indexRetrieval = await retriever.retrieve(item.product.id, item.question);
    const passages = workspaceCompleteSourceContext({ ...item.product, sources: item.sources.map(source => ({ ...source, ...(source.originalQuestion ? { originalQuestion: source.originalQuestion } : { originalQuestion: undefined }) })) }, corpus, indexRetrieval);
    assert.ok(passages.length > 0);
    results.push({ caseId: item.id, indexRetrieval, retrieval: { ...indexRetrieval, passages } });
  }
} finally { retriever.close(); }
const codeFiles = ['scripts/source-calibration-retrieval.ts', 'server/product-retrieval.ts', 'server/workspace-retrieval-context.ts', 'server/product-corpus.ts', 'server/loop-types.ts', 'package-lock.json'];
const body = { format: 'source-calibration-retrieval-v1', cohortFileSha256: hash(raw), implementationSha256: Object.fromEntries(codeFiles.map(path => [path, hash(readFileSync(path))])), corpusSha256: textHash(JSON.stringify(corpus)), results, providerCalls: 0, semanticAssessment: 'not_run', generationPerformed: false };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ ...body, sha256: textHash(JSON.stringify(body)) }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ cases: results.length, selectedSourceCounts: results.map(item => item.retrieval.passages.length), providerCalls: 0, generationPerformed: false }));
