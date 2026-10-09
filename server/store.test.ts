import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from './store.ts';

function openStoreInAnotherProcess(path: string) {
  return spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '--eval', `
    import { RunStore } from ${JSON.stringify(new URL('./store.ts', import.meta.url).href)};
    const store = new RunStore(${JSON.stringify(path)});
    try {
      store.reserveCharge('same-id', 'research', 20, 100);
      console.log(JSON.stringify(store.budgetSummary(100)));
    } finally { store.close(); }
  `], { encoding: 'utf8', timeout: 10_000 });
}

test('in-memory stores remain independent while another process has one open', () => {
  const store = new RunStore(':memory:');
  try {
    store.reserveCharge('same-id', 'research', 70, 100);
    const other = openStoreInAnotherProcess(':memory:');
    assert.ifError(other.error);
    assert.equal(other.status, 0, other.stderr);
    assert.equal(JSON.parse(other.stdout).reservedCents, 20);
    assert.equal(store.budgetSummary(100).reservedCents, 70);
  } finally { store.close(); }
});

test('file-backed stores still reject another process while the owner is active', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-store-owner-'));
  const path = join(directory, 'runs.sqlite');
  const store = new RunStore(path);
  try {
    const other = openStoreInAnotherProcess(path);
    assert.ifError(other.error);
    assert.notEqual(other.status, 0);
    assert.match(other.stderr, /Database is owned by process/);
    assert.equal(store.budgetSummary(100).reservedCents, 0);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
