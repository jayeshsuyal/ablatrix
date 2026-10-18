import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SyntheticAnswerProvider } from './synthetic-answer-provider.ts';
import { RuntimeAnswerPolicyStore } from './runtime-answer-policy.ts';
import { AnswerPolicyWorker } from './answer-policy-worker.ts';
import { RejectedPolicyDemoProvider, seedRejectedPolicyDemo } from './rejected-policy-demo-fixture.ts';
import { createRuntimeGraderBinding } from './runtime-grader.ts';
import { CITED_APPLICABILITY_GRADER_VERSION } from './claim-support-v4.ts';
import { AutomaticSupport } from './automatic-support.ts';

test('demo evaluates and durably rejects a blanket-abstention candidate while retaining baseline', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rejected-policy-demo-')), receipts = join(directory, 'receipts.sqlite'), policyPath = join(directory, 'runtime-policy.sqlite');
  let outbound = 0; const previous = globalThis.fetch; globalThis.fetch = async () => { outbound++; throw new Error('No network in fictional demo.'); };
  const provider = new SyntheticAnswerProvider(receipts), policies = new RuntimeAnswerPolicyStore(policyPath);
  try {
    const demo = await seedRejectedPolicyDemo(directory, provider, policies), before = JSON.stringify(demo.worker.exportEvidence());
    assert.equal(demo.decision.verdict, 'rejected'); assert.equal(demo.decision.complete, true); assert.equal(demo.decision.operations.length, 13);
    assert.equal(demo.decision.candidateMetrics.unnecessaryAbstentions, 2); assert.equal(demo.decision.candidateMetrics.regressions, 1);
    assert.equal(policies.capture('synthetic').id, demo.baselineId); assert.equal(policies.overview('synthetic').events.length, 0);
    assert.equal(demo.providerCalls, 0); assert.equal(outbound, 0); assert.equal(demo.qualityClaimEligible, false);
    assert.throws(() => demo.worker.activateTrial(demo.groupId), /eligible/); demo.close(); demo.close();
    const replayProvider = new RejectedPolicyDemoProvider(provider, join(directory, 'rejected-policy-receipts.sqlite'));
    const support = new AutomaticSupport(provider, join(directory, 'rejected-policy-support.sqlite'));
    const replay = new AnswerPolicyWorker(replayProvider, policies, policyPath, { graderBinding: createRuntimeGraderBinding('synthetic', CITED_APPLICABILITY_GRADER_VERSION), completedJobs: () => support.overview() });
    try { assert.equal(JSON.stringify(replay.exportEvidence()), before); assert.equal(policies.capture('synthetic').id, demo.baselineId); assert.throws(() => replay.activateTrial(demo.groupId), /eligible/); }
    finally { replay.close(); support.close(); replayProvider.close(); }
  } finally { provider.close(); policies.close(); globalThis.fetch = previous; rmSync(directory, { recursive: true, force: true }); }
});
