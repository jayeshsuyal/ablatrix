import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PaidAnswerReview } from './paid-answer-review.ts';
import { AnswerRevisions } from './answer-revisions.ts';
import { SapiomFeedbackProvider } from './feedback-provider.ts';
import { SapiomRevisionSearch } from './revision-search.ts';
import { investigateRevision } from './revision-investigation.ts';

const sourceUrl = 'https://manufacturer.com/fixture-parts';
const sourceText = 'Synthetic fixture only: Frigidaire drawer 240337103 replaces part 241543917. Verify the refrigerator model before installation.';
const critique = 'Compatibility with the requested part is missing. Find an applicable replacement cross-reference.';
type GenerationInput = { evidence: { id: string; text: string; origin: string; originalQuestion?: string }[]; investigation: { addedSourceIds: string[] }; promptVersion: string };

function response(value: unknown) { return new Response(JSON.stringify(value)); }
function harness(options: { web?: boolean; callLimit?: number; uncertainRead?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'investigation-flow-'));
  const path = join(directory, 'review.sqlite'), ledger = join(directory, 'budget.sqlite');
  const reviews = new PaidAnswerReview(path), calls: string[] = [], generations: GenerationInput[] = [];
  const provider = new SapiomFeedbackProvider({
    enabled: true, apiKey: 'fixture-only-credential', capUsd: 10, allowancePerCallUsd: 0.1,
    callLimit: options.callLimit ?? 4, dbPath: ledger,
    fetchImpl: async (url, init) => {
      const destination = String(url); calls.push(destination);
      if (destination.endsWith('/web.search')) return response({ results: [{ title: 'Synthetic manufacturer fixture', url: sourceUrl, snippet: 'A discovery lead, not answer evidence.' }] });
      if (destination.endsWith('/web.scrape')) {
        if (options.uncertainRead) throw new Error('Synthetic lost response: fixture-only-credential');
        return response({ url: sourceUrl, markdown: sourceText, metadata: { sourceURL: sourceUrl, title: 'Synthetic manufacturer fixture', statusCode: 200 } });
      }
      const input = JSON.parse(JSON.parse(String(init?.body)).messages[1].content) as GenerationInput;
      generations.push(input);
      const source = input.evidence.find(item => item.text === sourceText);
      assert.ok(source, 'The qualifying source must be supplied to answer generation.');
      return response({ model: 'gpt-5.6-luna', choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: 'answer_revision_v1', arguments: JSON.stringify({ answer: 'The synthetic reference lists drawer 240337103 as the replacement for part 241543917.', status: 'answered', citations: [{ passageId: source.id, quote: source.text }] }) } }] } }], usage: { prompt_tokens: 12, completion_tokens: 8 } });
    }
  });
  const search = new SapiomRevisionSearch(provider, { enabled: options.web ?? false, allowedDomains: ['manufacturer.com'] });
  const state = {
    directory, path, reviews, provider, search, calls, generations,
    flow: new AnswerRevisions(reviews, provider, path, false, () => true, search),
    close() { state.flow.close(); provider.close(); reviews.close(); rmSync(directory, { recursive: true, force: true }); },
    restart() { state.flow.close(); state.flow = new AnswerRevisions(reviews, provider, path, false, () => true, search); },
    q19() { return state.flow.overview().cases.find(item => item.qid === '19')!; },
    request(key: string, additions: object = {}) {
      return state.flow.request('19', { versionId: state.q19().versions.at(-1)!.id, idempotencyKey: key, reviewer: 'Synthetic reviewer', feedback: critique, issue: 'missing_evidence', ...additions });
    }
  };
  return state;
}

test('Q19 clarification checks preserve the answer limit and an added applicable source enables a revision', async () => {
  const state = harness();
  try {
    for (let index = 0; index < 3; index++) {
      state.request(`local-clarification-${index}`, { clarification: 'The customer does not have the full refrigerator model number.' });
      await state.flow.tick();
      const item = state.q19(), job = item.jobs.at(-1)!;
      assert.equal(job.status, 'needs_information');
      assert.equal(job.investigationComplete, true);
      assert.deepEqual(job.investigation?.requestedIdentifiers, ['241543917']);
      assert.match(job.investigation?.clarificationQuestion ?? '', /full device model/);
      assert.match(job.investigation?.clarificationQuestion ?? '', /241543917/);
      assert.equal(item.versions.length, 1);
      assert.equal(item.generationAttempts, 0);
      assert.equal(job.attempts.length, 0);
    }
    assert.equal(state.calls.length, 0);
    assert.equal(state.flow.overview().summary.providerCalls, 0);
    state.request('applicable-added-source', { additionalSources: [{ label: 'Synthetic fixture cross-reference', text: sourceText, reference: sourceUrl }] });
    await state.flow.tick();
    const item = state.q19(), job = item.jobs.at(-1)!;
    assert.equal(job.status, 'ready');
    assert.equal(item.generationAttempts, 1);
    assert.equal(item.versions.length, 2);
    assert.equal(state.generations.length, 1);
    assert.equal(state.calls.length, 1);
    assert.equal(state.generations[0].promptVersion, 'answer-revision-v3-investigation');
    assert.equal(state.generations[0].evidence.some(source => source.originalQuestion?.includes('25367889506')), false);
    assert.ok(job.context?.sources.some(source => source.originalQuestion?.includes('25367889506')), 'Filtered historical sources remain in the audit context.');
    assert.equal(item.versions[1].context?.clarifications.length, 3);
    assert.equal(state.flow.overview().summary.searchAndReadCalls, 0);
    assert.equal(state.flow.overview().summary.answerCalls, 1);
    state.request('second-answer-generation', { issue: 'answer_quality', feedback: 'State the supported replacement relationship more clearly.' });
    await state.flow.tick();
    assert.equal(state.q19().jobs.at(-1)?.status, 'ready');
    assert.equal(state.q19().generationAttempts, 2);
    assert.equal(state.generations.length, 2);
    assert.throws(() => state.request('third-answer-generation'), /two generation attempts/);
  } finally { state.close(); }
});

test('web investigation records search, read, answer usage and saves the exact source supplied to generation', async () => {
  const state = harness({ web: true });
  try {
    const job = state.request('web-investigation-1');
    await state.flow.tick();
    const item = state.q19(), saved = item.jobs[0], summary = state.flow.overview().summary;
    assert.equal(saved.status, 'ready');
    assert.equal(saved.investigation?.newEvidence, true);
    assert.equal(saved.investigation?.externalCalls, 2);
    assert.equal(saved.externalUsage.length, 2);
    assert.equal(state.provider.receipt(`${job.id}:search:1`)?.status, 'completed');
    assert.equal(state.provider.receipt(`${job.id}:read:1`)?.status, 'completed');
    assert.equal(state.provider.receipt(job.id)?.status, 'completed');
    assert.equal(summary.providerCalls, 3);
    assert.equal(summary.searchAndReadCalls, 2);
    assert.equal(summary.answerCalls, 1);
    assert.ok(Math.abs(summary.planningAllowanceUsd - 0.3) < 1e-9);
    assert.equal(summary.actualProviderCharges, 'unavailable');
    const retrieved = item.versions[1].context?.sources.find(source => source.origin === 'agent_retrieved');
    assert.equal(retrieved?.text, sourceText);
    assert.equal(retrieved?.reference, sourceUrl);
    assert.ok(item.versions[1].investigation?.addedSourceIds.includes(retrieved!.id));
    assert.equal(state.generations[0].evidence.some(source => source.originalQuestion?.includes('25367889506')), false);
    assert.equal(state.generations[0].evidence.find(source => source.id === retrieved!.id)?.text, sourceText);
    await state.flow.tick();
    assert.equal(state.calls.length, 3);
  } finally { state.close(); }
});

test('a restarted investigation replays completed search and read receipts without redispatching them', async () => {
  const state = harness({ web: true });
  try {
    const job = state.request('interrupted-investigation');
    // Simulate a crash after external receipts are durable, before the new context is persisted.
    const result = await investigateRevision({ context: job.context!, critique: job.feedback, issue: 'missing_evidence', runId: job.id }, state.search);
    assert.equal(state.calls.length, 2);
    assert.equal(result.investigation.newEvidence, true);
    const db = new DatabaseSync(state.path);
    try {
      db.prepare('UPDATE answer_revision_jobs SET status=?,document=?,lease_expires=? WHERE id=?').run('running', JSON.stringify({ ...job, status: 'running', phase: 'investigation', investigation: result.investigation }), 0, job.id);
    } finally { db.close(); }
    state.restart();
    assert.equal(state.q19().jobs[0].status, 'queued');
    await state.flow.tick();
    assert.equal(state.q19().jobs[0].status, 'ready');
    assert.equal(state.q19().versions.length, 2);
    assert.equal(state.calls.filter(url => url.endsWith('/web.search')).length, 1);
    assert.equal(state.calls.filter(url => url.endsWith('/web.scrape')).length, 1);
    assert.equal(state.generations.length, 1);
    assert.equal(state.flow.overview().summary.providerCalls, 3);
    await state.flow.tick();
    assert.equal(state.calls.length, 3);
  } finally { state.close(); }
});

test('an unknown source-read outcome blocks answer generation and further attempts across restart', async () => {
  const state = harness({ web: true, uncertainRead: true });
  try {
    const job = state.request('unknown-source-read');
    await state.flow.tick();
    const saved = state.q19().jobs[0];
    assert.equal(saved.status, 'reconciliation');
    assert.equal(state.q19().versions.length, 1);
    assert.equal(state.q19().generationAttempts, 0);
    assert.equal(state.provider.receipt(`${job.id}:read:1`)?.status, 'failed_or_unknown');
    assert.equal(state.flow.overview().summary.searchAndReadCalls, 2);
    assert.equal(state.flow.overview().summary.answerCalls, 0);
    assert.doesNotMatch(saved.error ?? '', /fixture-only-credential/);
    state.restart();
    await state.flow.tick();
    await state.flow.tick();
    assert.equal(state.calls.length, 2);
    assert.equal(state.generations.length, 0);
    assert.throws(() => state.request('retry-unknown-source'), /active or unresolved job/);
  } finally { state.close(); }
});

test('the four-call investigation preflight leaves the last allowance untouched', async () => {
  const state = harness({ web: true, callLimit: 1 });
  try {
    const job = state.request('last-call-preflight');
    await state.flow.tick();
    const saved = state.q19().jobs[0];
    assert.equal(saved.status, 'needs_information');
    assert.equal(saved.investigation?.externalCalls, 0);
    assert.match(saved.investigation?.steps.find(step => step.kind === 'web_search')?.detail ?? '', /4-call.*remaining/i);
    assert.equal(state.calls.length, 0);
    assert.equal(state.provider.receipt(`${job.id}:search:1`), undefined);
    assert.equal(state.provider.receipt(job.id), undefined);
    assert.equal(state.provider.capacity(1).ready, true);
    assert.equal(state.flow.overview().summary.providerCalls, 0);
  } finally { state.close(); }
});

test('a clarification-only follow-up keeps its rejected parent unavailable for acceptance until a new revision exists', async () => {
  const state = harness();
  try {
    state.request('first-reviewable-answer', { additionalSources: [{ label: 'Synthetic fixture cross-reference', text: sourceText, reference: sourceUrl }] });
    await state.flow.tick();
    const first = state.q19().versions.at(-1)!;
    assert.equal(state.q19().jobs.at(-1)?.status, 'ready');
    state.request('missing-details-followup');
    await state.flow.tick();
    assert.equal(state.q19().jobs.at(-1)?.status, 'needs_information');
    assert.equal(state.q19().versions.at(-1)?.id, first.id);
    const source = first.context!.sources.find(item => item.text === sourceText)!;
    assert.throws(() => state.flow.decide('19', { versionId: first.id, reviewer: 'Synthetic reviewer', decision: 'accept', note: 'The source was checked.', checkedSourceShas: [source.sha256] }), /rejected for a newer investigation/);
    assert.deepEqual(state.q19().jobs.map(job => job.status), ['ready', 'needs_information']);
    assert.equal(state.q19().events.some(event => event.kind === 'accept'), false);
    assert.equal(state.flow.overview().summary.accepted, 0);
    state.request('supplied-details-followup', { additionalSources: [{ label: 'Synthetic fixture installation note', text: 'Synthetic fixture note: drawer 240337103 replaces 241543917 and fits the lower compartment; consult the mounting diagram before installation.', reference: `${sourceUrl}/installation` }] });
    await state.flow.tick();
    const next = state.q19().versions.at(-1)!;
    assert.notEqual(next.id, first.id);
    assert.equal(state.q19().jobs.at(-1)?.status, 'ready');
    const checked = next.context!.sources.find(item => next.investigation!.selectedSourceIds.includes(item.id))!;
    state.flow.decide('19', { versionId: next.id, reviewer: 'Synthetic reviewer', decision: 'accept', note: 'The new revision was source checked.', checkedSourceShas: [checked.sha256] });
    assert.deepEqual(state.q19().jobs.map(job => job.status), ['ready', 'needs_information', 'accepted']);
    assert.equal(state.flow.overview().summary.accepted, 1);
    assert.equal(state.flow.overview().summary.unresolved, 0);
    assert.equal(state.generations.length, 2);
  } finally { state.close(); }
});
