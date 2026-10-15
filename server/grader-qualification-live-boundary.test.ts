import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { QUALIFICATION_CODE_FILES } from './grader-qualification.ts';
import { QUALIFICATION_LIVE_CODE_FILES, assertLiveQualificationStartingLedger, calibrationRepository, defaultLiveQualificationScope, inspectLiveQualificationBoundary, readLiveQualificationLedger, readLiveQualificationReceipts, validateLiveScope, type LiveQualificationBoundary } from './grader-qualification-live-boundary.ts';

function isolatedLedger() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-qualification-boundary-'))), path = join(directory, 'ledger.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE loop_provider_calls(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,kind TEXT NOT NULL,allowance_usd REAL NOT NULL,status TEXT NOT NULL,model TEXT,input_tokens INTEGER,output_tokens INTEGER,run_id TEXT,error_code TEXT,receipt_json TEXT);
    CREATE TABLE loop_provider_owner(id INTEGER PRIMARY KEY,pid INTEGER,token TEXT,expires_at INTEGER);`);
  const insert = db.prepare('INSERT INTO loop_provider_calls(id,created_at,kind,allowance_usd,status,run_id) VALUES(?,?,?,?,?,?)');
  for (let index = 0; index < 102; index++) insert.run(`prior-${index}`, '2026-10-15T00:00:00.000Z', 'SYNTHETIC historical metadata', .1, 'completed', `prior-run-${index}`);
  const initial = readLiveQualificationLedger(path);
  const scope = { ...defaultLiveQualificationScope(), budgetPath: path, ledgerInitialSha256: initial.initialSha256 };
  const allowedRunIds = Array.from({ length: 92 }, (_, index) => `frozen-operation-${index}`);
  const boundary: LiveQualificationBoundary = { ledgerInitialSha256: initial.initialSha256, allowedRunIds, reservedRunIds: [], transportCount: 0, maxCalls: 92 };
  const deps = { expectedScope: { budgetPath: path }, inspectWorkers: () => undefined as never };
  return { directory, path, db, insert, initial, scope, boundary, deps, cleanup() { db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('qualification fingerprints all 102 historical rows and reads the current schema without migration', () => {
  const fixture = isolatedLedger();
  try {
    assertLiveQualificationStartingLedger(fixture.initial);
    assert.equal(fixture.initial.reservedUsd, 10.2);
    assert.equal(fixture.initial.pending, 0);
    assert.deepEqual(fixture.initial.rows, []);
    assert.throws(() => readLiveQualificationLedger(fixture.path, 96), /102 previous/);
    fixture.db.prepare('UPDATE loop_provider_calls SET receipt_json=? WHERE id=?').run('{"SYNTHETIC":"changed row 102"}', 'prior-101');
    assert.notEqual(readLiveQualificationLedger(fixture.path).initialSha256, fixture.initial.initialSha256);
    assert.throws(() => inspectLiveQualificationBoundary(fixture.scope, fixture.boundary, fixture.deps), /Historical shared receipt/);
  } finally { fixture.cleanup(); }
});

test('qualification rejects old schemas and symlink ledger paths before any write or provider construction', () => {
  const fixture = isolatedLedger();
  try {
    const linked = join(fixture.directory, 'linked.sqlite'); symlinkSync(fixture.path, linked);
    assert.throws(() => readLiveQualificationLedger(linked), /symlink traversal/);
    const oldPath = join(fixture.directory, 'old.sqlite'), old = new DatabaseSync(oldPath);
    try {
      old.exec('CREATE TABLE loop_provider_calls(id TEXT); CREATE TABLE loop_provider_owner(id INTEGER)');
      assert.throws(() => readLiveQualificationLedger(oldPath), /no migration/);
      assert.deepEqual((old.prepare('PRAGMA table_info(loop_provider_calls)').all() as {name:string}[]).map(c => c.name), ['id']);
    } finally { old.close(); }
  } finally { fixture.cleanup(); }
});

test('qualification scopes keep the canonical shared ledger and a separate project claim directory', () => {
  const fixture = isolatedLedger();
  try {
    assert.ok(defaultLiveQualificationScope().claimDirectory.endsWith('/.data/grader-qualification-live-claims'));
    assert.throws(() => validateLiveScope(fixture.scope), /shared planning ledger/);
    assert.doesNotThrow(() => validateLiveScope(fixture.scope, fixture.deps.expectedScope));
    assert.throws(() => validateLiveScope({ ...fixture.scope, executionAuthority: 'any_caller' }, fixture.deps.expectedScope));
    assert.throws(() => validateLiveScope({ ...fixture.scope, claimDirectory: resolve(fixture.directory, 'claims') }, fixture.deps.expectedScope), /private data/);
    assert.throws(() => validateLiveScope({ ...fixture.scope, injected: 'field' }, fixture.deps.expectedScope), /fields are exact/);
  } finally { fixture.cleanup(); }
});

test('all qualification boundaries inspect workers and match reservations, pending identity and ownership', () => {
  const fixture = isolatedLedger(); let checks = 0;
  const deps = { ...fixture.deps, inspectWorkers: () => { checks++; return undefined as never; } };
  try {
    inspectLiveQualificationBoundary(fixture.scope, fixture.boundary, deps);
    fixture.insert.run('new-0', '2026-10-15T00:00:01.000Z', 'claim_support_v1', .1, 'pending', fixture.boundary.allowedRunIds[0]);
    const reserved = { ...fixture.boundary, reservedRunIds: [fixture.boundary.allowedRunIds[0]], runId: fixture.boundary.allowedRunIds[0], attemptId: 'new-0' };
    assert.throws(() => inspectLiveQualificationBoundary(fixture.scope, fixture.boundary, deps), /Another operation changed/);
    inspectLiveQualificationBoundary(fixture.scope, reserved, deps);
    inspectLiveQualificationBoundary(fixture.scope, { ...reserved, transportCount: 1 }, deps);
    assert.throws(() => inspectLiveQualificationBoundary(fixture.scope, { ...reserved, attemptId: 'different' }, deps), /Unexpected pending/);
    fixture.db.prepare('INSERT INTO loop_provider_owner VALUES(1,?,?,?)').run(process.pid + 10000, 'SYNTHETIC owner', Date.now() + 60000);
    assert.throws(() => inspectLiveQualificationBoundary(fixture.scope, reserved, deps), /Another process owns/);
    fixture.db.prepare('UPDATE loop_provider_owner SET pid=? WHERE id=1').run(process.pid);
    inspectLiveQualificationBoundary(fixture.scope, reserved, deps);
    fixture.db.prepare("UPDATE loop_provider_calls SET status='completed' WHERE id='new-0'").run();
    const complete = inspectLiveQualificationBoundary(fixture.scope, { ...reserved, runId: null, attemptId: undefined, transportCount: 1 }, deps);
    assert.equal(complete.ledger.reservedUsd, 10.3);
    assert.equal(checks, 8);
    assert.throws(() => inspectLiveQualificationBoundary(fixture.scope, reserved, { ...deps, inspectWorkers() { throw new Error('SYNTHETIC queued worker'); } }), /queued worker/);
    assert.throws(() => assertLiveQualificationStartingLedger(complete.ledger), /Shared ledger differs/);
  } finally { fixture.cleanup(); }
});

test('qualification rejects changed histories, unapproved work, altered allowances and excess transport', () => {
  const fixture = isolatedLedger();
  try {
    for (const boundary of [
      { ...fixture.boundary, maxCalls: 93 as never },
      { ...fixture.boundary, allowedRunIds: fixture.boundary.allowedRunIds.slice(1) },
      { ...fixture.boundary, reservedRunIds: ['unapproved'] },
      { ...fixture.boundary, transportCount: 1 },
      { ...fixture.boundary, transportCount: -1 },
      { ...fixture.boundary, ledgerInitialSha256: 'a'.repeat(64) }
    ]) assert.throws(() => inspectLiveQualificationBoundary(fixture.scope, boundary, fixture.deps));
    fixture.insert.run('new-other', '2026-10-15T00:00:01.000Z', 'claim_support_v1', .1, 'completed', 'unapproved');
    assert.throws(() => inspectLiveQualificationBoundary(fixture.scope, fixture.boundary, fixture.deps), /Another operation changed/);
    fixture.db.prepare('DELETE FROM loop_provider_calls WHERE id=?').run('new-other');
    fixture.insert.run('new-0', '2026-10-15T00:00:01.000Z', 'claim_support_v1', .2, 'completed', fixture.boundary.allowedRunIds[0]);
    assert.throws(() => inspectLiveQualificationBoundary(fixture.scope, { ...fixture.boundary, reservedRunIds: [fixture.boundary.allowedRunIds[0]] }, fixture.deps));
  } finally { fixture.cleanup(); }
});

test('qualification enforces exactly 92 new allowances and the 194-attempt total ceiling', () => {
  const fixture = isolatedLedger();
  try {
    for (const [index, runId] of fixture.boundary.allowedRunIds.entries()) fixture.insert.run(`new-${index}`, '2026-10-15T00:00:01.000Z', 'claim_support_v1', .1, 'completed', runId);
    const complete = inspectLiveQualificationBoundary(fixture.scope, { ...fixture.boundary, reservedRunIds: [...fixture.boundary.allowedRunIds], transportCount: 92 }, fixture.deps);
    assert.equal(complete.ledger.attempts, 194);
    assert.equal(complete.ledger.reservedUsd, 19.4);
    assert.equal(Number((complete.ledger.reservedUsd + .200281).toFixed(6)), 19.600281);
    fixture.insert.run('extra', '2026-10-15T00:00:01.000Z', 'claim_support_v1', .1, 'completed', 'unapproved-extra');
    assert.throws(() => inspectLiveQualificationBoundary(fixture.scope, { ...fixture.boundary, reservedRunIds: [...fixture.boundary.allowedRunIds], transportCount: 92 }, fixture.deps), /Another operation changed/);
  } finally { fixture.cleanup(); }
});

test('qualification receipt reads return only selected row bytes and accounting and reject duplicates', () => {
  const fixture = isolatedLedger();
  try {
    const runId = fixture.boundary.allowedRunIds[0];
    fixture.insert.run('new-0', '2026-10-15T00:00:01.000Z', 'claim_support_v1', .1, 'completed', runId);
    fixture.db.prepare('UPDATE loop_provider_calls SET model=?,input_tokens=?,output_tokens=?,receipt_json=? WHERE id=?').run('gpt-luna', 10, 20, '{"SYNTHETIC":"literal receipt"}', 'new-0');
    const receipts = readLiveQualificationReceipts(fixture.scope, [runId, fixture.boundary.allowedRunIds[1]]);
    assert.deepEqual(Object.keys(receipts), [runId, fixture.boundary.allowedRunIds[1]]);
    assert.equal(receipts[runId]!.receipt_json, '{"SYNTHETIC":"literal receipt"}');
    assert.equal(receipts[runId]!.allowance_usd, .1); assert.equal(receipts[runId]!.input_tokens, 10); assert.equal(receipts[runId]!.output_tokens, 20);
    assert.equal(receipts[fixture.boundary.allowedRunIds[1]], null);
    assert.throws(() => readLiveQualificationReceipts(fixture.scope, [runId, runId]), /distinct bounded/);
    fixture.insert.run('new-duplicate', '2026-10-15T00:00:01.000Z', 'claim_support_v1', .1, 'completed', runId);
    assert.throws(() => readLiveQualificationReceipts(fixture.scope, [runId]), /duplicate ledger/);
  } finally { fixture.cleanup(); }
});

test('the live implementation manifest retains all eight sealed PR 1 code files and all runtime guards', () => {
  assert.equal(new Set(QUALIFICATION_LIVE_CODE_FILES).size, QUALIFICATION_LIVE_CODE_FILES.length);
  for (const path of [...QUALIFICATION_CODE_FILES, 'server/grader-qualification-live-journal.ts', 'server/feedback-provider.ts', 'server/grader-calibration-boundary.ts', 'server/grader-calibration.ts', 'server/grader-calibration-fixtures.ts']) assert.ok(QUALIFICATION_LIVE_CODE_FILES.includes(path));
});

test('the manifest covers the complete runtime-loaded project import graph', async () => {
  // Parsing/bundling only: no application module is evaluated, credential or
  // ledger opened, output written, or transport constructed. Vendor versions
  // remain bound by the unchanged package/lock files on the trusted host.
  const result = await build({ absWorkingDir: resolve(calibrationRepository), entryPoints: ['scripts/grader-qualification-live.ts'], bundle: true, platform: 'node', format: 'esm', packages: 'external', tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } }, write: false, metafile: true, logLevel: 'silent' });
  const loaded = Object.keys(result.metafile!.inputs);
  assert.deepEqual(loaded.filter(file => !QUALIFICATION_LIVE_CODE_FILES.includes(file)), [], 'A runtime-loaded project module is absent from the approved code manifest.');
  for (const required of ['server/revision-policy.ts', 'server/answer-policy-protocol.ts', 'server/answer-review-source.ts', 'server/context-comparison.ts']) assert.ok(loaded.includes(required));
});
