import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeSourceGapBaseline, assembleSourceGapCandidate, sourceGapRetrievalCli } from './source-gap-retrieval.ts';
import { contextComparisonHash } from '../server/context-comparison.ts';
import { workspaceReviewSourceHash } from '../server/answer-review-source.ts';
import { SOURCE_GAP_CODE_FILES, SOURCE_GAP_SEED, retrievalCoverageCorpus, sourceCalibrationHash as hash, type SourceCalibrationArtifact } from '../server/source-calibration-comparison.ts';
import { WORKSPACE_GENERATION_CONTRACT, workspaceGenerationPromptIdentity } from '../server/workspace-generation.ts';
import type { RetrievalResult } from '../server/loop-types.ts';

type Json = Record<string, any>;
const repository = resolve(fileURLToPath(new URL('../', import.meta.url)));
const encode = (document: unknown) => `${JSON.stringify(document, null, 2)}\n`;
const bindings = () => Object.fromEntries(SOURCE_GAP_CODE_FILES.map(path => [path, '0'.repeat(64)]));
function seal(document: Json, key: string) { return { ...document, [key]: contextComparisonHash(document) }; }
function artifact(name: string, document: Json): SourceCalibrationArtifact { return { path: `work/${name}.json`, fileSha256: hash(encode(document)), document }; }
function source(id: string, label: string, text: string, originalQuestion: string | null = null) {
  const value = { id, label, text, originalQuestion, reference: `fixture://${id}` };
  return { ...value, sha256: workspaceReviewSourceHash(value) };
}
function cases(count: 8 | 64) {
  return Array.from({ length: count }, (_, index) => {
    const group = index < 3 ? 'specification_gap' : index < 6 ? 'model_detail_gap' : 'baseline_complete_control';
    const report = source(`report${index}`, 'review', index >= 6 ? 'The customer reports the color is blue.' : 'A customer report about an unspecified variant.', 'What was the original variant?');
    const omitted = source(`detail${index}`, 'attribute', index === 2 ? 'finish_tone: { value:"blue" }' : index < 3 ? 'color: { value:"blue" }' : index < 6 ? `model_number: { value:"FIXTURE${index}" }` : 'material: { value:"wood" }');
    const sources = [report, omitted];
    return { id: `fictional-${index}`, product: { id: `FICTIONAL${index}`, title: `Fictional product ${index}` }, question: index < 3 || index >= 6 ? 'What color is this product?' : `Does it fit model FIXTURE${index}?`, sources, sourcePoolSha256: contextComparisonHash(sources),
      ...(count === 8 ? { sourceGapGroup: group, designatedFacts: [{ fact: index >= 6 ? 'A customer reported blue.' : 'A literal listing detail.', sourceIds: [index >= 6 ? report.id : omitted.id], quote: index >= 6 ? report.text : omitted.text, qualification: 'Listing or customer report only, no independent physical verification.' }] } : {}) };
  });
}
function input(count: 8 | 64, implementation = bindings(), freezePath = 'work/candidate-freeze.json') {
  const candidateFreeze = artifact('candidate-freeze', { format: 'ablatrix-source-gap-candidate-freeze-v1', frozen: true, status: 'experimental_not_promoted',
    retrievalContract: 'workspace-source-coverage-v1', generationContract: WORKSPACE_GENERATION_CONTRACT,
    systemInstructionsSha256: workspaceGenerationPromptIdentity().systemInstructionsSha256, selectionSeed: SOURCE_GAP_SEED,
    qualityClaimEligible: false, createdAt: '2026-10-18T00:00:00.000Z', implementationSha256: structuredClone(implementation) });
  candidateFreeze.path = freezePath;
  return artifact(count === 64 ? 'deck' : 'cohort', seal({ format: count === 64 ? 'ablatrix-source-gap-deck-v1' : 'ablatrix-source-gap-cohort-v1', candidateFreeze, cases: cases(count) }, count === 64 ? 'deckSha256' : 'cohortSha256'));
}
function retriever(input: SourceCalibrationArtifact, chooseDetail = false) {
  const corpus = retrievalCoverageCorpus(input), calls: string[] = [];
  return { calls, async retrieve(productId: string, _question: string): Promise<RetrievalResult> {
    calls.push(productId);
    const passage = corpus.passages.find(p => p.productId === productId && p.id.startsWith(chooseDetail ? 'detail' : 'report'))!;
    return { passages: [{ ...passage, lexicalRank: 1, semanticRank: 2, score: .032 }], durationMs: 2, method: 'injected offline mechanics', embeddingModel: 'none', corpusVersion: corpus.version };
  } };
}
function familyAudit(cohort: SourceCalibrationArtifact, baseline: SourceCalibrationArtifact) {
  return artifact('family-audit', { status: 'passed', provenance: 'independent_ai_source_and_family_review', cohortFileSha256: cohort.fileSha256, finalBaselineFileSha256: baseline.fileSha256,
    exposureAuditFileSha256: 'a'.repeat(64), generationPerformed: false, newProviderCalls: 0, modelOutputsInspected: false, candidateContextInspected: false,
    cases: cohort.document.cases.map((c: Json, index: number) => ({ caseId: c.id, baselineContextSha256: baseline.document.results[index].baselineContextSha256, sourceScopeReviewed: true, familySeparationReviewed: true, baselineAndTitleReviewed: true, originalQuestionsReviewed: true,
      sourceGapGroup: c.sourceGapGroup, designatedFacts: structuredClone(c.designatedFacts), designatedFactsSemanticallyRechecked: true, gapOrControlConfirmed: true,
      noEquivalentFactInBaseline: c.sourceGapGroup !== 'baseline_complete_control', baselineComplete: c.sourceGapGroup === 'baseline_complete_control', notes: 'Fictional source-only mechanics fixture; no real semantic assessment.' })) });
}
async function finalFixture(implementation = bindings(), freezePath?: string) {
  const cohort = input(8, implementation, freezePath), baseline = artifact('final-baseline', await freezeSourceGapBaseline(cohort, 'selected_cohort', implementation, retriever(cohort)));
  return { cohort, baseline, audit: familyAudit(cohort, baseline), implementation };
}

test('64-case screening and final8 modes freeze baseline only with separate corpus-specific ranking', async () => {
  const deck = input(64), firstRetriever = retriever(deck), first = await freezeSourceGapBaseline(deck, 'screening_deck', bindings(), firstRetriever);
  assert.equal(firstRetriever.calls.length, 64); assert.equal(first.results.length, 64);
  assert.equal(first.candidateContextInspected, false); assert.equal(first.providerCalls, 0); assert.equal(first.generationPerformed, false);
  assert.deepEqual(Object.keys(first.results[0]).sort(), ['caseId', 'indexRetrieval', 'baseline', 'baselineContextSha256'].sort());
  assert.ok(first.results.every(row => !Object.hasOwn(row, 'candidate') && !Object.hasOwn(row, 'additions')));
  const cohort = input(8), secondRetriever = retriever(cohort, true), final = await freezeSourceGapBaseline(cohort, 'selected_cohort', bindings(), secondRetriever);
  assert.equal(secondRetriever.calls.length, 8); assert.notEqual(first.corpusSha256, final.corpusSha256);
  assert.notEqual(first.results[0].baselineContextSha256, final.results[0].baselineContextSha256);
  assert.ok(final.results[0].baseline.passages[0].id.startsWith('detail'));
});

test('paired assembly requires the audit and reuses exact final baseline; a missed candidate gap stays in all8', async () => {
  const f = await finalFixture(), saved = structuredClone(f.baseline);
  const paired = assembleSourceGapCandidate(f.cohort, f.baseline, f.audit, f.implementation);
  assert.equal(paired.format, 'source-gap-retrieval-v1'); assert.equal(paired.results.length, 8);
  assert.equal(paired.familyAuditFileSha256, f.audit.fileSha256);
  assert.deepEqual(paired.inputArtifacts.finalBaseline, saved); assert.deepEqual(f.baseline, saved);
  for (const [index, row] of paired.results.entries()) {
    assert.deepEqual(row.indexRetrieval, f.baseline.document.results[index].indexRetrieval);
    assert.deepEqual(row.baseline, f.baseline.document.results[index].baseline);
    assert.deepEqual(row.candidate.passages.slice(0, row.baseline.passages.length), row.baseline.passages);
  }
  assert.deepEqual(paired.results[2].additions, [], 'The unrecognized finish_tone gap is retained, not replaced.');
  assert.equal(paired.results[2].candidate.passages.length, paired.results[2].baseline.passages.length);
  assert.equal(paired.providerCalls, 0); assert.equal(paired.generationPerformed, false);
  const { sha256, ...body } = paired; assert.equal(sha256, hash(body));
});

test('failed/stale/nonsemantic audit and role/fact drift reject assembly before any candidate output', async () => {
  const f = await finalFixture();
  for (const mutate of [
    (audit: Json) => { audit.status = 'failed'; },
    (audit: Json) => { audit.finalBaselineFileSha256 = 'b'.repeat(64); },
    (audit: Json) => { audit.cases[0].baselineContextSha256 = 'b'.repeat(64); },
    (audit: Json) => { audit.candidateContextInspected = true; },
    (audit: Json) => { audit.cases[0].designatedFactsSemanticallyRechecked = false; },
    (audit: Json) => { audit.cases[0].sourceGapGroup = 'baseline_complete_control'; },
    (audit: Json) => { audit.cases[0].designatedFacts[0].quote = 'Invented missing fact.'; },
    (audit: Json) => { audit.cases[0].noEquivalentFactInBaseline = false; },
  ]) {
    const audit = structuredClone(f.audit); mutate(audit.document);
    assert.throws(() => assembleSourceGapCandidate(f.cohort, f.baseline, audit, f.implementation));
  }
});

test('rehashed baseline context/source drift and incomplete code bindings cannot be assembled', async () => {
  const f = await finalFixture();
  const changed = structuredClone(f.baseline); changed.document.results[0].baseline.passages[0].text = 'Changed source';
  const { sha256: _old, ...body } = changed.document; changed.document.sha256 = hash(body);
  assert.throws(() => assembleSourceGapCandidate(f.cohort, changed, f.audit, f.implementation));
  const wrongCode = { ...f.implementation }; delete wrongCode[SOURCE_GAP_CODE_FILES[0]];
  assert.throws(() => assembleSourceGapCandidate(f.cohort, f.baseline, f.audit, wrongCode));
  await assert.rejects(() => freezeSourceGapBaseline(input(8), 'screening_deck', bindings(), retriever(input(8))));
  const wrongQuota = input(8); wrongQuota.document.cases[0].sourceGapGroup = 'model_detail_gap';
  const { cohortSha256: _seal, ...quotaBody } = wrongQuota.document;
  wrongQuota.document.cohortSha256 = contextComparisonHash(quotaBody);
  const neverRanked = retriever(wrongQuota);
  await assert.rejects(() => freezeSourceGapBaseline(wrongQuota, 'selected_cohort', bindings(), neverRanked), /three\/three\/two/);
  assert.equal(neverRanked.calls.length, 0);
});

test('stale embedded/current code maps reject before retrieval and before later audit or candidate assembly', async () => {
  const f = await finalFixture();
  for (const staleCurrent of [false, true]) {
    const packet = structuredClone(f.cohort), current = { ...f.implementation }, laterAudit = structuredClone(f.audit);
    if (staleCurrent) current['server/feedback-provider.ts'] = 'f'.repeat(64);
    else packet.document.candidateFreeze.document.implementationSha256['server/workspace-source-coverage.ts'] = 'f'.repeat(64);
    let retrievalCalls = 0;
    const neverRetrieve = { async retrieve(): Promise<RetrievalResult> { retrievalCalls++; throw new Error('Must not retrieve.'); } };
    await assert.rejects(() => freezeSourceGapBaseline(packet, 'selected_cohort', current, neverRetrieve), /candidate freeze implementation changed/);
    assert.equal(retrievalCalls, 0);
    laterAudit.document.status = 'failed';
    assert.throws(() => assembleSourceGapCandidate(packet, f.baseline, laterAudit, current), /candidate freeze implementation changed/);
  }
});

test('candidate freeze format, seed, contract, prompt, timestamps and complete file list are strict', async () => {
  for (const update of [{ format: 'unknown' }, { selectionSeed: 'other' }, { generationContract: 'other' },
    { retrievalContract: 'other' }, { systemInstructionsSha256: 'f'.repeat(64) }, { frozen: false },
    { createdAt: '2026-10-18T00:00:00' }, { createdAt: '2026-02-31T00:00:00.000Z' }, { extra: true }]) {
    const packet = input(64); Object.assign(packet.document.candidateFreeze.document, update);
    let calls = 0;
    await assert.rejects(() => freezeSourceGapBaseline(packet, 'screening_deck', bindings(), { async retrieve(): Promise<RetrievalResult> { calls++; throw new Error('Must not retrieve.'); } }), /candidate freeze/);
    assert.equal(calls, 0);
  }
});

test('CLI exposes only explicit offline modes and rejects unsupported/missing/duplicate arguments before reads', async () => {
  const help = await sourceGapRetrievalCli([]); assert.equal(help.providerCalls, 0); assert.equal(help.mode, 'offline_help');
  for (const argv of [['--execute'], ['--assemble'], ['--final-baseline', '--cohort', 'not-read', '--cohort', 'also-not-read', '--out', 'not-written'],
    ['--screening-baseline', '--deck', 'not-read', '--execute', 'true', '--out', 'not-written']]) {
    await assert.rejects(() => sourceGapRetrievalCli(argv));
  }
});

test('assembly CLI writes an exclusive artifact without a retriever/network and never overwrites output', async () => {
  mkdirSync(resolve(repository, 'work'), { recursive: true });
  const folder = mkdtempSync(resolve(repository, 'work/source-gap-fixture-test-'));
  const previousFetch = globalThis.fetch; let networkCalls = 0;
  globalThis.fetch = (async () => { networkCalls++; throw new Error('No network in fixture assembly.'); }) as typeof fetch;
  try {
    const actualBindings = Object.fromEntries(SOURCE_GAP_CODE_FILES.map(path => [path, hash(readFileSync(resolve(repository, path)))]));
    const f = await finalFixture(actualBindings, relative(repository, resolve(folder, 'candidate-freeze.json')));
    const write = (name: string, a: SourceCalibrationArtifact) => { const path = resolve(folder, name); writeFileSync(path, encode(a.document)); return path; };
    write('candidate-freeze.json', f.cohort.document.candidateFreeze);
    const cohortPath = write('cohort.json', f.cohort), baselinePath = write('baseline.json', f.baseline), auditPath = write('audit.json', f.audit), out = resolve(folder, 'paired.json');
    const args = ['--assemble', '--cohort', cohortPath, '--baseline', baselinePath, '--family-audit', auditPath, '--out', out];
    const result = await sourceGapRetrievalCli(args);
    assert.equal(result.cases, 8); assert.equal(result.providerCalls, 0); assert.equal(networkCalls, 0);
    const paired = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(paired.inputArtifacts.finalBaseline.path, relative(repository, baselinePath));
    assert.equal(paired.inputArtifacts.finalBaseline.fileSha256, hash(readFileSync(baselinePath)));
    assert.equal(statSync(out).mode & 0o777, 0o600);
    const original = readFileSync(out); await assert.rejects(() => sourceGapRetrievalCli(args));
    assert.deepEqual(readFileSync(out), original); assert.equal(networkCalls, 0);
  } finally { globalThis.fetch = previousFetch; rmSync(folder, { recursive: true, force: true }); }
});
