import test from 'node:test';
import assert from 'node:assert/strict';
import type { PilotRequest } from './pilot.ts';
import { createNamedRouterTransport, runPilotWorkflow, type NamedRouterRequest, type NamedRouterResult, type PilotWorkflowDependencies } from './pilot-workflow.ts';

const quote = 'You can use GitHub Actions to automate your workflow.';
const request: PilotRequest = { attemptId: 'test-attempt', question: 'What can GitHub Actions automate?', searchEnabled: false, model: 'gpt-luna', lane: 'run_now', maxTokens: 4096,
  source: { id: 'source-1', title: 'Actions', url: 'https://docs.github.com/en/actions', capturedAt: '2026-09-24T00:00:00Z', text: quote, sha256: 'a'.repeat(64) } };
const answer = { answer: 'GitHub Actions can automate your workflow.', citations: [{ url: request.source.url, quote }] };
function response(overrides: Record<string, unknown> = {}) {
  return { id: 'chatcmpl-test', model: 'gpt-5.6-luna', usage: { prompt_tokens: 82, completion_tokens: 30 }, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: { name: 'grounded_pilot_answer', arguments: JSON.stringify(answer) } }] } }], ...overrides };
}
function dependencies(overrides: Partial<PilotWorkflowDependencies> = {}): PilotWorkflowDependencies {
  return { search: async () => ({ answer: 'Untrusted search hypothesis.' }), router: async () => ({ output: answer, model: 'gpt-luna', modelVerified: true, usage: null, requestId: 'request-test' }), ...overrides };
}
const routerInput: NamedRouterRequest = { model: 'gpt-luna', lane: 'run_now', maxTokens: 4096, messages: [{ role: 'system', content: 'Test' }, { role: 'user', content: 'Test' }] };
function fetchResponse(body: unknown, status = 200): typeof fetch {
  return async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-request-id': 'request-test' } });
}

test('both arms use the same named model, generation settings and prompt except the search hypothesis', async () => {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [], searches: unknown[] = [];
  const transport = createNamedRouterTransport('test-key', async (url, init) => {
    calls.push({ url: String(url), init: init!, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(response()));
  });
  const deps = dependencies({ router: transport, search: async query => { searches.push(query); return { answer: 'Search says workflows can be automated.' }; }, executionId: 'execution-test' });
  const off = await runPilotWorkflow(request, deps), on = await runPilotWorkflow({ ...request, searchEnabled: true }, deps);
  assert.equal(off.status, 'completed'); assert.equal(on.status, 'completed');
  assert.deepEqual(off.calls, { search: 0, model: 1 }); assert.deepEqual(on.calls, { search: 1, model: 1 });
  assert.deepEqual(searches, [{ query: request.question, intent: 'answer', depth: 'standard' }]);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, 'https://router.sapiom.ai/v1/chat/completions');
    assert.equal(call.body.model, 'gpt-luna'); assert.equal(call.body.max_tokens, 4096);
    assert.equal(new Headers(call.init.headers).get('x-sapiom-lane'), 'run_now');
    assert.equal(call.body.parallel_tool_calls, false);
    assert.equal(JSON.stringify(call.body).includes(request.attemptId), false);
    assert.equal(JSON.stringify(call.body).includes(request.source.sha256), false);
    assert.equal(JSON.stringify(call.body).includes('expectedAnswer'), false);
    assert.equal(JSON.stringify(call.body).includes('requiredFacts'), false);
  }
  const offMessages = calls[0].body.messages as { content: string }[], onMessages = calls[1].body.messages as { content: string }[];
  const offData = JSON.parse(offMessages[1].content), onData = JSON.parse(onMessages[1].content);
  assert.equal(offData.searchHypothesis, ''); assert.equal(onData.searchHypothesis, 'Search says workflows can be automated.');
  onData.searchHypothesis = '';
  assert.deepEqual(onData, offData);
  onMessages[1].content = JSON.stringify(onData);
  assert.deepEqual(calls[1].body, calls[0].body);
  assert.equal(off.executionId, 'execution-test'); assert.equal(off.requestId, 'chatcmpl-test');
  assert.equal(off.modelVerified, true); assert.equal(off.charge, null);
  assert.deepEqual(off.usage, { inputTokens: 82, outputTokens: 30 });
});

test('invalid protocol settings or leaked reference labels reject before any call', async () => {
  let calls = 0;
  const deps = dependencies({ search: async () => { calls++; return {}; }, router: async () => { calls++; throw Error('should not run'); } });
  for (const changed of [{ ...request, model: 'gpt-6-luna' }, { ...request, maxTokens: 200 }, { ...request, expectedAnswer: 'private answer label' }]) {
    const result = await runPilotWorkflow(changed as PilotRequest, deps);
    assert.equal(result.errorCode, 'invalid_pilot_request'); assert.deepEqual(result.calls, { search: 0, model: 0 });
  }
  assert.equal(calls, 0);
});

test('grounding rejects invented quotes and another URL even when the search hypothesis contains them', async () => {
  for (const citation of [{ url: request.source.url, quote: 'An invented supporting quotation.' }, { url: 'https://example.com', quote }]) {
    const result = await runPilotWorkflow({ ...request, searchEnabled: true }, dependencies({
      search: async () => ({ answer: citation.quote }), router: async () => ({ output: { ...answer, citations: [citation] }, model: 'gpt-luna', modelVerified: true, usage: null, requestId: null })
    }));
    assert.equal(result.status, 'failed'); assert.equal(result.errorCode, 'answer_not_grounded'); assert.equal(result.output, null);
  }
});

test('search errors preserve attempted calls without exposing provider text or calling the model', async () => {
  const result = await runPilotWorkflow({ ...request, searchEnabled: true }, dependencies({ search: async () => { throw Error('secret-provider-text'); }, router: async () => { throw Error('unexpected model call'); } }));
  assert.equal(result.errorCode, 'search_failed'); assert.deepEqual(result.calls, { search: 1, model: 0 });
  assert.equal(JSON.stringify(result).includes('secret-provider-text'), false);
});

test('search hypotheses are capped and never replace the frozen source', async () => {
  let prompt: unknown;
  const result = await runPilotWorkflow({ ...request, searchEnabled: true }, dependencies({ search: async () => ({ answer: 'x'.repeat(6000) }), router: async input => {
    prompt = JSON.parse(input.messages[1].content);
    return { output: answer, model: 'gpt-luna', modelVerified: true, usage: null, requestId: null };
  } }));
  assert.equal(result.status, 'completed');
  assert.deepEqual(prompt, { question: request.question, frozenSource: { url: request.source.url, text: request.source.text }, searchHypothesis: 'x'.repeat(4000) });
});

test('Router accepts only verified named aliases and keeps mismatch metadata', async () => {
  for (const model of ['gpt-luna', 'gpt-5.6-luna']) {
    assert.equal((await createNamedRouterTransport('test-key', fetchResponse(response({ model })))(routerInput)).modelVerified, true);
  }
  for (const model of ['gpt-6-luna', 'smart', null]) {
    const result = await runPilotWorkflow(request, dependencies({ router: createNamedRouterTransport('test-key', fetchResponse(response({ model }))) }));
    assert.equal(result.errorCode, 'router_model_unverified'); assert.equal(result.model, model); assert.equal(result.modelVerified, false);
    assert.equal(result.requestId, 'request-test'); assert.deepEqual(result.calls, { search: 0, model: 1 });
  }
});

test('Router rejects malformed tool answers, extra output fields and cutoff output without retries', async () => {
  const malformed = [
    { finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: { name: 'grounded_pilot_answer', arguments: '{' } }] } },
    { finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: { name: 'grounded_pilot_answer', arguments: JSON.stringify({ ...answer, injected: true }) } }] } },
    { finish_reason: 'length', message: { tool_calls: [{ type: 'function', function: { name: 'grounded_pilot_answer', arguments: JSON.stringify(answer) } }] } },
    { finish_reason: 'stop', message: { content: JSON.stringify(answer) } }
  ];
  for (const [index, choice] of malformed.entries()) {
    let fetches = 0;
    const result = await runPilotWorkflow(request, dependencies({ router: createNamedRouterTransport('test-key', async () => { fetches++; return new Response(JSON.stringify(response({ choices: [choice] }))); }) }));
    assert.equal(result.status, 'failed'); assert.equal(result.output, null); assert.equal(fetches, 1);
    assert.equal(result.errorCode, index === 2 ? 'router_incomplete_output' : index === 3 ? 'router_invalid_response' : 'router_invalid_answer');
    assert.equal(result.requestId, 'chatcmpl-test'); assert.deepEqual(result.usage, { inputTokens: 82, outputTokens: 30 });
  }
});

test('Router strips HTTP and network errors, and refuses oversized responses', async () => {
  const transports = [
    createNamedRouterTransport('test-key', fetchResponse({ error: 'secret-provider-text' }, 429)),
    createNamedRouterTransport('test-key', async () => { throw Error('secret-provider-text'); }),
    createNamedRouterTransport('test-key', async () => new Response('x'.repeat(128 * 1024 + 1)))
  ];
  for (const [index, router] of transports.entries()) {
    const result = await runPilotWorkflow(request, dependencies({ router }));
    assert.equal(result.errorCode, ['router_http_error', 'router_network_error', 'router_response_too_large'][index]);
    assert.equal(JSON.stringify(result).includes('secret-provider-text'), false);
    assert.equal(result.charge, null); assert.deepEqual(result.calls, { search: 0, model: 1 });
  }
});

test('injected transports cannot bypass answer limits or model verification', async () => {
  for (const reply of [
    { output: { ...answer, answer: 'x'.repeat(12_001) }, model: 'gpt-luna', modelVerified: true },
    { output: answer, model: 'gpt-6-luna', modelVerified: true }
  ]) {
    const result = await runPilotWorkflow(request, dependencies({ router: async () => ({ ...reply, usage: null, requestId: null }) as NamedRouterResult }));
    assert.equal(result.status, 'failed'); assert.equal(result.output, null);
  }
});
