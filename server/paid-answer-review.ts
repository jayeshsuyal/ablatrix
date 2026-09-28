import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

const evidenceDir = fileURLToPath(new URL('../docs/evidence/paid-qa-batch-2026-09-28/', import.meta.url));
const pinnedManifestSha = '125def79dfcd8823e1ca5c38b125fcdc5bdfcbd55222e4cbc1236c6b3a666dd2';
const pinnedResultsSha = 'cad0c449824d169c23014ad85c317a483d0b15b342241971b2a2d416e9a9b54b';
const verdicts = ['correct', 'incorrect', 'uncertain'] as const;
const categories = ['none', 'unsupported_claim', 'incomplete_answer', 'missed_evidence', 'source_conflict', 'unnecessary_abstention', 'other'] as const;
const reviewInput = z.object({
  reviewer: z.string().trim().min(2).max(100),
  answerVerdict: z.enum(verdicts),
  supportVerdict: z.enum(['supported', 'unsupported', 'uncertain']),
  category: z.enum(categories),
  checkedSourceShas: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(8),
  note: z.string().trim().max(2000),
  referenceChecked: z.literal(true)
}).strict();

type ManifestCase = { qid: string; asin: string; title: string; question: string; sources: { label: string; text: string; sha256: string; originalLabel: number }[] };
type SavedRun = { qid: string; asin: string; run: { id: string; status: string; answer: { answer: string; status: string; citations: { passageId: string; quote: string }[] } | null; retrieval: { passages: { id: string; sha256: string; text: string; reference: string }[] } | null; model: string | null }; clientMs: number | null };
export type PaidReview = z.infer<typeof reviewInput> & { qid: string; manifestSha256: string; runId: string; createdAt: string; kind: 'human' };

/** Reviews a pinned historical batch; no model provider or experiment workspace is opened. */
export class PaidAnswerReview {
  private db: DatabaseSync;
  private cases: ManifestCase[];
  private runs: Map<string, SavedRun>;
  constructor(dbPath = '.data/paid-answer-review.sqlite', sourceDir = evidenceDir) {
    const bytes = readFileSync(resolve(sourceDir, 'manifest.json'));
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== pinnedManifestSha) throw new Error('Paid review: pinned manifest changed.');
    const manifest = JSON.parse(bytes.toString()) as { cases: ManifestCase[] };
    const resultsBytes = readFileSync(resolve(sourceDir, 'results.json'));
    if (createHash('sha256').update(resultsBytes).digest('hex') !== pinnedResultsSha) throw new Error('Paid review: pinned results changed.');
    const results = JSON.parse(resultsBytes.toString()) as { manifestSha256: string; runs: SavedRun[] };
    if (results.manifestSha256 !== sha || manifest.cases.length !== 20 || results.runs.length !== 20 ||
      new Set(manifest.cases.map(item => item.qid)).size !== 20 || new Set(results.runs.map(item => item.qid)).size !== 20 ||
      manifest.cases.some(item => !results.runs.some(result => result.qid === item.qid && result.asin === item.asin && result.run.status === 'completed' && result.run.answer && result.run.retrieval))) {
      throw new Error('Paid review: saved results do not match the pinned batch.');
    }
    this.cases = manifest.cases;
    this.runs = new Map(results.runs.map(item => [item.qid, item]));
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('CREATE TABLE IF NOT EXISTS paid_answer_reviews (qid TEXT PRIMARY KEY, manifest_sha TEXT NOT NULL, document TEXT NOT NULL)');
  }
  private reviews(): PaidReview[] {
    return (this.db.prepare('SELECT document FROM paid_answer_reviews WHERE manifest_sha=?').all(pinnedManifestSha) as { document: string }[]).map(row => JSON.parse(row.document) as PaidReview);
  }
  overview() {
    const reviews = this.reviews();
    const byQid = new Map(reviews.map(item => [item.qid, item]));
    const judged = reviews.filter(item => item.answerVerdict !== 'uncertain');
    return {
      manifestSha256: pinnedManifestSha,
      cases: this.cases.map(item => ({ qid: item.qid, asin: item.asin, title: item.title, question: item.question,
        sources: item.sources.map(source => ({ label: source.label, text: source.text, sha256: source.sha256 })),
        result: this.runs.get(item.qid), review: byQid.get(item.qid) ?? null })),
      summary: { total: this.cases.length, reviewed: reviews.length, judged: judged.length,
        correct: judged.filter(item => item.answerVerdict === 'correct').length,
        incorrect: judged.filter(item => item.answerVerdict === 'incorrect').length,
        uncertain: reviews.filter(item => item.answerVerdict === 'uncertain').length,
        categories: Object.fromEntries(categories.filter(category => category !== 'none').map(category => [category, reviews.filter(item => item.category === category).length])) }
    };
  }
  review(qid: string, raw: unknown): PaidReview {
    const item = this.cases.find(entry => entry.qid === qid);
    if (!item) throw new Error('Paid review: case not found.');
    const input = reviewInput.parse(raw);
    if (new Set(input.checkedSourceShas).size !== input.checkedSourceShas.length ||
      input.checkedSourceShas.some(sha => !item.sources.some(source => source.sha256 === sha))) throw new Error('Paid review: checked sources must belong to this product.');
    if (input.answerVerdict === 'correct' && (input.supportVerdict !== 'supported' || input.category !== 'none')) throw new Error('Paid review: a correct answer must be supported with no failure category.');
    if (input.answerVerdict !== 'correct' && input.category === 'none') throw new Error('Paid review: choose a failure or uncertainty category.');
    if (input.answerVerdict !== 'correct' && input.note.length < 10) throw new Error('Paid review: explain the failure or uncertainty in at least 10 characters.');
    const review: PaidReview = { ...input, qid, manifestSha256: pinnedManifestSha, runId: this.runs.get(qid)!.run.id, createdAt: new Date().toISOString(), kind: 'human' };
    try { this.db.prepare('INSERT INTO paid_answer_reviews(qid,manifest_sha,document) VALUES(?,?,?)').run(qid, pinnedManifestSha, JSON.stringify(review)); }
    catch (error) { if (error instanceof Error && /UNIQUE constraint/.test(error.message)) throw new Error('Paid review: this case has already been reviewed.'); throw error; }
    return review;
  }
  close() { this.db.close(); }
}
