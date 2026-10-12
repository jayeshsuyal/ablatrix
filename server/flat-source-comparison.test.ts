import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workspaceReviewSourceHash } from './answer-review-source.ts';
import { contextComparisonHash as hash, ContextComparisonStore } from './context-comparison.ts';
import { SapiomFeedbackProvider, flatSourceIdAnswerRequestBody } from './feedback-provider.ts';
import { FLAT_COMPARISON_CODE_FILES, flatFileHash, flatComparisonCorpus, retrieveFlatSourceComparison, prepareFlatSourceComparison, verifyFlatSourceComparison, executeFlatSourceComparison, flatComparisonFlags, flatSourceComparisonCli, privateFlatComparisonOutput, readFlatExposureMetadata, readFlatPublicExposure, metadataFingerprints, type FlatArtifact, type FlatExecution, type FlatPreparation, type FlatResult } from './flat-source-comparison.ts';
import type { DiagnosticState } from './source-id-diagnostic.ts';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const art = (name: string, document: Record<string, any>): FlatArtifact => ({ path: `synthetic/${name}.json`, fileSha256: flatFileHash(JSON.stringify(document)), document });
const bind = (document: Record<string, any>, key: string) => ({ ...document, [key]: hash(document) });
const baseline = 'Answer using only supplied product sources. Distinguish listing facts from customer reports and cite literal source quotations. Abstain when insufficient.';
async function preparation(): Promise<FlatPreparation> {
  const metadata = { workspaces: [{ inventory: 'workspace-1', products: [], runs: [] }], comparisons: [{ inventory: 'comparison-1', cases: [], reservedProducts: [] }] };
  const exposureAudit = art('exposure', bind({ metadata, metadataSha256: hash(metadata), metadataInventorySha256: metadataFingerprints(metadata).inventories, protectedProducts: [{ id: 'SYNTHETIC-PREVIOUS' }], publicIdentifierProjections: [] }, 'auditSha256'));
  const cases = Array.from({ length: 8 }, (_, n) => {
    const sources = Array.from({ length: 2 }, (_, i) => { const source = { id: `flat-source-${n}-${i}`, label: i ? 'cqa' : 'description', text: `SYNTHETIC source body for product ${n}, detail ${i}. Holds ${(n + 1) * 2} liters.`, originalQuestion: i ? `What is the capacity of synthetic product ${n}?` : null, reference: `https://example.com/synthetic/${n}/${i}` }; return { ...source, sha256: workspaceReviewSourceHash(source) }; });
    return { id: `flat-synthetic-${n}`, product: { id: `SYNTHETIC-FLAT-NEW-${n}`, title: `SYNTHETIC product ${n}` }, question: `What is the listed capacity of synthetic product ${n}?`, sources, sourcePoolSha256: hash(sources), critique: { kind: 'ai_assisted', text: 'Check the supplied source context and state supported listing details, limitations and uncertainty concisely.' } };
  });
  const cohort = art('cohort', bind({ source: { url: 'https://example.com/synthetic', license: 'Synthetic test data' }, cases, exposureAuditSha256: exposureAudit.document.auditSha256 }, 'cohortSha256'));
  const implementationSha256 = Object.fromEntries(FLAT_COMPARISON_CODE_FILES.map(path => [path, flatFileHash(readFileSync(new URL(`../${path}`, import.meta.url)))]));
  const corpus = flatComparisonCorpus(cohort), retrieval = art('retrieval', await retrieveFlatSourceComparison(cohort, { retrieve: async productId => ({ passages: corpus.passages.filter(s => s.productId === productId).map((s, i) => ({ ...s, lexicalRank: i + 1, semanticRank: i + 1, score: 1 / (i + 1) })), durationMs: 1, method: 'SYNTHETIC test retrieval', embeddingModel: 'synthetic', corpusVersion: corpus.version }), close() {} }, implementationSha256, '2026-10-11T00:00:00.000Z'));
  const audit = { passed: true, cohortFileSha256: cohort.fileSha256, orderedCaseIds: cases.map(c => c.id), cases: cases.map(c => ({ id: c.id, passed: true })) };
  const familyAudit = art('family', clone(audit)), sourceAudit = art('sources', { ...audit, retrievalFileSha256: retrieval.fileSha256, exposureAuditFileSha256: exposureAudit.fileSha256, metadataSha256: exposureAudit.document.metadataSha256, cases: cases.map(c => ({ id: c.id, passed: true, generationSourceIds: c.sources.map(s => s.id) })) });
  const publicHistorySha256 = { 'docs/synthetic-history.json': 'b'.repeat(64) };
  const qualification = art('qualification', { passed: true, newProviderCalls: 0, sourceIdInterface: 'source_ids_v3', qualityClaimEligible: false, routerConstrainedDecodingVerified: false, implementationSha256, publicHistorySha256 });
  return { cohort, retrieval, familyAudit, sourceAudit, exposureAudit, qualification, implementationSha256, publicHistorySha256, implementationCommit: 'a'.repeat(40), baselinePolicy: baseline, createdAt: '2026-10-11T00:00:00.000Z' };
}
type Body = ReturnType<typeof flatSourceIdAnswerRequestBody>;
const payload = (body: Body) => JSON.parse(body.messages[1].content);
const valid = (body: Body, index: number) => ({ answer: `SYNTHETIC response ${index}; no quality judgment.`, status: 'answered', citations: [payload(body).quoteOptions[0].id] });
const before: DiagnosticState = { ledgerAttempts: 86, pendingReservations: 0, activeOwners: 0, activeOwnerPid: null, activeReviewJobs: 0, historicalReceiptsSha256: 'opaque-prior-receipts', reviewStateSha256: 'opaque-review-history', newRunIds: [] };
async function harness(response: (body: Body, index: number) => unknown = valid, model: (index: number) => string = () => 'gpt-luna') {
  const prep = await preparation(), manifest = prepareFlatSourceComparison(prep), checkpoints: FlatResult[] = [], bodies: Body[] = [], store = new ContextComparisonStore(':memory:');
  const receipts = new Map<string, NonNullable<ReturnType<SapiomFeedbackProvider['receipt']>>>(); let providerCreations = 0, outputCreations = 0, imports = 0, closed = false, liveProvider: SapiomFeedbackProvider | undefined;
  const ids = manifest.plan.order.map(s => `flat-${manifest.planSha256.slice(0, 14)}-${hash(s.caseId).slice(0, 16)}-${s.arm}`);
  const deps: FlatExecution = { preparation: prep, approvedPlanSha256: manifest.planSha256, implementationMerged: true, env: { ABLATRIX_LOOP_LIVE: '1', ABLATRIX_REVISION_WEB: '0', ABLATRIX_LOOP_CALL_LIMIT: '110', ABLATRIX_SPEND_CAP_USD: '12' },
    inspectApp: () => ({ configuredPort: 4173, checkedPorts: [4173], listenerPids: [], sharedFileOwnerPids: [], activeLockPids: [], stopped: true }), publicHistory: () => clone(prep.publicHistorySha256), publicExposure: () => manifest.plan.publicExposureSha256, metadata: () => clone(manifest.plan.metadata),
    readState: () => { if (liveProvider && !closed) for (const id of ids) { const receipt = liveProvider.receipt(id); if (receipt) receipts.set(id, receipt); } return { ...before, ledgerAttempts: 86 + receipts.size, pendingReservations: [...receipts.values()].filter(r => r.status === 'pending').length, newRunIds: [...receipts.keys()] }; },
    output: { create: result => { outputCreations++; checkpoints.push(result); }, save: result => checkpoints.push(result) },
    createProvider: fetchImpl => { providerCreations++; const p = new SapiomFeedbackProvider({ enabled: true, apiKey: 'synthetic-test-key-not-a-credential', dbPath: ':memory:', capUsd: 12, priorSpendUsd: .200281, allowancePerCallUsd: .1, callLimit: 110, fetchImpl }); liveProvider = p;
      const remember = (id: string) => { const r = p.receipt(id); if (r) receipts.set(id, r); return r; };
      return { capacity: n => p.capacity(n), receipt: remember, answerWithFlatSourceIds: async input => { try { return await p.answerWithFlatSourceIds(input); } finally { if (input.runId) remember(input.runId); } }, reviseWithFlatSourceIds: async input => { try { return await p.reviseWithFlatSourceIds(input); } finally { if (input.runId) remember(input.runId); } }, close: () => { closed = true; p.close(); } }; },
    transport: async (_url, init) => { const body: Body = JSON.parse(String(init?.body)), index = bodies.length; bodies.push(body); const saved = checkpoints.at(-1)!;
      assert.equal(saved.networkDispatches, index); assert.equal(saved.boundaryChecks.at(-1)?.phase, 'before_transport'); assert.ok(saved.boundaryChecks.at(-1)?.passed); const step = saved.steps.find(s => s.status === 'dispatching')!; assert.ok(step.dispatchIntentAt); assert.deepEqual(step.requestBody, body); assert.equal(step.requestSha256, flatFileHash(String(init?.body))); assert.equal(init?.redirect, 'error');
      return new Response(JSON.stringify({ model: model(index), usage: { prompt_tokens: 20, completion_tokens: 7 }, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: body.tool_choice.function.name, arguments: JSON.stringify(response(body, index)) } }] } }] })); },
    importPacket: packet => { imports++; return store.importPacket(packet); }
  };
  return { manifest, deps, checkpoints, bodies, receipts, store, counts: () => ({ providerCreations, outputCreations, imports, closed }) };
}

test('offline preparation binds eight disjoint source pools, audited ordered retrieval, dynamic enums and all-original-first sibling order', async () => {
  const prep = await preparation(), manifest = prepareFlatSourceComparison(prep); assert.equal(manifest.plan.cases.length, 8); assert.equal(manifest.plan.order.length, 24); assert.ok(manifest.plan.order.slice(0, 8).every(s => s.arm === 'original'));
  assert.deepEqual(manifest.plan.order.slice(8, 12).map(s => s.arm), ['baseline', 'candidate', 'candidate', 'baseline']); assert.deepEqual(manifest.plan.limits, { initialLedgerAttempts: 86, maximumNewAttempts: 24, absoluteCallLimit: 110, planningAllowancePerAttemptUsd: .1, maximumPlanningAllowanceUsd: 2.4, capUsd: 12, priorSpendUsd: .200281, web: false, retries: 0 });
  for (const c of manifest.plan.cases) for (const body of [c.originalRequest, c.templates.baseline, c.templates.candidate]) { assert.deepEqual(payload(body).quoteOptions, payload(c.originalRequest).quoteOptions); assert.equal(flatFileHash(JSON.stringify(body.tools[0].function.parameters)), c.responseSchemaSha256); assert.deepEqual((body.tools[0].function.parameters as any).properties.citations.items.enum, payload(body).quoteOptions.map((o: any) => o.id)); }
  const changes: ((p: FlatPreparation) => void)[] = [p => { p.sourceAudit.document.cases[0].generationSourceIds.reverse(); }, p => { p.familyAudit.document.passed = false; }, p => { p.sourceAudit.document.retrievalFileSha256 = '0'.repeat(64); }, p => { p.sourceAudit.document.metadataSha256 = '0'.repeat(64); }, p => { p.qualification.document.sourceIdInterface = 'source_ids_v2'; }, p => { p.retrieval.document.retrievals[0].retrieval.passages.reverse(); }, p => { p.cohort.document.cases[0].sources[0].originalQuestion = 'Altered context'; }, p => { p.exposureAudit.document.metadata.workspaces[0].runs.push({ question: 'New exposure' }); }];
  for (const change of changes) { const altered = clone(prep); change(altered); assert.throws(() => prepareFlatSourceComparison(altered)); }
});

test('exact approval, code, protocol, budgets, app, ledger and freshness gates reject before provider or output creation', async () => {
  const changes: ((h: Awaited<ReturnType<typeof harness>>) => void)[] = [h => { h.deps.approvedPlanSha256 = '0'.repeat(64); }, h => { (h.manifest.plan.limits as { maximumNewAttempts: number }).maximumNewAttempts = 25; h.manifest.planSha256 = hash(h.manifest.plan); h.deps.approvedPlanSha256 = h.manifest.planSha256; }, h => { h.deps.preparation.implementationSha256[FLAT_COMPARISON_CODE_FILES[0]] = '0'.repeat(64); }, h => { h.deps.implementationMerged = false; }, h => { h.deps.env.ABLATRIX_LOOP_LIVE = '0'; }, h => { h.deps.env.ABLATRIX_REVISION_WEB = '1'; }, h => { h.deps.env.ABLATRIX_LOOP_CALL_LIMIT = '111'; }, h => { h.deps.env.ABLATRIX_SPEND_CAP_USD = '13'; }, h => { h.deps.publicHistory = () => ({}); }, h => { h.deps.publicExposure = () => 'new-public-exposure'; }, h => { h.deps.metadata = () => ({ sha256: 'changed', inventories: {} }); }, h => { const check = h.deps.inspectApp; h.deps.inspectApp = () => ({ ...check(), stopped: false, sharedFileOwnerPids: [999] }); }, ...(['ledgerAttempts', 'pendingReservations', 'activeOwners', 'activeReviewJobs'] as const).map(field => (h: Awaited<ReturnType<typeof harness>>) => { h.deps.readState = () => ({ ...before, [field]: field === 'ledgerAttempts' ? 85 : 1 }); })];
  for (const change of changes) { const h = await harness(); try { change(h); await assert.rejects(executeFlatSourceComparison(h.manifest, h.deps)); assert.deepEqual(h.counts(), { providerCreations: 0, outputCreations: 0, imports: 0, closed: false }); assert.equal(h.bodies.length, 0); } finally { h.store.close(); } }
});

test('24 injected v3 responses use actual original for both siblings and import all eight for blinded pending human review', async () => {
  for (const model of ['gpt-luna', 'gpt-5.6-luna']) { const h = await harness(valid, () => model); try {
    const result = await executeFlatSourceComparison(h.manifest, h.deps); assert.equal(result.status, 'awaiting_blind_human_review'); assert.equal(result.newProviderAttempts, 24); assert.equal(result.networkDispatches, 24); assert.equal(result.acceptedOutputs, 24); assert.equal(h.counts().imports, 1); assert.equal(result.comparisonPacket!.cases.length, 8); assert.ok(result.metadataUnchangedBeforeImport && result.publicHistoryUnchanged && result.existingReceiptsUnchanged && result.existingReviewStateUnchanged);
    for (const [i, step] of result.steps.entries()) { const c = h.manifest.plan.cases.find(c => c.id === step.caseId)!; assert.equal(step.result!.citationInterface, 'source_ids_v3'); assert.equal(step.result!.model, model); assert.equal(step.receipt!.allowance_usd, .1); assert.equal(step.result!.responseSchemaSha256, c.responseSchemaSha256); assert.equal(JSON.parse(step.receipt!.receipt_json!).optionSetSha256, c.optionSetSha256); assert.deepEqual(payload(h.bodies[i]).quoteOptions, payload(c.originalRequest).quoteOptions); if (step.arm !== 'original') assert.equal(payload(h.bodies[i]).rejectedAnswer, result.steps.find(s => s.caseId === step.caseId && s.arm === 'original')!.result!.answer.answer); }
    const view = h.store.get(h.manifest.plan.id); assert.equal(view.reviewedAnswers, 0); assert.equal(view.reviewableAnswers, 16); const rendered = JSON.stringify(view); assert.ok(!rendered.includes('gpt-luna') && !rendered.includes('gpt-5.6-luna') && !rendered.includes('candidate_v4') && !rendered.includes('latencyMs')); assert.equal(result.qualityClaimEligible, false); assert.equal(result.humanJudgments, 0); assert.equal(result.actualProviderCharges, 'unavailable');
  } finally { h.store.close(); } }
});

test('first original failure preserves 24-step denominator and never imports placeholders or retries', async () => {
  const h = await harness(body => ({ ...valid(body, 0), citations: ['src_invented'] })); try { const result = await executeFlatSourceComparison(h.manifest, h.deps); assert.equal(result.status, 'stopped'); assert.equal(result.networkDispatches, 1); assert.equal(result.newProviderAttempts, 1); assert.equal(result.acceptedOutputs, 0); assert.equal(result.steps.length, 24); assert.equal(result.steps.filter(s => s.status === 'not_attempted').length, 23); assert.equal(result.steps[0].receipt!.error_code, 'output_validation'); assert.equal(h.counts().imports, 0); } finally { h.store.close(); }
});

test('first revision failure keeps every original, failed arm and all not-attempted arms in the full eight-case import', async () => {
  const h = await harness((body, i) => i === 8 ? { ...valid(body, i), citations: ['src_invalid'] } : valid(body, i)); try { const result = await executeFlatSourceComparison(h.manifest, h.deps); assert.equal(result.status, 'stopped'); assert.equal(result.networkDispatches, 9); assert.equal(result.newProviderAttempts, 9); assert.equal(result.acceptedOutputs, 8); assert.equal(h.counts().imports, 1); assert.equal(result.comparisonPacket!.cases.length, 8); assert.equal(result.comparisonPacket!.cases[0].arms.baseline.status, 'failed'); assert.equal(result.comparisonPacket!.cases[0].arms.candidate.status, 'not_attempted'); assert.equal(result.steps.filter(s => s.status === 'not_attempted').length, 15); } finally { h.store.close(); }
});

test('mixed returned model aliases stop before another case while legitimate uncited insufficient outputs remain reviewable without a quality claim', async () => {
  const mixed = await harness(valid, i => i === 9 ? 'gpt-5.6-luna' : 'gpt-luna'); try { const result = await executeFlatSourceComparison(mixed.manifest, mixed.deps); assert.equal(result.status, 'stopped'); assert.equal(result.networkDispatches, 10); assert.equal(result.steps[9].status, 'failed_or_uncertain'); } finally { mixed.store.close(); }
  const empty = await harness(() => ({ answer: 'SYNTHETIC insufficient source context.', status: 'insufficient_evidence', citations: [] })); try { const result = await executeFlatSourceComparison(empty.manifest, empty.deps); assert.equal(result.acceptedOutputs, 24); assert.equal(result.qualityClaimEligible, false); assert.ok(result.steps.every(s => s.result!.answer.citations.length === 0)); } finally { empty.store.close(); }
});

test('observed app restart, new metadata, public evidence and review-history changes stop at repeated dispatch boundaries', async () => {
  for (const phase of ['before_transport', 'after_transport'] as const) for (const kind of ['app', 'metadata', 'history', 'review', 'public'] as const) {
    const h = await harness(), inspect = h.deps.inspectApp, metadata = h.deps.metadata, history = h.deps.publicHistory, publicExposure = h.deps.publicExposure, state = h.deps.readState; let changed = false;
    const save = h.deps.output.save; h.deps.output.save = r => { save(r); if (phase === 'before_transport' && r.steps.some(s => s.dispatchIntentAt)) changed = true; };
    const transport = h.deps.transport; h.deps.transport = async (...args) => { const response = await transport(...args); if (phase === 'after_transport') changed = true; return response; };
    h.deps.inspectApp = () => changed && kind === 'app' ? { ...inspect(), stopped: false, listenerPids: [999] } : inspect(); h.deps.metadata = () => changed && kind === 'metadata' ? { ...metadata(), sha256: 'changed' } : metadata(); h.deps.publicHistory = () => changed && kind === 'history' ? {} : history(); h.deps.publicExposure = () => changed && kind === 'public' ? 'new-public-exposure' : publicExposure(); h.deps.readState = () => changed && kind === 'review' ? { ...state(), reviewStateSha256: 'changed' } : state();
    try { const result = await executeFlatSourceComparison(h.manifest, h.deps); assert.equal(result.status, 'stopped'); assert.equal(result.networkDispatches, phase === 'before_transport' ? 0 : 1); assert.equal(result.newProviderAttempts, 1); assert.equal(h.counts().imports, 0); assert.equal(result.boundaryChecks.at(-1)?.passed, false); assert.equal(result.boundaryChecks.at(-1)?.phase, phase); assert.equal(result.steps.length, 24); } finally { h.store.close(); }
  }
});

test('failed pre-send checkpoint records no transport dispatch and existing or symlinked private outputs are refused', async () => {
  const h = await harness(), save = h.deps.output.save; let rejected = false; h.deps.output.save = r => { if (!rejected && r.steps.some(s => s.dispatchIntentAt)) { rejected = true; throw new Error('Synthetic disk failure'); } save(r); };
  try { const result = await executeFlatSourceComparison(h.manifest, h.deps); assert.equal(result.networkDispatches, 0); assert.equal(result.newProviderAttempts, 1); assert.equal(result.status, 'stopped'); } finally { h.store.close(); }
  const root = mkdtempSync(join(tmpdir(), 'flat-output-')); try { const privateRoot = join(root, '.data'), elsewhere = join(root, 'public'); mkdirSync(privateRoot); mkdirSync(elsewhere); symlinkSync(elsewhere, join(privateRoot, 'escape')); assert.throws(() => privateFlatComparisonOutput(join(privateRoot, 'escape', 'result.json'), privateRoot));
    const h = await harness(), path = join(privateRoot, 'result.json'); writeFileSync(path, 'existing'); h.deps.output = privateFlatComparisonOutput(path, privateRoot); try { await assert.rejects(executeFlatSourceComparison(h.manifest, h.deps)); assert.equal(h.counts().providerCreations, 0); assert.equal(readFileSync(path, 'utf8'), 'existing'); } finally { h.store.close(); }
    const output = privateFlatComparisonOutput(join(privateRoot, 'new.json'), privateRoot); output.create({ synthetic: true } as unknown as FlatResult); assert.equal(statSync(join(privateRoot, 'new.json')).mode & 0o777, 0o600);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('source-only metadata hashes ignore generated answers but detect new question and source exposure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flat-metadata-')), workspace = join(dir, 'workspace.sqlite'), comparison = join(dir, 'comparison.sqlite'); const w = new DatabaseSync(workspace), c = new DatabaseSync(comparison);
  try { w.exec('CREATE TABLE workspace_products(id TEXT,document TEXT); CREATE TABLE workspace_runs(id TEXT,document TEXT)'); c.exec('CREATE TABLE context_comparisons(id TEXT,document TEXT); CREATE TABLE context_comparison_exposure(mode TEXT,product_id TEXT,fingerprint TEXT)');
    const sources = [{ id: 'source1', source: 'cqa', text: 'Body', originalQuestion: 'Prior question', score: 4 }]; const run = { productId: 'p', question: 'Q', answer: { answer: 'DO NOT READ' }, retrieval: { passages: sources } };
    w.prepare('INSERT INTO workspace_products VALUES (?,?)').run('p', JSON.stringify({ id: 'p', title: 'Product', sources })); w.prepare('INSERT INTO workspace_runs VALUES (?,?)').run('r', JSON.stringify(run)); c.prepare('INSERT INTO context_comparisons VALUES (?,?)').run('x', JSON.stringify({ mode: 'live', cases: [{ product: { id: 'x', title: 'Comparison' }, question: 'Question', sources, original: { answer: 'NEVER PROJECT' } }] })); c.prepare('INSERT INTO context_comparison_exposure VALUES (?,?,?)').run('live', 'x', 'fingerprint');
    const first = readFlatExposureMetadata([workspace], [comparison]), initial = metadataFingerprints(first); assert.deepEqual(first.workspaces[0].runs[0].sources, [{ id: 'source1', label: 'cqa', text: 'Body', originalQuestion: 'Prior question', reference: null }]); assert.ok(!JSON.stringify(first).includes('DO NOT READ') && !JSON.stringify(first).includes('NEVER PROJECT'));
    run.answer.answer = 'Changed generated answer'; w.prepare('UPDATE workspace_runs SET document=?').run(JSON.stringify(run)); assert.deepEqual(metadataFingerprints(readFlatExposureMetadata([workspace], [comparison])), initial);
    run.question = 'Newly exposed question'; w.prepare('UPDATE workspace_runs SET document=?').run(JSON.stringify(run)); assert.notDeepEqual(metadataFingerprints(readFlatExposureMetadata([workspace], [comparison])), initial);
  } finally { w.close(); c.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('CLI flag sets are exact and reject bad approval before any runtime environment or output access', async () => {
  const names = ['--cohort', '--retrieval', '--family-audit', '--source-audit', '--exposure-audit', '--qualification', '--out']; assert.equal(flatComparisonFlags(['--prepare', ...names.flatMap(n => [n, 'synthetic'])]).command, '--prepare'); assert.throws(() => flatComparisonFlags(['--prepare', ...names.flatMap(n => [n, 'synthetic']), '--unknown', 'x'])); assert.throws(() => flatComparisonFlags(['--execute', '--plan', 'x', '--out', 'x']));
  const dir = mkdtempSync(join(tmpdir(), 'flat-cli-')); try { const file = join(dir, 'plan.json'), manifest = prepareFlatSourceComparison(await preparation()); writeFileSync(file, JSON.stringify(manifest)); await assert.rejects(flatSourceComparisonCli(['--execute', '--plan', file, '--approved-plan-sha256', '0'.repeat(64), '--out', join(dir, 'never-created.json')])); } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('a temporary boundary block before first revision stays not_attempted with no fabricated receipt or provider outcome', async () => {
  const h = await harness(), original = h.deps.inspectApp; let blocked = false;
  h.deps.inspectApp = () => { if (h.bodies.length === 8 && h.receipts.size === 8 && h.checkpoints.at(-1)?.steps.filter(s => s.status === 'completed').length === 8 && !blocked) { blocked = true; return { ...original(), stopped: false, listenerPids: [999] }; } return original(); };
  try { const result = await executeFlatSourceComparison(h.manifest, h.deps); assert.equal(result.status, 'stopped'); assert.equal(result.newProviderAttempts, 8); assert.equal(result.networkDispatches, 8); assert.equal(result.steps[8].status, 'not_attempted'); assert.equal(result.steps[8].receipt, null); assert.equal(h.counts().imports, 1); assert.equal(result.comparisonPacket!.cases.length, 8);
    for (const c of result.comparisonPacket!.cases) for (const arm of Object.values(c.arms)) { assert.equal(arm.status, 'not_attempted'); assert.equal(arm.providerCallId, null); assert.equal(arm.model, null); assert.equal(arm.latencyMs, null); assert.equal(arm.usage, null); assert.equal(arm.answer, null); }
  } finally { h.store.close(); }
});


test('public exposure inventory detects new same-cohort or unrelated product files and README changes; exclusions require unchanged raw bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'flat-public-')); try { mkdirSync(join(root, 'docs')); writeFileSync(join(root, 'README.md'), 'No product identifiers.');
    const published = { path: 'docs/cohort.json', fileSha256: flatFileHash('B000000001') }; writeFileSync(join(root, published.path), 'B000000001');
    const manifest = { path: join(root, 'docs/plan.json'), fileSha256: flatFileHash('B000000001') }; writeFileSync(manifest.path, 'B000000001');
    const initial = readFlatPublicExposure(root, [published], manifest); assert.deepEqual(initial, []);
    for (const extension of ['json', 'csv', 'tsv', 'txt', 'html']) for (const id of ['B000000001', 'B000000099']) { const file = join(root, `docs/new-result.${extension}`); writeFileSync(file, extension === 'csv' ? `product_id,answer\n${id},SYNTHETIC\n` : id); const changed = readFlatPublicExposure(root, [published], manifest); assert.notEqual(hash(changed), hash(initial)); assert.deepEqual(changed[0].productIds, [id]); assert.equal(changed[0].path, `docs/new-result.${extension}`); rmSync(file); }
    writeFileSync(join(root, 'README.md'), 'Result B000000001'); assert.equal(readFlatPublicExposure(root, [published], manifest)[0].path, 'README.md'); writeFileSync(join(root, 'README.md'), 'No product identifiers.');
    writeFileSync(join(root, published.path), 'B000000099'); assert.throws(() => readFlatPublicExposure(root, [published], manifest), /artifact changed/); writeFileSync(join(root, published.path), 'B000000001');
    const amendment = { path: 'docs/amendment.json', fileSha256: flatFileHash('Rejected pre-generation draft B000000099') }; writeFileSync(join(root, amendment.path), 'Rejected pre-generation draft B000000099'); assert.deepEqual(readFlatPublicExposure(root, [published, amendment], manifest), []);
    writeFileSync(join(root, amendment.path), 'Altered B000000001'); assert.throws(() => readFlatPublicExposure(root, [published, amendment], manifest), /artifact changed/); rmSync(join(root, amendment.path));
    writeFileSync(manifest.path, 'B000000099'); assert.throws(() => readFlatPublicExposure(root, [published], manifest), /manifest bytes changed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('prospective preparation publications must be raw-hash-bound members of qualified public history', async () => {
  const prep = await preparation(); prep.qualification.document.preparationHistorySha256 = { 'docs/synthetic-history.json': 'b'.repeat(64) };
  const plan = prepareFlatSourceComparison(prep); assert.deepEqual(plan.plan.preparationHistorySha256, prep.qualification.document.preparationHistorySha256);
  prep.qualification.document.preparationHistorySha256['docs/unqualified-new-evidence.json'] = 'c'.repeat(64); assert.throws(() => prepareFlatSourceComparison(prep), /qualified public history/);
});


test('offline verify reconstructs the immutable plan without runtime state and rejects altered plan or public exposure', async () => {
  const prep = await preparation(), manifest = prepareFlatSourceComparison(prep); assert.equal(flatComparisonFlags(['--verify', '--plan', 'synthetic.json']).command, '--verify'); assert.throws(() => flatComparisonFlags(['--verify', '--plan', 'synthetic.json', '--approved-plan-sha256', 'x']));
  assert.deepEqual(verifyFlatSourceComparison(manifest, prep, manifest.plan.publicExposureSha256), { verified: true, planSha256: manifest.planSha256, cases: 8, proposedCalls: 24, newProviderCalls: 0, paidExecutionAuthorized: false, qualityClaimEligible: false });
  const altered = clone(manifest); altered.plan.cases[0].shared.question = 'Altered question'; altered.planSha256 = hash(altered.plan); assert.throws(() => verifyFlatSourceComparison(altered, prep, manifest.plan.publicExposureSha256));
  assert.throws(() => verifyFlatSourceComparison(manifest, prep, 'new-public-exposure'));
});
