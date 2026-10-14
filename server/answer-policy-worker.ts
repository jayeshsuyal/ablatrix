import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseReviewAnswerSnapshot } from './answer-review-source.ts';
import type { AutomaticSupportJob } from './automatic-support.ts';
import { claimSupportPromptIdentity, claimSupportRequestParts, replayClaimSupportReceipt, type ClaimSupportInput, type ValidatedClaimSupportAssessment } from './claim-support.ts';
import type { AnswerRevisionReceipt } from './answer-revisions.ts';
import type { LoopAnswer } from './loop-types.ts';
import type { CitationEvidence } from './citation-options.ts';
import { originalAnswerVersionId } from './paid-answer-review.ts';
import { answerSchema, revisionRequestBody } from './feedback-provider.ts';
import { revisionPromptIdentity } from './revision-policy.ts';
import { runtimeAnswerRequestParts, runtimeProposalRequestParts, replayRuntimeAnswerReceipt, replayRuntimeProposalReceipt, type RuntimeAnswerInput, type RuntimeProposalInput, type RuntimeFailureBinding } from './answer-policy-protocol.ts';
import { RuntimeAnswerPolicyStore, runtimePolicyHash as sha, type RuntimeAnswerPolicy, type RuntimePolicyBinding, type RuntimePolicyMode, type RuntimeTrialDecision, type RuntimeTrialMetrics, type RuntimeTrialOperation } from './runtime-answer-policy.ts';

type Category = RuntimeProposalInput['failure']['category'];
export type RuntimeValidationCase = { id: string; role: 'targeted' | 'correct_control' | 'unanswerable_control'; question: string; product: { id: string; title: string }; evidence: CitationEvidence[];
  expectedStatus: 'answered' | 'insufficient_evidence'; requiredFacts: { sourceId: string; quote: string; answerIncludes: string }[] };
export type RuntimeValidationPacket = { id: string; mode: RuntimePolicyMode; provenance: 'synthetic_fictional_fixture' | 'fresh_product_disjoint_validation'; cases: RuntimeValidationCase[] };
export const SYNTHETIC_RUNTIME_VALIDATION_PACKET: RuntimeValidationPacket = {
  id: 'synthetic-fictional-runtime-policy-v1', mode: 'synthetic', provenance: 'synthetic_fictional_fixture', cases: [
    { id: 'nacre-capacity', role: 'targeted', question: 'How many cups does the fictional Nacre kettle hold?', product: { id: 'fictional-nacre', title: 'Fictional Nacre kettle' },
      evidence: [{ id: 'nacre-capacity-source', source: 'Synthetic fictional fixture listing', text: 'SYNTHETIC runtime fixture: The fictional Nacre kettle holds twelve cups.' }], expectedStatus: 'answered',
      requiredFacts: [{ sourceId: 'nacre-capacity-source', quote: 'SYNTHETIC runtime fixture: The fictional Nacre kettle holds twelve cups.', answerIncludes: 'twelve cups' }] },
    { id: 'opal-material', role: 'correct_control', question: 'What material is the fictional Opal tray made of?', product: { id: 'fictional-opal', title: 'Fictional Opal tray' },
      evidence: [{ id: 'opal-material-source', source: 'Synthetic fictional fixture listing', text: 'SYNTHETIC runtime fixture: The fictional Opal tray is made of steel.' }], expectedStatus: 'answered',
      requiredFacts: [{ sourceId: 'opal-material-source', quote: 'SYNTHETIC runtime fixture: The fictional Opal tray is made of steel.', answerIncludes: 'steel' }] },
    { id: 'opal-voltage', role: 'unanswerable_control', question: 'What voltage does the fictional Opal tray require?', product: { id: 'fictional-opal', title: 'Fictional Opal tray' },
      evidence: [{ id: 'opal-material-source', source: 'Synthetic fictional fixture listing', text: 'SYNTHETIC runtime fixture: The fictional Opal tray is made of steel.' }], expectedStatus: 'insufficient_evidence', requiredFacts: [] }
  ]
};
export type AnswerPolicyProvider = {
  executionMode?: RuntimePolicyMode; readiness(): { ready: boolean; reason: string }; capacity(count: number): { ready: boolean; reason: string };
  receipt(runId: string): AnswerRevisionReceipt | undefined;
  suggestRuntimePolicy(input: RuntimeProposalInput): Promise<unknown>; answerRuntimePolicy(input: RuntimeAnswerInput): Promise<unknown>; gradeClaimSupport(input: ClaimSupportInput): Promise<unknown>;
};
type CaseResult = { caseId: string; baseline?: { answer: LoopAnswer; assessment?: ValidatedClaimSupportAssessment }; candidate?: { answer: LoopAnswer; assessment?: ValidatedClaimSupportAssessment } };
export type AnswerPolicyGroup = { id: string; mode: RuntimePolicyMode; category: Category; parent: RuntimeAnswerPolicy; bindings: RuntimeFailureBinding[];
  groupSha256: string; status: 'collecting' | 'queued' | 'running' | 'completed' | 'failed' | 'reconciliation'; phase: number; callCeiling: 13;
  packet: RuntimeValidationPacket | null; packetSha256: string; graderSha256: string; operations: RuntimeTrialOperation[];
  candidate?: RuntimeAnswerPolicy; results: CaseResult[]; decisionId?: string; decision?: RuntimeTrialDecision; createdAt: string; finishedAt?: string; error?: string };
type StoredGroup = { document: string; document_sha256: string | null };
const CALL_CEILING = 13;
const MAX_GROUPS = 32;
const TERMINAL_CHECKS = new Set(['supported', 'repaired', 'abstained']);
function metrics(): RuntimeTrialMetrics { return { usefulSupportedAnswers: 0, unsupportedClaims: 0, unnecessaryAbstentions: 0, completeAnswers: 0, regressions: 0, uncertainAssessments: 0, latencyMs: 0, planningAllowanceUsd: null }; }
function packetCopy(packet: RuntimeValidationPacket): RuntimeValidationPacket {
  const copy = structuredClone(packet);
  if (copy.cases.length !== 3 || new Set(copy.cases.map(item => item.id)).size !== 3 || !['targeted', 'correct_control', 'unanswerable_control'].every(role => copy.cases.some(item => item.role === role)) ||
    copy.mode === 'synthetic' && copy.provenance !== 'synthetic_fictional_fixture' || copy.mode === 'live' && copy.provenance !== 'fresh_product_disjoint_validation' || JSON.stringify(copy).length > 30_000) throw new Error('Runtime validation requires three distinct bounded frozen cases and matching provenance.');
  for (const item of copy.cases) {
    if (item.role === 'unanswerable_control' ? item.expectedStatus !== 'insufficient_evidence' || item.requiredFacts.length : item.expectedStatus !== 'answered' || !item.requiredFacts.length) throw new Error('Frozen validation controls require independently labeled answerability and facts.');
    if (item.requiredFacts.length > 5 || item.requiredFacts.some(fact => !fact.answerIncludes.trim() || !fact.quote.trim() || !item.evidence.some(source => source.id === fact.sourceId && source.text.includes(fact.quote)))) throw new Error('Frozen reference facts must bind to literal independent source text.');
  }
  return copy;
}

/** At most one proposal and twelve paired answer/check operations per consumed
 * group. Synthetic trials and uncalibrated live shadows are separate evidence. */
export class AnswerPolicyWorker {
  private readonly db: DatabaseSync;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private paused = false;
  private closed = false;
  private inFlight: Promise<void> | null = null;
  private readonly packet: RuntimeValidationPacket | null;
  constructor(private readonly provider: AnswerPolicyProvider, private readonly store: RuntimeAnswerPolicyStore, dbPath = '.data/runtime-answer-policy.sqlite',
    private readonly options: { automatic?: boolean; canDispatch?: () => boolean; liveEnabled?: boolean; completedJobs?: () => AutomaticSupportJob[]; validationPacket?: RuntimeValidationPacket } = {}) {
    this.packet = options.validationPacket ? packetCopy(options.validationPacket) : (provider.executionMode === 'synthetic' ? packetCopy(SYNTHETIC_RUNTIME_VALIDATION_PACKET) : null);
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS runtime_policy_failure_groups(id TEXT PRIMARY KEY,status TEXT NOT NULL,mode TEXT NOT NULL,parent_id TEXT NOT NULL,category TEXT NOT NULL,document TEXT NOT NULL,document_sha256 TEXT NOT NULL,lease_expires INTEGER);
      CREATE TABLE IF NOT EXISTS runtime_policy_observed_checks(job_id TEXT PRIMARY KEY,run_id TEXT NOT NULL UNIQUE,binding TEXT NOT NULL);`);
    if (!(this.db.prepare('PRAGMA table_info(runtime_policy_failure_groups)').all() as { name: string }[]).some(column => column.name === 'document_sha256')) {
      // Do not manufacture integrity evidence for records written before this
      // contract. Unhashed rows require explicit reconciliation or restore.
      this.db.exec('ALTER TABLE runtime_policy_failure_groups ADD COLUMN document_sha256 TEXT');
    }
    try { this.reconcile(); this.syncDecisions(); }
    catch (error) { this.db.close(); throw error; }
    if (options.automatic) this.start();
  }
  start() { if (this.timer || this.paused || this.closed) return; this.timer = setInterval(() => { void this.tick().catch(error => console.error('Runtime answer-policy worker failed:', error)); }, 1500); this.timer.unref(); }
  readiness() {
    if (this.paused || this.closed) return { ready: false, reason: 'Runtime answer-policy worker is paused.' };
    if (typeof this.provider.suggestRuntimePolicy !== 'function' || typeof this.provider.answerRuntimePolicy !== 'function') return { ready: false, reason: 'Provider has no bounded runtime policy methods.' };
    if (this.provider.executionMode !== 'synthetic' && !this.options.liveEnabled) return { ready: false, reason: 'Live shadow execution requires independent opt-in and explicit approval for thirteen operations.' };
    if (!this.packet || this.packet.mode !== (this.provider.executionMode ?? 'live')) return { ready: false, reason: 'A separately approved frozen validation packet with matching mode is missing.' };
    return this.provider.capacity(CALL_CEILING);
  }
  private gradeInput(job: AutomaticSupportJob): ClaimSupportInput {
    return { runId: `${job.id}:grade-original`, question: job.original.context.question, product: job.original.context.product, answer: job.original.answer,
      evidence: job.original.context.sources.map(source => ({ id: source.id, source: source.label, text: source.text, ...(source.originalQuestion !== null ? { originalQuestion: source.originalQuestion } : {}), origin: source.origin, ...(source.reference ? { reference: source.reference } : {}) })), clarifications: job.original.context.clarifications };
  }
  private failure(job: AutomaticSupportJob): { category: Category; parent: RuntimeAnswerPolicy; binding: RuntimeFailureBinding } | null {
    if (!TERMINAL_CHECKS.has(job.status) || !job.finishedAt || !job.original.runtimePolicy || !job.originalSnapshotSha256 || sha(job.original) !== job.originalSnapshotSha256 || !job.operations.length || job.operations.some(operation => operation.status !== 'completed') ||
      new Set(job.operations.map(operation => operation.phase)).size !== job.operations.length || new Set(job.operations.map(operation => operation.runId)).size !== job.operations.length || new Set(job.operations.map(operation => operation.receiptId)).size !== job.operations.length) return null;
    const snapshot = parseReviewAnswerSnapshot(job.original), parent = this.store.validateBinding(snapshot.runtimePolicy!);
    if (snapshot.contextProvenance !== 'workspace_source_snapshot' || originalAnswerVersionId(snapshot.id, snapshot.runId) !== job.originalId || parent.mode !== job.mode || parent.mode !== (this.provider.executionMode ?? 'live') || sha(snapshot.context) !== job.sourceContextSha256 || sha(snapshot.answer) !== job.originalAnswerSha256) return null;
    for (const operation of job.operations) {
      const receipt = this.provider.receipt(operation.runId);
      if (operation.runId !== `${job.id}:${operation.phase.replaceAll('_', '-')}` || !receipt || receipt.status !== 'completed' || receipt.error_code || receipt.id !== operation.receiptId || !receipt.receipt_json || JSON.parse(receipt.receipt_json).requestSha256 !== operation.requestSha256) return null;
      if (operation.phase === 'grade_repair') {
        if (!job.repaired || sha(job.repaired.answer) !== job.repaired.answerSha256 || job.repaired.sourceContextSha256 !== job.sourceContextSha256) return null;
        const assessment = replayClaimSupportReceipt({ ...this.gradeInput(job), runId: operation.runId, answer: job.repaired.answer }, receipt, job.mode).assessment;
        if (JSON.stringify(assessment) !== JSON.stringify(job.assessments.find(item => item.phase === 'repair')?.assessment)) return null;
      }
    }
    const input = this.gradeInput(job), operation = job.operations.find(item => item.phase === 'grade_original'), receipt = this.provider.receipt(input.runId), saved = job.assessments.find(item => item.phase === 'original');
    if (!operation || operation.runId !== input.runId || operation.requestSha256 !== claimSupportRequestParts(input).bindings.requestSha256 || !receipt || operation.receiptId !== receipt.id || !saved || saved.receiptId !== receipt.id) return null;
    const assessment = replayClaimSupportReceipt(input, receipt, job.mode).assessment;
    if (JSON.stringify(assessment) !== JSON.stringify(saved.assessment) || assessment.disposition === 'uncertain' || assessment.disposition === 'pass') return null;
    if (job.operations.length === 1) {
      if (job.status !== 'abstained' || job.phase !== 'grade_original' || assessment.disposition !== 'abstain' || job.assessments.length !== 1 || job.repaired) return null;
    } else {
      if (job.operations.length !== 3 || job.operations.map(operation => operation.phase).join(',') !== 'grade_original,repair,grade_repair' || assessment.disposition !== 'repair' || job.phase !== 'grade_repair' || job.assessments.length !== 2 || !job.repaired) return null;
      const final = job.assessments.find(item => item.phase === 'repair')!.assessment;
      if (job.status === 'repaired' ? final.disposition !== 'pass' : job.status !== 'abstained' || !['repair', 'abstain'].includes(final.disposition)) return null;
      const repair = this.provider.receipt(`${job.id}:repair`)!, document = JSON.parse(repair.receipt_json!), prompt = revisionPromptIdentity('baseline', false);
      const critique = JSON.stringify({ reason: assessment.reason, questionCoverage: assessment.questionCoverage, answerability: assessment.answerability, correctness: assessment.correctness, uncertaintyHandling: assessment.uncertaintyHandling,
        units: assessment.units.map(unit => ({ unitId: unit.unitId, verdict: unit.verdict, reason: unit.reason, sourceIds: unit.evidence.map(proof => proof.sourceId) })) });
      const repairRequest = { runId: `${job.id}:repair`, question: input.question, product: input.product, rejectedAnswer: snapshot.answer.answer, critique, evidence: input.evidence, clarifications: input.clarifications };
      if (sha(revisionRequestBody(repairRequest)) !== document.requestSha256 || JSON.stringify(answerSchema.parse(document.output)) !== JSON.stringify(job.repaired.answer) || document.promptVersion !== prompt.promptVersion || document.systemInstructionsSha256 !== prompt.systemInstructionsSha256 || document.model !== repair.model ||
        (job.mode === 'synthetic' ? repair.kind !== 'synthetic_automatic_revision' || document.model !== 'synthetic-fixture' || document.accounting !== 'no_provider_call' : repair.kind !== 'answer_revision_v1' || !['gpt-luna', 'gpt-5.6-luna'].includes(document.model)) ||
        job.repaired.answer.citations.some(citation => !snapshot.context.sources.some(source => source.id === citation.passageId && source.text.includes(citation.quote)))) return null;
    }
    let category: Category | null = null;
    if (assessment.correctness === 'contradicted_by_sources' || assessment.answerability === 'conflicting' || assessment.units.some(unit => unit.verdict === 'contradicted')) category = 'source_conflict';
    else if (assessment.uncertaintyHandling === 'unnecessary_abstention' || snapshot.answer.status === 'insufficient_evidence' && assessment.answerability === 'answerable') category = 'unnecessary_abstention';
    else if (assessment.units.some(unit => unit.verdict === 'unsupported') || assessment.uncertaintyHandling === 'overconfident') category = 'unsupported_claim';
    else if (assessment.questionCoverage === 'incomplete') category = 'incomplete_answer';
    if (!category) return null;
    return { category, parent, binding: { jobId: job.id, runId: snapshot.runId, answerSha256: job.originalAnswerSha256, sourceContextSha256: job.sourceContextSha256, assessmentReceiptId: receipt.id, policyId: parent.id, policySha256: parent.instructionSha256 } };
  }
  /** Explicit ingestion only. Historical unbound answers and uncertain transport
   * outcomes cannot become semantic improvement signals. */
  observeCompleted(jobs: AutomaticSupportJob[]) {
    if (this.paused || this.closed) return { observed: 0, eligible: 0 };
    let observed = 0, eligible = 0;
    for (const job of jobs) {
      let failure: ReturnType<AnswerPolicyWorker['failure']>;
      try { failure = this.failure(job); } catch { continue; }
      if (!failure) continue;
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const prior = this.db.prepare("SELECT binding FROM runtime_policy_observed_checks WHERE job_id=? OR run_id=? OR json_extract(binding,'$.assessmentReceiptId')=?").get(job.id, job.original.runId, failure.binding.assessmentReceiptId) as { binding: string } | undefined;
        if (prior) { this.db.exec('COMMIT'); continue; }
        const row = this.db.prepare("SELECT document,document_sha256 FROM runtime_policy_failure_groups WHERE status='collecting' AND mode=? AND parent_id=? AND category=? ORDER BY rowid LIMIT 1").get(job.mode, failure.parent.id, failure.category) as StoredGroup | undefined;
        let group: AnswerPolicyGroup;
        if (row) group = this.readStoredGroup(row);
        else {
          const count = this.db.prepare('SELECT count(*) AS count FROM runtime_policy_failure_groups').get() as { count: number };
          if (count.count >= MAX_GROUPS) { this.db.exec('COMMIT'); continue; }
          group = { id: randomUUID(), mode: job.mode, category: failure.category, parent: failure.parent, bindings: [], groupSha256: '', status: 'collecting', phase: 0, callCeiling: CALL_CEILING,
            packet: this.packet && this.packet.mode === job.mode ? structuredClone(this.packet) : null, packetSha256: this.packet && this.packet.mode === job.mode ? sha(this.packet) : '', graderSha256: claimSupportPromptIdentity().systemInstructionsSha256,
            operations: [], results: [], createdAt: new Date().toISOString() };
          const document = JSON.stringify(group);
          this.db.prepare('INSERT INTO runtime_policy_failure_groups(id,status,mode,parent_id,category,document,document_sha256) VALUES(?,?,?,?,?,?,?)').run(group.id, group.status, group.mode, group.parent.id, group.category, document, sha(document));
        }
        if (group.bindings.length >= 5) { this.db.exec('COMMIT'); continue; }
        group.bindings.push(failure.binding); group.groupSha256 = sha({ parent: group.parent, category: group.category, bindings: group.bindings });
        this.db.prepare('INSERT INTO runtime_policy_observed_checks(job_id,run_id,binding) VALUES(?,?,?)').run(job.id, job.original.runId, JSON.stringify(failure.binding)); observed++;
        if (group.bindings.length >= 3) { group.status = 'queued'; eligible++; }
        this.save(group); this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    return { observed, eligible };
  }
  private readStoredGroup(row: StoredGroup): AnswerPolicyGroup {
    if (!row.document_sha256 || sha(row.document) !== row.document_sha256) throw new Error('Runtime policy group evidence has no matching stored hash; reconciliation is required.');
    return JSON.parse(row.document) as AnswerPolicyGroup;
  }
  get(id: string): AnswerPolicyGroup | null { const row = this.db.prepare('SELECT document,document_sha256 FROM runtime_policy_failure_groups WHERE id=?').get(id) as StoredGroup | undefined; return row ? this.readStoredGroup(row) : null; }
  overview() { return { groups: (this.db.prepare('SELECT document,document_sha256 FROM runtime_policy_failure_groups ORDER BY rowid DESC').all() as StoredGroup[]).map(row => this.readStoredGroup(row)), callCeiling: CALL_CEILING, maxGroups: MAX_GROUPS, minimumFailures: 3, qualityClaimEligible: false as const }; }
  exportEvidence() {
    const mode = this.provider.executionMode ?? 'live';
    const overview = this.overview(), groups = overview.groups.filter(group => group.mode === mode);
    const checks = this.options.completedJobs?.() ?? [];
    const originalChecks = groups.flatMap(group => group.bindings.map(binding => {
      const job = checks.find(item => item.id === binding.jobId && item.mode === mode);
      let failure: ReturnType<AnswerPolicyWorker['failure']> = null;
      try { if (job) failure = this.failure(job); } catch { /* Unverifiable supporting records cannot enter an evidence bundle. */ }
      if (!job || !failure || failure.category !== group.category || JSON.stringify(failure.binding) !== JSON.stringify(binding)) throw new Error('Runtime policy export: An originating automatic check no longer matches its consumed failure binding.');
      return job;
    }));
    const phaseReceipts = groups.flatMap(group => {
      try { if (group.operations.some(operation => operation.status === 'completed')) this.validate(group); }
      catch { throw new Error('Runtime policy export: A completed phase no longer matches its frozen request and saved result.'); }
      return group.operations.map(operation => {
        let receipt = this.provider.receipt(operation.runId) ?? null;
        if (operation.status === 'completed') {
          try { receipt = this.replayCompletedOperation(group, operation); }
          catch { throw new Error('Runtime policy export: A completed phase no longer matches its frozen request and saved result.'); }
        }
        return { groupId: group.id, runId: operation.runId, requestSha256: operation.requestSha256, verification: operation.status === 'completed' ? 'replayed_completed_phase' as const : 'unaccepted_diagnostic' as const, receipt };
      });
    });
    return { ...overview, groups, originalChecks, phaseReceipts };
  }
  hasActive() { return this.busy; }
  private save(group: AnswerPolicyGroup, lease: number | null = null) { const document = JSON.stringify(group); this.db.prepare('UPDATE runtime_policy_failure_groups SET status=?,document=?,document_sha256=?,lease_expires=? WHERE id=?').run(group.status, document, sha(document), lease, group.id); }
  private runId(group: AnswerPolicyGroup) { return `runtime-policy:${group.id}:${group.phase}`; }
  private snapshot(policy: RuntimeAnswerPolicy) { return { ...this.binding(policy), instructions: policy.instructions }; }
  private proposalInput(group: AnswerPolicyGroup): RuntimeProposalInput { return { runId: this.runId(group), parent: this.snapshot(group.parent), groupId: group.id, groupSha256: group.groupSha256, failure: { category: group.category, bindings: group.bindings } }; }
  private phaseParts(group: AnswerPolicyGroup) {
    const offset = group.phase - 1, caseIndex = Math.floor(offset / 4), step = offset % 4;
    if (!group.packet || !group.candidate || !group.packet.cases[caseIndex]) throw new Error('Paired evaluation has no frozen packet or candidate.');
    const item = group.packet.cases[caseIndex], side = step < 2 ? 'baseline' as const : 'candidate' as const;
    return { caseIndex, step, item, side, policy: side === 'baseline' ? group.parent : group.candidate };
  }
  private answerInput(group: AnswerPolicyGroup): RuntimeAnswerInput { const part = this.phaseParts(group); return { runId: this.runId(group), question: part.item.question, product: part.item.product, evidence: part.item.evidence, clarifications: [], policy: this.snapshot(part.policy), validationPacketSha256: group.packetSha256, caseId: part.item.id }; }
  private checkInput(group: AnswerPolicyGroup): ClaimSupportInput { const part = this.phaseParts(group), result = group.results[part.caseIndex]?.[part.side]; if (!result) throw new Error('A frozen paired answer is missing.'); return { runId: this.runId(group), question: part.item.question, product: part.item.product, evidence: part.item.evidence, clarifications: [], answer: result.answer }; }
  private requestHash(group: AnswerPolicyGroup) { return group.phase === 0 ? runtimeProposalRequestParts(this.proposalInput(group)).bindings.requestSha256 : this.phaseParts(group).step % 2 === 0 ? runtimeAnswerRequestParts(this.answerInput(group)).bindings.requestSha256 : claimSupportRequestParts(this.checkInput(group)).bindings.requestSha256; }
  private validate(group: AnswerPolicyGroup) {
    const parent = this.store.validateBinding(group.parent);
    if (parent.instructions !== group.parent.instructions || group.mode !== parent.mode || group.groupSha256 !== sha({ parent: group.parent, category: group.category, bindings: group.bindings }) || group.bindings.length < 3 || group.bindings.length > 5 || new Set(group.bindings.map(item => item.runId)).size !== group.bindings.length ||
      group.packetSha256 !== sha(group.packet) || !group.packet || group.packet.mode !== group.mode || group.graderSha256 !== claimSupportPromptIdentity().systemInstructionsSha256 || group.callCeiling !== 13) throw new Error('Runtime trial immutable bindings are invalid.');
    packetCopy(group.packet);
    if (group.candidate && this.store.validateBinding(group.candidate).instructions !== group.candidate.instructions) throw new Error('Runtime candidate identity changed.');
  }
  private summarize(group: AnswerPolicyGroup) {
    const baseline = metrics(), candidate = metrics();
    for (const [index, item] of (group.packet?.cases ?? []).entries()) {
      const results = group.results[index]; let baselineSuccess = false;
      for (const side of ['baseline', 'candidate'] as const) {
        const output = results?.[side], metric = side === 'baseline' ? baseline : candidate, grade = output?.assessment;
        if (!output || !grade) { metric.uncertainAssessments++; continue; }
        const facts = item.requiredFacts.every(fact => output.answer.answer.includes(fact.answerIncludes) && output.answer.citations.some(citation => citation.passageId === fact.sourceId && citation.quote.includes(fact.quote)));
        const complete = grade.questionCoverage === 'complete' && facts;
        const supported = grade.disposition === 'pass' && output.answer.status === 'answered' && complete && item.expectedStatus === 'answered';
        const correctAbstention = complete && item.expectedStatus === 'insufficient_evidence' && output.answer.status === 'insufficient_evidence' && grade.answerability === 'insufficient' && grade.correctness === 'consistent_with_sources' && grade.uncertaintyHandling === 'appropriate' && !grade.units.some(unit => ['unsupported', 'contradicted', 'uncertain'].includes(unit.verdict));
        if (supported) metric.usefulSupportedAnswers++;
        if (complete && (supported || correctAbstention)) metric.completeAnswers++;
        metric.unsupportedClaims += grade.units.filter(unit => ['unsupported', 'contradicted'].includes(unit.verdict)).length;
        if (output.answer.status === 'insufficient_evidence' && item.expectedStatus === 'answered' || grade.uncertaintyHandling === 'unnecessary_abstention') metric.unnecessaryAbstentions++;
        if (grade.disposition === 'uncertain') metric.uncertainAssessments++;
        const success = supported || correctAbstention;
        if (side === 'baseline') baselineSuccess = success;
        else if (baselineSuccess && !success || item.role === 'correct_control' && !success || item.role === 'unanswerable_control' && !success) candidate.regressions++;
      }
    }
    for (const operation of group.operations) {
      if (operation.phase === 0) continue;
      const metric = (operation.phase - 1) % 4 < 2 ? baseline : candidate;
      metric.latencyMs += operation.latencyMs ?? 0;
      if (group.mode === 'live') metric.planningAllowanceUsd = (metric.planningAllowanceUsd ?? 0) + (operation.planningAllowanceUsd ?? 0);
    }
    return { baseline, candidate };
  }
  private finish(group: AnswerPolicyGroup, status: 'completed' | 'failed' | 'reconciliation', error?: string) {
    group.status = status; group.finishedAt = new Date().toISOString(); if (error) group.error = error;
    const operation = group.operations.find(item => item.phase === group.phase);
    if (operation?.status === 'started') { operation.status = 'unknown'; operation.finishedAt = group.finishedAt; }
    const { baseline, candidate } = this.summarize(group), complete = status === 'completed' && group.operations.length === 13 && group.operations.every(item => item.status === 'completed') && group.results.length === 3 && group.results.every(item => item.baseline?.assessment && item.candidate?.assessment);
    const gain = complete && candidate.usefulSupportedAnswers > baseline.usefulSupportedAnswers && candidate.unsupportedClaims <= baseline.unsupportedClaims && candidate.unnecessaryAbstentions <= baseline.unnecessaryAbstentions && candidate.completeAnswers >= baseline.completeAnswers && !candidate.regressions && !candidate.uncertainAssessments && !baseline.uncertainAssessments;
    const stale = this.store.capture(group.mode).id !== group.parent.id;
    const reasons = error ? [error] : !complete ? ['Evaluation is incomplete.'] : stale ? ['Captured parent is stale.'] : !gain ? ['Paired packet shows no eligible supported-usefulness gain without regression.'] : group.mode === 'live' ? ['Uncalibrated AI shadow only: qualified live activation gate is missing.'] : ['Scripted fictional fixture release only; no measured model quality gain.'];
    const decision: RuntimeTrialDecision = { id: `runtime-trial-${group.id}`, groupId: group.id, mode: group.mode, parent: this.binding(group.parent), candidate: group.candidate ? this.binding(group.candidate) : null,
      kind: group.mode === 'synthetic' ? 'synthetic_scripted_trial' : 'automated_shadow_trial', verdict: !complete ? 'inconclusive' : stale || !gain ? 'rejected' : group.mode === 'synthetic' ? 'eligible_synthetic_trial' : 'shadow_candidate',
      qualityClaimEligible: false, calibration: 'not_measured', gate: group.mode === 'synthetic' ? 'synthetic_fixture_only' : 'unqualified_ai', complete, callCeiling: 13, packetSha256: group.packetSha256, graderSha256: group.graderSha256, validationPacket: structuredClone(group.packet),
      operations: structuredClone(group.operations), baseline, candidateMetrics: candidate, caseResults: structuredClone(group.results), reasons, createdAt: group.finishedAt };
    group.decision = decision; group.decisionId = decision.id; this.save(group);
  }
  private syncDecisions() {
    // The store may share this SQLite file through another connection. Record
    // evidence only after our lease transaction commits, and recover this
    // publication step from the immutable decision saved with the group.
    const rows = this.db.prepare("SELECT document,document_sha256 FROM runtime_policy_failure_groups WHERE status IN ('completed','failed','reconciliation')").all() as StoredGroup[];
    for (const row of rows) { const group = this.readStoredGroup(row); if (group.decision) this.store.recordDecision(group.decision); }
  }
  private binding(policy: RuntimeAnswerPolicy): RuntimePolicyBinding { return { id: policy.id, instructionSha256: policy.instructionSha256, mode: policy.mode }; }
  private consume(group: AnswerPolicyGroup, receipt: AnswerRevisionReceipt) {
    // Another worker may have expired this lease while a slow transport was
    // still returning. A consumed uncertain outcome stays terminal forever.
    const persisted = this.get(group.id);
    if (!persisted || persisted.phase !== group.phase || ['completed', 'failed', 'reconciliation'].includes(persisted.status) || persisted.operations.find(item => item.phase === group.phase)?.status !== 'started') return;
    const operation = group.operations.find(item => item.phase === group.phase);
    try { this.validate(group); if (!operation || operation.runId !== this.runId(group) || operation.requestSha256 !== this.requestHash(group)) throw new Error('Operation identity mismatch.'); }
    catch { this.finish(group, 'failed', 'Saved trial operation or frozen input has inconsistent bindings.'); return; }
    operation.receiptId = receipt.id; operation.finishedAt = new Date().toISOString(); operation.latencyMs = Math.max(0, Date.parse(operation.finishedAt) - Date.parse(operation.startedAt));
    operation.planningAllowanceUsd = group.mode === 'synthetic' ? null : receipt.allowance_usd; operation.accounting = group.mode === 'synthetic' ? 'no_provider_call' : 'planning_allowance';
    operation.usage = receipt.input_tokens !== null && receipt.output_tokens !== null ? { inputTokens: receipt.input_tokens, outputTokens: receipt.output_tokens } : null;
    if (receipt.status !== 'completed') { operation.status = 'unknown'; this.finish(group, 'reconciliation', 'Unknown provider outcome is consumed permanently without redispatch.'); return; }
    try {
      if (group.phase === 0) {
        const proposal = replayRuntimeProposalReceipt(this.proposalInput(group), receipt, group.mode);
        group.candidate = this.store.createCandidate(this.binding(group.parent), proposal.instructions, group.id);
      } else {
        const part = this.phaseParts(group);
        if (part.step % 2 === 0) {
          const answer = replayRuntimeAnswerReceipt(this.answerInput(group), receipt, group.mode).answer;
          group.results[part.caseIndex] ??= { caseId: part.item.id }; group.results[part.caseIndex][part.side] = { answer };
        } else group.results[part.caseIndex][part.side]!.assessment = replayClaimSupportReceipt(this.checkInput(group), receipt, group.mode).assessment;
      }
      operation.status = 'completed';
      if (group.phase === 12) this.finish(group, 'completed');
      else { group.phase++; group.status = 'queued'; this.save(group); }
    } catch { operation.status = 'invalid'; this.finish(group, 'failed', 'Recorded trial output failed its frozen request, provenance, citation or grading contract.'); }
  }
  private reconcile() {
    const rows = this.db.prepare("SELECT document,document_sha256 FROM runtime_policy_failure_groups WHERE status='running' AND (lease_expires IS NULL OR lease_expires<?)").all(Date.now()) as StoredGroup[];
    for (const row of rows) { const group = this.readStoredGroup(row), receipt = this.provider.receipt(this.runId(group)); if (receipt) this.consume(group, receipt); else this.finish(group, 'reconciliation', 'Started operation has no durable receipt; it will not be retried.'); }
  }
  tick(): Promise<void> {
    if (this.paused || this.closed) return Promise.resolve(); if (this.inFlight) return this.inFlight;
    const pending = this.runTick().finally(() => { if (this.inFlight === pending) this.inFlight = null; }); this.inFlight = pending; return pending;
  }
  private async runTick() {
    if (this.busy) return; this.busy = true;
    try {
      this.reconcile(); if (this.options.completedJobs) this.observeCompleted(this.options.completedJobs());
      if (this.options.canDispatch && !this.options.canDispatch()) return;
      this.db.exec('BEGIN IMMEDIATE'); let group: AnswerPolicyGroup;
      try {
        const row = this.db.prepare("SELECT document,document_sha256 FROM runtime_policy_failure_groups WHERE status='queued' ORDER BY rowid LIMIT 1").get() as StoredGroup | undefined;
        if (!row) { this.db.exec('COMMIT'); return; } group = this.readStoredGroup(row);
        if (group.mode !== (this.provider.executionMode ?? 'live')) { this.finish(group, 'failed', 'Saved trial provenance differs from this provider.'); this.db.exec('COMMIT'); return; }
        const receipt = this.provider.receipt(this.runId(group)); if (receipt) { this.db.exec('COMMIT'); this.consume(group, receipt); return; }
        if (group.operations.some(item => item.phase === group.phase)) { this.finish(group, 'reconciliation', 'Started trial phase cannot be dispatched twice.'); this.db.exec('COMMIT'); return; }
        if (group.mode === 'live' && !this.options.liveEnabled || !group.packet) { this.db.exec('COMMIT'); return; }
        if (this.store.capture(group.mode).id !== group.parent.id) { this.finish(group, 'failed', 'Captured parent is stale; remaining evaluation phases are closed.'); this.db.exec('COMMIT'); return; }
        if (typeof this.provider.suggestRuntimePolicy !== 'function' || typeof this.provider.answerRuntimePolicy !== 'function') { this.finish(group, 'failed', 'Provider methods for bounded trials are unavailable.'); this.db.exec('COMMIT'); return; }
        const capacity = this.provider.capacity(CALL_CEILING - group.phase);
        if (!capacity.ready) { this.finish(group, 'failed', `Remaining finite planning ceiling is unavailable: ${capacity.reason}`); this.db.exec('COMMIT'); return; }
        let requestSha256: string;
        try { this.validate(group); requestSha256 = this.requestHash(group); }
        catch { this.finish(group, 'failed', 'Frozen trial packet or request identity is invalid before dispatch.'); this.db.exec('COMMIT'); return; }
        group.operations.push({ phase: group.phase, runId: this.runId(group), requestSha256, status: 'started', startedAt: new Date().toISOString() }); group.status = 'running'; this.save(group, Date.now() + 120_000); this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      try { if (group.phase === 0) await this.provider.suggestRuntimePolicy(this.proposalInput(group)); else if (this.phaseParts(group).step % 2 === 0) await this.provider.answerRuntimePolicy(this.answerInput(group)); else await this.provider.gradeClaimSupport(this.checkInput(group)); }
      catch { /* Only a durable matching receipt can authorize phase advancement. */ }
      const receipt = this.provider.receipt(this.runId(group));
      if (receipt) this.consume(group, receipt);
      else { const persisted = this.get(group.id); if (persisted?.status === 'running' && persisted.phase === group.phase) this.finish(persisted, 'reconciliation', 'Started operation has no durable receipt; it will not be retried.'); }
    } finally { this.busy = false; this.syncDecisions(); }
  }
  activateTrial(id: string) {
    const group = this.get(id) ?? this.overview().groups.find(item => item.decisionId === id);
    if (!group?.decisionId || group.status !== 'completed' || !group.decision || !group.candidate) throw new Error('A complete persisted trial decision is required.');
    if (group.mode !== (this.provider.executionMode ?? 'live')) throw new Error('Runtime trial activation mode differs from the configured provider.');
    this.validate(group);
    if (this.store.capture(group.mode).id !== group.parent.id) throw new Error('Runtime activation has a stale parent.');
    if (group.operations.length !== CALL_CEILING || new Set(group.operations.map(operation => operation.phase)).size !== CALL_CEILING || new Set(group.operations.map(operation => operation.receiptId)).size !== CALL_CEILING) throw new Error('Trial operation evidence is incomplete or duplicated.');
    for (let phase = 0; phase < CALL_CEILING; phase++) {
      const operation = group.operations.find(item => item.phase === phase);
      if (!operation) throw new Error('Trial activation has missing or mismatched durable receipts.');
      this.replayCompletedOperation(group, operation);
    }
    const totals = this.summarize(group), persisted = this.store.getDecision(group.decisionId);
    if (!persisted || JSON.stringify(persisted) !== JSON.stringify(group.decision) || JSON.stringify(totals.baseline) !== JSON.stringify(persisted.baseline) || JSON.stringify(totals.candidate) !== JSON.stringify(persisted.candidateMetrics) || JSON.stringify(group.results) !== JSON.stringify(persisted.caseResults)) throw new Error('Trial decision differs from its exact replayed evidence.');
    return this.store.activateTrial(group.mode, group.parent.id, group.decisionId);
  }
  /** Pure receipt verification shared by activation and evidence export. */
  private replayCompletedOperation(group: AnswerPolicyGroup, operation: RuntimeTrialOperation): AnswerRevisionReceipt {
    const replayGroup = { ...group, phase: operation.phase }, receipt = this.provider.receipt(this.runId(replayGroup));
    if (operation.status !== 'completed' || operation.runId !== this.runId(replayGroup) || operation.requestSha256 !== this.requestHash(replayGroup) || !receipt || operation.receiptId !== receipt.id) throw new Error('Trial activation has missing or mismatched durable receipts.');
    if (operation.phase === 0) {
      const proposal = replayRuntimeProposalReceipt(this.proposalInput(replayGroup), receipt, group.mode);
      if (group.candidate?.instructions !== `${group.parent.instructions}\n\nRuntime answer-policy addition:\n${proposal.instructions.trim()}`) throw new Error('Trial candidate differs from its bound proposal.');
    } else {
      const part = this.phaseParts(replayGroup), result = group.results[part.caseIndex]?.[part.side];
      if (part.step % 2 === 0) { if (JSON.stringify(replayRuntimeAnswerReceipt(this.answerInput(replayGroup), receipt, group.mode).answer) !== JSON.stringify(result?.answer)) throw new Error('Frozen trial answer differs from its receipt.'); }
      else if (JSON.stringify(replayClaimSupportReceipt(this.checkInput(replayGroup), receipt, group.mode).assessment) !== JSON.stringify(result?.assessment)) throw new Error('Frozen trial assessment differs from its receipt.');
    }
    return receipt;
  }
  async pauseAndDrain() { this.paused = true; if (this.timer) { clearInterval(this.timer); this.timer = null; } await this.inFlight; }
  close() { this.paused = true; if (this.timer) { clearInterval(this.timer); this.timer = null; } if (this.busy) throw new Error('Runtime policy: await pauseAndDrain before closing an active worker.'); if (!this.closed) { this.closed = true; this.db.close(); } }
}
