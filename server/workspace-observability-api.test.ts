import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createApp } from './app.ts';
import { DemoAccess, type DemoAccessConfig, type DemoRole } from './demo-access.ts';
import { RunStore } from './store.ts';
import { PilotRunner, PilotStore } from './pilot.ts';
import { ProductWorkspace } from './product-workspace.ts';
import { SyntheticAnswerProvider } from './synthetic-answer-provider.ts';
import { SapiomFeedbackProvider } from './feedback-provider.ts';
import { AutomaticSupport, automaticSupportGradeInput } from './automatic-support.ts';
import { claimSupportRequestParts } from './claim-support.ts';
import { RuntimeAnswerPolicyStore } from './runtime-answer-policy.ts';
import { createRuntimeGraderBinding } from './runtime-grader.ts';
import { CITED_APPLICABILITY_GRADER_VERSION } from './claim-support-v4.ts';
import { localDemoRetriever } from './local-demo.ts';
import { buildWorkspaceObservabilityPreview } from './workspace-observability-v1.ts';
import type { WorkspaceProof } from './workspace-proof.ts';

const paths = ['/api/workspace/observability', '/api/workspace/observability/export'];
const canary = 'PRIVATE-CANARY-observability-api-user@example.invalid-91027';
const accessConfig: DemoAccessConfig = {
  origin: 'https://demo.example.test', issuer: 'https://identity.example.test', audience: 'observability-api-fixture', jwksUrl: 'https://identity.example.test/certs',
  members: (['viewer', 'reviewer', 'operator'] as const).map(role => ({ subject: `fixture-${role}`, role, name: `Fixture ${role}` }))
};
const keys = generateKeyPair('RS256');
type Reply = { status: number; headers: import('node:http').IncomingHttpHeaders; text: string; value: any };

function snapshot(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' ORDER BY name").all() as { name: string; sql: string }[];
    return tables.map(table => ({ ...table, rows: db.prepare(`SELECT * FROM "${table.name.replaceAll('"', '""')}" ORDER BY rowid`).all() }));
  } finally { db.close(); }
}

async function boot(directory: string, hosted: boolean, liveFixture = false, omitInjection = false) {
  const files = ['receipts.sqlite', 'workspace.sqlite', 'reviews.sqlite', 'policies.sqlite', 'runs.sqlite'].map(file => join(directory, file));
  let providerDispatches = 0;
  const provider = liveFixture ? new SapiomFeedbackProvider({ enabled: true, apiKey: 'synthetic-api-fixture', dbPath: files[0], capUsd: 0.1, allowancePerCallUsd: 0.1, callLimit: 1,
    fetchImpl: async (_url, init) => {
      providerDispatches++;
      const request = JSON.parse(String(init?.body)), input = JSON.parse(request.messages[1].content);
      return new Response(JSON.stringify({ model: 'gpt-5.6-luna', choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: request.tool_choice.function.name,
        arguments: JSON.stringify({ answer: `Synthetic intercepted response: ${canary}`, status: 'answered', citations: [input.quoteOptions[0].id] }) } }] } }], usage: { prompt_tokens: 12, completion_tokens: 8 } }));
    }
  }) : new SyntheticAnswerProvider(files[0]);
  const policies = new RuntimeAnswerPolicyStore(files[3]);
  const workspace = new ProductWorkspace(files[1], provider, localDemoRetriever, policies);
  const product = workspace.createProduct({ title: `Synthetic fixture ${canary}`, sources: [{ label: 'Synthetic fixture source', text: `SYNTHETIC fixture: The fictional bottle holds six cups and has a cork lid. ${canary}`, originalQuestion: `What source context contains ${canary}?` }] });
  await workspace.ask({ productId: product.id, question: `What capacity and lid are listed for ${canary}?`, mode: liveFixture ? 'live' : 'synthetic' }, undefined, { automaticCheck: true });
  // The saved pending handoff is deliberate: a GET must not enqueue its check.
  const checks = new AutomaticSupport(provider, files[2], { graderBinding: createRuntimeGraderBinding(liveFixture ? 'live' : 'synthetic', CITED_APPLICABILITY_GRADER_VERSION) });
  checks.close();
  const store = new RunStore(files[4]);
  const demoAccess = hosted ? new DemoAccess(accessConfig, { keyResolver: createLocalJWKSet({ keys: [{ ...await exportJWK((await keys).publicKey), kid: 'fixture-key', alg: 'RS256' }] }) }) : undefined;
  const server = createApp(store, 'fixture', undefined, new PilotRunner(new PilotStore(':memory:')), undefined, undefined, omitInjection ? undefined : workspace, undefined, false,
    { answerProvider: omitInjection ? undefined : provider, reviewDbPath: files[2], runtimePolicyStore: policies, runtimePolicyDbPath: files[3], demoAccess });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const assertions = Object.fromEntries(await Promise.all((['viewer', 'reviewer', 'operator'] as const).map(async role => [role,
    await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' }).setIssuer(accessConfig.issuer).setAudience(accessConfig.audience).setSubject(`fixture-${role}`).setIssuedAt().setExpirationTime('5m').sign((await keys).privateKey)]))) as Record<DemoRole, string>;
  const send = (path: string, role: DemoRole | null = 'viewer', method = 'GET') => new Promise<Reply>((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: address.port, path, method,
      headers: { host: hosted ? 'demo.example.test' : `127.0.0.1:${address.port}`, ...(hosted && role ? { 'cf-access-jwt-assertion': assertions[role] } : {}), ...(method === 'POST' ? { origin: hosted ? accessConfig.origin : `http://127.0.0.1:${address.port}`, 'content-type': 'application/json' } : {}) }
    }, res => {
      let output = ''; res.setEncoding('utf8'); res.on('data', chunk => { output += chunk; });
      res.on('end', () => { try { resolve({ status: res.statusCode ?? 0, headers: res.headers, text: output, value: JSON.parse(output) }); } catch (error) { reject(error); } });
    });
    req.setTimeout(10_000, () => req.destroy(new Error('Synthetic fixture request timed out.'))); req.on('error', reject); req.end(method === 'POST' ? '{}' : undefined);
  });
  return { files, provider, workspace, send, dispatches: () => providerDispatches, async close() { await server.shutdown(); store.close(); if (omitInjection) { workspace.close(); provider.close(); } } };
}

test('hosted trace reads require identity, permit every reader role and retain only verified metadata', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-observability-hosted-'));
  let outbound = 0;
  t.mock.method(globalThis, 'fetch', async () => { outbound++; throw new Error('No outbound connection is allowed in this synthetic HTTP fixture.'); });
  const app = await boot(directory, true);
  try {
    const before = app.files.map(snapshot);
    for (const path of paths) {
      assert.equal((await app.send(path, null)).status, 401);
      for (const role of ['viewer', 'reviewer', 'operator'] as const) {
        const reply = await app.send(path, role);
        assert.equal(reply.status, 200); assert.equal(reply.headers['cache-control'], 'no-store');
        assert.match(String(reply.headers['content-type']), /^application\/json/);
        assert.equal(reply.value.format, 'ablatrix-workspace-observability-preview-v1');
        assert.equal(reply.value.privacy, 'metadata_only'); assert.equal(reply.value.providerCalls, 0); assert.equal(reply.value.exported, false);
        assert.ok(!reply.text.includes(canary));
        assert.ok(!reply.text.includes('user@example.invalid'));
        if (path.endsWith('/export')) {
          assert.equal(reply.headers['content-disposition'], 'attachment; filename="ablatrix-workspace-observability-preview.json"');
          assert.equal(reply.headers['x-content-type-options'], 'nosniff');
        } else assert.equal(reply.headers['content-disposition'], undefined);
        assert.equal((await app.send(path, role, 'POST')).status, 403);
      }
    }
    const proof = (await app.send('/api/workspace/proof')).value as WorkspaceProof;
    const expected = buildWorkspaceObservabilityPreview(proof);
    assert.deepEqual((await app.send(paths[0])).value, expected);
    assert.deepEqual((await app.send(paths[1])).value, expected);
    assert.equal(proof.cases[0].run.automaticCheckHandoff, 'pending');
    assert.equal(proof.cases[0].job, null);
    assert.deepEqual(app.files.map(snapshot), before, 'trace reads must not register handoffs, enqueue jobs or alter saved workflow history');
    assert.equal(outbound, 0);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('trace reads and exports preserve the bounded provider ledger and cannot dispatch another answer', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-observability-ledger-'));
  let outbound = 0;
  t.mock.method(globalThis, 'fetch', async () => { outbound++; throw new Error('No external HTTP request is allowed.'); });
  const app = await boot(directory, false, true);
  try {
    assert.equal(app.dispatches(), 1, 'only the intercepted fixture setup may create a provider receipt');
    assert.equal(app.provider.capacity(1).ready, false, 'the fixture has exhausted its single reservation');
    const before = app.files.map(snapshot);
    const first = await app.send(paths[0]); assert.equal(first.status, 200);
    for (let i = 0; i < 3; i++) for (const path of paths) {
      const reply = await app.send(path); assert.equal(reply.status, 200); assert.deepEqual(reply.value, first.value);
    }
    assert.deepEqual(app.files.map(snapshot), before, 'reads must not create, reconcile or reserve provider calls');
    assert.equal(app.dispatches(), 1); assert.equal(outbound, 0);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('unverifiable saved evidence fails both trace routes without a partial projection or raw error', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-observability-invalid-'));
  const app = await boot(directory, false);
  try {
    const read = app.workspace.proofRuns.bind(app.workspace);
    app.workspace.proofRuns = () => read().map(run => ({ ...run, answer: { ...run.answer!, answer: `Unaccepted altered answer ${canary}` } }));
    const expected = { error: 'Automatic check: Paired evidence could not be verified against its exact saved sources, requests and receipts.' };
    for (const path of [...paths, '/api/workspace/proof', '/api/workspace/proof/export']) {
      const reply = await app.send(path);
      assert.equal(reply.status, 409); assert.deepEqual(reply.value, expected);
      assert.equal(reply.headers['content-disposition'], undefined);
      assert.ok(!reply.text.includes(canary)); assert.ok(!reply.text.includes('resourceSpans'));
    }
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('the first trace GET preserves an expired started check instead of reconciling its lease', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-observability-expired-'));
  const app = await boot(directory, false);
  try {
    const checks = new AutomaticSupport(app.provider, app.files[2], { graderBinding: createRuntimeGraderBinding('synthetic', CITED_APPLICABILITY_GRADER_VERSION) });
    const job = checks.enqueue(app.workspace.reviewSnapshots()[0]); checks.close();
    job.status = 'checking';
    job.operations = [{ phase: 'grade_original', runId: `${job.id}:grade-original`, status: 'started',
      requestSha256: claimSupportRequestParts(automaticSupportGradeInput(job)).bindings.requestSha256, startedAt: job.createdAt }];
    const db = new DatabaseSync(app.files[2]);
    try { db.prepare('UPDATE automatic_support_jobs SET status=?,document=?,lease_expires=0 WHERE id=?').run(job.status, JSON.stringify(job), job.id); } finally { db.close(); }
    const before = app.files.map(snapshot);
    for (const path of paths) {
      const reply = await app.send(path); assert.equal(reply.status, 200);
      const spans = reply.value.otlp.resourceSpans[0].scopeSpans[0].spans;
      assert.ok(spans.some((span: { name: string }) => span.name === 'check-original-snapshot'));
      const rootAttributes = spans[0].attributes;
      assert.ok(rootAttributes.some((attribute: { key: string; value: { stringValue?: string } }) => attribute.key === 'langfuse.observation.metadata.automatic_status' && attribute.value.stringValue === 'checking'));
    }
    assert.deepEqual(app.files.map(snapshot), before, 'the first read must preserve saved status, operation bytes and expired lease');
    // The historical proof route retains its existing reconciliation contract.
    const proof = await app.send('/api/workspace/proof'); assert.equal(proof.status, 200);
    assert.equal(proof.value.cases[0].job.status, 'reconciliation');
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('saved-only trace inspection does not construct a workspace, provider or policy store', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-observability-saved-only-'));
  const seeded = await boot(directory, false, true);
  const files = seeded.files;
  await seeded.close();
  const db = new DatabaseSync(files[1]);
  try {
    const saved = JSON.parse((db.prepare('SELECT document FROM workspace_runs LIMIT 1').get() as { document: string }).document);
    const legacy = { ...saved, id: randomUUID(), generation: undefined, requestIdentity: undefined, status: 'retrieving', answer: null, model: null, usage: null, finishedAt: undefined, durationMs: undefined };
    db.prepare('INSERT INTO workspace_runs(id,created_at,document) VALUES(?,?,?)').run(legacy.id, legacy.createdAt, JSON.stringify(legacy));
  } finally { db.close(); }
  const policyPath = join(directory, 'must-not-create-policy.sqlite');
  const env = { ABLATRIX_WORKSPACE_DB: files[1], ABLATRIX_LOOP_BUDGET_DB: files[0], ABLATRIX_RUNTIME_POLICY_DB: policyPath };
  const priorEnv = Object.keys(env).map(key => [key, process.env[key]] as const);
  Object.assign(process.env, env);
  let outbound = 0;
  t.mock.method(globalThis, 'fetch', async () => { outbound++; throw new Error('Trace inspection must not open an outbound connection.'); });
  const store = new RunStore(files[4]);
  const server = createApp(store, 'fixture', undefined, new PilotRunner(new PilotStore(':memory:')), undefined, undefined, undefined, undefined, false, { reviewDbPath: files[2] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const get = (path: string) => new Promise<Reply>((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: address.port, path }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('end', () => { try { resolve({ status: res.statusCode ?? 0, headers: res.headers, text, value: JSON.parse(text) }); } catch (error) { reject(error); } });
    }); req.on('error', reject); req.end();
  });
  try {
    const before = files.map(snapshot);
    for (const path of paths) {
      const reply = await get(path); assert.equal(reply.status, 200); assert.ok(!reply.text.includes(canary));
      const roots = reply.value.otlp.resourceSpans[0].scopeSpans[0].spans.filter((span: { parentSpanId?: string }) => !span.parentSpanId);
      assert.equal(roots.length, 2);
      assert.ok(roots.some((span: { attributes: { key: string; value: { stringValue?: string } }[] }) => span.attributes.some(attribute => attribute.key === 'langfuse.observation.metadata.status' && attribute.value.stringValue === 'retrieving')));
    }
    assert.deepEqual(files.map(snapshot), before, 'the interrupted legacy run and provider ledger must remain byte-for-byte unchanged');
    assert.equal(existsSync(policyPath), false); assert.equal(outbound, 0);
    // Missing history is an empty local preview; its GET must not create stores.
    process.env.ABLATRIX_WORKSPACE_DB = join(directory, 'missing-workspace.sqlite');
    process.env.ABLATRIX_LOOP_BUDGET_DB = join(directory, 'missing-ledger.sqlite');
    const empty = await get(paths[0]); assert.equal(empty.status, 200);
    assert.deepEqual(empty.value.otlp.resourceSpans[0].scopeSpans[0].spans, []);
    assert.equal(existsSync(process.env.ABLATRIX_WORKSPACE_DB), false); assert.equal(existsSync(process.env.ABLATRIX_LOOP_BUDGET_DB), false);
  } finally {
    await server.shutdown(); store.close();
    for (const [key, value] of priorEnv) value === undefined ? delete process.env[key] : process.env[key] = value;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a misconfigured hosted trace reader cannot fall back to local live history', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-observability-hosted-config-'));
  const env = { ABLATRIX_WORKSPACE_DB: join(directory, 'workspace.sqlite'), ABLATRIX_LOOP_BUDGET_DB: join(directory, 'receipts.sqlite') };
  const priorEnv = Object.keys(env).map(key => [key, process.env[key]] as const);
  Object.assign(process.env, env);
  const app = await boot(directory, true, true, true);
  try {
    const before = app.files.map(snapshot);
    for (const path of paths) {
      assert.equal((await app.send(path, null)).status, 401);
      const reply = await app.send(path, 'viewer');
      assert.equal(reply.status, 409);
      assert.deepEqual(reply.value, { error: 'Automatic check: Paired evidence could not be verified against its exact saved sources, requests and receipts.' });
      assert.ok(!reply.text.includes('resourceSpans')); assert.ok(!reply.text.includes(canary));
    }
    assert.deepEqual(app.files.map(snapshot), before);
  } finally {
    await app.close();
    for (const [key, value] of priorEnv) value === undefined ? delete process.env[key] : process.env[key] = value;
    rmSync(directory, { recursive: true, force: true });
  }
});
