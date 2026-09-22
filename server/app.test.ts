import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.ts';
import { RunStore } from './store.ts';

test('baseline request persists a fixture result and survives reopening', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-'));
  const path = join(directory, 'runs.sqlite');
  const store = new RunStore(path);
  const app = createApp(store, 'fixture');
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
  try {
    const address = app.address();
    assert(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const invalid = await fetch(`${base}/api/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entity: 'X', question: 'short' })
    });
    assert.equal(invalid.status, 400);
    const response = await fetch(`${base}/api/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entity: 'Example Company', question: 'What does it make?', taskId: 'sample-1' })
    });
    assert.equal(response.status, 201);
    const run = await response.json();
    assert.equal(run.mode, 'fixture');
    assert.equal(run.taskId, 'sample-1');
    assert.equal(run.costStatus, 'fixture');
    assert.match(run.output.answer, /synthetic/i);
    assert.equal(run.output.sources.length, 1);
    store.close();
    const reopened = new RunStore(path);
    assert.equal(reopened.get(run.id)?.output?.answer, run.output.answer);
    reopened.close();
  } finally {
    await new Promise<void>(resolve => app.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
