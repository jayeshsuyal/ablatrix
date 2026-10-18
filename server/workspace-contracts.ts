import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ProductWorkspace, type WorkspaceFaultBoundary } from './product-workspace.ts';
import { SapiomFeedbackProvider } from './feedback-provider.ts';
import { SyntheticAnswerProvider } from './synthetic-answer-provider.ts';
import { ProductRetriever, type EmbeddingFunction } from './product-retrieval.ts';
import { textHash } from './product-corpus.ts';
import { WORKSPACE_GENERATION_CONTRACT, WORKSPACE_GENERATION_TOOL } from './workspace-generation.ts';
import { workspaceSourceChunks } from './workspace-retrieval-context.ts';
import type { LoopRetriever, ProductCorpus } from './loop-types.ts';

type Checkpoint = { id: string; expected: unknown; observed: unknown; status: 'pass' | 'fail' };
type ContractCase = { id: string; checkpoints: Checkpoint[]; mechanical: 'pass' | 'fail' };
const decimalSource = 'SYNTHETIC fixture: The fictional Neral jug holds 2.75 liters and has a removable lid.';
const qualifiedSource = `${'Catalog note. '.repeat(17)}The Neral liner is dishwasher safe. This applies only when the red gasket is removed first.`;
const conflictingSource = 'A customer reports the Neral liner warped in a dishwasher despite removing the red gasket before washing.';
const question = 'Neral liner dishwasher safe';
const fixture = { decimalSource, qualifiedSource, conflictingSource, question, contextSelection: 'complete-selected-source-bodies-v1' };
const allSaved = (corpus: ProductCorpus): LoopRetriever => ({ close() {}, async retrieve(productId) { return { passages: corpus.passages.filter(item => item.productId === productId).map(item => ({ ...item, lexicalRank: 1, semanticRank: 1, score: 1 })), durationMs: 0, method: 'synthetic_all_saved_sources', embeddingModel: 'none', corpusVersion: corpus.version }; } });

/** Same fictional frozen input, current FTS/RRF selector, injected vectors. The
 * vectors make this a deterministic boundary regression, not a relevance test. */
export async function runWorkspaceQualifierFixture() {
  const provider = new SyntheticAnswerProvider(':memory:');
  const embed: EmbeddingFunction = async (texts, kind) => texts.map(text => kind === 'query' || text.includes('dishwasher safe') ? [1, 0] : text === conflictingSource ? [0.99, 0.01] : text.startsWith('Storage record') ? [0.8, 0.2] : [0, 1]);
  const workspace = new ProductWorkspace(':memory:', provider, corpus => new ProductRetriever(corpus, ':memory:', { embed, modelId: 'injected-workspace-qualifier-contract', modelRevision: 'v1' }));
  try {
    const product = workspace.createProduct({ title: 'Fictional Neral liner', sources: [
      { label: 'Manual', text: qualifiedSource, originalQuestion: 'Does this apply to model NR-2?' },
      { label: 'Conflicting report', text: conflictingSource },
      ...Array.from({ length: 6 }, (_, index) => ({ label: `Storage record ${index}`, text: `Storage record ${index}: keep the packaging label with the spare cloth.` }))
    ] });
    const run = await workspace.ask({ productId: product.id, question, mode: 'synthetic' });
    const before = run.retrieval?.passages ?? [], after = run.generationPassages ?? [];
    return {
      fixtureSha256: textHash(JSON.stringify(fixture)), status: run.status, contract: run.generationProtocol,
      retrieval: { method: run.retrieval?.method, embeddingModel: run.retrieval?.embeddingModel, selectedChunks: before.length },
      before: { factCovered: before.some(item => item.text.includes('dishwasher safe')), conditionCovered: before.some(item => item.text.includes('red gasket is removed first')), conflictCovered: before.some(item => item.text === conflictingSource) },
      after: { factCovered: after.some(item => item.text.includes('dishwasher safe')), conditionCovered: after.some(item => item.text.includes('red gasket is removed first')), conflictCovered: after.some(item => item.text === conflictingSource),
        originalQuestionPreserved: after.some(item => item.text === qualifiedSource && item.originalQuestion === 'Does this apply to model NR-2?'),
        exactBodyPreserved: after.some(item => item.text === qualifiedSource) && run.generation?.input.passages.some(item => item.text === qualifiedSource) === true,
        sourceCharacters: after.reduce((sum, item) => sum + item.text.length + (item.originalQuestion?.length ?? 0), 0) },
      boundaries: workspaceSourceChunks(qualifiedSource).map(chunk => textHash(chunk)),
      diagnosis: 'retrieved_claim_without_required_condition' as const, semanticAssessment: 'not_run' as const
    };
  } finally { workspace.close(); provider.close(); }
}

async function capture(id: string, execute: (check: (id: string, expected: unknown, observed: unknown) => void) => Promise<void>): Promise<ContractCase> {
  const checkpoints: Checkpoint[] = [];
  const check = (id: string, expected: unknown, observed: unknown) => checkpoints.push({ id, expected, observed, status: JSON.stringify(expected) === JSON.stringify(observed) ? 'pass' : 'fail' });
  try { await execute(check); } catch (error) { check('scenario_execution', 'completed', error instanceof Error ? error.name : 'unknown_error'); }
  return { id, checkpoints, mechanical: checkpoints.length && checkpoints.every(item => item.status === 'pass') ? 'pass' : 'fail' };
}

/** Uses only fresh SQLite files and an injected transport. Never adopts an
 * application ledger, reads credentials, or calls the network. */
export async function runWorkspaceContracts() {
  const cases: ContractCase[] = []; let attempts = 0;
  for (const boundary of ['before_dispatch', 'after_dispatch_intent', 'after_receipt', 'after_answer_persist'] as const) {
    cases.push(await capture(boundary, async check => {
      const directory = mkdtempSync(join(tmpdir(), 'workspace-contract-')), path = join(directory, 'workspace.sqlite');
      let calls = 0, workspace: ProductWorkspace | undefined;
      const provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'SYNTHETIC offline placeholder', credentialsFile: '', dbPath: join(directory, 'receipts.sqlite'), capUsd: 2, callLimit: 5,
        fetchImpl: async (_url, init) => {
          calls++; attempts++; const body = JSON.parse(String(init?.body)), payload = JSON.parse(body.messages[1].content), db = new DatabaseSync(path);
          try { const saved = JSON.parse((db.prepare('SELECT document FROM workspace_runs WHERE id=?').get(payload.operationRunId) as { document: string }).document);
            check('exact_request_before_transport', body, saved.generation.requestBody); check('phase_before_transport', 'dispatching', saved.generation.phase);
          } finally { db.close(); }
          return new Response(JSON.stringify({ model: 'gpt-luna', usage: { prompt_tokens: 17, completion_tokens: 11 }, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: WORKSPACE_GENERATION_TOOL, arguments: JSON.stringify({ answer: 'The fictional jug holds 2.75 liters.', status: 'answered', citations: [payload.quoteOptions[0].id] }) } }] } }] }));
        } });
      try {
        workspace = new ProductWorkspace(path, provider, allSaved, undefined, { fault(current) { if (current === boundary) throw new Error('SYNTHETIC injected interruption.'); } });
        const product = workspace.createProduct({ title: 'Fictional Neral jug', sources: [{ label: 'Manual', text: decimalSource }] }), input = { productId: product.id, question: 'What is the capacity?', mode: 'live' };
        let interrupted = false; try { await workspace.ask(input, undefined, { idempotencyKey: 'same-question', automaticCheck: true }); } catch { interrupted = true; }
        check('interruption_injected', true, interrupted); const original = workspace.proofRuns()[0]; workspace.close();
        workspace = new ProductWorkspace(path, provider, allSaved); const run = workspace.proofRuns()[0], expected = boundary === 'before_dispatch' || boundary === 'after_dispatch_intent' ? 'failed' : 'completed';
        check('restart_status', expected, run.status); check('same_run', original.id, run.id); check('no_restart_dispatch', expected === 'completed' ? 1 : 0, calls);
        check('same_request_returns_saved_run', run.id, (await workspace.ask(input, undefined, { idempotencyKey: 'same-question', automaticCheck: true })).id);
        check('duplicate_no_dispatch', expected === 'completed' ? 1 : 0, calls); check('finished_time_saved', true, Boolean(run.finishedAt) && Number.isFinite(run.durationMs) && run.durationMs! >= 0);
        check('durable_handoffs', expected === 'completed' ? [1, 1] : [0, 0], [workspace.pendingReviewSnapshots().length, workspace.automaticCheckSnapshots().length]);
        if (expected === 'completed') { check('whole_decimal_quote', decimalSource, run.answer?.citations[0]?.quote); check('new_generation_contract', WORKSPACE_GENERATION_CONTRACT, run.generationProtocol); }
      } finally { workspace?.close(); provider.close(); rmSync(directory, { recursive: true, force: true }); }
    }));
  }
  cases.push(await capture('reserved_unknown_late_response', async check => {
    const directory = mkdtempSync(join(tmpdir(), 'workspace-contract-')), path = join(directory, 'workspace.sqlite');
    let release!: () => void, entered!: () => void, calls = 0; const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'SYNTHETIC offline placeholder', credentialsFile: '', dbPath: join(directory, 'receipts.sqlite'), capUsd: 2, callLimit: 5, fetchImpl: async (_url, init) => {
      calls++; attempts++; const payload = JSON.parse(JSON.parse(String(init?.body)).messages[1].content); entered(); await gate;
      return new Response(JSON.stringify({ model: 'gpt-luna', usage: { prompt_tokens: 17, completion_tokens: 11 }, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: WORKSPACE_GENERATION_TOOL, arguments: JSON.stringify({ answer: 'The jug holds 2.75 liters.', status: 'answered', citations: [payload.quoteOptions[0].id] }) } }] } }] }));
    } });
    const first = new ProductWorkspace(path, provider, allSaved); let second: ProductWorkspace | undefined;
    try {
      const product = first.createProduct({ title: 'Fictional jug', sources: [{ label: 'Manual', text: decimalSource }] }), input = { productId: product.id, question: 'Capacity?', mode: 'live' };
      const pending = first.ask(input, undefined, { idempotencyKey: 'unknown-question' }); await started;
      check('receipt_reserved_before_recovery', 'pending', provider.receipt(first.proofRuns()[0].id)?.status);
      second = new ProductWorkspace(path, provider, allSaved); check('unknown_is_terminal', 'failed', second.proofRuns()[0].status);
      release(); const late = await pending; check('late_response_cannot_reopen', 'failed', late.status); check('late_answer_not_delivered', null, late.answer);
      check('unknown_duplicate_is_same_run', late.id, (await second.ask(input, undefined, { idempotencyKey: 'unknown-question' })).id); check('no_unknown_retry', 1, calls);
    } finally { release(); second?.close(); first.close(); provider.close(); rmSync(directory, { recursive: true, force: true }); }
  }));
  cases.push(await capture('qualifier_context_restoration', async check => {
    const result = await runWorkspaceQualifierFixture();
    check('original_failure_reproduced', { factCovered: true, conditionCovered: false, conflictCovered: true }, result.before);
    check('restored_fact', true, result.after.factCovered); check('restored_condition', true, result.after.conditionCovered); check('selected_conflict_retained', true, result.after.conflictCovered);
    check('exact_source_body', true, result.after.exactBodyPreserved); check('original_question_metadata', true, result.after.originalQuestionPreserved); check('bounded_context', true, result.after.sourceCharacters <= 12_000); check('generation_completed', 'completed', result.status);
  }));
  return { suite: 'offline-workspace-generation-v1', fixtureSha256: textHash(JSON.stringify(fixture)), provenance: 'synthetic_scripted_transport' as const,
    contract: WORKSPACE_GENERATION_CONTRACT, contextSelection: fixture.contextSelection, embeddingModel: 'injected-workspace-qualifier-contract@v1', cases,
    mechanical: cases.every(item => item.mechanical === 'pass') ? 'pass' as const : 'fail' as const, syntheticTransportAttempts: attempts, paidProviderCalls: 0, humanDecisions: 0, semanticAssessment: 'not_run' as const, qualityClaimEligible: false,
    limitations: ['Injected vectors and scripted output establish failure-boundary mechanics and the constructed qualifier regression only; natural-product retrieval coverage and answer benefit remain unmeasured.', 'Complete-body restoration preserves sources selected by the current retriever; it does not recover a source that the retriever never selects.'] };
}
