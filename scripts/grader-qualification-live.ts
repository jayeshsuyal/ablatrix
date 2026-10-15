import assert from 'node:assert/strict';
import { isAbsolute, resolve } from 'node:path';
import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { executeLiveQualification, prepareLiveQualification, verifyLiveQualification, verifyLiveQualificationPlanFile } from '../server/grader-qualification-live-runner.ts';

// This capability is module-local runtime metadata, not caller input. An
// importing module cannot turn another module's import.meta.main into true.
// The launcher removes preloads before Node starts; native TS avoids loaders.
// Current env/argv checks detect mislaunches; they cannot attest a process that
// was already compromised by a preload. The reviewed launcher/trusted host is
// an explicit external precondition, not inferred from absent env variables.
export const NATIVE_QUALIFICATION_ENTRY = import.meta.main === true &&
  process.execArgv.length === 1 && process.execArgv[0] === '--experimental-transform-types' &&
  !process.env.NODE_OPTIONS && !process.env.NODE_PATH;
if (NATIVE_QUALIFICATION_ENTRY) {
  // The clean standalone program imports only its reviewed dependency graph.
  // Lock the built-ins implicated by review before any execution/async work.
  for (const value of [childProcess, http, https, tls, http.Agent.prototype, https.Agent.prototype, http.ClientRequest.prototype]) Object.freeze(value);
}

function absolutePath(path: string) {
  assert.ok(isAbsolute(path) && resolve(path) === path, 'Use an absolute canonical qualification artifact path.');
  return path;
}

async function offline<T>(operation: () => T | Promise<T>): Promise<T> {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Network transport is forbidden during qualification preparation, verification and replay.'); };
  try { return await operation(); }
  finally { globalThis.fetch = saved; }
}

/** The CLI never loads .env. The reviewed runner owns all execution approval gates. */
export async function runQualificationLiveCli(argv: string[]) {
  if (!argv.length) return { usage: 'node --import tsx scripts/grader-qualification-live.ts --prepare|--verify; sh scripts/grader-qualification-native.sh --replay --plan <absolute-plan.json> | --execute --plan <absolute-plan.json> --acknowledged-plan-sha256 <SHA>', execution: 'help_only', liveProviderCalls: 0, financialApproval: 'not_granted' };
  const command = argv[0];
  assert.ok(['--prepare', '--verify', '--replay', '--execute'].includes(command), 'Unknown live qualification command.');
  const flags = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    assert.ok(argv[index]?.startsWith('--') && argv[index + 1] && !argv[index + 1].startsWith('--') && !flags.has(argv[index]), 'Flags require unique explicit values.');
    flags.set(argv[index], argv[index + 1]);
  }
  const expected = command === '--prepare' ? ['--implementation-commit', '--out'] : command === '--execute' ? ['--plan', '--acknowledged-plan-sha256'] : ['--plan'];
  assert.deepEqual([...flags.keys()].sort(), expected.sort(), 'Unknown or missing live qualification flag.');
  const flag = (name: string) => { const value = flags.get(name); assert.ok(value); return value; };
  if (command === '--prepare') {
    const implementationCommit = flag('--implementation-commit'); assert.match(implementationCommit, /^[a-f0-9]{40}$/, 'Use an exact implementation commit SHA.');
    const out = absolutePath(flag('--out'));
    return offline(() => prepareLiveQualification({ implementationCommit, out }));
  }
  const planPath = absolutePath(flag('--plan'));
  if (command === '--verify') return offline(() => verifyLiveQualificationPlanFile(planPath));
  if (command === '--replay') return offline(() => verifyLiveQualification(planPath));
  const acknowledgedPlanSha256 = flag('--acknowledged-plan-sha256');
  assert.match(acknowledgedPlanSha256, /^[a-f0-9]{64}$/, 'Execution requires the exact acknowledged plan SHA256.');
  return executeLiveQualification({ planPath, acknowledgedPlanSha256 });
}

if (import.meta.main === true) {
  try {
    const result = await runQualificationLiveCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (process.argv[2] === '--execute' && result && typeof result === 'object' && 'stopped' in result && result.stopped === true) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Live qualification command failed.'}\n`);
    process.exitCode = 1;
  }
}
