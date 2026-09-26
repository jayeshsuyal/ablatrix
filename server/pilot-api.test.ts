import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from './app.ts';
import { RunStore } from './store.ts';
import { PilotRunner, PilotStore } from './pilot.ts';

test('pilot API keeps live blocked, serves persisted synthetic results, and exports frozen evidence', async () => {
  const store = new RunStore(':memory:'), pilot = new PilotRunner(new PilotStore());
  const server = createApp(store, 'fixture', undefined, pilot);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const overview = await (await fetch(`${base}/api/pilot`)).json();
    assert.equal(overview.readiness.ready, false); assert.equal(overview.protocol.measuredRuns, 32);
    assert.equal(JSON.stringify(overview).includes('expectedAnswer'), false);
    const blocked = await fetch(`${base}/api/pilot/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'live' }) });
    assert.equal(blocked.status, 409);
    const crossOrigin = await fetch(`${base}/api/pilot/runs`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.com' }, body: JSON.stringify({ mode: 'fixture' }) });
    assert.equal(crossOrigin.status, 403);
    const response = await fetch(`${base}/api/pilot/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'fixture' }) });
    assert.equal(response.status, 201); const { id } = await response.json(); await pilot.wait(id);
    const result = await (await fetch(`${base}/api/pilot/runs/${id}`)).json();
    assert.equal(result.completedRuns, 32); assert.equal(result.decision, 'inconclusive');
    const download = await fetch(`${base}/api/pilot/runs/${id}/export`);
    assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition') ?? '', /attachment/);
    const artifact = await download.json();
    assert.equal(artifact.suite.tasks.length, 12); assert.equal(artifact.attempts.length, 32);
    assert.equal(artifact.summary.baseline.costUsd, null); assert.equal(artifact.mode, 'fixture');
    const reviews = await (await fetch(`${base}/api/pilot/runs/${id}/review`)).json();
    assert.ok(reviews.cards.every((card: object) => !('arm' in card)));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); }
});
