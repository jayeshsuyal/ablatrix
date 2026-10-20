/** Local metadata preview only. No environment, credentials, transport or provider. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildWorkspaceObservabilityPreview } from '../server/workspace-observability-v1.ts';
import type { WorkspaceProof } from '../server/workspace-proof.ts';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
export function workspaceObservabilityPreviewCli(argv: string[]) {
  if (!argv.length || argv.length === 1 && argv[0] === '--help') return {
    usage: '--preview --proof SAVED_PROOF_JSON --out NEW_ABSOLUTE_JSON',
    privacy: 'metadata_only', providerCalls: 0, externalRequests: 0, exported: false,
  };
  assert.equal(argv[0], '--preview', 'Only local preview is supported.');
  const flags = new Map<string, string>();
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i]!, value = argv[i + 1];
    assert.ok(['--proof', '--out'].includes(key) && value && !flags.has(key), 'Supply each preview argument exactly once.');
    flags.set(key, value);
  }
  assert.equal(flags.size, 2, 'Supply both --proof and --out.');
  const source = resolve(flags.get('--proof')!);
  assert.ok(lstatSync(source).isFile() && !lstatSync(source).isSymbolicLink() && realpathSync(source) === source, 'Use a canonical regular proof file.');
  assert.ok(lstatSync(source).size <= 50 * 1024 * 1024, 'Proof exceeds the local preview size limit.');
  const output = flags.get('--out')!;
  assert.equal(resolve(output), output, 'Use an absolute output path.');
  assert.ok(!existsSync(output) && realpathSync(dirname(output)) === dirname(output), 'Use a new file with a canonical existing parent.');
  const bytes = readFileSync(source, 'utf8'), document = JSON.parse(bytes);
  // This wrapper contains a separately labeled rewrite control. The preview
  // verifies only its workspace proof and makes no claim about that control.
  const wrapped = document.format === 'development-proof-rehearsal-v1';
  const preview = buildWorkspaceObservabilityPreview((wrapped ? document.proof : document) as WorkspaceProof);
  const saved = { ...preview, sourceInputFileSha256: sha(bytes), inputKind: wrapped ? 'development_wrapper_workspace_proof_only' : 'workspace_proof' };
  writeFileSync(output, JSON.stringify(saved, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { output, sourceProofSha256: preview.sourceProofSha256, sourceInputFileSha256: saved.sourceInputFileSha256,
    privacy: preview.privacy, providerCalls: 0, externalRequests: 0, exported: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(workspaceObservabilityPreviewCli(process.argv.slice(2)), null, 2)); }
  catch { console.error('Preview stopped: invalid arguments, proof or output path. No telemetry was sent.'); process.exitCode = 1; }
}
