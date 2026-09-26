import { createApp } from './app.ts';
import { RunStore } from './store.ts';
import { PilotRunner, PilotStore } from './pilot.ts';

const port = Number(process.env.PORT ?? '4173');
const mode = process.env.ABLATRIX_MODE === 'live' ? 'live' : 'fixture';
const store = new RunStore(process.env.ABLATRIX_DB ?? '.data/ablatrix.sqlite');
const pilot = new PilotRunner(new PilotStore(process.env.ABLATRIX_PILOT_DB ?? '.data/search-pilot.sqlite'));
createApp(store, mode, undefined, pilot).listen(port, '127.0.0.1', () => {
  console.log(`Ablatrix ${mode} mode listening on http://127.0.0.1:${port}`);
});
