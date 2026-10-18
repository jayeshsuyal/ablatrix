import { createHash } from 'node:crypto';
import { automaticSupportGradeInput, automaticSupportRepairInput, verifyAutomaticSupportEvidence, type AutomaticSupportJob, type AutomaticSupportProvider } from './automatic-support.ts';
import { revisionPromptIdentity } from './revision-policy.ts';
import { revisionRequestBody } from './feedback-provider.ts';
import { claimSupportRequestParts, replayClaimSupportReceipt } from './claim-support.ts';
import type { AnswerRevisionReceipt } from './answer-revisions.ts';
const INTERVENTION='reviewerCritique is empty in the control; all other request fields are identical';
const LIMITATION='Synthetic templates do not respond to critique semantically. This proves a matched protocol, not benefit.';
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Development mechanics only. The two revision arms use the same model,
 * prompt, sources and rejected answer; only reviewerCritique is removed. */
export async function runDevelopmentRewriteControl(job:AutomaticSupportJob,provider:AutomaticSupportProvider){
 if(provider.executionMode!=='synthetic'||job.mode!=='synthetic')throw new Error('This development rehearsal accepts the offline synthetic provider only. No live execution is implemented.');
 verifyAutomaticSupportEvidence(job,provider.receipt.bind(provider));
 if(!job.repaired||!job.assessments.some(item=>item.phase==='repair'))throw new Error('A completed critique-guided repair and recheck are required for this matched control.');
 const guidedInput=automaticSupportRepairInput(job),controlInput={...guidedInput,runId:`${job.id}:extra-attempt-no-critique`,critique:''};
 const guidedBody=revisionRequestBody(guidedInput),controlBody=revisionRequestBody(controlInput);
 const guidedPayload=JSON.parse(guidedBody.messages[1]!.content),controlPayload=JSON.parse(controlBody.messages[1]!.content);
 guidedPayload.reviewerCritique='';
 if(JSON.stringify({...guidedBody,messages:[guidedBody.messages[0],{role:'user',content:JSON.stringify(guidedPayload)}]})!==JSON.stringify(controlBody)||controlPayload.reviewerCritique!=='')throw new Error('The matched rewrite changes fields beyond the critique.');
 const start=Date.now();
 const rewritten=await provider.reviseAutomatic(controlInput);
 const gradeInput={...automaticSupportGradeInput(job,'grade_original'),runId:`${job.id}:grade-extra-attempt`,answer:rewritten.answer};
 const grade=await provider.gradeClaimSupport(gradeInput);
 const rewriteReceipt=provider.receipt(controlInput.runId),gradeReceipt=provider.receipt(gradeInput.runId);
 if(!rewriteReceipt||!gradeReceipt)throw new Error('Matched control requires durable receipts.');
 const body={format:'development-rewrite-control-v1' as const,kind:'critique_vs_matched_extra_attempt' as const,provenance:'synthetic_exposed_development_mechanics' as const,qualityClaimEligible:false as const,
  originalJob:job,originalReceipts:job.operations.map(operation=>({runId:operation.runId,receipt:provider.receipt(operation.runId)!})),
  heldConstant:{model:rewritten.model,revisionPrompt:JSON.parse(rewriteReceipt.receipt_json!).promptVersion,sourceContextSha256:job.sourceContextSha256,grader:job.graderBinding??null},
  intervention:INTERVENTION,control:{input:controlInput,requestSha256:sha(controlBody),answer:rewritten.answer,receipt:rewriteReceipt,gradeInput,grade:grade.assessment,gradeReceipt},
  outcomes:{guided:job.assessments.find(item=>item.phase==='repair')!.assessment.disposition,extraAttempt:grade.assessment.disposition},accounting:{additionalRecordedOperations:2,providerCalls:0,totalMs:Date.now()-start,planningAllowanceUsd:0,tokens:null},limitation:LIMITATION};
 return {...body,sha256:sha(body)};
}
export type DevelopmentRewriteControl=Awaited<ReturnType<typeof runDevelopmentRewriteControl>>;
export function verifyDevelopmentRewriteControl(packet:DevelopmentRewriteControl){
 const {sha256,...body}=packet;if(sha(body)!==sha256||packet.provenance!=='synthetic_exposed_development_mechanics'||packet.qualityClaimEligible!==false)throw new Error('Development control identity mismatch.');
 if(packet.intervention!==INTERVENTION||packet.limitation!==LIMITATION||packet.originalReceipts.length!==packet.originalJob.operations.length||new Set(packet.originalReceipts.map(item=>item.runId)).size!==packet.originalJob.operations.length||packet.originalReceipts.some(item=>!packet.originalJob.operations.some(operation=>operation.runId===item.runId)))throw new Error('Development control metadata or receipt set is inconsistent.');
 const receipts=new Map<string,AnswerRevisionReceipt>(packet.originalReceipts.map(item=>[item.runId,item.receipt]));verifyAutomaticSupportEvidence(packet.originalJob,id=>receipts.get(id));
 const expected={...automaticSupportRepairInput(packet.originalJob),runId:`${packet.originalJob.id}:extra-attempt-no-critique`,critique:''};
 if(JSON.stringify(expected)!==JSON.stringify(packet.control.input)||sha(revisionRequestBody(expected))!==packet.control.requestSha256)throw new Error('Development control is not a matched no-critique request.');
 const receipt=packet.control.receipt,document=JSON.parse(receipt.receipt_json!),prompt=revisionPromptIdentity('baseline',false);
 if(packet.format!=='development-rewrite-control-v1'||packet.kind!=='critique_vs_matched_extra_attempt'||packet.accounting.providerCalls!==0||packet.accounting.additionalRecordedOperations!==2||packet.accounting.planningAllowanceUsd!==0||packet.accounting.tokens!==null||!Number.isFinite(packet.accounting.totalMs)||packet.accounting.totalMs<0||receipt.status!=='completed'||receipt.kind!=='synthetic_automatic_revision'||receipt.error_code||receipt.model!=='synthetic-fixture'||receipt.executionMode!=='synthetic'||receipt.allowance_usd!==0||document.model!==receipt.model||document.promptVersion!==prompt.promptVersion||document.systemInstructionsSha256!==prompt.systemInstructionsSha256)throw new Error('Development control provenance or accounting is invalid.');
 if(document.requestSha256!==packet.control.requestSha256||document.accounting!=='no_provider_call'||JSON.stringify(document.output)!==JSON.stringify(packet.control.answer))throw new Error('Development rewrite does not match its receipt.');
 const held={model:document.model,revisionPrompt:document.promptVersion,sourceContextSha256:packet.originalJob.sourceContextSha256,grader:packet.originalJob.graderBinding??null};
 if(JSON.stringify(held)!==JSON.stringify(packet.heldConstant))throw new Error('Development held-constant identities differ from actual receipts.');
 const expectedGrade={...automaticSupportGradeInput(packet.originalJob,'grade_original'),runId:`${packet.originalJob.id}:grade-extra-attempt`,answer:packet.control.answer};
 if(JSON.stringify(expectedGrade)!==JSON.stringify(packet.control.gradeInput))throw new Error('Control grade input differs from frozen original context.');
 const result=replayClaimSupportReceipt(expectedGrade,packet.control.gradeReceipt,'synthetic');
 if(JSON.stringify(result.assessment)!==JSON.stringify(packet.control.grade)||packet.outcomes.guided!==packet.originalJob.assessments.find(item=>item.phase==='repair')!.assessment.disposition||packet.outcomes.extraAttempt!==result.assessment.disposition)throw new Error('Development control grades differ from exact replay.');
 claimSupportRequestParts(expectedGrade);
 return {valid:true as const,sha256,qualityClaimEligible:false as const};
}
