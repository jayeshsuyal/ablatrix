import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage, ClientRequest } from 'node:http';
import type { RequestOptions } from 'node:https';
import https from 'node:https';
import { qualificationRouterTransport, qualificationTransportMechanics } from './grader-qualification-live-transport.ts';
const endpoint = 'https://router.sapiom.ai/v1/chat/completions';
const init = () => ({ method: 'POST', redirect: 'error' as const, signal: AbortSignal.timeout(1000), headers: { authorization: 'Bearer SYNTHETIC_FAKE_KEY', 'content-type': 'application/json', 'x-sapiom-lane': 'run_now' }, body: '{"synthetic":"wire mechanics only"}' });
function fakeWire(chunks: Buffer[] = [Buffer.from('{"synthetic":true}')], status = 200, hang = false) {
  let options: RequestOptions | undefined, body: unknown, destroyed = false;
  const req = new EventEmitter() as ClientRequest;
  req.destroy = (error?: Error) => { destroyed = true; if (error) queueMicrotask(() => req.emit('error', error)); return req; };
  const request: Parameters<typeof qualificationTransportMechanics>[0] = (value, callback) => {
    options = value;
    req.end = ((content: unknown) => {
      body = content;
      queueMicrotask(() => {
        const message = new Readable({ read() { for (const chunk of chunks) this.push(chunk); if (!hang) this.push(null); } }) as IncomingMessage;
        message.statusCode = status; message.headers = { 'content-type': 'application/json' }; callback(message);
      });
      return req;
    }) as ClientRequest['end'];
    return req;
  };
  return { request, state: () => ({ options, body, destroyed }) };
}

test('direct HTTPS mechanics pins target, TLS, a private agent and exact frozen request bytes', async () => {
  const fake = fakeWire(), input = init(), saved = globalThis.fetch, savedAgent = https.globalAgent, BuiltinAgent = https.Agent;
  let fabricatedAgentConstructed = 0;
  globalThis.fetch = async () => { throw new Error('Global fetch must not be consulted.'); };
  https.globalAgent = { constructor: function () { fabricatedAgentConstructed++; } } as never;
  try {
    const response = await qualificationTransportMechanics(fake.request, endpoint, input); assert.equal(await response.text(), '{"synthetic":true}');
    const state = fake.state(); assert.equal(state.body, input.body); assert.equal(state.options?.hostname, 'router.sapiom.ai'); assert.equal(state.options?.servername, 'router.sapiom.ai'); assert.equal(state.options?.path, '/v1/chat/completions'); assert.ok(state.options?.agent instanceof BuiltinAgent); assert.notEqual(state.options?.agent, savedAgent); assert.equal(fabricatedAgentConstructed, 0); assert.equal(state.options?.rejectUnauthorized, true); assert.equal(state.options?.minVersion, 'TLSv1.2');
    // Deliberately invalid endpoint: test production's preflight rejection
    // without a credential, connection, provider call or redirect opportunity.
    await assert.rejects(qualificationRouterTransport('https://unapproved.invalid', input));
  } finally { globalThis.fetch = saved; https.globalAgent = savedAgent; }
});

test('direct HTTPS bounds response bytes, cancellation and request headers without retry', async () => {
  const oversized = fakeWire([Buffer.alloc(128 * 1024), Buffer.from('x')]);
  await assert.rejects(qualificationTransportMechanics(oversized.request, endpoint, init()), /128 KiB/); assert.equal(oversized.state().destroyed, true);
  const controller = new AbortController(), pending = fakeWire([], 200, true);
  const operation = qualificationTransportMechanics(pending.request, endpoint, { ...init(), signal: controller.signal }); controller.abort();
  await assert.rejects(operation, /aborted/); assert.equal(pending.state().destroyed, true);
  for (const edit of [{ headers: { ...init().headers, host: 'unapproved.invalid' } }, { method: 'GET' }, { redirect: 'follow' as const }]) {
    const fake = fakeWire(); await assert.rejects(qualificationTransportMechanics(fake.request, endpoint, { ...init(), ...edit })); assert.equal(fake.state().options, undefined);
  }
  const redirect = fakeWire([], 302); assert.equal((await qualificationTransportMechanics(redirect.request, endpoint, init())).status, 302);
  const stopped = new AbortController(); let disposed = 0;
  const throwing: Parameters<typeof qualificationTransportMechanics>[0] = options => {
    const agent = options.agent as https.Agent, original = agent.destroy.bind(agent); agent.destroy = () => { disposed++; original(); };
    const request = new EventEmitter() as ClientRequest; request.destroy = () => request;
    request.end = (() => { throw new Error('SYNTHETIC synchronous write failure'); }) as ClientRequest['end']; return request;
  };
  await assert.rejects(qualificationTransportMechanics(throwing, endpoint, { ...init(), signal: stopped.signal }), /synchronous write failure/);
  assert.equal(disposed, 1); assert.equal(getEventListeners(stopped.signal, 'abort').length, 0);
});
