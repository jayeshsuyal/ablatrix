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
import type { LoopAnswer, LoopPolicy, LoopProvider, LoopRetriever, LoopUsage, ProductCorpus, RetrievalResult } from './loop-types.ts';

const sourceInput = z.object({ label: z.string().trim().min(2).max(80), text: z.string().trim().min(30).max(1500), originalQuestion: z.string().trim().min(1).max(500).optional() }).strict();
const productInput = z.object({ title: z.string().trim().min(3).max(160), sources: z.array(sourceInput).min(1).max(8) }).strict();
const questionInput = z.object({ productId: z.uuid(), question: z.string().trim().min(5).max(500), mode: z.enum(['preview', 'live', 'synthetic']) }).strict();

// A byte is an upper bound on byte-level BPE tokens. Keep each passage below
// the retriever's 350-token limit, including tokenizer special tokens.
function sourceChunks(text: string): string[] {
  const chars = [...text];
  const chunks: string[] = [];
  let start = 0;
  while (start < chars.length) {
    let end = start, bytes = 0;
    while (end < chars.length && bytes + Buffer.byteLength(chars[end]!) <= 300) bytes += Buffer.byteLength(chars[end++]!);
    if (end < chars.length) {
      const boundary = chars.lastIndexOf(' ', end - 1);
      if (boundary > start && boundary - start > 40) end = boundary + 1;
    }
    const chunk = chars.slice(start, end).join('').trim();
    if (chunk) chunks.push(chunk);
    start = end;
  }
  return chunks;
}

export type WorkspaceProduct = { id: string; title: string; sources: { id: string; label: string; text: string; originalQuestion?: string }[]; createdAt: string };
export type WorkspaceRun = { id: string; productId: string; question: string; mode: 'preview' | 'live' | 'synthetic'; generationProtocol?: 'product-answer-v2-context' | 'synthetic-product-answer-v1'; reviewContext?: RevisionContext;
  runtimePolicy?: RuntimePolicyBinding; runtimePolicyInstructions?: string;
  automaticCheckRequested?: true; automaticCheckHandoff?: 'pending' | 'enqueued' | 'unavailable'; automaticCheckError?: string;
  status: 'retrieving' | 'evidence_ready' | 'completed' | 'failed'; retrieval: RetrievalResult | null; answer: LoopAnswer | null; model: string | null; usage: LoopUsage; error: string | null; createdAt: string };

/** Local product workspace. Imported evidence never enters the frozen evaluation corpora. */
export class ProductWorkspace {
  private db: DatabaseSync;
  private retrievers = new Map<string, LoopRetriever>();
  private busy = false;
  constructor(dbPath = '.data/product-workspace.sqlite', private provider: LoopProvider & { executionMode?: 'live' | 'synthetic' }, private retrieverFactory: (corpus: ProductCorpus) => LoopRetriever = corpus => new ProductRetriever(corpus, dbPath === ':memory:' ? ':memory:' : `${dbPath}.retrieval.sqlite`), private policyStore?: Pick<RuntimeAnswerPolicyStore, 'capture'>) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS workspace_products (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspace_runs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, document TEXT NOT NULL);`);
    for (const run of this.runs().filter(item => item.status === 'retrieving')) {
      run.status = 'failed'; run.error = 'Question was interrupted; it was not retried automatically.';
      this.saveRun(run);
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
      generationSourceIds: run.retrieval!.passages.map(passage => passage.id)
    }));
  }
  /** Only explicit unfinished automatic handoffs are eligible for startup recovery. */
  automaticCheckSnapshots(): ReviewAnswerSnapshot[] {
    const rows = this.db.prepare("SELECT document FROM workspace_runs WHERE json_extract(document,'$.automaticCheckRequested')=1 AND json_extract(document,'$.status')='completed' AND json_extract(document,'$.automaticCheckHandoff')='pending' ORDER BY created_at,id").all() as { document: string }[];
    return this.snapshots(rows.map(row => JSON.parse(row.document) as WorkspaceRun));
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
    return { binding, policy: { id: binding.id, parentId: captured?.parentId ?? null, instructions,
      rationale: 'Local product workspace baseline with separate original customer question context.', feedbackRunIds: [],
      status: captured && captured.status !== 'baseline' ? 'candidate' : 'baseline', mode: mode === 'synthetic' ? 'fixture' : 'live', createdAt: captured?.createdAt ?? '2026-09-29T00:00:00.000Z' } };
  }
  async ask(raw: unknown, beforeLiveDispatch?: () => void, options: { automaticCheck?: boolean } = {}): Promise<WorkspaceRun> {
    const input = questionInput.parse(raw);
    if (options.automaticCheck && input.mode === 'preview') throw new Error('Workspace: automatic checking requires a generated answer.');
    if (this.busy) throw new Error('Workspace: finish the current question before starting another.');
    const product = this.getProduct(input.productId);
    if (!product) throw new Error('Workspace: product not found.');
    if (input.mode !== 'preview' && (input.mode === 'synthetic') !== (this.provider.executionMode === 'synthetic')) throw new Error('Workspace: requested answer mode does not match the configured provider.');
    if (input.mode !== 'preview' && !this.provider.readiness().ready) throw new Error(`Workspace: ${this.provider.readiness().reason}`);
    const capturedPolicy = input.mode === 'preview' ? undefined : this.capturePolicy(input.mode);
    this.busy = true;
    const run: WorkspaceRun = { id: randomUUID(), productId: product.id, question: input.question, mode: input.mode, ...(input.mode !== 'preview' ? { generationProtocol: input.mode === 'synthetic' ? 'synthetic-product-answer-v1' as const : 'product-answer-v2-context' as const,
      runtimePolicy: capturedPolicy!.binding, runtimePolicyInstructions: capturedPolicy!.policy.instructions,
      reviewContext: { question: input.question, product: { id: product.id, title: product.title }, sources: this.corpus(product).passages.map(passage => {
        const source = { id: passage.id, label: passage.reference, text: passage.text, originalQuestion: passage.originalQuestion ?? null, origin: 'workspace' as const, reference: passage.reference };
        return { ...source, sha256: workspaceReviewSourceHash(source) };
      }), clarifications: [] }
    } : {}), ...(options.automaticCheck ? { automaticCheckRequested: true as const, automaticCheckHandoff: 'pending' as const } : {}),
      status: 'retrieving', retrieval: null, answer: null, model: null, usage: null, error: null, createdAt: new Date().toISOString() };
    this.saveRun(run);
    try {
      if (options.automaticCheck) {
        try {
          const context = run.reviewContext!, evidence = context.sources.map(source => ({ id: source.id, source: source.label, text: source.text,
            ...(source.originalQuestion !== null ? { originalQuestion: source.originalQuestion } : {}), origin: source.origin, ...(source.reference ? { reference: source.reference } : {}) }));
          // Reserve ordinary 10k-character answer headroom plus up to five full
          // body citations. Actual serialized outputs are validated again later.
          const citations = [...evidence].sort((a, b) => b.text.length - a.text.length).slice(0, 5).map(source => ({ passageId: source.id, quote: source.text }));
          claimSupportRequestParts({ runId: `${run.id}:preflight`, question: context.question, product: context.product, evidence,
            answer: { answer: 'x'.repeat(10_000), status: 'answered', citations }, clarifications: context.clarifications });
        } catch {
          run.automaticCheckHandoff = 'unavailable'; run.automaticCheckError = 'The complete source packet does not fit automatic checking with answer headroom. No answer call was made.';
          throw new Error(`Feedback ${run.automaticCheckError}`);
        }
      }
      run.retrieval = await this.retriever(product).retrieve(product.id, input.question);
      if (input.mode === 'preview') run.status = 'evidence_ready';
      else {
        const passages = run.retrieval.passages;
        if (!passages.length) throw new Error('No product evidence was retrieved.');
        if (passages.some(passage => passage.productId !== product.id || passage.sha256 !== textHash(passage.text) || !run.reviewContext!.sources.some(source => source.id === passage.id && source.text === passage.text && source.originalQuestion === (passage.originalQuestion ?? null)))) throw new Error('Retrieved evidence does not match the saved product snapshot.');
        this.saveRun(run);
        if (input.mode === 'live') beforeLiveDispatch?.();
        const quoteCount = this.provider.answerWithSnippetIds ? quoteOptions(passages).length : 0;
        const answerMethod = quoteCount >= 1 && quoteCount <= 60 ? this.provider.answerWithSnippetIds! : this.provider.answer;
        const answer = await answerMethod.call(this.provider, { question: input.question, product: { id: product.id, title: product.title, split: 'development' }, policy: capturedPolicy!.policy, passages, runId: run.id });
        if (input.mode === 'synthetic' && (answer.model !== 'synthetic-fixture' || !answer.answer.answer.startsWith('SYNTHETIC'))) throw new Error('Synthetic answer provenance is missing.');
        if (answer.answer.status === 'answered' && !answer.answer.citations.length || answer.answer.citations.some(citation => !passages.some(passage => passage.id === citation.passageId && passage.text.includes(citation.quote)))) throw new Error('Answer citation did not match supplied product evidence.');
        run.answer = answer.answer; run.model = answer.model; run.usage = answer.usage; run.status = 'completed';
      }
    } catch (error) {
      console.error('Product workspace question failed:', error);
      run.status = 'failed'; run.error = error instanceof Error && error.message.startsWith('Feedback ') ? error.message : 'Question failed; inspect the local server log and saved evidence.';
    } finally { this.saveRun(run); this.busy = false; }
    return run;
  }
  close(): void { for (const retriever of this.retrievers.values()) retriever.close(); this.db.close(); }
}
