/** Synthetic/public fixture tests. No server, provider or telemetry connection. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { workspaceObservabilityPreviewCli } from '../scripts/workspace-observability-preview-v1.ts';

const fixture = resolve('docs/evidence/workflow-engineering-2026-10-17/development-proof-v1.json');
test('preview help and invalid modes cannot read input, connect or dispatch', () => {
  assert.equal(workspaceObservabilityPreviewCli([]).exported, false);
  assert.equal(workspaceObservabilityPreviewCli(['--help']).externalRequests, 0);
  for (const args of [['--sync'], ['--preview', '--proof', '/MISSING'], ['--preview', '--proof', '/MISSING', '--proof', '/OTHER']]) {
    assert.throws(() => workspaceObservabilityPreviewCli(args));
  }
});
test('local preview verifies only the wrapped workspace proof and never sends telemetry', () => {
  const directory = realpathSync(mkdtempSync(resolve(tmpdir(), 'ablatrix-observability-cli-'))), oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('No network in preview'); };
  try {
    const output = resolve(directory, 'preview.json');
    const result = workspaceObservabilityPreviewCli(['--preview', '--proof', fixture, '--out', output]);
    assert.equal(result.externalRequests, 0); assert.equal(result.providerCalls, 0); assert.equal(result.exported, false);
    const saved = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(saved.format, 'ablatrix-workspace-observability-preview-v1'); assert.equal(saved.inputKind, 'development_wrapper_workspace_proof_only');
    assert.equal(saved.privacy, 'metadata_only'); assert.match(saved.sourceInputFileSha256, /^[a-f0-9]{64}$/);
    assert.ok(saved.otlp.resourceSpans[0].scopeSpans[0].spans.length > 0);
  } finally { globalThis.fetch = oldFetch; rmSync(directory, { recursive: true, force: true }); }
});
test('a tampered proof cannot produce a preview; existing output and symlinks are rejected', () => {
  const directory = realpathSync(mkdtempSync(resolve(tmpdir(), 'ablatrix-observability-invalid-')));
  try {
    const output = resolve(directory, 'preview.json'), input = resolve(directory, 'proof.json');
    const packet = JSON.parse(readFileSync(fixture, 'utf8')); packet.proof.paired.wins += 1;
    writeFileSync(input, JSON.stringify(packet));
    assert.throws(() => workspaceObservabilityPreviewCli(['--preview', '--proof', input, '--out', output])); assert.equal(existsSync(output), false);
    writeFileSync(output, 'preserved');
    assert.throws(() => workspaceObservabilityPreviewCli(['--preview', '--proof', fixture, '--out', output])); assert.equal(readFileSync(output, 'utf8'), 'preserved');
    const link = resolve(directory, 'linked.json'); symlinkSync(fixture, link);
    assert.throws(() => workspaceObservabilityPreviewCli(['--preview', '--proof', link, '--out', resolve(directory, 'new.json')]));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
