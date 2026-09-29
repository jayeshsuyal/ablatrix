import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PaidAnswerReview } from './paid-answer-review.ts';

test('pinned paid batch reviews persist separately and cannot be counted without checked sources', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-paid-review-'));
  const path = join(directory, 'reviews.sqlite');
  let review = new PaidAnswerReview(path);
  try {
    const initial = review.overview();
    assert.equal(initial.cases.length, 20);
    assert.equal(initial.summary.reviewed, 0);
    assert.equal(initial.summary.aiDrafts, 20);
    assert.equal(initial.cases.filter(item => item.aiDraft?.answerVerdict === 'incorrect').length, 1);
    assert.equal(initial.cases.find(item => item.qid === '19')?.aiDraft?.answerVerdict, 'incorrect');
    assert.equal(initial.cases.find(item => item.qid === '81')?.aiDraft?.answerVerdict, 'correct');
    assert.match(initial.cases.find(item => item.qid === '81')?.sources.find(source => source.label === 'ePQA cqa 770')?.originalQuestion ?? '', /kenmore model 106\.56369400/i);
    assert.equal(initial.cases.flatMap(item => item.sources).filter(source => source.originalQuestion).length, 42);
    assert(initial.cases.every(item => item.aiDraft && !item.review));
    assert(!JSON.stringify(initial).includes('originalLabel'));
    const first = initial.cases[0]!;
    const valid = { reviewer: 'Case reviewer', answerVerdict: 'incorrect', supportVerdict: 'unsupported', category: 'source_conflict', checkedSourceShas: [first.sources[0]!.sha256], note: 'The source conflicts with the answer.', referenceChecked: true };
    assert.throws(() => review.review(first.qid, { ...valid, checkedSourceShas: [] }));
    assert.throws(() => review.review(first.qid, { ...valid, checkedSourceShas: [initial.cases[1]!.sources[0]!.sha256] }), /belong to this product/);
    assert.throws(() => review.review(first.qid, { ...valid, referenceChecked: false }));
    assert.throws(() => review.review(first.qid, { ...valid, answerVerdict: 'correct' }), /correct answer must be supported/);
    const saved = review.review(first.qid, valid);
    assert.equal(saved.kind, 'human');
    assert.equal(saved.runId, first.result?.run.id);
    assert.throws(() => review.review(first.qid, valid), /already been reviewed/);
    review.close();
    review = new PaidAnswerReview(path);
    assert.equal(review.overview().summary.incorrect, 1);
    assert.equal(review.overview().summary.judged, 1);
    assert.equal(review.overview().cases[0]?.review?.note, valid.note);
  } finally { review.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('review screen refuses altered historical results, Q&A context, or AI drafts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-paid-evidence-'));
  const source = new URL('../docs/evidence/paid-qa-batch-2026-09-28/', import.meta.url);
  try {
    for (const name of ['manifest.json', 'results.json', 'source-context.json', 'ai-review-drafts.json']) writeFileSync(join(directory, name), readFileSync(new URL(name, source)));
    const results = JSON.parse(readFileSync(join(directory, 'results.json'), 'utf8'));
    results.runs[0].run.answer.answer = 'Altered answer';
    writeFileSync(join(directory, 'results.json'), JSON.stringify(results));
    assert.throws(() => new PaidAnswerReview(':memory:', directory), /pinned results changed/);
    writeFileSync(join(directory, 'results.json'), readFileSync(new URL('results.json', source)));
    const contexts = JSON.parse(readFileSync(join(directory, 'source-context.json'), 'utf8'));
    contexts.contexts[0].originalQuestion = 'Different question';
    writeFileSync(join(directory, 'source-context.json'), JSON.stringify(contexts));
    assert.throws(() => new PaidAnswerReview(':memory:', directory), /pinned source context changed/);
    writeFileSync(join(directory, 'source-context.json'), readFileSync(new URL('source-context.json', source)));
    const drafts = JSON.parse(readFileSync(join(directory, 'ai-review-drafts.json'), 'utf8'));
    drafts.drafts[0].answerVerdict = 'incorrect';
    writeFileSync(join(directory, 'ai-review-drafts.json'), JSON.stringify(drafts));
    assert.throws(() => new PaidAnswerReview(':memory:', directory), /pinned AI drafts changed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
