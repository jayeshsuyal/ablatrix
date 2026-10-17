import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { qualificationHash as sha } from './grader-qualification.ts';
import { QUALIFICATION_LIVE_BUDGET, type QualificationLivePlan } from './grader-qualification-live.ts';
import { confirmNativeQualification, qualificationApprovalDialog, verifyNativeConfirmationMetadata } from './grader-qualification-live-authorization.ts';
const plan = { executionPlanSha256: 'a'.repeat(64), budget: { ...QUALIFICATION_LIVE_BUDGET } } as QualificationLivePlan;

test('native approval displays the exact plan and every financial bound with Cancel as default', () => {
  const dialog = qualificationApprovalDialog(plan);
  for (const text of [plan.executionPlanSha256, '92 grading calls', '$9.20', '194', '$19.600281', '$20.00', 'not settled charges', 'No retries']) assert.ok(dialog.message.includes(text));
  assert.equal(dialog.challenge, `APPROVE ${'a'.repeat(12)}`);
  assert.ok(dialog.script.includes('defaultButton: "Cancel"')); assert.ok(dialog.script.includes('cancelButton: "Cancel"')); assert.ok(dialog.script.includes('givingUpAfter: 300'));
  assert.ok(dialog.script.includes('result.textReturned !==')); assert.ok(dialog.script.includes('result.buttonReturned !=='));
  const different = qualificationApprovalDialog({ ...plan, executionPlanSha256: 'b'.repeat(64) }); assert.notEqual(different.challenge, dialog.challenge);
  assert.throws(() => qualificationApprovalDialog({ ...plan, budget: { ...plan.budget, newCalls: 93 } as never }), /exact frozen financial scope/);
});

test('prefilling removes transcription but still requires the explicit approval button and exact plan', () => {
  const dialog = qualificationApprovalDialog(plan);
  const run = (reply: { gaveUp: boolean; buttonReturned: string; textReturned: string }) => runInNewContext(dialog.script, {
    Application: { currentApplication: () => ({ displayDialog(message: string, options: Record<string, unknown>) {
      assert.equal(message, dialog.message);
      assert.equal(options.defaultAnswer, dialog.challenge);
      assert.equal(options.defaultButton, 'Cancel');
      assert.equal(options.cancelButton, 'Cancel');
      assert.deepEqual(Array.from(options.buttons as string[]), ['Cancel', 'Approve $9.20']);
      return reply;
    } }) }
  });
  assert.ok(dialog.message.includes('No typing is required'));
  assert.equal(run({ gaveUp: false, buttonReturned: 'Approve $9.20', textReturned: dialog.challenge }), `confirmed:${plan.executionPlanSha256}`);
  assert.throws(() => run({ gaveUp: true, buttonReturned: 'Approve $9.20', textReturned: dialog.challenge }), /timed out/);
  assert.throws(() => run({ gaveUp: false, buttonReturned: 'Cancel', textReturned: dialog.challenge }), /not approved/);
  for (const textReturned of ['', 'APPROVE', ` ${dialog.challenge}`, `APPROVE ${'b'.repeat(12)}`]) {
    assert.throws(() => run({ gaveUp: false, buttonReturned: 'Approve $9.20', textReturned }), /challenge was changed/);
  }
});

test('stored native confirmation is checked audit metadata, never a dispatch capability', () => {
  const body = { channel: 'macos_native_dialog' as const, executionPlanSha256: plan.executionPlanSha256, budgetSha256: sha(plan.budget), challengeSha256: sha(qualificationApprovalDialog(plan).challenge), confirmedAt: '2026-10-15T23:00:00.000Z' };
  assert.deepEqual(verifyNativeConfirmationMetadata(plan, body), body);
  for (const [key, value] of [['channel', 'json_file'], ['executionPlanSha256', 'b'.repeat(64)], ['budgetSha256', 'b'.repeat(64)], ['challengeSha256', 'b'.repeat(64)], ['confirmedAt', 'invalid']]) assert.throws(() => verifyNativeConfirmationMetadata(plan, { ...body, [key]: value }));
  assert.throws(() => verifyNativeConfirmationMetadata(plan, { ...body, approved: true } as never));
  if (process.platform !== 'darwin') assert.throws(() => confirmNativeQualification(plan), /other hosts are closed/);
});
