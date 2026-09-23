import { evaluate, holdoutTasksForFinal } from './evaluation.ts';
import { executeResearch } from './research.ts';
import { RunStore } from './store.ts';
import { randomUUID } from 'node:crypto';
import { baselineConfig } from './config.ts';

export async function runFinalFixtureHoldout(store: RunStore, optimizationId: string) {
  const record = store.getOptimization(optimizationId);
  if (!record || record.status !== 'completed') throw new Error('A frozen completed optimization is required.');
  if (record.mode !== 'fixture') throw new Error('Paid holdout execution needs a verified metered provider.');
  if (record.holdoutStatus === 'running' || record.holdoutStatus === 'completed') throw new Error('Final holdout already started for this optimization.');
  record.holdoutStatus = 'running';
  store.saveOptimization(record);
  try {
    for (const task of holdoutTasksForFinal()) {
      for (const arm of ['baseline', 'candidate'] as const) {
        const ids = arm === 'baseline' ? record.holdoutBaselineRunIds ?? [] : record.holdoutRunIds ?? [];
        if (ids.some(id => { const run = store.get(id); return run?.taskId === task.id && run.status === 'completed'; })) continue;
        const runId = randomUUID();
        if (arm === 'baseline') record.holdoutBaselineRunIds = [...ids, runId];
        else record.holdoutRunIds = [...ids, runId];
        store.saveOptimization(record);
        await executeResearch(store, { ...task, taskId: task.id }, 'fixture', arm === 'baseline' ? 'baseline' : record.candidateId,
          runId, arm === 'baseline' ? baselineConfig : record.settings);
      }
    }
    record.holdoutStatus = 'completed';
  } catch (error) {
    record.holdoutStatus = 'failed';
    throw error;
  } finally {
    record.updatedAt = new Date().toISOString();
    store.saveOptimization(record);
  }
  return finalHoldoutAssessment(store, optimizationId);
}

export function finalHoldoutAssessment(store: RunStore, optimizationId: string) {
  const record = store.getOptimization(optimizationId);
  if (!record || record.holdoutStatus !== 'completed') return null;
  const baseline = (record.holdoutBaselineRunIds ?? []).map(id => store.get(id)).filter((run): run is NonNullable<typeof run> => !!run && run.status === 'completed');
  const candidate = (record.holdoutRunIds ?? []).map(id => store.get(id)).filter((run): run is NonNullable<typeof run> => !!run && run.status === 'completed');
  const byTask = holdoutTasksForFinal().map(task => {
    const first = baseline.find(run => run.taskId === task.id);
    const second = candidate.find(run => run.taskId === task.id);
    const baselineCorrect = !!first && !!evaluate(first, true)?.correct;
    const candidateCorrect = !!second && !!evaluate(second, true)?.correct;
    return { taskId: task.id, baselineCorrect, candidateCorrect, regressed: baselineCorrect && !candidateCorrect };
  });
  return { optimizationId, mode: record.mode, sampleSize: byTask.length,
    baselineCorrect: byTask.filter(item => item.baselineCorrect).length,
    correct: byTask.filter(item => item.candidateCorrect).length,
    regressions: byTask.filter(item => item.regressed).map(item => item.taskId), byTask,
    baselineDurationMs: baseline.reduce((sum, run) => sum + (run.durationMs ?? 0), 0),
    candidateDurationMs: candidate.reduce((sum, run) => sum + (run.durationMs ?? 0), 0),
    baselineCostUsd: null, candidateCostUsd: null,
    note: 'Synthetic paired fixture assessment. No live holdout performance or cost claim.' };
}

if (process.argv[1]?.endsWith('/holdout.ts')) {
  const id = process.argv[2];
  if (!id) throw new Error('Usage: npm run holdout -- <optimization-id>');
  const store = new RunStore(process.env.ABLATRIX_DB ?? '.data/ablatrix.sqlite');
  try { console.log(JSON.stringify(await runFinalFixtureHoldout(store, id))); }
  finally { store.close(); }
}
