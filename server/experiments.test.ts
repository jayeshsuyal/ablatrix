import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExperimentRunner } from './experiments.ts';
import { RunStore } from './store.ts';

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for experiment');
}

test('fixture runner persists bounded completion and cancellation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-exp-'));
  const store = new RunStore(join(directory, 'runs.sqlite'));
  try {
    const runner = new ExperimentRunner(store, 'fixture');
    const completed = runner.create({ taskIds: ['github-platform-v1'], maxAttempts: 1, maxDurationMs: 5000, maxSpendUsd: 0 });
    await until(() => store.getExperiment(completed.id)?.status === 'completed');
    assert.equal(store.getExperiment(completed.id)?.runIds.length, 1);
    const cancelled = runner.create({ taskIds: ['github-platform-v1', 'cloudflare-workers-v1'], fixtureDelayMs: 500, maxDurationMs: 5000 });
    await until(() => store.getExperiment(cancelled.id)?.status === 'running');
    runner.cancel(cancelled.id);
    await until(() => store.getExperiment(cancelled.id)?.status === 'cancelled');
    assert.equal(store.getExperiment(cancelled.id)?.runIds.length, 0);
    const timedOut = runner.create({ taskIds: ['github-platform-v1'], fixtureDelayMs: 2000, maxDurationMs: 1000 });
    await until(() => store.getExperiment(timedOut.id)?.status === 'failed');
    assert.equal(store.getExperiment(timedOut.id)?.runIds.length, 0);
    assert.match(store.getExperiment(timedOut.id)?.error ?? '', /time budget/);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('live interrupted jobs are not retried automatically', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-exp-'));
  const store = new RunStore(join(directory, 'runs.sqlite'));
  try {
    const now = new Date().toISOString();
    store.saveExperiment({
      id: 'interrupted', candidateId: 'baseline', mode: 'live', status: 'running',
      taskIds: ['github-platform-v1'], runIds: [], maxAttempts: 1, maxDurationMs: 5000,
      maxSpendUsd: 1, fixtureDelayMs: 0, createdAt: now, updatedAt: now,
      cancelRequested: false, error: null, steps: []
    });
    new ExperimentRunner(store, 'live');
    assert.equal(store.getExperiment('interrupted')?.status, 'interrupted');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('fixture recovery counts failed attempts and retries only within the cap', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-exp-'));
  const store = new RunStore(join(directory, 'runs.sqlite'));
  try {
    const now = new Date().toISOString();
    store.save({
      id: 'old-run', taskId: 'github-platform-v1', candidateId: 'baseline', mode: 'fixture',
      provider: 'fixture', model: null, status: 'failed',
      input: { entity: 'GitHub', question: 'What does GitHub provide for software teams?', taskId: 'github-platform-v1' },
      output: null, error: 'Old fixture failure', startedAt: now, finishedAt: now,
      durationMs: 1, costUsd: null, costStatus: 'fixture', usage: null
    });
    store.saveExperiment({
      id: 'recover', candidateId: 'baseline', mode: 'fixture', status: 'running',
      taskIds: ['github-platform-v1'], runIds: ['old-run'], maxAttempts: 2, maxDurationMs: 5000,
      maxSpendUsd: 0, fixtureDelayMs: 0, createdAt: now, updatedAt: now,
      cancelRequested: false, error: null, steps: []
    });
    new ExperimentRunner(store, 'fixture');
    await until(() => store.getExperiment('recover')?.status === 'completed');
    assert.equal(store.getExperiment('recover')?.runIds.length, 2);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
