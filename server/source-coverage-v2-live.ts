import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareV2, SOURCE_COVERAGE_V2_FILES } from '../scripts/source-coverage-v2-retrieval.ts';
import { contextComparisonHash } from './context-comparison.ts';
import { SapiomFeedbackProvider, type FeedbackProviderOptions } from './feedback-provider.ts';
import { sourceCalibrationHash as hash, readLedgerAnchor, readSourceCalibrationLedgerState, SOURCE_CALIBRATION_CODE_FILES, type SourceCalibrationArtifact as Artifact, type SourceCalibrationLedgerAnchor as Anchor, type SourceCalibrationLedgerState as LedgerState } from './source-calibration-comparison.ts';
import { WORKSPACE_GENERATION_CONTRACT, workspaceGenerationParts, workspaceGenerationPromptIdentity, replayWorkspaceGenerationReceipt, type WorkspaceGenerationInput, type WorkspaceGenerationReceipt } from './workspace-generation.ts';
import type { LoopPolicy } from './loop-types.ts';

type Json = Record<string, any>;
type Arm = 'baseline' | 'candidate';
export const SOURCE_COVERAGE_V2_LEDGER = '/Users/jayeshsuyal/Documents/ChatGPT/Ablatrix/repo/.data/feedback-budget.sqlite';
export const SOURCE_COVERAGE_V2_LIVE_FILES = [...new Set([...SOURCE_COVERAGE_V2_FILES, ...SOURCE_CALIBRATION_CODE_FILES,
  'server/source-coverage-v2-live.ts', 'server/source-coverage-v2-live.test.ts', 'scripts/source-coverage-v2-live.ts'])].sort();
const encode = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const clone = <T>(value: T): T => structuredClone(value);
const digest = (value: string) => assert.match(value, /^[a-f0-9]{64}$/);
const rounded = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
export type SourceCoverageV2Preparation = {
  deck: Artifact; baseline: Artifact; sourceReview: Artifact; comparison: Artifact; analysisProtocol: Artifact;
  implementationSha256: Record<string, string>; policy: LoopPolicy; createdAt: string;
  ledgerAnchor: Anchor; repositoryPath: string; outputDirectory: string;
};
type Slot = { index: number; caseId: string; arm: Arm; input: WorkspaceGenerationInput;
  requestBody: ReturnType<typeof workspaceGenerationParts>['body']; binding: ReturnType<typeof workspaceGenerationParts>['binding'] };
function relativeFile(path: string) {
  assert.ok(path && !isAbsolute(path) && relative('/', resolve('/', path)) === path && !path.includes('\\'), 'Bound files must have canonical repository-relative paths.'); return path;
}
function privatePath(path: string, repository: string) {
  const rel = relative(resolve(repository, '.data'), path);
  assert.ok(isAbsolute(path) && resolve(path) === path && rel && !rel.startsWith('..') && !isAbsolute(rel), 'Use a canonical private .data path.');
}
/** Include every nested raw input wrapper in the deck, not just detached seals. */
function artifacts(preparation: SourceCoverageV2Preparation) {
  const found = new Map<string, Artifact>();
  const visit = (value: any) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.path === 'string' && typeof value.fileSha256 === 'string' && value.document && typeof value.document === 'object') {
      assert.deepEqual(Object.keys(value).sort(), ['document', 'fileSha256', 'path']); relativeFile(value.path); digest(value.fileSha256);
      if (found.has(value.path)) assert.deepEqual(found.get(value.path), value, 'Two bound artifact wrappers disagree.'); else found.set(value.path, value);
    }
    for (const child of Object.values(value)) visit(child);
  };
  for (const value of [preparation.deck, preparation.baseline, preparation.sourceReview, preparation.comparison, preparation.analysisProtocol]) visit(value);
  return [...found.values()];
}

/** Pure preparation: no ledger, credentials, environment or network are opened.
 * All twelve products remain, including candidate misses and unchanged pairs. */
export function prepareSourceCoverageV2Live(raw: SourceCoverageV2Preparation) {
  const p = clone(raw), deck = p.deck.document;
  assert.ok(isAbsolute(p.repositoryPath) && resolve(p.repositoryPath) === p.repositoryPath); privatePath(p.outputDirectory, p.repositoryPath);
  assert.ok(Number.isFinite(Date.parse(p.createdAt))); assert.equal(p.policy.mode, 'live'); assert.ok(p.policy.instructions.length >= 40);
  assert.deepEqual(Object.keys(p.implementationSha256).sort(), SOURCE_COVERAGE_V2_LIVE_FILES);
  for (const [path, sha] of Object.entries(p.implementationSha256)) { relativeFile(path); digest(sha); }
  assert.equal(deck.format, 'ablatrix-source-coverage-v2-deck-v1');
  assert.equal(p.analysisProtocol.path, 'docs/evidence/retrieval-source-coverage-v2-2026-10-18/analysis-protocol-v1.json');
  assert.equal(p.analysisProtocol.document.format, 'ablatrix-source-coverage-v2-analysis-protocol-v1');
  assert.equal(p.analysisProtocol.document.createdBeforeFreshSelection, true);
  assert.equal(p.analysisProtocol.document.deck.products, 12); assert.equal(p.analysisProtocol.document.deck.evaluateAllTwelve, true);
  assert.equal(p.analysisProtocol.document.comparison.answerContract, WORKSPACE_GENERATION_CONTRACT);
  assert.equal(p.analysisProtocol.document.paidEligibility.maximumAnswerCalls, 24);
  assert.equal(p.analysisProtocol.document.paidEligibility.noPaidCallsUntilExactFreshFinancialApproval, true);
  assert.equal(p.analysisProtocol.document.qualityClaimEligible, false); assert.equal(p.analysisProtocol.document.paidExecutionAuthorized, false);
  const { deckSha256, ...deckBody } = deck; assert.equal(deckSha256, contextComparisonHash(deckBody));
  assert.equal(deck.candidateFreeze.document.generationContract, WORKSPACE_GENERATION_CONTRACT);
  assert.equal(deck.candidateFreeze.document.systemInstructionsSha256, workspaceGenerationPromptIdentity().systemInstructionsSha256);
  assert.deepEqual(Object.keys(deck.candidateFreeze.document.implementationSha256).sort(), [...SOURCE_COVERAGE_V2_FILES].sort());
  for (const [path, sha] of Object.entries(deck.candidateFreeze.document.implementationSha256)) assert.equal(p.implementationSha256[path], sha, 'The live adapter cannot change frozen retrieval or generation code.');
  for (const key of ['generationPerformed', 'candidateContextInspected', 'paidExecutionAuthorized', 'qualityClaimEligible']) assert.equal(deck.status[key], false);
  const checkedArtifacts = artifacts(p), occupied = new Set(Object.keys(p.implementationSha256));
  for (const artifact of checkedArtifacts) { assert.ok(!occupied.has(artifact.path), 'A bound artifact cannot replace code or another artifact.'); occupied.add(artifact.path); }
  const comparison = compareV2(p.deck, p.baseline, p.sourceReview);
  assert.deepEqual(p.comparison.document, comparison, 'Replay the exact independently reviewed source-only comparison.');
  assert.equal(comparison.summary.sourceOnlyPaidEligibility, true, 'Paid preparation needs a supported gap, two complete controls and a designated missing fact delivered by an added literal source.');
  const anchor = p.ledgerAnchor;
  assert.equal(anchor.canonicalPath, SOURCE_COVERAGE_V2_LEDGER, 'Use the existing project-wide ledger, never a checkout-local empty ledger.');
  assert.equal(anchor.pathSha256, hash(anchor.canonicalPath)); digest(anchor.historicalRowsSha256);
  assert.equal(anchor.attempts, 138); assert.ok(Math.abs(anchor.reservedUsd - 13.8) < 1e-8); assert.equal(anchor.priorSpendUsd, .200281);
  assert.equal(anchor.pending, 0); assert.equal(anchor.owners, 0);
  const experimentId = hash({ deck: p.deck.fileSha256, comparison: p.comparison.fileSha256, anchor, createdAt: p.createdAt }).slice(0, 24);
  const slots: Slot[] = [];
  for (const [index, item] of deck.cases.entries()) {
    assert.match(item.id, /^[A-Za-z0-9_-]{1,120}$/); assert.ok(item.question.trim() && item.question.length <= 500);
    const row = comparison.results[index], pair: Slot[] = [];
    for (const arm of (index % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) as Arm[]) {
      const input: WorkspaceGenerationInput = { runId: `source-coverage-v2-${experimentId}-${index}-${arm}`, generationContract: WORKSPACE_GENERATION_CONTRACT,
        question: item.question, product: { ...item.product, split: 'validation' }, policy: p.policy, passages: row[arm].passages };
      const parts = workspaceGenerationParts(input);
      pair.push({ index: slots.length + pair.length, caseId: item.id, arm, input: parts.input, requestBody: parts.body, binding: parts.binding });
    }
    const common = (slot: Slot) => {
      const body = clone(slot.requestBody), payload = JSON.parse(body.messages[1]!.content);
      delete payload.operationRunId; delete payload.evidence; delete payload.quoteOptions;
      body.messages[1]!.content = JSON.stringify(payload); (body.tools[0]!.function.parameters as any).properties.citations.items.enum = [];
      return body;
    };
    assert.deepEqual(common(pair[0]!), common(pair[1]!), 'Both arms must share the same answer prompt, model, parameters, policy, tool and schema, except derived citation IDs.'); slots.push(...pair);
  }
  assert.equal(slots.length, 24);
  const plan = { format: 'ablatrix-source-coverage-v2-live-plan-v1', preparation: p, slots,
    budget: { maximumNewAttempts: 24, maximumAdditionalPlanningUsd: 2.4, absoluteCallLimit: 162, allowancePerCallUsd: .1, capUsd: 20,
      previousCombinedPlanningUsd: rounded(anchor.reservedUsd + anchor.priorSpendUsd), maximumCombinedPlanningUsd: rounded(anchor.reservedUsd + anchor.priorSpendUsd + 2.4), allowancesAreProviderCharges: false },
    retainedCases: deck.cases.map((item: Json, index: number) => ({ caseId: item.id, sourceGapGroup: comparison.results[index].sourceGapGroup, changedContext: comparison.results[index].additions.length > 0 })),
    retries: 0, revisions: 0, graderCalls: 0, webCalls: 0, activationAllowed: false, humanJudgments: 0, qualityClaimEligible: false, paidExecutionAuthorized: false } as const;
  assert.ok(plan.budget.maximumCombinedPlanningUsd <= plan.budget.capUsd);
  return { plan, planSha256: hash(plan) };
}
export type SourceCoverageV2Manifest = ReturnType<typeof prepareSourceCoverageV2Live>;
export function verifySourceCoverageV2Plan(manifest: SourceCoverageV2Manifest) {
  assert.equal(manifest.planSha256, hash(manifest.plan)); assert.deepEqual(manifest, prepareSourceCoverageV2Live(manifest.plan.preparation)); return manifest;
}
type Step = { index: number; started: boolean; dispatched: boolean; dispatchIntent?: true; startedAt?: string; observedAt?: string; attemptId?: string; receipt?: WorkspaceGenerationReceipt; receiptSha256?: string };
export type SourceCoverageV2Checkpoint = { format: 'source-coverage-v2-checkpoint-v1'; planSha256: string; steps: Step[]; stopReason: string | null; transportProvenance: 'live_router' | 'mocked_mechanics_only' };
// A locally rejected answer can still carry independently bound observed tokens.
// Preserve that subtotal without treating unknown attempts as zero usage.
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
export function verifySourceCoverageV2Result(manifest: SourceCoverageV2Manifest, checkpoint: SourceCoverageV2Checkpoint) {
  verifySourceCoverageV2Plan(manifest); assert.equal(checkpoint.format, 'source-coverage-v2-checkpoint-v1'); assert.equal(checkpoint.planSha256, manifest.planSha256); assert.equal(checkpoint.steps.length, 24);
  assert.ok(['live_router', 'mocked_mechanics_only'].includes(checkpoint.transportProvenance));
  let stopped = false, model: string | undefined;
  const models = new Set<string>();
  const steps = checkpoint.steps.map((step, index) => {
    const slot = manifest.plan.slots[index]!;
    assert.equal(step.index, index); assert.ok(!step.dispatched || step.started && step.attemptId && step.dispatchIntent); assert.ok(!step.attemptId || step.started); assert.ok(!step.dispatchIntent || step.started && step.attemptId);
    assert.equal(Boolean(step.startedAt), step.started); if (step.startedAt) assert.ok(Number.isFinite(Date.parse(step.startedAt))); if (step.observedAt) assert.ok(step.startedAt && Date.parse(step.observedAt) >= Date.parse(step.startedAt));
    if (stopped) assert.equal(step.started, false, 'No later call is permitted after an invalid or uncertain answer.');
    const common = { index, caseId: slot.caseId, arm: slot.arm, startedAt: step.startedAt ?? null, observedAt: step.observedAt ?? null,
      attemptDurationMs: step.startedAt && step.observedAt ? Date.parse(step.observedAt) - Date.parse(step.startedAt) : null };
    if (!step.started) { stopped = true; assert.ok(!step.receipt && !step.dispatched && !step.attemptId && !step.observedAt); return { ...common, status: 'not_attempted' as const, output: undefined, elapsedMs: null }; }
    if (!step.receipt) { stopped = true; return { ...common, status: 'failed_or_unknown' as const, output: undefined, elapsedMs: null }; }
    assert.equal(step.receiptSha256, hash(step.receipt)); assert.equal(step.receipt.id, step.attemptId); assert.equal(step.receipt.kind, workspaceGenerationPromptIdentity().tool); assert.equal(step.receipt.allowance_usd, .1);
    let output: ReturnType<typeof replayWorkspaceGenerationReceipt> | undefined;
    try { output = replayWorkspaceGenerationReceipt(slot.input, step.receipt, 'live'); } catch { /* Preserve failures and unknown outcomes without retry. */ }
    if (output) models.add(output.model);
    if (!output || !step.dispatched || !step.observedAt || model && model !== output.model) { stopped = true; return { ...common, status: 'failed_or_unknown' as const, output: undefined, elapsedMs: null }; }
    model = output.model;
    return { ...common, status: 'completed' as const, output, elapsedMs: Date.parse(step.observedAt) - Date.parse(step.startedAt!) };
  });
  const attempts = checkpoint.steps.filter(step => step.attemptId).length;
  const usages = checkpoint.steps.flatMap((step, index) => { const usage = observedUsage(manifest.plan.slots[index]!, step.receipt); return usage ? [usage] : []; });
  const knownUsageSubtotal = usages.reduce((sum, usage) => ({ inputTokens: sum.inputTokens + usage.inputTokens, outputTokens: sum.outputTokens + usage.outputTokens }), { inputTokens: 0, outputTokens: 0 });
  assert.ok(Number.isSafeInteger(knownUsageSubtotal.inputTokens) && Number.isSafeInteger(knownUsageSubtotal.outputTokens));
  return { format: 'source-coverage-v2-result-v1', planSha256: manifest.planSha256, status: steps.every(step => step.status === 'completed') && !checkpoint.stopReason ? 'awaiting_independent_review' : 'stopped',
    transportProvenance: checkpoint.transportProvenance, plannedCases: 12, plannedAnswers: 24, newProviderAttempts: attempts, networkDispatches: checkpoint.steps.some(step => step.dispatchIntent && !step.dispatched) ? null : checkpoint.steps.filter(step => step.dispatched).length,
    observedNetworkDispatches: checkpoint.steps.filter(step => step.dispatched).length, unresolvedDispatchIntents: checkpoint.steps.filter(step => step.dispatchIntent && !step.dispatched).length,
    planningAllowanceReservedUsd: rounded(attempts * .1), allowanceIsProviderCharge: false, actualProviderCharges: 'unavailable', completedAnswers: steps.filter(step => step.status === 'completed').length,
    usage: usages.length === attempts ? knownUsageSubtotal : null, knownUsageSubtotal, attemptsWithKnownUsage: usages.length,
    completedPairs: manifest.plan.retainedCases.filter((item: Json) => steps.filter(step => step.caseId === item.caseId && step.status === 'completed').length === 2).length,
    retainedCases: manifest.plan.retainedCases, observedModels: [...models], modelIdentityConsistent: models.size <= 1, steps, retries: 0, revisions: 0, graderCalls: 0, webCalls: 0, activationAllowed: false,
    humanJudgments: 0, qualityClaimEligible: false, timingDefinition: 'Local operation duration includes guards and receipt handling; it is not provider-only latency. Failed attempts retain attemptDurationMs when observation timing is known.',
    limitation: 'Local structural receipt replay does not authenticate provider origin or establish answer quality. All twelve cases, misses and unchanged contexts remain in the denominator. Unknown provider usage is null, not zero.' };
}
export function verifySourceCoverageV2Checkpoints(manifest: SourceCoverageV2Manifest, checkpoints: SourceCoverageV2Checkpoint[]) {
  assert.ok(checkpoints.length > 0); let previous: SourceCoverageV2Checkpoint | undefined;
  for (const value of checkpoints) {
    verifySourceCoverageV2Result(manifest, value);
    if (previous) {
      assert.equal(value.transportProvenance, previous.transportProvenance); if (previous.stopReason) assert.equal(value.stopReason, previous.stopReason);
      for (const [index, old] of previous.steps.entries()) {
        const next = value.steps[index]!;
        for (const key of ['started', 'dispatchIntent', 'dispatched'] as const) if (old[key]) assert.equal(next[key], old[key]);
        for (const key of ['startedAt', 'observedAt', 'attemptId', 'receipt', 'receiptSha256'] as const) if (old[key] !== undefined) assert.deepEqual(next[key], old[key], 'Durable observations cannot be removed or rewritten.');
      }
    }
    previous = value;
  }
  return verifySourceCoverageV2Result(manifest, checkpoints.at(-1)!);
}
type Guard = NonNullable<FeedbackProviderOptions['operationGuard']>;
type Provider = Pick<SapiomFeedbackProvider, 'answerWorkspace' | 'receipt' | 'capacity' | 'close' | 'executionMode'>;
export type SourceCoverageV2Dependencies = {
  checkFrozenFiles(): void; readLedger(): LedgerState; createProvider(hooks: { fetchImpl: typeof fetch; operationGuard: Guard }): Provider; transport: typeof fetch;
  output: { create(): void; checkpoint(value: SourceCoverageV2Checkpoint): void; finish(result: ReturnType<typeof verifySourceCoverageV2Result>, review: ReturnType<typeof sourceCoverageV2Worksheet>): void };
};
const receiptProjection = (row: LedgerState['rows'][number]): WorkspaceGenerationReceipt => ({ id: row.id, kind: row.kind, status: row.status, model: row.model,
  input_tokens: row.input_tokens ?? null, output_tokens: row.output_tokens ?? null, error_code: row.error_code, receipt_json: row.receipt_json, allowance_usd: row.allowance_usd });
export async function executeSourceCoverageV2Live(manifest: SourceCoverageV2Manifest, options: { execute: boolean; liveOptIn: boolean; approvedPlanSha256: string; transportProvenance: SourceCoverageV2Checkpoint['transportProvenance'] }, dependencies: SourceCoverageV2Dependencies) {
  assert.ok(options.execute === true && options.liveOptIn === true && options.approvedPlanSha256 === manifest.planSha256, 'Exact fresh plan approval, --execute and ABLATRIX_LOOP_LIVE=1 are required before credentials or provider construction.');
  verifySourceCoverageV2Plan(manifest); const anchor = manifest.plan.preparation.ledgerAnchor;
  const checkpoint: SourceCoverageV2Checkpoint = { format: 'source-coverage-v2-checkpoint-v1', planSha256: manifest.planSha256, steps: manifest.plan.slots.map(slot => ({ index: slot.index, started: false, dispatched: false })), stopReason: null, transportProvenance: options.transportProvenance };
  let active: { slot: Slot; before: boolean } | undefined, owner: string | undefined, provider: Provider | undefined;
  const inspect = () => {
    verifySourceCoverageV2Plan(manifest); dependencies.checkFrozenFiles(); const state = dependencies.readLedger();
    for (const key of ['canonicalPath', 'pathSha256', 'historicalRowsSha256', 'priorSpendUsd'] as const) assert.equal(state[key], anchor[key]);
    const reserved = checkpoint.steps.filter(step => step.attemptId); assert.equal(state.attempts, 138 + reserved.length); assert.ok(Math.abs(state.reservedUsd - anchor.reservedUsd - reserved.length * .1) < 1e-8); assert.equal(state.rows.length, reserved.length);
    for (const step of reserved) {
      const slot = manifest.plan.slots[step.index]!, rows = state.rows.filter(row => row.run_id === slot.input.runId); assert.equal(rows.length, 1);
      const row = rows[0]!; assert.equal(row.id, step.attemptId); assert.equal(row.allowance_usd, .1); assert.equal(row.kind, workspaceGenerationParts(slot.input).tool);
      if (step.receipt) assert.equal(hash(receiptProjection(row)), step.receiptSha256);
      else { assert.equal(row.status, 'pending'); assert.equal(row.error_code, null); const binding = JSON.parse(row.receipt_json!); for (const [key, value] of Object.entries(slot.binding)) assert.equal(binding[key], value); }
    }
    assert.equal(state.pending, state.rows.filter(row => row.status === 'pending').length); assert.ok(state.pending <= (active ? 1 : 0));
    if (!reserved.length) assert.equal(state.owners, 0);
    else { assert.equal(state.owners, 1); assert.equal(state.ownerRows[0]!.pid, process.pid); assert.ok(state.ownerRows[0]!.expires_at > Date.now()); owner ??= state.ownerRows[0]!.token; assert.equal(state.ownerRows[0]!.token, owner); }
    return state;
  };
  inspect(); dependencies.output.create(); dependencies.output.checkpoint(clone(checkpoint)); inspect();
  const guard: Guard = async operation => {
    assert.ok(active && operation.kind === workspaceGenerationParts(active.slot.input).tool && operation.runId === active.slot.input.runId && operation.requestSha256 === active.slot.binding.requestSha256, 'Unexpected provider operation.');
    const step = checkpoint.steps[active.slot.index]!;
    if (operation.phase === 'before_reservation') { assert.ok(!active.before && !step.attemptId); inspect(); active.before = true; }
    else { assert.ok(active.before && !step.attemptId && operation.attemptId); step.attemptId = operation.attemptId; dependencies.output.checkpoint(clone(checkpoint)); inspect(); }
  };
  const bounded: typeof fetch = async (url, init) => {
    const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url; assert.ok(active);
    const step = checkpoint.steps[active.slot.index]!;
    assert.ok(active.before && step.attemptId && !step.dispatched && target === 'https://router.sapiom.ai/v1/chat/completions' && init?.method === 'POST' && init.body === JSON.stringify(active.slot.requestBody), 'Transport must match the one frozen request exactly once.');
    inspect(); step.dispatchIntent = true; dependencies.output.checkpoint(clone(checkpoint)); let response: Response | undefined;
    try { step.dispatched = true; response = await dependencies.transport(target, { ...init, redirect: 'error', signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000) }); return response; }
    finally { try { inspect(); } catch (error) { await response?.body?.cancel(); throw error; } }
  };
  try {
    provider = dependencies.createProvider({ fetchImpl: bounded, operationGuard: guard }); assert.equal(provider.executionMode, 'live'); assert.ok(provider.capacity(24).ready);
    for (const slot of manifest.plan.slots) {
      active = { slot, before: false }; const step = checkpoint.steps[slot.index]!; inspect(); step.started = true; step.startedAt = new Date().toISOString(); dependencies.output.checkpoint(clone(checkpoint));
      try { await provider.answerWorkspace(clone(slot.input)); } catch { /* Receipt decides. Ambiguous outcomes are never retried. */ }
      step.observedAt = new Date().toISOString();
      const state = dependencies.readLedger(), rows = state.rows.filter(row => row.run_id === slot.input.runId), receipt = provider.receipt(slot.input.runId);
      assert.equal(rows.length, receipt ? 1 : 0); if (receipt) { assert.equal(hash(receipt), hash(receiptProjection(rows[0]!))); step.receipt = clone(receipt); step.receiptSha256 = hash(receipt); }
      inspect(); const derived = verifySourceCoverageV2Result(manifest, checkpoint); dependencies.output.checkpoint(clone(checkpoint));
      if (derived.steps[slot.index]!.status !== 'completed') { checkpoint.stopReason = 'first_invalid_or_unknown_answer'; break; } active = undefined;
    }
  } catch { checkpoint.stopReason = 'frozen_boundary_or_execution_failed'; }
  finally { provider?.close(); }
  dependencies.output.checkpoint(clone(checkpoint)); const result = verifySourceCoverageV2Result(manifest, checkpoint); dependencies.output.finish(result, sourceCoverageV2Worksheet(manifest, checkpoint)); return { result, checkpoint };
}
export function sourceCoverageV2Worksheet(manifest: SourceCoverageV2Manifest, checkpoint: SourceCoverageV2Checkpoint) {
  const result = verifySourceCoverageV2Result(manifest, checkpoint), mapping: Json[] = [];
  const quote = (text: string) => text.split('\n').map(line => `> ${line}`).join('\n');
  const lines = ['# Anonymous source coverage answer review', '', 'Check support, completeness, exact model/workflow scope, citation relevance and unnecessary wording against every saved source. Prefer A/B/tie/neither with reasons. No judgments are assigned. Unavailable answers remain in the denominator.', ''];
  for (const item of manifest.plan.preparation.deck.document.cases) {
    lines.push(`## ${item.id}`, '', quote(item.question), '', quote(item.product.title), '');
    const order: Arm[] = parseInt(hash(`${manifest.planSha256}:${item.id}`).slice(0, 2), 16) % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
    for (const [index, arm] of order.entries()) {
      const step = result.steps.find(step => step.caseId === item.id && step.arm === arm)!, label = index ? 'B' : 'A'; mapping.push({ caseId: item.id, label, arm, slotIndex: step.index });
      lines.push(`### Answer ${label}`, '', step.output ? quote(step.output.answer.answer) : `Unavailable (${step.status}); retained in the planned denominator.`, '');
      for (const citation of step.output?.answer.citations ?? []) lines.push(`Source ${citation.passageId}`, quote(citation.quote), '');
    }
    lines.push('### Complete saved sources', '');
    for (const source of item.sources) lines.push(`Source ${source.id} — ${source.label}`, '', ...(source.originalQuestion ? ['Original customer question:', quote(source.originalQuestion), ''] : []), quote(source.text), '', `Reference: ${source.reference}`, '');
  }
  return { worksheet: `${lines.join('\n')}\n`, armMapping: { planSha256: manifest.planSha256, mapping } };
}
const syncDirectory = (path: string) => { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } };
function exclusive(path: string, value: string) {
  assert.equal(realpathSync(dirname(path)), dirname(path)); const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); } syncDirectory(dirname(path));
}
export function privateSourceCoverageV2Output(directory: string, repository: string): SourceCoverageV2Dependencies['output'] {
  privatePath(directory, repository); let created = false;
  return {
    create() { assert.equal(realpathSync(dirname(directory)), dirname(directory)); assert.ok(!existsSync(directory), 'Existing executions cannot be overwritten or resumed, including under a new approval.'); mkdirSync(directory, { mode: 0o700 }); syncDirectory(dirname(directory)); exclusive(resolve(directory, 'checkpoint.jsonl'), ''); created = true; },
    checkpoint(value) { assert.ok(created && realpathSync(directory) === directory); const fd = openSync(resolve(directory, 'checkpoint.jsonl'), constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW); try { writeFileSync(fd, `${JSON.stringify(value)}\n`); fsyncSync(fd); } finally { closeSync(fd); } },
    finish(result, review) { assert.ok(created); exclusive(resolve(directory, 'result.json'), encode(result)); exclusive(resolve(directory, 'review.md'), review.worksheet); exclusive(resolve(directory, 'arm-mapping.json'), encode(review.armMapping)); }
  };
}
function canonicalFile(repository: string, path: string) {
  relativeFile(path); const absolute = resolve(repository, path); assert.ok(lstatSync(absolute).isFile() && !lstatSync(absolute).isSymbolicLink() && realpathSync(absolute) === absolute, 'Frozen inputs must be canonical regular files.'); return absolute;
}
/** Byte checks plus the producer's canonical independent deck/protection replay.
 * Called before preparation, verification, execution and every dispatch boundary. */
export function checkSourceCoverageV2Files(manifest: SourceCoverageV2Manifest, manifestPath?: string) {
  const p = manifest.plan.preparation;
  for (const [path, sha] of Object.entries(p.implementationSha256)) assert.equal(hash(readFileSync(canonicalFile(p.repositoryPath, path))), sha, `Frozen implementation changed: ${path}`);
  for (const artifact of artifacts(p)) {
    const bytes = readFileSync(canonicalFile(p.repositoryPath, artifact.path)); assert.equal(hash(bytes), artifact.fileSha256); assert.deepEqual(JSON.parse(bytes.toString('utf8')), artifact.document);
  }
  if (manifestPath) { privatePath(manifestPath, p.repositoryPath); assert.equal(readFileSync(canonicalFile(p.repositoryPath, relative(p.repositoryPath, manifestPath)), 'utf8'), encode(manifest), 'Frozen plan bytes changed.'); }
  const verified = JSON.parse(execFileSync('python3', ['-I', 'scripts/prepare-source-coverage-v2-deck.py', '--verify-deck', p.deck.path],
    { cwd: p.repositoryPath, env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 30_000, maxBuffer: 1_048_576 }));
  assert.equal(verified.mode, 'verified_source_only_deck'); assert.equal(verified.newProviderCalls, 0); assert.equal(verified.deckFileSha256, p.deck.fileSha256);
}
/** No .env loading and no injected production transport/provider flags. */
export async function sourceCoverageV2LiveCli(argv: string[], env: NodeJS.ProcessEnv = process.env) {
  if (!argv.length) return { mode: 'offline', usage: '--prepare --preparation FILE --out NEW | --verify --plan FILE [--checkpoint FILE] | --execute --plan FILE --approved-plan-sha256 HASH', newProviderCalls: 0 };
  const [command, ...rest] = argv;
  const keys = command === '--prepare' ? ['--preparation', '--out'] : command === '--verify' ? ['--plan', '--checkpoint'] : command === '--execute' ? ['--plan', '--approved-plan-sha256'] : undefined;
  assert.ok(keys, 'Choose exactly one supported mode.'); const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) { assert.ok(keys.includes(rest[index]!) && rest[index + 1] && !rest[index + 1]!.startsWith('--') && !flags.has(rest[index]!)); flags.set(rest[index]!, rest[index + 1]!); }
  assert.ok(keys.every(key => flags.has(key) || command === '--verify' && key === '--checkpoint'));
  const read = (flag: string) => JSON.parse(readFileSync(flags.get(flag)!, 'utf8'));
  if (command === '--prepare') {
    const prep = read('--preparation') as SourceCoverageV2Preparation; privatePath(resolve(flags.get('--preparation')!), prep.repositoryPath); privatePath(resolve(flags.get('--out')!), prep.repositoryPath);
    assert.deepEqual(readLedgerAnchor(prep.ledgerAnchor.canonicalPath, prep.ledgerAnchor.priorSpendUsd), prep.ledgerAnchor, 'Freeze the current canonical ledger anchor.');
    const manifest = prepareSourceCoverageV2Live(prep); checkSourceCoverageV2Files(manifest); exclusive(resolve(flags.get('--out')!), encode(manifest));
    return { mode: 'offline_preparation', planSha256: manifest.planSha256, budget: manifest.plan.budget, newProviderCalls: 0, paidExecutionAuthorized: false };
  }
  const manifest = read('--plan') as SourceCoverageV2Manifest;
  if (command === '--execute') assert.ok(flags.get('--approved-plan-sha256') === manifest.planSha256 && env.ABLATRIX_LOOP_LIVE === '1', 'Exact approval and live opt-in must precede credential access.');
  verifySourceCoverageV2Plan(manifest); checkSourceCoverageV2Files(manifest, resolve(flags.get('--plan')!));
  if (command === '--verify') {
    if (!flags.has('--checkpoint')) {
      const anchor = manifest.plan.preparation.ledgerAnchor; assert.deepEqual(readLedgerAnchor(anchor.canonicalPath, anchor.priorSpendUsd), anchor, 'The current ledger changed; this plan cannot begin or resume.');
      return { verified: true, planSha256: manifest.planSha256, budget: manifest.plan.budget, newProviderCalls: 0, qualityClaimEligible: false };
    }
    const raw = readFileSync(flags.get('--checkpoint')!, 'utf8'); assert.ok(raw.endsWith('\n'));
    return verifySourceCoverageV2Checkpoints(manifest, raw.trimEnd().split('\n').map(line => JSON.parse(line)));
  }
  const prep = manifest.plan.preparation, repository = resolve(fileURLToPath(new URL('../', import.meta.url))); assert.equal(realpathSync(prep.repositoryPath), realpathSync(repository));
  const executed = await executeSourceCoverageV2Live(manifest, { execute: true, liveOptIn: true, approvedPlanSha256: flags.get('--approved-plan-sha256')!, transportProvenance: 'live_router' }, {
    checkFrozenFiles: () => checkSourceCoverageV2Files(manifest, resolve(flags.get('--plan')!)), readLedger: () => readSourceCalibrationLedgerState(prep.ledgerAnchor.canonicalPath, prep.ledgerAnchor.priorSpendUsd, manifest.plan.slots.map(slot => slot.input.runId)),
    output: privateSourceCoverageV2Output(prep.outputDirectory, prep.repositoryPath), transport: fetch,
    createProvider: hooks => new SapiomFeedbackProvider({ enabled: true, apiKey: env.SAPIOM_API_KEY, credentialsFile: env.SAPIOM_CREDENTIALS_FILE, dbPath: prep.ledgerAnchor.canonicalPath,
      capUsd: 20, priorSpendUsd: .200281, allowancePerCallUsd: .1, callLimit: 162, ...hooks })
  });
  return { status: executed.result.status, planSha256: manifest.planSha256, outputDirectory: prep.outputDirectory, newProviderAttempts: executed.result.newProviderAttempts, qualityClaimEligible: false };
}
