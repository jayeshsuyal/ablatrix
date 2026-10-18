import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareWorkflowProofPlan,prospectivePairCount,proposedWorkflowProofBudget} from './workflow-proof-plan.ts';
const digest='1'.repeat(64);
const manifest=(role:string,prefix:string,count=234)=>({id:prefix,role,sourceIndexSha256:digest,queriesSha256:prefix.charCodeAt(0).toString(16).repeat(32),referencesSha256:(prefix.charCodeAt(0)+1).toString(16).repeat(32),independentReviewSha256:digest,families:Array.from({length:count},(_,i)=>`${prefix}:${i}`),caseCount:count});
test('prospective paired plan budgets qualification and independent workflow/future-policy arms without execution',()=>{
 const n=prospectivePairCount({minimumGain:.1,discordantRate:.3,maxRegressions:.02}).independentFamilies;
 const packets=[{...manifest('judge_qualification','q',80),repeatChecks:3},manifest('workflow_holdout','w',n),manifest('future_policy_holdout','f',n)];
 const p=prepareWorkflowProofPlan(packets,['exposed']);assert.equal(p.status,'prepared_not_authorized');assert.equal(p.budget.maxCalls,83+n*8);assert.equal(p.packets[1].sourceIndexSha256,digest);assert.equal(proposedWorkflowProofBudget().approved,false);
 const same=structuredClone(packets);same[2].queriesSha256=same[1].queriesSha256;assert.throws(()=>prepareWorkflowProofPlan(same,[]),/packet identities/);
 assert.throws(()=>prepareWorkflowProofPlan(packets,['w:1']),/exposed/);const reused=structuredClone(packets);reused[2].families[0]='w:0';assert.throws(()=>prepareWorkflowProofPlan(reused,[]),/reused/);
 const short=structuredClone(packets);short[1]=manifest('workflow_holdout','w',2);assert.throws(()=>prepareWorkflowProofPlan(short,[]),/sample/);
 assert.throws(()=>prospectivePairCount({minimumGain:.1,discordantRate:.05,maxRegressions:.02}),/invalid/);
});
