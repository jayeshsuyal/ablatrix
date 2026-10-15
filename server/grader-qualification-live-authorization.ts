import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { qualificationHash as sha } from './grader-qualification.ts';
import { QUALIFICATION_LIVE_BUDGET, type QualificationLivePlan } from './grader-qualification-live.ts';

export function qualificationApprovalDialog(plan: QualificationLivePlan) {
  assert.match(plan.executionPlanSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(plan.budget, QUALIFICATION_LIVE_BUDGET, 'Native confirmation must display the exact frozen financial scope.');
  const challenge = `APPROVE ${plan.executionPlanSha256.slice(0, 12)}`;
  const message = `Approve this exact paid Ablatrix qualification run?\n\nPlan SHA-256:\n${plan.executionPlanSha256}\n\n80 primary cases + 12 repeats = at most 92 grading calls.\nMaximum additional local allowance: $9.20.\nCumulative attempt ceiling: 194.\nMaximum combined planning usage: $19.600281.\nCumulative local cap: $20.00.\n\nPlanning allowances are not settled charges or a provider-enforced cap. No retries, resume or activation.\n\nType ${challenge} and select Approve $9.20 to authorize this run. Cancel makes no calls.`;
  const script = `const app = Application.currentApplication(); app.includeStandardAdditions = true; const result = app.displayDialog(${JSON.stringify(message)}, {withTitle: "Ablatrix paid-run approval", defaultAnswer: "", buttons: ["Cancel", "Approve $9.20"], defaultButton: "Cancel", cancelButton: "Cancel", givingUpAfter: 300}); if (result.gaveUp || result.buttonReturned !== "Approve $9.20" || result.textReturned !== ${JSON.stringify(challenge)}) throw new Error("Paid qualification was not approved"); ${JSON.stringify(`confirmed:${plan.executionPlanSha256}`)};`;
  return { challenge, message, script };
}
export type NativeQualificationConfirmation = { channel: 'macos_native_dialog'; executionPlanSha256: string; budgetSha256: string; challengeSha256: string; confirmedAt: string };

/** Execution calls this itself: no approval JSON, stdin, environment variable,
 * caller hook or command-line flag can supply the native confirmation result.
 * Unsupported/headless hosts fail closed. This is an interactive local operator
 * channel, not a claim to cryptographically authenticate the human's identity. */
export function confirmNativeQualification(plan: QualificationLivePlan): NativeQualificationConfirmation {
  assert.equal(process.platform, 'darwin', 'Paid qualification requires the interactive macOS approval channel; other hosts are closed.');
  const binary = '/usr/bin/osascript', stat = lstatSync(binary);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.uid === 0 && (stat.mode & 0o022) === 0 && realpathSync(binary) === binary, 'Native confirmation requires the system-owned OS dialog interpreter.');
  const dialog = qualificationApprovalDialog(plan);
  const output = execFileSync(binary, ['-l', 'JavaScript', '-e', dialog.script], { encoding: 'utf8', timeout: 305_000, maxBuffer: 4096, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin' } });
  assert.equal(output.trim(), `confirmed:${plan.executionPlanSha256}`, 'Native approval was cancelled, timed out or did not confirm the exact plan.');
  return { channel: 'macos_native_dialog', executionPlanSha256: plan.executionPlanSha256, budgetSha256: sha(plan.budget), challengeSha256: sha(dialog.challenge), confirmedAt: new Date().toISOString() };
}
/** Stored metadata supports audit binding only. It does not authorize dispatch. */
export function verifyNativeConfirmationMetadata(plan: QualificationLivePlan, confirmation: NativeQualificationConfirmation) {
  assert.equal(sha(Object.keys(confirmation).sort()), sha(['channel', 'executionPlanSha256', 'budgetSha256', 'challengeSha256', 'confirmedAt'].sort()));
  assert.equal(confirmation.channel, 'macos_native_dialog'); assert.equal(confirmation.executionPlanSha256, plan.executionPlanSha256); assert.equal(confirmation.budgetSha256, sha(plan.budget)); assert.equal(confirmation.challengeSha256, sha(qualificationApprovalDialog(plan).challenge));
  assert.ok(typeof confirmation.confirmedAt === 'string' && new Date(confirmation.confirmedAt).toISOString() === confirmation.confirmedAt);
  return confirmation;
}
