import { verifySourceCoverageV2Result } from './source-coverage-v2-live.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { baselineV2, compareV2, sourceCoverageV2Corpus, SOURCE_COVERAGE_V2_FILES } from '../scripts/source-coverage-v2-retrieval.ts';
import { workspaceReviewSourceHash } from './answer-review-source.ts';
import { contextComparisonHash } from './context-comparison.ts';
import { SapiomFeedbackProvider } from './feedback-provider.ts';
import { sourceCalibrationHash as hash, readSourceCalibrationLedgerState } from './source-calibration-comparison.ts';
import { workspaceGenerationPromptIdentity, WORKSPACE_GENERATION_CONTRACT } from './workspace-generation.ts';
import { SOURCE_COVERAGE_V2_LEDGER, SOURCE_COVERAGE_V2_LIVE_FILES, prepareSourceCoverageV2Live, verifySourceCoverageV2Plan, executeSourceCoverageV2Live,
  verifySourceCoverageV2Checkpoints, privateSourceCoverageV2Output, sourceCoverageV2LiveCli, checkSourceCoverageV2Files, type SourceCoverageV2Preparation, type SourceCoverageV2Dependencies, type SourceCoverageV2Checkpoint } from './source-coverage-v2-live.ts';

type Json = Record<string, any>;
const clone = <T>(value: T): T => structuredClone(value);
const artifact = (path: string, document: Json) => ({ path, document, fileSha256: hash(JSON.stringify(document)) });
// SYNTHETIC engineering fixtures only. No natural validation source is read.
async function preparation(): Promise<SourceCoverageV2Preparation> {
  const implementationSha256 = Object.fromEntries(SOURCE_COVERAGE_V2_LIVE_FILES.map(path => [path, hash(`SYNTHETIC code ${path}`)]));
  const freeze = artifact('docs/SYNTHETIC-freeze.json', { generationContract: WORKSPACE_GENERATION_CONTRACT, systemInstructionsSha256: workspaceGenerationPromptIdentity().systemInstructionsSha256,
    implementationSha256: Object.fromEntries(SOURCE_COVERAGE_V2_FILES.map(path => [path, implementationSha256[path]])) });
  const cases = Array.from({ length: 12 }, (_, index) => {
    const sources = [
      { id: `base-${index}`, label: 'review', text: 'SYNTHETIC customer report: easy to use.', originalQuestion: null, reference: 'synthetic:report' },
      { id: `spec-${index}`, label: index === 1 ? 'review' : 'attribute', text: index === 1 ? 'SYNTHETIC unrecognized factory span is 22 units.' : 'dimensions:{width:18,unit:mm,note:"SYNTHETIC"}', originalQuestion: null, reference: 'synthetic:spec' }
    ].map(source => ({ ...source, sha256: workspaceReviewSourceHash(source) }));
    return { id: `synthetic-${index}`, product: { id: `SYNTH${String(index).padStart(5, '0')}`, title: `SYNTHETIC device ${index}` }, question: 'What are the item dimensions?', sources, sourcePoolSha256: contextComparisonHash(sources) };
  });
  const body = { format: 'ablatrix-source-coverage-v2-deck-v1', candidateFreeze: freeze, status: { generationPerformed: false, candidateContextInspected: false, paidExecutionAuthorized: false, qualityClaimEligible: false }, cases };
  const deck = artifact('docs/SYNTHETIC-deck.json', { ...body, deckSha256: contextComparisonHash(body) }), corpus = sourceCoverageV2Corpus(deck);
  const baseline = artifact('docs/SYNTHETIC-baseline.json', await baselineV2(deck, { async retrieve(id: string) {
    const index = cases.findIndex(item => item.product.id === id);
    return { corpusVersion: corpus.version, durationMs: 0, method: 'SYNTHETIC ranking fixture', embeddingModel: 'none', passages: corpus.passages.filter(passage => passage.productId === id && (index >= 3 || passage.id.startsWith('base-'))).map(passage => ({ ...passage, lexicalRank: 1, semanticRank: null, score: 1 })) };
  } }));
  const sourceReview = artifact('docs/SYNTHETIC-source-review.json', { format: 'ablatrix-source-coverage-v2-source-review-v1', status: 'completed', provenance: 'independent_ai_source_gap_review',
    deckFileSha256: deck.fileSha256, baselineFileSha256: baseline.fileSha256, candidateContextInspected: false, modelOutputsInspected: false,
    cases: cases.map((item, index) => ({ caseId: item.id, baselineContextSha256: baseline.document.results[index].baselineContextSha256, sourcePoolSha256: item.sourcePoolSha256,
      sourceScopeReviewed: true, baselineAndTitleReviewed: true, originalQuestionsReviewed: true, sourceGapGroup: index < 2 ? 'specification_gap' : index === 2 ? 'ineligible_or_uncertain' : 'baseline_complete_control',
      noEquivalentFactInBaseline: index < 2, baselineComplete: index >= 3, designatedFacts: index === 2 ? [] : [{ fact: 'SYNTHETIC declared fact', sourceIds: [index < 2 ? `spec-${index}` : `base-${index}`],
        quote: index === 0 ? 'width:18' : index === 1 ? 'factory span is 22 units.' : 'easy to use.', qualification: 'SYNTHETIC fixture; no quality measured.' }] })) });
  const comparison = artifact('docs/SYNTHETIC-comparison.json', compareV2(deck, baseline, sourceReview));
  const analysisProtocol = artifact('docs/evidence/retrieval-source-coverage-v2-2026-10-18/analysis-protocol-v1.json', { format: 'ablatrix-source-coverage-v2-analysis-protocol-v1', createdBeforeFreshSelection: true,
    deck: { products: 12, evaluateAllTwelve: true }, comparison: { answerContract: WORKSPACE_GENERATION_CONTRACT }, paidEligibility: { maximumAnswerCalls: 24, noPaidCallsUntilExactFreshFinancialApproval: true }, qualityClaimEligible: false, paidExecutionAuthorized: false });
  return { deck, baseline, sourceReview, comparison, analysisProtocol, implementationSha256, createdAt: '2026-10-18T12:00:00.000Z', repositoryPath: '/synthetic', outputDirectory: '/synthetic/.data/fresh-result',
    policy: { id: 'synthetic-policy', parentId: null, instructions: 'SYNTHETIC shared source-attributed answer policy with exact scope and uncertainty.', rationale: 'SYNTHETIC mechanics fixture only.', feedbackRunIds: [], status: 'baseline', mode: 'live', createdAt: '2026-10-18T00:00:00.000Z' },
    ledgerAnchor: { canonicalPath: SOURCE_COVERAGE_V2_LEDGER, pathSha256: hash(SOURCE_COVERAGE_V2_LEDGER), historicalRowsSha256: hash('SYNTHETIC historical rows'), attempts: 138, reservedUsd: 13.8, priorSpendUsd: .200281, pending: 0, owners: 0 } };
}

test('SYNTHETIC paid plan retains twelve pairs, misses and uncertain cases with one shared answer contract', async () => {
  const prep = await preparation(), manifest = prepareSourceCoverageV2Live(prep);
  assert.equal(manifest.plan.slots.length, 24); assert.equal(manifest.plan.retainedCases.length, 12);
  assert.equal(manifest.plan.retainedCases[1].sourceGapGroup, 'specification_gap'); assert.equal(manifest.plan.retainedCases[1].changedContext, false);
  assert.equal(manifest.plan.retainedCases[2].sourceGapGroup, 'ineligible_or_uncertain');
  assert.deepEqual(manifest.plan.budget, { maximumNewAttempts: 24, maximumAdditionalPlanningUsd: 2.4, absoluteCallLimit: 162, allowancePerCallUsd: .1, capUsd: 20, previousCombinedPlanningUsd: 14.000281, maximumCombinedPlanningUsd: 16.400281, allowancesAreProviderCharges: false });
  assert.deepEqual(manifest.plan.slots.slice(0, 4).map(slot => slot.arm), ['baseline', 'candidate', 'candidate', 'baseline']);
  assert.ok(manifest.plan.slots.every(slot => slot.binding.contract === WORKSPACE_GENERATION_CONTRACT && slot.requestBody.model === manifest.plan.slots[0].requestBody.model));
  const changed = clone(manifest); changed.plan.slots[0].requestBody.messages[1].content += ' '; changed.planSha256 = hash(changed.plan); assert.throws(() => verifySourceCoverageV2Plan(changed));
});

test('SYNTHETIC semantic gates reject stale review, changed code, absent fact delivery and wrong canonical budget', async () => {
  for (const mutate of [
    (p: SourceCoverageV2Preparation) => { p.sourceReview.document.candidateContextInspected = true; },
    (p: SourceCoverageV2Preparation) => { p.sourceReview.document.cases.reverse(); },
    (p: SourceCoverageV2Preparation) => { p.comparison.document.summary.sourceOnlyPaidEligibility = false; },
    (p: SourceCoverageV2Preparation) => { delete p.implementationSha256['server/workspace-generation.ts']; },
    (p: SourceCoverageV2Preparation) => { p.implementationSha256['server/workspace-source-coverage-v2.ts'] = '0'.repeat(64); },
    (p: SourceCoverageV2Preparation) => { p.ledgerAnchor.canonicalPath = '/synthetic/.data/feedback-budget.sqlite'; },
    (p: SourceCoverageV2Preparation) => { p.ledgerAnchor.attempts = 139; },
    (p: SourceCoverageV2Preparation) => { p.ledgerAnchor.reservedUsd = 0; },
    (p: SourceCoverageV2Preparation) => { p.ledgerAnchor.priorSpendUsd = 0; },
    (p: SourceCoverageV2Preparation) => { p.ledgerAnchor.pending = 1; },
    (p: SourceCoverageV2Preparation) => { p.ledgerAnchor.owners = 1; },
    (p: SourceCoverageV2Preparation) => { p.analysisProtocol.document.createdBeforeFreshSelection = false; },
  ]) { const p = await preparation(); mutate(p); assert.throws(() => prepareSourceCoverageV2Live(p)); }
  const p = await preparation();
  p.sourceReview.document.cases[0].sourceGapGroup = 'ineligible_or_uncertain'; p.sourceReview.document.cases[0].designatedFacts = [];
  p.sourceReview.fileSha256 = hash(JSON.stringify(p.sourceReview.document)); p.comparison = artifact('docs/SYNTHETIC-comparison.json', compareV2(p.deck, p.baseline, p.sourceReview));
  assert.equal(p.comparison.document.summary.deliveredMissingFacts, 0); assert.throws(() => prepareSourceCoverageV2Live(p), /designated missing fact/);
});

async function harness(options: { transportFailure?: boolean; failureAt?: number; invalidOutput?: boolean; changedBody?: boolean; duplicateTransport?: boolean; changedModel?: boolean; driftAfterReservation?: boolean } = {}) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-v2-live-SYNTHETIC-'))), dbPath = join(directory, 'ledger.sqlite');
  const initialize = new SapiomFeedbackProvider({ enabled: true, apiKey: 'SYNTHETIC-test-only', dbPath, capUsd: 20, priorSpendUsd: .200281, allowancePerCallUsd: .1, callLimit: 162 }); initialize.close();
  const db = new DatabaseSync(dbPath);
  for (let index = 0; index < 138; index++) db.prepare('INSERT INTO loop_provider_calls(id,created_at,kind,allowance_usd,status,run_id) VALUES(?,?,?,?,?,?)').run(`synthetic-historical-${index}`, '2026-10-17T00:00:00Z', 'SYNTHETIC history', .1, 'completed', `synthetic-old-${index}`);
  db.close(); const prep = await preparation();
  const initial = readSourceCalibrationLedgerState(dbPath, .200281);
  prep.ledgerAnchor.reservedUsd = initial.reservedUsd; prep.ledgerAnchor.historicalRowsSha256 = initial.historicalRowsSha256;
  const manifest = prepareSourceCoverageV2Live(prep), checkpoints: SourceCoverageV2Checkpoint[] = [], bodies: Json[] = [];
  let constructions = 0, outputs = 0, closed = false, finished = 0;
  const dependencies: SourceCoverageV2Dependencies = {
    checkFrozenFiles() { if (options.driftAfterReservation && checkpoints.at(-1)?.steps.some(step => step.attemptId) && !bodies.length) throw new Error('SYNTHETIC file drift'); },
    readLedger() { const state = readSourceCalibrationLedgerState(dbPath, .200281, manifest.plan.slots.map(slot => slot.input.runId)); return { ...state, canonicalPath: SOURCE_COVERAGE_V2_LEDGER, pathSha256: hash(SOURCE_COVERAGE_V2_LEDGER) }; },
    createProvider(hooks) {
      constructions++;
      const provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'SYNTHETIC-test-only', dbPath, capUsd: 20, priorSpendUsd: .200281, allowancePerCallUsd: .1, callLimit: 162, operationGuard: hooks.operationGuard,
        fetchImpl: async (url, init) => { if (options.changedBody) return hooks.fetchImpl(url, { ...init, body: `${init?.body} ` }); const response = await hooks.fetchImpl(url, init); if (options.duplicateTransport) await hooks.fetchImpl(url, init); return response; } });
      const close = provider.close.bind(provider); provider.close = () => { closed = true; close(); }; return provider;
    },
    transport: async (_url, init) => {
      const index = bodies.length, body = JSON.parse(String(init?.body)); bodies.push(body); assert.equal(init?.redirect, 'error');
      assert.ok(checkpoints.at(-1)?.steps[index].attemptId); assert.ok(checkpoints.at(-1)?.steps[index].dispatchIntent); assert.equal(checkpoints.at(-1)?.steps[index].dispatched, false);
      if (options.transportFailure || options.failureAt === index) throw new Error('SYNTHETIC ambiguous network');
      const payload = JSON.parse(body.messages[1].content), output = { answer: 'SYNTHETIC supported fixture answer.', status: 'answered', citations: [options.invalidOutput ? 'SYNTHETIC-nonexistent-option' : payload.quoteOptions[0].id] };
      return new Response(JSON.stringify({ model: options.changedModel && index === 1 ? 'gpt-5.6-luna' : 'gpt-luna', usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: body.tool_choice.function.name, arguments: JSON.stringify(output) } }] } }] }));
    },
    output: { create() { outputs++; }, checkpoint(value) { checkpoints.push(clone(value)); }, finish() { finished++; } }
  };
  const execute = () => executeSourceCoverageV2Live(manifest, { execute: true, liveOptIn: true, approvedPlanSha256: manifest.planSha256, transportProvenance: 'mocked_mechanics_only' }, dependencies);
  return { manifest, dependencies, checkpoints, bodies, execute, counts: () => ({ constructions, outputs, closed, finished }), cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test('SYNTHETIC execution reserves/checkpoints before every exact dispatch and verifies all 24 receipts', async () => {
  const h = await harness();
  try {
    const executed = await h.execute(); assert.equal(executed.result.transportProvenance, 'mocked_mechanics_only'); assert.equal(executed.result.completedPairs, 12);
    assert.equal(executed.result.newProviderAttempts, 24); assert.equal(executed.result.networkDispatches, 24); assert.equal(executed.result.status, 'awaiting_independent_review');
    assert.deepEqual(executed.result.usage, { inputTokens: 240, outputTokens: 120 }); assert.equal(executed.result.attemptsWithKnownUsage, 24);
    assert.equal(executed.result.qualityClaimEligible, false); assert.equal(executed.result.activationAllowed, false); assert.deepEqual(h.counts(), { constructions: 1, outputs: 1, closed: true, finished: 1 });
    assert.equal(verifySourceCoverageV2Checkpoints(h.manifest, h.checkpoints).completedAnswers, 24);
    await assert.rejects(h.execute()); assert.equal(h.bodies.length, 24, 'Existing reservations cannot resume or redispatch.');
  } finally { h.cleanup(); }
});

test('SYNTHETIC execution gates approval and opt-in before provider or output creation', async () => {
  for (const change of [{ execute: false }, { liveOptIn: false }, { approvedPlanSha256: '0'.repeat(64) }]) {
    const h = await harness();
    try { await assert.rejects(executeSourceCoverageV2Live(h.manifest, { execute: true, liveOptIn: true, approvedPlanSha256: h.manifest.planSha256, transportProvenance: 'mocked_mechanics_only', ...change }, h.dependencies)); assert.equal(h.counts().constructions, 0); assert.equal(h.counts().outputs, 0); }
    finally { h.cleanup(); }
  }
});

test('SYNTHETIC ambiguous transport, request tampering, duplicate dispatch and model drift stop without retries', async () => {
  for (const options of [{ transportFailure: true }, { changedBody: true }, { duplicateTransport: true }, { changedModel: true }, { driftAfterReservation: true }]) {
    const h = await harness(options);
    try {
      const result = await h.execute(); assert.equal(result.result.status, 'stopped'); assert.ok(result.result.newProviderAttempts <= 2); assert.ok(h.bodies.length <= 2);
      assert.equal(result.result.retries, 0); assert.ok(h.counts().closed); assert.equal(result.checkpoint.steps.filter(step => step.started).length, result.result.newProviderAttempts);
      if (options.changedBody || options.driftAfterReservation) assert.equal(h.bodies.length, 0);
      if (options.changedModel) { assert.equal(result.result.attemptsWithKnownUsage, 2); assert.deepEqual(result.result.usage, { inputTokens: 20, outputTokens: 10 }); }
      if (options.transportFailure) { assert.equal(result.result.usage, null); assert.equal(result.result.attemptsWithKnownUsage, 0); assert.deepEqual(result.result.knownUsageSubtotal, { inputTokens: 0, outputTokens: 0 }); assert.equal(typeof result.result.steps[0].attemptDurationMs, 'number'); assert.equal(result.result.steps[0].elapsedMs, null); }
      await assert.rejects(h.execute());
    } finally { h.cleanup(); }
  }
});

test('SYNTHETIC durable checkpoint observations cannot be removed or rewritten', async () => {
  const h = await harness({ transportFailure: true });
  try {
    await h.execute();
    for (const mutate of [(v: SourceCoverageV2Checkpoint) => { v.steps[0].attemptId = 'other'; }, (v: SourceCoverageV2Checkpoint) => { v.steps[0].dispatchIntent = undefined; }, (v: SourceCoverageV2Checkpoint) => { v.steps[0].startedAt = '2026-01-01T00:00:00Z'; }]) {
      const checkpoints = clone(h.checkpoints), last = clone(checkpoints.at(-1)!); mutate(last); checkpoints.push(last); assert.throws(() => verifySourceCoverageV2Checkpoints(h.manifest, checkpoints));
    }
  } finally { h.cleanup(); }
});

test('SYNTHETIC rejected completed output retains usage while partial unknown usage stays null', async () => {
  for (const options of [{ invalidOutput: true }, { failureAt: 1 }]) {
    const h = await harness(options);
    try {
      const { result } = await h.execute(); assert.equal(result.status, 'stopped');
      assert.deepEqual(result.knownUsageSubtotal, { inputTokens: 10, outputTokens: 5 }); assert.equal(result.attemptsWithKnownUsage, 1);
      if (options.invalidOutput) { assert.equal(result.completedAnswers, 0); assert.deepEqual(result.usage, result.knownUsageSubtotal); }
      else { assert.equal(result.newProviderAttempts, 2); assert.equal(result.completedAnswers, 1); assert.equal(result.usage, null); }
    } finally { h.cleanup(); }
  }
});

test('SYNTHETIC frozen raw artifact drift is rejected even when JSON content is unchanged', async () => {
  const repository = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-v2-bytes-SYNTHETIC-'))), p = await preparation(); p.repositoryPath = repository; p.outputDirectory = join(repository, '.data', 'result');
  const write = (path: string, body: string) => { const absolute = join(repository, path); mkdirSync(join(absolute, '..'), { recursive: true }); writeFileSync(absolute, body); };
  try {
    for (const path of SOURCE_COVERAGE_V2_LIVE_FILES) write(path, `SYNTHETIC code ${path}`);
    const visit = (value: any) => { if (!value || typeof value !== 'object') return; if (value.path && value.fileSha256 && value.document) write(value.path, JSON.stringify(value.document)); for (const child of Object.values(value)) visit(child); };
    for (const input of [p.deck, p.baseline, p.sourceReview, p.comparison, p.analysisProtocol]) visit(input);
    const manifest = prepareSourceCoverageV2Live(p); write(p.comparison.path, `${JSON.stringify(p.comparison.document)}\n`);
    assert.throws(() => checkSourceCoverageV2Files(manifest), 'A detached JSON-equivalent raw artifact cannot pass the byte boundary.');
  } finally { rmSync(repository, { recursive: true, force: true }); }
});

test('SYNTHETIC output is private, append-only and refuses overwrite, resume or symlink parents', () => {
  const repository = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-v2-output-SYNTHETIC-'))); mkdirSync(join(repository, '.data'));
  try {
    const directory = join(repository, '.data', 'run'), output = privateSourceCoverageV2Output(directory, repository); output.create();
    assert.equal(statSync(directory).mode & 0o777, 0o700); assert.equal(statSync(join(directory, 'checkpoint.jsonl')).mode & 0o777, 0o600);
    assert.throws(() => output.create()); assert.throws(() => privateSourceCoverageV2Output(directory, repository).create());
    symlinkSync(join(repository, '.data'), join(repository, 'alias')); assert.throws(() => privateSourceCoverageV2Output(join(repository, 'alias', 'run2'), repository).create());
  } finally { rmSync(repository, { recursive: true, force: true }); }
});

test('offline CLI exposes no execution through duplicate/unknown flags and rejects approval before credential access', async () => {
  assert.equal((await sourceCoverageV2LiveCli([]) as Json).newProviderCalls, 0);
  for (const args of [['--execute'], ['--prepare', '--preparation', 'x', '--preparation', 'y'], ['--verify', '--plan', 'x', '--transport', 'mock']]) await assert.rejects(sourceCoverageV2LiveCli(args));
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-v2-cli-SYNTHETIC-'))), path = join(directory, 'plan.json');
  try {
    writeFileSync(path, JSON.stringify(prepareSourceCoverageV2Live(await preparation())));
    const env = new Proxy({ ABLATRIX_LOOP_LIVE: '1' } as NodeJS.ProcessEnv, { get(target, key) { if (String(key).startsWith('SAPIOM_')) throw new Error('Credential accessed too early'); return target[String(key)]; } });
    await assert.rejects(sourceCoverageV2LiveCli(['--execute', '--plan', path, '--approved-plan-sha256', '0'.repeat(64)], env), /approval and live opt-in/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('SYNTHETIC interrupted durable dispatch intent reports unknown total, never definitive zero', async () => {
  const h = await harness();
  try {
    await h.execute();
    const checkpoint = clone(h.checkpoints.find(c => c.steps[0].dispatchIntent && !c.steps[0].dispatched)!);
    assert.ok(checkpoint); const result = verifySourceCoverageV2Result(h.manifest, checkpoint);
    assert.equal(result.networkDispatches, null); assert.equal(result.observedNetworkDispatches, 0); assert.equal(result.unresolvedDispatchIntents, 1); assert.equal(result.newProviderAttempts, 1);
  } finally { h.cleanup(); }
});
