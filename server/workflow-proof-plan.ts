import { createHash } from 'node:crypto';
import { z } from 'zod';
import { WORKSPACE_GENERATION_CONTRACT } from './workspace-generation.ts';
import { CITED_APPLICABILITY_GRADER_VERSION, claimSupportV4ContractIdentity } from './claim-support-v4.ts';

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const packetSchema=z.object({ id:z.string().min(1).max(160), role:z.enum(['judge_qualification','workflow_holdout','future_policy_holdout']), sourceIndexSha256:digest, queriesSha256:digest, referencesSha256:digest, independentReviewSha256:digest, families:z.array(z.string().trim().min(1).max(160)).min(1), caseCount:z.number().int().positive(), repeatChecks:z.number().int().min(0).max(100).default(0) }).strict();
export type ProofPacketManifest=z.infer<typeof packetSchema>;
/** Approximate paired-design planning, not a post-hoc power claim. Inputs are
 * frozen development assumptions; independent products are the sampling unit. */
export function prospectivePairCount(input:{minimumGain:number;discordantRate:number;maxRegressions:number}) {
  const {minimumGain:g,discordantRate:d,maxRegressions:r}=input;
  if (!(g>0 && g<1 && d>=g && d<=1 && r>=0 && r<g)) throw new Error('Prospective paired assumptions are invalid.');
  const n=Math.ceil(((1.96*Math.sqrt(d)+0.842*Math.sqrt(d-g*g))**2)/(g*g));
  return { independentFamilies:n, minimumGain:g, discordantRate:d, toleratedRegressionRate:r, alpha:0.05,powerTarget:0.8,method:'normal_approximation_paired_difference', limitation:'A planning approximation; pilot variability, exact paired analysis and human review remain required.' };
}
/** Metadata-only preparation: callers never pass hidden queries or labels here. */
export function prepareWorkflowProofPlan(raw:unknown,exposedFamilies:readonly string[],assumptions={minimumGain:0.10,discordantRate:0.30,maxRegressions:0.02}) {
  const packets=z.array(packetSchema).length(3).parse(raw);
  if(new Set(packets.map(packet=>packet.id)).size!==3||new Set(packets.map(packet=>packet.queriesSha256)).size!==3||new Set(packets.map(packet=>packet.referencesSha256)).size!==3)throw new Error('Independent roles require distinct manifest, query and reference packet identities.');
  if(new Set(packets.map(packet=>packet.role)).size!==3)throw new Error('Separate qualification, workflow and future-policy packets are required.');
  const exposed=new Set(exposedFamilies.map(id=>id.trim().toLowerCase())),used=new Set<string>();
  for(const packet of packets)for(const family of packet.families){const id=family.toLowerCase();if(exposed.has(id)||used.has(id))throw new Error('Packet family was exposed or reused across independent roles.');used.add(id);}
  if(packets.some(packet=>new Set(packet.families.map(id=>id.toLowerCase())).size!==packet.families.length||packet.families.length!==packet.caseCount))throw new Error('Each independent case needs a distinct canonical product family.');
  const sample=prospectivePairCount(assumptions),workflow=packets.find(packet=>packet.role==='workflow_holdout')!,future=packets.find(packet=>packet.role==='future_policy_holdout')!;
  if(workflow.caseCount<sample.independentFamilies||future.caseCount<sample.independentFamilies)throw new Error('Fresh proof packet is below the prospectively chosen independent-family sample.');
  const qualification=packets.find(packet=>packet.role==='judge_qualification')!;
  const calls=qualification.caseCount+qualification.repeatChecks+(workflow.caseCount+workflow.repeatChecks)*4+(future.caseCount+future.repeatChecks)*4;
  const body={format:'workflow-proof-plan-v1',status:'prepared_not_authorized',generationVersion:WORKSPACE_GENERATION_CONTRACT,graderVersion:CITED_APPLICABILITY_GRADER_VERSION,graderIdentity:claimSupportV4ContractIdentity(),packets,exposureSha256:sha([...exposed].sort()),sample,
    controls:{workflow:'original answer versus one critique-guided repair',development:'matched one-call rewrite without critique',futurePolicy:'parent versus proposed instructions; model, retrieval and grader fixed',holdout:'Documents stay in the frozen index; queries and reference labels remain outside tuning.'},
    stopRules:['Stop on unknown provider outcome; never redispatch an ambiguous reservation.','Stop on severe regression or qualification failure.','A failed or incomplete qualification cannot enable the live grader.','Retain baseline when gain is absent, inconclusive or fails source-checked human review.'],
    budget:{maxCalls:calls,allowancePerCallUsd:0.10,additionalPlanningAllowanceUsd:Math.round(calls*10)/100,accounting:'planning_allowance_not_provider_charges'},authorization:'Separate explicit approval for this exact frozen plan and budget is required; this module cannot execute.'};
  return {...body,sha256:sha(body)};
}
export function proposedWorkflowProofBudget(){
  const sample=prospectivePairCount({minimumGain:0.10,discordantRate:0.30,maxRegressions:0.02});
  return {status:'proposal_missing_independent_packets_and_pilot_variability',sample,qualificationCases:80,qualificationRepeatChecks:3,qualificationCalls:83,workflowFamilies:sample.independentFamilies,futurePolicyFamilies:sample.independentFamilies,maxCalls:83+sample.independentFamilies*8,additionalPlanningAllowanceUsd:(83+sample.independentFamilies*8)/10,approved:false,liveQualified:false,qualityClaimEligible:false};
}
