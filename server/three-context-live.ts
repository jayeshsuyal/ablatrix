import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SapiomFeedbackProvider } from './feedback-provider.ts';
import { readLedgerAnchor, readSourceCalibrationLedgerState, type SourceCalibrationLedgerState } from './source-calibration-comparison.ts';
import { anonymousDiagnosticReview, diagnosticHash, DIAGNOSTIC_LEDGER, executeThreeContext, prepareThreeContext, recoverDiagnosticReceipts,
  verifyDiagnosticCheckpoint, verifyThreeContext, type DiagnosticCheckpoint, type DiagnosticPreparation, type ThreeContextManifest } from './three-context-diagnostic.ts';
import type { WorkspaceGenerationReceipt } from './workspace-generation.ts';

/** Required production byte bindings. Additional candidate/source producer files
 * may be bound too; no caller may omit any of the execution dependency closure. */
export const THREE_CONTEXT_LIVE_FILES = [
  'server/three-context-live.ts', 'scripts/three-context-live.ts', 'server/three-context-diagnostic.ts',
  'server/feedback-provider.ts', 'server/workspace-generation.ts', 'server/citation-options.ts', 'server/loop-types.ts',
  'server/source-calibration-comparison.ts', 'server/answer-review-source.ts', 'server/flat-source-comparison.ts',
  'server/context-comparison.ts', 'server/product-corpus.ts', 'server/product-retrieval.ts', 'server/workspace-retrieval-context.ts',
  'server/workspace-source-coverage.ts', 'server/retrieval-diagnosis.ts', 'server/semantic-reranker.ts',
  'package.json', 'package-lock.json'
] as const;
const encode = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const hashBytes = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export type ThreeContextLivePreparation = { repositoryPath: string; outputDirectory: string; diagnostic: DiagnosticPreparation };
export type ThreeContextLiveManifest = { format: 'ablatrix-three-context-live-plan-v1'; preparationPath: string; preparationFileSha256: string; preparation: ThreeContextLivePreparation; diagnostic: ThreeContextManifest; sha256: string };

function relativeFile(path: string) { assert.ok(path && !isAbsolute(path) && !path.split(/[\\/]/).some(part => part === '..' || part === '.') && path === path.replaceAll('\\', '/')); return path; }
function canonicalRepository(path: string) { assert.ok(isAbsolute(path) && resolve(path) === path && realpathSync(path) === path && lstatSync(path).isDirectory()); return path; }
function privatePath(path: string, repository: string) {
  const relativePath = relative(repository, path); assert.ok(isAbsolute(path) && path === resolve(path) && relativePath.startsWith('.data/') && !relativePath.split('/').includes('..'), 'Plans and executions must remain in this repository .data directory.');
  assert.equal(realpathSync(dirname(path)), dirname(path), 'Private output parents must already exist and be canonical.');
}
function canonicalFile(repository: string, path: string) {
  relativeFile(path); const absolute = resolve(repository, path);
  assert.ok(lstatSync(absolute).isFile() && !lstatSync(absolute).isSymbolicLink() && realpathSync(absolute) === absolute, 'Frozen inputs must be canonical regular files.'); return absolute;
}
/** Conservative relative-import closure, including type imports. This prevents
 * a new helper import from silently escaping the approved implementation map. */
export function requiredThreeContextLiveFiles(repository: string): string[] {
  const pending: string[] = [...THREE_CONTEXT_LIVE_FILES], seen = new Set<string>();
  while (pending.length) {
    const path = pending.pop()!; if (seen.has(path)) continue; seen.add(path);
    if (!path.endsWith('.ts')) continue;
    const text = readFileSync(canonicalFile(repository, path), 'utf8');
    for (const match of text.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)["'](\.{1,2}\/[^"']+)["']/g)) {
      const imported = relative(repository, resolve(repository, dirname(path), match[1]!)); relativeFile(imported); pending.push(imported);
    }
  }
  return [...seen].sort();
}
const ledgerProjection = (anchor: ReturnType<typeof readLedgerAnchor>): DiagnosticPreparation['ledger'] => ({ canonicalPath: anchor.canonicalPath, historicalRowsSha256: anchor.historicalRowsSha256, attempts: anchor.attempts, reservedUsd: anchor.reservedUsd, priorSpendUsd: anchor.priorSpendUsd, pending: anchor.pending, owners: anchor.owners });
function checkFreshLedger(manifest: ThreeContextLiveManifest) {
  const expected = manifest.preparation.diagnostic.ledger;
  assert.equal(expected.canonicalPath, DIAGNOSTIC_LEDGER); assert.equal(expected.priorSpendUsd, .200281);
  assert.deepEqual(ledgerProjection(readLedgerAnchor(DIAGNOSTIC_LEDGER, .200281)), expected, 'Refresh the actual canonical shared ledger; existing reservations cannot resume.');
}
export function prepareThreeContextLive(preparation: ThreeContextLivePreparation, preparationPath: string): ThreeContextLiveManifest {
  const p = structuredClone(preparation), repository = canonicalRepository(p.repositoryPath);
  privatePath(preparationPath, repository); privatePath(p.outputDirectory, repository);
  const required = Object.keys(p.diagnostic.implementationSha256); for (const path of requiredThreeContextLiveFiles(repository)) assert.ok(required.includes(path), `Missing frozen execution dependency: ${path}`);
  assert.equal(p.diagnostic.ledger.priorSpendUsd, .200281);
  const diagnostic = prepareThreeContext(p.diagnostic), document = { format: 'ablatrix-three-context-live-plan-v1' as const, preparationPath, preparationFileSha256: hashBytes(readFileSync(canonicalFile(repository, relative(repository, preparationPath)))), preparation: p, diagnostic };
  assert.deepEqual(JSON.parse(readFileSync(preparationPath, 'utf8')), p, 'Preparation must match its exact saved input.');
  const manifest = { ...document, sha256: diagnosticHash(document) }; checkThreeContextLiveFiles(manifest); return manifest;
}
export function verifyThreeContextLivePlan(manifest: ThreeContextLiveManifest) {
  const { sha256, ...document } = manifest; assert.equal(manifest.format, 'ablatrix-three-context-live-plan-v1'); assert.equal(sha256, diagnosticHash(document));
  verifyThreeContext(manifest.diagnostic); assert.deepEqual(manifest.diagnostic.document.preparation, manifest.preparation.diagnostic);
  canonicalRepository(manifest.preparation.repositoryPath); privatePath(manifest.preparation.outputDirectory, manifest.preparation.repositoryPath);
  for (const path of requiredThreeContextLiveFiles(manifest.preparation.repositoryPath)) assert.ok(Object.hasOwn(manifest.preparation.diagnostic.implementationSha256, path), `Missing frozen execution dependency: ${path}`);
  assert.equal(manifest.preparation.diagnostic.ledger.priorSpendUsd, .200281); return manifest;
}
export function checkThreeContextLiveFiles(manifest: ThreeContextLiveManifest, planPath?: string) {
  verifyThreeContextLivePlan(manifest); const p = manifest.preparation, repository = p.repositoryPath;
  for (const map of [p.diagnostic.implementationSha256, p.diagnostic.artifactSha256]) for (const [path, hash] of Object.entries(map)) assert.equal(hashBytes(readFileSync(canonicalFile(repository, path))), hash, `Frozen bytes changed: ${path}`);
  privatePath(manifest.preparationPath, repository); const prep = readFileSync(canonicalFile(repository, relative(repository, manifest.preparationPath)));
  assert.equal(hashBytes(prep), manifest.preparationFileSha256); assert.deepEqual(JSON.parse(prep.toString('utf8')), p);
  if (planPath) { privatePath(planPath, repository); assert.equal(readFileSync(canonicalFile(repository, relative(repository, planPath)), 'utf8'), encode(manifest), 'Frozen plan bytes changed.'); }
}
function syncDirectory(path: string) { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
function exclusive(path: string, content: string) {
  assert.equal(realpathSync(dirname(path)), dirname(path)); const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); } syncDirectory(dirname(path));
}
export function privateThreeContextOutput(directory: string, repository: string) {
  privatePath(directory, repository); let created = false;
  return {
    create() { privatePath(directory, repository); assert.ok(!existsSync(directory), 'Existing execution output cannot be overwritten or resumed.'); mkdirSync(directory, { mode: 0o700 }); syncDirectory(dirname(directory)); exclusive(resolve(directory, 'checkpoint.jsonl'), ''); created = true; },
    checkpoint(value: DiagnosticCheckpoint) { assert.ok(created && realpathSync(directory) === directory); const fd = openSync(resolve(directory, 'checkpoint.jsonl'), constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW); try { assert.ok(lstatSync(resolve(directory, 'checkpoint.jsonl')).isFile()); writeFileSync(fd, `${JSON.stringify(value)}\n`); fsyncSync(fd); } finally { closeSync(fd); } },
    finish(manifest: ThreeContextLiveManifest, checkpoint: DiagnosticCheckpoint) {
      assert.ok(created && realpathSync(directory) === directory); const review = anonymousDiagnosticReview(manifest.diagnostic, checkpoint, randomBytes(32).toString('hex'));
      exclusive(resolve(directory, 'result.json'), encode(threeContextLiveResult(manifest, checkpoint)));
      exclusive(resolve(directory, 'review.json'), encode(review.review)); exclusive(resolve(directory, 'arm-mapping.json'), encode(review.mapping));
    }
  };
}
/** Receipt usage can be known even when the output fails citation or model-arm
 * consistency checks. Unknown attempts never acquire an invented zero total. */
export function threeContextLiveResult(manifest: ThreeContextLiveManifest, checkpoint: DiagnosticCheckpoint) {
  verifyThreeContextLivePlan(manifest); const observed = verifyDiagnosticCheckpoint(manifest.diagnostic, checkpoint);
  let known = 0, inputTokens = 0, outputTokens = 0; const models = new Set<string>();
  for (const step of checkpoint.steps) {
    const receipt = step.receipt; if (!receipt || receipt.status !== 'completed' || !receipt.receipt_json) continue;
    try {
      const body = JSON.parse(receipt.receipt_json), slot = manifest.diagnostic.document.slots[step.index]!;
      for (const [key, value] of Object.entries(slot.binding)) assert.equal(body[key], value);
      assert.equal(body.mode, 'live'); assert.equal(body.accounting, 'local_planning_allowance'); assert.equal(body.model, receipt.model); assert.ok(['gpt-luna', 'gpt-5.6-luna'].includes(body.model)); models.add(body.model);
      assert.ok(body.usage && Number.isSafeInteger(body.usage.inputTokens) && body.usage.inputTokens >= 0 && Number.isSafeInteger(body.usage.outputTokens) && body.usage.outputTokens >= 0);
      assert.equal(receipt.input_tokens, body.usage.inputTokens); assert.equal(receipt.output_tokens, body.usage.outputTokens);
      known++; inputTokens += body.usage.inputTokens; outputTokens += body.usage.outputTokens;
    } catch { /* Unknown or mismatched receipt usage stays unknown. */ }
  }
  const attempts = checkpoint.steps.filter(s => s.attemptId).length, subtotal = { inputTokens, outputTokens }; assert.ok(Number.isSafeInteger(inputTokens) && Number.isSafeInteger(outputTokens));
  return { format: 'ablatrix-three-context-live-result-v1', planSha256: manifest.sha256, status: observed.completedAnswers === checkpoint.steps.length && !checkpoint.stopReason ? 'awaiting_independent_review' : 'stopped', transportProvenance: checkpoint.provenance,
    plannedAnswers: checkpoint.steps.length, newProviderAttempts: attempts, planningAllowanceReservedUsd: Math.round(attempts * 10) / 100,
    completedAnswers: observed.completedAnswers, failedOrUnknownAnswers: observed.outputs.filter(o => o.status === 'failed_or_unknown').length, unattemptedAnswers: observed.outputs.filter(o => o.status === 'not_attempted').length,
    networkDispatches: observed.networkDispatches, observedDispatches: observed.observedDispatches, transportInvocations: observed.transportInvocations, unresolvedDispatchIntents: observed.unresolvedDispatchIntents, remoteOutcomeUnknownAttempts: observed.remoteOutcomeUnknownAttempts,
    dispatchDefinition: 'transportInvocations/observedDispatches count local transport entry, not provider delivery. networkDispatches stays null for unresolved intent or intent without a bound completed provider receipt. Local receipt replay does not independently authenticate provider origin.',
    usage: known === attempts ? subtotal : null, knownUsageSubtotal: subtotal, attemptsWithKnownUsage: known, observedModels: [...models], retries: 0, graderCalls: 0, webCalls: 0,
    steps: checkpoint.steps.map((step, index) => { const duration = step.startedAt && step.observedAt ? Date.parse(step.observedAt) - Date.parse(step.startedAt) : null; return { index, status: observed.outputs[index]!.status, attemptDurationMs: duration, elapsedMs: observed.outputs[index]!.status === 'completed' ? duration : null }; }),
    qualityClaimEligible: false, activationAllowed: false, actualProviderCharges: 'unavailable', allowanceIsProviderCharge: false, stopReason: checkpoint.stopReason };
}
export function verifyThreeContextLiveCheckpoints(manifest: ThreeContextLiveManifest, checkpoints: DiagnosticCheckpoint[]) {
  assert.ok(checkpoints.length); let previous: DiagnosticCheckpoint | undefined;
  for (const checkpoint of checkpoints) {
    verifyDiagnosticCheckpoint(manifest.diagnostic, checkpoint);
    if (previous) {
      assert.equal(checkpoint.provenance, previous.provenance); if (previous.stopReason) assert.equal(checkpoint.stopReason, previous.stopReason);
      previous.steps.forEach((old, i) => { const next = checkpoint.steps[i]!;
        for (const key of ['started', 'dispatchIntent', 'dispatched'] as const) if (old[key]) assert.equal(next[key], old[key], 'Durable observations cannot disappear.');
        for (const key of ['startedAt', 'observedAt', 'attemptId', 'receipt'] as const) if (old[key] !== undefined) assert.deepEqual(next[key], old[key], 'Durable observations cannot be rewritten.');
      });
    }
    previous = checkpoint;
  }
  return threeContextLiveResult(manifest, checkpoints.at(-1)!);
}
/** Read-only canonical-ledger receipt reconciliation. No provider is constructed
 * and no attempt may be resumed or redispatched by this function. */
export function recoverThreeContextLive(manifest: ThreeContextLiveManifest, checkpoint: DiagnosticCheckpoint) {
  const state = readSourceCalibrationLedgerState(DIAGNOSTIC_LEDGER, .200281, manifest.diagnostic.document.slots.map(s => s.input.runId));
  return reconcileThreeContextLiveLedger(manifest, checkpoint, state);
}
export function reconcileThreeContextLiveLedger(manifest: ThreeContextLiveManifest, checkpoint: DiagnosticCheckpoint, state: SourceCalibrationLedgerState) {
  verifyThreeContextLivePlan(manifest); verifyDiagnosticCheckpoint(manifest.diagnostic, checkpoint); assert.equal(state.canonicalPath, DIAGNOSTIC_LEDGER); assert.equal(state.priorSpendUsd, .200281);
  const anchor = manifest.preparation.diagnostic.ledger; assert.equal(state.historicalRowsSha256, anchor.historicalRowsSha256); assert.equal(state.attempts, anchor.attempts + state.rows.length);
  assert.ok(Math.abs(state.reservedUsd - anchor.reservedUsd - state.rows.length * .1) < 1e-8);
  assert.ok(state.rows.every(row => checkpoint.steps.some(step => step.attemptId === row.id)), 'A reserved attempt lacks a durable checkpoint identity; reconcile manually without redispatch.');
  const receipts: WorkspaceGenerationReceipt[] = [];
  for (const step of checkpoint.steps) if (step.attemptId && step.dispatchIntent && !step.receipt) {
    const slot = manifest.diagnostic.document.slots[step.index]!, row = state.rows.find(r => r.id === step.attemptId && r.run_id === slot.input.runId); assert.ok(row && row.allowance_usd === .1);
    if (row.status === 'completed' && !row.error_code) receipts.push({ id: row.id, kind: row.kind, status: row.status, error_code: row.error_code, receipt_json: row.receipt_json, model: row.model, input_tokens: row.input_tokens, output_tokens: row.output_tokens, allowance_usd: row.allowance_usd });
  }
  const recovered = recoverDiagnosticReceipts(manifest.diagnostic, checkpoint, receipts);
  return { checkpoint: recovered.checkpoint, result: threeContextLiveResult(manifest, recovered.checkpoint), recoveredReceipts: receipts.length, newProviderCalls: 0, redispatchAllowed: false };
}

/** The actual production entry point has no injected provider/transport/runtime
 * mode override. It never loads .env and gates access to credential fields. */
export async function threeContextLiveCli(argv: string[], env: NodeJS.ProcessEnv = process.env) {
  if (!argv.length) return { usage: '--prepare --preparation FILE --out NEW | --verify --plan FILE [--checkpoint FILE] | --execute --plan FILE --approved-plan-sha256 HASH', newProviderCalls: 0 };
  const [command, ...rest] = argv, keys = command === '--prepare' ? ['--preparation', '--out'] : command === '--verify' ? ['--plan', '--checkpoint'] : command === '--execute' ? ['--plan', '--approved-plan-sha256'] : undefined;
  assert.ok(keys, 'Choose one supported mode.'); const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) { assert.ok(keys.includes(rest[i]!) && rest[i + 1] && !rest[i + 1]!.startsWith('--') && !flags.has(rest[i]!)); flags.set(rest[i]!, rest[i + 1]!); }
  assert.ok(keys.every(key => flags.has(key) || command === '--verify' && key === '--checkpoint'));
  const repository = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
  if (command === '--prepare') {
    const input = resolve(flags.get('--preparation')!), output = resolve(flags.get('--out')!); privatePath(input, repository); privatePath(output, repository);
    const preparation = JSON.parse(readFileSync(canonicalFile(repository, relative(repository, input)), 'utf8')) as ThreeContextLivePreparation; assert.equal(preparation.repositoryPath, repository);
    const manifest = prepareThreeContextLive(preparation, input); checkFreshLedger(manifest); exclusive(output, encode(manifest));
    return { mode: 'offline_preparation', planSha256: manifest.sha256, diagnosticPlanSha256: manifest.diagnostic.sha256, budget: manifest.diagnostic.document.paidPlan, stopReason: manifest.diagnostic.document.stopReason, newProviderCalls: 0, paidExecutionAuthorized: false };
  }
  const planPath = resolve(flags.get('--plan')!); privatePath(planPath, repository); const manifest = JSON.parse(readFileSync(canonicalFile(repository, relative(repository, planPath)), 'utf8')) as ThreeContextLiveManifest;
  assert.equal(manifest.preparation.repositoryPath, repository);
  if (command === '--execute') assert.ok(flags.get('--approved-plan-sha256') === manifest.sha256 && env.ABLATRIX_LOOP_LIVE === '1', 'Exact fresh financial approval and ABLATRIX_LOOP_LIVE=1 are required before credential access.');
  checkThreeContextLiveFiles(manifest, planPath);
  if (command === '--verify') {
    if (!flags.has('--checkpoint')) { checkFreshLedger(manifest); return { verified: true, planSha256: manifest.sha256, budget: manifest.diagnostic.document.paidPlan, newProviderCalls: 0, qualityClaimEligible: false }; }
    const checkpointPath = resolve(flags.get('--checkpoint')!); privatePath(checkpointPath, repository); const raw = readFileSync(canonicalFile(repository, relative(repository, checkpointPath)), 'utf8'); assert.ok(raw.endsWith('\n') && raw.trim());
    const checkpoints = raw.trimEnd().split('\n').map(line => JSON.parse(line) as DiagnosticCheckpoint), result = verifyThreeContextLiveCheckpoints(manifest, checkpoints);
    return { verified: true, savedResult: result, readOnlyRecovery: recoverThreeContextLive(manifest, checkpoints.at(-1)!), newProviderCalls: 0 };
  }
  assert.ok(manifest.diagnostic.document.paidPlan, 'No reviewed source benefit: no paid plan qualifies.'); checkFreshLedger(manifest);
  const output = privateThreeContextOutput(manifest.preparation.outputDirectory, repository), bindings = () => { checkThreeContextLiveFiles(manifest, planPath); return { implementationSha256: manifest.preparation.diagnostic.implementationSha256, artifactSha256: manifest.preparation.diagnostic.artifactSha256 }; };
  const executed = await executeThreeContext(manifest.diagnostic, { execute: true, liveOptIn: true, approvedSha256: manifest.diagnostic.sha256, provenance: 'live_router' }, {
    checkBindings: bindings, checkLedger: () => readSourceCalibrationLedgerState(DIAGNOSTIC_LEDGER, .200281, manifest.diagnostic.document.slots.map(s => s.input.runId)), create: output.create, checkpoint: output.checkpoint, transport: fetch,
    createProvider: hooks => new SapiomFeedbackProvider({ enabled: true, apiKey: env.SAPIOM_API_KEY, credentialsFile: env.SAPIOM_CREDENTIALS_FILE, dbPath: DIAGNOSTIC_LEDGER, capUsd: 20, priorSpendUsd: .200281, allowancePerCallUsd: .1, callLimit: manifest.diagnostic.document.paidPlan!.absoluteCallLimit, ...hooks })
  });
  output.finish(manifest, executed.checkpoint);
  return { status: threeContextLiveResult(manifest, executed.checkpoint).status, planSha256: manifest.sha256, outputDirectory: manifest.preparation.outputDirectory, newProviderAttempts: threeContextLiveResult(manifest, executed.checkpoint).newProviderAttempts, qualityClaimEligible: false };
}
