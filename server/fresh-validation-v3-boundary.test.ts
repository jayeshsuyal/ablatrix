import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { textHash } from './product-corpus.ts';
import { assertFreshSnapshotBindings, freshValidationV3Cli, v3CalculationInput, v3CalculationOutput } from '../scripts/fresh-validation-contexts-v3.ts';

/** These are SYNTHETIC boundary fixtures. The copied TypeScript entry point is
 * byte-identical; a tiny synthetic Python verifier controls only the boundary
 * response. Real Python qualification is covered by its own synthetic suite.
 * No actual run, private source pool, model cache or dataset is opened. */
const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
function isolatedBoundary(verifier: string) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-fresh-v3-SYNTHETIC-')));
  mkdirSync(join(directory, 'scripts'));
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}\n');
  symlinkSync(join(root, 'server'), join(directory, 'server'), 'dir');
  symlinkSync(resolve(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
  for (const name of ['fresh-validation-contexts-v3.ts', 'fresh-validation-contexts-v2.ts']) {
    writeFileSync(join(directory, 'scripts', name), readFileSync(join(root, 'scripts', name)));
  }
  writeFileSync(join(directory, 'scripts', 'prepare-fresh-validation-v3.py'), verifier);
  const output = join(directory, 'SYNTHETIC-output.json');
  const run = (mode = '--baseline', extra: string[] = []) => spawnSync(process.execPath,
    ['--import', 'tsx', 'scripts/fresh-validation-contexts-v3.ts', mode,
      '--freeze-dir', 'SYNTHETIC-freeze', '--qualification', 'SYNTHETIC-pending.json',
      '--pool', 'SYNTHETIC-POOL-MUST-NOT-BE-OPENED.json', '--screening', 'SYNTHETIC-screening.json', '--out', output, ...extra],
    { cwd: directory, env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 20_000 });
  return { directory, output, run, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test('pending Python qualification stops the real v3 entry point before any fresh snapshot or output access', () => {
  const f = isolatedBoundary('import sys\nsys.stderr.write("SYNTHETIC pending qualification rejected before fresh access\\n")\nsys.exit(7)\n');
  try {
    for (const [mode, extra] of [['--baseline', []], ['--contexts', ['--baseline', 'SYNTHETIC-missing-baseline.json', '--review', 'SYNTHETIC-missing-review.json', '--selection', 'SYNTHETIC-missing-selection.json']]] as const) {
      const result = f.run(mode, [...extra]);
      assert.equal(result.error, undefined); assert.notEqual(result.status, 0);
      assert.match(result.stderr, /SYNTHETIC pending qualification rejected before fresh access/);
      assert.ok(!result.stderr.includes("lstat '"), 'The verifier must reject before TypeScript attempts any fresh input lstat.');
      assert.equal(existsSync(f.output), false);
    }
  } finally { f.cleanup(); }
});

test('a changed raw screening snapshot is rejected before cached inference or candidate calculation', () => {
  const f = isolatedBoundary('import json\nprint(json.dumps({"providerCalls":0,"artifactSha256":{"SYNTHETIC-screening.json":"' + '0'.repeat(64) + '"}}))\n');
  try {
    writeFileSync(join(f.directory, 'SYNTHETIC-screening.json'), '{"format":"ablatrix-fresh-validation-screening-v3","SYNTHETIC":true}\n');
    const result = f.run(); assert.equal(result.error, undefined); assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Loaded parsed snapshot differs from exact verified raw bytes/);
    assert.equal(existsSync(f.output), false);
  } finally { f.cleanup(); }
});

test('raw-byte binding detects whitespace changes even when the parsed screening is identical', () => {
  const raw = '{"format":"SYNTHETIC screening","orderedCases":["SYNTHETIC-1","SYNTHETIC-2"]}\n';
  const snapshot = { path: 'SYNTHETIC-screening.json', fileSha256: textHash(raw), document: JSON.parse(raw) };
  assertFreshSnapshotBindings([snapshot], { [snapshot.path]: snapshot.fileSha256 });
  const changed = { ...snapshot, fileSha256: textHash(raw + '\n'), document: JSON.parse(raw + '\n') };
  assert.deepEqual(changed.document, snapshot.document);
  assert.throws(() => assertFreshSnapshotBindings([changed], { [snapshot.path]: snapshot.fileSha256 }), /exact verified raw bytes/);
  assert.throws(() => assertFreshSnapshotBindings([snapshot], {}), /exact verified raw bytes/);
});

test('v3 adapters preserve all source scope, uncertainty and raw bindings without rewriting saved historical observations', () => {
  for (const kind of ['screening', 'baseline', 'source-review', 'selection'] as const) {
    const saved = { format: `ablatrix-fresh-validation-${kind}-v3`, screeningSha256: 'SYNTHETIC raw screening pin',
      originalQuestion: 'SYNTHETIC precise applicability question', sourceText: 'SYNTHETIC nearly eight hours before manual stopping.',
      retainedUncertainty: ['SYNTHETIC conditions unknown'], orderedCases: ['SYNTHETIC-2', 'SYNTHETIC-1'],
      artifactSha256: { 'SYNTHETIC-baseline.json': 'd'.repeat(64) }, sourceReviewSha256: 'e'.repeat(64) };
    const before = structuredClone(saved), projected = v3CalculationInput(saved, kind);
    assert.deepEqual(projected, { ...before, format: `ablatrix-fresh-validation-${kind}-v2` });
    assert.deepEqual(saved, before); assert.notEqual(projected, saved);
    assert.throws(() => v3CalculationInput({ ...saved, format: `ablatrix-fresh-validation-${kind}-v2` }, kind));
  }
  for (const kind of ['baseline', 'contexts'] as const) {
    const calculated = { format: `ablatrix-fresh-validation-${kind}-v2`, selectionSha256: 'SYNTHETIC bound original selection', results: [{ caseId: 'SYNTHETIC-case', missRetained: true }] };
    const before = structuredClone(calculated), saved = v3CalculationOutput(calculated, kind);
    assert.deepEqual(saved, { ...before, format: `ablatrix-fresh-validation-${kind}-v3` }); assert.deepEqual(calculated, before);
    assert.throws(() => v3CalculationOutput({ ...calculated, format: `ablatrix-fresh-validation-${kind}-v3` }, kind));
  }
});

test('v3 usage and malformed modes have no fresh-read or provider execution mode', async () => {
  const usage = await freshValidationV3Cli([]); assert.equal(usage.providerCalls, 0); assert.equal(usage.freshInputReads, 0);
  await assert.rejects(freshValidationV3Cli(['--execute']), /AssertionError/);
  await assert.rejects(freshValidationV3Cli(['--baseline', '--unknown', 'SYNTHETIC']), /AssertionError/);
});
