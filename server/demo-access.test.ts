import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { DemoAccess, DemoAccessError, loadDemoAccessConfig, parseDemoAccessConfig, type DemoAccessConfig, type DemoActor } from './demo-access.ts';

const config: DemoAccessConfig = {
  origin: 'https://demo.example.test', issuer: 'https://identity.example.test', audience: 'ablatrix-demo', jwksUrl: 'https://identity.example.test/cdn-cgi/access/certs',
  members: [{ subject: 'person-viewer', role: 'viewer', name: 'Viewer' }, { subject: 'person-reviewer', role: 'reviewer', name: 'Reviewer' }, { subject: 'person-operator', role: 'operator', name: 'Operator' }]
};
const keys = generateKeyPair('RS256');
async function access() {
  const { publicKey } = await keys;
  return new DemoAccess(config, { keyResolver: createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256' }] }) });
}
async function token(claims: JWTPayload = {}, missing: string[] = []) {
  const now = Math.floor(Date.now() / 1000);
  const payload: JWTPayload = { iss: config.issuer, aud: config.audience, sub: 'person-viewer', iat: now, exp: now + 300, ...claims };
  for (const name of missing) delete payload[name];
  return new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign((await keys).privateKey);
}
function request(assertion?: string, method = 'GET', headers: Record<string, string | string[] | undefined> = {}): IncomingMessage {
  return { method, headers: { host: 'demo.example.test', ...(assertion ? { 'cf-access-jwt-assertion': assertion } : {}), ...(method === 'POST' ? { origin: config.origin, 'content-type': 'application/json' } : {}), ...headers }, rawHeaders: [] } as unknown as IncomingMessage;
}
function status(code: number) { return (error: unknown) => error instanceof DemoAccessError && error.status === code; }
const qid = 'workspace-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('hosted configuration requires complete HTTPS authority and unique configured subjects', () => {
  assert.equal(loadDemoAccessConfig({}), undefined);
  assert.deepEqual(parseDemoAccessConfig(config), config);
  assert.deepEqual(loadDemoAccessConfig({ ABLATRIX_DEMO_ORIGIN: config.origin, ABLATRIX_DEMO_ISSUER: config.issuer, ABLATRIX_DEMO_AUDIENCE: config.audience, ABLATRIX_DEMO_JWKS_URL: config.jwksUrl, ABLATRIX_DEMO_MEMBERS: JSON.stringify(config.members) }), config);
  for (const invalid of [
    { ...config, origin: 'http://demo.example.test' }, { ...config, origin: `${config.origin}/ask` }, { ...config, origin: `${config.origin}/` },
    { ...config, issuer: 'http://identity.example.test' }, { ...config, jwksUrl: 'https://user:password@identity.example.test/certs' },
    { ...config, jwksUrl: `${config.jwksUrl}#other` }, { ...config, members: [config.members[0], config.members[0]] },
    { ...config, members: [{ ...config.members[0], role: 'admin' }] }, { ...config, secret: 'unrecognized' }
  ]) assert.throws(() => parseDemoAccessConfig(invalid), status(500));
  assert.throws(() => loadDemoAccessConfig({ ABLATRIX_DEMO_ORIGIN: config.origin }), status(500));
  assert.throws(() => loadDemoAccessConfig({ ABLATRIX_DEMO_ACCESS_CONFIG: 'missing', ABLATRIX_DEMO_ORIGIN: config.origin }), status(500));
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-demo-access-'));
  try {
    const path = join(directory, 'access.json');
    writeFileSync(path, JSON.stringify(config));
    assert.deepEqual(loadDemoAccessConfig({ ABLATRIX_DEMO_ACCESS_CONFIG: path }), config);
    writeFileSync(path, '{malformed');
    assert.throws(() => loadDemoAccessConfig({ ABLATRIX_DEMO_ACCESS_CONFIG: path }), status(500));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('real signed identities receive only configured roles and a stable bounded reviewer identity', async () => {
  const boundary = await access();
  const actor = await boundary.authenticate(request(await token({ role: 'operator', email: 'admin@example.test', name: 'Administrator' })));
  assert.equal(actor.role, 'viewer'); assert.equal(actor.name, 'Viewer'); assert.equal(actor.subject, 'person-viewer');
  assert.match(actor.reviewer, /^subject:[a-f0-9]{64}$/); assert.ok(actor.reviewer.length <= 100);
  assert.deepEqual(await (await access()).authenticate(request(await token())), actor);
  const different = await boundary.authenticate(request(await token({ sub: 'person-reviewer' })));
  assert.notEqual(different.reviewer, actor.reviewer);
  assert.throws(() => boundary.authorize({ ...actor, role: 'operator' }, 'POST', '/api/workspace/questions'), status(403));
  assert.throws(() => boundary.authorize({ ...actor, reviewer: 'Administrator' }, 'GET', '/api/workspace'), status(403));
  await assert.rejects(boundary.authenticate(request(await token({ sub: 'unlisted-person', role: 'operator' }))), status(403));
});

test('missing, tampered, wrongly signed and wrong algorithm assertions fail closed', async () => {
  const boundary = await access();
  await assert.rejects(boundary.authenticate(request(undefined, 'GET', { authorization: `Bearer ${await token()}`, 'x-user': 'person-operator' })), status(401));
  const valid = await token();
  const pieces = valid.split('.'); pieces[1] = Buffer.from(JSON.stringify({ sub: 'person-operator' })).toString('base64url');
  await assert.rejects(boundary.authenticate(request(pieces.join('.'))), status(401));
  const otherKeys = await generateKeyPair('RS256');
  const forged = await new SignJWT({ iss: config.issuer, aud: config.audience, sub: 'person-viewer' }).setIssuedAt().setExpirationTime('5m').setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(otherKeys.privateKey);
  await assert.rejects(boundary.authenticate(request(forged)), status(401));
  const hmac = await new SignJWT({ iss: config.issuer, aud: config.audience, sub: 'person-viewer' }).setIssuedAt().setExpirationTime('5m').setProtectedHeader({ alg: 'HS256', kid: 'test-key' }).sign(new Uint8Array(32));
  await assert.rejects(boundary.authenticate(request(hmac)), status(401));
  await assert.rejects(boundary.authenticate(request('a'.repeat(16_385))), status(401));
  await assert.rejects(boundary.authenticate(request(valid, 'GET', { 'cf-access-jwt-assertion': [valid, valid] })), status(401));
  const duplicate = request(valid); duplicate.rawHeaders = ['Cf-Access-Jwt-Assertion', valid, 'cf-access-jwt-assertion', valid];
  await assert.rejects(boundary.authenticate(duplicate), status(401));
});

test('issuer, audience, subject and time claims are mandatory and verified', async () => {
  const boundary = await access();
  const now = Math.floor(Date.now() / 1000);
  for (const claims of [{ iss: 'https://other.example.test' }, { aud: 'other-app' }, { exp: now - 1 }, { nbf: now + 600 }, { iat: now + 600 }, { sub: '' }]) {
    await assert.rejects(boundary.authenticate(request(await token(claims))), status(401));
  }
  for (const missing of ['iss', 'aud', 'sub', 'exp', 'iat']) await assert.rejects(boundary.authenticate(request(await token({}, [missing]))), status(401));
});

test('the public Host and modifying Origin are exact, with no forwarded-header authority', async () => {
  const boundary = await access(), assertion = await token();
  for (const host of ['localhost:4173', 'attacker.example.test', 'demo.example.test.attacker.test', 'demo.example.test:443']) {
    await assert.rejects(boundary.authenticate(request(assertion, 'GET', { host, 'x-forwarded-host': 'demo.example.test', 'x-forwarded-proto': 'https' })), status(403));
  }
  assert.equal((await boundary.authenticate(request(assertion, 'GET', { 'x-forwarded-host': 'attacker.example.test' }))).role, 'viewer');
  for (const origin of [undefined, 'http://demo.example.test', 'https://attacker.example.test', `${config.origin}/`, 'null']) {
    await assert.rejects(boundary.authenticate(request(assertion, 'POST', { origin })), status(403));
  }
  for (const contentType of [undefined, 'text/plain', 'application/jsonp']) {
    await assert.rejects(boundary.authenticate(request(assertion, 'POST', { 'content-type': contentType })), status(415));
  }
  assert.equal((await boundary.authenticate(request(assertion, 'POST', { 'content-type': 'application/json; charset=utf-8' }))).role, 'viewer');
  const duplicate = request(assertion); duplicate.rawHeaders = ['Host', 'demo.example.test', 'Host', 'attacker.example.test'];
  await assert.rejects(boundary.authenticate(duplicate), status(403));
});

test('every role can inspect the narrow demo surface; legacy APIs and path tricks stay blocked', async () => {
  const boundary = await access();
  const readPaths = ['/api/session', '/api/health', '/api/workspace', '/api/workspace/reviews', '/api/workspace/reviews/export', '/api/context-comparisons', '/api/context-comparisons/example_1', '/api/context-comparisons/example_1/report', '/api/context-comparisons/example_1/export', '/', '/ask', '/review', '/compare', '/assets/index-abc123.js', '/assets/index-abc123.css', '/favicon.ico'];
  const forbidden = ['/api/loop', '/api/paid-review', '/api/pilot', '/api/runs', '/api/experiments', '/api/optimizations', '/api/live-readiness', '/api/context-comparisons/example/reviews', '/api/context-comparisons/example/export/extra', '/assets/../server/index.ts', '/assets/index.js.map', '/.env', '/review/extra', '//ask', '/api/workspace?mode=live'];
  for (const member of config.members) {
    const actor = await boundary.authenticate(request(await token({ sub: member.subject })));
    for (const path of readPaths) assert.doesNotThrow(() => boundary.authorize(actor, 'GET', path));
    for (const path of forbidden) assert.throws(() => boundary.authorize(actor, 'GET', path), status(403), `${member.role} ${path}`);
    for (const method of ['PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']) assert.throws(() => boundary.authorize(actor, method, '/api/workspace'), status(403));
  }
});

test('reviewers can judge; only operators can enqueue or create; all legacy paid routes stay blocked', async () => {
  const boundary = await access();
  // Build each request from a signed token rather than trusting a caller-supplied actor.
  const verified: DemoActor[] = [];
  for (const member of config.members) verified.push(await boundary.authenticate(request(await token({ sub: member.subject }))));
  const judgments = [`/api/workspace/reviews/${qid}/decisions`, '/api/context-comparisons/example/reviews'];
  const operatorActions = ['/api/workspace/products', '/api/workspace/questions', `/api/workspace/reviews/${qid}/revisions`, '/api/context-comparisons/fixture'];
  const forbidden = ['/api/loop/runs', '/api/loop/batches', '/api/loop/final', '/api/loop/proposals', '/api/loop/policies/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/validate', '/api/loop/telemetry/sync', '/api/pilot/runs', '/api/experiments', '/api/optimizations', '/api/context-comparisons', '/api/paid-review/19/revisions'];
  for (const actor of verified) {
    for (const path of judgments) actor.role === 'viewer' ? assert.throws(() => boundary.authorize(actor, 'POST', path), status(403)) : assert.doesNotThrow(() => boundary.authorize(actor, 'POST', path));
    for (const path of operatorActions) actor.role === 'operator' ? assert.doesNotThrow(() => boundary.authorize(actor, 'POST', path)) : assert.throws(() => boundary.authorize(actor, 'POST', path), status(403));
    for (const path of forbidden) assert.throws(() => boundary.authorize(actor, 'POST', path), status(403));
  }
});
