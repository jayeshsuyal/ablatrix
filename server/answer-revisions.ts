import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { originalAnswerVersionId, type PaidAnswerReview } from './paid-answer-review.ts';
import { answerSchema, type SapiomFeedbackProvider } from './feedback-provider.ts';
import { investigateRevision, type InvestigationIssue, type InvestigationTrace } from './revision-investigation.ts';
import { SapiomRevisionSearch } from './revision-search.ts';

const additionalSourceSchema = z.object({ label: z.string().trim().min(2).max(80), text: z.string().trim().min(30).max(2000), reference: z.string().trim().min(1).max(500).optional(), originalQuestion: z.string().trim().min(1).max(500).optional() }).strict();
const requestSchema = z.object({ versionId: z.string().min(1), idempotencyKey: z.string().min(8).max(120), reviewer: z.string().trim().min(2).max(100), feedback: z.string().trim().min(10).max(2000), additionalSources: z.array(additionalSourceSchema).max(3).default([]), clarification: z.string().trim().min(1).max(500).optional(), investigate: z.boolean().default(true), issue: z.enum(['auto','wrong_model','missing_evidence','conflicting_sources','missed_source','answer_quality']).default('auto') }).strict();
const decisionSchema = z.object({ versionId: z.string().min(1), reviewer: z.string().trim().min(2).max(100), decision: z.enum(['accept', 'needs_information']), note: z.string().trim().max(2000), checkedSourceShas: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1) }).strict();
export type RevisionSource = { id: string; label: string; text: string; sha256: string; originalQuestion: string | null; origin: 'pinned' | 'reviewer_added' | 'agent_retrieved'; reference?: string; addedBy?: string; retrievedAt?: string };
export type RevisionContext = { question: string; product: { id: string; title: string }; sources: RevisionSource[]; clarifications: { text: string; reviewer: string }[] };
type Version = { id: string; qid: string; parentId: string | null; jobId: string | null; answer: { answer: string; status: string; citations: { passageId: string; quote: string }[] }; model: string; promptVersion: string; sourceContextSha256: string; createdAt: string; context?: RevisionContext; investigation?: InvestigationTrace };
type Job = { id: string; qid: string; parentId: string; feedback: string; reviewer: string; status: string; createdAt: string; startedAt?: string; finishedAt?: string; attemptId?: string; error?: string; versionId?: string; context?: RevisionContext; promptVersion?: string; additionalSources?: z.infer<typeof additionalSourceSchema>[]; clarification?: string; investigate?: boolean; issue?: InvestigationIssue; investigation?: InvestigationTrace; investigationComplete?: boolean; phase?: 'investigation' | 'generation' };
type RevisionSearch = NonNullable<Parameters<typeof investigateRevision>[1]>;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** A local, single-worker queue. Tables and receipts make a later shared worker possible. */
export class AnswerRevisions {
  private db: DatabaseSync;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private readonly search: RevisionSearch;
  constructor(private readonly reviews: PaidAnswerReview, private readonly provider: SapiomFeedbackProvider, dbPath = '.data/paid-answer-review.sqlite', private readonly automatic = true, private readonly canDispatch: () => boolean = () => true, search?: RevisionSearch) {
    this.search = search ?? new SapiomRevisionSearch(provider);
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
  private pinnedContext(qid: string): RevisionContext {
    const item = this.case(qid);
    return { question: item.question, product: { id: item.asin, title: item.title }, sources: item.sources.map(source => ({ ...source, id: `${qid}:${source.sha256}`, origin: 'pinned' })), clarifications: [] };
  }
  private versions(qid: string): Version[] { return (this.db.prepare('SELECT document FROM answer_versions WHERE qid=? ORDER BY rowid').all(qid) as {document:string}[]).map(r => JSON.parse(r.document)); }
  private jobs(qid: string): Job[] { return (this.db.prepare('SELECT document FROM answer_revision_jobs WHERE qid=? ORDER BY rowid').all(qid) as {document:string}[]).map(r => JSON.parse(r.document)); }
  private latest(qid: string) { return this.versions(qid).at(-1)!; }
  private externalReceipts(job: Job) {
    return ['search:1','read:1','read:2'].map(step => this.provider.receipt(`${job.id}:${step}`)).filter((receipt): receipt is NonNullable<typeof receipt> => receipt !== undefined && receipt !== null);
  }
  private generationAttempts(qid: string) { return this.jobs(qid).filter(job => this.provider.receipt(job.id)).length; }
  overview() {
    const cases = this.reviews.overview().cases.map(item => ({ qid: item.qid, generationAttempts:this.generationAttempts(item.qid), versions: this.versions(item.qid), jobs: this.jobs(item.qid).map(job => { const receipt = this.provider.receipt(job.id); const attempts=this.db.prepare('SELECT * FROM answer_revision_attempts WHERE job_id=? ORDER BY created_at').all(job.id); return { ...job, attempts, externalUsage:this.externalReceipts(job).map(call => ({ id:call.id, kind:call.kind, status:call.status, planningAllowanceUsd:call.allowance_usd })), usage: receipt ? { inputTokens:receipt.input_tokens, outputTokens:receipt.output_tokens, planningAllowanceUsd:receipt.allowance_usd, providerCallStatus:receipt.status } : null, latencyMs: job.finishedAt ? new Date(job.finishedAt).getTime()-new Date(job.createdAt).getTime() : null }; }), events: (this.db.prepare('SELECT document FROM answer_review_events WHERE qid=? ORDER BY rowid').all(item.qid) as {document:string}[]).map(r => JSON.parse(r.document)) }));
    const jobs=cases.flatMap(c=>c.jobs);
    const external = jobs.flatMap(job => job.externalUsage);
    return { cases, ready: cases.filter(c => c.jobs.at(-1)?.status === 'ready').length, pending: cases.filter(c => ['queued','running'].includes(c.jobs.at(-1)?.status ?? '')).length, readiness:this.provider.readiness(), investigationReadiness:this.search.readiness(), summary: { requested:jobs.length, accepted:cases.filter(c=>c.jobs.at(-1)?.status==='accepted').length, unresolved:cases.filter(c=>c.jobs.length && c.jobs.at(-1)?.status!=='accepted').length, providerCalls:jobs.filter(j=>j.usage).length + external.length, answerCalls:jobs.filter(j=>j.usage).length, searchAndReadCalls:external.length, planningAllowanceUsd:jobs.reduce((n,j)=>n+(j.usage?.planningAllowanceUsd ?? 0),0) + external.reduce((n,call)=>n+call.planningAllowanceUsd,0), actualProviderCharges:'unavailable' } };
  }
  hasActive() { return this.busy; }
  getJob(id: string) { const job = this.overview().cases.flatMap(c=>c.jobs).find(j=>j.id===id); if (!job) throw new Error('Revision: job not found.'); return job; }
  request(qid: string, raw: unknown): Job {
    const input = requestSchema.parse(raw); this.case(qid);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const duplicate = this.db.prepare('SELECT document FROM answer_revision_jobs WHERE idempotency_key=?').get(input.idempotencyKey) as {document:string}|undefined;
      if (duplicate) { const job = JSON.parse(duplicate.document) as Job; if (job.qid !== qid || job.parentId !== input.versionId || job.feedback !== input.feedback || job.reviewer !== input.reviewer || JSON.stringify(job.additionalSources ?? []) !== JSON.stringify(input.additionalSources) || job.clarification !== input.clarification || (job.investigate ?? false) !== input.investigate || (job.issue ?? 'auto') !== input.issue) throw new Error('Revision: idempotency key belongs to a different request.'); this.db.exec('COMMIT'); return job; }
      const latest = this.latest(qid);
      if (latest.id !== input.versionId) throw new Error('Revision: stale answer version. Refresh before acting.');
      if (this.db.prepare("SELECT 1 FROM answer_review_events WHERE version_id=? AND kind='accept' LIMIT 1").get(latest.id)) throw new Error('Revision: this answer version has been accepted.');
      if (this.jobs(qid).some(j => ['queued','running','reconciliation'].includes(j.status))) throw new Error('Revision: an active or unresolved job already exists for this case.');
      if (this.generationAttempts(qid) >= 2) throw new Error('Revision: two generation attempts are the per-case limit.');
      const previousJob = this.jobs(qid).at(-1);
      const retryContext = previousJob?.parentId === latest.id && !previousJob.versionId ? previousJob.context : undefined;
      const context: RevisionContext = structuredClone(retryContext ?? latest.context ?? this.pinnedContext(qid));
      for (const source of input.additionalSources) {
        const digest = sha(JSON.stringify([source.label, source.text, source.reference ?? '', source.originalQuestion ?? '']));
        if (!context.sources.some(item => item.sha256 === digest)) context.sources.push({ ...source, originalQuestion: source.originalQuestion ?? null, id: `${qid}:${digest}`, sha256: digest, origin: 'reviewer_added', addedBy: input.reviewer });
      }
      if (input.clarification) context.clarifications.push({ text: input.clarification, reviewer: input.reviewer });
      // Leave room below the provider's 40,000-character input limit for field names.
      if (JSON.stringify(context).length + JSON.stringify(latest.answer.answer).length + JSON.stringify(input.feedback).length > 35_000) throw new Error('Revision: combined source context is too large. Shorten the added excerpts.');
      const id = randomUUID(), now = new Date().toISOString();
      const job: Job = { id, qid, parentId: latest.id, feedback: input.feedback, reviewer: input.reviewer, status: 'queued', createdAt: now, context, promptVersion: 'answer-revision-v2-context', additionalSources: input.additionalSources, clarification: input.clarification, investigate:input.investigate, issue:input.issue };
      this.db.prepare('INSERT INTO answer_review_events(id,qid,version_id,kind,document) VALUES(?,?,?,?,?)').run(randomUUID(),qid,latest.id,'reject',JSON.stringify({ versionId: latest.id, kind:'reject', reviewer:input.reviewer, note:input.feedback, createdAt:now, jobId:id }));
      this.db.prepare('INSERT INTO answer_revision_jobs(id,qid,parent_id,idempotency_key,status,document) VALUES(?,?,?,?,?,?)').run(id,qid,latest.id,input.idempotencyKey,'queued',JSON.stringify(job));
      this.db.exec('COMMIT'); return job;
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  decide(qid: string, raw: unknown) {
    const input = decisionSchema.parse(raw); this.case(qid);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.latest(qid).id !== input.versionId) throw new Error('Revision: stale answer version. Refresh before acting.');
      if (this.jobs(qid).some(j => ['queued','running'].includes(j.status))) throw new Error('Revision: wait for the active revision.');
      const version=this.latest(qid);
      if (input.decision === 'accept' && this.jobs(qid).some(job => job.parentId === version.id)) throw new Error('Revision: this answer was rejected for a newer investigation. Supply the missing information and review the next revision before accepting.');
      const context = version.context ?? this.pinnedContext(qid);
      if (input.checkedSourceShas.some(s => !context.sources.some(source => source.sha256 === s))) throw new Error('Revision: checked source does not belong to this answer version.');
      if (input.decision === 'accept' && version.investigation && !context.sources.some(source => version.investigation!.selectedSourceIds.includes(source.id) && input.checkedSourceShas.includes(source.sha256))) throw new Error('Revision: check a source used by the revised answer before accepting it.');
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
    const context = job.context ?? this.pinnedContext(job.qid);
    const parsed=answerSchema.safeParse(output);
    const eligibleSources = job.investigationComplete && job.investigation ? context.sources.filter(source => job.investigation!.selectedSourceIds.includes(source.id)) : context.sources;
    const valid = parsed.success && !/\bthe supplied evidence\b/i.test(parsed.data.answer) && (parsed.data.status !== 'answered' || parsed.data.citations.length > 0) && parsed.data.citations.every(c => eligibleSources.some(source => source.text.includes(c.quote) && source.id === c.passageId));
    if (!valid) { job.status='needs_information'; job.error='Revision output failed source or quote validation.'; job.finishedAt=new Date().toISOString(); job.attemptId=receipt.id; this.saveJob(job); this.db.prepare('UPDATE answer_revision_attempts SET provider_call_id=?,status=?,finished_at=? WHERE job_id=?').run(receipt.id,'invalid_output',job.finishedAt,job.id); return; }
    const id = `revision-${job.id}`;
    const parent = this.versions(job.qid).find(v => v.id === job.parentId)!;
    const version: Version = { id, qid:job.qid,parentId:parent.id,jobId:job.id,answer:parsed.data!,model,promptVersion:job.promptVersion ?? 'answer-revision-v1',sourceContextSha256:job.context ? sha(JSON.stringify(context)) : parent.sourceContextSha256,createdAt:new Date().toISOString(), ...(job.context ? { context } : {}), ...(job.investigation ? {investigation:job.investigation} : {}) };
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
      else if (this.externalReceipts(job).some(call => call.status !== 'completed')) { job.status='reconciliation'; job.error='A search or read outcome is unverified; allowance remains consumed. Reconcile it before another attempt.'; this.saveJob(job); }
      else { job.status='queued'; this.saveJob(job); }
    }
  }
  async tick() {
    if (this.busy) return; this.busy=true;
    try {
      this.reconcile();
      if (!this.canDispatch()) return;
      this.db.exec('BEGIN IMMEDIATE');
      let job: Job;
      try {
        const row = this.db.prepare("SELECT document FROM answer_revision_jobs WHERE status='queued' ORDER BY rowid LIMIT 1").get() as {document:string}|undefined;
        if (!row) { this.db.exec('COMMIT'); return; }
        job = JSON.parse(row.document) as Job;
        if ((!job.investigate || job.investigationComplete) && !this.provider.readiness().ready) { this.db.exec('COMMIT'); return; }
        job.status='running'; job.startedAt ??= new Date().toISOString();
        job.phase = job.investigate && !job.investigationComplete ? 'investigation' : 'generation';
        this.db.prepare('UPDATE answer_revision_jobs SET status=?,document=?,lease_owner=?,lease_expires=? WHERE id=?').run('running',JSON.stringify(job),String(process.pid),Date.now()+120_000,job.id);
        this.db.exec('COMMIT');
      } catch(error) { this.db.exec('ROLLBACK'); throw error; }
      const parent = this.versions(job.qid).find(v => v.id === job.parentId)!;
      // Queued legacy jobs get a snapshot before dispatch; completed legacy receipts keep their original provenance.
      if (!job.context) { job.context = this.pinnedContext(job.qid); job.promptVersion = 'answer-revision-v2-context'; this.saveJob(job); }
      if (job.investigate && !job.investigationComplete) {
        const boundedSearch: RevisionSearch = {
          readiness: () => { const configured = this.search.readiness(); if (!configured.ready) return configured; return this.provider.capacity(Math.max(1, 4 - this.externalReceipts(job).length)); },
          allowed: url => this.search.allowed(url), search: (query,id) => this.search.search(query,id), read: (url,id) => this.search.read(url,id)
        };
        try {
          const originalCitedSourceIds = parent.answer.citations.map(c => {
            const savedPassage = this.case(job.qid).result!.run.retrieval?.passages.find(p => p.id === c.passageId);
            return job.context!.sources.find(source => source.id === c.passageId || source.sha256 === savedPassage?.sha256)?.id ?? c.passageId;
          });
          const originalSourceIds = (parent.context ?? this.pinnedContext(job.qid)).sources.map(source => source.id);
          const result = await investigateRevision({ context:job.context, critique:job.feedback, issue:job.issue ?? 'auto', runId:job.id, originalCitedSourceIds, originalSourceIds }, boundedSearch, trace => { job.investigation=structuredClone(trace); this.saveJob(job); });
          job.context=result.context; job.investigation=result.investigation; job.investigationComplete=true;
          if (result.investigation.status !== 'ready_to_revise' || !result.investigation.selectedSourceIds.length) { job.status='needs_information'; job.finishedAt=new Date().toISOString(); this.saveJob(job); return; }
          if (JSON.stringify(job.context).length + JSON.stringify(parent.answer.answer).length + JSON.stringify(job.feedback).length > 35_000) { job.status='needs_information'; job.error='Investigation found more source text than the bounded answer context permits. Narrow the excerpts before revising.'; job.finishedAt=new Date().toISOString(); this.saveJob(job); return; }
          job.promptVersion='answer-revision-v3-investigation'; job.phase='generation'; this.saveJob(job);
        } catch (error) {
          const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
          job.status = ['unverified_outcome','reconciliation_required'].includes(String(code)) ? 'reconciliation' : 'needs_information';
          job.error = job.status === 'reconciliation' ? 'A search or read outcome is unverified; its allowance remains consumed. Reconcile before another attempt.' : 'Investigation could not complete. Review the saved trace and provide the missing information.';
          job.finishedAt=new Date().toISOString(); this.saveJob(job); return;
        }
      }
      if (!this.provider.readiness().ready) { job.status='queued'; this.saveJob(job); return; }
      this.db.prepare('INSERT INTO answer_revision_attempts(id,job_id,status,created_at) VALUES(?,?,?,?)').run(randomUUID(),job.id,'dispatching',new Date().toISOString());
      const context = job.context;
      const selected = job.investigationComplete && job.investigation ? context.sources.filter(source => job.investigation!.selectedSourceIds.includes(source.id)) : context.sources;
      const evidence = selected.map(source => ({ id:source.id, source:source.label, text:source.text, originalQuestion:source.originalQuestion ?? undefined, origin:source.origin, reference:source.reference }));
      const investigation = job.investigation ? { issue:job.investigation.issue, query:job.investigation.query, selectedSourceIds:job.investigation.selectedSourceIds, addedSourceIds:job.investigation.addedSourceIds, stopReason:job.investigation.stopReason } : undefined;
      try { await this.provider.revise({ runId:job.id, question:context.question, product:context.product, rejectedAnswer:parent.answer.answer, critique:job.feedback, evidence, clarifications:context.clarifications, investigation }); }
      catch(error) { job.error=error instanceof Error ? error.message : 'Provider result unavailable.'; }
      const receipt=this.provider.receipt(job.id);
      if (receipt?.status === 'completed') this.materialize(job,receipt);
      else { job.status=receipt ? 'reconciliation' : 'queued'; job.attemptId=receipt?.id; job.error=receipt ? 'Provider outcome is uncertain; allowance consumed. Reconcile before redispatch.' : job.error; this.saveJob(job); if(receipt) this.db.prepare('UPDATE answer_revision_attempts SET provider_call_id=?,status=?,finished_at=? WHERE job_id=?').run(receipt.id,'uncertain',new Date().toISOString(),job.id); }
    } finally { this.busy=false; }
  }
  close() { if(this.timer) clearInterval(this.timer); this.db.close(); }
}
