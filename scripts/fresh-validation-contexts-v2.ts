/** Source-only future workflow. Python verifier runs before fresh artifact reads. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { textHash } from '../server/product-corpus.ts';
import { ProductRetriever } from '../server/product-retrieval.ts';
import { cachedCrossEncoder } from '../server/semantic-reranker.ts';
import { freshValidationBaseline, freshValidationContexts, freshValidationCorpus, verifyFreshValidationBaseline } from '../server/fresh-validation-v2.ts';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
function input(name: string) {
  assert.ok(!isAbsolute(name) && name && !name.split(/[\\/]/).some(p => p === '..' || p === '.') && !name.includes('\\'));
  const path = resolve(root, name); assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink() && realpathSync(path) === path);
  const bytes = readFileSync(path, 'utf8'); return { path: name, fileSha256: textHash(bytes), document: JSON.parse(bytes) };
}
export function assertFreshSnapshotBindings(snapshots: { path: string; fileSha256: string; document: unknown }[], bindings: Record<string, string>) {
  for (const snapshot of snapshots) assert.equal(snapshot.fileSha256, bindings[snapshot.path], 'Loaded parsed snapshot differs from exact verified raw bytes.');
}
export async function freshValidationCli(argv: string[]) {
  if (!argv.length) return { usage: ['--baseline --freeze-dir DIR --qualification FILE --pool FILE --screening FILE --out NEW', '--contexts --freeze-dir DIR --qualification FILE --pool FILE --screening FILE --baseline FILE --review FILE --selection FILE --out NEW'], providerCalls: 0, freshInputReads: 0 };
  const [mode, ...rest] = argv; assert.ok(mode === '--baseline' || mode === '--contexts' || mode === '--verify-baseline');
  const required = ['--freeze-dir', '--qualification', '--pool', '--screening', ...(mode === '--verify-baseline' ? ['--baseline'] : ['--out']), ...(mode === '--contexts' ? ['--baseline', '--review', '--selection'] : [])];
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) { assert.ok(required.includes(rest[i]!) && rest[i + 1] && !flags.has(rest[i]!)); flags.set(rest[i]!, rest[i + 1]!); }
  assert.equal(flags.size, required.length);
  // Verifier checks exact reviewed protocol/code/history BEFORE even reading or
  // stat'ing the fresh pool. A pending qualification cannot consume the pool.
  const base = ['--freeze-dir', flags.get('--freeze-dir')!, '--qualification', flags.get('--qualification')!, '--pool', flags.get('--pool')!, '--screening', flags.get('--screening')!];
  const verification = JSON.parse(execFileSync('python3', ['-I', 'scripts/prepare-fresh-validation-v2.py', 'verify-screen', ...base], { cwd: root, env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 30_000, maxBuffer: 1_048_576 }));
  assert.equal(verification.providerCalls, 0);
  const screeningArtifact = input(flags.get('--screening')!);
  assertFreshSnapshotBindings([screeningArtifact], verification.artifactSha256);
  const screening = screeningArtifact.document;
  if (mode === '--verify-baseline') {
    const baseline = input(flags.get('--baseline')!);
    await verifyFreshValidationBaseline(screening, baseline.document);
    return { mode, baselineFileSha256: baseline.fileSha256, screeningFileSha256: screeningArtifact.fileSha256, providerCalls: 0 };
  }
  const output = resolve(flags.get('--out')!); assert.ok(!existsSync(output) && dirname(output) === realpathSync(dirname(output)), 'Use a new absolute output file with canonical existing parent.');
  const oldFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('Fresh offline preparation cannot download or dispatch. Cached model artifacts required.'); };
  try {
    let document: unknown;
    if (mode === '--baseline') {
      const retriever = new ProductRetriever(freshValidationCorpus(screening), ':memory:', { cachedOnly: true });
      try { document = await freshValidationBaseline(screening, retriever, cachedCrossEncoder()); } finally { retriever.close(); }
    } else {
      const baselineArtifact = input(flags.get('--baseline')!), reviewArtifact = input(flags.get('--review')!), selectionArtifact = input(flags.get('--selection')!);
      const baseline = baselineArtifact.document, review = reviewArtifact.document, selection = selectionArtifact.document;
      const checked = JSON.parse(execFileSync('python3', ['-I', 'scripts/prepare-fresh-validation-v2.py', 'select', ...base, '--baseline', flags.get('--baseline')!, '--review', flags.get('--review')!, '--out', `${output}.selection-replay`], { cwd: root, env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 30_000, maxBuffer: 1_048_576 }));
      assert.equal(checked.stopReason, null);
      assertFreshSnapshotBindings([screeningArtifact, baselineArtifact, reviewArtifact], checked.artifactSha256);
      const replay = JSON.parse(readFileSync(`${output}.selection-replay`, 'utf8')); assert.deepEqual(selection, replay, 'Review denominator/selection must replay before any candidate model score.');
      document = await freshValidationContexts(screening, baseline, review, selection, { baselineFileSha256: baselineArtifact.fileSha256, sourceReviewFileSha256: reviewArtifact.fileSha256 });
    }
    writeFileSync(output, JSON.stringify(document, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return { mode, output, providerCalls: 0, generatedAnswers: 0, paidExecutionAuthorized: false };
  } finally { globalThis.fetch = oldFetch; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(await freshValidationCli(process.argv.slice(2))));
