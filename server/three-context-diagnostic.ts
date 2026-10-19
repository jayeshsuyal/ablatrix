import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { SourceCalibrationLedgerState } from './source-calibration-comparison.ts';
import type { LoopPolicy, Product, RetrievedPassage } from './loop-types.ts';
import { textHash } from './product-corpus.ts';
import { workspaceGenerationParts, replayWorkspaceGenerationReceipt, type WorkspaceGenerationInput, type WorkspaceGenerationReceipt } from './workspace-generation.ts';
import type { DesignatedFact } from './retrieval-diagnosis.ts';
export const DIAGNOSTIC_LEDGER = '/Users/jayeshsuyal/Documents/ChatGPT/Ablatrix/repo/.data/feedback-budget.sqlite';
export const diagnosticHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type DiagnosticCase = { id: string; product: Product; question: string; completeSources: RetrievedPassage[]; contexts: { current: RetrievedPassage[]; semantic: RetrievedPassage[]; reference: RetrievedPassage[] }; designatedFacts: DesignatedFact[]; referenceReview: { provenance: 'source_checked_human' | 'source_checked_ai'; reviewer: string; sufficientFor: string; unknowns: string[]; sourcePoolSha256: string } };
export type FreshValidationQualification = { contract: 'ablatrix-fresh-validation-v1'; protocolSha256: string; candidateFreezeSha256: string; historyInventorySha256: string; sourceReviewSha256: string; developmentOutcomeReviewSha256: string | null; selectedDenominator: number; screeningDenominator: number; qualificationPassed: boolean };
export type DiagnosticPreparation = { cases: DiagnosticCase[]; policy: LoopPolicy; implementationSha256: Record<string, string>; artifactSha256: Record<string, string>; ledger: { canonicalPath: string; historicalRowsSha256: string; attempts: number; reservedUsd: number; priorSpendUsd: number; pending: number; owners: number }; codeReviewPassed: boolean; validation?: FreshValidationQualification };
export function prepareThreeContext(preparation: DiagnosticPreparation) {
  const p = structuredClone(preparation); assert.ok(p.cases.length > 0 && p.cases.length <= 8); assert.equal(new Set(p.cases.map(c => c.id)).size, p.cases.length);
  assert.equal(p.ledger.canonicalPath, DIAGNOSTIC_LEDGER); assert.equal(p.ledger.pending, 0); assert.equal(p.ledger.owners, 0); assert.ok(p.ledger.attempts >= 138 && p.ledger.reservedUsd + p.ledger.priorSpendUsd >= 14.00028);
  assert.ok(p.policy.mode === 'live' && p.policy.instructions.length >= 40);
  for (const bindings of [p.implementationSha256, p.artifactSha256]) { assert.ok(Object.keys(bindings).length); for (const [path, hash] of Object.entries(bindings)) { assert.ok(!path.startsWith('/') && !path.split('/').includes('..')); assert.match(hash, /^[a-f0-9]{64}$/); } }
  if (p.validation) {
    const v = p.validation; assert.equal(v.contract, 'ablatrix-fresh-validation-v1');
    assert.equal(v.selectedDenominator, 8); assert.equal(v.screeningDenominator, 24); assert.equal(p.cases.length, v.selectedDenominator); assert.equal(new Set(p.cases.map(c => c.product.id)).size, v.selectedDenominator, 'Fresh selected products must remain distinct.'); assert.equal(typeof v.qualificationPassed, 'boolean');
    for (const sha of [v.protocolSha256, v.candidateFreezeSha256, v.historyInventorySha256, v.sourceReviewSha256]) { assert.match(sha, /^[a-f0-9]{64}$/); assert.ok(Object.values(p.artifactSha256).includes(sha), 'Fresh qualification proofs must remain byte-bound artifacts.'); }
    if (v.developmentOutcomeReviewSha256 !== null) { assert.match(v.developmentOutcomeReviewSha256, /^[a-f0-9]{64}$/); assert.ok(Object.values(p.artifactSha256).includes(v.developmentOutcomeReviewSha256)); }
    if (v.qualificationPassed) assert.ok(v.developmentOutcomeReviewSha256, 'Fresh paid preparation needs the independently reviewed development answer outcome.');
  }
  const identity = diagnosticHash(p), deliveries: string[] = [];
  const slots = p.cases.flatMap((item, caseIndex) => {
    assert.ok(item.id && item.question.trim() && item.product.split === (p.validation ? 'validation' : 'development'));
    assert.equal(new Set(item.completeSources.map(s => s.id)).size, item.completeSources.length);
    assert.equal(item.referenceReview.sourcePoolSha256, diagnosticHash(item.completeSources));
    assert.ok(item.referenceReview.reviewer.trim() && item.referenceReview.sufficientFor.trim() && item.designatedFacts.length);
    const validSource = (s: RetrievedPassage) => { assert.equal(s.productId, item.product.id); assert.equal(s.sha256, textHash(s.text)); assert.ok(s.text.length <= 1500); };
    item.completeSources.forEach(validSource);
    for (const context of Object.values(item.contexts)) {
      assert.ok(context.length <= 8 && context.reduce((n, s) => n + s.text.length, 0) <= 12000); assert.equal(new Set(context.map(s => s.id)).size, context.length);
      for (const s of context) { validSource(s); const original = item.completeSources.find(x => x.id === s.id); assert.ok(original && original.text === s.text && original.source === s.source && (original.originalQuestion ?? null) === (s.originalQuestion ?? null), 'Context must preserve literal source and question scope.'); }
    }
    for (const fact of item.designatedFacts) {
      assert.ok(fact.quote.trim().length >= 5 && fact.fact.trim());
      assert.ok(fact.sourceIds.length && fact.sourceIds.every(id => item.completeSources.some(s => s.id === id && s.text.includes(fact.quote))));
      const deliversFact = (context: RetrievedPassage[]) => context.some(source => {
        const reviewed = item.completeSources.find(s => s.id === source.id);
        return fact.sourceIds.includes(source.id) && source.text.includes(fact.quote)
          && reviewed && (source.originalQuestion ?? null) === (reviewed.originalQuestion ?? null);
      });
      assert.ok(deliversFact(item.contexts.reference), 'Curated reference must contain every designated fact.');
      if (!deliversFact(item.contexts.current) && deliversFact(item.contexts.semantic)) deliveries.push(item.id);
    }
    const arms = ['current', 'semantic', 'reference'] as const;
    const order = [...arms.slice(caseIndex % 3), ...arms.slice(0, caseIndex % 3)];
    const rows = order.map(arm => {
      const input: WorkspaceGenerationInput = { runId: `three-context-${identity.slice(0, 20)}-${caseIndex}-${arm}`, question: item.question, product: item.product, policy: p.policy, passages: item.contexts[arm] };
      const parts = workspaceGenerationParts(input); return { caseId: item.id, arm, input, body: parts.body, binding: parts.binding };
    });
    const neutral = (row: typeof rows[number]) => { const body = structuredClone(row.body), payload = JSON.parse(body.messages[1]!.content); delete payload.operationRunId; delete payload.evidence; delete payload.quoteOptions; body.messages[1]!.content = JSON.stringify(payload); (body.tools[0]!.function.parameters as any).properties.citations.items.enum = []; return body; };
    assert.deepEqual(neutral(rows[0]!), neutral(rows[1]!)); assert.deepEqual(neutral(rows[0]!), neutral(rows[2]!)); return rows;
  });
  const sourceBenefit = deliveries.length > 0, emptyContext = p.cases.some(c => Object.values(c.contexts).some(context => !context.length)), eligible = sourceBenefit && p.codeReviewPassed && !emptyContext && (!p.validation || p.validation.qualificationPassed);
  const allowance = Math.round(slots.length * 10) / 100, combined = Math.round((p.ledger.reservedUsd + p.ledger.priorSpendUsd + allowance) * 1e6) / 1e6;
  assert.ok(combined <= 20);
  const document = { format: p.validation ? 'ablatrix-three-context-fresh-validation-v1' : 'ablatrix-three-context-diagnostic-v1', preparation: p, slots, scope: p.validation ? 'prospective_fresh_validation' : 'exposed_development_only', sourceBenefit, deliveredCaseIds: [...new Set(deliveries)],
    paidPlan: eligible ? { maximumNewAttempts: slots.length, planningAllowanceUsd: allowance, allowancePerCallUsd: .1, absoluteCallLimit: p.ledger.attempts + slots.length, cumulativePlanningLimitUsd: combined, localCapUsd: 20, actualProviderCharges: 'unavailable', providerEnforcedCap: false } : null,
    stopReason: !sourceBenefit ? 'no_designated_missing_fact_delivered_by_semantic_context' : !p.codeReviewPassed ? 'code_review_pending' : emptyContext ? 'empty_context_requires_review' : p.validation && !p.validation.qualificationPassed ? 'fresh_validation_qualification_pending' : null, retries: 0, webCalls: 0, graderCalls: 0, activationAllowed: false, qualityClaimEligible: false, paidExecutionAuthorized: false };
  return { document, sha256: diagnosticHash(document) };
}
export type ThreeContextManifest = ReturnType<typeof prepareThreeContext>;
export function verifyThreeContext(manifest: ThreeContextManifest) { assert.equal(manifest.sha256, diagnosticHash(manifest.document)); assert.deepEqual(manifest, prepareThreeContext(manifest.document.preparation)); return manifest; }
export type DiagnosticStep = { index: number; started: boolean; startedAt?: string; observedAt?: string; attemptId?: string; dispatchIntent?: true; dispatched: boolean; receipt?: WorkspaceGenerationReceipt };
export type DiagnosticCheckpoint = { planSha256: string; provenance: 'mocked_mechanics_only' | 'live_router'; steps: DiagnosticStep[]; stopReason: string | null };
export function verifyDiagnosticCheckpoint(manifest: ThreeContextManifest, checkpoint: DiagnosticCheckpoint) {
  verifyThreeContext(manifest); assert.equal(checkpoint.planSha256, manifest.sha256); assert.equal(checkpoint.steps.length, manifest.document.slots.length); assert.ok(['live_router', 'mocked_mechanics_only'].includes(checkpoint.provenance));
  let stopped = false, model: string | undefined;
  const outputs = checkpoint.steps.map((step, i) => {
    assert.equal(step.index, i); assert.ok(!step.attemptId || step.started); assert.ok(!step.dispatchIntent || step.started && step.attemptId); assert.ok(!step.dispatched || step.dispatchIntent);
    if (step.startedAt !== undefined) assert.ok(step.started && Number.isFinite(Date.parse(step.startedAt)));
    if (step.observedAt !== undefined) assert.ok(step.startedAt !== undefined && Number.isFinite(Date.parse(step.observedAt)) && Date.parse(step.observedAt) >= Date.parse(step.startedAt));
    if (stopped) assert.equal(step.started, false);
    if (!step.started) { assert.ok(!step.receipt && !step.dispatched); stopped = true; return { status: 'not_attempted', output: null }; }
    if (!step.receipt) { stopped = true; return { status: 'failed_or_unknown', output: null }; }
    assert.equal(step.receipt.id, step.attemptId);
    try {
      assert.equal(step.receipt.allowance_usd, .1); assert.ok(step.dispatchIntent);
      const output = replayWorkspaceGenerationReceipt(manifest.document.slots[i]!.input, step.receipt, 'live');
      assert.ok(!model || model === output.model); model = output.model; return { status: 'completed', output };
    } catch { stopped = true; return { status: 'failed_or_unknown', output: null }; }
  });
  const unresolvedDispatchIntents = checkpoint.steps.filter(s => s.dispatchIntent && !s.dispatched).length;
  const remoteOutcomeUnknownAttempts = checkpoint.steps.filter((step, index) => {
    if (!step.dispatchIntent) return false;
    try {
      assert.ok(step.receipt?.status === 'completed' && step.receipt.receipt_json); const receipt = JSON.parse(step.receipt.receipt_json);
      for (const [key, value] of Object.entries(manifest.document.slots[index]!.binding)) assert.equal(receipt[key], value);
      assert.equal(receipt.mode, 'live'); assert.equal(receipt.accounting, 'local_planning_allowance'); assert.equal(receipt.model, step.receipt.model); return false;
    } catch { return true; }
  }).length;
  const transportInvocations = checkpoint.steps.filter(s => s.dispatched).length;
  return { outputs, completedAnswers: outputs.filter(o => o.status === 'completed').length, observedDispatches: transportInvocations, transportInvocations, unresolvedDispatchIntents, remoteOutcomeUnknownAttempts, networkDispatches: unresolvedDispatchIntents || remoteOutcomeUnknownAttempts ? null : transportInvocations, retries: 0, qualityClaimEligible: false };
}
/** Adapter owns no credentials. Production wiring must supply the existing durable ledger/provider and exact file guards. */
export async function executeThreeContext(manifest: ThreeContextManifest, approval: { execute: boolean; liveOptIn: boolean; approvedSha256: string; provenance: DiagnosticCheckpoint['provenance'] }, deps: {
  checkBindings(): { implementationSha256: Record<string, string>; artifactSha256: Record<string, string> }; checkLedger(steps: DiagnosticStep[]): SourceCalibrationLedgerState; create(): void; checkpoint(value: DiagnosticCheckpoint): void;
  createProvider(hooks: { operationGuard: (operation: { phase: string; kind: string; runId?: string; requestSha256: string; attemptId?: string }) => Promise<void>; fetchImpl: typeof fetch }): { answerWorkspace(input: WorkspaceGenerationInput): Promise<unknown>; receipt(runId: string): WorkspaceGenerationReceipt | undefined; close(): void; executionMode: string; capacity(requests: number): { ready: boolean } };
  transport: typeof fetch;
}) {
  verifyThreeContext(manifest); assert.ok(manifest.document.paidPlan, 'No-benefit or unreviewed packet cannot execute.');
  assert.ok(approval.execute && approval.liveOptIn && approval.approvedSha256 === manifest.sha256, 'Exact fresh financial approval and explicit live opt-in required.');
  const checkpoint: DiagnosticCheckpoint = { planSha256: manifest.sha256, provenance: approval.provenance, steps: manifest.document.slots.map((_, index) => ({ index, started: false, dispatched: false })), stopReason: null };
  let ownerToken: string | undefined;
  const inspect = () => {
    verifyThreeContext(manifest);
    assert.deepEqual(deps.checkBindings(), { implementationSha256: manifest.document.preparation.implementationSha256, artifactSha256: manifest.document.preparation.artifactSha256 });
    const state = deps.checkLedger(checkpoint.steps), anchor = manifest.document.preparation.ledger, reserved = checkpoint.steps.filter(s => s.attemptId);
    for (const key of ['canonicalPath', 'historicalRowsSha256', 'priorSpendUsd'] as const) assert.equal(state[key], anchor[key]);
    assert.equal(state.attempts, anchor.attempts + reserved.length); assert.ok(Math.abs(state.reservedUsd - anchor.reservedUsd - reserved.length * .1) < 1e-8);
    assert.equal(state.rows.length, reserved.length); assert.equal(state.pending, state.rows.filter(r => r.status === 'pending').length); assert.ok(state.pending <= 1);
    for (const step of reserved) {
      const slot = manifest.document.slots[step.index]!, row = state.rows.find(r => r.id === step.attemptId);
      assert.ok(row && row.run_id === slot.input.runId && row.allowance_usd === .1 && row.kind === workspaceGenerationParts(slot.input).tool);
      const receipt = JSON.parse(row.receipt_json!); for (const [key, value] of Object.entries(slot.binding)) assert.equal(receipt[key], value);
      if (step.receipt) { assert.equal(row.status, step.receipt.status); assert.equal(row.receipt_json, step.receipt.receipt_json); }
    }
    assert.equal(state.owners, state.ownerRows.length);
    if (!reserved.length) assert.equal(state.owners, 0);
    else { assert.equal(state.owners, 1); assert.equal(state.ownerRows[0]!.pid, process.pid); assert.ok(state.ownerRows[0]!.expires_at > Date.now()); ownerToken ??= state.ownerRows[0]!.token; assert.equal(state.ownerRows[0]!.token, ownerToken); }
  };
  const save = () => deps.checkpoint(structuredClone(checkpoint));
  inspect(); deps.create(); save(); let active = -1, before = false;
  let provider: ReturnType<typeof deps.createProvider> | undefined;
  try {
    provider = deps.createProvider({ operationGuard: async operation => {
      const slot = manifest.document.slots[active], step = checkpoint.steps[active]; assert.ok(slot && step && operation.kind === workspaceGenerationParts(slot.input).tool && operation.runId === slot.input.runId && operation.requestSha256 === slot.binding.requestSha256);
      if (operation.phase === 'before_reservation') { assert.ok(!before && !step.attemptId); inspect(); before = true; }
      else { assert.equal(operation.phase, 'after_reservation'); assert.ok(before && !step.attemptId && operation.attemptId); step.attemptId = operation.attemptId; save(); inspect(); }
    }, fetchImpl: async (url, init) => {
      const slot = manifest.document.slots[active]!, step = checkpoint.steps[active]!;
      assert.ok(before && step.attemptId && !step.dispatchIntent && String(url) === 'https://router.sapiom.ai/v1/chat/completions' && init?.method === 'POST' && init.body === JSON.stringify(slot.body));
      inspect(); step.dispatchIntent = true; save(); step.dispatched = true;
      return deps.transport(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(45000) });
    } });
    assert.equal(provider.executionMode, 'live'); assert.ok(provider.capacity(manifest.document.slots.length).ready, 'The whole approved batch must fit the shared ledger.');
    for (const [i, slot] of manifest.document.slots.entries()) {
      active = i; before = false; const step = checkpoint.steps[i]!; inspect(); step.started = true; step.startedAt = new Date().toISOString(); save();
      try { await provider.answerWorkspace(structuredClone(slot.input)); } catch { /* Receipt recovery never redispatches. */ }
      step.observedAt = new Date().toISOString(); step.receipt = provider.receipt(slot.input.runId); save(); inspect();
      const observed = verifyDiagnosticCheckpoint(manifest, checkpoint); if (observed.outputs[i]?.status !== 'completed') { checkpoint.stopReason = 'failed_or_unknown_no_retry'; save(); break; }
    }
  } catch { checkpoint.stopReason = 'frozen_boundary_or_execution_failed'; }
  finally { try { provider?.close(); } catch { checkpoint.stopReason = 'provider_close_failed'; } }
  save();
  return { checkpoint, result: verifyDiagnosticCheckpoint(manifest, checkpoint) };
}

/** Separate anonymous file and private mapping. Review labels never encode the arm. */
export function anonymousDiagnosticReview(manifest: ThreeContextManifest, checkpoint: DiagnosticCheckpoint, secret: string) {
  assert.ok(secret.length >= 16); const result = verifyDiagnosticCheckpoint(manifest, checkpoint);
  const ordered = manifest.document.slots.map((slot, i) => ({ slot, i, key: diagnosticHash([secret, slot.input.runId]) })).sort((a, b) => a.key.localeCompare(b.key));
  const mapping = ordered.map((r, i) => ({ label: `Answer ${i + 1}`, caseId: r.slot.caseId, arm: r.slot.arm, operationRunId: r.slot.input.runId, attemptId: checkpoint.steps[r.i]!.attemptId ?? null }));
  // Receipt bindings include an operation ID ending in the arm name. Keep every
  // execution field private, and expose only the actual source-checking content.
  const answers = ordered.map((r, i) => {
    const observed = result.outputs[r.i]!;
    return { label: `Answer ${i + 1}`, caseId: r.slot.caseId, status: observed.status, output: observed.output ? structuredClone(observed.output.answer) : null };
  });
  return { review: { format: 'anonymous-three-context-review-v1', reviewerInstruction: 'Score each axis against complete sources and prewritten fact qualifications. AI review is provisional; agreement is not ground truth.', cases: manifest.document.preparation.cases.map(c => ({ id: c.id, product: c.product, question: c.question, completeSources: c.completeSources, designatedFacts: c.designatedFacts, unknowns: c.referenceReview.unknowns })), answers, qualityClaimEligible: false }, mapping };
}

/** Recover observations only. This function has no transport or execution capability. */
export function recoverDiagnosticReceipts(manifest: ThreeContextManifest, checkpoint: DiagnosticCheckpoint, receipts: WorkspaceGenerationReceipt[]) {
  verifyDiagnosticCheckpoint(manifest, checkpoint); const recovered = structuredClone(checkpoint);
  for (const receipt of receipts) {
    const step = recovered.steps.find(s => s.attemptId === receipt.id); assert.ok(step && step.started && step.dispatchIntent);
    if (step.receipt) assert.deepEqual(step.receipt, receipt);
    else { replayWorkspaceGenerationReceipt(manifest.document.slots[step.index]!.input, receipt, 'live'); step.receipt = structuredClone(receipt); }
  }
  return { checkpoint: recovered, result: verifyDiagnosticCheckpoint(manifest, recovered) };
}
