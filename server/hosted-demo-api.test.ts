import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createApp } from './app.ts';
import { DemoAccess, type DemoAccessConfig, type DemoRole } from './demo-access.ts';
import { SyntheticAnswerProvider } from './synthetic-answer-provider.ts';
import { ProductWorkspace } from './product-workspace.ts';
import { PaidAnswerReview } from './paid-answer-review.ts';
import { RunStore } from './store.ts';
import { PilotRunner, PilotStore } from './pilot.ts';
import type { AnswerRevisions } from './answer-revisions.ts';
import type { ContextComparisonDetail } from './context-comparison.ts';
import type { LoopRetriever, ProductCorpus } from './loop-types.ts';

const config: DemoAccessConfig = { origin: 'https://demo.example.test', issuer: 'https://identity.example.test', audience: 'hosted-api-test', jwksUrl: 'https://identity.example.test/certs', members: ['viewer', 'reviewer', 'operator'].map(role => ({ subject: `test-${role}`, role: role as DemoRole, name: `Configured ${role}` })) };
const keys = generateKeyPair('RS256');
async function assertion(role: DemoRole) {
  return new SignJWT({ role: 'operator', email: 'spoofed@example.test' }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(config.issuer).setAudience(config.audience).setSubject(`test-${role}`).setIssuedAt().setExpirationTime('5m').sign((await keys).privateKey);
}
const offlineRetriever = (corpus: ProductCorpus): LoopRetriever => ({
  close() {},
  async retrieve(productId) { return { passages: corpus.passages.filter(p => p.productId === productId).map(p => ({ ...p, lexicalRank: 1, semanticRank: null, score: 1 })), durationMs: 0, method: 'synthetic offline integration fixture', embeddingModel: 'synthetic', corpusVersion: corpus.version }; }
});
type Overview = ReturnType<AnswerRevisions['overview']>;
function databaseSnapshot(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' ORDER BY name").all() as { name: string; sql: string }[];
    return tables.map(table => ({ ...table, rows: db.prepare(`SELECT * FROM "${table.name.replaceAll('"', '""')}"`).all() }));
  } finally { db.close(); }
}
function receiptCount(directory: string) {
  const db = new DatabaseSync(join(directory, 'receipts.sqlite'), { readOnly: true });
  try { return (db.prepare('SELECT COUNT(*) AS n FROM synthetic_answer_receipts').get() as { n: number }).n; } finally { db.close(); }
}

async function boot(directory: string) {
  const demoAccess = new DemoAccess(config, { keyResolver: createLocalJWKSet({ keys: [{ ...await exportJWK((await keys).publicKey), kid: 'test-key', alg: 'RS256' }] }) });
  const provider = new SyntheticAnswerProvider(join(directory, 'receipts.sqlite'));
  const workspace = new ProductWorkspace(join(directory, 'workspace.sqlite'), provider, offlineRetriever);
  const reviewPath = join(directory, 'reviews.sqlite');
  const paidReview = new PaidAnswerReview(reviewPath);
  const store = new RunStore(join(directory, 'runs.sqlite'));
  const observations = { readiness: 0, snapshots: 0, answer: 0, revise: 0 };
  const readiness = provider.readiness.bind(provider), snapshots = workspace.reviewSnapshots.bind(workspace), answer = provider.answer.bind(provider), revise = provider.revise.bind(provider);
  provider.readiness = () => { observations.readiness++; return readiness(); };
  workspace.reviewSnapshots = () => { observations.snapshots++; return snapshots(); };
  provider.answer = async input => { observations.answer++; return answer(input); };
  provider.revise = async input => { observations.revise++; return revise(input); };
  const server = createApp(store, 'fixture', undefined, new PilotRunner(new PilotStore(':memory:')), undefined, undefined, workspace, paidReview, false, { answerProvider: provider, reviewDbPath: reviewPath, comparisonDbPath: join(directory, 'comparisons.sqlite'), demoAccess });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const tokens = { viewer: await assertion('viewer'), reviewer: await assertion('reviewer'), operator: await assertion('operator') };
  const send = (method: string, path: string, role: DemoRole | null, value?: unknown, headers: Record<string, string> = {}) => new Promise<{ status: number; value: any }>((resolve, reject) => {
    const body = value === undefined ? undefined : JSON.stringify(value);
    const req = httpRequest({ hostname: '127.0.0.1', port: address.port, method, path, headers: { host: 'demo.example.test', ...(role ? { 'cf-access-jwt-assertion': tokens[role] } : {}), ...(method !== 'GET' ? { origin: config.origin, 'content-type': 'application/json' } : {}), ...headers } }, res => {
      let output = ''; res.setEncoding('utf8'); res.on('data', chunk => { output += chunk; });
      res.on('end', () => { try { resolve({ status: res.statusCode ?? 0, value: JSON.parse(output) }); } catch (error) { reject(error); } });
    });
    req.setTimeout(10_000, () => req.destroy(new Error('Synthetic test HTTP request timed out.'))); req.on('error', reject); req.end(body);
  });
  return {
    observations, provider, send,
    async get(path: string, role: DemoRole = 'viewer') { const response = await send('GET', path, role); assert.equal(response.status, 200, JSON.stringify(response.value)); return response.value; },
    async post(path: string, value: unknown, role: DemoRole = 'operator', expected = 201) { const response = await send('POST', path, role, value); assert.equal(response.status, expected, JSON.stringify(response.value)); return response.value; },
    async close() { await server.shutdown(); store.close(); }
  };
}

test('hosted HTTP rejects unauthorized and forbidden work before initializing review workers or mutating stores', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-hosted-boundary-'));
  let outbound = 0;
  t.mock.method(globalThis, 'fetch', async () => { outbound++; throw new Error('No outbound calls are allowed in hosted synthetic tests.'); });
  const envNames = ['ABLATRIX_LOOP_LIVE', 'ABLATRIX_REVISION_WEB', 'ABLATRIX_LANGFUSE_ENABLED'] as const;
  const savedEnv = envNames.map(name => [name, process.env[name]] as const);
  for (const name of envNames) process.env[name] = '1';
  let app: Awaited<ReturnType<typeof boot>> | undefined;
  try {
    app = await boot(directory);
    const paths = ['runs.sqlite', 'workspace.sqlite', 'reviews.sqlite', 'receipts.sqlite'].map(name => join(directory, name));
    const before = paths.map(databaseSnapshot);
    for (const path of ['/api/workspace', '/api/workspace/reviews', '/api/session', '/api/health']) assert.equal((await app.send('GET', path, null)).status, 401);
    assert.equal((await app.send('GET', '/api/workspace/reviews', null, undefined, { 'cf-access-jwt-assertion': 'forged.assertion.signature', 'x-user': 'test-operator' })).status, 401);
    assert.equal((await app.send('POST', '/api/workspace/products', 'operator', {}, { origin: 'https://untrusted.example.test' })).status, 403);
    for (const role of ['viewer', 'reviewer'] as const) {
      for (const path of ['/api/workspace/products', '/api/workspace/questions', '/api/workspace/reviews/workspace-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/revisions', '/api/context-comparisons/fixture']) assert.equal((await app.send('POST', path, role, {})).status, 403);
    }
    assert.equal((await app.send('POST', '/api/workspace/reviews/workspace-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/decisions', 'viewer', {})).status, 403);
    assert.equal((await app.send('POST', '/api/workspace/questions', 'operator', { mode: 'live' })).status, 403, 'inherited live environment flags cannot enable hosted execution');
    for (const [method, path] of [['GET', '/api/loop'], ['GET', '/api/paid-review'], ['GET', '/api/not-configured'], ['POST', '/api/loop/runs'], ['POST', '/api/loop/telemetry/sync'], ['POST', '/api/pilot/runs'], ['POST', '/api/optimizations'], ['POST', '/api/experiments'], ['POST', '/api/context-comparisons']]) assert.equal((await app.send(method, path, 'operator', method === 'POST' ? {} : undefined)).status, 403);
    const session = await app.get('/api/session');
    assert.equal(session.actor.role, 'viewer'); assert.equal(session.actor.name, 'Configured viewer'); assert.match(session.actor.reviewer, /^subject:[a-f0-9]{64}$/);
    assert.equal(session.hosted, true); assert.equal(session.providerMode, 'synthetic');
    assert.deepEqual(app.observations, { readiness: 0, snapshots: 0, answer: 0, revise: 0 });
    assert.deepEqual(paths.map(databaseSnapshot), before, 'blocked requests must not initialize worker tables or save records');
    assert.equal(outbound, 0);
  } finally {
    await app?.close(); rmSync(directory, { recursive: true, force: true });
    for (const [name, value] of savedEnv) value === undefined ? delete process.env[name] : process.env[name] = value;
  }
});

test('hosted synthetic answer, authenticated correction and source-checked decision export identically after restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-hosted-roundtrip-'));
  let outbound = 0;
  t.mock.method(globalThis, 'fetch', async () => { outbound++; throw new Error('No outbound calls are allowed in hosted synthetic tests.'); });
  let app: Awaited<ReturnType<typeof boot>> | undefined;
  try {
    app = await boot(directory);
    const operator = (await app.get('/api/session', 'operator')).actor, reviewer = (await app.get('/api/session', 'reviewer')).actor;
    const product = await app.post('/api/workspace/products', { title: 'Synthetic example tool', sources: [{ label: 'Synthetic example manual', text: 'Synthetic example only: this tool has a handle made from oak wood.', originalQuestion: 'Which material is the example handle made from?' }] });
    const saved = await app.post('/api/workspace/questions', { productId: product.id, question: 'What is the handle made from?', mode: 'synthetic' });
    assert.equal(saved.status, 'completed'); assert.equal(saved.mode, 'synthetic'); assert.equal(saved.model, 'synthetic-fixture'); assert.equal(saved.usage, null); assert.match(saved.answer.answer, /^SYNTHETIC/);
    assert.equal(receiptCount(directory), 1);
    assert.equal((await app.get('/api/workspace')).runs[0].id, saved.id);
    const first: Overview = await app.get('/api/workspace/reviews');
    const item = first.cases[0], original = item.versions[0], path = `/api/workspace/reviews/${item.qid}`;
    assert.equal(item.mode, 'synthetic'); assert.equal(item.qualityClaimEligible, false); assert.equal(original.mode, 'synthetic');
    const request = { versionId: original.id, idempotencyKey: 'hosted-synthetic-correction-1', reviewer: 'FORGED OPERATOR NAME', feedback: 'Include the supplementary source and the saved original question context.', issue: 'answer_quality', investigate: false, additionalSources: [{ label: 'Synthetic supplementary note', text: 'Synthetic example only: the oak handle has a smooth natural wood finish.' }], clarification: 'Please preserve both synthetic source statements.' };
    await app.post(path + '/revisions', request, 'reviewer', 403);
    const job = await app.post(path + '/revisions', request, 'operator', 202);
    assert.equal(job.reviewer, operator.reviewer); assert.equal(job.mode, 'synthetic');
    assert.equal(job.context.sources.find((source: { origin: string }) => source.origin === 'reviewer_added').addedBy, operator.reviewer);
    assert.equal(job.context.clarifications[0].reviewer, operator.reviewer);
    assert.equal((await app.post(path + '/revisions', { ...request, reviewer: 'ANOTHER SPOOFED NAME' }, 'operator', 202)).id, job.id, 'caller reviewer text cannot alter idempotency identity');
    let complete: Overview = first;
    for (let attempt = 0; attempt < 80; attempt++) {
      complete = await app.get('/api/workspace/reviews');
      if (complete.cases[0].jobs[0].status === 'ready') break;
      await delay(100);
    }
    assert.equal(complete.cases[0].jobs[0].status, 'ready'); assert.equal(complete.cases[0].versions.length, 2);
    const revision = complete.cases[0].versions[1];
    assert.equal(revision.mode, 'synthetic'); assert.match(revision.answer.answer, /^SYNTHETIC revision/);
    assert.equal(complete.summary.providerCalls, 0); assert.equal(complete.summary.syntheticOperations, 1); assert.equal(complete.summary.actualProviderCharges, 'not_applicable_no_provider_calls');
    assert.equal(complete.cases[0].jobs[0].usage?.planningAllowanceUsd, null);
    const decision = { versionId: revision.id, reviewer: 'FORGED REVIEWER NAME', decision: 'accept', note: 'Personally checked the cited synthetic source text.', checkedSourceShas: [revision.context!.sources.find(source => revision.answer.citations.some(citation => citation.passageId === source.id))!.sha256] };
    await app.post(path + '/decisions', decision, 'viewer', 403);
    await app.post(path + '/decisions', { ...decision, checkedSourceShas: [] }, 'reviewer', 400);
    await app.post(path + '/decisions', { ...decision, checkedSourceShas: ['f'.repeat(64)] }, 'reviewer', 409);
    await app.post(path + '/decisions', { ...decision, versionId: original.id }, 'reviewer', 409);
    const event = await app.post(path + '/decisions', decision, 'reviewer');
    assert.equal(event.reviewer, reviewer.reviewer); assert.equal(event.mode, 'synthetic'); assert.equal(event.qualityClaimEligible, false);
    const exported = await app.get('/api/workspace/reviews/export');
    assert.equal(exported.providerMode, 'synthetic'); assert.equal(exported.cases.length, 1); assert.equal(exported.cases[0].jobs[0].status, 'accepted');
    assert.ok(exported.cases[0].events.every((entry: { qualityClaimEligible: boolean }) => entry.qualityClaimEligible === false));
    assert.ok(!JSON.stringify(exported).includes('FORGED'));
    assert.equal(receiptCount(directory), 2); assert.equal(app.observations.answer, 1); assert.equal(app.observations.revise, 1);
    await app.close(); app = undefined;
    app = await boot(directory);
    assert.deepEqual(await app.get('/api/workspace/reviews/export'), exported);
    assert.equal((await app.post(path + '/revisions', request, 'operator', 202)).id, job.id);
    await delay(1700);
    assert.deepEqual(await app.get('/api/workspace/reviews/export'), exported);
    assert.equal(receiptCount(directory), 2); assert.equal(app.observations.answer, 0); assert.equal(app.observations.revise, 0); assert.equal(outbound, 0);
  } finally { await app?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('hosted comparison reviews retain explicit source attestation and overwrite caller identity', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-hosted-comparison-'));
  let app: Awaited<ReturnType<typeof boot>> | undefined;
  try {
    app = await boot(directory);
    const reviewer = (await app.get('/api/session', 'reviewer')).actor;
    const saved = await app.post('/api/context-comparisons/fixture', {});
    const detail: ContextComparisonDetail = await app.get(`/api/context-comparisons/${saved.id}`);
    const item = detail.cases[0], answer = item.answers[0];
    const review = { manifestSha256: detail.manifestSha256, caseId: item.id, versionId: answer.versionId, reviewer: 'FORGED PERSON', correctness: 'uncertain', support: 'uncertain', adequacy: 'uncertain', checkedSourceShas: item.sources.map(source => source.sha256), note: 'Synthetic source inspection does not establish measured model quality.', referenceChecked: true };
    const path = `/api/context-comparisons/${saved.id}/reviews`;
    await app.post(path, review, 'viewer', 403);
    await app.post(path, { ...review, referenceChecked: false }, 'reviewer', 409);
    await app.post(path, { ...review, checkedSourceShas: [] }, 'reviewer', 409);
    const recorded = await app.post(path, review, 'reviewer');
    assert.equal(recorded.reviewer, reviewer.reviewer); assert.equal(recorded.kind, 'synthetic'); assert.equal(recorded.referenceChecked, true);
    assert.equal((await app.send('GET', `/api/context-comparisons/${saved.id}/export`, 'viewer')).status, 409, 'authentication does not bypass incomplete-review export gates');
    assert.equal(receiptCount(directory), 0);
  } finally { await app?.close(); rmSync(directory, { recursive: true, force: true }); }
});
