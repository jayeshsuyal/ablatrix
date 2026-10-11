import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PaidAnswerReview } from './paid-answer-review.ts';
import { revisionPromptIdentity } from './revision-policy.ts';

export const correctionHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const correctionFileHash = (path: string) => createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex');
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const cases = [
  { qid:'26', criterion:'Attribute white/off-white/light-gray reports and lighter-than-pewter comparison to customers; no manufacturer-color certainty or speculation about an unseen image. Avoid repeated evidence framing.' },
  { qid:'63', criterion:'Directly explain that one slim-quarter keg is a listed configuration while up to two sixth-barrel kegs are listed. Two slim-quarter kegs are not a listed supported configuration. Do not assert independently tested impossibility or ask for the supplied model again.' },
  { qid:'19', criterion:'Remove the claim that the source matches this questioner\'s model. Preserve uncertainty about interchangeability between 241543917 and 240337103. Historical CQA refers to a different refrigerator; do not transfer it.' },
  { qid:'47', criterion:'Do not establish WMR200 compatibility from other models\' customer questions or a generic compatibility statement. Request documentation of WMR200 compatibility without asking for the already supplied station identifier.' },
  { qid:'75', criterion:'Retain the supported customer reports of use with stacked washers/dryers, with attribution. Do not turn customer experience into a universal compatibility guarantee or an unnecessary refusal.' },
  { qid:'4', criterion:'Preserve the distinction between reported use on well water and suitability of a city-water test kit. Do not resolve the conflicting sources into an unsupported guarantee that the kit is appropriate for well-water testing.' }
];
export function correctionDevelopmentPlan() {
  const reviews = new PaidAnswerReview(':memory:');
  const prior = JSON.parse(readFileSync(new URL('../docs/evidence/local-correction-live-2026-10-10.json', import.meta.url), 'utf8'));
  try {
    const saved=reviews.overview();
    const inputs=cases.map(({qid,criterion})=>{
      const item=saved.cases.find(item=>item.qid===qid)!;
      if (!item?.result?.run.answer) throw new Error('Development source missing');
      const commonFeedback='Review the answer against these saved sources. Retain correct supported content, correct unsupported or overstated claims, and explain any genuinely unresolved part. Preserve the scope of each original customer question. Write a direct, natural answer; do not speculate about information not supplied.';
      const evidence=item.sources.map(source=>({id:`${qid}:${source.sha256}`,source:source.label,text:source.text,originalQuestion:source.originalQuestion??undefined,origin:'pinned'}));
      const input=prior.cases.find((value:{qid:string})=>value.qid===qid)?.input ?? {question:item.question,product:{id:item.asin,title:item.title},rejectedAnswer:item.result.run.answer.answer,critique:commonFeedback,evidence,clarifications:[],investigation:{issue:'answer_quality',query:item.question,selectedSourceIds:evidence.map(source=>source.id),addedSourceIds:[],stopReason:'Frozen development evaluation source pool; generation probe only, not a production investigation decision.'}};
      const {runId:_,...shared}=input;
      return {qid,criterion,input:clean(shared),priorBaseline:prior.cases.find((value:{qid:string})=>value.qid===qid)?.version.answer??null,reviewKind:'ai_assisted' as const};
    });
    return {format:'ablatrix-correction-development-plan-v1' as const,id:'correction-policy-dev-2026-10-10',selection:'previously_exposed_development_cases' as const,
      cases:inputs,policies:{baseline:revisionPromptIdentity('baseline',true),candidate:revisionPromptIdentity('candidate_v4',true)},
      implementationSha256:Object.fromEntries(['server/feedback-provider.ts','server/revision-policy.ts','server/correction-policy-development.ts','scripts/correction-policy-experiment.ts'].map(path=>[path,correctionFileHash(path)])),
      limits:{initialLedgerAttempts:63,developmentAttempts:6,conditionalFreshProducts:8,conditionalFreshAttempts:24,maxTotalNewAttempts:30,absoluteCallLimit:93,allowancePerAttemptUsd:0.1,maxNewPlanningAllowanceUsd:3,existingPlanCapUsd:10,priorSpendUsd:0.200281,webEnabled:false,automaticRetries:0},
      gate:{kind:'independent_ai_development_assessment',allCriteriaRequired:true,exactQuotesRequired:true,noUnsupportedClaims:true,noStatusTokensInProse:true,uncertainOrFailedStopsValidation:true,qualityClaimEligible:false,humanJudgments:0},
      scope:'Evaluation-only revision prompt variant. Existing first-pass and product-revision defaults remain baseline. Existing product versions and human judgments are never overwritten.'};
  } finally { reviews.close(); }
}
