import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PilotRunner, PilotStore } from './pilot.ts';

const mode = process.argv.includes('--live') ? 'live' : 'fixture';
const runner = new PilotRunner(new PilotStore(process.env.ABLATRIX_PILOT_DB ?? '.data/search-pilot.sqlite'));
try {
  const initial = runner.create({ mode });
  const result = (await runner.wait(initial.id))!;
  if (result.exportReady) {
    mkdirSync('outputs', { recursive: true });
    const file = resolve('outputs', `search-ablation-${result.id}.json`);
    writeFileSync(file, `${JSON.stringify(runner.export(result.id), null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ mode, status: result.status, runs: result.completedRuns, decision: result.decision, reason: result.reason, artifact: file }, null, 2));
  } else console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith('Pilot') ? error.message : 'Pilot could not start.');
  process.exitCode = 1;
} finally { await runner.close(); }
