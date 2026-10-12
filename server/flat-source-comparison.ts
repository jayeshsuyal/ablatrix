import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProductRetriever } from './product-retrieval.ts';
import type { LoopProvider, LoopRetriever, ProductCorpus, RetrievalResult } from './loop-types.ts';
import { workspaceReviewSourceHash } from './answer-review-source.ts';
import { SapiomFeedbackProvider, flatSourceIdAnswerPromptIdentity, flatSourceIdAnswerRequestBody, type RevisionInput } from './feedback-provider.ts';
import { ContextComparisonStore, contextComparisonHash as hash, correctionComparisonInput, correctionComparisonProtocol, correctionComparisonRequest, correctionComparisonRequestHash, type CorrectionComparisonPacket } from './context-comparison.ts';
import { diagnosticAppPort, inspectDiagnosticApp, type DiagnosticAppState, type DiagnosticState } from './source-id-diagnostic.ts';

type Json = Record<string, any>;
export type FlatArtifact = { path: string; fileSha256: string; document: Json };
export const flatFileHash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const FLAT_COMPARISON_CODE_FILES = ['server/flat-source-comparison.ts', 'server/flat-source-comparison.test.ts', 'scripts/flat-source-comparison.ts', 'server/feedback-provider.ts', 'server/revision-policy.ts', 'server/citation-options.ts', 'server/context-comparison.ts', 'server/product-retrieval.ts', 'server/source-id-diagnostic.ts', 'server/feedback-loop.ts', 'server/product-corpus.ts', 'server/loop-types.ts', 'server/answer-review-source.ts', 'package-lock.json'] as const;
export const FLAT_RETRIEVAL_CODE_FILES = ['server/product-retrieval.ts', 'server/product-corpus.ts', 'server/loop-types.ts', 'package-lock.json'] as const;
const limits = { initialLedgerAttempts: 86, maximumNewAttempts: 24, absoluteCallLimit: 110, planningAllowancePerAttemptUsd: .1, maximumPlanningAllowanceUsd: 2.4, capUsd: 12, priorSpendUsd: .200281, web: false, retries: 0 } as const;
type PacketCase = CorrectionComparisonPacket['cases'][number];
type Original = Parameters<LoopProvider['answer']>[0];
type Body = ReturnType<typeof flatSourceIdAnswerRequestBody>;
type Output = Awaited<ReturnType<SapiomFeedbackProvider['answerWithFlatSourceIds']>> | Awaited<ReturnType<SapiomFeedbackProvider['reviseWithFlatSourceIds']>>;
type Receipt = NonNullable<ReturnType<SapiomFeedbackProvider['receipt']>>;
type Provider = Pick<SapiomFeedbackProvider, 'answerWithFlatSourceIds' | 'reviseWithFlatSourceIds' | 'receipt' | 'capacity' | 'close'>;
function relativePath(path: string) { assert.ok(path && !isAbsolute(path) && !path.split('/').includes('..') && !path.includes('\\'), 'Artifact paths must stay in the repository.'); return path; }
const identity = ({ path, fileSha256 }: FlatArtifact) => ({ path, fileSha256 });
const bodyHashes = (body: Body) => ({ requestSha256: flatFileHash(JSON.stringify(body)), optionSetSha256: flatFileHash(JSON.stringify(JSON.parse(body.messages[1].content).quoteOptions)), responseSchemaSha256: flatFileHash(JSON.stringify(body.tools[0].function.parameters)) });
function cohortCases(artifact: FlatArtifact): Json[] {
  const document = artifact.document, cases = document.cases;
  const { cohortSha256, ...cohortDocument } = document; assert.equal(cohortSha256, hash(cohortDocument));
  assert.ok(Array.isArray(cases) && cases.length === 8, 'Exactly eight frozen products are required.');
  assert.equal(new Set(cases.map(c => c.id)).size, 8); assert.equal(new Set(cases.map(c => c.product.id.toUpperCase())).size, 8);
  assert.ok(cases.every(c => /^[A-Za-z0-9_-]{1,120}$/.test(c.id) && c.critique.kind === 'ai_assisted' && c.critique.text.length >= 10));
  assert.equal(new Set(cases.map(c => c.critique.text)).size, 1, 'Use the same prewritten rubric critique for every case.');
  for (const c of cases) {
    assert.equal(c.sourcePoolSha256, hash(c.sources));
    assert.ok(c.sources.length >= 1 && c.sources.length <= 128); assert.equal(new Set(c.sources.map((s: Json) => s.id)).size, c.sources.length);
    for (const source of c.sources) { assert.equal(source.sha256, workspaceReviewSourceHash(source)); assert.ok(source.text.length <= 2000 && !/(?:^|\s)Question:\s*\S/i.test(source.text)); }
  }
  return cases;
}
export function flatComparisonCorpus(cohort: FlatArtifact): ProductCorpus {
  const cases = cohortCases(cohort);
  return { version: `flat-comparison-${cohort.fileSha256.slice(0, 20)}`, source: cohort.document.source.url, license: cohort.document.source.license, products: cases.map(c => ({ ...c.product, split: 'validation' as const })), cases: [],
    passages: cases.flatMap(c => c.sources.map((s: Json) => ({ id: s.id, productId: c.product.id, source: s.label, text: s.text, reference: s.reference, sha256: flatFileHash(s.text), ...(s.originalQuestion ? { originalQuestion: s.originalQuestion } : {}) }))) };
}
/** Offline retrieval happens once. Final preparation consumes this immutable result. */
export async function retrieveFlatSourceComparison(cohort: FlatArtifact, retriever: LoopRetriever, implementationSha256: Record<string, string>, createdAt: string) {
  const cases = cohortCases(cohort), retrievals = [];
  for (const c of cases) retrievals.push({ caseId: c.id, retrieval: await retriever.retrieve(c.product.id, c.question) });
  const document = { format: 'ablatrix-flat-source-retrieval-v1', cohortFileSha256: cohort.fileSha256, corpusSha256: hash(flatComparisonCorpus(cohort)), orderedCaseIds: cases.map(c => c.id), createdAt, implementationSha256, retrievals };
  return { ...document, retrievalSha256: hash(document) };
}
export type FlatPreparation = { cohort: FlatArtifact; retrieval: FlatArtifact; familyAudit: FlatArtifact; sourceAudit: FlatArtifact; qualification: FlatArtifact; exposureAudit: FlatArtifact; implementationCommit: string; implementationSha256: Record<string, string>; publicHistorySha256: Record<string, string>; baselinePolicy: string; createdAt: string };
function audit(artifact: FlatArtifact, cohort: FlatArtifact, ids: string[]) {
  assert.equal(artifact.document.passed, true); assert.equal(artifact.document.cohortFileSha256, cohort.fileSha256); assert.deepEqual(artifact.document.orderedCaseIds, ids);
  assert.deepEqual(artifact.document.cases.map((c: Json) => c.id), ids); assert.ok(artifact.document.cases.every((c: Json) => c.passed === true));
}
/** Pure reconstruction and validation: never performs retrieval, generation or live DB I/O. */
export function prepareFlatSourceComparison(input: FlatPreparation) {
  const cases = cohortCases(input.cohort), ids = cases.map(c => c.id);
  for (const artifact of [input.cohort, input.retrieval, input.familyAudit, input.sourceAudit, input.qualification, input.exposureAudit]) { relativePath(artifact.path); assert.match(artifact.fileSha256, /^[a-f0-9]{64}$/); }
  assert.match(input.implementationCommit, /^[a-f0-9]{40}$/); assert.ok(Number.isFinite(Date.parse(input.createdAt))); assert.ok(input.baselinePolicy.length >= 40);
  const gate = input.qualification.document; assert.equal(gate.passed, true); assert.equal(gate.newProviderCalls, 0); assert.equal(gate.sourceIdInterface, 'source_ids_v3'); assert.equal(gate.qualityClaimEligible, false); assert.equal(gate.routerConstrainedDecodingVerified, false);
  assert.deepEqual(input.implementationSha256, gate.implementationSha256); assert.deepEqual(input.publicHistorySha256, gate.publicHistorySha256); assert.ok(Object.keys(input.publicHistorySha256).length > 0);
  for (const path of FLAT_COMPARISON_CODE_FILES) assert.match(input.implementationSha256[path] ?? '', /^[a-f0-9]{64}$/);
  for (const [path, digest] of Object.entries({ ...input.implementationSha256, ...input.publicHistorySha256 })) { relativePath(path); assert.match(digest, /^[a-f0-9]{64}$/); }
  audit(input.familyAudit, input.cohort, ids); audit(input.sourceAudit, input.cohort, ids); assert.equal(input.sourceAudit.document.retrievalFileSha256, input.retrieval.fileSha256);
  const { retrievalSha256, ...retrievalDocument } = input.retrieval.document; assert.equal(retrievalSha256, hash(retrievalDocument)); assert.equal(retrievalDocument.cohortFileSha256, input.cohort.fileSha256); assert.deepEqual(retrievalDocument.orderedCaseIds, ids);
  for (const [path, digest] of Object.entries(retrievalDocument.implementationSha256)) assert.equal(input.implementationSha256[path], digest, 'Retrieval code changed after selected-source audit.');
  assert.deepEqual(retrievalDocument.retrievals.map((r: Json) => r.caseId), ids);
  assert.equal(retrievalDocument.corpusSha256, hash(flatComparisonCorpus(input.cohort)));
  for (const path of FLAT_RETRIEVAL_CODE_FILES) assert.equal(retrievalDocument.implementationSha256[path], input.implementationSha256[path], 'Retrieval implementation fingerprint missing or stale.');
  const exposure = input.exposureAudit.document, { auditSha256, ...exposureBody } = exposure; assert.equal(auditSha256, hash(exposureBody)); assert.equal(input.cohort.document.exposureAuditSha256, auditSha256);
  assert.equal(exposure.metadataSha256, hash(exposure.metadata)); assert.deepEqual(exposure.metadataInventorySha256, metadataFingerprints(exposure.metadata).inventories);
  assert.equal(input.sourceAudit.document.exposureAuditFileSha256, input.exposureAudit.fileSha256); assert.equal(input.sourceAudit.document.metadataSha256, exposure.metadataSha256);
  assert.ok(exposure.metadata.workspaces.length > 0 && exposure.metadata.comparisons.length > 0);
  const protectedIds = new Set(exposure.protectedProducts.map((p: Json) => p.id.toUpperCase())); assert.ok(cases.every(c => !protectedIds.has(c.product.id.toUpperCase())));
  const preparationHistorySha256: Record<string, string> = gate.preparationHistorySha256 ?? {};
  for (const [path, digest] of Object.entries(preparationHistorySha256)) { relativePath(path); assert.equal(digest, input.publicHistorySha256[path], 'Preparation publication must be bound by the qualified public history.'); assert.match(digest, /^[a-f0-9]{64}$/); }
  const artifactPaths = new Set([input.cohort, input.retrieval, input.familyAudit, input.sourceAudit, input.qualification, input.exposureAudit].map(a => a.path).concat(Object.keys(preparationHistorySha256)));
  const publicIdentifierProjections: PublicIdentifierProjection[] = exposure.publicIdentifierProjections;
  assert.ok(Array.isArray(publicIdentifierProjections)); assert.equal(new Set(publicIdentifierProjections.map(p => p.path)).size, publicIdentifierProjections.length);
  for (const p of publicIdentifierProjections) { relativePath(p.path); assert.ok(p.productIds.length && p.productIds.every(id => /^B[0-9A-Z]{9}$/.test(id))); assert.deepEqual(p.productIds, [...new Set(p.productIds)].sort()); assert.equal(p.identifierProjectionSha256, hash(p.productIds)); }
  const publicExposureSha256 = hash(publicIdentifierProjections.filter(p => !artifactPaths.has(p.path)).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const protocol = correctionComparisonProtocol('gpt-luna', input.implementationCommit, 'source_ids_v3');
  const prepared = cases.map((c, index) => {
    const retrieval: RetrievalResult = clone(retrievalDocument.retrievals[index].retrieval), selected = retrieval.passages.map(s => s.id);
    assert.ok(selected.length >= 1 && selected.length <= 8); assert.equal(new Set(selected).size, selected.length); assert.deepEqual(input.sourceAudit.document.cases[index].generationSourceIds, selected);
    for (const passage of retrieval.passages) { const s = c.sources.find((s: Json) => s.id === passage.id); assert.ok(s); assert.equal(passage.productId, c.product.id); assert.equal(passage.source, s.label); assert.equal(passage.text, s.text); assert.equal(passage.originalQuestion ?? null, s.originalQuestion); assert.equal(passage.reference, s.reference); assert.equal(passage.sha256, flatFileHash(s.text)); }
    const originalInput: Original = { question: c.question, product: { ...c.product, split: 'validation' }, policy: { id: 'flat-comparison-original', parentId: null, instructions: input.baselinePolicy, rationale: 'Frozen shared original with explicit flat source IDs.', feedbackRunIds: [], status: 'baseline', mode: 'live', createdAt: input.createdAt }, passages: retrieval.passages };
    const body = flatSourceIdAnswerRequestBody(originalInput);
    const shared = { id: c.id, product: clone(c.product), question: c.question, sources: clone(c.sources), generationSourceIds: selected, critique: clone(c.critique), clarifications: [], investigation: { issue: 'answer_quality' as const, query: c.question.slice(0, 240), selectedSourceIds: selected, addedSourceIds: [], stopReason: 'Frozen hybrid retrieval and shared rubric; no external discovery or source adaptation.' }, original: { id: `template-${c.id}`, answer: { answer: 'Preparation placeholder only. Never dispatched.', status: 'insufficient_evidence' as const, citations: [] }, model: 'gpt-luna', providerCallId: `template-receipt-${c.id}`, inputSha256: hash(originalInput), requestSha256: bodyHashes(body).requestSha256 } };
    const templates = { baseline: correctionComparisonRequest(protocol, shared, 'baseline', 'not-dispatched'), candidate: correctionComparisonRequest(protocol, shared, 'candidate', 'not-dispatched') };
    for (const template of Object.values(templates)) { assert.deepEqual(JSON.parse(template.messages[1].content).quoteOptions, JSON.parse(body.messages[1].content).quoteOptions); assert.equal(bodyHashes(template).responseSchemaSha256, bodyHashes(body).responseSchemaSha256); }
    return { id: c.id, cohortCase: clone(c), retrieval, shared, originalInput, originalRequest: body, ...bodyHashes(body), templates, templateRequestSha256: { baseline: bodyHashes(templates.baseline).requestSha256, candidate: bodyHashes(templates.candidate).requestSha256 } };
  });
  const plan = { format: 'ablatrix-flat-source-comparison-plan-v1', id: `flat-source-comparison-${input.cohort.fileSha256.slice(0, 16)}`, createdAt: input.createdAt, citationInterface: 'source_ids_v3',
    artifacts: { cohort: identity(input.cohort), retrieval: identity(input.retrieval), familyAudit: identity(input.familyAudit), sourceAudit: identity(input.sourceAudit), qualification: identity(input.qualification), exposureAudit: identity(input.exposureAudit) },
    metadata: metadataFingerprints(exposure.metadata), publicExposureSha256, preparationHistorySha256: clone(preparationHistorySha256),
    implementationCommit: input.implementationCommit, implementationSha256: clone(input.implementationSha256), publicHistorySha256: clone(input.publicHistorySha256), baselinePolicy: input.baselinePolicy, originalPromptIdentity: flatSourceIdAnswerPromptIdentity(), protocol, cases: prepared,
    order: [...prepared.map(c => ({ caseId: c.id, arm: 'original' as const })), ...prepared.flatMap((c, i) => (i % 2 === 0 ? ['baseline', 'candidate'] as const : ['candidate', 'baseline'] as const).map(arm => ({ caseId: c.id, arm })))], limits: { ...limits },
    revisionDerivation: 'Each policy independently revises the actual validated shared original answer with the same prewritten rubric, ordered source context and clarification/investigation fields. Derive and save the exact revision request hash before dispatch. Never revise the sibling.',
    paidExecutionAuthorized: false, qualityClaimEligible: false, routerConstrainedDecodingVerified: false, humanJudgments: 0 };
  // Exercise complete packet validation using synthetic placeholders, only in memory.
  const probe = new ContextComparisonStore(':memory:');
  try { probe.importPacket(packetForPlan({ plan, planSha256: hash(plan) }, true)); } finally { probe.close(); }
  return { createdAt: input.createdAt, planSha256: hash(plan), plan };
}
export type FlatManifest = ReturnType<typeof prepareFlatSourceComparison>;
type Arm = 'original' | 'baseline' | 'candidate';
const runIdFor = (manifest: { planSha256: string }, caseId: string, arm: Arm) => `flat-${manifest.planSha256.slice(0, 14)}-${hash(caseId).slice(0, 16)}-${arm}`;
function packetForPlan(manifest: { plan: Json; planSha256: string }, fixture = false): CorrectionComparisonPacket {
  const protocol = fixture ? correctionComparisonProtocol('synthetic-model', manifest.plan.implementationCommit, 'source_ids_v3') : manifest.plan.protocol;
  const packet: CorrectionComparisonPacket = { format: 'ablatrix-correction-comparison-v1', id: manifest.plan.id, title: 'Flat source-ID correction policy comparison', mode: fixture ? 'fixture' : 'live', createdAt: manifest.plan.createdAt, hypothesis: 'compare_correction_policy', protocol,
    provenance: { kind: fixture ? 'synthetic_fixture' : 'imported_live', sourcePacketSha256: fixture ? null : manifest.planSha256, note: fixture ? 'Synthetic preparation validation only; no model-quality results.' : 'Local results bound to a frozen prospective manifest. Imported receipts and provider authenticity remain independently unverified; source-checked human judgments are pending.' }, cases: [] };
  for (const c of manifest.plan.cases) {
    const item = clone(c.shared) as PacketCase;
    item.original = { ...item.original, id: runIdFor(manifest, c.id, 'original'), answer: { answer: 'SYNTHETIC preparation placeholder only.', status: 'insufficient_evidence', citations: [] }, model: fixture ? 'synthetic-model' : 'gpt-luna', providerCallId: fixture ? null : `not-generated-${hash(c.id).slice(0, 16)}` };
    item.arms = {} as PacketCase['arms'];
    for (const arm of ['baseline', 'candidate'] as const) item.arms[arm] = { id: runIdFor(manifest, c.id, arm), inputSha256: hash(correctionComparisonInput(protocol, item, arm)), requestSha256: correctionComparisonRequestHash(protocol, item, arm, runIdFor(manifest, c.id, arm)), status: 'not_attempted', answer: null, model: null, latencyMs: null, usage: null, providerCallId: null, error: 'Not attempted.' };
    packet.cases.push(item);
  }
  return packet;
}
export type FlatStep = { caseId: string; arm: Arm; runId: string; status: 'not_attempted' | 'dispatching' | 'completed' | 'failed_or_uncertain'; input?: Original | RevisionInput; requestBody?: Body; requestSha256?: string; inputSha256?: string; dispatchIntentAt?: string; dispatchedAt?: string; dispatched?: boolean; httpStatus?: number; durationMs?: number; result?: Output; receipt?: Receipt | null };
type Boundary = { phase: 'preflight' | 'before_reservation' | 'before_transport' | 'after_transport' | 'before_import'; checkedAt: string; runId?: string; appState?: DiagnosticAppState; state?: DiagnosticState; publicHistorySha256?: Record<string, string>; metadata?: MetadataFingerprints; publicExposureSha256?: string; passed: boolean; failure?: string };
export type FlatResult = { format: string; mode: 'live'; planSha256: string; operatorApprovalPlanSha256: string; startedAt: string; finishedAt?: string; status: 'running' | 'stopped' | 'awaiting_blind_human_review'; steps: FlatStep[]; before: DiagnosticState; after?: DiagnosticState; boundaryChecks: Boundary[]; networkDispatches: number; newProviderAttempts: number; acceptedOutputs: number; stopReason?: string; existingReceiptsUnchanged?: boolean; existingReviewStateUnchanged?: boolean; publicHistoryUnchanged?: boolean; metadataUnchangedBeforeImport?: boolean; publicExposureUnchanged?: boolean; comparisonPacket?: CorrectionComparisonPacket; imported?: unknown; humanJudgments: 0; qualityClaimEligible: false; routerConstrainedDecodingVerified: false; actualProviderCharges: 'unavailable' };
export type FlatExecution = { approvedPlanSha256: string; preparation: FlatPreparation; implementationMerged: boolean; env: { PORT?: string; ABLATRIX_LOOP_LIVE?: string; ABLATRIX_REVISION_WEB?: string; ABLATRIX_LOOP_CALL_LIMIT?: string; ABLATRIX_SPEND_CAP_USD?: string }; inspectApp(): DiagnosticAppState; readState(): DiagnosticState; publicHistory(): Record<string, string>; metadata(): MetadataFingerprints; publicExposure(): string; createProvider(fetchImpl: typeof fetch): Provider; transport: typeof fetch; output: { create(result: FlatResult): void; save(result: FlatResult): void }; importPacket(packet: CorrectionComparisonPacket): unknown };
function stopped(state: DiagnosticAppState, port?: string) { assert.equal(state.configuredPort, diagnosticAppPort(port)); assert.deepEqual(state.checkedPorts, [...new Set([4173, state.configuredPort])]); assert.equal(state.stopped, true); assert.deepEqual(state.listenerPids, []); assert.deepEqual(state.sharedFileOwnerPids, []); assert.deepEqual(state.activeLockPids, []); }
export async function executeFlatSourceComparison(manifest: FlatManifest, deps: FlatExecution): Promise<FlatResult> {
  assert.equal(manifest.planSha256, hash(manifest.plan)); assert.equal(deps.approvedPlanSha256, manifest.planSha256); assert.deepEqual(manifest, prepareFlatSourceComparison(deps.preparation)); assert.equal(deps.implementationMerged, true);
  assert.equal(deps.env.ABLATRIX_LOOP_LIVE, '1'); assert.equal(deps.env.ABLATRIX_REVISION_WEB, '0'); assert.equal(deps.env.ABLATRIX_LOOP_CALL_LIMIT, '110'); assert.equal(deps.env.ABLATRIX_SPEND_CAP_USD, '12');
  const app = deps.inspectApp(); stopped(app, deps.env.PORT); assert.deepEqual(deps.publicHistory(), manifest.plan.publicHistorySha256); assert.deepEqual(deps.metadata(), manifest.plan.metadata); assert.equal(deps.publicExposure(), manifest.plan.publicExposureSha256);
  const before = deps.readState(); assert.equal(before.ledgerAttempts, 86); assert.equal(before.pendingReservations, 0); assert.equal(before.activeOwners, 0); assert.equal(before.activeReviewJobs, 0); assert.deepEqual(before.newRunIds, []);
  const result: FlatResult = { format: 'ablatrix-flat-source-comparison-results-v1', mode: 'live', planSha256: manifest.planSha256, operatorApprovalPlanSha256: deps.approvedPlanSha256, startedAt: new Date().toISOString(), status: 'running', before,
    steps: manifest.plan.order.map(s => ({ ...s, runId: runIdFor(manifest, s.caseId, s.arm), status: 'not_attempted' })), boundaryChecks: [{ phase: 'preflight', checkedAt: new Date().toISOString(), appState: app, state: before, publicHistorySha256: deps.publicHistory(), metadata: deps.metadata(), publicExposureSha256: deps.publicExposure(), passed: true }], networkDispatches: 0, newProviderAttempts: 0, acceptedOutputs: 0, humanJudgments: 0, qualityClaimEligible: false, routerConstrainedDecodingVerified: false, actualProviderCharges: 'unavailable' };
  deps.output.create(clone(result)); const checkpoint = () => deps.output.save(clone(result));
  const packet = packetForPlan(manifest); let active: FlatStep | undefined, provider: Provider | undefined;
  // Boundary observations cannot prevent an external restart during an in-flight request.
  const check = (phase: Exclude<Boundary['phase'], 'preflight'>) => {
    const record: Boundary = { phase, checkedAt: new Date().toISOString(), runId: active?.runId, passed: false }; result.boundaryChecks.push(record);
    try {
      record.appState = deps.inspectApp(); stopped(record.appState, deps.env.PORT); record.publicHistorySha256 = deps.publicHistory(); assert.deepEqual(record.publicHistorySha256, manifest.plan.publicHistorySha256); record.metadata = deps.metadata(); assert.deepEqual(record.metadata, manifest.plan.metadata); record.publicExposureSha256 = deps.publicExposure(); assert.equal(record.publicExposureSha256, manifest.plan.publicExposureSha256);
      record.state = deps.readState(); assert.equal(record.state.historicalReceiptsSha256, before.historicalReceiptsSha256); assert.equal(record.state.reviewStateSha256, before.reviewStateSha256); assert.equal(record.state.activeReviewJobs, 0);
      const own = result.steps.flatMap(s => { const receipt = provider?.receipt(s.runId); return receipt ? [{ runId: s.runId, status: receipt.status }] : []; });
      assert.equal(record.state.ledgerAttempts, 86 + own.length); assert.ok(own.length <= 24); assert.deepEqual([...record.state.newRunIds].sort(), own.map(s => s.runId).sort());
      assert.equal(record.state.pendingReservations, own.filter(s => s.status === 'pending').length); assert.ok(record.state.pendingReservations <= (phase === 'before_transport' || phase === 'after_transport' ? 1 : 0));
      assert.ok(record.state.activeOwners === 0 || record.state.activeOwners === 1 && record.state.activeOwnerPid === process.pid); record.passed = true;
    } catch (error) { record.failure = 'application_or_history_changed'; throw error; } finally { checkpoint(); }
  };
  try {
    provider = deps.createProvider(async (url, init) => {
      assert.ok(active && !active.dispatched); assert.equal(String(url), 'https://router.sapiom.ai/v1/chat/completions'); assert.equal(init?.method, 'POST'); assert.equal(init.body, JSON.stringify(active.requestBody)); assert.ok(result.networkDispatches < 24);
      active.dispatchIntentAt = new Date().toISOString(); checkpoint(); check('before_transport'); active.dispatched = true; result.networkDispatches++; active.dispatchedAt = new Date().toISOString();
      const response = await deps.transport(url, { ...init, redirect: 'error' }); active.httpStatus = response.status; try { check('after_transport'); } catch (error) { await response.body?.cancel(); throw error; } return response;
    });
    assert.equal(provider.capacity(24).ready, true);
    for (const step of result.steps) {
      active = step; const c = manifest.plan.cases.find(c => c.id === step.caseId)!, item = packet.cases.find(c => c.id === step.caseId)!; const started = performance.now();
      try {
        check('before_reservation'); assert.equal(provider.receipt(step.runId), undefined);
        if (step.arm === 'original') { step.input = { ...clone(c.originalInput), runId: step.runId }; step.requestBody = flatSourceIdAnswerRequestBody(step.input); assert.equal(bodyHashes(step.requestBody).requestSha256, c.requestSha256); step.inputSha256 = hash(step.input); }
        else { assert.equal(result.steps.find(s => s.caseId === c.id && s.arm === 'original')?.status, 'completed'); const { modelAlias, ...input } = correctionComparisonInput(packet.protocol, item, step.arm); assert.equal(modelAlias, 'gpt-luna'); step.input = { ...input, runId: step.runId }; step.inputSha256 = hash(correctionComparisonInput(packet.protocol, item, step.arm)); step.requestBody = correctionComparisonRequest(packet.protocol, item, step.arm, step.runId); }
        const requestHashes = bodyHashes(step.requestBody); assert.equal(requestHashes.optionSetSha256, c.optionSetSha256); assert.equal(requestHashes.responseSchemaSha256, c.responseSchemaSha256); step.requestSha256 = requestHashes.requestSha256; step.status = 'dispatching'; checkpoint();
        const output: Output = step.arm === 'original' ? await provider.answerWithFlatSourceIds(step.input as Original) : await provider.reviseWithFlatSourceIds(step.input as RevisionInput);
        step.result = output; step.receipt = provider.receipt(step.runId) ?? null; step.durationMs = Math.round(performance.now() - started); assert.ok(step.dispatched && step.receipt); assert.equal(step.receipt.status, 'completed'); assert.equal(step.receipt.error_code, null); assert.equal(step.receipt.id, output.attemptId); assert.ok(['gpt-luna', 'gpt-5.6-luna'].includes(output.model)); assert.equal(step.receipt.model, output.model);
        const identity = step.arm === 'original' ? manifest.plan.originalPromptIdentity : packet.protocol.policies[step.arm], receipt = JSON.parse(step.receipt.receipt_json!);
        for (const [key, value] of Object.entries({ citationInterface: 'source_ids_v3', optionSetSha256: c.optionSetSha256, responseSchemaSha256: c.responseSchemaSha256, promptVersion: identity.promptVersion, systemInstructionsSha256: identity.systemInstructionsSha256 })) { assert.equal((output as any)[key], value); assert.equal(receipt[key], value); }
        const options = JSON.parse(c.originalRequest.messages[1].content).quoteOptions; assert.ok(output.answer.status !== 'answered' || output.answer.citations.length > 0); assert.ok(output.answer.citations.every(q => options.some((s: Json) => s.passageId === q.passageId && s.quote === q.quote)));
        if (step.arm === 'original') {
          item.original = { id: step.runId, answer: output.answer, model: output.model, providerCallId: step.receipt.id, inputSha256: step.inputSha256!, requestSha256: step.requestSha256 };
          for (const arm of ['baseline', 'candidate'] as const) { item.arms[arm].inputSha256 = hash(correctionComparisonInput(packet.protocol, item, arm)); item.arms[arm].requestSha256 = correctionComparisonRequestHash(packet.protocol, item, arm, item.arms[arm].id); }
        } else {
          const sibling = item.arms[step.arm === 'baseline' ? 'candidate' : 'baseline']; if (sibling.status === 'completed') assert.equal(output.model, sibling.model);
          assert.equal(step.requestSha256, item.arms[step.arm].requestSha256); Object.assign(item.arms[step.arm], { status: 'completed', answer: output.answer, model: output.model, latencyMs: step.durationMs, usage: output.usage, providerCallId: step.receipt.id, error: null });
        }
        step.status = 'completed'; checkpoint();
      } catch {
        step.receipt = provider.receipt(step.runId) ?? null; step.status = step.receipt ? 'failed_or_uncertain' : 'not_attempted'; step.durationMs = Math.round(performance.now() - started); result.status = 'stopped'; result.stopReason = 'A boundary, request or output check failed; no retry or replacement.';
        if (step.arm !== 'original' && step.receipt) Object.assign(item.arms[step.arm], { status: step.receipt?.status === 'failed_or_unknown' ? 'uncertain' : 'failed', answer: null, model: null, latencyMs: step.durationMs, usage: null, providerCallId: step.receipt?.id ?? null, error: 'Attempt failed or is uncertain; no retry.' }); checkpoint(); break;
      }
    }
    // A stopped original never becomes a fabricated placeholder in an imported partial cohort.
    if (result.steps.filter(s => s.arm === 'original' && s.status === 'completed').length === 8) {
      check('before_import'); result.metadataUnchangedBeforeImport = true; const temporary = new ContextComparisonStore(':memory:'); try { temporary.importPacket(packet); } finally { temporary.close(); }
      result.comparisonPacket = clone(packet); checkpoint(); result.imported = deps.importPacket(packet); checkpoint();
    }
    if (result.steps.every(s => s.status === 'completed')) result.status = 'awaiting_blind_human_review';
  } catch { result.status = 'stopped'; result.stopReason ??= 'Configuration, boundary, persistence or complete-packet import failed. No automatic retry.'; }
  finally {
    provider?.close(); result.finishedAt = new Date().toISOString(); result.after = deps.readState(); result.newProviderAttempts = result.after.ledgerAttempts - 86; result.acceptedOutputs = result.steps.filter(s => s.status === 'completed').length;
    result.existingReceiptsUnchanged = result.after.historicalReceiptsSha256 === before.historicalReceiptsSha256; result.existingReviewStateUnchanged = result.after.reviewStateSha256 === before.reviewStateSha256; result.publicHistoryUnchanged = false; try { result.publicHistoryUnchanged = hash(deps.publicHistory()) === hash(manifest.plan.publicHistorySha256); } catch { /* Changed or unreadable evidence fails closed. */ }
    if (!result.imported) { result.metadataUnchangedBeforeImport = false; try { result.metadataUnchangedBeforeImport = hash(deps.metadata()) === hash(manifest.plan.metadata); } catch { /* Unreadable source inventory fails closed. */ } }
    result.publicExposureUnchanged = false; try { result.publicExposureUnchanged = deps.publicExposure() === manifest.plan.publicExposureSha256; } catch { /* Changed frozen artifacts are never exempted. */ }
    const ownIds = result.steps.filter(s => s.receipt).map(s => s.runId).sort();
    if (!result.publicExposureUnchanged || !result.metadataUnchangedBeforeImport || !result.existingReceiptsUnchanged || !result.existingReviewStateUnchanged || !result.publicHistoryUnchanged || result.after.pendingReservations || result.after.activeOwners || result.after.activeReviewJobs || result.newProviderAttempts > 24 || result.newProviderAttempts !== ownIds.length || hash([...result.after.newRunIds].sort()) !== hash(ownIds)) { result.status = 'stopped'; result.stopReason = 'Post-run history or reservation integrity changed; no further calls.'; } checkpoint();
  }
  return result;
}

export type MetadataFingerprints = { sha256: string; inventories: Record<string, string> };
export function metadataFingerprints(metadata: { workspaces: Json[]; comparisons: Json[] }): MetadataFingerprints {
  const inventories = [...metadata.workspaces, ...metadata.comparisons]; assert.equal(new Set(inventories.map(i => i.inventory)).size, inventories.length);
  for (const [group, prefix] of [[metadata.workspaces, 'workspace'], [metadata.comparisons, 'comparison']] as const) group.forEach((item, i) => assert.equal(item.inventory, `${prefix}-${i + 1}`));
  return { sha256: hash(metadata), inventories: Object.fromEntries(inventories.map(i => [i.inventory, hash(i)])) };
}
/** These SQL projections never select generated answers, judgments or receipts. */
export function readFlatExposureMetadata(workspacePaths: string[], comparisonPaths: string[]) {
  const project = (raw: unknown) => (JSON.parse(String(raw ?? '[]')) as Json[]).map(s => ({ id: s.id ?? '', label: Object.hasOwn(s, 'label') ? s.label : s.source ?? '', text: s.text ?? '', originalQuestion: s.originalQuestion ?? null, reference: s.reference ?? null }));
  const read = <T>(path: string, callback: (db: DatabaseSync) => T) => { assert.ok(isAbsolute(path) && existsSync(path)); const db = new DatabaseSync(path, { readOnly: true }); try { return callback(db); } finally { db.close(); } };
  const workspaces = workspacePaths.map((path, index) => read(path, db => ({ inventory: `workspace-${index + 1}`,
    products: db.prepare("SELECT json_extract(document,'$.id') id,json_extract(document,'$.title') title,json_extract(document,'$.sources') sources FROM workspace_products ORDER BY id").all().map(r => ({ id: r.id, title: r.title, sources: project(r.sources) })),
    runs: db.prepare("SELECT json_extract(document,'$.productId') productId,json_extract(document,'$.question') question,json_extract(document,'$.reviewContext.product.title') title,COALESCE(json_extract(document,'$.reviewContext.sources'),json_extract(document,'$.retrieval.passages')) sources FROM workspace_runs ORDER BY id").all().map(r => ({ productId: r.productId, question: r.question ?? '', title: r.title ?? '', sources: project(r.sources) })) })));
  const comparisons = comparisonPaths.map((path, index) => read(path, db => {
    const cases = db.prepare("SELECT json_extract(c.value,'$.product.id') id,json_extract(c.value,'$.product.title') title,json_extract(c.value,'$.question') question,json_extract(c.value,'$.sources') sources FROM context_comparisons,json_each(document,'$.cases') c WHERE json_extract(document,'$.mode')='live' ORDER BY context_comparisons.id,c.key").all().map(r => ({ id: r.id, title: r.title, question: r.question, sources: project(r.sources) }));
    const reservedProducts = db.prepare("SELECT product_id id,fingerprint sourceFingerprint FROM context_comparison_exposure WHERE mode='live' ORDER BY product_id").all().map(r => ({ id: r.id, sourceFingerprint: r.sourceFingerprint }));
    assert.ok(reservedProducts.every(r => cases.some(c => String(c.id).toUpperCase() === String(r.id).toUpperCase())), 'Exposure without source metadata.');
    return { inventory: `comparison-${index + 1}`, cases, reservedProducts };
  }));
  return { workspaces, comparisons };
}
const repository = fileURLToPath(new URL('../', import.meta.url));
const reviewTables = ['answer_versions', 'answer_review_events', 'answer_revision_jobs', 'answer_revision_attempts', 'paid_answer_reviews', 'paid_answer_reviews_v2'];
const readArtifact = (path: string): FlatArtifact => { relativePath(path); const raw = readFileSync(resolve(repository, path)); return { path, fileSha256: flatFileHash(raw), document: JSON.parse(raw.toString()) }; };
const fingerprints = (paths: string[]) => Object.fromEntries(paths.map(path => [relativePath(path), flatFileHash(readFileSync(resolve(repository, path)))]));
function codeFingerprints(qualification: FlatArtifact, commit: string) {
  assert.match(commit, /^[a-f0-9]{40}$/);
  const actual = fingerprints(Object.keys(qualification.document.implementationSha256));
  for (const [path, digest] of Object.entries(actual)) assert.equal(digest, flatFileHash(execFileSync('git', ['show', `${commit}:${path}`], { cwd: repository })), 'Uncommitted implementation cannot be frozen or executed.');
  return actual;
}
export function privateFlatComparisonOutput(path: string, privateRoot = resolve(repository, '.data')): FlatExecution['output'] {
  const output = resolve(path); privateRoot = resolve(privateRoot); const child = relative(privateRoot, output);
  assert.ok(child && !child.startsWith('..') && !isAbsolute(child), 'Live output must be a new file under private .data.');
  const verify = () => { let current = privateRoot; for (const part of ['', ...relative(privateRoot, dirname(output)).split('/').filter(Boolean)]) { if (part) current = resolve(current, part); try { const stat = lstatSync(current); assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Private output cannot traverse symlinks.'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } } };
  const write = (file: string, result: FlatResult) => { const fd = openSync(file, 'wx', 0o600); try { writeFileSync(fd, JSON.stringify(result, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); } };
  verify(); return { create(result) { verify(); mkdirSync(dirname(output), { recursive: true }); verify(); write(output, result); }, save(result) { verify(); const temporary = `${output}.${randomUUID()}.tmp`; write(temporary, result); renameSync(temporary, output); } };
}
export function flatComparisonFlags(argv: string[]) {
  const [command] = argv, flags = new Map<string, string>();
  for (let i = 1; i < argv.length; i += 2) { assert.ok(argv[i]?.startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--') && !flags.has(argv[i])); flags.set(argv[i], argv[i + 1]); }
  const names = command === '--retrieve' ? ['--cohort', '--out'] : command === '--prepare' ? ['--cohort', '--retrieval', '--family-audit', '--source-audit', '--exposure-audit', '--qualification', '--out'] : command === '--execute' ? ['--plan', '--approved-plan-sha256', '--out'] : command === '--verify' ? ['--plan'] : [];
  assert.ok(names.length, 'Use --retrieve, --prepare, --verify or --execute.'); assert.deepEqual([...flags.keys()].sort(), names.sort(), 'Unknown or missing flag.');
  return { command, flag: (name: string) => { const value = flags.get(name); assert.ok(value); return value; } };
}
/** Retrieval and preparation never construct a paid provider or open the shared ledger. */
export async function flatSourceComparisonCli(argv: string[]) {
  const { command, flag } = flatComparisonFlags(argv);
  if (command === '--retrieve') {
    const cohort = readArtifact(flag('--cohort')), out = flag('--out'); assert.ok(!existsSync(out));
    const corpus = flatComparisonCorpus(cohort), code = fingerprints([...FLAT_RETRIEVAL_CODE_FILES]);
    const retriever = new ProductRetriever(corpus, resolve(repository, '.data', `flat-comparison-retrieval-${randomUUID()}.sqlite`));
    try { const document = await retrieveFlatSourceComparison(cohort, retriever, code, new Date().toISOString()); mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(out, JSON.stringify(document, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); return { out, retrievalSha256: document.retrievalSha256, cases: 8, newProviderCalls: 0 }; } finally { retriever.close(); }
  }
  if (command === '--prepare') {
    const qualification = readArtifact(flag('--qualification')), commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
    const manifest = prepareFlatSourceComparison({ cohort: readArtifact(flag('--cohort')), retrieval: readArtifact(flag('--retrieval')), familyAudit: readArtifact(flag('--family-audit')), sourceAudit: readArtifact(flag('--source-audit')), exposureAudit: readArtifact(flag('--exposure-audit')), qualification,
      implementationCommit: commit, implementationSha256: codeFingerprints(qualification, commit), publicHistorySha256: fingerprints(Object.keys(qualification.document.publicHistorySha256)), baselinePolicy: readFileSync(resolve(repository, 'server/feedback-loop.ts'), 'utf8').match(/const baseline = '([^']+)';/)![1], createdAt: new Date().toISOString() });
    assert.equal(hash(readFlatPublicExposure(repository, [...Object.values(manifest.plan.artifacts), ...Object.entries(manifest.plan.preparationHistorySha256).map(([path, fileSha256]) => ({ path, fileSha256 }))])), manifest.plan.publicExposureSha256);
    const out = flag('--out'); mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' }); return { out, planSha256: manifest.planSha256, cases: 8, plannedCalls: 24, newProviderCalls: 0, paidExecutionAuthorized: false };
  }
  const manifestRaw = readFileSync(flag('--plan')), manifest: FlatManifest = JSON.parse(manifestRaw.toString()), approved = command === '--execute' ? flag('--approved-plan-sha256') : undefined;
  assert.equal(manifest.planSha256, hash(manifest.plan));
  if (command === '--execute') { assert.equal(approved, manifest.planSha256, 'Exact frozen-plan approval required.'); assert.equal(process.env.ABLATRIX_LOOP_LIVE, '1'); assert.equal(process.env.ABLATRIX_REVISION_WEB, '0'); assert.equal(process.env.ABLATRIX_LOOP_CALL_LIMIT, '110'); assert.equal(process.env.ABLATRIX_SPEND_CAP_USD, '12'); }
  const artifacts = manifest.plan.artifacts, qualification = readArtifact(artifacts.qualification.path), commit = manifest.plan.implementationCommit;
  const preparation: FlatPreparation = { cohort: readArtifact(artifacts.cohort.path), retrieval: readArtifact(artifacts.retrieval.path), familyAudit: readArtifact(artifacts.familyAudit.path), sourceAudit: readArtifact(artifacts.sourceAudit.path), exposureAudit: readArtifact(artifacts.exposureAudit.path), qualification,
    implementationCommit: commit, implementationSha256: codeFingerprints(qualification, commit), publicHistorySha256: fingerprints(Object.keys(qualification.document.publicHistorySha256)), baselinePolicy: manifest.plan.baselinePolicy, createdAt: manifest.createdAt };
  const publicExposure = () => hash(readFlatPublicExposure(repository, [...Object.values(manifest.plan.artifacts), ...Object.entries(manifest.plan.preparationHistorySha256).map(([path, fileSha256]) => ({ path, fileSha256 }))], { path: resolve(flag('--plan')), fileSha256: flatFileHash(manifestRaw) }));
  if (command === '--verify') return verifyFlatSourceComparison(manifest, preparation, publicExposure());
  assert.deepEqual(manifest, prepareFlatSourceComparison(preparation)); assert.ok(approved); const env = process.env;
  for (const ref of ['HEAD', 'github/main']) execFileSync('git', ['merge-base', '--is-ancestor', commit, ref], { cwd: repository });
  const existing = (path: string | undefined) => { assert.ok(path && isAbsolute(path) && existsSync(path), 'Explicit existing absolute database path required.'); return path; };
  const budgetPath = existing(env.ABLATRIX_LOOP_BUDGET_DB), reviewPath = existing(env.ABLATRIX_PAID_REVIEW_DB), comparisonPath = existing(env.ABLATRIX_COMPARISON_DB);
  const paths = (value: string | undefined) => { assert.ok(value); const result: unknown = JSON.parse(value); assert.ok(Array.isArray(result) && result.length > 0 && result.every(p => typeof p === 'string')); return result.map(existing); };
  const workspacePaths = paths(env.ABLATRIX_COMPARISON_WORKSPACE_DBS), comparisonPaths = paths(env.ABLATRIX_COMPARISON_EXPOSURE_DBS); assert.ok(comparisonPaths.includes(comparisonPath), 'Import database must be part of the audited comparison inventory.');
  assert.equal(workspacePaths.length, preparation.exposureAudit.document.metadata.workspaces.length); assert.equal(comparisonPaths.length, preparation.exposureAudit.document.metadata.comparisons.length);
  const output = privateFlatComparisonOutput(flag('--out')); assert.ok(!existsSync(resolve(flag('--out'))), 'Never overwrite or resume a result.');
  const budget = new DatabaseSync(budgetPath, { readOnly: true }), review = new DatabaseSync(reviewPath, { readOnly: true });
  try {
    const readState = (): DiagnosticState => { const rows = budget.prepare('SELECT * FROM loop_provider_calls ORDER BY rowid').all(), owner = budget.prepare('SELECT expires_at,pid FROM loop_provider_owner WHERE id=1').get(), activeOwner = owner && Number(owner.expires_at) > Date.now();
      return { ledgerAttempts: rows.length, pendingReservations: rows.filter(r => r.status === 'pending').length, activeOwners: activeOwner ? 1 : 0, activeOwnerPid: activeOwner ? Number(owner.pid) : null, activeReviewJobs: Number(review.prepare("SELECT COUNT(*) n FROM answer_revision_jobs WHERE status IN ('queued','running','reconciliation')").get()!.n), historicalReceiptsSha256: hash(rows.slice(0, 86)), newRunIds: rows.slice(86).map(r => String(r.run_id)), reviewStateSha256: hash(Object.fromEntries(reviewTables.map(t => [t, hash(review.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())]))) }; };
    const result = await executeFlatSourceComparison(manifest, { preparation, approvedPlanSha256: approved, implementationMerged: true,
      env: { PORT: env.PORT, ABLATRIX_LOOP_LIVE: env.ABLATRIX_LOOP_LIVE, ABLATRIX_REVISION_WEB: env.ABLATRIX_REVISION_WEB, ABLATRIX_LOOP_CALL_LIMIT: env.ABLATRIX_LOOP_CALL_LIMIT, ABLATRIX_SPEND_CAP_USD: env.ABLATRIX_SPEND_CAP_USD },
      inspectApp: () => inspectDiagnosticApp({ port: env.PORT, budgetPath, reviewPath, appDbPath: env.ABLATRIX_DB ?? '.data/ablatrix.sqlite', loopDbPath: env.ABLATRIX_LOOP_DB ?? '.data/feedback-loop.sqlite' }), readState, publicHistory: () => fingerprints(Object.keys(manifest.plan.publicHistorySha256)), publicExposure, metadata: () => metadataFingerprints(readFlatExposureMetadata(workspacePaths, comparisonPaths)), output, transport: fetch,
      createProvider: fetchImpl => new SapiomFeedbackProvider({ enabled: true, dbPath: budgetPath, capUsd: 12, priorSpendUsd: .200281, allowancePerCallUsd: .1, callLimit: 110, fetchImpl }),
      importPacket: packet => { const store = new ContextComparisonStore(comparisonPath); try { return store.importPacket(packet); } finally { store.close(); } } });
    if (result.status !== 'awaiting_blind_human_review') process.exitCode = 1;
    return { out: flag('--out'), status: result.status, newProviderAttempts: result.newProviderAttempts, acceptedOutputs: result.acceptedOutputs, imported: Boolean(result.imported), plannedCalls: 24, humanJudgments: 0, qualityClaimEligible: false, actualProviderCharges: 'unavailable' };
  } finally { budget.close(); review.close(); }
}

export type PublicIdentifierProjection = { path: string; productIds: string[]; identifierProjectionSha256: string };
/** Match the source preparer's public ASIN projection, extending it to public
 * CSV/TSV/text/HTML documents and the root README.
 * Only exact, freshly verified plan artifacts and the validated manifest can be
 * omitted. Even another file repeating this cohort's ASINs is a new exposure.
 */
export function readFlatPublicExposure(root: string, artifacts: { path: string; fileSha256: string }[], manifest?: { path: string; fileSha256: string }): PublicIdentifierProjection[] {
  root = resolve(root); const excluded = new Set<string>();
  for (const artifact of artifacts) { relativePath(artifact.path); assert.equal(flatFileHash(readFileSync(resolve(root, artifact.path))), artifact.fileSha256, 'A bound plan artifact changed.'); excluded.add(relative(root, resolve(root, artifact.path))); }
  if (manifest) { assert.equal(flatFileHash(readFileSync(resolve(root, manifest.path))), manifest.fileSha256, 'Validated manifest bytes changed.'); excluded.add(relative(root, resolve(root, manifest.path))); }
  const files: string[] = [], walk = (path: string) => { for (const entry of readdirSync(path, { withFileTypes: true })) { if (entry.isSymbolicLink()) continue; const child = resolve(path, entry.name); if (entry.isDirectory()) walk(child); else if (entry.isFile() && /\.(json|md|csv|tsv|txt|html)$/.test(entry.name)) files.push(child); } };
  walk(resolve(root, 'docs')); const readme = resolve(root, 'README.md'); if (existsSync(readme)) { assert.ok(!lstatSync(readme).isSymbolicLink()); files.push(readme); }
  return files.sort().flatMap(path => { const name = relative(root, path); if (excluded.has(name)) return []; const productIds = [...new Set(readFileSync(path, 'utf8').match(/\bB[0-9A-Z]{9}\b/g) ?? [])].sort(); return productIds.length ? [{ path: name, productIds, identifierProjectionSha256: hash(productIds) }] : []; }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}


/** Offline reconstruction only; no credentials, provider or on-disk database access. */
export function verifyFlatSourceComparison(manifest: FlatManifest, preparation: FlatPreparation, publicExposureSha256: string) {
  assert.equal(manifest.planSha256, hash(manifest.plan)); assert.deepEqual(manifest, prepareFlatSourceComparison(preparation)); assert.equal(publicExposureSha256, manifest.plan.publicExposureSha256);
  return { verified: true, planSha256: manifest.planSha256, cases: 8, proposedCalls: 24, newProviderCalls: 0, paidExecutionAuthorized: false, qualityClaimEligible: false };
}
