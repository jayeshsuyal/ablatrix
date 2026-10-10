import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostedDemo, prepareDemoData } from './hosted-demo.ts';

test('a hosted data root has immutable synthetic identity and cannot adopt a local ledger', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-hosted-root-')));
  try {
    const fresh = join(root, 'fresh');
    prepareDemoData(fresh);
    assert.deepEqual(JSON.parse(readFileSync(join(fresh, 'demo.json'), 'utf8')), { schema: 1, providerMode: 'synthetic', scope: 'invited-shared-demo' });
    writeFileSync(join(fresh, 'product-workspace.sqlite'), 'saved fixture');
    assert.equal(prepareDemoData(fresh), fresh);
    writeFileSync(join(fresh, 'demo.json'), JSON.stringify({ schema: 1, providerMode: 'live' }));
    assert.throws(() => prepareDemoData(fresh), /identity differs/);
    const old = join(root, 'old');
    prepareDemoData(old);
    rmSync(join(old, 'demo.json'));
    writeFileSync(join(old, 'product-workspace.sqlite'), 'local data');
    assert.throws(() => prepareDemoData(old), /empty directory/);
    assert.equal(readFileSync(join(old, 'product-workspace.sqlite'), 'utf8'), 'local data');
    assert.throws(() => prepareDemoData('.data'), /absolute path/);
    assert.throws(() => prepareDemoData('/'), /dedicated absolute/);
    const linked = join(root, 'linked');
    symlinkSync(old, linked);
    assert.throws(() => prepareDemoData(linked), /symlinks/);
    const clean = join(root, 'clean');
    prepareDemoData(clean);
    symlinkSync(join(old, 'product-workspace.sqlite'), join(clean, 'product-workspace.sqlite'));
    assert.throws(() => prepareDemoData(clean), /symlinks/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('hosted startup fails closed before creating any stores without complete identity and runtime configuration', () => {
  assert.throws(() => createHostedDemo({ ABLATRIX_HOSTED_DEMO: '1' }), /complete access configuration/);
  assert.throws(() => createHostedDemo({
    ABLATRIX_DEMO_ORIGIN: 'https://demo.example.test', ABLATRIX_DEMO_ISSUER: 'https://identity.example.test',
    ABLATRIX_DEMO_JWKS_URL: 'https://identity.example.test/certs', ABLATRIX_DEMO_AUDIENCE: 'test',
    ABLATRIX_DEMO_MEMBERS: JSON.stringify([{ subject: 'operator', role: 'operator', name: 'Operator' }])
  }), /runtime|lock|entrypoint/);
});
