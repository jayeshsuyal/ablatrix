import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { LoopProvider } from './loop-types.ts';
import {
  CONSTRAINED_SOURCE_ID_CITATION_INTERFACE, SapiomFeedbackProvider, type RevisionInput,
  constrainedSourceIdAnswerPromptIdentity, constrainedSourceIdRevisionPromptIdentity,
  constrainedSourceIdAnswerRequestBody, constrainedSourceIdRevisionRequestBody,
  sourceIdAnswerPromptIdentity, sourceIdRevisionPromptIdentity, sourceIdAnswerRequestBody, sourceIdRevisionRequestBody,
  sourceCitationOptions,
} from './feedback-provider.ts';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const input: Parameters<LoopProvider['answer']>[0] = {
  runId: 'synthetic-enum-original', question: 'How long is the shelf?', product: { id: 'synthetic-shelf', title: 'Synthetic shelf fixture', split: 'development' },
  policy: { id: 'synthetic-policy', parentId: null, instructions: 'Use supplied sources and preserve uncertainty.', rationale: 'Synthetic offline check.', feedbackRunIds: [], status: 'baseline', mode: 'fixture', createdAt: '2026-10-11T00:00:00.000Z' },
  passages: [
    { id: 'listing', productId: 'synthetic-shelf', source: 'attribute', text: 'dimensions:  { length:{ unit:inches, value:21.5 }, height:{ unit:inches, value:12. } }', reference: 'synthetic://listing', sha256: 'synthetic', lexicalRank: 1, semanticRank: 1, score: 1 },
    { id: 'customer', productId: 'synthetic-shelf', source: 'cqa', text: 'It fits my unit.', originalQuestion: 'Will this fit model AB100?', reference: 'synthetic://customer', sha256: 'synthetic', lexicalRank: 2, semanticRank: 2, score: 1 },
  ],
};
const revision: RevisionInput = { runId: 'synthetic-enum-revision', question: input.question, product: input.product, rejectedAnswer: 'SYNTHETIC incorrect placeholder.', critique: 'Check the listed dimensions and original customer-question scope.', evidence: input.passages,
  investigation: { issue: 'answer_quality', query: input.question, selectedSourceIds: input.passages.map(source => source.id), addedSourceIds: [] } };
const settings = { enabled: true, apiKey: 'synthetic-test-only-not-a-credential', dbPath: ':memory:', capUsd: 10, priorSpendUsd: 0, allowancePerCallUsd: .1, callLimit: 20 };
type Body = ReturnType<typeof constrainedSourceIdAnswerRequestBody>;
const payloadOf = (body: Body) => JSON.parse(body.messages[1].content);
const schemaOf = (body: Body) => body.tools[0].function.parameters as { properties: { citations: { items: { properties: { quoteId: { enum?: string[] } } } } }; required: string[] };
function reply(body: Body, output: unknown, model = 'gpt-5.6-luna') {
  return new Response(JSON.stringify({ model, usage: { prompt_tokens: 10, completion_tokens: 4 }, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: body.tool_choice.function.name, arguments: JSON.stringify(output) } }] } }] }));
}
const selectedOutput = (body: Body) => ({ answer: `SYNTHETIC listing dimensions. [${payloadOf(body).quoteOptions[0].id}]`, status: 'answered', citations: [{ quoteId: payloadOf(body).quoteOptions[0].id }] });

test('v2 originals and both revision policies bind exact per-request enums, transports and receipts for both accepted model aliases', async () => {
  for (const model of ['gpt-luna', 'gpt-5.6-luna']) {
    const inputs = [input, { ...revision, revisionPolicy: 'baseline' as const }, { ...revision, revisionPolicy: 'candidate_v4' as const }];
    const helpers = [constrainedSourceIdAnswerRequestBody(input), constrainedSourceIdRevisionRequestBody(inputs[1] as RevisionInput), constrainedSourceIdRevisionRequestBody(inputs[2] as RevisionInput)];
    const prompts = [constrainedSourceIdAnswerPromptIdentity(), constrainedSourceIdRevisionPromptIdentity('baseline'), constrainedSourceIdRevisionPromptIdentity('candidate_v4')];
    let calls = 0;
    const provider = new SapiomFeedbackProvider({ ...settings, fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body)), expected = helpers[calls++];
      assert.equal(String(init?.body), JSON.stringify(expected));
      const payload = payloadOf(body), ids = payload.quoteOptions.map((option: { id: string }) => option.id);
      assert.deepEqual(schemaOf(body).properties.citations.items.properties.quoteId.enum, ids);
      assert.equal(payload.citationInterface, 'source_ids_v2'); assert.equal(body.model, 'gpt-luna');
      assert.equal(body.max_tokens, 4096); assert.equal(body.reasoning_effort, 'none'); assert.equal(body.parallel_tool_calls, false);
      assert.equal('strict' in body.tools[0].function, false);
      assert.equal(payload.quoteOptions[0].quote, input.passages[0].text);
      assert.equal(payload.evidence[1].originalQuestion, input.passages[1].originalQuestion);
      assert.equal(payload.quoteOptions.some((option: { quote: string }) => option.quote.includes('AB100')), false);
      return reply(body, selectedOutput(body), model);
    } });
    try {
      for (const [index, value] of inputs.entries()) {
        const runId = `synthetic-${model.replaceAll('.', '-')}-${index}`;
        const result = index === 0 ? await provider.answerWithConstrainedSourceIds({ ...input, runId }) : await provider.reviseWithConstrainedSourceIds({ ...value as RevisionInput, runId });
        assert.equal(result.model, model); assert.equal(result.answer.answer, 'SYNTHETIC listing dimensions.');
        assert.deepEqual(result.answer.citations, [{ passageId: input.passages[0].id, quote: input.passages[0].text }]);
        assert.equal(result.citationInterface, CONSTRAINED_SOURCE_ID_CITATION_INTERFACE);
        assert.equal(result.promptVersion, prompts[index].promptVersion); assert.equal(result.systemInstructionsSha256, prompts[index].systemInstructionsSha256);
        assert.equal(result.responseSchemaSha256, sha(JSON.stringify(helpers[index].tools[0].function.parameters)));
        assert.equal(result.optionSetSha256, sha(JSON.stringify(payloadOf(helpers[index]).quoteOptions)));
        const receipt = provider.receipt(runId)!; assert.equal(receipt.error_code, null); assert.equal(receipt.model, model);
        const saved = JSON.parse(receipt.receipt_json!);
        for (const key of ['citationInterface', 'promptVersion', 'systemInstructionsSha256', 'optionSetSha256', 'responseSchemaSha256'] as const) assert.equal(saved[key], result[key]);
      }
      assert.equal(calls, 3);
      const normalized = helpers.slice(1).map(body => { const copy = structuredClone(body), payload = payloadOf(copy); delete payload.promptVersion; copy.messages[0].content = '<policy>'; copy.messages[1].content = JSON.stringify(payload); return copy; });
      assert.deepEqual(normalized[0], normalized[1]);
      assert.deepEqual(payloadOf(helpers[0]).quoteOptions, payloadOf(helpers[1]).quoteOptions);
    } finally { provider.close(); }
  }
});

test('Q10021 truncated live ID is outside the exact enum and still fails server validation without repair or retry', async () => {
  // Public pre-generation inputs only; no private generated answer is loaded.
  const frozen = JSON.parse(readFileSync(new URL('../docs/evidence/source-id-correction-2026-10-10/execution-plan-v2.json', import.meta.url), 'utf8'));
  const item = frozen.plan.cases.find((entry: { id: string }) => entry.id === 'source-id-train-10021');
  const evidence = payloadOf(sourceIdAnswerRequestBody(item.originalInput)).evidence;
  const failed = 'src_d6dec31ee5a0006a8e2e684', offered = `${failed}a`;
  const request: RevisionInput = { runId: 'synthetic-q10021-truncated-id', question: item.question, product: item.product, rejectedAnswer: 'SYNTHETIC placeholder; no saved generated answer is used.', critique: item.critique.text, evidence,
    revisionPolicy: 'baseline', investigation: { issue: 'answer_quality', query: item.question.slice(0, 240), selectedSourceIds: item.generationSourceIds, addedSourceIds: [] } };
  const expected = constrainedSourceIdRevisionRequestBody(request), schema = schemaOf(expected), ids = schema.properties.citations.items.properties.quoteId.enum!;
  assert.deepEqual(payloadOf(expected).quoteOptions, item.quoteOptions); assert.ok(ids.includes(offered)); assert.ok(!ids.includes(failed));
  assert.equal(failed.length, 27); assert.equal(offered.length, 28);
  let calls = 0;
  const provider = new SapiomFeedbackProvider({ ...settings, fetchImpl: async (_url, init) => { calls++; assert.equal(String(init?.body), JSON.stringify(expected)); return reply(expected, { answer: 'SYNTHETIC malformed-ID regression.', status: 'answered', citations: [{ quoteId: failed }] }); } });
  try {
    await assert.rejects(provider.reviseWithConstrainedSourceIds(request), /output validation/);
    assert.equal(calls, 1);
    const receipt = provider.receipt(request.runId)!; assert.equal(receipt.status, 'completed'); assert.equal(receipt.error_code, 'output_validation');
    const saved = JSON.parse(receipt.receipt_json!);
    assert.equal(saved.output.citations[0].quoteId, failed);
    assert.equal(saved.responseSchemaSha256, sha(JSON.stringify(expected.tools[0].function.parameters)));
    assert.equal(saved.optionSetSha256, sha(JSON.stringify(item.quoteOptions))); assert.equal(saved.citationInterface, 'source_ids_v2');
  } finally { provider.close(); }
});

test('v2 server validation rejects unknown, foreign, duplicate, uncited and unresolved citations despite enum guidance', async () => {
  const body = constrainedSourceIdAnswerRequestBody(input), id = payloadOf(body).quoteOptions[0].id;
  const foreign = payloadOf(constrainedSourceIdAnswerRequestBody({ ...input, question: 'A different request question?' })).quoteOptions[0].id;
  const outputs = [
    { answer: 'SYNTHETIC.', status: 'answered', citations: [{ quoteId: 'src_unknown' }] },
    { answer: 'SYNTHETIC.', status: 'answered', citations: [{ quoteId: foreign }] },
    { answer: 'SYNTHETIC.', status: 'answered', citations: [{ quoteId: id }, { quoteId: id }] },
    { answer: 'SYNTHETIC.', status: 'answered', citations: [] },
    { answer: `SYNTHETIC. [${foreign}]`, status: 'answered', citations: [{ quoteId: id }] },
    { answer: `SYNTHETIC. ${id}`, status: 'answered', citations: [{ quoteId: id }] },
  ];
  for (const kind of ['original', 'revision'] as const) for (const [index, output] of outputs.entries()) {
    let calls = 0;
    const runId = `invalid-${kind}-${index}`, provider = new SapiomFeedbackProvider({ ...settings, fetchImpl: async (_url, init) => { calls++; const request = JSON.parse(String(init?.body)); return reply(request, output); } });
    try {
      await assert.rejects(kind === 'original' ? provider.answerWithConstrainedSourceIds({ ...input, runId }) : provider.reviseWithConstrainedSourceIds({ ...revision, runId }), /output validation/);
      assert.equal(calls, 1); const receipt = provider.receipt(runId)!; assert.equal(receipt.error_code, 'output_validation');
      assert.match(JSON.parse(receipt.receipt_json!).responseSchemaSha256, /^[a-f0-9]{64}$/);
    } finally { provider.close(); }
  }
});

test('v2 preserves empty citations for uncertainty and rejects unexpected returned models without retries', async () => {
  for (const kind of ['original', 'revision'] as const) {
    let calls = 0;
    const provider = new SapiomFeedbackProvider({ ...settings, fetchImpl: async (_url, init) => { calls++; const body = JSON.parse(String(init?.body)); return reply(body, { answer: 'SYNTHETIC: the source does not establish that relationship.', status: 'insufficient_evidence', citations: [] }, calls === 1 ? 'gpt-luna' : 'unexpected-model'); } });
    try {
      const result = kind === 'original' ? await provider.answerWithConstrainedSourceIds(input) : await provider.reviseWithConstrainedSourceIds(revision);
      assert.equal(result.answer.status, 'insufficient_evidence'); assert.deepEqual(result.answer.citations, []);
      const runId = `unexpected-model-${kind}`;
      await assert.rejects(kind === 'original' ? provider.answerWithConstrainedSourceIds({ ...input, runId }) : provider.reviseWithConstrainedSourceIds({ ...revision, runId }), /model_identity/);
      assert.equal(provider.receipt(runId)!.error_code, 'model_identity'); assert.equal(calls, 2);
    } finally { provider.close(); }
  }
});

test('v2 bounds and ambiguous source IDs fail before reservations or transport', async () => {
  const source = input.passages[0], invalid = [[], [source, source], [{ ...source, text: 'x'.repeat(3001) }],
    Array.from({ length: 13 }, (_, i) => ({ ...source, id: `source-${i}` })),
    Array.from({ length: 5 }, (_, i) => ({ ...source, id: `source-${i}`, text: 'x'.repeat(2500) }))];
  let calls = 0;
  const provider = new SapiomFeedbackProvider({ ...settings, fetchImpl: async () => { calls++; throw new Error('Unexpected transport'); } });
  try {
    for (const [index, passages] of invalid.entries()) {
      for (const kind of ['original', 'revision'] as const) {
        const runId = `preflight-${kind}-${index}`;
        await assert.rejects(kind === 'original' ? provider.answerWithConstrainedSourceIds({ ...input, runId, passages }) : provider.reviseWithConstrainedSourceIds({ ...revision, runId, evidence: passages }), /Source-ID/);
        assert.equal(provider.receipt(runId), undefined);
      }
    }
    await assert.rejects(provider.answerWithConstrainedSourceIds({ ...input, runId: 'foreign-product', passages: [{ ...source, productId: 'foreign' }] }), /another product/);
    assert.equal(provider.receipt('foreign-product'), undefined);
    assert.equal(calls, 0); assert.match(provider.readiness().reason, /0\/20 calls/);
  } finally { provider.close(); }
});

test('enum schemas are request scoped, ordered and isolated from inspected bodies, v1 and concurrent requests', async () => {
  const other = { ...input, question: 'Will it fit a different unit?', passages: [...input.passages].reverse() };
  const first = constrainedSourceIdAnswerRequestBody(input), second = constrainedSourceIdAnswerRequestBody(other);
  const ids = (body: Body) => schemaOf(body).properties.citations.items.properties.quoteId.enum!;
  assert.deepEqual(ids(first), payloadOf(first).quoteOptions.map((option: { id: string }) => option.id));
  assert.deepEqual(ids(second), payloadOf(second).quoteOptions.map((option: { id: string }) => option.id));
  assert.ok(ids(first).every(id => !ids(second).includes(id)));
  const snapshot = JSON.stringify(second); ids(first).push('injected'); schemaOf(first).required.push('injected');
  assert.equal(JSON.stringify(second), snapshot); assert.equal(ids(constrainedSourceIdAnswerRequestBody(input)).includes('injected'), false);
  assert.equal('enum' in schemaOf(sourceIdAnswerRequestBody(input)).properties.citations.items.properties.quoteId, false);
  assert.equal('enum' in schemaOf(sourceIdRevisionRequestBody(revision)).properties.citations.items.properties.quoteId, false);
  const seen: Body[] = [], provider = new SapiomFeedbackProvider({ ...settings, fetchImpl: async (_url, init) => { const body = JSON.parse(String(init?.body)); seen.push(body); await Promise.resolve(); return reply(body, selectedOutput(body)); } });
  try {
    const results = await Promise.all([provider.answerWithConstrainedSourceIds({ ...input, runId: 'parallel-first' }), provider.answerWithConstrainedSourceIds({ ...other, runId: 'parallel-second' })]);
    assert.equal(seen.length, 2); assert.deepEqual(ids(seen[0]), ids(constrainedSourceIdAnswerRequestBody(input))); assert.deepEqual(ids(seen[1]), ids(second));
    assert.notEqual(results[0].responseSchemaSha256, results[1].responseSchemaSha256);
  } finally { provider.close(); }
});

test('legacy and v1 identities stay frozen while v2 identities are explicit and immutable', () => {
  const frozen = JSON.parse(readFileSync(new URL('../docs/evidence/source-id-correction-2026-10-10/execution-plan-v2.json', import.meta.url), 'utf8'));
  for (const item of frozen.plan.cases) assert.equal(sha(JSON.stringify(sourceIdAnswerRequestBody(item.originalInput))), item.originalRequestSha256);
  const historic: RevisionInput = { runId: 'fixture', question: 'What material is the handle?', product: { id: 'p1', title: 'Example fixture item' }, rejectedAnswer: 'Plastic.', critique: 'Check the supplied material.', evidence: [{ id: 'c1', source: 'manufacturer', text: 'The handle is made of oak.' }], investigation: { issue: 'answer_quality', query: 'handle material', selectedSourceIds: ['c1'], addedSourceIds: [] } };
  assert.equal(sha(JSON.stringify(sourceIdRevisionRequestBody(historic))), '2f781c067243e4ca68b78c0ec26d73e7747cc1f959b85b45fbc321e6a632180e');
  assert.equal(sourceIdAnswerPromptIdentity().systemInstructionsSha256, '29bef50129107f14d3dac0b4b9cc42c382127e1543f76c405f9c34712d9a2202');
  assert.equal(sourceIdRevisionPromptIdentity().systemInstructionsSha256, 'ec06924d7590acf51f7e52b19a9edd700e5c51c24b8ab38db9e10352cb314862');
  assert.equal(sourceIdRevisionPromptIdentity('candidate_v4').systemInstructionsSha256, 'b06b92911b87f06c9f215ce5e23bf8a4a9762220be74cc1f69d0e8be83ffa53f');
  for (const [identity, expected] of [
    [constrainedSourceIdAnswerPromptIdentity(), 'f87744b196a0ad5abbb098c79113b2d48bb2ab36c17daa1b33af658440d2e31e'],
    [constrainedSourceIdRevisionPromptIdentity(), '9955d3ae41757b91f505f9f5ed2e0dc5f8db14e4d55e1dd153e9beb6cfce39f2'],
    [constrainedSourceIdRevisionPromptIdentity('candidate_v4'), '827ad225ba4c5902c7064af74902ba346ce61d7c978a34d218a6828543238342'],
  ] as const) { assert.equal(identity.systemInstructionsSha256, expected); assert.equal(sha(identity.systemInstructions), expected); assert.equal(Object.isFrozen(identity), true); }
  assert.equal(constrainedSourceIdRevisionPromptIdentity('baseline', false).promptVersion, 'answer-revision-v2-context-source-ids-v2');
  assert.deepEqual(payloadOf(constrainedSourceIdAnswerRequestBody(input)).quoteOptions, sourceCitationOptions({ productId: input.product.id, question: input.question, evidence: input.passages }));
});
