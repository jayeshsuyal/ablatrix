/** Synthetic mechanics for the 24-answer development scope. No actual provider calls. */
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SapiomFeedbackProvider } from '../server/feedback-provider.ts';
import { readSourceCalibrationLedgerState } from '../server/source-calibration-comparison.ts';
import { executeThreeContext, DIAGNOSTIC_LEDGER, diagnosticHash, type DiagnosticCheckpoint } from '../server/three-context-diagnostic.ts';
import { prepareThreeContextLive, checkThreeContextLiveFiles, privateThreeContextOutput, threeContextLiveResult, verifyThreeContextLiveCheckpoints, reconcileThreeContextLiveLedger, requiredThreeContextLiveFiles } from '../server/three-context-live.ts';
import { prepareThreeContextEvaluation } from '../server/three-context-evaluation.ts';
import { textHash } from '../server/product-corpus.ts';
import { syntheticPreparation } from './three-context-mock.ts';
import { createReportCalibrationPreparation, REPORT_CALIBRATION_V1, reportCalibrationEvaluationMetadata } from './prepare-report-calibration-v1.ts';

export async function mockReportCalibration(options: { failureAt?: number; unknownUsageAt?: number } = {}) {
  const root = realpathSync(fileURLToPath(new URL('../', import.meta.url))), storage = resolve(root, '.data');
  if (!existsSync(storage)) mkdirSync(storage, { mode: 0o700 }); assert.ok(!lstatSync(storage).isSymbolicLink()); assert.equal(realpathSync(storage), storage);
  const directory = realpathSync(mkdtempSync(resolve(storage, 'SYNTHETIC-report-calibration-'))), dbPath = resolve(directory, 'synthetic-ledger.sqlite');
  try {
    const providerOptions = { enabled: true, apiKey: 'SYNTHETIC-mocked-transport-only', credentialsFile: '', dbPath, capUsd: 20, priorSpendUsd: .200281, allowancePerCallUsd: .1, callLimit: 165 };
    const initialize = new SapiomFeedbackProvider(providerOptions); initialize.close();
    const seed = new DatabaseSync(dbPath); try { for (let i = 0; i < 141; i++) seed.prepare('INSERT INTO loop_provider_calls(id,created_at,kind,allowance_usd,status,run_id) VALUES(?,?,?,?,?,?)').run(`SYNTHETIC-history-${i}`, '2026-10-19T00:00:00Z', 'SYNTHETIC completed history', .1, 'completed', `SYNTHETIC-history-${i}`); } finally { seed.close(); }
    const before = readSourceCalibrationLedgerState(dbPath, .200281), input = resolve(directory, 'preparation.json'), artifact = relative(root, resolve(directory, 'SYNTHETIC-inputs.json'));
    const synthetic = syntheticPreparation(), gap = synthetic.cases[0]!; gap.id = REPORT_CALIBRATION_V1.selectedSourceCaseIds[0]; gap.contexts.current = gap.completeSources.slice(0, 1);
    const control = structuredClone(gap); control.id = REPORT_CALIBRATION_V1.selectedSourceCaseIds[1]; control.product = { id: 'SYNTHETIC-control', title: 'SYNTHETIC complete source control', split: 'development' };
    const replaceProduct = <T extends { productId: string }>(source: T) => ({ ...source, productId: control.product.id });
    control.completeSources = control.completeSources.map(replaceProduct); control.contexts = { current: control.completeSources, semantic: control.completeSources, reference: control.completeSources }; control.referenceReview.sourcePoolSha256 = diagnosticHash(control.completeSources);
    const sourceCases = [gap, control]; writeFileSync(resolve(root, artifact), JSON.stringify({ provenance: 'SYNTHETIC mocked inputs, not an actual source review', cases: sourceCases }) + '\n', { flag: 'wx', mode: 0o600 });
    const paths = [...new Set([...requiredThreeContextLiveFiles(root), 'scripts/prepare-report-calibration-v1.ts', 'scripts/report-calibration-mock.ts'])].sort(), digest = (path: string) => textHash(readFileSync(resolve(root, path), 'utf8'));
    const wrapper = createReportCalibrationPreparation(root, sourceCases, synthetic.policy, { canonicalPath: DIAGNOSTIC_LEDGER, historicalRowsSha256: before.historicalRowsSha256, attempts: before.attempts, reservedUsd: before.reservedUsd, priorSpendUsd: .200281, pending: 0, owners: 0 },
      { implementationSha256: Object.fromEntries(paths.map(path => [path, digest(path)])), artifactSha256: { [artifact]: digest(artifact) } },
      { v6ReviewedResultPath: artifact, expectedV6ReviewedResultSha256: digest(artifact), sourceReviewPath: artifact, expectedSourceReviewSha256: digest(artifact) }, 'a'.repeat(64), resolve(directory, 'execution'));
    // This true value is exclusively for injected mocked transport and temporary
    // synthetic storage. Actual preparation/qualification never uses this path.
    wrapper.diagnostic.codeReviewPassed = true; writeFileSync(input, JSON.stringify(wrapper, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    const manifest = prepareThreeContextLive(wrapper, input), checkpoints: DiagnosticCheckpoint[] = [], output = privateThreeContextOutput(wrapper.outputDirectory, root); let calls = 0;
    const readLedger = () => ({ ...readSourceCalibrationLedgerState(dbPath, .200281, manifest.diagnostic.document.slots.map(s => s.input.runId)), canonicalPath: DIAGNOSTIC_LEDGER });
    const executed = await executeThreeContext(manifest.diagnostic, { execute: true, liveOptIn: true, approvedSha256: manifest.diagnostic.sha256, provenance: 'mocked_mechanics_only' }, {
      checkBindings() { checkThreeContextLiveFiles(manifest); return { implementationSha256: wrapper.diagnostic.implementationSha256, artifactSha256: wrapper.diagnostic.artifactSha256 }; }, checkLedger: readLedger,
      create: output.create, checkpoint(value) { checkpoints.push(structuredClone(value)); output.checkpoint(value); }, createProvider: hooks => new SapiomFeedbackProvider({ ...providerOptions, ...hooks }),
      transport: async (_url, init) => {
        const index = calls++, body = JSON.parse(String(init?.body)), payload = JSON.parse(body.messages[1].content);
        assert.ok(checkpoints.at(-1)!.steps[index]!.dispatchIntent); assert.equal(checkpoints.at(-1)!.steps[index]!.dispatched, false);
        if (index === options.failureAt) throw new Error('SYNTHETIC ambiguous transport outcome; do not retry.');
        const response = { answer: 'SYNTHETIC mechanics fixture; no answer-quality finding is measured.', status: 'answered', citations: [payload.quoteOptions[0].id] };
        return new Response(JSON.stringify({ model: 'gpt-luna', ...(index === options.unknownUsageAt ? {} : { usage: { prompt_tokens: 10, completion_tokens: 5 } }), choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: body.tool_choice.function.name, arguments: JSON.stringify(response) } }] } }] }));
      }
    });
    output.finish(manifest, executed.checkpoint); const result = threeContextLiveResult(manifest, executed.checkpoint); assert.deepEqual(verifyThreeContextLiveCheckpoints(manifest, checkpoints), result);
    const review = JSON.parse(readFileSync(resolve(wrapper.outputDirectory, 'review.json'), 'utf8')), evaluation = prepareThreeContextEvaluation(manifest, checkpoints, result, review);
    const recovered = reconcileThreeContextLiveLedger(manifest, executed.checkpoint, readLedger()); assert.equal(recovered.newProviderCalls, 0); assert.equal(recovered.redispatchAllowed, false);
    return { ...reportCalibrationEvaluationMetadata(wrapper), format: 'ablatrix-report-calibration-mocked-rehearsal-v1', provenance: 'SYNTHETIC inputs and mocked transport, not actual answer-quality observations',
      result, transportCalls: calls, newRealProviderCalls: 0, ledger: 'Temporary synthetic 141-row ledger; canonical ledger never read or written',
      evaluation: { answers: evaluation.answers.length, caseInstances: evaluation.cases.length, actualProducts: new Set(evaluation.cases.map(c => c.product.id)).size, completed: evaluation.answers.filter(a => a.status === 'completed').length, failedOrUnknown: evaluation.answers.filter(a => a.status === 'failed_or_unknown').length, unattempted: evaluation.answers.filter(a => a.status === 'not_attempted').length, anonymousBytes: JSON.stringify(evaluation), humanJudgments: 0 },
      budget: manifest.diagnostic.document.paidPlan, redispatchAllowed: false };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) { const result = await mockReportCalibration(); const { anonymousBytes: _privateContent, ...evaluation } = result.evaluation; console.log(JSON.stringify({ ...result, evaluation }, null, 2)); }
