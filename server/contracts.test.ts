import { test } from 'node:test';
import assert from 'node:assert/strict';
import { researchOutput } from './contracts.ts';

test('a quoted citation must appear in a returned source', () => {
  const output = {
    answer: 'GitHub provides a developer platform.',
    facts: [{ claim: 'GitHub provides a developer platform.',
      sourceUrls: ['https://github.com/about'], supportQuote: 'developer platform' }],
    sources: [{ title: 'GitHub', url: 'https://github.com/about', snippet: 'A developer platform for software teams.' }]
  };
  assert.equal(researchOutput.safeParse(output).success, true);
  assert.equal(researchOutput.safeParse({ ...output,
    facts: [{ ...output.facts[0], supportQuote: 'not found in the source' }] }).success, false);
});
