import { readFileSync } from 'node:fs';
import { researchConfig } from './config.ts';
import { publicTasks } from './evaluation.ts';
import { ExperimentRunner } from './experiments.ts';
import { RunStore } from './store.ts';

export function loadCandidateConfig(path: string) {
  return researchConfig.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

if (process.argv[1]?.endsWith('/replay.ts')) {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: npm run replay -- /path/to/research.candidate.json');
  const settings = loadCandidateConfig(path);
  const store = new RunStore(process.env.ABLATRIX_DB ?? '.data/ablatrix.sqlite');
  try {
    const tasks = publicTasks();
    const job = new ExperimentRunner(store, 'fixture').create({
      taskIds: [...tasks.development, ...tasks.validation].map(task => task.id),
      maxAttempts: 1, maxDurationMs: 30_000, maxSpendUsd: 0, settings
    });
    let final = store.getExperiment(job.id);
    for (let i = 0; i < 400 && final && (final.status === 'queued' || final.status === 'running'); i++) {
      await new Promise(resolve => setTimeout(resolve, 25));
      final = store.getExperiment(job.id);
    }
    if (!final || final.status !== 'completed') throw new Error(`Fixture replay ${job.id} ended ${final?.status ?? 'missing'}.`);
    console.log(`Fixture replay completed: ${job.id}; ${final.runIds.length} run(s). Synthetic output only.`);
  } finally { store.close(); }
}
