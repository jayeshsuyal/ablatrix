import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createApp } from './app.ts';
import { RunStore } from './store.ts';

test('live gates, invalid input, and static routing do not disclose credentials', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-security-'));
  const store = new RunStore(join(directory, 'runs.sqlite'));
  const app = createApp(store, 'live');
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
  try {
    const address = app.address();
    assert(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const direct = await fetch(`${base}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(direct.status, 403);
    const badJson = await fetch(`${base}/api/experiments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    assert.equal(badJson.status, 400);
    assert.equal((await badJson.json()).error, 'Invalid JSON body.');
    const tooLarge = await fetch(`${base}/api/experiments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(17_000) });
    assert.equal(tooLarge.status, 413);
    const crossOrigin = await fetch(`${base}/api/experiments`, { method: 'POST', headers: { origin: 'https://malicious.example', 'content-type': 'text/plain' }, body: JSON.stringify({ taskIds: ['github-platform-v1'] }) });
    assert.equal(crossOrigin.status, 403);
    const wrongHostStatus = await new Promise<number>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: address.port, path: '/api/health', headers: { host: 'malicious.example' } }, response => { response.resume(); resolve(response.statusCode ?? 0); });
      req.on('error', reject); req.end();
    });
    assert.equal(wrongHostStatus, 403);
    const traversal = await fetch(`${base}/%2e%2e/.env`);
    const text = await traversal.text();
    assert(!text.includes('SAPIOM_API_KEY='));
    const tasks = await fetch(`${base}/api/tasks`);
    assert(!JSON.stringify(await tasks.json()).includes('mozilla'));
  } finally {
    await new Promise<void>(resolve => app.close(() => resolve()));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
