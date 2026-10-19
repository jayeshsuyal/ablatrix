import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syntheticPreparation } from '../scripts/three-context-mock.ts';
import { executeThreeContext, type DiagnosticCheckpoint } from './three-context-diagnostic.ts';
import { SapiomFeedbackProvider } from './feedback-provider.ts';
import { readSourceCalibrationLedgerState } from './source-calibration-comparison.ts';
import { THREE_CONTEXT_LIVE_FILES, requiredThreeContextLiveFiles, prepareThreeContextLive, checkThreeContextLiveFiles, privateThreeContextOutput,
  threeContextLiveCli, threeContextLiveResult, verifyThreeContextLiveCheckpoints, type ThreeContextLiveManifest, type ThreeContextLivePreparation } from './three-context-live.ts';
import { reconcileThreeContextLiveLedger } from './three-context-live.ts';
const encode = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
function fixture(repository?: string) {
  const root = repository ?? realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-three-context-files-SYNTHETIC-')));
  mkdirSync(join(root, '.data'), { recursive: true });
  const directory = realpathSync(mkdtempSync(join(root, '.data/three-context-SYNTHETIC-')));
  const write = (path: string, content: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
  if (!repository) for (const path of THREE_CONTEXT_LIVE_FILES) write(path, path.endsWith('.ts') ? '// SYNTHETIC byte binding fixture\n' : '{}\n');
  const relativeDirectory = relative(root, directory), artifact = `${relativeDirectory}/source.json`; write(artifact, '{"provenance":"SYNTHETIC"}\n');
  const diagnostic = syntheticPreparation(); diagnostic.codeReviewPassed = false;
  diagnostic.implementationSha256 = Object.fromEntries(requiredThreeContextLiveFiles(root).map(path => [path, hash(readFileSync(join(root, path)))]));
  diagnostic.artifactSha256 = { [artifact]: hash(readFileSync(join(root, artifact))) };
  const input = join(root, '.data', `${directory.split('/').at(-1)}-preparation.json`), outputDirectory = join(root, '.data', `${directory.split('/').at(-1)}-execution`);
  const preparation: ThreeContextLivePreparation = { repositoryPath: root, outputDirectory, diagnostic }; writeFileSync(input, encode(preparation));
  const manifest = prepareThreeContextLive(preparation, input);
  return { root, directory, input, preparation, manifest, artifact, write, cleanup() { rmSync(directory, { recursive: true, force: true }); rmSync(input, { force: true }); rmSync(outputDirectory, { recursive: true, force: true }); if (!repository) rmSync(root, { recursive: true, force: true }); } };
}
test('live preparation binds literal input bytes, complete execution imports and regular canonical files', () => {
  const f = fixture();
  try {
    assert.equal(f.manifest.diagnostic.document.paidPlan, null); checkThreeContextLiveFiles(f.manifest);
    writeFileSync(join(f.root, f.artifact), '{ "provenance":"SYNTHETIC" }\n'); assert.throws(() => checkThreeContextLiveFiles(f.manifest), /Frozen bytes changed/);
    f.write(f.artifact, '{"provenance":"SYNTHETIC"}\n');
    writeFileSync(f.input, JSON.stringify(f.preparation)); assert.throws(() => checkThreeContextLiveFiles(f.manifest)); writeFileSync(f.input, encode(f.preparation));
    f.write('server/extra-boundary.ts', '// SYNTHETIC imported helper\n'); f.write('server/three-context-live.ts', "import './extra-boundary.ts';\n");
    assert.ok(requiredThreeContextLiveFiles(f.root).includes('server/extra-boundary.ts')); assert.throws(() => prepareThreeContextLive(f.preparation, f.input), /Missing frozen execution dependency/);
  } finally { f.cleanup(); }
});
test('symlinked inputs and outputs cannot escape the canonical repository', () => {
  const f = fixture();
  try {
    const external = join(f.directory, 'external.json'); writeFileSync(external, 'SYNTHETIC'); rmSync(join(f.root, f.artifact)); symlinkSync(external, join(f.root, f.artifact));
    assert.throws(() => checkThreeContextLiveFiles(f.manifest), /canonical regular files/);
    const linked = join(f.root, '.data', 'linked'); symlinkSync(f.directory, linked); assert.throws(() => privateThreeContextOutput(join(linked, 'run'), f.root));
  } finally { unlinkSync(join(f.root, '.data', 'linked')); f.cleanup(); }
});
test('private execution journal is durable, append-only, exclusive and stores only anonymous review content publicly', async () => {
  const f = fixture();
  try {
    const h = await runMock(f); const output = h.output;
    const log = readFileSync(join(f.preparation.outputDirectory, 'checkpoint.jsonl'), 'utf8'); assert.equal(log.trimEnd().split('\n').length, h.checkpoints.length); assert.ok(log.endsWith('\n'));
    assert.equal(statSync(f.preparation.outputDirectory).mode & 0o777, 0o700); assert.equal(statSync(join(f.preparation.outputDirectory, 'checkpoint.jsonl')).mode & 0o777, 0o600);
    const review = JSON.parse(readFileSync(join(f.preparation.outputDirectory, 'review.json'), 'utf8')), mapping = JSON.parse(readFileSync(join(f.preparation.outputDirectory, 'arm-mapping.json'), 'utf8'));
    assert.equal(review.answers.length, 3); assert.equal(mapping.length, 3); assert.ok(!JSON.stringify(review).includes('operationRunId'));
    assert.equal(statSync(join(f.preparation.outputDirectory, 'review.json')).mode & 0o777, 0o600); assert.equal(statSync(join(f.preparation.outputDirectory, 'arm-mapping.json')).mode & 0o777, 0o600);
    assert.throws(() => output.finish(h.manifest, h.checkpoint), /EEXIST/);
    assert.throws(() => privateThreeContextOutput(f.preparation.outputDirectory, f.root).create(), /overwritten or resumed/);
  } finally { f.cleanup(); }
});
async function runMock(f: ReturnType<typeof fixture>, options: { failureAt?: number; invalidCitation?: boolean; modelDrift?: boolean; unknownUsage?: boolean; constructorFailure?: boolean; ownerDrift?: boolean } = {}) {
  f.preparation.diagnostic.codeReviewPassed = true; writeFileSync(f.input, encode(f.preparation)); const manifest = prepareThreeContextLive(f.preparation, f.input), checkpoints: DiagnosticCheckpoint[] = [];
  const path = join(f.directory, 'mock-ledger.sqlite'), initialize = new SapiomFeedbackProvider({ enabled: true, apiKey: 'SYNTHETIC-test-only', credentialsFile: '', dbPath: path, priorSpendUsd: .200281, capUsd: 20, callLimit: 3 }); initialize.close();
  let calls = 0, closed = false, reservedInspections = 0; const output = privateThreeContextOutput(f.preparation.outputDirectory, f.root);
  const executed = await executeThreeContext(manifest.diagnostic, { execute: true, liveOptIn: true, approvedSha256: manifest.diagnostic.sha256, provenance: 'mocked_mechanics_only' }, {
    create: output.create, checkpoint(value) { checkpoints.push(structuredClone(value)); output.checkpoint(value); },
    checkBindings() { checkThreeContextLiveFiles(manifest); return { implementationSha256: manifest.preparation.diagnostic.implementationSha256, artifactSha256: manifest.preparation.diagnostic.artifactSha256 }; },
    checkLedger() { const state = readSourceCalibrationLedgerState(path, .200281, manifest.diagnostic.document.slots.map(s => s.input.runId)); if (options.ownerDrift && state.rows.length && ++reservedInspections > 1) state.ownerRows[0]!.token = 'SYNTHETIC-replaced-owner'; return { ...state, canonicalPath: f.preparation.diagnostic.ledger.canonicalPath, historicalRowsSha256: f.preparation.diagnostic.ledger.historicalRowsSha256, attempts: 138 + state.attempts, reservedUsd: 13.8 + state.reservedUsd }; },
    createProvider(hooks) {
      if (options.constructorFailure) throw new Error('SYNTHETIC constructor failure');
      const provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'SYNTHETIC-test-only', credentialsFile: '', dbPath: path, priorSpendUsd: .200281, capUsd: 20, allowancePerCallUsd: .1, callLimit: 3, ...hooks });
      const close = provider.close.bind(provider); provider.close = () => { closed = true; close(); }; return provider;
    },
    transport: async (_url, init) => {
      const index = calls++, body = JSON.parse(String(init?.body)); assert.ok(checkpoints.at(-1)!.steps[index]!.dispatchIntent); assert.equal(checkpoints.at(-1)!.steps[index]!.dispatched, false);
      if (options.failureAt === index) throw new Error('SYNTHETIC ambiguous transport');
      const payload = JSON.parse(body.messages[1].content), answer = { answer: 'SYNTHETIC scoped report with unknown population average.', status: 'answered', citations: [options.invalidCitation ? 'SYNTHETIC-invalid' : payload.quoteOptions[0].id] };
      return new Response(JSON.stringify({ model: options.modelDrift && index === 1 ? 'gpt-5.6-luna' : 'gpt-luna', ...(options.unknownUsage ? {} : { usage: { prompt_tokens: 10, completion_tokens: 5 } }), choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: body.tool_choice.function.name, arguments: JSON.stringify(answer) } }] } }] }));
    }
  });
  output.finish(manifest, executed.checkpoint);
  const state = readSourceCalibrationLedgerState(path, .200281, manifest.diagnostic.document.slots.map(s => s.input.runId));
  const ledger = { ...state, canonicalPath: f.preparation.diagnostic.ledger.canonicalPath, historicalRowsSha256: f.preparation.diagnostic.ledger.historicalRowsSha256, attempts: 138 + state.attempts, reservedUsd: 13.8 + state.reservedUsd };
  return { ...executed, manifest, checkpoints, calls, closed, output, ledger, summary: threeContextLiveResult(manifest, executed.checkpoint) };
}
test('live result and journal retain completed, invalid and unknown accounting without retries', async () => {
  for (const options of [{}, { invalidCitation: true }, { failureAt: 1 }, { modelDrift: true }, { unknownUsage: true }, { constructorFailure: true }, { ownerDrift: true }]) {
    const f = fixture();
    try {
      const r = await runMock(f, options); assert.equal(r.summary.retries, 0); assert.equal(r.summary.qualityClaimEligible, false); assert.equal(r.summary.activationAllowed, false);
      assert.equal(verifyThreeContextLiveCheckpoints(r.manifest, r.checkpoints).newProviderAttempts, r.summary.newProviderAttempts);
      if (options.failureAt !== undefined) { assert.equal(r.calls, 2); assert.equal(r.summary.completedAnswers, 1); assert.equal(r.summary.usage, null); assert.deepEqual(r.summary.knownUsageSubtotal, { inputTokens: 10, outputTokens: 5 }); assert.equal(typeof r.summary.steps[1]!.attemptDurationMs, 'number'); assert.equal(r.summary.steps[1]!.elapsedMs, null); }
      else if (options.invalidCitation) { assert.equal(r.calls, 1); assert.equal(r.summary.completedAnswers, 0); assert.deepEqual(r.summary.usage, { inputTokens: 10, outputTokens: 5 }); }
      else if (options.modelDrift) { assert.equal(r.calls, 2); assert.equal(r.summary.completedAnswers, 1); assert.deepEqual(r.summary.usage, { inputTokens: 20, outputTokens: 10 }); }
      else if (options.unknownUsage) { assert.equal(r.calls, 3); assert.equal(r.summary.usage, null); assert.equal(r.summary.attemptsWithKnownUsage, 0); }
      else if (options.constructorFailure) { assert.equal(r.calls, 0); assert.equal(r.summary.status, 'stopped'); assert.equal(r.checkpoints.at(-1)!.stopReason, 'frozen_boundary_or_execution_failed'); }
      else if (options.ownerDrift) { assert.equal(r.calls, 0); assert.equal(r.summary.newProviderAttempts, 1); assert.equal(r.summary.status, 'stopped'); assert.equal(r.summary.networkDispatches, 0); }
      else { assert.equal(r.calls, 3); assert.equal(r.summary.status, 'awaiting_independent_review'); assert.deepEqual(r.summary.usage, { inputTokens: 30, outputTokens: 15 }); }
      const erased = structuredClone(r.checkpoints), last = erased.at(-1)!; if (last.steps[0]!.attemptId) { last.steps[0]!.attemptId = 'SYNTHETIC-rewritten'; assert.throws(() => verifyThreeContextLiveCheckpoints(r.manifest, erased)); }
    } finally { f.cleanup(); }
  }
});
test('read-only receipt reconciliation preserves unknown dispatches and cannot invent missing checkpoint identities', async () => {
  const f = fixture();
  try {
    const r = await runMock(f), interrupted = structuredClone(r.checkpoint); interrupted.steps[2]!.dispatched = false; delete interrupted.steps[2]!.receipt;
    assert.equal(threeContextLiveResult(r.manifest, interrupted).networkDispatches, null);
    const recovered = reconcileThreeContextLiveLedger(r.manifest, interrupted, r.ledger);
    assert.equal(recovered.recoveredReceipts, 1); assert.equal(recovered.result.completedAnswers, 3); assert.equal(recovered.result.networkDispatches, null);
    assert.equal(recovered.newProviderCalls, 0); assert.equal(recovered.redispatchAllowed, false); assert.equal(r.calls, 3);
    const missing = structuredClone(interrupted); missing.steps[2] = { index: 2, started: true, dispatched: false };
    assert.throws(() => reconcileThreeContextLiveLedger(r.manifest, missing, r.ledger), /lacks a durable checkpoint identity/);
    const history = structuredClone(r.ledger); history.historicalRowsSha256 = '0'.repeat(64); assert.throws(() => reconcileThreeContextLiveLedger(r.manifest, interrupted, history));
  } finally { f.cleanup(); }
});
test('actual CLI rejects invalid approval, missing opt-in and unqualified packets before reading credential properties', async () => {
  const repository = realpathSync(fileURLToPath(new URL('../', import.meta.url))), f = fixture(repository);
  const env = { ABLATRIX_LOOP_LIVE: '1' } as NodeJS.ProcessEnv; let credentialReads = 0;
  for (const key of ['SAPIOM_API_KEY', 'SAPIOM_CREDENTIALS_FILE']) Object.defineProperty(env, key, { get() { credentialReads++; throw new Error('Credential access is forbidden in this offline test.'); } });
  const plan = join(repository, '.data', `${f.directory.split('/').at(-1)}-plan.json`); writeFileSync(plan, encode(f.manifest));
  try {
    await assert.rejects(threeContextLiveCli(['--execute', '--plan', plan, '--approved-plan-sha256', '0'.repeat(64)], env), /financial approval/);
    const noOptIn = Object.create(env) as NodeJS.ProcessEnv; Object.defineProperty(noOptIn, 'ABLATRIX_LOOP_LIVE', { value: '0' });
    await assert.rejects(threeContextLiveCli(['--execute', '--plan', plan, '--approved-plan-sha256', f.manifest.sha256], noOptIn), /financial approval/);
    await assert.rejects(threeContextLiveCli(['--execute', '--plan', plan, '--approved-plan-sha256', f.manifest.sha256], env), /No reviewed source benefit/);
    assert.equal(credentialReads, 0); assert.equal(statSync(plan).isFile(), true);
  } finally { rmSync(plan, { force: true }); f.cleanup(); }
});
