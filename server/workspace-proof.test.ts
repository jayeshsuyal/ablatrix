import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SyntheticAnswerProvider} from './synthetic-answer-provider.ts';
import {ProductWorkspace} from './product-workspace.ts';
import {AutomaticSupport,verifyAutomaticSupportEvidence} from './automatic-support.ts';
import {createRuntimeGraderBinding} from './runtime-grader.ts';
import {CITED_APPLICABILITY_GRADER_VERSION} from './claim-support-v4.ts';
import {localDemoRetriever} from './local-demo.ts';
import {buildWorkspaceProof,verifyWorkspaceProof} from './workspace-proof.ts';
import {runDevelopmentRewriteControl,verifyDevelopmentRewriteControl} from './development-rewrite-control.ts';
const rehash=(packet:any)=>{const {sha256,...body}=packet;return {...body,sha256:createHash('sha256').update(JSON.stringify(body)).digest('hex')};};
test('whole-cohort proof replays exact source/answer/check receipts and preserves unknown and failed denominators',async()=>{
 const provider=new SyntheticAnswerProvider(':memory:'),workspace=new ProductWorkspace(':memory:',provider,localDemoRetriever),checks=new AutomaticSupport(provider,':memory:',{graderBinding:createRuntimeGraderBinding('synthetic',CITED_APPLICABILITY_GRADER_VERSION)});
 try{
  const product=workspace.createProduct({title:'Fictional proof bottle',sources:[{label:'Fictional saved specification',text:'SYNTHETIC fixture: This fictional bottle holds six cups and has a cork lid.'}]});
  const run=await workspace.ask({productId:product.id,question:'What capacity and lid are listed?',mode:'synthetic'});
  checks.enqueue(workspace.reviewSnapshots(run.id)[0]);for(let i=0;i<3;i++)await checks.tick();
  assert.equal(checks.overview()[0].status,'repaired');
  await workspace.ask({productId:product.id,question:'What else is listed about this bottle?',mode:'synthetic'});
  await workspace.ask({productId:product.id,question:'Preview this product evidence.',mode:'preview'});
  const packet=buildWorkspaceProof(workspace.proofRuns(),checks.verifiedOverview(),id=>provider.receipt(id));
  assert.deepEqual(packet.paired,{wins:1,ties:0,regressions:0,unresolved:1});assert.equal(packet.cohort.planned,2);assert.equal(packet.cohort.previewExcluded,1);assert.equal(packet.accounting.calls,0);assert.equal(packet.accounting.recordedOperations,5);assert.equal(packet.metrics.repairTriggered.original.denominator,1);assert.equal(packet.qualityClaimEligible,false);
  assert.equal(verifyWorkspaceProof(packet).valid,true);
  const summary=structuredClone(packet);summary.paired.wins=2;assert.throws(()=>verifyWorkspaceProof(rehash(summary)),/derived/);
  const altered=structuredClone(packet);altered.cases.find(item=>item.job)!.run.answer!.answer='SYNTHETIC changed original';assert.throws(()=>verifyWorkspaceProof(rehash(altered)),/exact original workspace run|original differs/);
  const detached=structuredClone(packet);const plain=detached.cases.find(item=>!item.job)!;plain.run.question='Changed question with a genuine older receipt';assert.throws(()=>verifyWorkspaceProof(rehash(detached)),/identity is inconsistent/);
  const status=structuredClone(packet);status.cases[0].run.status='failed';assert.throws(()=>verifyWorkspaceProof(rehash(status)),/acceptance state/);
  const receiptId=structuredClone(packet);receiptId.cases[0].run.generation!.receiptId='wrong-receipt';assert.throws(()=>verifyWorkspaceProof(rehash(receiptId)),/receipt identity/);
  const grade=structuredClone(packet);const checked=grade.cases.find(item=>item.job)!;checked.job!.assessments[0].assessment.reason='changed';assert.throws(()=>verifyWorkspaceProof(rehash(grade)),/exact replay/);
  const liveRun = { ...run, mode: 'live' as const, requestIdentity: undefined, generation: undefined, generationProtocol: undefined, runtimePolicy: undefined, runtimePolicyInstructions: undefined }; // Unverified legacy-shaped accounting fixture only.
  const liveJob = structuredClone(checks.overview()[0]); liveJob.mode = 'live'; delete liveJob.original.mode; delete liveJob.original.runtimePolicy; liveJob.original.promptVersion = undefined as unknown as string;
  const originalReceipt = { ...provider.receipt(run.id)!, allowance_usd: .1, input_tokens: 10, output_tokens: 5 };
  const partial = buildWorkspaceProof([liveRun], [liveJob], id => id === run.id ? originalReceipt : undefined);
  assert.equal(partial.accounting.calls, 1); assert.equal(partial.accounting.unknownCallSlots, 3); assert.equal(partial.accounting.planningAllowanceUsd, null); assert.equal(partial.accounting.tokens, null);
  const control=await runDevelopmentRewriteControl(checks.overview()[0],provider);assert.equal(verifyDevelopmentRewriteControl(control).valid,true);assert.equal(control.accounting.providerCalls,0);assert.equal(control.outcomes.extraAttempt,'pass');assert.equal(control.outcomes.guided,'pass');
  const metadata=structuredClone(control);metadata.heldConstant.model='altered-model';assert.throws(()=>verifyDevelopmentRewriteControl(rehash(metadata)),/held-constant/);
  const changed=structuredClone(control);changed.control.input.critique='Use a different hint';assert.throws(()=>verifyDevelopmentRewriteControl(rehash(changed)),/matched/);
 }finally{checks.close();workspace.close();provider.close();}
});

test('a completed but invalid original receipt remains an unaccepted diagnostic attempt in the cohort',async()=>{
 class InvalidSynthetic extends SyntheticAnswerProvider{
  override receipt(runId:string){const receipt=super.receipt(runId);if(!receipt||receipt.kind!=='workspace_answer_flat_sources_v1')return receipt;const document=JSON.parse(receipt.receipt_json!);document.output.citations=['src_not_offered'];return {...receipt,receipt_json:JSON.stringify(document)};}
 }
 const provider=new InvalidSynthetic(':memory:'),workspace=new ProductWorkspace(':memory:',provider,localDemoRetriever);
 try{
  const product=workspace.createProduct({title:'Invalid-output fixture jar',sources:[{label:'Fictional specification',text:'SYNTHETIC fixture: This fictional jar holds one liter.'}]});
  const run=await workspace.ask({productId:product.id,question:'How much does the jar hold?',mode:'synthetic'});
  assert.equal(run.status,'failed');assert.equal(provider.receipt(run.id)?.status,'completed');
  const proof=buildWorkspaceProof(workspace.proofRuns(),[],id=>provider.receipt(id));assert.equal(proof.cohort.planned,1);assert.equal(proof.paired.unresolved,1);assert.equal(proof.accounting.recordedOperations,1);assert.ok(proof.cases[0].unknowns.includes('generation_result_not_accepted'));assert.equal(verifyWorkspaceProof(proof).valid,true);
 }finally{workspace.close();provider.close();}
});

test('proof rejects missing repair phases and leaves terminal uncertainty unresolved',async()=>{
 const provider=new SyntheticAnswerProvider(':memory:'),workspace=new ProductWorkspace(':memory:',provider,localDemoRetriever),checks=new AutomaticSupport(provider,':memory:',{graderBinding:createRuntimeGraderBinding('synthetic',CITED_APPLICABILITY_GRADER_VERSION)});
 try{
  const product=workspace.createProduct({title:'Fictional phase-prefix bottle',sources:[{label:'Fictional specification',text:'SYNTHETIC fixture: The bottle holds six cups and has a cork lid.'}]});
  const run=await workspace.ask({productId:product.id,question:'What capacity and lid are listed?',mode:'synthetic'});
  checks.enqueue(workspace.reviewSnapshots(run.id)[0]);for(let phase=0;phase<3;phase++)await checks.tick();
  const repaired=checks.overview()[0];assert.equal(repaired.status,'repaired');
  const stopped=structuredClone(repaired);stopped.status='inconclusive';stopped.delivery={origin:'safe_abstention',versionId:null,answer:{status:'insufficient_evidence',answer:'SYNTHETIC example: I could not confirm an answer against the saved sources.',citations:[]}};
  verifyAutomaticSupportEvidence(stopped,id=>provider.receipt(id));
  const unresolved=buildWorkspaceProof([run],[stopped],id=>provider.receipt(id));
  assert.deepEqual(unresolved.paired,{wins:0,ties:0,regressions:0,unresolved:1});assert.equal(unresolved.metrics.finalDelivery.assessed,0);assert.equal(verifyWorkspaceProof(unresolved).valid,true);
  const missing=structuredClone(stopped);missing.operations=missing.operations.filter(operation=>operation.phase!=='repair');
  assert.throws(()=>verifyAutomaticSupportEvidence(missing,id=>provider.receipt(id)),/phase prefix|completed repair operation/);
  assert.throws(()=>verifyWorkspaceProof(buildWorkspaceProof([run],[missing],id=>provider.receipt(id))),/phase prefix|completed repair operation/);
  const reordered=structuredClone(stopped);reordered.operations.reverse();assert.throws(()=>verifyAutomaticSupportEvidence(reordered,id=>provider.receipt(id)),/phase prefix/);
  const unfinished=structuredClone(stopped);unfinished.operations[1].status='unknown';assert.throws(()=>verifyAutomaticSupportEvidence(unfinished,id=>provider.receipt(id)),/phase prefix/);
 }finally{checks.close();workspace.close();provider.close();}
});

test('final-delivery metrics retain supported originals and preserve legacy proof verification',async()=>{
 class SupportedOriginal extends SyntheticAnswerProvider{
  override receipt(runId:string){const receipt=super.receipt(runId);if(!receipt||receipt.kind!=='workspace_answer_flat_sources_v1')return receipt;const document=JSON.parse(receipt.receipt_json!);document.output.answer=document.output.answer.replace(/^SYNTHETIC draft/,'SYNTHETIC revision');return {...receipt,receipt_json:JSON.stringify(document)};}
 }
 const provider=new SupportedOriginal(':memory:'),workspace=new ProductWorkspace(':memory:',provider,localDemoRetriever),checks=new AutomaticSupport(provider,':memory:',{graderBinding:createRuntimeGraderBinding('synthetic',CITED_APPLICABILITY_GRADER_VERSION)});
 try{
  const product=workspace.createProduct({title:'Fictional already-supported bottle',sources:[{label:'Fictional specification',text:'SYNTHETIC fixture: The bottle holds six cups and has a cork lid.'}]});
  const run=await workspace.ask({productId:product.id,question:'What capacity and lid are listed?',mode:'synthetic'});
  checks.enqueue(workspace.reviewSnapshots(run.id)[0]);await checks.tick();assert.equal(checks.overview()[0].status,'supported');
  const proof=buildWorkspaceProof([run],checks.verifiedOverview(),id=>provider.receipt(id));
  assert.equal(proof.paired.ties,1);assert.equal(proof.metrics.wholeCohort.original.usefulSupportedAnswers,1);assert.equal(proof.metrics.wholeCohort.repair.assessed,0);
  assert.deepEqual(proof.metrics.finalDelivery,proof.metrics.wholeCohort.original);assert.equal(verifyWorkspaceProof(proof).finalDeliveryMetrics,'verified');
  const changed=structuredClone(proof);changed.metrics.finalDelivery.usefulSupportedAnswers=0;assert.throws(()=>verifyWorkspaceProof(rehash(changed)),/derived/);
  const legacy=structuredClone(proof);Reflect.deleteProperty(legacy.metrics,'finalDelivery');assert.equal(verifyWorkspaceProof(rehash(legacy)).finalDeliveryMetrics,'absent_legacy');
 }finally{checks.close();workspace.close();provider.close();}
});

test('workflow elapsed time stays unknown throughout an unfinished automatic check',async()=>{
 const provider=new SyntheticAnswerProvider(':memory:'),workspace=new ProductWorkspace(':memory:',provider,localDemoRetriever),checks=new AutomaticSupport(provider,':memory:',{graderBinding:createRuntimeGraderBinding('synthetic',CITED_APPLICABILITY_GRADER_VERSION)});
 try{
  const product=workspace.createProduct({title:'Fictional pending-time bottle',sources:[{label:'Fictional specification',text:'SYNTHETIC fixture: The bottle holds six cups and has a cork lid.'}]});
  const run=await workspace.ask({productId:product.id,question:'What capacity and lid are listed?',mode:'synthetic'},undefined,{automaticCheck:true});assert.ok(run.finishedAt);assert.equal(run.automaticCheckHandoff,'pending');
  const handoff=buildWorkspaceProof([run],[],id=>provider.receipt(id));
  assert.equal(handoff.cases[0].totalMs,null);assert.equal(handoff.accounting.totalMs,null);assert.equal(verifyWorkspaceProof(handoff).valid,true);
  checks.enqueue(workspace.reviewSnapshots(run.id)[0]);
  for (const phase of ['grade_original','repair','grade_repair']) {
   assert.equal(checks.overview()[0].phase,phase);assert.equal(checks.overview()[0].finishedAt,undefined);
   const pending=buildWorkspaceProof([run],checks.verifiedOverview(),id=>provider.receipt(id));
   assert.equal(pending.cases[0].totalMs,null);assert.equal(pending.accounting.totalMs,null);assert.ok(pending.cases[0].unknowns.includes('elapsed_time_unavailable'));assert.equal(verifyWorkspaceProof(pending).valid,true);
   await checks.tick();
  }
  const finished=buildWorkspaceProof([run],checks.verifiedOverview(),id=>provider.receipt(id));
  assert.equal(typeof finished.cases[0].totalMs,'number');assert.equal(typeof finished.accounting.totalMs,'number');assert.equal(verifyWorkspaceProof(finished).valid,true);
 }finally{checks.close();workspace.close();provider.close();}
});
