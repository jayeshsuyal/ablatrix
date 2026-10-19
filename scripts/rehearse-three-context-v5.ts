/** Actual pinned development sources + real provider ledger mechanics, mocked transport only. */
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SapiomFeedbackProvider } from '../server/feedback-provider.ts';
import { readSourceCalibrationLedgerState } from '../server/source-calibration-comparison.ts';
import { anonymousDiagnosticReview, executeThreeContext, DIAGNOSTIC_LEDGER, type DiagnosticCheckpoint } from '../server/three-context-diagnostic.ts';
import { checkThreeContextLiveFiles, prepareThreeContextLive, privateThreeContextOutput, threeContextLiveResult, verifyThreeContextLiveCheckpoints, reconcileThreeContextLiveLedger, type ThreeContextLivePreparation } from '../server/three-context-live.ts';
import { buildV5DevelopmentPreparation, REVIEWED_V5_RESULT } from './prepare-three-context-v5.ts';
import { prepareThreeContextEvaluation } from '../server/three-context-evaluation.ts';
export async function rehearseV5(options: { failureAt?: number } = {}) {
  const root = realpathSync(fileURLToPath(new URL('../', import.meta.url))); const storage = resolve(root, '.data'); if (!existsSync(storage)) mkdirSync(storage, { mode: 0o700 }); assert.ok(!lstatSync(storage).isSymbolicLink()); assert.equal(realpathSync(storage), storage);
  const directory = realpathSync(mkdtempSync(resolve(root, '.data/SYNTHETIC-v5-rehearsal-'))), input = resolve(directory, 'preparation.json');
  try {
    const sources = buildV5DevelopmentPreparation(REVIEWED_V5_RESULT.path, input, root), dbPath = resolve(directory, 'mocked-ledger.sqlite');
    const init = new SapiomFeedbackProvider({ enabled: true, apiKey: 'SYNTHETIC-test-only', credentialsFile: '', dbPath, capUsd: 20, priorSpendUsd: .200281, allowancePerCallUsd: .1, callLimit: 141 }); init.close();
    const seed = new DatabaseSync(dbPath); for (let i = 0; i < 138; i++) seed.prepare('INSERT INTO loop_provider_calls(id,created_at,kind,allowance_usd,status,run_id) VALUES(?,?,?,?,?,?)').run(`SYNTHETIC-history-${i}`, '2026-10-19T00:00:00Z', 'SYNTHETIC history', .1, 'completed', `SYNTHETIC-history-${i}`); seed.close();
    const ledger = readSourceCalibrationLedgerState(dbPath, .200281), wrapper: ThreeContextLivePreparation = { repositoryPath: root, outputDirectory: resolve(directory, 'execution'), diagnostic: {
      cases: sources.cases, policy: sources.policy, implementationSha256: Object.fromEntries(sources.codeFiles.map(path => [path, sources.digest(path)])), artifactSha256: Object.fromEntries(sources.artifactPaths.map(path => [path, sources.digest(path)])),
      ledger: { canonicalPath: DIAGNOSTIC_LEDGER, historicalRowsSha256: ledger.historicalRowsSha256, attempts: ledger.attempts, reservedUsd: ledger.reservedUsd, priorSpendUsd: .200281, pending: 0, owners: 0 }, codeReviewPassed: true } };
    // true is confined to mocked mechanics. No actual reviewed wrapper or canonical ledger is read/written here.
    writeFileSync(input, JSON.stringify(wrapper, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); const manifest = prepareThreeContextLive(wrapper, input), checkpoints: DiagnosticCheckpoint[] = [], output = privateThreeContextOutput(wrapper.outputDirectory, root);
    let calls = 0; const readLedger = () => ({ ...readSourceCalibrationLedgerState(dbPath, .200281, manifest.diagnostic.document.slots.map(s => s.input.runId)), canonicalPath: DIAGNOSTIC_LEDGER });
    const execution = await executeThreeContext(manifest.diagnostic, { execute: true, liveOptIn: true, approvedSha256: manifest.diagnostic.sha256, provenance: 'mocked_mechanics_only' }, {
      checkBindings() { checkThreeContextLiveFiles(manifest); return { implementationSha256: wrapper.diagnostic.implementationSha256, artifactSha256: wrapper.diagnostic.artifactSha256 }; }, checkLedger: readLedger, create: output.create,
      checkpoint(value) { checkpoints.push(structuredClone(value)); output.checkpoint(value); },
      createProvider: hooks => new SapiomFeedbackProvider({ enabled: true, apiKey: 'SYNTHETIC-test-only', credentialsFile: '', dbPath, capUsd: 20, priorSpendUsd: .200281, allowancePerCallUsd: .1, callLimit: 141, ...hooks }),
      transport: async (_url, init) => {
        const i = calls++, body = JSON.parse(String(init?.body)); assert.ok(checkpoints.at(-1)!.steps[i]!.dispatchIntent); assert.equal(checkpoints.at(-1)!.steps[i]!.dispatched, false);
        if (i === options.failureAt) throw new Error('SYNTHETIC ambiguous dispatch'); const payload = JSON.parse(body.messages[1].content);
        const response = { answer: 'SYNTHETIC mechanics-only response; this is not an actual answer-quality observation.', status: 'answered', citations: [payload.quoteOptions[0].id] };
        return new Response(JSON.stringify({ model: 'gpt-luna', usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: body.tool_choice.function.name, arguments: JSON.stringify(response) } }] } }] }));
      }
    });
    output.finish(manifest, execution.checkpoint); const result = threeContextLiveResult(manifest, execution.checkpoint); assert.deepEqual(verifyThreeContextLiveCheckpoints(manifest, checkpoints), result);
    const anonymous = JSON.parse(readFileSync(resolve(wrapper.outputDirectory, 'review.json'), 'utf8')); assert.ok(!JSON.stringify(anonymous).includes('operationRunId'));
    const evaluation = prepareThreeContextEvaluation(manifest, checkpoints, result, anonymous);
    const recovered = reconcileThreeContextLiveLedger(manifest, execution.checkpoint, readLedger()); assert.equal(recovered.newProviderCalls, 0); assert.equal(recovered.redispatchAllowed, false);
    return { format: 'ablatrix-v5-three-context-mocked-rehearsal-v1', sourceCases: sources.cases.map(c => c.id), requestBindings: manifest.diagnostic.document.slots.map(s => ({ arm: s.arm, requestSha256: s.binding.requestSha256, sourceContextSha256: s.binding.sourceContextSha256 })), result, evaluation: { answers: evaluation.answers.length, sourceCases: evaluation.cases.length, completed: evaluation.answers.filter(a => a.status === 'completed').length, humanJudgments: 0, qualityClaimEligible: false },
      transportCalls: calls, newRealProviderCalls: 0, ledger: 'Temporary synthetic 138-row ledger, never the canonical ledger', provenance: 'SYNTHETIC mocked mechanics only', qualityClaimEligible: false };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(await rehearseV5(), null, 2));
