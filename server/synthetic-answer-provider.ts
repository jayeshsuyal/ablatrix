import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { answerSchema, revisionRequestBody, type RevisionInput } from './feedback-provider.ts';
import { revisionPromptIdentity } from './revision-policy.ts';
import type { AnswerRevisionProvider, AnswerRevisionReceipt } from './answer-revisions.ts';
import type { LoopAnswer, LoopProvider } from './loop-types.ts';
import { CLAIM_SUPPORT_TOOL, claimSupportRequestParts, validateClaimSupportOutput, replayClaimSupportReceipt, type ClaimSupportInput, type ClaimSupportWireOutput } from './claim-support.ts';
import { RUNTIME_POLICY_PROPOSAL_TOOL, RUNTIME_POLICY_ANSWER_TOOL, runtimeProposalRequestParts, runtimeAnswerRequestParts, validateRuntimeProposalOutput, validateRuntimeAnswerOutput, replayRuntimeProposalReceipt, replayRuntimeAnswerReceipt, type RuntimeProposalInput, type RuntimeAnswerInput } from './answer-policy-protocol.ts';

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
  async suggestRuntimePolicy(input: RuntimeProposalInput) {
    if (this.closed) throw new Error('Synthetic provider is closed.');
    const parts = runtimeProposalRequestParts(input);
    if (parts.normalized.parent.mode !== this.executionMode) throw new Error('Runtime policy proposal mode does not match this provider.');
    const previous = this.receipt(parts.normalized.runId);
    if (previous) return replayRuntimeProposalReceipt(parts.normalized, previous, this.executionMode);
    const output = validateRuntimeProposalOutput({ instructions: 'Check every material claim against applicable source text. Preserve exact model relationships, units, and source attribution. Cover every requested supported fact, and abstain only when the requested fact is absent or conflicting.', rationale: 'SYNTHETIC scripted generic addition for demonstrating persistent workflow state only; no model call or measured quality gain.' });
    this.insertRuntimeReceipt(parts.normalized.runId, RUNTIME_POLICY_PROPOSAL_TOOL, output, parts.prompt.promptVersion, parts.bindings);
    return replayRuntimeProposalReceipt(parts.normalized, this.receipt(parts.normalized.runId)!, this.executionMode);
  }
  async answerRuntimePolicy(input: RuntimeAnswerInput) {
    if (this.closed) throw new Error('Synthetic provider is closed.');
    const parts = runtimeAnswerRequestParts(input);
    if (parts.normalized.policy.mode !== this.executionMode) throw new Error('Runtime policy evaluation mode does not match this provider.');
    const previous = this.receipt(parts.normalized.runId);
    if (previous) return replayRuntimeAnswerReceipt(parts.normalized, previous, this.executionMode);
    const fixture = runtimeFixture(parts.normalized.question, parts.normalized.evidence);
    const candidate = parts.normalized.policy.instructions.includes('Runtime answer-policy addition:');
    let answer: LoopAnswer;
    if (fixture === 'nacre-capacity') answer = { status: 'answered', answer: `SYNTHETIC runtime fixture answer: The fictional Nacre kettle holds ${candidate ? 'twelve' : 'ten'} cups.`, citations: [{ passageId: parts.normalized.evidence[0].id, quote: parts.normalized.evidence[0].text }] };
    else if (fixture === 'opal-material') answer = { status: 'answered', answer: 'SYNTHETIC runtime fixture answer: The fictional Opal tray is made of steel.', citations: [{ passageId: parts.normalized.evidence[0].id, quote: parts.normalized.evidence[0].text }] };
    else answer = { status: 'insufficient_evidence', answer: 'SYNTHETIC runtime fixture abstention: The requested fact is absent from this fictional source packet.', citations: [] };
    const output = validateRuntimeAnswerOutput(parts.normalized, answer);
    this.insertRuntimeReceipt(parts.normalized.runId, RUNTIME_POLICY_ANSWER_TOOL, output, parts.prompt.promptVersion, parts.bindings);
    return replayRuntimeAnswerReceipt(parts.normalized, this.receipt(parts.normalized.runId)!, this.executionMode);
  }
  private insertRuntimeReceipt(runId: string, kind: string, output: unknown, promptVersion: string, bindings: { requestSha256: string } & Record<string, unknown>) {
    const receipt: AnswerRevisionReceipt = { id: `synthetic-${randomUUID()}`, kind, status: 'completed', model: 'synthetic-fixture', input_tokens: null, output_tokens: null, error_code: null, receipt_json: JSON.stringify({ output, model: 'synthetic-fixture', usage: null, promptVersion, ...bindings, mode: this.executionMode, accounting: 'no_provider_call' }), allowance_usd: 0, executionMode: this.executionMode, accounting: 'no_provider_call' };
    this.db.prepare('INSERT INTO synthetic_answer_receipts(run_id,input_sha256,document) VALUES(?,?,?)').run(runId, bindings.requestSha256, JSON.stringify(receipt));
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
    const output: ClaimSupportWireOutput = runtimeFixtureGrade(input) ?? {
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

/** Exact fictional controls shared with the offline worker packet. Unknown
 * questions/sources are never assigned invented semantic labels. */
function runtimeFixture(question: string, evidence: readonly Source[]): 'nacre-capacity' | 'opal-material' | 'opal-voltage' | undefined {
  if (evidence.length !== 1) return;
  const source = evidence[0];
  if (source.id === 'nacre-capacity-source' && source.text === 'SYNTHETIC runtime fixture: The fictional Nacre kettle holds twelve cups.' && question === 'How many cups does the fictional Nacre kettle hold?') return 'nacre-capacity';
  if (source.id === 'opal-material-source' && source.text === 'SYNTHETIC runtime fixture: The fictional Opal tray is made of steel.') {
    if (question === 'What material is the fictional Opal tray made of?') return 'opal-material';
    if (question === 'What voltage does the fictional Opal tray require?') return 'opal-voltage';
  }
}
function runtimeFixtureGrade(input: ClaimSupportInput): ClaimSupportWireOutput | undefined {
  const fixture = runtimeFixture(input.question, input.evidence);
  if (!fixture || !input.answer.answer.startsWith('SYNTHETIC runtime fixture ')) return;
  const parts = claimSupportRequestParts(input), abstention = input.answer.status === 'insufficient_evidence';
  const expected = fixture === 'nacre-capacity' ? 'SYNTHETIC runtime fixture answer: The fictional Nacre kettle holds twelve cups.' : fixture === 'opal-material' ? 'SYNTHETIC runtime fixture answer: The fictional Opal tray is made of steel.' : undefined;
  const supported = !abstention && input.answer.answer === expected && input.answer.citations.some(citation => citation.passageId === input.evidence[0].id && citation.quote === input.evidence[0].text);
  const wrong = fixture === 'nacre-capacity' && input.answer.answer === 'SYNTHETIC runtime fixture answer: The fictional Nacre kettle holds ten cups.';
  const knownAbstention = abstention && input.answer.answer === 'SYNTHETIC runtime fixture abstention: The requested fact is absent from this fictional source packet.';
  const unknown = !supported && !wrong && !knownAbstention;
  return { units: parts.units.map(unit => ({ unitId: unit.id, verdict: unknown ? 'uncertain' : abstention ? 'non_factual' : supported ? 'supported' : 'unsupported', evidence: supported ? [{ sourceId: input.evidence[0].id, quote: input.evidence[0].text, relation: 'supports' }] : [], reason: 'SYNTHETIC exact fictional workflow control; not a semantic model assessment.' })), questionCoverage: unknown ? 'uncertain' : fixture === 'opal-voltage' || supported || knownAbstention ? 'complete' : 'incomplete', answerability: unknown ? 'uncertain' : fixture === 'opal-voltage' ? 'insufficient' : 'answerable', correctness: unknown ? 'uncertain' : 'consistent_with_sources', uncertaintyHandling: unknown ? 'uncertain' : abstention && fixture !== 'opal-voltage' ? 'unnecessary_abstention' : 'appropriate', reason: 'SYNTHETIC scripted fictional control labels only; no model quality or correctness claim.' };
}
