import { randomUUID } from 'node:crypto';
import { researchOutput, type ResearchInput, type RunMode, type RunRecord } from './contracts.ts';
import { runFixture } from './fixture.ts';
import { validatedCharge, type MeteredLiveProvider } from './live-provider.ts';
import { RunStore } from './store.ts';
import { createHash } from 'node:crypto';
import { baselineConfig, type ResearchConfig } from './config.ts';
import { maxCacheTtlForTask } from './evaluation.ts';

export async function executeResearch(store: RunStore, input: ResearchInput, mode: RunMode, candidateId = 'baseline', runId = randomUUID(), settings: ResearchConfig = baselineConfig, liveProvider?: MeteredLiveProvider): Promise<RunRecord> {
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
    if (mode === 'live' && !cached) {
      if (!liveProvider?.readiness().ready) throw new Error('Live provider accounting is unavailable.');
      const result = await liveProvider.research(input, run.id, settings);
      const charge = validatedCharge(result.charge);
      run.costUsd = charge.cents / 100;
      run.costStatus = 'priced';
      run.model = result.model;
      run.usage = { ...result.usage, executionId: result.executionId, agentVersion: result.agentVersion,
        chargeReference: charge.reference };
      if (result.status === 'failed') {
        run.error = 'Provider research failed.';
        run.status = 'failed';
      } else run.output = researchOutput.parse(result.output);
    } else {
      run.output = cached ? researchOutput.parse(cached) : researchOutput.parse(await runFixture(input, settings));
      run.usage = cached ? { cacheHit: true, chargeReference: `local-cache:${run.id}` } : {};
    }
    if (cached) { run.provider = 'local-cache'; run.costUsd = 0; run.costStatus = 'priced'; }
    else if (mode === 'live' && ttl > 0 && run.output) store.cacheResearch(cacheKey, run.output, ttl);
    if (run.status !== 'failed') run.status = 'completed';
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
