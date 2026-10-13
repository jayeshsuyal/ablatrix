import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { answerSchema, revisionRequestBody, type SapiomFeedbackProvider } from './feedback-provider.ts';
import { parseReviewAnswerSnapshot, type ReviewAnswerSnapshot } from './answer-review-source.ts';
import { originalAnswerVersionId } from './paid-answer-review.ts';
import { revisionPromptIdentity } from './revision-policy.ts';
import { claimSupportRequestParts, replayClaimSupportReceipt, type ClaimSupportInput, type ValidatedClaimSupportAssessment } from './claim-support.ts';
import type { AnswerRevisionReceipt, AnswerRevisionProvider } from './answer-revisions.ts';
import type { LoopAnswer, LoopUsage } from './loop-types.ts';

export type AutomaticSupportProvider = Pick<AnswerRevisionProvider, 'readiness' | 'capacity'> & Pick<SapiomFeedbackProvider, 'gradeClaimSupport'> & {
  reviseAutomatic(input: Parameters<AnswerRevisionProvider['revise']>[0]): ReturnType<AnswerRevisionProvider['revise']>;
  receipt(runId: string): AnswerRevisionReceipt | undefined;
  executionMode?: 'live' | 'synthetic';
};
type Phase = 'grade_original' | 'repair' | 'grade_repair';
type Status = 'queued' | 'checking' | 'repairing' | 'rechecking' | 'supported' | 'repaired' | 'abstained' | 'inconclusive' | 'reconciliation';
type Operation = { phase: Phase; runId: string; status: 'started' | 'completed' | 'invalid' | 'unknown'; requestSha256: string; startedAt: string; finishedAt?: string; receiptId?: string;
  providerCallStatus?: string; planningAllowanceUsd?: number | null; usage?: LoopUsage; accounting?: 'planning_allowance' | 'no_provider_call' };
export type AutomaticSupportJob = {
  id: string; qid: string; originalId: string; mode: 'live' | 'synthetic'; status: Status; phase: Phase;
  original: ReviewAnswerSnapshot; sourceContextSha256: string; originalAnswerSha256: string;
  assessments: { phase: 'original' | 'repair'; assessment: ValidatedClaimSupportAssessment; model: string; promptVersion: string; receiptId: string; usage: LoopUsage }[];
  operations: Operation[];
  repaired?: { id: string; answer: LoopAnswer; model: string; promptVersion: string; answerSha256: string; sourceContextSha256: string; createdAt: string };
  delivery?: { answer: LoopAnswer; versionId: string | null; origin: 'original' | 'repair' | 'safe_abstention' };
  assessmentKind: 'ai_claim_support_estimate' | 'synthetic_scripted_claim_support'; qualityClaimEligible: false;
  createdAt: string; finishedAt?: string; error?: string;
};
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const active = new Set<Status>(['checking', 'repairing', 'rechecking']);
const remainingCalls: Record<Phase, number> = { grade_original: 3, repair: 2, grade_repair: 1 };
const phaseStatus: Record<Phase, Status> = { grade_original: 'checking', repair: 'repairing', grade_repair: 'rechecking' };

/** A bounded companion to the revision worker. AI estimates never enter human review tables. */
export class AutomaticSupport {
  private readonly db: DatabaseSync;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private busy = false;
  private paused = false;
  private closed = false;
  constructor(private readonly provider: AutomaticSupportProvider, dbPath = '.data/paid-answer-review.sqlite',
    private readonly options: { automatic?: boolean; canDispatch?: () => boolean; liveEnabled?: boolean } = {}) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS automatic_support_jobs(id TEXT PRIMARY KEY,qid TEXT NOT NULL,original_id TEXT NOT NULL UNIQUE,status TEXT NOT NULL,document TEXT NOT NULL,lease_expires INTEGER);
      CREATE INDEX IF NOT EXISTS automatic_support_qid ON automatic_support_jobs(qid);`);
    this.reconcile();
    if (options.automatic) this.start();
  }
  start() {
    if (this.timer || this.paused || this.closed) return;
    this.timer = setInterval(() => { void this.tick().catch(error => console.error('Automatic source-check worker failed:', error)); }, 1500);
    this.timer.unref();
  }
  readiness() {
    if (this.closed || this.paused) return { ready: false, reason: 'Automatic source checks are paused.' };
    if (typeof this.provider.gradeClaimSupport !== 'function' || typeof this.provider.reviseAutomatic !== 'function') return { ready: false, reason: 'The configured provider does not support automatic source checks.' };
    if (this.provider.executionMode !== 'synthetic' && !this.options.liveEnabled) return { ready: false, reason: 'Live automatic source checks require their independent opt-in and an approved three-call allowance.' };
    return this.provider.capacity(3);
  }
  get(qid: string): AutomaticSupportJob | null {
    const row = this.db.prepare('SELECT document FROM automatic_support_jobs WHERE qid=? ORDER BY rowid DESC LIMIT 1').get(qid) as { document: string } | undefined;
    return row ? JSON.parse(row.document) as AutomaticSupportJob : null;
  }
  overview(qid?: string): AutomaticSupportJob[] {
    const rows = qid === undefined ? this.db.prepare('SELECT document FROM automatic_support_jobs ORDER BY rowid DESC').all() : this.db.prepare('SELECT document FROM automatic_support_jobs WHERE qid=? ORDER BY rowid DESC').all(qid);
    return (rows as { document: string }[]).map(row => JSON.parse(row.document) as AutomaticSupportJob);
  }
  enqueue(raw: ReviewAnswerSnapshot): AutomaticSupportJob {
    const snapshot = parseReviewAnswerSnapshot(raw);
    if (snapshot.contextProvenance !== 'workspace_source_snapshot') throw new Error('Automatic checks require the complete saved workspace source context.');
    const originalId = originalAnswerVersionId(snapshot.id, snapshot.runId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.db.prepare('SELECT document FROM automatic_support_jobs WHERE original_id=?').get(originalId) as { document: string } | undefined;
      if (prior) {
        const job = JSON.parse(prior.document) as AutomaticSupportJob;
        if (JSON.stringify(job.original) !== JSON.stringify(snapshot)) throw new Error('Automatic check identity belongs to a different immutable answer snapshot.');
        this.db.exec('COMMIT'); return job;
      }
      const mode = snapshot.mode ?? 'live';
      if (mode !== (this.provider.executionMode ?? 'live')) throw new Error('Automatic check provenance does not match the configured provider.');
      const ready = this.readiness();
      if (!ready.ready) throw new Error(`Automatic check: ${ready.reason}`);
      const job: AutomaticSupportJob = { id: randomUUID(), qid: snapshot.id, originalId, mode, status: 'queued', phase: 'grade_original', original: snapshot,
        sourceContextSha256: sha(snapshot.context), originalAnswerSha256: sha(snapshot.answer), assessments: [], operations: [],
        assessmentKind: mode === 'synthetic' ? 'synthetic_scripted_claim_support' : 'ai_claim_support_estimate', qualityClaimEligible: false, createdAt: new Date().toISOString() };
      // Validate the bounded grader input before reserving any provider operation.
      claimSupportRequestParts(this.gradeInput(job));
      this.db.prepare('INSERT INTO automatic_support_jobs(id,qid,original_id,status,document) VALUES(?,?,?,?,?)').run(job.id, job.qid, originalId, job.status, JSON.stringify(job));
      this.db.exec('COMMIT'); return structuredClone(job);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  hasActive() { return this.busy; }
  private save(job: AutomaticSupportJob, lease: number | null = null) {
    this.db.prepare('UPDATE automatic_support_jobs SET status=?,document=?,lease_expires=? WHERE id=?').run(job.status, JSON.stringify(job), lease, job.id);
  }
  private evidence(job: AutomaticSupportJob) {
    return job.original.context.sources.map(source => ({ id: source.id, source: source.label, text: source.text,
      ...(source.originalQuestion !== null ? { originalQuestion: source.originalQuestion } : {}), origin: source.origin, ...(source.reference ? { reference: source.reference } : {}) }));
  }
  private runId(job: AutomaticSupportJob) { return `${job.id}:${job.phase.replaceAll('_', '-')}`; }
  private gradeInput(job: AutomaticSupportJob): ClaimSupportInput {
    return { runId: this.runId(job), question: job.original.context.question, product: job.original.context.product,
      answer: job.phase === 'grade_repair' ? job.repaired!.answer : job.original.answer,
      evidence: this.evidence(job), clarifications: job.original.context.clarifications };
  }
  private repairInput(job: AutomaticSupportJob): Parameters<AutomaticSupportProvider['reviseAutomatic']>[0] {
    const grade = job.assessments.find(item => item.phase === 'original')!.assessment;
    const critique = JSON.stringify({ reason: grade.reason, questionCoverage: grade.questionCoverage, answerability: grade.answerability,
      correctness: grade.correctness, uncertaintyHandling: grade.uncertaintyHandling,
      units: grade.units.map(unit => ({ unitId: unit.unitId, verdict: unit.verdict, reason: unit.reason, sourceIds: unit.evidence.map(proof => proof.sourceId) })) });
    return { runId: this.runId(job), question: job.original.context.question, product: job.original.context.product,
      rejectedAnswer: job.original.answer.answer, critique, evidence: this.evidence(job), clarifications: job.original.context.clarifications };
  }
  private requestHash(job: AutomaticSupportJob) { return job.phase === 'repair' ? sha(revisionRequestBody(this.repairInput(job))) : claimSupportRequestParts(this.gradeInput(job)).bindings.requestSha256; }
  private validateSavedContext(job: AutomaticSupportJob) {
    parseReviewAnswerSnapshot(job.original);
    if (job.original.contextProvenance !== 'workspace_source_snapshot' || sha(job.original.context) !== job.sourceContextSha256 || sha(job.original.answer) !== job.originalAnswerSha256 ||
      (job.repaired && (sha(job.repaired.answer) !== job.repaired.answerSha256 || job.repaired.sourceContextSha256 !== job.sourceContextSha256))) throw new Error('Automatic check context no longer matches its immutable hashes.');
  }
  private finish(job: AutomaticSupportJob, status: 'abstained' | 'inconclusive' | 'reconciliation', error?: string) {
    job.status = status; job.finishedAt = new Date().toISOString(); if (error) job.error = error;
    const operation = job.operations.find(item => item.phase === job.phase);
    if (operation?.status === 'started') { operation.status = 'unknown'; operation.finishedAt = job.finishedAt; }
    job.delivery = { origin: 'safe_abstention', versionId: null, answer: { status: 'insufficient_evidence', answer: `${job.mode === 'synthetic' ? 'SYNTHETIC example: ' : ''}I could not confirm an answer against the saved sources.`, citations: [] } };
    this.save(job);
  }
  private consume(job: AutomaticSupportJob, receipt: AnswerRevisionReceipt) {
    const operation = job.operations.find(item => item.phase === job.phase);
    try {
      this.validateSavedContext(job);
      if (!operation || operation.requestSha256 !== this.requestHash(job)) throw new Error('Operation identity mismatch.');
    } catch { this.finish(job, 'inconclusive', 'Saved operation does not match its immutable request.'); return; }
    operation.receiptId = receipt.id; operation.finishedAt = new Date().toISOString(); operation.providerCallStatus = receipt.status;
    operation.planningAllowanceUsd = job.mode === 'synthetic' ? null : receipt.allowance_usd;
    operation.usage = receipt.input_tokens !== null && receipt.output_tokens !== null ? { inputTokens: receipt.input_tokens, outputTokens: receipt.output_tokens } : null;
    operation.accounting = job.mode === 'synthetic' ? 'no_provider_call' : 'planning_allowance';
    if (receipt.status !== 'completed') { operation.status = 'unknown'; this.finish(job, 'reconciliation', 'A recorded provider outcome is uncertain. It will not be retried.'); return; }
    try {
      if (job.phase !== 'repair') {
        const result = replayClaimSupportReceipt(this.gradeInput(job), receipt, job.mode);
        const phase = job.phase === 'grade_original' ? 'original' : 'repair';
        job.assessments.push({ phase, assessment: result.assessment, model: result.model, promptVersion: result.promptVersion, receiptId: receipt.id, usage: result.usage });
        operation.status = 'completed';
        if (result.assessment.disposition === 'pass') {
          job.status = phase === 'original' ? 'supported' : 'repaired'; job.finishedAt = new Date().toISOString();
          job.delivery = { origin: phase === 'original' ? 'original' : 'repair', versionId: phase === 'original' ? job.originalId : job.repaired!.id,
            answer: phase === 'original' ? job.original.answer : job.repaired!.answer };
          this.save(job); return;
        }
        if (result.assessment.disposition === 'repair' && phase === 'original') { job.phase = 'repair'; job.status = 'queued'; this.save(job); return; }
        this.finish(job, result.assessment.disposition === 'uncertain' ? 'inconclusive' : 'abstained'); return;
      }
      if (receipt.error_code || !receipt.receipt_json) throw new Error('Repair receipt is invalid.');
      const raw = JSON.parse(receipt.receipt_json), answer = answerSchema.parse(raw.output);
      const prompt = revisionPromptIdentity('baseline', false);
      const synthetic = job.mode === 'synthetic';
      if (synthetic ? receipt.executionMode !== 'synthetic' || raw.model !== 'synthetic-fixture' || !answer.answer.startsWith('SYNTHETIC') || receipt.kind !== 'synthetic_automatic_revision'
        : receipt.executionMode === 'synthetic' || !['gpt-luna', 'gpt-5.6-luna'].includes(raw.model) || receipt.kind !== 'answer_revision_v1' || raw.promptVersion !== prompt.promptVersion || raw.systemInstructionsSha256 !== prompt.systemInstructionsSha256) throw new Error('Repair receipt provenance is invalid.');
      if (receipt.model !== raw.model || raw.requestSha256 !== operation.requestSha256 || (answer.status === 'answered' && !answer.citations.length) || answer.citations.some(citation => !job.original.context.sources.some(source => source.id === citation.passageId && source.text.includes(citation.quote)))) throw new Error('Repair cites material outside its frozen sources or has an unbound receipt.');
      job.repaired = { id: `automatic-repair-${job.id}`, answer, model: raw.model, promptVersion: synthetic ? 'synthetic-revision' : prompt.promptVersion,
        answerSha256: sha(answer), sourceContextSha256: job.sourceContextSha256, createdAt: new Date().toISOString() };
      operation.status = 'completed'; job.phase = 'grade_repair'; job.status = 'queued';
      // A repair never becomes deliverable before its independent grading phase.
      this.save(job);
    } catch {
      operation.status = 'invalid'; this.finish(job, 'inconclusive', 'Recorded output failed automatic-check contract or source validation; it will not be retried.');
    }
  }
  private reconcile() {
    const rows = this.db.prepare("SELECT document FROM automatic_support_jobs WHERE status IN ('checking','repairing','rechecking') AND (lease_expires IS NULL OR lease_expires<?)").all(Date.now()) as { document: string }[];
    for (const row of rows) {
      const job = JSON.parse(row.document) as AutomaticSupportJob, receipt = this.provider.receipt(this.runId(job));
      if (receipt) this.consume(job, receipt);
      else this.finish(job, 'reconciliation', 'A started operation has no durable receipt. It will not be retried.');
    }
  }
  tick(): Promise<void> {
    if (this.paused || this.closed) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    const pending = this.runTick().finally(() => { if (this.inFlight === pending) this.inFlight = null; });
    this.inFlight = pending; return pending;
  }
  private async runTick() {
    if (this.busy) return; this.busy = true;
    try {
      this.reconcile();
      if (this.options.canDispatch && !this.options.canDispatch()) return;
      this.db.exec('BEGIN IMMEDIATE');
      let job: AutomaticSupportJob;
      try {
        const row = this.db.prepare("SELECT document FROM automatic_support_jobs WHERE status='queued' ORDER BY rowid LIMIT 1").get() as { document: string } | undefined;
        if (!row) { this.db.exec('COMMIT'); return; }
        job = JSON.parse(row.document) as AutomaticSupportJob;
        if (job.mode !== (this.provider.executionMode ?? 'live')) { this.finish(job, 'inconclusive', 'Saved answer provenance does not match the configured provider.'); this.db.exec('COMMIT'); return; }
        const prior = this.provider.receipt(this.runId(job));
        if (prior) { this.consume(job, prior); this.db.exec('COMMIT'); return; }
        if (job.operations.some(item => item.phase === job.phase)) { this.finish(job, 'reconciliation', 'A started operation cannot be dispatched again.'); this.db.exec('COMMIT'); return; }
        if (job.mode === 'live' && !this.options.liveEnabled) { this.db.exec('COMMIT'); return; }
        const capacity = this.provider.capacity(remainingCalls[job.phase]);
        if (!capacity.ready) { this.finish(job, 'inconclusive', `Automatic check could not reserve its remaining bounded operations: ${capacity.reason}`); this.db.exec('COMMIT'); return; }
        let requestSha256: string;
        try { this.validateSavedContext(job); requestSha256 = this.requestHash(job); }
        catch { this.finish(job, 'inconclusive', 'Saved input exceeds the automatic-check contract or no longer matches its immutable context.'); this.db.exec('COMMIT'); return; }
        job.operations.push({ phase: job.phase, runId: this.runId(job), status: 'started', requestSha256, startedAt: new Date().toISOString() });
        job.status = phaseStatus[job.phase]; this.save(job, Date.now() + 120_000); this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      try {
        if (job.phase === 'repair') await this.provider.reviseAutomatic(this.repairInput(job));
        else await this.provider.gradeClaimSupport(this.gradeInput(job));
      } catch { /* The durable receipt, never the thrown message, decides replay or reconciliation. */ }
      const receipt = this.provider.receipt(this.runId(job));
      if (receipt) this.consume(job, receipt);
      else this.finish(job, 'reconciliation', 'A started operation has no durable receipt. It will not be retried.');
    } finally { this.busy = false; }
  }
  async pauseAndDrain() { this.paused = true; if (this.timer) { clearInterval(this.timer); this.timer = null; } await this.inFlight; }
  close() {
    this.paused = true; if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.busy) throw new Error('Automatic checks: await pauseAndDrain before closing an active worker.');
    if (!this.closed) { this.closed = true; this.db.close(); }
  }
}
