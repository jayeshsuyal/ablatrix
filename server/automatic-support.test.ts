import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AutomaticSupport, verifyAutomaticSupportEvidence, type AutomaticSupportJob, type AutomaticSupportProvider } from './automatic-support.ts';
import { workspaceReviewSourceHash, type ReviewAnswerSnapshot } from './answer-review-source.ts';
import { SapiomFeedbackProvider } from './feedback-provider.ts';
import { SyntheticAnswerProvider } from './synthetic-answer-provider.ts';
import { createRuntimeGraderBinding } from './runtime-grader.ts';
import { CITED_APPLICABILITY_GRADER_VERSION } from './claim-support-v4.ts';

function snapshot(mode: 'live' | 'synthetic' = 'live'): ReviewAnswerSnapshot {
  const runId = randomUUID(), source = { id: 'fixture-source-1', label: 'Synthetic fixture listing', text: 'SYNTHETIC fixture: the container holds twelve cups.', originalQuestion: null, origin: 'workspace' as const };
  return { id: `workspace-${runId}`, runId, ...(mode === 'synthetic' ? { mode } : {}),
    context: { question: 'How many cups does the fixture container hold?', product: { id: 'fixture-product', title: 'Synthetic fixture container' }, sources: [{ ...source, sha256: workspaceReviewSourceHash(source) }], clarifications: [] },
    answer: { answer: mode === 'synthetic' ? 'SYNTHETIC draft — scripted source excerpts, not a model-generated answer.' : 'The fixture container holds ten cups.', status: 'answered', citations: [{ passageId: source.id, quote: source.text }] },
    model: mode === 'synthetic' ? 'synthetic-fixture' : 'gpt-5.6-luna', promptVersion: 'fixture-original', createdAt: '2026-10-12T00:00:00.000Z', contextProvenance: 'workspace_source_snapshot', generationSourceIds: [source.id] };
}
type Verdict = 'pass' | 'repair' | 'uncertain' | 'abstain' | 'invalid';
function harness(grades: Verdict[], repairInvalid = false, unanswerable?: { answerability: 'insufficient' | 'conflicting'; verdict: 'unsupported' | 'contradicted' }, contradictorySupport = false) {
  const directory = mkdtempSync(join(tmpdir(), 'automatic-support-')), path = join(directory, 'review.sqlite'), ledger = join(directory, 'budget.sqlite');
  const calls: { kind: string; payload: any }[] = [];
  let gradeIndex = 0;
  const provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'fixture-not-a-secret', capUsd: 1, allowancePerCallUsd: 0.1, callLimit: 10, dbPath: ledger,
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(String(init?.body)), payload = JSON.parse(request.messages[1].content), kind = request.tool_choice.function.name;
      calls.push({ kind, payload });
      let output: unknown;
      if (kind === 'claim_support_v1') {
        const verdict = grades[gradeIndex++] ?? 'pass';
        if (verdict === 'invalid') output = { invalid: true };
        else output = { units: payload.answerUnits.map((unit: { id: string }) => ({ unitId: unit.id, verdict: unanswerable?.verdict ?? (verdict === 'pass' || verdict === 'abstain' ? 'supported' : verdict === 'repair' ? 'unsupported' : 'uncertain'),
          evidence: contradictorySupport ? ['supports', 'contradicts'].map(relation => ({ sourceId: payload.evidence[0].id, quote: payload.evidence[0].text, relation })) : unanswerable?.verdict === 'contradicted' ? [{ sourceId: payload.evidence[0].id, quote: payload.evidence[0].text, relation: 'contradicts' }] : verdict === 'pass' || verdict === 'abstain' ? [{ sourceId: payload.evidence[0].id, quote: payload.evidence[0].text, relation: 'supports' }] : [], reason: 'Synthetic fixture judgment only.' })),
          questionCoverage: 'complete', answerability: unanswerable?.answerability ?? (verdict === 'uncertain' ? 'uncertain' : verdict === 'abstain' ? 'insufficient' : 'answerable'), correctness: unanswerable?.verdict === 'contradicted' ? 'contradicted_by_sources' : 'consistent_with_sources', uncertaintyHandling: 'appropriate', reason: 'Synthetic fixture support check; no measured model quality.' };
      } else {
        assert.equal(kind, 'answer_revision_v1');
        output = { answer: 'The fixture listing states that the container holds twelve cups.', status: 'answered', citations: [{ passageId: repairInvalid ? 'wrong-source' : payload.evidence[0].id, quote: payload.evidence[0].text }] };
      }
      return new Response(JSON.stringify({ model: 'gpt-5.6-luna', choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: kind, arguments: JSON.stringify(output) } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
    } });
  return { directory, path, ledger, provider, calls, cleanup() { provider.close(); rmSync(directory, { recursive: true, force: true }); } };
}
function expire(path: string, job: AutomaticSupportJob) {
  const db = new DatabaseSync(path);
  db.prepare('UPDATE automatic_support_jobs SET status=?,document=?,lease_expires=0 WHERE id=?').run(job.status, JSON.stringify(job), job.id);
  db.close();
}

test('automatic checks require independent live opt-in and complete immutable workspace context', () => {
  const h = harness(['pass']), flow = new AutomaticSupport(h.provider, h.path, { automatic: false });
  try {
    assert.equal(flow.readiness().ready, false);
    assert.throws(() => flow.enqueue(snapshot()), /independent opt-in/);
    assert.equal(flow.overview().length, 0); assert.equal(h.calls.length, 0);
  } finally { flow.close(); h.cleanup(); }
  const enabled = harness(['pass']), next = new AutomaticSupport(enabled.provider, enabled.path, { liveEnabled: true });
  try {
    const incomplete = snapshot(); incomplete.contextProvenance = 'saved_retrieval_only';
    assert.throws(() => next.enqueue(incomplete), /complete saved/);
    const original = snapshot(), job = next.enqueue(original);
    assert.equal(next.enqueue(original).id, job.id);
    const changed = structuredClone(original); changed.answer.answer = 'A different saved answer.';
    assert.throws(() => next.enqueue(changed), /different immutable/);
    assert.equal(enabled.calls.length, 0);
  } finally { next.close(); enabled.cleanup(); }
});

test('passing AI check preserves original and never creates human records', async () => {
  const h = harness(['pass']); let flow = new AutomaticSupport(h.provider, h.path, { liveEnabled: true });
  try {
    const original = snapshot(), job = flow.enqueue(original);
    await flow.tick(); await flow.tick();
    const checked = flow.get(original.id)!;
    assert.equal(checked.status, 'supported'); assert.equal(checked.delivery?.versionId, job.originalId);
    assert.equal(checked.delivery?.origin, 'original'); assert.equal(checked.assessments[0].assessment.qualityClaimEligible, false);
    assert.equal(checked.qualityClaimEligible, false); assert.deepEqual(checked.original, original);
    assert.equal(h.calls.length, 1); assert.equal(checked.operations.length, 1);
    const db = new DatabaseSync(h.path);
    assert.equal((db.prepare("SELECT name FROM sqlite_master WHERE name IN ('answer_review_events','answer_versions','answer_revision_jobs')").all()).length, 0);
    db.close(); flow.close(); flow = new AutomaticSupport(h.provider, h.path);
    assert.equal(flow.enqueue(original).id, job.id, 'Completed replay does not require live opt-in again.');
    await flow.tick(); assert.equal(h.calls.length, 1);
  } finally { flow.close(); h.cleanup(); }
});

test('one repair is independently rechecked before delivery and all three operations survive restart', async () => {
  const h = harness(['repair', 'pass']); let flow = new AutomaticSupport(h.provider, h.path, { liveEnabled: true });
  try {
    const original = snapshot(), job = flow.enqueue(original);
    await flow.tick(); assert.equal(flow.get(original.id)?.phase, 'repair'); assert.equal(flow.get(original.id)?.delivery, undefined);
    flow.close(); flow = new AutomaticSupport(h.provider, h.path, { liveEnabled: true });
    await flow.tick(); assert.equal(flow.get(original.id)?.phase, 'grade_repair'); assert.equal(flow.get(original.id)?.delivery, undefined);
    await flow.tick(); await flow.tick();
    const checked = flow.get(original.id)!;
    assert.equal(checked.status, 'repaired'); assert.equal(checked.delivery?.origin, 'repair'); assert.equal(checked.delivery?.versionId, `automatic-repair-${job.id}`);
    assert.equal(checked.assessments.length, 2); assert.equal(checked.operations.length, 3); assert.equal(h.calls.length, 3);
    assert.deepEqual(h.calls.map(call => call.kind), ['claim_support_v1', 'answer_revision_v1', 'claim_support_v1']);
    assert.deepEqual(h.calls[1].payload.evidence, h.calls[0].payload.evidence);
    assert.deepEqual(checked.original, original);
    assert.equal(h.calls[2].payload.answer.answer, checked.repaired?.answer.answer);
    assert.equal(checked.repaired?.sourceContextSha256, checked.sourceContextSha256);
  } finally { flow.close(); h.cleanup(); }
});

test('failed repaired check abstains permanently after the single repair', async () => {
  const h = harness(['repair', 'repair']), flow = new AutomaticSupport(h.provider, h.path, { liveEnabled: true });
  try {
    const original = snapshot(); flow.enqueue(original);
    for (let i = 0; i < 6; i++) await flow.tick();
    const checked = flow.get(original.id)!;
    assert.equal(checked.status, 'abstained'); assert.equal(checked.delivery?.origin, 'safe_abstention');
    assert.equal(checked.delivery?.answer.status, 'insufficient_evidence'); assert.equal(checked.delivery?.versionId, null);
    assert.equal(h.calls.length, 3); assert.equal(checked.repaired?.answer.status, 'answered');
  } finally { flow.close(); h.cleanup(); }
});

test('uncertain, insufficient and malformed original grades stop without repair', async () => {
  for (const verdict of ['uncertain', 'abstain', 'invalid'] as const) {
    const h = harness([verdict]), flow = new AutomaticSupport(h.provider, h.path, { liveEnabled: true });
    try {
      const original = snapshot(); flow.enqueue(original); await flow.tick(); await flow.tick();
      const checked = flow.get(original.id)!;
      assert.equal(checked.status, verdict === 'abstain' ? 'abstained' : 'inconclusive');
      assert.equal(checked.repaired, undefined); assert.equal(h.calls.length, 1);
      assert.equal(checked.delivery?.origin, 'safe_abstention');
    } finally { flow.close(); h.cleanup(); }
  }
});

test('unanswerable original checks abstain after one grade even when individual claims fail', async () => {
  for (const scenario of [{ answerability: 'insufficient', verdict: 'unsupported' }, { answerability: 'conflicting', verdict: 'contradicted' }] as const) {
    const h = harness(['repair', 'pass'], false, scenario), flow = new AutomaticSupport(h.provider, h.path, { liveEnabled: true });
    try {
      const original = snapshot(); flow.enqueue(original);
      await flow.tick(); await flow.tick(); await flow.tick();
      const checked = flow.get(original.id)!;
      assert.equal(checked.status, 'abstained'); assert.equal(checked.delivery?.origin, 'safe_abstention');
      assert.equal(checked.assessments[0].assessment.answerability, scenario.answerability);
      assert.equal(checked.assessments[0].assessment.units[0].verdict, scenario.verdict);
      assert.equal(checked.assessments.length, 1); assert.equal(checked.operations.length, 1);
      assert.equal(checked.repaired, undefined); assert.deepEqual(h.calls.map(call => call.kind), ['claim_support_v1']);
    } finally { flow.close(); h.cleanup(); }
  }
});

test('contradictory proofs cannot deliver a supported original or trigger another operation', async () => {
  const h = harness(['pass', 'pass'], false, undefined, true), flow = new AutomaticSupport(h.provider, h.path, { liveEnabled: true });
  try {
    const original = snapshot(); flow.enqueue(original);
    await flow.tick(); await flow.tick(); await flow.tick();
    const checked = flow.get(original.id)!;
    assert.equal(checked.status, 'inconclusive'); assert.equal(checked.delivery?.origin, 'safe_abstention');
    assert.equal(checked.delivery?.versionId, null); assert.equal(checked.assessments.length, 0);
    assert.equal(checked.operations.length, 1); assert.equal(checked.repaired, undefined);
    assert.deepEqual(h.calls.map(call => call.kind), ['claim_support_v1']);
    assert.equal(h.provider.receipt(checked.operations[0].runId)?.error_code, 'output_validation');
    assert.deepEqual(checked.original, original);
  } finally { flow.close(); h.cleanup(); }
});

test('completed grade receipt replays after persistence interruption without another model call', async () => {
  const h = harness(['repair', 'pass']); let flow = new AutomaticSupport(h.provider, h.path, { liveEnabled: true });
  try {
    const original = snapshot(); flow.enqueue(original); await flow.tick();
    const interrupted = flow.get(original.id)!;
    interrupted.phase = 'grade_original'; interrupted.status = 'checking'; interrupted.assessments = []; interrupted.operations[0].status = 'started';
    flow.close(); expire(h.path, interrupted);
    flow = new AutomaticSupport(h.provider, h.path, { liveEnabled: true });
    assert.equal(flow.get(original.id)?.phase, 'repair'); assert.equal(h.calls.length, 1);
    await flow.tick(); await flow.tick(); await flow.tick();
    assert.equal(flow.get(original.id)?.status, 'repaired'); assert.equal(h.calls.length, 3);
  } finally { flow.close(); h.cleanup(); }
});

test('missing receipt after a started phase stops across restart instead of redispatching', async () => {
  const h = harness(['pass']); let flow = new AutomaticSupport(h.provider, h.path, { liveEnabled: true });
  try {
    const original = snapshot(), interrupted = flow.enqueue(original);
    interrupted.status = 'checking'; interrupted.operations.push({ phase: 'grade_original', runId: `${interrupted.id}:grade-original`, status: 'started', requestSha256: '0'.repeat(64), startedAt: new Date().toISOString() });
    flow.close(); expire(h.path, interrupted);
    flow = new AutomaticSupport(h.provider, h.path, { liveEnabled: true });
    await flow.tick(); await flow.tick();
    assert.equal(flow.get(original.id)?.status, 'reconciliation'); assert.equal(h.calls.length, 0);
  } finally { flow.close(); h.cleanup(); }
});

test('unknown provider outcome consumes its single attempt and is never retried', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'automatic-unknown-')), path = join(directory, 'checks.sqlite'); let calls = 0;
  const provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'fixture-not-a-secret', capUsd: 0.3, allowancePerCallUsd: 0.1, callLimit: 3, dbPath: join(directory, 'ledger.sqlite'), fetchImpl: async () => { calls++; throw new Error('Synthetic uncertain transport outcome.'); } });
  let flow = new AutomaticSupport(provider, path, { liveEnabled: true });
  try {
    const original = snapshot(); flow.enqueue(original); await flow.tick(); flow.close();
    flow = new AutomaticSupport(provider, path, { liveEnabled: true }); await flow.tick(); await flow.tick();
    assert.equal(flow.get(original.id)?.status, 'reconciliation'); assert.equal(calls, 1); assert.equal(provider.capacity(3).ready, false);
  } finally { flow.close(); provider.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('invalid repair output stops before another grade, preserving immutable original', async () => {
  const h = harness(['repair', 'pass'], true), flow = new AutomaticSupport(h.provider, h.path, { liveEnabled: true });
  try {
    const original = snapshot(); flow.enqueue(original); await flow.tick(); await flow.tick(); await flow.tick();
    const checked = flow.get(original.id)!;
    assert.equal(checked.status, 'inconclusive'); assert.equal(checked.repaired, undefined); assert.equal(h.calls.length, 2);
    assert.deepEqual(checked.original, original);
  } finally { flow.close(); h.cleanup(); }
});

test('capacity loss ends pending check without dispatch while disabled live queue waits', async () => {
  const h = harness(['repair', 'pass']); let exhausted = false;
  const wrapped: AutomaticSupportProvider = { receipt: h.provider.receipt.bind(h.provider), readiness: h.provider.readiness.bind(h.provider), gradeClaimSupport: h.provider.gradeClaimSupport.bind(h.provider), reviseAutomatic: h.provider.reviseAutomatic.bind(h.provider),
    capacity: count => exhausted ? { ready: false, reason: 'Fixture shared capacity exhausted.' } : h.provider.capacity(count) };
  let flow = new AutomaticSupport(wrapped, h.path, { liveEnabled: true });
  try {
    const original = snapshot(); flow.enqueue(original); await flow.tick(); flow.close();
    flow = new AutomaticSupport(wrapped, h.path); await flow.tick(); assert.equal(flow.get(original.id)?.status, 'queued'); assert.equal(h.calls.length, 1);
    flow.close(); exhausted = true; flow = new AutomaticSupport(wrapped, h.path, { liveEnabled: true }); await flow.tick();
    assert.equal(flow.get(original.id)?.status, 'inconclusive'); assert.equal(h.calls.length, 1);
  } finally { flow.close(); h.cleanup(); }
});

test('synthetic workflow repairs and checks with no ledger, tokens or external calls', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'automatic-synthetic-')), provider = new SyntheticAnswerProvider(join(directory, 'receipts.sqlite'));
  const flow = new AutomaticSupport(provider, join(directory, 'review.sqlite'));
  try {
    const original = snapshot('synthetic'); flow.enqueue(original);
    await flow.tick(); await flow.tick(); await flow.tick(); await flow.tick();
    const checked = flow.get(original.id)!;
    assert.equal(checked.status, 'repaired'); assert.equal(checked.operations.length, 3); assert.match(checked.delivery!.answer.answer, /^SYNTHETIC/);
    assert.equal(checked.assessmentKind, 'synthetic_scripted_claim_support');
    assert(checked.assessments.every(item => item.usage === null && item.assessment.assessmentKind === 'synthetic_scripted_claim_support'));
    const db = new DatabaseSync(join(directory, 'receipts.sqlite'));
    assert.equal((db.prepare("SELECT name FROM sqlite_master WHERE name='loop_provider_calls'").all()).length, 0); db.close();
  } finally { flow.close(); provider.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('mutated context hash stops before a provider reservation', async () => {
  const h = harness(['pass']), flow = new AutomaticSupport(h.provider, h.path, { liveEnabled: true });
  try {
    const original = snapshot(), job = flow.enqueue(original);
    job.originalAnswerSha256 = createHash('sha256').update('different original').digest('hex'); expire(h.path, job);
    await flow.tick(); assert.equal(flow.get(original.id)?.status, 'inconclusive'); assert.equal(h.calls.length, 0);
  } finally { flow.close(); h.cleanup(); }
});

test('new checks freeze explicit v4 bindings, replay them after restart, and reject incompatible or unqualified scope', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'automatic-v4-')), path = join(directory, 'checks.sqlite'), provider = new SyntheticAnswerProvider(join(directory, 'receipts.sqlite'));
  const binding = createRuntimeGraderBinding('synthetic', CITED_APPLICABILITY_GRADER_VERSION); let flow = new AutomaticSupport(provider, path, { graderBinding: binding });
  try {
    const original = snapshot('synthetic'); flow.preflight(original.context, 'synthetic-preflight'); const job = flow.enqueue(original);
    assert.equal(job.graderBinding?.version, CITED_APPLICABILITY_GRADER_VERSION); assert.equal(job.graderBinding?.scope.maxAnswerCharacters, 1500); assert.equal(job.graderBinding?.qualification.liveQualified, false);
    for (let index = 0; index < 3; index++) await flow.tick(); const complete = flow.get(original.id)!; assert.equal(complete.status, 'repaired');
    assert(complete.assessments.every(item => item.promptVersion === CITED_APPLICABILITY_GRADER_VERSION)); flow.verifyForExport(complete);
    flow.close(); flow = new AutomaticSupport(provider, path); assert.equal(flow.verifiedOverview()[0].status, 'repaired');
    const changed = structuredClone(complete); changed.graderBinding!.scope.maxAnswerCharacters = 10000; assert.throws(() => verifyAutomaticSupportEvidence(changed, provider.receipt.bind(provider)), /altered/);
    const changedGrade = structuredClone(complete); changedGrade.assessments[0].assessment.questionCoverage = 'uncertain'; assert.throws(() => verifyAutomaticSupportEvidence(changedGrade, provider.receipt.bind(provider)), /exact replay/);
    const changedUsage = structuredClone(complete); changedUsage.operations[0].usage = { inputTokens: 1, outputTokens: 1 }; assert.throws(() => verifyAutomaticSupportEvidence(changedUsage, provider.receipt.bind(provider)), /accounting/);
    const changedRepair = structuredClone(complete); changedRepair.repaired!.model = 'another-model'; assert.throws(() => verifyAutomaticSupportEvidence(changedRepair, provider.receipt.bind(provider)), /repair differs/);
    const impossibleTerminal = structuredClone(complete); impossibleTerminal.status = 'abstained'; assert.throws(() => verifyAutomaticSupportEvidence(impossibleTerminal, provider.receipt.bind(provider)), /terminal transition/);
    const oversized = snapshot('synthetic'); oversized.answer.answer = 'SYNTHETIC ' + 'x'.repeat(1500); const bounded = new AutomaticSupport(provider, ':memory:', { graderBinding: binding });
    try { assert.throws(() => bounded.enqueue(oversized), /1500/); assert.equal(bounded.overview().length, 0); } finally { bounded.close(); }
  } finally { flow.close(); provider.close(); rmSync(directory, { recursive: true, force: true }); }
  const h = harness(['pass']), blocked = new AutomaticSupport(h.provider, h.path, { liveEnabled: true, graderBinding: createRuntimeGraderBinding('live', CITED_APPLICABILITY_GRADER_VERSION) });
  try { assert.equal(blocked.readiness().ready, false); assert.throws(() => blocked.enqueue(snapshot()), /qualification/); assert.equal(h.calls.length, 0); } finally { blocked.close(); h.cleanup(); }
});

test('overlapping recovery cannot reopen a terminal job when its original grader returns late', async () => {
  for (const receiptBeforeWait of [false, true]) {
    const directory = mkdtempSync(join(tmpdir(), 'automatic-overlap-')), path = join(directory, 'checks.sqlite'), provider = new SyntheticAnswerProvider(join(directory, 'receipts.sqlite'));
    let release!: () => void, calls = 0; const waiting = new Promise<void>(resolve => { release = resolve; });
    const wrapped: AutomaticSupportProvider = { executionMode: 'synthetic', readiness: provider.readiness.bind(provider), capacity: provider.capacity.bind(provider), receipt: provider.receipt.bind(provider), reviseAutomatic: provider.reviseAutomatic.bind(provider),
      async gradeClaimSupport(input) { calls++; if (receiptBeforeWait) { const result = await provider.gradeClaimSupport(input); await waiting; return result; } await waiting; return provider.gradeClaimSupport(input); } };
    const flow = new AutomaticSupport(wrapped, path); let recovery: AutomaticSupport | undefined;
    try {
      const original = snapshot('synthetic'); original.answer.answer = 'SYNTHETIC revision — scripted source excerpts, not a model-generated answer.';
      flow.enqueue(original); const pending = flow.tick(), started = flow.get(original.id)!; expire(path, started);
      recovery = new AutomaticSupport(provider, path); const terminal = recovery.get(original.id)!; assert.equal(terminal.status, receiptBeforeWait ? 'supported' : 'reconciliation');
      release(); await pending; const late = flow.get(original.id)!; assert.deepEqual(late, terminal); assert.equal(calls, 1);
      assert.equal(late.assessments.length, receiptBeforeWait ? 1 : 0); assert.equal(late.delivery?.origin, receiptBeforeWait ? 'original' : 'safe_abstention'); flow.verifyForExport(late);
      await recovery.tick(); await flow.tick(); assert.equal(calls, 1); assert.deepEqual(flow.get(original.id), terminal);
    } finally { release(); await flow.pauseAndDrain(); recovery?.close(); flow.close(); provider.close(); rmSync(directory, { recursive: true, force: true }); }
  }
});
