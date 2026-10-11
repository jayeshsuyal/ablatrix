import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contextComparisonHash } from './context-comparison.ts';
import { SapiomFeedbackProvider, constrainedSourceIdAnswerRequestBody, constrainedSourceIdRevisionRequestBody } from './feedback-provider.ts';
import { DIAGNOSTIC_CASE_IDS, DIAGNOSTIC_CODE_FILES, diagnosticSha256, diagnosticRevisionInput, prepareSourceIdDiagnostic, executeSourceIdDiagnostic, privateDiagnosticOutput, sourceIdDiagnosticCli, inspectDiagnosticApp, diagnosticAppPort, type DiagnosticArtifact, type DiagnosticExecution, type DiagnosticPreparation, type DiagnosticResult, type DiagnosticState } from './source-id-diagnostic.ts';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function artifact(path: string): DiagnosticArtifact { const raw = readFileSync(new URL(`../${path}`, import.meta.url)); return { path, fileSha256: diagnosticSha256(raw), document: JSON.parse(raw.toString()) }; }
function preparation(): DiagnosticPreparation {
  // Public source context only. No generated live answer or real database is read.
  const source = artifact('docs/evidence/source-id-correction-2026-10-10/execution-plan-v2.json');
  const caseAudit = artifact('docs/evidence/source-id-diagnostic-2026-10-11/case-audit.json');
  const implementationSha256 = Object.fromEntries(DIAGNOSTIC_CODE_FILES.map(path => [path, diagnosticSha256(readFileSync(new URL(`../${path}`, import.meta.url)))]));
  const document = { kind: 'synthetic_offline_test_qualification', passed: true, newProviderCalls: 0, sourceIdInterface: 'source_ids_v2', qualityClaimEligible: false, routerConstrainedDecodingVerified: false, implementationSha256 };
  return { source, caseAudit, qualification: { path: 'synthetic/offline-qualification.json', fileSha256: diagnosticSha256(JSON.stringify(document)), document }, implementationCommit: 'a'.repeat(40), implementationSha256, createdAt: '2026-10-11T00:00:00.000Z' };
}
type Body = ReturnType<typeof constrainedSourceIdAnswerRequestBody>;
function payload(body: Body) { return JSON.parse(body.messages[1].content); }
const before: DiagnosticState = { ledgerAttempts: 81, pendingReservations: 0, activeOwners: 0, activeReviewJobs: 0, historicalReceiptsSha256: 'opaque-prior-receipts', reviewStateSha256: 'opaque-review-history', newRunIds: [] };
function harness(response: (body: Body, index: number) => unknown, model = 'gpt-luna') {
  const prep = preparation(), manifest = prepareSourceIdDiagnostic(prep), checkpoints: DiagnosticResult[] = [], bodies: Body[] = [];
  const receipts = new Map<string, NonNullable<ReturnType<SapiomFeedbackProvider['receipt']>>>();
  let providerCreations = 0, outputCreations = 0, closed = false;
  const deps: DiagnosticExecution = {
    preparation: prep, approvedPlanSha256: manifest.planSha256, env: { ABLATRIX_LOOP_LIVE: '1', ABLATRIX_REVISION_WEB: '0', ABLATRIX_LOOP_CALL_LIMIT: '87' }, implementationMerged: true, inspectApp: () => ({ configuredPort: 4173, checkedPorts: [4173], listenerPids: [], sharedFileOwnerPids: [], activeLockPids: [], stopped: true }),
    readState: () => ({ ...before, ledgerAttempts: 81 + receipts.size, newRunIds: [...receipts.keys()] }),
    output: { create: result => { outputCreations++; checkpoints.push(result); }, save: result => checkpoints.push(result) },
    createProvider: fetchImpl => {
      providerCreations++;
      const p = new SapiomFeedbackProvider({ enabled: true, apiKey: 'synthetic-test-key-not-a-credential', dbPath: ':memory:', capUsd: 10, priorSpendUsd: .200281, allowancePerCallUsd: .1, callLimit: 87, fetchImpl });
      const remember = (runId: string) => { const receipt = p.receipt(runId); if (receipt) receipts.set(runId, receipt); return receipt; };
      return { capacity: n => p.capacity(n), receipt: remember, answerWithConstrainedSourceIds: async input => { try { return await p.answerWithConstrainedSourceIds(input); } finally { if (input.runId) remember(input.runId); } }, reviseWithConstrainedSourceIds: async input => { try { return await p.reviseWithConstrainedSourceIds(input); } finally { if (input.runId) remember(input.runId); } }, close: () => { closed = true; p.close(); } };
    },
    transport: async (_url, init) => {
      const body: Body = JSON.parse(String(init?.body)); bodies.push(body);
      const snapshot = checkpoints.at(-1)!;
      assert.equal(snapshot.networkDispatches, bodies.length - 1); assert.equal(snapshot.steps.filter(s => s.dispatched).length, bodies.length - 1);
      const step = snapshot.steps.find(s => s.status === 'dispatching')!;
      assert.ok(step.dispatchIntentAt); assert.equal(step.dispatched, undefined); assert.deepEqual(step.requestBody, body); assert.equal(step.requestSha256, diagnosticSha256(String(init?.body))); assert.equal(init?.redirect, 'error');
      return new Response(JSON.stringify({ model, usage: { prompt_tokens: 20, completion_tokens: 7 }, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: body.tool_choice.function.name, arguments: JSON.stringify(response(body, bodies.length - 1)) } }] } }] }));
    },
  };
  return { manifest, deps, checkpoints, bodies, receipts, counts: () => ({ providerCreations, outputCreations, closed }) };
}
const valid = (body: Body, index: number) => ({ answer: `SYNTHETIC diagnostic response ${index}; no quality judgment.`, status: 'answered', citations: [{ quoteId: payload(body).quoteOptions[0].id }] });

test('pure preparation freezes all three exact public contexts and six requests, with a dynamic baseline derivation', () => {
  const prep = preparation(), frozen = prepareSourceIdDiagnostic(prep);
  assert.deepEqual(frozen.plan.cases.map(c => c.id), [...DIAGNOSTIC_CASE_IDS]); assert.equal(frozen.plan.order.length, 6);
  assert.equal(frozen.plan.limits.absoluteCallLimit, 87); assert.equal(frozen.plan.limits.maximumPlanningAllowanceUsd, .6);
  assert.equal(frozen.plan.paidExecutionAuthorized, false); assert.equal(frozen.plan.qualityClaimEligible, false); assert.equal(frozen.plan.routerConstrainedDecodingVerified, false);
  for (const c of frozen.plan.cases) {
    const prior = prep.source.document.plan.cases.find((s: any) => s.id === c.id);
    assert.deepEqual(c.originalInput.passages, prior.originalInput.passages); assert.deepEqual(c.critique, prior.critique);
    assert.equal(c.originalInput.policy.instructions, prior.originalInput.policy.instructions); assert.equal(c.quoteOptions.length, 5);
    assert.deepEqual(payload(c.originalRequest).quoteOptions, payload(c.revisionTemplateRequest).quoteOptions);
    const actual = constrainedSourceIdRevisionRequestBody(diagnosticRevisionInput(c, 'SYNTHETIC actual original.', 'synthetic-run'));
    assert.equal(payload(actual).rejectedAnswer, 'SYNTHETIC actual original.'); assert.notEqual(diagnosticSha256(JSON.stringify(actual)), c.revisionTemplateRequestSha256);
    assert.deepEqual(payload(actual).quoteOptions, c.quoteOptions); assert.equal(diagnosticSha256(JSON.stringify(actual.tools[0].function.parameters)), c.responseSchemaSha256);
  }
  assert.equal(frozen.plan.cases[0].quoteOptions[0].id, 'src_d6dec31ee5a0006a8e2e684a');
  assert.equal(frozen.plan.cases[1].quoteOptions.find(s => s.passageId === frozen.plan.cases[1].targetSourceIds[0])!.quote.length, 289);
  assert.ok(frozen.plan.cases[2].originalInput.passages.every(s => s.source === 'cqa' && s.originalQuestion));
  const altered = clone(prep); altered.caseAudit.document.cases[0].critique.text = 'Changed after source selection'; assert.throws(() => prepareSourceIdDiagnostic(altered));
  const reordered = clone(prep); reordered.source.document.plan.cases.find((c: any) => c.id === DIAGNOSTIC_CASE_IDS[0]).originalInput.passages.reverse(); reordered.source.document.planSha256 = contextComparisonHash(reordered.source.document.plan); assert.throws(() => prepareSourceIdDiagnostic(reordered));
  const missingQualification = clone(prep); delete missingQualification.qualification.document.implementationSha256[DIAGNOSTIC_CODE_FILES[0]]; assert.throws(() => prepareSourceIdDiagnostic(missingQualification));
});

test('approval, frozen source/code, merged state, live/web limits and ledger gates fail before provider or output creation', async () => {
  const changes: ((h: ReturnType<typeof harness>) => void)[] = [
    h => { h.deps.approvedPlanSha256 = '0'.repeat(64); },
    h => { (h.manifest.plan.limits as { maximumNewAttempts: number }).maximumNewAttempts = 7; h.manifest.planSha256 = contextComparisonHash(h.manifest.plan); h.deps.approvedPlanSha256 = h.manifest.planSha256; },
    h => { h.deps.preparation.implementationSha256[DIAGNOSTIC_CODE_FILES[0]] = 'b'.repeat(64); },
    h => { h.deps.implementationMerged = false; }, h => { h.deps.inspectApp = () => ({ configuredPort: 4173, checkedPorts: [4173], listenerPids: [123], sharedFileOwnerPids: [], activeLockPids: [], stopped: false }); },
    h => { h.deps.env.ABLATRIX_LOOP_LIVE = '0'; }, h => { h.deps.env.ABLATRIX_REVISION_WEB = '1'; }, h => { h.deps.env.ABLATRIX_LOOP_CALL_LIMIT = '88'; },
    ...(['ledgerAttempts', 'pendingReservations', 'activeOwners', 'activeReviewJobs'] as const).map(field => (h: ReturnType<typeof harness>) => { h.deps.readState = () => ({ ...before, [field]: field === 'ledgerAttempts' ? 80 : 1 }); }),
  ];
  for (const change of changes) { const h = harness(valid); change(h); await assert.rejects(executeSourceIdDiagnostic(h.manifest, h.deps)); assert.deepEqual(h.counts(), { providerCreations: 0, outputCreations: 0, closed: false }); assert.equal(h.bodies.length, 0); }
});

test('six injected responses preserve exact request/catalog/schema/receipt identity and derive baseline from actual original', async () => {
  for (const model of ['gpt-luna', 'gpt-5.6-luna']) {
    const h = harness((body, index) => { const c = h.manifest.plan.cases[Math.floor(index / 2)], option = payload(body).quoteOptions.find((s: any) => c.targetSourceIds.includes(s.passageId)); return { ...valid(body, index), citations: [{ quoteId: option.id }] }; }, model);
    const result = await executeSourceIdDiagnostic(h.manifest, h.deps);
    assert.equal(result.status, 'completed'); assert.equal(result.newProviderAttempts, 6); assert.equal(result.networkDispatches, 6); assert.equal(result.acceptedOutputs, 6); assert.equal(result.citationSelectionRequests, 6);
    assert.equal(result.deliveryOutcome, 'completed_with_observed_selection'); assert.ok(result.targetCoverage.every(c => c.status === 'observed')); assert.ok(result.existingReceiptsUnchanged && result.existingReviewStateUnchanged); assert.equal(h.counts().closed, true);
    for (const [i, step] of result.steps.entries()) {
      const c = h.manifest.plan.cases[Math.floor(i / 2)]; assert.equal(step.result!.model, model); assert.equal(step.receipt!.allowance_usd, .1);
      assert.deepEqual(payload(h.bodies[i]).quoteOptions, c.quoteOptions); assert.equal(step.result!.responseSchemaSha256, c.responseSchemaSha256); assert.equal(JSON.parse(step.receipt!.receipt_json!).responseSchemaSha256, c.responseSchemaSha256);
      if (step.arm === 'baseline') assert.equal(payload(h.bodies[i]).rejectedAnswer, result.steps[i - 1].result!.answer.answer);
    }
    assert.equal(result.operatorApprovalPlanSha256, h.manifest.planSha256); assert.equal(result.qualityClaimEligible, false); assert.equal(result.routerConstrainedDecodingVerified, false); assert.equal(result.humanJudgments, 0);
  }
});

test('the historically truncated ID stops at exactly one attempt without repair, replacement, import or denominator shrink', async () => {
  const h = harness(body => ({ ...valid(body, 0), citations: [{ quoteId: 'src_d6dec31ee5a0006a8e2e684' }] }));
  const result = await executeSourceIdDiagnostic(h.manifest, h.deps);
  assert.equal(result.status, 'stopped'); assert.equal(result.deliveryOutcome, 'incomplete'); assert.equal(result.newProviderAttempts, 1); assert.equal(result.networkDispatches, 1); assert.equal(result.acceptedOutputs, 0);
  assert.equal(result.steps.length, 6); assert.equal(result.steps.filter(s => s.status === 'not_attempted').length, 5); assert.equal(result.steps[0].receipt!.status, 'completed'); assert.equal(result.steps[0].receipt!.error_code, 'output_validation');
  assert.equal(JSON.parse(result.steps[0].receipt!.receipt_json!).responseSchemaSha256, h.manifest.plan.cases[0].responseSchemaSha256); assert.equal('imported' in result, false);
});

test('empty insufficient responses are accepted while all selection and target coverage remains inconclusive, with no extra calls', async () => {
  const h = harness(() => ({ answer: 'SYNTHETIC: source support remains uncertain.', status: 'insufficient_evidence', citations: [] }));
  const result = await executeSourceIdDiagnostic(h.manifest, h.deps);
  assert.equal(result.status, 'completed'); assert.equal(result.acceptedOutputs, 6); assert.equal(result.networkDispatches, 6); assert.equal(result.citationSelectionRequests, 0);
  assert.equal(result.deliveryOutcome, 'completed_with_unexercised_selection'); assert.ok(result.targetCoverage.every(c => c.status === 'inconclusive')); assert.ok(result.steps.every(s => s.citationSelection === 'unexercised'));
  const missed = harness(body => ({ ...valid(body, 0), citations: [{ quoteId: payload(body).quoteOptions[1].id }] }));
  const selection = await executeSourceIdDiagnostic(missed.manifest, missed.deps); assert.equal(selection.citationSelectionRequests, 6); assert.equal(selection.targetCoverage[0].status, 'inconclusive');
});

test('network failure and post-run history drift are terminal and never trigger retries', async () => {
  const network = harness(valid); network.deps.transport = async () => { throw new Error('Synthetic connection loss after dispatch.'); };
  const stopped = await executeSourceIdDiagnostic(network.manifest, network.deps); assert.equal(stopped.networkDispatches, 1); assert.equal(stopped.newProviderAttempts, 1); assert.equal(stopped.steps[0].receipt!.status, 'failed_or_unknown'); assert.equal(stopped.status, 'stopped');
  const history = harness(valid), read = history.deps.readState;
  history.deps.readState = () => { const state = read(); return state.ledgerAttempts === 81 ? state : { ...state, reviewStateSha256: 'changed' }; };
  const changed = await executeSourceIdDiagnostic(history.manifest, history.deps); assert.equal(changed.status, 'stopped'); assert.equal(changed.existingReviewStateUnchanged, false); assert.equal(changed.deliveryOutcome, 'incomplete'); assert.equal(changed.networkDispatches, 6);
});

test('private output starts exclusively with 0600 permissions and checkpoints preserve those permissions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ablatrix-diagnostic-'));
  try {
    const path = join(dir, 'private', 'result.json'), sink = privateDiagnosticOutput(path, dir), value = { format: 'synthetic-only' } as DiagnosticResult;
    sink.create(value); assert.equal(statSync(path).mode & 0o777, 0o600); assert.throws(() => sink.create(value)); sink.save({ ...value, status: 'stopped' }); assert.equal(statSync(path).mode & 0o777, 0o600); assert.equal(JSON.parse(readFileSync(path, 'utf8')).status, 'stopped');
    assert.throws(() => privateDiagnosticOutput(join(dir, '..', 'outside.json'), dir));
    const external = join(dir, 'external'), link = join(dir, 'linked'); mkdirSync(external); symlinkSync(external, link); assert.throws(() => privateDiagnosticOutput(join(link, 'answer.json'), dir), /symlink/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('a failed pre-dispatch persistence checkpoint consumes no transport dispatch and prevents later steps', async () => {
  const h = harness(valid), save = h.deps.output.save;
  let failed = false;
  h.deps.output.save = result => { if (!failed && result.steps.some(s => s.dispatchIntentAt)) { failed = true; throw new Error('Synthetic disk error before transport.'); } save(result); };
  const result = await executeSourceIdDiagnostic(h.manifest, h.deps);
  assert.equal(result.status, 'stopped'); assert.equal(result.networkDispatches, 0); assert.equal(h.bodies.length, 0); assert.equal(result.newProviderAttempts, 1);
  assert.equal(result.steps[0].receipt!.status, 'failed_or_unknown'); assert.equal(result.steps[0].dispatched, undefined); assert.ok(result.steps[0].dispatchIntentAt); assert.equal(result.steps.filter(s => s.status === 'not_attempted').length, 5);
});


test('CLI accepts exactly the documented five prepare flags and rejects unknown flags before artifact I/O', async () => {
  const args = ['--prepare', '--source-plan', 'synthetic/does-not-exist.json', '--qualification', 'synthetic/qualification.json', '--case-audit', 'synthetic/audit.json', '--implementation-commit', 'a'.repeat(40), '--out', 'synthetic/not-created.json'];
  // The normal argument set reaches the read-only source check; no code commit,
  // provider, credential, live database, or output is needed for this boundary.
  await assert.rejects(sourceIdDiagnosticCli(args), { code: 'ENOENT' });
  await assert.rejects(sourceIdDiagnosticCli([...args, '--extra', 'ignored']), /Unknown or missing preparation flag/);
  await assert.rejects(sourceIdDiagnosticCli(['--execute', '--plan', 'missing.json', '--approved-plan-sha256', 'a'.repeat(64), '--out', 'unused', '--extra', 'ignored']), /Unknown or missing execution flag/);
  await assert.rejects(sourceIdDiagnosticCli(['--prepare', '--source-plan', 'first', '--source-plan', 'second']));
});

test('existing private output refuses a new execution before constructing its provider', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ablatrix-diagnostic-exclusive-'));
  try {
    const h = harness(valid), path = join(dir, 'result.json'), sink = privateDiagnosticOutput(path, dir);
    sink.create({ format: 'synthetic-existing-output' } as DiagnosticResult); h.deps.output = sink;
    await assert.rejects(executeSourceIdDiagnostic(h.manifest, h.deps), { code: 'EEXIST' });
    assert.equal(h.counts().providerCreations, 0); assert.equal(h.bodies.length, 0); assert.equal(JSON.parse(readFileSync(path, 'utf8')).format, 'synthetic-existing-output');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


function temporaryAppPaths() {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-diagnostic-app-'));
  const paths = { budgetPath: join(directory, 'budget.sqlite'), reviewPath: join(directory, 'review.sqlite'), appDbPath: join(directory, 'app.sqlite'), loopDbPath: join(directory, 'loop.sqlite') };
  writeFileSync(paths.budgetPath, ''); writeFileSync(paths.reviewPath, '');
  return { directory, paths };
}

test('stopped-app check follows default/configured PORT and blocks real listeners before output/provider creation', async () => {
  const { directory, paths } = temporaryAppPaths();
  const defaultServer = createServer((_req, res) => res.end('SYNTHETIC default app'));
  const alternateServer = createServer((_req, res) => res.end('SYNTHETIC alternate app'));
  try {
    assert.equal(diagnosticAppPort(), 4173); assert.equal(diagnosticAppPort('4194'), 4194);
    for (const value of ['0', '-1', '65536', 'foo', '1.5', '']) assert.throws(() => diagnosticAppPort(value));
    await new Promise<void>((resolve, reject) => { defaultServer.once('error', reject); defaultServer.listen(4173, '127.0.0.1', resolve); });
    const defaultState = inspectDiagnosticApp(paths); assert.equal(defaultState.stopped, false); assert.deepEqual(defaultState.checkedPorts, [4173]); assert.ok(defaultState.listenerPids.includes(process.pid));
    const blockedDefault = harness(valid); blockedDefault.deps.inspectApp = () => inspectDiagnosticApp(paths);
    await assert.rejects(executeSourceIdDiagnostic(blockedDefault.manifest, blockedDefault.deps), /Stop the local application/); assert.equal(blockedDefault.counts().providerCreations, 0); assert.equal(blockedDefault.counts().outputCreations, 0);
    await new Promise<void>((resolve, reject) => defaultServer.close(error => error ? reject(error) : resolve()));
    await new Promise<void>((resolve, reject) => { alternateServer.once('error', reject); alternateServer.listen(0, '127.0.0.1', resolve); });
    const address = alternateServer.address(); assert.ok(address && typeof address === 'object'); const port = String(address.port);
    const alternateState = inspectDiagnosticApp({ ...paths, port }); assert.equal(alternateState.stopped, false); assert.deepEqual(alternateState.checkedPorts, [4173, address.port]);
    const blockedAlternate = harness(valid); blockedAlternate.deps.env.PORT = port; blockedAlternate.deps.inspectApp = () => inspectDiagnosticApp({ ...paths, port });
    await assert.rejects(executeSourceIdDiagnostic(blockedAlternate.manifest, blockedAlternate.deps), /Stop the local application/); assert.equal(blockedAlternate.counts().providerCreations, 0); assert.equal(blockedAlternate.counts().outputCreations, 0);
    await new Promise<void>((resolve, reject) => alternateServer.close(error => error ? reject(error) : resolve()));
    const stopped = inspectDiagnosticApp({ ...paths, port }); assert.equal(stopped.stopped, true); assert.deepEqual(stopped.listenerPids, []);
  } finally { defaultServer.close(); alternateServer.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a worker holding the shared SQLite files on an unconfigured port blocks execution without a provider lease', async () => {
  const { directory, paths } = temporaryAppPaths();
  const script = `import {DatabaseSync} from 'node:sqlite'; import {createServer} from 'node:http';
    const budget = new DatabaseSync(process.argv[1]), review = new DatabaseSync(process.argv[2]);
    budget.exec('CREATE TABLE synthetic_fixture(id INTEGER)'); review.exec('CREATE TABLE synthetic_fixture(id INTEGER)');
    const server = createServer((_req,res) => res.end('SYNTHETIC worker')); server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));
    process.on('SIGTERM',()=>server.close(()=>{budget.close();review.close();process.exit(0);}));`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, paths.budgetPath, paths.reviewPath], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  try {
    const [message] = await once(child, 'message', { signal: AbortSignal.timeout(10_000) }); assert.ok(message.port !== 4173);
    const state = inspectDiagnosticApp(paths); assert.equal(state.stopped, false); assert.deepEqual(state.listenerPids, []); assert.ok(state.sharedFileOwnerPids.includes(child.pid!));
    const h = harness(valid); h.deps.inspectApp = () => inspectDiagnosticApp(paths);
    await assert.rejects(executeSourceIdDiagnostic(h.manifest, h.deps), /Stop the local application/); assert.equal(h.counts().providerCreations, 0); assert.equal(h.counts().outputCreations, 0); assert.equal(h.bodies.length, 0);
  } finally { if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; } rmSync(directory, { recursive: true, force: true }); }
});

test('live application ownership locks fail closed independently of ports, and malformed locks are not deleted', () => {
  const { directory, paths } = temporaryAppPaths();
  try {
    writeFileSync(paths.appDbPath + '.lock', String(process.pid));
    const state = inspectDiagnosticApp(paths); assert.equal(state.stopped, false); assert.deepEqual(state.activeLockPids, [process.pid]);
    writeFileSync(paths.appDbPath + '.lock', 'not-a-pid'); assert.throws(() => inspectDiagnosticApp(paths), /lock is malformed/); assert.equal(readFileSync(paths.appDbPath + '.lock', 'utf8'), 'not-a-pid');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
