import assert from 'node:assert/strict';
import { test } from 'node:test';
import { realpathSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runQualificationLiveCli } from './grader-qualification-live.ts';

test('live qualification help and malformed arguments cannot dispatch despite ambient live flags', async () => {
  const savedFetch = globalThis.fetch, savedOptIn = process.env.ABLATRIX_GRADER_QUALIFICATION_LIVE;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('No test network transport.'); };
  process.env.ABLATRIX_GRADER_QUALIFICATION_LIVE = '1';
  try {
    const help = await runQualificationLiveCli([]);
    assert.equal(help.liveProviderCalls, 0); assert.equal(help.financialApproval, 'not_granted');
    for (const argv of [
      ['--execute'], ['--execute', '--plan', '/tmp/no-plan.json'],
      ['--verify', '--plan', '/tmp/no-plan.json', '--approved', 'true'],
      ['--replay', '--plan', '/tmp/no-plan.json', '--plan', '/tmp/no-plan.json'],
      ['--prepare', '--implementation-commit', 'a'.repeat(40), '--out', 'relative'],
      ['--execute', '--plan', '/tmp/no-plan.json', '--acknowledged-plan-sha256', 'not-an-exact-sha'],
      ['--unknown'], ['--verify', '--plan'], ['--verify', '--plan', '--execute']
    ]) await assert.rejects(runQualificationLiveCli(argv));
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedOptIn === undefined) delete process.env.ABLATRIX_GRADER_QUALIFICATION_LIVE; else process.env.ABLATRIX_GRADER_QUALIFICATION_LIVE = savedOptIn;
  }
});

test('an importing caller with patched built-ins cannot enter production execution or certification', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'qualification-untrusted-importer-'))), root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const importer = join(directory, 'importer.mts');
    writeFileSync(importer, `import cp from 'node:child_process'; import https from 'node:https'; import {syncBuiltinESMExports} from 'node:module';
let nativeCalls=0,networkCalls=0; cp.execFileSync=()=>{nativeCalls++;return 'confirmed:${'a'.repeat(64)}';}; https.Agent.prototype.addRequest=function(){networkCalls++;throw Error('fake agent reached');};syncBuiltinESMExports();
process.argv[1]=${JSON.stringify(resolve(root, 'scripts/grader-qualification-live.ts'))};
const r=await import(${JSON.stringify(pathToFileURL(resolve(root, 'server/grader-qualification-live-runner.ts')).href)}); let rejected=0;
try{await r.executeLiveQualification({planPath:'/must-never-read-private-plan',acknowledgedPlanSha256:'${'a'.repeat(64)}'});}catch(e){if(String(e).includes('clean standalone native CLI'))rejected++;else throw e;}
try{r.verifyLiveQualification('/must-never-read-private-plan');}catch(e){if(String(e).includes('clean standalone native CLI'))rejected++;else throw e;}
console.log(JSON.stringify({rejected,nativeCalls,networkCalls}));`);
    const output = execFileSync(process.execPath, ['--experimental-transform-types', importer], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } });
    assert.deepEqual(JSON.parse(output), { rejected: 2, nativeCalls: 0, networkCalls: 0 });
    const help = execFileSync('/bin/sh', [resolve(root, 'scripts/grader-qualification-native.sh')], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '--import /must-never-load-preload.mjs', NODE_PATH: '/must-never-use-module-path' } });
    assert.equal(JSON.parse(help).financialApproval, 'not_granted');
    // A real native main reaches ordinary offline input validation, proving the
    // ESM cycle does not reject its legitimate capability or create a TDZ.
    assert.throws(() => execFileSync('/bin/sh', [resolve(root, 'scripts/grader-qualification-native.sh'), '--replay', '--plan', join(directory, 'missing.json')], { encoding: 'utf8' }), error => String((error as { stderr?: string }).stderr).includes('ENOENT'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('offline verification and replay restore the network guard when artifact inspection fails', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-qualification-cli-'))), missingPlan = join(directory, 'missing-plan.json');
  const savedFetch = globalThis.fetch;
  let requests = 0;
  const original = async () => { requests++; throw new Error('No test network transport.'); };
  globalThis.fetch = original;
  try {
    for (const command of ['--verify', '--replay']) {
      await assert.rejects(runQualificationLiveCli([command, '--plan', missingPlan]));
      assert.equal(globalThis.fetch, original);
    }
    assert.equal(requests, 0);
  } finally { globalThis.fetch = savedFetch; rmSync(directory, { recursive: true, force: true }); }
});
