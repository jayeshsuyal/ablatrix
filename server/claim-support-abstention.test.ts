import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ABSTENTION_GRADER_VERSION, claimSupportRequestParts, replayClaimSupportReceipt, validateClaimSupportOutput, type ClaimSupportInput, type ClaimSupportWireOutput } from './claim-support.ts';
import { abstentionCalibrationFixtureDataset } from './grader-calibration-fixtures.ts';
import { SapiomFeedbackProvider } from './feedback-provider.ts';
import type { CalibrationReport } from './grader-calibration.ts';

test('historical v1 request bytes and valid receipts stay unchanged; its rejected abstention is never upgraded', () => {
  const bytes = readFileSync(new URL('../docs/evidence/grader-calibration-2026-10-14/live-report-v3.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '4bcfd874f9a60bf04b74cd04617b1273d1065318ebe0be16b1d2eab90f20bdaf');
  const report = JSON.parse(bytes.toString()) as CalibrationReport;
  for (const slot of report.plan.slots) {
    const legacy = claimSupportRequestParts(slot.input), explicit = claimSupportRequestParts({ ...slot.input, graderVersion: 'claim-support-v1' });
    assert.equal(JSON.stringify(legacy.body), JSON.stringify(slot.requestBody));
    assert.deepEqual(explicit.body, legacy.body); assert.equal(legacy.bindings.requestSha256, slot.requestSha256);
  }
  for (const slot of report.slots.filter(slot => slot.assessment)) assert.deepEqual(replayClaimSupportReceipt(report.plan.slots[slot.index].input, slot.receipt!).assessment, slot.assessment);
  const invalid = report.slots[4]; assert.equal(invalid.status, 'invalid');
  assert.throws(() => replayClaimSupportReceipt(report.plan.slots[4].input, invalid.receipt!), /reconciliation/);
});

test('fresh v2 abstention references separate appropriate refusal, unnecessary refusal and a factual addition', () => {
  const data = abstentionCalibrationFixtureDataset();
  assert.equal(data.cases.length, 5); assert.equal(data.families.length, 5);
  for (const item of data.cases) {
    const ref = data.references.find(ref => ref.caseId === item.id)!, parts = claimSupportRequestParts({ runId: item.id, ...item.input });
    assert.equal(parts.prompt.promptVersion, ABSTENTION_GRADER_VERSION); assert.equal(parts.units.length, 1);
    assert.match(parts.prompt.systemInstructions, /never return supported with evidence=\[\]/);
    const output: ClaimSupportWireOutput = { units: parts.units.map(unit => ({ unitId: unit.id, verdict: ref.support, evidence: ref.support === 'supported' ? [{ sourceId: item.input.answer.citations[0].passageId, quote: item.input.answer.citations[0].quote, relation: 'supports' }] : ref.support === 'contradicted' ? [{ sourceId: item.input.evidence[0].id, quote: item.input.evidence[0].text, relation: 'contradicts' }] : [], reason: 'Synthetic contract control, no model judgment.' })), questionCoverage: ref.questionCoverage, answerability: ref.acceptableAxes.answerability[0], correctness: ref.acceptableAxes.correctness[0], uncertaintyHandling: ref.uncertaintyHandling, reason: 'Synthetic source-limited reference control.' };
    const assessment = validateClaimSupportOutput({ runId: item.id, ...item.input }, output);
    assert.ok(ref.acceptableDispositions.includes(assessment.disposition)); assert.equal(assessment.qualityClaimEligible, false);
    if (ref.answerQuality === 'flawed') assert.notEqual(assessment.disposition, 'pass');
    if (ref.support === 'non_factual') { output.units[0].verdict = 'supported'; assert.throws(() => validateClaimSupportOutput({ runId: item.id, ...item.input }, output), /requires a supporting body proof/); }
    if (item.input.product.title.includes('Kelmor')) { assert.equal(ref.support, 'unsupported'); assert.equal(output.units.length, 1); assert.match(parts.units[0].text, /24 hours/); }
  }
  assert.throws(() => claimSupportRequestParts({ runId: 'unknown-version', ...data.cases[0].input, graderVersion: 'future-unknown' as never }), /Unknown frozen/);
});

test('grader version is frozen across transport and receipts cannot cross replay between v1 and v2', async () => {
  const item = abstentionCalibrationFixtureDataset().cases.find(item => item.input.product.title.includes('Peldin'))!;
  for (const version of ['claim-support-v1', ABSTENTION_GRADER_VERSION] as const) {
    const input: ClaimSupportInput = { runId: `versioned-${version}`, ...structuredClone(item.input), graderVersion: version };
    const expected = claimSupportRequestParts(input); let calls = 0;
    const provider = new SapiomFeedbackProvider({ enabled: true, apiKey: 'SYNTHETIC fixture', credentialsFile: '', dbPath: ':memory:', capUsd: 1, allowancePerCallUsd: .1, callLimit: 1,
      fetchImpl: async (_url, init) => {
        calls++; assert.equal(String(init?.body), JSON.stringify(expected.body)); input.graderVersion = version === ABSTENTION_GRADER_VERSION ? 'claim-support-v1' : ABSTENTION_GRADER_VERSION;
        const output = { units: expected.units.map(unit => ({ unitId: unit.id, verdict: 'supported', evidence: [{ sourceId: item.input.evidence[0].id, quote: item.input.answer.citations[0].quote, relation: 'supports' }], reason: 'Synthetic version binding control.' })), questionCoverage: 'complete', answerability: 'answerable', correctness: 'consistent_with_sources', uncertaintyHandling: 'appropriate', reason: 'Synthetic version binding control.' };
        return new Response(JSON.stringify({ model: 'gpt-luna', usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: 'claim_support_v1', arguments: JSON.stringify(output) } }] } }] }));
      } });
    try {
      const result = await provider.gradeClaimSupport(input); assert.equal(result.promptVersion, version); assert.equal(result.assessment.requestSha256, expected.bindings.requestSha256);
      await assert.rejects(provider.gradeClaimSupport(input), /reconciliation/);
      assert.deepEqual(await provider.gradeClaimSupport({ ...input, graderVersion: version }), result); assert.equal(calls, 1);
    } finally { provider.close(); }
  }
});
