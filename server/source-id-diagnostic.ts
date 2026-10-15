import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, lstatSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contextComparisonHash } from './context-comparison.ts';
import { SapiomFeedbackProvider, constrainedSourceIdAnswerPromptIdentity, constrainedSourceIdAnswerRequestBody, constrainedSourceIdRevisionPromptIdentity, constrainedSourceIdRevisionRequestBody, type RevisionInput, type QuoteOption } from './feedback-provider.ts';
import type { LoopProvider } from './loop-types.ts';

export const DIAGNOSTIC_CASE_IDS = ['source-id-train-10021', 'source-id-train-12820', 'source-id-train-8746'] as const;
export const DIAGNOSTIC_CODE_FILES = ['server/source-id-diagnostic.ts', 'server/source-id-diagnostic.test.ts', 'scripts/source-id-diagnostic.ts', 'server/feedback-provider.ts', 'server/citation-options.ts', 'server/revision-policy.ts', 'server/context-comparison.ts'] as const;
export const diagnosticSha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
type JsonDocument = Record<string, any>;
type OriginalInput = Parameters<LoopProvider['answer']>[0];
type Body = ReturnType<typeof constrainedSourceIdAnswerRequestBody>;
type Output = Awaited<ReturnType<SapiomFeedbackProvider['answerWithConstrainedSourceIds']>> | Awaited<ReturnType<SapiomFeedbackProvider['reviseWithConstrainedSourceIds']>>;
type Receipt = NonNullable<ReturnType<SapiomFeedbackProvider['receipt']>>;
export type DiagnosticArtifact = { path: string; fileSha256: string; document: JsonDocument };
export type DiagnosticPreparation = {
  source: DiagnosticArtifact; qualification: DiagnosticArtifact; caseAudit: DiagnosticArtifact;
  implementationCommit: string; implementationSha256: Record<string, string>; createdAt: string;
};
const limits = Object.freeze({ initialLedgerAttempts: 81, maximumNewAttempts: 6, absoluteCallLimit: 87, planningAllowancePerAttemptUsd: 0.1, maximumPlanningAllowanceUsd: 0.6, capUsd: 10, priorSpendUsd: 0.200281, web: false, retries: 0 });
const derivation = 'Use the actual validated original answer text as rejectedAnswer, with the frozen original product/question, exact prewritten AI critique, same five ordered sources, no clarifications, and the frozen investigation descriptor. Call baseline revision once. Log its exact derived body before dispatch; no candidate, retry, replacement or import.';
const placeholder = 'Preparation placeholder only. Never dispatched or recorded as a generated answer.';
function artifactIdentity(artifact: DiagnosticArtifact) { return { path: artifact.path, fileSha256: artifact.fileSha256 }; }
function relativeFile(path: string) {
  assert.ok(path && !isAbsolute(path) && !path.split('/').includes('..') && !path.includes('\\'), 'Artifact/code path must stay inside the repository.');
  return path;
}
function hashes(body: Body) {
  const payload = JSON.parse(body.messages[1].content);
  return { requestSha256: diagnosticSha256(JSON.stringify(body)), optionSetSha256: diagnosticSha256(JSON.stringify(payload.quoteOptions)), responseSchemaSha256: diagnosticSha256(JSON.stringify(body.tools[0].function.parameters)) };
}
export function diagnosticRevisionInput(c: Pick<DiagnosticCase, 'originalInput' | 'critique' | 'investigation'>, answer: string, runId: string): RevisionInput {
  return { runId, question: c.originalInput.question, product: { id: c.originalInput.product.id, title: c.originalInput.product.title }, rejectedAnswer: answer, critique: c.critique.text,
    evidence: c.originalInput.passages.map(s => ({ id: s.id, source: s.source, text: s.text, ...(s.originalQuestion !== undefined ? { originalQuestion: s.originalQuestion } : {}), reference: s.reference })),
    clarifications: [], investigation: clone(c.investigation), revisionPolicy: 'baseline' };
}
export type DiagnosticCase = {
  id: string; originalInput: OriginalInput; critique: { text: string; kind: 'ai_assisted' };
  generationSourceIds: string[]; sourcePoolSha256: string; quoteOptions: QuoteOption[]; targetSourceIds: string[];
  investigation: NonNullable<RevisionInput['investigation']>; originalRequest: Body;
  originalRequestSha256: string; optionSetSha256: string; responseSchemaSha256: string;
  revisionTemplateRequest: Body; revisionTemplateRequestSha256: string;
};
/** Pure preparation: no credentials, provider, retrieval or database access. */
export function prepareSourceIdDiagnostic(input: DiagnosticPreparation) {
  const { source, qualification, caseAudit } = input;
  for (const artifact of [source, qualification, caseAudit]) { relativeFile(artifact.path); assert.match(artifact.fileSha256, /^[a-f0-9]{64}$/); }
  assert.match(input.implementationCommit, /^[a-f0-9]{40}$/); assert.ok(Number.isFinite(Date.parse(input.createdAt)));
  assert.equal(source.document.planSha256, contextComparisonHash(source.document.plan));
  assert.equal(source.document.plan.format, 'ablatrix-source-id-comparison-plan-v1');
  const gate = qualification.document;
  assert.equal(gate.passed, true); assert.equal(gate.newProviderCalls, 0); assert.equal(gate.sourceIdInterface, 'source_ids_v2');
  assert.equal(gate.qualityClaimEligible, false); assert.equal(gate.routerConstrainedDecodingVerified, false);
  for (const path of DIAGNOSTIC_CODE_FILES) assert.match(gate.implementationSha256?.[path] ?? '', /^[a-f0-9]{64}$/, `Qualification must cover ${path}`);
  for (const [path, hash] of Object.entries(gate.implementationSha256)) { relativeFile(path); assert.equal(input.implementationSha256[path], hash, 'Qualified implementation fingerprint changed.'); }
  assert.deepEqual(Object.keys(input.implementationSha256).sort(), Object.keys(gate.implementationSha256).sort());
  const audit = caseAudit.document;
  assert.equal(audit.passed, true); assert.equal(audit.intendedInterface, 'source_ids_v2'); assert.deepEqual(audit.caseOrder, [...DIAGNOSTIC_CASE_IDS]);
  assert.equal(audit.sourceManifest.fileSha256, source.fileSha256); assert.equal(audit.sourceManifest.planSha256, source.document.planSha256);
  const cases: DiagnosticCase[] = DIAGNOSTIC_CASE_IDS.map(id => {
    const matches = source.document.plan.cases.filter((c: JsonDocument) => c.id === id); assert.equal(matches.length, 1);
    const c = matches[0], audited = audit.cases.find((value: JsonDocument) => value.id === id); assert.ok(audited);
    assert.equal(c.critique.kind, 'ai_assisted'); assert.ok(c.critique.text.length >= 10);
    assert.equal(c.originalInput.question, c.question); assert.equal(c.originalInput.product.id, c.product.id); assert.equal(c.originalInput.product.title, c.product.title);
    assert.equal(c.originalInput.policy.instructions, source.document.plan.baselinePolicy);
    assert.equal(c.originalInput.passages.length, 5); assert.deepEqual(c.originalInput.passages, c.retrieval.passages);
    assert.deepEqual(c.generationSourceIds, c.originalInput.passages.map((s: JsonDocument) => s.id));
    assert.deepEqual(audited.generationSourceIds, c.generationSourceIds); assert.deepEqual(audited.critique, c.critique);
    assert.equal(audited.question, c.question); assert.deepEqual(audited.product, c.product);
    for (const [index, passage] of c.originalInput.passages.entries()) {
      const sourceBody = c.sources.find((s: JsonDocument) => s.id === passage.id); assert.ok(sourceBody);
      assert.equal(passage.productId, c.product.id); assert.equal(passage.text, sourceBody.text); assert.equal(passage.originalQuestion ?? null, sourceBody.originalQuestion); assert.equal(passage.reference, sourceBody.reference);
      const checked = audited.selectedSources[index]; assert.equal(checked.id, passage.id); assert.equal(checked.text, passage.text); assert.equal(checked.originalQuestion, passage.originalQuestion ?? null); assert.equal(checked.reference, passage.reference);
    }
    const originalInput: OriginalInput = clone({ ...c.originalInput, runId: 'not-dispatched' });
    const body = constrainedSourceIdAnswerRequestBody(originalInput), catalog = JSON.parse(body.messages[1].content).quoteOptions as QuoteOption[];
    assert.deepEqual(catalog, c.quoteOptions, 'The historical source catalog must remain unchanged.');
    const targets = id === DIAGNOSTIC_CASE_IDS[0] ? ['epqa-B0051POK1E-review-18ea39b439fecdee'] : id === DIAGNOSTIC_CASE_IDS[1] ? ['epqa-B00O4HP9JW-attribute-3ef0619cd4a3a665'] : originalInput.passages.filter(s => s.source === 'cqa' && s.originalQuestion).map(s => s.id);
    assert.ok(targets.length); assert.ok(targets.every(id => catalog.some(s => s.passageId === id))); assert.deepEqual(audited.targetSourceIds, targets);
    const prepared: Omit<DiagnosticCase, 'revisionTemplateRequest' | 'revisionTemplateRequestSha256'> = { id, originalInput, critique: clone(c.critique), generationSourceIds: clone(c.generationSourceIds), sourcePoolSha256: contextComparisonHash(c.sources), quoteOptions: catalog, targetSourceIds: targets,
      investigation: { issue: 'answer_quality', query: c.question.slice(0, 240), selectedSourceIds: clone(c.generationSourceIds), addedSourceIds: [], stopReason: 'Frozen previously exposed diagnostic sources; no retrieval changes or external discovery.' },
      originalRequest: body, originalRequestSha256: hashes(body).requestSha256, optionSetSha256: hashes(body).optionSetSha256, responseSchemaSha256: hashes(body).responseSchemaSha256 };
    const revisionBody = constrainedSourceIdRevisionRequestBody(diagnosticRevisionInput(prepared, placeholder, 'not-dispatched'));
    assert.deepEqual(JSON.parse(revisionBody.messages[1].content).quoteOptions, catalog); assert.equal(hashes(revisionBody).responseSchemaSha256, prepared.responseSchemaSha256);
    return { ...prepared, revisionTemplateRequest: revisionBody, revisionTemplateRequestSha256: hashes(revisionBody).requestSha256 };
  });
  const plan = { format: 'ablatrix-source-id-diagnostic-plan-v1', id: 'source-id-diagnostic-2026-10-11', createdAt: input.createdAt, citationInterface: 'source_ids_v2',
    source: { ...artifactIdentity(source), planSha256: source.document.planSha256 }, qualification: artifactIdentity(qualification), caseAudit: artifactIdentity(caseAudit),
    implementationCommit: input.implementationCommit, implementationSha256: clone(input.implementationSha256),
    originalPromptIdentity: constrainedSourceIdAnswerPromptIdentity(), revisionPromptIdentity: constrainedSourceIdRevisionPromptIdentity('baseline', true),
    revisionDerivation: derivation, cases, order: cases.flatMap(c => [{ caseId: c.id, arm: 'original' as const }, { caseId: c.id, arm: 'baseline' as const }]), limits: { ...limits },
    selection: 'Previously exposed diagnostic cases. No fresh cohort or quality comparison.', paidExecutionAuthorized: false, qualityClaimEligible: false, routerConstrainedDecodingVerified: false, humanJudgments: 0 };
  return { createdAt: input.createdAt, planSha256: contextComparisonHash(plan), plan };
}
export type DiagnosticManifest = ReturnType<typeof prepareSourceIdDiagnostic>;
export type DiagnosticState = { ledgerAttempts: number; pendingReservations: number; activeOwners: number; activeOwnerPid: number | null; activeReviewJobs: number; historicalReceiptsSha256: string; reviewStateSha256: string; newRunIds: string[] };
export type DiagnosticAppState = { configuredPort: number; checkedPorts: number[]; listenerPids: number[]; sharedFileOwnerPids: number[]; activeLockPids: number[]; stopped: boolean };
/** Same port contract as server/index.ts; a missing PORT means 4173. */
export function diagnosticAppPort(value?: string): number {
  const port = Number(value ?? '4173');
  assert.ok(Number.isSafeInteger(port) && port >= 1 && port <= 65535, 'PORT must be an integer between 1 and 65535.');
  return port;
}
function lsofPids(args: string[]): number[] {
  const result = spawnSync('lsof', ['-nP', '-F', 'p', ...args], { encoding: 'utf8' });
  if (result.error) throw result.error;
  // An absent owner/listener returns 1 with empty output. Permission/tool errors
  // must never be interpreted as proof that the application is stopped.
  assert.ok(!result.stderr.trim() && (result.status === 0 || (result.status === 1 && !result.stdout.trim())), 'Cannot verify local process ownership with lsof.');
  return [...new Set(result.stdout.split('\n').filter(line => /^p\d+$/.test(line)).map(line => Number(line.slice(1))))];
}
/** Read-only OS checks: ports alone cannot detect an idle worker on another port. */
export function inspectDiagnosticApp(input: { port?: string; budgetPath: string; reviewPath: string; appDbPath: string; loopDbPath: string }): DiagnosticAppState {
  const configuredPort = diagnosticAppPort(input.port), checkedPorts = [...new Set([4173, configuredPort])];
  assert.ok([input.budgetPath, input.reviewPath].every(path => isAbsolute(path) && existsSync(path)), 'Shared database files must exist before checking process ownership.');
  const listenerPids = [...new Set(checkedPorts.flatMap(port => lsofPids([`-iTCP:${port}`, '-sTCP:LISTEN'])))];
  // index.ts opens these stores when it initializes its worker, even with no
  // queued jobs or paid-provider lease. Checking their file owners catches the
  // same application on any port or under a different ABLATRIX_DB setting.
  // macOS lsof exits 1 when only some file operands match. Query each file
  // independently so an unopened review DB does not invalidate a budget owner.
  const sharedFileOwnerPids = [...new Set([input.budgetPath, input.reviewPath].flatMap(path => lsofPids(['--', path])))].filter(pid => pid !== process.pid);
  const activeLockPids: number[] = [];
  for (const database of [input.appDbPath, input.loopDbPath]) {
    assert.notEqual(database, ':memory:', 'Diagnostic application database paths must be explicit files.');
    const path = `${resolve(database)}.lock`;
    let raw: string;
    try { raw = readFileSync(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const pid = Number(raw); assert.ok(Number.isSafeInteger(pid) && pid > 0, 'An application ownership lock is malformed; inspect it before execution.');
    try { process.kill(pid, 0); activeLockPids.push(pid); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') activeLockPids.push(pid); }
  }
  return { configuredPort, checkedPorts, listenerPids, sharedFileOwnerPids, activeLockPids: [...new Set(activeLockPids)], stopped: !listenerPids.length && !sharedFileOwnerPids.length && !activeLockPids.length };
}

function assertAppStopped(appState: DiagnosticAppState, port?: string) {
  assert.equal(appState.configuredPort, diagnosticAppPort(port)); assert.deepEqual(appState.checkedPorts, [...new Set([4173, appState.configuredPort])]);
  assert.equal(appState.stopped, true, 'Stop the local application and shared database owners before executing.');
  assert.deepEqual(appState.listenerPids, []); assert.deepEqual(appState.sharedFileOwnerPids, []); assert.deepEqual(appState.activeLockPids, []);
}
export type DiagnosticBoundaryCheck = { phase: 'preflight' | 'before_reservation' | 'before_transport' | 'after_transport'; checkedAt: string; runId?: string; appState?: DiagnosticAppState; state?: DiagnosticState; passed: boolean; failure?: 'application_or_history_changed' };

type Provider = Pick<SapiomFeedbackProvider, 'answerWithConstrainedSourceIds' | 'reviseWithConstrainedSourceIds' | 'receipt' | 'capacity' | 'close'>;
export type DiagnosticStep = { caseId: string; arm: 'original' | 'baseline'; runId: string; status: 'not_attempted' | 'dispatching' | 'completed' | 'failed_or_uncertain'; dispatched?: boolean; input?: OriginalInput | RevisionInput; requestBody?: Body; requestSha256?: string; inputSha256?: string; dispatchIntentAt?: string; dispatchedAt?: string; httpStatus?: number; durationMs?: number; result?: Output; receipt?: Receipt | null; citationSelection?: 'observed' | 'unexercised'; quoteChecks?: { passageId: string; matched: boolean }[] };
export type DiagnosticResult = {
  format: string; mode: 'live'; planSha256: string; operatorApprovalPlanSha256: string; startedAt: string; finishedAt?: string; status: 'running' | 'completed' | 'stopped'; stopReason?: string;
  steps: DiagnosticStep[]; networkDispatches: number; newProviderAttempts: number; acceptedOutputs: number; citationSelectionRequests: number;
  deliveryOutcome: 'incomplete' | 'completed_with_observed_selection' | 'completed_with_unexercised_selection';
  targetCoverage: { caseId: string; selectedTargetSourceIds: string[]; status: 'observed' | 'inconclusive' }[];
  appState: DiagnosticAppState; boundaryChecks: DiagnosticBoundaryCheck[]; before: DiagnosticState; after?: DiagnosticState; existingReceiptsUnchanged?: boolean; existingReviewStateUnchanged?: boolean;
  qualityClaimEligible: false; routerConstrainedDecodingVerified: false; humanJudgments: 0; actualProviderCharges: 'unavailable';
};
export type DiagnosticExecution = {
  approvedPlanSha256: string; preparation: DiagnosticPreparation;
  env: { PORT?: string; ABLATRIX_LOOP_LIVE?: string; ABLATRIX_REVISION_WEB?: string; ABLATRIX_LOOP_CALL_LIMIT?: string };
  implementationMerged: boolean; inspectApp(): DiagnosticAppState; readState(): DiagnosticState;
  createProvider(fetchImpl: typeof fetch): Provider; transport: typeof fetch;
  output: { create(result: DiagnosticResult): void; save(result: DiagnosticResult): void };
};
/** One terminal run only. All approval/environment/history gates precede provider creation. */
export async function executeSourceIdDiagnostic(manifest: DiagnosticManifest, deps: DiagnosticExecution): Promise<DiagnosticResult> {
  assert.equal(manifest.planSha256, contextComparisonHash(manifest.plan)); assert.equal(deps.approvedPlanSha256, manifest.planSha256, 'Approval must name this exact diagnostic plan.');
  assert.deepEqual(manifest, prepareSourceIdDiagnostic(deps.preparation), 'Source, qualified code or frozen diagnostic plan changed.');
  assert.equal(deps.implementationMerged, true, 'Implementation must be merged and unchanged.');
  assert.equal(deps.env.ABLATRIX_LOOP_LIVE, '1'); assert.equal(deps.env.ABLATRIX_REVISION_WEB, '0'); assert.equal(deps.env.ABLATRIX_LOOP_CALL_LIMIT, '87');
  const appState = deps.inspectApp();
  assertAppStopped(appState, deps.env.PORT);
  const before = deps.readState(); assert.equal(before.ledgerAttempts, 81); assert.equal(before.pendingReservations, 0); assert.equal(before.activeOwners, 0); assert.equal(before.activeReviewJobs, 0); assert.deepEqual(before.newRunIds, []);
  const result: DiagnosticResult = { format: 'ablatrix-source-id-diagnostic-results-v1', mode: 'live', planSha256: manifest.planSha256, operatorApprovalPlanSha256: deps.approvedPlanSha256, startedAt: new Date().toISOString(), status: 'running',
    steps: manifest.plan.order.map(s => ({ ...s, runId: `source-id-diagnostic-${manifest.planSha256.slice(0, 14)}-${s.caseId}-${s.arm}`, status: 'not_attempted' })),
    networkDispatches: 0, newProviderAttempts: 0, acceptedOutputs: 0, citationSelectionRequests: 0, deliveryOutcome: 'incomplete', targetCoverage: [], appState, boundaryChecks: [{ phase: 'preflight', checkedAt: new Date().toISOString(), appState, state: before, passed: true }], before, qualityClaimEligible: false, routerConstrainedDecodingVerified: false, humanJudgments: 0, actualProviderCharges: 'unavailable' };
  deps.output.create(clone(result));
  let provider: Provider | undefined, active: DiagnosticStep | undefined;
  const checkpoint = () => deps.output.save(clone(result));
  // These observations stop later dispatches after a detected restart. They
  // cannot prevent another process starting during an in-flight paid request.
  const checkBoundary = (phase: Exclude<DiagnosticBoundaryCheck['phase'], 'preflight'>) => {
    const check: DiagnosticBoundaryCheck = { phase, checkedAt: new Date().toISOString(), runId: active?.runId, passed: false };
    result.boundaryChecks.push(check);
    try {
      check.appState = deps.inspectApp(); assertAppStopped(check.appState, deps.env.PORT);
      check.state = deps.readState();
      assert.equal(check.state.historicalReceiptsSha256, before.historicalReceiptsSha256, 'Historical provider receipts changed.');
      assert.equal(check.state.reviewStateSha256, before.reviewStateSha256, 'Review history changed.'); assert.equal(check.state.activeReviewJobs, 0);
      const ownReceipts = result.steps.flatMap(step => { const receipt = provider?.receipt(step.runId); return receipt ? [{ runId: step.runId, status: receipt.status }] : []; });
      assert.equal(check.state.ledgerAttempts, 81 + ownReceipts.length); assert.ok(ownReceipts.length <= 6);
      assert.deepEqual([...check.state.newRunIds].sort(), ownReceipts.map(receipt => receipt.runId).sort());
      // The current dispatch has already reserved one pending call and may own
      // the provider lease. Only this process and this run's receipts are allowed.
      assert.equal(check.state.pendingReservations, ownReceipts.filter(receipt => receipt.status === 'pending').length);
      assert.ok(check.state.pendingReservations <= (phase === 'before_reservation' ? 0 : 1));
      assert.ok(check.state.activeOwners === 0 || (check.state.activeOwners === 1 && check.state.activeOwnerPid === process.pid));
      check.passed = true;
    } catch (error) { check.failure = 'application_or_history_changed'; throw error; }
    finally { checkpoint(); }
  };
  try {
    provider = deps.createProvider(async (url, init) => {
      assert.ok(active && !active.dispatched); assert.equal(String(url), 'https://router.sapiom.ai/v1/chat/completions'); assert.equal(init?.method, 'POST');
      assert.equal(init.body, JSON.stringify(active.requestBody), 'Dispatch differs from the exact frozen/derived request.');
      assert.ok(result.networkDispatches < 6); active.dispatchIntentAt = new Date().toISOString(); checkpoint();
      // Recheck after persisting intent, before entering the actual transport.
      checkBoundary('before_transport');
      active.dispatched = true; result.networkDispatches++; active.dispatchedAt = new Date().toISOString();
      const response = await deps.transport(url, { ...init, redirect: 'error' }); active.httpStatus = response.status;
      try { checkBoundary('after_transport'); } catch (error) { await response.body?.cancel(); throw error; }
      return response;
    });
    assert.equal(provider.capacity(6).ready, true);
    for (const step of result.steps) {
      active = step;
      const c = manifest.plan.cases.find(c => c.id === step.caseId)!;
      const started = performance.now();
      try {
        checkBoundary('before_reservation');
        assert.equal(provider.receipt(step.runId), undefined, 'Never resume an existing attempt.');
        if (step.arm === 'original') { step.input = { ...clone(c.originalInput), runId: step.runId }; step.requestBody = constrainedSourceIdAnswerRequestBody(step.input); assert.equal(hashes(step.requestBody).requestSha256, c.originalRequestSha256); }
        else { const original = result.steps.find(s => s.caseId === step.caseId && s.arm === 'original'); assert.equal(original?.status, 'completed'); assert.ok(original.result); step.input = diagnosticRevisionInput(c, original.result.answer.answer, step.runId); step.requestBody = constrainedSourceIdRevisionRequestBody(step.input); }
        const identity = step.arm === 'original' ? manifest.plan.originalPromptIdentity : manifest.plan.revisionPromptIdentity;
        const requestHashes = hashes(step.requestBody); assert.equal(requestHashes.optionSetSha256, c.optionSetSha256); assert.equal(requestHashes.responseSchemaSha256, c.responseSchemaSha256);
        step.requestSha256 = requestHashes.requestSha256; step.inputSha256 = contextComparisonHash(step.input); step.status = 'dispatching'; checkpoint();
        const output: Output = step.arm === 'original' ? await provider.answerWithConstrainedSourceIds(step.input as OriginalInput) : await provider.reviseWithConstrainedSourceIds(step.input as RevisionInput);
        step.result = output; step.receipt = provider.receipt(step.runId) ?? null; assert.ok(step.dispatched); assert.ok(step.receipt); assert.equal(step.receipt.status, 'completed'); assert.equal(step.receipt.error_code, null); assert.equal(step.receipt.id, output.attemptId);
        assert.ok(['gpt-luna', 'gpt-5.6-luna'].includes(output.model)); assert.equal(step.receipt.model, output.model);
        const receipt = JSON.parse(step.receipt.receipt_json!);
        for (const [field, value] of Object.entries({ citationInterface: 'source_ids_v2', optionSetSha256: c.optionSetSha256, responseSchemaSha256: c.responseSchemaSha256, promptVersion: identity.promptVersion, systemInstructionsSha256: identity.systemInstructionsSha256 })) { assert.equal((output as any)[field], value); assert.equal(receipt[field], value); }
        const quoteChecks = output.answer.citations.map(q => ({ passageId: q.passageId, matched: c.quoteOptions.some(s => s.passageId === q.passageId && s.quote === q.quote) }));
        step.quoteChecks = quoteChecks;
        assert.ok(quoteChecks.every(q => q.matched)); assert.ok(output.answer.status !== 'answered' || quoteChecks.length > 0);
        step.citationSelection = quoteChecks.length ? 'observed' : 'unexercised'; step.status = 'completed'; step.durationMs = Math.round(performance.now() - started); checkpoint();
      } catch { step.receipt = provider.receipt(step.runId) ?? null; step.status = 'failed_or_uncertain'; step.durationMs = Math.round(performance.now() - started); result.status = 'stopped'; result.stopReason = 'A request, receipt or output validation failed; no retry or replacement.'; checkpoint(); break; }
    }
    if (result.steps.every(s => s.status === 'completed')) result.status = 'completed';
  } catch { result.status = 'stopped'; result.stopReason ??= 'Execution configuration or persistence failed; inspect private receipts before any separate future run.'; }
  finally {
    provider?.close(); result.finishedAt = new Date().toISOString(); result.after = deps.readState(); result.newProviderAttempts = result.after.ledgerAttempts - before.ledgerAttempts;
    result.existingReceiptsUnchanged = result.after.historicalReceiptsSha256 === before.historicalReceiptsSha256;
    result.existingReviewStateUnchanged = result.after.reviewStateSha256 === before.reviewStateSha256;
    const receipts = result.steps.filter(s => s.receipt).map(s => s.runId);
    if (!result.existingReceiptsUnchanged || !result.existingReviewStateUnchanged || result.after.pendingReservations || result.after.activeOwners || result.after.activeReviewJobs || result.newProviderAttempts > 6 || result.newProviderAttempts !== receipts.length || contextComparisonHash([...result.after.newRunIds].sort()) !== contextComparisonHash(receipts.sort())) { result.status = 'stopped'; result.stopReason = 'Post-run ledger or history integrity check failed; no further calls.'; }
    result.acceptedOutputs = result.steps.filter(s => s.status === 'completed').length;
    result.citationSelectionRequests = result.steps.filter(s => s.status === 'completed' && s.citationSelection === 'observed').length;
    result.deliveryOutcome = result.status !== 'completed' ? 'incomplete' : result.citationSelectionRequests === 6 ? 'completed_with_observed_selection' : 'completed_with_unexercised_selection';
    result.targetCoverage = manifest.plan.cases.map(c => { const cited = new Set(result.steps.filter(s => s.caseId === c.id && s.status === 'completed').flatMap(s => s.result!.answer.citations.map(q => q.passageId))); const selected = c.targetSourceIds.filter(id => cited.has(id)); return { caseId: c.id, selectedTargetSourceIds: selected, status: selected.length ? 'observed' : 'inconclusive' }; });
    checkpoint();
  }
  return result;
}

const reviewTables = ['answer_versions', 'answer_review_events', 'answer_revision_jobs', 'answer_revision_attempts', 'paid_answer_reviews', 'paid_answer_reviews_v2'];
const repository = fileURLToPath(new URL('../', import.meta.url));
const readArtifact = (path: string): DiagnosticArtifact => { relativeFile(path); const raw = readFileSync(resolve(repository, path)); return { path, fileSha256: diagnosticSha256(raw), document: JSON.parse(raw.toString('utf8')) }; };
function codeFingerprints(qualification: DiagnosticArtifact, commit: string) {
  assert.match(commit, /^[a-f0-9]{40}$/);
  return Object.fromEntries(Object.keys(qualification.document.implementationSha256).map(path => {
    relativeFile(path); const raw = readFileSync(resolve(repository, path)), committed = execFileSync('git', ['show', `${commit}:${path}`], { cwd: repository });
    assert.equal(diagnosticSha256(raw), diagnosticSha256(committed), 'Implementation commit and working file differ.'); return [path, diagnosticSha256(raw)];
  }));
}
export function privateDiagnosticOutput(path: string, privateRoot = resolve(repository, '.data')): DiagnosticExecution['output'] {
  const output = resolve(path); privateRoot = resolve(privateRoot);
  assert.ok(relative(privateRoot, output) && !relative(privateRoot, output).startsWith('..') && !isAbsolute(relative(privateRoot, output)), 'Live output must be a new file under the private .data directory.');
  const verifyParents = () => {
    let current = privateRoot;
    for (const part of ['', ...relative(privateRoot, dirname(output)).split('/').filter(Boolean)]) {
      if (part) current = resolve(current, part);
      try { const info = lstatSync(current); assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Private output cannot traverse a symlink or non-directory.'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  };
  verifyParents();
  // No directory/file is created until all execution preflight gates pass.
  const write = (file: string, result: DiagnosticResult) => { const fd = openSync(file, 'wx', 0o600); try { writeFileSync(fd, JSON.stringify(result, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); } };
  return { create(result) { verifyParents(); mkdirSync(dirname(output), { recursive: true }); verifyParents(); write(output, result); }, save(result) { verifyParents(); const temporary = `${output}.${randomUUID()}.tmp`; write(temporary, result); renameSync(temporary, output); } };
}
/** Filesystem/CLI boundary. --prepare never opens a database or constructs a provider. */
export async function sourceIdDiagnosticCli(argv: string[]) {
  const command = argv[0], flags = new Map<string, string>();
  for (let i = 1; i < argv.length; i += 2) { assert.ok(argv[i]?.startsWith('--') && argv[i + 1] && !flags.has(argv[i])); flags.set(argv[i], argv[i + 1]); }
  const flag = (name: string) => { const value = flags.get(name); assert.ok(value, `Missing ${name}`); return value; };
  assert.ok(command === '--prepare' || command === '--execute');
  if (command === '--prepare') {
    assert.deepEqual([...flags.keys()].sort(), ['--source-plan', '--qualification', '--case-audit', '--implementation-commit', '--out'].sort(), 'Unknown or missing preparation flag.');
    const source = readArtifact(flag('--source-plan')), qualification = readArtifact(flag('--qualification')), caseAudit = readArtifact(flag('--case-audit')), implementationCommit = flag('--implementation-commit');
    const manifest = prepareSourceIdDiagnostic({ source, qualification, caseAudit, implementationCommit, implementationSha256: codeFingerprints(qualification, implementationCommit), createdAt: new Date().toISOString() });
    const out = flag('--out'); mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    return { out, planSha256: manifest.planSha256, plannedCalls: 6, newProviderCalls: 0 };
  }
  assert.deepEqual([...flags.keys()].sort(), ['--plan', '--approved-plan-sha256', '--out'].sort(), 'Unknown or missing execution flag.');
  const manifest: DiagnosticManifest = JSON.parse(readFileSync(flag('--plan'), 'utf8')), approved = flag('--approved-plan-sha256');
  assert.equal(manifest.planSha256, contextComparisonHash(manifest.plan)); assert.equal(approved, manifest.planSha256, 'Exact new plan approval required.');
  const env = process.env;
  assert.equal(env.ABLATRIX_LOOP_LIVE, '1'); assert.equal(env.ABLATRIX_REVISION_WEB, '0'); assert.equal(env.ABLATRIX_LOOP_CALL_LIMIT, '87');
  const source = readArtifact(manifest.plan.source.path), qualification = readArtifact(manifest.plan.qualification.path), caseAudit = readArtifact(manifest.plan.caseAudit.path);
  const commit = manifest.plan.implementationCommit;
  const preparation = { source, qualification, caseAudit, implementationCommit: commit, implementationSha256: codeFingerprints(qualification, commit), createdAt: manifest.createdAt };
  assert.deepEqual(manifest, prepareSourceIdDiagnostic(preparation));
  for (const ref of ['HEAD', 'github/main']) execFileSync('git', ['merge-base', '--is-ancestor', commit, ref], { cwd: repository });
  const budgetPath = env.ABLATRIX_LOOP_BUDGET_DB, reviewPath = env.ABLATRIX_PAID_REVIEW_DB;
  assert.ok(budgetPath && reviewPath && isAbsolute(budgetPath) && isAbsolute(reviewPath) && existsSync(budgetPath) && existsSync(reviewPath), 'Explicit existing absolute shared ledger and review database paths required.');
  const output = privateDiagnosticOutput(flag('--out')); assert.ok(!existsSync(resolve(flag('--out'))), 'Never overwrite or resume an output.');
  const budget = new DatabaseSync(budgetPath, { readOnly: true }), review = new DatabaseSync(reviewPath, { readOnly: true });
  try {
    const readState = (): DiagnosticState => {
      const rows = budget.prepare('SELECT * FROM loop_provider_calls ORDER BY rowid').all();
      const owner = budget.prepare('SELECT expires_at,pid FROM loop_provider_owner WHERE id=1').get();
      return { ledgerAttempts: rows.length, pendingReservations: rows.filter(r => r.status === 'pending').length, activeOwners: owner && Number(owner.expires_at) > Date.now() ? 1 : 0, activeOwnerPid: owner && Number(owner.expires_at) > Date.now() ? Number(owner.pid) : null,
        activeReviewJobs: Number(review.prepare("SELECT COUNT(*) n FROM answer_revision_jobs WHERE status IN ('queued','running','reconciliation')").get()!.n),
        historicalReceiptsSha256: contextComparisonHash(rows.slice(0, 81)), newRunIds: rows.slice(81).map(r => String(r.run_id)),
        reviewStateSha256: contextComparisonHash(Object.fromEntries(reviewTables.map(t => [t, contextComparisonHash(review.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())]))) };
    };
    const result = await executeSourceIdDiagnostic(manifest, { approvedPlanSha256: approved, preparation, env: { PORT: env.PORT, ABLATRIX_LOOP_LIVE: env.ABLATRIX_LOOP_LIVE, ABLATRIX_REVISION_WEB: env.ABLATRIX_REVISION_WEB, ABLATRIX_LOOP_CALL_LIMIT: env.ABLATRIX_LOOP_CALL_LIMIT }, implementationMerged: true, inspectApp: () => inspectDiagnosticApp({ port: env.PORT, budgetPath, reviewPath, appDbPath: env.ABLATRIX_DB ?? '.data/ablatrix.sqlite', loopDbPath: env.ABLATRIX_LOOP_DB ?? '.data/feedback-loop.sqlite' }), readState, output, transport: fetch,
      createProvider: fetchImpl => new SapiomFeedbackProvider({ enabled: true, dbPath: budgetPath, capUsd: 10, priorSpendUsd: .200281, allowancePerCallUsd: .1, callLimit: 87, fetchImpl }) });
    if (result.status !== 'completed') process.exitCode = 1;
    return { out: flag('--out'), status: result.status, newProviderAttempts: result.newProviderAttempts, acceptedOutputs: result.acceptedOutputs, citationSelectionRequests: result.citationSelectionRequests, deliveryOutcome: result.deliveryOutcome, targetCoverage: result.targetCoverage, qualityClaimEligible: false, routerConstrainedDecodingVerified: false };
  } finally { review.close(); budget.close(); }
}
