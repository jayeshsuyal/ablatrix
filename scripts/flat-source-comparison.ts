import { flatSourceComparisonCli } from '../server/flat-source-comparison.ts';
try { console.log(JSON.stringify(await flatSourceComparisonCli(process.argv.slice(2)))); }
catch { console.error('Comparison preparation or execution failed; no automatic retry. Inspect the private checkpoint when one exists.'); process.exitCode = 1; }
