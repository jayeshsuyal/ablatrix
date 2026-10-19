/** Prepare exposed development contexts only. No credentials, provider or .env. */
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { textHash } from '../server/product-corpus.ts';
import { diagnosticHash, DIAGNOSTIC_LEDGER, prepareThreeContext, type DiagnosticCase } from '../server/three-context-diagnostic.ts';
import { requiredThreeContextLiveFiles, type ThreeContextLivePreparation } from '../server/three-context-live.ts';
import { readLedgerAnchor } from '../server/source-calibration-comparison.ts';
import type { RetrievedPassage } from '../server/loop-types.ts';
import { SEMANTIC_SUPPLEMENT_V5 } from '../server/semantic-supplement-v5.ts';

const directory = 'docs/evidence/retrieval-diagnosis-2026-10-19', source = 'docs/evidence/retrieval-source-coverage-v2-2026-10-18';
const repository = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
/** Fixed-scope mechanical review pin. This is deliberately not a hash supplied
 * by the comparison being checked: changing its candidate output must stop. */
export const REVIEWED_V5_RESULT = Object.freeze({
  path: `${directory}/semantic-supplement-v5-development-v2.json`,
  fileSha256: 'ff3567bb1545843853706e9cf411249df63f81d7f14eae1a95eb1bb33583dd2f',
  reviewPath: `${directory}/semantic-supplement-v5-reviewed-result-v1.json`,
  reviewFileSha256: 'e988b607ec04b9bd70f3687109b98ffe60665bf95bcf5575157ab48ab9889bed'
});
function canonicalFile(root: string, path: string) {
  assert.ok(path && !isAbsolute(path) && !path.split(/[\\/]/).some(part => part === '..' || part === '.') && !path.includes('\\'), 'Use a canonical repository-relative input path.');
  const absolute = resolve(root, path);
  assert.ok(lstatSync(absolute).isFile() && !lstatSync(absolute).isSymbolicLink() && realpathSync(absolute) === absolute, 'Inputs must be canonical repository regular files.');
  return absolute;
}
function privateOutput(root: string, path: string) {
  const rel = relative(root, path);
  assert.ok(rel.startsWith('.data/') && !isAbsolute(rel) && !rel.split('/').includes('..') && !existsSync(path), 'Use a new repository .data preparation path.');
  assert.equal(realpathSync(dirname(path)), dirname(path), 'Output parent must already exist and be canonical; preparation creates no directories.');
}
export function verifyReviewedV5DevelopmentResult(input: string, root = repository) {
  const inputRelative = relative(root, resolve(root, input));
  assert.equal(inputRelative, REVIEWED_V5_RESULT.path, 'This fixed development preparer requires the independently reviewed result path.');
  const reviewBytes = readFileSync(canonicalFile(root, REVIEWED_V5_RESULT.reviewPath), 'utf8');
  assert.equal(textHash(reviewBytes), REVIEWED_V5_RESULT.reviewFileSha256, 'The independent mechanical review record changed.');
  const resultBytes = readFileSync(canonicalFile(root, inputRelative), 'utf8');
  assert.equal(textHash(resultBytes), REVIEWED_V5_RESULT.fileSha256, 'Unreviewed v5 result bytes: replay/review every candidate row before preparing different contexts.');
  return { reviewRecord: JSON.parse(reviewBytes), result: JSON.parse(resultBytes) };
}
/** Pin the parsed snapshot actually used for contexts, not a later disk read
 * whose bytes may differ from the snapshot previously inspected by the loader. */
export function bindReviewedV5DevelopmentResult(saved: unknown, input: string, root = repository) {
  const pinned = verifyReviewedV5DevelopmentResult(input, root);
  assert.deepEqual(saved, pinned.result, 'Loaded v5 result snapshot differs from the exact independently reviewed bytes.');
  return pinned.result;
}
/** Pure file preparation boundary, separately testable without a ledger, model,
 * provider or credential. The actual CLI always supplies its own repository. */
export function loadV5DevelopmentPreparationInputs(input: string, output: string, root = repository) {
  assert.ok(isAbsolute(root) && resolve(root) === root && realpathSync(root) === root && lstatSync(root).isDirectory());
  const path = resolve(root, output); privateOutput(root, path);
  const inputRelative = relative(root, resolve(root, input)), read = (p: string) => JSON.parse(readFileSync(canonicalFile(root, p), 'utf8'));
  const digest = (p: string) => textHash(readFileSync(canonicalFile(root, p), 'utf8'));
  const saved = read(inputRelative); assert.equal(saved.format, 'ablatrix-semantic-supplement-v5-development-comparison-v1'); assert.deepEqual(saved.candidate, SEMANTIC_SUPPLEMENT_V5);
  assert.equal(saved.providerCalls, 0); assert.equal(saved.generatedAnswers, 0); assert.equal(saved.qualityClaimEligible, false);
  for (const key of ['paidExecutionAuthorized', 'activationAllowed']) if (key in saved) assert.equal(saved[key], false);
  const freezeBytes = readFileSync(canonicalFile(root, saved.freeze.path), 'utf8'); assert.equal(textHash(freezeBytes), saved.freeze.fileSha256);
  const freeze = JSON.parse(freezeBytes);
  assert.equal(freeze.format, 'ablatrix-semantic-supplement-v5-development-freeze-v1'); assert.deepEqual(freeze.candidate, SEMANTIC_SUPPLEMENT_V5);
  assert.equal(freeze.providerCalls, 0); assert.equal(freeze.qualityClaimEligible, false);
  for (const key of ['paidExecutionAuthorized', 'activationAllowed']) if (key in freeze) assert.equal(freeze[key], false);
  const bindings: [string, string][] = [];
  for (const map of [freeze.codeSha256, freeze.inputSha256]) {
    assert.ok(map && typeof map === 'object' && !Array.isArray(map) && Object.keys(map).length);
    for (const [p, sha] of Object.entries(map)) { canonicalFile(root, p); assert.equal(typeof sha, 'string'); assert.match(sha as string, /^[a-f0-9]{64}$/); bindings.push([p, sha as string]); }
  }
  // Validate every path before reading any declared code/input body. Do not merge
  // maps: a conflicting duplicate must fail rather than hide one frozen hash.
  for (const [p, sha] of bindings) assert.equal(digest(p), sha, `Frozen candidate changed: ${p}`);
  return { root, path, inputRelative, saved, freeze, read, digest };
}
export function prepareV5Development(input: string, output: string) {
assert.ok(input && output, 'Usage: prepare-three-context-v5.ts V5_DEVELOPMENT_JSON NEW_PRIVATE_PREPARATION_JSON');
const { root, path, inputRelative, saved: loadedSnapshot, freeze, read, digest } = loadV5DevelopmentPreparationInputs(input, output);
const saved = bindReviewedV5DevelopmentResult(loadedSnapshot, input, root);
const deckPath = `${source}/deck-v1.json`, reviewPath = `${source}/source-review-v1.json`, baselinePath = `${source}/baseline-v1.json`;
const deck = read(deckPath), review = read(reviewPath), baseline = read(baselinePath), originalPath = `${directory}/three-context-preparation-final.json`, original = read(originalPath);
assert.equal(review.deckFileSha256, digest(deckPath)); assert.equal(review.baselineFileSha256, digest(baselinePath));
assert.deepEqual(saved.results.map((r: any) => r.caseId), deck.cases.map((r: any) => r.id), 'Keep the full development denominator.');
// Select all independently designated gap cases, not a subset chosen by v5 success.
const gaps = review.cases.filter((r: any) => ['specification_gap', 'model_detail_gap'].includes(r.sourceGapGroup));
assert.ok(gaps.length > 0 && gaps.length <= 8, 'The complete source-gap diagnostic must fit its fixed maximum.');
const cases: DiagnosticCase[] = gaps.map((assessed: any) => {
  const item = deck.cases.find((c: any) => c.id === assessed.caseId), current = baseline.results.find((r: any) => r.caseId === assessed.caseId), candidate = saved.results.find((r: any) => r.caseId === assessed.caseId);
  assert.ok(item && current && candidate); assert.equal(current.baselineContextSha256, assessed.baselineContextSha256);
  assert.deepEqual(candidate.candidate.passages.slice(0, current.baseline.passages.length), current.baseline.passages, 'Baseline parents must remain intact.');
  const completeSources: RetrievedPassage[] = item.sources.map((s: any) => ({ id: s.id, productId: item.product.id, source: s.label, reference: s.label, text: s.text, sha256: textHash(s.text), ...(s.originalQuestion !== null ? { originalQuestion: s.originalQuestion } : {}), lexicalRank: null, semanticRank: null, score: 0 }));
  const existing = original.document.preparation.cases.find((c: any) => c.id === item.id);
  assert.ok(existing, 'A separately source-reviewed reference and its unknowns are required before preparing another case.');
  assert.deepEqual(completeSources, existing.completeSources); assert.deepEqual(assessed.designatedFacts, existing.designatedFacts);
  return { id: item.id, product: { ...item.product, split: 'development' }, question: item.question, completeSources,
    contexts: { current: current.baseline.passages, semantic: candidate.candidate.passages, reference: existing.contexts.reference },
    designatedFacts: assessed.designatedFacts, referenceReview: { ...existing.referenceReview, sourcePoolSha256: diagnosticHash(completeSources) } };
});
const codeFiles = [...new Set([...requiredThreeContextLiveFiles(root), 'server/semantic-reranker-v4.ts', 'server/semantic-supplement-v5.ts', 'scripts/prepare-three-context-v5.ts', 'scripts/retrieval-diagnosis-v4.ts', 'scripts/retrieval-diagnosis-v5.ts', 'server/answer-diagnostic-evaluation.ts'])].sort();
const artifactPaths = [...new Set([inputRelative, REVIEWED_V5_RESULT.reviewPath, saved.freeze.path, ...Object.keys(freeze.inputSha256), deckPath, reviewPath, baselinePath, originalPath])].sort();
const ledger = readLedgerAnchor(DIAGNOSTIC_LEDGER, .200281);
const anchor = { canonicalPath: ledger.canonicalPath, historicalRowsSha256: ledger.historicalRowsSha256, attempts: ledger.attempts, reservedUsd: ledger.reservedUsd, priorSpendUsd: ledger.priorSpendUsd, pending: ledger.pending, owners: ledger.owners };
const diagnostic = { cases, policy: original.document.preparation.policy,
  implementationSha256: Object.fromEntries(codeFiles.map(p => [p, digest(p)])),
  artifactSha256: Object.fromEntries(artifactPaths.map(p => [p, digest(p)])), ledger: anchor,
  codeReviewPassed: false };
const prepared = prepareThreeContext(diagnostic); assert.equal(prepared.document.paidPlan, null);
const wrapper: ThreeContextLivePreparation = { repositoryPath: root, outputDirectory: resolve(root, '.data', 'three-context-v5-development-execution'), diagnostic };
privateOutput(root, path);
writeFileSync(path, JSON.stringify(wrapper, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
assert.deepEqual(readLedgerAnchor(DIAGNOSTIC_LEDGER, .200281), ledger, 'Preparation must not change the shared ledger.');
return { mode: 'exposed_development_preparation', cases: cases.length, contexts: prepared.document.slots.length,
  sourceBenefit: prepared.document.sourceBenefit, deliveredCaseIds: prepared.document.deliveredCaseIds, stopReason: prepared.document.stopReason,
  paidPlan: null, paidExecutionAuthorized: false, providerCalls: 0, output: path,
  limitation: 'A prepared development diagnostic is not fresh validation or an answer-quality gain. Code review and exact financial approval remain required.' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2); console.log(JSON.stringify(prepareV5Development(input!, output!)));
}
