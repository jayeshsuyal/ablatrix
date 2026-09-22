import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { ZodError } from 'zod';
import { researchInput } from './contracts.ts';
import { RunStore } from './store.ts';
import { publicTasks, taskForRun, report } from './evaluation.ts';
import { executeResearch } from './research.ts';
import { ExperimentRunner } from './experiments.ts';
import { OptimizationRunner } from './optimizations.ts';
import { comparison, exportArtifacts } from './comparison.ts';

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}
function download(res: ServerResponse, filename: string, value: string, mime: string): void {
  res.writeHead(200, {
    'content-type': `${mime}; charset=utf-8`, 'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff'
  });
  res.end(value);
}

async function body(req: IncomingMessage): Promise<unknown> {
  let text = '';
  for await (const chunk of req) {
    text += chunk.toString();
    if (text.length > 16_384) throw new Error('Request body too large');
  }
  return JSON.parse(text || '{}') as unknown;
}

export function createApp(store: RunStore, mode: 'fixture' | 'live' = 'fixture') {
  const runner = new ExperimentRunner(store, mode);
  const optimizer = new OptimizationRunner(store, runner, mode);
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/api/health') return json(res, 200, { ok: true, mode });
      if (req.method === 'GET' && path === '/api/runs') return json(res, 200, { runs: store.list() });
      if (req.method === 'GET' && path === '/api/tasks') return json(res, 200, publicTasks());
      if (req.method === 'GET' && path === '/api/report') return json(res, 200, report(store.list()));
      if (req.method === 'GET' && path === '/api/experiments') return json(res, 200, { experiments: store.listExperiments() });
      if (req.method === 'GET' && path === '/api/optimizations') return json(res, 200, { optimizations: optimizer.list() });
      if (req.method === 'POST' && path === '/api/optimizations') return json(res, 201, await optimizer.create(await body(req)));
      if (req.method === 'GET' && /^\/api\/optimizations\/[a-f0-9-]{36}\/comparison$/.test(path)) {
        const record = store.getOptimization(path.split('/')[3]);
        return json(res, record ? 200 : 404, record ? comparison(optimizer.refresh(record), store) : { error: 'Optimization not found' });
      }
      if (req.method === 'GET' && /^\/api\/optimizations\/[a-f0-9-]{36}\/export$/.test(path)) {
        const id = path.split('/')[3];
        const record = store.getOptimization(id);
        if (!record) return json(res, 404, { error: 'Optimization not found' });
        const artifacts = exportArtifacts(optimizer.refresh(record), store);
        const format = url.searchParams.get('format') ?? 'bundle';
        if (format === 'original') return download(res, 'research.baseline.json', artifacts.original, 'application/json');
        const label = record.decision === 'accepted' ? 'candidate' : 'unvalidated-candidate';
        if (format === 'candidate') return download(res, `research.${label}.json`, artifacts.candidate, 'application/json');
        if (format === 'patch') return download(res, `research.${label}.patch`, artifacts.patch, 'text/plain');
        if (format === 'manifest') return download(res, 'reproducibility.json', `${JSON.stringify(artifacts.manifest, null, 2)}\n`, 'application/json');
        if (format === 'bundle') return download(res, 'ablatrix-export.json', `${JSON.stringify(artifacts, null, 2)}\n`, 'application/json');
        return json(res, 400, { error: 'Unknown export format' });
      }
      if (req.method === 'POST' && path === '/api/experiments') return json(res, 201, runner.create(await body(req)));
      if (req.method === 'GET' && /^\/api\/experiments\/[a-f0-9-]{36}$/.test(path)) {
        const record = store.getExperiment(path.slice('/api/experiments/'.length));
        return json(res, record ? 200 : 404, record ?? { error: 'Experiment not found' });
      }
      if (req.method === 'POST' && /^\/api\/experiments\/[a-f0-9-]{36}\/cancel$/.test(path)) {
        const id = path.split('/')[3];
        const record = runner.cancel(id);
        return json(res, record ? 200 : 404, record ?? { error: 'Experiment not found' });
      }
      if (req.method === 'GET' && /^\/api\/runs\/[a-f0-9-]{36}$/.test(path)) {
        const run = store.get(path.slice('/api/runs/'.length));
        return json(res, run ? 200 : 404, run ?? { error: 'Run not found' });
      }
      if (req.method === 'POST' && path === '/api/runs') {
        if (mode === 'live') return json(res, 403, { error: 'Direct live runs are disabled until metering is available; use a bounded experiment.' });
        const input = researchInput.parse(await body(req));
        const benchmarkTask = input.taskId ? taskForRun(input.taskId) : null;
        if (input.taskId && input.taskId.endsWith('-v1') && !benchmarkTask) return json(res, 400, { error: 'Unknown benchmark task' });
        if (benchmarkTask && (benchmarkTask.entity !== input.entity || benchmarkTask.question !== input.question)) {
          return json(res, 400, { error: 'Benchmark task input does not match its versioned definition' });
        }
        const run = await executeResearch(store, input, mode);
        return json(res, run.status === 'completed' ? 201 : 502, run);
      }
      if (req.method === 'GET' && !path.startsWith('/api/')) {
        const root = resolve('dist');
        const file = path === '/' ? join(root, 'index.html') : resolve(root, `.${path}`);
        if (!file.startsWith(`${root}/`) && file !== root) return json(res, 404, { error: 'Not found' });
        const target = existsSync(file) ? file : join(root, 'index.html');
        const contents = await readFile(target);
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(target)] ?? 'application/octet-stream';
        res.writeHead(200, { 'content-type': `${mime}; charset=utf-8` });
        return res.end(contents);
      }
      return json(res, 404, { error: 'Not found' });
    } catch (error) {
      const status = error instanceof ZodError || error instanceof SyntaxError || error instanceof Error && /task|budget|Duplicate|queue is halted|baseline experiment|allowlisted/.test(error.message) ? 400 : 500;
      return json(res, status, { error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
}
