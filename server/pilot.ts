import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { PilotAnswer, PilotArm, PilotMetrics, PilotMode, PilotOverview, PilotProtocol, PilotPublicRun, PilotReview, PilotReviewCard, PilotSource, PilotStatus, PilotSuite, PilotTask } from './pilot-types.ts';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const sourceSchema = z.object({ id: z.string().min(1), title: z.string().min(1), url: z.url().refine(url => new URL(url).hostname === 'docs.github.com' && url.startsWith('https://')), capturedAt: z.iso.datetime(), text: z.string().min(20).max(20_000), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const taskSchema = z.object({ id: z.string().min(1), split: z.enum(['development', 'evaluation']), question: z.string().min(8), sourceId: z.string(), expectedAnswer: z.string().min(1), requiredFacts: z.array(z.string().min(1)).min(1), supportQuote: z.string().min(12) }).strict();
const suiteSchema = z.object({ version: z.literal(1), scope: z.string(), labelStatus: z.string(), sources: z.array(sourceSchema).min(1), tasks: z.array(taskSchema).length(12) }).strict();
export function validatePilotSuite(raw: unknown): PilotSuite {
  const suite = suiteSchema.parse(raw);
  if (new Set(suite.tasks.map(task => task.id)).size !== 12 || new Set(suite.sources.map(source => source.id)).size !== suite.sources.length) throw new Error('Pilot IDs must be unique.');
  if (suite.tasks.filter(task => task.split === 'development').length !== 4) throw new Error('Pilot requires four development and eight evaluation questions.');
  for (const source of suite.sources) if (sha256(source.text) !== source.sha256) throw new Error('Pilot source snapshot checksum mismatch.');
  for (const task of suite.tasks) {
    const source = suite.sources.find(source => source.id === task.sourceId);
    if (!source?.text.includes(task.supportQuote)) throw new Error('Pilot reference quote does not occur in its frozen source.');
  }
  return suite;
}
export function loadPilotSuite(): PilotSuite {
  return validatePilotSuite(JSON.parse(readFileSync(fileURLToPath(new URL('../data/pilot/suite.json', import.meta.url)), 'utf8')));
}
export function pilotProtocol(suite: PilotSuite): PilotProtocol {
  return { version: 1, hypothesis: 'Removing the extra web search reduces answer-stage time without observed losses in supported correctness.', model: 'gpt-luna', lane: 'run_now', maxTokens: 4096,
    repetitions: 2, developmentQuestions: 4, evaluationQuestions: 8, measuredRuns: 32, latencyTargetPercent: 20, spendCapUsd: 10,
    sourceCollection: 'Official source snapshots are shared preparation, excluded from answer-stage time and charges.', scope: suite.scope };
}
export type PilotReadinessEvidence = { ready: boolean; reason: string; capReference: string | null; preflightReference: string | null; capMicros: number; priorSpendMicros: number; maxCallMicros: number };
export type PilotRequest = { attemptId: string; question: string; source: PilotSource; searchEnabled: boolean; model: 'gpt-luna'; lane: 'run_now'; maxTokens: number };
export type PilotProviderResult = {
  status: 'completed' | 'failed'; output: unknown; model: string | null; modelVerified: boolean;
  charge: { micros: number; reference: string } | null;
  calls: { search: number; model: number }; usage: { inputTokens: number; outputTokens: number } | null;
  executionId: string | null;
  requestId?: string | null; errorCode?: string | null;
};
export interface PilotProvider {
  readiness(): PilotReadinessEvidence;
  execute(request: PilotRequest): Promise<PilotProviderResult>;
}
export class SapiomPilotProvider implements PilotProvider {
  readiness(): PilotReadinessEvidence {
    return { ready: false, reason: 'Live comparison needs a verified Sapiom spending cap, settled per-run charges, and a preflight confirming the same named model in both versions.', capReference: null, preflightReference: null, capMicros: 0, priorSpendMicros: 0, maxCallMicros: 0 };
  }
  async execute(): Promise<never> { throw new Error(this.readiness().reason); }
}
type Slot = { id: string; cardId: string; taskId: string; repetition: number; arm: PilotArm };
type Attempt = Slot & { status: 'running' | 'completed' | 'failed'; startedAt: string; durationMs: number | null; answer: PilotAnswer | null; error: string | null; model: string | null; modelVerified: boolean; charge: PilotProviderResult['charge']; calls: PilotProviderResult['calls'] | null; usage: PilotProviderResult['usage']; executionId: string | null; requestId: string | null; review: PilotReview | null };
type StoredPilot = { id: string; mode: PilotMode; status: PilotStatus; createdAt: string; updatedAt: string; protocol: PilotProtocol; suite: PilotSuite; suiteHash: string; seed: string; slots: Slot[]; attempts: Attempt[]; cancelRequested: boolean; error: string | null; capReference: string | null; returnedModel: string | null };
const now = () => new Date().toISOString();
const safeInt = (value: number) => Number.isSafeInteger(value) && value >= 0;

export class PilotStore {
  private db: DatabaseSync;
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS pilot_sessions (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pilot_charges (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, reserved INTEGER NOT NULL, actual INTEGER, status TEXT NOT NULL, reference TEXT);`);
  }
  close() { this.db.close(); }
  save(run: StoredPilot) { run.updatedAt = now(); this.db.prepare('INSERT INTO pilot_sessions VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(run.id, run.createdAt, JSON.stringify(run)); }
  get(id: string): StoredPilot | null { const row = this.db.prepare('SELECT body FROM pilot_sessions WHERE id=?').get(id); return row ? JSON.parse(String(row.body)) : null; }
  list(): StoredPilot[] { return this.db.prepare('SELECT body FROM pilot_sessions ORDER BY created_at DESC').all().map(row => JSON.parse(String(row.body))); }
  hasUnknown(): boolean { return !!this.db.prepare("SELECT id FROM pilot_charges WHERE status IN ('unknown','over-bound') LIMIT 1").get(); }
  reservedTotal(): number { return Number(this.db.prepare("SELECT COALESCE(SUM(COALESCE(actual,reserved)),0) AS total FROM pilot_charges").get()!.total); }
  reserve(id: string, session: string, evidence: PilotReadinessEvidence) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.hasUnknown() || evidence.priorSpendMicros + this.reservedTotal() + evidence.maxCallMicros > evidence.capMicros) throw new Error('Pilot budget cannot reserve another call.');
      this.db.prepare("INSERT INTO pilot_charges VALUES (?, ?, ?, NULL, 'reserved', NULL)").run(id, session, evidence.maxCallMicros);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  settle(id: string, charge: NonNullable<PilotProviderResult['charge']>) {
    const row = this.db.prepare('SELECT reserved, actual, status, reference FROM pilot_charges WHERE id=?').get(id);
    if (!row || !safeInt(charge.micros) || !charge.reference?.trim()) throw new Error('Pilot charge evidence is invalid.');
    if (row.status === 'settled') {
      if (row.actual !== charge.micros || row.reference !== charge.reference) throw new Error('Pilot charge evidence changed.');
      return;
    }
    const status = charge.micros > Number(row.reserved) ? 'over-bound' : 'settled';
    this.db.prepare('UPDATE pilot_charges SET actual=?, status=?, reference=? WHERE id=?').run(charge.micros, status, charge.reference, id);
    if (status === 'over-bound') throw new Error('Pilot call exceeded its verified charge bound.');
  }
  unknown(id: string) { this.db.prepare("UPDATE pilot_charges SET status='unknown' WHERE id=? AND status='reserved'").run(id); }
  recover() {
    this.db.prepare("UPDATE pilot_charges SET status='unknown' WHERE status='reserved'").run();
    for (const run of this.list().filter(run => run.status === 'running')) {
      run.status = 'interrupted'; run.error = 'Execution was interrupted. Saved calls will not be repeated automatically.';
      for (const attempt of run.attempts.filter(attempt => attempt.status === 'running')) { attempt.status = 'failed'; attempt.error = 'Interrupted call; remote completion and charge may be unknown.'; }
      this.save(run);
    }
  }
}

export function buildPilotSchedule(suite: PilotSuite, seed: string): Slot[] {
  const slots: Slot[] = [];
  const tasks = suite.tasks.filter(task => task.split === 'evaluation');
  for (let repetition = 1; repetition <= 2; repetition++) {
    const ordered = [...tasks].sort((a, b) => sha256(`${seed}:${repetition}:${a.id}`).localeCompare(sha256(`${seed}:${repetition}:${b.id}`)));
    for (const task of ordered) {
      const arms: PilotArm[] = parseInt(sha256(`${seed}:${task.id}:${repetition}:arm`).slice(0, 2), 16) % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
      for (const arm of arms) slots.push({ id: randomUUID(), cardId: randomUUID(), taskId: task.id, repetition, arm });
    }
  }
  return slots;
}

const answerSchema = z.object({ answer: z.string().min(1).max(12_000), citations: z.array(z.object({ url: z.url(), quote: z.string().min(12).max(10_000) }).strict()).min(1).max(6) }).strict();
function checkedAnswer(raw: unknown, source: PilotSource): PilotAnswer {
  const answer = answerSchema.parse(raw);
  if (answer.citations.some(citation => citation.url !== source.url || !source.text.includes(citation.quote))) throw new Error('Answer cites text outside the frozen source.');
  return answer;
}
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function passes(attempt: Attempt | undefined) { return !!attempt && attempt.status === 'completed' && attempt.review?.correct === true && attempt.review.supported && attempt.review.referenceCorrect; }
function metrics(attempts: Attempt[], live: boolean, reviewed: boolean): PilotMetrics {
  return { completed: attempts.filter(a => a.status === 'completed').length, failed: attempts.filter(a => a.status === 'failed').length,
    reviewed: reviewed ? attempts.filter(a => a.review).length : 0, supportedCorrect: reviewed ? attempts.filter(passes).length : 0,
    medianMs: live && attempts.length && attempts.every(a => a.durationMs !== null) ? median(attempts.map(a => a.durationMs!)) : null,
    costUsd: live && attempts.length && attempts.every(a => a.charge) ? attempts.reduce((sum, a) => sum + a.charge!.micros, 0) / 1_000_000 : null,
    searchCalls: attempts.every(a => a.calls) ? attempts.reduce((sum, a) => sum + a.calls!.search, 0) : null, modelCalls: attempts.every(a => a.calls) ? attempts.reduce((sum, a) => sum + a.calls!.model, 0) : null,
    inputTokens: live && attempts.length && attempts.every(a => a.usage) ? attempts.reduce((sum, a) => sum + a.usage!.inputTokens, 0) : null,
    outputTokens: live && attempts.length && attempts.every(a => a.usage) ? attempts.reduce((sum, a) => sum + a.usage!.outputTokens, 0) : null };
}

export function summarizePilot(run: StoredPilot): PilotPublicRun {
  const finished = run.attempts.filter(a => a.status !== 'running');
  const completed = finished.filter(a => a.status === 'completed');
  const reviewComplete = run.status !== 'running' && completed.every(a => a.review !== null);
  const baseline = metrics(finished.filter(a => a.arm === 'baseline'), run.mode === 'live', reviewComplete);
  const candidate = metrics(finished.filter(a => a.arm === 'candidate'), run.mode === 'live', reviewComplete);
  const rows = reviewComplete ? run.suite.tasks.filter(task => task.split === 'evaluation').map(task => {
    const first = finished.filter(a => a.taskId === task.id && a.arm === 'baseline');
    const second = finished.filter(a => a.taskId === task.id && a.arm === 'candidate');
    const source = run.suite.sources.find(source => source.id === task.sourceId)!;
    return { taskId: task.id, question: task.question, baseline: metrics(first, run.mode === 'live', true), candidate: metrics(second, run.mode === 'live', true),
      regression: first.some(a => passes(a) && !passes(second.find(b => b.repetition === a.repetition))), sources: [{ title: source.title, url: source.url }] };
  }) : [];
  const reductions: number[] = [];
  for (const first of finished.filter(a => a.arm === 'baseline')) {
    const second = finished.find(a => a.arm === 'candidate' && a.taskId === first.taskId && a.repetition === first.repetition);
    if (first.durationMs && second?.durationMs !== null && second?.durationMs !== undefined && first.status === 'completed' && second.status === 'completed') reductions.push((first.durationMs - second.durationMs) / first.durationMs * 100);
  }
  const medianPairedReductionPercent = run.mode === 'live' ? median(reductions) : null;
  const regressions = rows.filter(row => row.regression).length;
  let decision: PilotPublicRun['decision'] = 'inconclusive';
  let reason = 'Waiting for all measured calls and blind answer reviews.';
  if (run.mode === 'fixture') reason = 'Synthetic rehearsal: calls and reviews are simulated. No model quality, latency or dollar saving has been established.';
  else if (run.status !== 'completed' || finished.length !== run.protocol.measuredRuns) reason = 'The full paired experiment did not complete; preserve partial evidence and resolve the blocker.';
  else if (!reviewComplete) reason = 'Blind semantic reviews are required before comparing answer quality.';
  else if (completed.some(a => a.review?.kind !== 'human' || !a.review.referenceCorrect)) reason = 'Reference answers need human confirmation against their frozen excerpts.';
  else if (finished.some(a => !a.modelVerified || !['gpt-luna', 'gpt-5.6-luna'].includes(a.model ?? ''))) reason = 'The same named answer model was not verified for every call.';
  else if (regressions || baseline.failed || candidate.failed) { decision = 'rejected'; reason = 'A version failed to complete or the candidate lost supported correctness on a baseline-correct answer.'; }
  else if (baseline.supportedCorrect !== 16 || candidate.supportedCorrect !== 16) reason = 'Both versions must produce supported-correct answers on all 16 question repetitions for this pilot.';
  else if (baseline.costUsd === null || candidate.costUsd === null) reason = 'Settled charge evidence is incomplete.';
  else if (reductions.length === 16 && medianPairedReductionPercent !== null && medianPairedReductionPercent >= 20) { decision = 'accepted'; reason = 'The candidate met the 20% median paired answer-time target with no observed supported-correctness loss on these eight questions. Dollar savings are a separate measurement.'; }
  else { decision = 'rejected'; reason = 'The candidate did not meet the predeclared 20% median paired answer-time target.'; }
  return { id: run.id, mode: run.mode, status: run.status, createdAt: run.createdAt, updatedAt: run.updatedAt, completedRuns: finished.length, plannedRuns: run.slots.length,
    reviewCount: completed.filter(a => a.review).length, reviewsNeeded: completed.length, protocol: run.protocol, decision, reason, baseline, candidate, rows,
    medianPairedReductionPercent, regressions, error: run.error, reviewComplete, exportReady: reviewComplete && run.status !== 'running', sourceHash: run.suiteHash, seed: run.seed };
}

export class PilotRunner {
  private active: string | null = null;
  private jobs = new Map<string, Promise<void>>();
  constructor(private store: PilotStore, private suite: PilotSuite = loadPilotSuite(), private provider: PilotProvider = new SapiomPilotProvider(), private timeoutMs = 45_000) { this.store.recover(); }
  overview(): PilotOverview { return { protocol: pilotProtocol(this.suite), readiness: this.readiness(), labelStatus: this.suite.labelStatus, runs: this.store.list().slice(0, 20).map(summarizePilot) }; }
  readiness() {
    const evidence = this.provider.readiness();
    if (this.store.hasUnknown()) return { ready: false, reason: 'An earlier paid call has unknown or over-bound charges. Reconcile it before another live call.' };
    return { ready: this.validReadiness(evidence), reason: evidence.reason };
  }
  private validReadiness(e: PilotReadinessEvidence) { return e.ready && !!e.capReference?.trim() && !!e.preflightReference?.trim() && safeInt(e.capMicros) && e.capMicros > 0 && e.capMicros <= 10_000_000 && safeInt(e.priorSpendMicros) && safeInt(e.maxCallMicros) && e.maxCallMicros > 0; }
  create(raw: unknown): PilotPublicRun {
    const { mode } = z.object({ mode: z.enum(['fixture', 'live']) }).strict().parse(raw);
    if (this.active) throw new Error('Pilot already running.');
    const evidence = this.provider.readiness();
    if (mode === 'live') {
      if (!this.readiness().ready) throw new Error(`Pilot live execution blocked: ${this.readiness().reason}`);
      if (evidence.priorSpendMicros + this.store.reservedTotal() + evidence.maxCallMicros * 32 > evidence.capMicros) throw new Error('Pilot budget cannot cover all 32 bounded calls.');
    }
    const at = now(), seed = randomBytes(16).toString('hex');
    const run: StoredPilot = { id: randomUUID(), mode, status: 'running', createdAt: at, updatedAt: at, protocol: pilotProtocol(this.suite),
      suite: structuredClone(this.suite), suiteHash: sha256(JSON.stringify(this.suite)), seed, slots: buildPilotSchedule(this.suite, seed), attempts: [], cancelRequested: false, error: null, capReference: mode === 'live' ? evidence.capReference : null, returnedModel: null };
    this.store.save(run); this.active = run.id;
    const job = Promise.resolve().then(() => this.execute(run.id)).catch(() => { const failed = this.store.get(run.id)!; failed.status = 'blocked'; failed.error = 'Pilot execution failed; inspect saved evidence before proceeding.'; this.store.save(failed); }).finally(() => { this.active = null; this.jobs.delete(run.id); });
    this.jobs.set(run.id, job);
    return summarizePilot(run);
  }
  async wait(id: string) { await this.jobs.get(id); return this.get(id); }
  async close() {
    if (this.active) this.cancel(this.active);
    await Promise.all(this.jobs.values());
    this.store.close();
  }
  get(id: string): PilotPublicRun | null { const run = this.store.get(id); return run ? summarizePilot(run) : null; }
  cancel(id: string): PilotPublicRun {
    const run = this.require(id); if (run.status === 'running') { run.cancelRequested = true; this.store.save(run); } return summarizePilot(run);
  }
  private require(id: string) { const run = this.store.get(id); if (!run) throw new Error('Pilot run not found.'); return run; }
  reviewCards(id: string): PilotReviewCard[] {
    const run = this.require(id);
    if (run.status === 'running') throw new Error('Pilot must finish before blind review.');
    return run.attempts.filter(a => a.status === 'completed' && a.answer).sort((a, b) => sha256(`${run.seed}:${a.cardId}`).localeCompare(sha256(`${run.seed}:${b.cardId}`))).map(a => {
      const task = run.suite.tasks.find(task => task.id === a.taskId)!;
      return { id: a.cardId, taskId: a.taskId, question: task.question, answer: a.answer!, source: run.suite.sources.find(source => source.id === task.sourceId)!, expectedAnswer: task.expectedAnswer, requiredFacts: task.requiredFacts, review: a.review };
    });
  }
  review(id: string, raw: unknown): PilotPublicRun {
    const input = z.object({ cardId: z.uuid(), correct: z.boolean(), supported: z.boolean(), referenceCorrect: z.boolean(), notes: z.string().max(1500) }).strict().parse(raw);
    const run = this.require(id);
    if (run.status === 'running') throw new Error('Pilot must finish before review.');
    const attempt = run.attempts.find(a => a.cardId === input.cardId && a.status === 'completed');
    if (!attempt) throw new Error('Pilot review card not found.');
    if (run.mode === 'live' && attempt.review) throw new Error('Pilot review is frozen once submitted.');
    attempt.review = { correct: input.correct, supported: input.supported, referenceCorrect: input.referenceCorrect, notes: input.notes, kind: 'human', reviewedAt: now() };
    this.store.save(run); return summarizePilot(run);
  }
  export(id: string) {
    const run = this.require(id), summary = summarizePilot(run);
    if (!summary.exportReady) throw new Error('Pilot export is available after blind reviews are complete.');
    return { formatVersion: 1, ...run, summary, limitations: ['Eight distinct evaluation questions; repetitions do not increase the independent question count.', 'Official source acquisition is shared preparation outside the timed answer stage.', 'A named Sapiom model alias does not establish a provider model revision.', 'Fixture runs and synthetic reviews never establish a live improvement.'], patch: { before: { model: 'gpt-luna', searchEnabled: true }, after: { model: 'gpt-luna', searchEnabled: false } } };
  }
  private async execute(id: string) {
    for (const slot of this.require(id).slots) {
      let run = this.require(id);
      if (run.cancelRequested) { run.status = 'cancelled'; this.store.save(run); return; }
      const task = run.suite.tasks.find(task => task.id === slot.taskId)!;
      const source = run.suite.sources.find(source => source.id === task.sourceId)!;
      if (run.mode === 'live') {
        const evidence = this.provider.readiness();
        if (!this.validReadiness(evidence) || evidence.capReference !== run.capReference) { run.status = 'blocked'; run.error = 'Verified spending contract changed during the experiment.'; this.store.save(run); return; }
        try { this.store.reserve(slot.id, run.id, evidence); }
        catch { run.status = 'blocked'; run.error = 'Pilot budget refused the next call.'; this.store.save(run); return; }
      }
      const attempt: Attempt = { ...slot, status: 'running', startedAt: now(), durationMs: null, answer: null, error: null, model: null, modelVerified: false, charge: null, calls: null, usage: null, executionId: null, requestId: null, review: null };
      run.attempts.push(attempt); this.store.save(run);
      const started = performance.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = run.mode === 'fixture';
      try {
        let result: PilotProviderResult;
        if (run.mode === 'fixture') {
          result = { status: 'completed', output: { answer: task.expectedAnswer, citations: [{ url: source.url, quote: task.supportQuote }] }, model: null, modelVerified: false, charge: null, calls: { search: slot.arm === 'baseline' ? 1 : 0, model: 1 }, usage: null, executionId: null };
        } else {
          const request: PilotRequest = { attemptId: slot.id, question: task.question, source, searchEnabled: slot.arm === 'baseline', model: run.protocol.model, lane: run.protocol.lane, maxTokens: run.protocol.maxTokens };
          result = await Promise.race([this.provider.execute(request), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Pilot call timed out.')), this.timeoutMs); })]);
        }
        attempt.durationMs = performance.now() - started;
        attempt.model = result.model; attempt.modelVerified = result.modelVerified;
        attempt.executionId = result.executionId;
        attempt.requestId = result.requestId ?? null;
        if (safeInt(result.calls?.search) && safeInt(result.calls?.model)) attempt.calls = result.calls;
        if (result.usage && safeInt(result.usage.inputTokens) && safeInt(result.usage.outputTokens)) attempt.usage = result.usage;
        if (run.mode === 'live') {
          if (!result.charge || !safeInt(result.charge.micros) || !result.charge.reference?.trim()) throw new Error('Pilot charge missing.');
          attempt.charge = result.charge;
          this.store.settle(slot.id, result.charge);
          settled = true;
        }
        if (run.mode === 'live' && result.calls.model > 0 && (!result.modelVerified || !['gpt-luna', 'gpt-5.6-luna'].includes(result.model ?? ''))) {
          run.status = 'blocked'; run.error = 'The named model was not verified; stop before testing a different workflow.';
          throw new Error('Pilot model mismatch.');
        }
        if (run.mode === 'live' && result.calls.model > 0) {
          if (run.returnedModel && run.returnedModel !== result.model) {
            run.status = 'blocked'; run.error = 'The returned model identifier changed during the paired experiment.';
            throw new Error('Pilot model identity changed.');
          }
          run.returnedModel = result.model;
        }
        if (result.status !== 'completed') throw new Error('Provider returned a failed answer.');
        if (result.calls.search !== (slot.arm === 'baseline' ? 1 : 0) || result.calls.model !== 1) throw new Error('Provider call trace differs from the frozen protocol.');
        attempt.answer = checkedAnswer(result.output, source); attempt.status = 'completed';
        if (run.mode === 'fixture') attempt.review = { correct: true, supported: true, referenceCorrect: true, notes: 'Synthetic expected-answer replay; no independent review.', kind: 'synthetic', reviewedAt: now() };
      } catch {
        attempt.status = 'failed'; attempt.error = 'Call failed, returned invalid evidence, or exceeded the wait limit.';
        attempt.durationMs ??= performance.now() - started;
        if (run.mode === 'live' && !settled) {
          this.store.unknown(slot.id); run.status = 'blocked'; run.error = 'Call charge is unknown or exceeded its verified bound; further paid calls stopped.';
        }
      } finally { if (timer) clearTimeout(timer); }
      const current = this.require(id); run.cancelRequested = current.cancelRequested;
      this.store.save(run);
      if (run.status === 'blocked') return;
      // Yield so cancellation can be observed even during a synthetic rehearsal.
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    const run = this.require(id); run.status = run.cancelRequested ? 'cancelled' : 'completed'; this.store.save(run);
  }
}
