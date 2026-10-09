import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import { ContextComparisonStore, createContextComparisonFixture } from './context-comparison.ts';

const usage = 'Usage: npm run compare -- <fixture|import|list|export> --db <sqlite path> [--packet <json path>] [--id <comparison id> --out <new json path>]';
let store: ContextComparisonStore | undefined;
try {
  const [command, ...args] = process.argv.slice(2);
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--db', '--packet', '--id', '--out'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || flags.has(args[i])) throw new Error(usage);
    flags.set(args[i], args[i + 1]);
  }
  if (!flags.get('--db') || !['fixture', 'import', 'list', 'export'].includes(command)) throw new Error(usage);
  const allowed = command === 'import' ? ['--db', '--packet'] : command === 'export' ? ['--db', '--id', '--out'] : ['--db'];
  if ([...flags.keys()].some(key => !allowed.includes(key)) || allowed.some(key => !flags.has(key))) throw new Error(usage);
  store = new ContextComparisonStore(resolve(flags.get('--db')!));
  if (command === 'fixture') console.log(JSON.stringify(store.importPacket(createContextComparisonFixture()), null, 2));
  if (command === 'list') console.log(JSON.stringify(store.list(), null, 2));
  if (command === 'import') {
    const packet = resolve(flags.get('--packet')!);
    if (!statSync(packet).isFile() || statSync(packet).size > 16 * 1024 * 1024) throw new Error('Comparison packet must be a JSON file of at most 16 MiB.');
    console.log(JSON.stringify(store.importPacket(JSON.parse(readFileSync(packet, 'utf8'))), null, 2));
  }
  if (command === 'export') {
    const evidence = store.exportPacket(flags.get('--id')!);
    const output = resolve(flags.get('--out')!);
    writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ output, note: 'Export preserves recorded provenance; it does not authenticate provider records or establish preregistration.' }));
  }
} catch (error) {
  console.error(error instanceof ZodError ? 'Invalid comparison packet fields.' : error instanceof Error ? error.message : 'Comparison command failed.');
  process.exitCode = 1;
} finally { store?.close(); }
