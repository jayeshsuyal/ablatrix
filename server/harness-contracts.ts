import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnswerRevisions, type AnswerRevisionProvider, type AnswerRevisionReceipt, type ReviewAnswerSnapshot } from './answer-revisions.ts';
import { workspaceReviewSourceHash } from './answer-review-source.ts';
import { SapiomFeedbackProvider } from './feedback-provider.ts';

type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
export type HarnessCheckpoint = { id: string; expected: Value; observed: Value; status: 'pass' | 'fail' | 'inconclusive' };
export type HarnessContractCase = { id: string; provenance: 'synthetic_scripted_transport'; mechanical: 'pass' | 'fail' | 'inconclusive'; checkpoints: HarnessCheckpoint[]; syntheticTransportAttempts: number; semanticAssessment: 'not_run'; qualityClaimEligible: false };
export type HarnessContractReport = {
  suite: 'offline-workspace-harness-v1'; fixtureSha256: string; provenance: 'synthetic_scripted_transport';
  mechanical: 'pass' | 'fail' | 'inconclusive'; cases: HarnessContractCase[];
  contract: { exercised: 'legacy_workspace_passage_quotes'; tool: 'answer_revision_v1'; comparisonOnly: 'source_ids_v3'; sourceIdsV3Exercised: false };
  syntheticTransportAttempts: number; paidProviderCalls: 0; humanDecisions: 0; semanticAssessment: 'not_run'; qualityClaimEligible: false;
  limitations: string[];
};
const source = {
  id: 'synthetic-harness-source', label: 'Synthetic listing',
  text: 'SYNTHETIC fixture: model CAB12345 has a listed capacity of 12 liters. No replacement compatibility is stated.',
  originalQuestion: null, origin: 'workspace' as const, reference: 'https://example.invalid/synthetic-harness'
};
const fixtureSnapshot: ReviewAnswerSnapshot = {
  id: 'workspace-20000000-0000-4000-8000-000000000001', runId: '20000000-0000-4000-8000-000000000001', mode: 'synthetic',
  context: { question: 'What capacity is listed for model CAB12345?', product: { id: 'SYNTHETIC-HARNESS', title: 'Synthetic cabinet CAB12345' }, sources: [{ ...source, sha256: workspaceReviewSourceHash(source) }], clarifications: [] },
  answer: { answer: 'SYNTHETIC original fixture; no model-quality judgment.', status: 'insufficient_evidence', citations: [] },
  model: 'synthetic-fixture', promptVersion: 'synthetic-harness-original-v1', createdAt: '2026-10-12T00:00:00.000Z', contextProvenance: 'workspace_source_snapshot', generationSourceIds: [source.id]
};
const scenarios = [
  { id: 'invalid_citation', transport: 'foreign_source', investigate: false, issue: 'answer_quality', feedback: 'SYNTHETIC control instruction: restate the listed capacity using its source.' },
  { id: 'uncertain_receipt_restart', transport: 'lost_response', investigate: false, issue: 'answer_quality', feedback: 'SYNTHETIC control instruction: restate the listed capacity using its source.' },
  { id: 'missing_information', transport: 'must_not_dispatch', investigate: true, issue: 'missing_evidence', feedback: 'SYNTHETIC control instruction: compatibility is missing; do not transfer another model claim.' },
  { id: 'exhausted_allowance', transport: 'must_not_dispatch', investigate: false, issue: 'answer_quality', feedback: 'SYNTHETIC control instruction: restate the listed capacity using its source.' }
] as const;
type Scenario = typeof scenarios[number];
const fixtureSha256 = createHash('sha256').update(JSON.stringify({ fixtureSnapshot, scenarios })).digest('hex');

// AnswerRevisions currently accepts the historical store class, although it only
// consumes overview().cases. This narrow empty adapter avoids constructing that
// class or reading its pinned answers. All scenarios register their own sources.
const emptyPinnedReviews = { overview: () => ({ cases: [] }) } as unknown as ConstructorParameters<typeof AnswerRevisions>[0];

/** Delegate wire parsing, validation, reservations and durability to production
 * code. Only fixture provenance/accounting is relabeled for the synthetic queue;
 * receipt status, errors and output bodies are never repaired or coerced.
 */
function syntheticAdapter(provider: SapiomFeedbackProvider): AnswerRevisionProvider {
  return {
    executionMode: 'synthetic', readiness: () => provider.readiness(), capacity: count => provider.capacity(count),
    async revise(input) { const result = await provider.revise(input); return { ...result, model: 'synthetic-fixture', usage: null }; },
    receipt(runId): AnswerRevisionReceipt | undefined {
      const receipt = provider.receipt(runId); if (!receipt) return undefined;
      return { ...receipt, model: receipt.model === null ? null : 'synthetic-fixture', input_tokens: null, output_tokens: null, allowance_usd: 0,
        executionMode: 'synthetic', accounting: 'no_provider_call', receipt_json: receipt.receipt_json === null ? null : JSON.stringify({ ...JSON.parse(receipt.receipt_json), model: 'synthetic-fixture', usage: null, mode: 'synthetic', accounting: 'no_provider_call' }) };
    }
  };
}

async function runScenario(scenario: Scenario): Promise<HarnessContractCase> {
  const result: HarnessContractCase = { id: scenario.id, provenance: 'synthetic_scripted_transport', mechanical: 'inconclusive', checkpoints: [], syntheticTransportAttempts: 0, semanticAssessment: 'not_run', qualityClaimEligible: false };
  const checkpoint = (id: string, expected: Value, observed: Value) => { result.checkpoints.push({ id, expected, observed, status: JSON.stringify(expected) === JSON.stringify(observed) ? 'pass' : 'fail' }); };
  let directory: string | undefined, provider: SapiomFeedbackProvider | undefined, flow: AnswerRevisions | undefined;
  const toolNames: string[] = [], promptVersions: string[] = [], transports: string[] = [];
  try {
    directory = mkdtempSync(join(tmpdir(), 'ablatrix-harness-contract-'));
    const ledger = join(directory, 'synthetic-ledger.sqlite'), reviewDb = join(directory, 'synthetic-review.sqlite');
    const transport: typeof fetch = async (url, init) => {
      result.syntheticTransportAttempts++; transports.push(`${init?.method} ${String(url)}`);
      if (String(url) !== 'https://router.sapiom.ai/v1/chat/completions' || init?.method !== 'POST') throw new Error('Synthetic transport rejected an unexpected endpoint.');
      const body = JSON.parse(String(init.body)); toolNames.push(body.tool_choice?.function?.name ?? 'missing'); promptVersions.push(JSON.parse(body.messages[1].content).promptVersion ?? 'missing');
      if (scenario.transport === 'lost_response') throw new Error('SYNTHETIC lost response after transport invocation.');
      if (scenario.transport === 'must_not_dispatch') throw new Error('SYNTHETIC forbidden dispatch was observed.');
      const output = { answer: 'SYNTHETIC invalid citation fixture; no quality judgment.', status: 'answered', citations: [{ passageId: 'synthetic-foreign-source', quote: source.text }] };
      return new Response(JSON.stringify({ model: 'gpt-luna', choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: 'answer_revision_v1', arguments: JSON.stringify(output) } }] } }], usage: { prompt_tokens: 0, completion_tokens: 0 } }), { status: 200 });
    };
    const open = () => {
      provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'synthetic-offline-placeholder', credentialsFile: '', dbPath: ledger, capUsd: .2, priorSpendUsd: scenario.id === 'exhausted_allowance' ? .2 : 0, allowancePerCallUsd: .1, callLimit: 2, fetchImpl: transport });
      flow = new AnswerRevisions(emptyPinnedReviews, syntheticAdapter(provider), reviewDb, false);
    };
    open(); const snapshot = structuredClone(fixtureSnapshot);
    if (scenario.id === 'missing_information') snapshot.context.question = 'Will part DRAW12345 replace the drawer in model CAB67890?';
    const original = flow!.registerAnswer(snapshot);
    const job = flow!.request(snapshot.id, { versionId: original.id, idempotencyKey: `synthetic-contract-${scenario.id}`, reviewer: 'Synthetic harness instruction', reviewKind: 'ai_assisted', feedback: scenario.feedback, investigate: scenario.investigate, issue: scenario.issue });
    checkpoint('original_registered', 1, flow!.overview('workspace').cases[0].versions.length); checkpoint('scripted_job_queued', 'queued', job.status);
    await flow!.tick(); await flow!.tick();
    const observed = () => flow!.overview('workspace').cases[0];
    const first = observed(), receipt = provider!.receipt(job.id);
    checkpoint('workspace_provenance', 'synthetic', first.mode);
    checkpoint('no_human_judgments', 0, first.events.filter(event => event.reviewKind === 'human' || event.kind === 'accept').length);
    checkpoint('only_original_version', 1, first.versions.length);
    checkpoint('generation_transport_count', scenario.transport === 'must_not_dispatch' ? 0 : 1, result.syntheticTransportAttempts);
    checkpoint('exact_generation_contract', scenario.transport === 'must_not_dispatch' ? [] : ['answer_revision_v1'], toolNames);
    checkpoint('no_external_discovery', 0, first.jobs[0].investigation?.externalCalls ?? 0);
    if (scenario.id === 'invalid_citation') {
      checkpoint('durable_transport_outcome', 'completed', receipt?.status ?? null);
      checkpoint('output_validation_error', 'output_validation', receipt?.error_code ?? null);
      checkpoint('queue_rejects_invalid_output', 'needs_information', first.jobs[0].status);
      checkpoint('generation_attempt_validation', ['invalid_output'], first.jobs[0].attempts.map(attempt => String(attempt.status)));
    } else if (scenario.id === 'uncertain_receipt_restart') {
      checkpoint('durable_uncertain_receipt', 'failed_or_unknown', receipt?.status ?? null);
      checkpoint('uncertain_job_state', 'reconciliation', first.jobs[0].status);
      flow!.close(); flow = undefined; provider!.close(); provider = undefined;
      open(); await flow!.tick(); await flow!.tick(); const reopened = observed(), replayed = provider!.receipt(job.id);
      checkpoint('same_receipt_after_reopen', true, !!receipt && receipt.id === replayed?.id);
      checkpoint('uncertain_state_after_reopen', 'reconciliation', reopened.jobs[0].status);
      checkpoint('no_redispatch_after_reopen', 1, result.syntheticTransportAttempts);
      checkpoint('no_revision_after_reopen', 1, reopened.versions.length);
      checkpoint('one_durable_attempt', 1, reopened.generationAttempts);
    } else if (scenario.id === 'missing_information') {
      checkpoint('investigation_stop', 'needs_information', first.jobs[0].investigation?.status ?? null);
      checkpoint('queue_stop', 'needs_information', first.jobs[0].status);
      checkpoint('no_generation_receipt', null, receipt?.status ?? null);
      checkpoint('no_generation_attempt', 0, first.jobs[0].attempts.length);
      checkpoint('unsupported_compatibility_not_dispatchable', false, first.jobs[0].investigation?.status === 'ready_to_revise');
    } else {
      checkpoint('allowance_readiness', false, provider!.readiness().ready);
      checkpoint('blocked_job_remains_queued', 'queued', first.jobs[0].status);
      checkpoint('no_generation_receipt', null, receipt?.status ?? null);
      checkpoint('no_generation_attempt', 0, first.jobs[0].attempts.length);
    }
    checkpoint('legacy_prompt_identity', scenario.transport === 'must_not_dispatch' ? [] : ['answer-revision-v2-context'], promptVersions);
    checkpoint('scripted_endpoint_only', Array.from({ length: result.syntheticTransportAttempts }, () => 'POST https://router.sapiom.ai/v1/chat/completions'), transports);
    checkpoint('no_acceptance_event', 0, flow!.overview('workspace').summary.accepted);
  } catch (error) {
    // Preserve all preceding observations and the full scenario denominator.
    // No request bodies, headers, temporary paths or arbitrary error text escape.
    checkpoint('scenario_execution', 'completed', error instanceof Error ? error.name : 'unknown_error');
  } finally {
    try { if (flow) { await flow.pauseAndDrain(); flow.close(); } } catch { checkpoint('worker_cleanup', 'closed', 'cleanup_failed'); }
    try { provider?.close(); } catch { checkpoint('provider_cleanup', 'closed', 'cleanup_failed'); }
    try { if (directory) rmSync(directory, { recursive: true, force: true }); } catch { checkpoint('temporary_storage_cleanup', 'removed', 'cleanup_failed'); }
  }
  result.mechanical = result.checkpoints.some(c => c.status === 'fail') ? 'fail' : result.checkpoints.length && result.checkpoints.every(c => c.status === 'pass') ? 'pass' : 'inconclusive';
  return result;
}

/** No env credentials, historical answers, live stores, outbound transport or human decisions. */
export async function runHarnessContracts(): Promise<HarnessContractReport> {
  const cases: HarnessContractCase[] = [];
  for (const scenario of scenarios) cases.push(await runScenario(scenario));
  return {
    suite: 'offline-workspace-harness-v1', fixtureSha256, provenance: 'synthetic_scripted_transport', cases,
    mechanical: cases.some(c => c.mechanical === 'fail') ? 'fail' : cases.every(c => c.mechanical === 'pass') ? 'pass' : 'inconclusive',
    contract: { exercised: 'legacy_workspace_passage_quotes', tool: 'answer_revision_v1', comparisonOnly: 'source_ids_v3', sourceIdsV3Exercised: false },
    syntheticTransportAttempts: cases.reduce((sum, c) => sum + c.syntheticTransportAttempts, 0), paidProviderCalls: 0, humanDecisions: 0, semanticAssessment: 'not_run', qualityClaimEligible: false,
    limitations: [
      'Scripted transport exercises the production legacy parser, queue and local receipt ledger; it does not establish Router behavior, billing, model correctness or answer improvement.',
      'The adapter marks all workspace records synthetic and preserves receipt outcomes and output bodies. The required critique is an automated fixture instruction, never a human judgment.',
      'source_ids_v3 belongs to explicit comparison methods and is not exercised or enabled for the workspace by this report.'
    ]
  };
}
