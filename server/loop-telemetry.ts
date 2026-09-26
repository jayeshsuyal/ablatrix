import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { LoopOverview, LoopPolicy, LoopRun } from './loop-types.ts';

export type LoopTelemetryStatus = { enabled: boolean; ready: boolean; busy: boolean; reason: string; destination: string | null; deliveredTraces: number; deliveredScores: number; uncertain: number; rejected: number; lastSyncAt: string | null };
type DeliveryState = 'sending' | 'delivered' | 'uncertain' | 'rejected';
type Kind = 'trace' | 'score';
type Counts = Pick<LoopTelemetryStatus, 'deliveredTraces' | 'deliveredScores' | 'uncertain' | 'rejected'>;
type Attribute = { key: string; value: { stringValue: string } };
type Span = { traceId: string; spanId: string; parentSpanId?: string; name: string; startTimeUnixNano: string; endTimeUnixNano: string; attributes: Attribute[] };
type ScoreExport = { ledgerId: string; eventId: string; payload: unknown };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const validDate = (value: string) => Number.isFinite(Date.parse(value));
const finiteCount = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0;
const attr = (key: string, value: unknown): Attribute => ({ key, value: { stringValue: typeof value === 'string' ? value : JSON.stringify(value) } });
const nano = (ms: number) => (BigInt(Math.trunc(ms)) * 1_000_000n).toString();
function stageRange(start: string | undefined, end: string | undefined): [string, string] | undefined {
  if (!start || !end || !validDate(start) || !validDate(end) || Date.parse(end) < Date.parse(start)) return;
  return [nano(Date.parse(start)), nano(Date.parse(end))];
}
const MAX_BODY_BYTES = 1_000_000;
const MAX_RESPONSE_BYTES = 64_000;
const MAX_RUNS_PER_SYNC = 100;

/** Explicit export only. Local experiment records remain authoritative. No model calls. */
export class LoopTelemetry {
  private db?: DatabaseSync;
  private enabled: boolean;
  private reason = 'Langfuse export is disabled.';
  private baseUrl: string | null = null;
  private target = '';
  private auth = '';
  private secrets: string[] = [];
  private fetchImpl: typeof fetch;
  private inFlight?: Promise<LoopTelemetryStatus>;
  private controller?: AbortController;
  private closed = false;
  private lastSyncAt: string | null = null;
  private counts: Counts = { deliveredTraces: 0, deliveredScores: 0, uncertain: 0, rejected: 0 };

  constructor(options: { env?: NodeJS.ProcessEnv; dbPath?: string; fetchImpl?: typeof fetch } = {}) {
    const env = options.env ?? process.env;
    this.enabled = env.ABLATRIX_LANGFUSE_ENABLED === '1';
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (!this.enabled) return;
    const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim();
    const secretKey = env.LANGFUSE_SECRET_KEY?.trim();
    if (!publicKey || !secretKey || !env.LANGFUSE_BASE_URL?.trim()) { this.reason = 'Set the Langfuse base URL and project key pair in the server environment.'; return; }
    try {
      const url = new URL(env.LANGFUSE_BASE_URL.trim());
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) throw new Error();
      this.baseUrl = url.href.replace(/\/+$/, '');
    } catch { this.reason = 'Langfuse requires an explicit HTTPS base URL, or HTTP on loopback.'; return; }
    this.target = hash(`${this.baseUrl}\n${publicKey}`);
    this.auth = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`;
    this.secrets = [publicKey, secretKey, this.auth];
    const path = options.dbPath ?? env.ABLATRIX_LANGFUSE_DB ?? '.data/langfuse-export.sqlite';
    try {
      if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
      this.db = new DatabaseSync(path);
      this.db.exec(`PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS loop_telemetry_delivery (target TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(target,kind,id));
        CREATE TABLE IF NOT EXISTS loop_telemetry_meta (target TEXT PRIMARY KEY, last_sync_at TEXT NOT NULL);`);
      // A crashed send may already have reached the receiver. Trace IDs are not deduplication keys in v4.
      this.db.prepare("UPDATE loop_telemetry_delivery SET state='uncertain' WHERE target=? AND state='sending'").run(this.target);
      this.lastSyncAt = (this.db.prepare('SELECT last_sync_at FROM loop_telemetry_meta WHERE target=?').get(this.target) as { last_sync_at: string } | undefined)?.last_sync_at ?? null;
      this.reason = 'Ready for explicit export of eligible live results and verified human feedback.';
    } catch { this.db?.close(); this.db = undefined; this.reason = 'The local Langfuse export ledger could not be opened.'; }
  }

  status(): LoopTelemetryStatus {
    if (this.db) {
      this.counts = { deliveredTraces: 0, deliveredScores: 0, uncertain: 0, rejected: 0 };
      for (const row of this.db.prepare('SELECT kind,state,COUNT(*) AS count FROM loop_telemetry_delivery WHERE target=? GROUP BY kind,state').all(this.target) as { kind: Kind; state: DeliveryState; count: number }[]) {
        if (row.state === 'delivered') this.counts[row.kind === 'trace' ? 'deliveredTraces' : 'deliveredScores'] += row.count;
        else if (row.state === 'uncertain' || row.state === 'rejected') this.counts[row.state] += row.count;
      }
    }
    return { enabled: this.enabled, ready: !!this.db && !this.closed, busy: !!this.inFlight, reason: this.reason, destination: this.baseUrl, ...this.counts, lastSyncAt: this.lastSyncAt };
  }

  async sync(overview: LoopOverview): Promise<LoopTelemetryStatus> {
    if (this.inFlight) return this.inFlight;
    if (!this.db || this.closed) return this.status();
    const snapshot = structuredClone(overview);
    this.inFlight = (async () => {
      try { await this.export(snapshot); } finally { this.inFlight = undefined; }
      return this.status();
    })();
    return this.inFlight;
  }

  close(): void {
    if (this.closed) return;
    this.status(); this.closed = true; this.controller?.abort();
    this.db?.close(); this.db = undefined;
    this.reason = 'Langfuse export is closed.';
  }

  private eligible(run: LoopRun, value: LoopOverview): boolean {
    if (run.mode !== 'live' || !['completed', 'failed', 'interrupted'].includes(run.status) || !validDate(run.createdAt)) return false;
    const validations = value.validations.filter(item => item.id === run.validationId || item.runIds.includes(run.id));
    const finals = value.finals.filter(item => item.id === run.finalId || item.runIds.includes(run.id));
    if (run.validationId && !validations.length || run.finalId && !finals.length) return false;
    if (validations.some(item => item.id !== run.validationId || !item.runIds.includes(run.id) || item.mode !== 'live' || !['accepted', 'rejected'].includes(item.status) || !finiteCount(item.parentCorrect) || !finiteCount(item.candidateCorrect) || !finiteCount(item.regressions))) return false;
    if (finals.some(item => item.id !== run.finalId || !item.runIds.includes(run.id) || item.mode !== 'live' || item.status !== 'reported' || item.result === null)) return false;
    if (run.split === 'validation' && !validations.length || run.split === 'holdout' && !finals.length) return false;
    return value.policies.some(policy => policy.id === run.policyId && policy.mode === 'live' && policy.instructions.trim());
  }

  private state(kind: Kind, id: string): DeliveryState | undefined {
    return (this.db?.prepare('SELECT state FROM loop_telemetry_delivery WHERE target=? AND kind=? AND id=?').get(this.target, kind, id) as { state: DeliveryState } | undefined)?.state;
  }
  private record(kind: Kind, id: string, state: DeliveryState): void {
    this.db?.prepare('INSERT INTO loop_telemetry_delivery(target,kind,id,state,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(target,kind,id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at').run(this.target, kind, id, state, new Date().toISOString());
  }
  private clean(payload: unknown): string {
    let result = JSON.stringify(payload);
    for (const secret of this.secrets) result = result.split(secret).join('[redacted]');
    return result;
  }

  private scores(run: LoopRun): ScoreExport[] {
    const feedback = run.feedback;
    if (feedback?.kind !== 'human' || !feedback.referenceChecked || !validDate(feedback.createdAt)) return [];
    return ([['human_correctness', Number(feedback.correct), 'BOOLEAN'], ['human_supported', Number(feedback.supported), 'BOOLEAN'], ['human_failure_category', feedback.category, 'CATEGORICAL']] as const).map(([name, score, dataType]) => {
      const remoteId = hash(`ablatrix:score:${run.id}:${name}`);
      const body = { id: remoteId, traceId: hash(`ablatrix:run:${run.id}`).slice(0, 32), name, value: score, dataType, comment: feedback.correction, metadata: { feedbackKind: 'human', referenceChecked: true, sourceIds: feedback.sourceIds, feedbackCreatedAt: feedback.createdAt, draftId: feedback.draftId ?? null } };
      const ledgerId = hash(`${remoteId}:${this.clean(body)}`);
      const rawEventId = hash(`ablatrix:score-event:${ledgerId}`);
      const eventId = `${rawEventId.slice(0, 8)}-${rawEventId.slice(8, 12)}-4${rawEventId.slice(13, 16)}-8${rawEventId.slice(17, 20)}-${rawEventId.slice(20, 32)}`;
      // v4 score identity includes the timestamp date. Anchor it to the immutable run,
      // while retaining the actual review time in metadata, so edits replace the score.
      return { ledgerId, eventId, payload: { batch: [{ id: eventId, timestamp: run.createdAt, type: 'score-create', body }] } };
    });
  }

  private pending(run: LoopRun): boolean {
    const state = this.state('trace', run.id);
    if (!state || state === 'rejected') return true;
    return state === 'delivered' && this.scores(run).some(score => { const scoreState = this.state('score', score.ledgerId); return !scoreState || scoreState === 'uncertain' || scoreState === 'rejected'; });
  }

  private trace(run: LoopRun, policy: LoopPolicy): unknown {
    const traceId = hash(`ablatrix:run:${run.id}`).slice(0, 32);
    const rootId = hash(`ablatrix:root:${run.id}`).slice(0, 16);
    const started = Date.parse(run.createdAt);
    const duration = finiteCount(run.durationMs) ? run.durationMs! : 0;
    const ended = started + duration;
    const shared = [attr('langfuse.trace.name', 'ablatrix.product-answer'), attr('langfuse.environment', 'ablatrix-local-live'), attr('langfuse.session.id', run.finalId ?? run.validationId ?? run.batchId ?? run.id), ...Object.entries({ runId: run.id, policyId: run.policyId, productId: run.productId, caseId: run.caseId ?? '', split: run.split, batchId: run.batchId ?? '', validationId: run.validationId ?? '', finalId: run.finalId ?? '', providerBilledCost: 'unknown' }).map(([key, value]) => attr(`langfuse.observation.metadata.${key}`, value))];
    const spans: Span[] = [{ traceId, spanId: rootId, name: 'product-answer', startTimeUnixNano: nano(started), endTimeUnixNano: nano(ended), attributes: [...shared, attr('langfuse.observation.type', 'span'), attr('langfuse.observation.input', { question: run.question, policyId: policy.id, instructions: policy.instructions }), attr('langfuse.observation.output', { status: run.status, answer: run.answer }), attr('langfuse.observation.metadata.timing', finiteCount(run.durationMs) ? 'recorded_total_workflow_duration' : 'duration_unavailable_zero_length_snapshot'), attr('langfuse.observation.metadata.model', run.model), attr('langfuse.observation.metadata.tokenUsage', run.usage), attr('langfuse.observation.level', run.status === 'completed' ? 'DEFAULT' : 'ERROR')] }];
    // Historical records do not retain stage timestamps. Zero-length snapshots are labeled;
    // the recorded retrieval duration can include evidence reused across paired arms.
    const retrievalRange = run.timings?.retrievalReused ? undefined : stageRange(run.timings?.retrievalStartedAt, run.timings?.retrievalEndedAt);
    if (run.retrieval) spans.push({ traceId, spanId: hash(`ablatrix:retrieval:${run.id}`).slice(0, 16), parentSpanId: rootId, name: retrievalRange ? 'retrieve-product-evidence' : 'retrieval-snapshot (stage timestamps unavailable or reused)', startTimeUnixNano: retrievalRange?.[0] ?? nano(ended), endTimeUnixNano: retrievalRange?.[1] ?? nano(ended), attributes: [...shared, attr('langfuse.observation.type', retrievalRange ? 'retriever' : 'event'), attr('langfuse.observation.metadata.timing', retrievalRange ? 'recorded_stage_timestamps' : 'snapshot_only'), attr('langfuse.observation.output', { method: run.retrieval.method, embeddingModel: run.retrieval.embeddingModel, corpusVersion: run.retrieval.corpusVersion, reportedRetrievalDurationMs: run.retrieval.durationMs, evidenceReused: run.timings?.retrievalReused ?? null, passages: run.retrieval.passages.map(item => ({ id: item.id, sha256: item.sha256, source: item.source, lexicalRank: item.lexicalRank, semanticRank: item.semanticRank, score: item.score })) })] });
    const generationRange = stageRange(run.timings?.generationStartedAt, run.timings?.generationEndedAt);
    if (run.model && generationRange) spans.push({ traceId, spanId: hash(`ablatrix:generation:${run.id}`).slice(0, 16), parentSpanId: rootId, name: 'generate-product-answer', startTimeUnixNano: generationRange[0], endTimeUnixNano: generationRange[1], attributes: [...shared, attr('langfuse.observation.type', 'generation'), attr('langfuse.observation.model.name', run.model), attr('langfuse.observation.metadata.timing', 'recorded_stage_timestamps'), attr('langfuse.observation.input', { question: run.question, instructions: policy.instructions }), attr('langfuse.observation.output', run.answer), ...(run.usage ? [attr('langfuse.observation.usage_details', { input: run.usage.inputTokens, output: run.usage.outputTokens })] : [])] });
    return { resourceSpans: [{ resource: { attributes: [attr('service.name', 'ablatrix')] }, scopeSpans: [{ scope: { name: 'ablatrix.feedback-loop', version: '1' }, spans }] }] };
  }

  private async export(value: LoopOverview): Promise<LoopTelemetryStatus> {
    try {
      const pending = value.runs.filter(run => this.eligible(run, value) && this.pending(run));
      const runs = pending.slice(0, MAX_RUNS_PER_SYNC);
      for (const run of runs) {
        if (this.closed) break;
        const traceState = this.state('trace', run.id);
        if (!traceState || traceState === 'rejected') await this.deliver('trace', run.id, '/api/public/otel/v1/traces', this.trace(run, value.policies.find(policy => policy.id === run.policyId)!));
        if (this.state('trace', run.id) !== 'delivered') continue;
        for (const score of this.scores(run)) {
          if (this.closed) break;
          const state = this.state('score', score.ledgerId);
          if (state === 'delivered' || state === 'sending') continue;
          await this.deliver('score', score.ledgerId, '/api/public/ingestion', score.payload, score.eventId);
        }
      }
      if (this.db && !this.closed) {
        this.lastSyncAt = new Date().toISOString();
        this.db.prepare('INSERT INTO loop_telemetry_meta(target,last_sync_at) VALUES(?,?) ON CONFLICT(target) DO UPDATE SET last_sync_at=excluded.last_sync_at').run(this.target, this.lastSyncAt);
        const status = this.status();
        this.reason = status.uncertain || status.rejected ? 'Export finished with uncertain or rejected deliveries. Fix rejected deliveries and sync again. Uncertain traces are never automatically resent.' : 'Eligible live results exported. Unresolved comparisons and AI review drafts stay local.';
        if (pending.length > MAX_RUNS_PER_SYNC) this.reason += ' More eligible results remain; sync again to continue the bounded export.';
      }
    } catch { if (!this.closed) this.reason = 'Export stopped because the local delivery ledger was unavailable.'; }
    return this.status();
  }

  private async deliver(kind: Kind, id: string, path: string, payload: unknown, eventId?: string): Promise<void> {
    const body = this.clean(payload);
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) { this.record(kind, id, 'rejected'); return; }
    this.record(kind, id, 'sending');
    const controller = new AbortController(); this.controller = controller;
    const timer = setTimeout(() => controller.abort(), 10_000);
    let state: DeliveryState = 'uncertain';
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, { method: 'POST', redirect: 'error', signal: controller.signal, headers: { Authorization: this.auth, 'Content-Type': 'application/json', ...(kind === 'trace' ? { 'x-langfuse-ingestion-version': '4' } : {}) }, body });
      if (!response.ok) { state = response.status >= 500 || response.status === 429 || response.status === 408 ? 'uncertain' : 'rejected'; await response.body?.cancel(); return; }
      let raw = ''; let bytes = 0;
      const reader = response.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        while (true) { const result = await reader.read(); if (result.done) break; bytes += result.value.byteLength; if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error(); } raw += decoder.decode(result.value, { stream: true }); }
        raw += decoder.decode();
      }
      const result = JSON.parse(raw) as Record<string, unknown>;
      if (!result || typeof result !== 'object' || Array.isArray(result)) return;
      if (kind === 'trace' && response.status === 200 && result.name === 'otel-ingestion-job' && typeof result.id === 'string' && result.id.length > 0 && typeof result.queueQualifiedName === 'string' && result.queueQualifiedName.length > 0) {
        // Langfuse Cloud can acknowledge OTLP batches with its durable queue receipt.
        state = 'delivered';
      } else if (kind === 'trace' && response.status === 200 && Object.keys(result).every(key => key === 'partialSuccess')) {
        const partial = result.partialSuccess as { rejectedSpans?: unknown; errorMessage?: unknown } | undefined;
        if (partial !== undefined && (!partial || typeof partial !== 'object' || Array.isArray(partial))) return;
        if (partial?.rejectedSpans !== undefined && !(typeof partial.rejectedSpans === 'number' && Number.isSafeInteger(partial.rejectedSpans) && partial.rejectedSpans >= 0) && !(typeof partial.rejectedSpans === 'string' && /^\d+$/.test(partial.rejectedSpans))) return;
        const rejected = partial?.rejectedSpans === undefined ? 0 : Number(partial.rejectedSpans);
        state = Number.isFinite(rejected) && rejected === 0 ? 'delivered' : 'uncertain';
      } else if (kind === 'score' && response.status === 207 && Array.isArray(result.successes) && Array.isArray(result.errors)) {
        const success = result.successes.find((item: { id?: string; status?: number }) => item.id === eventId && item.status === 201);
        const failure = result.errors.find((item: { id?: string }) => item.id === eventId);
        state = failure ? 'rejected' : success ? 'delivered' : 'uncertain';
      }
    } catch { /* Transport errors can follow acceptance; never expose remote bodies or credentials. */ }
    finally { clearTimeout(timer); if (this.controller === controller) this.controller = undefined; this.record(kind, id, state); }
  }
}
