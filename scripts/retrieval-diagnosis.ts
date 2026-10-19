/** Exposed development only. Zero provider calls. No .env or credential imports. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ProductRetriever } from '../server/product-retrieval.ts';
import { textHash } from '../server/product-corpus.ts';
import { sourceCoverageV2Corpus } from './source-coverage-v2-retrieval.ts';
import { workspaceCompleteSourceContext } from '../server/workspace-retrieval-context.ts';
import { workspaceSourceCoverageV2Context } from '../server/workspace-source-coverage-v2.ts';
import { cachedCrossEncoder, semanticContext, SEMANTIC_RERANKER } from '../server/semantic-reranker.ts';
import { diagnoseUsefulSources } from '../server/retrieval-diagnosis.ts';
const directory = 'docs/evidence/retrieval-source-coverage-v2-2026-10-18';
const artifact = (name: string) => { const path = `${directory}/${name}`, raw = readFileSync(path, 'utf8'); return { path, fileSha256: textHash(raw), document: JSON.parse(raw) }; };
const deck = artifact('deck-v1.json'), review = artifact('source-review-v1.json'), saved = artifact('baseline-v1.json');
const corpus = sourceCoverageV2Corpus(deck), retriever = new ProductRetriever(corpus, ':memory:', { cachedOnly: true }), scorer = cachedCrossEncoder();
const previousFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('Diagnosis is offline. Run explicit model preparation separately.'); };
const results = [];
try {
  for (const [index, item] of deck.document.cases.entries()) {
    const product = { ...item.product, sources: item.sources.map((s: any) => ({ ...s, originalQuestion: s.originalQuestion ?? undefined })) };
    const { result, trace } = await retriever.diagnose(product.id, item.question);
    const baseline = workspaceCompleteSourceContext(product, corpus, result), v2 = workspaceSourceCoverageV2Context(product, corpus, result, item.question);
    assert.deepEqual(result.passages, saved.document.results[index].indexRetrieval.passages, 'Instrumentation must preserve historical selection.');
    const facts = review.document.cases[index].designatedFacts;
    const semantic = await semanticContext(product, corpus, result, trace, item.question, scorer);
    const allSources = await semanticContext(product, corpus, result, trace, item.question, scorer, 'all_product_sources_development');
    results.push({ caseId: item.id, product, question: item.question, trace, baseline, v2, semantic, allSources,
      baselineDiagnosis: diagnoseUsefulSources(product, corpus, result, trace, facts, baseline), v2Diagnosis: diagnoseUsefulSources(product, corpus, result, trace, facts, v2.passages, v2.additions),
      semanticDiagnosis: diagnoseUsefulSources(product, corpus, result, trace, facts, semantic.passages), allSourcesDiagnosis: diagnoseUsefulSources(product, corpus, result, trace, facts, allSources.passages) });
    console.error(`${item.id}: ${semantic.passages.length} hybrid reranked / ${allSources.passages.length} all-source parents`);
  }
} finally { retriever.close(); globalThis.fetch = previousFetch; }
const codeFiles = ['server/product-retrieval.ts', 'server/retrieval-diagnosis.ts', 'server/semantic-reranker.ts', 'server/workspace-source-coverage-v2.ts', 'server/workspace-retrieval-context.ts', 'scripts/source-coverage-v2-retrieval.ts', 'scripts/retrieval-diagnosis.ts', 'package-lock.json'];
const implementationSha256 = Object.fromEntries(codeFiles.map(path => [path, textHash(readFileSync(path, 'utf8'))]));
const document = { implementationSha256, runtime: { node: process.version, platform: process.platform, architecture: process.arch, scoreRuntime: '@huggingface/transformers 4.3.0 / ONNX CPU q8', resourcesInclude: 'BGE and cross-encoder in same process; first case includes cold cross-encoder load, subsequent cases warm; process peak RSS is cumulative' }, format: 'ablatrix-retrieval-stage-diagnosis-v3-development', exposure: 'All twelve cases were exposed by the failed v2 study; none are fresh validation.', inputBindings: { deck: deck.fileSha256, review: review.fileSha256, baseline: saved.fileSha256 }, model: SEMANTIC_RERANKER, results, providerCalls: 0, generatedAnswers: 0, qualityClaimEligible: false };
const output = process.argv[2]; assert.ok(output, 'Supply a new output JSON path.'); writeFileSync(resolve(output), JSON.stringify(document, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ cases: results.length, output, providerCalls: 0 }));
