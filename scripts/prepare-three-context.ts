/** Offline preparation only. Actual negative source result prevents a paid plan. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareThreeContext, diagnosticHash, DIAGNOSTIC_LEDGER } from '../server/three-context-diagnostic.ts';
import { readLedgerAnchor } from '../server/source-calibration-comparison.ts';
import type { RetrievedPassage } from '../server/loop-types.ts';
import { textHash } from '../server/product-corpus.ts';
const [input, output] = process.argv.slice(2); assert.ok(input && output, 'Usage: prepare-three-context.ts STAGE_TRACE NEW_OUTPUT');
const trace = JSON.parse(readFileSync(input, 'utf8')), row = trace.results.find((r: any) => r.caseId === 'source-coverage-v2-train-12870'); assert.ok(row);
const reviewPath = 'docs/evidence/retrieval-source-coverage-v2-2026-10-18/source-review-v1.json';
assert.equal(textHash(readFileSync(reviewPath, 'utf8')), trace.inputBindings.review);
const reviewed = JSON.parse(readFileSync(reviewPath, 'utf8')).cases.find((r: any) => r.caseId === row.caseId);
const completeSources: RetrievedPassage[] = row.product.sources.map((s: any) => ({ id: s.id, productId: row.product.id, source: s.label, reference: s.label, text: s.text, sha256: textHash(s.text), ...(s.originalQuestion !== undefined ? { originalQuestion: s.originalQuestion } : {}), lexicalRank: null, semanticRank: null, score: 0 }));
const selectedIds = new Set(reviewed.designatedFacts.flatMap((f: any) => f.sourceIds));
const implementationFiles = ['server/three-context-diagnostic.ts', 'server/workspace-generation.ts', 'server/feedback-provider.ts', 'server/citation-options.ts', 'server/semantic-reranker.ts', 'server/product-retrieval.ts', 'server/retrieval-diagnosis.ts', 'scripts/prepare-three-context.ts', 'scripts/retrieval-diagnosis.ts', 'package-lock.json'];
const digestFile = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const manifest = prepareThreeContext({ cases: [{ id: row.caseId, product: { id: row.product.id, title: row.product.title, split: 'development' }, question: row.question, completeSources, contexts: { current: row.baseline, semantic: row.semantic.passages, reference: completeSources.filter(s => selectedIds.has(s.id)) }, designatedFacts: reviewed.designatedFacts,
  referenceReview: { provenance: 'source_checked_ai', reviewer: 'Saved independent source-gap review; curated union of all three designated literal parents', sufficientFor: 'Attributing the three duration reports and their qualifications, with no universal-average claim', unknowns: ['Population average, initial fill and fuel/wick/weather conditions are unknown.', 'Nearly eight hours ended by manual extinguishing; it is not a fuel exhaustion time.'], sourcePoolSha256: diagnosticHash(completeSources) } }],
  policy: { id: 'three-context-shared-baseline', parentId: null, instructions: 'Answer the customer question from supplied sources, retain exact product and workflow scope, attribute reports, preserve conditions and uncertainty, and use only literal supplied citations.', rationale: 'Identical frozen diagnostic policy across all three contexts.', feedbackRunIds: [], status: 'baseline', mode: 'live', createdAt: '2026-10-19T00:00:00Z' }, implementationSha256: Object.fromEntries(implementationFiles.map(p => [p, digestFile(p)])), artifactSha256: Object.fromEntries([input, reviewPath].map(p => [p, digestFile(p)])), ledger: readLedgerAnchor(DIAGNOSTIC_LEDGER, .200281), codeReviewPassed: false });
writeFileSync(resolve(output), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ preparedContexts: manifest.document.slots.length, paidPlan: manifest.document.paidPlan, stopReason: manifest.document.stopReason, providerCalls: 0, qualityClaimEligible: false }));
