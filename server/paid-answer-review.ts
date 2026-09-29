import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

const evidenceDir = fileURLToPath(new URL('../docs/evidence/paid-qa-batch-2026-09-28/', import.meta.url));
const pinnedManifestSha = '125def79dfcd8823e1ca5c38b125fcdc5bdfcbd55222e4cbc1236c6b3a666dd2';
const pinnedResultsSha = 'cad0c449824d169c23014ad85c317a483d0b15b342241971b2a2d416e9a9b54b';
const pinnedDraftsSha = 'ad4fce66fdac6306d423e6d3e128abb7fcb99d6daf84d3e0fa3faab574cccdea';
const pinnedSourceContextSha = '6808fdd8ffee30b15d391238aa7165d732b249bdd02799635f3de895c7ba06d5';
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
type SourceContext = { qid: string; sourceSha256: string; originalQuestion: string };
type SavedRun = { qid: string; asin: string; run: { id: string; status: string; answer: { answer: string; status: string; citations: { passageId: string; quote: string }[] } | null; retrieval: { passages: { id: string; sha256: string; text: string; reference: string }[] } | null; model: string | null }; clientMs: number | null };
export type PaidReview = z.infer<typeof reviewInput> & { qid: string; manifestSha256: string; sourceContextSha256: string; runId: string; createdAt: string; kind: 'human' };
export type PaidAiDraft = { qid: string; asin: string; runId: string; answerVerdict: 'correct' | 'incorrect' | 'uncertain'; supportVerdict: 'supported' | 'unsupported' | 'uncertain'; category: (typeof categories)[number]; confidence: 'high' | 'medium' | 'low'; sourceShas: string[]; note: string };

/** Reviews a pinned historical batch; no model provider or experiment workspace is opened. */
export class PaidAnswerReview {
  private db: DatabaseSync;
  private cases: ManifestCase[];
  private runs: Map<string, SavedRun>;
  private aiDrafts: Map<string, PaidAiDraft>;
  private sourceContexts: Map<string, string>;
  constructor(dbPath = '.data/paid-answer-review.sqlite', sourceDir = evidenceDir) {
    const bytes = readFileSync(resolve(sourceDir, 'manifest.json'));
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== pinnedManifestSha) throw new Error('Paid review: pinned manifest changed.');
    const manifest = JSON.parse(bytes.toString()) as { upstreamSha256: string; cases: ManifestCase[] };
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
    const contextBytes = readFileSync(resolve(sourceDir, 'source-context.json'));
    if (createHash('sha256').update(contextBytes).digest('hex') !== pinnedSourceContextSha) throw new Error('Paid review: pinned source context changed.');
    const contextPacket = JSON.parse(contextBytes.toString()) as { kind: string; manifestSha256: string; upstreamSha256: string; contexts: SourceContext[] };
    const expectedCqaCount = this.cases.flatMap(item => item.sources).filter(source => source.label.startsWith('ePQA cqa')).length;
    if (contextPacket.kind !== 'original_cqa_question_context' || contextPacket.manifestSha256 !== sha || contextPacket.upstreamSha256 !== manifest.upstreamSha256 ||
      contextPacket.contexts.length !== expectedCqaCount || new Set(contextPacket.contexts.map(item => `${item.qid}:${item.sourceSha256}`)).size !== expectedCqaCount ||
      contextPacket.contexts.some(context => !context.originalQuestion || !this.cases.some(item => item.qid === context.qid && item.sources.some(source => source.sha256 === context.sourceSha256 && source.label.startsWith('ePQA cqa'))))) {
      throw new Error('Paid review: source context does not match the pinned batch.');
    }
    this.sourceContexts = new Map(contextPacket.contexts.map(item => [`${item.qid}:${item.sourceSha256}`, item.originalQuestion]));
    const draftBytes = readFileSync(resolve(sourceDir, 'ai-review-drafts.json'));
    if (createHash('sha256').update(draftBytes).digest('hex') !== pinnedDraftsSha) throw new Error('Paid review: pinned AI drafts changed.');
    const packet = JSON.parse(draftBytes.toString()) as { kind: string; manifestSha256: string; resultsSha256: string; drafts: PaidAiDraft[] };
    if (packet.kind !== 'ai_assisted_review_drafts' || packet.manifestSha256 !== sha || packet.resultsSha256 !== pinnedResultsSha || packet.drafts.length !== 20 ||
      new Set(packet.drafts.map(item => item.qid)).size !== 20 || packet.drafts.some(draft => {
        const item = this.cases.find(entry => entry.qid === draft.qid);
        return !item || draft.asin !== item.asin || draft.runId !== this.runs.get(draft.qid)?.run.id ||
          !verdicts.includes(draft.answerVerdict) || !categories.includes(draft.category) ||
          !['supported', 'unsupported', 'uncertain'].includes(draft.supportVerdict) || !['high', 'medium', 'low'].includes(draft.confidence) ||
          !draft.note || !draft.sourceShas.length || draft.sourceShas.some(sourceSha => !item.sources.some(source => source.sha256 === sourceSha));
      })) throw new Error('Paid review: AI drafts do not match the pinned batch.');
    this.aiDrafts = new Map(packet.drafts.map(item => [item.qid, item]));
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    // Keep pre-context reviews in the old table for audit, but never count them under this protocol.
    this.db.exec('CREATE TABLE IF NOT EXISTS paid_answer_reviews_v2 (qid TEXT NOT NULL, manifest_sha TEXT NOT NULL, source_context_sha TEXT NOT NULL, document TEXT NOT NULL, PRIMARY KEY(qid, manifest_sha, source_context_sha))');
  }
  private reviews(): PaidReview[] {
    return (this.db.prepare('SELECT document FROM paid_answer_reviews_v2 WHERE manifest_sha=? AND source_context_sha=?').all(pinnedManifestSha, pinnedSourceContextSha) as { document: string }[]).map(row => JSON.parse(row.document) as PaidReview);
  }
  overview() {
    const reviews = this.reviews();
    const byQid = new Map(reviews.map(item => [item.qid, item]));
    const judged = reviews.filter(item => item.answerVerdict !== 'uncertain');
    return {
      manifestSha256: pinnedManifestSha,
      cases: this.cases.map(item => ({ qid: item.qid, asin: item.asin, title: item.title, question: item.question,
        sources: item.sources.map(source => ({ label: source.label, text: source.text, sha256: source.sha256, originalQuestion: this.sourceContexts.get(`${item.qid}:${source.sha256}`) ?? null })),
        result: this.runs.get(item.qid), review: byQid.get(item.qid) ?? null, aiDraft: this.aiDrafts.get(item.qid) ?? null })),
      summary: { total: this.cases.length, reviewed: reviews.length, judged: judged.length,
        correct: judged.filter(item => item.answerVerdict === 'correct').length,
        incorrect: judged.filter(item => item.answerVerdict === 'incorrect').length,
        uncertain: reviews.filter(item => item.answerVerdict === 'uncertain').length,
        aiDrafts: this.aiDrafts.size,
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
    const review: PaidReview = { ...input, qid, manifestSha256: pinnedManifestSha, sourceContextSha256: pinnedSourceContextSha, runId: this.runs.get(qid)!.run.id, createdAt: new Date().toISOString(), kind: 'human' };
    try { this.db.prepare('INSERT INTO paid_answer_reviews_v2(qid,manifest_sha,source_context_sha,document) VALUES(?,?,?,?)').run(qid, pinnedManifestSha, pinnedSourceContextSha, JSON.stringify(review)); }
    catch (error) { if (error instanceof Error && /UNIQUE constraint/.test(error.message)) throw new Error('Paid review: this case has already been reviewed.'); throw error; }
    return review;
  }
  close() { this.db.close(); }
}
