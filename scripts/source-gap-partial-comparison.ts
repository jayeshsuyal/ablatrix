import { sourceGapPartialComparisonCli } from '../server/source-calibration-comparison.ts';
try { console.log(JSON.stringify(await sourceGapPartialComparisonCli(process.argv.slice(2)))); }
catch { console.error('Source-exposed exploratory comparison stopped. No retry or replacement was attempted.'); process.exitCode = 1; }
