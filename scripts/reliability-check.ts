import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRagContracts } from '../server/rag-contracts.ts';
import { runHarnessContracts } from '../server/harness-contracts.ts';

type Mechanical = 'pass' | 'fail' | 'inconclusive';
type Checkpoint = { id: string; expected: unknown; observed: unknown; status: Mechanical };
type Suite = { mechanical: Mechanical; cases: { id: string; checkpoints: Checkpoint[] }[] };
const sourceFiles = [
  'server/product-retrieval.ts', 'server/revision-investigation.ts',
  'server/feedback-provider.ts', 'server/answer-revisions.ts',
  'server/citation-options.ts', 'server/answer-review-source.ts',
  'server/rag-contracts.ts', 'server/harness-contracts.ts',
  'scripts/reliability-check.ts'
];

async function capture(run: () => Promise<Suite>): Promise<Suite> {
  try { return await run(); }
  catch (error) {
    return { mechanical: 'inconclusive', cases: [{ id: 'suite_execution', checkpoints: [{
      id: 'completed', expected: 'completed offline contract run',
      observed: error instanceof Error ? error.message : 'Contract run failed.', status: 'inconclusive'
    }] }] };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const [flag, outputArgument, modeFlag, modeArgument, ...rest] = args;
  if (flag !== '--out' || !outputArgument || rest.length ||
      (modeFlag !== undefined && (modeFlag !== '--embedding' || modeArgument !== 'pinned_local_bge'))) {
    throw new Error('Usage: npm run check:reliability -- --out <new-file.json> [--embedding pinned_local_bge]');
  }
  const output = resolve(outputArgument);
  if (existsSync(output)) throw new Error('Output already exists; choose a new report file.');
  const mode = modeArgument === 'pinned_local_bge' ? 'pinned_local_bge' : 'injected_contract';
  const root = fileURLToPath(new URL('../', import.meta.url));
  const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file,
    createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex')
  ]));
  // This command has no live opt-in, credentials, application database or corpus
  // inputs. Scripted transport and cached local embeddings are the only paths.
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('Network disabled for offline reliability contracts; cache pinned BGE assets before requesting that mode.'); }) as typeof fetch;
  let retrieval: Suite, harness: Suite;
  try {
    retrieval = await capture(() => runRagContracts({ mode }));
    harness = await capture(runHarnessContracts);
  } finally { globalThis.fetch = priorFetch; }
  const suites = { retrieval, harness };
  const mechanical: Mechanical = Object.values(suites).some(suite => suite.mechanical === 'fail') ? 'fail'
    : Object.values(suites).some(suite => suite.mechanical === 'inconclusive') ? 'inconclusive' : 'pass';
  const report = {
    format: 'ablatrix-offline-reliability-v1', generatedAt: new Date().toISOString(),
    provenance: 'synthetic_contracts', embeddingMode: mode, sourceHashes, mechanical,
    semanticAssessment: 'not_run', qualityClaimEligible: false, paidProviderCalls: 0,
    scope: 'Regression contracts for source retrieval and bounded revision execution. A pass is not answer correctness or a measured quality gain.',
    suites
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  for (const [name, suite] of Object.entries(suites)) {
    for (const item of suite.cases) {
      const failures = item.checkpoints.filter(check => check.status !== 'pass');
      console.log(`${name}/${item.id}: ${failures.length ? failures.map(check => `${check.id}=${check.status}`).join(', ') : 'pass'}`);
    }
  }
  console.log(JSON.stringify({ output, mechanical, embeddingMode: mode, paidProviderCalls: 0, semanticAssessment: 'not_run' }));
  if (mechanical !== 'pass') process.exitCode = 1;
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Reliability check failed.'); process.exitCode = 1; });
