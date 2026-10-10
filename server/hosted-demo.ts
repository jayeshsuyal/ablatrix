import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { createApp } from './app.ts';
import { DemoAccess, loadDemoAccessConfig } from './demo-access.ts';
import { SyntheticAnswerProvider } from './synthetic-answer-provider.ts';
import { ProductWorkspace } from './product-workspace.ts';
import { RunStore } from './store.ts';
import { PilotRunner, PilotStore } from './pilot.ts';
import type { LoopRetriever, ProductCorpus } from './loop-types.ts';
import { assertRuntimeLock } from '../scripts/demo-backup.ts';

const identity = { schema: 1, providerMode: 'synthetic', scope: 'invited-shared-demo' } as const;

/** A new hosted ledger can never silently adopt local/live experiment data. */
export function prepareDemoData(directory: string): string {
  if (!isAbsolute(directory) || resolve(directory) === '/') throw new Error('Hosted data directory must be a dedicated absolute path.');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== resolve(directory)) throw new Error('Hosted data directory cannot use symlinks.');
  if (existsSync(join(directory, '.restore-in-progress'))) throw new Error('Hosted restore is incomplete; finish recovery before startup.');
  const marker = join(directory, 'demo.json');
  if (existsSync(marker)) {
    if (lstatSync(marker).isSymbolicLink() || JSON.stringify(JSON.parse(readFileSync(marker, 'utf8'))) !== JSON.stringify(identity)) throw new Error('Hosted data identity differs; use a separate empty directory.');
  } else {
    if (readdirSync(directory).some(name => name !== '.runtime.lock')) throw new Error('Hosted demo requires an empty directory on first startup.');
    writeFileSync(marker, JSON.stringify(identity) + '\n', { flag: 'wx', mode: 0o600 });
  }
  // Databases must not escape the mounted directory through operator-created links.
  for (const name of readdirSync(directory)) if (lstatSync(join(directory, name)).isSymbolicLink()) throw new Error('Hosted data files cannot be symlinks.');
  return directory;
}

export const syntheticRetriever = (corpus: ProductCorpus): LoopRetriever => ({
  close() {},
  async retrieve(productId) {
    return { passages: corpus.passages.filter(p => p.productId === productId).slice(0, 5).map((p, index) => ({ ...p, lexicalRank: index + 1, semanticRank: null, score: 0 })), durationMs: 0, method: 'synthetic source selection (first five chunks)', embeddingModel: 'none — synthetic fixture', corpusVersion: corpus.version };
  }
});

export function createHostedDemo(env: NodeJS.ProcessEnv = process.env) {
  const config = loadDemoAccessConfig(env);
  if (!config) throw new Error('Hosted demo requires a complete access configuration.');
  if (env.ABLATRIX_RUNTIME_LOCK_HELD !== '1') throw new Error('Start hosted mode through scripts/demo-entrypoint.sh to acquire the shared data lock.');
  assertRuntimeLock(env.ABLATRIX_DATA_DIR ?? '/data', env);
  const directory = prepareDemoData(env.ABLATRIX_DATA_DIR ?? '/data');
  const provider = new SyntheticAnswerProvider(join(directory, 'synthetic-receipts.sqlite'));
  const workspace = new ProductWorkspace(join(directory, 'product-workspace.sqlite'), provider, syntheticRetriever);
  const store = new RunStore(join(directory, 'ablatrix.sqlite'));
  // Every hosted path is explicit; inherited local DB/credential/live env vars are unused.
  const server = createApp(store, 'fixture', undefined, new PilotRunner(new PilotStore(join(directory, 'search-pilot.sqlite'))), undefined, undefined, workspace, undefined, true, {
    demoAccess: new DemoAccess(config), answerProvider: provider, reviewDbPath: join(directory, 'paid-answer-review.sqlite'), comparisonDbPath: join(directory, 'context-comparisons.sqlite')
  });
  return { server, store };
}
