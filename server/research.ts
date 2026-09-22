import { randomUUID } from 'node:crypto';
import { researchOutput, type ResearchInput, type RunMode, type RunRecord } from './contracts.ts';
import { runFixture } from './fixture.ts';
import { runSapiom } from './sapiom.ts';
import { RunStore } from './store.ts';
import { createHash } from 'node:crypto';
import { baselineConfig, type ResearchConfig } from './config.ts';
import { maxCacheTtlForTask } from './evaluation.ts';

export async function executeResearch(store: RunStore, input: ResearchInput, mode: RunMode, candidateId = 'baseline', runId = randomUUID(), settings: ResearchConfig = baselineConfig): Promise<RunRecord> {
  const now = Date.now();
  const run: RunRecord = {
    id: runId, taskId: input.taskId ?? randomUUID(), candidateId, mode,
    provider: mode === 'live' ? 'sapiom' : 'fixture', model: mode === 'live' && settings.modelAssignment === 'small' ? 'sapiom:small' : null, status: 'running',
    input, output: null, error: null, startedAt: new Date(now).toISOString(), finishedAt: null,
    durationMs: null, costUsd: null, costStatus: mode === 'live' ? 'unknown' : 'fixture', usage: null, settings
  };
  store.save(run);
  try {
    const ttl = input.taskId ? Math.min(settings.cacheTtlMinutes, maxCacheTtlForTask(input.taskId)) : 0;
    const cacheKey = createHash('sha256').update(JSON.stringify({ input, settings })).digest('hex');
    const cached = mode === 'live' && ttl > 0 ? store.cachedResearch(cacheKey) : null;
    const result = cached
      ? { output: researchOutput.parse(cached), usage: { cacheHit: true } }
      : mode === 'live' ? await runSapiom(input, run.id, settings) : { output: await runFixture(input, settings), usage: {} };
    run.output = researchOutput.parse(result.output);
    run.usage = result.usage;
    if (cached) { run.provider = 'local-cache'; run.costUsd = 0; run.costStatus = 'priced'; }
    else if (mode === 'live' && ttl > 0) store.cacheResearch(cacheKey, run.output, ttl);
    run.status = 'completed';
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    run.error = mode === 'live' && !/^Live mode requires|^Live research currently requires|^Sapiom run did not complete\./.test(message)
      ? 'Sapiom research failed; inspect server logs and provider usage.' : message || 'Research failed.';
    run.status = 'failed';
  }
  run.finishedAt = new Date().toISOString();
  run.durationMs = Date.now() - now;
  store.save(run);
  return run;
}
