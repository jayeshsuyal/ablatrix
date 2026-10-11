import { sourceIdDiagnosticCli } from '../server/source-id-diagnostic.ts';
try { console.log(JSON.stringify(await sourceIdDiagnosticCli(process.argv.slice(2)))); }
catch (error) { console.error(error instanceof Error ? error.message : 'Diagnostic failed before completion.'); process.exitCode = 1; }
