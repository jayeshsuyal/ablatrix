import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { ContextComparisonStore, createContextComparisonFixture, createCorrectionComparisonFixture, contextComparisonHash, contextComparisonInput, correctionComparisonInput, correctionComparisonProtocol, correctionComparisonRequest, correctionComparisonRequestHash, type CorrectionComparisonPacket, type ContextComparisonPacket, type ContextComparisonDetail } from './context-comparison.ts';
import { revisionRequestBody } from './feedback-provider.ts';
import { workspaceReviewSourceHash } from './answer-review-source.ts';

// All packets and judgments in this file are synthetic test data, including
// packets shaped like imported live records. No provider is instantiated.
const arms = ['without_context', 'with_context'] as const;
function rehash(packet: ContextComparisonPacket) {
  for (const item of packet.cases) for (const arm of arms) item.arms[arm].inputSha256 = contextComparisonHash(contextComparisonInput(packet.protocol, item, arm));
  return packet;
}
function importedShape(): ContextComparisonPacket {
  const packet = createContextComparisonFixture();
  packet.id = 'synthetic-imported-record-shape'; packet.mode = 'live'; packet.protocol.modelAlias = 'gpt-luna';
  packet.provenance = { kind: 'imported_live', note: 'Synthetic unit test of the imported record schema; never a live result.', sourcePacketSha256: 'a'.repeat(64) };
  for (const item of packet.cases) for (const arm of arms) { item.arms[arm].model = 'gpt-5.6-luna'; item.arms[arm].providerCallId = `synthetic-receipt-${item.id}-${arm}`; }
  return rehash(packet);
}
function judgment(detail: ContextComparisonDetail, caseIndex = 0, answerIndex = 0) {
  const item = detail.cases[caseIndex];
  return { manifestSha256: detail.manifestSha256, caseId: item.id, versionId: item.answers[answerIndex].versionId, reviewer: 'Synthetic test reviewer', correctness: 'correct' as const, support: 'supported' as const, adequacy: 'adequate' as const, checkedSourceShas: item.sources.map(source => source.sha256), note: '', referenceChecked: true as const, independentReview: detail.mode === 'live' };
}
function reviewAll(store: ContextComparisonStore, comparisonId: string) {
  const detail = store.get(comparisonId);
  for (const [caseIndex, item] of detail.cases.entries()) for (const [answerIndex, answer] of item.answers.entries()) if (answer.status === 'completed' && !answer.review) store.review(comparisonId, judgment(detail, caseIndex, answerIndex));
}

test('frozen context inputs vary only customer-question metadata and reject leaked or mismatched packets', () => {
  const packet = createContextComparisonFixture(), item = packet.cases[0];
  const baseline = contextComparisonInput(packet.protocol, item, 'without_context');
  const candidate = contextComparisonInput(packet.protocol, item, 'with_context');
  assert.notEqual(contextComparisonHash(baseline), contextComparisonHash(candidate));
  assert.deepEqual({ ...candidate, evidence: candidate.evidence.map(({ originalQuestion: _question, ...source }) => source) }, baseline);
  assert.deepEqual(candidate.quoteOptions, baseline.quoteOptions);
  const mutations: [string, (packet: ContextComparisonPacket) => void][] = [
    ['arm input', value => { value.cases[0].arms.with_context.inputSha256 = 'f'.repeat(64); }],
    ['source context hash', value => { value.cases[0].sources[0].originalQuestion = 'Changed original question?'; }],
    ['inline Question', value => { const source = value.cases[0].sources[0]; source.text += ' Question: Does it fit another model?'; source.sha256 = workspaceReviewSourceHash(source); rehash(value); }],
    ['distinct case and product', value => { value.cases[1].product.id = value.cases[0].product.id; rehash(value); }],
    ['duplicate source', value => { value.cases[0].retrievalSourceIds.push(value.cases[0].retrievalSourceIds[0]); rehash(value); }],
    ['duplicate attempt', value => { value.cases[1].arms.with_context.id = value.cases[0].arms.with_context.id; }],
    ['recorded protocol', value => { value.cases[0].arms.with_context.model = 'unrecognized-model'; }]
  ];
  for (const [reason, mutate] of mutations) {
    const store = new ContextComparisonStore(':memory:');
    try { const changed = structuredClone(packet); mutate(changed); assert.throws(() => store.importPacket(changed), new RegExp(reason)); assert.equal(store.list().comparisons.length, 0); }
    finally { store.close(); }
  }
});

test('imports and exposure reservations are immutable, atomic, persistent and separate for fixtures', () => {
  const directory = mkdtempSync(join(tmpdir(), 'context-comparison-import-')), path = join(directory, 'comparisons.sqlite');
  let store = new ContextComparisonStore(path);
  try {
    const packet = createContextComparisonFixture(), imported = store.importPacket(packet), detail = store.get(packet.id);
    assert.deepEqual(store.importPacket(structuredClone(packet)), imported);
    const changed = structuredClone(packet); changed.title = 'Changed frozen comparison';
    assert.throws(() => store.importPacket(changed), /cannot be replaced/);
    const reused = structuredClone(packet); reused.id = 'another-fixture';
    assert.throws(() => store.importPacket(reused), /already exposed/);
    const alias = structuredClone(reused); alias.cases.forEach((item, index) => { item.product.id = `new-alias-${index}`; }); rehash(alias);
    assert.throws(() => store.importPacket(alias), /snapshot was already exposed/);
    assert.equal(store.list().comparisons.length, 1);
    assert.equal(store.importPacket(importedShape()).mode, 'live', 'fixture exposure never consumes the live namespace');
    packet.cases[0].sources[0].text = 'Caller mutation after import.';
    assert.deepEqual(store.get(packet.id), detail);
    store.close(); store = new ContextComparisonStore(path);
    assert.deepEqual(store.get(packet.id), detail, 'private blind assignment persists across restart');
    assert.throws(() => store.importPacket(reused), /already exposed/);
    assert.equal(store.list().comparisons.length, 2);
    reviewAll(store, packet.id);
    const exported = JSON.stringify(store.exportPacket(packet.id));
    store.close(); store = new ContextComparisonStore(path);
    assert.equal(JSON.stringify(store.exportPacket(packet.id)), exported, 'reviews, blind assignment and report reproduce after restart');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('an interrupted import transaction leaves no packet or partial product reservation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'context-comparison-atomic-')), path = join(directory, 'comparisons.sqlite');
  const store = new ContextComparisonStore(path), db = new DatabaseSync(path), packet = createContextComparisonFixture();
  try {
    db.exec("CREATE TRIGGER synthetic_exposure_failure BEFORE INSERT ON context_comparison_exposure WHEN NEW.product_id='FIXTURE-BOTTLE' BEGIN SELECT RAISE(ABORT,'Synthetic storage failure'); END");
    assert.throws(() => store.importPacket(packet), /Synthetic storage failure/);
    assert.equal(store.list().comparisons.length, 0);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM context_comparison_exposure').get() as { n: number }).n, 0);
    db.exec('DROP TRIGGER synthetic_exposure_failure');
    assert.equal(store.importPacket(packet).caseCount, 2);
  } finally { db.close(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('known historical products and explicit workspace exposures cannot be imported as new live comparisons', () => {
  const known = JSON.parse(readFileSync(new URL('../data/product-qa/corpus.json', import.meta.url), 'utf8')).products[0].id as string;
  const store = new ContextComparisonStore(':memory:', { excludedProductIds: ['prior-workspace-product'] });
  try {
    for (const productId of [known.toLowerCase(), 'prior-workspace-product']) {
      const packet = importedShape(); packet.cases[0].product.id = productId; rehash(packet);
      assert.throws(() => store.importPacket(packet), /overlaps/);
      assert.equal(store.list().comparisons.length, 0);
    }
    const duplicate = importedShape(); duplicate.cases[1] = { ...structuredClone(duplicate.cases[0]), id: 'different-case', product: { ...duplicate.cases[0].product, id: 'aliased-product' } }; rehash(duplicate);
    assert.throws(() => store.importPacket(duplicate), /same source snapshot/);
  } finally { store.close(); }
});

test('blind reads omit arm metadata and reports stay locked until every answer has a source-bound judgment', () => {
  const store = new ContextComparisonStore(':memory:');
  try {
    const packet = createContextComparisonFixture(); store.importPacket(packet);
    const detail = store.get(packet.id), input = judgment(detail);
    assert.equal(detail.qualityStatus, 'pending'); assert.equal(detail.reviewableAnswers, 4);
    const publicJson = JSON.stringify([store.list(), detail]);
    assert.doesNotMatch(publicJson, /"(?:arms|model|latencyMs|inputSha256|providerCallId|blindKey|protocol)"/);
    assert.doesNotMatch(publicJson, /without_context|with_context/);
    assert.throws(() => store.report(packet.id), /all completed answers/);
    assert.throws(() => store.exportPacket(packet.id), /all completed answers/);
    assert.throws(() => store.review(packet.id, { ...input, manifestSha256: 'f'.repeat(64) }), /stale manifest/);
    assert.throws(() => store.review(packet.id, { ...input, caseId: detail.cases[1].id }), /does not belong/);
    assert.throws(() => store.review(packet.id, { ...input, checkedSourceShas: detail.cases[1].sources.map(source => source.sha256) }), /belong to this frozen case/);
    assert.throws(() => store.review(packet.id, { ...input, correctness: 'uncertain' }), /at least ten/);
    assert.throws(() => store.review(packet.id, { ...input, kind: 'human' }), /invalid packet or review/);
    const review = store.review(packet.id, input);
    assert.equal(review.kind, 'synthetic'); assert.deepEqual(store.review(packet.id, input), review);
    assert.throws(() => store.review(packet.id, { ...input, note: 'A different judgment.' }), /already has a different/);
    assert.throws(() => store.report(packet.id), /all completed answers/);
    reviewAll(store, packet.id);
    const report = store.report(packet.id);
    assert.equal(report.status, 'synthetic_only'); assert.equal(report.quality, null); assert.equal(report.qualityClaimEligible, false);
    assert.equal(report.citationMatching.baseline.matching, 2); assert.equal(report.citationMatching.candidate.matching, 2);
    assert.equal(report.billedCostUsd, null);
    assert.equal(JSON.stringify(store.exportPacket(packet.id)), JSON.stringify(store.exportPacket(packet.id)), 'export adds no current timestamp or randomness');
  } finally { store.close(); }
});

test('live-shaped imported records require independent review and retain uncertain pairs outside outcome counts', () => {
  const store = new ContextComparisonStore(':memory:');
  try {
    const packet = importedShape(); store.importPacket(packet);
    const detail = store.get(packet.id), first = judgment(detail);
    assert.match(detail.provenance.note, /retrospective/);
    assert.throws(() => store.review(packet.id, { ...first, independentReview: false }), /independent source check/);
    const uncertain = store.review(packet.id, { ...first, correctness: 'uncertain', note: 'Synthetic test: this claim cannot be resolved.' });
    assert.equal(uncertain.kind, 'human', 'this exercises the declared live-review schema, not a real judgment');
    reviewAll(store, packet.id);
    const report = store.report(packet.id);
    assert.equal(report.quality?.totalPairs, 2); assert.equal(report.quality?.eligiblePairs, 1); assert.equal(report.quality?.uncertainPairs, 1);
    assert.equal(report.quality?.ties, 1); assert.equal(report.quality?.wins, 0); assert.equal(report.quality?.losses, 0);
    assert.equal(report.quality?.verdict, 'inconclusive'); assert.equal(report.quality?.interval95, null); assert.equal(report.qualityClaimEligible, false);
  } finally { store.close(); }
});

test('failed and uncertain attempts remain incomplete and can never turn into quality ties', () => {
  for (const status of ['failed', 'uncertain'] as const) {
    const store = new ContextComparisonStore(':memory:');
    try {
      const packet = importedShape(), attempt = packet.cases[0].arms.with_context;
      attempt.status = status; attempt.answer = null; attempt.error = 'Synthetic recorded incomplete attempt.';
      store.importPacket(packet); const detail = store.get(packet.id);
      assert.equal(detail.reviewableAnswers, 3); assert.equal(detail.attempts[status], 1);
      const answerIndex = detail.cases[0].answers.findIndex(answer => answer.status === status);
      assert.throws(() => store.review(packet.id, judgment(detail, 0, answerIndex)), /only completed/);
      reviewAll(store, packet.id);
      const report = store.report(packet.id);
      assert.equal(report.status, 'incomplete'); assert.equal(report.quality, null); assert.equal(report.timing.candidateMedianMs, null);
    } finally { store.close(); }
  }
});

test('invalid citation records stay inspectable but cannot receive a supported judgment', () => {
  for (const defect of ['unknown-source', 'wrong-quote', 'missing-citation'] as const) {
    const store = new ContextComparisonStore(':memory:');
    try {
      const packet = importedShape(), answer = packet.cases[0].arms.without_context.answer!;
      if (defect === 'unknown-source') answer.citations[0].passageId = 'foreign-source';
      if (defect === 'wrong-quote') answer.citations[0].quote = 'This quotation is not in the source.';
      if (defect === 'missing-citation') answer.citations = [];
      store.importPacket(packet); const detail = store.get(packet.id), index = detail.cases[0].answers.findIndex(item => item.answer?.answer === answer.answer), input = judgment(detail, 0, index);
      assert.throws(() => store.review(packet.id, input), /matching source quotes/);
      store.review(packet.id, { ...input, support: 'unsupported', note: 'Synthetic citation defect has been checked against the source.' });
      reviewAll(store, packet.id);
      const report = store.report(packet.id);
      assert.equal(report.quality?.baseline.supported, 1); assert.equal(report.quality?.verdict, 'exploratory_only'); assert.equal(report.qualityClaimEligible, false);
    } finally { store.close(); }
  }
});

function rehashCorrection(packet: CorrectionComparisonPacket) {
  for (const item of packet.cases) for (const arm of ['baseline', 'candidate'] as const) {
    item.arms[arm].inputSha256 = contextComparisonHash(correctionComparisonInput(packet.protocol, item, arm));
    item.arms[arm].requestSha256 = correctionComparisonRequestHash(packet.protocol, item, arm, item.arms[arm].id);
  }
  return packet;
}
function correctionImportedShape() {
  const packet = createCorrectionComparisonFixture();
  packet.mode = 'live'; packet.id = 'synthetic-correction-live-shape'; packet.protocol = correctionComparisonProtocol('gpt-luna');
  packet.provenance = { kind: 'imported_live', note: 'Synthetic test shaped like imported live receipts; no calls or real judgments.', sourcePacketSha256: 'a'.repeat(64) };
  for (const item of packet.cases) {
    item.original.model = 'gpt-5.6-luna'; item.original.providerCallId = `synthetic-receipt-${item.original.id}`;
    for (const arm of ['baseline', 'candidate'] as const) { item.arms[arm].model = 'gpt-5.6-luna'; item.arms[arm].providerCallId = `synthetic-receipt-${item.id}-${arm}`; }
  }
  return rehashCorrection(packet);
}

test('correction policies use the same original, critique and ordered context with exact transport hashes', () => {
  assert.equal(contextComparisonHash(createContextComparisonFixture()), '80d0d3a500d2e921ca8779f73d51d979da73806902589556311409b87409495b', 'the original context experiment fixture remains byte-compatible');
  const packet = correctionImportedShape(), item = packet.cases[0];
  const baseline = correctionComparisonInput(packet.protocol, item, 'baseline'), candidate = correctionComparisonInput(packet.protocol, item, 'candidate');
  assert.deepEqual({ ...candidate, revisionPolicy: 'baseline' }, baseline);
  assert.equal(baseline.rejectedAnswer, item.original.answer.answer);
  assert.notEqual(candidate.rejectedAnswer, item.arms.baseline.answer!.answer);
  assert.equal(baseline.evidence[1].originalQuestion, item.sources[1].originalQuestion);
  const { modelAlias: _alias, ...providerInput } = baseline;
  assert.deepEqual(correctionComparisonRequest(packet.protocol, item, 'baseline', item.arms.baseline.id), revisionRequestBody({ ...providerInput, runId: item.arms.baseline.id }));
  const requestA = correctionComparisonRequest(packet.protocol, item, 'baseline', item.arms.baseline.id), requestB = correctionComparisonRequest(packet.protocol, item, 'candidate', item.arms.candidate.id);
  const userA = JSON.parse(requestA.messages[1].content), userB = JSON.parse(requestB.messages[1].content);
  assert.deepEqual({ ...userB, promptVersion: userA.promptVersion }, userA);
  assert.deepEqual({ ...requestB, messages: requestA.messages }, requestA, 'generation settings and output schema are identical');
  assert.notEqual(packet.protocol.policies.baseline.configurationSha256, packet.protocol.policies.candidate.configurationSha256);
  const store = new ContextComparisonStore(':memory:');
  try { assert.equal(store.importPacket(packet).experiment, 'correction_policy'); } finally { store.close(); }
});

test('correction imports reject changed shared inputs, request identity, source order and hidden arm overrides', () => {
  const packet = createCorrectionComparisonFixture();
  const mutations: [string, (value: CorrectionComparisonPacket) => void][] = [
    ['prompt configuration', value => { value.protocol.policies.candidate.systemInstructions += 'Changed rule.'; }],
    ['prompt configuration', value => { value.protocol.policies.baseline.configurationSha256 = 'f'.repeat(64); }],
    ['shared original', value => { value.cases[0].original.answer.answer += 'Changed original.'; }],
    ['shared original', value => { value.cases[0].critique.text += ' Changed feedback.'; }],
    ['source context hash', value => { value.cases[0].sources[1].originalQuestion = 'Changed source context?'; }],
    ['shared original', value => { const item = value.cases[0]; item.generationSourceIds.reverse(); item.investigation.selectedSourceIds = [...item.generationSourceIds]; }],
    ['investigation selection', value => { value.cases[0].investigation.selectedSourceIds.reverse(); }],
    ['request hash', value => { value.cases[0].arms.candidate.requestSha256 = 'f'.repeat(64); }],
    ['duplicate attempt', value => { value.cases[0].arms.candidate.id = value.cases[0].original.id; }],
    ['invalid packet', value => { Object.assign(value.cases[0].arms.candidate, { original: value.cases[0].arms.baseline.answer }); }],
    ['invalid packet', value => { Object.assign(value.cases[0].critique, { kind: 'human' }); }]
  ];
  for (const [reason, mutate] of mutations) {
    const store = new ContextComparisonStore(':memory:');
    try { const changed = structuredClone(packet); mutate(changed); assert.throws(() => store.importPacket(changed), new RegExp(reason)); assert.equal(store.list().comparisons.length, 0); }
    finally { store.close(); }
  }
});

test('correction review keeps policies, original and AI critique blind until independent judgments are locked', () => {
  const store = new ContextComparisonStore(':memory:');
  try {
    const packet = correctionImportedShape(); store.importPacket(packet);
    const detail = store.get(packet.id), serialized = JSON.stringify([store.list(), detail]);
    assert.equal(detail.hypothesis, 'compare_correction_policy');
    assert.doesNotMatch(serialized, /"(?:original|critique|investigation|protocol|policies|model|inputSha256|requestSha256|providerCallId|generationSourceIds)"/);
    assert.ok(!serialized.includes(packet.cases[0].original.answer.answer));
    assert.ok(!serialized.includes(packet.cases[0].critique.text));
    assert.throws(() => store.exportPacket(packet.id), /all completed answers/);
    assert.throws(() => store.review(packet.id, { ...judgment(detail), independentReview: false }), /independent source check/);
    assert.throws(() => store.review(packet.id, { ...judgment(detail), kind: 'human', reviewKind: 'ai_assisted' }), /invalid packet/);
    reviewAll(store, packet.id);
    const report = store.report(packet.id), exported = store.exportPacket(packet.id);
    assert.equal(exported.format, 'ablatrix-correction-comparison-evidence-v1');
    assert.deepEqual(report.protocol, packet.protocol);
    assert.deepEqual(report.cases[0].original, packet.cases[0].original);
    assert.equal(report.cases[0].critique!.kind, 'ai_assisted');
    assert.equal(report.qualityClaimEligible, false); assert.equal(report.quality?.verdict, 'exploratory_only');
    assert.equal(report.quality?.ties, 1); assert.equal(report.quality?.wins, 0);
    assert.throws(() => store.review(packet.id, { ...judgment(detail), correctness: 'incorrect', note: 'Changed after the labels were revealed.' }), /already has a different/);
    assert.equal(JSON.stringify(exported), JSON.stringify(store.exportPacket(packet.id)));
  } finally { store.close(); }
});

test('correction full review pools stay separate from bounded generation and quotation matching', () => {
  const store = new ContextComparisonStore(':memory:'), packet = createCorrectionComparisonFixture(), item = packet.cases[0];
  try {
    for (let index = 0; index < 18; index++) {
      const source = { id: `review-only-${index}`, label: `Synthetic reference ${index}`, text: `Supplemental synthetic source ${index} has a distinct product detail.`, originalQuestion: null, reference: `synthetic://review-only/${index}` };
      item.sources.push({ ...source, sha256: workspaceReviewSourceHash(source) });
    }
    // A literal quotation from an unsupplied review source must not pass the generation-source check.
    const extra = item.sources.at(-1)!;
    item.arms.candidate.answer!.citations = [{ passageId: extra.id, quote: extra.text }];
    store.importPacket(packet);
    const detail = store.get(packet.id), index = detail.cases[0].answers.findIndex(answer => answer.answer!.answer === item.arms.candidate.answer!.answer);
    assert.equal(detail.cases[0].sources.length, 20);
    assert.equal(detail.cases[0].answers[index].citationCheck!.matching, 0);
    assert.throws(() => store.review(packet.id, judgment(detail, 0, index)), /matching source quotes/);
    store.review(packet.id, { ...judgment(detail, 0, index), support: 'unsupported', note: 'This synthetic citation came from outside the frozen generation input.' });
    reviewAll(store, packet.id);
    assert.equal(store.report(packet.id).quality, null, 'fixture judgments never become human quality');
  } finally { store.close(); }
});

test('a stopped correction arm remains not attempted, never a failed call or quality tie', () => {
  const store = new ContextComparisonStore(':memory:'), packet = correctionImportedShape();
  try {
    const attempt = packet.cases[0].arms.candidate;
    Object.assign(attempt, { status: 'not_attempted', answer: null, model: null, latencyMs: null, usage: null, providerCallId: null, error: 'Stopped before dispatch; no request was made.' });
    const summary = store.importPacket(packet);
    assert.deepEqual(summary.attempts, { completed: 1, failed: 0, uncertain: 0, notAttempted: 1 });
    reviewAll(store, packet.id);
    const report = store.report(packet.id);
    assert.equal(report.status, 'incomplete'); assert.equal(report.quality, null); assert.equal(report.timing.candidateMedianMs, null);
  } finally { store.close(); }
});

test('the existing offline CLI imports tagged correction packets and exports only locked reviews', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ablatrix-correction-cli-'));
  const packet = createCorrectionComparisonFixture(), packetPath = join(directory, 'synthetic-packet.json'), dbPath = join(directory, 'comparison.sqlite'), outputPath = join(directory, 'reviewed.json');
  const cli = (...args: string[]) => spawnSync(process.execPath, ['--import', fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url)), fileURLToPath(new URL('./context-comparison-cli.ts', import.meta.url)), ...args], { cwd: directory, encoding: 'utf8', env: { PATH: process.env.PATH } });
  try {
    writeFileSync(packetPath, JSON.stringify(packet));
    const imported = cli('import', '--db', dbPath, '--packet', packetPath);
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(JSON.parse(imported.stdout).experiment, 'correction_policy');
    const locked = cli('export', '--db', dbPath, '--id', packet.id, '--out', outputPath);
    assert.notEqual(locked.status, 0);
    assert.match(locked.stderr, /all completed answers require source-checked review/);
    const store = new ContextComparisonStore(dbPath);
    try { reviewAll(store, packet.id); } finally { store.close(); }
    const exported = cli('export', '--db', dbPath, '--id', packet.id, '--out', outputPath);
    assert.equal(exported.status, 0, exported.stderr);
    const result = JSON.parse(readFileSync(outputPath, 'utf8'));
    assert.equal(result.format, 'ablatrix-correction-comparison-evidence-v1');
    assert.deepEqual(result.packet, packet);
    assert.equal(result.report.qualityClaimEligible, false);
    assert.ok(result.reviews.every((review: { kind: string }) => review.kind === 'synthetic'));
    const repeat = cli('export', '--db', dbPath, '--id', packet.id, '--out', outputPath);
    assert.notEqual(repeat.status, 0);
    assert.match(repeat.stderr, /EEXIST/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
