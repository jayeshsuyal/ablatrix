import { randomUUID } from 'node:crypto';
import { researchOutput, type ResearchInput, type RunMode, type RunRecord } from './contracts.ts';
import { runFixture } from './fixture.ts';
import { runSapiom } from './sapiom.ts';
import { RunStore } from './store.ts';

export async function executeResearch(store: RunStore, input: ResearchInput, mode: RunMode, candidateId = 'baseline', runId = randomUUID()): Promise<RunRecord> {
  const now = Date.now();
  const run: RunRecord = {
    id: runId, taskId: input.taskId ?? randomUUID(), candidateId, mode,
    provider: mode === 'live' ? 'sapiom' : 'fixture', model: null, status: 'running',
    input, output: null, error: null, startedAt: new Date(now).toISOString(), finishedAt: null,
    durationMs: null, costUsd: null, costStatus: mode === 'live' ? 'unknown' : 'fixture', usage: null
  };
  store.save(run);
  try {
    const result = mode === 'live' ? await runSapiom(input, run.id) : { output: await runFixture(input), usage: {} };
    run.output = researchOutput.parse(result.output);
    run.usage = result.usage;
    run.status = 'completed';
  } catch (error) {
    run.error = error instanceof Error ? error.message : String(error);
    run.status = 'failed';
  }
  run.finishedAt = new Date().toISOString();
  run.durationMs = Date.now() - now;
  store.save(run);
  return run;
}
