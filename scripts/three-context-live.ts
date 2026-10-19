import { threeContextLiveCli } from '../server/three-context-live.ts';
try { console.log(JSON.stringify(await threeContextLiveCli(process.argv.slice(2)))); }
catch { console.error('Three-context execution stopped. No retry, resume or activation was attempted.'); process.exitCode = 1; }
