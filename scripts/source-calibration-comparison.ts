import { sourceCalibrationComparisonCli } from '../server/source-calibration-comparison.ts';
try { console.log(JSON.stringify(await sourceCalibrationComparisonCli(process.argv.slice(2)))); }
catch { console.error('Source calibration preparation or execution stopped. No retry or resume was attempted; inspect the private checkpoint if present.'); process.exitCode = 1; }
