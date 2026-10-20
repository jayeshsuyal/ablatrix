import { createHash } from 'node:crypto';
import { verifyWorkspaceProof, type WorkspaceProof } from './workspace-proof.ts';
import type { AutomaticSupportJob } from './automatic-support.ts';

type Attribute = { key: string; value: { stringValue: string } | { boolValue: boolean } | { doubleValue: number } };
type Span = { traceId: string; spanId: string; parentSpanId?: string; name: string; kind: 1; startTimeUnixNano: string; endTimeUnixNano: string; attributes: Attribute[] };
type Case = WorkspaceProof['cases'][number];
type Assessment = AutomaticSupportJob['assessments'][number];
const MAX_CASES = 1000;
const MAX_OTLP_MS = Number((2n ** 64n - 1n) / 1_000_000n);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const identity = (kind: string, value: string) => hash(`ablatrix:workspace-observability-v1:${kind}:${value}`);
const attr = (key: string, value: string | boolean | number): Attribute => ({ key, value: typeof value === 'string' ? { stringValue: value } : typeof value === 'boolean' ? { boolValue: value } : { doubleValue: value } });
const metadata = (key: string, value: string | boolean | number) => attr(`langfuse.observation.metadata.${key}`, value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const count = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value);
const safeEnum = (value: unknown, values: readonly string[]) => typeof value === 'string' && values.includes(value) ? value : 'unknown';
const shaAttr = (key: string, value: unknown): Attribute[] => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? [metadata(key, value)] : [];
const date = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isSafeInteger(ms) && ms >= 0 && ms <= MAX_OTLP_MS ? ms : null;
};
const nano = (ms: number) => (BigInt(ms) * 1_000_000n).toString();

function usage(value: { inputTokens: number; outputTokens: number } | null | undefined): Attribute[] {
  const known = !!value && count(value.inputTokens) && count(value.outputTokens);
  return [metadata('token_usage_known', known), ...(known ? [attr('langfuse.observation.usage_details', JSON.stringify({ input: value.inputTokens, output: value.outputTokens }))] : [])];
}

function assessment(value: Assessment | undefined): Attribute[] {
  if (!value) return [metadata('assessment_available', false)];
  const a = value.assessment;
  return [metadata('assessment_available', true),
    metadata('assessment_kind', safeEnum(a.assessmentKind, ['ai_claim_support_estimate', 'synthetic_scripted_claim_support'])),
    metadata('calibration', 'not_measured'), metadata('quality_claim_eligible', false),
    metadata('disposition', safeEnum(a.disposition, ['pass', 'repair', 'abstain', 'uncertain'])),
    metadata('question_coverage', safeEnum(a.questionCoverage, ['complete', 'incomplete', 'uncertain'])),
    metadata('answerability', safeEnum(a.answerability, ['answerable', 'insufficient', 'conflicting', 'uncertain'])),
    metadata('correctness', safeEnum(a.correctness, ['consistent_with_sources', 'contradicted_by_sources', 'uncertain'])),
    metadata('uncertainty_handling', safeEnum(a.uncertaintyHandling, ['appropriate', 'overconfident', 'unnecessary_abstention', 'uncertain'])),
    metadata('grader_version_sha256', hash(value.promptVersion)),
    ...shaAttr('grader_request_sha256', a.requestSha256),
    ...shaAttr('grader_prompt_sha256', a.systemInstructionsSha256),
    ...('v4' in a && a.v4 ? [metadata('unit_axes', JSON.stringify((a as Assessment['assessment'] & { v4: { units: { factualConsistency: string; citedSupport: string; applicability: string }[] } }).v4.units.map(unit => ({
      factualConsistency: safeEnum(unit.factualConsistency, ['consistent', 'contradicted', 'not_established', 'non_factual', 'uncertain']),
      citedSupport: safeEnum(unit.citedSupport, ['supported', 'unsupported', 'non_factual', 'uncertain']),
      applicability: safeEnum(unit.applicability, ['applicable', 'wrong_variant', 'ambiguous_scope', 'not_applicable'])
    }))))] : [])];
}

function rootSpan(item: Case, proofSha256: string): Span {
  const run = item.run;
  const traceId = identity('trace', run.id).slice(0, 32), spanId = identity('workflow', run.id).slice(0, 16);
  const start = date(run.createdAt);
  const known = start !== null && count(item.totalMs) && Number.isSafeInteger(start + item.totalMs) && start + item.totalMs <= MAX_OTLP_MS;
  // An unfinished or legacy record is a snapshot, never an invented elapsed measurement.
  const anchor = start ?? date(run.finishedAt) ?? 0;
  const end = known ? start + item.totalMs! : anchor;
  return { traceId, spanId, name: 'workspace-answer', kind: 1, startTimeUnixNano: nano(anchor), endTimeUnixNano: nano(end), attributes: [
    attr('langfuse.trace.name', 'ablatrix.workspace-answer'), attr('langfuse.observation.type', 'span'),
    metadata('run_identity_sha256', identity('run', run.id)), metadata('source_proof_sha256', proofSha256),
    metadata('execution_mode', safeEnum(run.mode, ['live', 'synthetic'])),
    metadata('synthetic', run.mode === 'synthetic'), metadata('quality_claim_eligible', false),
    metadata('provider_authenticity', 'not_attested'), metadata('provider_billed_cost', 'unknown'),
    metadata('status', safeEnum(run.status, ['retrieving', 'evidence_ready', 'completed', 'failed'])),
    metadata('automated_paired_outcome', safeEnum(item.outcome, ['win', 'tie', 'regression', 'unresolved'])),
    metadata('timing', known ? 'recorded_workflow_elapsed' : 'snapshot_only_workflow_duration_unknown'),
    metadata('timestamp_known', start !== null), metadata('workflow_elapsed_ms_known', known),
    ...(known ? [metadata('workflow_elapsed_ms', item.totalMs!)] : []),
    metadata('recorded_operation_count', item.recordedOperations), metadata('recorded_live_receipt_count', item.calls),
    metadata('call_slots_without_receipts', item.unknownCallSlots),
    ...usage(item.tokens ? { inputTokens: item.tokens.input, outputTokens: item.tokens.output } : null),
    metadata('planning_allowance_known', finite(item.planningAllowanceUsd)),
    ...(finite(item.planningAllowanceUsd) ? [metadata('planning_allowance_usd', item.planningAllowanceUsd)] : []),
    metadata('accounting', 'planning_allowance_not_provider_charges'),
    metadata('assessment_provenance', item.job ? safeEnum(item.job.assessmentKind, ['ai_claim_support_estimate', 'synthetic_scripted_claim_support']) : 'unassessed'),
    metadata('automatic_status', item.job ? safeEnum(item.job.status, ['queued', 'checking', 'repairing', 'rechecking', 'supported', 'repaired', 'abstained', 'inconclusive', 'reconciliation']) : 'not_requested_or_unavailable'),
    ...shaAttr('request_sha256', run.requestIdentity?.sha256),
    ...shaAttr('policy_instructions_sha256', run.runtimePolicy?.instructionSha256),
    ...(run.runtimePolicy ? [metadata('policy_identity_sha256', identity('policy', run.runtimePolicy.id))] : []),
    ...shaAttr('source_context_sha256', run.generation?.binding.sourceContextSha256 ?? item.job?.sourceContextSha256),
    metadata('source_count', item.original.sources.length)
  ] };
}

function generationSnapshot(item: Case, root: Span): Span | null {
  const run = item.run;
  if (!run.generation && !item.original.receipt && !run.model) return null;
  const anchor = date(run.finishedAt) ?? date(run.createdAt) ?? 0;
  return { traceId: root.traceId, spanId: identity('generation', run.id).slice(0, 16), parentSpanId: root.spanId,
    name: 'original-generation-snapshot', kind: 1, startTimeUnixNano: nano(anchor), endTimeUnixNano: nano(anchor), attributes: [
      attr('langfuse.observation.type', 'event'), metadata('phase', 'original_generation'),
      metadata('timing', 'snapshot_only_stage_timestamps_unavailable'), metadata('stage_duration_known', false),
      metadata('generation_phase', safeEnum(run.generation?.phase, ['prepared', 'dispatching', 'completed', 'reconciliation'])),
      metadata('status', safeEnum(item.original.receipt?.status, ['pending', 'completed', 'failed', 'interrupted'])),
      metadata('synthetic', run.mode === 'synthetic'), metadata('quality_claim_eligible', false),
      ...(item.original.receipt ? [metadata('receipt_identity_sha256', identity('receipt', item.original.receipt.id))] : []),
      ...(run.model ? [metadata('model_identity_sha256', identity('model', run.model))] : []),
      ...(run.generation ? [metadata('generation_contract_sha256', hash(run.generation.contract))] : []),
      ...shaAttr('request_sha256', run.generation?.binding.requestSha256),
      ...shaAttr('prompt_sha256', run.generation?.binding.systemInstructionsSha256),
      ...shaAttr('source_context_sha256', run.generation?.binding.sourceContextSha256),
      ...usage(run.usage), ...assessment(item.job?.assessments.find(value => value.phase === 'original'))
    ] };
}

function operationSpan(item: Case, operation: Case['operations'][number], root: Span): Span {
  const start = date(operation.startedAt), end = date(operation.finishedAt);
  const known = start !== null && end !== null && end >= start;
  const anchor = end ?? start ?? date(item.run.createdAt) ?? 0;
  const phase = safeEnum(operation.phase, ['grade_original', 'repair', 'grade_repair']);
  const names: Record<string, string> = { grade_original: 'check-original', repair: 'repair-answer', grade_repair: 'recheck-repair' };
  const grade = item.job?.assessments.find(value => value.phase === (phase === 'grade_original' ? 'original' : 'repair'));
  let promptSha256: unknown;
  try { promptSha256 = JSON.parse(operation.receipt?.receipt_json ?? 'null')?.systemInstructionsSha256; } catch { /* Verified unsuccessful receipts may not contain a structured output. */ }
  return { traceId: root.traceId, spanId: identity('operation', operation.runId).slice(0, 16), parentSpanId: root.spanId,
    name: `${names[phase] ?? 'unknown-phase'}${known ? '' : '-snapshot'}`, kind: 1,
    startTimeUnixNano: nano(known ? start : anchor), endTimeUnixNano: nano(known ? end : anchor), attributes: [
      attr('langfuse.observation.type', known ? 'generation' : 'event'), metadata('phase', phase),
      metadata('status', safeEnum(operation.status, ['started', 'completed', 'invalid', 'unknown'])),
      metadata('timing', known ? 'recorded_operation_wall_clock' : 'snapshot_only_stage_duration_unknown'),
      metadata('stage_duration_known', known), ...(known ? [metadata('operation_elapsed_ms', end - start)] : []),
      metadata('timestamp_known', start !== null || end !== null),
      metadata('synthetic', item.run.mode === 'synthetic'), metadata('quality_claim_eligible', false),
      metadata('operation_identity_sha256', identity('operation', operation.runId)),
      ...(operation.receiptId ? [metadata('receipt_identity_sha256', identity('receipt', operation.receiptId))] : []),
      ...(operation.receipt?.model ? [metadata('model_identity_sha256', identity('model', operation.receipt.model))] : []),
      ...shaAttr('prompt_sha256', promptSha256),
      ...shaAttr('request_sha256', operation.requestSha256), ...usage(operation.usage),
      ...(phase === 'repair' ? [] : assessment(grade))
    ] };
}

/** Pure local projection of verified evidence. It has no credential, provider or transport interface. */
export function buildWorkspaceObservabilityPreview(proof: WorkspaceProof) {
  verifyWorkspaceProof(proof);
  if (proof.cases.length > MAX_CASES) throw new Error('Observability preview exceeds its 1000-case bound.');
  const spans: Span[] = [];
  for (const item of proof.cases) {
    const root = rootSpan(item, proof.sha256);
    spans.push(root);
    const generation = generationSnapshot(item, root);
    if (generation) spans.push(generation);
    for (const operation of item.operations) spans.push(operationSpan(item, operation, root));
  }
  return { format: 'ablatrix-workspace-observability-preview-v1' as const, sourceProofSha256: proof.sha256,
    transport: 'otlp_http_json_preview' as const, privacy: 'metadata_only' as const, providerCalls: 0 as const, exported: false as const,
    otlp: { resourceSpans: [{ resource: { attributes: [attr('service.name', 'ablatrix')] },
      scopeSpans: [{ scope: { name: 'ablatrix.workspace-proof', version: '1' }, spans }] }] } };
}
