import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SapiomFeedbackProvider } from './feedback-provider.ts';
import { workspaceReviewSourceHash } from './answer-review-source.ts';
import { contextComparisonHash } from './context-comparison.ts';
import { metadataFingerprints } from './flat-source-comparison.ts';
import { workspaceGenerationPromptIdentity, WORKSPACE_GENERATION_CONTRACT, WORKSPACE_SOURCE_CALIBRATION_CONTRACT } from './workspace-generation.ts';
import { workspaceCompleteSourceContext } from './workspace-retrieval-context.ts';
import { workspaceSourceCoverageContext, WORKSPACE_SOURCE_COVERAGE_CONTRACT } from './workspace-source-coverage.ts';
import { SOURCE_CALIBRATION_CODE_FILES, RETRIEVAL_COVERAGE_CODE_FILES, RETRIEVAL_COVERAGE_RETRIEVAL_FILES, RETRIEVAL_COVERAGE_EXPERIMENT, retrievalCoverageCorpus, retrievalCoverageComparisonCli, sourceCalibrationHash as hash, prepareSourceCalibrationComparison, verifySourceCalibrationPlan, verifySourceCalibrationResult, verifySourceCalibrationCheckpoints, executeSourceCalibrationComparison, sourceCalibrationReviewWorksheet, privateSourceCalibrationOutput, readLedgerAnchor, sourceCalibrationComparisonCli, type SourceCalibrationArtifact, type SourceCalibrationPreparation, type SourceCalibrationDependencies, type SourceCalibrationCheckpoint } from './source-calibration-comparison.ts';

const clone = <T>(value: T): T => structuredClone(value);
function artifact(path: string, document: Record<string, any>): SourceCalibrationArtifact { return { path: `docs/${path}.json`, document, fileSha256: hash(JSON.stringify(document)) }; }
function preparation(): SourceCalibrationPreparation {
  const implementationSha256 = Object.fromEntries(SOURCE_CALIBRATION_CODE_FILES.map(path => [path, hash(`SYNTHETIC implementation ${path}`)]));
  const seed = 'ablatrix-source-calibration-2026-10-18-v1';
  const candidateFreeze = artifact('freeze', { selectionSeed: seed, frozen: true, status: 'experimental_not_promoted', ...workspaceGenerationPromptIdentity(WORKSPACE_SOURCE_CALIBRATION_CONTRACT), qualityClaimEligible: false });
  const cases = Array.from({ length: 8 }, (_, i) => {
    const sources = [{ id: `source-${i}`, label: 'SYNTHETIC listing', text: `SYNTHETIC Product ${i} supports model ${i}.`, originalQuestion: null, reference: `synthetic:source-${i}` }, { id: `other-${i}`, label: 'SYNTHETIC customer', text: 'SYNTHETIC customer report about a different variant.', originalQuestion: 'SYNTHETIC other model?', reference: `synthetic:other-${i}` }].map(source => ({ ...source, sha256: workspaceReviewSourceHash(source) }));
    return { id: `synthetic-case-${i}`, upstream: { qid: String(i) }, stratum: ['capacity_dimensions', 'capacity_dimensions', 'appearance_material', 'appearance_material', 'model_scope', 'model_scope', 'missing_information', 'preservation_control'][i], selectionRankSha256: hash(`SYNTHETIC rank ${i}`), product: { id: `SYNTHETIC-${i}`, title: `SYNTHETIC Product ${i}` }, question: `SYNTHETIC Does model ${i} fit?`, sources, sourcePoolSha256: contextComparisonHash(sources) };
  });
  const results = cases.map(c => ({ caseId: c.id, retrieval: { passages: c.sources.slice(0, 1).map(s => ({ id: s.id, productId: c.product.id, source: s.label, text: s.text, sha256: hash(s.text), reference: s.label, lexicalRank: 1, semanticRank: 1, score: 1 })), durationMs: 0, method: 'SYNTHETIC', embeddingModel: 'SYNTHETIC', corpusVersion: 'SYNTHETIC' } }));
  const metadata = { workspaces: [], comparisons: [] }, fingerprints = metadataFingerprints(metadata), exposure = { metadata, metadataSha256: fingerprints.sha256, metadataInventorySha256: fingerprints.inventories, metadataOnly: true, generatedAnswersOrJudgmentsRead: false, newProviderCalls: 0, paidExecutionAuthorized: false };
  const exposureAudit = artifact('exposure', { ...exposure, auditSha256: contextComparisonHash(exposure) });
  const inventory = { passed: true }, selectionCodeSha256 = 'bf4e3686de1742eb0e0616f9b3e25875c3db60dfca476a36e74e4b3d8b66dba0', immutableHelperSha256 = Object.fromEntries(['scripts/prepare-flat-source-cohort.py', 'scripts/prepare-correction-cohort.py', 'scripts/prepare-source-id-cohort.py'].map(path => [path, implementationSha256[path]])), eligibilityAmendment = { candidateInstructionsUnchanged: true, generationOutputsInspected: false }, priorCohorts: any[] = [], priorSourceReviews: any[] = [], inventoryInputs = { workspaceCount: 0, comparisonCount: 0, canonicalPathSha256: [] };
  const selectionBody = { format: 'ablatrix-source-calibration-selection-audit-v1', selectionSeed: seed, candidateFreezeFileSha256: candidateFreeze.fileSha256, exposureAuditSha256: exposureAudit.document.auditSha256, inventory, selectionCodeSha256, immutableHelperSha256, eligibilityAmendment, priorCohorts, priorSourceReviews, inventoryInputs, generatedAnswersOrJudgmentsRead: false, generationPerformed: false, newProviderCalls: 0, decisions: cases.map(c => ({ stage: 'ranked_selection', selected: true, eligible: true, qid: c.upstream.qid, productId: c.product.id, stratum: c.stratum, rankSha256: c.selectionRankSha256 })) };
  const selectionAudit = artifact('selection', { ...selectionBody, selectionAuditSha256: contextComparisonHash(selectionBody) });
  const packetBody = { format: 'ablatrix-source-calibration-cohort-v1', selectionSeed: seed, candidateFreeze: { fileSha256: candidateFreeze.fileSha256, document: candidateFreeze.document }, source: { commit: 'cec976cc2f2218aa76e562ecc9c7d79f1f3271bc', sha256: 'b63de9681b770573240367e919f7f04f087f6a4745ab1f79a77e6b800105ea25', testSplitUsed: false }, selection: { selectionCodeSha256, immutableHelperSha256, eligibilityAmendment, priorCohorts, priorSourceReviews, inventoryInputs, labelOrAnswerColumnsUsed: false, modelOutputsUsed: false }, inventory, exposureAuditSha256: exposureAudit.document.auditSha256, selectionAuditSha256: selectionAudit.document.selectionAuditSha256, status: { privateCandidateOnly: true, generationPerformed: false, humanJudgments: 0, qualityClaimEligible: false, paidExecutionAuthorized: false }, executionPlan: { caseCount: 8, maximumNewAnswerAttempts: 16, automaticRetries: 0, webCalls: 0, caseReplacement: false, paidExecutionAuthorized: false }, cases };
  const packet = artifact('packet', { ...packetBody, cohortSha256: contextComparisonHash(packetBody) });
  const retrievalBody = { format: 'source-calibration-retrieval-v1', cohortFileSha256: packet.fileSha256, implementationSha256, results };
  const retrieval = artifact('retrieval', { ...retrievalBody, sha256: hash(retrievalBody) });
  const familyAudit = artifact('audit', { format: 'source-calibration-source-family-review-v1', status: 'passed', provenance: 'independent_ai_source_and_family_review', cohortFileSha256: packet.fileSha256, retrievalFileSha256: retrieval.fileSha256, exposureAuditFileSha256: exposureAudit.fileSha256, cases: cases.map(c => ({ caseId: c.id, sourceScopeReviewed: true, familySeparationReviewed: true, notes: 'SYNTHETIC mechanical fixture only.' })) });
  const path = '/synthetic/.data/feedback-budget.sqlite';
  return { packet, candidateFreeze, retrieval, familyAudit, exposureAudit, selectionAudit, implementationSha256, historySha256: { 'docs/exposed.md': hash('SYNTHETIC history') }, createdAt: '2026-10-18T12:00:00.000Z', policy: { id: 'synthetic-policy', parentId: null, instructions: 'SYNTHETIC shared answer policy with source attribution and bounded scope.', rationale: 'SYNTHETIC fixture.', feedbackRunIds: [], status: 'baseline', mode: 'live', createdAt: '2026-10-18T00:00:00.000Z' }, ledgerAnchor: { canonicalPath: path, pathSha256: hash(path), historicalRowsSha256: hash('SYNTHETIC historical rows'), attempts: 122, reservedUsd: 12.2, priorSpendUsd: .200281, pending: 0, owners: 0 }, scope: { repositoryPath: '/synthetic', outputDirectory: '/synthetic/.data/fresh-result', workspacePaths: [], comparisonPaths: [] }, exposure: { metadataSha256: fingerprints.sha256, publicExposureSha256: hash('SYNTHETIC public exposure') } };
}
function retrievalPreparation(unchangedLast = false): SourceCalibrationPreparation {
  const p = preparation(), seed = 'ablatrix-retrieval-coverage-2026-10-18-v1';
  p.experiment = RETRIEVAL_COVERAGE_EXPERIMENT; p.ledgerAnchor.attempts = 138; p.ledgerAnchor.reservedUsd = 13.8;
  p.implementationSha256 = Object.fromEntries(RETRIEVAL_COVERAGE_CODE_FILES.map(path => [path, hash(`SYNTHETIC implementation ${path}`)]));
  p.candidateFreeze = artifact('retrieval-freeze', { format: 'ablatrix-retrieval-coverage-candidate-freeze-v1', frozen: true, status: 'experimental_not_promoted', retrievalContract: WORKSPACE_SOURCE_COVERAGE_CONTRACT, generationContract: WORKSPACE_GENERATION_CONTRACT, systemInstructionsSha256: workspaceGenerationPromptIdentity().systemInstructionsSha256, selectionSeed: seed, implementationSha256: clone(p.implementationSha256), qualityClaimEligible: false });
  const consumed = [{ fileSha256: hash('SYNTHETIC consumed cohort'), cohortSha256: hash('SYNTHETIC consumed seal'), sourceReviewFileSha256: hash('SYNTHETIC passed source review'), executionFileSha256: hash('SYNTHETIC execution metadata'), generationPerformed: true, planSha256: hash('SYNTHETIC consumed plan'), newProviderAttempts: 16, attemptScopeSha256: hash('SYNTHETIC consumed slots'), protectionScope: 'entire_cohort_after_any_recorded_provider_attempt', executionMetadataProvenance: 'allowlisted_existing_execution_metadata',
    productIds: Array.from({ length: 8 }, (_, i) => `SYNTHETIC-CONSUMED-${i}`), canonicalFamilyTitles: ['SYNTHETIC prior family'], modelIdentifiers: ['PRIOR123'], sourcePacketFingerprints: [hash('SYNTHETIC prior source')] }];
  const immutableHelperSha256 = Object.fromEntries(['scripts/prepare-source-calibration-cohort.py', 'scripts/prepare-flat-source-cohort.py', 'scripts/prepare-correction-cohort.py', 'scripts/prepare-source-id-cohort.py'].map(path => [path, p.implementationSha256[path]]));
  const priorCohorts = [1, 2].map(i => ({ fileSha256: hash(`SYNTHETIC rejected draft ${i}`) })), priorSourceReviews = priorCohorts.map(c => ({ cohortFileSha256: c.fileSha256, status: 'failed', provenance: 'independent_ai_source_and_family_review' }));
  const eligibilityAmendment = { rules: 'unchanged_source_calibration_revision_3', generationInstructionsChanged: false, modelOutputsUsed: false, rejectedDraftsRemainProtected: true, consumedCohortsRemainProtected: true };
  p.scope.workspacePaths = ['/synthetic/workspace-current.sqlite', '/synthetic/workspace-canonical.sqlite']; p.scope.comparisonPaths = ['/synthetic/comparison.sqlite'];
  const inventoryInputs = { workspaceCount: 2, comparisonCount: 1, canonicalPathSha256: [...p.scope.workspacePaths, ...p.scope.comparisonPaths].map(hash).sort() };
  const metadata = { workspaces: [1, 2].map(i => ({ inventory: `workspace-${i}`, products: [], runs: [] })), comparisons: [{ inventory: 'comparison-1', cases: [], reservedProducts: [] }] }, fingerprints = metadataFingerprints(metadata);
  const exposure = { metadata, metadataSha256: fingerprints.sha256, metadataInventorySha256: fingerprints.inventories, metadataOnly: true, generatedAnswersOrJudgmentsRead: false, newProviderCalls: 0, paidExecutionAuthorized: false };
  p.exposureAudit = artifact('exposure', { ...exposure, auditSha256: contextComparisonHash(exposure) }); p.exposure.metadataSha256 = fingerprints.sha256;
  Object.assign(p.selectionAudit.document, { format: 'ablatrix-retrieval-coverage-selection-audit-v1', selectionSeed: seed, candidateFreezeFileSha256: p.candidateFreeze.fileSha256, exposureAuditSha256: p.exposureAudit.document.auditSha256, selectionCodeSha256: p.implementationSha256['scripts/prepare-retrieval-coverage-cohort.py'], immutableHelperSha256, consumedCohorts: consumed, priorCohorts, priorSourceReviews, eligibilityAmendment, inventoryInputs, modelOutputsUsed: false });
  Object.assign(p.packet.document, { format: 'ablatrix-retrieval-coverage-cohort-v1', selectionSeed: seed, candidateFreeze: { fileSha256: p.candidateFreeze.fileSha256, document: p.candidateFreeze.document } });
  Object.assign(p.packet.document.selection, { selectionCodeSha256: p.selectionAudit.document.selectionCodeSha256, immutableHelperSha256, consumedCohorts: consumed, priorCohorts, priorSourceReviews, eligibilityAmendment, inventoryInputs });
  p.packet.document.exposureAuditSha256 = p.exposureAudit.document.auditSha256; p.familyAudit.document.exposureAuditFileSha256 = p.exposureAudit.fileSha256;
  Object.assign(p.packet.document.executionPlan, { generationContract: WORKSPACE_GENERATION_CONTRACT, retrievalCandidateContract: WORKSPACE_SOURCE_COVERAGE_CONTRACT });
  for (const [i, c] of p.packet.document.cases.entries()) {
    c.question = unchangedLast && i === 7 ? 'SYNTHETIC What do customers say?' : `SYNTHETIC What are the dimensions for model AB123${i}?`;
    c.sources.push(...[
      { id: `dimensions-${i}`, label: 'attribute', text: 'Product Dimensions: 12.3 x 4.5 x 6 inches', originalQuestion: null, reference: `synthetic:dimensions-${i}` },
      { id: `model-${i}`, label: 'attribute', text: `Item Model Number: AB123${i}`, originalQuestion: null, reference: `synthetic:model-${i}` }
    ].map(source => ({ ...source, sha256: workspaceReviewSourceHash(source) })));
    c.sourcePoolSha256 = contextComparisonHash(c.sources);
  }
  resealPreparation(p);
  const corpus = retrievalCoverageCorpus(p.packet);
  const results = p.packet.document.cases.map((c: any) => {
    const source = corpus.passages.find(s => s.id === c.sources[0].id)!;
    const indexRetrieval = { passages: [{ ...source, lexicalRank: 1, semanticRank: 1, score: 1 }], durationMs: 0, method: 'SYNTHETIC baseline ranking', embeddingModel: 'SYNTHETIC', corpusVersion: corpus.version };
    const product = { ...c.product, sources: c.sources.map((s: any) => ({ ...s, originalQuestion: s.originalQuestion ?? undefined })) };
    const baseline = workspaceCompleteSourceContext(product, corpus, indexRetrieval), candidate = workspaceSourceCoverageContext(product, corpus, indexRetrieval, c.question);
    return { caseId: c.id, indexRetrieval, baseline: { ...indexRetrieval, passages: baseline }, candidate: { ...indexRetrieval, passages: candidate.passages }, additions: candidate.additions, contract: candidate.contract };
  });
  const body = { format: 'retrieval-coverage-retrieval-v1', cohortFileSha256: p.packet.fileSha256, implementationSha256: Object.fromEntries(RETRIEVAL_COVERAGE_RETRIEVAL_FILES.map(path => [path, p.implementationSha256[path]])), corpusSha256: hash(corpus), results, providerCalls: 0, semanticAssessment: 'not_run', generationPerformed: false };
  p.retrieval = artifact('paired-retrieval', { ...body, sha256: hash(body) });
  p.familyAudit.document.retrievalFileSha256 = p.retrieval.fileSha256; p.familyAudit.fileSha256 = hash(JSON.stringify(p.familyAudit.document));
  return p;
}
function harness(options: { response?: (body: any, index: number) => any; transportFailure?: boolean; changeBody?: boolean; duplicateTransport?: boolean; preparation?: SourceCalibrationPreparation } = {}) {
  const prep = options.preparation ?? preparation(), manifest = prepareSourceCalibrationComparison(prep), checkpoints: SourceCalibrationCheckpoint[] = [], bodies: any[] = [];
  let provider: SapiomFeedbackProvider | undefined, creations = 0, outputs = 0, finished = 0, changed = false, closed = false;
  const dependencies: SourceCalibrationDependencies = {
    checkFrozenFiles() { assert.equal(changed, false, 'SYNTHETIC code/history/exposure changed.'); },
    readLedger() {
      const rows = manifest.plan.slots.flatMap(slot => { const receipt = provider?.receipt(slot.input.runId); return receipt ? [{ ...receipt, run_id: slot.input.runId, created_at: 'SYNTHETIC' }] : []; });
      return { ...prep.ledgerAnchor, attempts: prep.ledgerAnchor.attempts + rows.length, reservedUsd: prep.ledgerAnchor.reservedUsd + rows.length * .1, pending: rows.filter(r => r.status === 'pending').length, owners: rows.length ? 1 : 0, ownerRows: rows.length ? [{ pid: process.pid, token: 'SYNTHETIC-owner', expires_at: Date.now() + 60_000 }] : [], rows };
    },
    createProvider(hooks) {
      creations++; provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'SYNTHETIC-TEST-ONLY', dbPath: ':memory:', callLimit: manifest.plan.budget.absoluteCallLimit, capUsd: 20, priorSpendUsd: prep.ledgerAnchor.priorSpendUsd, allowancePerCallUsd: .1, operationGuard: hooks.operationGuard,
        fetchImpl: async (url, init) => { if (options.changeBody) return hooks.fetchImpl(url, { ...init, body: `${init?.body} ` }); const response = await hooks.fetchImpl(url, init); if (options.duplicateTransport) await hooks.fetchImpl(url, init); return response; } });
      const close = provider.close.bind(provider); provider.close = () => { closed = true; close(); }; return provider;
    },
    transport: async (_url, init) => { const body = JSON.parse(String(init?.body)), index = bodies.length; bodies.push(body); assert.equal(init?.redirect, 'error'); assert.ok(checkpoints.at(-1)?.steps[index].dispatchIntent); assert.equal(checkpoints.at(-1)?.steps[index].dispatched, false); if (options.transportFailure) throw new Error('SYNTHETIC ambiguous transport'); const payload = JSON.parse(body.messages[1].content); const output = options.response?.(body, index) ?? { answer: 'SYNTHETIC supported answer.', status: 'answered', citations: [payload.quoteOptions[0].id] }; return new Response(JSON.stringify({ model: 'gpt-luna', usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: body.tool_choice.function.name, arguments: JSON.stringify(output) } }] } }] })); },
    output: { create() { outputs++; }, checkpoint(value) { checkpoints.push(clone(value)); }, finish() { finished++; } }
  };
  return { manifest, dependencies, checkpoints, bodies, change() { changed = true; }, counts: () => ({ creations, outputs, finished, closed }), execute: () => executeSourceCalibrationComparison(manifest, { execute: true, liveOptIn: true, approvedPlanSha256: manifest.planSha256, transportProvenance: 'mocked_mechanics_only' }, dependencies) };
}

test('two first-answer arms freeze exact shared context, all source pools, alternating order and dynamic ledger ceiling', () => {
  const prep = preparation(), manifest = prepareSourceCalibrationComparison(prep); assert.equal(manifest.plan.cases.length, 8); assert.equal(manifest.plan.slots.length, 16); assert.equal(manifest.plan.budget.absoluteCallLimit, 138); assert.equal(manifest.plan.budget.capUsd, 20);
  assert.equal(manifest.planSha256, '26a6e90d446b4328328265c8f12347cfe927d3ab83e07e8b4ac4a54aeea90e50', 'The historical prompt-comparison preparation must retain exact bytes.');
  assert.deepEqual(manifest.plan.slots.slice(0, 4).map(s => s.arm), ['baseline', 'candidate', 'candidate', 'baseline']);
  for (let i = 0; i < 16; i += 2) { const [a, b] = manifest.plan.slots.slice(i, i + 2); assert.deepEqual(a.input.passages, b.input.passages); assert.equal(a.binding.responseSchemaSha256, b.binding.responseSchemaSha256); assert.equal(a.binding.sourceContextSha256, b.binding.sourceContextSha256); assert.notEqual(a.binding.requestSha256, b.binding.requestSha256); assert.equal(a.requestBody.model, b.requestBody.model); }
  prep.ledgerAnchor.attempts = 125; prep.ledgerAnchor.reservedUsd = 12.5; assert.equal(prepareSourceCalibrationComparison(prep).plan.budget.absoluteCallLimit, 141);
  prep.ledgerAnchor.canonicalPath = '/synthetic-other-checkout/.data/feedback-budget.sqlite'; prep.ledgerAnchor.pathSha256 = hash(prep.ledgerAnchor.canonicalPath); assert.equal(prepareSourceCalibrationComparison(prep).plan.preparation.ledgerAnchor.canonicalPath, prep.ledgerAnchor.canonicalPath); prep.ledgerAnchor.attempts = 0; assert.throws(() => prepareSourceCalibrationComparison(prep));
});

test('changed sources, original questions, retrieval order, audit, prompt or requests cannot retain a verified plan', () => {
  const mutations: ((p: SourceCalibrationPreparation) => void)[] = [p => { p.packet.document.cases[0].sources[0].text = 'Changed'; }, p => { p.packet.document.cases[0].sources[1].originalQuestion = 'Changed'; }, p => { p.retrieval.document.results.reverse(); }, p => { p.familyAudit.document.cases[0].sourceScopeReviewed = false; }, p => { p.candidateFreeze.document.systemInstructionsSha256 = '0'.repeat(64); }, p => { p.implementationSha256['server/product-retrieval.ts'] = '0'.repeat(64); }, p => { p.ledgerAnchor.owners = 1; }, p => { p.ledgerAnchor.pending = 1; }];
  for (const mutate of mutations) { const p = preparation(); mutate(p); assert.throws(() => prepareSourceCalibrationComparison(p)); }
  const m = prepareSourceCalibrationComparison(preparation()); m.plan.slots[0].requestBody.messages[1].content += ' '; m.planSha256 = hash(m.plan); assert.throws(() => verifySourceCalibrationPlan(m));
});

// Rebind every dependent seal so semantic regressions cannot pass merely by
// updating hashes after an outcome-informed selection or a changed cohort.
function resealPreparation(p: SourceCalibrationPreparation) {
  const seal = (a: SourceCalibrationArtifact, field: string, canonical = true) => { delete a.document[field]; a.document[field] = canonical ? contextComparisonHash(a.document) : hash(a.document); a.fileSha256 = hash(JSON.stringify(a.document)); };
  seal(p.selectionAudit, 'selectionAuditSha256');
  p.packet.document.selectionAuditSha256 = p.selectionAudit.document.selectionAuditSha256;
  seal(p.packet, 'cohortSha256');
  p.retrieval.document.cohortFileSha256 = p.packet.fileSha256; seal(p.retrieval, 'sha256', false);
  p.familyAudit.document.cohortFileSha256 = p.packet.fileSha256; p.familyAudit.document.retrievalFileSha256 = p.retrieval.fileSha256;
  p.familyAudit.fileSha256 = hash(JSON.stringify(p.familyAudit.document));
}

test('selection seals bind the pre-generation cohort and reject outcome-informed or detached selections even after resealing', () => {
  const missing = preparation(); delete missing.packet.document.cohortSha256; assert.throws(() => prepareSourceCalibrationComparison(missing));
  const changed = preparation(); changed.packet.document.cases[0].question = 'SYNTHETIC changed question'; assert.throws(() => prepareSourceCalibrationComparison(changed), /cohortSha256/);
  const mutations: ((p: SourceCalibrationPreparation) => void)[] = [
    p => { p.packet.document.selectionSeed = 'different-seed'; },
    p => { p.selectionAudit.document.format = 'different-audit'; },
    p => { p.packet.document.status.generationPerformed = true; },
    p => { p.packet.document.status.qualityClaimEligible = true; },
    p => { p.packet.document.selection.labelOrAnswerColumnsUsed = true; },
    p => { p.packet.document.selection.modelOutputsUsed = true; },
    p => { p.selectionAudit.document.generatedAnswersOrJudgmentsRead = true; },
    p => { p.selectionAudit.document.newProviderCalls = 1; },
    p => { p.packet.document.executionPlan.caseReplacement = true; },
    p => { p.selectionAudit.document.candidateFreezeFileSha256 = '0'.repeat(64); },
    p => { p.selectionAudit.document.decisions[0].productId = 'SYNTHETIC swapped'; },
    p => { p.selectionAudit.document.decisions.reverse(); },
    p => { p.selectionAudit.document.exposureAuditSha256 = '0'.repeat(64); },
    p => { p.selectionAudit.document.selectionCodeSha256 = p.packet.document.selection.selectionCodeSha256 = hash('SYNTHETIC different selector'); },
    p => { p.selectionAudit.document.immutableHelperSha256['scripts/prepare-flat-source-cohort.py'] = p.packet.document.selection.immutableHelperSha256['scripts/prepare-flat-source-cohort.py'] = hash('SYNTHETIC different helper'); },
    p => { p.packet.document.selection.priorSourceReviews = [{ cohortFileSha256: hash('SYNTHETIC detached prior') }]; },
    p => { p.selectionAudit.document.inventoryInputs = p.packet.document.selection.inventoryInputs = { workspaceCount: 1, comparisonCount: 0, canonicalPathSha256: [hash('/synthetic/extra.sqlite')] }; },
    p => { p.selectionAudit.document.priorCohorts = p.packet.document.selection.priorCohorts = [{ fileSha256: hash('SYNTHETIC prior 1') }, { fileSha256: hash('SYNTHETIC prior 2') }]; p.selectionAudit.document.priorSourceReviews = p.packet.document.selection.priorSourceReviews = Array.from({ length: 2 }, () => ({ cohortFileSha256: hash('SYNTHETIC prior 1'), status: 'failed', provenance: 'independent_ai_source_and_family_review' })); }
  ];
  for (const mutate of mutations) { const p = preparation(); mutate(p); resealPreparation(p); assert.throws(() => prepareSourceCalibrationComparison(p)); }
});

test('exact approval, opt-in and boundary checks precede output and credential-owning provider construction', async () => {
  for (const mutate of [(o: any) => { o.execute = false; }, (o: any) => { o.liveOptIn = false; }, (o: any) => { o.approvedPlanSha256 = '0'.repeat(64); }]) {
    const h = harness(), options = { execute: true, liveOptIn: true, approvedPlanSha256: h.manifest.planSha256, transportProvenance: 'mocked_mechanics_only' as const }; mutate(options); await assert.rejects(executeSourceCalibrationComparison(h.manifest, options, h.dependencies)); assert.deepEqual(h.counts(), { creations: 0, outputs: 0, finished: 0, closed: false });
  }
  const h = harness(); h.change(); await assert.rejects(h.execute()); assert.equal(h.counts().creations, 0);
});

test('sixteen injected provider responses replay receipts and create anonymous full-source worksheet without verdicts', async () => {
  const h = harness(), { result, checkpoint } = await h.execute(); assert.equal(result.status, 'awaiting_independent_review'); assert.equal(result.completedAnswers, 16); assert.equal(result.newProviderAttempts, 16); assert.equal(h.bodies.length, 16); assert.equal(result.humanJudgments, 0); assert.equal(result.qualityClaimEligible, false); assert.equal(h.counts().closed, true);
  assert.deepEqual(verifySourceCalibrationResult(h.manifest, checkpoint), result); assert.deepEqual(verifySourceCalibrationCheckpoints(h.manifest, h.checkpoints), result); assert.equal(result.planningAllowanceReservedUsd, 1.6); assert.deepEqual(result.usage, { inputTokens: 160, outputTokens: 80 }); assert.ok(result.steps.every(s => s.finishedAt && s.elapsedMs !== null));
  const review = sourceCalibrationReviewWorksheet(h.manifest, checkpoint); assert.ok(review.worksheet.includes('SYNTHETIC customer report about a different variant.')); assert.ok(review.worksheet.includes('Original customer question:')); assert.equal(review.armMapping.mapping.length, 16); assert.ok(!review.worksheet.includes('workspace-answer-source-calibration') && !review.worksheet.includes('gpt-luna')); assert.ok(review.worksheet.includes('support ___'));
});

test('first invalid, ambiguous, changed or duplicate request stops without redispatch and keeps all planned arms', async () => {
  for (const options of [{ transportFailure: true }, { changeBody: true }, { duplicateTransport: true }, { response: () => ({ answer: 'SYNTHETIC invalid citation.', status: 'answered', citations: ['src_invalid'] }) }]) {
    const h = harness(options), { result } = await h.execute(); assert.equal(result.status, 'stopped'); assert.equal(result.plannedAnswers, 16); assert.equal(result.newProviderAttempts, 1); assert.equal(result.planningAllowanceReservedUsd, .1); assert.deepEqual(result.usage, options.response ? { inputTokens: 10, outputTokens: 5 } : null); assert.equal(result.steps[0].finishedAt, null); assert.equal(result.steps[0].elapsedMs, null); assert.ok(result.steps[0].attemptDurationMs !== null); assert.equal(result.completedAnswers, 0); assert.equal(result.steps.filter(s => s.status === 'not_attempted').length, 15); assert.equal(h.bodies.length, options.changeBody ? 0 : 1);
  }
});

test('history/code/exposure change after dispatch stops and preserves the single ambiguous reservation', async () => {
  const h = harness(), original = h.dependencies.transport; h.dependencies.transport = async (...args) => { const response = await original(...args); h.change(); return response; };
  const { result } = await h.execute(); assert.equal(result.status, 'stopped'); assert.equal(result.newProviderAttempts, 1); assert.equal(result.networkDispatches, 1); assert.equal(result.completedAnswers, 0); assert.equal(result.steps.length, 16);
});

test('a failed dispatch-intent checkpoint cannot count a transport entry', async () => {
  const h = harness(), persist = h.dependencies.output.checkpoint;
  let injected = false;
  h.dependencies.output.checkpoint = value => {
    if (!injected && value.steps[0].dispatchIntent && !value.steps[0].dispatched) { injected = true; throw new Error('SYNTHETIC failed intent persistence'); }
    persist(value);
  };
  const { result, checkpoint } = await h.execute();
  assert.equal(injected, true); assert.equal(h.bodies.length, 0); assert.equal(result.networkDispatches, 0);
  assert.equal(result.dispatchIntentsWithoutObservedEntry, 1); assert.equal(result.newProviderAttempts, 1);
  assert.equal(result.planningAllowanceReservedUsd, .1); assert.equal(result.completedAnswers, 0);
  assert.equal(result.steps.filter(step => step.status === 'not_attempted').length, 15);
  assert.deepEqual(verifySourceCalibrationResult(h.manifest, checkpoint), result);
  const erased = clone(checkpoint); delete erased.steps[0].dispatchIntent;
  assert.equal(verifySourceCalibrationResult(h.manifest, erased).dispatchIntentsWithoutObservedEntry, 0);
  assert.throws(() => verifySourceCalibrationCheckpoints(h.manifest, [...h.checkpoints, erased]));
});

test('a bound rejected output retains measured usage without becoming an accepted answer', async () => {
  const h = harness({ response: () => ({ answer: 'SYNTHETIC invalid source selection.', status: 'answered', citations: ['src_not_offered'] }) });
  const { result, checkpoint } = await h.execute();
  assert.equal(checkpoint.steps[0].receipt!.error_code, 'output_validation');
  assert.equal(result.completedAnswers, 0); assert.equal(result.steps[0].status, 'failed_or_unknown');
  assert.deepEqual(result.knownUsageSubtotal, { inputTokens: 10, outputTokens: 5 });
  assert.deepEqual(result.usage, result.knownUsageSubtotal); assert.equal(result.attemptsWithKnownUsage, 1);
  const unbound = clone(checkpoint), receipt = unbound.steps[0].receipt!, document = JSON.parse(receipt.receipt_json!);
  document.requestSha256 = '0'.repeat(64); receipt.receipt_json = JSON.stringify(document); unbound.steps[0].receiptSha256 = hash(receipt);
  const replay = verifySourceCalibrationResult(h.manifest, unbound);
  assert.equal(replay.completedAnswers, 0); assert.equal(replay.usage, null); assert.equal(replay.attemptsWithKnownUsage, 0);
});

test('historical ledger changes at reservation prevent transport; pending checkpoints keep unknown timing and usage', async () => {
  const h = harness(), read = h.dependencies.readLedger; h.dependencies.readLedger = () => { const state = read(); return state.rows.length ? { ...state, historicalRowsSha256: hash('SYNTHETIC altered history') } : state; };
  const { result } = await h.execute(); assert.equal(result.newProviderAttempts, 1); assert.equal(result.networkDispatches, 0); assert.equal(result.completedAnswers, 0); assert.equal(result.planningAllowanceReservedUsd, .1);
  const successful = harness(); await successful.execute(); const pending = successful.checkpoints.find(c => c.steps[0].attemptId && !c.steps[0].dispatched)!; const replay = verifySourceCalibrationResult(successful.manifest, pending); assert.equal(replay.newProviderAttempts, 1); assert.equal(replay.completedAnswers, 0); assert.equal(replay.usage, null); assert.equal(replay.steps[0].finishedAt, null); assert.equal(replay.steps[0].elapsedMs, null); assert.equal(replay.steps[0].attemptDurationMs, null); assert.equal(replay.steps.filter(s => s.status === 'not_attempted').length, 15);
});

test('receipt hash tampering fails; request binding tampering stays unknown and cannot create a success', async () => {
  const h = harness({ transportFailure: true }), failed = await h.execute(); const tampered = clone(failed.checkpoint); tampered.steps[0].receipt!.model = 'invented'; assert.throws(() => verifySourceCalibrationResult(h.manifest, tampered));
  const good = harness(), saved = await good.execute(), altered = clone(saved.checkpoint); const receipt = altered.steps[15].receipt!, parsed = JSON.parse(receipt.receipt_json!); parsed.sourceContextSha256 = '0'.repeat(64); receipt.receipt_json = JSON.stringify(parsed); altered.steps[15].receiptSha256 = hash(receipt); const verification = verifySourceCalibrationResult(good.manifest, altered); assert.equal(verification.completedAnswers, 15); assert.equal(verification.steps[15].status, 'failed_or_unknown');
});

test('private output is exclusive and symlink-free, and ledger anchor reads historical rows in stable rowid order', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'source-calibration-'))); try {
    mkdirSync(join(root, '.data')); const directory = join(root, '.data', 'result'), output = privateSourceCalibrationOutput(directory, root); output.create(); assert.equal(statSync(directory).mode & 0o777, 0o700); assert.equal(statSync(join(directory, 'checkpoint.jsonl')).mode & 0o777, 0o600); assert.throws(() => privateSourceCalibrationOutput(directory, root).create());
    symlinkSync(root, join(root, '.data', 'escape')); assert.throws(() => privateSourceCalibrationOutput(join(root, '.data', 'escape', 'out'), root).create());
    const path = join(root, '.data', 'feedback-budget.sqlite'), db = new DatabaseSync(path); db.exec('CREATE TABLE loop_provider_calls(id TEXT,run_id TEXT,allowance_usd REAL,status TEXT,receipt_json TEXT); CREATE TABLE loop_provider_owner(id INTEGER,pid INTEGER,token TEXT,expires_at INTEGER)'); db.prepare('INSERT INTO loop_provider_calls VALUES(?,?,?,?,?)').run('b', 'historical', .1, 'completed', 'SYNTHETIC saved receipt'); const initial = readLedgerAnchor(path, .200281); assert.equal(initial.attempts, 1); assert.equal(initial.pending, 0); assert.equal(initial.owners, 0); assert.ok(!JSON.stringify(initial).includes('SYNTHETIC saved receipt')); assert.deepEqual(readLedgerAnchor(path, .200281), initial); db.prepare('UPDATE loop_provider_calls SET receipt_json=?').run('Changed'); assert.notEqual(readLedgerAnchor(path, .200281).historicalRowsSha256, initial.historicalRowsSha256); db.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CLI defaults offline and rejects approval before reading a credential or shared ledger', async () => {
  const help = await sourceCalibrationComparisonCli([]); assert.ok('mode' in help && help.mode === 'offline'); const root = mkdtempSync(join(tmpdir(), 'source-calibration-cli-')); try { const path = join(root, 'plan.json'); writeFileSync(path, JSON.stringify(prepareSourceCalibrationComparison(preparation()))); const env = new Proxy({ ABLATRIX_LOOP_LIVE: '1' }, { get(target, key) { if (String(key).includes('SAPIOM')) assert.fail('Credential access before approval'); return Reflect.get(target, key); } }); await assert.rejects(sourceCalibrationComparisonCli(['--execute', '--plan', path, '--approved-plan-sha256', '0'.repeat(64)], env)); assert.equal(readFileSync(path, 'utf8').includes('planSha256'), true); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('retrieval protocol freezes appended parent bodies while holding the shipped answer instructions and settings constant', () => {
  const manifest = prepareSourceCalibrationComparison(retrievalPreparation());
  assert.equal(manifest.plan.format, 'ablatrix-retrieval-coverage-first-answer-plan-v1'); assert.equal(manifest.plan.budget.absoluteCallLimit, 154);
  assert.equal(manifest.plan.retrievalContexts?.plannedChangedCases, 8); assert.equal(manifest.plan.retrievalContexts?.plannedUnchangedCases, 0);
  for (let index = 0; index < 16; index += 2) {
    const pair = manifest.plan.slots.slice(index, index + 2), baseline = pair.find(s => s.arm === 'baseline')!, candidate = pair.find(s => s.arm === 'candidate')!;
    assert.equal(baseline.binding.contract, WORKSPACE_GENERATION_CONTRACT); assert.equal(candidate.binding.contract, WORKSPACE_GENERATION_CONTRACT);
    assert.equal(baseline.binding.systemInstructionsSha256, candidate.binding.systemInstructionsSha256); assert.equal(baseline.requestBody.messages[0].content, workspaceGenerationPromptIdentity().systemInstructions);
    assert.deepEqual(candidate.input.passages.slice(0, baseline.input.passages.length), baseline.input.passages); assert.equal(candidate.input.passages.length, baseline.input.passages.length + 2);
    assert.notEqual(baseline.binding.sourceContextSha256, candidate.binding.sourceContextSha256); assert.notEqual(baseline.binding.optionSetSha256, candidate.binding.optionSetSha256); assert.notEqual(baseline.binding.responseSchemaSha256, candidate.binding.responseSchemaSha256);
    const normalized = (body: typeof baseline.requestBody) => { const copy = clone(body), payload = JSON.parse(copy.messages[1].content); delete payload.evidence; delete payload.quoteOptions; delete payload.operationRunId; copy.messages[1].content = JSON.stringify(payload); (copy.tools[0].function.parameters as any).properties.citations.items.enum = []; return copy; };
    assert.deepEqual(normalized(baseline.requestBody), normalized(candidate.requestBody));
  }
  assert.deepEqual(verifySourceCalibrationPlan(manifest), manifest);
});

test('retrieval preparation rejects edited selections, detached consumed exposure, prompt drift and stale starting counts even after hashes are rebound', () => {
  const mutations: ((p: SourceCalibrationPreparation) => void)[] = [
    p => { p.experiment = 'unrecognized' as any; },
    p => { p.ledgerAnchor.attempts = 137; }, p => { p.ledgerAnchor.attempts = 139; },
    p => { p.candidateFreeze.document.generationContract = WORKSPACE_SOURCE_CALIBRATION_CONTRACT; },
    p => { p.candidateFreeze.document.systemInstructionsSha256 = workspaceGenerationPromptIdentity(WORKSPACE_SOURCE_CALIBRATION_CONTRACT).systemInstructionsSha256; },
    p => { p.candidateFreeze.document.implementationSha256['server/workspace-source-coverage.ts'] = hash('SYNTHETIC changed rules'); },
    p => { p.selectionAudit.document.consumedCohorts = []; p.packet.document.selection.consumedCohorts = []; },
    p => { p.selectionAudit.document.consumedCohorts[0].productIds[0] = p.packet.document.cases[0].product.id; },
    p => { p.retrieval.document.results[0].baseline.passages = p.retrieval.document.results[0].candidate.passages; },
    p => { p.retrieval.document.results[0].candidate.passages.reverse(); },
    p => { p.retrieval.document.results[0].candidate.passages.pop(); },
    p => { p.retrieval.document.results[0].additions[0].reasons = ['SYNTHETIC unbound rationale']; },
    p => { p.retrieval.document.results[0].indexRetrieval.passages[0].productId = 'SYNTHETIC foreign product'; },
    p => { p.retrieval.document.corpusSha256 = hash('SYNTHETIC other corpus'); },
    p => { p.retrieval.document.implementationSha256['server/workspace-source-coverage.ts'] = hash('SYNTHETIC other code'); }
  ];
  for (const mutate of mutations) { const p = retrievalPreparation(); mutate(p); resealPreparation(p); assert.throws(() => prepareSourceCalibrationComparison(p)); }
  const manifest = prepareSourceCalibrationComparison(retrievalPreparation()); manifest.plan.slots[1].input.generationContract = WORKSPACE_SOURCE_CALIBRATION_CONTRACT; manifest.planSha256 = hash(manifest.plan); assert.throws(() => verifySourceCalibrationPlan(manifest));
});

test('retrieval comparison dispatches sixteen exact v1 requests and resolves citations from each arm own offered context', async () => {
  const h = harness({ preparation: retrievalPreparation(true), response: body => { const payload = JSON.parse(body.messages[1].content); return { answer: 'SYNTHETIC literal-source response.', status: 'answered', citations: [payload.quoteOptions.at(-1).id] }; } });
  const { result, checkpoint } = await h.execute();
  assert.equal(result.format, 'retrieval-coverage-result-v1'); assert.equal(result.completedAnswers, 16); assert.equal(result.newProviderAttempts, 16); assert.equal(result.networkDispatches, 16); assert.equal(result.qualityClaimEligible, false);
  assert.equal(result.retrievalContexts?.plannedChangedCases, 7); assert.equal(result.retrievalContexts?.completedChangedPairs, 7); assert.equal(result.retrievalContexts?.plannedUnchangedCases, 1); assert.equal(result.retrievalContexts?.completedUnchangedPairs, 1); assert.deepEqual(result.retrievalContexts?.unchangedCaseIds, ['synthetic-case-7']);
  assert.deepEqual(verifySourceCalibrationCheckpoints(h.manifest, h.checkpoints), result); assert.deepEqual(verifySourceCalibrationResult(h.manifest, checkpoint), result);
  for (const [index, body] of h.bodies.entries()) {
    const slot = h.manifest.plan.slots[index]; assert.deepEqual(body, slot.requestBody); assert.equal(slot.binding.contract, WORKSPACE_GENERATION_CONTRACT);
    const step = result.steps[index]; assert.equal(step.status, 'completed'); assert.ok(step.status === 'completed'); const output = step.output; assert.deepEqual(output.answer.citations, [{ passageId: slot.input.passages.at(-1)!.id, quote: slot.input.passages.at(-1)!.text }]);
  }
  const review = sourceCalibrationReviewWorksheet(h.manifest, checkpoint), worksheet = review.worksheet;
  for (const label of ['Generation-available', 'generationSourceIds', 'workspace-source-coverage-v1', 'candidate', 'baseline', 'additions']) assert.ok(!worksheet.includes(label), `Anonymous worksheet leaked ${label}.`);
  assert.deepEqual(worksheet.split('\n').filter(line => /^Source .* — /.test(line)), h.manifest.plan.cases.flatMap(c => c.sources.map(source => `Source ${source.id} — ${source.label}`)), 'Every complete review source is present, with no per-arm availability subset.');
  for (const c of h.manifest.plan.cases) for (const source of c.sources) assert.ok(worksheet.includes(`Source ${source.id} — ${source.label}\n\n`));
  for (const item of review.armMapping.mapping) {
    const c = h.manifest.plan.cases.find(c => c.id === item.caseId)!;
    assert.deepEqual(item.generationSourceIds, c.generationSourceIdsByArm![item.arm as 'baseline' | 'candidate'], 'Per-arm source availability stays in the separate mapping.');
  }
});

test('retrieval scope shares pre-provider approval, partial-stop, reservation and pre-dispatch history guards', async () => {
  const options = { execute: true, liveOptIn: true, approvedPlanSha256: 'wrong', transportProvenance: 'mocked_mechanics_only' as const }, unapproved = harness({ preparation: retrievalPreparation() });
  await assert.rejects(executeSourceCalibrationComparison(unapproved.manifest, options, unapproved.dependencies)); assert.equal(unapproved.counts().creations, 0); assert.equal(unapproved.counts().outputs, 0);
  const h = harness({ preparation: retrievalPreparation(), response: (body, index) => ({ answer: 'SYNTHETIC response.', status: 'answered', citations: index === 1 ? ['src_unoffered'] : [JSON.parse(body.messages[1].content).quoteOptions[0].id] }) });
  const { result } = await h.execute(); assert.equal(result.status, 'stopped'); assert.equal(result.completedAnswers, 1); assert.equal(result.newProviderAttempts, 2); assert.equal(result.networkDispatches, 2); assert.equal(result.steps.filter(s => s.status === 'not_attempted').length, 14); assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 10 });
  const changed = harness({ preparation: retrievalPreparation() }), read = changed.dependencies.readLedger;
  changed.dependencies.readLedger = () => { const state = read(); return state.rows.length ? { ...state, historicalRowsSha256: hash('SYNTHETIC altered history') } : state; };
  const stopped = await changed.execute(); assert.equal(stopped.result.newProviderAttempts, 1); assert.equal(stopped.result.networkDispatches, 0); assert.equal(changed.bodies.length, 0);
});

test('retrieval CLI cannot accept a historical prompt comparison and rejects missing approval before private state access', async () => {
  const help = await retrievalCoverageComparisonCli([]); assert.ok('mode' in help && help.mode === 'offline');
  const root = mkdtempSync(join(tmpdir(), 'retrieval-comparison-cli-'));
  try {
    const path = join(root, 'plan.json'), env = new Proxy({ ABLATRIX_LOOP_LIVE: '1' }, { get(target, key) { if (String(key).includes('SAPIOM')) assert.fail('Credential access before approval'); return Reflect.get(target, key); } });
    const old = prepareSourceCalibrationComparison(preparation()); writeFileSync(path, JSON.stringify(old));
    await assert.rejects(retrievalCoverageComparisonCli(['--execute', '--plan', path, '--approved-plan-sha256', old.planSha256], env), /Wrong comparison CLI/);
    const current = prepareSourceCalibrationComparison(retrievalPreparation()); writeFileSync(path, JSON.stringify(current));
    await assert.rejects(retrievalCoverageComparisonCli(['--execute', '--plan', path, '--approved-plan-sha256', '0'.repeat(64)], env), /Exact approval/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
