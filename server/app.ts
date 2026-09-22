import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { researchInput, researchOutput, type RunRecord } from './contracts.ts';
import { runFixture } from './fixture.ts';
import { runSapiom } from './sapiom.ts';
import { RunStore } from './store.ts';

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
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
  return createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/api/health') return json(res, 200, { ok: true, mode });
      if (req.method === 'GET' && path === '/api/runs') return json(res, 200, { runs: store.list() });
      if (req.method === 'GET' && /^\/api\/runs\/[a-f0-9-]{36}$/.test(path)) {
        const run = store.get(path.slice('/api/runs/'.length));
        return json(res, run ? 200 : 404, run ?? { error: 'Run not found' });
      }
      if (req.method === 'POST' && path === '/api/runs') {
        const input = researchInput.parse(await body(req));
        const now = Date.now();
        const run: RunRecord = {
          id: randomUUID(), taskId: input.taskId ?? randomUUID(), candidateId: 'baseline', mode,
          provider: mode === 'live' ? 'sapiom' : 'fixture', model: null, status: 'running',
          input, output: null, error: null, startedAt: new Date(now).toISOString(), finishedAt: null,
          durationMs: null, costUsd: null, costStatus: mode === 'live' ? 'unknown' : 'fixture', usage: null
        };
        store.save(run);
        try {
          const result = mode === 'live' ? await runSapiom(input, run.id) : { output: await runFixture(input), usage: {} };
          run.output = researchOutput.parse(result.output);
          run.usage = result.usage;
          run.status = 'completed';
        } catch (error) {
          run.error = error instanceof Error ? error.message : String(error);
          run.status = 'failed';
        }
        run.finishedAt = new Date().toISOString();
        run.durationMs = Date.now() - now;
        store.save(run);
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
      const status = error instanceof ZodError || error instanceof SyntaxError ? 400 : 500;
      return json(res, status, { error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
}
