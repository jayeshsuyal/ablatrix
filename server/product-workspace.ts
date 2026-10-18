import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { textHash } from './product-corpus.ts';
import { ProductRetriever } from './product-retrieval.ts';
import { quoteOptions } from './feedback-provider.ts';
import { workspaceReviewSourceHash, type ReviewAnswerSnapshot, type RevisionContext } from './answer-review-source.ts';
import { claimSupportRequestParts } from './claim-support.ts';
import { RUNTIME_BASELINE_INSTRUCTIONS, type RuntimeAnswerPolicyStore, type RuntimePolicyBinding } from './runtime-answer-policy.ts';
import { WORKSPACE_GENERATION_CONTRACT, workspaceGenerationContract, workspaceGenerationParts, replayWorkspaceGenerationReceipt, type WorkspaceGenerationContract, type WorkspaceGenerationInput, type WorkspaceGenerationBinding, type WorkspaceGenerationProvider } from './workspace-generation.ts';
import { workspaceSourceChunks as sourceChunks, workspaceCompleteSourceContext } from './workspace-retrieval-context.ts';
import { WORKSPACE_SOURCE_COVERAGE_CONTRACT, workspaceSourceCoverageContext } from './workspace-source-coverage.ts';
import { verifyWorkspaceRunGeneration, workspaceQuestionRequestHash } from './workspace-generation-identity.ts';
export { verifyWorkspaceRunGeneration } from './workspace-generation-identity.ts';
import type { LoopAnswer, LoopPolicy, LoopProvider, LoopRetriever, LoopUsage, ProductCorpus, RetrievalResult, RetrievedPassage } from './loop-types.ts';

const sourceInput = z.object({ label: z.string().trim().min(2).max(80), text: z.string().trim().min(30).max(1500), originalQuestion: z.string().trim().min(1).max(500).optional() }).strict();
const productInput = z.object({ title: z.string().trim().min(3).max(160), sources: z.array(sourceInput).min(1).max(8) }).strict();
const questionInput = z.object({ productId: z.uuid(), question: z.string().trim().min(5).max(500), mode: z.enum(['preview', 'live', 'synthetic']) }).strict();

export type WorkspaceProduct = { id: string; title: string; sources: { id: string; label: string; text: string; originalQuestion?: string }[]; createdAt: string };
export type WorkspaceGeneration = { contract: WorkspaceGenerationContract; phase: 'prepared' | 'dispatching' | 'completed' | 'reconciliation'; input: WorkspaceGenerationInput; requestBody: ReturnType<typeof workspaceGenerationParts>['body']; binding: WorkspaceGenerationBinding; receiptId?: string; recovered?: true };
export type WorkspaceAskOptions = { automaticCheck?: boolean; idempotencyKey?: string; generationContract?: WorkspaceGenerationContract; automaticCheckPreflight?: (context: RevisionContext, runId: string) => void };
export type WorkspaceFaultBoundary = 'before_dispatch' | 'after_dispatch_intent' | 'after_receipt' | 'after_answer_persist';
export type WorkspaceRun = { id: string; productId: string; question: string; mode: 'preview' | 'live' | 'synthetic'; generationProtocol?: 'product-answer-v2-context' | 'synthetic-product-answer-v1' | WorkspaceGenerationContract; reviewContext?: RevisionContext;
  requestIdentity?: { sha256: string; idempotencyKey?: string; generationContract?: WorkspaceGenerationContract }; generation?: WorkspaceGeneration; generationPassages?: RetrievedPassage[]; reviewHandoff?: 'pending' | 'registered';
  finishedAt?: string; durationMs?: number;
  sourceCoverage?: { contract: typeof WORKSPACE_SOURCE_COVERAGE_CONTRACT; additions: { sourceId: string; reasons: string[] }[] };
  runtimePolicy?: RuntimePolicyBinding; runtimePolicyInstructions?: string;
  automaticCheckRequested?: true; automaticCheckHandoff?: 'pending' | 'enqueued' | 'unavailable'; automaticCheckError?: string;
  status: 'retrieving' | 'evidence_ready' | 'completed' | 'failed'; retrieval: RetrievalResult | null; answer: LoopAnswer | null; model: string | null; usage: LoopUsage; error: string | null; createdAt: string };

/** Local product workspace. Imported evidence never enters the frozen evaluation corpora. */
export class ProductWorkspace {
  private db: DatabaseSync;
  private retrievers = new Map<string, LoopRetriever>();
  private busy = false;
  private policyVerifier?: (binding: RuntimePolicyBinding) => void;
  constructor(dbPath = '.data/product-workspace.sqlite', private provider: LoopProvider & Partial<WorkspaceGenerationProvider> & { executionMode?: 'live' | 'synthetic' }, private retrieverFactory: (corpus: ProductCorpus) => LoopRetriever = corpus => new ProductRetriever(corpus, dbPath === ':memory:' ? ':memory:' : `${dbPath}.retrieval.sqlite`), private policyStore?: Pick<RuntimeAnswerPolicyStore, 'capture'>, private hooks: { fault?: (boundary: WorkspaceFaultBoundary, run: WorkspaceRun) => void; sourceCoverage?: true } = {}) {
    if (hooks.sourceCoverage !== undefined && hooks.sourceCoverage !== true) throw new Error('Workspace: unknown source coverage option.');
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS workspace_products (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspace_runs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspace_question_requests(idempotency_key TEXT PRIMARY KEY,request_sha256 TEXT NOT NULL,run_id TEXT NOT NULL UNIQUE);`);
    for (const run of this.runs().filter(item => item.status === 'retrieving')) {
      if (run.generation) this.reconcileGeneration(run.id, true);
      else { run.status = 'failed'; run.error = 'Question was interrupted; it was not retried automatically.'; this.finishTime(run); this.saveRun(run); }
    }
  }
  private products(): WorkspaceProduct[] {
    return (this.db.prepare('SELECT document FROM workspace_products ORDER BY created_at DESC').all() as { document: string }[]).map(row => JSON.parse(row.document) as WorkspaceProduct);
  }
  private runs(limit?: number): WorkspaceRun[] {
    // Limit interactive history in SQL; recovery and review import read every run.
    const query = this.db.prepare(`SELECT document FROM workspace_runs ORDER BY created_at DESC, id${limit === undefined ? '' : ' LIMIT ?'}`);
    return (query.all(...(limit === undefined ? [] : [limit])) as { document: string }[]).map(row => JSON.parse(row.document) as WorkspaceRun);
  }
  overview() { return { products: this.products(), runs: this.runs(100), readiness: this.provider.readiness(), busy: this.busy }; }
  hasActive() { return this.busy; }
  proofRuns() { return this.runs(); }
  attachRuntimePolicyVerifier(verifier: (binding: RuntimePolicyBinding) => void) {
    if (this.policyVerifier === verifier) return;
    if (this.busy) throw new Error('Workspace: cannot replace runtime policy verification during a question.');
    this.policyVerifier = verifier;
  }
  attachRuntimePolicyStore(store: Pick<RuntimeAnswerPolicyStore, 'capture'>) {
    if (this.policyStore === store) return;
    if (this.policyStore) throw new Error('Workspace: runtime answer policy store is already attached.');
    if (this.busy) throw new Error('Workspace: cannot attach runtime answer policies during a question.');
    this.policyStore = store;
  }
  /** Detect both this connection's writes and commits from another connection. */
  reviewImportVersion() {
    const external = this.db.prepare('PRAGMA data_version').get() as { data_version: number };
    const local = this.db.prepare('SELECT total_changes() AS changes').get() as { changes: number };
    return `${external.data_version}:${local.changes}`;
  }
  reviewSnapshots(runId?: string): ReviewAnswerSnapshot[] {
    const row = runId === undefined ? undefined : this.db.prepare('SELECT document FROM workspace_runs WHERE id=?').get(runId) as { document: string } | undefined;
    return this.snapshots(runId === undefined ? this.runs() : row ? [JSON.parse(row.document) as WorkspaceRun] : []);
  }
  private snapshots(runs: WorkspaceRun[]): ReviewAnswerSnapshot[] {
    return runs.filter(run => (run.mode === 'live' || run.mode === 'synthetic') && run.status === 'completed' && run.answer && run.model && run.retrieval?.passages.length).map(run => ({
      id: `workspace-${run.id}`, runId: run.id, ...(run.mode === 'synthetic' ? { mode: 'synthetic' as const } : {}),
      ...(run.runtimePolicy ? { runtimePolicy: { ...run.runtimePolicy } } : {}),
      // Older runs did not freeze the full source set or original product title.
      // Their retrieved passages are the only historical context we can assert.
      context: run.reviewContext ?? { question: run.question, product: { id: run.productId, title: `Saved product ${run.productId} (original title unavailable)` },
        sources: run.retrieval!.passages.map(passage => {
          const source = { id: passage.id, label: passage.reference || passage.source, text: passage.text, originalQuestion: passage.originalQuestion ?? null, origin: 'workspace' as const, reference: passage.reference };
          return { ...source, sha256: workspaceReviewSourceHash(source) };
        }), clarifications: [] },
      answer: run.answer!, model: run.model!, promptVersion: run.generationProtocol ?? 'workspace-legacy-protocol-unknown', createdAt: run.createdAt,
      contextProvenance: run.reviewContext ? 'workspace_source_snapshot' as const : 'saved_retrieval_only' as const,
      generationSourceIds: (run.generationPassages ?? run.retrieval!.passages).map(passage => passage.id)
    }));
  }
  /** Only explicit unfinished automatic handoffs are eligible for startup recovery. */
  automaticCheckSnapshots(): ReviewAnswerSnapshot[] {
    const rows = this.db.prepare("SELECT document FROM workspace_runs WHERE json_extract(document,'$.automaticCheckRequested')=1 AND json_extract(document,'$.status')='completed' AND json_extract(document,'$.automaticCheckHandoff')='pending' ORDER BY created_at,id").all() as { document: string }[];
    return this.snapshots(rows.map(row => JSON.parse(row.document) as WorkspaceRun));
  }
  pendingReviewSnapshots(): ReviewAnswerSnapshot[] { return this.snapshots(this.runs().filter(run => run.reviewHandoff === 'pending')); }
  markReviewHandoff(runId: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const run = this.getRun(runId);
      if (!run || run.status !== 'completed' || !run.reviewHandoff) throw new Error('Workspace: completed review handoff was not found.');
      if (run.reviewHandoff !== 'registered') { run.reviewHandoff = 'registered'; this.saveRun(run); }
      this.db.exec('COMMIT'); return run;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  markAutomaticCheckHandoff(runId: string, state: 'enqueued' | 'unavailable', error?: string): WorkspaceRun {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT document FROM workspace_runs WHERE id=?').get(runId) as { document: string } | undefined;
      if (!row) throw new Error('Workspace: saved question was not found.');
      const run = JSON.parse(row.document) as WorkspaceRun;
      if (!run.automaticCheckRequested || run.status !== 'completed') throw new Error('Workspace: this completed answer did not request an automatic check.');
      if (run.automaticCheckHandoff !== 'pending' && run.automaticCheckHandoff !== state) throw new Error('Workspace: automatic-check handoff already has a terminal state.');
      run.automaticCheckHandoff = state;
      if (state === 'unavailable' && error) run.automaticCheckError = error.slice(0, 500);
      if (state === 'enqueued') delete run.automaticCheckError;
      this.saveRun(run); this.db.exec('COMMIT'); return run;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  createProduct(raw: unknown): WorkspaceProduct {
    const input = productInput.parse(raw);
    if (this.products().length >= 20) throw new Error('Workspace: this local workspace is limited to 20 products.');
    const product: WorkspaceProduct = { id: randomUUID(), title: input.title, sources: input.sources.map(source => ({ id: randomUUID(), ...source })), createdAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO workspace_products(id,created_at,document) VALUES(?,?,?)').run(product.id, product.createdAt, JSON.stringify(product));
    return product;
  }
  private getProduct(id: string): WorkspaceProduct | null {
    const row = this.db.prepare('SELECT document FROM workspace_products WHERE id=?').get(id) as { document: string } | undefined;
    return row ? JSON.parse(row.document) as WorkspaceProduct : null;
  }
  private saveRun(run: WorkspaceRun): void {
    this.db.prepare('INSERT INTO workspace_runs(id,created_at,document) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document').run(run.id, run.createdAt, JSON.stringify(run));
  }
  private getRun(id: string): WorkspaceRun | undefined { const row = this.db.prepare('SELECT document FROM workspace_runs WHERE id=?').get(id) as { document: string } | undefined; return row ? JSON.parse(row.document) as WorkspaceRun : undefined; }
  private finishTime(run: WorkspaceRun) { run.finishedAt ??= new Date().toISOString(); run.durationMs ??= Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.createdAt)); }
  findIdempotent(raw: unknown, options: Pick<WorkspaceAskOptions, 'idempotencyKey' | 'automaticCheck' | 'generationContract'> = {}): WorkspaceRun | undefined {
    const contract = workspaceGenerationContract(options.generationContract);
    if (options.idempotencyKey === undefined) return undefined;
    const key = z.string().trim().min(1).max(160).parse(options.idempotencyKey), input = questionInput.parse(raw);
    const requestHash = workspaceQuestionRequestHash(input, options.automaticCheck ?? false, contract);
    const prior = this.db.prepare('SELECT request_sha256,run_id FROM workspace_question_requests WHERE idempotency_key=?').get(key) as { request_sha256: string; run_id: string } | undefined;
    if (prior && prior.request_sha256 !== requestHash) throw new Error('Workspace: idempotency key belongs to a different question request.');
    // The immutable request on a saved run remains authoritative if its lookup
    // index is lost; deleting an index row must never create another paid call.
    const retained = prior ? [] : this.db.prepare("SELECT document FROM workspace_runs WHERE json_extract(document,'$.requestIdentity.idempotencyKey')=? LIMIT 2").all(key) as { document: string }[];
    if (!prior && !retained.length) return undefined;
    if (retained.length > 1) throw new Error('Workspace: idempotency key has conflicting retained runs.');
    const run = prior ? this.getRun(prior.run_id) : JSON.parse(retained[0].document) as WorkspaceRun;
    if (!run || run.requestIdentity?.sha256 !== requestHash || run.requestIdentity.idempotencyKey !== key || workspaceGenerationContract(run.requestIdentity.generationContract) !== contract) throw new Error('Workspace: saved request identity is inconsistent.');
    return run;
  }
  private reconcileGeneration(id: string, recovered = false): WorkspaceRun {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const run = this.getRun(id)!;
      if (run.status !== 'retrieving' || !run.generation || !['prepared', 'dispatching'].includes(run.generation.phase)) { this.db.exec('COMMIT'); return run; }
      const generation = run.generation;
      try {
        verifyWorkspaceRunGeneration(run);
        const receipt = this.provider.receipt?.(run.id);
        if (!receipt) throw new Error(generation.phase === 'prepared' ? 'Prepared question was interrupted before dispatch; it was not retried.' : 'Started generation has no durable receipt; its outcome is unknown and it was not retried.');
        const result = replayWorkspaceGenerationReceipt(generation.input, receipt, run.mode as 'live' | 'synthetic');
        run.answer = result.answer; run.model = result.model; run.usage = result.usage; run.status = 'completed'; run.error = null; generation.phase = 'completed'; generation.receiptId = result.attemptId;
        if (recovered) generation.recovered = true;
      } catch (error) {
        run.status = 'failed'; run.error = error instanceof Error ? error.message : 'Generation requires reconciliation; it was not retried.';
        generation.phase = 'reconciliation';
      }
      this.finishTime(run); this.saveRun(run); this.db.exec('COMMIT'); return run;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private corpus(product: WorkspaceProduct): ProductCorpus {
    return { version: `workspace-${textHash(JSON.stringify(product)).slice(0, 24)}`, source: 'user-supplied local evidence', license: 'user-supplied',
      products: [{ id: product.id, title: product.title, split: 'development' }],
      passages: product.sources.flatMap(source => sourceChunks(source.text).map((chunk, index, chunks) => ({ id: chunks.length === 1 ? source.id : `${source.id}-${index + 1}`, productId: product.id, source: source.label, text: chunk, reference: chunks.length === 1 ? source.label : `${source.label} (part ${index + 1})`, sha256: textHash(chunk), ...(source.originalQuestion ? { originalQuestion: source.originalQuestion } : {}) }))), cases: [] };
  }
  private retriever(product: WorkspaceProduct): LoopRetriever {
    const cached = this.retrievers.get(product.id);
    if (cached) return cached;
    const corpus = this.corpus(product);
    const retriever = this.retrieverFactory(corpus);
    this.retrievers.set(product.id, retriever);
    return retriever;
  }
  private capturePolicy(mode: 'live' | 'synthetic'): { policy: LoopPolicy; binding: RuntimePolicyBinding } {
    // Copy the policy before retrieval can yield. Later pointer changes apply only
    // to later questions; the saved run and dispatched instructions share bytes.
    const captured = this.policyStore?.capture(mode);
    if (this.policyStore && !captured) throw new Error('Workspace: runtime answer policy store did not capture a policy.');
    const instructions = captured ? captured.instructions : RUNTIME_BASELINE_INSTRUCTIONS;
    const binding: RuntimePolicyBinding = captured ? { id: captured.id, instructionSha256: captured.instructionSha256, mode: captured.mode }
      : { id: 'workspace-baseline-v2-context', instructionSha256: textHash(instructions), mode };
    if (typeof instructions !== 'string' || !instructions.trim() || binding.mode !== mode || binding.instructionSha256 !== textHash(instructions) || typeof binding.id !== 'string' || !binding.id || binding.id.length > 160) throw new Error('Workspace: captured runtime answer policy has invalid identity or mode.');
    this.policyVerifier?.({ ...binding });
    return { binding, policy: { id: binding.id, parentId: captured?.parentId ?? null, instructions,
      rationale: 'Local product workspace baseline with separate original customer question context.', feedbackRunIds: [],
      status: captured && captured.status !== 'baseline' ? 'candidate' : 'baseline', mode: mode === 'synthetic' ? 'fixture' : 'live', createdAt: captured?.createdAt ?? '2026-09-29T00:00:00.000Z' } };
  }
  async ask(raw: unknown, beforeLiveDispatch?: () => void, options: WorkspaceAskOptions = {}): Promise<WorkspaceRun> {
    const input = questionInput.parse(raw);
    const contract = workspaceGenerationContract(options.generationContract);
    if (input.mode === 'preview' && contract !== WORKSPACE_GENERATION_CONTRACT) throw new Error('Workspace: experimental generation requires a generated answer.');
    if (options.automaticCheck && input.mode === 'preview') throw new Error('Workspace: automatic checking requires a generated answer.');
    const duplicate = this.findIdempotent(input, options);
    if (duplicate) return duplicate;
    if (this.busy) throw new Error('Workspace: finish the current question before starting another.');
    const product = this.getProduct(input.productId);
    if (!product) throw new Error('Workspace: product not found.');
    if (input.mode !== 'preview' && (input.mode === 'synthetic') !== (this.provider.executionMode === 'synthetic')) throw new Error('Workspace: requested answer mode does not match the configured provider.');
    if (input.mode !== 'preview' && !this.provider.readiness().ready) throw new Error(`Workspace: ${this.provider.readiness().reason}`);
    const capturedPolicy = input.mode === 'preview' ? undefined : this.capturePolicy(input.mode);
    const modern = input.mode !== 'preview' && typeof this.provider.answerWorkspace === 'function' && typeof this.provider.receipt === 'function';
    if (contract !== WORKSPACE_GENERATION_CONTRACT && !modern) throw new Error('Workspace: provider does not support the selected generation contract.');
    if (this.hooks.sourceCoverage && !modern) throw new Error('Workspace: source coverage requires receipt-enabled answer generation.');
    const corpus = this.corpus(product);
    const requestIdentity = { sha256: workspaceQuestionRequestHash(input, options.automaticCheck ?? false, contract), ...(options.idempotencyKey !== undefined ? { idempotencyKey: z.string().trim().min(1).max(160).parse(options.idempotencyKey) } : {}), ...(contract !== WORKSPACE_GENERATION_CONTRACT ? { generationContract: contract } : {}) };
    this.busy = true;
    let interrupted = false, persisted = false, returningExisting = false;
    const fault = (boundary: WorkspaceFaultBoundary) => { interrupted = true; this.hooks.fault?.(boundary, structuredClone(run)); interrupted = false; };
    let run: WorkspaceRun = { id: randomUUID(), productId: product.id, question: input.question, mode: input.mode, requestIdentity, ...(input.mode !== 'preview' ? { generationProtocol: modern ? contract : input.mode === 'synthetic' ? 'synthetic-product-answer-v1' as const : 'product-answer-v2-context' as const,
      runtimePolicy: capturedPolicy!.binding, runtimePolicyInstructions: capturedPolicy!.policy.instructions,
      reviewHandoff: 'pending' as const,
      reviewContext: { question: input.question, product: { id: product.id, title: product.title }, sources: (modern ? product.sources.map(source => ({ id: source.id, text: source.text, reference: source.label, originalQuestion: source.originalQuestion })) : corpus.passages).map(passage => {
        const source = { id: passage.id, label: passage.reference, text: passage.text, originalQuestion: passage.originalQuestion ?? null, origin: 'workspace' as const, reference: passage.reference };
        return { ...source, sha256: workspaceReviewSourceHash(source) };
      }), clarifications: [] }
    } : {}), ...(options.automaticCheck ? { automaticCheckRequested: true as const, automaticCheckHandoff: 'pending' as const } : {}),
      status: 'retrieving', retrieval: null, answer: null, model: null, usage: null, error: null, createdAt: new Date().toISOString() };
    try {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const raced = this.findIdempotent(input, options);
        if (raced) { returningExisting = true; run = raced; this.db.exec('COMMIT'); return run; }
        this.saveRun(run);
        if (requestIdentity.idempotencyKey) this.db.prepare('INSERT INTO workspace_question_requests(idempotency_key,request_sha256,run_id) VALUES(?,?,?)').run(requestIdentity.idempotencyKey, requestIdentity.sha256, run.id);
        this.db.exec('COMMIT'); persisted = true;
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      if (options.automaticCheck) {
        try {
          if (options.automaticCheckPreflight) options.automaticCheckPreflight(structuredClone(run.reviewContext!), run.id);
          else {
          const context = run.reviewContext!, evidence = context.sources.map(source => ({ id: source.id, source: source.label, text: source.text,
            ...(source.originalQuestion !== null ? { originalQuestion: source.originalQuestion } : {}), origin: source.origin, ...(source.reference ? { reference: source.reference } : {}) }));
          // Reserve ordinary 10k-character answer headroom plus up to five full
          // body citations. Actual serialized outputs are validated again later.
          const citations = [...evidence].sort((a, b) => b.text.length - a.text.length).slice(0, 5).map(source => ({ passageId: source.id, quote: source.text }));
          claimSupportRequestParts({ runId: `${run.id}:preflight`, question: context.question, product: context.product, evidence,
            answer: { answer: 'x'.repeat(10_000), status: 'answered', citations }, clarifications: context.clarifications });
          }
        } catch {
          run.automaticCheckHandoff = 'unavailable'; run.automaticCheckError = 'The complete source packet does not fit automatic checking with answer headroom. No answer call was made.';
          throw new Error(`Feedback ${run.automaticCheckError}`);
        }
      }
      run.retrieval = await this.retriever(product).retrieve(product.id, input.question);
      if (input.mode === 'preview') run.status = 'evidence_ready';
      else {
        const coverage = modern && this.hooks.sourceCoverage ? workspaceSourceCoverageContext(product, corpus, run.retrieval, input.question) : undefined;
        const passages = coverage?.passages ?? (modern ? workspaceCompleteSourceContext(product, corpus, run.retrieval) : run.retrieval.passages);
        if (coverage) run.sourceCoverage = { contract: coverage.contract, additions: structuredClone(coverage.additions) };
        if (!passages.length) throw new Error('No product evidence was retrieved.');
        if (passages.some(passage => passage.productId !== product.id || passage.sha256 !== textHash(passage.text) || !run.reviewContext!.sources.some(source => source.id === passage.id && source.text === passage.text && source.originalQuestion === (passage.originalQuestion ?? null)))) throw new Error('Retrieved evidence does not match the saved product snapshot.');
        const generationInput: WorkspaceGenerationInput = { question: input.question, product: { id: product.id, title: product.title, split: 'development' }, policy: capturedPolicy!.policy, passages, runId: run.id, ...(contract !== WORKSPACE_GENERATION_CONTRACT ? { generationContract: contract } : {}) };
        if (modern) {
          const parts = workspaceGenerationParts(generationInput);
          run.generationPassages = structuredClone(passages); run.generation = { contract, phase: 'prepared', input: parts.input, requestBody: parts.body, binding: parts.binding };
          this.saveRun(run); fault('before_dispatch');
          if (input.mode === 'live') beforeLiveDispatch?.();
          run.generation.phase = 'dispatching'; this.saveRun(run); fault('after_dispatch_intent');
          await this.provider.answerWorkspace!(structuredClone(generationInput)); fault('after_receipt');
          run = this.reconcileGeneration(run.id); fault('after_answer_persist');
        } else {
          this.saveRun(run);
          if (input.mode === 'live') beforeLiveDispatch?.();
          const quoteCount = this.provider.answerWithSnippetIds ? quoteOptions(passages).length : 0;
          const answerMethod = quoteCount >= 1 && quoteCount <= 60 ? this.provider.answerWithSnippetIds! : this.provider.answer;
          const answer = await answerMethod.call(this.provider, generationInput);
          if (input.mode === 'synthetic' && (answer.model !== 'synthetic-fixture' || !answer.answer.answer.startsWith('SYNTHETIC'))) throw new Error('Synthetic answer provenance is missing.');
          if (answer.answer.status === 'answered' && !answer.answer.citations.length || answer.answer.citations.some(citation => !passages.some(passage => passage.id === citation.passageId && passage.text.includes(citation.quote)))) throw new Error('Answer citation did not match supplied product evidence.');
          run.answer = answer.answer; run.model = answer.model; run.usage = answer.usage; run.status = 'completed';
        }
      }
    } catch (error) {
      if (interrupted || !persisted) throw error;
      console.error('Product workspace question failed:', error);
      if (run.generation?.phase === 'dispatching') run = this.reconcileGeneration(run.id);
      else { run.status = 'failed'; run.error = error instanceof Error && error.message.startsWith('Feedback ') ? error.message : 'Question failed; inspect the local server log and saved evidence.'; }
    } finally {
      try { if (!interrupted && persisted && !returningExisting) { this.finishTime(run); this.saveRun(run); } }
      finally { this.busy = false; }
    }
    return run;
  }
  close(): void { for (const retriever of this.retrievers.values()) retriever.close(); this.db.close(); }
}
