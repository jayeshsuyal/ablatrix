import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { FeedbackExternalError, SapiomFeedbackProvider, quoteOptions, revisionRequestBody, sourceIdAnswerRequestBody, sourceIdRevisionRequestBody, sourceIdAnswerPromptIdentity, sourceIdRevisionPromptIdentity, sourceCitationOptions, type RevisionInput } from './feedback-provider.ts';
import type { LoopProvider } from './loop-types.ts';
import { revisionPromptIdentity, type RevisionPolicySelector } from './revision-policy.ts';

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
    assert.equal(createHash('sha256').update(body.messages[0].content).digest('hex'), '072372a766c4021be6e7ff5417bb38c2ed128b301bd64992f08c762d8466f008');
    const payload = JSON.parse(body.messages[1].content);
    assert.deepEqual(Object.keys(payload).sort(), ['answerPolicy', 'evidence', 'product', 'promptVersion', 'question']);
    assert.equal(payload.promptVersion, 'product-answer-v2-context');
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

test('an explicitly raised cumulative limit preserves all prior allowances and stops at its exact ceiling', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'feedback-provider-cumulative-')), dbPath = join(dir, 'budget.sqlite');
  let calls = 0;
  const provider = new SapiomFeedbackProvider({ ...options, dbPath, callLimit: 110, capUsd: 12, priorSpendUsd: .200281, fetchImpl: async () => { calls++; return reply(valid); } });
  const db = new DatabaseSync(dbPath);
  try {
    const insert = db.prepare('INSERT INTO loop_provider_calls(id,created_at,kind,allowance_usd,status,run_id) VALUES(?,?,?,?,?,?)');
    for (let i = 0; i < 86; i++) insert.run(`historical-${i}`, '2026-10-11T00:00:00.000Z', 'synthetic-history', .1, 'completed', `historical-run-${i}`);
    assert.equal(provider.capacity(24).ready, true);
    assert.equal(provider.capacity(25).ready, false);
    assert.equal(provider.capacity(101).ready, false, 'the individual batch bound remains 100');
    const oldCap = new SapiomFeedbackProvider({ ...options, dbPath, callLimit: 110, capUsd: 10, priorSpendUsd: .200281 });
    try { assert.equal(oldCap.capacity(24).ready, false, 'a higher call ceiling does not raise the spending plan'); } finally { oldCap.close(); }
    for (let i = 0; i < 24; i++) await provider.answer({ ...input, runId: `new-${i}` });
    await assert.rejects(provider.answer({ ...input, runId: 'past-limit' }), /allowance/);
    assert.equal(calls, 24); assert.equal(db.prepare('SELECT COUNT(*) n FROM loop_provider_calls').get()!.n, 110);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM loop_provider_calls WHERE kind='synthetic-history' AND allowance_usd=0.1 AND status='completed'").get()!.n, 86);
  } finally { db.close(); provider.close(); rmSync(dir, { recursive: true, force: true }); }
  for (const callLimit of [201, Infinity, 110.5]) {
    const invalid = new SapiomFeedbackProvider({ ...options, callLimit, capUsd: 100 });
    try { assert.equal(invalid.capacity(24).ready, false); } finally { invalid.close(); }
  }
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
    assert.equal(createHash('sha256').update(body.messages[0].content).digest('hex'), '8e6a986e17e3474388d1aed7d9f2e353546ddba592f2c466452ff47ced9edc2e');
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

test('customer questions reach both answer methods as context and never become quote options', async () => {
  for (const inline of [false, true]) {
    const originalQuestion = 'Will this fit Kenmore model 25367889506?';
    const text = 'Yes, this drawer fits that model.';
    const contextInput = { ...input, passages: [{ ...input.passages[0], source: 'cqa', text: inline ? `${text} Question: ${originalQuestion}` : text, ...(inline ? {} : { originalQuestion }) }] };
    assert.deepEqual(quoteOptions(contextInput.passages).map(option => option.quote), [text]);
    const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body)), payload = JSON.parse(body.messages[1].content);
      assert.equal(payload.evidence[0].originalQuestion, originalQuestion);
      assert.equal(payload.evidence[0].text, text);
      const snippet = body.tools[0].function.name === 'product_answer_snippet';
      return reply({ answer: 'The customer report applies to its named Kenmore model.', status: 'answered', citations: snippet ? [{ quoteId: 'p1q1' }] : [{ passageId: 'c1', quote: text }] }, 'gpt-5.6-luna', 'tool_calls', snippet ? 'product_answer_snippet' : 'product_answer');
    } });
    try { await provider.answer(contextInput); await provider.answerWithSnippetIds(contextInput); }
    finally { provider.close(); }
  }
});

test('an exact quote from an original customer question is rejected as factual evidence', async () => {
  const originalQuestion = 'Will this fit Kenmore model 25367889506?';
  const contextInput = { ...input, passages: [{ ...input.passages[0], source:'cqa', text:`Yes, this drawer fits that model. Question: ${originalQuestion}` }] };
  const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async () => reply({ answer:'It fits that Kenmore.', status:'answered', citations:[{passageId:'c1',quote:originalQuestion}] }) });
  try { await assert.rejects(provider.answer(contextInput), /output validation/); }
  finally { provider.close(); }
});

test('concurrent external operations with the same identity cannot dispatch twice', async () => {
  let release!: (response: Response) => void; let calls = 0;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async () => { calls++; return pending; } });
  const operation = { kind: 'revision_search' as const, runId: 'job:search:1', request: { query: 'fixture' } };
  const execute = async (fetch: typeof globalThis.fetch) => (await fetch('https://api.sapiom.ai/v1/capabilities/web.search', { method: 'POST', body: '{}' })).json();
  const validate = (output: unknown) => output as { results: [] };
  const first = provider.meteredExternal(operation, execute, validate);
  try {
    await assert.rejects(provider.meteredExternal(operation, execute, validate), error => error instanceof FeedbackExternalError && error.code === 'reconciliation_required');
    release(new Response('{"results":[]}')); await first;
    assert.deepEqual(await provider.meteredExternal(operation, execute, validate), { results: [] }); assert.equal(calls, 1);
  } finally { release(new Response('{"results":[]}')); await first.catch(() => {}); provider.close(); }
});

test('external SDK transport refuses additional requests under a single reservation', async () => {
  let calls = 0;
  const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async () => { calls++; return new Response('{}'); } });
  try {
    await assert.rejects(provider.meteredExternal({ kind: 'revision_search', runId: 'job:search:1', request: {} }, async fetch => {
      await fetch('https://api.sapiom.ai/v1/capabilities/web.search', { method: 'POST' });
      return fetch('https://api.sapiom.ai/v1/capabilities/web.search', { method: 'POST' });
    }, value => value), error => error instanceof FeedbackExternalError && error.code === 'unverified_outcome');
    assert.equal(calls, 1); assert.equal(provider.receipt('job:search:1')?.status, 'failed_or_unknown');
  } finally { provider.close(); }
});

test('revision passes investigation triage as bounded context without treating it as source verification', async () => {
  const investigation = { issue: 'missing_fact', query: 'fixture handle material', selectedSourceIds: ['c1'], addedSourceIds: ['c1'], stopReason: 'Retrieved a source excerpt.' };
  const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body)), payload = JSON.parse(body.messages[1].content);
    assert.equal(payload.promptVersion, 'answer-revision-v3-investigation'); assert.deepEqual(payload.investigation, investigation);
    assert.match(body.messages[0].content, /rule-based source triage, not verification/);
    return reply(valid, 'gpt-5.6-luna', 'tool_calls', 'answer_revision_v1');
  } });
  try {
    const result = await provider.revise({ runId: 'revision-job', question: input.question, product: input.product, rejectedAnswer: 'It is plastic.', critique: 'Wrong material.', evidence: input.passages, investigation });
    assert.equal(result.answer.answer, 'The handle is oak.');
  } finally { provider.close(); }
});

test('revision policy defaults preserve the exact current instructions and reject mutation', () => {
  const baseline = revisionPromptIdentity();
  assert.equal(baseline.policy, 'baseline');
  assert.equal(baseline.promptVersion, 'answer-revision-v3-investigation');
  assert.equal(baseline.systemInstructionsSha256, 'ffb69c36e6ed056e38d4c5ee4754cbdae5058a3a757ed27193ee98d632dfcd19');
  assert.equal(createHash('sha256').update(baseline.systemInstructions).digest('hex'), baseline.systemInstructionsSha256);
  assert.equal(revisionPromptIdentity('baseline', false).promptVersion, 'answer-revision-v2-context');
  assert.equal(revisionPromptIdentity('baseline', false).systemInstructions, baseline.systemInstructions);
  assert.equal(Object.isFrozen(baseline), true);
  assert.throws(() => { (baseline as { systemInstructions: string }).systemInstructions = 'mutated'; }, TypeError);
  assert.equal(revisionPromptIdentity().systemInstructionsSha256, baseline.systemInstructionsSha256);
  const candidate = revisionPromptIdentity('candidate_v4');
  assert.equal(Object.isFrozen(candidate), true);
  assert.equal(candidate.promptVersion, 'answer-revision-v4-attributed-listing');
  assert.notEqual(candidate.systemInstructionsSha256, baseline.systemInstructionsSha256);
});

test('revision evaluation changes only system instructions and version while receipts identify the dispatched prompt', async () => {
  const original: RevisionInput = { runId: 'unused', question: input.question, product: input.product, rejectedAnswer: 'It is plastic.', critique: 'Use the saved listing material.', evidence: input.passages, clarifications: [{ text: 'The model is already in this context: HP12345.', reviewer: 'Fixture reviewer' }], investigation: { issue: 'missed_source', query: 'handle material', selectedSourceIds: ['c1'], addedSourceIds: [], stopReason: 'Saved source candidate, not a quality judgment.' } };
  const policies = [undefined, 'baseline', 'candidate_v4'] as const;
  const bodies: ReturnType<typeof revisionRequestBody>[] = [];
  const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async (_url, init) => {
    const current = bodies.length < policies.length ? { ...original, runId: `revision-${bodies.length}`, revisionPolicy: policies[bodies.length] }
      : { ...original, investigation: undefined, runId: 'legacy-revision' };
    assert.equal(String(init?.body), JSON.stringify(revisionRequestBody(current)));
    bodies.push(JSON.parse(String(init?.body)));
    return reply(valid, 'gpt-5.6-luna', 'tool_calls', 'answer_revision_v1');
  } });
  try {
    for (const [index, revisionPolicy] of policies.entries()) {
      const runId = `revision-${index}`;
      const result = await provider.revise({ ...original, runId, revisionPolicy });
      const identity = revisionPromptIdentity(revisionPolicy);
      assert.equal(result.promptVersion, identity.promptVersion);
      assert.equal(result.systemInstructionsSha256, identity.systemInstructionsSha256);
      const receipt = JSON.parse(provider.receipt(runId)!.receipt_json!);
      assert.equal(receipt.promptVersion, result.promptVersion);
      assert.equal(receipt.systemInstructionsSha256, result.systemInstructionsSha256);
      assert.equal(receipt.revisionPolicy, identity.policy);
    }
    assert.deepEqual(bodies[0], bodies[1]);
    const normalized = bodies.map(body => {
      const copy = structuredClone(body), payload = JSON.parse(copy.messages[1].content);
      assert.deepEqual(payload.evidence, original.evidence);
      assert.deepEqual(payload.investigation, original.investigation);
      assert.deepEqual(payload.clarifications, original.clarifications);
      delete payload.promptVersion;
      copy.messages[0].content = '<policy>'; copy.messages[1].content = JSON.stringify(payload);
      return copy;
    });
    assert.deepEqual(normalized[0], normalized[2]);
    // A caller inspecting a body cannot mutate shared schemas or future requests.
    const inspected = revisionRequestBody(original);
    (inspected.tools[0].function.parameters as { required: string[] }).required.push('injected');
    assert.deepEqual(revisionRequestBody(original), bodies[0]);
    const legacy = await provider.revise({ ...original, investigation: undefined, runId: 'legacy-revision' });
    assert.equal(legacy.promptVersion, 'answer-revision-v2-context');
    assert.equal(legacy.systemInstructionsSha256, revisionPromptIdentity('baseline').systemInstructionsSha256);
  } finally { provider.close(); }
});

test('an unknown revision policy is rejected before any reservation or transport', async () => {
  let calls = 0;
  const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async () => { calls++; return reply(valid); } });
  const invalid: RevisionInput = { runId: 'invalid-policy', question: input.question, product: input.product, rejectedAnswer: 'Plastic.', critique: 'Wrong material.', evidence: input.passages, revisionPolicy: 'unreviewed-env-policy' as RevisionPolicySelector };
  try {
    assert.throws(() => revisionRequestBody(invalid), /Unknown revision policy/);
    await assert.rejects(provider.revise(invalid), /Unknown revision policy/);
    assert.equal(provider.receipt(invalid.runId), undefined);
    assert.equal(calls, 0);
    assert.match(provider.readiness().reason, /0\/20 calls/);
  } finally { provider.close(); }
});

test('candidate revisions retain source-body-only citation validation', async () => {
  const originalQuestion = 'Does this fit model HP12345?';
  const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async () => reply({ answer: 'This fits the model.', status: 'answered', citations: [{ passageId: 'c1', quote: originalQuestion }] }, 'gpt-5.6-luna', 'tool_calls', 'answer_revision_v1') });
  try {
    await assert.rejects(provider.revise({ runId: 'candidate-invalid-citation', question: originalQuestion, product: input.product, rejectedAnswer: 'Unknown.', critique: 'Assess the source.', evidence: [{ id: 'c1', source: 'cqa', text: 'The handle is made of oak.', originalQuestion }], revisionPolicy: 'candidate_v4' }), /revision failed output validation/);
    const receipt = provider.receipt('candidate-invalid-citation')!;
    assert.equal(receipt.error_code, 'output_validation');
    assert.equal(JSON.parse(receipt.receipt_json!).promptVersion, 'answer-revision-v4-attributed-listing');
  } finally { provider.close(); }
});

test('new source-ID originals dispatch the frozen exact body and resolve literal attribute text on the server', async () => {
  const text = 'item_dimensions:  { length:{ normalized_value:{ unit:inches, value:21.5 }, value:21.5 }, height:{ normalized_value:{ unit:inches, value:12. }, value:12. } }';
  const original = { ...input, runId: 'source-id-original', passages: [{ ...input.passages[0], source: 'attribute', text }] };
  let calls = 0, chosen = '';
  const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async (_url, init) => {
    calls++;
    assert.equal(String(init?.body), JSON.stringify(sourceIdAnswerRequestBody(original)));
    const body = JSON.parse(String(init?.body)), payload = JSON.parse(body.messages[1].content);
    assert.equal(payload.citationInterface, 'source_ids_v1');
    assert.equal(body.tool_choice.function.name, 'product_answer_source_ids_v1');
    assert.equal(payload.quoteOptions.length, 1); assert.equal(payload.quoteOptions[0].quote, text);
    assert.equal(payload.evidence[0].reference, 'fixture');
    chosen = payload.quoteOptions[0].id;
    return reply({ answer: `The listing gives a length of 21.5 inches. [${chosen}]`, status: 'answered', citations: [{ quoteId: chosen }] }, 'gpt-5.6-luna', 'tool_calls', 'product_answer_source_ids_v1');
  } });
  try {
    const result = await provider.answerWithSourceIds(original);
    assert.equal(result.answer.answer, 'The listing gives a length of 21.5 inches.');
    assert.deepEqual(result.answer.citations, [{ passageId: 'c1', quote: text }]);
    assert.deepEqual(result.quoteIds, [chosen]); assert.equal(calls, 1);
    assert.equal(result.promptVersion, 'product-answer-source-ids-v1');
    assert.equal(result.systemInstructionsSha256, sourceIdAnswerPromptIdentity().systemInstructionsSha256);
    const receipt = provider.receipt(original.runId)!;
    assert.equal(receipt.error_code, null);
    const identity = JSON.parse(receipt.receipt_json!);
    assert.equal(identity.citationInterface, result.citationInterface);
    assert.equal(identity.optionSetSha256, result.optionSetSha256);
    assert.equal(identity.systemInstructionsSha256, result.systemInstructionsSha256);
    assert.equal(identity.promptVersion, result.promptVersion);
  } finally { provider.close(); }
});

test('new source-ID sibling revisions share exact context/options and differ only in versioned policy instructions', async () => {
  const original: RevisionInput = { runId: 'unused', question: input.question, product: input.product, rejectedAnswer: 'It is plastic.', critique: 'Recheck the material and model scope.', evidence: [{ id: 'c1', source: 'cqa', text: 'It is oak. Question: What is the material for model AB100?', reference: 'fixture://customer' }], investigation: { issue: 'answer_quality', query: input.question, selectedSourceIds: ['c1'], addedSourceIds: [] } };
  const bodies: ReturnType<typeof sourceIdRevisionRequestBody>[] = [];
  const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async (_url, init) => {
    const revisionPolicy = bodies.length === 0 ? 'baseline' : 'candidate_v4';
    assert.equal(String(init?.body), JSON.stringify(sourceIdRevisionRequestBody({ ...original, revisionPolicy })));
    const body = JSON.parse(String(init?.body)), payload = JSON.parse(body.messages[1].content); bodies.push(body);
    assert.equal(payload.evidence[0].text, 'It is oak.');
    assert.equal(payload.evidence[0].originalQuestion, 'What is the material for model AB100?');
    assert.equal(payload.quoteOptions[0].quote, 'It is oak.');
    assert.equal(body.tool_choice.function.name, 'answer_revision_source_ids_v1');
    assert.match(body.messages[0].content, /originalQuestion.*not factual source assertions/);
    assert.doesNotMatch(body.messages[0].content, /exact copied quote/);
    return reply({ answer: 'The customer reports oak for model AB100.', status: 'answered', citations: [{ quoteId: payload.quoteOptions[0].id }] }, 'gpt-5.6-luna', 'tool_calls', 'answer_revision_source_ids_v1');
  } });
  try {
    for (const revisionPolicy of ['baseline', 'candidate_v4'] as const) {
      const runId = `source-id-revision-${revisionPolicy}`;
      const result = await provider.reviseWithSourceIds({ ...original, runId, revisionPolicy });
      const prompt = sourceIdRevisionPromptIdentity(revisionPolicy);
      assert.equal(result.promptVersion, prompt.promptVersion);
      assert.equal(result.systemInstructionsSha256, prompt.systemInstructionsSha256);
      assert.deepEqual(result.answer.citations, [{ passageId: 'c1', quote: 'It is oak.' }]);
      const receipt = JSON.parse(provider.receipt(runId)!.receipt_json!);
      assert.equal(receipt.revisionPolicy, revisionPolicy); assert.equal(receipt.citationInterface, 'source_ids_v1');
      assert.equal(receipt.optionSetSha256, result.optionSetSha256);
    }
    const withoutPolicy = bodies.map(body => {
      const copy = structuredClone(body), payload = JSON.parse(copy.messages[1].content);
      delete payload.promptVersion; copy.messages[0].content = '<policy>'; copy.messages[1].content = JSON.stringify(payload); return copy;
    });
    assert.deepEqual(withoutPolicy[0], withoutPolicy[1]);
    assert.notEqual(bodies[0].messages[0].content, bodies[1].messages[0].content);
    assert.equal(sourceIdRevisionPromptIdentity().systemInstructionsSha256, sourceIdRevisionPromptIdentity('baseline').systemInstructionsSha256);
    assert.equal(sourceIdRevisionPromptIdentity('baseline', false).promptVersion, 'answer-revision-v2-context-source-ids-v1');
    const mutated = sourceIdRevisionRequestBody(original);
    (mutated.tools[0].function.parameters as { required: string[] }).required.push('injected');
    assert.deepEqual(sourceIdRevisionRequestBody(original), bodies[0]);
  } finally { provider.close(); }
});

test('source-ID outputs reject foreign IDs, duplicates, unresolved markers and uncited answers without retrying', async () => {
  const evidence = input.passages.map(({ id, source, text, reference }) => ({ id, source, text, reference }));
  const selected = sourceCitationOptions({ productId: input.product.id, question: input.question, evidence })[0].id;
  const foreign = sourceCitationOptions({ productId: 'different-product', question: input.question, evidence })[0].id;
  const outputs = [
    { answer: 'Oak.', status: 'answered', citations: [{ quoteId: foreign }] },
    { answer: 'Oak.', status: 'answered', citations: [{ quoteId: selected }, { quoteId: selected }] },
    { answer: 'Oak.', status: 'answered', citations: [] },
    { answer: `Oak. [${foreign}]`, status: 'answered', citations: [{ quoteId: selected }] },
    { answer: `Oak. ${selected}`, status: 'answered', citations: [{ quoteId: selected }] },
    { answer: 'Oak.', status: 'answered', citations: [{ quoteId: selected, quote: 'A fabricated quote.' }] },
  ];
  for (const [index, output] of outputs.entries()) {
    let calls = 0; const runId = `invalid-source-id-${index}`;
    const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async () => { calls++; return reply(output, 'gpt-5.6-luna', 'tool_calls', 'product_answer_source_ids_v1'); } });
    try {
      await assert.rejects(provider.answerWithSourceIds({ ...input, runId }), /output validation/);
      assert.equal(calls, 1); assert.equal(provider.receipt(runId)!.error_code, 'output_validation');
    } finally { provider.close(); }
  }
});

test('source-ID preflight rejects duplicate sources, oversized bodies, foreign products and unknown policies without reserving calls', async () => {
  let calls = 0;
  const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async () => { calls++; return reply(valid); } });
  try {
    for (const [index, passages] of [[input.passages[0], input.passages[0]], [{ ...input.passages[0], text: 'x'.repeat(3001) }], [{ ...input.passages[0], productId: 'foreign' }]].entries()) {
      const runId = `source-preflight-${index}`;
      await assert.rejects(provider.answerWithSourceIds({ ...input, runId, passages }), /Source-ID/);
      assert.equal(provider.receipt(runId), undefined);
    }
    await assert.rejects(provider.reviseWithSourceIds({ runId: 'source-preflight-policy', question: input.question, product: input.product, rejectedAnswer: 'Plastic.', critique: 'Check source.', evidence: input.passages, revisionPolicy: 'unknown' as RevisionPolicySelector }), /Unknown revision policy/);
    assert.equal(provider.receipt('source-preflight-policy'), undefined);
    assert.equal(calls, 0); assert.match(provider.readiness().reason, /0\/20 calls/);
  } finally { provider.close(); }
});

test('source-ID identities are independently versioned while the historical revision body stays byte-identical', () => {
  const frozen: RevisionInput = { runId: 'frozen-serialization', question: 'What material is the handle?', product: { id: 'p1', title: 'Example fixture item' }, rejectedAnswer: 'Plastic.', critique: 'Check the supplied material.', evidence: [{ id: 'c1', source: 'manufacturer', text: 'The handle is made of oak.' }], investigation: { issue: 'answer_quality', query: 'handle material', selectedSourceIds: ['c1'], addedSourceIds: [] } };
  assert.equal(createHash('sha256').update(JSON.stringify(revisionRequestBody(frozen))).digest('hex'), '787a67173ae5e849867b3a5b1cd6458522362972ddd6efa3fcd7d1032e8de993');
  for (const [identity, expected] of [
    [sourceIdAnswerPromptIdentity(), '29bef50129107f14d3dac0b4b9cc42c382127e1543f76c405f9c34712d9a2202'],
    [sourceIdRevisionPromptIdentity('baseline'), 'ec06924d7590acf51f7e52b19a9edd700e5c51c24b8ab38db9e10352cb314862'],
    [sourceIdRevisionPromptIdentity('candidate_v4'), 'b06b92911b87f06c9f215ce5e23bf8a4a9762220be74cc1f69d0e8be83ffa53f']
  ] as const) {
    assert.equal(identity.systemInstructionsSha256, expected);
    assert.equal(createHash('sha256').update(identity.systemInstructions).digest('hex'), expected);
    assert.equal(Object.isFrozen(identity), true);
  }
});

test('source-ID revisions reject invalid IDs and preserve uncited uncertainty without fabricating a citation', async () => {
  const revision: RevisionInput = { runId: 'source-uncertain', question: input.question, product: input.product, rejectedAnswer: 'Plastic.', critique: 'Check the missing source relationship.', evidence: input.passages, revisionPolicy: 'candidate_v4' };
  let calls = 0;
  const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async () => {
    calls++;
    return reply(calls === 1 ? { answer: 'The source does not establish the requested relationship.', status: 'insufficient_evidence', citations: [] }
      : { answer: 'The handle is oak.', status: 'answered', citations: [{ quoteId: 'src_invented' }] }, 'gpt-5.6-luna', 'tool_calls', 'answer_revision_source_ids_v1');
  } });
  try {
    const result = await provider.reviseWithSourceIds(revision);
    assert.equal(result.answer.status, 'insufficient_evidence'); assert.deepEqual(result.answer.citations, []);
    await assert.rejects(provider.reviseWithSourceIds({ ...revision, runId: 'source-invalid-revision' }), /output validation/);
    assert.equal(provider.receipt('source-invalid-revision')!.error_code, 'output_validation'); assert.equal(calls, 2);
  } finally { provider.close(); }
});
