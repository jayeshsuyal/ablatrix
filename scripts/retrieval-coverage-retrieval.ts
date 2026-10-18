import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ProductRetriever } from '../server/product-retrieval.ts';
import { workspaceCompleteSourceContext } from '../server/workspace-retrieval-context.ts';
import { workspaceSourceCoverageContext } from '../server/workspace-source-coverage.ts';
import { contextComparisonHash } from '../server/context-comparison.ts';
import { RETRIEVAL_COVERAGE_RETRIEVAL_FILES, retrievalCoverageCorpus, sourceCalibrationHash as hash } from '../server/source-calibration-comparison.ts';

const [flag, cohortArgument, outFlag, outputArgument, ...rest] = process.argv.slice(2);
assert.ok(flag === '--cohort' && cohortArgument && outFlag === '--out' && outputArgument && !rest.length,
  'Usage: node --import tsx scripts/retrieval-coverage-retrieval.ts --cohort <cohort.json> --out <new-retrieval.json>');
const output = resolve(outputArgument), raw = readFileSync(resolve(cohortArgument));
assert.ok(!existsSync(output), 'Preserve existing retrieval snapshots.');
const cohort = JSON.parse(raw.toString()), { cohortSha256, ...cohortBody } = cohort;
assert.equal(cohort.format, 'ablatrix-retrieval-coverage-cohort-v1'); assert.equal(cohortSha256, contextComparisonHash(cohortBody));
assert.equal(cohort.cases.length, 8); assert.equal(new Set(cohort.cases.map((c: any) => c.product.id)).size, 8);
const corpus = retrievalCoverageCorpus({ path: cohortArgument, fileSha256: hash(raw), document: cohort });
// Local, pinned embedding assets only. No Router calls, downloads or fallback.
globalThis.fetch = (async () => { throw new Error('Retrieval comparison requires cached local embedding assets.'); }) as typeof fetch;
const retriever = new ProductRetriever(corpus, ':memory:'), results = [];
try {
  for (const item of cohort.cases) {
    const indexRetrieval = await retriever.retrieve(item.product.id, item.question);
    const product = { ...item.product, sources: item.sources.map((source: any) => ({ ...source, originalQuestion: source.originalQuestion ?? undefined })) };
    const baseline = workspaceCompleteSourceContext(product, corpus, indexRetrieval), candidate = workspaceSourceCoverageContext(product, corpus, indexRetrieval, item.question);
    assert.ok(baseline.length > 0); assert.deepEqual(candidate.passages.slice(0, baseline.length), baseline);
    results.push({ caseId: item.id, indexRetrieval, baseline: { ...indexRetrieval, passages: baseline }, candidate: { ...indexRetrieval, passages: candidate.passages }, additions: candidate.additions, contract: candidate.contract });
  }
} finally { retriever.close(); }
const body = { format: 'retrieval-coverage-retrieval-v1', cohortFileSha256: hash(raw), implementationSha256: Object.fromEntries(RETRIEVAL_COVERAGE_RETRIEVAL_FILES.map(path => [path, hash(readFileSync(path))])), corpusSha256: hash(corpus), results, providerCalls: 0, semanticAssessment: 'not_run', generationPerformed: false };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ ...body, sha256: hash(body) }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ cases: results.length, selectedSourceCounts: results.map(row => ({ baseline: row.baseline.passages.length, candidate: row.candidate.passages.length })), providerCalls: 0, generationPerformed: false }));
