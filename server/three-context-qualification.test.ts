import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { textHash } from './product-corpus.ts';
import { diagnosticHash, prepareThreeContext, type DiagnosticPreparation } from './three-context-diagnostic.ts';
import { syntheticPreparation } from '../scripts/three-context-mock.ts';
import { buildV5DevelopmentPreparation, REVIEWED_V5_RESULT } from '../scripts/prepare-three-context-v5.ts';
import { CODE_QUALIFICATION_CHECKS, qualificationImplementation, qualificationReviewBindings, verifyQualifiedV5Preparation, verifyCodeQualification, type ThreeContextCodeReview } from './three-context-qualification.ts';
import type { ThreeContextLivePreparation } from './three-context-live.ts';
import { qualifyThreeContextCli } from '../scripts/qualify-three-context-v5.ts';
const encode = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
function reviewFixture() {
  const root = realpathSync(fileURLToPath(new URL('../', import.meta.url))), id = randomUUID(), output = resolve(root, '.data', `SYNTHETIC-unwritten-${id}.json`);
  const inputs = buildV5DevelopmentPreparation(REVIEWED_V5_RESULT.path, output, root), diagnostic: DiagnosticPreparation = { cases: inputs.cases, policy: inputs.policy,
    implementationSha256: Object.fromEntries(inputs.codeFiles.map(path => [path, inputs.digest(path)])), artifactSha256: Object.fromEntries(inputs.artifactPaths.map(path => [path, inputs.digest(path)])), ledger: syntheticPreparation().ledger, codeReviewPassed: false };
  const base: ThreeContextLivePreparation = { repositoryPath: root, outputDirectory: resolve(root, '.data', `SYNTHETIC-output-${id}`), diagnostic }, bytes = encode(base);
  const reportPath = `docs/evidence/SYNTHETIC-code-qualification-${id}.json`, implementation = qualificationImplementation(root, base), checks = Object.fromEntries(CODE_QUALIFICATION_CHECKS.map(key => [key, true])) as ThreeContextCodeReview['review']['checks'];
  const report = { provenance: 'independent_agent_code_review' as const, reviewer: 'SYNTHETIC mechanics fixture, not an actual reviewer', reviewedCommit: '1'.repeat(40), outcome: 'ready_for_unexecuted_financial_proposal' as const, reviewedPreparationSha256: textHash(bytes), reviewedImplementationSha256: implementation, reviewedArtifactSha256: diagnostic.artifactSha256, checks };
  writeFileSync(resolve(root, reportPath), encode(report), { flag: 'wx' });
  const record: ThreeContextCodeReview = { format: 'ablatrix-three-context-code-qualification-v1', reviewedPreparationSha256: textHash(bytes), reviewedImplementationSha256: implementation, reviewedArtifactSha256: diagnostic.artifactSha256,
    review: { ...report, reportPath, reportSha256: textHash(encode(report)) }, sourceResult: REVIEWED_V5_RESULT, paidExecutionAuthorized: false, humanAnswerQualityJudgments: 0, qualityClaimEligible: false };
  return { root, base, bytes, record, reportPath, verify(b = base, r = record, expected = textHash(encode(r))) { return verifyCodeQualification(b, encode(b), r, expected, encode(r), root); }, cleanup() { rmSync(resolve(root, reportPath)); } };
}
test('review qualification binds exact preparation, full execution code and reviewed scoped v5 result without reading a ledger', () => {
  const f = reviewFixture(); try { assert.equal(f.verify().review.outcome, 'ready_for_unexecuted_financial_proposal'); assert.equal(f.base.diagnostic.codeReviewPassed, false); }
  finally { f.cleanup(); }
});
test('code qualification rejects flipped flags, changed code/source/contexts and self-asserted incomplete review', () => {
  const f = reviewFixture();
  try {
    const mutate = [
      (b: typeof f.base, _r: typeof f.record) => { b.diagnostic.codeReviewPassed = true; },
      (_b: typeof f.base, r: typeof f.record) => { r.reviewedImplementationSha256['server/three-context-live.ts'] = '0'.repeat(64); },
      (_b: typeof f.base, r: typeof f.record) => { r.reviewedArtifactSha256[REVIEWED_V5_RESULT.path] = '0'.repeat(64); },
      (_b: typeof f.base, r: typeof f.record) => { r.review.checks.approval_before_credentials = false as true; },
      (b: typeof f.base, r: typeof f.record) => { b.diagnostic.cases[0]!.contexts.semantic = b.diagnostic.cases[0]!.contexts.reference; r.reviewedPreparationSha256 = textHash(encode(b)); },
      (_b: typeof f.base, r: typeof f.record) => { r.review.reportSha256 = '0'.repeat(64); }
    ];
    for (const fn of mutate) { const base = structuredClone(f.base), record = structuredClone(f.record); fn(base, record); assert.throws(() => f.verify(base, record)); }
    assert.throws(() => f.verify(f.base, f.record, '0'.repeat(64)), /reviewed qualification bytes/);
  } finally { f.cleanup(); }
});
function freshFixture() {
  const p = syntheticPreparation(); p.cases = Array.from({ length: 8 }, (_, i) => {
    const c = structuredClone(p.cases[0]!); c.id = `SYNTHETIC-validation-${i}`; c.product = { ...c.product, id: `SYNTHETIC-product-${i}`, split: 'validation' };
    for (const s of c.completeSources) s.productId = c.product.id; for (const context of Object.values(c.contexts)) for (const s of context) s.productId = c.product.id;
    c.referenceReview.sourcePoolSha256 = diagnosticHash(c.completeSources); return c;
  });
  const proofs = ['3','4','5','6'].map(x => x.repeat(64)); proofs.forEach((sha,i) => p.artifactSha256[`docs/SYNTHETIC-proof-${i}.json`] = sha);
  p.validation = { contract: 'ablatrix-fresh-validation-v1', protocolSha256: proofs[0]!, candidateFreezeSha256: proofs[1]!, historyInventorySha256: proofs[2]!, sourceReviewSha256: proofs[3]!, developmentOutcomeReviewSha256: null, selectedDenominator: 8, screeningDenominator: 24, qualificationPassed: false }; return p;
}
test('fresh scope is separately versioned and cannot borrow a development qualification or unpaid outcome', () => {
  const p = freshFixture(), stopped = prepareThreeContext(p); assert.equal(stopped.document.format, 'ablatrix-three-context-fresh-validation-v1'); assert.equal(stopped.document.scope, 'prospective_fresh_validation'); assert.equal(stopped.document.paidPlan, null); assert.equal(stopped.document.stopReason, 'fresh_validation_qualification_pending');
  const changed = structuredClone(p); changed.validation!.qualificationPassed = true; assert.throws(() => prepareThreeContext(changed), /development answer outcome/);
  changed.validation!.developmentOutcomeReviewSha256 = '7'.repeat(64); assert.throws(() => prepareThreeContext(changed));
  changed.artifactSha256['docs/SYNTHETIC-reviewed-development-answer-outcome.json'] = '7'.repeat(64); const qualified = prepareThreeContext(changed); assert.equal(qualified.document.paidPlan!.maximumNewAttempts, 24);
  changed.cases[0]!.product.split = 'development'; assert.throws(() => prepareThreeContext(changed));
  const old = prepareThreeContext(syntheticPreparation()); assert.equal(old.document.format, 'ablatrix-three-context-diagnostic-v1'); assert.equal(old.document.scope, 'exposed_development_only');
});
test('qualification CLI has no execution mode and rejects widened/duplicate arguments before any data read', () => {
  for (const args of [['--execute'], ['--qualify','--preparation','x','--preparation','y'], ['--proposal','--plan','x','--out','y','--allow-retries','1']]) assert.throws(() => qualifyThreeContextCli(args));
});

test('review artifacts stay pinned between qualification inspection and final binding; generic wrappers cannot claim qualification', () => {
  const f = reviewFixture(), recordPath = `docs/evidence/SYNTHETIC-record-${randomUUID()}.json`, bytes = encode(f.record), expected = textHash(bytes);
  writeFileSync(resolve(f.root, recordPath), bytes, { flag: 'wx' });
  try {
    f.verify(); assert.equal(qualificationReviewBindings(f.root, recordPath, bytes, expected, f.record)[recordPath], expected);
    writeFileSync(resolve(f.root, recordPath), bytes + '\n'); assert.throws(() => qualificationReviewBindings(f.root, recordPath, bytes, expected, f.record), /certificate changed/);
    writeFileSync(resolve(f.root, recordPath), bytes); const report = readFileSync(resolve(f.root, f.reportPath), 'utf8'); writeFileSync(resolve(f.root, f.reportPath), report + '\n');
    assert.throws(() => qualificationReviewBindings(f.root, recordPath, bytes, expected, f.record), /report changed/);
    const generic = structuredClone(f.base); generic.diagnostic.codeReviewPassed = true; assert.throws(() => verifyQualifiedV5Preparation(generic), /requires its independently checked qualification/);
  } finally { rmSync(resolve(f.root, recordPath)); f.cleanup(); }
});
test('even fully self-consistent review assertions cannot qualify arbitrary v5 context replacements', () => {
  const f = reviewFixture();
  try {
    const base = structuredClone(f.base), record = structuredClone(f.record); base.diagnostic.cases[0]!.contexts.semantic = base.diagnostic.cases[0]!.contexts.reference;
    record.reviewedPreparationSha256 = textHash(encode(base)); const report = JSON.parse(readFileSync(resolve(f.root, f.reportPath), 'utf8')); report.reviewedPreparationSha256 = record.reviewedPreparationSha256;
    writeFileSync(resolve(f.root, f.reportPath), encode(report)); record.review.reportSha256 = textHash(encode(report)); assert.throws(() => f.verify(base, record), /exact pinned current/);
  } finally { f.cleanup(); }
});
