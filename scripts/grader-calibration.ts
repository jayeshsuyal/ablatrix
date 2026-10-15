import assert from 'node:assert/strict';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareCalibrationPlan, verifyCalibrationPlan, type CalibrationPlan } from '../server/grader-calibration.ts';
import { SapiomFeedbackProvider } from '../server/feedback-provider.ts';
import { executeGraderCalibration, verifyGraderCalibrationCheckpoint, type CalibrationExecutionOptions } from '../server/grader-calibration-runner.ts';
import { assertCalibrationMerged, assertCalibrationStartingLedger, calibrationCodeHashes, defaultCalibrationScope, inspectCalibrationExecutionBoundary,
  inspectCalibrationWorkers, readCalibrationLedgerState, readCalibrationReceipts, validateCalibrationScope, type CalibrationScope } from '../server/grader-calibration-boundary.ts';

function exclusiveJson(path: string, value: unknown, mode = 0o444) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const fd = openSync(path, 'wx', mode);
  try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
}
function privateCheckpoint(path: string, scope: CalibrationScope) {
  assert.ok(isAbsolute(path) && resolve(path) === path, 'Private checkpoint path must be canonical and absolute.');
  const root = resolve(scope.repositoryPath, '.data'), rel = relative(root, path);
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Live checkpoint must stay under this project private .data directory.');
  let current = dirname(path);
  while (!existsSync(current)) { const parent = dirname(current); assert.notEqual(parent, current); current = parent; }
  assert.equal(realpathSync(current), current, 'Checkpoint parents cannot traverse symlinks.');
}
function reportTarget(path: string) {
  assert.ok(isAbsolute(path) && resolve(path) === path, 'Report path must be canonical and absolute.');
  let current = dirname(path);
  while (!existsSync(current)) { const parent = dirname(current); assert.notEqual(parent, current); current = parent; }
  assert.equal(realpathSync(current), current, 'Report parents cannot traverse symlinks.');
  if (existsSync(path)) assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink());
}
async function runCalibrationCli(argv: string[]) {
  if (!argv.length) return { mode: 'offline', usage: 'grader:calibration --prepare|--verify|--replay|--execute; no command dispatches without --execute, independent opt-in, exact plan acknowledgement and full preflight.' };
  const command = argv[0]; assert.ok(['--prepare', '--verify', '--replay', '--execute'].includes(command), 'Unknown calibration mode.');
  const flags = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    assert.ok(argv[index]?.startsWith('--') && argv[index + 1] && !argv[index + 1].startsWith('--') && !flags.has(argv[index]), 'Calibration flags need unique explicit values.');
    flags.set(argv[index], argv[index + 1]);
  }
  const requireFlags = (required: string[], optional: string[] = []) => {
    assert.ok(required.every(flag => flags.has(flag)) && [...flags.keys()].every(flag => required.includes(flag) || optional.includes(flag)), 'Unknown or missing calibration flag.');
  };
  const flag = (name: string) => { const value = flags.get(name); assert.ok(value, `Missing ${name}.`); return value; };
  if (command === '--prepare') {
    requireFlags(['--implementation-commit', '--out'], ['--scope']);
    const scope = flags.has('--scope') ? JSON.parse(readFileSync(flag('--scope'), 'utf8')) as CalibrationScope : defaultCalibrationScope();
    validateCalibrationScope({ ...scope, ledgerInitialSha256: '0'.repeat(64) });
    const state = readCalibrationLedgerState(scope.budgetPath); assertCalibrationStartingLedger(state);
    scope.ledgerInitialSha256 = state.initialSha256; validateCalibrationScope(scope);
    const implementationCommit = flag('--implementation-commit');
    const plan = prepareCalibrationPlan({ implementationCommit, callerScope: scope, codeFileSha256: calibrationCodeHashes(implementationCommit), createdAt: new Date().toISOString() });
    exclusiveJson(flag('--out'), plan);
    return { mode: 'offline_preparation', out: resolve(flag('--out')), planSha256: plan.planSha256, slots: plan.slots.length, families: plan.families.length, newProviderCalls: 0, references: plan.referenceProvenance, budget: plan.budget };
  }
  if (command === '--verify') requireFlags(['--plan']);
  else if (command === '--replay') requireFlags(['--plan', '--checkpoint', '--report']);
  else requireFlags(['--plan', '--acknowledged-plan-sha256', '--checkpoint', '--report']);
  const plan = JSON.parse(readFileSync(flag('--plan'), 'utf8')) as CalibrationPlan;
  const scope = validateCalibrationScope(plan.callerScope);
  const verification = { callerScope: scope, implementationCommit: plan.implementationCommit, codeFileSha256: calibrationCodeHashes(plan.implementationCommit) };
  verifyCalibrationPlan(plan, verification);
  if (command === '--verify') return { mode: 'offline_plan_verification', planSha256: plan.planSha256, slots: plan.slots.length, newProviderCalls: 0, liveActivationQualified: false };
  const options: CalibrationExecutionOptions = { plan, execute: command === '--execute', liveOptIn: process.env.ABLATRIX_GRADER_CALIBRATION_LIVE === '1',
    acknowledgedPlanSha256: command === '--execute' ? flag('--acknowledged-plan-sha256') : plan.planSha256, ledgerPath: scope.budgetPath, claimDirectory: scope.claimDirectory,
    checkpointPath: flag('--checkpoint'), reportPath: flag('--report'), transportProvenance: 'live_router' };
  privateCheckpoint(options.checkpointPath, scope); reportTarget(options.reportPath);
  if (command === '--replay') {
    const state = readCalibrationLedgerState(scope.budgetPath); assert.equal(state.initialSha256, scope.ledgerInitialSha256, 'Historical shared receipts changed.');
    const result = verifyGraderCalibrationCheckpoint(options, { verification, readLedgerReceipts: readCalibrationReceipts });
    return { mode: 'read_only_checkpoint_replay', planSha256: plan.planSha256, savedReportPresent: existsSync(options.reportPath), complete: result.report.complete, accounting: result.report.accounting, metrics: result.report.metrics, newProviderCalls: 0, qualityClaimEligible: false };
  }
  // All static/environment/commit/OS/ledger checks occur before the provider
  // constructor can read its existing project credential. No .env is loaded.
  assert.equal(options.liveOptIn, true, 'Independent ABLATRIX_GRADER_CALIBRATION_LIVE=1 opt-in required.');
  assert.equal(options.acknowledgedPlanSha256, plan.planSha256, 'Parent must source-review the constructed references and acknowledge this exact plan.');
  const env = process.env;
  assert.equal(env.ABLATRIX_LOOP_LIVE, '1'); assert.equal(env.ABLATRIX_REVISION_WEB, '0');
  assert.equal(env.ABLATRIX_AUTOMATIC_CHECK_LIVE, '0'); assert.equal(env.ABLATRIX_ANSWER_POLICY_SHADOW_LIVE, '0'); assert.equal(env.ABLATRIX_LANGFUSE_ENABLED, '0');
  assert.equal(env.ABLATRIX_LOOP_CALL_LIMIT, '96');
  assert.equal(env.ABLATRIX_LOOP_BUDGET_DB, scope.budgetPath, 'Explicit shared ledger path must match the frozen caller.');
  assert.equal(Number(env.ABLATRIX_SPEND_CAP_USD), 10); assert.equal(Number(env.ABLATRIX_LOOP_PRIOR_SPEND_USD), .200281); assert.equal(Number(env.ABLATRIX_LOOP_ALLOWANCE_USD), .1);
  const result = await executeGraderCalibration(options, {
    verification,
    preflight() {
      assertCalibrationMerged(plan.implementationCommit, scope.repositoryPath);
      validateCalibrationScope(scope); calibrationCodeHashes(plan.implementationCommit);
      assertCalibrationStartingLedger(readCalibrationLedgerState(scope.budgetPath));
      const state = readCalibrationLedgerState(scope.budgetPath); assert.equal(state.initialSha256, scope.ledgerInitialSha256); assert.equal(state.activeOwners, 0, 'Another provider currently owns the shared ledger.');
      inspectCalibrationWorkers(scope);
    },
    inspectBoundary: boundary => { inspectCalibrationExecutionBoundary(plan, boundary); },
    createProvider: ({ fetchImpl, operationGuard }) => {
      // Recheck the existing schema/history after private intent creation and
      // before a credential-owning constructor can perform any initialization.
      const state = readCalibrationLedgerState(scope.budgetPath); assertCalibrationStartingLedger(state);
      assert.equal(state.initialSha256, scope.ledgerInitialSha256); assert.equal(state.activeOwners, 0);
      inspectCalibrationWorkers(scope); calibrationCodeHashes(plan.implementationCommit);
      return new SapiomFeedbackProvider({ enabled: true, dbPath: scope.budgetPath, callLimit: 96, capUsd: 10, priorSpendUsd: .200281, allowancePerCallUsd: .1, fetchImpl, operationGuard });
    },
    transport: globalThis.fetch, readLedgerReceipts: readCalibrationReceipts
  });
  if (result.stopped) process.exitCode = 1;
  return { mode: 'live_constructed_grader_pilot', planSha256: plan.planSha256, reportPath: result.reportPath, complete: result.report.complete, accounting: result.report.accounting, metrics: result.report.metrics, qualityClaimEligible: false };
}
export async function graderCalibrationCli(argv: string[]) {
  if (argv[0] === '--execute') return runCalibrationCli(argv);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Calibration preparation, verification and replay deny network access.'); };
  try { return await runCalibrationCli(argv); } finally { globalThis.fetch = originalFetch; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) graderCalibrationCli(process.argv.slice(2)).then(value => console.log(JSON.stringify(value))).catch(error => { console.error(error instanceof Error ? error.message : 'Calibration command failed.'); process.exitCode = 1; });
