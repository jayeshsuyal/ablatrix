import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SapiomFeedbackProvider } from './feedback-provider.ts';
import { qualificationHash, rehearseQualification } from './grader-qualification.ts';
import { QUALIFICATION_LIVE_CODE_FILES, assertLiveQualificationStartingLedger, defaultLiveQualificationScope, inspectLiveQualificationBoundary, readLiveQualificationLedger, readLiveQualificationReceipts, type LiveQualificationBoundary, type LiveQualificationScope } from './grader-qualification-live-boundary.ts';
import { executeLiveQualification, executeQualificationMechanics, verifyLiveQualification, verifyLiveQualificationPlanFile } from './grader-qualification-live-runner.ts';
import { prepareQualificationLivePlan, readQualificationLiveSources, type QualificationLiveApproval, type QualificationLivePlan } from './grader-qualification-live.ts';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = readQualificationLiveSources(repository);
const implementationCommit = 'a'.repeat(40);
const codeFileSha256 = Object.fromEntries(QUALIFICATION_LIVE_CODE_FILES.map(path => [path, qualificationHash(`SYNTHETIC mocked code identity: ${path}`)]));
const outputs = rehearseQualification(sources.bundle, { implementationCommit: sources.bundle.plan.implementationCommit, codeFileSha256: sources.bundle.plan.codeFileSha256 }).slots.map(slot => {
  const { units, questionCoverage, answerability, correctness, uncertaintyHandling, reason } = slot.assessment!;
  return structuredClone({ units, questionCoverage, answerability, correctness, uncertaintyHandling, reason });
});
function response(index: number, output: unknown = outputs[index]) {
  return new Response(JSON.stringify({ model: 'gpt-luna', usage: { prompt_tokens: 100, completion_tokens: 60 }, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: 'claim_support_v1', arguments: JSON.stringify(output) } }] } }] }));
}
function approval(plan: QualificationLivePlan): QualificationLiveApproval {
  const body = { format: 'grader-qualification-user-approval-v1' as const, executionPlanSha256: plan.executionPlanSha256, budget: structuredClone(plan.budget), authorizationSource: 'direct_user_response' as const, userResponse: 'SYNTHETIC isolated-test authorization; no real dispatch authority.', recordedAt: '2026-10-15T23:01:00.000Z' };
  return { ...body, approvalSha256: qualificationHash(body) };
}
function setup(t: TestContext) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-qualification-runner-'))), budgetPath = join(directory, 'shared.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const db = new DatabaseSync(budgetPath);
  try {
    db.exec(`CREATE TABLE loop_provider_calls(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,kind TEXT NOT NULL,allowance_usd REAL NOT NULL,status TEXT NOT NULL,model TEXT,input_tokens INTEGER,output_tokens INTEGER,run_id TEXT,error_code TEXT,receipt_json TEXT);
      CREATE TABLE loop_provider_owner(id INTEGER PRIMARY KEY,pid INTEGER,token TEXT,expires_at INTEGER);`);
    const insert = db.prepare('INSERT INTO loop_provider_calls(id,created_at,kind,allowance_usd,status,run_id) VALUES(?,?,?,?,?,?)');
    for (let index = 0; index < 102; index++) insert.run(`synthetic-history-${index}`, '2026-10-15T00:00:00.000Z', 'synthetic_metadata_only', .1, 'completed', `synthetic-old-run-${index}`);
  } finally { db.close(); }
  const initial = readLiveQualificationLedger(budgetPath);
  const scope: LiveQualificationScope = { repositoryPath: directory, budgetPath, reviewPath: join(directory, 'review.sqlite'), appDbPath: join(directory, 'app.sqlite'), loopDbPath: join(directory, 'loop.sqlite'), workspaceDbPath: join(directory, 'workspace.sqlite'), runtimePolicyDbPath: join(directory, 'policy.sqlite'), claimDirectory: join(directory, '.data/grader-qualification-live-claims'), configuredPort: '4194', initiatingThreadId: defaultLiveQualificationScope().initiatingThreadId, executionAuthority: 'parent_execution_only', ledgerInitialSha256: initial.initialSha256 };
  const plan = prepareQualificationLivePlan({ sources, implementationCommit, codeFileSha256, callerScope: scope, artifactDirectory: join(directory, 'docs/evidence/mocked-runner'), createdAt: '2026-10-15T23:00:00.000Z' });
  const options = { plan, sources, planFileSha256: qualificationHash(JSON.stringify(plan)), approval: approval(plan) };
  let factoryCalls = 0, transportCalls = 0, preflightDone = false, providerClosed = false;
  const boundaries: LiveQualificationBoundary[] = [];
  type Dependencies = Parameters<typeof executeQualificationMechanics>[1];
  const dependencies: Dependencies = {
    preflight() { assertLiveQualificationStartingLedger(readLiveQualificationLedger(budgetPath)); preflightDone = true; },
    inspect(boundary) {
      boundaries.push(structuredClone(boundary));
      inspectLiveQualificationBoundary(scope, boundary, { expectedScope: { repositoryPath: directory, budgetPath }, inspectWorkers: () => undefined as never });
    },
    createProvider(hooks) {
      factoryCalls++; assert.ok(preflightDone); assert.ok(boundaries.length >= 2); assert.equal(transportCalls, 0);
      const provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'SYNTHETIC explicit fake key', credentialsFile: '', dbPath: budgetPath, callLimit: 194, capUsd: 20, priorSpendUsd: .200281, allowancePerCallUsd: .1, ...hooks });
      return { executionMode: provider.executionMode, capacity: provider.capacity.bind(provider), gradeClaimSupport: provider.gradeClaimSupport.bind(provider), receipt: provider.receipt.bind(provider), close() { provider.close(); providerClosed = true; } };
    },
    async transport(url, init) {
      const slot = plan.slots[transportCalls]; transportCalls++;
      assert.equal(url, 'https://router.sapiom.ai/v1/chat/completions'); assert.equal(init?.redirect, 'error'); assert.ok(init?.signal); assert.equal(init.method, 'POST');
      assert.equal(init.body, JSON.stringify(sources.bundle.requests[slot.index].requestBody));
      const ledger = readLiveQualificationLedger(budgetPath); assert.equal(ledger.attempts, 102 + transportCalls); assert.equal(ledger.pending, 1); assert.equal(ledger.rows.at(-1)?.runId, slot.runId); assert.equal(ledger.rows.at(-1)?.status, 'pending'); assert.equal(ledger.initialSha256, initial.initialSha256);
      return response(slot.index);
    },
    receipts() { return readLiveQualificationReceipts(scope, plan.slots.map(slot => slot.runId)); }
  };
  return { directory, budgetPath, initial, scope, plan, options, dependencies, boundaries, counts: () => ({ factoryCalls, transportCalls, preflightDone, providerClosed }) };
}

test('mechanics executes exactly 92 reserved frozen calls and cannot issue qualification or public records', async t => {
  const f = setup(t), result = await executeQualificationMechanics(f.options, f.dependencies);
  assert.equal(result.stopped, false); assert.deepEqual(f.counts(), { factoryCalls: 1, transportCalls: 92, preflightDone: true, providerClosed: true });
  assert.equal(result.result.gatePassed, true); assert.equal(result.result.metrics.primary.valid, 80); assert.equal(result.result.metrics.primary.fullAxisMatches, 80); assert.equal(result.result.metrics.repeats.valid, 12); assert.equal(result.result.metrics.repeats.stable, 12);
  assert.deepEqual(result.result.metrics.primary.flawed, { denominator: 60, rawPasses: 0 }); assert.deepEqual(result.result.metrics.primary.acceptable, { denominator: 20, dispositionMatches: 20 });
  assert.equal(result.result.accounting.observedTransportCount, 92); assert.equal(result.result.accounting.reservedPlanningAllowanceUsd, 9.2);
  assert.equal(result.transportProvenance, 'mocked_mechanics_only'); assert.equal(result.qualified, false); assert.equal(result.result.qualified, false); assert.equal(result.productionActivationQualified, false); assert.equal(result.qualityClaimEligible, false);
  assert.ok(result.journal.records.every(record => record.transportProvenance === 'mocked_mechanics_only' && record.authority === 'mocked_mechanics_only'));
  assert.equal(result.journal.records.filter(record => record.kind === 'slot_reserved').length, 92); assert.equal(result.journal.records.at(-1)?.kind, 'finished');
  assert.equal(existsSync(f.plan.paths.reportPath), false); assert.equal(existsSync(f.plan.paths.recordPath), false);
  const ledger = readLiveQualificationLedger(f.budgetPath); assert.equal(ledger.attempts, 194); assert.equal(ledger.reservedUsd, 19.4); assert.equal(ledger.pending, 0); assert.equal(ledger.activeOwners, 0); assert.equal(ledger.initialSha256, f.initial.initialSha256);
  await assert.rejects(executeQualificationMechanics(f.options, f.dependencies), /Shared ledger differs|already attempted|consumed/); assert.equal(f.counts().factoryCalls, 1); assert.equal(f.counts().transportCalls, 92);
});

test('invalid and unknown provider outcomes stop once and preserve all unattempted slots', async t => {
  for (const outcome of ['invalid', 'unknown'] as const) await t.test(outcome, async sub => {
    const f = setup(sub), original = f.dependencies.transport; let actualCalls = 0;
    f.dependencies.transport = async (url, init) => { actualCalls++; if (outcome === 'unknown') throw new Error('SYNTHETIC transport uncertainty'); await original(url, init); return response(0, { ...outputs[0], units: [] }); };
    const result = await executeQualificationMechanics(f.options, f.dependencies);
    assert.equal(actualCalls, 1); assert.equal(result.stopped, true); assert.equal(result.result.slots[0].status, outcome); assert.equal(result.result.metrics.unattempted, 91);
    assert.equal(result.result.slots.length, 92); assert.equal(result.result.metrics.primary.planned, 80); assert.equal(result.result.metrics.primary.flawed.denominator, 60); assert.equal(result.result.metrics.primary.acceptable.denominator, 20); assert.equal(result.result.metrics.repeats.planned, 12);
    assert.equal(result.result.accounting.reservedSlots, 1); assert.equal(result.result.accounting.reservedPlanningAllowanceUsd, .1); assert.ok(result.stopReasons.includes('invalid_or_unknown_outcome')); assert.equal(result.result.gatePassed, false); assert.equal(result.qualified, false); assert.equal(readLiveQualificationLedger(f.budgetPath).attempts, 103);
  });
});

test('a useful-answer or critical-axis failure stops at the first frozen offending case', async t => {
  const target = sources.bundle.plan.slots.find(slot => slot.role === 'primary' && slot.category === 'partial_coverage')!;
  const f = setup(t), transport = f.dependencies.transport;
  f.dependencies.transport = async (url, init) => { const result = await transport(url, init); if (f.counts().transportCalls !== target.index + 1) return result; return response(target.index, { ...outputs[target.index], questionCoverage: 'complete' }); };
  const result = await executeQualificationMechanics(f.options, f.dependencies);
  assert.equal(f.counts().transportCalls, target.index + 1); assert.equal(result.result.metrics.primary.flawed.rawPasses, 1); assert.equal(result.result.metrics.unattempted, 91 - target.index); assert.ok(result.stopReasons.includes('flawed_raw_pass')); assert.ok(result.stopReasons.includes('critical_axis_mismatch')); assert.equal(result.stopped, true); assert.equal(result.qualified, false);
});

test('exact URL, body, once-only transport and once-only reservation guards cannot be bypassed', async t => {
  for (const violation of ['wrong_url', 'wrong_body', 'twice_transport', 'twice_reservation'] as const) await t.test(violation, async sub => {
    const f = setup(sub), create = f.dependencies.createProvider;
    f.dependencies.createProvider = hooks => {
      const wrapped: typeof hooks = {
        operationGuard: async operation => { await hooks.operationGuard(operation); if (violation === 'twice_reservation' && operation.phase === 'before_reservation') await hooks.operationGuard(operation); },
        fetchImpl: async (url, init) => {
          if (violation === 'wrong_url') return hooks.fetchImpl('https://example.invalid/unapproved', init);
          if (violation === 'wrong_body') return hooks.fetchImpl(url, { ...init, body: JSON.stringify({ unexpected: 'SYNTHETIC mutation' }) });
          const value = await hooks.fetchImpl(url, init); if (violation === 'twice_transport') await hooks.fetchImpl(url, init); return value;
        }
      };
      return create(wrapped);
    };
    const result = await executeQualificationMechanics(f.options, f.dependencies);
    assert.equal(f.counts().transportCalls, violation === 'twice_transport' ? 1 : 0); assert.equal(result.result.metrics.primary.valid, 0); assert.equal(result.result.metrics.unattempted, 91); assert.equal(result.stopped, true); assert.equal(result.qualified, false);
    assert.equal(readLiveQualificationLedger(f.budgetPath).attempts, violation === 'twice_reservation' ? 102 : 103);
  });
});

test('a surviving dataset claim rejects a different plan before constructing any provider', async t => {
  const f = setup(t); f.dependencies.transport = async () => response(0, { ...outputs[0], units: [] });
  await executeQualificationMechanics(f.options, f.dependencies);
  rmSync(f.plan.paths.checkpointPath);
  const next = prepareQualificationLivePlan({ sources, implementationCommit, codeFileSha256, callerScope: f.scope, artifactDirectory: join(f.directory, 'docs/evidence/different-plan'), createdAt: '2026-10-15T23:02:00.000Z' });
  assert.notEqual(next.executionPlanSha256, f.plan.executionPlanSha256);
  let factories = 0;
  const dependencies = { ...f.dependencies, preflight() {}, inspect() {}, receipts() { return {}; }, createProvider(hooks: Parameters<typeof f.dependencies.createProvider>[0]) { factories++; return f.dependencies.createProvider(hooks); } };
  await assert.rejects(executeQualificationMechanics({ ...f.options, plan: next, approval: approval(next) }, dependencies), /consumed/);
  assert.equal(factories, 0); assert.equal(readLiveQualificationLedger(f.budgetPath).attempts, 103);
});

test('the body-consumption boundary catches changes before parsing or committing a valid grade', async t => {
  const f = setup(t), inspect = f.dependencies.inspect, transport = f.dependencies.transport; let bodyConsumed = false;
  f.dependencies.transport = async (url, init) => {
    const result = await transport(url, init), bytes = new Uint8Array(await result.arrayBuffer());
    return new Response(new ReadableStream<Uint8Array>({ pull(controller) { bodyConsumed = true; controller.enqueue(bytes); controller.close(); } }, { highWaterMark: 0 }), { status: 200 });
  };
  f.dependencies.inspect = async boundary => { await inspect(boundary); if (bodyConsumed) throw new Error('SYNTHETIC boundary mutation during streamed body read'); };
  const result = await executeQualificationMechanics(f.options, f.dependencies);
  assert.equal(bodyConsumed, true); assert.equal(f.counts().transportCalls, 1); assert.equal(result.result.metrics.primary.valid, 0); assert.equal(result.result.metrics.unattempted, 91); assert.equal(result.stopped, true); assert.ok(result.stopReasons.includes('after_operation_boundary_failed')); assert.equal(result.result.gatePassed, false); assert.equal(result.qualified, false);
});

test('oversized streamed provider bodies are cancelled and stop after one reserved call', async t => {
  const f = setup(t), transport = f.dependencies.transport; let cancelled = false;
  f.dependencies.transport = async (url, init) => { await transport(url, init); return new Response(new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(128 * 1024 + 1)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 }), { status: 200 }); };
  const result = await executeQualificationMechanics(f.options, f.dependencies);
  assert.equal(cancelled, true); assert.equal(f.counts().transportCalls, 1); assert.equal(result.result.metrics.primary.valid, 0); assert.equal(result.result.metrics.unattempted, 91); assert.equal(result.result.accounting.reservedPlanningAllowanceUsd, .1); assert.equal(result.stopped, true); assert.equal(result.qualified, false);
});

test('a failed final boundary prevents completion after all 92 otherwise valid grades', async t => {
  const f = setup(t), inspect = f.dependencies.inspect;
  f.dependencies.inspect = async boundary => { await inspect(boundary); if (f.counts().providerClosed) throw new Error('SYNTHETIC final scan failure'); };
  const result = await executeQualificationMechanics(f.options, f.dependencies);
  assert.equal(f.counts().transportCalls, 92); assert.equal(result.result.metrics.primary.valid, 80); assert.equal(result.result.metrics.repeats.valid, 12); assert.equal(result.result.gates.allSlotsValid, true); assert.equal(result.result.gates.completeExecution, false);
  assert.equal(result.stopped, true); assert.deepEqual(result.stopReasons, ['before_publication_boundary_failed']); assert.equal(result.journal.records.at(-1)?.kind, 'stopped'); assert.equal(result.result.gatePassed, false); assert.equal(result.qualified, false); assert.equal(existsSync(f.plan.paths.recordPath), false);
});

test('production execute and verifiers reject a caller-selected temp scope before provider or network use', async t => {
  const f = setup(t), planPath = join(f.directory, 'execution-plan-v1.json'); writeFileSync(planPath, JSON.stringify(f.plan), { mode: 0o600 });
  const before = readFileSync(planPath), savedFetch = globalThis.fetch; let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error('SYNTHETIC unexpected network access'); };
  t.after(() => { globalThis.fetch = savedFetch; });
  assert.throws(() => verifyLiveQualificationPlanFile(planPath), /canonical production scope/);
  assert.throws(() => verifyLiveQualification(planPath), /canonical production scope/);
  await assert.rejects(executeLiveQualification({ planPath, acknowledgedPlanSha256: f.plan.executionPlanSha256 }), /canonical production scope/);
  assert.equal(fetchCalls, 0); assert.equal(f.counts().factoryCalls, 0); assert.equal(readLiveQualificationLedger(f.budgetPath).attempts, 102); assert.deepEqual(readFileSync(planPath), before); assert.equal(existsSync(f.plan.paths.checkpointPath), false);
});
