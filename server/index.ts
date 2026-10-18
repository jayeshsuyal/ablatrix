import { createApp } from './app.ts';
import { RunStore } from './store.ts';
import { PilotRunner, PilotStore } from './pilot.ts';
import { createHostedDemo } from './hosted-demo.ts';
import { createLocalDemo } from './local-demo.ts';

const localDemo = process.argv.includes('--demo');
const port = Number(localDemo ? process.argv.find(argument => argument.startsWith('--port='))?.slice(7) ?? '4184' : process.env.PORT ?? '4173');
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
if (localDemo && port === 4194) throw new Error('The isolated demo cannot use the existing product server port 4194.');
const hosted = !localDemo && process.env.ABLATRIX_HOSTED_DEMO === '1';
const mode = process.env.ABLATRIX_MODE === 'live' ? 'live' : 'fixture';
const { server, store } = localDemo ? await createLocalDemo() : hosted ? createHostedDemo() : (() => {
  const store = new RunStore(process.env.ABLATRIX_DB ?? '.data/ablatrix.sqlite');
  const pilot = new PilotRunner(new PilotStore(process.env.ABLATRIX_PILOT_DB ?? '.data/search-pilot.sqlite'));
  return { store, server: createApp(store, mode, undefined, pilot, undefined, undefined, undefined, undefined, true) };
})();
const bind = hosted ? '0.0.0.0' : '127.0.0.1';
server.listen(port, bind, () => {
  console.log(`Ablatrix ${localDemo ? 'isolated synthetic demo (zero provider calls)' : hosted ? 'authenticated synthetic demo' : mode} listening on ${bind}:${port}`);
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  // The orchestrator may kill after its grace period; unfinished work is recovered conservatively.
  void server.shutdown().then(() => { store.close(); process.exitCode = 0; }).catch(error => { console.error('Shutdown failed:', error); process.exitCode = 1; });
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
