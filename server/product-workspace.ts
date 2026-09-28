import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { textHash } from './product-corpus.ts';
import { ProductRetriever } from './product-retrieval.ts';
import type { LoopAnswer, LoopProvider, LoopRetriever, LoopUsage, ProductCorpus, RetrievalResult } from './loop-types.ts';

const sourceInput = z.object({ label: z.string().trim().min(2).max(80), text: z.string().trim().min(30).max(1500) }).strict();
const productInput = z.object({ title: z.string().trim().min(3).max(160), sources: z.array(sourceInput).min(1).max(8) }).strict();
const questionInput = z.object({ productId: z.uuid(), question: z.string().trim().min(5).max(500), mode: z.enum(['preview', 'live']) }).strict();
const baselineInstructions = 'Answer the product question using only the supplied product evidence. State supported facts directly, attribute claims to their source, and qualify missing or conflicting details. Never invent a specification. Cite an exact supporting quote for each material claim.';

export type WorkspaceProduct = { id: string; title: string; sources: { id: string; label: string; text: string }[]; createdAt: string };
export type WorkspaceRun = { id: string; productId: string; question: string; mode: 'preview' | 'live'; status: 'retrieving' | 'evidence_ready' | 'completed' | 'failed'; retrieval: RetrievalResult | null; answer: LoopAnswer | null; model: string | null; usage: LoopUsage; error: string | null; createdAt: string };

/** Local product workspace. Imported evidence never enters the frozen evaluation corpora. */
export class ProductWorkspace {
  private db: DatabaseSync;
  private retrievers = new Map<string, LoopRetriever>();
  private busy = false;
  constructor(dbPath = '.data/product-workspace.sqlite', private provider: LoopProvider, private retrieverFactory: (corpus: ProductCorpus) => LoopRetriever = corpus => new ProductRetriever(corpus, '.data/product-workspace-retrieval.sqlite')) {
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
    return (this.db.prepare('SELECT document FROM workspace_runs ORDER BY created_at DESC LIMIT 100').all() as { document: string }[]).map(row => JSON.parse(row.document) as WorkspaceRun);
  }
  overview() { return { products: this.products(), runs: this.runs(), readiness: this.provider.readiness(), busy: this.busy }; }
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
  private retriever(product: WorkspaceProduct): LoopRetriever {
    const cached = this.retrievers.get(product.id);
    if (cached) return cached;
    const corpus: ProductCorpus = { version: `workspace-${textHash(JSON.stringify(product)).slice(0, 24)}`, source: 'user-supplied local evidence', license: 'user-supplied',
      products: [{ id: product.id, title: product.title, split: 'development' }],
      passages: product.sources.map(source => ({ id: source.id, productId: product.id, source: 'user_supplied', text: source.text, reference: source.label, sha256: textHash(source.text) })), cases: [] };
    const retriever = this.retrieverFactory(corpus);
    this.retrievers.set(product.id, retriever);
    return retriever;
  }
  async ask(raw: unknown): Promise<WorkspaceRun> {
    const input = questionInput.parse(raw);
    if (this.busy) throw new Error('Workspace: finish the current question before starting another.');
    const product = this.getProduct(input.productId);
    if (!product) throw new Error('Workspace: product not found.');
    if (input.mode === 'live' && !this.provider.readiness().ready) throw new Error(`Workspace: ${this.provider.readiness().reason}`);
    this.busy = true;
    const run: WorkspaceRun = { id: randomUUID(), productId: product.id, question: input.question, mode: input.mode, status: 'retrieving', retrieval: null, answer: null, model: null, usage: null, error: null, createdAt: new Date().toISOString() };
    this.saveRun(run);
    try {
      run.retrieval = await this.retriever(product).retrieve(product.id, input.question);
      if (input.mode === 'preview') run.status = 'evidence_ready';
      else {
        const passages = run.retrieval.passages;
        if (!passages.length) throw new Error('No product evidence was retrieved.');
        const policy = { id: 'workspace-baseline-v1', parentId: null, instructions: baselineInstructions, rationale: 'Frozen local product workspace baseline.', feedbackRunIds: [], status: 'baseline' as const, mode: 'live' as const, createdAt: '2026-09-27T00:00:00.000Z' };
        const answer = await (this.provider.answerWithSnippetIds ?? this.provider.answer).call(this.provider, { question: input.question, product: { id: product.id, title: product.title, split: 'development' }, policy, passages, runId: run.id });
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
