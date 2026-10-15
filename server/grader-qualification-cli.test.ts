import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runQualificationCli } from '../scripts/grader-qualification.ts';

test('qualification CLI is offline even with all ambient live opt-ins and has no execute command', () => {
  const saved = process.env.ABLATRIX_GRADER_CALIBRATION_LIVE; process.env.ABLATRIX_GRADER_CALIBRATION_LIVE = '1';
  try {
    const help = runQualificationCli([]); assert.equal(help.execution, 'offline_only'); assert.equal(help.liveProviderCalls, 0); assert.equal(help.qualified, false);
    for (const argv of [['--execute'], ['--prepare', '--implementation-commit', 'a'.repeat(40), '--out', '/tmp/uncreated-qualification', '--live', '1'], ['--verify', '--dir', '/tmp/uncreated-qualification', '--qualified', 'true'], ['--rehearse', '--dir', '/tmp/uncreated-qualification', '--out', '/tmp/uncreated-report.json', '--transport', 'live']]) assert.throws(() => runQualificationCli(argv));
    assert.throws(() => runQualificationCli(['--prepare', '--out', 'relative', '--implementation-commit', 'a'.repeat(40)]), /absolute canonical/);
    assert.throws(() => runQualificationCli(['--verify', '--dir', '/tmp', '--dir', '/tmp']), /unique explicit/);
  } finally { if (saved === undefined) delete process.env.ABLATRIX_GRADER_CALIBRATION_LIVE; else process.env.ABLATRIX_GRADER_CALIBRATION_LIVE = saved; }
});

test('qualification entry points cannot import execution capability or synthesize a live qualification', () => {
  for (const path of ['../scripts/grader-qualification.ts', './grader-qualification.ts', './grader-qualification-fixtures.ts']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"][^'"]*(?:feedback-provider|grader-calibration-runner|node:sqlite|node:https?|sapiom)[^'"]*['"]/);
    assert.doesNotMatch(source, /\b(?:fetch|gradeClaimSupport)\s*\(/);
  }
});
