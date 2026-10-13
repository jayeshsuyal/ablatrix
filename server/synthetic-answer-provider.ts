import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { answerSchema, revisionRequestBody, type RevisionInput } from './feedback-provider.ts';
import { revisionPromptIdentity } from './revision-policy.ts';
import type { AnswerRevisionProvider, AnswerRevisionReceipt } from './answer-revisions.ts';
import type { LoopAnswer, LoopProvider } from './loop-types.ts';
import { CLAIM_SUPPORT_TOOL, claimSupportRequestParts, validateClaimSupportOutput, replayClaimSupportReceipt, type ClaimSupportInput, type ClaimSupportWireOutput } from './claim-support.ts';

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
  private execute(runId: string, kind: string, input: unknown, output: () => LoopAnswer, identity: Record<string, unknown> = {}) {
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
      receipt_json: JSON.stringify({ output: answer, model: 'synthetic-fixture', mode: 'synthetic', accounting: 'no_provider_call', ...identity }), allowance_usd: 0, executionMode: 'synthetic', accounting: 'no_provider_call' };
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
  async reviseAutomatic(input: RevisionInput) {
    const frozen = structuredClone(input), prompt = revisionPromptIdentity(frozen.revisionPolicy, Boolean(frozen.investigation)), requestSha256 = createHash('sha256').update(JSON.stringify(revisionRequestBody(frozen))).digest('hex'), previous = this.receipt(frozen.runId);
    if (previous) {
      try {
        const document = JSON.parse(previous.receipt_json!);
        if (previous.kind !== 'synthetic_automatic_revision' || previous.status !== 'completed' || previous.error_code || previous.model !== 'synthetic-fixture' || document.model !== 'synthetic-fixture' || document.accounting !== 'no_provider_call' || document.requestSha256 !== requestSha256 || document.promptVersion !== prompt.promptVersion || document.systemInstructionsSha256 !== prompt.systemInstructionsSha256) throw new Error('receipt_identity');
      } catch { throw new Error('Synthetic automatic repair requires reconciliation; it was not redispatched.'); }
    }
    const identity = { requestSha256, promptVersion: prompt.promptVersion, systemInstructionsSha256: prompt.systemInstructionsSha256, revisionPolicy: prompt.policy };
    return { ...this.execute(frozen.runId, 'synthetic_automatic_revision', frozen, () => this.template(frozen.evidence, true), identity), ...identity };
  }
  async gradeClaimSupport(input: ClaimSupportInput) {
    if (this.closed) throw new Error('Synthetic provider is closed.');
    const parts = claimSupportRequestParts(input), previous = this.receipt(input.runId);
    if (previous) return replayClaimSupportReceipt(input, previous, 'synthetic');
    const fixture = parts.normalized.evidence.every(source => source.text.startsWith('SYNTHETIC fixture:'));
    const draft = fixture && input.answer.answer.startsWith('SYNTHETIC draft — scripted source excerpts'), revised = fixture && input.answer.answer.startsWith('SYNTHETIC revision — scripted source excerpts');
    const proof = parts.normalized.evidence.find(source => input.answer.citations.some(citation => citation.passageId === source.id));
    // Only explicitly synthetic source fixtures demonstrate repair/pass. All
    // ordinary source snapshots remain uncertain; there is no semantic model.
    const output: ClaimSupportWireOutput = {
      units: parts.units.map(unit => ({ unitId: unit.id, verdict: revised && proof ? 'supported' : draft ? 'unsupported' : 'uncertain', evidence: revised && proof ? [{ sourceId: proof.id, quote: proof.text, relation: 'supports' }] : [], reason: 'SYNTHETIC scripted workflow state only; no semantic model assessment.' })),
      questionCoverage: draft || revised ? 'complete' : 'uncertain', answerability: draft || revised ? 'answerable' : 'uncertain', correctness: draft || revised ? 'consistent_with_sources' : 'uncertain', uncertaintyHandling: 'appropriate',
      reason: 'SYNTHETIC demonstration: this template checks workflow behavior only and does not establish answer correctness or improvement.'
    };
    const assessment = validateClaimSupportOutput(input, output, 'synthetic_scripted_claim_support');
    const receipt: AnswerRevisionReceipt = { id: `synthetic-${randomUUID()}`, kind: CLAIM_SUPPORT_TOOL, status: 'completed', model: 'synthetic-fixture', input_tokens: null, output_tokens: null, error_code: null,
      receipt_json: JSON.stringify({ output, model: 'synthetic-fixture', usage: null, promptVersion: parts.prompt.promptVersion, ...parts.bindings, assessmentKind: 'synthetic_scripted_claim_support', mode: 'synthetic', accounting: 'no_provider_call' }), allowance_usd: 0, executionMode: 'synthetic', accounting: 'no_provider_call' };
    this.db.prepare('INSERT INTO synthetic_answer_receipts(run_id,input_sha256,document) VALUES(?,?,?)').run(input.runId, parts.bindings.requestSha256, JSON.stringify(receipt));
    return { assessment, attemptId: receipt.id, model: 'synthetic-fixture', usage: null, promptVersion: parts.prompt.promptVersion, ...parts.bindings };
  }
  async propose(): Promise<{ instructions: string; rationale: string }> { throw new Error('Synthetic workspace answers cannot propose evaluation policies.'); }
  close() { if (!this.closed) { this.closed = true; this.db.close(); } }
}
