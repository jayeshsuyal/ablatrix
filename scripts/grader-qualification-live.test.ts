import assert from 'node:assert/strict';
import { test } from 'node:test';
import { realpathSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
