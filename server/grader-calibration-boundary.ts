import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { inspectDiagnosticApp } from './source-id-diagnostic.ts';
import { CALIBRATION_BUDGET, calibrationHash, type CalibrationPlan } from './grader-calibration.ts';
import type { SapiomFeedbackProvider } from './feedback-provider.ts';

export const CALIBRATION_CODE_FILES = [
  'server/grader-calibration.ts', 'server/grader-calibration-fixtures.ts', 'server/grader-calibration-runner.ts',
  'server/grader-calibration-boundary.ts', 'scripts/grader-calibration.ts', 'server/claim-support.ts',
  'server/feedback-provider.ts', 'server/citation-options.ts', 'server/source-id-diagnostic.ts'
] as const;
export const calibrationRepository = fileURLToPath(new URL('../', import.meta.url));
export const calibrationSharedBudgetPath = resolve(calibrationRepository, '../repo/.data/feedback-budget.sqlite');

/** Validate metadata only, before the provider reads credential contents. */
export function calibrationCredentialOptions(env: NodeJS.ProcessEnv,
  projectRoot = resolve(calibrationRepository, '..'), accountFile = resolve(homedir(), '.sapiom/credentials.json')) {
  if (env.SAPIOM_API_KEY?.trim()) return { apiKey: env.SAPIOM_API_KEY, credentialsFile: '', source: 'explicit_environment' as const };
  const configured = env.SAPIOM_CREDENTIALS_FILE;
  assert.ok(configured && isAbsolute(configured) && configured === resolve(configured), 'An explicit canonical project or Sapiom account credential source is required.');
  assert.ok(configured.startsWith(`${projectRoot}/`) || configured === accountFile, 'Calibration cannot read a credential file from an unrelated repository.');
  canonicalPath(configured, true);
  return { apiKey: '', credentialsFile: configured, source: configured === accountFile ? 'explicit_user_sapiom_account' as const : 'explicit_project_file' as const };
}
export type CalibrationScope = Record<string, string>;
const pathKeys = ['repositoryPath', 'budgetPath', 'reviewPath', 'appDbPath', 'loopDbPath', 'workspaceDbPath', 'runtimePolicyDbPath', 'claimDirectory'] as const;

/** No ambient .env or credential file is read by preparation or verification. */
export function defaultCalibrationScope(): CalibrationScope {
  const root = resolve(calibrationRepository);
  return { repositoryPath: root, budgetPath: calibrationSharedBudgetPath, reviewPath: resolve(root, '.data/paid-answer-review.sqlite'),
    appDbPath: resolve(root, '.data/ablatrix.sqlite'), loopDbPath: resolve(root, '.data/loop-workspace.sqlite'), workspaceDbPath: resolve(root, '.data/product-workspace.sqlite'),
    runtimePolicyDbPath: resolve(root, '.data/runtime-answer-policy.sqlite'), claimDirectory: resolve(root, '.data/grader-calibration-claims'), configuredPort: '4194',
    initiatingThreadId: '01a0db4e-a5c0-7e80-8498-9a3a43be0b8f', executionAuthority: 'parent_execution_only' };
}
function canonicalPath(path: string, required: boolean) {
  assert.ok(path && isAbsolute(path) && resolve(path) === path, 'Calibration paths must be explicit canonical absolute paths.');
  let existing = path;
  while (!existsSync(existing)) { const parent = resolve(existing, '..'); assert.notEqual(parent, existing); existing = parent; }
  assert.equal(realpathSync(existing), existing, 'Calibration paths cannot traverse symlinks.');
  if (required) assert.ok(existsSync(path) && lstatSync(path).isFile(), 'Required calibration database file is absent.');
}
export function validateCalibrationScope(scope: CalibrationScope, expected: { repositoryPath?: string; budgetPath?: string } = {}) {
  assert.deepEqual(Object.keys(scope).sort(), [...pathKeys, 'configuredPort', 'initiatingThreadId', 'executionAuthority', 'ledgerInitialSha256'].sort(), 'Calibration caller scope fields are exact.');
  for (const key of pathKeys) canonicalPath(scope[key], key === 'budgetPath');
  assert.equal(scope.repositoryPath, expected.repositoryPath ?? resolve(calibrationRepository));
  assert.equal(scope.budgetPath, expected.budgetPath ?? calibrationSharedBudgetPath, 'Calibration must use the existing shared planning ledger.');
  assert.equal(scope.executionAuthority, 'parent_execution_only');
  assert.equal(scope.initiatingThreadId, '01a0db4e-a5c0-7e80-8498-9a3a43be0b8f');
  assert.match(scope.ledgerInitialSha256, /^[a-f0-9]{64}$/);
  assert.ok(/^[1-9]\d*$/.test(scope.configuredPort) && Number(scope.configuredPort) <= 65535);
  assert.ok(scope.claimDirectory.startsWith(`${scope.repositoryPath}/.data/`), 'Canonical claims must stay in this project private data directory.');
  return structuredClone(scope);
}
export function calibrationCodeHashes(commit?: string, root = calibrationRepository): Record<string, string> {
  if (commit) assert.match(commit, /^[a-f0-9]{40}$/, 'Exact implementation commit required.');
  return Object.fromEntries(CALIBRATION_CODE_FILES.map(path => {
    const bytes = readFileSync(resolve(root, path)), digest = createHash('sha256').update(bytes).digest('hex');
    if (commit) assert.equal(createHash('sha256').update(execFileSync('git', ['show', `${commit}:${path}`], { cwd: root })).digest('hex'), digest, `Committed implementation differs: ${path}`);
    return [path, digest];
  }));
}
export function assertCalibrationMerged(commit: string, root = calibrationRepository) {
  assert.match(commit, /^[a-f0-9]{40}$/);
  for (const ref of ['HEAD', 'github/main']) execFileSync('git', ['merge-base', '--is-ancestor', commit, ref], { cwd: root, stdio: 'pipe' });
}

export type CalibrationLedgerState = { attempts: number; pending: number; reservedUsd: number; initialSha256: string; activeOwners: number; ownerPid: number | null; newRunIds: string[]; rows: { id: string; runId: string; status: string; allowanceUsd: number }[] };
/** Hash historical bytes internally; only aggregate metadata leaves this helper. */
export function readCalibrationLedgerState(budgetPath: string): CalibrationLedgerState {
  canonicalPath(budgetPath, true);
  const db = new DatabaseSync(budgetPath, { readOnly: true });
  try {
    for (const [table, required] of [
      ['loop_provider_calls', ['id', 'created_at', 'kind', 'allowance_usd', 'status', 'model', 'input_tokens', 'output_tokens', 'run_id', 'error_code', 'receipt_json']],
      ['loop_provider_owner', ['id', 'pid', 'token', 'expires_at']]
    ] as const) {
      const actual = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(row => row.name));
      assert.ok(required.every(column => actual.has(column)), 'Calibration requires the current existing ledger schema; parent must reconcile an older schema before provider construction.');
    }
    const rows = db.prepare('SELECT * FROM loop_provider_calls ORDER BY rowid').all();
    const owner = db.prepare('SELECT pid,expires_at FROM loop_provider_owner WHERE id=1').get();
    const active = Boolean(owner && Number(owner.expires_at) > Date.now());
    const fresh = rows.slice(CALIBRATION_BUDGET.startingAttempts);
    return { attempts: rows.length, pending: rows.filter(row => row.status === 'pending').length,
      reservedUsd: Math.round(rows.reduce((sum, row) => sum + Number(row.allowance_usd), 0) * 1_000_000) / 1_000_000,
      initialSha256: calibrationHash(rows.slice(0, CALIBRATION_BUDGET.startingAttempts)), activeOwners: active ? 1 : 0, ownerPid: active ? Number(owner!.pid) : null,
      newRunIds: fresh.map(row => String(row.run_id)), rows: fresh.map(row => ({ id: String(row.id), runId: String(row.run_id), status: String(row.status), allowanceUsd: Number(row.allowance_usd) })) };
  } finally { db.close(); }
}
export function assertCalibrationStartingLedger(state: CalibrationLedgerState) {
  assert.equal(state.attempts, CALIBRATION_BUDGET.startingAttempts, 'Shared ledger differs; parent review and a new frozen plan are required.');
  assert.equal(state.pending, 0, 'Pending shared attempts require reconciliation.');
  assert.equal(state.reservedUsd, CALIBRATION_BUDGET.startingReservedUsd);
  assert.deepEqual(state.newRunIds, []);
}
export function readCalibrationReceipts(plan: CalibrationPlan): Record<string, NonNullable<ReturnType<SapiomFeedbackProvider['receipt']>> | null> {
  const scope = plan.callerScope as CalibrationScope;
  canonicalPath(scope.budgetPath, true);
  const db = new DatabaseSync(scope.budgetPath, { readOnly: true });
  try {
    return Object.fromEntries(plan.slots.map(slot => {
      const rows = db.prepare('SELECT id,kind,status,model,input_tokens,output_tokens,error_code,receipt_json,allowance_usd FROM loop_provider_calls WHERE run_id=?').all(slot.input.runId) as NonNullable<ReturnType<SapiomFeedbackProvider['receipt']>>[];
      assert.ok(rows.length <= 1, 'Frozen calibration operation has duplicate ledger attempts.');
      return [slot.input.runId, rows[0] ?? null];
    }));
  } finally { db.close(); }
}
function otherFileOwners(paths: string[]) {
  const files = [...new Set(paths.filter(existsSync))];
  if (!files.length) return [];
  const result = spawnSync('lsof', ['-nP', '-F', 'p', '--', ...files], { encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.ok(!result.stderr.trim() && (result.status === 0 || result.status === 1 && !result.stdout.trim()), 'Cannot verify calibration shared-file ownership.');
  return [...new Set(result.stdout.split('\n').filter(line => /^p\d+$/.test(line)).map(line => Number(line.slice(1))))].filter(pid => pid !== process.pid);
}
function queuedJobs(path: string, table: string, statuses: string[]) {
  if (!existsSync(path)) return 0;
  canonicalPath(path, true);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const exists = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?").get(table);
    if (!exists) return 0;
    return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE status IN (${statuses.map(() => '?').join(',')})`).get(...statuses)!.count);
  } finally { db.close(); }
}
export function inspectCalibrationWorkers(scope: CalibrationScope) {
  canonicalPath(scope.reviewPath, true);
  const app = inspectDiagnosticApp({ port: scope.configuredPort, budgetPath: scope.budgetPath, reviewPath: scope.reviewPath, appDbPath: scope.appDbPath, loopDbPath: scope.loopDbPath });
  const owners = otherFileOwners([scope.workspaceDbPath, scope.runtimePolicyDbPath, resolve(scope.repositoryPath, '.data/feedback-loop.sqlite')]);
  const queued = queuedJobs(scope.reviewPath, 'answer_revision_jobs', ['queued', 'running', 'reconciliation']) +
    queuedJobs(scope.reviewPath, 'automatic_support_jobs', ['queued', 'checking', 'repairing', 'rechecking', 'reconciliation']) +
    queuedJobs(scope.runtimePolicyDbPath, 'runtime_policy_failure_groups', ['queued', 'running', 'reconciliation']);
  assert.ok(app.stopped && !owners.length && !queued, 'Stop and drain every application/worker sharing the ledger before calibration; queued/uncertain jobs require parent review.');
  return { app, otherFileOwnerPids: owners, queuedOrUncertainJobs: queued };
}
export type CalibrationBoundary = { phase: 'preflight' | 'before_reservation' | 'after_reservation' | 'before_transport' | 'after_transport' | 'after_operation' | 'before_report_publish'; slotIndex: number | null; runId: string | null; attemptId?: string; reservedRunIds: string[]; transportCount: number };
export function inspectCalibrationExecutionBoundary(plan: CalibrationPlan, boundary: CalibrationBoundary) {
  const scope = validateCalibrationScope(plan.callerScope as CalibrationScope);
  const workers = inspectCalibrationWorkers(scope), ledger = readCalibrationLedgerState(scope.budgetPath);
  assert.equal(ledger.initialSha256, scope.ledgerInitialSha256, 'Historical shared receipt bytes changed.');
  assert.deepEqual([...ledger.newRunIds].sort(), [...boundary.reservedRunIds].sort(), 'Another operation changed the shared ledger.');
  assert.equal(new Set(ledger.newRunIds).size, ledger.newRunIds.length);
  assert.equal(ledger.attempts, 86 + boundary.reservedRunIds.length);
  assert.ok(ledger.attempts <= 96 && boundary.transportCount <= 10);
  assert.equal(ledger.reservedUsd, Math.round((8.6 + .1 * boundary.reservedRunIds.length) * 1_000_000) / 1_000_000);
  assert.ok(ledger.reservedUsd + .200281 <= 10 + 1e-9);
  assert.ok(!ledger.activeOwners || ledger.activeOwners === 1 && ledger.ownerPid === process.pid, 'Another process owns the shared provider.');
  const slot = boundary.slotIndex === null ? undefined : plan.slots[boundary.slotIndex];
  const pending = ledger.rows.filter(row => row.status === 'pending');
  assert.ok(pending.length <= 1 && pending.every(row => row.runId === slot?.input.runId && row.id === boundary.attemptId), 'Unexpected pending operation exists.');
  assert.ok(ledger.rows.every(row => row.allowanceUsd === .1 && plan.slots.some(item => item.input.runId === row.runId)), 'Shared ledger contains an out-of-scope attempt.');
  return { ledger, workers };
}
