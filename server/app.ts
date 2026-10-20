import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { extname, join, resolve } from 'node:path';
import { ZodError, z } from 'zod';
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
import { ProductWorkspace, type WorkspaceRun } from './product-workspace.ts';
import { PaidAnswerReview } from './paid-answer-review.ts';
import { AnswerRevisions } from './answer-revisions.ts';
import { ContextComparisonStore, createContextComparisonFixture } from './context-comparison.ts';
import { DemoAccess, DemoAccessError, type DemoActor } from './demo-access.ts';
import { SyntheticAnswerProvider } from './synthetic-answer-provider.ts';
import { AutomaticSupport, type AutomaticSupportJob } from './automatic-support.ts';
import { RuntimeAnswerPolicyStore, type RuntimePolicyActor } from './runtime-answer-policy.ts';
import { createRuntimeGraderBinding } from './runtime-grader.ts';
import { CITED_APPLICABILITY_GRADER_VERSION } from './claim-support-v4.ts';
import { buildWorkspaceProof, verifyWorkspaceProof } from './workspace-proof.ts';
import { buildWorkspaceObservabilityPreview } from './workspace-observability-v1.ts';
import { AnswerPolicyWorker } from './answer-policy-worker.ts';

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
function readSavedDatabase<T>(path: string, read: (db: DatabaseSync) => T, missing: () => T): T {
  if (path === ':memory:' || !existsSync(path)) return missing();
  const db = new DatabaseSync(path, { readOnly: true });
  try { return read(db); } finally { db.close(); }
}

async function body(req: IncomingMessage, maxLength = 16_384): Promise<unknown> {
  let text = '';
  for await (const chunk of req) {
    text += chunk.toString();
    if (text.length > maxLength) throw new Error('Request body too large');
  }
  return JSON.parse(text || '{}') as unknown;
}

export function createApp(store: RunStore, mode: 'fixture' | 'live' = 'fixture', provider: MeteredLiveProvider = new SapiomLiveProvider(), pilot = new PilotRunner(new PilotStore()), feedback?: FeedbackLoop, telemetry?: LoopTelemetry, workspace?: ProductWorkspace, paidReview?: PaidAnswerReview, startRevisionWorker = false, localOptions: { answerProvider?: SapiomFeedbackProvider | SyntheticAnswerProvider; reviewDbPath?: string; comparisonDbPath?: string; demoAccess?: DemoAccess; runtimePolicyDbPath?: string; runtimePolicyStore?: RuntimeAnswerPolicyStore; answerPolicyWorker?: AnswerPolicyWorker; localDemo?: { label: string } } = {}) {
  const runner = new ExperimentRunner(store, mode, provider);
  const optimizer = new OptimizationRunner(store, runner, mode, provider);
  let feedbackProvider: SapiomFeedbackProvider | SyntheticAnswerProvider | undefined = localOptions.answerProvider;
  const localAnswerProvider = () => {
    if (!feedbackProvider) {
      if (localOptions.demoAccess) throw new Error('Hosted demo requires an explicit synthetic provider.');
      feedbackProvider = new SapiomFeedbackProvider();
    }
    return feedbackProvider;
  };
  const reviewDbPath = localOptions.reviewDbPath ?? process.env.ABLATRIX_PAID_REVIEW_DB;
  // Hosted instances derive this path solely from their dedicated review path.
  const policyDbPath = localOptions.runtimePolicyDbPath ?? (!localOptions.demoAccess ? process.env.ABLATRIX_RUNTIME_POLICY_DB : undefined) ?? (reviewDbPath === ':memory:' ? ':memory:' : reviewDbPath ? `${reviewDbPath}.runtime-policy.sqlite` : '.data/runtime-answer-policy.sqlite');
  let runtimePolicies = localOptions.runtimePolicyStore;
  const answerPolicies = () => runtimePolicies ??= new RuntimeAnswerPolicyStore(policyDbPath);
  const policyAction = <T,>(action: () => T): T => {
    try { return action(); }
    catch (error) { throw new Error(`Runtime policy: ${error instanceof Error ? error.message : 'Action could not complete.'}`); }
  };
  const productWorkspace = () => {
    workspace ??= new ProductWorkspace(process.env.ABLATRIX_WORKSPACE_DB, localAnswerProvider(), undefined, answerPolicies());
    workspace.attachRuntimePolicyStore(answerPolicies());
    workspace.attachRuntimePolicyVerifier(verifyPolicyCapture);
    return workspace;
  };
  const paidAnswerReview = () => paidReview ??= new PaidAnswerReview(reviewDbPath, undefined, { workspaceOnly: !!localOptions.localDemo });
  let comparisons: ContextComparisonStore | undefined;
  const contextComparisons = () => comparisons ??= new ContextComparisonStore(localOptions.comparisonDbPath ?? process.env.ABLATRIX_COMPARISON_DB);
  let revisions: AnswerRevisions | undefined;
  let supportChecks: AutomaticSupport | undefined;
  let policyWorker = localOptions.answerPolicyWorker;
  const answerPolicyWorker = () => policyWorker ??= new AnswerPolicyWorker(localAnswerProvider(), answerPolicies(), policyDbPath, {
    automatic: false,
    graderBinding: createRuntimeGraderBinding(localAnswerProvider().executionMode === 'synthetic' ? 'synthetic' : 'live', CITED_APPLICABILITY_GRADER_VERSION),
    liveEnabled: !localOptions.demoAccess && process.env.ABLATRIX_ANSWER_POLICY_SHADOW_LIVE === '1',
    completedJobs: () => automaticSupport().overview(),
    canDispatch: () => !feedback?.publicOverview().busy && !workspace?.hasActive() && !revisions?.hasActive() && !supportChecks?.hasActive()
  });
  const automaticSupport = () => supportChecks ??= new AutomaticSupport(localAnswerProvider(), reviewDbPath, {
    automatic: false,
    graderBinding: createRuntimeGraderBinding(localAnswerProvider().executionMode === 'synthetic' ? 'synthetic' : 'live', CITED_APPLICABILITY_GRADER_VERSION),
    liveEnabled: !localOptions.demoAccess && process.env.ABLATRIX_AUTOMATIC_CHECK_LIVE === '1',
    canDispatch: () => !feedback?.publicOverview().busy && !workspace?.hasActive() && !revisions?.hasActive() && !policyWorker?.hasActive()
  });
  const verifyPolicyCapture = (binding: { id: string; mode: 'live' | 'synthetic' }) => {
    const policies = answerPolicies().overview(binding.mode);
    if (policies.active.id !== binding.id) throw new Error('Runtime captured policy no longer matches its active version.');
    answerPolicyWorker().verifyActivatedHistory(policies);
  };
  let importedWorkspaceVersion: string | undefined;
  const answerRevisions = () => {
    revisions ??= new AnswerRevisions(paidAnswerReview(), localAnswerProvider(), reviewDbPath, true, () => !feedback?.publicOverview().busy && !workspace?.hasActive() && !supportChecks?.hasActive() && !policyWorker?.hasActive());
    const version = productWorkspace().reviewImportVersion();
    // Recover all historical handoffs at startup or after workspace writes, not
    // on every poll. A failed import leaves the old token so the next read retries.
    if (version !== importedWorkspaceVersion) {
      for (const snapshot of productWorkspace().reviewSnapshots()) revisions.registerAnswer(snapshot);
      for (const snapshot of productWorkspace().pendingReviewSnapshots()) productWorkspace().markReviewHandoff(snapshot.runId);
      importedWorkspaceVersion = productWorkspace().reviewImportVersion();
    }
    return revisions;
  };
  const recoverAutomaticChecks = () => {
    // Only saved intent from an explicit new-answer request is recoverable.
    // Unflagged history and GET handlers never create automatic work.
    for (const snapshot of productWorkspace().automaticCheckSnapshots()) {
      try {
        automaticSupport().enqueue(snapshot);
      } catch {
        if (!automaticSupport().readiness().ready) continue;
        try { productWorkspace().markAutomaticCheckHandoff(snapshot.runId, 'unavailable', 'Automatic checking is unavailable for this saved answer. Its original was preserved.'); }
        catch { console.warn('Automatic-check handoff marker deferred:', snapshot.runId); }
        continue;
      }
      // The durable job is authoritative even if its workspace marker cannot be saved.
      try { productWorkspace().markAutomaticCheckHandoff(snapshot.runId, 'enqueued'); }
      catch { console.warn('Queued automatic-check marker deferred:', snapshot.runId); }
    }
  };
  const loopTelemetry = () => telemetry ??= new LoopTelemetry();
  const feedbackLoop = () => {
    if (localOptions.demoAccess || localOptions.localDemo) throw new DemoAccessError(403, 'This synthetic demo does not run legacy experiments.');
    if (revisions?.hasActive() || supportChecks?.hasActive() || policyWorker?.hasActive()) throw new Error('Feedback revision, automatic check or policy trial is using the shared provider.');
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
  const savedAutomaticChecks = (): AutomaticSupportJob[] => {
    if (supportChecks) return supportChecks.verifiedOverview();
    // Constructing a worker would reconcile expired leases. A trace GET must
    // project the saved state without advancing or reconciling that state.
    return readSavedDatabase(reviewDbPath ?? '.data/paid-answer-review.sqlite', db => {
      if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='automatic_support_jobs'").get()) return [];
      return (db.prepare('SELECT document FROM automatic_support_jobs ORDER BY rowid DESC').all() as { document: string }[]).map(row => JSON.parse(row.document) as AutomaticSupportJob);
    }, () => []);
  };
  const currentWorkspaceProof = () => {
    try {
      const packet = buildWorkspaceProof(productWorkspace().proofRuns(), automaticSupport().verifiedOverview(), runId => localAnswerProvider().receipt(runId));
      verifyWorkspaceProof(packet);
      return packet;
    } catch { throw new Error('Automatic check: Paired evidence could not be verified against its exact saved sources, requests and receipts.'); }
  };
  const savedWorkspaceProof = () => {
    if ((localOptions.demoAccess || localOptions.localDemo) && (!workspace || !feedbackProvider)) throw new Error('Synthetic demo evidence stores must be explicitly configured.');
    const runs = workspace ? workspace.proofRuns() : readSavedDatabase(process.env.ABLATRIX_WORKSPACE_DB ?? '.data/product-workspace.sqlite', db => {
      if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='workspace_runs'").get()) return [];
      return (db.prepare('SELECT document FROM workspace_runs ORDER BY created_at DESC, id').all() as { document: string }[]).map(row => JSON.parse(row.document) as WorkspaceRun);
    }, () => []);
    const checks = savedAutomaticChecks();
    const verified = (receipt: Parameters<typeof buildWorkspaceProof>[2]) => {
      const packet = buildWorkspaceProof(runs, checks, receipt);
      verifyWorkspaceProof(packet);
      return packet;
    };
    if (feedbackProvider) return verified(runId => feedbackProvider!.receipt(runId));
    // The default live provider constructor can migrate its ledger and read a
    // credential file. Saved trace inspection needs only existing receipt rows.
    return readSavedDatabase(process.env.ABLATRIX_LOOP_BUDGET_DB ?? '.data/feedback-budget.sqlite', db => {
      if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='loop_provider_calls'").get()) return verified(() => undefined);
      const query = db.prepare('SELECT id,kind,status,model,input_tokens,output_tokens,error_code,receipt_json,allowance_usd FROM loop_provider_calls WHERE run_id=? ORDER BY created_at DESC LIMIT 1');
      return verified(runId => query.get(runId) as ReturnType<SapiomFeedbackProvider['receipt']>);
    }, () => verified(() => undefined));
  };
  let stopping = false;
  const server = createServer(async (req, res) => {
    try {
      if (stopping) return json(res, 503, { error: 'Workspace is shutting down. Retry after restart.' });
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      let actor: DemoActor | undefined;
      if (localOptions.demoAccess) {
        actor = await localOptions.demoAccess.authenticate(req);
        localOptions.demoAccess.authorize(actor, req.method ?? '', path);
        res.setHeader('cache-control', 'no-store');
        res.setHeader('x-content-type-options', 'nosniff');
        res.setHeader('referrer-policy', 'same-origin');
        res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      }
      const policyActor: RuntimePolicyActor = actor ? { kind: 'authenticated_member', id: actor.reviewer, role: 'operator' } : { kind: 'local_operator', id: 'local-loopback', role: 'operator' };
      if (localOptions.localDemo && path.startsWith('/api/') && !path.startsWith('/api/workspace') && !['/api/session', '/api/health'].includes(path)) return json(res, 403, { error: 'The isolated synthetic demo exposes workspace evidence only.' });
      const authenticatedBody = async (limit?: number) => {
        const input = await body(req, limit);
        return actor && input && typeof input === 'object' && !Array.isArray(input) ? { ...input, reviewer: actor.reviewer } : input;
      };
      const host = req.headers.host ?? '';
      if (!localOptions.demoAccess && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json(res, 403, { error: 'Local host required.' });
      if (!localOptions.demoAccess && req.method === 'POST') {
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
      if (req.method === 'GET' && path === '/api/session') return json(res, 200, { hosted: !!localOptions.demoAccess, providerMode: localOptions.demoAccess || localOptions.localDemo ? 'synthetic' : 'local', localDemo: !!localOptions.localDemo, demoLabel: localOptions.localDemo?.label, actor: actor ? { name: actor.name, role: actor.role, reviewer: actor.reviewer } : null });
      if (req.method === 'GET' && path === '/api/context-comparisons') return json(res, 200, contextComparisons().list());
      if (req.method === 'POST' && path === '/api/context-comparisons/fixture') {
        const input = await body(req);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) return json(res, 400, { error: 'The synthetic example takes an empty object.' });
        return json(res, 201, contextComparisons().importPacket(createContextComparisonFixture()));
      }
      if (/^\/api\/context-comparisons\/[A-Za-z0-9_-]{1,120}(\/(reviews|report|export))?$/.test(path)) {
        const id = path.split('/')[3], action = path.split('/')[4];
        if (req.method === 'GET' && !action) return json(res, 200, contextComparisons().get(id));
        if (req.method === 'POST' && action === 'reviews') return json(res, 201, contextComparisons().review(id, await authenticatedBody(40_000)));
        if (req.method === 'GET' && action === 'report') return json(res, 200, contextComparisons().report(id));
        if (req.method === 'GET' && action === 'export') return download(res, `ablatrix-context-comparison-${id}.json`, `${JSON.stringify(contextComparisons().exportPacket(id), null, 2)}\n`, 'application/json');
      }
      if (req.method === 'POST' && path.startsWith('/api/loop/') && (revisions?.hasActive() || supportChecks?.hasActive() || policyWorker?.hasActive())) return json(res, 409, { error: 'A revision, automatic check or policy trial is using the shared live provider.' });
      if (req.method === 'GET' && path === '/api/paid-review') return json(res, 200, paidAnswerReview().overview());
      if (req.method === 'GET' && path === '/api/paid-review/revisions') return json(res, 200, answerRevisions().overview('pinned'));
      if (req.method === 'GET' && /^\/api\/paid-review\/revisions\/[a-f0-9-]{36}$/.test(path)) {
        const job = answerRevisions().getJob(path.split('/')[4]);
        return /^\d+$/.test(job.qid) ? json(res, 200, job) : json(res, 404, { error: 'Revision: job not found.' });
      }
      if (req.method === 'POST' && /^\/api\/paid-review\/[0-9]{1,10}\/revisions$/.test(path)) return json(res, 202, answerRevisions().request(path.split('/')[3], await authenticatedBody(40_000)));
      if (req.method === 'POST' && /^\/api\/paid-review\/[0-9]{1,10}\/decisions$/.test(path)) return json(res, 201, answerRevisions().decide(path.split('/')[3], await authenticatedBody()));
      if (req.method === 'POST' && /^\/api\/paid-review\/[0-9]{1,10}$/.test(path)) return json(res, 201, paidAnswerReview().review(path.split('/')[3], await authenticatedBody()));
      if (req.method === 'GET' && path === '/api/paid-review/export') return download(res, 'ablatrix-paid-answer-reviews.json', `${JSON.stringify(paidAnswerReview().overview(), null, 2)}\n`, 'application/json');
      if (req.method === 'GET' && path === '/api/workspace') return json(res, 200, { ...productWorkspace().overview(), automaticCheckReadiness: automaticSupport().readiness() });
      if (req.method === 'GET' && ['/api/workspace/answer-policy', '/api/workspace/answer-policy/export'].includes(path)) {
        const policyMode = localAnswerProvider().executionMode === 'synthetic' ? 'synthetic' : 'live';
        const worker = answerPolicyWorker(), overview = worker.overview();
        const policies = answerPolicies().overview(policyMode);
        if (!path.endsWith('/export')) worker.verifyActivatedHistory(policies);
        const packet = { mode: policyMode, policies, improvement: path.endsWith('/export') ? worker.exportEvidence() : { ...overview, groups: overview.groups.filter(group => group.mode === policyMode) }, readiness: worker.readiness(), note: 'Automated trial evidence only. AI calibration is not measured; live activation is closed. Synthetic results demonstrate mechanics, not answer quality. Historical human promotion and final benchmarks remain separate.' };
        if (path.endsWith('/export')) return download(res, 'ablatrix-runtime-answer-policy.json', `${JSON.stringify(packet, null, 2)}\n`, 'application/json');
        return json(res, 200, packet);
      }
      if (req.method === 'POST' && path === '/api/workspace/answer-policy/rollback') {
        const input = z.object({ expectedActiveId: z.string().min(1).max(200) }).strict().parse(await body(req));
        const policyMode = localAnswerProvider().executionMode === 'synthetic' ? 'synthetic' : 'live';
        return json(res, 200, policyAction(() => { verifyPolicyCapture(answerPolicies().capture(policyMode)); return answerPolicies().rollback(policyMode, input.expectedActiveId, policyActor); }));
      }
      if (req.method === 'POST' && /^\/api\/workspace\/answer-policy\/trials\/(?:runtime-trial-)?[a-f0-9-]{36}\/activate$/.test(path)) {
        z.object({}).strict().parse(await body(req));
        return json(res, 200, policyAction(() => answerPolicyWorker().activateTrial(path.split('/')[5], policyActor)));
      }
      if (req.method === 'GET' && path === '/api/workspace/automatic-checks') {
        const answer = url.searchParams.get('answer');
        if (!answer || !/^workspace-[a-f0-9-]{36}$/.test(answer)) return json(res, 400, { error: 'A valid workspace answer ID is required.' });
        const check = automaticSupport().get(answer);
        if (check) { try { automaticSupport().verifyForExport(check); } catch { throw new Error('Automatic check: Saved check evidence requires reconciliation.'); } }
        return json(res, 200, { checks: check ? [check] : [], readiness: automaticSupport().readiness() });
      }
      if (req.method === 'GET' && ['/api/workspace/proof', '/api/workspace/proof/export'].includes(path)) {
        const packet = currentWorkspaceProof();
        if (path.endsWith('/export')) return download(res, 'ablatrix-paired-proof.json', JSON.stringify(packet, null, 2) + '\n', 'application/json');
        return json(res, 200, packet);
      }
      if (req.method === 'GET' && ['/api/workspace/observability', '/api/workspace/observability/export'].includes(path)) {
        let preview;
        try { preview = buildWorkspaceObservabilityPreview(savedWorkspaceProof()); }
        catch { throw new Error('Automatic check: Paired evidence could not be verified against its exact saved sources, requests and receipts.'); }
        if (path.endsWith('/export')) return download(res, 'ablatrix-workspace-observability-preview.json', JSON.stringify(preview, null, 2) + '\n', 'application/json');
        return json(res, 200, preview);
      }
      if (req.method === 'GET' && path === '/api/workspace/reviews/export') {
        const first = answerRevisions().overview('workspace');
        const cases = [...first.cases];
        for (let page = 2; (page - 1) * 20 < (first.pagination?.total ?? 0); page++) cases.push(...answerRevisions().overview('workspace', { page }).cases);
        return download(res, 'ablatrix-workspace-reviews.json', JSON.stringify({ scope: 'workspace', providerMode: localOptions.demoAccess ? 'synthetic' : 'local', note: 'Versioned workflow records. Synthetic answers do not measure model quality; automatic checks are uncalibrated AI estimates, and source matching does not establish correctness.', cases, automaticChecks: automaticSupport().overview() }, null, 2) + '\n', 'application/json');
      }
      if (req.method === 'GET' && path === '/api/workspace/reviews') {
        const rawPage = url.searchParams.get('page') ?? '1';
        const page = Number(rawPage), answer = url.searchParams.get('answer') ?? undefined;
        if (!/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(page) || (answer !== undefined && !/^workspace-[a-f0-9-]{36}$/.test(answer))) {
          return json(res, 400, { error: 'A positive page number and a valid workspace answer ID are required.' });
        }
        return json(res, 200, answerRevisions().overview('workspace', { page, answer }));
      }
      if (req.method === 'POST' && /^\/api\/workspace\/reviews\/workspace-[a-f0-9-]{36}\/revisions$/.test(path)) return json(res, 202, answerRevisions().request(path.split('/')[4], await authenticatedBody(40_000)));
      if (req.method === 'POST' && /^\/api\/workspace\/reviews\/workspace-[a-f0-9-]{36}\/decisions$/.test(path)) return json(res, 201, answerRevisions().decide(path.split('/')[4], await authenticatedBody()));
      if (req.method === 'POST' && path === '/api/workspace/products') return json(res, 201, productWorkspace().createProduct(await body(req, 110_000)));
      if (req.method === 'POST' && path === '/api/workspace/questions') {
        const rawInput = await body(req);
        if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) return json(res, 400, { error: 'A workspace question object is required.' });
        const { automaticCheck = false, idempotencyKey, ...input } = rawInput as Record<string, unknown>;
        if (typeof automaticCheck !== 'boolean' || (automaticCheck && input.mode === 'preview')) return json(res, 400, { error: 'Automatic checking requires a generated answer and a boolean opt-in.' });
        if ((localOptions.demoAccess || localOptions.localDemo) && (!input || typeof input !== 'object' || !('mode' in input) || !['preview', 'synthetic'].includes(String(input.mode)))) return json(res, 403, { error: 'The hosted demo accepts preview or synthetic generation only.' });
        const replay = productWorkspace().findIdempotent(input, { automaticCheck, idempotencyKey: idempotencyKey as string | undefined });
        if (replay) {
          let check: ReturnType<AutomaticSupport['get']> | undefined;
          if (replay.status === 'completed') {
            try { answerRevisions(); } catch { console.warn('Review handoff remains pending for saved workspace answer:', replay.id); }
            try { recoverAutomaticChecks(); check = automaticSupport().get(`workspace-${replay.id}`); } catch { console.warn('Automatic handoff remains pending for saved workspace answer:', replay.id); }
          }
          const stored = productWorkspace().findIdempotent(input, { automaticCheck, idempotencyKey: idempotencyKey as string | undefined })!;
          return json(res, replay.status === 'failed' ? 502 : 200, { ...stored, ...(check ? { automaticCheck: check } : {}) });
        }
        if (automaticCheck) {
          const checkReadiness = automaticSupport().readiness();
          if (!checkReadiness.ready) return json(res, 409, { error: checkReadiness.reason });
          const batchReadiness = localAnswerProvider().capacity(4);
          if (!batchReadiness.ready) return json(res, 409, { error: batchReadiness.reason });
        }
        const loop = input && typeof input === 'object' && 'mode' in input && input.mode === 'live' ? feedbackLoop() : undefined;
        if (loop?.publicOverview().busy || revisions?.hasActive() || supportChecks?.hasActive() || policyWorker?.hasActive()) return json(res, 409, { error: 'Finish the active dispatch before a workspace answer.' });
        let run = await productWorkspace().ask(input, () => {
          if (loop?.publicOverview().busy || revisions?.hasActive() || supportChecks?.hasActive() || policyWorker?.hasActive()) throw new Error('Feedback experiment, revision, automatic check or policy trial started during retrieval; no workspace live call was made.');
        }, { automaticCheck, idempotencyKey: idempotencyKey as string | undefined, automaticCheckPreflight: (context, runId) => automaticSupport().preflight(context, runId) });
        let reviewHandoff: 'pending' | undefined;
        if (run.status === 'completed') {
          try { answerRevisions(); }
          catch {
            // Generation and its receipt are already durable. Review import is
            // replayable, so its failure must not invite another paid answer.
            console.warn('Review handoff deferred for saved workspace answer:', run.id);
            reviewHandoff = 'pending';
          }
          if (automaticCheck) {
            let check: ReturnType<AutomaticSupport['enqueue']>;
            try {
              const snapshot = productWorkspace().reviewSnapshots(run.id)[0];
              if (!snapshot) throw new Error('Automatic check: source snapshot is unavailable.');
              check = automaticSupport().enqueue(snapshot);
            } catch {
              // The original and receipt remain saved even if the check cannot start.
              const automaticCheckError = 'Automatic checking is unavailable for this saved answer. Its original was preserved.';
              try { run = productWorkspace().markAutomaticCheckHandoff(run.id, 'unavailable', automaticCheckError); } catch { /* Pending intent is retained if storage remains unavailable. */ }
              return json(res, 201, { ...run, ...(reviewHandoff ? { reviewHandoff } : {}), automaticCheckError });
            }
            // Once enqueue succeeds, return that saved job regardless of marker
            // persistence. A failed marker must not hide already authorized work.
            try { run = productWorkspace().markAutomaticCheckHandoff(run.id, 'enqueued'); }
            catch { console.warn('Queued automatic-check marker deferred:', run.id); }
            automaticSupport().start();
            answerPolicyWorker().start();
            return json(res, 201, { ...run, ...(reviewHandoff ? { reviewHandoff } : {}), automaticCheck: check });
          }
        }
        return json(res, run.status === 'failed' ? 502 : 201, { ...run, ...(reviewHandoff ? { reviewHandoff } : {}) });
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
      if (error instanceof DemoAccessError) return json(res, error.status, { error: error.message });
      if (error instanceof ZodError) return json(res, 400, { error: 'Invalid request fields.' });
      if (error instanceof SyntaxError) return json(res, 400, { error: 'Invalid JSON body.' });
      if (error instanceof Error && error.message === 'Request body too large') return json(res, 413, { error: error.message });
      if (error instanceof Error && error.message.startsWith('Feedback')) return json(res, 409, { error: error.message });
      if (error instanceof Error && error.message.startsWith('Workspace:')) return json(res, error.message.includes('not found') ? 404 : 409, { error: error.message });
      if (error instanceof Error && error.message.startsWith('Paid review:')) return json(res, error.message.includes('not found') ? 404 : 409, { error: error.message });
      if (error instanceof Error && error.message.startsWith('Context comparison:')) return json(res, error.message.includes('not found') ? 404 : 409, { error: error.message });
      if (error instanceof Error && error.message.startsWith('Revision:')) return json(res, error.message.includes('not found') ? 404 : 409, { error: error.message });
      if (error instanceof Error && error.message.startsWith('Automatic check:')) return json(res, 409, { error: error.message });
      if (error instanceof Error && /^(Runtime |Trial |Synthetic trial |Live trial |Answer policy)/.test(error.message)) return json(res, 409, { error: error.message });
      if (error instanceof Error && error.message.startsWith('Pilot')) return json(res, error.message.includes('not found') ? 404 : 409, { error: error.message });
      if (error instanceof Error && /task|budget|Duplicate|queue is halted|baseline experiment|allowlisted|Live optimization|holdout|frozen completed/.test(error.message)) {
        return json(res, 400, { error: error.message });
      }
      console.error('Ablatrix request failed:', error);
      return json(res, 500, { error: 'Internal server error.' });
    }
  });
  let disposal: Promise<void> | undefined;
  const dispose = () => disposal ??= (async () => {
    await revisions?.pauseAndDrain();
    await supportChecks?.pauseAndDrain();
    await policyWorker?.pauseAndDrain();
    await pilot.close();
    revisions?.close(); supportChecks?.close(); policyWorker?.close(); feedback?.close(); workspace?.close(); paidReview?.close(); feedbackProvider?.close(); telemetry?.close(); comparisons?.close(); runtimePolicies?.close();
  })();
  const closeHttp = server.close.bind(server);
  server.close = (callback?: (error?: Error) => void) => {
    stopping = true;
    void revisions?.pauseAndDrain();
    void supportChecks?.pauseAndDrain();
    void policyWorker?.pauseAndDrain();
    closeHttp(error => {
      if (error) { callback?.(error); return; }
      void dispose().then(() => callback?.()).catch(reason => {
        if (callback) callback(reason instanceof Error ? reason : new Error('Shutdown failed.'));
        else console.error('Ablatrix shutdown failed:', reason);
      });
    });
    return server;
  };
  server.requestTimeout = 30_000; server.headersTimeout = 15_000;
  let shutdown: Promise<void> | undefined;
  const result = Object.assign(server, { shutdown: () => shutdown ??= (async () => {
    stopping = true;
    const worker = revisions?.pauseAndDrain();
    const checkWorker = supportChecks?.pauseAndDrain();
    const improvementWorker = policyWorker?.pauseAndDrain();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await worker; await checkWorker; await improvementWorker; await dispose();
  })() });
  if (startRevisionWorker) { answerRevisions(); recoverAutomaticChecks(); automaticSupport().start(); answerPolicyWorker().start(); }
  return result;
}
