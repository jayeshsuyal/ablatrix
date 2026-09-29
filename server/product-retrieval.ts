import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { textHash, validateProductCorpus } from './product-corpus.ts';
import type { LoopRetriever, Passage, ProductCorpus, RetrievalResult, RetrievedPassage } from './loop-types.ts';

export const EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';
export const EMBEDDING_REVISION = 'ea104dacec62c0de699686887e3f920caeb4f3e3';
export const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
const RRF_K = 60;
const CANDIDATES_PER_METHOD = 20;
const MAX_PASSAGES = 5;
const CONTEXT_CHAR_BUDGET = 6000;
const modelCachePath = fileURLToPath(new URL('../.data/models', import.meta.url));
export type EmbeddingFunction = (texts: string[], kind: 'passage' | 'query') => Promise<number[][]>;
export type RetrieverOptions = { embed?: EmbeddingFunction; modelId?: string; modelRevision?: string; cqaAnswerOnly?: boolean };

/** The ePQA CQA corpus appends the upstream question after the answer. */
export function cqaAnswerText(passage: Passage): string {
  if (passage.source !== 'cqa') return passage.text;
  const marker = passage.text.lastIndexOf(' Question: ');
  return marker > 0 ? passage.text.slice(0, marker).trim() : passage.text;
}

/** Each list is ranked best-first; duplicates in a method only vote once. */
export function reciprocalRankFusion(lexical: string[], semantic: string[]): { id: string; lexicalRank: number | null; semanticRank: number | null; score: number }[] {
  const scores = new Map<string, { id: string; lexicalRank: number | null; semanticRank: number | null; score: number }>();
  for (const [method, ids] of [['lexicalRank', lexical], ['semanticRank', semantic]] as const) {
    [...new Set(ids)].forEach((id, index) => {
      const entry = scores.get(id) ?? { id, lexicalRank: null, semanticRank: null, score: 0 };
      entry[method] = index + 1; entry.score += 1 / (RRF_K + index + 1); scores.set(id, entry);
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function normalized(vector: number[]): number[] {
  if (!vector.length || vector.some(value => !Number.isFinite(value))) throw new Error('Embedding returned invalid values.');
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) throw new Error('Embedding returned a zero vector.');
  return vector.map(value => value / norm);
}

/** Lazy local model loading. Errors stay visible; there is no pretend-semantic fallback. */
function localBgeEmbedding(modelId: string, revision: string): EmbeddingFunction {
  let extractorPromise: Promise<import('@huggingface/transformers').FeatureExtractionPipeline> | undefined;
  return async (texts, kind) => {
    extractorPromise ??= (async () => {
      const { env, AutoTokenizer, AutoModel, FeatureExtractionPipeline } = await import('@huggingface/transformers');
      env.cacheDir = modelCachePath;
      const localPath = resolve(modelCachePath, modelId, revision);
      // Fetch only revision-pinned assets, then use an absolute model directory.
      // v4.3's metadata discovery ignores revision/cache flags even in AutoTokenizer.
      for (const file of ['tokenizer.json', 'tokenizer_config.json', 'config.json', 'onnx/model_quantized.onnx']) {
        const destination = resolve(localPath, file);
        if (existsSync(destination)) continue;
        const response = await fetch(`https://huggingface.co/${modelId}/resolve/${revision}/${file}`, { signal: AbortSignal.timeout(120_000) });
        if (!response.ok) throw new Error(`Embedding asset download failed (${response.status}): ${file}.`);
        mkdirSync(dirname(destination), { recursive: true });
        const temporary = `${destination}.${randomUUID()}.tmp`;
        writeFileSync(temporary, Buffer.from(await response.arrayBuffer())); renameSync(temporary, destination);
      }
      // Construct components explicitly: Transformers.js 4.3's pipeline factory
      // discovers files against unpinned main and omits local_files_only there.
      const [tokenizer, model] = await Promise.all([
        AutoTokenizer.from_pretrained(localPath, { local_files_only: true }),
        AutoModel.from_pretrained(localPath, { dtype: 'q8', device: 'cpu', local_files_only: true })
      ]);
      return new FeatureExtractionPipeline({ task: 'feature-extraction', tokenizer, model });
    })().catch(error => { extractorPromise = undefined; throw error; });
    const extractor = await extractorPromise;
    const inputs = texts.map(text => kind === 'query' ? QUERY_PREFIX + text : text);
    for (const text of inputs) {
      const tokens = extractor.tokenizer(text, { truncation: false, padding: false });
      const count = tokens.input_ids.size;
      const limit = kind === 'passage' ? 350 : 512;
      if (count > limit) throw new Error(`${kind === 'passage' ? 'Passage needs rechunking' : 'Question is too long'}: ${count} embedding tokens exceeds ${limit}; text was not truncated.`);
    }
    // The tokenizer check above guarantees the pipeline's 512-token window cannot truncate.
    const output = await extractor(inputs, { pooling: 'cls', normalize: true });
    return output.tolist() as number[][];
  };
}

const sharedLocalEmbeddings = new Map<string, EmbeddingFunction>();
function sharedLocalBgeEmbedding(modelId: string, revision: string): EmbeddingFunction {
  const key = `${modelId}@${revision}`;
  let embed = sharedLocalEmbeddings.get(key);
  if (!embed) {
    const run = localBgeEmbedding(modelId, revision);
    let queue: Promise<unknown> = Promise.resolve();
    embed = (texts, kind) => {
      const result = queue.then(() => run(texts, kind));
      queue = result.catch(() => undefined);
      return result;
    };
    sharedLocalEmbeddings.set(key, embed);
  }
  return embed;
}

export class ProductRetriever implements LoopRetriever {
  private readonly db: DatabaseSync;
  private readonly embed: EmbeddingFunction;
  private readonly modelId: string;
  private readonly revision: string;
  private readonly indexText: (passage: Passage) => string;
  private readonly byProduct = new Map<string, Passage[]>();
  private readonly productInitialization = new Map<string, Promise<Map<string, number[]>>>();
  private closed = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly corpus: ProductCorpus, dbPath = '.data/product-retrieval.sqlite', options: RetrieverOptions = {}) {
    validateProductCorpus(corpus);
    this.modelId = options.modelId ?? (options.embed ? 'injected-test-embedding' : EMBEDDING_MODEL);
    this.revision = options.modelRevision ?? (options.embed ? 'test-only' : EMBEDDING_REVISION);
    this.indexText = options.cqaAnswerOnly === false ? passage => passage.text : cqaAnswerText;
    this.embed = options.embed ?? sharedLocalBgeEmbedding(this.modelId, this.revision);
    if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE VIRTUAL TABLE IF NOT EXISTS product_passages_fts USING fts5(corpus UNINDEXED, product_id UNINDEXED, passage_id UNINDEXED, text, tokenize='unicode61');
      CREATE TABLE IF NOT EXISTS product_corpus_index (version TEXT PRIMARY KEY, digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS product_vectors (corpus TEXT NOT NULL, model TEXT NOT NULL, revision TEXT NOT NULL, text_hash TEXT NOT NULL, vector TEXT NOT NULL, PRIMARY KEY(corpus,model,revision,text_hash));`);
    for (const passage of corpus.passages) this.byProduct.set(passage.productId, [...(this.byProduct.get(passage.productId) ?? []), passage]);
    const digest = textHash(JSON.stringify(corpus.passages.map(passage => ({ id: passage.id, productId: passage.productId, text: this.indexText(passage) }))));
    const existing = this.db.prepare('SELECT digest FROM product_corpus_index WHERE version=?').get(corpus.version) as { digest: string } | undefined;
    if (existing?.digest !== digest) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.prepare('DELETE FROM product_passages_fts WHERE corpus=?').run(corpus.version);
        const insert = this.db.prepare('INSERT INTO product_passages_fts (corpus,product_id,passage_id,text) VALUES (?,?,?,?)');
        for (const passage of corpus.passages) insert.run(corpus.version, passage.productId, passage.id, this.indexText(passage));
        this.db.prepare('INSERT OR REPLACE INTO product_corpus_index (version,digest) VALUES (?,?)').run(corpus.version, digest);
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
  }

  private async vectors(productId: string): Promise<Map<string, number[]>> {
    const existing = this.productInitialization.get(productId);
    if (existing) return existing;
    const pending = (async () => {
      const vectors = new Map<string, number[]>(), missing: Passage[] = [];
      const get = this.db.prepare('SELECT vector FROM product_vectors WHERE corpus=? AND model=? AND revision=? AND text_hash=?');
      for (const passage of this.byProduct.get(productId)!) {
        const row = get.get(this.corpus.version, this.modelId, this.revision, textHash(this.indexText(passage))) as { vector: string } | undefined;
        if (row) vectors.set(passage.id, normalized(JSON.parse(row.vector) as number[]));
        else missing.push(passage);
      }
      // Small batches bound local CPU/RAM use; no hosted embedding request is made.
      for (let offset = 0; offset < missing.length; offset += 16) {
        const batch = missing.slice(offset, offset + 16);
        const embeddings = await this.embed(batch.map(passage => this.indexText(passage)), 'passage');
        if (embeddings.length !== batch.length) throw new Error('Embedding batch length mismatch.');
        for (const [index, passage] of batch.entries()) {
          const vector = normalized(embeddings[index]);
          this.db.prepare('INSERT OR REPLACE INTO product_vectors (corpus,model,revision,text_hash,vector) VALUES (?,?,?,?,?)').run(this.corpus.version, this.modelId, this.revision, textHash(this.indexText(passage)), JSON.stringify(vector));
          vectors.set(passage.id, vector);
        }
      }
      return vectors;
    })();
    this.productInitialization.set(productId, pending);
    try { return await pending; } catch (error) { this.productInitialization.delete(productId); throw error; }
  }

  retrieve(productId: string, question: string): Promise<RetrievalResult> {
    // Serialize ONNX execution, keeping concurrent HTTP calls safe and reproducible.
    const result = this.queue.then(() => this.performRetrieval(productId, question));
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Offline diagnostic: the same query and context budget across all three rankings. */
  compareRankings(productId: string, question: string): Promise<{ result: RetrievalResult; rankings: { bm25: string[]; dense: string[]; hybrid: string[] } }> {
    const result = this.queue.then(() => this.performRetrieval(productId, question, true));
    this.queue = result.catch(() => undefined);
    return result.then(({ rankings, ...retrieval }) => ({ result: retrieval, rankings: rankings! }));
  }

  private async performRetrieval(productId: string, question: string, compare = false): Promise<RetrievalResult & { rankings?: { bm25: string[]; dense: string[]; hybrid: string[] } }> {
    if (this.closed) throw new Error('Product retriever is closed.');
    if (!question.trim()) throw new Error('A nonempty question is required.');
    const pool = this.byProduct.get(productId);
    if (!pool) throw new Error(`Unknown product: ${productId}.`);
    const start = performance.now();
    const terms = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].slice(0, 80);
    const match = terms.map(term => `"${term.replaceAll('"', '""')}"`).join(' OR ');
    const lexical = match ? (this.db.prepare(`SELECT passage_id FROM product_passages_fts WHERE product_passages_fts MATCH ? AND corpus=? AND product_id=? ORDER BY bm25(product_passages_fts), passage_id LIMIT ?`).all(match, this.corpus.version, productId, CANDIDATES_PER_METHOD) as { passage_id: string }[]).map(row => row.passage_id) : [];
    const vectors = await this.vectors(productId);
    const queries = await this.embed([question], 'query');
    if (queries.length !== 1) throw new Error('Query embedding length mismatch.');
    const query = normalized(queries[0]);
    const semantic = pool.map(passage => {
      const vector = vectors.get(passage.id)!;
      if (vector.length !== query.length) throw new Error('Embedding dimensions differ; invalidate the model cache.');
      return { id: passage.id, score: vector.reduce((sum, value, index) => sum + value * query[index], 0) };
    }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, CANDIDATES_PER_METHOD).map(entry => entry.id);
    const byId = new Map(pool.map(passage => [passage.id, passage]));
    const fused = reciprocalRankFusion(lexical, semantic);
    const select = (ids: string[]) => {
      const chosen: string[] = [], seenText = new Set<string>(); let chars = 0;
      for (const id of ids) {
        const passage = byId.get(id)!;
        // Identical answers can describe different models in their parent questions.
        const contextKey = JSON.stringify([passage.sha256, passage.originalQuestion ?? null]);
        const contextLength = passage.text.length + (passage.originalQuestion?.length ?? 0);
        if (seenText.has(contextKey) || chars + contextLength > CONTEXT_CHAR_BUDGET) continue;
        chosen.push(id); seenText.add(contextKey); chars += contextLength;
        if (chosen.length === MAX_PASSAGES) break;
      }
      return chosen;
    };
    const hybrid = select(fused.map(item => item.id));
    const byRank = new Map(fused.map(item => [item.id, item]));
    const passages: RetrievedPassage[] = hybrid.map(id => ({ ...byId.get(id)!, ...byRank.get(id)! }));
    const result = { passages, durationMs: performance.now() - start, method: `hybrid:fts5-bm25+bge-cosine+rrf(k=60)${this.indexText === cqaAnswerText ? '+cqa-answer-index' : ''}`, embeddingModel: `${this.modelId}@${this.revision}`, corpusVersion: this.corpus.version };
    return compare ? { ...result, rankings: { bm25: select(lexical), dense: select(semantic), hybrid } } : result;
  }

  close(): void { if (!this.closed) { this.closed = true; this.db.close(); } }
}
