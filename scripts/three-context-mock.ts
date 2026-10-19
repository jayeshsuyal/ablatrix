/** SYNTHETIC mechanics demonstration, not answer-quality evidence. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSourceCalibrationLedgerState } from '../server/source-calibration-comparison.ts';
import { SapiomFeedbackProvider } from '../server/feedback-provider.ts';
import { textHash } from '../server/product-corpus.ts';
import { prepareThreeContext, executeThreeContext, diagnosticHash, anonymousDiagnosticReview, DIAGNOSTIC_LEDGER, type DiagnosticPreparation, type DiagnosticCheckpoint } from '../server/three-context-diagnostic.ts';
import { workspaceGenerationParts } from '../server/workspace-generation.ts';
export function syntheticPreparation(): DiagnosticPreparation {
  const product = { id: 'synthetic-torch', title: 'SYNTHETIC torch ZX-1', split: 'development' as const };
  const passage = (id: string, text: string, originalQuestion?: string) => ({ id, productId: product.id, source: 'review', reference: 'SYNTHETIC', text, sha256: textHash(text), lexicalRank: null, semanticRank: null, score: 0, ...(originalQuestion ? { originalQuestion } : {}) });
  const sources = [passage('base', 'SYNTHETIC durable housing.'), passage('duration', 'SYNTHETIC nearly eight hours before manual extinguishing.', 'How long did model ZX-1 burn?'), passage('conflict', 'SYNTHETIC five to six hours with unknown conditions.')];
  return { cases: [{ id: 'synthetic-case', product, question: 'Once filled, how long do they last?', completeSources: sources, contexts: { current: sources.slice(0, 1), semantic: sources, reference: sources.slice(1) }, designatedFacts: [{ fact: 'SYNTHETIC duration observations', quote: 'nearly eight hours', sourceIds: ['duration'], qualification: 'Manually extinguished, not a measured average.' }], referenceReview: { provenance: 'source_checked_ai', reviewer: 'SYNTHETIC fixture reference', sufficientFor: 'SYNTHETIC attributed observations only', unknowns: ['SYNTHETIC population average and conditions unknown'], sourcePoolSha256: diagnosticHash(sources) } }], policy: { id: 'synthetic-policy', parentId: null, instructions: 'SYNTHETIC shared answer policy: attribute source reports, preserve scope and uncertainty.', rationale: 'SYNTHETIC mechanics only', feedbackRunIds: [], status: 'baseline', mode: 'live', createdAt: '2026-10-19T00:00:00Z' }, implementationSha256: { 'server/three-context-diagnostic.ts': '0'.repeat(64) }, artifactSha256: { 'docs/SYNTHETIC-source.json': '1'.repeat(64) }, ledger: { canonicalPath: DIAGNOSTIC_LEDGER, historicalRowsSha256: '2'.repeat(64), attempts: 138, reservedUsd: 13.8, priorSpendUsd: .200281, pending: 0, owners: 0 }, codeReviewPassed: true };
}
export async function mockedThreeContext(options: { failure?: boolean; modelDrift?: boolean; invalidCitation?: boolean; duplicate?: boolean; noBenefit?: boolean; tamperBinding?: boolean } = {}, preparation?: DiagnosticPreparation) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-three-context-SYNTHETIC-'))), p = preparation ?? syntheticPreparation();
  if (options.noBenefit) p.cases[0]!.contexts.semantic = p.cases[0]!.contexts.current;
  const dbPath = join(directory, 'synthetic-ledger.sqlite');
  const initialize = new SapiomFeedbackProvider({ enabled: true, apiKey: 'SYNTHETIC-test-only', dbPath, capUsd: 20, priorSpendUsd: .200281, allowancePerCallUsd: .1, callLimit: p.cases.length * 3 }); initialize.close();
  const manifest = prepareThreeContext(p), checkpoints: DiagnosticCheckpoint[] = []; let calls = 0, creations = 0, closed = false, constructions = 0;
  try {
    const result = await executeThreeContext(manifest, { execute: true, liveOptIn: true, approvedSha256: manifest.sha256, provenance: 'mocked_mechanics_only' }, {
      checkBindings() { if (options.tamperBinding) throw new Error('SYNTHETIC frozen binding changed'); return { implementationSha256: p.implementationSha256, artifactSha256: p.artifactSha256 }; }, checkLedger(steps) { const state = readSourceCalibrationLedgerState(dbPath, .200281, manifest.document.slots.map(s => s.input.runId)); assert.ok(steps.filter(s => s.attemptId).length <= p.cases.length * 3); return { ...state, canonicalPath: p.ledger.canonicalPath, historicalRowsSha256: p.ledger.historicalRowsSha256, attempts: 138 + state.attempts, reservedUsd: 13.8 + state.reservedUsd }; }, create() { assert.equal(creations++, 0); }, checkpoint(c) { checkpoints.push(c); },
      createProvider(hooks) {
        constructions++;
        const provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'SYNTHETIC-test-only', dbPath, capUsd: 20, priorSpendUsd: .200281, allowancePerCallUsd: .1, callLimit: p.cases.length * 3, operationGuard: hooks.operationGuard,
          fetchImpl: async (url, init) => { const response = await hooks.fetchImpl(url, init); if (options.duplicate) await hooks.fetchImpl(url, init); return response; } });
        const close = provider.close.bind(provider); provider.close = () => { closed = true; close(); }; return provider;
      },
      transport: async (_url, init) => {
        const index = calls++, body = JSON.parse(String(init?.body)), payload = JSON.parse(body.messages[1].content);
        assert.equal(init?.redirect, 'error'); assert.ok(checkpoints.at(-1)!.steps[index]!.dispatchIntent); assert.equal(checkpoints.at(-1)!.steps[index]!.dispatched, false);
        if (options.failure) throw new Error('SYNTHETIC ambiguous transport');
        const output = { answer: 'SYNTHETIC source-attributed report; average remains unknown.', status: 'answered', citations: [options.invalidCitation ? 'bad-source-id' : payload.quoteOptions[0].id] };
        return new Response(JSON.stringify({ model: options.modelDrift && index === 1 ? 'gpt-5.6-luna' : 'gpt-luna', usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: body.tool_choice.function.name, arguments: JSON.stringify(output) } }] } }] }));
      }
    });
    const anonymous = anonymousDiagnosticReview(manifest, result.checkpoint, 'SYNTHETIC-secret-at-least-sixteen');
    return { manifest, ...result, checkpoints, calls, constructions, closed, anonymous };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await mockedThreeContext(); assert.equal(result.result.completedAnswers, 3); assert.equal(result.calls, 3);
  console.log(JSON.stringify({ provenance: 'SYNTHETIC mocked mechanics only', completedAnswers: 3, transportCalls: result.calls, realProviderCalls: 0, retries: 0, anonymousAnswers: result.anonymous.review.answers.length, qualityClaimEligible: false }));
}
