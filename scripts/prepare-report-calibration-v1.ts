/** Exposed-development preparation only. No provider, credentials or fresh inputs. */
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { textHash } from '../server/product-corpus.ts';
import { diagnosticHash, DIAGNOSTIC_LEDGER, prepareThreeContext, type DiagnosticCase, type DiagnosticPreparation } from '../server/three-context-diagnostic.ts';
import { requiredThreeContextLiveFiles, type ThreeContextLivePreparation } from '../server/three-context-live.ts';
import { readLedgerAnchor } from '../server/source-calibration-comparison.ts';
import { WORKSPACE_GENERATION_CONTRACT, type WorkspaceGenerationContract } from '../server/workspace-generation.ts';
import { WORKSPACE_UNCERTAINTY_CONTRACT } from '../server/workspace-uncertainty-policy.ts';
import { REVIEWED_V5_RESULT, verifyReviewedV5DevelopmentResult } from './prepare-three-context-v5.ts';
import type { RetrievedPassage } from '../server/loop-types.ts';

const repository = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const old = 'docs/evidence/retrieval-source-coverage-v2-2026-10-18', diagnosis = 'docs/evidence/retrieval-diagnosis-2026-10-19';
export const REPORT_CALIBRATION_V1 = Object.freeze({ format: 'ablatrix-report-calibration-development-v1', selectedSourceCaseIds: ['source-coverage-v2-train-12870', 'source-coverage-v2-train-13347'],
  selectionRule: 'all_old_specification_or_model_detail_gaps_plus_first_lexicographic_baseline_complete_control',
  v6ResultPath: 'docs/evidence/report-uncertainty-v6-2026-10-19/development-result-v1.json', v6FreezePath: 'docs/evidence/report-uncertainty-v6-2026-10-19/candidate-freeze-v1.json', protocolPath: 'docs/evidence/report-uncertainty-v6-2026-10-19/development-protocol-v1.json',
  instructionContracts: [WORKSPACE_GENERATION_CONTRACT, WORKSPACE_UNCERTAINTY_CONTRACT], repeats: 2, actualProducts: 2, caseInstances: 8, plannedAnswers: 24 } as const);
export function reportCalibrationDevelopmentProtocol() {
  const document = { format: 'ablatrix-report-calibration-development-protocol-v1', scope: 'exposed_development_only',
    design: { actualProducts: 2, freshProducts: 0, caseInstances: 8, instructionVariants: 2, contextsPerInstance: 3, repetitions: 2, maximumNewAttempts: 24,
      selectedSourceCaseIds: REPORT_CALIBRATION_V1.selectedSourceCaseIds, instructionContracts: REPORT_CALIBRATION_V1.instructionContracts,
      selectionRule: REPORT_CALIBRATION_V1.selectionRule, selectionBasis: 'Exact historical source-only review; all eligible old gaps plus the lexicographically first old complete control, without filtering on new candidate or answer success.',
      contexts: { current: 'v5', semantic: 'v6', reference: 'independent_curated' },
      contextDefinitions: { current: 'Exact independently reviewed additive v5 context', semantic: 'Independently reviewed full-twelve-case v6 replay context', reference: 'Independently source-reviewed sufficient reference preserving qualifications and unknowns' },
      repeatsMeaning: 'Two repeated outputs per source-case/instruction/context cell, not independent product samples.',
      executionOrder: 'Repeat, old source-only case order, alternating instruction-contract order; existing adapter rotates context order by opaque case instance.',
      controls: 'Within a source case/repetition/context, both instruction contracts receive identical literal context and runtime policy; model route, settings, citation/schema interface and answer budget remain fixed.',
      anonymity: 'Opaque instance IDs use a private keyed derivation; keys, generation-contract mappings and operation identities are excluded from reviewer packets.' },
    review: { axes: ['usefulFactCompleteness', 'unsupportedClaims', 'exactApplicability', 'appropriateUncertainty', 'directRelevance', 'literalCitationMatching'],
      comparisons: 'Explicit anonymous source-aware reviewer verdicts; within-instance retrieval comparisons and separate across-instruction pairs at fixed source case/repetition/context. Keep each reviewer and disagreements; no algorithmic composite winner.',
      retention: 'Keep every planned arm, candidate miss, complete control, tie, disagreement, uncertain judgment, failed and unattempted answer. No replacement or resampling based on outcomes.',
      calibration: 'AI judgments remain provisional; source-checked human judgments exist only when actually saved and bound. Agreement is not ground truth.' },
    gates: { independentSourceScopeAndReferenceSufficiency: true, independentlyReviewedFullTwelveCaseResult: true, exactIndependentCodeQualification: true, separateExactFinancialApproval: true,
      initialPreparationCodeReviewPassed: false, initialPreparationPaidPlan: null, futureFreshValidationRequiresOwnFrozenProtocolAndApproval: true },
    expectedPlanningScope: { canonicalStartingAttempts: 141, canonicalStartingCombinedPlanningUsd: 14.300281, maximumNewAttempts: 24, addedPlanningAllowanceUsd: 2.4, absoluteCallLimit: 165, cumulativePlanningLimitUsd: 16.700281, localCapUsd: 20, retries: 0, graderCalls: 0, webCalls: 0, actualProviderCharges: 'unavailable', providerEnforcedCap: false },
    paidExecutionAuthorized: false, freshInputReads: 0, humanAnswerQualityJudgments: 0, qualityClaimEligible: false, activationAllowed: false };
  return { ...document, sha256: diagnosticHash(document) };
}
const historicalPins = {
  [`${old}/deck-v1.json`]: 'e315f8cccbe943acfa205e4c2a3a6f966d41865ec63247214693909be5052a9a',
  [`${old}/source-review-v1.json`]: 'cc10964003f98c7ab141f70c69588949802852fc6434761040b34510484efffe',
  [`${old}/baseline-v1.json`]: 'd8dfe44845d0b92666fc3fae86a9c52e54ee398606a2736ec37ff9f9ea347005',
  [`${diagnosis}/three-context-preparation-final.json`]: 'dccc3389cdfbe6e3c0052fd3c996b5664bba37edaa89da79f9b7ee24feb34f4e'
};
type Json = Record<string, any>;
export type ReportCalibrationPins = { v6ReviewedResultPath: string; expectedV6ReviewedResultSha256: string; sourceReviewPath: string; expectedSourceReviewSha256: string };
export type ReportCalibrationSourceReview = { format: 'ablatrix-report-calibration-source-review-v1'; provenance: 'independent_ai_source_review'; reviewer: string; candidateResultsInspected: false; generatedAnswersInspected: false;
  sourceEligibilityReviewFileSha256: string; selectionRule: typeof REPORT_CALIBRATION_V1.selectionRule;
  cases: { sourceCaseId: string; sourcePoolSha256: string; referenceContextSha256: string; designatedFactsSha256: string; questionScopeSha256: string; unknowns: string[]; sufficientFor: string; sourceScopeReviewed: true; originalQuestionsReviewed: true; referenceSufficient: true }[];
  paidExecutionAuthorized: false; qualityClaimEligible: false };
export type ReportCalibrationPreparation = ThreeContextLivePreparation & { reportCalibration: { format: typeof REPORT_CALIBRATION_V1.format; scope: 'exposed_development_only'; actualProducts: 2; freshProducts: 0; caseInstances: 8; repeats: 2; plannedAnswers: 24;
  selectionRule: typeof REPORT_CALIBRATION_V1.selectionRule; selectedSourceCaseIds: string[]; instructionContracts: readonly WorkspaceGenerationContract[]; privateCaseIdentityKey: string;
  caseInstancesPrivate: { caseId: string; sourceCaseId: string; productId: string; generationContract: WorkspaceGenerationContract; repeat: number }[];
  executionOrder: string; evaluationMethod: string; sourceReviewPath: string; sourceReviewSha256: string; v6ReviewedResultPath: string; v6ReviewedResultSha256: string;
  paidExecutionAuthorized: false; qualityClaimEligible: false; activationAllowed: false } };

function canonical(root: string, path: string) {
  assert.ok(path && !isAbsolute(path) && !path.includes('\\') && !path.split('/').some(s => s === '..' || s === '.'));
  const full = resolve(root, path); assert.ok(lstatSync(full).isFile() && !lstatSync(full).isSymbolicLink() && realpathSync(full) === full, 'Inputs must be canonical repository regular files.'); return full;
}
function bytes(root: string, path: string, sha?: string) { const value = readFileSync(canonical(root, path), 'utf8'); if (sha !== undefined) { assert.match(sha, /^[a-f0-9]{64}$/); assert.equal(textHash(value), sha, `Frozen bytes changed: ${path}`); } return value; }
function privateOutput(root: string, output: string) { const rel = relative(root, output); assert.ok(isAbsolute(output) && output === resolve(output) && rel.startsWith('.data/') && !rel.split('/').includes('..') && !existsSync(output), 'Use a new private repository .data path.'); assert.equal(realpathSync(dirname(output)), dirname(output), 'Output parent must already be canonical.'); }

/** This source-only view can be independently reviewed before inspecting new
 * candidate results. Selection is determined entirely by the old source review. */
export function reportCalibrationSourceReviewRequests(root = repository) {
  const read = (path: string) => JSON.parse(bytes(root, path, historicalPins[path as keyof typeof historicalPins]));
  const deck = read(`${old}/deck-v1.json`), assessment = read(`${old}/source-review-v1.json`), baseline = read(`${old}/baseline-v1.json`), original = read(`${diagnosis}/three-context-preparation-final.json`);
  assert.equal(assessment.candidateContextInspected, false); assert.equal(assessment.modelOutputsInspected, false);
  assert.equal(assessment.deckFileSha256, historicalPins[`${old}/deck-v1.json`]); assert.equal(assessment.baselineFileSha256, historicalPins[`${old}/baseline-v1.json`]);
  const gaps = assessment.cases.filter((r: Json) => ['specification_gap', 'model_detail_gap'].includes(r.sourceGapGroup)).map((r: Json) => r.caseId).sort();
  const control = assessment.cases.filter((r: Json) => r.sourceGapGroup === 'baseline_complete_control').map((r: Json) => r.caseId).sort()[0];
  const selected = [...gaps, control]; assert.deepEqual(selected, [...REPORT_CALIBRATION_V1.selectedSourceCaseIds], 'Do not replace an eligible gap or choose controls using new candidate/answer success.');
  const cases = selected.map(id => {
    const item = deck.cases.find((c: Json) => c.id === id), reviewed = assessment.cases.find((c: Json) => c.caseId === id), base = baseline.results.find((c: Json) => c.caseId === id); assert.ok(item && reviewed && base);
    assert.equal(reviewed.sourceScopeReviewed, true); assert.equal(reviewed.originalQuestionsReviewed, true); assert.equal(reviewed.baselineContextSha256, base.baselineContextSha256);
    const completeSources: RetrievedPassage[] = item.sources.map((s: Json) => ({ id: s.id, productId: item.product.id, source: s.label, reference: s.label, text: s.text, sha256: textHash(s.text), ...(s.originalQuestion !== null ? { originalQuestion: s.originalQuestion } : {}), lexicalRank: null, semanticRank: null, score: 0 }));
    const existing = original.document.preparation.cases.find((c: Json) => c.id === id);
    if (existing) { assert.deepEqual(existing.completeSources, completeSources); assert.deepEqual(existing.designatedFacts, reviewed.designatedFacts); }
    else assert.equal(reviewed.baselineComplete, true, 'Only a source-reviewed complete control may use its original baseline as reference.');
    const product = { ...item.product, split: 'development' as const }, reference = existing ? existing.contexts.reference : base.baseline.passages;
    return { sourceCaseId: id, product, question: item.question, completeSources, reference, designatedFacts: reviewed.designatedFacts,
      priorUnknowns: existing?.referenceReview.unknowns as string[] | undefined, oldSourceReviewNotes: reviewed.notes,
      sourcePoolSha256: diagnosticHash(completeSources), referenceContextSha256: diagnosticHash(reference), designatedFactsSha256: diagnosticHash(reviewed.designatedFacts), questionScopeSha256: diagnosticHash({ product, question: item.question }) };
  });
  return { selectionRule: REPORT_CALIBRATION_V1.selectionRule, sourceEligibilityReviewFileSha256: historicalPins[`${old}/source-review-v1.json`], cases, policy: original.document.preparation.policy, deckCaseIds: deck.cases.map((c: Json) => c.id) as string[] };
}
export function verifyReportCalibrationSourceReview(requests: ReturnType<typeof reportCalibrationSourceReviewRequests>, review: ReportCalibrationSourceReview) {
  assert.equal(review.format, 'ablatrix-report-calibration-source-review-v1'); assert.equal(review.provenance, 'independent_ai_source_review'); assert.ok(review.reviewer.trim());
  assert.equal(review.candidateResultsInspected, false); assert.equal(review.generatedAnswersInspected, false); assert.equal(review.selectionRule, requests.selectionRule); assert.equal(review.sourceEligibilityReviewFileSha256, requests.sourceEligibilityReviewFileSha256);
  assert.deepEqual(review.cases.map(c => c.sourceCaseId), requests.cases.map(c => c.sourceCaseId)); assert.equal(review.paidExecutionAuthorized, false); assert.equal(review.qualityClaimEligible, false);
  for (const request of requests.cases) {
    const item = review.cases.find(c => c.sourceCaseId === request.sourceCaseId)!;
    for (const key of ['sourcePoolSha256', 'referenceContextSha256', 'designatedFactsSha256', 'questionScopeSha256'] as const) assert.equal(item[key], request[key]);
    for (const key of ['sourceScopeReviewed', 'originalQuestionsReviewed', 'referenceSufficient'] as const) assert.equal(item[key], true);
    assert.ok(item.sufficientFor.trim() && Array.isArray(item.unknowns) && item.unknowns.every(s => typeof s === 'string' && s.trim())); assert.equal(new Set(item.unknowns).size, item.unknowns.length);
    if (request.priorUnknowns) assert.deepEqual(item.unknowns, request.priorUnknowns, 'Preserve every previously source-reviewed gap qualification.');
  }
  return review;
}

export function reportCalibrationEvaluationMetadata(preparation: ReportCalibrationPreparation) {
  return { format: preparation.reportCalibration.format, scope: preparation.reportCalibration.scope, actualProducts: 2, freshProducts: 0, caseInstances: 8, repeats: 2, instructionVariants: 2, contextsPerInstance: 3, plannedAnswers: 24,
    evaluationMethod: preparation.reportCalibration.evaluationMethod, limitation: 'Two exposed products repeated under two instruction contracts; eight instances are not eight independent or fresh products. Six axes and explicit reviewer comparisons remain separate.', qualityClaimEligible: false, activationAllowed: false };
}
/** Pure constructor. Actual CLI inputs must pass complete source/result replay;
 * the separate qualifier must reconstruct them before permitting a paid plan. */
export function createReportCalibrationPreparation(root: string, sourceCases: DiagnosticCase[], policy: DiagnosticPreparation['policy'], ledger: DiagnosticPreparation['ledger'], bindings: Pick<DiagnosticPreparation, 'implementationSha256' | 'artifactSha256'>, pins: ReportCalibrationPins, caseIdentityKey: string, outputDirectory: string): ReportCalibrationPreparation {
  assert.match(caseIdentityKey, /^[a-f0-9]{64}$/); assert.equal(sourceCases.length, 2); assert.equal(new Set(sourceCases.map(c => c.product.id)).size, 2); assert.deepEqual(sourceCases.map(c => c.id), [...REPORT_CALIBRATION_V1.selectedSourceCaseIds]);
  assert.equal(ledger.canonicalPath, DIAGNOSTIC_LEDGER); assert.equal(ledger.attempts, 141); assert.ok(Math.abs(ledger.reservedUsd - 14.1) < 1e-7); assert.equal(ledger.priorSpendUsd, .200281); assert.equal(ledger.pending, 0); assert.equal(ledger.owners, 0);
  const instances: ReportCalibrationPreparation['reportCalibration']['caseInstancesPrivate'] = [], cases: DiagnosticCase[] = [];
  for (let repeat = 0; repeat < 2; repeat++) for (const [index, source] of sourceCases.entries()) {
    const contracts = (repeat + index) % 2 ? [...REPORT_CALIBRATION_V1.instructionContracts].reverse() : [...REPORT_CALIBRATION_V1.instructionContracts];
    for (const generationContract of contracts) {
      const id = `rci-${createHmac('sha256', Buffer.from(caseIdentityKey, 'hex')).update(JSON.stringify([REPORT_CALIBRATION_V1.format, source.id, generationContract, repeat])).digest('hex').slice(0, 24)}`;
      cases.push({ ...structuredClone(source), id, generationContract }); instances.push({ caseId: id, sourceCaseId: source.id, productId: source.product.id, generationContract, repeat });
    }
  }
  const result: ReportCalibrationPreparation = { repositoryPath: root, outputDirectory, diagnostic: { cases, policy: structuredClone(policy), ...structuredClone(bindings), ledger: structuredClone(ledger), codeReviewPassed: false },
    reportCalibration: { format: REPORT_CALIBRATION_V1.format, scope: 'exposed_development_only', actualProducts: 2, freshProducts: 0, caseInstances: 8, repeats: 2, plannedAnswers: 24,
      selectionRule: REPORT_CALIBRATION_V1.selectionRule, selectedSourceCaseIds: sourceCases.map(c => c.id), instructionContracts: REPORT_CALIBRATION_V1.instructionContracts, privateCaseIdentityKey: caseIdentityKey, caseInstancesPrivate: instances,
      executionOrder: 'Repeat, old source-only case order, alternating instruction-contract order; existing adapter rotates the three context orders by instance.',
      evaluationMethod: 'Source-aware blind review of six separate axes for all retained outcomes, explicit within-instance context comparisons, and separate predeclared across-instruction pairs at fixed source case/repeat/context. No composite quality score or automatic promotion.',
      sourceReviewPath: pins.sourceReviewPath, v6ReviewedResultPath: pins.v6ReviewedResultPath, sourceReviewSha256: pins.expectedSourceReviewSha256, v6ReviewedResultSha256: pins.expectedV6ReviewedResultSha256, paidExecutionAuthorized: false, qualityClaimEligible: false, activationAllowed: false } };
  const prepared = prepareThreeContext(result.diagnostic); assert.equal(prepared.document.slots.length, 24); assert.equal(prepared.document.paidPlan, null);
  return result;
}

export async function buildReportCalibrationPreparation(root: string, output: string, pins: ReportCalibrationPins, ledger: DiagnosticPreparation['ledger'], caseIdentityKey: string) {
  assert.equal(realpathSync(root), root); const target = resolve(root, output); privateOutput(root, target);
  assert.deepEqual(JSON.parse(bytes(root, REPORT_CALIBRATION_V1.protocolPath)), reportCalibrationDevelopmentProtocol(), 'Development design must match its frozen safe protocol.');
  const requests = reportCalibrationSourceReviewRequests(root), sourceReview = verifyReportCalibrationSourceReview(requests, JSON.parse(bytes(root, pins.sourceReviewPath, pins.expectedSourceReviewSha256)));
  const reviewed = JSON.parse(bytes(root, pins.v6ReviewedResultPath, pins.expectedV6ReviewedResultSha256));
  assert.equal(reviewed.format, 'ablatrix-report-uncertainty-v6-reviewed-result-v1'); assert.equal(reviewed.resultPath, REPORT_CALIBRATION_V1.v6ResultPath); assert.equal(reviewed.provenance, 'independent_agent_source_and_replay_review'); assert.ok(reviewed.reviewer.trim()); assert.match(reviewed.reviewedCommit, /^[a-f0-9]{40}$/);
  assert.equal(reviewed.outcome, 'reviewed_for_development_preparation'); assert.deepEqual(Object.keys(reviewed.checks).sort(), ['all12CasesRetained', 'allBaselinePrefixesRetained', 'allSelectionsReplayed', 'sourceScopesPreserved'].sort()); assert.ok(Object.values(reviewed.checks).every(v => v === true)); assert.equal(reviewed.paidExecutionAuthorized, false); assert.equal(reviewed.qualityClaimEligible, false);
  const snapshot = JSON.parse(bytes(root, REPORT_CALIBRATION_V1.v6ResultPath, reviewed.resultFileSha256)); assert.equal(snapshot.format, 'ablatrix-report-uncertainty-v6-development-v1'); assert.equal(snapshot.candidate.contract, 'workspace-semantic-supplement-v6-quantified-peer-dev');
  assert.equal(snapshot.freeze.path, REPORT_CALIBRATION_V1.v6FreezePath); assert.equal(snapshot.freeze.fileSha256, reviewed.freezeFileSha256);
  const freeze = JSON.parse(bytes(root, REPORT_CALIBRATION_V1.v6FreezePath, reviewed.freezeFileSha256));
  const frozenBindings: [string, string][] = []; for (const map of [freeze.implementationSha256, freeze.inputSha256]) { assert.ok(map && Object.keys(map).length); for (const [path, hash] of Object.entries(map)) { canonical(root, path); assert.equal(typeof hash, 'string'); frozenBindings.push([path, hash as string]); } }
  for (const [path, hash] of frozenBindings) bytes(root, path, hash);
  const { verifyReportUncertaintyDevelopment, reportDevelopmentImplementation } = await import('../server/report-uncertainty-development.ts');
  await verifyReportUncertaintyDevelopment(snapshot, REPORT_CALIBRATION_V1.v6FreezePath, root);
  const v5 = verifyReviewedV5DevelopmentResult(REVIEWED_V5_RESULT.path, root).result;
  assert.deepEqual(snapshot.results.map((r: Json) => r.caseId), requests.deckCaseIds, 'Replay and retain all twelve development rows before selecting the source-only pair.'); assert.deepEqual(v5.results.map((r: Json) => r.caseId), requests.deckCaseIds);
  const cases: DiagnosticCase[] = requests.cases.map(request => {
    const a = sourceReview.cases.find(c => c.sourceCaseId === request.sourceCaseId)!, previous = v5.results.find((r: Json) => r.caseId === request.sourceCaseId), next = snapshot.results.find((r: Json) => r.caseId === request.sourceCaseId); assert.ok(previous && next);
    return { id: request.sourceCaseId, product: request.product, question: request.question, completeSources: request.completeSources,
      contexts: { current: previous.candidate.passages, semantic: next.candidate.passages, reference: request.reference }, designatedFacts: request.designatedFacts,
      referenceReview: { provenance: 'source_checked_ai', reviewer: sourceReview.reviewer, sufficientFor: a.sufficientFor, unknowns: a.unknowns, sourcePoolSha256: request.sourcePoolSha256 } };
  });
  const codePaths = Object.keys(reportDevelopmentImplementation(root, [...requiredThreeContextLiveFiles(root), 'scripts/prepare-report-calibration-v1.ts', 'scripts/report-calibration-mock.ts', 'server/report-uncertainty-development.ts', 'server/report-calibration-qualification.ts', 'scripts/qualify-report-calibration-v1.ts', 'server/three-context-evaluation.ts', 'scripts/three-context-evaluation.ts', ...Object.keys(freeze.implementationSha256)]));
  const artifactPaths = [...new Set([...Object.keys(historicalPins), REVIEWED_V5_RESULT.path, REVIEWED_V5_RESULT.reviewPath, pins.v6ReviewedResultPath, pins.sourceReviewPath, REPORT_CALIBRATION_V1.protocolPath, REPORT_CALIBRATION_V1.v6ResultPath, REPORT_CALIBRATION_V1.v6FreezePath, ...Object.keys(freeze.inputSha256)])].sort();
  const digest = (path: string) => textHash(bytes(root, path));
  return createReportCalibrationPreparation(root, cases, requests.policy, ledger, { implementationSha256: Object.fromEntries(codePaths.map(path => [path, digest(path)])), artifactSha256: Object.fromEntries(artifactPaths.map(path => [path, digest(path)])) }, pins, caseIdentityKey, resolve(root, '.data', `report-calibration-${caseIdentityKey.slice(0, 16)}-execution`));
}
export async function prepareReportCalibrationCli(argv: string[]) {
  if (!argv.length) return { usage: '--v6-review FILE --v6-review-sha256 HASH --source-review FILE --source-review-sha256 HASH --out NEW_PRIVATE_JSON', newProviderCalls: 0 };
  const allowed = ['--v6-review', '--v6-review-sha256', '--source-review', '--source-review-sha256', '--out'], flags = new Map<string, string>(); assert.equal(argv.length, 10);
  for (let i = 0; i < argv.length; i += 2) { assert.ok(allowed.includes(argv[i]!) && argv[i + 1] && !flags.has(argv[i]!)); flags.set(argv[i]!, argv[i + 1]!); }
  const value = (key: string) => { const v = flags.get(key); assert.ok(v); return v; }, output = resolve(repository, value('--out')); privateOutput(repository, output);
  const pins = { v6ReviewedResultPath: value('--v6-review'), expectedV6ReviewedResultSha256: value('--v6-review-sha256'), sourceReviewPath: value('--source-review'), expectedSourceReviewSha256: value('--source-review-sha256') };
  const before = readLedgerAnchor(DIAGNOSTIC_LEDGER, .200281), { pathSha256: _path, ...ledger } = before;
  const preparation = await buildReportCalibrationPreparation(repository, output, pins, ledger, randomBytes(32).toString('hex'));
  privateOutput(repository, output); writeFileSync(output, JSON.stringify(preparation, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); assert.deepEqual(readLedgerAnchor(DIAGNOSTIC_LEDGER, .200281), before);
  return { output, ...reportCalibrationEvaluationMetadata(preparation), codeReviewPassed: false, stopReason: prepareThreeContext(preparation.diagnostic).document.stopReason, paidPlan: null, paidExecutionAuthorized: false, newProviderCalls: 0 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(await prepareReportCalibrationCli(process.argv.slice(2)), null, 2));
