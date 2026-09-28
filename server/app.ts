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
import { SapiomLiveProvider, type MeteredLiveProvider } from './live-provider.ts';
import { finalHoldoutAssessment, runFinalFixtureHoldout } from './holdout.ts';
import { PilotRunner, PilotStore } from './pilot.ts';
import { FeedbackLoop } from './feedback-loop.ts';
import { loadFinalProductCorpus, loadProductCorpus } from './product-corpus.ts';
import { ProductRetriever } from './product-retrieval.ts';
import { SapiomFeedbackProvider } from './feedback-provider.ts';
import { LoopTelemetry } from './loop-telemetry.ts';
import { ProductWorkspace } from './product-workspace.ts';

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

async function body(req: IncomingMessage, maxLength = 16_384): Promise<unknown> {
  let text = '';
  for await (const chunk of req) {
    text += chunk.toString();
    if (text.length > maxLength) throw new Error('Request body too large');
  }
  return JSON.parse(text || '{}') as unknown;
}

export function createApp(store: RunStore, mode: 'fixture' | 'live' = 'fixture', provider: MeteredLiveProvider = new SapiomLiveProvider(), pilot = new PilotRunner(new PilotStore()), feedback?: FeedbackLoop, telemetry?: LoopTelemetry, workspace?: ProductWorkspace) {
  const runner = new ExperimentRunner(store, mode, provider);
  const optimizer = new OptimizationRunner(store, runner, mode, provider);
  let feedbackProvider: SapiomFeedbackProvider | undefined;
  const localAnswerProvider = () => {
    if (!feedbackProvider) feedbackProvider = new SapiomFeedbackProvider();
    return feedbackProvider;
  };
  const productWorkspace = () => workspace ??= new ProductWorkspace(process.env.ABLATRIX_WORKSPACE_DB, localAnswerProvider());
  const loopTelemetry = () => telemetry ??= new LoopTelemetry();
  const feedbackLoop = () => {
    if (!feedback) {
      const corpus = loadProductCorpus();
      const finalCorpus = loadFinalProductCorpus();
      const nextProvider = localAnswerProvider();
      let nextRetriever: ProductRetriever | undefined;
      let nextFinalRetriever: ProductRetriever | undefined;
      let nextLoop: FeedbackLoop | undefined;
      try {
        nextRetriever = new ProductRetriever(corpus, process.env.ABLATRIX_RETRIEVAL_DB);
        nextFinalRetriever = new ProductRetriever(finalCorpus, process.env.ABLATRIX_FINAL_RETRIEVAL_DB ?? '.data/product-final-retrieval.sqlite');
        nextLoop = new FeedbackLoop(corpus, nextRetriever, nextProvider, process.env.ABLATRIX_LOOP_DB, finalCorpus, nextFinalRetriever);
        nextProvider.recoverInterruptedCalls();
        feedback = nextLoop;
      } catch (error) {
        if (nextLoop) nextLoop.close();
        else { nextRetriever?.close(); nextFinalRetriever?.close(); }
        throw error;
      }
    }
    return feedback;
  };
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? '';
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json(res, 403, { error: 'Local host required.' });
      if (req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin) {
          let originHost = '';
          try { const parsed = new URL(origin); if (parsed.protocol === 'http:') originHost = parsed.host; } catch { /* reject below */ }
          if (originHost !== host) return json(res, 403, { error: 'Same-origin request required.' });
        }
        if (!req.url?.endsWith('/cancel') && !req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
          return json(res, 415, { error: 'JSON content type required.' });
        }
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/api/workspace') return json(res, 200, productWorkspace().overview());
      if (req.method === 'POST' && path === '/api/workspace/products') return json(res, 201, productWorkspace().createProduct(await body(req, 100_000)));
      if (req.method === 'POST' && path === '/api/workspace/questions') {
        const input = await body(req);
        if (input && typeof input === 'object' && 'mode' in input && input.mode === 'live') feedbackLoop();
        const run = await productWorkspace().ask(input);
        return json(res, run.status === 'failed' ? 502 : 201, run);
      }
      if (req.method === 'GET' && path === '/api/loop/telemetry') return json(res, 200, loopTelemetry().status());
      if (req.method === 'POST' && path === '/api/loop/telemetry/sync') {
        const input = await body(req);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) return json(res, 400, { error: 'Sync takes an empty object; configure Langfuse on the server.' });
        const exporter = loopTelemetry();
        if (!exporter.status().ready) return json(res, 200, exporter.status());
        const snapshot = feedbackLoop().publicOverview();
        if (snapshot.busy) return json(res, 409, { error: 'Finish the current experiment operation before syncing.' });
        return json(res, 200, await exporter.sync(snapshot));
      }
      if (req.method === 'GET' && path === '/api/loop') return json(res, 200, feedbackLoop().publicOverview());
      if (req.method === 'GET' && /^\/api\/loop\/products\/[A-Za-z0-9_-]{1,120}\/evidence$/.test(path)) return json(res, 200, { passages: feedbackLoop().productEvidence(path.split('/')[4]) });
      if (req.method === 'GET' && /^\/api\/loop\/final\/products\/[A-Za-z0-9_-]{1,120}\/evidence$/.test(path)) return json(res, 200, { passages: feedbackLoop().finalEvidence(path.split('/')[5]) });
      if (req.method === 'GET' && path === '/api/loop/export') return download(res, 'ablatrix-feedback-loop.json', `${JSON.stringify(feedbackLoop().export(), null, 2)}\n`, 'application/json');
      if (req.method === 'POST' && path === '/api/loop/runs') return json(res, 201, await feedbackLoop().run(await body(req)));
      if (req.method === 'POST' && path === '/api/loop/batches') return json(res, 201, await feedbackLoop().batch(await body(req)));
      if (req.method === 'POST' && path === '/api/loop/final') { const result = await feedbackLoop().startFinal(await body(req)); return json(res, 201, feedbackLoop().publicOverview().finals.find(item => item.id === result.id)); }
      if (req.method === 'POST' && /^\/api\/loop\/final\/[a-f0-9-]{36}\/report$/.test(path)) { await body(req); return json(res, 200, feedbackLoop().reportFinal(path.split('/')[4])); }
      if (req.method === 'POST' && path === '/api/loop/proposals') return json(res, 201, await feedbackLoop().propose(await body(req)));
      if (req.method === 'POST' && path === '/api/loop/rollback') return json(res, 200, feedbackLoop().rollback(await body(req)));
      if (req.method === 'POST' && /^\/api\/loop\/runs\/[a-f0-9-]{36}\/review-draft$/.test(path)) return json(res, 200, feedbackLoop().saveReviewDraft(path.split('/')[4], await body(req)));
      if (req.method === 'POST' && /^\/api\/loop\/runs\/[a-f0-9-]{36}\/review$/.test(path)) { const run = feedbackLoop().review(path.split('/')[4], await body(req)); return json(res, 200, feedbackLoop().publicRun(run.id)); }
      if (req.method === 'POST' && /^\/api\/loop\/policies\/[a-f0-9-]{36}\/validate$/.test(path)) { const input = await body(req); const validation = await feedbackLoop().validate(path.split('/')[4], input); return json(res, 201, feedbackLoop().publicOverview().validations.find(item => item.id === validation.id)); }
      if (req.method === 'POST' && /^\/api\/loop\/validations\/[a-f0-9-]{36}\/decide$/.test(path)) { await body(req); return json(res, 200, feedbackLoop().decide(path.split('/')[4])); }
      if (req.method === 'GET' && path === '/api/pilot') return json(res, 200, pilot.overview());
      if (req.method === 'POST' && path === '/api/pilot/runs') return json(res, 201, pilot.create(await body(req)));
      if (/^\/api\/pilot\/runs\/[a-f0-9-]{36}(\/(cancel|review|export))?$/.test(path)) {
        const id = path.split('/')[4], action = path.split('/')[5];
        if (req.method === 'GET' && !action) { const run = pilot.get(id); return json(res, run ? 200 : 404, run ?? { error: 'Pilot run not found.' }); }
        if (req.method === 'POST' && action === 'cancel') return json(res, 200, pilot.cancel(id));
        if (req.method === 'GET' && action === 'review') return json(res, 200, { cards: pilot.reviewCards(id) });
        if (req.method === 'POST' && action === 'review') return json(res, 200, pilot.review(id, await body(req)));
        if (req.method === 'GET' && action === 'export') return download(res, `ablatrix-search-pilot-${id}.json`, `${JSON.stringify(pilot.export(id), null, 2)}\n`, 'application/json');
      }
      if (req.method === 'GET' && path === '/api/health') return json(res, 200, { ok: true, mode });
      if (req.method === 'GET' && path === '/api/live-readiness') return json(res, 200, {
        ...provider.readiness(), budget: store.budgetSummary(provider.readiness().approvedCapCents)
      });
      if (req.method === 'GET' && path === '/api/runs') return json(res, 200, { runs: store.list() });
      if (req.method === 'GET' && path === '/api/tasks') return json(res, 200, publicTasks());
      if (req.method === 'GET' && path === '/api/report') return json(res, 200, report(store.allRunsForReport()));
      if (req.method === 'GET' && path === '/api/experiments') return json(res, 200, { experiments: store.listExperiments() });
      if (req.method === 'GET' && path === '/api/optimizations') return json(res, 200, { optimizations: optimizer.list() });
      if (/^\/api\/optimizations\/[a-f0-9-]{36}\/holdout$/.test(path)) {
        const id = path.split('/')[3];
        if (req.method === 'GET') {
          const result = finalHoldoutAssessment(store, id);
          return json(res, result ? 200 : 404, result ?? { error: 'Holdout assessment not found' });
        }
        if (req.method === 'POST') return json(res, 201, await runFinalFixtureHoldout(store, id));
      }
      if (req.method === 'POST' && path === '/api/optimizations') return json(res, 201, await optimizer.create(await body(req)));
      if (req.method === 'GET' && /^\/api\/optimizations\/[a-f0-9-]{36}\/comparison$/.test(path)) {
        const record = store.getOptimization(path.split('/')[3]);
        if (record && !record.candidateExperimentId) return json(res, 409, { error: 'Candidate experiment is not ready.' });
        return json(res, record ? 200 : 404, record ? comparison(optimizer.refresh(record), store) : { error: 'Optimization not found' });
      }
      if (req.method === 'GET' && /^\/api\/optimizations\/[a-f0-9-]{36}\/export$/.test(path)) {
        const id = path.split('/')[3];
        const record = store.getOptimization(id);
        if (!record) return json(res, 404, { error: 'Optimization not found' });
        if (!record.candidateExperimentId) return json(res, 409, { error: 'Candidate experiment is not ready.' });
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
      if (error instanceof ZodError) return json(res, 400, { error: 'Invalid request fields.' });
      if (error instanceof SyntaxError) return json(res, 400, { error: 'Invalid JSON body.' });
      if (error instanceof Error && error.message === 'Request body too large') return json(res, 413, { error: error.message });
      if (error instanceof Error && error.message.startsWith('Feedback')) return json(res, 409, { error: error.message });
      if (error instanceof Error && error.message.startsWith('Workspace:')) return json(res, error.message.includes('not found') ? 404 : 409, { error: error.message });
      if (error instanceof Error && error.message.startsWith('Pilot')) return json(res, error.message.includes('not found') ? 404 : 409, { error: error.message });
      if (error instanceof Error && /task|budget|Duplicate|queue is halted|baseline experiment|allowlisted|Live optimization|holdout|frozen completed/.test(error.message)) {
        return json(res, 400, { error: error.message });
      }
      console.error('Ablatrix request failed:', error);
      return json(res, 500, { error: 'Internal server error.' });
    }
  });
  server.on('close', () => { void pilot.close(); feedback?.close(); workspace?.close(); feedbackProvider?.close(); telemetry?.close(); });
  return server;
}
