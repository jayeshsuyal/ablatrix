/** Offline only; no environment loading, provider or execution mode. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reportDevelopmentFile } from '../server/report-uncertainty-development.ts';
import { qualifyReportCalibration, reportCalibrationFinancialProposal, verifyReportCalibrationOutcome } from '../server/report-calibration-qualification.ts';
const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
export async function qualifyReportCalibrationCli(argv: string[]) {
  if (!argv.length) return { usage: '--qualify --preparation PRIVATE --review-record FILE --review-sha256 HASH --out NEW_PRIVATE | --proposal --plan PRIVATE --out NEW | --verify-outcome PRIVATE', newProviderCalls: 0 };
  if (argv[0] === '--verify-outcome') { assert.equal(argv.length, 2); return verifyReportCalibrationOutcome(root, argv[1]!); }
  const [mode, ...rest] = argv, keys = mode === '--qualify' ? ['--preparation', '--review-record', '--review-sha256', '--out'] : mode === '--proposal' ? ['--plan', '--out'] : undefined; assert.ok(keys);
  const flags = new Map<string, string>(); for (let i = 0; i < rest.length; i += 2) { assert.ok(keys.includes(rest[i]!) && rest[i + 1] && !flags.has(rest[i]!)); flags.set(rest[i]!, rest[i + 1]!); } assert.equal(flags.size, keys.length);
  if (mode === '--qualify') return qualifyReportCalibration(root, flags.get('--preparation')!, flags.get('--review-record')!, flags.get('--review-sha256')!, flags.get('--out')!);
  const planPath = flags.get('--plan')!; assert.ok(planPath.startsWith('.data/')); const manifest = JSON.parse(readFileSync(reportDevelopmentFile(root, planPath), 'utf8'));
  const proposal = await reportCalibrationFinancialProposal(manifest, resolve(root, planPath)); const output = resolve(root, flags.get('--out')!), rel = relative(root, output);
  assert.ok((rel.startsWith('docs/evidence/') || rel.startsWith('.data/')) && !rel.split('/').includes('..') && !existsSync(output)); assert.equal(realpathSync(dirname(output)), dirname(output));
  writeFileSync(output, JSON.stringify(proposal, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); return { output, ...proposal };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) { try { console.log(JSON.stringify(await qualifyReportCalibrationCli(process.argv.slice(2)), null, 2)); } catch (e) { console.error(`Qualification stopped: ${e instanceof Error ? e.message : 'invalid input'}`); process.exitCode = 1; } }
