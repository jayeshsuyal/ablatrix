import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, publicTasks, report, taskForRun } from './evaluation.ts';
import type { RunRecord } from './contracts.ts';

test('curated splits hide holdout answers and fixture data cannot become a live quality claim', () => {
  const tasks = publicTasks();
  assert.equal(tasks.development.length, 2);
  assert.equal(tasks.validation.length, 2);
  assert.equal(tasks.holdoutCount, 2);
  assert(!JSON.stringify(tasks).includes('Firefox'));
  assert.equal(taskForRun('mozilla-firefox-v1'), null);
  const run: RunRecord = {
    id: 'r1', taskId: 'github-platform-v1', candidateId: 'baseline', mode: 'fixture',
    provider: 'fixture', model: null, status: 'completed',
    input: { entity: 'GitHub', question: 'What does GitHub provide for software teams?' },
    output: {
      answer: 'GitHub is a developer platform.',
      facts: [{ claim: 'Developer platform', sourceUrls: ['https://github.com/about'] }],
      sources: [{ title: 'GitHub', url: 'https://github.com/about', snippet: '' }]
    },
    error: null, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    durationMs: 2, costUsd: null, costStatus: 'fixture', usage: null
  };
  assert.equal(evaluate(run)?.correct, true);
  const summary = report([run]);
  assert.equal(summary.sampleSize, 0);
  assert.equal(summary.qualityRate, null);
  assert.equal(summary.costPerCorrectUsd, null);
  assert.equal(report([{ ...run, taskId: 'mozilla-firefox-v1' }]).evaluations.length, 0);
});

test('pilot rubric catches missing terms and citation/source mismatch but cannot resolve a contradiction', () => {
  const at = new Date().toISOString();
  const base: RunRecord = {
    id: 'pilot', taskId: 'github-platform-v1', candidateId: 'baseline', mode: 'live',
    provider: 'fake-metered', model: 'fake', status: 'completed',
    input: { entity: 'GitHub', question: 'What does GitHub provide for software teams?', taskId: 'github-platform-v1' },
    output: { answer: 'GitHub is a developer platform.', facts: [{ claim: 'developer platform', sourceUrls: ['https://github.com/about'] }],
      sources: [{ title: 'GitHub', url: 'https://github.com/about', snippet: '' }] },
    error: null, startedAt: at, finishedAt: at, durationMs: 1, costUsd: 0.01, costStatus: 'priced', usage: null
  };
  assert.equal(evaluate(base)?.correct, true);
  assert.equal(evaluate({ ...base, output: { ...base.output!, answer: 'GitHub hosts projects.' } })?.correct, false);
  assert.equal(evaluate({ ...base, output: { ...base.output!, sources: [{ title: 'Other', url: 'https://example.com/', snippet: '' }] } })?.correct, false);
  assert.equal(evaluate({ ...base, output: { ...base.output!, facts: [{ claim: 'developer platform', sourceUrls: ['https://wrong.example/'] }] } })?.correct, false);
  assert.equal(evaluate({ ...base, output: { ...base.output!, answer: 'GitHub is not a developer platform.' } })?.correct, true);
  assert.equal(evaluate({ ...base, status: 'failed', output: null })?.correct, false);
});
