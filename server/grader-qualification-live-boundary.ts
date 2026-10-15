import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ClaimSupportReceipt } from './claim-support.ts';
import { QUALIFICATION_CODE_FILES, qualificationHash } from './grader-qualification.ts';
import { assertCalibrationMerged, calibrationCredentialOptions, calibrationRepository, calibrationSharedBudgetPath, defaultCalibrationScope, inspectCalibrationWorkers, validateCalibrationScope, type CalibrationScope } from './grader-calibration-boundary.ts';

export { calibrationCredentialOptions, calibrationRepository, calibrationSharedBudgetPath };
export const assertLiveQualificationMerged = assertCalibrationMerged;
export const defaultLiveQualificationScope = (): LiveQualificationScope => ({ ...defaultCalibrationScope(), claimDirectory: resolve(calibrationRepository, '.data/grader-qualification-live-claims') });
export type LiveQualificationScope = CalibrationScope;

/** The PR 1 seal stays byte-identical; execution adds a separate code manifest. */
export const QUALIFICATION_LIVE_CODE_FILES = Object.freeze([...new Set([
  ...QUALIFICATION_CODE_FILES,
  'server/grader-qualification-live.ts', 'server/grader-qualification-live-runner.ts',
  'server/grader-qualification-live-boundary.ts', 'server/grader-qualification-live-journal.ts', 'scripts/grader-qualification-live.ts',
  'server/grader-qualification-live-authorization.ts',
  'server/grader-qualification-live-transport.ts',
  'server/feedback-provider.ts', 'server/grader-calibration-boundary.ts',
  'server/grader-calibration.ts', 'server/grader-calibration-fixtures.ts'
])]);

export function qualificationLiveCodeHashes(commit?: string, root = calibrationRepository): Record<string, string> {
  if (commit) assert.match(commit, /^[a-f0-9]{40}$/, 'An exact live implementation commit is required.');
  return Object.fromEntries(QUALIFICATION_LIVE_CODE_FILES.map(path => {
    const local = resolve(root, path), stat = lstatSync(local);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && realpathSync(local) === local, 'Qualification implementation files cannot traverse symlinks.');
    const digest = createHash('sha256').update(readFileSync(local)).digest('hex');
    if (commit) {
      const committed = createHash('sha256').update(execFileSync('git', ['show', `${commit}:${path}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })).digest('hex');
      assert.equal(digest, committed, `Committed live qualification implementation differs: ${path}`);
    }
    return [path, digest];
  }));
}

/** Preparation and replay do not read .env or credential contents. */
export function validateLiveScope(scope: LiveQualificationScope, expected: { repositoryPath?: string; budgetPath?: string } = {}) {
  return validateCalibrationScope(scope, expected);
}

function canonicalExistingFile(path: string) {
  assert.ok(path && isAbsolute(path) && resolve(path) === path, 'Live qualification requires a canonical absolute ledger path.');
  assert.ok(existsSync(path) && lstatSync(path).isFile() && realpathSync(path) === path, 'Live qualification ledger must be an existing regular file without symlink traversal.');
}
function openLedger(path: string) {
  canonicalExistingFile(path);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    for (const [table, required] of [
      ['loop_provider_calls', ['id', 'created_at', 'kind', 'allowance_usd', 'status', 'model', 'input_tokens', 'output_tokens', 'run_id', 'error_code', 'receipt_json']],
      ['loop_provider_owner', ['id', 'pid', 'token', 'expires_at']]
    ] as const) {
      const columns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(row => row.name));
      assert.ok(required.every(column => columns.has(column)), 'Live qualification requires the existing current ledger schema; no migration is allowed.');
    }
    return db;
  } catch (error) { db.close(); throw error; }
}

export type LiveQualificationLedger = {
  attempts: number; pending: number; reservedUsd: number; initialSha256: string;
  activeOwners: number; ownerPid: number | null; newRunIds: string[];
  rows: { id: string; runId: string; status: string; allowanceUsd: number }[];
};
/** Historical receipt bytes are hashed internally and never returned by this helper. */
export function readLiveQualificationLedger(path: string, startingAttempts = 102): LiveQualificationLedger {
  assert.equal(startingAttempts, 102, 'Qualification must bind every one of the 102 previous attempts.');
  const db = openLedger(path);
  try {
    const rows = db.prepare('SELECT * FROM loop_provider_calls ORDER BY rowid').all();
    const owner = db.prepare('SELECT pid,expires_at FROM loop_provider_owner WHERE id=1').get();
    const active = Boolean(owner && Number(owner.expires_at) > Date.now());
    const fresh = rows.slice(startingAttempts);
    assert.ok(rows.every(row => Number.isFinite(Number(row.allowance_usd)) && Number(row.allowance_usd) >= 0), 'Ledger planning allowances must be finite and nonnegative.');
    return { attempts: rows.length, pending: rows.filter(row => row.status === 'pending').length,
      reservedUsd: Number(rows.reduce((sum, row) => sum + Number(row.allowance_usd), 0).toFixed(6)),
      initialSha256: qualificationHash(rows.slice(0, startingAttempts)), activeOwners: active ? 1 : 0,
      ownerPid: active ? Number(owner!.pid) : null, newRunIds: fresh.map(row => String(row.run_id)),
      rows: fresh.map(row => ({ id: String(row.id), runId: String(row.run_id), status: String(row.status), allowanceUsd: Number(row.allowance_usd) })) };
  } finally { db.close(); }
}

export function assertLiveQualificationStartingLedger(state: LiveQualificationLedger) {
  assert.equal(state.attempts, 102, 'Shared ledger differs; freeze a new reviewed execution plan.');
  assert.equal(state.pending, 0, 'Reconcile pending shared attempts before qualification.');
  assert.equal(state.reservedUsd, 10.2, 'Qualification starts after exactly $10.20 of local planning allowances.');
  assert.deepEqual(state.newRunIds, []);
  assert.equal(state.activeOwners, 0, 'Stop the existing shared provider before qualification.');
}

export type LiveQualificationReceipt = ClaimSupportReceipt & { allowance_usd: number; input_tokens: number | null; output_tokens: number | null };
/** Read only explicitly frozen run identities; no provider is constructed. */
export function readLiveQualificationReceipts(scope: LiveQualificationScope, runIds: readonly string[]): Record<string, LiveQualificationReceipt | null> {
  assert.ok(runIds.length <= 92 && new Set(runIds).size === runIds.length && runIds.every(id => typeof id === 'string' && id.length > 0), 'Receipt reads require distinct bounded frozen run identities.');
  const db = openLedger(scope.budgetPath);
  try {
    const select = db.prepare('SELECT id,kind,status,model,input_tokens,output_tokens,error_code,receipt_json,allowance_usd FROM loop_provider_calls WHERE run_id=?');
    return Object.fromEntries(runIds.map(runId => {
      const rows = select.all(runId) as LiveQualificationReceipt[];
      assert.ok(rows.length <= 1, 'Frozen qualification operation has duplicate ledger attempts.');
      return [runId, rows[0] ?? null];
    }));
  } finally { db.close(); }
}

export type LiveQualificationBoundary = {
  ledgerInitialSha256: string; allowedRunIds: readonly string[]; reservedRunIds: readonly string[];
  transportCount: number; maxCalls: 92; runId?: string | null; attemptId?: string;
};
type BoundaryDependencies = {
  inspectWorkers?: typeof inspectCalibrationWorkers;
  expectedScope?: { repositoryPath?: string; budgetPath?: string };
};
/** CLI supplies no test overrides. Check stopped workers and accounting at every boundary. */
export function inspectLiveQualificationBoundary(scope: LiveQualificationScope, boundary: LiveQualificationBoundary, dependencies: BoundaryDependencies = {}) {
  const validated = validateLiveScope(scope, dependencies.expectedScope);
  assert.equal(boundary.ledgerInitialSha256, validated.ledgerInitialSha256, 'Execution must bind the frozen initial ledger fingerprint.');
  assert.equal(boundary.maxCalls, 92, 'Qualification is exactly the approved finite 92-call scope.');
  assert.equal(boundary.allowedRunIds.length, 92, 'Qualification requires all 92 frozen run identities.');
  assert.equal(new Set(boundary.allowedRunIds).size, 92);
  assert.ok(boundary.allowedRunIds.every(runId => typeof runId === 'string' && runId.length > 0));
  assert.ok(Number.isInteger(boundary.transportCount) && boundary.transportCount >= 0 && boundary.transportCount <= boundary.reservedRunIds.length && boundary.transportCount <= 92, 'Qualification transport exceeds its exact reservations or call ceiling.');
  assert.ok(boundary.reservedRunIds.length <= 92 && new Set(boundary.reservedRunIds).size === boundary.reservedRunIds.length && boundary.reservedRunIds.every(runId => boundary.allowedRunIds.includes(runId)), 'Qualification reservations contain duplicate or unapproved identities.');
  const workers = (dependencies.inspectWorkers ?? inspectCalibrationWorkers)(validated);
  const ledger = readLiveQualificationLedger(validated.budgetPath);
  assert.equal(ledger.initialSha256, boundary.ledgerInitialSha256, 'Historical shared receipt bytes changed.');
  assert.deepEqual([...ledger.newRunIds].sort(), [...boundary.reservedRunIds].sort(), 'Another operation changed the shared ledger.');
  assert.equal(new Set(ledger.newRunIds).size, ledger.newRunIds.length);
  assert.equal(ledger.attempts, 102 + boundary.reservedRunIds.length);
  assert.ok(ledger.attempts <= 194);
  assert.equal(ledger.reservedUsd, Number((10.2 + .1 * boundary.reservedRunIds.length).toFixed(6)));
  assert.ok(ledger.reservedUsd + .200281 <= 20 + 1e-9, 'Qualification exceeds the new local planning cap.');
  assert.ok(!ledger.activeOwners || ledger.activeOwners === 1 && ledger.ownerPid === process.pid, 'Another process owns the shared provider.');
  const pending = ledger.rows.filter(row => row.status === 'pending');
  assert.ok(ledger.pending === pending.length && pending.length <= 1 && pending.every(row => row.runId === boundary.runId && row.id === boundary.attemptId), 'Unexpected pending operation exists.');
  assert.ok(ledger.rows.every(row => row.allowanceUsd === .1 && boundary.allowedRunIds.includes(row.runId)), 'Shared ledger contains an out-of-scope attempt.');
  return { ledger, workers };
}
