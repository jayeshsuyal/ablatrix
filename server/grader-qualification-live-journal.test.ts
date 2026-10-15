import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendQualificationJournal, createQualificationJournal, publishQualificationJson, readQualificationJournal, type QualificationJournalBinding, type QualificationJournalRecord } from './grader-qualification-live-journal.ts';

const digest = (char: string) => char.repeat(64);
function fixture(t: TestContext) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-qualification-journal-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const binding: QualificationJournalBinding = { planSha256: digest('a'), datasetSha256: digest('b'), ledgerPath: join(dir, 'shared.sqlite'), claimDirectory: join(dir, 'claims'), checkpointPath: join(dir, 'execution.jsonl'), reportPath: join(dir, 'report.json'), transportProvenance: 'mocked_mechanics_only' };
  return { dir, binding };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function lines(path: string) { return readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line)); }
function writeLines(path: string, values: unknown[]) { writeFileSync(path, values.map(v => JSON.stringify(v)).join('\n') + '\n'); }

test('qualification journal independently anchors exact event bytes and read-only replay creates nothing', t => {
  const { binding } = fixture(t), handle = createQualificationJournal(binding);
  assert.equal(handle.paths.claimPath, join(binding.claimDirectory, `${binding.datasetSha256}.claim.jsonl`));
  appendQualificationJournal(handle, { kind: 'intent', approvedPlanSha256: binding.planSha256 });
  appendQualificationJournal(handle, { kind: 'slot_started', index: 0, runId: 'frozen-slot', requestSha256: digest('c') });
  appendQualificationJournal(handle, { kind: 'slot_reserved', index: 0, receiptId: 'opaque-id' });
  appendQualificationJournal(handle, { kind: 'slot_observed', index: 0, receiptStatus: 'accepted', receipt: { status: 'accepted', output: { units: [] } } });
  appendQualificationJournal(handle, { kind: 'finished' });
  const before = [handle.paths.checkpointPath, handle.paths.claimPath].map(path => ({ path, bytes: readFileSync(path, 'utf8'), modified: lstatSync(path).mtimeMs }));
  const inspected = readQualificationJournal(binding);
  assert.equal(inspected.records.length, 5); assert.equal(inspected.anchors.length, 6);
  assert.equal(inspected.records[3].receiptStatus, 'accepted');
  assert.equal(inspected.anchors.at(-1)?.checkpointBytes, Buffer.byteLength(before[0].bytes));
  for (const item of before) { assert.equal(readFileSync(item.path, 'utf8'), item.bytes); assert.equal(lstatSync(item.path).mtimeMs, item.modified); }
  assert.equal(existsSync(binding.reportPath), false); assert.equal(existsSync(binding.ledgerPath), false);
  assert.throws(() => appendQualificationJournal(handle, { kind: 'slot_started' }), /lifecycle/);
  assert.throws(() => appendQualificationJournal({ paths: handle.paths }, { kind: 'intent' }), /original/);
  publishQualificationJson(binding.reportPath, { status: 'mechanics_only', qualified: false });
  assert.equal(lstatSync(binding.reportPath).mode & 0o777, 0o444);
  assert.throws(() => publishQualificationJson(binding.reportPath, { qualified: true }), /EEXIST/);
});

test('qualification dataset claim consumes different plans and all preexisting outputs prevent resume', t => {
  const { dir, binding } = fixture(t), handle = createQualificationJournal(binding);
  appendQualificationJournal(handle, { kind: 'intent' });
  assert.throws(() => createQualificationJournal(binding), /consumed/);
  assert.throws(() => createQualificationJournal({ ...binding, planSha256: digest('c'), checkpointPath: join(dir, 'another.jsonl'), reportPath: join(dir, 'another-report.json') }), /consumed/);
  assert.throws(() => readQualificationJournal({ ...binding, planSha256: digest('c') }), /binding|anchors/);
  assert.throws(() => readQualificationJournal({ ...binding, transportProvenance: 'live_router' }), /binding|anchors/);
  assert.throws(() => readQualificationJournal({ ...binding, ledgerPath: join(dir, 'different.sqlite') }), /claim/);
  unlinkSync(handle.paths.claimPath);
  assert.throws(() => createQualificationJournal(binding), /consumed/);
  assert.throws(() => readQualificationJournal(binding), /ENOENT/);
});

test('concurrent processes cannot consume the same dataset under different plans', async t => {
  const { dir, binding } = fixture(t);
  const modulePath = fileURLToPath(new URL('./grader-qualification-live-journal.ts', import.meta.url));
  const run = (suffix: string) => new Promise<number | null>((resolve, reject) => {
    const options = { ...binding, planSha256: digest(suffix), checkpointPath: join(dir, `${suffix}.jsonl`), reportPath: join(dir, `${suffix}.json`) };
    const script = `import {createQualificationJournal} from ${JSON.stringify(modulePath)};try {createQualificationJournal(${JSON.stringify(options)});process.exitCode=0;}catch{process.exitCode=7;}`;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'ignore' });
    child.on('error', reject); child.on('close', resolve);
  });
  assert.deepEqual((await Promise.all([run('c'), run('d')])).sort(), [0, 7]);
  assert.equal(Number(existsSync(join(dir, 'c.jsonl'))) + Number(existsSync(join(dir, 'd.jsonl'))), 1);
});

test('journal rehashing cannot defeat independent original anchors', t => {
  const { binding } = fixture(t), handle = createQualificationJournal(binding);
  appendQualificationJournal(handle, { kind: 'intent' });
  appendQualificationJournal(handle, { kind: 'slot_observed', receiptStatus: 'invalid', receipt: { body: 'original' } });
  appendQualificationJournal(handle, { kind: 'stopped' });
  const records = lines(handle.paths.checkpointPath) as QualificationJournalRecord[];
  records[1].receiptStatus = 'accepted'; records[1].receipt = { body: 'rewritten' };
  for (const [index, record] of records.entries()) { record.previousSha256 = index ? records[index - 1].sha256 : digest('0'); const { sha256: _old, ...body } = record; record.sha256 = hash(body); }
  writeLines(handle.paths.checkpointPath, records);
  assert.throws(() => readQualificationJournal(binding), /claim/);
  assert.throws(() => appendQualificationJournal(handle, { kind: 'finished' }), /lifecycle/);
});

test('deleted tails, partial appends and complete unanchored tails fail strict read-only verification', async t => {
  for (const alteration of ['checkpoint_tail', 'anchor_tail', 'partial_checkpoint', 'partial_anchor', 'unanchored_complete', 'deleted_checkpoint'] as const) {
    await t.test(alteration, sub => {
      const { binding } = fixture(sub), handle = createQualificationJournal(binding);
      appendQualificationJournal(handle, { kind: 'intent' });
      appendQualificationJournal(handle, { kind: 'slot_started', index: 0 });
      const records = lines(handle.paths.checkpointPath), anchors = lines(handle.paths.claimPath);
      if (alteration === 'checkpoint_tail') writeLines(handle.paths.checkpointPath, records.slice(0, -1));
      if (alteration === 'anchor_tail') writeLines(handle.paths.claimPath, anchors.slice(0, -1));
      if (alteration === 'partial_checkpoint') appendFileSync(handle.paths.checkpointPath, '{"partial":');
      if (alteration === 'partial_anchor') appendFileSync(handle.paths.claimPath, '{"partial":');
      if (alteration === 'deleted_checkpoint') unlinkSync(handle.paths.checkpointPath);
      if (alteration === 'unanchored_complete') {
        const body = { ...records[1], kind: 'stopped', sequence: 2, previousSha256: records[1].sha256 }; delete body.sha256;
        appendFileSync(handle.paths.checkpointPath, JSON.stringify({ ...body, sha256: hash(body) }) + '\n');
      }
      const claimBefore = readFileSync(handle.paths.claimPath);
      assert.throws(() => readQualificationJournal(binding));
      assert.throws(() => appendQualificationJournal(handle, { kind: 'stopped' }));
      assert.deepEqual(readFileSync(handle.paths.claimPath), claimBefore);
      assert.throws(() => createQualificationJournal(binding), /consumed/);
    });
  }
});

test('replacement files and symlink or noncanonical path aliases are rejected', t => {
  const { dir, binding } = fixture(t), handle = createQualificationJournal(binding);
  appendQualificationJournal(handle, { kind: 'intent' });
  const checkpoint = readFileSync(handle.paths.checkpointPath);
  renameSync(handle.paths.checkpointPath, join(dir, 'old-checkpoint'));
  writeFileSync(handle.paths.checkpointPath, checkpoint);
  assert.throws(() => appendQualificationJournal(handle, { kind: 'stopped' }), /changed/);
  unlinkSync(handle.paths.checkpointPath); symlinkSync(join(dir, 'old-checkpoint'), handle.paths.checkpointPath);
  assert.throws(() => readQualificationJournal(binding), /symlinks/);
  const other = { ...binding, datasetSha256: digest('c'), checkpointPath: join(dir, 'fresh.jsonl'), reportPath: join(dir, 'fresh-report.json') };
  symlinkSync(join(dir, 'missing-report'), other.reportPath);
  assert.throws(() => createQualificationJournal(other), /symlinks/);
  assert.throws(() => publishQualificationJson(other.reportPath, {}), /symlinks/);
  assert.throws(() => createQualificationJournal({ ...other, reportPath: `${dir}/nested/../out.json` }), /normalized/);
  assert.throws(() => createQualificationJournal({ ...other, reportPath: 'relative.json' }), /normalized/);
  mkdirSync(join(dir, 'actual')); symlinkSync(join(dir, 'actual'), join(dir, 'alias'));
  assert.throws(() => createQualificationJournal({ ...other, claimDirectory: join(dir, 'alias', 'claims') }), /symlinks/);
});

test('journal rejects metadata overrides, non-JSON inputs, size excess and duplicate intent', t => {
  const { binding } = fixture(t), handle = createQualificationJournal(binding);
  assert.throws(() => appendQualificationJournal(handle, { kind: 'slot_started' }), /lifecycle/);
  assert.throws(() => appendQualificationJournal(handle, { kind: 'intent', sequence: 10 }), /metadata/);
  assert.throws(() => appendQualificationJournal(handle, { kind: 'intent', output: undefined }), /JSON/);
  assert.throws(() => appendQualificationJournal(handle, { kind: 'intent', output: Infinity }), /JSON/);
  assert.throws(() => appendQualificationJournal(handle, { kind: 'intent', output: new Date() }), /JSON/);
  assert.throws(() => appendQualificationJournal(handle, { kind: 'intent', body: 'x'.repeat(256 * 1024) }), /bound/);
  assert.equal(readQualificationJournal(binding).records.length, 0);
  appendQualificationJournal(handle, { kind: 'intent' });
  assert.throws(() => appendQualificationJournal(handle, { kind: 'intent' }), /lifecycle/);
  appendQualificationJournal(handle, { kind: 'stopped', reason: 'guard_failed' });
  assert.equal(readQualificationJournal(binding).records.at(-1)?.kind, 'stopped');
});
