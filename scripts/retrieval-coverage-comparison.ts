import { retrievalCoverageComparisonCli } from '../server/source-calibration-comparison.ts';
try { console.log(JSON.stringify(await retrievalCoverageComparisonCli(process.argv.slice(2)))); }
catch { console.error('Retrieval coverage preparation or execution stopped. No retry or resume was attempted; inspect the private checkpoint if present.'); process.exitCode = 1; }
