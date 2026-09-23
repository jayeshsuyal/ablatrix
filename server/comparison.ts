import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { baselineConfig } from './config.ts';
import type { ExperimentRecord, OptimizationRecord, RunRecord } from './contracts.ts';
import { evaluate, publicTasks } from './evaluation.ts';
import { RunStore } from './store.ts';

type Side = { status: string; correct: boolean; attempts: number; durationMs: number | null; costUsd: number | null; errors: number; sources: { title: string; url: string }[] };

function side(experiment: ExperimentRecord, taskId: string, store: RunStore): Side {
  const runs = experiment.runIds.map(id => store.get(id)).filter((run): run is RunRecord => !!run && run.taskId === taskId);
  const latest = runs.at(-1);
  return {
    status: latest?.status ?? 'missing', correct: latest ? evaluate(latest)?.correct ?? false : false,
    attempts: runs.length,
    durationMs: runs.every(run => run.durationMs !== null) ? runs.reduce((sum, run) => sum + (run.durationMs ?? 0), 0) : null,
    costUsd: runs.length && runs.every(run => run.costStatus === 'priced' && run.costUsd !== null)
      ? runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0) : null,
    errors: runs.filter(run => run.status === 'failed').length,
    sources: latest?.output?.sources.map(source => ({ title: source.title, url: source.url })) ?? []
  };
}

function metrics(sides: Side[]) {
  const correct = sides.filter(item => item.correct).length;
  const costKnown = sides.every(item => item.costUsd !== null);
  const costUsd = costKnown ? sides.reduce((sum, item) => sum + (item.costUsd ?? 0), 0) : null;
  const durationKnown = sides.every(item => item.durationMs !== null);
  return {
    correct, total: sides.length, qualityRate: sides.length ? correct / sides.length : null,
    costUsd, costPerCorrectUsd: costUsd !== null && correct > 0 ? costUsd / correct : null,
    durationMs: durationKnown ? sides.reduce((sum, item) => sum + (item.durationMs ?? 0), 0) : null,
    failures: sides.reduce((sum, item) => sum + item.errors, 0)
  };
}

export function comparison(record: OptimizationRecord, store: RunStore) {
  const baseline = store.getExperiment(record.baselineExperimentId);
  const candidate = store.getExperiment(record.candidateExperimentId);
  if (!baseline || !candidate) throw new Error('Experiment not found');
  const rows = baseline.taskIds.map(taskId => {
    const first = side(baseline, taskId, store);
    const second = side(candidate, taskId, store);
    return { taskId, baseline: first, candidate: second, regression: first.correct && !second.correct };
  });
  const first = metrics(rows.map(row => row.baseline));
  const second = metrics(rows.map(row => row.candidate));
  const proposalCharge = record.proposalChargeId ? store.getCharge(record.proposalChargeId) : null;
  const proposalCostUsd = record.mode === 'fixture' ? null : proposalCharge?.status === 'settled' && proposalCharge.actualCents !== null
    ? proposalCharge.actualCents / 100 : null;
  const experimentCostUsd = record.mode === 'live' && first.costUsd !== null && second.costUsd !== null && proposalCostUsd !== null
    ? first.costUsd + second.costUsd + proposalCostUsd : null;
  const savings = first.costPerCorrectUsd !== null && second.costPerCorrectUsd !== null
    ? first.costPerCorrectUsd - second.costPerCorrectUsd : null;
  return {
    id: record.id, mode: record.mode, status: record.status, decision: record.decision,
    baseline: first, candidate: second, rows,
    experimentCostUsd,
    proposalCostUsd,
    breakEvenTasks: experimentCostUsd !== null && savings !== null && savings > 0 && record.decision === 'accepted'
      ? Math.ceil(experimentCostUsd / savings) : null,
    uncertainty: `Only ${rows.length} paired tasks; this cannot establish a general performance gain.`,
    costNote: record.mode === 'fixture' ? 'Synthetic fixture data; costs and performance are not live evidence.' : 'All attempts and proposal charges must be settled before cost and break-even are known.'
  };
}

export function exportArtifacts(record: OptimizationRecord, store: RunStore) {
  const result = comparison(record, store);
  const proposalCharge = record.proposalChargeId ? store.getCharge(record.proposalChargeId) : null;
  const original = `${JSON.stringify(baselineConfig, null, 2)}\n`;
  const candidate = `${JSON.stringify(record.settings, null, 2)}\n`;
  const baselineLines = original.trimEnd().split('\n');
  const candidateLines = candidate.trimEnd().split('\n');
  const patch = [
    'diff --git a/configs/research.json b/configs/research.json',
    '--- a/configs/research.json', '+++ b/configs/research.json',
    `@@ -1,${baselineLines.length} +1,${candidateLines.length} @@`,
    ...baselineLines.map(line => `-${line}`), ...candidateLines.map(line => `+${line}`), ''
  ].join('\n');
  const suite = publicTasks();
  const fixturePath = fileURLToPath(new URL('../data/tasks.v2.json', import.meta.url));
  const summarizeExperiment = (id: string) => {
    const experiment = store.getExperiment(id);
    if (!experiment) return null;
    return {
      id: experiment.id, status: experiment.status, mode: experiment.mode,
      taskIds: experiment.taskIds, settings: experiment.settings ?? baselineConfig,
      limits: { maxAttempts: experiment.maxAttempts, maxDurationMs: experiment.maxDurationMs, maxSpendUsd: experiment.maxSpendUsd },
      createdAt: experiment.createdAt, updatedAt: experiment.updatedAt,
      runs: experiment.runIds.map(runId => {
        const run = store.get(runId);
        if (!run) return { id: runId, unavailable: true };
        return {
          id: run.id, taskId: run.taskId, candidateId: run.candidateId,
          status: run.status, provider: run.provider, model: run.model,
          startedAt: run.startedAt, finishedAt: run.finishedAt, durationMs: run.durationMs,
          costUsd: run.costUsd, costStatus: run.costStatus, settings: run.settings ?? null,
          cacheHit: run.usage?.cacheHit === true,
          executionId: typeof run.usage?.executionId === 'string' ? run.usage.executionId : null,
          agentVersion: typeof run.usage?.agentVersion === 'string' ? run.usage.agentVersion : null,
          chargeReference: typeof run.usage?.chargeReference === 'string' ? run.usage.chargeReference : null,
          outputSha256: run.output ? createHash('sha256').update(JSON.stringify(run.output)).digest('hex') : null,
          sourceEvidence: run.output?.sources.map(source => ({ url: source.url, title: source.title,
            snippetSha256: createHash('sha256').update(source.snippet).digest('hex') })) ?? []
        };
      })
    };
  };
  const manifest = {
    formatVersion: 2, candidateId: record.candidateId, decision: record.decision,
    mode: record.mode, createdAt: record.createdAt,
    taskSuiteVersion: suite.version,
    taskSuiteSha256: createHash('sha256').update(readFileSync(fixturePath)).digest('hex'),
    taskIds: result.rows.map(row => row.taskId),
    baselineExperiment: summarizeExperiment(record.baselineExperimentId),
    candidateExperiment: summarizeExperiment(record.candidateExperimentId),
    proposalCharge: proposalCharge ? { status: proposalCharge.status, actualCents: proposalCharge.actualCents,
      evidence: proposalCharge.evidence } : null,
    proposalMetadata: record.proposalMetadata ?? null,
    sources: result.rows.flatMap(row => [...row.baseline.sources, ...row.candidate.sources].map(source => source.url)),
    requiredEnvNamesForLive: ['SAPIOM_API_KEY', 'SAPIOM_AGENT_SLUG', 'ABLATRIX_SPEND_CAP_USD', 'SAPIOM_BUDGET_ENFORCED'],
    codeCommit: process.env.ABLATRIX_BUILD_SHA ?? null,
    deployedAgentVersion: null,
    reproducibilityLimit: 'Source snapshots are not captured. Live web results can change; provider usage and deployed version appear only when returned by the metered adapter.',
    qualityLimit: result.uncertainty,
    costLimit: result.costNote
  };
  return { original, candidate, patch, manifest };
}

export function baselineConfigMatchesFile(): boolean {
  const path = fileURLToPath(new URL('../configs/research.json', import.meta.url));
  return readFileSync(path, 'utf8') === `${JSON.stringify(baselineConfig, null, 2)}\n`;
}
