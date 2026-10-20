/** Exposed-development replay only. No model downloads, provider or credential path. */
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { textHash } from './product-corpus.ts';
import { semanticSupplementContextV6, SEMANTIC_SUPPLEMENT_V6 } from './semantic-supplement-v6.ts';
import { semanticSupplementContextV5 } from './semantic-supplement-v5.ts';
import { diagnoseUsefulSources } from './retrieval-diagnosis.ts';
import { replaySavedStages } from './retrieval-diagnosis-replay.ts';
import { workspaceCompleteSourceContext } from './workspace-retrieval-context.ts';
import { workspaceGenerationPromptIdentity, WORKSPACE_GENERATION_CONTRACT } from './workspace-generation.ts';
import { WORKSPACE_UNCERTAINTY_CONTRACT, WORKSPACE_UNCERTAINTY_RULES } from './workspace-uncertainty-policy.ts';
import { sourceCoverageV2Corpus } from '../scripts/source-coverage-v2-retrieval.ts';
import { REVIEWED_V5_RESULT, verifyReviewedV5DevelopmentResult } from '../scripts/prepare-three-context-v5.ts';
import type { RetrievalResult } from './loop-types.ts';

type Json = Record<string, any>;
const repository = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const evidence = 'docs/evidence/retrieval-diagnosis-2026-10-19';
const source = 'docs/evidence/retrieval-source-coverage-v2-2026-10-18';
export const REPORT_DEVELOPMENT_PATHS = Object.freeze({
  deck: `${source}/deck-v1.json`, sourceReview: `${source}/source-review-v1.json`, baseline: `${source}/baseline-v1.json`,
  stages: `${evidence}/stage-traces-v3-final.json`, v4Result: `${evidence}/semantic-input-v4-development-v1.json`,
  v4Freeze: `${evidence}/semantic-input-v4-freeze-v1.json`, v5Freeze: `${evidence}/semantic-supplement-v5-freeze-v2.json`,
  v5Result: REVIEWED_V5_RESULT.path, v5Review: REVIEWED_V5_RESULT.reviewPath,
});
export function reportDevelopmentFile(root: string, name: string) {
  assert.ok(isAbsolute(root) && realpathSync(root) === root);
  assert.ok(name && !isAbsolute(name) && !name.includes('\\') && !name.split('/').some(p => p === '..' || p === '.'));
  const path = resolve(root, name);
  assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() && realpathSync(path) === path, 'Use canonical repository files.');
  return path;
}
function snapshot(root: string, path: string) {
  const bytes = readFileSync(reportDevelopmentFile(root, path), 'utf8');
  return { path, bytes, fileSha256: textHash(bytes), document: JSON.parse(bytes) as Json };
}
export function reportDevelopmentImplementation(root: string, roots: readonly string[] = ['server/report-uncertainty-development.ts', 'scripts/retrieval-diagnosis-v6.ts',
    'server/semantic-supplement-v6.ts', 'server/workspace-uncertainty-policy.ts', 'package.json', 'package-lock.json']) {
  const pending = [...roots];
  const seen = new Set<string>();
  while (pending.length) {
    const path = pending.pop()!; if (seen.has(path)) continue;
    const body = readFileSync(reportDevelopmentFile(root, path), 'utf8'); seen.add(path);
    if (!path.endsWith('.ts')) continue;
    for (const match of body.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)["'](\.{1,2}\/[^"']+)["']/g)) {
      pending.push(relative(root, resolve(root, dirname(path), match[1]!)));
    }
  }
  return Object.fromEntries([...seen].sort().map(path => [path, textHash(readFileSync(reportDevelopmentFile(root, path), 'utf8'))]));
}
function writeNew(root: string, name: string, document: unknown) {
  const path = resolve(root, name); assert.ok(!existsSync(path) && relative(root, path).split('/').every(p => p !== '..'));
  assert.equal(realpathSync(dirname(path)), dirname(path));
  writeFileSync(path, JSON.stringify(document, null, 2) + '\n', { flag: 'wx', mode: 0o644 }); return path;
}
function assertHistoricalMaps(root: string, document: Json) {
  for (const map of [document.codeSha256, document.inputSha256]) for (const [path, sha] of Object.entries(map)) {
    assert.equal(textHash(readFileSync(reportDevelopmentFile(root, path), 'utf8')), sha, `Historical frozen input changed: ${path}`);
  }
}
export function freezeReportUncertaintyDevelopment(freezePath: string, policyPath: string, root = repository) {
  const pinned = verifyReviewedV5DevelopmentResult(REVIEWED_V5_RESULT.path, root);
  const old = snapshot(root, REPORT_DEVELOPMENT_PATHS.v5Freeze);
  assert.equal(old.fileSha256, '24f85ef7f659ba52211d3f57fb7a205d702eda4e86c874f186b2abb8dc14a6b9');
  assertHistoricalMaps(root, old.document);
  const implementationSha256 = reportDevelopmentImplementation(root);
  const policy = { format: 'ablatrix-workspace-uncertainty-policy-freeze-v1', createdAt: new Date().toISOString(),
    contract: WORKSPACE_UNCERTAINTY_CONTRACT, rules: WORKSPACE_UNCERTAINTY_RULES,
    prompt: workspaceGenerationPromptIdentity(WORKSPACE_UNCERTAINTY_CONTRACT),
    controlPrompt: workspaceGenerationPromptIdentity(WORKSPACE_GENERATION_CONTRACT), implementationSha256,
    historicalContractsUnchanged: true, sourceFactsEmbedded: false, providerCalls: 0, paidExecutionAuthorized: false, qualityClaimEligible: false };
  writeNew(root, policyPath, policy);
  const inputSha256 = Object.fromEntries([...Object.values(REPORT_DEVELOPMENT_PATHS), policyPath].sort().map(path => [path, snapshot(root, path).fileSha256]));
  const freeze = { format: 'ablatrix-report-uncertainty-v6-candidate-freeze-v1', createdAt: new Date().toISOString(),
    candidate: SEMANTIC_SUPPLEMENT_V6, implementationSha256, inputSha256, policyPath,
    cases: pinned.result.results.map((row: Json) => row.caseId),
    protocol: { exposure: 'Same twelve exposed development products; candidate selected after prior missing-report and crowding diagnosis.',
      scores: 'Exact frozen question-plus-title/literal-body-plus-original-question v4 logits; no new inference or model claim.',
      denominator: 'Keep every case, miss, complete control and source uncertainty. Designated units do not label all sources or all twelve cases.',
      semantics: 'Quantified-unit/scope grouping is a bounded retrieval signal, not proof of equivalent facet, applicability, source truth or answer quality.',
      runtime: 'Cached-only model implementation retained for later inference. This command replays saved inputs and selection only.' },
    providerCalls: 0, freshInputReads: 0, paidExecutionAuthorized: false, qualityClaimEligible: false };
  writeNew(root, freezePath, freeze); return { freezePath, policyPath, freezeFileSha256: snapshot(root, freezePath).fileSha256, policyFileSha256: snapshot(root, policyPath).fileSha256 };
}
function readFreeze(root: string, path: string) {
  const freeze = snapshot(root, path), f = freeze.document;
  assert.equal(f.format, 'ablatrix-report-uncertainty-v6-candidate-freeze-v1'); assert.deepEqual(f.candidate, SEMANTIC_SUPPLEMENT_V6);
  assert.equal(f.providerCalls, 0); assert.equal(f.freshInputReads, 0); assert.equal(f.paidExecutionAuthorized, false);
  assert.deepEqual(f.implementationSha256, reportDevelopmentImplementation(root));
  assert.deepEqual(Object.keys(f.inputSha256).sort(), [...Object.values(REPORT_DEVELOPMENT_PATHS), f.policyPath].sort());
  for (const [path, sha] of Object.entries(f.inputSha256)) assert.equal(snapshot(root, path).fileSha256, sha);
  const policy = snapshot(root, f.policyPath).document;
  assert.equal(policy.format, 'ablatrix-workspace-uncertainty-policy-freeze-v1'); assert.equal(policy.contract, WORKSPACE_UNCERTAINTY_CONTRACT);
  assert.deepEqual(policy.prompt, workspaceGenerationPromptIdentity(WORKSPACE_UNCERTAINTY_CONTRACT));
  assert.deepEqual(policy.controlPrompt, workspaceGenerationPromptIdentity(WORKSPACE_GENERATION_CONTRACT));
  assert.equal(policy.rules, WORKSPACE_UNCERTAINTY_RULES); assert.deepEqual(policy.implementationSha256, f.implementationSha256);
  return freeze;
}
export async function replayReportUncertaintyDevelopment(freezePath: string, root = repository) {
  const freeze = readFreeze(root, freezePath), files = Object.fromEntries(Object.entries(REPORT_DEVELOPMENT_PATHS).map(([key, path]) => [key, snapshot(root, path)]));
  verifyReviewedV5DevelopmentResult(REVIEWED_V5_RESULT.path, root);
  assertHistoricalMaps(root, files.v5Freeze!.document); assertHistoricalMaps(root, files.v4Freeze!.document);
  const deck = files.deck!, corpus = sourceCoverageV2Corpus(deck), stages = files.stages!.document;
  const oldV4 = files.v4Result!.document, oldV5 = files.v5Result!.document, sourceReview = files.sourceReview!.document;
  const ids = deck.document.cases.map((item: Json) => item.id);
  for (const rows of [stages.results, oldV4.results, oldV5.results, sourceReview.cases]) assert.deepEqual(rows.map((item: Json) => item.caseId), ids);
  assert.deepEqual(freeze.document.cases, ids); assert.equal(stages.inputBindings.deck, deck.fileSha256);
  const results: Json[] = [], previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Saved development replay forbids network/model/provider access.'); };
  try {
    for (const [index, item] of deck.document.cases.entries()) {
      const old = stages.results[index], previous = oldV5.results[index], inputs = oldV4.results[index].candidate.actualInputs;
      const product = { ...item.product, sources: item.sources.map((s: Json) => ({ ...s, originalQuestion: s.originalQuestion ?? undefined })) };
      assert.deepEqual(old.product, JSON.parse(JSON.stringify(product))); assert.equal(old.question, item.question);
      const replayed = await replaySavedStages(corpus, product.id, item.question, old.trace);
      const retrieval: RetrievalResult = { corpusVersion: corpus.version, embeddingModel: 'saved-baseline-diagnostic', method: 'saved-baseline-diagnostic', durationMs: 0, passages: replayed.passages };
      assert.deepEqual(workspaceCompleteSourceContext(product, corpus, retrieval), old.baseline);
      assert.equal(textHash(inputs.query), inputs.querySha256);
      const scores = new Map<string, number>(), consumed = new Set<string>();
      for (const row of inputs.documents) { assert.equal(textHash(row.document), row.documentSha256); assert.ok(Number.isFinite(row.score)); assert.ok(!scores.has(row.document) || scores.get(row.document) === row.score); scores.set(row.document, row.score); }
      const scorer = async (query: string, documents: string[]) => { assert.equal(query, inputs.query); return documents.map(document => { const score = scores.get(document); assert.notEqual(score, undefined); consumed.add(document); return score!; }); };
      const v5 = await semanticSupplementContextV5(product, corpus, retrieval, old.trace, item.question, scorer);
      assert.deepEqual(v5.passages, previous.candidate.passages); assert.deepEqual(v5.proposal.actualInputs, inputs);
      const candidate = await semanticSupplementContextV6(product, corpus, retrieval, old.trace, item.question, scorer);
      assert.equal(consumed.size, scores.size); assert.deepEqual(candidate.passages.slice(0, old.baseline.length), old.baseline);
      const facts = sourceReview.cases[index].designatedFacts;
      assert.deepEqual(facts, old.baselineDiagnosis.designated.map(({ sources: _sources, ...fact }: Json) => fact));
      const diagnosis = diagnoseUsefulSources(product, corpus, retrieval, old.trace, facts, candidate.passages, candidate.additions);
      const delivered = diagnosis.designated.filter(f => f.sources.some(s => s.literalFactDelivered)).length;
      results.push({ caseId: item.id, question: item.question, designatedFacts: facts.length,
        baselineDelivered: previous.baselineDelivered, v5Delivered: previous.v5Delivered, v6Delivered: delivered,
        contextChangedFromV5: JSON.stringify(candidate.passages) !== JSON.stringify(v5.passages), candidate, diagnosis });
    }
  } finally { globalThis.fetch = previousFetch; }
  readFreeze(root, freezePath);
  return { format: 'ablatrix-report-uncertainty-v6-development-v1', freeze: { path: freezePath, fileSha256: freeze.fileSha256 }, candidate: SEMANTIC_SUPPLEMENT_V6,
    summary: { cases: results.length, designatedFacts: results.reduce((n, r) => n + r.designatedFacts, 0), baselineDelivered: results.reduce((n, r) => n + r.baselineDelivered, 0), v5Delivered: results.reduce((n, r) => n + r.v5Delivered, 0), v6Delivered: results.reduce((n, r) => n + r.v6Delivered, 0),
      baselinePrefixesRetained: results.filter(r => r.candidate.baselinePreservation.allBaselineParentsRetainedInOrder).length,
      changedCases: results.filter(r => r.contextChangedFromV5).map(r => r.caseId), regressionsAgainstV5: results.filter(r => r.v6Delivered < r.v5Delivered).map(r => r.caseId),
      v5Additions: oldV5.results.reduce((n: number, r: Json) => n + r.candidate.additions.length, 0), v6Additions: results.reduce((n, r) => n + r.candidate.additions.length, 0) },
    results, scoreMode: 'Exact input-bound saved v4 logits, with genuine FTS/scope/fusion/selection replay; model scores are not independently authenticated.',
    exposure: 'All twelve products exposed before v6 design; five uncertain cases have no complete designated-fact label.', providerCalls: 0, freshInputReads: 0, generatedAnswers: 0, qualityClaimEligible: false };
}
/** Only observation-only performance resources may vary between replay processes. */
function withoutResources(value: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(value));
  if (Array.isArray(copy?.results)) for (const row of copy.results) {
    if (row?.candidate?.proposal) delete row.candidate.proposal.resources;
  }
  return copy;
}

export async function verifyReportUncertaintyDevelopment(saved: unknown, freezePath: string, root = repository) {
  const replayed = await replayReportUncertaintyDevelopment(freezePath, root);
  assert.deepEqual(withoutResources(saved), withoutResources(replayed), 'Replay every candidate row, score input, source scope, selection, context and delivered unit.'); return replayed;
}
