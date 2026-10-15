import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUALIFICATION_CODE_FILES, sealQualification, verifyQualification, rehearseQualification, type QualificationBundle } from '../server/grader-qualification.ts';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const names = ['plan', 'requests', 'references', 'record'] as const;
function canonicalPath(path: string) {
  assert.ok(isAbsolute(path) && resolve(path) === path, 'Use an absolute canonical artifact path.');
  let existing = path;
  while (!existsSync(existing)) { const parent = dirname(existing); assert.notEqual(parent, existing); existing = parent; }
  assert.equal(realpathSync(existing), existing, 'Artifact paths cannot traverse symlinks.');
  return path;
}
function exclusiveJson(path: string, value: unknown) {
  canonicalPath(path);
  const fd = openSync(path, 'wx', 0o444);
  try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
}
function codeHashes(commit: string) {
  assert.match(commit, /^[a-f0-9]{40}$/, 'Use the exact implementation commit SHA.');
  return Object.fromEntries(QUALIFICATION_CODE_FILES.map(path => {
    const current = createHash('sha256').update(readFileSync(resolve(repository, path))).digest('hex');
    const committed = createHash('sha256').update(execFileSync('git', ['show', `${commit}:${path}`], { cwd: repository, stdio: ['ignore', 'pipe', 'pipe'] })).digest('hex');
    assert.equal(current, committed, `Current implementation differs from committed code: ${path}`);
    return [path, current];
  }));
}
function readBundle(directory: string): QualificationBundle {
  canonicalPath(directory); assert.ok(lstatSync(directory).isDirectory(), 'Seal directory is required.');
  return Object.fromEntries(names.map(name => {
    const path = canonicalPath(resolve(directory, `${name}.json`));
    const stat = lstatSync(path); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 8 * 1024 * 1024, 'Seal components must be bounded regular JSON files.');
    return [name, JSON.parse(readFileSync(path, 'utf8'))];
  })) as QualificationBundle;
}

/** Offline only. Deliberately no execute mode, provider, .env, ledger or transport hook. */
export function runQualificationCli(argv: string[]) {
  if (!argv.length) return { usage: 'grader:qualification --prepare --implementation-commit <SHA> --out <absolute-new-directory> | --verify --dir <absolute-seal-directory> | --rehearse --dir <absolute-seal-directory> --out <absolute-new-report.json>', execution: 'offline_only', liveProviderCalls: 0, qualified: false };
  const command = argv[0]; assert.ok(['--prepare', '--verify', '--rehearse'].includes(command), 'Qualification supports only offline prepare, verify and rehearse.');
  const flags = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    assert.ok(argv[index]?.startsWith('--') && argv[index + 1] && !argv[index + 1].startsWith('--') && !flags.has(argv[index]), 'Flags require unique explicit values.');
    flags.set(argv[index], argv[index + 1]);
  }
  const expected = command === '--prepare' ? ['--implementation-commit', '--out'] : command === '--verify' ? ['--dir'] : ['--dir', '--out'];
  assert.deepEqual([...flags.keys()].sort(), expected.sort(), 'Unknown or missing qualification flag.');
  const flag = (name: string) => { const value = flags.get(name); assert.ok(value); return value; };
  if (command === '--prepare') {
    const implementationCommit = flag('--implementation-commit');
    const out = canonicalPath(flag('--out')); assert.ok(!existsSync(out), 'A seal cannot overwrite or resume an existing directory.');
    const bundle = sealQualification({ implementationCommit, codeFileSha256: codeHashes(implementationCommit), createdAt: new Date().toISOString() });
    // The new directory is the publication unit. An interrupted partial seal
    // remains unusable and cannot be retried into the same directory.
    mkdirSync(dirname(out), { recursive: true }); mkdirSync(out, { mode: 0o700 });
    for (const name of names) exclusiveJson(resolve(out, `${name}.json`), bundle[name]);
    return { mode: 'offline_seal_preparation', directory: out, planSha256: bundle.plan.planSha256, primaryCases: 80, repeatChecks: 12, liveProviderCalls: 0, qualified: false, financialApproval: 'not_granted', recordStatus: bundle.record.status };
  }
  const bundle = readBundle(flag('--dir'));
  const options = { implementationCommit: bundle.plan.implementationCommit, codeFileSha256: codeHashes(bundle.plan.implementationCommit) };
  verifyQualification(bundle, options);
  if (command === '--verify') return { mode: 'offline_seal_verification', planSha256: bundle.plan.planSha256, liveProviderCalls: 0, qualified: false, recordStatus: bundle.record.status };
  const out = canonicalPath(flag('--out')); assert.ok(existsSync(dirname(out)), 'Report parent directory must exist.');
  const report = rehearseQualification(bundle, options); exclusiveJson(out, report);
  return { mode: 'offline_mechanics_rehearsal', out, planSha256: bundle.plan.planSha256, rehearsalSha256: report.rehearsalSha256, engineeringGateMechanics: report.engineeringGateMechanics, metrics: report.metrics, liveProviderCalls: 0, qualified: false, recordStatus: report.qualificationRecord.status };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(runQualificationCli(process.argv.slice(2)))}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : 'Offline qualification failed.'}\n`); process.exitCode = 1; }
}
