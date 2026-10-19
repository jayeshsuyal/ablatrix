/** Offline only: no credential, environment-file, provider or execution mode. */
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { qualifyV5Development, threeContextFinancialProposal } from '../server/three-context-qualification.ts';
export function qualifyThreeContextCli(argv: string[]) {
  if (!argv.length) return { usage: '--qualify --preparation FILE --review-record FILE --review-sha256 HASH --out NEW_PRIVATE | --proposal --plan FILE --out NEW_PUBLIC', newProviderCalls: 0 };
  const root = realpathSync(fileURLToPath(new URL('../', import.meta.url))), [mode, ...rest] = argv;
  const keys = mode === '--qualify' ? ['--preparation', '--review-record', '--review-sha256', '--out'] : mode === '--proposal' ? ['--plan', '--out'] : null; assert.ok(keys);
  const flags = new Map<string, string>(); for (let i = 0; i < rest.length; i += 2) { assert.ok(keys.includes(rest[i]!) && rest[i + 1] && !rest[i + 1]!.startsWith('--') && !flags.has(rest[i]!)); flags.set(rest[i]!, rest[i + 1]!); } assert.equal(flags.size, keys.length);
  if (mode === '--qualify') return qualifyV5Development(root, flags.get('--preparation')!, flags.get('--review-record')!, flags.get('--review-sha256')!, flags.get('--out')!);
  const plan = resolve(root, flags.get('--plan')!), rel = relative(root, plan); assert.ok(rel.startsWith('.data/') && !isAbsolute(rel) && !rel.split('/').includes('..')); assert.ok(lstatSync(plan).isFile() && !lstatSync(plan).isSymbolicLink() && realpathSync(plan) === plan);
  const output = resolve(root, flags.get('--out')!), outputRel = relative(root, output); assert.ok(outputRel.startsWith('docs/evidence/') && !outputRel.split('/').includes('..') && !existsSync(output)); assert.equal(realpathSync(dirname(output)), dirname(output));
  const proposal = threeContextFinancialProposal(JSON.parse(readFileSync(plan, 'utf8')), plan); writeFileSync(output, JSON.stringify(proposal, null, 2) + '\n', { flag: 'wx' });
  return { mode: 'unexecuted_financial_proposal', output, privatePlanSha256: proposal.privatePlanSha256, budget: proposal.budget, newProviderCalls: 0, paidExecutionAuthorized: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) { try { console.log(JSON.stringify(qualifyThreeContextCli(process.argv.slice(2)))); } catch (e) { console.error(`Qualification stopped: ${e instanceof Error ? e.message : 'invalid input'}`); process.exitCode = 1; } }
