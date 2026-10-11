import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { answerSchema, quoteOptions, revisionRequestBody, type RevisionInput } from './feedback-provider.ts';
import { revisionPromptIdentity } from './revision-policy.ts';
import { workspaceReviewSourceHash } from './answer-review-source.ts';

const fail = (message: string): never => { throw new Error(`Context comparison: ${message}`); };
const id = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const armNames = ['without_context', 'with_context'] as const;
export type ContextComparisonArm = typeof armNames[number];
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => compareText(a, b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const contextComparisonHash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const sourceSchema = z.object({ id, label: z.string().trim().min(2).max(80), text: z.string().trim().min(1).max(2000), originalQuestion: z.string().trim().min(1).max(500).nullable(), sha256: digest, reference: z.string().trim().min(1).max(1000) }).strict();
const protocolSchema = z.object({ modelAlias: z.enum(['gpt-luna', 'synthetic-model']), policy: z.string().trim().min(40).max(2500), citationInterface: z.literal('snippet_ids'), codeCommit: z.string().regex(/^[a-f0-9]{7,40}$/).nullable() }).strict();
const attemptSchema = z.object({ id, inputSha256: digest, status: z.enum(['completed', 'failed', 'uncertain']), answer: answerSchema.nullable(), model: z.string().trim().min(1).max(100).nullable(), latencyMs: z.number().finite().nonnegative().nullable(), usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).strict().nullable(), providerCallId: z.string().trim().min(1).max(200).nullable(), error: z.string().trim().min(1).max(1000).nullable() }).strict();
const caseSchema = z.object({ id, product: z.object({ id, title: z.string().trim().min(3).max(160) }).strict(), question: z.string().trim().min(5).max(500), sources: z.array(sourceSchema).min(1).max(12), retrievalSourceIds: z.array(id).min(1).max(12), arms: z.object({ without_context: attemptSchema, with_context: attemptSchema }).strict() }).strict();
const packetSchema = z.object({ format: z.literal('ablatrix-context-comparison-v1'), id, title: z.string().trim().min(3).max(120), mode: z.enum(['fixture', 'live']), createdAt: z.iso.datetime(), hypothesis: z.literal('preserve_original_customer_question'), protocol: protocolSchema, provenance: z.object({ kind: z.enum(['synthetic_fixture', 'imported_live']), note: z.string().trim().min(10).max(1000), sourcePacketSha256: digest.nullable() }).strict(), cases: z.array(caseSchema).min(1).max(20) }).strict();
export type ContextComparisonPacket = z.infer<typeof packetSchema>;
const correctionPolicySchema = z.object({ policy: z.enum(['baseline', 'candidate_v4']), promptVersion: z.string().min(1).max(100), systemInstructions: z.string().min(40).max(6000), systemInstructionsSha256: digest, configurationSha256: digest }).strict();
const correctionProtocolSchema = z.object({ modelAlias: z.enum(['gpt-luna', 'synthetic-model']), citationInterface: z.literal('passage_quotes'), codeCommit: z.string().regex(/^[a-f0-9]{7,40}$/).nullable(), policies: z.object({ baseline: correctionPolicySchema, candidate: correctionPolicySchema }).strict() }).strict();
const correctionAttemptSchema = attemptSchema.extend({ status: z.enum(['completed', 'failed', 'uncertain', 'not_attempted']), requestSha256: digest }).strict();
const correctionCaseSchema = z.object({ id, product: caseSchema.shape.product, question: caseSchema.shape.question, sources: z.array(sourceSchema).min(1).max(128), generationSourceIds: z.array(id).min(1).max(8),
  original: z.object({ id, answer: answerSchema, model: z.string().min(1).max(100), providerCallId: z.string().min(1).max(200).nullable(), inputSha256: digest, requestSha256: digest }).strict(),
  critique: z.object({ text: z.string().trim().min(10).max(2000), kind: z.literal('ai_assisted') }).strict(),
  investigation: z.object({ issue: z.enum(['wrong_model', 'missing_evidence', 'conflicting_sources', 'missed_source', 'answer_quality']), query: z.string().max(240), selectedSourceIds: z.array(id).min(1).max(8), addedSourceIds: z.array(id).length(0), stopReason: z.string().max(1000).optional() }).strict(),
  clarifications: z.array(z.object({ text: z.string().max(500), reviewer: z.string().max(100) }).strict()).length(0),
  arms: z.object({ baseline: correctionAttemptSchema, candidate: correctionAttemptSchema }).strict() }).strict();
const correctionPacketSchema = z.object({ format: z.literal('ablatrix-correction-comparison-v1'), id, title: packetSchema.shape.title, mode: packetSchema.shape.mode, createdAt: packetSchema.shape.createdAt, hypothesis: z.literal('compare_correction_policy'), protocol: correctionProtocolSchema, provenance: packetSchema.shape.provenance, cases: z.array(correctionCaseSchema).min(1).max(20) }).strict();
export type CorrectionComparisonPacket = z.infer<typeof correctionPacketSchema>;
type ComparisonPacket = ContextComparisonPacket | CorrectionComparisonPacket;
type ContextCase = ContextComparisonPacket['cases'][number];
type CorrectionCase = CorrectionComparisonPacket['cases'][number];
type ComparisonCase = ContextCase | CorrectionCase;
type Attempt = ContextCase['arms'][ContextComparisonArm] | CorrectionCase['arms']['baseline'];
const pairedArms = ['baseline', 'candidate'] as const;
type PairedArm = typeof pairedArms[number];
const attemptFor = (item: ComparisonCase, arm: PairedArm): Attempt => 'generationSourceIds' in item ? item.arms[arm] : item.arms[arm === 'baseline' ? 'without_context' : 'with_context'];
const generationIds = (item: ComparisonCase) => 'generationSourceIds' in item ? item.generationSourceIds : item.retrievalSourceIds;
const reviewSchema = z.object({ manifestSha256: digest, caseId: id, versionId: z.string().regex(/^v-[a-f0-9]{32}$/), reviewer: z.string().trim().min(2).max(100), correctness: z.enum(['correct', 'incorrect', 'uncertain']), support: z.enum(['supported', 'unsupported', 'uncertain']), adequacy: z.enum(['adequate', 'inadequate', 'uncertain']), checkedSourceShas: z.array(digest).min(1).max(128), note: z.string().trim().max(2000), referenceChecked: z.literal(true), independentReview: z.boolean().default(false) }).strict();
export type ContextComparisonReview = z.infer<typeof reviewSchema> & { kind: 'human' | 'synthetic'; createdAt: string };
function parse<T>(schema: z.ZodType<T>, raw: unknown): T { const result = schema.safeParse(raw); return result.success ? result.data : fail('invalid packet or review fields.'); }

/** Exact controlled input: only the separate customer-question field differs between arms. */
export function contextComparisonInput(protocol: z.infer<typeof protocolSchema>, item: Pick<ContextCase, 'product' | 'question' | 'sources' | 'retrievalSourceIds'>, arm: ContextComparisonArm) {
  const selected = item.retrievalSourceIds.map(sourceId => item.sources.find(source => source.id === sourceId) ?? fail('retrieved source does not belong to its case.'));
  const passages = selected.map(source => ({ id: source.id, productId: item.product.id, source: source.label, text: source.text, reference: source.reference, sha256: createHash('sha256').update(source.text).digest('hex'), ...(arm === 'with_context' && source.originalQuestion ? { originalQuestion: source.originalQuestion } : {}), lexicalRank: null, semanticRank: null, score: 0 }));
  return { modelAlias: protocol.modelAlias, promptVersion: 'product-answer-v2-context', question: item.question, product: item.product, answerPolicy: protocol.policy, citationInterface: protocol.citationInterface,
    evidence: passages.map(passage => ({ id: passage.id, source: passage.source, text: passage.text, ...(passage.originalQuestion ? { originalQuestion: passage.originalQuestion } : {}) })), quoteOptions: quoteOptions(passages) };
}
/** Exact common revision inputs. Both arms revise this same original, never one another. */
export function correctionComparisonInput(protocol: CorrectionComparisonPacket['protocol'], item: Omit<CorrectionCase, 'arms'>, arm: PairedArm) {
  return { modelAlias: protocol.modelAlias, question: item.question, product: item.product, rejectedAnswer: item.original.answer.answer, critique: item.critique.text,
    evidence: item.generationSourceIds.map(sourceId => { const source = item.sources.find(source => source.id === sourceId) ?? fail('generation source does not belong to its case.'); return { id: source.id, source: source.label, text: source.text, ...(source.originalQuestion ? { originalQuestion: source.originalQuestion } : {}) }; }),
    clarifications: item.clarifications, investigation: item.investigation, revisionPolicy: protocol.policies[arm].policy };
}
export function correctionComparisonRequest(protocol: CorrectionComparisonPacket['protocol'], item: Omit<CorrectionCase, 'arms'>, arm: PairedArm, runId: string) {
  const { modelAlias, ...input } = correctionComparisonInput(protocol, item, arm);
  return { ...revisionRequestBody({ ...input, runId }), model: modelAlias };
}
export const correctionComparisonRequestHash = (protocol: CorrectionComparisonPacket['protocol'], item: Omit<CorrectionCase, 'arms'>, arm: PairedArm, runId: string) => createHash('sha256').update(JSON.stringify(correctionComparisonRequest(protocol, item, arm, runId))).digest('hex');
export function correctionComparisonProtocol(modelAlias: 'gpt-luna' | 'synthetic-model' = 'gpt-luna', codeCommit: string | null = null): CorrectionComparisonPacket['protocol'] {
  const policy = (name: 'baseline' | 'candidate_v4') => {
    const identity = revisionPromptIdentity(name, true);
    const input: RevisionInput = { runId: 'configuration', question: '', product: { id: '', title: '' }, rejectedAnswer: '', critique: '', evidence: [], clarifications: [], investigation: { issue: 'answer_quality', query: '', selectedSourceIds: [], addedSourceIds: [] }, revisionPolicy: name };
    const body = revisionRequestBody(input);
    // Bind all generation settings, system instructions, tool schema and tool
    // choice; case-specific user content is bound by each actual request hash.
    return { ...identity, configurationSha256: contextComparisonHash({ ...body, model: modelAlias, messages: body.messages.filter(message => message.role === 'system') }) };
  };
  return { modelAlias, citationInterface: 'passage_quotes', codeCommit, policies: { baseline: policy('baseline'), candidate: policy('candidate_v4') } };
}
function validateContextPacket(raw: unknown): ContextComparisonPacket {
  const packet = parse(packetSchema, raw);
  if (packet.mode === 'fixture' ? packet.provenance.kind !== 'synthetic_fixture' || packet.protocol.modelAlias !== 'synthetic-model' || packet.provenance.sourcePacketSha256 !== null : packet.provenance.kind !== 'imported_live' || packet.protocol.modelAlias !== 'gpt-luna' || !packet.provenance.sourcePacketSha256) fail('mode and provenance must agree; live packets are explicitly imported, unverified records.');
  const seenCases = new Set<string>(), seenProducts = new Set<string>(), seenAttempts = new Set<string>(), seenReceipts = new Set<string>(), seenSnapshots = new Set<string>();
  for (const item of packet.cases) {
    const productId = item.product.id.toUpperCase();
    if (seenCases.has(item.id) || seenProducts.has(productId)) fail('cases require distinct case and product identities.');
    seenCases.add(item.id); seenProducts.add(productId);
    const snapshot = fingerprint(item);
    if (seenSnapshots.has(snapshot)) fail('distinct products cannot reuse the same source snapshot.');
    seenSnapshots.add(snapshot);
    if (new Set(item.sources.map(source => source.id)).size !== item.sources.length || new Set(item.retrievalSourceIds).size !== item.retrievalSourceIds.length) fail('duplicate source identity.');
    for (const source of item.sources) {
      if (/(?:^|\s)Question:\s*\S/i.test(source.text)) fail('legacy inline Question context must be separated before freezing either arm.');
      if (source.sha256 !== workspaceReviewSourceHash(source)) fail('source context hash mismatch.');
    }
    if (!item.retrievalSourceIds.some(sourceId => item.sources.find(source => source.id === sourceId)?.originalQuestion)) fail('each pair requires a retrieved customer-question context to test.');
    for (const arm of armNames) {
      const attempt = item.arms[arm], input = contextComparisonInput(packet.protocol, item, arm);
      if (attempt.inputSha256 !== contextComparisonHash(input)) fail('arm input does not match the frozen controlled context.');
      if (!input.quoteOptions.length || input.quoteOptions.length > 60 || canonical(input).length > 35_000) fail('frozen generation input exceeds the bounded protocol.');
      if (seenAttempts.has(attempt.id)) fail('duplicate attempt identity.');
      seenAttempts.add(attempt.id);
      if (attempt.providerCallId) { if (seenReceipts.has(attempt.providerCallId)) fail('duplicate provider-call identity.'); seenReceipts.add(attempt.providerCallId); }
      if (attempt.status === 'completed') {
        if (!attempt.answer || !attempt.model || attempt.latencyMs === null || attempt.error !== null) fail('completed attempts require an answer, model and latency.');
        if (packet.mode === 'live' ? !['gpt-luna', 'gpt-5.6-luna'].includes(attempt.model!) || !attempt.providerCallId : attempt.model !== 'synthetic-model' || attempt.providerCallId !== null) fail('attempt identity does not match the recorded protocol.');
        if (packet.mode === 'fixture' && !attempt.answer!.answer.startsWith('SYNTHETIC')) fail('fixture answer text must be explicitly synthetic.');
      } else if (attempt.answer !== null || !attempt.error) fail('failed or uncertain attempts cannot supply an accepted answer.');
    }
    if (item.arms.without_context.status === 'completed' && item.arms.with_context.status === 'completed' && item.arms.without_context.model !== item.arms.with_context.model) fail('paired returned model identities differ.');
  }
  return packet;
}
function validateCorrectionPacket(raw: unknown): CorrectionComparisonPacket {
  const packet = parse(correctionPacketSchema, raw);
  if (packet.mode === 'fixture' ? packet.provenance.kind !== 'synthetic_fixture' || packet.protocol.modelAlias !== 'synthetic-model' || packet.provenance.sourcePacketSha256 !== null : packet.provenance.kind !== 'imported_live' || packet.protocol.modelAlias !== 'gpt-luna' || !packet.provenance.sourcePacketSha256) fail('mode and provenance must agree; live packets are explicitly imported, unverified records.');
  if (canonical(packet.protocol) !== canonical(correctionComparisonProtocol(packet.protocol.modelAlias, packet.protocol.codeCommit))) fail('correction prompt configuration does not match the frozen baseline and candidate policies.');
  const seenCases = new Set<string>(), seenProducts = new Set<string>(), seenSnapshots = new Set<string>(), seenAttempts = new Set<string>(), seenReceipts = new Set<string>();
  const recordIdentity = (attemptId: string, receipt: string | null) => {
    if (seenAttempts.has(attemptId)) fail('duplicate attempt identity.');
    seenAttempts.add(attemptId);
    if (receipt) { if (seenReceipts.has(receipt)) fail('duplicate provider-call identity.'); seenReceipts.add(receipt); }
  };
  for (const item of packet.cases) {
    const productId = item.product.id.toUpperCase(), snapshot = fingerprint(item);
    if (seenCases.has(item.id) || seenProducts.has(productId)) fail('cases require distinct case and product identities.');
    if (seenSnapshots.has(snapshot)) fail('distinct products cannot reuse the same source snapshot.');
    seenCases.add(item.id); seenProducts.add(productId); seenSnapshots.add(snapshot);
    if (new Set(item.sources.map(source => source.id)).size !== item.sources.length || new Set(item.generationSourceIds).size !== item.generationSourceIds.length) fail('duplicate source identity.');
    if (canonical(item.investigation.selectedSourceIds) !== canonical(item.generationSourceIds)) fail('investigation selection must match the shared ordered generation sources.');
    for (const source of item.sources) {
      if (/(?:^|\s)Question:\s*\S/i.test(source.text)) fail('legacy inline Question context must be separated before freezing either arm.');
      if (source.sha256 !== workspaceReviewSourceHash(source)) fail('source context hash mismatch.');
    }
    recordIdentity(item.original.id, item.original.providerCallId);
    if (packet.mode === 'fixture' ? item.original.model !== 'synthetic-model' || item.original.providerCallId !== null || !item.original.answer.answer.startsWith('SYNTHETIC') : !['gpt-luna', 'gpt-5.6-luna'].includes(item.original.model) || !item.original.providerCallId) fail('shared original identity does not match the recorded protocol.');
    if (item.original.answer.status === 'answered' && !item.original.answer.citations.length || item.original.answer.citations.some(citation => !item.generationSourceIds.includes(citation.passageId) || !item.sources.some(source => source.id === citation.passageId && source.text.includes(citation.quote)))) fail('shared original citations must match its frozen generation sources.');
    for (const arm of pairedArms) {
      const attempt = item.arms[arm], input = correctionComparisonInput(packet.protocol, item, arm);
      if (attempt.inputSha256 !== contextComparisonHash(input)) fail('correction arm input does not match the shared original, critique and context.');
      if (attempt.requestSha256 !== correctionComparisonRequestHash(packet.protocol, item, arm, attempt.id)) fail('correction request hash does not match the exact frozen request body.');
      if (canonical(input).length > 35_000) fail('frozen generation input exceeds the bounded protocol.');
      recordIdentity(attempt.id, attempt.providerCallId);
      if (attempt.status === 'completed') {
        if (!attempt.answer || !attempt.model || attempt.latencyMs === null || attempt.error !== null) fail('completed attempts require an answer, model and latency.');
        if (packet.mode === 'live' ? !['gpt-luna', 'gpt-5.6-luna'].includes(attempt.model!) || !attempt.providerCallId : attempt.model !== 'synthetic-model' || attempt.providerCallId !== null) fail('attempt identity does not match the recorded protocol.');
        if (packet.mode === 'fixture' && !attempt.answer!.answer.startsWith('SYNTHETIC')) fail('fixture answer text must be explicitly synthetic.');
      } else {
        if (attempt.answer !== null || !attempt.error) fail('incomplete attempts cannot supply an accepted answer.');
        if (attempt.status === 'not_attempted' && [attempt.model, attempt.latencyMs, attempt.usage, attempt.providerCallId].some(value => value !== null)) fail('not-attempted arms cannot contain provider outcomes.');
      }
    }
    if (item.arms.baseline.status === 'completed' && item.arms.candidate.status === 'completed' && item.arms.baseline.model !== item.arms.candidate.model) fail('paired returned model identities differ.');
  }
  return packet;
}
const validatePacket = (raw: unknown): ComparisonPacket => raw && typeof raw === 'object' && 'format' in raw && raw.format === 'ablatrix-correction-comparison-v1' ? validateCorrectionPacket(raw) : validateContextPacket(raw);
const versionId = (manifest: string, item: ComparisonCase, arm: PairedArm) => `v-${contextComparisonHash([manifest, item.id, attemptFor(item, arm)]).slice(0, 32)}`;
function citationCheck(item: ComparisonCase, attempt: Attempt) {
  if (!attempt.answer) return null;
  return { matching: attempt.answer.citations.filter(citation => generationIds(item).includes(citation.passageId) && item.sources.some(source => source.id === citation.passageId && source.text.includes(citation.quote))).length, total: attempt.answer.citations.length, answeredHasCitation: attempt.answer.status !== 'answered' || attempt.answer.citations.length > 0 };
}
type Stored = { packet: ComparisonPacket; hash: string; blindKey: string };
export type ContextComparisonSummary = { experiment?: 'correction_policy'; format?: 'ablatrix-correction-comparison-v1'; id: string; title: string; mode: 'fixture' | 'live'; manifestSha256: string; caseCount: number; reviewedAnswers: number; reviewableAnswers: number; attempts: { completed: number; failed: number; uncertain: number; notAttempted?: number }; reportAvailable: boolean; qualityStatus: 'pending' | 'synthetic_only' | 'incomplete' | 'ready' };
export type ContextComparisonDetail = ContextComparisonSummary & { hypothesis: ComparisonPacket['hypothesis']; provenance: ComparisonPacket['provenance']; cases: { id: string; product: ComparisonCase['product']; question: string; sources: ComparisonCase['sources']; answers: { label: 'A' | 'B'; versionId: string; status: Attempt['status']; answer: Attempt['answer']; citationCheck: ReturnType<typeof citationCheck>; review: ContextComparisonReview | null }[] }[] };
const publicProvenance = (packet: ComparisonPacket): ComparisonPacket['provenance'] => ({ kind: packet.provenance.kind, sourcePacketSha256: null, note: packet.mode === 'fixture' ? 'Synthetic workflow rehearsal; these results do not measure model quality.' : packet.format === 'ablatrix-correction-comparison-v1' ? 'Imported correction results. Provider authenticity and a freeze before generation have not been independently verified.' : 'Imported retrospective results. Provider authenticity and a freeze before generation have not been independently verified.' });
const fingerprint = (item: ComparisonCase) => contextComparisonHash(item.sources.map(source => [source.text.normalize('NFKC').replace(/\s+/g, ' ').trim(), source.originalQuestion?.normalize('NFKC').replace(/\s+/g, ' ').trim() ?? '']).sort((a, b) => compareText(canonical(a), canonical(b))));
function knownProductIds(): Set<string> {
  const products = new Set<string>();
  for (const filename of ['../data/product-qa/corpus.json', '../data/product-qa/final-corpus.json']) {
    const corpus = JSON.parse(readFileSync(new URL(filename, import.meta.url), 'utf8')) as { products: { id: string }[] };
    for (const item of corpus.products) products.add(item.id.toUpperCase());
  }
  const paid = JSON.parse(readFileSync(new URL('../docs/evidence/paid-qa-batch-2026-09-28/manifest.json', import.meta.url), 'utf8')) as { cases: { asin: string }[] };
  for (const item of paid.cases) products.add(item.asin.toUpperCase());
  return products;
}

/** Import/review only. This class has no provider, worker or paid execution path. */
export class ContextComparisonStore {
  private readonly db: DatabaseSync;
  private readonly excluded: Set<string>;
  constructor(dbPath = '.data/context-comparisons.sqlite', options: { excludedProductIds?: string[] } = {}) {
    this.excluded = knownProductIds();
    for (const productId of options.excludedProductIds ?? []) this.excluded.add(productId.toUpperCase());
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS context_comparisons(id TEXT PRIMARY KEY,manifest_sha TEXT NOT NULL UNIQUE,blind_key TEXT NOT NULL,document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS context_comparison_exposure(mode TEXT NOT NULL,product_id TEXT NOT NULL,fingerprint TEXT NOT NULL,comparison_id TEXT NOT NULL,PRIMARY KEY(mode,product_id),UNIQUE(mode,fingerprint));
      CREATE TABLE IF NOT EXISTS context_comparison_reviews(comparison_id TEXT NOT NULL,version_id TEXT NOT NULL,document TEXT NOT NULL,PRIMARY KEY(comparison_id,version_id));`);
  }
  private stored(comparisonId: string): Stored {
    const row = this.db.prepare('SELECT manifest_sha,blind_key,document FROM context_comparisons WHERE id=?').get(comparisonId) as { manifest_sha: string; blind_key: string; document: string } | undefined;
    if (!row) return fail('comparison not found.');
    return { packet: JSON.parse(row.document) as ComparisonPacket, hash: row.manifest_sha, blindKey: row.blind_key };
  }
  private reviews(comparisonId: string) { return new Map((this.db.prepare('SELECT version_id,document FROM context_comparison_reviews WHERE comparison_id=?').all(comparisonId) as { version_id: string; document: string }[]).map(row => [row.version_id, JSON.parse(row.document) as ContextComparisonReview])); }
  private label(stored: Stored, item: ComparisonCase, arm: PairedArm): 'A' | 'B' {
    const first = parseInt(contextComparisonHash([stored.blindKey, item.id]).slice(0, 2), 16) % 2 === 0 ? 'baseline' : 'candidate';
    return arm === first ? 'A' : 'B';
  }
  private summary(stored: Stored): ContextComparisonSummary {
    const reviews = this.reviews(stored.packet.id), attempts = stored.packet.cases.flatMap(item => pairedArms.map(arm => attemptFor(item, arm)));
    const counts = { completed: attempts.filter(attempt => attempt.status === 'completed').length, failed: attempts.filter(attempt => attempt.status === 'failed').length, uncertain: attempts.filter(attempt => attempt.status === 'uncertain').length, ...(stored.packet.format === 'ablatrix-correction-comparison-v1' ? { notAttempted: attempts.filter(attempt => attempt.status === 'not_attempted').length } : {}) };
    const reportAvailable = reviews.size === counts.completed;
    return { ...(stored.packet.format === 'ablatrix-correction-comparison-v1' ? { experiment: 'correction_policy' as const, format: stored.packet.format } : {}), id: stored.packet.id, title: stored.packet.title, mode: stored.packet.mode, manifestSha256: stored.hash, caseCount: stored.packet.cases.length, reviewedAnswers: reviews.size, reviewableAnswers: counts.completed, attempts: counts, reportAvailable,
      qualityStatus: !reportAvailable ? 'pending' : counts.failed || counts.uncertain || counts.notAttempted ? 'incomplete' : stored.packet.mode === 'fixture' ? 'synthetic_only' : 'ready' };
  }
  list() { return { comparisons: (this.db.prepare('SELECT id FROM context_comparisons ORDER BY rowid DESC LIMIT 100').all() as { id: string }[]).map(row => this.summary(this.stored(row.id))) }; }
  importPacket(raw: unknown): ContextComparisonSummary {
    const packet = validatePacket(raw), hash = contextComparisonHash(packet);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.db.prepare('SELECT manifest_sha FROM context_comparisons WHERE id=?').get(packet.id) as { manifest_sha: string } | undefined;
      if (prior) { if (prior.manifest_sha !== hash) fail('a frozen comparison cannot be replaced.'); this.db.exec('COMMIT'); return this.summary(this.stored(packet.id)); }
      for (const item of packet.cases) {
        if (packet.mode === 'live' && this.excluded.has(item.product.id.toUpperCase())) fail('product overlaps an existing evaluation or supplied exposure record.');
        if (this.db.prepare('SELECT 1 FROM context_comparison_exposure WHERE mode=? AND (product_id=? OR fingerprint=?)').get(packet.mode, item.product.id.toUpperCase(), fingerprint(item))) fail('product or source snapshot was already exposed in another comparison.');
      }
      this.db.prepare('INSERT INTO context_comparisons(id,manifest_sha,blind_key,document) VALUES(?,?,?,?)').run(packet.id, hash, randomUUID(), canonical(packet));
      for (const item of packet.cases) this.db.prepare('INSERT INTO context_comparison_exposure(mode,product_id,fingerprint,comparison_id) VALUES(?,?,?,?)').run(packet.mode, item.product.id.toUpperCase(), fingerprint(item), packet.id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.summary(this.stored(packet.id));
  }
  get(comparisonId: string): ContextComparisonDetail {
    const stored = this.stored(comparisonId), reviews = this.reviews(comparisonId);
    return { ...this.summary(stored), hypothesis: stored.packet.hypothesis, provenance: publicProvenance(stored.packet), cases: stored.packet.cases.map(item => ({ id: item.id, product: item.product, question: item.question, sources: item.sources,
      answers: pairedArms.map(arm => ({ label: this.label(stored, item, arm), versionId: versionId(stored.hash, item, arm), status: attemptFor(item, arm).status, answer: attemptFor(item, arm).answer, citationCheck: citationCheck(item, attemptFor(item, arm)), review: reviews.get(versionId(stored.hash, item, arm)) ?? null })).sort((a, b) => compareText(a.label, b.label)) })) };
  }
  review(comparisonId: string, raw: unknown): ContextComparisonReview {
    const input = parse(reviewSchema, raw), stored = this.stored(comparisonId);
    if (input.manifestSha256 !== stored.hash) fail('stale manifest hash.');
    const item = stored.packet.cases.find(entry => entry.id === input.caseId) ?? fail('case not found.');
    const arm = pairedArms.find(name => versionId(stored.hash, item, name) === input.versionId) ?? fail('answer version does not belong to this case.');
    const attempt = attemptFor(item, arm);
    if (attempt.status !== 'completed') fail('only completed answers can be reviewed.');
    if (stored.packet.mode === 'live' && !input.independentReview) fail('live judgments require an explicit independent source check without AI review suggestions.');
    const citations = citationCheck(item, attempt)!;
    if (input.support === 'supported' && (citations.matching !== citations.total || !citations.answeredHasCitation)) fail('a supported judgment requires matching source quotes and citations for an answered response.');
    if (new Set(input.checkedSourceShas).size !== input.checkedSourceShas.length || input.checkedSourceShas.some(hash => !item.sources.some(source => source.sha256 === hash))) fail('checked sources must be distinct and belong to this frozen case.');
    if (item.sources.some(source => attempt.answer!.citations.some(citation => citation.passageId === source.id) && !input.checkedSourceShas.includes(source.sha256))) fail('check every source referenced by this answer.');
    if ((input.correctness !== 'correct' || input.support !== 'supported' || input.adequacy !== 'adequate') && input.note.length < 10) fail('explain a negative or uncertain judgment in at least ten characters.');
    const saved: ContextComparisonReview = { ...input, kind: stored.packet.mode === 'fixture' ? 'synthetic' : 'human', createdAt: new Date().toISOString() };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.reviews(comparisonId).get(input.versionId);
      if (prior) { const { kind: _kind, createdAt: _createdAt, ...priorInput } = prior; if (canonical(priorInput) !== canonical(input)) fail('this frozen answer already has a different judgment.'); this.db.exec('COMMIT'); return prior; }
      this.db.prepare('INSERT INTO context_comparison_reviews(comparison_id,version_id,document) VALUES(?,?,?)').run(comparisonId, input.versionId, canonical(saved));
      this.db.exec('COMMIT'); return saved;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  report(comparisonId: string) {
    const stored = this.stored(comparisonId), summary = this.summary(stored), reviews = this.reviews(comparisonId);
    if (!summary.reportAvailable) fail('all completed answers require source-checked review before the report or export.');
    const cases = stored.packet.cases.map(item => ({ id: item.id, product: item.product, question: item.question, ...('generationSourceIds' in item ? { original: item.original, critique: item.critique, investigation: item.investigation, generationSourceIds: item.generationSourceIds } : {}), arms: Object.fromEntries(pairedArms.map(arm => [arm, { ...attemptFor(item, arm), label: this.label(stored, item, arm), versionId: versionId(stored.hash, item, arm), review: reviews.get(versionId(stored.hash, item, arm)) ?? null }])) as Record<'baseline' | 'candidate', Attempt & { label: 'A' | 'B'; versionId: string; review: ContextComparisonReview | null }> }));
    const metric = (arm: PairedArm) => stored.packet.cases.reduce((sum, item) => { const value = citationCheck(item, attemptFor(item, arm)); if (value) { sum.matching += value.matching; sum.total += value.total; sum.completed++; sum.answeredWithCitation += Number(attemptFor(item, arm).answer?.status === 'answered' && value.answeredHasCitation); } return sum; }, { matching: 0, total: 0, completed: 0, answeredWithCitation: 0 });
    const counts = (arm: 'baseline' | 'candidate') => cases.reduce((sum, item) => { const review = item.arms[arm].review; sum.correct += Number(review?.correctness === 'correct'); sum.supported += Number(review?.support === 'supported'); sum.adequate += Number(review?.adequacy === 'adequate'); sum.good += Number(review?.correctness === 'correct' && review.support === 'supported' && review.adequacy === 'adequate'); return sum; }, { correct: 0, supported: 0, adequate: 0, good: 0 });
    const uncertain = (review: ContextComparisonReview | null) => !review || review.correctness === 'uncertain' || review.support === 'uncertain' || review.adequacy === 'uncertain';
    const eligible = cases.filter(item => !uncertain(item.arms.baseline.review) && !uncertain(item.arms.candidate.review));
    const good = (review: ContextComparisonReview) => review.correctness === 'correct' && review.support === 'supported' && review.adequacy === 'adequate';
    const differences = eligible.map(item => Number(good(item.arms.candidate.review!)) - Number(good(item.arms.baseline.review!)));
    const wins = differences.filter(value => value > 0).length, losses = differences.filter(value => value < 0).length;
    const complete = summary.attempts.completed === stored.packet.cases.length * 2;
    const verdict: 'exploratory_only' | 'inconclusive' = eligible.length !== cases.length ? 'inconclusive' : 'exploratory_only';
    const median = (arm: 'baseline' | 'candidate') => { const values = cases.map(item => item.arms[arm].latencyMs); if (cases.some(item => item.arms[arm].status !== 'completed') || values.some(value => value === null)) return null; const sorted = (values as number[]).sort((a, b) => a - b); return (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2; };
    return { ...summary, status: (!complete ? 'incomplete' : stored.packet.mode === 'fixture' ? 'synthetic_only' : 'complete') as 'incomplete' | 'synthetic_only' | 'complete', provenance: publicProvenance(stored.packet),
      ...(stored.packet.format === 'ablatrix-correction-comparison-v1' ? { protocol: stored.packet.protocol } : {}), qualityClaimEligible: false as const, quality: !complete || stored.packet.mode === 'fixture' ? null : { totalPairs: cases.length, eligiblePairs: eligible.length, uncertainPairs: cases.length - eligible.length, baseline: counts('baseline'), candidate: counts('candidate'), wins, losses, ties: differences.filter(value => value === 0).length, regressions: losses, interval95: null, verdict },
      citationMatching: { baseline: metric('baseline'), candidate: metric('candidate') }, timing: { definition: stored.packet.format === 'ablatrix-correction-comparison-v1' ? 'Imported revision-stage latency; shared original-answer generation and retrieval are excluded. Values are recorded, not independently verified.' : 'Imported answer-stage latency; shared retrieval is excluded. Values are recorded, not independently verified.', baselineMedianMs: median('baseline'), candidateMedianMs: median('candidate') }, billedCostUsd: null,
      limitations: ['Exact quote membership does not establish claim support or answer correctness.', 'Imported live records do not prove a freeze before generation, provider authenticity or unbiased product selection.', 'Human is locally attributed without authentication; fixture judgments are synthetic.', 'Small historical product samples do not establish a general quality gain; uncertain judgments are excluded from pair outcomes.'], cases };
  }
  exportPacket(comparisonId: string) { const report = this.report(comparisonId), stored = this.stored(comparisonId); return { format: stored.packet.format === 'ablatrix-correction-comparison-v1' ? 'ablatrix-correction-comparison-evidence-v1' : 'ablatrix-context-comparison-evidence-v1', manifestSha256: stored.hash, packet: stored.packet, reviews: [...this.reviews(comparisonId).values()].sort((a, b) => compareText(a.versionId, b.versionId)), report }; }
  close() { this.db.close(); }
}
export type ContextComparisonReport = ReturnType<ContextComparisonStore['report']>;

export function createContextComparisonFixture(): ContextComparisonPacket {
  const protocol: ContextComparisonPacket['protocol'] = { modelAlias: 'synthetic-model', policy: 'Answer from the supplied source body, preserve scope and cite supporting quote options.', citationInterface: 'snippet_ids', codeCommit: null };
  const examples = [
    { id: 'fixture-fit', product: { id: 'fixture-part', title: 'Synthetic replacement part' }, question: 'Does this replacement fit model XY-200?', text: 'Yes, it fits.', originalQuestion: 'Does the replacement fit model AB-100?', baseline: 'SYNTHETIC: this replacement fits XY-200.', candidate: 'SYNTHETIC: the customer answered about AB-100; XY-200 fit remains unverified.', candidateStatus: 'insufficient_evidence' as const },
    { id: 'fixture-capacity', product: { id: 'fixture-bottle', title: 'Synthetic water bottle' }, question: 'What is the capacity of this water bottle?', text: 'The bottle has a capacity of 750 mL.', originalQuestion: 'What is this water bottle capacity?', baseline: 'SYNTHETIC: the customer reports a 750 mL capacity.', candidate: 'SYNTHETIC: the customer reports a 750 mL capacity.', candidateStatus: 'answered' as const }
  ];
  const cases = examples.map(example => {
    const source = { id: `${example.id}-source`, label: 'Synthetic customer answer', text: example.text, originalQuestion: example.originalQuestion, reference: `synthetic://context-comparison/${example.id}` };
    const item: ContextCase = { id: example.id, product: example.product, question: example.question, sources: [{ ...source, sha256: workspaceReviewSourceHash(source) }], retrievalSourceIds: [source.id], arms: {} as ContextCase['arms'] };
    for (const arm of armNames) item.arms[arm] = { id: `${example.id}-${arm}`, inputSha256: contextComparisonHash(contextComparisonInput(protocol, item, arm)), status: 'completed', answer: { status: arm === 'with_context' ? example.candidateStatus : 'answered', answer: arm === 'with_context' ? example.candidate : example.baseline, citations: [{ passageId: source.id, quote: source.text }] }, model: 'synthetic-model', latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1 }, providerCallId: null, error: null };
    return item;
  });
  return { format: 'ablatrix-context-comparison-v1', id: 'synthetic-context-demo-v1', title: 'Synthetic context-preservation rehearsal', mode: 'fixture', createdAt: '2026-10-09T00:00:00.000Z', hypothesis: 'preserve_original_customer_question', protocol, provenance: { kind: 'synthetic_fixture', note: 'Scripted synthetic answers demonstrate the workflow, never measured model improvement.', sourcePacketSha256: null }, cases };
}

/** Explicit no-call example of the separate correction-policy experiment. */
export function createCorrectionComparisonFixture(): CorrectionComparisonPacket {
  const protocol = correctionComparisonProtocol('synthetic-model');
  const sources = [
    { id: 'policy-listing', label: 'Synthetic cabinet listing', text: 'The cabinet holds two narrow storage bins on its lower shelf.', originalQuestion: null, reference: 'synthetic://correction-comparison/listing' },
    { id: 'policy-customer', label: 'Synthetic customer answer', text: 'I use one large basket on that shelf.', originalQuestion: 'Can this cabinet shelf hold one large basket?', reference: 'synthetic://correction-comparison/customer' }
  ].map(source => ({ ...source, sha256: workspaceReviewSourceHash(source) }));
  const originalAnswer = { status: 'insufficient_evidence' as const, answer: 'SYNTHETIC original: physical capacity has not been independently tested, so the listing cannot answer this question.', citations: [{ passageId: sources[0].id, quote: sources[0].text }] };
  const item: CorrectionCase = { id: 'policy-capacity', product: { id: 'synthetic-policy-cabinet', title: 'Synthetic narrow-bin cabinet' }, question: 'Can this cabinet hold two narrow storage bins?', sources, generationSourceIds: sources.map(source => source.id),
    original: { id: 'synthetic-policy-original', answer: originalAnswer, model: 'synthetic-model', providerCallId: null, inputSha256: contextComparisonHash(['synthetic-original-input', sources]), requestSha256: contextComparisonHash(['synthetic-original-request', sources]) },
    critique: { text: 'Distinguish the listed cabinet capacity from independently verified physical fit.', kind: 'ai_assisted' },
    investigation: { issue: 'answer_quality', query: 'cabinet narrow storage bins capacity', selectedSourceIds: sources.map(source => source.id), addedSourceIds: [], stopReason: 'Synthetic frozen source selection; no external discovery.' }, clarifications: [], arms: {} as CorrectionCase['arms'] };
  for (const arm of pairedArms) item.arms[arm] = { id: `synthetic-policy-${arm}`, inputSha256: contextComparisonHash(correctionComparisonInput(protocol, item, arm)), requestSha256: correctionComparisonRequestHash(protocol, item, arm, `synthetic-policy-${arm}`), status: 'completed',
    answer: { status: arm === 'baseline' ? 'insufficient_evidence' : 'answered', answer: arm === 'baseline' ? 'SYNTHETIC revision: the cabinet capacity has not been independently tested.' : 'SYNTHETIC revision: the listing says the lower shelf holds two narrow storage bins; this is a listing claim, not an independent fit test.', citations: [{ passageId: sources[0].id, quote: sources[0].text }] }, model: 'synthetic-model', latencyMs: 1, usage: null, providerCallId: null, error: null };
  return { format: 'ablatrix-correction-comparison-v1', id: 'synthetic-correction-demo-v1', title: 'Synthetic correction-policy rehearsal', mode: 'fixture', createdAt: '2026-10-10T00:00:00.000Z', hypothesis: 'compare_correction_policy', protocol,
    provenance: { kind: 'synthetic_fixture', note: 'Scripted correction-policy answers; the shared critique is AI-authored development input, never a human quality judgment.', sourcePacketSha256: null }, cases: [item] };
}
