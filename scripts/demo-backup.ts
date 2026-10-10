import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, createReadStream, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

const lockName = '.runtime.lock';
const restoreMarker = '.restore-in-progress';
const fail = (message: string): never => { throw new Error(`Demo maintenance: ${message}`); };
const safeRelative = (value: string) => value.length > 0 && value.length <= 1024 && !isAbsolute(value) && !value.includes('\\') && !/[\u0000-\u001f\u007f]/.test(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
const isLock = (value: string) => basename(value) === lockName || basename(value).endsWith('.lock');
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const manifestSchema = z.object({
  format: z.literal('ablatrix-demo-snapshot-v1'), createdAt: z.iso.datetime(),
  application: z.object({ name: z.literal('ablatrix'), version: z.string().min(1).max(100), node: z.string().min(1).max(100), codeRevision: z.string().regex(/^[a-f0-9]{7,40}$/).nullable() }).strict(),
  consistency: z.literal('offline-exclusive-runtime-lock'),
  files: z.array(z.object({ path: z.string().refine(safeRelative), bytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(10000),
  databases: z.array(z.object({ path: z.string().refine(safeRelative), userVersion: z.number().int().nonnegative(), schemaSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(10000),
  omittedLocks: z.array(z.string().refine(safeRelative)).max(10000)
}).strict();
export type DemoSnapshotManifest = z.infer<typeof manifestSchema>;

function directory(path: string): string {
  if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()) fail('expected an existing directory without a symbolic link.');
  return realpathSync(path);
}
function newDestination(path: string): string {
  try { lstatSync(path); return fail('backup destination already exists; choose a new snapshot directory.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const parent = directory(dirname(resolve(path)));
  return join(parent, basename(resolve(path)));
}
function contains(root: string, child: string): boolean {
  const rel = relative(root, child);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
function inventory(root: string, omitLocks: boolean): { files: string[]; omittedLocks: string[] } {
  const files: string[] = [], omittedLocks: string[] = [];
  const visit = (prefix: string) => {
    for (const name of readdirSync(join(root, prefix)).sort()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (!safeRelative(path)) fail('unsafe data path.');
      const value = lstatSync(join(root, path));
      if (value.isSymbolicLink()) fail(`symbolic links are not allowed: ${path}`);
      if (omitLocks && isLock(path)) { if (!value.isFile()) fail('lock path must be a regular file.'); omittedLocks.push(path); continue; }
      if (value.isDirectory()) visit(path);
      else if (value.isFile()) files.push(path);
      else fail(`only regular data files and directories are allowed: ${path}`);
    }
  };
  visit('');
  return { files, omittedLocks };
}
async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
function copyRegular(source: string, destination: string) {
  const value = lstatSync(source);
  if (!value.isFile() || value.isSymbolicLink()) fail('source changed into an unsafe file.');
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  copyFileSync(source, destination);
  chmodSync(destination, 0o600);
}
function isDatabase(root: string, path: string) {
  if (/\.(?:sqlite3?|db)$/i.test(path)) return true;
  const descriptor = openSync(join(root, path), 'r'), header = Buffer.alloc(16);
  try { return readSync(descriptor, header, 0, header.length, 0) === 16 && header.toString('ascii') === 'SQLite format 3\0'; }
  finally { closeSync(descriptor); }
}
function checkDatabases(root: string, files: string[]): DemoSnapshotManifest['databases'] {
  return files.filter(path => isDatabase(root, path)).map(path => {
    let db: DatabaseSync | undefined;
    try {
      // Recovery may need to roll back a hot DELETE journal or checkpoint a
      // WAL. This helper only receives a private copy, never the source root.
      db = new DatabaseSync(join(root, path));
      const rows = db.prepare('PRAGMA integrity_check').all();
      if (rows.length !== 1 || Object.values(rows[0])[0] !== 'ok') fail(`SQLite integrity check failed: ${path}`);
      const userVersion = Number(db.prepare('PRAGMA user_version').get()!.user_version);
      const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
      return { path, userVersion, schemaSha256: sha(JSON.stringify(schema)) };
    } catch { return fail(`SQLite integrity check failed: ${path}`); }
    finally { db?.close(); }
  });
}

/** The CLI only runs as a child of the shared flock-owning entrypoint. */
export function assertRuntimeLock(dataDir: string, environment: NodeJS.ProcessEnv = process.env) {
  if (environment.ABLATRIX_RUNTIME_LOCK_HELD !== '1' || !/^\d+$/.test(environment.ABLATRIX_RUNTIME_LOCK_FD ?? '')) fail('run maintenance through scripts/demo-entrypoint.sh while the app is stopped.');
  if (process.platform !== 'linux') fail('runtime ownership verification requires Linux and util-linux flock.');
  const root = directory(dataDir), path = join(root, lockName);
  const fd = Number(environment.ABLATRIX_RUNTIME_LOCK_FD);
  try {
    const file = lstatSync(path), descriptor = fstatSync(fd);
    if (!file.isFile() || file.isSymbolicLink() || file.ino !== descriptor.ino || file.dev !== descriptor.dev) fail('runtime lock descriptor does not match the data directory.');
  } catch { fail('runtime lock descriptor does not match the data directory.'); }
  // Matching an inode alone does not prove ownership: a separately opened FD
  // names the same file. flock uses the shared open-file description, so this
  // succeeds for an inherited owner and fails for a competing descriptor. If
  // initially unlocked, it acquires a real lock that persists on the caller FD.
  const ownership = spawnSync('flock', ['-n', '3'], { stdio: ['ignore', 'ignore', 'pipe', fd] });
  if (ownership.error || ownership.status !== 0) fail('exclusive runtime lock is unavailable; stop the other app or maintenance process.');
}

/** Called under the runtime lock with every app/worker connection closed. */
export async function backupDemoData(dataDir: string, output: string): Promise<DemoSnapshotManifest> {
  const root = directory(dataDir), destination = newDestination(output);
  if (contains(root, destination)) fail('backup destination must be outside the data directory.');
  if (existsSync(join(root, restoreMarker))) fail('an interrupted restore must be resolved before backup.');
  const source = inventory(root, true);
  const temporary = mkdtempSync(join(dirname(destination), '.ablatrix-backup-'));
  try {
    const payload = join(temporary, 'data'); mkdirSync(payload, { mode: 0o700 });
    for (const path of source.files) copyRegular(join(root, path), join(payload, path));
    // Check the copy, so SQLite never opens or changes the source ledgers.
    const databases = checkDatabases(payload, source.files);
    const copied = inventory(payload, false);
    const files = await Promise.all(copied.files.map(async path => ({ path, bytes: statSync(join(payload, path)).size, sha256: await hashFile(join(payload, path)) })));
    const app = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    const revision = process.env.ABLATRIX_BUILD_COMMIT;
    const manifest: DemoSnapshotManifest = { format: 'ablatrix-demo-snapshot-v1', createdAt: new Date().toISOString(), application: { name: 'ablatrix', version: app.version, node: process.version, codeRevision: revision && /^[a-f0-9]{7,40}$/.test(revision) ? revision : null }, consistency: 'offline-exclusive-runtime-lock', files, databases, omittedLocks: source.omittedLocks };
    manifestSchema.parse(manifest);
    writeFileSync(join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    if (existsSync(destination)) fail('backup destination appeared while copying; refusing to replace it.');
    renameSync(temporary, destination);
    return manifest;
  } catch (error) { rmSync(temporary, { recursive: true, force: true }); throw error; }
}

/** Validates a private copy before writing anything into an empty data directory. */
export async function restoreDemoData(dataDir: string, input: string): Promise<DemoSnapshotManifest> {
  const root = directory(dataDir), snapshot = directory(input);
  if (contains(root, snapshot) || contains(snapshot, root)) fail('snapshot and restore directories must be separate.');
  if (readdirSync(root).some(name => name !== lockName)) fail('restore requires an empty data directory apart from its runtime lock.');
  if (existsSync(join(root, lockName)) && (!lstatSync(join(root, lockName)).isFile() || lstatSync(join(root, lockName)).isSymbolicLink())) fail('unsafe runtime lock.');
  const manifestPath = join(snapshot, 'manifest.json');
  if (!existsSync(manifestPath) || !lstatSync(manifestPath).isFile() || lstatSync(manifestPath).isSymbolicLink() || statSync(manifestPath).size > 4 * 1024 * 1024) fail('snapshot manifest must be a regular JSON file of at most 4 MiB.');
  let manifest: DemoSnapshotManifest;
  try { manifest = manifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8'))); }
  catch { return fail('snapshot manifest is invalid.'); }
  const payload = directory(join(snapshot, 'data'));
  if (readdirSync(snapshot).some(name => name !== 'manifest.json' && name !== 'data')) fail('snapshot contains unexpected entries.');
  const paths = manifest.files.map(file => file.path);
  if (new Set(paths).size !== paths.length || paths.some(path => isLock(path) || path === restoreMarker) || new Set(manifest.databases.map(db => db.path)).size !== manifest.databases.length) fail('snapshot contains duplicate or forbidden paths.');
  const actual = inventory(payload, false).files;
  if (JSON.stringify([...paths].sort()) !== JSON.stringify(actual.sort())) fail('snapshot files do not match its manifest.');
  const staging = mkdtempSync(join(tmpdir(), 'ablatrix-restore-'));
  let installing = false;
  try {
    for (const file of manifest.files) {
      const source = join(payload, file.path);
      if (statSync(source).size !== file.bytes || await hashFile(source) !== file.sha256) fail(`snapshot hash mismatch: ${file.path}`);
      const copied = join(staging, file.path);
      copyRegular(source, copied);
      if (statSync(copied).size !== file.bytes || await hashFile(copied) !== file.sha256) fail(`snapshot changed during validation: ${file.path}`);
    }
    const databases = checkDatabases(staging, paths);
    if (JSON.stringify(databases) !== JSON.stringify(manifest.databases)) fail('snapshot database schema metadata does not match.');
    // Recovery can remove journals or checkpoint WAL. Install the validated,
    // normalized private copy instead of reading the external snapshot again.
    const installedFiles = await Promise.all(inventory(staging, false).files.map(async path => ({ path, bytes: statSync(join(staging, path)).size, sha256: await hashFile(join(staging, path)) })));
    writeFileSync(join(root, restoreMarker), `${JSON.stringify({ snapshot: basename(snapshot), startedAt: new Date().toISOString(), token: randomUUID() })}\n`, { flag: 'wx', mode: 0o600 });
    installing = true;
    for (const file of installedFiles) {
      const target = join(root, file.path);
      copyRegular(join(staging, file.path), target);
      if (statSync(target).size !== file.bytes || await hashFile(target) !== file.sha256) fail(`validated data changed during restore: ${file.path}`);
    }
    rmSync(join(root, restoreMarker));
    installing = false;
    return manifest;
  } catch (error) {
    if (installing) {
      // The destination started empty and is exclusively locked. Leave the
      // marker if cleanup fails so a partially restored app cannot start.
      for (const name of readdirSync(root)) if (name !== lockName && name !== restoreMarker) rmSync(join(root, name), { recursive: true, force: true });
      rmSync(join(root, restoreMarker));
    }
    throw error;
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

async function main() {
  const [command, flag, path, ...extra] = process.argv.slice(2);
  if (extra.length || !path || !((command === 'backup' && flag === '--destination') || (command === 'restore' && flag === '--source'))) fail('usage: demo-backup.ts backup --destination <new snapshot directory> | restore --source <snapshot directory>');
  const dataDir = process.env.ABLATRIX_DATA_DIR ?? '/data';
  assertRuntimeLock(dataDir);
  const manifest = command === 'backup' ? await backupDemoData(dataDir, path) : await restoreDemoData(dataDir, path);
  console.log(JSON.stringify({ operation: command, directory: resolve(path), files: manifest.files.length, databases: manifest.databases.length, format: manifest.format }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Demo maintenance failed.'); process.exitCode = 1; });
}
