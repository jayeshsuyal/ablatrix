import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { assertRuntimeLock, backupDemoData, restoreDemoData, type DemoSnapshotManifest } from '../scripts/demo-backup.ts';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const entrypoint = join(repo, 'scripts/demo-entrypoint.sh');
const hasFlock = process.platform === 'linux' && spawnSync('flock', ['--version']).status === 0;
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ablatrix-demo-backup-'));
  const data = join(root, 'source'), target = join(root, 'target'), snapshot = join(root, 'snapshot');
  mkdirSync(data); mkdirSync(target);
  return { root, data, target, snapshot, close: () => rmSync(root, { recursive: true, force: true }) };
}
function database(path: string, value: string) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA user_version=3; CREATE TABLE receipts(value TEXT NOT NULL)');
  db.prepare('INSERT INTO receipts VALUES(?)').run(value);
  db.close();
}
function contents(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare('SELECT value FROM receipts').all().map(row => row.value); }
  finally { db.close(); }
}
function editManifest(snapshot: string, edit: (manifest: DemoSnapshotManifest) => void) {
  const path = join(snapshot, 'manifest.json'), manifest = JSON.parse(readFileSync(path, 'utf8')) as DemoSnapshotManifest;
  edit(manifest); writeFileSync(path, JSON.stringify(manifest));
}

test('offline snapshot restores every ledger together and excludes runtime locks', async () => {
  const f = fixture();
  try {
    for (const name of ['product-workspace.sqlite', 'paid-answer-review.sqlite', 'feedback-budget.sqlite', 'context-comparison.sqlite']) database(join(f.data, name), name);
    mkdirSync(join(f.data, 'receipts')); writeFileSync(join(f.data, 'receipts/run.json'), '{"synthetic":true}');
    writeFileSync(join(f.data, '.runtime.lock'), ''); writeFileSync(join(f.data, 'ablatrix.sqlite.lock'), `${process.pid}`);
    writeFileSync(join(f.target, '.runtime.lock'), 'target lock');
    const before = readFileSync(join(f.data, 'product-workspace.sqlite'));
    const manifest = await backupDemoData(f.data, f.snapshot);
    assert.equal(manifest.format, 'ablatrix-demo-snapshot-v1');
    assert.equal(manifest.consistency, 'offline-exclusive-runtime-lock');
    assert.equal(manifest.databases.length, 4);
    assert.ok(manifest.databases.every(db => db.userVersion === 3));
    assert.deepEqual(manifest.omittedLocks, ['.runtime.lock', 'ablatrix.sqlite.lock']);
    assert.equal(manifest.files.length, 5);
    assert.deepEqual(await restoreDemoData(f.target, f.snapshot), manifest);
    for (const db of manifest.databases) assert.deepEqual(contents(join(f.target, db.path)), [db.path]);
    assert.equal(readFileSync(join(f.target, '.runtime.lock'), 'utf8'), 'target lock');
    assert.equal(readFileSync(join(f.target, 'receipts/run.json'), 'utf8'), '{"synthetic":true}');
    assert.deepEqual(readFileSync(join(f.data, 'product-workspace.sqlite')), before);
    assert.ok(!existsSync(join(f.target, '.restore-in-progress')));
  } finally { f.close(); }
});

test('offline snapshot recovers an exited writer’s WAL privately and preserves its committed rows', async () => {
  const f = fixture();
  try {
    const path = join(f.data, 'workspace.sqlite');
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(process.argv[1]); db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE receipts(value TEXT); INSERT INTO receipts VALUES('committed before writer exit')"); process.exit(0);`, path]);
    assert.equal(result.status, 0, result.stderr.toString());
    assert.ok(existsSync(`${path}-wal`));
    const before = readFileSync(`${path}-wal`);
    const manifest = await backupDemoData(f.data, f.snapshot);
    assert.ok(manifest.databases.some(file => file.path === 'workspace.sqlite'));
    assert.deepEqual(readFileSync(`${path}-wal`), before, 'source WAL is never opened by maintenance SQLite checks');
    await restoreDemoData(f.target, f.snapshot);
    assert.deepEqual(contents(join(f.target, 'workspace.sqlite')), ['committed before writer exit']);
  } finally { f.close(); }
});

test('offline snapshot rolls back a hot DELETE journal on its private copy without changing the source', async () => {
  const f = fixture();
  try {
    const path = join(f.data, 'workspace.sqlite');
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(process.argv[1]); db.exec("PRAGMA journal_mode=DELETE; PRAGMA cache_size=5; CREATE TABLE receipts(value TEXT); BEGIN");const insert=db.prepare('INSERT INTO receipts VALUES(?)');for(let i=0;i<300;i++)insert.run('original '+('x'.repeat(4000)));db.exec('COMMIT; BEGIN');db.prepare('UPDATE receipts SET value=?').run('uncommitted '+('y'.repeat(4000)));process.exit(0);`, path]);
    assert.equal(result.status, 0, result.stderr.toString());
    assert.ok(existsSync(`${path}-journal`));
    const beforeDb = readFileSync(path), beforeJournal = readFileSync(`${path}-journal`);
    const readonly = new DatabaseSync(path, { readOnly: true });
    try { assert.throws(() => readonly.prepare('SELECT value FROM receipts').all(), /readonly|read.only|disk I\/O/i, 'the crashed source requires write recovery'); }
    finally { readonly.close(); }
    const manifest = await backupDemoData(f.data, f.snapshot);
    assert.ok(!manifest.files.some(file => file.path === 'workspace.sqlite-journal'), 'successful private recovery removes the hot journal');
    assert.deepEqual(readFileSync(path), beforeDb);
    assert.deepEqual(readFileSync(`${path}-journal`), beforeJournal);
    await restoreDemoData(f.target, f.snapshot);
    const values = contents(join(f.target, 'workspace.sqlite'));
    assert.equal(values.length, 300);
    assert.ok(values.every(value => typeof value === 'string' && value.startsWith('original ')));
  } finally { f.close(); }
});

test('hash and SQLite integrity failures leave the destination empty', async () => {
  const f = fixture();
  try {
    database(join(f.data, 'workspace.sqlite'), 'original');
    await backupDemoData(f.data, f.snapshot);
    const path = join(f.snapshot, 'data/workspace.sqlite');
    writeFileSync(path, 'corrupted database');
    await assert.rejects(restoreDemoData(f.target, f.snapshot), /hash mismatch/);
    assert.deepEqual(readdirSync(f.target), []);
    editManifest(f.snapshot, manifest => {
      manifest.files[0].bytes = readFileSync(path).length;
      manifest.files[0].sha256 = hash(readFileSync(path));
    });
    await assert.rejects(restoreDemoData(f.target, f.snapshot), /SQLite integrity check failed/);
    assert.deepEqual(readdirSync(f.target), []);
  } finally { f.close(); }
});

test('restore refuses traversal, duplicate paths, unlisted payloads, and symbolic links', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.data, 'record.json'), '{}');
    await backupDemoData(f.data, f.snapshot);
    const manifest = readFileSync(join(f.snapshot, 'manifest.json'));
    editManifest(f.snapshot, value => { value.files[0].path = '../escape'; });
    await assert.rejects(restoreDemoData(f.target, f.snapshot), /manifest is invalid/);
    writeFileSync(join(f.snapshot, 'manifest.json'), manifest);
    editManifest(f.snapshot, value => { value.files.push(value.files[0]); });
    await assert.rejects(restoreDemoData(f.target, f.snapshot), /duplicate or forbidden/);
    writeFileSync(join(f.snapshot, 'manifest.json'), manifest);
    writeFileSync(join(f.snapshot, 'data/unlisted'), 'unexpected');
    await assert.rejects(restoreDemoData(f.target, f.snapshot), /do not match/);
    rmSync(join(f.snapshot, 'data/unlisted'));
    rmSync(join(f.snapshot, 'data/record.json'));
    symlinkSync(join(f.data, 'record.json'), join(f.snapshot, 'data/record.json'));
    await assert.rejects(restoreDemoData(f.target, f.snapshot), /symbolic links/);
    assert.deepEqual(readdirSync(f.target), []);
    assert.ok(!existsSync(join(f.root, 'escape')));
  } finally { f.close(); }
});

test('maintenance refuses nonempty restores, unsafe sources, and an interrupted restore', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.data, 'record.json'), '{}');
    await backupDemoData(f.data, f.snapshot);
    writeFileSync(join(f.target, 'existing'), 'keep me');
    await assert.rejects(restoreDemoData(f.target, f.snapshot), /empty data directory/);
    assert.equal(readFileSync(join(f.target, 'existing'), 'utf8'), 'keep me');
    await assert.rejects(backupDemoData(f.data, f.snapshot), /already exists/);
    await assert.rejects(backupDemoData(f.data, join(f.data, 'nested')), /outside/);
    symlinkSync(join(f.target, 'existing'), join(f.data, 'unsafe'));
    await assert.rejects(backupDemoData(f.data, join(f.root, 'unsafe-snapshot')), /symbolic links/);
    rmSync(join(f.data, 'unsafe'));
    writeFileSync(join(f.data, '.restore-in-progress'), '{}');
    await assert.rejects(backupDemoData(f.data, join(f.root, 'interrupted-snapshot')), /interrupted restore/);
    assert.throws(() => assertRuntimeLock(f.data, {}), /through scripts\/demo-entrypoint/);
  } finally { f.close(); }
});

function exited(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
}
function waitForLine(child: ChildProcess, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${expected}: ${output}`)), 4000);
    child.stdout!.on('data', chunk => { output += chunk.toString(); if (output.includes(expected)) { clearTimeout(timeout); resolve(); } });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
  });
}

test('Linux entrypoint excludes a second app and maintenance, forwards TERM, and retains the lock through drain', { skip: !hasFlock }, async () => {
  const f = fixture();
  const env = { ...process.env, ABLATRIX_DATA_DIR: f.data };
  let child: ChildProcess | undefined;
  try {
    writeFileSync(join(f.data, 'ablatrix.sqlite.lock'), `${process.pid}`);
    child = spawn('sh', [entrypoint, process.execPath, '-e', `process.on('SIGTERM',()=>{console.log('draining');setTimeout(()=>process.exit(23),500)});console.log('ready');setInterval(()=>{},1000)`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const exit = exited(child);
    await waitForLine(child, 'ready');
    assert.ok(!existsSync(join(f.data, 'ablatrix.sqlite.lock')), 'legacy PID locks are removed after exclusive ownership');
    const forgedFd = openSync(join(f.data, '.runtime.lock'), 'r+');
    try {
      assert.throws(() => assertRuntimeLock(f.data, { ABLATRIX_RUNTIME_LOCK_HELD: '1', ABLATRIX_RUNTIME_LOCK_FD: String(forgedFd) }), /exclusive runtime lock is unavailable/, 'a separate descriptor with matching inode cannot bypass the active owner');
    } finally { closeSync(forgedFd); }
    writeFileSync(join(f.data, 'feedback-loop.sqlite.lock'), 'do not remove while locked');
    const blocked = spawnSync('sh', [entrypoint, process.execPath, '-e', 'process.exit(0)'], { env });
    assert.equal(blocked.status, 75);
    assert.match(blocked.stderr.toString(), /in use/);
    assert.ok(existsSync(join(f.data, 'feedback-loop.sqlite.lock')));
    const draining = waitForLine(child, 'draining');
    child.kill('SIGTERM'); await draining;
    const maintenance = spawnSync('sh', [entrypoint, process.execPath, '--import', 'tsx', 'scripts/demo-backup.ts', 'backup', '--destination', f.snapshot], { env, cwd: repo });
    assert.equal(maintenance.status, 75, 'maintenance stays excluded while the worker drains');
    assert.deepEqual(await exit, { code: 23, signal: null });
    child = undefined;
    const backup = spawnSync('sh', [entrypoint, process.execPath, '--import', 'tsx', 'scripts/demo-backup.ts', 'backup', '--destination', f.snapshot], { env, cwd: repo });
    assert.equal(backup.status, 0, backup.stderr.toString());
    assert.ok(existsSync(join(f.snapshot, 'manifest.json')));
    const directFd = openSync(join(f.data, '.runtime.lock'), 'r+');
    try {
      assertRuntimeLock(f.data, { ABLATRIX_RUNTIME_LOCK_HELD: '1', ABLATRIX_RUNTIME_LOCK_FD: String(directFd) });
      const directContender = spawnSync('sh', [entrypoint, process.execPath, '-e', 'process.exit(0)'], { env });
      assert.equal(directContender.status, 75, 'verification on an unlocked descriptor acquires real ownership until the caller closes it');
    } finally { closeSync(directFd); }
    child = spawn('sh', [entrypoint, process.execPath, '-e', `process.on('SIGTERM',()=>process.exit(19));console.log('ready');setInterval(()=>{},1000)`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const immediateExit = exited(child);
    await waitForLine(child, 'ready'); child.kill('SIGTERM');
    assert.deepEqual(await immediateExit, { code: 19, signal: null }, 'an immediate child exit is reaped after the interrupted wait');
    child = undefined;
    writeFileSync(join(f.data, '.restore-in-progress'), '{}');
    const interrupted = spawnSync('sh', [entrypoint, process.execPath, '-e', 'process.exit(0)'], { env });
    assert.equal(interrupted.status, 75);
    assert.match(interrupted.stderr.toString(), /restore was interrupted/);
  } finally { child?.kill('SIGKILL'); f.close(); }
});
