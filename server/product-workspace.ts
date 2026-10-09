import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { textHash } from './product-corpus.ts';
import { ProductRetriever } from './product-retrieval.ts';
import { quoteOptions } from './feedback-provider.ts';
import { workspaceReviewSourceHash, type ReviewAnswerSnapshot, type RevisionContext } from './answer-review-source.ts';
import type { LoopAnswer, LoopProvider, LoopRetriever, LoopUsage, ProductCorpus, RetrievalResult } from './loop-types.ts';

const sourceInput = z.object({ label: z.string().trim().min(2).max(80), text: z.string().trim().min(30).max(1500), originalQuestion: z.string().trim().min(1).max(500).optional() }).strict();
const productInput = z.object({ title: z.string().trim().min(3).max(160), sources: z.array(sourceInput).min(1).max(8) }).strict();
const questionInput = z.object({ productId: z.uuid(), question: z.string().trim().min(5).max(500), mode: z.enum(['preview', 'live']) }).strict();
const baselineInstructions = 'Answer the product question using only the supplied product evidence. State supported facts directly, attribute claims to their source, and qualify missing or conflicting details. Never invent a specification. Cite an exact supporting quote for each material claim.';

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
export type WorkspaceRun = { id: string; productId: string; question: string; mode: 'preview' | 'live'; generationProtocol?: 'product-answer-v2-context'; reviewContext?: RevisionContext; status: 'retrieving' | 'evidence_ready' | 'completed' | 'failed'; retrieval: RetrievalResult | null; answer: LoopAnswer | null; model: string | null; usage: LoopUsage; error: string | null; createdAt: string };

/** Local product workspace. Imported evidence never enters the frozen evaluation corpora. */
export class ProductWorkspace {
  private db: DatabaseSync;
  private retrievers = new Map<string, LoopRetriever>();
  private busy = false;
  constructor(dbPath = '.data/product-workspace.sqlite', private provider: LoopProvider, private retrieverFactory: (corpus: ProductCorpus) => LoopRetriever = corpus => new ProductRetriever(corpus, dbPath === ':memory:' ? ':memory:' : `${dbPath}.retrieval.sqlite`)) {
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
  private runs(): WorkspaceRun[] {
    return (this.db.prepare('SELECT document FROM workspace_runs ORDER BY created_at DESC, id').all() as { document: string }[]).map(row => JSON.parse(row.document) as WorkspaceRun);
  }
  overview() { return { products: this.products(), runs: this.runs(), readiness: this.provider.readiness(), busy: this.busy }; }
  reviewSnapshots(): ReviewAnswerSnapshot[] {
    return this.runs().filter(run => run.mode === 'live' && run.status === 'completed' && run.answer && run.model && run.retrieval?.passages.length).map(run => ({
      id: `workspace-${run.id}`, runId: run.id,
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
  async ask(raw: unknown, beforeLiveDispatch?: () => void): Promise<WorkspaceRun> {
    const input = questionInput.parse(raw);
    if (this.busy) throw new Error('Workspace: finish the current question before starting another.');
    const product = this.getProduct(input.productId);
    if (!product) throw new Error('Workspace: product not found.');
    if (input.mode === 'live' && !this.provider.readiness().ready) throw new Error(`Workspace: ${this.provider.readiness().reason}`);
    this.busy = true;
    const run: WorkspaceRun = { id: randomUUID(), productId: product.id, question: input.question, mode: input.mode, ...(input.mode === 'live' ? { generationProtocol: 'product-answer-v2-context' as const,
      reviewContext: { question: input.question, product: { id: product.id, title: product.title }, sources: this.corpus(product).passages.map(passage => {
        const source = { id: passage.id, label: passage.reference, text: passage.text, originalQuestion: passage.originalQuestion ?? null, origin: 'workspace' as const, reference: passage.reference };
        return { ...source, sha256: workspaceReviewSourceHash(source) };
      }), clarifications: [] }
    } : {}), status: 'retrieving', retrieval: null, answer: null, model: null, usage: null, error: null, createdAt: new Date().toISOString() };
    this.saveRun(run);
    try {
      run.retrieval = await this.retriever(product).retrieve(product.id, input.question);
      if (input.mode === 'preview') run.status = 'evidence_ready';
      else {
        const passages = run.retrieval.passages;
        if (!passages.length) throw new Error('No product evidence was retrieved.');
        if (passages.some(passage => passage.productId !== product.id || passage.sha256 !== textHash(passage.text) || !run.reviewContext!.sources.some(source => source.id === passage.id && source.text === passage.text && source.originalQuestion === (passage.originalQuestion ?? null)))) throw new Error('Retrieved evidence does not match the saved product snapshot.');
        this.saveRun(run);
        beforeLiveDispatch?.();
        const policy = { id: 'workspace-baseline-v2-context', parentId: null, instructions: baselineInstructions, rationale: 'Local product workspace baseline with separate original customer question context.', feedbackRunIds: [], status: 'baseline' as const, mode: 'live' as const, createdAt: '2026-09-29T00:00:00.000Z' };
        const quoteCount = this.provider.answerWithSnippetIds ? quoteOptions(passages).length : 0;
        const answerMethod = quoteCount >= 1 && quoteCount <= 60 ? this.provider.answerWithSnippetIds! : this.provider.answer;
        const answer = await answerMethod.call(this.provider, { question: input.question, product: { id: product.id, title: product.title, split: 'development' }, policy, passages, runId: run.id });
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
