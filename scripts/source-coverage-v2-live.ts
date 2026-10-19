import { sourceCoverageV2LiveCli } from '../server/source-coverage-v2-live.ts';
try { console.log(JSON.stringify(await sourceCoverageV2LiveCli(process.argv.slice(2)))); }
catch { console.error('Source coverage v2 stopped. No retry, resume or activation was attempted.'); process.exitCode = 1; }
