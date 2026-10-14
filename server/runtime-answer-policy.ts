import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type RuntimePolicyMode = 'live' | 'synthetic';
export type RuntimePolicyBinding = { id: string; instructionSha256: string; mode: RuntimePolicyMode };
export type RuntimeAnswerPolicy = RuntimePolicyBinding & {
  instructions: string; parentId: string | null; createdAt: string; status: 'baseline' | 'candidate';
  provenance: 'workspace_baseline' | 'automated_instruction_proposal' | 'synthetic_instruction_proposal'; groupId: string | null;
};
export const RUNTIME_BASELINE_INSTRUCTIONS = 'Answer the product question using only the supplied product evidence. State supported facts directly, attribute claims to their source, and qualify missing or conflicting details. Never invent a specification. Cite an exact supporting quote for each material claim.';
export const runtimePolicyHash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function runtimeBaselinePolicy(mode: RuntimePolicyMode): RuntimeAnswerPolicy {
  return { id: mode === 'live' ? 'workspace-baseline-v2-context' : 'workspace-baseline-v2-context-synthetic', instructions: RUNTIME_BASELINE_INSTRUCTIONS,
    instructionSha256: runtimePolicyHash(RUNTIME_BASELINE_INSTRUCTIONS), mode, parentId: null, createdAt: '2026-09-29T00:00:00.000Z', status: 'baseline', provenance: 'workspace_baseline', groupId: null };
}
export type RuntimeTrialOperation = { phase: number; runId: string; requestSha256: string; status: 'started' | 'completed' | 'invalid' | 'unknown'; startedAt: string; finishedAt?: string; receiptId?: string;
  latencyMs?: number; planningAllowanceUsd?: number | null; accounting?: 'planning_allowance' | 'no_provider_call'; usage?: { inputTokens: number; outputTokens: number } | null };
export type RuntimeTrialMetrics = { usefulSupportedAnswers: number; unsupportedClaims: number; unnecessaryAbstentions: number; completeAnswers: number; regressions: number; uncertainAssessments: number; latencyMs: number; planningAllowanceUsd: number | null };
export type RuntimeTrialDecision = {
  id: string; groupId: string; mode: RuntimePolicyMode; parent: RuntimePolicyBinding; candidate: RuntimePolicyBinding | null;
  kind: 'automated_shadow_trial' | 'synthetic_scripted_trial'; verdict: 'eligible_synthetic_trial' | 'shadow_candidate' | 'rejected' | 'inconclusive';
  qualityClaimEligible: false; calibration: 'not_measured'; gate: 'unqualified_ai' | 'synthetic_fixture_only'; complete: boolean;
  callCeiling: 13; packetSha256: string; graderSha256: string; validationPacket: unknown; operations: RuntimeTrialOperation[];
  baseline: RuntimeTrialMetrics; candidateMetrics: RuntimeTrialMetrics; caseResults: unknown[]; reasons: string[]; createdAt: string;
};
type PolicyEvent = { id: string; mode: RuntimePolicyMode; action: 'synthetic_trial_activation' | 'rollback'; fromId: string; toId: string; decisionId: string | null; createdAt: string };

/** Runtime trials have their own versions, pointers and evidence. They never
 * write the historical human-reviewed laboratory promotion tables. */
export class RuntimeAnswerPolicyStore {
  private readonly db: DatabaseSync;
  constructor(dbPath = '.data/runtime-answer-policy.sqlite') {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS runtime_answer_policies(id TEXT PRIMARY KEY,mode TEXT NOT NULL,document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runtime_answer_policy_active(mode TEXT PRIMARY KEY,policy_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runtime_answer_policy_decisions(id TEXT PRIMARY KEY,mode TEXT NOT NULL,document TEXT NOT NULL,sha256 TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runtime_answer_policy_events(id TEXT PRIMARY KEY,mode TEXT NOT NULL,document TEXT NOT NULL);`);
    for (const mode of ['live', 'synthetic'] as const) {
      const baseline = runtimeBaselinePolicy(mode);
      this.db.prepare('INSERT OR IGNORE INTO runtime_answer_policies(id,mode,document) VALUES(?,?,?)').run(baseline.id, mode, JSON.stringify(baseline));
      this.db.prepare('INSERT OR IGNORE INTO runtime_answer_policy_active(mode,policy_id) VALUES(?,?)').run(mode, baseline.id);
    }
  }
  get(id: string): RuntimeAnswerPolicy | null {
    const row = this.db.prepare('SELECT document FROM runtime_answer_policies WHERE id=?').get(id) as { document: string } | undefined;
    if (!row) return null;
    const policy = JSON.parse(row.document) as RuntimeAnswerPolicy;
    if (policy.id !== id || runtimePolicyHash(policy.instructions) !== policy.instructionSha256 || !['live', 'synthetic'].includes(policy.mode)) throw new Error('Runtime policy has an invalid immutable identity.');
    return policy;
  }
  capture(mode: RuntimePolicyMode): RuntimeAnswerPolicy {
    const row = this.db.prepare('SELECT policy_id FROM runtime_answer_policy_active WHERE mode=?').get(mode) as { policy_id: string } | undefined;
    const policy = row && this.get(row.policy_id);
    if (!policy || policy.mode !== mode) throw new Error('Runtime active policy has inconsistent mode provenance.');
    return policy;
  }
  validateBinding(binding: RuntimePolicyBinding): RuntimeAnswerPolicy {
    const policy = this.get(binding.id);
    if (!policy || policy.mode !== binding.mode || policy.instructionSha256 !== binding.instructionSha256) throw new Error('Runtime policy binding does not match its immutable version.');
    return policy;
  }
  createCandidate(parent: RuntimePolicyBinding, addition: string, groupId: string): RuntimeAnswerPolicy {
    const original = this.validateBinding(parent);
    if (!addition.trim() || addition.length > 1500 || !groupId.trim() || groupId.length > 200) throw new Error('Runtime instruction addition exceeds its bounded contract.');
    const instructions = `${original.instructions}\n\nRuntime answer-policy addition:\n${addition.trim()}`;
    if (instructions.length > 10_000) throw new Error('Runtime policy lineage exceeds its finite instruction bound.');
    const id = `runtime-policy-${runtimePolicyHash([parent, groupId]).slice(0, 32)}`;
    const prior = this.get(id);
    if (prior) { if (prior.instructions !== instructions || prior.parentId !== original.id) throw new Error('A consumed group already has a different immutable candidate.'); return prior; }
    const candidate: RuntimeAnswerPolicy = { id, mode: original.mode, instructions, instructionSha256: runtimePolicyHash(instructions), parentId: original.id,
      createdAt: new Date().toISOString(), status: 'candidate', provenance: original.mode === 'synthetic' ? 'synthetic_instruction_proposal' : 'automated_instruction_proposal', groupId };
    this.db.prepare('INSERT INTO runtime_answer_policies(id,mode,document) VALUES(?,?,?)').run(id, candidate.mode, JSON.stringify(candidate));
    return candidate;
  }
  recordDecision(decision: RuntimeTrialDecision) {
    this.validateBinding(decision.parent);
    if (decision.candidate) this.validateBinding(decision.candidate);
    const packet = decision.validationPacket as { mode?: unknown; provenance?: unknown } | null;
    if (decision.mode !== decision.parent.mode || decision.candidate && decision.mode !== decision.candidate.mode || decision.qualityClaimEligible !== false || decision.calibration !== 'not_measured' || decision.callCeiling !== 13 ||
      decision.complete && (!packet || packet.mode !== decision.mode || decision.packetSha256 !== runtimePolicyHash(packet)) ||
      (decision.mode === 'synthetic' ? decision.kind !== 'synthetic_scripted_trial' || decision.gate !== 'synthetic_fixture_only' || decision.complete && packet?.provenance !== 'synthetic_fictional_fixture' : decision.kind !== 'automated_shadow_trial' || decision.gate !== 'unqualified_ai' || decision.verdict === 'eligible_synthetic_trial' || decision.complete && packet?.provenance !== 'fresh_product_disjoint_validation')) throw new Error('Trial decision provenance is invalid.');
    const prior = this.getDecision(decision.id);
    if (prior) { if (JSON.stringify(prior) !== JSON.stringify(decision)) throw new Error('Trial decisions are immutable.'); return; }
    const document = JSON.stringify(decision);
    this.db.prepare('INSERT INTO runtime_answer_policy_decisions(id,mode,document,sha256) VALUES(?,?,?,?)').run(decision.id, decision.mode, document, runtimePolicyHash(document));
  }
  getDecision(id: string): RuntimeTrialDecision | null {
    const row = this.db.prepare('SELECT document,sha256 FROM runtime_answer_policy_decisions WHERE id=?').get(id) as { document: string; sha256: string } | undefined;
    if (!row) return null;
    if (runtimePolicyHash(row.document) !== row.sha256) throw new Error('Trial evidence no longer matches its immutable hash.');
    return JSON.parse(row.document) as RuntimeTrialDecision;
  }
  private move(mode: RuntimePolicyMode, expectedActiveId: string, target: RuntimeAnswerPolicy, action: PolicyEvent['action'], decisionId: string | null) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.capture(mode);
      if (current.id !== expectedActiveId || target.mode !== mode) throw new Error('Runtime activation has a stale parent or mismatched mode.');
      const event: PolicyEvent = { id: randomUUID(), mode, action, fromId: current.id, toId: target.id, decisionId, createdAt: new Date().toISOString() };
      this.db.prepare('UPDATE runtime_answer_policy_active SET policy_id=? WHERE mode=? AND policy_id=?').run(target.id, mode, expectedActiveId);
      this.db.prepare('INSERT INTO runtime_answer_policy_events(id,mode,document) VALUES(?,?,?)').run(event.id, mode, JSON.stringify(event));
      this.db.exec('COMMIT'); return target;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  activateTrial(mode: RuntimePolicyMode, expectedActiveId: string, decisionId: string) {
    const decision = this.getDecision(decisionId);
    if (!decision || decision.mode !== mode || decision.parent.mode !== mode || !decision.candidate || decision.candidate.mode !== mode) throw new Error('Trial activation requires matching persisted decision and policy modes.');
    if (mode === 'live') throw new Error('Live trial activation is closed: separately qualified calibration and fresh evaluation gate are missing (calibration=not_measured).');
    const candidate = this.validateBinding(decision.candidate);
    if (candidate.parentId !== expectedActiveId || decision.parent.id !== expectedActiveId || !decision.complete || decision.verdict !== 'eligible_synthetic_trial' || decision.gate !== 'synthetic_fixture_only' || decision.kind !== 'synthetic_scripted_trial' ||
      decision.packetSha256 !== runtimePolicyHash(decision.validationPacket) || decision.operations.length !== 13 || new Set(decision.operations.map(operation => operation.phase)).size !== 13 || new Set(decision.operations.map(operation => operation.receiptId)).size !== 13 ||
      decision.operations.some(operation => operation.status !== 'completed' || !operation.receiptId || operation.phase < 0 || operation.phase > 12 || !Number.isInteger(operation.phase) || operation.runId !== `runtime-policy:${decision.groupId}:${operation.phase}` || !/^[a-f0-9]{64}$/.test(operation.requestSha256)) ||
      Object.values(decision.baseline).concat(Object.values(decision.candidateMetrics)).some(value => value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) || decision.candidateMetrics.regressions || decision.candidateMetrics.uncertainAssessments || decision.baseline.uncertainAssessments ||
      decision.candidateMetrics.usefulSupportedAnswers <= decision.baseline.usefulSupportedAnswers || decision.candidateMetrics.unnecessaryAbstentions > decision.baseline.unnecessaryAbstentions || decision.candidateMetrics.unsupportedClaims > decision.baseline.unsupportedClaims || decision.candidateMetrics.completeAnswers < decision.baseline.completeAnswers) throw new Error('Synthetic trial lacks complete, eligible, independently checked evidence.');
    return this.move(mode, expectedActiveId, candidate, 'synthetic_trial_activation', decision.id);
  }
  rollback(mode: RuntimePolicyMode, expectedActiveId: string) {
    const active = this.capture(mode);
    if (active.id !== expectedActiveId || !active.parentId) throw new Error('Rollback requires the current candidate version.');
    const parent = this.get(active.parentId);
    if (!parent || parent.mode !== mode) throw new Error('Rollback parent mode is invalid.');
    return this.move(mode, expectedActiveId, parent, 'rollback', null);
  }
  overview(mode: RuntimePolicyMode) {
    const documents = (table: string) => (this.db.prepare(`SELECT document FROM ${table} WHERE mode=? ORDER BY rowid DESC`).all(mode) as { document: string }[]).map(row => JSON.parse(row.document));
    return { active: this.capture(mode), versions: documents('runtime_answer_policies') as RuntimeAnswerPolicy[], decisions: documents('runtime_answer_policy_decisions') as RuntimeTrialDecision[], events: documents('runtime_answer_policy_events') as PolicyEvent[], liveActivation: 'closed_missing_qualified_calibration' as const, qualityClaimEligible: false as const };
  }
  close() { this.db.close(); }
}
