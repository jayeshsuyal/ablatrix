import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildWorkspaceObservabilityPreview } from './workspace-observability-v1.ts';
import { buildWorkspaceProof, type WorkspaceProof } from './workspace-proof.ts';
import { SyntheticAnswerProvider } from './synthetic-answer-provider.ts';
import { ProductWorkspace } from './product-workspace.ts';
import { localDemoRetriever } from './local-demo.ts';
import { AutomaticSupport, automaticSupportGradeInput } from './automatic-support.ts';
import { claimSupportRequestParts } from './claim-support.ts';
import { createRuntimeGraderBinding } from './runtime-grader.ts';
import { CITED_APPLICABILITY_GRADER_VERSION } from './claim-support-v4.ts';

type Preview = ReturnType<typeof buildWorkspaceObservabilityPreview>;
const spans = (preview: Preview) => preview.otlp.resourceSpans.flatMap(resource => resource.scopeSpans.flatMap(scope => scope.spans));
const attributes = (span: ReturnType<typeof spans>[number]) => Object.fromEntries(span.attributes.map(attribute => [attribute.key.replace('langfuse.observation.metadata.', ''), 'stringValue' in attribute.value ? attribute.value.stringValue : 'boolValue' in attribute.value ? attribute.value.boolValue : attribute.value.doubleValue]));
const fixture = () => JSON.parse(readFileSync(new URL('../docs/evidence/workflow-engineering-2026-10-17/development-proof-v1.json', import.meta.url), 'utf8')).proof as WorkspaceProof;
const rehash = (proof: WorkspaceProof) => { const { sha256: ignored, ...body } = proof; return { ...body, sha256: createHash('sha256').update(JSON.stringify(body)).digest('hex') }; };

test('verified synthetic history becomes stable OTLP metadata while source bytes remain private', () => {
  const proof = fixture(), before = JSON.stringify(proof);
  const preview = buildWorkspaceObservabilityPreview(proof);
  assert.equal(preview.format, 'ablatrix-workspace-observability-preview-v1');
  assert.equal(preview.privacy, 'metadata_only'); assert.equal(preview.providerCalls, 0); assert.equal(preview.exported, false);
  assert.equal(preview.sourceProofSha256, proof.sha256); assert.deepEqual(buildWorkspaceObservabilityPreview(proof), preview);
  assert.equal(JSON.stringify(proof), before);
  const projected = spans(preview), roots = projected.filter(span => !span.parentSpanId);
  assert.equal(roots.length, proof.cases.length);
  assert.equal(projected.length, proof.cases.reduce((sum, item) => sum + 2 + item.operations.length, 0));
  assert.equal(new Set(projected.map(span => span.spanId)).size, projected.length);
  for (const span of projected) {
    assert.match(span.traceId, /^[a-f0-9]{32}$/); assert.match(span.spanId, /^[a-f0-9]{16}$/);
    assert.match(span.startTimeUnixNano, /^\d+$/); assert.match(span.endTimeUnixNano, /^\d+$/);
    assert.ok(BigInt(span.endTimeUnixNano) >= BigInt(span.startTimeUnixNano));
    assert.ok(span.parentSpanId === undefined || roots.some(root => root.spanId === span.parentSpanId && root.traceId === span.traceId));
    assert.equal(attributes(span).quality_claim_eligible, false);
    assert.equal(attributes(span).synthetic, true);
  }
  const serialized = JSON.stringify(preview);
  for (const item of proof.cases) {
    for (const privateValue of [item.run.id, item.run.question, item.original.answer?.answer, item.run.runtimePolicyInstructions, ...item.original.sources.flatMap(source => [source.id, source.text])]) {
      if (privateValue) assert.ok(!serialized.includes(privateValue), `Private proof value leaked (${privateValue.length} characters).`);
    }
  }
});

test('checks retain automated provenance and axes without rationale, proof quotes or unit text', () => {
  const proof = fixture(), preview = buildWorkspaceObservabilityPreview(proof);
  const checks = spans(preview).filter(span => ['check-original', 'recheck-repair'].includes(span.name));
  assert.equal(checks.length, 3);
  for (const span of checks) {
    const values = attributes(span);
    assert.equal(values.assessment_kind, 'synthetic_scripted_claim_support');
    assert.equal(values.calibration, 'not_measured'); assert.equal(values.assessment_available, true);
    assert.ok(['pass', 'repair', 'abstain', 'uncertain'].includes(values.disposition as string));
    assert.ok(Array.isArray(JSON.parse(values.unit_axes as string)));
    assert.equal(values.timing, 'recorded_operation_wall_clock');
  }
  const output = JSON.stringify(preview);
  for (const item of proof.cases) for (const grade of item.job?.assessments ?? []) {
    assert.ok(!output.includes(grade.assessment.reason));
    for (const unit of grade.assessment.units) if (unit.reason.length > 20) assert.ok(!output.includes(unit.reason));
  }
});

test('untrusted legacy strings and injected user canaries cannot escape the metadata projection', () => {
  const canary = 'PRIVATE-CANARY-user@example.invalid-secret-key-778801';
  const original = fixture().cases[0].run;
  const run = { ...structuredClone(original), id: canary, question: canary, model: canary, generationProtocol: canary,
    generation: undefined, generationPassages: undefined, requestIdentity: undefined, runtimePolicy: undefined, runtimePolicyInstructions: canary,
    error: canary, automaticCheckError: canary, reviewContext: undefined,
    retrieval: original.retrieval ? { ...original.retrieval, method: canary, passages: original.retrieval.passages.map(passage => ({ ...passage, id: canary, source: canary, text: canary })) } : null } as unknown as typeof original;
  const proof = buildWorkspaceProof([run], [], () => undefined);
  const preview = buildWorkspaceObservabilityPreview(proof), output = JSON.stringify(preview);
  assert.ok(!output.includes(canary)); assert.ok(!output.includes('user@example.invalid'));
  const root = attributes(spans(preview)[0]); assert.equal(root.token_usage_known, false);
  assert.equal(root.assessment_provenance, 'unassessed');
});

test('proof mutations are rejected before any preview is generated, even when the outer checksum is replaced', () => {
  const proof = fixture(); proof.cohort.planned++;
  assert.throws(() => buildWorkspaceObservabilityPreview(proof), /identity/);
  assert.throws(() => buildWorkspaceObservabilityPreview(rehash(proof)), /derived/);
  const changed = fixture(); changed.cases[0].run.answer!.answer = 'PRIVATE altered source answer';
  assert.throws(() => buildWorkspaceObservabilityPreview(rehash(changed)), /exact original workspace run|original differs/);
});

test('unknown elapsed time and token usage stay unknown instead of becoming zero measurements', async () => {
  const provider = new SyntheticAnswerProvider(':memory:'), workspace = new ProductWorkspace(':memory:', provider, localDemoRetriever);
  try {
    const product = workspace.createProduct({ title: 'Fictional pending bottle', sources: [{ label: 'Synthetic source', text: 'SYNTHETIC fixture: This bottle holds six cups and has a cork lid.' }] });
    await workspace.ask({ productId: product.id, question: 'What capacity and lid are listed?', mode: 'synthetic' }, undefined, { automaticCheck: true });
    const proof = buildWorkspaceProof(workspace.proofRuns(), [], id => provider.receipt(id));
    const preview = buildWorkspaceObservabilityPreview(proof), projected = spans(preview), root = attributes(projected[0]);
    assert.equal(root.workflow_elapsed_ms_known, false); assert.equal(root.workflow_elapsed_ms, undefined);
    assert.equal(root.token_usage_known, false); assert.equal(root['langfuse.observation.usage_details'], undefined);
    assert.equal(root.planning_allowance_known, true); assert.equal(root.planning_allowance_usd, 0);
    assert.equal(projected[0].startTimeUnixNano, projected[0].endTimeUnixNano);
    const generation = projected.find(span => span.name === 'original-generation-snapshot')!;
    assert.equal(attributes(generation)['langfuse.observation.type'], 'event');
    assert.equal(attributes(generation).stage_duration_known, false);
  } finally { workspace.close(); provider.close(); }
});

test('failed and unresolved histories retain their workflow records and pending phases stay snapshots', async () => {
  class InvalidSynthetic extends SyntheticAnswerProvider {
    override receipt(runId: string) {
      const receipt = super.receipt(runId);
      if (!receipt || receipt.kind !== 'workspace_answer_flat_sources_v1') return receipt;
      const document = JSON.parse(receipt.receipt_json!); document.output.citations = ['src_not_offered'];
      return { ...receipt, receipt_json: JSON.stringify(document) };
    }
  }
  const badProvider = new InvalidSynthetic(':memory:'), badWorkspace = new ProductWorkspace(':memory:', badProvider, localDemoRetriever);
  const provider = new SyntheticAnswerProvider(':memory:'), workspace = new ProductWorkspace(':memory:', provider, localDemoRetriever);
  const checks = new AutomaticSupport(provider, ':memory:', { graderBinding: createRuntimeGraderBinding('synthetic', CITED_APPLICABILITY_GRADER_VERSION) });
  try {
    const sources = [{ label: 'Synthetic source', text: 'SYNTHETIC fixture: This bottle holds six cups and has a cork lid.' }];
    const badProduct = badWorkspace.createProduct({ title: 'Fictional invalid bottle', sources });
    await badWorkspace.ask({ productId: badProduct.id, question: 'What capacity and lid are listed?', mode: 'synthetic' });
    const failed = buildWorkspaceObservabilityPreview(buildWorkspaceProof(badWorkspace.proofRuns(), [], id => badProvider.receipt(id)));
    assert.equal(attributes(spans(failed)[0]).status, 'failed'); assert.equal(attributes(spans(failed)[0]).automated_paired_outcome, 'unresolved');
    assert.ok(spans(failed).some(span => span.name === 'original-generation-snapshot'));
    const product = workspace.createProduct({ title: 'Fictional pending bottle', sources });
    const run = await workspace.ask({ productId: product.id, question: 'What capacity and lid are listed?', mode: 'synthetic' });
    const job = checks.enqueue(workspace.reviewSnapshots(run.id)[0]);
    const pending = structuredClone(job); pending.status = 'checking';
    pending.operations = [{ phase: 'grade_original', runId: `${job.id}:grade-original`, status: 'started', requestSha256: 'a'.repeat(64), startedAt: run.createdAt }];
    // The existing verifier rejects a fabricated started request binding.
    assert.throws(() => buildWorkspaceObservabilityPreview(buildWorkspaceProof([run], [pending], id => provider.receipt(id))), /request hash/);
    pending.operations[0].requestSha256 = claimSupportRequestParts(automaticSupportGradeInput(pending)).bindings.requestSha256;
    const inFlight = buildWorkspaceObservabilityPreview(buildWorkspaceProof([run], [pending], id => provider.receipt(id)));
    const pendingPhase = spans(inFlight).find(span => span.name === 'check-original-snapshot')!;
    assert.ok(pendingPhase); assert.equal(pendingPhase.startTimeUnixNano, pendingPhase.endTimeUnixNano);
    assert.equal(attributes(pendingPhase).status, 'started'); assert.equal(attributes(pendingPhase).stage_duration_known, false);
    assert.equal(attributes(pendingPhase).operation_elapsed_ms, undefined);
    assert.equal(attributes(pendingPhase)['langfuse.observation.type'], 'event');
    const queued = buildWorkspaceObservabilityPreview(buildWorkspaceProof([run], [job], id => provider.receipt(id)));
    assert.equal(attributes(spans(queued)[0]).automatic_status, 'queued');
    assert.equal(attributes(spans(queued)[0]).automated_paired_outcome, 'unresolved');
    assert.equal(attributes(spans(queued)[0]).workflow_elapsed_ms_known, false);
  } finally { checks.close(); workspace.close(); provider.close(); badWorkspace.close(); badProvider.close(); }
});
