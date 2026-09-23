import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baselineConfig } from './config.ts';
import { baselineConfigMatchesFile, comparison, exportArtifacts } from './comparison.ts';
import type { ExperimentRecord, OptimizationRecord, RunRecord } from './contracts.ts';
import { RunStore } from './store.ts';
import { loadCandidateConfig } from './replay.ts';

test('comparison counts failed attempt cost and export is a reproducible secret-free patch', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-export-'));
  const store = new RunStore(join(directory, 'runs.sqlite'));
  try {
    assert.equal(baselineConfigMatchesFile(), true);
    const at = new Date().toISOString();
    const makeRun = (id: string, status: 'completed' | 'failed', costUsd: number): RunRecord => ({
      id, taskId: 'github-platform-v1', candidateId: id.startsWith('b') ? 'baseline' : 'candidate-test', mode: 'live',
      provider: 'sapiom', model: null, status,
      input: { entity: 'GitHub', question: 'What does GitHub provide for software teams?', taskId: 'github-platform-v1' },
      output: status === 'completed' ? {
        answer: 'GitHub is a developer platform.',
        facts: [{ claim: 'developer platform', sourceUrls: ['https://github.com/about'] }],
        sources: [{ title: 'GitHub', url: 'https://github.com/about', snippet: '' }]
      } : null,
      error: status === 'failed' ? 'Failure' : null, startedAt: at, finishedAt: at,
      durationMs: 10, costUsd, costStatus: 'priced', usage: null, settings: baselineConfig
    });
    store.save(makeRun('b1', 'failed', 0.02));
    store.save(makeRun('b2', 'completed', 0.03));
    store.save(makeRun('c1', 'completed', 0.04));
    const makeExperiment = (id: string, runIds: string[]): ExperimentRecord => ({
      id, candidateId: id === 'baseline-id' ? 'baseline' : 'candidate-test', mode: 'live', status: 'completed',
      taskIds: ['github-platform-v1'], runIds, maxAttempts: 2, maxDurationMs: 30000, maxSpendUsd: 1,
      fixtureDelayMs: 0, createdAt: at, updatedAt: at, cancelRequested: false, error: null, steps: []
    });
    store.saveExperiment(makeExperiment('baseline-id', ['b1', 'b2']));
    store.saveExperiment(makeExperiment('candidate-id', ['c1']));
    const record: OptimizationRecord = {
      id: 'optimization-id', mode: 'live', status: 'completed', baselineExperimentId: 'baseline-id',
      candidateExperimentId: 'candidate-id', candidateId: 'candidate-test',
      settings: { ...baselineConfig, promptStyle: 'compact' }, createdAt: at, updatedAt: at,
      investigation: '', proposal: '', decision: 'accepted', challenge: '', error: null
    };
    const result = comparison(record, store);
    assert.equal(result.baseline.costPerCorrectUsd, 0.05);
    assert.equal(result.candidate.costPerCorrectUsd, 0.04);
    assert.equal(result.baseline.failures, 1);
    const artifacts = exportArtifacts(record, store);
    const candidatePath = join(directory, 'candidate.json');
    writeFileSync(candidatePath, artifacts.candidate);
    assert.equal(loadCandidateConfig(candidatePath).promptStyle, 'compact');
    assert.match(artifacts.patch, /\+  "promptStyle": "compact"/);
    assert.equal(artifacts.manifest.taskSuiteVersion, 2);
    assert.equal(artifacts.manifest.baselineExperiment?.runs.length, 2);
    assert.equal(artifacts.manifest.candidateExperiment?.runs.length, 1);
    assert.equal(artifacts.manifest.baselineExperiment?.limits.maxAttempts, 2);
    assert(!JSON.stringify(artifacts).includes('SAPIOM_API_KEY='));
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
