import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadProductCorpus } from './product-corpus.ts';
import { loadExternalComparison } from './external-comparison.ts';

test('the completed live pair is a checked read-only AI assessment with two opposed preferences', () => {
  const record = loadExternalComparison(loadProductCorpus())[0];
  assert.equal(record.cases.length, 2);
  assert.deepEqual(record.cases.map(item => item.aiReview.preferredArm), ['baseline', 'candidate']);
  assert.deepEqual(record.cases.map(item => item.answers.map(answer => answer.blindLabel)), [['A', 'B'], ['A', 'B']]);
  assert.ok(record.cases.every(item => item.answers.every(answer => answer.exactQuoteMembership && answer.answer.citations.length > 0)));
  assert.equal(record.kind, 'exploratory_ai_assessment');
});

test('changed packet or review text cannot silently change the displayed outcome', () => {
  const corpus = loadProductCorpus();
  const packet = readFileSync(new URL('../docs/evidence/answer-calibration-revision2-validation-2026-09-25.json', import.meta.url), 'utf8');
  const review = readFileSync(new URL('../docs/evidence/answer-calibration-revision2-validation-astra-review-2026-09-25.md', import.meta.url), 'utf8');
  assert.throws(() => loadExternalComparison(corpus, packet.replace('passed_execution', 'failed_execution'), review), /checksum mismatch/);
  assert.throws(() => loadExternalComparison(corpus, packet, review.replace('A, narrowly', 'B, narrowly')), /checksum mismatch/);
});
