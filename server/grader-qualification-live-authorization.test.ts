import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('stored native confirmation is checked audit metadata, never a dispatch capability', () => {
  const body = { channel: 'macos_native_dialog' as const, executionPlanSha256: plan.executionPlanSha256, budgetSha256: sha(plan.budget), challengeSha256: sha(qualificationApprovalDialog(plan).challenge), confirmedAt: '2026-10-15T23:00:00.000Z' };
  assert.deepEqual(verifyNativeConfirmationMetadata(plan, body), body);
  for (const [key, value] of [['channel', 'json_file'], ['executionPlanSha256', 'b'.repeat(64)], ['budgetSha256', 'b'.repeat(64)], ['challengeSha256', 'b'.repeat(64)], ['confirmedAt', 'invalid']]) assert.throws(() => verifyNativeConfirmationMetadata(plan, { ...body, [key]: value }));
  assert.throws(() => verifyNativeConfirmationMetadata(plan, { ...body, approved: true } as never));
  if (process.platform !== 'darwin') assert.throws(() => confirmNativeQualification(plan), /other hosts are closed/);
});
