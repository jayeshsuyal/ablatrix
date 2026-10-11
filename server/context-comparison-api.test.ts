import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.ts';
import { RunStore } from './store.ts';
import { PilotRunner, PilotStore } from './pilot.ts';
import { ContextComparisonStore, createContextComparisonFixture, createCorrectionComparisonFixture, correctionComparisonProtocol, correctionComparisonInput, correctionComparisonRequestHash, contextComparisonHash } from './context-comparison.ts';

test('comparison HTTP boundary preserves blind review and only permits the no-call fixture setup', async () => {
  const runs = new RunStore(':memory:');
  const server = createApp(runs, 'fixture', undefined, new PilotRunner(new PilotStore(':memory:')), undefined, undefined, undefined, undefined, false, { comparisonDbPath: ':memory:' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, input: unknown, origin = base) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(input) });
  try {
    assert.deepEqual(await (await fetch(base + '/api/context-comparisons')).json(), { comparisons: [] });
    assert.equal((await post('/api/context-comparisons/fixture', {}, 'https://untrusted.example')).status, 403);
    assert.equal((await post('/api/context-comparisons/fixture', { mode: 'live' })).status, 400);
    assert.equal((await post('/api/context-comparisons', createContextComparisonFixture())).status, 404, 'arbitrary packet imports are CLI-only');
    const setup = await post('/api/context-comparisons/fixture', {});
    assert.equal(setup.status, 201);
    const saved = await setup.json();
    assert.ok(saved.id);
    const replay = await post('/api/context-comparisons/fixture', {});
    assert.equal(replay.status, 201);
    assert.equal((await replay.json()).id, saved.id);
    const listing = await (await fetch(base + '/api/context-comparisons')).json();
    assert.equal(listing.comparisons.length, 1);
    const detailResponse = await fetch(`${base}/api/context-comparisons/${saved.id}`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    const forbiddenKeys = new Set(['arm', 'arms', 'baseline', 'candidate', 'model', 'usage', 'durationMs', 'attemptId', 'blindSecret']);
    function checkBlind(value: unknown): void {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        assert.equal(forbiddenKeys.has(key), false, `pre-review API exposed ${key}`);
        checkBlind(child);
      }
    }
    checkBlind(listing); checkBlind(detail);
    assert.equal((await fetch(`${base}/api/context-comparisons/${saved.id}/report`)).status, 409);
    assert.equal((await fetch(`${base}/api/context-comparisons/${saved.id}/export`)).status, 409);
    assert.equal((await post(`/api/context-comparisons/${saved.id}/reviews`, { kind: 'human', reviewer: 'spoofed' })).status, 409);
    assert.equal((await fetch(`${base}/api/context-comparisons/not-present`)).status, 404);
    assert.equal((await fetch(base + '/api/health')).status, 200);
  } finally {
    server.closeAllConnections(); server.close(); await once(server, 'close'); runs.close();
  }
});

for (const citationInterface of ['passage_quotes', 'source_ids_v1', 'source_ids_v2', 'source_ids_v3'] as const) test(`tagged ${citationInterface} correction packets reuse blind HTTP review without exposing AI critique or prompt identities`, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'correction-comparison-api-')), path = join(directory, 'comparisons.sqlite');
  const packet = createCorrectionComparisonFixture(), imported = new ContextComparisonStore(path);
  packet.protocol = correctionComparisonProtocol('synthetic-model', null, citationInterface);
  for (const item of packet.cases) for (const arm of ['baseline', 'candidate'] as const) {
    item.arms[arm].inputSha256 = contextComparisonHash(correctionComparisonInput(packet.protocol, item, arm));
    item.arms[arm].requestSha256 = correctionComparisonRequestHash(packet.protocol, item, arm, item.arms[arm].id);
  }
  imported.importPacket(packet); imported.close();
  const runs = new RunStore(':memory:');
  const server = createApp(runs, 'fixture', undefined, new PilotRunner(new PilotStore(':memory:')), undefined, undefined, undefined, undefined, false, { comparisonDbPath: path });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`, route = `/api/context-comparisons/${packet.id}`;
  try {
    const detail = await (await fetch(base + route)).json();
    assert.equal(detail.format, 'ablatrix-correction-comparison-v1');
    assert.equal(detail.hypothesis, 'compare_correction_policy');
    assert.doesNotMatch(JSON.stringify(detail), /"(?:original|critique|protocol|policies|requestSha256|inputSha256|providerCallId|generationSourceIds|investigation|quoteOptions|citationInterface)"/);
    assert.equal((await fetch(base + route + '/export')).status, 409);
    for (const answer of detail.cases[0].answers) {
      const response = await fetch(base + route + '/reviews', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ manifestSha256: detail.manifestSha256, caseId: detail.cases[0].id, versionId: answer.versionId, reviewer: 'Synthetic API reviewer', correctness: 'correct', support: 'supported', adequacy: 'adequate', checkedSourceShas: detail.cases[0].sources.map((source: { sha256: string }) => source.sha256), referenceChecked: true, note: '' }) });
      assert.equal(response.status, 201); assert.equal((await response.json()).kind, 'synthetic');
    }
    const exported = await (await fetch(base + route + '/export')).json();
    assert.equal(exported.format, 'ablatrix-correction-comparison-evidence-v1');
    assert.equal(exported.report.qualityClaimEligible, false); assert.equal(exported.report.quality, null);
    assert.deepEqual(exported.packet, packet);
    assert.equal(exported.report.cases[0].critique.kind, 'ai_assisted');
    assert.equal(exported.report.protocol.policies.candidate.policy, 'candidate_v4');
    assert.equal(exported.report.protocol.citationInterface, citationInterface);
  } finally { await server.shutdown(); runs.close(); rmSync(directory, { recursive: true, force: true }); }
});
