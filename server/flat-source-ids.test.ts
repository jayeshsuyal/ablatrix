import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { LoopProvider } from './loop-types.ts';
import {
  SapiomFeedbackProvider, FLAT_SOURCE_ID_CITATION_INTERFACE, type RevisionInput,
  flatSourceIdAnswerPromptIdentity, flatSourceIdRevisionPromptIdentity, flatSourceIdAnswerRequestBody, flatSourceIdRevisionRequestBody,
  constrainedSourceIdAnswerRequestBody, constrainedSourceIdRevisionRequestBody, constrainedSourceIdAnswerPromptIdentity, constrainedSourceIdRevisionPromptIdentity,
  sourceIdAnswerRequestBody, sourceIdRevisionRequestBody, revisionRequestBody,
} from './feedback-provider.ts';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const input: Parameters<LoopProvider['answer']>[0] = {
  runId: 'synthetic-flat-original', question: 'What are the shelf dimensions?', product: { id: 'synthetic-flat-shelf', title: 'SYNTHETIC shelf fixture', split: 'development' },
  policy: { id: 'synthetic', parentId: null, instructions: 'Use supplied sources and preserve uncertainty.', rationale: 'SYNTHETIC test policy.', feedbackRunIds: [], status: 'baseline', mode: 'fixture', createdAt: '2026-10-12T00:00:00.000Z' },
  passages: [
    { id: 'listing', productId: 'synthetic-flat-shelf', source: 'attribute', text: 'dimensions: { length:{ unit:inches, value:21.5 }, height:{ unit:inches, value:12. } }', reference: 'synthetic://listing', sha256: 'synthetic', lexicalRank: 1, semanticRank: 1, score: 1 },
    { id: 'customer', productId: 'synthetic-flat-shelf', source: 'cqa', text: 'It fits my unit.', originalQuestion: 'Will this fit model AB100?', reference: 'synthetic://customer', sha256: 'synthetic', lexicalRank: 2, semanticRank: 2, score: 1 },
  ],
};
const revision: RevisionInput = { runId: 'synthetic-flat-revision', question: input.question, product: input.product, rejectedAnswer: 'SYNTHETIC placeholder original.', critique: 'Check dimensions and retain the original customer-question scope.', evidence: input.passages, investigation: { issue: 'answer_quality', query: input.question, selectedSourceIds: input.passages.map(s => s.id), addedSourceIds: [] } };
const settings = { enabled: true, apiKey: 'synthetic-test-only-not-a-credential', dbPath: ':memory:', capUsd: 10, priorSpendUsd: 0, allowancePerCallUsd: .1, callLimit: 20 };
type Body = ReturnType<typeof flatSourceIdAnswerRequestBody>;
const payload = (body: Body) => JSON.parse(body.messages[1].content);
const schema = (body: Body) => body.tools[0].function.parameters as { properties: { citations: { type: string; maxItems: number; uniqueItems: boolean; items: { type: string; enum: string[] } } }; required: string[] };
const reply = (body: Body, output: unknown, model = 'gpt-5.6-luna') => new Response(JSON.stringify({ model, usage: { prompt_tokens: 10, completion_tokens: 4 }, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: body.tool_choice.function.name, arguments: JSON.stringify(output) } }] } }] }));
const valid = (body: Body) => ({ answer: `SYNTHETIC listed dimensions. [${payload(body).quoteOptions[0].id}]`, status: 'answered', citations: [payload(body).quoteOptions[0].id] });

test('v3 original and both revision policies use flat enums with exact helper/transport/receipt parity for both model aliases', async () => {
  for (const model of ['gpt-luna', 'gpt-5.6-luna']) {
    const baseline = { ...revision, revisionPolicy: 'baseline' as const }, candidate = { ...revision, revisionPolicy: 'candidate_v4' as const };
    const bodies = [flatSourceIdAnswerRequestBody(input), flatSourceIdRevisionRequestBody(baseline), flatSourceIdRevisionRequestBody(candidate)];
    const identities = [flatSourceIdAnswerPromptIdentity(), flatSourceIdRevisionPromptIdentity(), flatSourceIdRevisionPromptIdentity('candidate_v4')];
    let calls = 0;
    const provider = new SapiomFeedbackProvider({ ...settings, fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body)); assert.equal(String(init?.body), JSON.stringify(bodies[calls++]));
      const contract = schema(body).properties.citations; assert.equal(contract.type, 'array'); assert.equal(contract.items.type, 'string'); assert.equal(contract.uniqueItems, true); assert.equal(contract.maxItems, 5);
      assert.deepEqual(contract.items.enum, payload(body).quoteOptions.map((s: { id: string }) => s.id)); assert.equal('strict' in body.tools[0].function, false);
      assert.equal(body.model, 'gpt-luna'); assert.equal(body.max_tokens, 4096); assert.equal(body.reasoning_effort, 'none'); assert.equal(body.parallel_tool_calls, false);
      return reply(body, valid(body), model);
    } });
    try {
      for (let i = 0; i < bodies.length; i++) {
        const runId = `flat-${model}-${i}`;
        const result = i === 0 ? await provider.answerWithFlatSourceIds({ ...input, runId }) : await provider.reviseWithFlatSourceIds({ ...(i === 1 ? baseline : candidate), runId });
        assert.equal(result.answer.answer, 'SYNTHETIC listed dimensions.'); assert.deepEqual(result.answer.citations, [{ passageId: input.passages[0].id, quote: input.passages[0].text }]); assert.equal(result.model, model);
        assert.equal(result.citationInterface, FLAT_SOURCE_ID_CITATION_INTERFACE); assert.equal(result.optionSetSha256, sha(JSON.stringify(payload(bodies[i]).quoteOptions))); assert.equal(result.responseSchemaSha256, sha(JSON.stringify(bodies[i].tools[0].function.parameters)));
        assert.equal(result.promptVersion, identities[i].promptVersion); assert.equal(result.systemInstructionsSha256, identities[i].systemInstructionsSha256);
        const receipt = provider.receipt(runId)!; assert.equal(receipt.id, result.attemptId); assert.equal(receipt.status, 'completed'); assert.equal(receipt.error_code, null);
        const saved = JSON.parse(receipt.receipt_json!);
        for (const key of ['citationInterface', 'promptVersion', 'systemInstructionsSha256', 'optionSetSha256', 'responseSchemaSha256'] as const) assert.equal(saved[key], result[key]);
        assert.deepEqual(saved.output.citations, result.quoteIds);
      }
      assert.equal(calls, 3);
      const normalized = bodies.slice(1).map(body => { const copy = structuredClone(body), content = payload(copy); delete content.promptVersion; copy.messages[0].content = '<policy>'; copy.messages[1].content = JSON.stringify(content); return copy; });
      assert.deepEqual(normalized[0], normalized[1]); assert.deepEqual(payload(bodies[0]).quoteOptions, payload(bodies[1]).quoteOptions);
      assert.equal(payload(bodies[0]).evidence[1].originalQuestion, 'Will this fit model AB100?'); assert.equal(payload(bodies[0]).quoteOptions.some((s: { quote: string }) => s.quote.includes('AB100')), false);
    } finally { provider.close(); }
  }
});

test('Q8746 public failure IDs resolve under the new flat contract while historical v2 still rejects the same string-array shape', async () => {
  const frozen = JSON.parse(readFileSync(new URL('../docs/evidence/source-id-diagnostic-2026-10-11/execution-plan-v3.json', import.meta.url), 'utf8'));
  const summary = JSON.parse(readFileSync(new URL('../docs/evidence/source-id-diagnostic-2026-10-11/live-summary.json', import.meta.url), 'utf8'));
  const c = frozen.plan.cases.find((c: { id: string }) => c.id === 'source-id-train-8746'); assert.ok(c);
  const ids = summary.failure.returnedQuoteIds; assert.deepEqual(ids, ['src_80109087ff1cfa0f6bf265b7', 'src_1908f1e93de82b879429d853']);
  const output = { answer: 'SYNTHETIC placeholder; this test does not assess compatibility or answer quality.', status: 'insufficient_evidence', citations: ids };
  let calls = 0; const provider = new SapiomFeedbackProvider({ ...settings, fetchImpl: async (_url, init) => { calls++; return reply(JSON.parse(String(init?.body)), output); } });
  try {
    const result = await provider.answerWithFlatSourceIds({ ...c.originalInput, runId: 'synthetic-public-failure-v3' });
    assert.deepEqual(result.quoteIds, ids); assert.equal(result.answer.status, 'insufficient_evidence'); assert.deepEqual(result.answer.citations, ids.map((id: string) => { const source = c.quoteOptions.find((s: { id: string }) => s.id === id); return { passageId: source.passageId, quote: source.quote }; }));
    await assert.rejects(provider.answerWithConstrainedSourceIds({ ...c.originalInput, runId: 'synthetic-public-failure-v2' }), /output validation/);
    assert.equal(provider.receipt('synthetic-public-failure-v2')!.error_code, 'output_validation'); assert.equal(calls, 2);
    const offered = payload(flatSourceIdAnswerRequestBody(c.originalInput)); assert.deepEqual(offered.quoteOptions, c.quoteOptions); assert.ok(offered.evidence.every((s: { originalQuestion: string }) => s.originalQuestion));
  } finally { provider.close(); }
});

test('v3 rejects wrong shapes, unknown/shortened/foreign/duplicate IDs, uncited answers and unresolved markers without coercion or retry', async () => {
  const body = flatSourceIdAnswerRequestBody(input), first = payload(body).quoteOptions[0].id, second = payload(body).quoteOptions[1].id;
  const foreign = payload(flatSourceIdAnswerRequestBody({ ...input, question: 'A different request?' })).quoteOptions[0].id;
  const base = { answer: 'SYNTHETIC response.', status: 'answered' };
  const invalid = [
    { ...base, citations: [{ quoteId: first }] }, { ...base, citations: [{ passageId: 'listing', quote: input.passages[0].text }] },
    { ...base, citations: first }, { ...base, citations: [null] }, { ...base, citations: [7] }, { ...base, citations: [] },
    { ...base, citations: ['src_unknown'] }, { ...base, citations: [first.slice(0, -1)] }, { ...base, citations: [foreign] }, { ...base, citations: [first, first] },
    { ...base, citations: [first, second, first, second, first, second] }, { ...base, citations: [' ' + first] },
    { ...base, citations: [first], extra: true }, { ...base, answer: `SYNTHETIC [${second}]`, citations: [first] },
    { ...base, answer: `SYNTHETIC ${first}`, citations: [first] }, { ...base, answer: `[${first}]`, citations: [first] },
  ];
  for (const kind of ['original', 'revision'] as const) for (const [index, output] of invalid.entries()) {
    let calls = 0; const runId = `flat-invalid-${kind}-${index}`;
    const provider = new SapiomFeedbackProvider({ ...settings, fetchImpl: async (_url, init) => { calls++; return reply(JSON.parse(String(init?.body)), output); } });
    try {
      await assert.rejects(kind === 'original' ? provider.answerWithFlatSourceIds({ ...input, runId }) : provider.reviseWithFlatSourceIds({ ...revision, runId }), /output validation/);
      assert.equal(calls, 1); const receipt = provider.receipt(runId)!; assert.equal(receipt.status, 'completed'); assert.equal(receipt.error_code, 'output_validation');
      const saved = JSON.parse(receipt.receipt_json!); assert.equal(saved.citationInterface, 'source_ids_v3'); assert.equal(saved.responseSchemaSha256, sha(JSON.stringify(body.tools[0].function.parameters)));
    } finally { provider.close(); }
  }
});

test('v3 accepts legitimate empty-citation uncertainty and rejects unknown model aliases in one attempt', async () => {
  for (const kind of ['original', 'revision'] as const) {
    let calls = 0; const provider = new SapiomFeedbackProvider({ ...settings, fetchImpl: async (_url, init) => { calls++; return reply(JSON.parse(String(init?.body)), { answer: 'SYNTHETIC: the supplied sources do not establish that relationship.', status: 'insufficient_evidence', citations: [] }, calls === 1 ? 'gpt-luna' : 'unrecognized-model'); } });
    try {
      const accepted = kind === 'original' ? await provider.answerWithFlatSourceIds(input) : await provider.reviseWithFlatSourceIds(revision);
      assert.deepEqual(accepted.answer.citations, []); assert.equal(accepted.answer.status, 'insufficient_evidence');
      const runId = `flat-model-invalid-${kind}`;
      await assert.rejects(kind === 'original' ? provider.answerWithFlatSourceIds({ ...input, runId }) : provider.reviseWithFlatSourceIds({ ...revision, runId }), /model_identity/);
      assert.equal(provider.receipt(runId)!.error_code, 'model_identity'); assert.equal(calls, 2);
    } finally { provider.close(); }
  }
});

test('v3 scopes and source bounds reject before reserving calls', async () => {
  const source = input.passages[0], invalid = [[], [source, source], [{ ...source, text: 'x'.repeat(3001) }], [{ ...source, text: '' }],
    Array.from({ length: 13 }, (_, i) => ({ ...source, id: `source-${i}` })), Array.from({ length: 5 }, (_, i) => ({ ...source, id: `source-${i}`, text: 'x'.repeat(2500) })),
    [{ ...input.passages[1], text: 'Answer. Question: Different question?', originalQuestion: 'Conflicting question?' }]];
  let calls = 0; const provider = new SapiomFeedbackProvider({ ...settings, fetchImpl: async () => { calls++; throw new Error('Unexpected transport'); } });
  try {
    for (const [i, passages] of invalid.entries()) for (const kind of ['original', 'revision'] as const) {
      const runId = `flat-preflight-${kind}-${i}`;
      await assert.rejects(kind === 'original' ? provider.answerWithFlatSourceIds({ ...input, runId, passages }) : provider.reviseWithFlatSourceIds({ ...revision, runId, evidence: passages }), /Source-ID/); assert.equal(provider.receipt(runId), undefined);
    }
    await assert.rejects(provider.answerWithFlatSourceIds({ ...input, runId: 'flat-wrong-product', passages: [{ ...source, productId: 'foreign' }] }), /another product/); assert.equal(provider.receipt('flat-wrong-product'), undefined);
    await assert.rejects(provider.reviseWithFlatSourceIds({ ...revision, runId: 'flat-too-large', critique: 'x'.repeat(40_001) }), /bounded context/); assert.equal(provider.receipt('flat-too-large'), undefined);
    assert.equal(calls, 0); assert.match(provider.readiness().reason, /0\/20 calls/);
  } finally { provider.close(); }
});

test('flat enums are ordered, request-scoped and isolated from other calls and all historical schema objects', async () => {
  const other = { ...input, question: 'Will the other shelf fit?', passages: [...input.passages].reverse() };
  const first = flatSourceIdAnswerRequestBody(input), second = flatSourceIdAnswerRequestBody(other);
  const enumOf = (body: Body) => schema(body).properties.citations.items.enum;
  assert.ok(enumOf(first).every(id => !enumOf(second).includes(id)));
  const historicBefore = [sourceIdAnswerRequestBody(input), sourceIdRevisionRequestBody(revision), constrainedSourceIdAnswerRequestBody(input), constrainedSourceIdRevisionRequestBody(revision), revisionRequestBody(revision)].map(body => JSON.stringify(body));
  const secondBefore = JSON.stringify(second); enumOf(first).push('injected'); schema(first).required.push('injected'); assert.equal(JSON.stringify(second), secondBefore); assert.equal(enumOf(flatSourceIdAnswerRequestBody(input)).includes('injected'), false);
  const seen: Body[] = []; const provider = new SapiomFeedbackProvider({ ...settings, fetchImpl: async (_url, init) => { const body = JSON.parse(String(init?.body)); seen.push(body); await Promise.resolve(); return reply(body, valid(body)); } });
  try {
    const results = await Promise.all([provider.answerWithFlatSourceIds({ ...input, runId: 'flat-concurrent-a' }), provider.answerWithFlatSourceIds({ ...other, runId: 'flat-concurrent-b' })]);
    assert.deepEqual(enumOf(seen[0]), enumOf(flatSourceIdAnswerRequestBody(input))); assert.deepEqual(enumOf(seen[1]), enumOf(second)); assert.notEqual(results[0].responseSchemaSha256, results[1].responseSchemaSha256);
    assert.deepEqual([sourceIdAnswerRequestBody(input), sourceIdRevisionRequestBody(revision), constrainedSourceIdAnswerRequestBody(input), constrainedSourceIdRevisionRequestBody(revision), revisionRequestBody(revision)].map(body => JSON.stringify(body)), historicBefore);
  } finally { provider.close(); }
});

test('frozen v1/v2 requests and prompt hashes stay unchanged; v3 has explicit immutable identities and examples', () => {
  const v1 = JSON.parse(readFileSync(new URL('../docs/evidence/source-id-correction-2026-10-10/execution-plan-v2.json', import.meta.url), 'utf8'));
  for (const c of v1.plan.cases) assert.equal(sha(JSON.stringify(sourceIdAnswerRequestBody(c.originalInput))), c.originalRequestSha256);
  const v2 = JSON.parse(readFileSync(new URL('../docs/evidence/source-id-diagnostic-2026-10-11/execution-plan-v3.json', import.meta.url), 'utf8'));
  for (const c of v2.plan.cases) {
    assert.deepEqual(constrainedSourceIdAnswerRequestBody(c.originalInput), c.originalRequest); assert.equal(sha(JSON.stringify(constrainedSourceIdAnswerRequestBody(c.originalInput))), c.originalRequestSha256);
    const frozen = JSON.parse(c.revisionTemplateRequest.messages[1].content);
    const ri: RevisionInput = { runId: 'not-dispatched', question: frozen.question, product: frozen.product, rejectedAnswer: frozen.rejectedAnswer, critique: frozen.reviewerCritique, evidence: frozen.evidence, clarifications: frozen.clarifications, investigation: frozen.investigation, revisionPolicy: 'baseline' };
    assert.deepEqual(constrainedSourceIdRevisionRequestBody(ri), c.revisionTemplateRequest); assert.equal(sha(JSON.stringify(constrainedSourceIdRevisionRequestBody(ri))), c.revisionTemplateRequestSha256);
  }
  assert.equal(constrainedSourceIdAnswerPromptIdentity().systemInstructionsSha256, 'f87744b196a0ad5abbb098c79113b2d48bb2ab36c17daa1b33af658440d2e31e');
  assert.equal(constrainedSourceIdRevisionPromptIdentity().systemInstructionsSha256, '9955d3ae41757b91f505f9f5ed2e0dc5f8db14e4d55e1dd153e9beb6cfce39f2');
  assert.equal(constrainedSourceIdRevisionPromptIdentity('candidate_v4').systemInstructionsSha256, '827ad225ba4c5902c7064af74902ba346ce61d7c978a34d218a6828543238342');
  for (const identity of [flatSourceIdAnswerPromptIdentity(), flatSourceIdRevisionPromptIdentity(), flatSourceIdRevisionPromptIdentity('candidate_v4')]) {
    assert.ok(Object.isFrozen(identity)); assert.equal(identity.systemInstructionsSha256, sha(identity.systemInstructions)); assert.match(identity.promptVersion, /source-ids-v3$/); assert.match(identity.systemInstructions, /citations.*flat JSON array/); assert.ok(identity.systemInstructions.includes('"citations":["<offered source ID>"]')); assert.ok(identity.systemInstructions.includes('"citations":[]'));
  }
  assert.equal(flatSourceIdRevisionPromptIdentity('baseline', false).promptVersion, 'answer-revision-v2-context-source-ids-v3');
});
