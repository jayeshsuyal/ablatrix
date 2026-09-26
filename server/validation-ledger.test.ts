import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FeedbackLoop } from './feedback-loop.ts';
import { loadProductCorpus } from './product-corpus.ts';
import type { LoopProvider, LoopRetriever } from './loop-types.ts';

test('a new app database imports the completed external round before selecting validation cases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ablatrix-historical-validation-'));
  const path = join(dir, 'loop.sqlite');
  const corpus = loadProductCorpus();
  const retriever: LoopRetriever = { async retrieve() { throw new Error('No retrieval expected.'); }, close() {} };
  const provider: LoopProvider = { readiness: () => ({ ready: false, reason: 'No paid calls.' }), async answer() { throw new Error('No answer expected.'); }, async propose() { throw new Error('No proposal expected.'); } };
  let loop: FeedbackLoop | undefined;
  try {
    loop = new FeedbackLoop(corpus, retriever, provider, path);
    assert.deepEqual(loop.overview().externalValidationCases.map(item => item.caseId).sort(), ['epqa-dev-535', 'epqa-dev-587']);
    loop.close(); loop = new FeedbackLoop(corpus, retriever, provider, path);
    assert.equal(loop.overview().externalValidationCases.length, 2, 'restart must not duplicate the imported round');
  } finally { loop?.close(); rmSync(dir, { recursive: true, force: true }); }
});
