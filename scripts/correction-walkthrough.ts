import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCorrectionWalkthrough } from '../server/correction-walkthrough.ts';

export async function writeCorrectionWalkthrough(output: string) {
  const bundle = await buildCorrectionWalkthrough();
  const path = resolve(output);
  writeFileSync(path, `${JSON.stringify(bundle, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return { path, bundle };
}

async function main() {
  const [flag, output, ...rest] = process.argv.slice(2);
  if (flag !== '--out' || !output || rest.length) throw new Error('Usage: node --import tsx scripts/correction-walkthrough.ts --out <new-file.json>');
  const { path, bundle } = await writeCorrectionWalkthrough(output);
  console.log(JSON.stringify({ path, planSha256: bundle.planSha256, preflightPassed: bundle.preflight.passed, newProviderCalls: 0, humanJudgments: 0, qualityClaimEligible: false }));
  if (!bundle.preflight.passed) { console.error('Walkthrough preflight differs from the planned routes. Inspect the saved report; no provider calls were made.'); process.exitCode = 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : 'Walkthrough failed.'); process.exitCode = 1; });
