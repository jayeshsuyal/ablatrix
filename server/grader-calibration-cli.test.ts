import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graderCalibrationCli } from '../scripts/grader-calibration.ts';

test('calibration CLI defaults offline and rejects ambiguous or widened modes before dispatch', async t => {
  let network = 0; const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async () => { network++; throw new Error('Network forbidden in constructed CLI mechanics.'); });
  const mocked = globalThis.fetch;
  try {
    assert.equal((await graderCalibrationCli([])).mode, 'offline'); assert.equal(globalThis.fetch, mocked);
    for (const args of [
      ['--unknown'], ['--prepare', '--out', 'unused.json'], ['--verify', '--plan', 'unused.json', '--calls', '11'],
      ['--execute', '--plan', 'unused.json', '--acknowledged-plan-sha256', 'a'.repeat(64), '--checkpoint', '/tmp/unused', '--report', '/tmp/unused-report', '--retry', '1'],
      ['--verify', '--plan', 'one', '--plan', 'two'], ['--prepare', '--implementation-commit']
    ]) await assert.rejects(graderCalibrationCli(args));
    assert.equal(network, 0); assert.equal(globalThis.fetch, mocked);
  } finally { t.mock.restoreAll(); assert.equal(globalThis.fetch, originalFetch); }
});
