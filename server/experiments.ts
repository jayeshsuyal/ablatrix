import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type ExperimentRecord, type RunMode } from './contracts.ts';
import { taskForRun } from './evaluation.ts';
import { executeResearch } from './research.ts';
import { RunStore } from './store.ts';

export const experimentInput = z.object({
  taskIds: z.array(z.string()).min(1).max(2),
  maxAttempts: z.number().int().min(1).max(2).default(1),
  maxDurationMs: z.number().int().min(1_000).max(120_000).default(30_000),
  maxSpendUsd: z.number().nonnegative().max(100).default(0),
  fixtureDelayMs: z.number().int().min(0).max(5_000).default(0)
}).strict();

function step(record: ExperimentRecord, message: string): void {
  record.steps.push({ at: new Date().toISOString(), message });
  record.updatedAt = new Date().toISOString();
}

export class ExperimentRunner {
  private active = false;
  private halted = false;
  constructor(private store: RunStore, private mode: RunMode) {
    this.halted = mode === 'live' && store.hasInterruptedLiveExperiment();
    for (const record of store.pendingExperiments()) {
      if (record.status === 'running') {
        if (mode === 'live') {
          record.status = 'interrupted';
          record.error = 'A live attempt was interrupted; it will not be retried automatically because spend is unknown.';
          step(record, record.error);
          this.halted = true;
        } else {
          for (const runId of record.runIds) {
            const run = store.get(runId);
            if (run?.status === 'running') {
              run.status = 'failed'; run.error = 'Fixture attempt interrupted by restart.';
              run.finishedAt = new Date().toISOString();
              run.durationMs = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
              store.save(run);
            }
          }
          record.status = 'queued';
          step(record, 'Recovered interrupted fixture experiment.');
        }
        store.saveExperiment(record);
      }
    }
    if (!this.halted && store.pendingExperiments().some(item => item.status === 'queued')) queueMicrotask(() => this.drain());
  }
  create(raw: unknown): ExperimentRecord {
    if (this.halted && this.mode === 'live') throw new Error('Live queue is halted after an interrupted paid attempt; inspect provider usage before continuing');
    const input = experimentInput.parse(raw);
    if (new Set(input.taskIds).size !== input.taskIds.length) throw new Error('Duplicate task ID');
    if (input.taskIds.some(id => !taskForRun(id))) throw new Error('Only development and validation tasks are allowed');
    if (this.mode === 'live') {
      const approved = Number(process.env.ABLATRIX_SPEND_CAP_USD);
      if (!Number.isFinite(approved) || approved <= 0 || input.maxSpendUsd <= 0 || input.maxSpendUsd > approved || process.env.SAPIOM_BUDGET_ENFORCED !== '1') {
        throw new Error('Live experiment budget must be positive, at most the approved cap, and enforced upstream by Sapiom');
      }
    }
    const at = new Date().toISOString();
    const record: ExperimentRecord = {
      id: randomUUID(), candidateId: 'baseline', mode: this.mode,
      status: 'queued', taskIds: input.taskIds, runIds: [],
      maxAttempts: input.maxAttempts, maxDurationMs: input.maxDurationMs,
      maxSpendUsd: input.maxSpendUsd, fixtureDelayMs: input.fixtureDelayMs,
      createdAt: at, updatedAt: at, cancelRequested: false, error: null,
      steps: [{ at, message: 'Experiment queued.' }]
    };
    this.store.saveExperiment(record);
    queueMicrotask(() => this.drain());
    return record;
  }
  cancel(id: string): ExperimentRecord | null {
    const record = this.store.getExperiment(id);
    if (!record) return null;
    if (record.status === 'queued' || record.status === 'running') {
      record.cancelRequested = true;
      step(record, 'Cancellation requested. No further tasks will start.');
      if (record.status === 'queued') record.status = 'cancelled';
      this.store.saveExperiment(record);
    }
    return record;
  }
  private async drain(): Promise<void> {
    if (this.active || this.halted) return;
    this.active = true;
    try {
      while (!this.halted) {
        const record = this.store.pendingExperiments().find(item => item.status === 'queued');
        if (!record) break;
        await this.execute(record.id);
      }
    } finally { this.active = false; }
  }
  private async execute(id: string): Promise<void> {
    let record = this.store.getExperiment(id);
    if (!record || record.status !== 'queued') return;
    record.status = 'running'; step(record, 'Experiment started.'); this.store.saveExperiment(record);
    const deadline = Date.parse(record.createdAt) + record.maxDurationMs;
    const completedTaskIds = new Set(record.runIds.map(runId => this.store.get(runId)).filter(run => run?.status === 'completed').map(run => run?.taskId));
    for (const taskId of record.taskIds) {
      record = this.store.getExperiment(id)!;
      if (completedTaskIds.has(taskId)) continue;
      if (record.cancelRequested) break;
      if (Date.now() >= deadline) { record.error = 'Experiment time budget exhausted.'; break; }
      const task = taskForRun(taskId)!;
      const priorAttempts = record.runIds.map(runId => this.store.get(runId)).filter(run => run?.taskId === taskId).length;
      for (let attempt = priorAttempts + 1; attempt <= record.maxAttempts; attempt++) {
        record = this.store.getExperiment(id)!;
        if (record.cancelRequested || Date.now() >= deadline) break;
        step(record, `Starting ${taskId}, attempt ${attempt}.`); this.store.saveExperiment(record);
        if (record.fixtureDelayMs) {
          const until = Date.now() + record.fixtureDelayMs;
          while (Date.now() < until && Date.now() < deadline && !this.store.getExperiment(id)?.cancelRequested) {
            await new Promise(resolve => setTimeout(resolve, Math.min(50, until - Date.now(), deadline - Date.now())));
          }
          if (this.store.getExperiment(id)?.cancelRequested || Date.now() >= deadline) break;
        }
        const runId = randomUUID();
        record.runIds.push(runId);
        this.store.saveExperiment(record);
        const remainingMs = Math.max(1, deadline - Date.now());
        const runPromise = executeResearch(this.store, { entity: task.entity, question: task.question, taskId }, this.mode, 'baseline', runId);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timed = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Provider call exceeded experiment time budget; remote billing may continue.')), remainingMs); });
        let run;
        try { run = await Promise.race([runPromise, timed]); }
        catch (error) {
          record = this.store.getExperiment(id)!;
          record.error = error instanceof Error ? error.message : String(error);
          this.halted = this.mode === 'live';
          step(record, record.error);
          this.store.saveExperiment(record);
          break;
        } finally { if (timer) clearTimeout(timer); }
        record = this.store.getExperiment(id)!;
        step(record, `${taskId} attempt ${attempt}: ${run.status}.`);
        this.store.saveExperiment(record);
        if (run.status === 'completed') break;
        if (this.mode === 'live' && run.costStatus === 'unknown') {
          record.error = 'Live usage is unpriced; further paid attempts stopped.';
          break;
        }
      }
      if (Date.now() >= deadline && !record.cancelRequested) record.error = 'Experiment time budget exhausted.';
      const taskRuns = record.runIds.map(runId => this.store.get(runId)).filter(run => run?.taskId === taskId);
      if (!record.cancelRequested && !record.error && taskRuns.length && taskRuns.at(-1)?.status !== 'completed') {
        record.error = `${taskId} failed after ${taskRuns.length} attempt(s).`;
      }
      if (record.error) break;
      if (this.mode === 'live') {
        record.error = 'Live usage is unpriced; further paid tasks stopped.';
        break;
      }
    }
    const finalRecord = this.store.getExperiment(id)!;
    if (record.error) finalRecord.error = record.error;
    record = finalRecord;
    record.status = this.halted && this.mode === 'live' ? 'interrupted' : record.cancelRequested ? 'cancelled' : record.error ? 'failed' : 'completed';
    step(record, `Experiment ${record.status}.`);
    this.store.saveExperiment(record);
  }
}
