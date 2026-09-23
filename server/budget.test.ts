import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from './store.ts';

test('reservations are durable, bounded, idempotently settled, and unknown calls block dispatch', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-budget-'));
  const path = join(directory, 'runs.sqlite');
  let store = new RunStore(path);
  try {
    store.reserveCharge('first', 'research', 40, 100);
    store.reserveCharge('second', 'proposal', 40, 100);
    assert.throws(() => store.reserveCharge('third', 'research', 30, 100), /exhausted/);
    assert.throws(() => store.reserveCharge('first', 'research', 40, 100), /Duplicate/);
    store.settleCharge('first', 25, 'provider:charge-1');
    store.settleCharge('first', 25, 'provider:charge-1');
    assert.throws(() => store.settleCharge('first', 26, 'provider:charge-1'), /Conflicting/);
    assert.equal(store.budgetSummary(100).availableCents, 35);
    store.close();
    store = new RunStore(path);
    assert.equal(store.getCharge('second')?.status, 'unknown');
    assert.throws(() => store.reserveCharge('third', 'research', 10, 100), /unknown paid call/);
    store.settleCharge('second', 20, 'provider:charge-2');
    store.reserveCharge('third', 'research', 55, 100);
    assert.equal(store.budgetSummary(100).availableCents, 0);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('two independent store connections cannot overreserve the same cap', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-budget-race-'));
  const path = join(directory, 'runs.sqlite');
  const first = new RunStore(path);
  const second = new RunStore(path);
  try {
    const results = await Promise.allSettled([
      Promise.resolve().then(() => first.reserveCharge('left', 'research', 70, 100)),
      Promise.resolve().then(() => second.reserveCharge('right', 'proposal', 70, 100))
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(first.budgetSummary(100).reservedCents, 70);
    assert.equal(first.getCharge('left')?.status ?? first.getCharge('right')?.status, 'reserved');
  } finally { first.close(); second.close(); rmSync(directory, { recursive: true, force: true }); }
});
