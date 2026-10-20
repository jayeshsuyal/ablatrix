import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { freezeReportUncertaintyDevelopment, replayReportUncertaintyDevelopment, verifyReportUncertaintyDevelopment } from '../server/report-uncertainty-development.ts';

const [mode, ...args] = process.argv.slice(2);
if (!mode) console.log(JSON.stringify({ usage: '--freeze NEW_FREEZE NEW_POLICY_FREEZE | --run FREEZE NEW_RESULT | --verify FREEZE RESULT', providerCalls: 0, freshInputReads: 0 }));
else if (mode === '--freeze') { assert.equal(args.length, 2); console.log(JSON.stringify(freezeReportUncertaintyDevelopment(args[0]!, args[1]!))); }
else if (mode === '--run') {
  assert.equal(args.length, 2); const result = await replayReportUncertaintyDevelopment(args[0]!);
  writeFileSync(resolve(args[1]!), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify(result.summary));
} else if (mode === '--verify') {
  assert.equal(args.length, 2); const result = await verifyReportUncertaintyDevelopment(JSON.parse(readFileSync(args[1]!, 'utf8')), args[0]!);
  console.log(JSON.stringify({ verified: true, summary: result.summary, providerCalls: 0, freshInputReads: 0 }));
} else throw new Error('Choose a supported offline mode.');
