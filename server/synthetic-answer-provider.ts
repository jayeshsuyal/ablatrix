import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { answerSchema } from './feedback-provider.ts';
import type { AnswerRevisionProvider, AnswerRevisionReceipt } from './answer-revisions.ts';
import type { LoopAnswer, LoopProvider } from './loop-types.ts';

type Source = { id: string; source: string; text: string; originalQuestion?: string; origin?: string };
/** Offline templates with durable replay receipts. No credentials, network, tokens or spending reservations. */
export class SyntheticAnswerProvider implements LoopProvider, AnswerRevisionProvider {
  readonly executionMode = 'synthetic' as const;
  private readonly db: DatabaseSync;
  private closed = false;
  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS synthetic_answer_receipts(run_id TEXT PRIMARY KEY,input_sha256 TEXT NOT NULL,document TEXT NOT NULL)');
  }
  readiness() { return { ready: !this.closed, reason: this.closed ? 'Synthetic provider is closed.' : 'Synthetic local templates only; no model call, charge, or planning reservation.' }; }
  capacity(requests: number) { return Number.isSafeInteger(requests) && requests >= 1 && requests <= 100 ? this.readiness() : { ready: false, reason: 'Synthetic request count is outside the supported bound.' }; }
  recoverInterruptedCalls() { /* Local computation and receipt insertion commit atomically; there is no external outcome to reconcile. */ }
  receipt(runId: string): AnswerRevisionReceipt | undefined {
    const row = this.db.prepare('SELECT document FROM synthetic_answer_receipts WHERE run_id=?').get(runId) as { document: string } | undefined;
    return row ? JSON.parse(row.document) as AnswerRevisionReceipt : undefined;
  }
  externalReceipts() { return []; }
  private execute(runId: string, kind: string, input: unknown, output: () => LoopAnswer) {
    if (this.closed) throw new Error('Synthetic provider is closed.');
    const hash = createHash('sha256').update(JSON.stringify({ kind, input })).digest('hex');
    const prior = this.db.prepare('SELECT input_sha256,document FROM synthetic_answer_receipts WHERE run_id=?').get(runId) as { input_sha256: string; document: string } | undefined;
    if (prior) {
      if (prior.input_sha256 !== hash) throw new Error('Synthetic receipt identity belongs to a different request.');
      const receipt = JSON.parse(prior.document) as AnswerRevisionReceipt;
      return { attemptId: receipt.id, answer: answerSchema.parse(JSON.parse(receipt.receipt_json!).output), model: 'synthetic-fixture', usage: null };
    }
    const answer = answerSchema.parse(output());
    const receipt: AnswerRevisionReceipt = { id: `synthetic-${randomUUID()}`, kind, status: 'completed', model: 'synthetic-fixture', input_tokens: null, output_tokens: null, error_code: null,
      receipt_json: JSON.stringify({ output: answer, model: 'synthetic-fixture', mode: 'synthetic', accounting: 'no_provider_call' }), allowance_usd: 0, executionMode: 'synthetic', accounting: 'no_provider_call' };
    this.db.prepare('INSERT INTO synthetic_answer_receipts(run_id,input_sha256,document) VALUES(?,?,?)').run(runId, hash, JSON.stringify(receipt));
    return { attemptId: receipt.id, answer, model: 'synthetic-fixture', usage: null };
  }
  private template(sources: Source[], revised: boolean): LoopAnswer {
    const selected = [...sources].filter(source => source.text.trim()).sort((a, b) => Number(b.origin === 'reviewer_added') - Number(a.origin === 'reviewer_added')).slice(0, revised ? 3 : 1);
    if (!selected.length) return { status: 'insufficient_evidence', answer: 'SYNTHETIC example: no source excerpt is available. Add a relevant source before reviewing this answer.', citations: [] };
    const excerpts = selected.map(source => ({ source, quote: source.text.slice(0, 350).trim() }));
    return { status: 'answered', answer: `SYNTHETIC ${revised ? 'revision' : 'draft'} — scripted source excerpts, not a model-generated answer.\n${excerpts.map(({ source, quote }) => `${source.source}: “${quote}”${revised && source.originalQuestion ? `\nOriginal question context: ${source.originalQuestion}` : ''}`).join('\n')}\n${revised ? 'This illustrates a correction using the saved source context. Check applicability yourself; it does not demonstrate measured improvement.' : 'Review the complete source context before accepting this example.'}`,
      citations: excerpts.map(({ source, quote }) => ({ passageId: source.id, quote })) };
  }
  async answer(input: Parameters<LoopProvider['answer']>[0]) {
    return this.execute(input.runId ?? randomUUID(), 'synthetic_answer', input, () => this.template(input.passages.map(passage => ({ ...passage })), false));
  }
  async answerWithSnippetIds(input: Parameters<LoopProvider['answer']>[0]) { return this.answer(input); }
  async revise(input: Parameters<AnswerRevisionProvider['revise']>[0]) { return this.execute(input.runId, 'synthetic_revision', input, () => this.template(input.evidence, true)); }
  async propose(): Promise<{ instructions: string; rationale: string }> { throw new Error('Synthetic workspace answers cannot propose evaluation policies.'); }
  close() { if (!this.closed) { this.closed = true; this.db.close(); } }
}
