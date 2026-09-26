import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baselineConfig } from './config.ts';
import type { MeteredLiveProvider } from './live-provider.ts';
import { ExperimentRunner } from './experiments.ts';
import { OptimizationRunner } from './optimizations.ts';
import { RunStore } from './store.ts';
import { comparison, exportArtifacts } from './comparison.ts';

async function until(check: () => boolean) {
  for (let i = 0; i < 150; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('Timed out waiting for live-path fixture');
}

test('metered fake live baseline, proposal, candidate, and challenger share one durable cap', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-live-path-'));
  const store = new RunStore(join(directory, 'runs.sqlite'));
  const provider: MeteredLiveProvider = {
    readiness: () => ({ ready: true, reason: 'fake meter', approvedCapCents: 100,
      maxResearchCents: 12, maxProposalCents: 6, remoteCapEvidence: 'fake enforced cap' }),
    research: async (input, attemptId, settings) => {
      const github = input.taskId === 'github-platform-v1';
      const url = github ? 'https://github.com/about' : 'https://www.cloudflare.com/products/workers/';
      return {
        status: 'completed' as const, output: { answer: github ? 'GitHub is a developer platform.' : 'Cloudflare Workers is a serverless platform.',
          facts: [{ claim: github ? 'developer platform' : 'Workers serverless', sourceUrls: [url] }],
          sources: [{ title: github ? 'GitHub' : 'Cloudflare', url, snippet: 'checked source' }] },
        error: null, charge: { cents: settings.promptStyle === 'compact' ? 8 : 10, reference: `fake:${attemptId}` },
        executionId: attemptId, model: 'fake-model', agentVersion: 'fake-build-1', usage: { cacheHit: false }
      };
    },
    propose: async (_investigation, attemptId) => ({ settings: { ...baselineConfig, promptStyle: 'compact' },
      charge: { cents: 5, reference: `fake:${attemptId}` }, model: 'fake-proposer', requestId: attemptId, usage: { tokens: 12 } })
  };
  try {
    const runner = new ExperimentRunner(store, 'live', provider);
    const optimizer = new OptimizationRunner(store, runner, 'live', provider);
    const baseline = runner.create({ taskIds: ['github-platform-v1', 'cloudflare-workers-v1'], maxSpendUsd: 1 });
    await until(() => store.getExperiment(baseline.id)?.status === 'completed');
    const optimization = await optimizer.create({ baselineExperimentId: baseline.id });
    await until(() => store.getExperiment(optimization.candidateExperimentId)?.status === 'completed');
    const decision = optimizer.refresh(store.getOptimization(optimization.id)!);
    assert.equal(decision.decision, 'accepted');
    assert.equal(store.budgetSummary(100).settledCents, 41);
    assert.equal(store.getCharge(decision.proposalChargeId!)?.actualCents, 5);
    assert.equal(store.getExperiment(optimization.candidateExperimentId)?.runIds.length, 2);
    const compared = comparison(decision, store);
    assert.equal(compared.experimentCostUsd, 0.41);
    assert.equal(compared.breakEvenTasks, 21);
    assert.equal(exportArtifacts(decision, store).manifest.candidateExperiment?.runs.length, 2);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('missing charge holds the live queue and prevents a second paid task', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-live-unknown-'));
  const store = new RunStore(join(directory, 'runs.sqlite'));
  let calls = 0;
  const provider: MeteredLiveProvider = {
    readiness: () => ({ ready: true, reason: 'fake', approvedCapCents: 100,
      maxResearchCents: 20, maxProposalCents: 10, remoteCapEvidence: 'fake cap' }),
    research: async (_input, attemptId) => {
      calls++;
      return { status: 'failed', output: null, error: 'failed', charge: { cents: NaN, reference: '' },
        executionId: attemptId, model: null, agentVersion: null, usage: null };
    },
    propose: async () => { throw new Error('not reached'); }
  };
  try {
    const runner = new ExperimentRunner(store, 'live', provider);
    const job = runner.create({ taskIds: ['github-platform-v1', 'cloudflare-workers-v1'], maxSpendUsd: 1 });
    await until(() => store.getExperiment(job.id)?.status === 'interrupted');
    assert.equal(calls, 1);
    assert.equal(store.budgetSummary(100).unknownCents, 20);
    assert.throws(() => runner.create({ taskIds: ['github-platform-v1'], maxSpendUsd: 1 }), /halted/);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('verified local cap refuses a second task before dispatch', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-live-cap-'));
  const store = new RunStore(join(directory, 'runs.sqlite'));
  let calls = 0;
  const provider: MeteredLiveProvider = {
    readiness: () => ({ ready: true, reason: 'fake', approvedCapCents: 20,
      maxResearchCents: 12, maxProposalCents: 5, remoteCapEvidence: 'fake cap' }),
    research: async (_input, attemptId) => {
      calls++;
      return { status: 'completed', output: { answer: 'GitHub is a developer platform.',
        facts: [{ claim: 'developer platform', sourceUrls: ['https://github.com/about'] }],
        sources: [{ title: 'GitHub', url: 'https://github.com/about', snippet: '' }] }, error: null,
        charge: { cents: 10, reference: `fake:${attemptId}` },
        executionId: attemptId, model: null, agentVersion: null, usage: null };
    },
    propose: async () => { throw new Error('not reached'); }
  };
  try {
    const runner = new ExperimentRunner(store, 'live', provider);
    const job = runner.create({ taskIds: ['github-platform-v1', 'cloudflare-workers-v1'], maxSpendUsd: 0.2 });
    await until(() => store.getExperiment(job.id)?.status === 'failed');
    assert.equal(calls, 1);
    assert.equal(store.budgetSummary(20).settledCents, 10);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

for (const outcome of ['no-improvement', 'regression', 'proposal-timeout', 'malformed-proposal'] as const) {
  test(`fake live challenger handles ${outcome} without inventing a win`, async () => {
    const directory = mkdtempSync(join(tmpdir(), `ablatrix-${outcome}-`));
    const store = new RunStore(join(directory, 'runs.sqlite'));
    const provider: MeteredLiveProvider = {
      readiness: () => ({ ready: true, reason: 'fake', approvedCapCents: 100,
        maxResearchCents: 12, maxProposalCents: 6, remoteCapEvidence: 'fake cap' }),
      research: async (input, attemptId, settings) => {
        const github = input.taskId === 'github-platform-v1';
        const regression = outcome === 'regression' && github && settings.promptStyle === 'compact';
        const url = github ? 'https://github.com/about' : 'https://www.cloudflare.com/products/workers/';
        return { status: 'completed', output: {
          answer: regression ? 'No supported answer.' : github ? 'GitHub is a developer platform.' : 'Cloudflare Workers is serverless.',
          facts: [{ claim: 'source', sourceUrls: [url] }], sources: [{ title: 'Official', url, snippet: '' }]
        }, error: null, charge: { cents: outcome === 'no-improvement' ? 10 : settings.promptStyle === 'compact' ? 5 : 10,
          reference: `fake:${attemptId}` }, executionId: attemptId, model: 'fake', agentVersion: 'v1', usage: null };
      },
      propose: async (_investigation, attemptId) => {
        if (outcome === 'proposal-timeout') throw new Error('Timeout after dispatch');
        return { settings: outcome === 'malformed-proposal' ? {} as typeof baselineConfig : { ...baselineConfig, promptStyle: 'compact' as const },
          charge: { cents: 5, reference: `fake:${attemptId}` }, model: 'fake', requestId: attemptId, usage: null };
      }
    };
    try {
      const runner = new ExperimentRunner(store, 'live', provider);
      const optimizer = new OptimizationRunner(store, runner, 'live', provider);
      const baseline = runner.create({ taskIds: ['github-platform-v1', 'cloudflare-workers-v1'], maxSpendUsd: 1 });
      await until(() => store.getExperiment(baseline.id)?.status === 'completed');
      if (outcome === 'proposal-timeout' || outcome === 'malformed-proposal') {
        await assert.rejects(() => optimizer.create({ baselineExperimentId: baseline.id }));
        assert.equal(store.budgetSummary(100).unknownCents, outcome === 'proposal-timeout' ? 6 : 0);
        assert.equal(store.listOptimizations()[0].status, 'failed');
      } else {
        const optimization = await optimizer.create({ baselineExperimentId: baseline.id });
        await until(() => store.getExperiment(optimization.candidateExperimentId)?.status === 'completed');
        const decision = optimizer.refresh(store.getOptimization(optimization.id)!);
        assert.equal(decision.decision, outcome === 'regression' ? 'rejected' : 'no-improvement');
        assert.equal(comparison(decision, store).breakEvenTasks, null);
      }
    } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
  });
}

test('live cancellation stops future dispatch but settles the already-running remote call', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-live-cancel-'));
  const store = new RunStore(join(directory, 'runs.sqlite'));
  let calls = 0;
  const provider: MeteredLiveProvider = {
    readiness: () => ({ ready: true, reason: 'fake', approvedCapCents: 100,
      maxResearchCents: 12, maxProposalCents: 6, remoteCapEvidence: 'fake cap' }),
    research: async (_input, attemptId) => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 80));
      return { status: 'completed', output: { answer: 'GitHub is a developer platform.',
        facts: [{ claim: 'developer platform', sourceUrls: ['https://github.com/about'] }],
        sources: [{ title: 'GitHub', url: 'https://github.com/about', snippet: '' }] }, error: null,
        charge: { cents: 10, reference: `fake:${attemptId}` }, executionId: attemptId,
        model: 'fake', agentVersion: 'v1', usage: null };
    },
    propose: async () => { throw new Error('not reached'); }
  };
  try {
    const runner = new ExperimentRunner(store, 'live', provider);
    const job = runner.create({ taskIds: ['github-platform-v1', 'cloudflare-workers-v1'], maxSpendUsd: 1 });
    await until(() => calls === 1);
    runner.cancel(job.id);
    await until(() => store.getExperiment(job.id)?.status === 'cancelled');
    assert.equal(calls, 1);
    assert.equal(store.budgetSummary(100).settledCents, 10);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('timed-out live call remains unknown even if its transport completes later', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-live-timeout-'));
  const store = new RunStore(join(directory, 'runs.sqlite'));
  const provider: MeteredLiveProvider = {
    readiness: () => ({ ready: true, reason: 'fake', approvedCapCents: 100,
      maxResearchCents: 20, maxProposalCents: 5, remoteCapEvidence: 'fake cap' }),
    research: async (_input, attemptId) => {
      await new Promise(resolve => setTimeout(resolve, 1_100));
      return { status: 'failed', output: null, error: 'late result', charge: { cents: 4, reference: `fake:${attemptId}` },
        executionId: attemptId, model: null, agentVersion: null, usage: null };
    },
    propose: async () => { throw new Error('not reached'); }
  };
  try {
    const runner = new ExperimentRunner(store, 'live', provider);
    const job = runner.create({ taskIds: ['github-platform-v1'], maxDurationMs: 1_000, maxSpendUsd: 1 });
    await until(() => store.getExperiment(job.id)?.status === 'interrupted');
    assert.equal(store.budgetSummary(100).unknownCents, 20);
    await until(() => {
      const id = store.getExperiment(job.id)?.runIds[0];
      return !!id && store.get(id)?.status === 'failed';
    });
    assert.equal(store.budgetSummary(100).unknownCents, 20);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
