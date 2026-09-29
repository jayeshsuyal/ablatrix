import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { originalAnswerVersionId, type PaidAnswerReview } from './paid-answer-review.ts';
import { answerSchema, type SapiomFeedbackProvider } from './feedback-provider.ts';

const requestSchema = z.object({ versionId: z.string().min(1), idempotencyKey: z.string().min(8).max(120), reviewer: z.string().trim().min(2).max(100), feedback: z.string().trim().min(10).max(2000) }).strict();
const decisionSchema = z.object({ versionId: z.string().min(1), reviewer: z.string().trim().min(2).max(100), decision: z.enum(['accept', 'needs_information']), note: z.string().trim().max(2000), checkedSourceShas: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1) }).strict();
type Version = { id: string; qid: string; parentId: string | null; jobId: string | null; answer: { answer: string; status: string; citations: { passageId: string; quote: string }[] }; model: string; promptVersion: string; sourceContextSha256: string; createdAt: string };
type Job = { id: string; qid: string; parentId: string; feedback: string; reviewer: string; status: string; createdAt: string; startedAt?: string; finishedAt?: string; attemptId?: string; error?: string; versionId?: string };
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** A local, single-worker queue. Tables and receipts make a later shared worker possible. */
export class AnswerRevisions {
  private db: DatabaseSync;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  constructor(private readonly reviews: PaidAnswerReview, private readonly provider: SapiomFeedbackProvider, dbPath = '.data/paid-answer-review.sqlite', private readonly automatic = true, private readonly canDispatch: () => boolean = () => true) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS answer_versions(id TEXT PRIMARY KEY,qid TEXT NOT NULL,parent_id TEXT,job_id TEXT,document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS answer_review_events(id TEXT PRIMARY KEY,qid TEXT NOT NULL,version_id TEXT NOT NULL,kind TEXT NOT NULL,document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS answer_revision_jobs(id TEXT PRIMARY KEY,qid TEXT NOT NULL,parent_id TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,status TEXT NOT NULL,document TEXT NOT NULL,lease_owner TEXT,lease_expires INTEGER);
      CREATE INDEX IF NOT EXISTS answer_revision_qid ON answer_revision_jobs(qid);
      CREATE TABLE IF NOT EXISTS answer_revision_attempts(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,provider_call_id TEXT,status TEXT NOT NULL,created_at TEXT NOT NULL,finished_at TEXT);
    `);
    const columns = new Set((this.db.prepare('PRAGMA table_info(answer_revision_jobs)').all() as {name:string}[]).map(r=>r.name));
    if (!columns.has('lease_owner')) this.db.exec('ALTER TABLE answer_revision_jobs ADD COLUMN lease_owner TEXT');
    if (!columns.has('lease_expires')) this.db.exec('ALTER TABLE answer_revision_jobs ADD COLUMN lease_expires INTEGER');
    for (const item of reviews.overview().cases) {
      const id = originalAnswerVersionId(item.qid,item.result!.run.id);
      const sourceContextSha256 = sha(JSON.stringify(item.sources.map(s => [s.sha256, s.originalQuestion])));
      const version: Version = { id, qid: item.qid, parentId: null, jobId: null, answer: item.result!.run.answer!, model: item.result!.run.model ?? 'unknown', promptVersion: 'paid-batch-original', sourceContextSha256, createdAt: '2026-09-28T00:00:00.000Z' };
      this.db.prepare('INSERT OR IGNORE INTO answer_versions(id,qid,parent_id,job_id,document) VALUES(?,?,?,?,?)').run(id,item.qid,null,null,JSON.stringify(version));
    }
    this.reconcile();
    if (automatic) { this.timer = setInterval(() => { void this.tick(); }, 1500); this.timer.unref(); }
  }
  private case(qid: string) { const item = this.reviews.overview().cases.find(c => c.qid === qid); if (!item) throw new Error('Revision: case not found.'); return item; }
  private versions(qid: string): Version[] { return (this.db.prepare('SELECT document FROM answer_versions WHERE qid=? ORDER BY rowid').all(qid) as {document:string}[]).map(r => JSON.parse(r.document)); }
  private jobs(qid: string): Job[] { return (this.db.prepare('SELECT document FROM answer_revision_jobs WHERE qid=? ORDER BY rowid').all(qid) as {document:string}[]).map(r => JSON.parse(r.document)); }
  private latest(qid: string) { return this.versions(qid).at(-1)!; }
  overview() {
    const cases = this.reviews.overview().cases.map(item => ({ qid: item.qid, versions: this.versions(item.qid), jobs: this.jobs(item.qid).map(job => { const receipt = this.provider.receipt(job.id); const attempts=this.db.prepare('SELECT * FROM answer_revision_attempts WHERE job_id=? ORDER BY created_at').all(job.id); return { ...job, attempts, usage: receipt ? { inputTokens:receipt.input_tokens, outputTokens:receipt.output_tokens, planningAllowanceUsd:receipt.allowance_usd, providerCallStatus:receipt.status } : null, latencyMs: job.finishedAt ? new Date(job.finishedAt).getTime()-new Date(job.createdAt).getTime() : null }; }), events: (this.db.prepare('SELECT document FROM answer_review_events WHERE qid=? ORDER BY rowid').all(item.qid) as {document:string}[]).map(r => JSON.parse(r.document)) }));
    const jobs=cases.flatMap(c=>c.jobs);
    return { cases, ready: cases.filter(c => c.jobs.at(-1)?.status === 'ready').length, pending: cases.filter(c => ['queued','running'].includes(c.jobs.at(-1)?.status ?? '')).length, readiness:this.provider.readiness(), summary: { requested:jobs.length, accepted:cases.filter(c=>c.jobs.at(-1)?.status==='accepted').length, unresolved:cases.filter(c=>c.jobs.length && c.jobs.at(-1)?.status!=='accepted').length, providerCalls:jobs.filter(j=>j.usage).length, planningAllowanceUsd:jobs.reduce((n,j)=>n+(j.usage?.planningAllowanceUsd ?? 0),0), actualProviderCharges:'unavailable' } };
  }
  hasActive() { return this.busy; }
  getJob(id: string) { const job = this.overview().cases.flatMap(c=>c.jobs).find(j=>j.id===id); if (!job) throw new Error('Revision: job not found.'); return job; }
  request(qid: string, raw: unknown): Job {
    const input = requestSchema.parse(raw); this.case(qid);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const duplicate = this.db.prepare('SELECT document FROM answer_revision_jobs WHERE idempotency_key=?').get(input.idempotencyKey) as {document:string}|undefined;
      if (duplicate) { const job = JSON.parse(duplicate.document) as Job; if (job.qid !== qid || job.parentId !== input.versionId || job.feedback !== input.feedback || job.reviewer !== input.reviewer) throw new Error('Revision: idempotency key belongs to a different request.'); this.db.exec('COMMIT'); return job; }
      const latest = this.latest(qid);
      if (latest.id !== input.versionId) throw new Error('Revision: stale answer version. Refresh before acting.');
      if (this.db.prepare("SELECT 1 FROM answer_review_events WHERE version_id=? AND kind='accept' LIMIT 1").get(latest.id)) throw new Error('Revision: this answer version has been accepted.');
      if (this.jobs(qid).some(j => ['queued','running','reconciliation'].includes(j.status))) throw new Error('Revision: an active or unresolved job already exists for this case.');
      if (this.jobs(qid).length >= 2) throw new Error('Revision: two generation attempts are the per-case limit.');
      const id = randomUUID(), now = new Date().toISOString();
      const job: Job = { id, qid, parentId: latest.id, feedback: input.feedback, reviewer: input.reviewer, status: 'queued', createdAt: now };
      this.db.prepare('INSERT INTO answer_review_events(id,qid,version_id,kind,document) VALUES(?,?,?,?,?)').run(randomUUID(),qid,latest.id,'reject',JSON.stringify({ versionId: latest.id, kind:'reject', reviewer:input.reviewer, note:input.feedback, createdAt:now, jobId:id }));
      this.db.prepare('INSERT INTO answer_revision_jobs(id,qid,parent_id,idempotency_key,status,document) VALUES(?,?,?,?,?,?)').run(id,qid,latest.id,input.idempotencyKey,'queued',JSON.stringify(job));
      this.db.exec('COMMIT'); return job;
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  decide(qid: string, raw: unknown) {
    const input = decisionSchema.parse(raw), item = this.case(qid);
    if (input.checkedSourceShas.some(s => !item.sources.some(source => source.sha256 === s))) throw new Error('Revision: checked source does not belong to this product.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.latest(qid).id !== input.versionId) throw new Error('Revision: stale answer version. Refresh before acting.');
      if (this.jobs(qid).some(j => ['queued','running'].includes(j.status))) throw new Error('Revision: wait for the active revision.');
      const version=this.latest(qid);
      if (!version.jobId) throw new Error('Revision: decisions require a revised answer version.');
      const job=this.jobs(qid).find(j=>j.id===version.jobId);
      if (!job || !['ready','needs_information'].includes(job.status)) throw new Error('Revision: this answer version already has a decision or is unavailable.');
      if (this.db.prepare("SELECT 1 FROM answer_review_events WHERE version_id=? AND kind IN ('accept','needs_information') LIMIT 1").get(version.id)) throw new Error('Revision: this answer version already has a decision.');
      const event = { id: randomUUID(), versionId: input.versionId, kind: input.decision, reviewer: input.reviewer, note: input.note, checkedSourceShas: input.checkedSourceShas, createdAt: new Date().toISOString() };
      this.db.prepare('INSERT INTO answer_review_events(id,qid,version_id,kind,document) VALUES(?,?,?,?,?)').run(event.id,qid,input.versionId,event.kind,JSON.stringify(event));
      job.status=input.decision === 'accept' ? 'accepted' : 'needs_information'; this.saveJob(job);
      this.db.exec('COMMIT'); return event;
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private saveJob(job: Job) { this.db.prepare('UPDATE answer_revision_jobs SET status=?,document=? WHERE id=?').run(job.status,JSON.stringify(job),job.id); }
  private materialize(job: Job, receipt: NonNullable<ReturnType<SapiomFeedbackProvider['receipt']>>) {
    if (!receipt.receipt_json) { job.status='reconciliation'; job.error='Completed call has no durable response.'; job.attemptId=receipt.id; this.saveJob(job); return; }
    const { output, model } = JSON.parse(receipt.receipt_json);
    const item = this.case(job.qid);
    const parsed=answerSchema.safeParse(output);
    const valid = parsed.success && !/\bthe supplied evidence\b/i.test(parsed.data.answer) && (parsed.data.status !== 'answered' || parsed.data.citations.length > 0) && parsed.data.citations.every(c => item.sources.some(source => source.text.includes(c.quote) && `${job.qid}:${source.sha256}` === c.passageId));
    if (!valid) { job.status='needs_information'; job.error='Revision output failed source or quote validation.'; job.finishedAt=new Date().toISOString(); job.attemptId=receipt.id; this.saveJob(job); this.db.prepare('UPDATE answer_revision_attempts SET provider_call_id=?,status=?,finished_at=? WHERE job_id=?').run(receipt.id,'invalid_output',job.finishedAt,job.id); return; }
    const id = `revision-${job.id}`;
    const parent = this.versions(job.qid).find(v => v.id === job.parentId)!;
    const version: Version = { id, qid:job.qid,parentId:parent.id,jobId:job.id,answer:parsed.data!,model,promptVersion:'answer-revision-v1',sourceContextSha256:parent.sourceContextSha256,createdAt:new Date().toISOString() };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT OR IGNORE INTO answer_versions(id,qid,parent_id,job_id,document) VALUES(?,?,?,?,?)').run(id,job.qid,parent.id,job.id,JSON.stringify(version));
      job.versionId=id; job.status=parsed.data!.status === 'answered' ? 'ready' : 'needs_information'; job.finishedAt=new Date().toISOString(); job.attemptId=receipt.id; this.saveJob(job);
      this.db.prepare('UPDATE answer_revision_attempts SET provider_call_id=?,status=?,finished_at=? WHERE job_id=?').run(receipt.id,'completed',job.finishedAt,job.id);
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  reconcile() {
    for (const row of this.db.prepare("SELECT document FROM answer_revision_jobs WHERE status='running' AND (lease_expires IS NULL OR lease_expires<?)").all(Date.now()) as {document:string}[]) {
      const job = JSON.parse(row.document) as Job, receipt = this.provider.receipt(job.id);
      if (receipt?.status === 'completed') this.materialize(job,receipt);
      else if (receipt) { job.status='reconciliation'; job.attemptId=receipt.id; job.error=`Provider outcome ${receipt.status}; allowance remains consumed. Check provider records before another attempt.`; this.saveJob(job); }
      else { job.status='queued'; this.saveJob(job); }
    }
  }
  async tick() {
    if (this.busy) return; this.busy=true;
    try {
      this.reconcile();
      if (!this.canDispatch() || !this.provider.readiness().ready) return;
      this.db.exec('BEGIN IMMEDIATE');
      let job: Job;
      try {
        const row = this.db.prepare("SELECT document FROM answer_revision_jobs WHERE status='queued' ORDER BY rowid LIMIT 1").get() as {document:string}|undefined;
        if (!row) { this.db.exec('COMMIT'); return; }
        job = JSON.parse(row.document) as Job;
        job.status='running'; job.startedAt=new Date().toISOString();
        this.db.prepare('UPDATE answer_revision_jobs SET status=?,document=?,lease_owner=?,lease_expires=? WHERE id=?').run('running',JSON.stringify(job),String(process.pid),Date.now()+120_000,job.id);
        this.db.exec('COMMIT');
      } catch(error) { this.db.exec('ROLLBACK'); throw error; }
      this.db.prepare('INSERT INTO answer_revision_attempts(id,job_id,status,created_at) VALUES(?,?,?,?)').run(randomUUID(),job.id,'dispatching',job.startedAt);
      const item = this.case(job.qid), parent = this.versions(job.qid).find(v => v.id === job.parentId)!;
      const evidence = item.sources.map(source => ({ id:`${job.qid}:${source.sha256}`, source:source.label, text:source.originalQuestion ? `Original customer question: ${source.originalQuestion}\n${source.text}` : source.text }));
      try { await this.provider.revise({ runId:job.id, question:item.question, product:{id:item.asin,title:item.title}, rejectedAnswer:parent.answer.answer, critique:job.feedback, evidence }); }
      catch(error) { job.error=error instanceof Error ? error.message : 'Provider result unavailable.'; }
      const receipt=this.provider.receipt(job.id);
      if (receipt?.status === 'completed') this.materialize(job,receipt);
      else { job.status=receipt ? 'reconciliation' : 'queued'; job.attemptId=receipt?.id; job.error=receipt ? 'Provider outcome is uncertain; allowance consumed. Reconcile before redispatch.' : job.error; this.saveJob(job); if(receipt) this.db.prepare('UPDATE answer_revision_attempts SET provider_call_id=?,status=?,finished_at=? WHERE job_id=?').run(receipt.id,'uncertain',new Date().toISOString(),job.id); }
    } finally { this.busy=false; }
  }
  close() { if(this.timer) clearInterval(this.timer); this.db.close(); }
}
