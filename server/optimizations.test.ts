import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from './store.ts';
import { ExperimentRunner } from './experiments.ts';
import { OptimizationRunner } from './optimizations.ts';
import { finalHoldoutAssessment, runFinalFixtureHoldout } from './holdout.ts';

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Timed out');
}

test('optimizer preserves baseline and reports no improvement on fixture evidence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-opt-'));
  const store = new RunStore(join(directory, 'runs.sqlite'));
  try {
    const runner = new ExperimentRunner(store, 'fixture');
    const optimizer = new OptimizationRunner(store, runner, 'fixture');
    assert.throws(() => runner.create({ taskIds: ['github-platform-v1'], settings: { modelAssignment: 'small', promptStyle: 'compact', cacheTtlMinutes: 10, maxSources: 2, parallelReads: true } }), /allowlisted/);
    const baseline = runner.create({ taskIds: ['github-platform-v1', 'cloudflare-workers-v1'] });
    await until(() => store.getExperiment(baseline.id)?.status === 'completed');
    const proposed = await optimizer.create({ baselineExperimentId: baseline.id });
    await until(() => store.getExperiment(proposed.candidateExperimentId)?.status === 'completed');
    const result = optimizer.list()[0];
    assert.equal(result.decision, 'no-improvement');
    assert.equal(result.status, 'completed');
    assert.equal(store.getExperiment(baseline.id)?.candidateId, 'baseline');
    assert.equal(result.settings.maxSources, 2);
    assert.equal(result.settings.parallelReads, true);
    assert.equal(store.getExperiment(proposed.candidateExperimentId)?.runIds.length, 2);
    const candidateRunId = store.getExperiment(proposed.candidateExperimentId)!.runIds[0];
    assert.equal(store.get(candidateRunId)?.output?.sources.length, 2);
    const holdout = await runFinalFixtureHoldout(store, result.id);
    assert.equal(holdout?.sampleSize, 2);
    assert.equal(holdout?.mode, 'fixture');
    assert.equal(holdout?.byTask.length, 2);
    assert.equal(store.getOptimization(result.id)?.holdoutBaselineRunIds?.length, 2);
    assert.equal(store.getOptimization(result.id)?.holdoutRunIds?.length, 2);
    assert.equal(finalHoldoutAssessment(store, result.id)?.sampleSize, 2);
    await assert.rejects(() => runFinalFixtureHoldout(store, result.id), /already started/);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('challenger rejects a regression on a baseline-correct task even if another task improves', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-opt-'));
  const store = new RunStore(join(directory, 'runs.sqlite'));
  try {
    const runner = new ExperimentRunner(store, 'fixture');
    const optimizer = new OptimizationRunner(store, runner, 'fixture');
    const baseline = runner.create({ taskIds: ['github-platform-v1', 'cloudflare-workers-v1'] });
    await until(() => store.getExperiment(baseline.id)?.status === 'completed');
    const proposed = await optimizer.create({ baselineExperimentId: baseline.id });
    await until(() => store.getExperiment(proposed.candidateExperimentId)?.status === 'completed');
    const baselineDev = store.get(store.getExperiment(baseline.id)!.runIds[0])!;
    baselineDev.output = { answer: 'GitHub is a developer platform.', facts: [{ claim: 'developer platform', sourceUrls: ['https://github.com/about'] }], sources: [{ title: 'GitHub', url: 'https://github.com/about', snippet: '' }] };
    store.save(baselineDev);
    const candidateVal = store.get(store.getExperiment(proposed.candidateExperimentId)!.runIds[1])!;
    candidateVal.output = { answer: 'Cloudflare Workers is serverless.', facts: [{ claim: 'serverless', sourceUrls: ['https://www.cloudflare.com/products/workers/'] }], sources: [{ title: 'Cloudflare', url: 'https://www.cloudflare.com/products/workers/', snippet: '' }] };
    store.save(candidateVal);
    const result = optimizer.list()[0];
    assert.equal(result.decision, 'rejected');
    assert.match(result.challenge, /regressed/);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('interrupted paired fixture holdout resumes without rerunning completed arms', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-holdout-'));
  const path = join(directory, 'runs.sqlite');
  let store = new RunStore(path);
  try {
    const runner = new ExperimentRunner(store, 'fixture');
    const optimizer = new OptimizationRunner(store, runner, 'fixture');
    const baseline = runner.create({ taskIds: ['github-platform-v1', 'cloudflare-workers-v1'] });
    await until(() => store.getExperiment(baseline.id)?.status === 'completed');
    const proposed = await optimizer.create({ baselineExperimentId: baseline.id });
    await until(() => store.getExperiment(proposed.candidateExperimentId)?.status === 'completed');
    optimizer.list();
    const first = store.getOptimization(proposed.id)!;
    first.holdoutStatus = 'running';
    store.saveOptimization(first);
    store.close();
    store = new RunStore(path);
    assert.equal(store.getOptimization(proposed.id)?.holdoutStatus, 'failed');
    const result = await runFinalFixtureHoldout(store, proposed.id);
    assert.equal(result?.sampleSize, 2);
    assert.equal(store.getOptimization(proposed.id)?.holdoutBaselineRunIds?.length, 2);
    assert.equal(store.getOptimization(proposed.id)?.holdoutRunIds?.length, 2);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
