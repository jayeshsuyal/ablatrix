import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from './app.ts';
import { RunStore } from './store.ts';
import { PilotRunner, PilotStore } from './pilot.ts';
import { createContextComparisonFixture } from './context-comparison.ts';

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
