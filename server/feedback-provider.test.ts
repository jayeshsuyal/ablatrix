import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SapiomFeedbackProvider, quoteOptions } from './feedback-provider.ts';
import type { LoopProvider } from './loop-types.ts';

const input: Parameters<LoopProvider['answer']>[0] = {
  question: 'What material is the handle?', product: { id: 'p1', title: 'Example fixture item', split: 'development' },
  policy: { id: 'v0', parentId: null, instructions: 'Use exact evidence and preserve uncertainty.', rationale: 'baseline', feedbackRunIds: [], status: 'baseline', mode: 'live', createdAt: '' },
  passages: [{ id: 'c1', productId: 'p1', source: 'manufacturer', text: 'The handle is made of oak.', reference: 'fixture', sha256: 'test', lexicalRank: 1, semanticRank: 1, score: 1 }]
};
function reply(output: unknown, model = 'gpt-5.6-luna', finish = 'tool_calls', kind = 'product_answer') {
  return new Response(JSON.stringify({ model, usage: { prompt_tokens: 100, completion_tokens: 30 }, choices: [{ finish_reason: finish, message: { tool_calls: [{ function: { name: kind, arguments: JSON.stringify(output) } }] } }] }));
}
const valid = { answer: 'The handle is oak.', status: 'answered', citations: [{ passageId: 'c1', quote: 'The handle is made of oak.' }] };
const options = { enabled: true, apiKey: 'fixture-only-credential', capUsd: 10, priorSpendUsd: 0.2, allowancePerCallUsd: 0.1, dbPath: ':memory:' };

test('feedback provider pins model/settings, sends bounded evidence, and enforces persistent request allowance', async () => {
  let calls = 0;
  const provider = new SapiomFeedbackProvider({ ...options, callLimit: 1, fetchImpl: async (_url, init) => {
    calls++; const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'gpt-luna'); assert.equal(body.reasoning_effort, 'none'); assert.equal(body.max_tokens, 4096);
    const payload = JSON.parse(body.messages[1].content);
    assert.deepEqual(Object.keys(payload).sort(), ['answerPolicy', 'evidence', 'product', 'question']);
    assert.equal(payload.evidence[0].id, 'c1');
    return reply(valid);
  } });
  try {
    const result = await provider.answer(input);
    assert.equal(result.model, 'gpt-5.6-luna'); assert.deepEqual(result.usage, { inputTokens: 100, outputTokens: 30 });
    await assert.rejects(provider.answer(input), /allowance/); assert.equal(calls, 1);
  } finally { provider.close(); }
});

test('feedback provider keeps failures charged to the planning allowance and never retries or leaks errors', async () => {
  let calls = 0;
  const provider = new SapiomFeedbackProvider({ ...options, callLimit: 1, fetchImpl: async () => { calls++; throw new Error('fixture-only-credential'); } });
  try {
    await assert.rejects(provider.answer(input), error => error instanceof Error && error.message.includes('not retried') && !error.message.includes('credential'));
    assert.equal(provider.readiness().ready, false); assert.equal(calls, 1);
  } finally { provider.close(); }
});

test('provider records a safe HTTP failure code and the originating app run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'feedback-provider-diagnostic-')); const dbPath = join(dir, 'budget.sqlite');
  const provider = new SapiomFeedbackProvider({ ...options, dbPath, fetchImpl: async () => new Response('', { status: 503 }) });
  const db = new DatabaseSync(dbPath);
  try {
    await assert.rejects(provider.answer({ ...input, runId: 'run-example' }), /http_503/);
    const row = db.prepare('SELECT run_id,error_code,status FROM loop_provider_calls').get() as { run_id: string; error_code: string; status: string };
    assert.deepEqual({ ...row }, { run_id: 'run-example', error_code: 'http_503', status: 'failed_or_unknown' });
  } finally { db.close(); provider.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('feedback provider rejects unverified model and incomplete output', async () => {
  for (const response of [reply(valid, 'different-model'), reply(valid, 'gpt-5.6-luna', 'length')]) {
    const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async () => response });
    try { await assert.rejects(provider.answer(input), /unverified/); } finally { provider.close(); }
  }
});

test('full final comparison preflight refuses forty calls when local allowance only permits twenty', () => {
  const provider = new SapiomFeedbackProvider({ ...options, callLimit: 20 });
  try {
    assert.equal(provider.readiness().ready, true);
    const final = provider.capacity(40);
    assert.equal(final.ready, false);
    assert.match(final.reason, /40-call experiment/);
  } finally { provider.close(); }
});

test('opening another provider preserves pending calls until explicit owned recovery', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'feedback-provider-recovery-'));
  const dbPath = join(dir, 'budget.sqlite');
  let release!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  const first = new SapiomFeedbackProvider({ ...options, dbPath, fetchImpl: async () => pending });
  const request = first.answer(input);
  const second = new SapiomFeedbackProvider({ ...options, dbPath });
  const db = new DatabaseSync(dbPath);
  let firstClosed = false;
  try {
    assert.equal(db.prepare('SELECT status FROM loop_provider_calls').get()!.status, 'pending');
    release(reply(valid)); await request;
    assert.equal(db.prepare('SELECT status FROM loop_provider_calls').get()!.status, 'completed');
    db.prepare("INSERT INTO loop_provider_calls(id,created_at,kind,allowance_usd,status) VALUES(?,?,?,?,?)").run('abandoned-call', new Date().toISOString(), 'product_answer', 0.1, 'pending');
    assert.throws(() => second.recoverInterruptedCalls(), /owned by another provider/);
    first.close(); firstClosed = true;
    db.prepare('INSERT OR REPLACE INTO loop_provider_owner(id,pid,token,expires_at) VALUES(1,?,?,?)').run(process.pid, 'stale-owner', Date.now() - 1);
    second.recoverInterruptedCalls();
    assert.equal(db.prepare('SELECT status FROM loop_provider_calls WHERE id=?').get('abandoned-call')!.status, 'interrupted');
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM loop_provider_calls WHERE status='completed'").get()!.count, 1);
    assert.match(second.readiness().reason, /2\/20 calls/);
  } finally { release(reply(valid)); await request.catch(() => {}); db.close(); if (!firstClosed) first.close(); second.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('provider advertises and enforces the workflow output bounds', async () => {
  let parameters: any;
  const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); parameters = body.tools[0].function.parameters;
    return reply({ instructions: 'x'.repeat(35), rationale: 'A sufficiently long test rationale.' }, 'gpt-5.6-luna', 'tool_calls', 'policy_update');
  } });
  try {
    await assert.rejects(provider.propose({ policy: input.policy, examples: [] }));
    assert.equal(parameters.properties.instructions.minLength, 40);
    assert.equal(parameters.properties.instructions.maxLength, 2500);
    assert.equal(parameters.properties.rationale.maxLength, 1500);
  } finally { provider.close(); }
  const answerProvider = new SapiomFeedbackProvider({ ...options, fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); parameters = body.tools[0].function.parameters;
    return reply({ ...valid, citations: [{ passageId: 'c1', quote: 'x'.repeat(3001) }] });
  } });
  try {
    await assert.rejects(answerProvider.answer(input));
    assert.equal(parameters.properties.citations.items.properties.quote.maxLength, 3000);
    assert.equal(parameters.properties.citations.maxItems, 5);
    assert.equal(parameters.properties.answer.maxLength, 10_000);
  } finally { answerProvider.close(); }
});

test('snippet-ID arm maps literal spans and strips selected IDs from shopper answer', async () => {
  const optionsForInput = quoteOptions(input.passages);
  assert.deepEqual(optionsForInput, [{ id: 'p1q1', passageId: 'c1', quote: 'The handle is made of oak.' }]);
  const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'gpt-luna');
    assert.equal(body.tools[0].function.name, 'product_answer_snippet');
    const payload = JSON.parse(body.messages[1].content);
    assert.deepEqual(payload.quoteOptions, optionsForInput);
    return reply({ answer: 'The handle is oak. [p1q1]', status: 'answered', citations: [{ quoteId: 'p1q1' }] }, 'gpt-5.6-luna', 'tool_calls', 'product_answer_snippet');
  } });
  try {
    const result = await provider.answerWithSnippetIds(input);
    assert.deepEqual(result.answer.citations, [{ passageId: 'c1', quote: 'The handle is made of oak.' }]);
    assert.equal(result.answer.answer, 'The handle is oak.');
    assert.equal(result.rawAnswer, 'The handle is oak. [p1q1]');
    assert.deepEqual(result.quoteIds, ['p1q1']);
  } finally { provider.close(); }
});

test('snippet-ID arm rejects invented IDs and uncited answered outputs', async () => {
  for (const output of [
    { answer: 'The handle is oak.', status: 'answered', citations: [{ quoteId: 'invented' }] },
    { answer: 'The handle is oak.', status: 'answered', citations: [] },
    { answer: 'The handle is oak. [p2q1]', status: 'answered', citations: [{ quoteId: 'p1q1' }] },
  ]) {
    const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async () => reply(output, 'gpt-5.6-luna', 'tool_calls', 'product_answer_snippet') });
    try { await assert.rejects(provider.answerWithSnippetIds(input)); } finally { provider.close(); }
  }
});
