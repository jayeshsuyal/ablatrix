import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { allowedCandidateChange, baselineConfig, candidateId, researchConfig, type ResearchConfig } from './config.ts';
import type { ExperimentRecord, OptimizationRecord, RunRecord } from './contracts.ts';
import { evaluate } from './evaluation.ts';
import { ExperimentRunner } from './experiments.ts';
import { RunStore } from './store.ts';

const requestSchema = z.object({ baselineExperimentId: z.uuid() }).strict();

function fixtureProposal(baseline: ExperimentRecord, store: RunStore): ResearchConfig {
  const evaluations = baseline.runIds.map(id => store.get(id)).filter((run): run is RunRecord => !!run).map(run => evaluate(run)).filter(item => item?.split === 'development');
  if (evaluations.some(item => item && !item.deterministic.approvedSourcePresent)) {
    return { ...baselineConfig, maxSources: 2, parallelReads: true };
  }
  if (evaluations.some(item => item && !item.deterministic.answerTermsPresent)) {
    return { ...baselineConfig, modelAssignment: 'small' };
  }
  return { ...baselineConfig, promptStyle: 'compact' };
}

function score(experiment: ExperimentRecord, store: RunStore) {
  const runs = experiment.runIds.map(id => store.get(id)).filter((run): run is RunRecord => !!run);
  const latest = new Map<string, RunRecord>();
  for (const run of runs) latest.set(run.taskId, run);
  const passedTaskIds = new Set([...latest.values()].filter(run => evaluate(run)?.correct).map(run => run.taskId));
  const correct = passedTaskIds.size;
  const allPriced = runs.length > 0 && runs.every(run => run.mode === 'live' && run.costStatus === 'priced' && run.costUsd !== null);
  const cost = allPriced ? runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0) : null;
  return { correct, passedTaskIds, costPerCorrect: cost !== null && correct > 0 ? cost / correct : null, taskCount: latest.size };
}

export class OptimizationRunner {
  constructor(private store: RunStore, private experiments: ExperimentRunner, private mode: 'fixture' | 'live') {}
  async create(raw: unknown): Promise<OptimizationRecord> {
    if (this.mode === 'live') throw new Error('Live optimizer is blocked until total Router and experiment costs can be metered within one enforced budget');
    const input = requestSchema.parse(raw);
    const baseline = this.store.getExperiment(input.baselineExperimentId);
    if (!baseline || baseline.status !== 'completed' || baseline.candidateId !== 'baseline' || baseline.mode !== this.mode || baseline.taskIds.length < 2) {
      throw new Error('A completed two-task baseline experiment in the current mode is required');
    }
    const developmentRuns = baseline.runIds.map(id => this.store.get(id)).filter((run): run is RunRecord => !!run && evaluate(run)?.split === 'development');
    const developmentPasses = developmentRuns.filter(run => evaluate(run)?.correct).length;
    const investigation = `Development baseline: ${developmentRuns.length} attempt(s), ${developmentPasses} deterministic pass(es); fixture cost only. Validation is reserved for challenge.`;
    const proposed = fixtureProposal(baseline, this.store);
    const settings = researchConfig.parse(proposed);
    if (!allowedCandidateChange(settings) || candidateId(settings) === candidateId(baselineConfig)) throw new Error('Modifier proposal exceeds the allowlisted one-change boundary');
    const candidate = this.experiments.create({
      taskIds: baseline.taskIds, maxAttempts: baseline.maxAttempts,
      maxDurationMs: baseline.maxDurationMs, maxSpendUsd: baseline.maxSpendUsd,
      fixtureDelayMs: baseline.fixtureDelayMs, settings
    });
    const at = new Date().toISOString();
    const record: OptimizationRecord = {
      id: randomUUID(), mode: this.mode, status: 'running',
      baselineExperimentId: baseline.id, candidateExperimentId: candidate.id,
      candidateId: candidateId(settings), settings, createdAt: at, updatedAt: at,
      investigation, proposal: `Change from baseline: ${JSON.stringify(settings)}.`,
      decision: 'pending', challenge: 'Waiting for candidate evidence.', error: null
    };
    this.store.saveOptimization(record);
    return record;
  }
  refresh(record: OptimizationRecord): OptimizationRecord {
    if (record.status !== 'running') return record;
    const baseline = this.store.getExperiment(record.baselineExperimentId);
    const candidate = this.store.getExperiment(record.candidateExperimentId);
    if (!baseline || !candidate) {
      record.status = 'failed'; record.error = 'Experiment record missing.';
    } else if (candidate.status === 'completed') {
      const first = score(baseline, this.store);
      const second = score(candidate, this.store);
      const regressed = [...first.passedTaskIds].some(taskId => !second.passedTaskIds.has(taskId));
      if (second.taskCount !== first.taskCount || regressed) {
        record.decision = 'rejected'; record.challenge = 'Candidate lost task coverage or regressed on deterministic quality checks.';
      } else if (first.costPerCorrect === null || second.costPerCorrect === null || this.mode === 'fixture') {
        record.decision = 'no-improvement'; record.challenge = 'Cost per correct task is unpriced or fixture-only; improvement cannot be established.';
      } else if (second.costPerCorrect < first.costPerCorrect) {
        record.decision = 'accepted'; record.challenge = 'Candidate reduced priced cost per correct task without a measured quality regression in this small sample.';
      } else {
        record.decision = 'no-improvement'; record.challenge = 'Candidate did not reduce priced cost per correct task.';
      }
      record.status = 'completed';
    } else if (['failed', 'cancelled', 'interrupted'].includes(candidate.status)) {
      record.status = 'failed'; record.decision = 'rejected';
      record.error = candidate.error ?? `Candidate experiment ${candidate.status}.`;
      record.challenge = 'Candidate could not complete within the bounds.';
    }
    record.updatedAt = new Date().toISOString();
    this.store.saveOptimization(record);
    return record;
  }
  list(): OptimizationRecord[] { return this.store.listOptimizations().map(item => this.refresh(item)); }
}
