import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { LoopAnswer, LoopBatch, LoopEvent, LoopFeedback, LoopFinal, LoopFinalResult, LoopMode, LoopOverview, LoopPolicy, LoopProvider, LoopRetriever, LoopRun, LoopValidation, Passage, ProductCase, ProductCorpus, RetrievalResult } from './loop-types.ts';
import { ensureValidationLedger, externalValidationProducts, externalValidationReservations, externalValidationRounds, importKnownValidationPacket } from './validation-ledger.ts';
import { loadExternalComparison } from './external-comparison.ts';

const modes = z.enum(['fixture', 'live']);
const idSchema = z.string().trim().min(1).max(200);
const runSchema = z.object({ mode: modes, productId: idSchema, question: z.string().trim().min(2).max(2000), caseId: idSchema.optional() }).strict();
const detailReviewSchema = z.object({ detail: z.string().trim().min(2).max(140), evidence: z.enum(['listing', 'customer_report', 'conflicting', 'missing']), response: z.enum(['addressed', 'qualified', 'missed', 'overstated']) }).strict();
const reviewSchema = z.object({ correct: z.boolean(), supported: z.boolean(), referenceChecked: z.literal(true), category: z.enum(['none', 'unsupported_claim', 'incomplete_answer', 'missed_evidence', 'source_conflict', 'unnecessary_abstention']), correction: z.string().trim().max(4000), sourceIds: z.array(idSchema).min(1).max(20), reviewer: z.string().trim().min(2).max(100), kind: z.literal('human').optional(), draftId: idSchema.optional(), details: z.array(detailReviewSchema).max(6).optional() }).strict();
const draftSchema = reviewSchema.omit({ referenceChecked: true, kind: true, draftId: true, details: true }).extend({ kind: z.literal('ai_assisted'), sourceIds: z.array(idSchema).min(1).max(20), rationale: z.string().trim().min(10).max(4000), confidence: z.enum(['high', 'medium', 'low']) }).strict();
const proposalSchema = z.object({ mode: modes, runIds: z.array(idSchema).min(1).max(10) }).strict();
const policySchema = z.object({ instructions: z.string().trim().min(40).max(2500), rationale: z.string().trim().min(10).max(1500) }).strict();
const answerSchema = z.object({ answer: z.string().trim().min(1).max(10000), status: z.enum(['answered', 'insufficient_evidence']), citations: z.array(z.object({ passageId: z.string().trim().min(1).max(160), quote: z.string().min(1).max(3000) }).strict()).max(5) }).strict();
const rollbackSchema = z.object({ mode: modes, policyId: idSchema }).strict();
const batchSchema = z.object({ mode: modes }).strict();
const baseline = 'Answer the selected product question using only the supplied evidence. Cite exact supporting quotes and passage IDs. Distinguish manufacturer specifications from customer reports. If the evidence is insufficient or conflicting, explain the limitation and abstain. Never invent a specification or transfer evidence between products.';
const fixturePolicy = 'Synthetic workflow demonstration: return an explicitly labeled extract from the supplied product evidence with an exact citation. This deterministic fixture is not a model answer or evidence of learning. If no passage is supplied, report insufficient evidence.';
const now = () => new Date().toISOString();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (message: string): never => { throw new Error(`Feedback: ${message}`); };
function parse<T>(schema: z.ZodType<T>, input: unknown): T { const result = schema.safeParse(input); if (!result.success) return fail(result.error.issues.map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ')); return result.data; }
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Unexpected workflow error';

/** Deterministic independent draws for the exploratory paired bootstrap. */
export function pairedBootstrapInterval(differences: number[], seed: string): [number, number] {
  if (!differences.length) fail('paired bootstrap requires at least one case');
  const n = differences.length;
  const range = 0x100000000;
  const limit = range - range % n;
  let block = Buffer.alloc(0), offset = 0, blockNumber = 0;
  const nextIndex = () => {
    for (;;) {
      if (offset >= block.length) { block = createHash('sha256').update(`${seed}:${blockNumber++}`).digest(); offset = 0; }
      const value = block.readUInt32BE(offset); offset += 4;
      if (value < limit) return value % n;
    }
  };
  const estimates: number[] = [];
  for (let trial = 0; trial < 4096; trial++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += differences[nextIndex()];
    estimates.push(100 * sum / n);
  }
  estimates.sort((a, b) => a - b);
  return [estimates[Math.floor(estimates.length * 0.025)], estimates[Math.floor(estimates.length * 0.975)]];
}

/** One durable, bounded improvement loop. Fixture and live records never share an active policy. */
export class FeedbackLoop {
  private db: DatabaseSync;
  private busy = false;
  private closed = false;
  private path: string;
  private lockPath: string | null = null;
  private static owners = new Set<string>();
  constructor(private corpus: ProductCorpus, private retriever: LoopRetriever, private provider: LoopProvider, dbPath = '.data/feedback-loop.sqlite', private finalCorpus?: ProductCorpus, private finalRetriever?: LoopRetriever) {
    this.path = dbPath === ':memory:' ? `:memory:${randomUUID()}` : resolve(dbPath);
    if (FeedbackLoop.owners.has(this.path)) fail('this database already has an active workflow owner');
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    if (dbPath !== ':memory:') {
      this.lockPath = `${this.path}.lock`;
      try { writeFileSync(this.lockPath, String(process.pid), { flag: 'wx', mode: 0o600 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const pid = Number(readFileSync(this.lockPath, 'utf8'));
        let alive = true;
        if (Number.isSafeInteger(pid) && pid > 0) { try { process.kill(pid, 0); } catch (check) { alive = (check as NodeJS.ErrnoException).code !== 'ESRCH'; } }
        if (alive) fail('database is owned by another process; stop it before opening the workflow');
        unlinkSync(this.lockPath);
        writeFileSync(this.lockPath, String(process.pid), { flag: 'wx', mode: 0o600 });
      }
    }
    try { this.db = new DatabaseSync(dbPath); } catch (error) { if (this.lockPath) unlinkSync(this.lockPath); throw error; }
    this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS loop_documents (kind TEXT NOT NULL, id TEXT NOT NULL, document TEXT NOT NULL, PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS loop_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    ensureValidationLedger(this.db);
    FeedbackLoop.owners.add(this.path);
    const savedVersion = this.meta<string>('corpusVersion');
    if (savedVersion && savedVersion !== corpus.version) { this.close(); fail('corpus version differs from saved experiment; use a fresh database'); }
    this.setMeta('corpusVersion', corpus.version);
    try { importKnownValidationPacket(this.db, corpus); }
    catch (error) { this.close(); throw error; }
    if (finalCorpus) {
      const savedFinal = this.meta<string>('finalCorpusVersion');
      if (!finalRetriever || (savedFinal && savedFinal !== finalCorpus.version) || finalCorpus.products.some(item => item.split !== 'holdout' || corpus.products.some(product => product.id === item.id))) { this.close(); fail('final corpus/retriever mismatch or product overlap'); }
      this.setMeta('finalCorpusVersion', finalCorpus.version);
    }
    for (const product of corpus.products) if (corpus.cases.some(item => item.productId === product.id && item.split !== product.split)) { this.close(); fail('product appears across dataset splits'); }
    for (const mode of ['fixture', 'live'] as const) {
      if (!this.meta<string>(`active:${mode}`)) {
        const policy: LoopPolicy = { id: `${mode}-baseline`, parentId: null, instructions: baseline, rationale: mode === 'fixture' ? 'Synthetic deterministic baseline; no model call.' : 'Frozen initial answer policy.', feedbackRunIds: [], status: 'baseline', mode, createdAt: now() };
        this.save('policy', policy); this.setMeta(`active:${mode}`, policy.id);
      }
    }
    let recovered = false;
    for (const run of this.list<LoopRun>('run')) if (run.status === 'running') { run.status = 'interrupted'; run.error = 'Process interrupted; this call is not automatically retried.'; this.save('run', run); recovered = true; }
    for (const validation of this.list<LoopValidation>('validation')) if (validation.status === 'running') { validation.status = 'interrupted'; validation.reason = 'Process interrupted. Reserved validation cases remain consumed; no automatic retries.'; this.save('validation', validation); const candidate = this.get<LoopPolicy>('policy', validation.candidateId); if (candidate) { candidate.status = 'rejected'; this.save('policy', candidate); } recovered = true; }
    for (const batch of this.list<LoopBatch>('batch')) if (batch.status === 'running') { batch.status = 'interrupted'; batch.reason = 'Process interrupted. Completed and attempted answers remain saved; no automatic retry.'; this.save('batch', batch); recovered = true; }
    for (const final of this.list<LoopFinal>('final')) if (final.status === 'running') { final.status = 'interrupted'; final.reason = 'Process interrupted. Attempted holdout calls remain saved; no automatic retry or quality claim.'; this.save('final', final); recovered = true; }
    if (this.meta('job')) recovered = true;
    this.setMeta('job', null);
    if (recovered) this.event('recovery', 'Interrupted operations recovered without retrying external calls.');
  }
  private save(kind: string, item: { id: string }): void { this.db.prepare('INSERT INTO loop_documents(kind,id,document) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET document=excluded.document').run(kind, item.id, JSON.stringify(item)); }
  private get<T>(kind: string, id: string): T | undefined { const row = this.db.prepare('SELECT document FROM loop_documents WHERE kind=? AND id=?').get(kind, id) as { document: string } | undefined; return row ? JSON.parse(row.document) as T : undefined; }
  private list<T>(kind: string): T[] { return (this.db.prepare('SELECT document FROM loop_documents WHERE kind=? ORDER BY rowid').all(kind) as { document: string }[]).map(row => JSON.parse(row.document) as T); }
  private meta<T>(key: string): T | undefined { const row = this.db.prepare('SELECT value FROM loop_meta WHERE key=?').get(key) as { value: string } | undefined; return row ? JSON.parse(row.value) as T : undefined; }
  private setMeta(key: string, value: unknown): void { this.db.prepare('INSERT INTO loop_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  private event(kind: string, message: string, policyId: string | null = null): void { this.save('event', { id: randomUUID(), at: now(), kind, message, policyId } as LoopEvent); }
  private active(mode: LoopMode): LoopPolicy { return this.get<LoopPolicy>('policy', this.meta<string>(`active:${mode}`)!)!; }
  private idle(): void { if (this.closed) fail('workflow is closed'); if (this.busy) fail('another operation is in progress'); }
  private async job<T>(kind: string, mode: LoopMode, work: () => Promise<T>): Promise<T> {
    this.idle();
    if (mode === 'live' && !this.provider.readiness().ready) fail(this.provider.readiness().reason);
    this.busy = true; this.setMeta('job', { id: randomUUID(), kind, mode, startedAt: now() });
    try { return await work(); } finally { this.setMeta('job', null); this.busy = false; }
  }
  overview(): LoopOverview {
    return { products: this.corpus.products.filter(product => product.split !== 'holdout'), cases: this.corpus.cases.filter(item => item.split !== 'holdout'), corpus: { version: this.corpus.version, source: this.corpus.source, license: this.corpus.license, passageCount: this.corpus.passages.length }, policies: this.list<LoopPolicy>('policy'), activePolicyIds: { fixture: this.active('fixture').id, live: this.active('live').id }, runs: this.list<LoopRun>('run').reverse(), batches: this.list<LoopBatch>('batch').reverse(), validations: this.list<LoopValidation>('validation').reverse(), externalValidationCases: externalValidationReservations(this.db, this.corpus.version), externalComparisons: loadExternalComparison(this.corpus), finals: this.list<LoopFinal>('final').reverse(), reviewCards: {}, events: this.list<LoopEvent>('event').reverse(), readiness: this.provider.readiness(), busy: this.busy };
  }
  /** HTTP projection conceals arm identity until every paired review is locked. */
  publicOverview(): LoopOverview {
    const value = this.overview();
    const pending = [...value.validations.filter(item => item.status === 'running' || item.status === 'awaiting_review'), ...value.finals.filter(item => item.status === 'running' || item.status === 'awaiting_review')];
    const hiddenIds = new Set(pending.flatMap(item => item.runIds));
    const byId = new Map(value.runs.map(run => [run.id, run]));
    for (const comparison of pending) {
      if (comparison.status === 'running') { comparison.runIds = []; continue; }
      const cards = comparison.runIds.map(id => byId.get(id)).filter((run): run is LoopRun => !!run)
        .sort((a, b) => digest(`${comparison.id}:${a.id}`).localeCompare(digest(`${comparison.id}:${b.id}`)));
      value.reviewCards[comparison.id] = cards.map(run => {
        const pair = cards.filter(item => item.caseId === run.caseId);
        const { timings: _timings, ...blindRun } = run;
        return { ...blindRun, policyId: '', blindLabel: `Answer ${pair.findIndex(item => item.id === run.id) === 0 ? 'A' : 'B'}`, model: null, usage: null, durationMs: null, createdAt: comparison.createdAt };
      });
      comparison.runIds = cards.map(card => card.id);
    }
    value.runs = value.runs.filter(run => !hiddenIds.has(run.id));
    return value;
  }
  publicRun(runId: string): LoopRun {
    const value = this.publicOverview();
    return value.runs.find(run => run.id === runId) ?? Object.values(value.reviewCards).flat().find(run => run.id === runId) ?? fail('unknown run');
  }
  productEvidence(productId: string): Passage[] {
    parse(idSchema, productId);
    const product = this.corpus.products.find(item => item.id === productId) ?? fail('unknown product');
    if (product.split === 'holdout') fail('holdout evidence is sealed');
    return structuredClone(this.corpus.passages.filter(item => item.productId === product.id));
  }
  finalEvidence(productId: string): Passage[] {
    parse(idSchema, productId);
    const corpus = this.finalCorpus;
    if (!this.list<LoopFinal>('final').length || !corpus?.products.some(item => item.id === productId)) throw new Error('Feedback: final evidence is sealed until final evaluation starts');
    return structuredClone(corpus.passages.filter(item => item.productId === productId));
  }
  async run(raw: unknown): Promise<LoopRun> {
    const input = parse(runSchema, raw);
    const product = this.corpus.products.find(item => item.id === input.productId) ?? fail('unknown product');
    if (product.split !== 'development') fail('interactive runs use development products only');
    const item = input.caseId ? this.corpus.cases.find(item => item.id === input.caseId) ?? fail('unknown case') : null;
    if (item && (item.productId !== product.id || item.question !== input.question || item.split !== 'development')) fail('case, product, question and development split must match');
    return this.job('answer', input.mode, () => this.execute(input.mode, product.id, input.question, item, this.active(input.mode), null));
  }
  async batch(raw: unknown): Promise<LoopBatch> {
    const input = parse(batchSchema, raw);
    const policy = this.active(input.mode);
    const cases = this.corpus.cases.filter(item => item.split === 'development');
    if (!cases.length || cases.length > 10 || new Set(cases.map(item => item.productId)).size !== cases.length) fail('batch requires 1–10 product-disjoint development cases');
    if (this.list<LoopBatch>('batch').some(item => item.mode === input.mode && item.policyId === policy.id)) fail('one frozen batch per policy version is allowed');
    return this.job('development_batch', input.mode, async () => {
      const batch: LoopBatch = { id: randomUUID(), mode: input.mode, policyId: policy.id, caseIds: cases.map(item => item.id), runIds: [], manifestSha256: digest(JSON.stringify({ corpus: this.corpus.version, policy: policy.id, cases: cases.map(item => [item.id, item.productId, item.question]) })), status: 'running', reason: 'Development cases frozen before execution. Human review is still required in live mode.', createdAt: now() };
      this.save('batch', batch); this.event('batch_started', `Frozen ${cases.length}-case ${input.mode} development batch started.`, policy.id);
      for (const item of cases) {
        const run = await this.execute(input.mode, item.productId, item.question, item, policy, null, undefined, batch.id);
        batch.runIds.push(run.id); this.save('batch', batch);
        if (input.mode === 'live' && run.status !== 'completed') { batch.status = 'interrupted'; batch.reason = 'A live answer failed. Remaining development calls were not dispatched.'; break; }
        if (input.mode === 'live' && !this.provider.readiness().ready && batch.runIds.length < cases.length) { batch.status = 'interrupted'; batch.reason = 'Local call allowance reached. Remaining cases were not run; completed attempts remain saved.'; break; }
      }
      if (batch.status === 'running') { batch.status = 'completed'; batch.reason = `${batch.runIds.length} attempted answers saved. Review each answer against product evidence.`; }
      this.save('batch', batch); this.event('batch_finished', batch.reason, policy.id);
      return batch;
    });
  }
  private checkRetrieval(retrieval: RetrievalResult, productId: string, corpus = this.corpus): void {
    if (retrieval.corpusVersion !== corpus.version) fail('retrieval corpus version mismatch');
    const seen = new Set<string>();
    for (const passage of retrieval.passages) {
      const original = corpus.passages.find(item => item.id === passage.id);
      if (!original || original.productId !== productId || passage.productId !== productId || original.text !== passage.text || original.sha256 !== passage.sha256 || original.reference !== passage.reference || original.source !== passage.source || seen.has(passage.id)) fail('retrieval passage provenance mismatch');
      seen.add(passage.id);
    }
  }
  private checkAnswer(raw: unknown, retrieval: RetrievalResult): LoopAnswer {
    const answer = parse(answerSchema, raw);
    if (answer.status === 'answered' && !answer.citations.length) fail('answered output requires a citation');
    for (const citation of answer.citations) { const passage = retrieval.passages.find(item => item.id === citation.passageId); if (!citation.quote.trim() || !passage || !passage.text.includes(citation.quote)) fail('citation must quote an exact supplied passage'); }
    return answer;
  }
  private fixtureAnswer(policy: LoopPolicy, retrieval: RetrievalResult): LoopAnswer {
    const passage = retrieval.passages[0];
    if (policy.parentId === null || !passage) return { status: 'insufficient_evidence', answer: 'SYNTHETIC FIXTURE: conservative baseline abstention. This deterministic output is not a model answer.', citations: [] };
    const quote = passage.text.slice(0, 1500);
    return { status: 'answered', answer: `SYNTHETIC FIXTURE: evidence extract for a workflow demonstration: ${quote}`, citations: [{ passageId: passage.id, quote }] };
  }
  private async execute(mode: LoopMode, productId: string, question: string, item: ProductCase | null, policy: LoopPolicy, validation: LoopValidation | null, supplied?: RetrievalResult, batchId: string | null = null, final: LoopFinal | null = null): Promise<LoopRun> {
    const started = Date.now();
    const run: LoopRun = { id: randomUUID(), mode, productId, caseId: item?.id ?? null, split: item?.split ?? 'development', question, policyId: policy.id, status: 'running', answer: null, retrieval: null, model: null, usage: null, durationMs: null, error: null, feedback: null, createdAt: now(), validationId: validation?.id ?? null, batchId, finalId: final?.id ?? null };
    run.timings = { retrievalReused: !!supplied };
    this.save('run', run);
    if (validation) { validation.runIds.push(run.id); this.save('validation', validation); }
    if (final) { final.runIds.push(run.id); this.save('final', final); }
    try {
      const source = final ? this.finalCorpus! : this.corpus;
      if (supplied) run.retrieval = structuredClone(supplied);
      else {
        run.timings.retrievalStartedAt = now();
        try { run.retrieval = await (final ? this.finalRetriever! : this.retriever).retrieve(productId, question); }
        finally { run.timings.retrievalEndedAt = now(); }
      }
      this.checkRetrieval(run.retrieval, productId, source); this.save('run', run);
      if (mode === 'fixture') { run.answer = this.checkAnswer(this.fixtureAnswer(policy, run.retrieval), run.retrieval); run.model = 'synthetic-fixture/no-model'; }
      else {
        run.timings.generationStartedAt = now();
        const answer = this.provider.answerWithSnippetIds?.bind(this.provider) ?? this.provider.answer.bind(this.provider);
        const result = await answer({ question, product: source.products.find(item => item.id === productId)!, policy: structuredClone(policy), passages: structuredClone(run.retrieval.passages), runId: run.id }).finally(() => { run.timings!.generationEndedAt = now(); });
        if (!result.model?.trim()) fail('provider returned no model identity');
        run.model = result.model; run.usage = result.usage;
        run.answer = this.checkAnswer(result.answer, run.retrieval);
      }
      run.status = 'completed';
      if ((validation || final) && mode === 'fixture') run.feedback = { correct: run.answer.status === 'answered', supported: true, referenceChecked: true, category: run.answer.status === 'answered' ? 'none' : 'unnecessary_abstention', correction: run.answer.status === 'answered' ? '' : 'Synthetic exercise expects a cited extract.', sourceIds: run.retrieval.passages.map(passage => passage.id), reviewer: 'deterministic fixture (not human evaluation)', kind: 'synthetic', createdAt: now() };
    } catch (error) { run.status = 'failed'; run.error = errorText(error); }
    run.durationMs = Date.now() - started; this.save('run', run); return run;
  }
  saveReviewDraft(runId: string, raw: unknown): LoopRun {
    this.idle(); parse(idSchema, runId);
    const input = parse(draftSchema, raw);
    const run = this.get<LoopRun>('run', runId) ?? fail('unknown run');
    if (run.mode !== 'live' || run.split !== 'development' || run.validationId || run.finalId || run.status !== 'completed' || !run.answer) fail('AI drafts are limited to completed live development answers');
    if (run.feedback) fail('a reviewed answer cannot receive a new AI draft');
    const failure = !input.correct || !input.supported;
    if (failure && (!input.correction || input.category === 'none')) fail('a failure draft requires a correction and failure category');
    if (!failure && input.category !== 'none') fail('a correct supported draft uses category none');
    if (new Set(input.sourceIds).size !== input.sourceIds.length || input.sourceIds.some(id => !this.corpus.passages.some(passage => passage.id === id && passage.productId === run.productId))) fail('draft sources must belong to this product');
    run.reviewDraft = { ...input, id: randomUUID(), createdAt: now() };
    this.save('run', run);
    this.event('review_draft', `AI review draft saved for ${run.id}; human judgment is pending.`, run.policyId);
    return run;
  }
  review(runId: string, raw: unknown): LoopRun {
    this.idle(); parse(idSchema, runId);
    const input = parse(reviewSchema, raw);
    const run = this.get<LoopRun>('run', runId) ?? fail('unknown run');
    if (run.status !== 'completed') fail('only completed answers can be reviewed');
    if (run.validationId) { const validation = this.get<LoopValidation>('validation', run.validationId)!; if (validation.status !== 'awaiting_review') fail('validation reviews are frozen after a decision'); }
    if (run.finalId) { const final = this.get<LoopFinal>('final', run.finalId)!; if (final.status !== 'awaiting_review') fail('final reviews are frozen after reporting'); }
    if (this.list<LoopPolicy>('policy').some(policy => policy.feedbackRunIds.includes(run.id))) fail('feedback used by a proposal is frozen');
    if (input.draftId && input.draftId !== run.reviewDraft?.id) fail('review draft changed or does not belong to this answer');
    const failure = !input.correct || !input.supported;
    if (failure && (!input.correction || !input.sourceIds.length || input.category === 'none')) fail('a failure requires correction, supporting source IDs and a failure category');
    if (!failure && input.category !== 'none') fail('a correct supported answer uses category none');
    const source = run.finalId ? this.finalCorpus! : this.corpus;
    if (new Set(input.sourceIds).size !== input.sourceIds.length || input.sourceIds.some(id => !source.passages.some(passage => passage.id === id && passage.productId === run.productId))) fail('review sources must belong to this product');
    run.feedback = { ...input, ...(run.reviewDraft ? { draftId: run.reviewDraft.id } : {}), kind: run.mode === 'fixture' ? 'synthetic' : 'human', createdAt: now() }; this.save('run', run);
    this.event('review', run.validationId || run.finalId ? 'Blind comparison card reviewed.' : `${run.mode === 'fixture' ? 'Synthetic-answer' : 'Human'} review saved for ${run.id}.`, run.validationId || run.finalId ? null : run.policyId);
    return run;
  }
  async propose(raw: unknown): Promise<LoopPolicy> {
    const input = parse(proposalSchema, raw);
    if (new Set(input.runIds).size !== input.runIds.length) fail('duplicate feedback run IDs');
    const parent = this.active(input.mode);
    const examples = input.runIds.map(id => {
      const run = this.get<LoopRun>('run', id) ?? fail('unknown feedback run');
      if (run.mode !== input.mode || run.policyId !== parent.id || run.split !== 'development' || run.validationId || run.status !== 'completed' || !run.answer || !run.feedback || !run.feedback.referenceChecked || run.feedback.kind !== (input.mode === 'fixture' ? 'synthetic' : 'human')) fail('proposals require human-reviewed current-version development runs in the same mode');
      return { question: run.question, answer: run.answer!, feedback: run.feedback!, evidence: this.corpus.passages.filter(passage => passage.productId === run.productId && (run.feedback!.sourceIds.includes(passage.id) || run.retrieval?.passages.some(item => item.id === passage.id))) };
    });
    if (!examples.some(item => !item.feedback.correct || !item.feedback.supported)) fail('select at least one reviewed failure');
    if (this.list<LoopPolicy>('policy').some(item => item.mode === input.mode && item.parentId === parent.id && item.status === 'candidate')) fail('decide the existing candidate before proposing another');
    if ((this.meta<number>(`rounds:${input.mode}`) ?? 0) >= 3) fail('three proposal rounds consumed; export results and start a new experiment');
    return this.job('proposal', input.mode, async () => {
      this.setMeta(`rounds:${input.mode}`, (this.meta<number>(`rounds:${input.mode}`) ?? 0) + 1);
      this.event('proposal_started', `${input.mode} proposal attempt reserved; failures are not automatically retried.`, parent.id);
      try {
        const proposed = parse(policySchema, input.mode === 'fixture' ? { instructions: fixturePolicy, rationale: 'Synthetic mechanism exercise: replace deterministic abstention with a cited extract; no learning claim.' } : await this.provider.propose({ policy: structuredClone(parent), examples: structuredClone(examples) }));
        const lower = proposed.instructions.toLowerCase();
        const developmentProducts = new Set(this.corpus.products.filter(item => item.split === 'development').map(item => item.id));
        const facts = [...this.corpus.cases.filter(item => item.split === 'development').flatMap(item => [item.question, item.referenceAnswer]), ...this.corpus.passages.filter(item => developmentProducts.has(item.productId)).map(item => item.text)].filter(item => item.length >= 18);
        const mentionsProduct = [...developmentProducts].some(id => new RegExp(`(^|[^a-z0-9])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(proposed.instructions));
        if (/https?:\/\//i.test(proposed.instructions) || mentionsProduct || facts.some(item => lower.includes(item.toLowerCase()))) fail('candidate instructions contain case-specific facts or source URLs');
        const policy: LoopPolicy = { id: randomUUID(), parentId: parent.id, mode: input.mode, ...proposed, feedbackRunIds: input.runIds, status: 'candidate', createdAt: now() };
        this.save('policy', policy); this.event('proposal', `${input.mode === 'fixture' ? 'SYNTHETIC ' : ''}candidate saved; active policy unchanged.`, policy.id); return policy;
      } catch (error) { this.event('proposal_failed', 'Proposal attempt failed; the bounded attempt remains consumed.', parent.id); throw new Error(`Feedback: ${errorText(error)}`); }
    });
  }
  async validate(policyId: string, raw: unknown = {}): Promise<LoopValidation> {
    parse(idSchema, policyId);
    const selection = parse(z.object({ regressionCaseIds: z.array(idSchema).max(2).optional() }).strict(), raw);
    const candidate = this.get<LoopPolicy>('policy', policyId) ?? fail('unknown candidate');
    if (candidate.status !== 'candidate' || !candidate.parentId) fail('only candidates can be validated');
    const parent = this.get<LoopPolicy>('policy', candidate.parentId!)!;
    if (parent.mode !== candidate.mode || this.active(candidate.mode).id !== parent.id) fail('candidate parent is no longer active');
    const previous = this.list<LoopValidation>('validation');
    if (previous.some(item => item.candidateId === candidate.id)) fail('a candidate gets one validation attempt');
    if (previous.filter(item => item.mode === candidate.mode).length + (candidate.mode === 'live' ? externalValidationRounds(this.db, this.corpus.version) : 0) >= 3) fail('three validation rounds consumed');
    const consumedProducts = new Set(previous.filter(item => item.mode === candidate.mode).flatMap(item => item.caseIds.map(id => this.corpus.cases.find(item => item.id === id)).filter(item => item?.split === 'validation').map(item => item!.productId)));
    if (candidate.mode === 'live') for (const productId of externalValidationProducts(this.db, this.corpus.version)) consumedProducts.add(productId);
    const fresh: ProductCase[] = [];
    for (const item of this.corpus.cases) if (item.split === 'validation' && !consumedProducts.has(item.productId) && !fresh.some(selected => selected.productId === item.productId)) { fresh.push(item); if (fresh.length === 2) break; }
    if (fresh.length < 2) fail('two fresh product-disjoint validation cases are required');
    const reviewedControls = this.list<LoopRun>('run').filter(run => run.mode === candidate.mode && run.policyId === parent.id && run.split === 'development' && !run.validationId && run.feedback?.kind === (candidate.mode === 'fixture' ? 'synthetic' : 'human') && run.feedback.correct && run.feedback.supported && run.caseId);
    if (selection.regressionCaseIds && new Set(selection.regressionCaseIds).size !== selection.regressionCaseIds.length) fail('duplicate regression case IDs');
    if (selection.regressionCaseIds?.some(id => !reviewedControls.some(run => run.caseId === id))) fail('regression controls must be reviewed correct development cases from the parent policy');
    const controlIds = selection.regressionCaseIds ?? [...new Set(reviewedControls.map(run => run.caseId!))].slice(0, 2);
    const regression = controlIds.map(id => this.corpus.cases.find(item => item.id === id)!);
    const cases = [...fresh, ...regression];
    return this.job('validation', candidate.mode, async () => {
      if (candidate.mode === 'live' && this.provider.capacity) {
        const capacity = this.provider.capacity(cases.length * 2);
        if (!capacity.ready) fail(capacity.reason);
      }
      const validation: LoopValidation = { id: randomUUID(), candidateId: candidate.id, parentId: parent.id, mode: candidate.mode, status: 'running', caseIds: cases.map(item => item.id), runIds: [], createdAt: now(), reason: `${fresh.length} fresh validation products; ${regression.length} reviewed development regression checks.`, parentCorrect: null, candidateCorrect: null, regressions: null };
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const current = this.list<LoopValidation>('validation').filter(item => item.mode === candidate.mode);
        const external = candidate.mode === 'live' ? externalValidationProducts(this.db, this.corpus.version) : new Set<string>();
        if (current.length + (candidate.mode === 'live' ? externalValidationRounds(this.db, this.corpus.version) : 0) >= 3 || current.some(item => item.candidateId === candidate.id) || fresh.some(item => external.has(item.productId) || current.some(validation => validation.caseIds.includes(item.id)))) fail('validation cases were consumed concurrently');
        this.save('validation', validation); this.event('validation_started', 'Validation cases reserved before execution; no automatic retries.', candidate.id);
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      try {
        let retrievalConfig: string | null = null;
        for (let index = 0; index < cases.length; index++) {
          const item = cases[index];
          const retrieval = await this.retriever.retrieve(item.productId, item.question);
          this.checkRetrieval(retrieval, item.productId);
          const config = JSON.stringify([retrieval.method, retrieval.embeddingModel, retrieval.corpusVersion]);
          if (retrievalConfig !== null && retrievalConfig !== config) fail('retrieval configuration changed within validation');
          retrievalConfig = config;
          const order = index % 2 === 0 ? [parent, candidate] : [candidate, parent];
          for (const policy of order) {
            const run = await this.execute(candidate.mode, item.productId, item.question, item, policy, validation, retrieval);
            if (candidate.mode === 'live' && run.status !== 'completed') fail('a live answer failed; remaining calls were not dispatched');
          }
        }
        const runs = validation.runIds.map(id => this.get<LoopRun>('run', id)!);
        if (runs.some(run => run.status !== 'completed') || new Set(runs.map(run => run.model)).size !== 1) {
          validation.status = 'rejected'; validation.reason = 'Execution or provenance check failed, or paired model identities changed. Candidate rejected without a quality claim.';
          candidate.status = 'rejected'; this.save('policy', candidate);
        } else { validation.status = 'awaiting_review'; validation.reason += candidate.mode === 'fixture' ? ' SYNTHETIC mechanism exercise; generated fixture scores do not measure model quality.' : ' Every paired answer requires an independent human reference check before deciding.'; }
      } catch (error) { validation.status = 'interrupted'; validation.reason = `Validation stopped: ${errorText(error)}. Cases remain consumed; no automatic retry.`; candidate.status = 'rejected'; this.save('policy', candidate); }
      this.save('validation', validation); return validation;
    });
  }
  decide(validationId: string): LoopValidation {
    this.idle(); parse(idSchema, validationId);
    const validation = this.get<LoopValidation>('validation', validationId) ?? fail('unknown validation');
    if (validation.status !== 'awaiting_review') fail('validation is not awaiting review');
    const runs = validation.runIds.map(id => this.get<LoopRun>('run', id)!);
    const reviewKind = validation.mode === 'live' ? 'human' : 'synthetic';
    if (runs.length !== validation.caseIds.length * 2 || runs.some(run => run.status !== 'completed' || !run.feedback || !run.feedback.referenceChecked || (validation.mode === 'live' && run.feedback.kind !== reviewKind))) fail('every completed pair needs explicit human reference-checked feedback in live mode');
    const good = (run: LoopRun) => Boolean(run.feedback?.correct && run.feedback.supported);
    let parentCorrect = 0, candidateCorrect = 0, regressions = 0;
    let freshParentCorrect = 0, freshCandidateCorrect = 0;
    for (const caseId of validation.caseIds) {
      const parent = runs.find(run => run.caseId === caseId && run.policyId === validation.parentId) ?? fail('missing parent pair');
      const candidate = runs.find(run => run.caseId === caseId && run.policyId === validation.candidateId) ?? fail('missing candidate pair');
      parentCorrect += Number(good(parent)); candidateCorrect += Number(good(candidate)); regressions += Number(good(parent) && !good(candidate));
      if (this.corpus.cases.some(item => item.id === caseId && item.split === 'validation')) {
        freshParentCorrect += Number(good(parent)); freshCandidateCorrect += Number(good(candidate));
      }
    }
    validation.parentCorrect = parentCorrect; validation.candidateCorrect = candidateCorrect; validation.regressions = regressions;
    const candidate = this.get<LoopPolicy>('policy', validation.candidateId)!;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const stale = this.active(validation.mode).id !== validation.parentId || candidate.mode !== validation.mode;
      const accept = !stale && freshCandidateCorrect > freshParentCorrect && regressions === 0;
      validation.status = accept ? 'accepted' : 'rejected'; candidate.status = accept ? 'promoted' : 'rejected';
      validation.reason = `${validation.mode === 'fixture' ? 'SYNTHETIC workflow scores, not model quality. ' : ''}${stale ? 'Active policy changed; stale candidate rejected.' : accept ? 'Candidate improved supported correctness on fresh validation products with no observed pair regressions.' : 'No strict supported-correctness gain on fresh validation products without regression; candidate rejected.'} Fresh pairs: ${freshParentCorrect} parent, ${freshCandidateCorrect} candidate. Development controls check regressions only. Small validation batch is a release check, not a generalization claim.`;
      if (accept) this.setMeta(`active:${validation.mode}`, candidate.id);
      this.save('policy', candidate); this.save('validation', validation); this.event(accept ? 'promotion' : 'rejection', validation.reason, candidate.id); this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return validation;
  }
  async startFinal(raw: unknown): Promise<LoopFinal> {
    const input = parse(z.object({ mode: modes }).strict(), raw);
    const corpus = this.finalCorpus;
    if (!corpus || !this.finalRetriever) throw new Error('Feedback: frozen final product corpus is unavailable');
    const candidate = this.active(input.mode);
    if (candidate.status !== 'promoted') fail('freeze a promoted policy before final evaluation');
    if (this.list<LoopFinal>('final').some(item => item.mode === input.mode)) fail('one final evaluation per mode is allowed');
    const cases = corpus.cases;
    if (cases.length !== 20 || new Set(cases.map(item => item.productId)).size !== 20 || cases.some(item => item.split !== 'holdout')) fail('final requires 20 separate unseen products');
    if (input.mode === 'live' && this.provider.capacity && !this.provider.capacity(cases.length * 2).ready) fail(this.provider.capacity(cases.length * 2).reason);
    return this.job('final_comparison', input.mode, async () => {
      const baseline = this.get<LoopPolicy>('policy', `${input.mode}-baseline`)!;
      const final: LoopFinal = { id: randomUUID(), mode: input.mode, baselineId: baseline.id, candidateId: candidate.id, caseIds: cases.map(item => item.id), runIds: [], corpusVersion: this.finalCorpus!.version,
        manifestSha256: digest(JSON.stringify({ mainCorpus: this.corpus.version, finalCorpus: this.finalCorpus!.version, baseline: baseline.id, candidate: candidate.id, cases: cases.map(item => [item.id, item.productId, item.question]) })),
        status: 'running', reason: 'Original and frozen promoted policy are being compared on 20 unseen products.', createdAt: now(), result: null };
      this.save('final', final); this.event('final_started', 'Frozen final comparison started. Each product uses one retrieval for both policies.', candidate.id);
      let configuration: string | null = null, model: string | null = null;
      for (const [index, item] of cases.entries()) {
        try {
          const retrieval = await this.finalRetriever!.retrieve(item.productId, item.question);
          this.checkRetrieval(retrieval, item.productId, this.finalCorpus!);
          const config = JSON.stringify([retrieval.method, retrieval.embeddingModel, retrieval.corpusVersion]);
          if (configuration && configuration !== config) fail('final retrieval configuration changed');
          configuration = config;
          const order = index % 2 === 0 ? [baseline, candidate] : [candidate, baseline];
          for (const policy of order) {
            const run = await this.execute(input.mode, item.productId, item.question, item, policy, null, retrieval, null, final);
            if (run.status !== 'completed' || !run.model || (model && run.model !== model)) fail('final call failed or model identity changed');
            model = run.model;
          }
        } catch (error) {
          final.status = 'interrupted'; final.reason = `Final comparison stopped: ${errorText(error)}. No quality result; completed attempts remain saved.`;
          break;
        }
      }
      if (final.status === 'running') { final.status = 'awaiting_review'; final.reason = input.mode === 'fixture' ? 'SYNTHETIC fixture scores demonstrate the report path only.' : 'Every blinded answer needs independent human evidence review before any result is shown.'; }
      this.save('final', final); this.event('final_execution', final.reason, candidate.id);
      return final;
    });
  }
  reportFinal(finalId: string): LoopFinal {
    this.idle(); parse(idSchema, finalId);
    const final = this.get<LoopFinal>('final', finalId) ?? fail('unknown final evaluation');
    if (final.status !== 'awaiting_review') fail('final evaluation is not awaiting review');
    const runs = final.runIds.map(id => this.get<LoopRun>('run', id)!);
    if (runs.length !== final.caseIds.length * 2 || runs.some(run => run.status !== 'completed' || !run.feedback?.referenceChecked || run.feedback.kind !== (final.mode === 'live' ? 'human' : 'synthetic'))) fail('all final paired answers need complete human evidence review in live mode');
    const good = (run: LoopRun) => Boolean(run.feedback?.correct && run.feedback.supported);
    const cases: LoopFinalResult['cases'] = [];
    let wins = 0, losses = 0, ties = 0, baselineCorrect = 0, candidateCorrect = 0;
    const baselineRuns: LoopRun[] = [], candidateRuns: LoopRun[] = [];
    for (const caseId of final.caseIds) {
      const original = runs.find(run => run.caseId === caseId && run.policyId === final.baselineId) ?? fail('missing original answer');
      const updated = runs.find(run => run.caseId === caseId && run.policyId === final.candidateId) ?? fail('missing candidate answer');
      baselineRuns.push(original); candidateRuns.push(updated);
      const before = good(original), after = good(updated);
      baselineCorrect += Number(before); candidateCorrect += Number(after);
      if (after && !before) wins++; else if (before && !after) losses++; else ties++;
      cases.push({ caseId, baselineRunId: original.id, candidateRunId: updated.id, baselineGood: before, candidateGood: after });
    }
    const n = cases.length;
    const differences = cases.map(item => Number(item.candidateGood) - Number(item.baselineGood));
    const interval95 = pairedBootstrapInterval(differences, final.manifestSha256);
    const median = (values: number[]) => { const sorted = values.slice().sort((a, b) => a - b); return (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2; };
    const tokens = (items: LoopRun[]) => items.every(item => item.usage) ? items.reduce((sum, item) => sum + item.usage!.inputTokens + item.usage!.outputTokens, 0) : null;
    const result: LoopFinalResult = {
      baselineCorrect, candidateCorrect, wins, losses, ties, regressions: losses,
      pairedDifferencePoints: 100 * (wins - losses) / n,
      interval95,
      baselineAnswered: baselineRuns.filter(run => run.answer?.status === 'answered').length,
      candidateAnswered: candidateRuns.filter(run => run.answer?.status === 'answered').length,
      baselineUnsupported: baselineRuns.filter(run => !run.feedback?.supported).length,
      candidateUnsupported: candidateRuns.filter(run => !run.feedback?.supported).length,
      baselineTokens: tokens(baselineRuns), candidateTokens: tokens(candidateRuns),
      baselineMedianMs: median(baselineRuns.map(run => run.durationMs!)), candidateMedianMs: median(candidateRuns.map(run => run.durationMs!)),
      billedCostUsd: null, verdict: final.mode === 'fixture' || interval95[0] <= 0 && interval95[1] >= 0 ? 'inconclusive' : wins > losses ? 'gain_observed' : losses > wins ? 'decline_observed' : 'inconclusive', cases
    };
    final.result = result; final.status = 'reported';
    final.reason = `${final.mode === 'fixture' ? 'SYNTHETIC mechanism check. ' : ''}${baselineCorrect}/${n} original, ${candidateCorrect}/${n} candidate; ${wins} wins, ${losses} regressions, ${ties} ties. Purposive historical cases and a small paired sample limit generalization.`;
    this.db.exec('BEGIN IMMEDIATE');
    try { this.save('final', final); this.event('final_report', final.reason, final.candidateId); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return final;
  }
  rollback(raw: unknown): LoopOverview {
    this.idle(); const input = parse(rollbackSchema, raw);
    const target = this.get<LoopPolicy>('policy', input.policyId) ?? fail('unknown rollback policy');
    if (target.mode !== input.mode || (target.status !== 'baseline' && target.status !== 'promoted')) fail('rollback requires a previously active policy in the same mode');
    if (this.active(input.mode).id === target.id) fail('policy is already active');
    this.setMeta(`active:${input.mode}`, target.id); this.event('rollback', `Active ${input.mode} policy restored to ${target.id}.`, target.id); return this.overview();
  }
  export(): unknown { return { format: 'ablatrix-feedback-loop-v0.3', exportedAt: now(), ...this.publicOverview(), experiment: { corpusVersion: this.corpus.version, proposalRounds: { fixture: this.meta<number>('rounds:fixture') ?? 0, live: this.meta<number>('rounds:live') ?? 0 }, disclaimer: 'Fixture scores are synthetic. Live semantic correctness requires human review. Validation cases are consumed once per mode; holdout is excluded.' } }; }
  close(): void { if (this.closed) return; if (this.busy) fail('cannot close while an operation is running'); this.db.close(); this.retriever.close(); this.finalRetriever?.close(); FeedbackLoop.owners.delete(this.path); if (this.lockPath) unlinkSync(this.lockPath); this.closed = true; }
}
