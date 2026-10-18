import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspaceReviewSourceHash, type RevisionSource } from './answer-review-source.ts';
import { contextComparisonHash } from './context-comparison.ts';
import { metadataFingerprints, readFlatExposureMetadata, readFlatPublicExposure } from './flat-source-comparison.ts';
import { SapiomFeedbackProvider, type FeedbackProviderOptions } from './feedback-provider.ts';
import type { LoopPolicy, ProductCorpus, RetrievalResult, RetrievedPassage } from './loop-types.ts';
import { textHash } from './product-corpus.ts';
import { workspaceSourceChunks, workspaceCompleteSourceContext } from './workspace-retrieval-context.ts';
import { WORKSPACE_SOURCE_COVERAGE_CONTRACT, workspaceSourceCoverageContext } from './workspace-source-coverage.ts';
import { WORKSPACE_GENERATION_CONTRACT, WORKSPACE_SOURCE_CALIBRATION_CONTRACT, workspaceGenerationParts, workspaceGenerationPromptIdentity, replayWorkspaceGenerationReceipt, type WorkspaceGenerationInput, type WorkspaceGenerationReceipt } from './workspace-generation.ts';

type Json = Record<string, any>;
export const sourceCalibrationHash = (value: unknown) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const clone = <T>(value: T): T => structuredClone(value);
const digest = (value: string) => assert.match(value, /^[a-f0-9]{64}$/);
const candidateSha = 'e9faddec60d475fe358b01e6c7464eb2993848e982a764f7c12b122266d148f8';
// Selection predates the one-to-one review validation fix. Pin the historical
// selector that produced the unchanged packet; separately freeze current code.
const selectionCodeSha = 'bf4e3686de1742eb0e0616f9b3e25875c3db60dfca476a36e74e4b3d8b66dba0';
const selectionHelpers = ['scripts/prepare-flat-source-cohort.py', 'scripts/prepare-correction-cohort.py', 'scripts/prepare-source-id-cohort.py'] as const;
export const SOURCE_CALIBRATION_CODE_FILES = ['scripts/prepare-source-calibration-cohort.py', 'scripts/test_prepare_source_calibration_cohort.py', ...selectionHelpers, 'server/source-calibration-comparison.ts', 'server/source-calibration-comparison.test.ts', 'scripts/source-calibration-comparison.ts', 'scripts/source-calibration-retrieval.ts', 'server/workspace-generation.ts', 'server/feedback-provider.ts', 'server/citation-options.ts', 'server/answer-review-source.ts', 'server/flat-source-comparison.ts', 'server/context-comparison.ts', 'server/product-retrieval.ts', 'server/product-corpus.ts', 'server/workspace-retrieval-context.ts', 'server/loop-types.ts', 'package-lock.json'] as const;
export const RETRIEVAL_COVERAGE_EXPERIMENT = 'retrieval_source_coverage_v1' as const;
export const RETRIEVAL_COVERAGE_CODE_FILES = [...SOURCE_CALIBRATION_CODE_FILES, 'scripts/prepare-retrieval-coverage-cohort.py', 'scripts/test_prepare_retrieval_coverage_cohort.py', 'scripts/retrieval-coverage-comparison.ts', 'scripts/retrieval-coverage-retrieval.ts', 'server/workspace-source-coverage.ts', 'server/workspace-source-coverage.test.ts', 'server/product-workspace.ts', 'server/workspace-source-coverage-integration.test.ts'] as const;
export const RETRIEVAL_COVERAGE_RETRIEVAL_FILES = ['scripts/retrieval-coverage-retrieval.ts', 'server/source-calibration-comparison.ts', 'server/workspace-source-coverage.ts', 'server/product-retrieval.ts', 'server/workspace-retrieval-context.ts', 'server/product-corpus.ts', 'server/loop-types.ts', 'package-lock.json'] as const;
const retrievalSelectionHelpers = ['scripts/prepare-source-calibration-cohort.py', ...selectionHelpers] as const;
export type SourceCalibrationArtifact = { path: string; fileSha256: string; document: Json };
export type SourceCalibrationLedgerAnchor = { canonicalPath: string; pathSha256: string; historicalRowsSha256: string; attempts: number; reservedUsd: number; priorSpendUsd: number; pending: number; owners: number };
type LedgerRow = WorkspaceGenerationReceipt & { created_at: string; run_id: string | null; allowance_usd: number };
export type SourceCalibrationLedgerState = SourceCalibrationLedgerAnchor & { rows: LedgerRow[]; ownerRows: { pid: number; token: string; expires_at: number }[] };
type Source = Pick<RevisionSource, 'id' | 'label' | 'text' | 'sha256' | 'originalQuestion' | 'reference'>;
export type SourceCalibrationPreparation = {
  experiment?: typeof RETRIEVAL_COVERAGE_EXPERIMENT;
  packet: SourceCalibrationArtifact; retrieval: SourceCalibrationArtifact; familyAudit: SourceCalibrationArtifact; candidateFreeze: SourceCalibrationArtifact; exposureAudit: SourceCalibrationArtifact; selectionAudit: SourceCalibrationArtifact;
  implementationSha256: Record<string, string>; historySha256: Record<string, string>; policy: LoopPolicy; createdAt: string;
  ledgerAnchor: SourceCalibrationLedgerAnchor;
  scope: { repositoryPath: string; outputDirectory: string; workspacePaths: string[]; comparisonPaths: string[] };
  exposure: { metadataSha256: string; publicExposureSha256: string };
};
type Arm = 'baseline' | 'candidate';
type Slot = { index: number; caseId: string; arm: Arm; input: WorkspaceGenerationInput; requestBody: ReturnType<typeof workspaceGenerationParts>['body']; binding: ReturnType<typeof workspaceGenerationParts>['binding'] };
const artifactNames = ['packet', 'retrieval', 'familyAudit', 'candidateFreeze', 'exposureAudit', 'selectionAudit'] as const;
function relativeFile(path: string) { assert.ok(path && !isAbsolute(path) && !path.split('/').includes('..') && !path.includes('\\'), 'Bound files must stay in the repository.'); return path; }
function privatePath(path: string, root: string) { const rel = relative(resolve(root, '.data'), path); assert.ok(isAbsolute(path) && resolve(path) === path && rel && !rel.startsWith('..') && !isAbsolute(rel), 'Output must be canonical and private under .data.'); }
function verifySelectionSeal(p: SourceCalibrationPreparation) {
  const coverage = p.experiment === RETRIEVAL_COVERAGE_EXPERIMENT;
  const cohort = p.packet.document, audit = p.selectionAudit.document, seed = coverage ? 'ablatrix-retrieval-coverage-2026-10-18-v1' : 'ablatrix-source-calibration-2026-10-18-v1';
  const checkHash = (document: Json, field: string) => { const body = { ...document }; delete body[field]; assert.equal(document[field], contextComparisonHash(body), `Invalid ${field} seal.`); };
  checkHash(cohort, 'cohortSha256'); checkHash(audit, 'selectionAuditSha256');
  assert.equal(cohort.format, coverage ? 'ablatrix-retrieval-coverage-cohort-v1' : 'ablatrix-source-calibration-cohort-v1'); assert.equal(audit.format, coverage ? 'ablatrix-retrieval-coverage-selection-audit-v1' : 'ablatrix-source-calibration-selection-audit-v1');
  assert.equal(cohort.selectionSeed, seed); assert.equal(audit.selectionSeed, seed); assert.equal(p.candidateFreeze.document.selectionSeed, seed);
  assert.equal(cohort.selectionAuditSha256, audit.selectionAuditSha256); assert.equal(cohort.exposureAuditSha256, p.exposureAudit.document.auditSha256); assert.equal(audit.exposureAuditSha256, cohort.exposureAuditSha256);
  assert.equal(audit.candidateFreezeFileSha256, p.candidateFreeze.fileSha256);
  assert.equal(cohort.source?.commit, 'cec976cc2f2218aa76e562ecc9c7d79f1f3271bc'); assert.equal(cohort.source?.sha256, 'b63de9681b770573240367e919f7f04f087f6a4745ab1f79a77e6b800105ea25'); assert.equal(cohort.source?.testSplitUsed, false);
  assert.equal(cohort.status?.privateCandidateOnly, true); assert.equal(cohort.status?.generationPerformed, false); assert.equal(cohort.status?.humanJudgments, 0); assert.equal(cohort.status?.qualityClaimEligible, false); assert.equal(cohort.status?.paidExecutionAuthorized, false);
  assert.equal(cohort.selection?.labelOrAnswerColumnsUsed, false); assert.equal(cohort.selection?.modelOutputsUsed, false);
  assert.equal(audit.generatedAnswersOrJudgmentsRead, false); assert.equal(audit.generationPerformed, false); assert.equal(audit.newProviderCalls, 0);
  assert.equal(cohort.inventory?.passed, true); assert.deepEqual(cohort.inventory, audit.inventory);
  assert.equal(cohort.selection.selectionCodeSha256, audit.selectionCodeSha256); assert.equal(audit.selectionCodeSha256, coverage ? p.implementationSha256['scripts/prepare-retrieval-coverage-cohort.py'] : selectionCodeSha); digest(audit.selectionCodeSha256); assert.deepEqual(cohort.selection.immutableHelperSha256, audit.immutableHelperSha256);
  const helpers = coverage ? retrievalSelectionHelpers : selectionHelpers;
  assert.deepEqual(Object.keys(audit.immutableHelperSha256).sort(), [...helpers].sort()); for (const path of helpers) assert.equal(audit.immutableHelperSha256[path], p.implementationSha256[path]);
  assert.deepEqual(cohort.selection.eligibilityAmendment, audit.eligibilityAmendment);
  if (coverage) { assert.equal(audit.eligibilityAmendment.rules, 'unchanged_source_calibration_revision_3'); assert.equal(audit.eligibilityAmendment.generationInstructionsChanged, false); assert.equal(audit.eligibilityAmendment.modelOutputsUsed, false); assert.equal(audit.eligibilityAmendment.rejectedDraftsRemainProtected, true); assert.equal(audit.eligibilityAmendment.consumedCohortsRemainProtected, true); assert.equal(audit.modelOutputsUsed, false); }
  else { assert.equal(audit.eligibilityAmendment.candidateInstructionsUnchanged, true); assert.equal(audit.eligibilityAmendment.generationOutputsInspected, false); }
  assert.deepEqual(cohort.selection.priorCohorts, audit.priorCohorts); assert.deepEqual(cohort.selection.priorSourceReviews, audit.priorSourceReviews); assert.deepEqual(cohort.selection.inventoryInputs, audit.inventoryInputs);
  assert.equal(audit.inventoryInputs.workspaceCount, p.scope.workspacePaths.length); assert.equal(audit.inventoryInputs.comparisonCount, p.scope.comparisonPaths.length);
  const inventoryPaths = [...p.scope.workspacePaths, ...p.scope.comparisonPaths]; assert.ok(inventoryPaths.every(path => isAbsolute(path) && resolve(path) === path)); assert.equal(new Set(inventoryPaths).size, inventoryPaths.length);
  assert.deepEqual(audit.inventoryInputs.canonicalPathSha256, inventoryPaths.map(sourceCalibrationHash).sort());
  const priors = audit.priorCohorts.map((c: Json) => c.fileSha256), reviews = audit.priorSourceReviews.map((r: Json) => r.cohortFileSha256);
  assert.equal(new Set(priors).size, priors.length); assert.equal(reviews.length, priors.length); assert.deepEqual([...new Set(reviews)].sort(), [...priors].sort()); assert.ok(audit.priorSourceReviews.every((r: Json) => r.status === 'failed' && r.provenance === 'independent_ai_source_and_family_review'));
  if (coverage) {
    assert.equal(priors.length, 2, 'Both rejected source-only drafts must remain protected.');
    assert.equal(p.scope.workspacePaths.length, 2); assert.equal(p.scope.comparisonPaths.length, 1);
    assert.ok(Array.isArray(audit.consumedCohorts) && audit.consumedCohorts.length === 1, 'The consumed live cohort must remain protected.');
    assert.deepEqual(cohort.selection.consumedCohorts, audit.consumedCohorts);
    const consumed = audit.consumedCohorts.map((c: Json) => c.fileSha256);
    assert.equal(new Set(consumed).size, consumed.length); assert.ok(consumed.every((sha: string) => !priors.includes(sha)));
    for (const item of audit.consumedCohorts) {
      for (const field of ['fileSha256', 'cohortSha256', 'sourceReviewFileSha256', 'executionFileSha256', 'planSha256', 'attemptScopeSha256']) digest(item[field]);
      assert.equal(item.generationPerformed, true); assert.ok(Number.isSafeInteger(item.newProviderAttempts) && item.newProviderAttempts >= 1 && item.newProviderAttempts <= 16);
      assert.equal(item.protectionScope, 'entire_cohort_after_any_recorded_provider_attempt'); assert.equal(item.executionMetadataProvenance, 'allowlisted_existing_execution_metadata');
      assert.ok(Array.isArray(item.productIds) && item.productIds.length === 8 && new Set(item.productIds).size === 8);
      for (const field of ['canonicalFamilyTitles', 'modelIdentifiers', 'sourcePacketFingerprints']) assert.ok(Array.isArray(item[field]));
      assert.ok(cohort.cases.every((c: Json) => !item.productIds.includes(c.product.id.toUpperCase())));
    }
    assert.equal(cohort.executionPlan.generationContract, WORKSPACE_GENERATION_CONTRACT); assert.equal(cohort.executionPlan.retrievalCandidateContract, WORKSPACE_SOURCE_COVERAGE_CONTRACT);
  }
  assert.equal(cohort.executionPlan?.caseCount, 8); assert.equal(cohort.executionPlan?.maximumNewAnswerAttempts, 16); assert.equal(cohort.executionPlan?.automaticRetries, 0); assert.equal(cohort.executionPlan?.webCalls, 0); assert.equal(cohort.executionPlan?.caseReplacement, false); assert.equal(cohort.executionPlan?.paidExecutionAuthorized, false);
  const selected = audit.decisions.filter((d: Json) => d.stage === 'ranked_selection' && d.selected === true);
  assert.equal(selected.length, 8); assert.deepEqual(selected.map((d: Json) => [d.qid, d.productId, d.stratum, d.rankSha256]), cohort.cases.map((c: Json) => [String(c.upstream.qid), c.product.id, c.stratum, c.selectionRankSha256]));
}

/** Pure indexing snapshot shared by the paired freezer and preparation replay. */
export function retrievalCoverageCorpus(packet: SourceCalibrationArtifact): ProductCorpus {
  const cases = packet.document.cases as Json[];
  return {
    version: `retrieval-coverage-${packet.fileSha256.slice(0, 24)}`, source: 'Frozen pinned ePQA train source-only selection', license: 'CDLA-Sharing-1.0', cases: [],
    products: cases.map(c => ({ ...c.product, split: 'validation' })),
    passages: cases.flatMap(c => (c.sources as Source[]).flatMap(source => {
      assert.equal(source.sha256, workspaceReviewSourceHash(source)); assert.ok(source.text.length > 0 && source.text.length <= 1500 && !source.text.includes('\u0000'));
      return workspaceSourceChunks(source.text).map((text, index, chunks) => ({ id: chunks.length === 1 ? source.id : `${source.id}-${index + 1}`, productId: c.product.id,
        source: source.label, text, reference: chunks.length === 1 ? source.label : `${source.label} (part ${index + 1})`, sha256: textHash(text), ...(source.originalQuestion ? { originalQuestion: source.originalQuestion } : {}) }));
    }))
  };
}

/** Pure preparation. The caller supplies a freshly read anchor; no store,
 * credential, model, network or provider is opened here. */
export function prepareSourceCalibrationComparison(preparation: SourceCalibrationPreparation) {
  const p = clone(preparation), cases = p.packet.document.cases as Json[];
  assert.ok(p.experiment === undefined || p.experiment === RETRIEVAL_COVERAGE_EXPERIMENT, 'Unknown comparison experiment.');
  const coverage = p.experiment === RETRIEVAL_COVERAGE_EXPERIMENT;
  verifySelectionSeal(p);
  assert.ok(Array.isArray(cases) && cases.length === 8, 'Exactly eight cases are required.');
  const ids = cases.map(c => c.id); assert.equal(new Set(ids).size, 8); assert.equal(new Set(cases.map(c => c.product.id.toUpperCase())).size, 8);
  assert.ok(Number.isFinite(Date.parse(p.createdAt))); assert.equal(p.policy.mode, 'live'); assert.ok(p.policy.instructions.length >= 40);
  assert.ok(isAbsolute(p.scope.repositoryPath) && resolve(p.scope.repositoryPath) === p.scope.repositoryPath);
  privatePath(p.scope.outputDirectory, p.scope.repositoryPath);
  const anchor = p.ledgerAnchor; assert.ok(isAbsolute(anchor.canonicalPath) && resolve(anchor.canonicalPath) === anchor.canonicalPath && anchor.canonicalPath.endsWith('/.data/feedback-budget.sqlite'), 'An explicit canonical shared .data ledger is required.'); assert.equal(anchor.pathSha256, sourceCalibrationHash(anchor.canonicalPath)); digest(anchor.historicalRowsSha256);
  // The shared project ledger may belong to another checkout. The observed
  // 122-attempt floor rejects this checkout's unrelated empty default ledger.
  assert.ok(Number.isSafeInteger(anchor.attempts) && (coverage ? anchor.attempts === 138 : anchor.attempts >= 122 && anchor.attempts + 16 <= 200)); assert.equal(anchor.pending, 0); assert.equal(anchor.owners, 0);
  assert.ok(Number.isFinite(anchor.reservedUsd) && anchor.reservedUsd >= 0 && Number.isFinite(anchor.priorSpendUsd) && anchor.priorSpendUsd >= 0 && anchor.reservedUsd + anchor.priorSpendUsd + 1.6 <= 20);
  for (const name of artifactNames) { relativeFile(p[name].path); digest(p[name].fileSha256); }
  assert.equal(new Set(artifactNames.map(n => p[n].path)).size, artifactNames.length);
  for (const path of coverage ? RETRIEVAL_COVERAGE_CODE_FILES : SOURCE_CALIBRATION_CODE_FILES) digest(p.implementationSha256[path] ?? '');
  assert.ok(Object.keys(p.historySha256).length > 0);
  for (const [path, sha] of Object.entries({ ...p.implementationSha256, ...p.historySha256 })) { relativeFile(path); digest(sha); }
  digest(p.exposure.metadataSha256); digest(p.exposure.publicExposureSha256);
  const { auditSha256, ...exposureBody } = p.exposureAudit.document, metadata = metadataFingerprints(exposureBody.metadata);
  assert.equal(auditSha256, contextComparisonHash(exposureBody)); assert.equal(exposureBody.metadataSha256, metadata.sha256); assert.deepEqual(exposureBody.metadataInventorySha256, metadata.inventories); assert.equal(p.exposure.metadataSha256, metadata.sha256);
  assert.equal(exposureBody.metadataOnly, true); assert.equal(exposureBody.generatedAnswersOrJudgmentsRead, false); assert.equal(exposureBody.newProviderCalls, 0); assert.equal(exposureBody.paidExecutionAuthorized, false);
  assert.equal(p.scope.workspacePaths.length, exposureBody.metadata.workspaces.length); assert.equal(p.scope.comparisonPaths.length, exposureBody.metadata.comparisons.length);
  const freeze = p.candidateFreeze.document, candidate = workspaceGenerationPromptIdentity(coverage ? WORKSPACE_GENERATION_CONTRACT : WORKSPACE_SOURCE_CALIBRATION_CONTRACT);
  assert.equal(freeze.frozen, true); assert.equal(freeze.status, 'experimental_not_promoted'); assert.equal(freeze.qualityClaimEligible, false);
  if (coverage) {
    assert.equal(freeze.format, 'ablatrix-retrieval-coverage-candidate-freeze-v1'); assert.equal(freeze.retrievalContract, WORKSPACE_SOURCE_COVERAGE_CONTRACT); assert.equal(freeze.generationContract, WORKSPACE_GENERATION_CONTRACT); assert.equal(freeze.systemInstructionsSha256, candidate.systemInstructionsSha256);
    const required = ['server/workspace-source-coverage.ts', 'server/workspace-retrieval-context.ts', 'server/product-corpus.ts', 'server/loop-types.ts', 'server/product-retrieval.ts', 'server/workspace-generation.ts', 'server/feedback-provider.ts', 'server/citation-options.ts', 'package-lock.json', 'scripts/prepare-retrieval-coverage-cohort.py', ...retrievalSelectionHelpers];
    for (const path of required) { digest(freeze.implementationSha256?.[path] ?? ''); assert.equal(freeze.implementationSha256[path], p.implementationSha256[path]); }
    for (const [path, sha] of Object.entries(freeze.implementationSha256)) assert.equal(sha, p.implementationSha256[path]);
  } else {
    assert.equal(freeze.contract, candidate.contract); assert.equal(freeze.tool, candidate.tool); assert.equal(freeze.systemInstructionsSha256, candidateSha); assert.equal(candidate.systemInstructionsSha256, candidateSha);
  }
  assert.equal(p.packet.document.candidateFreeze?.fileSha256, p.candidateFreeze.fileSha256);
  assert.deepEqual(p.packet.document.candidateFreeze?.document, freeze, 'Selection must retain the exact pre-selection instruction freeze.');
  const retrieval = p.retrieval.document, { sha256, ...retrievalBody } = retrieval;
  assert.equal(sha256, sourceCalibrationHash(retrievalBody)); assert.equal(retrieval.cohortFileSha256, p.packet.fileSha256);
  assert.deepEqual(retrieval.results.map((r: Json) => r.caseId), ids);
  for (const [path, value] of Object.entries(retrieval.implementationSha256)) assert.equal(p.implementationSha256[path], value, 'Retrieval implementation changed.');
  for (const path of coverage ? RETRIEVAL_COVERAGE_RETRIEVAL_FILES : ['scripts/source-calibration-retrieval.ts', 'server/product-retrieval.ts', 'server/product-corpus.ts', 'server/workspace-retrieval-context.ts', 'server/loop-types.ts', 'package-lock.json']) assert.equal(retrieval.implementationSha256[path], p.implementationSha256[path]);
  const coverageCorpus = coverage ? retrievalCoverageCorpus(p.packet) : undefined;
  if (coverage) { assert.equal(retrieval.format, 'retrieval-coverage-retrieval-v1'); assert.equal(retrieval.corpusSha256, sourceCalibrationHash(coverageCorpus)); assert.equal(retrieval.providerCalls, 0); assert.equal(retrieval.generationPerformed, false); assert.equal(retrieval.semanticAssessment, 'not_run'); }
  const audit = p.familyAudit.document;
  assert.equal(audit.status, 'passed'); assert.equal(audit.provenance, 'independent_ai_source_and_family_review'); assert.equal(audit.cohortFileSha256, p.packet.fileSha256); assert.equal(audit.retrievalFileSha256, p.retrieval.fileSha256); assert.equal(audit.exposureAuditFileSha256, p.exposureAudit.fileSha256);
  assert.deepEqual(audit.cases.map((c: Json) => c.caseId), ids); assert.ok(audit.cases.every((c: Json) => c.sourceScopeReviewed === true && c.familySeparationReviewed === true && typeof c.notes === 'string'));
  const experimentId = sourceCalibrationHash({ packet: p.packet.fileSha256, freeze: p.candidateFreeze.fileSha256, anchor, createdAt: p.createdAt }).slice(0, 24);
  const reviewCases: { id: string; question: string; product: { id: string; title: string }; sources: Source[]; generationSourceIds: string[]; generationSourceIdsByArm?: Record<Arm, string[]> }[] = [];
  const slots: Slot[] = [];
  for (const [index, c] of cases.entries()) {
    assert.match(c.id, /^[A-Za-z0-9_-]{1,120}$/); assert.ok(c.question.length > 0 && c.question.length <= 500); assert.ok(c.sources.length > 0 && c.sources.length <= 256);
    assert.equal(c.sourcePoolSha256, contextComparisonHash(c.sources)); assert.equal(new Set(c.sources.map((s: Source) => s.id)).size, c.sources.length);
    for (const source of c.sources as Source[]) { assert.equal(source.sha256, workspaceReviewSourceHash(source)); assert.ok(source.text.length > 0 && source.text.length <= 3000); }
    const row = retrieval.results[index], selected = ((coverage ? row.baseline : row.retrieval) as RetrievalResult).passages;
    const byArm: Record<Arm, RetrievedPassage[]> = { baseline: selected, candidate: coverage ? row.candidate.passages : selected };
    for (const passages of Object.values(byArm)) {
      assert.ok(passages.length > 0 && passages.length <= c.sources.length); assert.equal(new Set(passages.map(s => s.id)).size, passages.length);
      for (const passage of passages) { const source = c.sources.find((s: Source) => s.id === passage.id); assert.ok(source); assert.equal(passage.productId, c.product.id); assert.equal(passage.source, source.label); assert.equal(passage.text, source.text); assert.equal(passage.originalQuestion ?? null, source.originalQuestion); assert.equal(passage.reference, source.label, 'Generation uses the workspace parent-label reference; upstream references remain in the review pool.'); assert.equal(passage.sha256, sourceCalibrationHash(source.text)); }
    }
    if (coverage) {
      const product = { ...c.product, sources: (c.sources as Source[]).map(source => ({ ...source, originalQuestion: source.originalQuestion ?? undefined })) };
      assert.equal(row.indexRetrieval.corpusVersion, coverageCorpus!.version); assert.ok(row.indexRetrieval.passages.length <= 5);
      const restored = workspaceCompleteSourceContext(product, coverageCorpus!, row.indexRetrieval), augmented = workspaceSourceCoverageContext(product, coverageCorpus!, row.indexRetrieval, c.question);
      assert.deepEqual(row.baseline, { ...row.indexRetrieval, passages: restored });
      assert.deepEqual(row.candidate, { ...row.indexRetrieval, passages: augmented.passages }); assert.deepEqual(row.additions, augmented.additions); assert.equal(row.contract, augmented.contract);
      assert.ok(augmented.passages.length <= 8 && augmented.passages.length - restored.length <= 3); assert.deepEqual(augmented.passages.slice(0, restored.length), restored);
    }
    reviewCases.push({ id: c.id, question: c.question, product: c.product, sources: c.sources, generationSourceIds: selected.map(s => s.id), ...(coverage ? { generationSourceIdsByArm: { baseline: selected.map(s => s.id), candidate: byArm.candidate.map(s => s.id) } } : {}) });
    const pair: Slot[] = [];
    for (const arm of (index % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) as Arm[]) {
      const input: WorkspaceGenerationInput = { runId: `${coverage ? 'retrieval-coverage' : 'source-calibration'}-${experimentId}-${index}-${arm}`, generationContract: coverage || arm === 'baseline' ? WORKSPACE_GENERATION_CONTRACT : WORKSPACE_SOURCE_CALIBRATION_CONTRACT, question: c.question, product: { ...c.product, split: 'validation' }, policy: p.policy, passages: byArm[arm] };
      const parts = workspaceGenerationParts(input); pair.push({ index: slots.length + pair.length, caseId: c.id, arm, input: parts.input, requestBody: parts.body, binding: parts.binding });
    }
    const neutral = (slot: Slot) => { const body = clone(slot.requestBody), payload = JSON.parse(body.messages[1].content); delete payload.promptVersion; delete payload.operationRunId; return { model: body.model, payload, parameters: body.tools[0].function.parameters, ...Object.fromEntries(Object.entries(body).filter(([key]) => !['messages', 'tools', 'tool_choice', 'model'].includes(key))) }; };
    if (coverage) {
      const sameAnswerContract = (slot: Slot) => {
        const body = clone(slot.requestBody), payload = JSON.parse(body.messages[1].content); delete payload.operationRunId; delete payload.evidence; delete payload.quoteOptions;
        body.messages[1].content = JSON.stringify(payload);
        (body.tools[0].function.parameters as any).properties.citations.items.enum = [];
        return body;
      };
      assert.deepEqual(sameAnswerContract(pair[0]), sameAnswerContract(pair[1]), 'Retrieval arms may differ only in supplied sources, derived citation IDs and operation identity.');
    } else assert.deepEqual(neutral(pair[0]), neutral(pair[1]), 'Arms may differ only in contract, instructions, tool and operation identity.');
    slots.push(...pair);
  }
  const changedCaseIds = coverage ? reviewCases.filter(c => c.generationSourceIdsByArm!.candidate.length > c.generationSourceIdsByArm!.baseline.length).map(c => c.id) : [];
  const unchangedCaseIds = coverage ? reviewCases.filter(c => !changedCaseIds.includes(c.id)).map(c => c.id) : [];
  const plan = { format: coverage ? 'ablatrix-retrieval-coverage-first-answer-plan-v1' : 'ablatrix-source-calibration-first-answer-plan-v1', preparation: p, cases: reviewCases, slots,
    ...(coverage ? { retrievalContexts: { changedCaseIds, unchangedCaseIds, plannedChangedCases: changedCaseIds.length, plannedUnchangedCases: unchangedCaseIds.length } } : {}),
    budget: { maximumNewAttempts: 16, absoluteCallLimit: anchor.attempts + 16, capUsd: 20, allowancePerCallUsd: .1, priorSpendUsd: anchor.priorSpendUsd }, provenance: 'local_exploratory_comparison', revisions: 0, retries: 0, graderCalls: 0, webCalls: 0, humanJudgments: 0, qualityClaimEligible: false, paidExecutionAuthorized: false } as const;
  return { plan, planSha256: sourceCalibrationHash(plan) };
}
export type SourceCalibrationManifest = ReturnType<typeof prepareSourceCalibrationComparison>;
export function verifySourceCalibrationPlan(manifest: SourceCalibrationManifest) { assert.equal(manifest.planSha256, sourceCalibrationHash(manifest.plan)); assert.deepEqual(manifest, prepareSourceCalibrationComparison(manifest.plan.preparation)); return manifest; }

/** Read-only aggregate anchor. Raw historical rows never leave this helper. */
export function readSourceCalibrationLedgerState(path: string, priorSpendUsd: number, plannedRunIds: string[] = []): SourceCalibrationLedgerState {
  assert.ok(isAbsolute(path) && resolve(path) === path && existsSync(path) && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() && realpathSync(path) === path, 'An existing canonical shared ledger is required.');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const all = db.prepare('SELECT * FROM loop_provider_calls ORDER BY rowid').all() as unknown as LedgerRow[], planned = new Set(plannedRunIds), rows = all.filter(row => row.run_id && planned.has(row.run_id));
    const ownerRows = db.prepare('SELECT pid,token,expires_at FROM loop_provider_owner ORDER BY id').all() as SourceCalibrationLedgerState['ownerRows'];
    return { canonicalPath: path, pathSha256: sourceCalibrationHash(path), historicalRowsSha256: sourceCalibrationHash(all.filter(row => !row.run_id || !planned.has(row.run_id))), attempts: all.length, reservedUsd: all.reduce((sum, row) => sum + Number(row.allowance_usd), 0), priorSpendUsd, pending: all.filter(row => row.status === 'pending').length, owners: ownerRows.length, rows, ownerRows };
  } finally { db.close(); }
}
export function readLedgerAnchor(path: string, priorSpendUsd: number): SourceCalibrationLedgerAnchor { const { rows, ownerRows, ...anchor } = readSourceCalibrationLedgerState(path, priorSpendUsd); assert.equal(rows.length, 0); return anchor; }
type ObservedStep = { index: number; started: boolean; dispatched: boolean; dispatchIntent?: true; startedAt?: string; observedAt?: string; attemptId?: string; receipt?: WorkspaceGenerationReceipt; receiptSha256?: string };
export type SourceCalibrationCheckpoint = { format: 'source-calibration-checkpoint-v1'; planSha256: string; steps: ObservedStep[]; stopReason: string | null; transportProvenance: 'live_router' | 'mocked_mechanics_only' };
// A rejected answer can still have measured usage. Preserve that observation
// only when its receipt retains the exact planned request and token bindings.
function observedUsage(slot: Slot, receipt?: WorkspaceGenerationReceipt) {
  if (!receipt?.receipt_json || receipt.status !== 'completed') return null;
  try {
    const document = JSON.parse(receipt.receipt_json), usage = document.usage;
    if (document.promptVersion !== slot.binding.contract || document.mode !== 'live' || document.accounting !== 'local_planning_allowance' || document.model !== receipt.model ||
      Object.entries(slot.binding).some(([key, value]) => document[key] !== value) || !usage || Object.keys(usage).sort().join(',') !== 'inputTokens,outputTokens' ||
      !Number.isSafeInteger(usage.inputTokens) || usage.inputTokens < 0 || !Number.isSafeInteger(usage.outputTokens) || usage.outputTokens < 0 ||
      receipt.input_tokens !== usage.inputTokens || receipt.output_tokens !== usage.outputTokens) return null;
    return { inputTokens: usage.inputTokens as number, outputTokens: usage.outputTokens as number };
  } catch { return null; }
}
export function verifySourceCalibrationResult(manifest: SourceCalibrationManifest, checkpoint: SourceCalibrationCheckpoint) {
  verifySourceCalibrationPlan(manifest); assert.equal(checkpoint.format, 'source-calibration-checkpoint-v1'); assert.equal(checkpoint.planSha256, manifest.planSha256); assert.equal(checkpoint.steps.length, 16);
  assert.ok(['live_router', 'mocked_mechanics_only'].includes(checkpoint.transportProvenance)); let stopped = false, model: string | undefined; const observedModels = new Set<string>();
  const steps = checkpoint.steps.map((step, index) => {
    const slot = manifest.plan.slots[index]; assert.equal(step.index, index); assert.ok(!step.dispatched || step.started && step.attemptId && step.dispatchIntent); assert.ok(!step.attemptId || step.started); assert.ok(!step.dispatchIntent || step.started && step.attemptId);
    assert.equal(Boolean(step.startedAt), step.started); if (step.startedAt) assert.ok(Number.isFinite(Date.parse(step.startedAt))); if (step.observedAt) assert.ok(step.startedAt && Date.parse(step.observedAt) >= Date.parse(step.startedAt));
    const timing = { startedAt: step.startedAt ?? null, observedAt: step.observedAt ?? null, finishedAt: null as string | null, elapsedMs: null as number | null, attemptDurationMs: step.startedAt && step.observedAt ? Date.parse(step.observedAt) - Date.parse(step.startedAt) : null };
    if (stopped) assert.equal(step.started, false, 'Dispatch continued after an invalid or unknown arm.');
    if (!step.started) { stopped = true; assert.ok(!step.receipt && !step.dispatched && !step.attemptId && !step.observedAt); return { index, caseId: slot.caseId, arm: slot.arm, status: 'not_attempted' as const, ...timing }; }
    if (!step.receipt) { stopped = true; return { index, caseId: slot.caseId, arm: slot.arm, status: 'failed_or_unknown' as const, ...timing }; }
    assert.equal(step.receiptSha256, sourceCalibrationHash(step.receipt)); assert.equal(step.receipt.id, step.attemptId); assert.equal(step.receipt.kind, slot.binding.contract === WORKSPACE_GENERATION_CONTRACT ? workspaceGenerationPromptIdentity().tool : workspaceGenerationPromptIdentity(WORKSPACE_SOURCE_CALIBRATION_CONTRACT).tool); assert.equal(step.receipt.allowance_usd, .1);
    let output: ReturnType<typeof replayWorkspaceGenerationReceipt> | undefined;
    try { output = replayWorkspaceGenerationReceipt(slot.input, step.receipt, 'live'); } catch { /* Incomplete, invalid and ambiguous receipts remain unknown. */ }
    if (output) observedModels.add(output.model);
    if (!output || !step.dispatched || !step.observedAt || model && output.model !== model) { stopped = true; return { index, caseId: slot.caseId, arm: slot.arm, status: 'failed_or_unknown' as const, ...timing }; }
    model = output.model; return { index, caseId: slot.caseId, arm: slot.arm, status: 'completed' as const, output, ...timing, finishedAt: step.observedAt, elapsedMs: timing.attemptDurationMs };
  });
  const attempts = checkpoint.steps.filter(s => s.attemptId).length, usages = checkpoint.steps.flatMap((step, index) => { const usage = observedUsage(manifest.plan.slots[index], step.receipt); return usage ? [usage] : []; }), knownUsage = usages.reduce((sum, u) => ({ inputTokens: sum.inputTokens + u.inputTokens, outputTokens: sum.outputTokens + u.outputTokens }), { inputTokens: 0, outputTokens: 0 });
  assert.ok(Number.isSafeInteger(knownUsage.inputTokens) && Number.isSafeInteger(knownUsage.outputTokens));
  const contexts = manifest.plan.retrievalContexts, completedPairs = (ids: string[]) => ids.filter(id => steps.filter(step => step.caseId === id && step.status === 'completed').length === 2).length;
  return { format: manifest.plan.preparation.experiment === RETRIEVAL_COVERAGE_EXPERIMENT ? 'retrieval-coverage-result-v1' : 'source-calibration-result-v1', planSha256: manifest.planSha256, status: steps.every(s => s.status === 'completed') && !checkpoint.stopReason ? 'awaiting_independent_review' : 'stopped', transportProvenance: checkpoint.transportProvenance, plannedCases: 8, plannedAnswers: 16,
    ...(contexts ? { retrievalContexts: { ...contexts, completedChangedPairs: completedPairs(contexts.changedCaseIds), completedUnchangedPairs: completedPairs(contexts.unchangedCaseIds), unchangedContextCaveat: 'Unchanged contexts remain in the planned denominator; any answer difference cannot be attributed to added retrieval context.' } } : {}),
    newProviderAttempts: attempts, planningAllowanceReservedUsd: Math.round(attempts * 10) / 100, allowanceIsProviderCharge: false, networkDispatches: checkpoint.steps.filter(s => s.dispatched).length, dispatchIntentsWithoutObservedEntry: checkpoint.steps.filter(s => s.dispatchIntent && !s.dispatched).length, completedAnswers: steps.filter(s => s.status === 'completed').length, usage: usages.length === attempts ? knownUsage : null, knownUsageSubtotal: knownUsage, attemptsWithKnownUsage: usages.length, observedModels: [...observedModels], modelIdentityConsistent: observedModels.size <= 1, retries: 0, revisions: 0, graderCalls: 0, webCalls: 0, steps, humanJudgments: 0, qualityClaimEligible: false, actualProviderCharges: 'unavailable', limitation: 'Local structural replay only; does not authenticate provider origin, certify a grader or establish answer quality. Timings measure the local operation; unknown provider completion stays null.' };
}
export function sourceCalibrationReviewWorksheet(manifest: SourceCalibrationManifest, checkpoint: SourceCalibrationCheckpoint) {
  const result = verifySourceCalibrationResult(manifest, checkpoint), mapping: Json[] = [];
  const quote = (value: string) => value.split('\n').map(line => `> ${line}`).join('\n');
  const lines = ['# Anonymous first-answer source review', '', 'Review each answer against the complete saved sources. Labels conceal assignment only; writing style can still reveal it. No grades or verdicts have been assigned.', 'For each answer: support ___; completeness ___; scope/uncertainty ___; citation relevance ___; unnecessary wording ___; checked source IDs ___; correction ___. Then preference A/B/tie/neither ___ with reason ___.', ''];
  for (const c of manifest.plan.cases) {
    lines.push(`## ${c.id}`, '', quote(c.question), '', quote(c.product.title), '');
    const order: Arm[] = parseInt(sourceCalibrationHash(`${manifest.planSha256}:${c.id}`).slice(0, 2), 16) % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
    order.forEach((arm, i) => { const step = result.steps.find(s => s.caseId === c.id && s.arm === arm)!; const label = i ? 'B' : 'A'; mapping.push({ caseId: c.id, label, arm, slotIndex: step.index, ...(c.generationSourceIdsByArm ? { generationSourceIds: c.generationSourceIdsByArm[arm] } : {}) }); lines.push(`### Answer ${label}`, '', step.status === 'completed' ? quote(step.output!.answer.answer) : `Unavailable (${step.status}); retained in the planned denominator.`, ''); if (step.status === 'completed') for (const citation of step.output!.answer.citations) lines.push(`Source ${citation.passageId}`, quote(citation.quote), ''); });
    lines.push('### Complete saved sources', ''); for (const s of c.sources) lines.push(`Source ${s.id} — ${s.label}`, '', ...(s.originalQuestion ? ['Original customer question:', quote(s.originalQuestion), ''] : []), quote(s.text), '', ...(s.reference ? [`Reference: ${s.reference}`, ''] : []));
  }
  return { worksheet: `${lines.join('\n')}\n`, armMapping: { planSha256: manifest.planSha256, mapping } };
}

type Guard = NonNullable<FeedbackProviderOptions['operationGuard']>;
type Provider = Pick<SapiomFeedbackProvider, 'answerWorkspace' | 'receipt' | 'capacity' | 'close' | 'executionMode'>;
export type SourceCalibrationDependencies = {
  checkFrozenFiles(): void; readLedger(): SourceCalibrationLedgerState;
  createProvider(hooks: { fetchImpl: typeof fetch; operationGuard: Guard }): Provider; transport: typeof fetch;
  output: { create(): void; checkpoint(value: SourceCalibrationCheckpoint): void; finish(result: ReturnType<typeof verifySourceCalibrationResult>, review: ReturnType<typeof sourceCalibrationReviewWorksheet>): void };
};
export async function executeSourceCalibrationComparison(manifest: SourceCalibrationManifest, options: { execute: boolean; liveOptIn: boolean; approvedPlanSha256: string; transportProvenance: SourceCalibrationCheckpoint['transportProvenance'] }, dependencies: SourceCalibrationDependencies) {
  assert.ok(options.execute === true && options.liveOptIn === true && options.approvedPlanSha256 === manifest.planSha256, 'Execution requires --execute, ABLATRIX_LOOP_LIVE=1 and the exact approved plan hash before provider construction.');
  verifySourceCalibrationPlan(manifest); const anchor = manifest.plan.preparation.ledgerAnchor;
  const checkpoint: SourceCalibrationCheckpoint = { format: 'source-calibration-checkpoint-v1', planSha256: manifest.planSha256, steps: manifest.plan.slots.map(s => ({ index: s.index, started: false, dispatched: false })), stopReason: null, transportProvenance: options.transportProvenance };
  let active: { slot: Slot; before: boolean } | undefined, owner: string | undefined, provider: Provider | undefined;
  const inspect = () => {
    verifySourceCalibrationPlan(manifest); dependencies.checkFrozenFiles(); const state = dependencies.readLedger();
    assert.equal(state.canonicalPath, anchor.canonicalPath); assert.equal(state.pathSha256, anchor.pathSha256); assert.equal(state.historicalRowsSha256, anchor.historicalRowsSha256); assert.equal(state.priorSpendUsd, anchor.priorSpendUsd);
    const reserved = checkpoint.steps.filter(s => s.attemptId); assert.equal(state.attempts, anchor.attempts + reserved.length); assert.ok(Math.abs(state.reservedUsd - anchor.reservedUsd - reserved.length * .1) < 1e-8); assert.equal(state.rows.length, reserved.length);
    for (const s of reserved) { const slot = manifest.plan.slots[s.index], rows = state.rows.filter(row => row.run_id === slot.input.runId); assert.equal(rows.length, 1); const row = rows[0]; assert.equal(row.id, s.attemptId); assert.equal(row.allowance_usd, .1); assert.equal(row.kind, workspaceGenerationParts(slot.input).tool); if (s.receipt) assert.equal(sourceCalibrationHash(receiptProjection(row)), s.receiptSha256); else { assert.equal(row.status, 'pending'); assert.equal(row.error_code, null); const binding = JSON.parse(row.receipt_json!); for (const [key, value] of Object.entries(slot.binding)) assert.equal(binding[key], value); } }
    assert.equal(state.pending, state.rows.filter(row => row.status === 'pending').length); assert.ok(state.pending <= (active ? 1 : 0));
    if (!reserved.length) assert.equal(state.owners, 0); else { assert.equal(state.owners, 1); assert.equal(state.ownerRows[0].pid, process.pid); assert.ok(state.ownerRows[0].expires_at > Date.now()); owner ??= state.ownerRows[0].token; assert.equal(state.ownerRows[0].token, owner); }
    return state;
  };
  inspect(); dependencies.output.create(); dependencies.output.checkpoint(clone(checkpoint)); inspect();
  const guard: Guard = async operation => {
    assert.ok(active && operation.kind === workspaceGenerationParts(active.slot.input).tool && operation.runId === active.slot.input.runId && operation.requestSha256 === active.slot.binding.requestSha256, 'Unexpected provider operation.');
    const step = checkpoint.steps[active.slot.index];
    if (operation.phase === 'before_reservation') { assert.ok(!active.before && !step.attemptId); inspect(); active.before = true; }
    else { assert.ok(active.before && !step.attemptId && operation.attemptId); step.attemptId = operation.attemptId; dependencies.output.checkpoint(clone(checkpoint)); inspect(); }
  };
  const bounded: typeof fetch = async (url, init) => {
    const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    assert.ok(active); const step = checkpoint.steps[active.slot.index];
    assert.ok(active.before && step.attemptId && !step.dispatched && target === 'https://router.sapiom.ai/v1/chat/completions' && init?.method === 'POST' && init.body === JSON.stringify(active.slot.requestBody), 'Transport must match the sole frozen request exactly once.');
    inspect(); step.dispatchIntent = true; dependencies.output.checkpoint(clone(checkpoint)); let response: Response | undefined;
    // The shared provider already bounds its streamed JSON body to 128KiB.
    // This same signal remains attached during that body read, not just headers.
    // Persist intent before entry; a failed checkpoint cannot fabricate a call.
    try { step.dispatched = true; response = await dependencies.transport(target, { ...init, redirect: 'error', signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000) }); return response; }
    finally { try { inspect(); } catch (error) { await response?.body?.cancel(); throw error; } }
  };
  try {
    provider = dependencies.createProvider({ fetchImpl: bounded, operationGuard: guard }); assert.equal(provider.executionMode, 'live'); assert.ok(provider.capacity(16).ready);
    for (const slot of manifest.plan.slots) {
      active = { slot, before: false }; const step = checkpoint.steps[slot.index]; inspect(); step.started = true; step.startedAt = new Date().toISOString(); dependencies.output.checkpoint(clone(checkpoint));
      try { await provider.answerWorkspace(clone(slot.input)); } catch { /* Receipt decides; never retry an ambiguous call. */ }
      step.observedAt = new Date().toISOString();
      const state = dependencies.readLedger(), rows = state.rows.filter(row => row.run_id === slot.input.runId), receipt = provider.receipt(slot.input.runId);
      assert.equal(rows.length, receipt ? 1 : 0); if (receipt) { assert.equal(sourceCalibrationHash(receipt), sourceCalibrationHash(receiptProjection(rows[0]))); step.receipt = clone(receipt); step.receiptSha256 = sourceCalibrationHash(receipt); }
      inspect(); const derived = verifySourceCalibrationResult(manifest, checkpoint); dependencies.output.checkpoint(clone(checkpoint));
      if (derived.steps[slot.index].status !== 'completed') { checkpoint.stopReason = 'first_invalid_or_unknown_answer'; break; }
      active = undefined;
    }
  } catch { checkpoint.stopReason = 'frozen_boundary_or_execution_failed'; }
  finally { provider?.close(); }
  dependencies.output.checkpoint(clone(checkpoint)); const result = verifySourceCalibrationResult(manifest, checkpoint); dependencies.output.finish(result, sourceCalibrationReviewWorksheet(manifest, checkpoint)); return { result, checkpoint };
}
function receiptProjection(row: LedgerRow): WorkspaceGenerationReceipt { return { id: row.id, kind: row.kind, status: row.status, model: row.model, input_tokens: row.input_tokens ?? null, output_tokens: row.output_tokens ?? null, error_code: row.error_code, receipt_json: row.receipt_json, allowance_usd: row.allowance_usd }; }

function syncDirectory(path: string) { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
function exclusive(path: string, value: string) { assert.equal(realpathSync(dirname(path)), dirname(path), 'Output parents must be canonical.'); const fd = openSync(path, 'wx', 0o600); try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); } syncDirectory(dirname(path)); }
export function privateSourceCalibrationOutput(directory: string, repository: string): SourceCalibrationDependencies['output'] {
  privatePath(directory, repository); let created = false;
  const safe = () => { assert.equal(realpathSync(dirname(directory)), dirname(directory)); assert.ok(!existsSync(directory), 'An existing comparison directory cannot be overwritten or resumed.'); };
  return {
    create() { safe(); mkdirSync(directory, { mode: 0o700 }); syncDirectory(dirname(directory)); exclusive(resolve(directory, 'checkpoint.jsonl'), ''); created = true; },
    checkpoint(value) { assert.ok(created && realpathSync(directory) === directory); const fd = openSync(resolve(directory, 'checkpoint.jsonl'), constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW); try { writeFileSync(fd, `${JSON.stringify(value)}\n`); fsyncSync(fd); } finally { closeSync(fd); } },
    finish(result, review) { assert.ok(created); exclusive(resolve(directory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`); exclusive(resolve(directory, 'review.md'), review.worksheet); exclusive(resolve(directory, 'arm-mapping.json'), `${JSON.stringify(review.armMapping, null, 2)}\n`); }
  };
}
function fileHashes(root: string, values: Record<string, string>) { return Object.fromEntries(Object.keys(values).map(path => [relativeFile(path), sourceCalibrationHash(readFileSync(resolve(root, path)))])); }
export function verifySourceCalibrationCheckpoints(manifest: SourceCalibrationManifest, checkpoints: SourceCalibrationCheckpoint[]) {
  assert.ok(checkpoints.length > 0); let previous: SourceCalibrationCheckpoint | undefined;
  for (const value of checkpoints) { verifySourceCalibrationResult(manifest, value); if (previous) { assert.equal(value.transportProvenance, previous.transportProvenance); if (previous.stopReason) assert.equal(value.stopReason, previous.stopReason); for (const [i, old] of previous.steps.entries()) { const next = value.steps[i]; if (old.started) assert.equal(next.started, true); if (old.dispatchIntent) assert.equal(next.dispatchIntent, true); if (old.dispatched) assert.equal(next.dispatched, true); for (const key of ['startedAt', 'observedAt', 'attemptId', 'receipt', 'receiptSha256'] as const) if (old[key] !== undefined) assert.deepEqual(next[key], old[key], 'A durable checkpoint observation changed.'); } } previous = value; }
  return verifySourceCalibrationResult(manifest, checkpoints.at(-1)!);
}
function checkFiles(manifest: SourceCalibrationManifest, manifestPath?: string) {
  const p = manifest.plan.preparation, root = p.scope.repositoryPath;
  assert.deepEqual(fileHashes(root, p.implementationSha256), p.implementationSha256); assert.deepEqual(fileHashes(root, p.historySha256), p.historySha256);
  const artifacts = artifactNames.map(name => p[name]); for (const a of artifacts) { const bytes = readFileSync(resolve(root, a.path)); assert.equal(sourceCalibrationHash(bytes), a.fileSha256); assert.deepEqual(JSON.parse(bytes.toString()), a.document); }
  assert.equal(metadataFingerprints(readFlatExposureMetadata(p.scope.workspacePaths, p.scope.comparisonPaths)).sha256, p.exposure.metadataSha256);
  const excluded = [...artifacts, ...Object.entries(p.historySha256).map(([path, fileSha256]) => ({ path, fileSha256 }))];
  if (manifestPath) { privatePath(manifestPath, root); assert.deepEqual(JSON.parse(readFileSync(manifestPath, 'utf8')), manifest, 'Frozen plan file changed.'); }
  assert.equal(sourceCalibrationHash(readFlatPublicExposure(root, excluded, manifestPath ? { path: manifestPath, fileSha256: sourceCalibrationHash(readFileSync(manifestPath)) } : undefined)), p.exposure.publicExposureSha256);
}
/** Production CLI deliberately has no provider/transport injection flags. */
export async function sourceCalibrationComparisonCli(argv: string[], env: NodeJS.ProcessEnv = process.env, expectedExperiment: 'source_calibration_v1' | typeof RETRIEVAL_COVERAGE_EXPERIMENT = 'source_calibration_v1') {
  if (!argv.length) return { mode: 'offline', usage: '--prepare --preparation FILE --out FILE | --verify --plan FILE [--checkpoint FILE] | --execute --plan FILE --approved-plan-sha256 HASH' };
  const command = argv[0], flags = new Map<string, string>(); assert.ok(['--prepare', '--verify', '--execute'].includes(command));
  for (let i = 1; i < argv.length; i += 2) { assert.ok(argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--') && !flags.has(argv[i])); flags.set(argv[i], argv[i + 1]); }
  const required = command === '--prepare' ? ['--preparation', '--out'] : command === '--execute' ? ['--plan', '--approved-plan-sha256'] : ['--plan'];
  assert.ok(required.every(f => flags.has(f)) && [...flags.keys()].every(f => required.includes(f) || command === '--verify' && f === '--checkpoint'));
  const read = (flag: string) => JSON.parse(readFileSync(flags.get(flag)!, 'utf8'));
  if (command === '--prepare') { const prep = read('--preparation') as SourceCalibrationPreparation; assert.equal(prep.experiment ?? 'source_calibration_v1', expectedExperiment, 'Wrong comparison CLI for this experiment.'); privatePath(resolve(flags.get('--preparation')!), prep.scope.repositoryPath); privatePath(resolve(flags.get('--out')!), prep.scope.repositoryPath); const current = readLedgerAnchor(prep.ledgerAnchor.canonicalPath, prep.ledgerAnchor.priorSpendUsd); assert.deepEqual(current, prep.ledgerAnchor, 'Refresh the supplied ledger anchor before freezing.'); const manifest = prepareSourceCalibrationComparison(prep); checkFiles(manifest); exclusive(resolve(flags.get('--out')!), `${JSON.stringify(manifest, null, 2)}\n`); return { mode: 'offline_preparation', planSha256: manifest.planSha256, proposedCalls: 16, newProviderCalls: 0 }; }
  const manifest = read('--plan') as SourceCalibrationManifest;
  assert.equal(manifest.plan.preparation.experiment ?? 'source_calibration_v1', expectedExperiment, 'Wrong comparison CLI for this experiment.');
  if (command === '--execute') assert.ok(flags.get('--approved-plan-sha256') === manifest.planSha256 && env.ABLATRIX_LOOP_LIVE === '1', 'Exact approval and live opt-in are required before provider or credential access.');
  verifySourceCalibrationPlan(manifest); checkFiles(manifest, resolve(flags.get('--plan')!));
  if (command === '--verify') { if (!flags.has('--checkpoint')) return { verified: true, planSha256: manifest.planSha256, newProviderCalls: 0, qualityClaimEligible: false }; const raw = readFileSync(flags.get('--checkpoint')!, 'utf8'); assert.ok(raw.endsWith('\n')); return verifySourceCalibrationCheckpoints(manifest, raw.trimEnd().split('\n').map(line => JSON.parse(line) as SourceCalibrationCheckpoint)); }
  const prep = manifest.plan.preparation, root = fileURLToPath(new URL('../', import.meta.url)); assert.equal(realpathSync(prep.scope.repositoryPath), realpathSync(root));
  const result = await executeSourceCalibrationComparison(manifest, { execute: true, liveOptIn: env.ABLATRIX_LOOP_LIVE === '1', approvedPlanSha256: flags.get('--approved-plan-sha256')!, transportProvenance: 'live_router' }, {
    checkFrozenFiles: () => checkFiles(manifest, resolve(flags.get('--plan')!)), readLedger: () => readSourceCalibrationLedgerState(prep.ledgerAnchor.canonicalPath, prep.ledgerAnchor.priorSpendUsd, manifest.plan.slots.map(s => s.input.runId)), output: privateSourceCalibrationOutput(prep.scope.outputDirectory, prep.scope.repositoryPath), transport: fetch,
    createProvider: hooks => new SapiomFeedbackProvider({ enabled: true, apiKey: env.SAPIOM_API_KEY, credentialsFile: env.SAPIOM_CREDENTIALS_FILE, dbPath: prep.ledgerAnchor.canonicalPath, capUsd: 20, priorSpendUsd: prep.ledgerAnchor.priorSpendUsd, allowancePerCallUsd: .1, callLimit: manifest.plan.budget.absoluteCallLimit, ...hooks })
  });
  return { status: result.result.status, planSha256: manifest.planSha256, outputDirectory: prep.scope.outputDirectory, newProviderAttempts: result.result.newProviderAttempts, qualityClaimEligible: false };
}
export function retrievalCoverageComparisonCli(argv: string[], env: NodeJS.ProcessEnv = process.env) { return sourceCalibrationComparisonCli(argv, env, RETRIEVAL_COVERAGE_EXPERIMENT); }
