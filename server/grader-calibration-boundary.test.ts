import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SapiomFeedbackProvider } from './feedback-provider.ts';
import { calibrationFixtureDataset } from './grader-calibration-fixtures.ts';
import { claimSupportRequestParts } from './claim-support.ts';
import { assertCalibrationStartingLedger, readCalibrationLedgerState, validateCalibrationScope, defaultCalibrationScope, calibrationCredentialOptions, type CalibrationScope } from './grader-calibration-boundary.ts';

test('pilot credentials accept explicit project or standard account sources without reading their contents', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-calibration-credential-')));
  const root = join(dir, 'project'), account = join(dir, 'home/.sapiom/credentials.json'), owned = join(root, '.private/credentials.json'), unrelated = join(dir, 'other-repository/credentials.json');
  for (const path of [owned, account, unrelated]) { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, 'NOT JSON: metadata validation must never parse credentials.'); }
  const choose = (env: NodeJS.ProcessEnv) => calibrationCredentialOptions(env, root, account);
  try {
    assert.equal(choose({ SAPIOM_CREDENTIALS_FILE: owned }).source, 'explicit_project_file');
    assert.equal(choose({ SAPIOM_CREDENTIALS_FILE: account }).source, 'explicit_user_sapiom_account');
    assert.deepEqual(choose({ SAPIOM_API_KEY: 'SYNTHETIC test placeholder', SAPIOM_CREDENTIALS_FILE: unrelated }), { apiKey: 'SYNTHETIC test placeholder', credentialsFile: '', source: 'explicit_environment' });
    assert.throws(() => choose({ SAPIOM_CREDENTIALS_FILE: unrelated }), /unrelated repository/);
    assert.throws(() => choose({}), /explicit canonical/);
    const link = join(root, '.private/linked.json'); symlinkSync(unrelated, link);
    assert.throws(() => choose({ SAPIOM_CREDENTIALS_FILE: link }), /symlinks/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('guarded grader reservations bind pending inputs before transport and cannot retry an unknown guard outcome', async () => {
  const input = { runId: 'neutral-guarded-operation', ...calibrationFixtureDataset().cases[0].input };
  const parts = claimSupportRequestParts(input); let transports = 0;
  let provider: SapiomFeedbackProvider;
  provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'SYNTHETIC offline fixture', dbPath: ':memory:', capUsd: 10, callLimit: 10,
    fetchImpl: async () => { transports++; throw new Error('No transport is permitted by this fixture.'); },
    operationGuard(operation) {
      assert.equal(operation.runId, input.runId); assert.equal(operation.kind, 'claim_support_v1'); assert.equal(operation.requestSha256, parts.bindings.requestSha256);
      if (operation.phase === 'before_reservation') { assert.equal(provider.receipt(input.runId), undefined); return; }
      const pending = provider.receipt(input.runId)!;
      assert.equal(pending.id, operation.attemptId); assert.equal(pending.status, 'pending');
      const document = JSON.parse(pending.receipt_json!);
      for (const [key, value] of Object.entries(parts.bindings)) assert.equal(document[key], value);
      throw new Error('SYNTHETIC boundary changed after reservation.');
    } });
  try {
    await assert.rejects(provider.gradeClaimSupport(input), /unverified result/);
    assert.equal(provider.receipt(input.runId)?.status, 'failed_or_unknown');
    await assert.rejects(provider.gradeClaimSupport(input), /not redispatched/);
    assert.equal(transports, 0); assert.equal(provider.receipt(input.runId)?.allowance_usd, .1);
  } finally { provider.close(); }
});

test('a failed pre-reservation guard cannot create a provider attempt', async () => {
  const input = { runId: 'neutral-refused-operation', ...calibrationFixtureDataset().cases[0].input };
  const provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'SYNTHETIC offline fixture', dbPath: ':memory:', capUsd: 10, callLimit: 10,
    operationGuard() { throw new Error('SYNTHETIC preflight refused.'); }, fetchImpl: async () => { assert.fail('Transport is forbidden.'); } });
  try { await assert.rejects(provider.gradeClaimSupport(input), /preflight refused/); assert.equal(provider.receipt(input.runId), undefined); }
  finally { provider.close(); }
});

test('read-only ledger metadata confirms exact 86 to 96 accounting and detects a changed starting allowance', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-calibration-boundary-'))), path = join(dir, 'ledger.sqlite');
  const provider = new SapiomFeedbackProvider({ enabled: false, apiKey: '', credentialsFile: '', dbPath: path }); provider.close();
  const db = new DatabaseSync(path);
  try {
    const insert = db.prepare('INSERT INTO loop_provider_calls(id,created_at,kind,allowance_usd,status,run_id) VALUES(?,?,?,?,?,?)');
    for (let i = 0; i < 86; i++) insert.run(`fixture-${i}`, '2026-10-14T00:00:00.000Z', 'synthetic historical metadata', .1, 'completed', `fixture-old-${i}`);
    const before = readCalibrationLedgerState(path); assertCalibrationStartingLedger(before);
    assert.equal(before.reservedUsd, 8.6); assert.equal(before.rows.length, 0);
    for (let i = 0; i < 10; i++) insert.run(`fixture-new-${i}`, '2026-10-14T00:00:00.000Z', 'claim_support_v1', .1, 'completed', `fixture-new-run-${i}`);
    const after = readCalibrationLedgerState(path); assert.equal(after.attempts, 96); assert.equal(after.reservedUsd, 9.6); assert.equal(after.pending, 0);
    assert.ok(Math.abs(after.reservedUsd + .200281 - 9.800281) < 1e-9); assert.equal(after.initialSha256, before.initialSha256);
    assert.throws(() => assertCalibrationStartingLedger(after), /Shared ledger differs/);
    db.prepare('UPDATE loop_provider_calls SET allowance_usd=? WHERE id=?').run(.2, 'fixture-0');
    assert.notEqual(readCalibrationLedgerState(path).initialSha256, before.initialSha256);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('caller scope fixes the existing ledger and authority instead of accepting an alternate budget', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-calibration-scope-')));
  const budgetPath = join(dir, 'budget.sqlite'), reviewPath = join(dir, 'reviews.sqlite');
  for (const path of [budgetPath, reviewPath]) new DatabaseSync(path).close();
  const scope: CalibrationScope = { ...defaultCalibrationScope(), budgetPath, reviewPath, ledgerInitialSha256: 'a'.repeat(64) };
  try {
    const expected = { budgetPath };
    assert.throws(() => validateCalibrationScope(scope), /shared planning ledger/, 'Production defaults cannot accept the test ledger.');
    assert.doesNotThrow(() => validateCalibrationScope(scope, expected));
    assert.throws(() => validateCalibrationScope({ ...scope, executionAuthority: 'any_caller' }, expected));
    assert.throws(() => validateCalibrationScope({ ...scope, budgetPath: reviewPath }, expected), /shared planning ledger/);
    assert.throws(() => validateCalibrationScope({ ...scope, extra: 'widened' }, expected));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an older ledger schema is rejected read-only before a provider could migrate historical rows', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-calibration-old-schema-'))), path = join(dir, 'ledger.sqlite');
  const db = new DatabaseSync(path);
  try {
    db.exec('CREATE TABLE loop_provider_calls(id TEXT PRIMARY KEY,created_at TEXT,kind TEXT,allowance_usd REAL,status TEXT,model TEXT,input_tokens INTEGER,output_tokens INTEGER,run_id TEXT,error_code TEXT); CREATE TABLE loop_provider_owner(id INTEGER PRIMARY KEY,pid INTEGER,token TEXT,expires_at INTEGER)');
    assert.throws(() => readCalibrationLedgerState(path), /current existing ledger schema/);
    assert.ok(!(db.prepare('PRAGMA table_info(loop_provider_calls)').all() as {name:string}[]).some(column => column.name === 'receipt_json'));
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
