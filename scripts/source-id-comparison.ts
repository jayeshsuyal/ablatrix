import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,renameSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {SapiomFeedbackProvider,sourceIdAnswerRequestBody,sourceIdAnswerPromptIdentity} from '../server/feedback-provider.ts';
import {ProductRetriever} from '../server/product-retrieval.ts';
import {ContextComparisonStore,correctionComparisonProtocol,correctionComparisonInput,correctionComparisonRequest,correctionComparisonRequestHash,contextComparisonHash,type CorrectionComparisonPacket} from '../server/context-comparison.ts';
import type {ProductCorpus} from '../server/loop-types.ts';
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const json=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const base='docs/evidence/source-id-correction-2026-10-10';
const codeFiles=['server/feedback-provider.ts','server/citation-options.ts','server/revision-policy.ts','server/context-comparison.ts','server/product-retrieval.ts','scripts/source-id-comparison.ts','scripts/prepare-source-id-cohort.py','scripts/prepare-correction-cohort.py'];
const codeHashes=()=>Object.fromEntries(codeFiles.map(path=>[path,sha(readFileSync(path))]));
const args=process.argv.slice(2),command=args.shift(),flags=new Map<string,string>();
for(let i=0;i<args.length;i+=2){assert.ok(['--out','--plan','--db','--approved-plan-sha256'].includes(args[i])&&args[i+1]&&!flags.has(args[i]));flags.set(args[i],args[i+1]);}
const out=flags.get('--out');assert.ok(out&&!existsSync(out),'New output required. Never overwrite or resume an execution.');
const gate=json(`${base}/offline-qualification.json`);
assert.equal(gate.passed,true);assert.equal(gate.newProviderCalls,0);assert.equal(gate.sourceIdInterface,'source_ids_v1');
for(const [path,hash] of Object.entries(gate.implementationSha256))assert.equal(sha(readFileSync(path)),hash,'Offline qualification implementation changed');
const cohort=json(`${base}/cohort.json`),family=json(`${base}/manual-family-audit.json`);
assert.equal(cohort.cases.length,8);assert.equal(family.passed,true);assert.equal(family.cohortFileSha256,sha(readFileSync(`${base}/cohort.json`)));
assert.deepEqual(family.cases.filter((c:any)=>c.passed).map((c:any)=>c.id).sort(),cohort.cases.map((c:any)=>c.id).sort());
const baselinePolicy=readFileSync('server/feedback-loop.ts','utf8').match(/const baseline = '([^']+)';/)?.[1];assert.ok(baselinePolicy);
if(command==='--prepare'){
  assert.equal(flags.size,1);
  // A fresh private cache stores embeddings only; no live or review database is opened.
  const corpus:ProductCorpus={version:`correction-cohort-${cohort.cohortSha256.slice(0,20)}`,source:cohort.source.url,license:cohort.source.license,products:cohort.cases.map((c:any)=>({...c.product,split:'validation'})),cases:[],passages:cohort.cases.flatMap((c:any)=>c.sources.map((s:any)=>({id:s.id,productId:c.product.id,source:s.label,text:s.text,reference:s.reference,sha256:sha(s.text),...(s.originalQuestion?{originalQuestion:s.originalQuestion}:{})})))};
  const retriever=new ProductRetriever(corpus,'.data/source-id-correction-retrieval.sqlite');
  const cases=[];
  const createdAt=new Date().toISOString();
  try{
    for(const c of cohort.cases){
      const retrieval=await retriever.retrieve(c.product.id,c.question);
      assert.ok(retrieval.passages.length>=1&&retrieval.passages.length<=8);
      const originalInput={question:c.question,product:{...c.product,split:'validation' as const},policy:{id:'frozen-source-id-original',parentId:null,instructions:baselinePolicy,rationale:'Shared original using source_ids_v1.',feedbackRunIds:[],status:'baseline' as const,mode:'live' as const,createdAt},passages:retrieval.passages};
      const originalRequest=sourceIdAnswerRequestBody(originalInput);
      const payload=JSON.parse(originalRequest.messages[1].content);
      cases.push({...c,retrieval,generationSourceIds:retrieval.passages.map(s=>s.id),originalInput,originalRequestSha256:sha(JSON.stringify(originalRequest)),quoteOptions:payload.quoteOptions});
    }
  }finally{retriever.close();}
  const protocol=correctionComparisonProtocol('gpt-luna',execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),'source_ids_v1');
  // Before spending, prove that both future revision requests offer the exact
  // original's catalog. The placeholder is never dispatched or called an answer.
  for(const c of cases){
    const probe={id:c.id,product:c.product,question:c.question,sources:c.sources,generationSourceIds:c.generationSourceIds,original:{id:'not-generated',answer:{answer:'Placeholder for a future original; never dispatched.',status:'insufficient_evidence' as const,citations:[]},model:'gpt-luna',providerCallId:null,inputSha256:'0'.repeat(64),requestSha256:c.originalRequestSha256},critique:c.critique,clarifications:[],investigation:{issue:'answer_quality' as const,query:c.question.slice(0,240),selectedSourceIds:c.generationSourceIds,addedSourceIds:[]}};
    for(const arm of ['baseline','candidate'] as const){
      const body=correctionComparisonRequest(protocol,probe,arm,'not-dispatched');
      assert.deepEqual(JSON.parse(body.messages[1].content).quoteOptions,c.quoteOptions);
    }
  }
  const plan={format:'ablatrix-source-id-comparison-plan-v1',id:'source-id-correction-2026-10-10',paidExecutionAuthorized:false,qualification:'offline mechanical checks; not a live model-quality gate',originalPromptIdentity:sourceIdAnswerPromptIdentity(),cohortFileSha256:sha(readFileSync(`${base}/cohort.json`)),familyAuditSha256:sha(readFileSync(`${base}/manual-family-audit.json`)),offlineQualificationSha256:sha(readFileSync(`${base}/offline-qualification.json`)),implementationSha256:codeHashes(),protocol,baselinePolicy,cases,
    order:cases.flatMap((c,i)=>[{caseId:c.id,arm:'original'},...((i%2===0?['baseline','candidate']:['candidate','baseline']).map(arm=>({caseId:c.id,arm})))]),
    limits:{initialLedgerAttempts:73,maximumNewAttempts:24,absoluteCallLimit:97,previouslyApprovedAbsoluteCallLimit:93,planningAllowancePerAttemptUsd:0.1,maximumPlanningAllowanceUsd:2.4,capUsd:10,priorSpendUsd:0.200281,web:false,retries:0},
    selection:'Frozen eight-product stratified cohort; no selection, replacement or critique adaptation based on model outputs.',humanJudgments:0,qualityClaimEligible:false};
  writeFileSync(out,JSON.stringify({createdAt,planSha256:contextComparisonHash(plan),plan},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({out,planSha256:contextComparisonHash(plan),cases:8,plannedCalls:24,newCalls:0}));
}else if(command==='--execute'){
  assert.equal(flags.size,4);assert.ok(flags.get('--plan')&&flags.get('--db')&&flags.get('--approved-plan-sha256'),'A separate, explicit execution approval for this exact new plan is required.');
  const frozen=json(flags.get('--plan')!),plan=frozen.plan;assert.equal(frozen.planSha256,contextComparisonHash(plan));assert.equal(flags.get('--approved-plan-sha256'),frozen.planSha256,'Approval must name the frozen plan hash.');
  assert.equal(plan.format,'ablatrix-source-id-comparison-plan-v1');
  assert.deepEqual(plan.implementationSha256,codeHashes());assert.deepEqual(plan.protocol,correctionComparisonProtocol('gpt-luna',plan.protocol.codeCommit,'source_ids_v1'));assert.deepEqual(plan.originalPromptIdentity,sourceIdAnswerPromptIdentity());
  assert.equal(plan.cohortFileSha256,sha(readFileSync(`${base}/cohort.json`)));assert.equal(plan.familyAuditSha256,sha(readFileSync(`${base}/manual-family-audit.json`)));assert.equal(plan.offlineQualificationSha256,sha(readFileSync(`${base}/offline-qualification.json`)));assert.equal(plan.baselinePolicy,baselinePolicy);
  assert.equal(plan.cases.length,8);assert.equal(plan.order.length,24);assert.deepEqual(plan.cases.map((c:any)=>c.id),cohort.cases.map((c:any)=>c.id));
  for(const c of plan.cases){const original=cohort.cases.find((v:any)=>v.id===c.id);const {retrieval,generationSourceIds,originalInput,originalRequestSha256,quoteOptions,...snapshot}=c;assert.deepEqual(snapshot,original);assert.equal(sha(JSON.stringify(sourceIdAnswerRequestBody(originalInput))),originalRequestSha256);assert.deepEqual(JSON.parse(sourceIdAnswerRequestBody(originalInput).messages[1].content).quoteOptions,quoteOptions);assert.equal(originalInput.question,c.question);assert.equal(originalInput.product.id,c.product.id);assert.equal(originalInput.product.title,c.product.title);assert.equal(originalInput.policy.instructions,plan.baselinePolicy);assert.deepEqual(originalInput.passages,retrieval.passages);assert.deepEqual(generationSourceIds,retrieval.passages.map((s:any)=>s.id));assert.ok(generationSourceIds.length>0&&generationSourceIds.length<=8);for(const p of retrieval.passages){const source=c.sources.find((s:any)=>s.id===p.id);assert.ok(source&&source.text===p.text&&source.originalQuestion===(p.originalQuestion??null));}}
  assert.deepEqual(plan.order,plan.cases.flatMap((c:any,i:number)=>[{caseId:c.id,arm:'original'},...(i%2===0?['baseline','candidate']:['candidate','baseline']).map(arm=>({caseId:c.id,arm}))]));
  assert.equal(process.env.ABLATRIX_LOOP_LIVE,'1');assert.equal(process.env.ABLATRIX_REVISION_WEB,'0');assert.equal(process.env.ABLATRIX_LOOP_CALL_LIMIT,'97');
  const budgetPath=process.env.ABLATRIX_LOOP_BUDGET_DB,reviewPath=process.env.ABLATRIX_PAID_REVIEW_DB;assert.ok(budgetPath&&reviewPath&&existsSync(budgetPath)&&existsSync(reviewPath));
  try{assert.equal(execFileSync('lsof',['-nP','-iTCP:4194','-sTCP:LISTEN'],{encoding:'utf8'}).trim(),'');}catch(e){if((e as any).status!==1)throw e;}
  const budget=new DatabaseSync(budgetPath,{readOnly:true}),review=new DatabaseSync(reviewPath,{readOnly:true});
  const calls=()=>budget.prepare('SELECT * FROM loop_provider_calls ORDER BY rowid').all();
  const before=calls();assert.equal(before.length,73);assert.equal(before.filter(c=>c.status==='pending').length,0);
  const owner=budget.prepare('SELECT expires_at FROM loop_provider_owner WHERE id=1').get();assert.ok(!owner||Number(owner.expires_at)<=Date.now());
  assert.equal(review.prepare("SELECT COUNT(*) AS n FROM answer_revision_jobs WHERE status IN ('queued','running','reconciliation')").get()!.n,0);
  const tables=['answer_versions','answer_review_events','answer_revision_jobs','answer_revision_attempts','paid_answer_reviews','paid_answer_reviews_v2'];
  const history=Object.fromEntries(tables.map(t=>[t,contextComparisonHash(review.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())]));
  mkdirSync(dirname(resolve(out)),{recursive:true});
  const result:any={format:'ablatrix-source-id-comparison-results-v1',mode:'live',planSha256:frozen.planSha256,operatorApprovalPlanSha256:flags.get('--approved-plan-sha256'),startedAt:new Date().toISOString(),status:'running',humanJudgments:0,qualityClaimEligible:false,actualProviderCharges:'unavailable',steps:plan.order.map((step:any)=>({...step,runId:`source-id-${frozen.planSha256.slice(0,14)}-${step.caseId}-${step.arm}`,status:'not_attempted'}))};
  writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  const checkpoint=()=>{writeFileSync(out+'.tmp',JSON.stringify(result,null,2)+'\n',{mode:0o600});renameSync(out+'.tmp',out);};
  const packet:CorrectionComparisonPacket={format:'ablatrix-correction-comparison-v1',id:plan.id,title:'Source-ID correction policy: eight fresh pairs',mode:'live',createdAt:result.startedAt,hypothesis:'compare_correction_policy',protocol:plan.protocol,provenance:{kind:'imported_live',note:'Explicitly approved local run bound to a separately published pre-generation manifest. Imported provider authenticity and prospectivity remain independently unverified.',sourcePacketSha256:frozen.planSha256},cases:[]};
  let active:any,networkDispatches=0,provider:SapiomFeedbackProvider|undefined;
  try{
    provider=new SapiomFeedbackProvider({enabled:true,dbPath:budgetPath,capUsd:10,priorSpendUsd:0.200281,allowancePerCallUsd:0.1,callLimit:97,fetchImpl:async(url,options)=>{
      assert.ok(active&&!active.dispatched);assert.equal(String(url),'https://router.sapiom.ai/v1/chat/completions');assert.equal(options?.method,'POST');
      const body=JSON.parse(String(options.body));assert.equal(body.model,'gpt-luna');assert.equal(body.max_tokens,4096);assert.equal(body.reasoning_effort,'none');assert.equal(body.parallel_tool_calls,false);
      assert.equal(options.body,JSON.stringify(active.expectedBody));
      if(active.arm==='original')assert.equal(sha(String(options.body)),plan.cases.find((c:any)=>c.id===active.caseId).originalRequestSha256);
      assert.ok(++networkDispatches<=24);active.dispatched=true;active.requestBody=body;active.requestSha256=sha(String(options.body));active.dispatchAt=new Date().toISOString();checkpoint();
      const response=await fetch(url,{...options,redirect:'error'});active.httpStatus=response.status;checkpoint();return response;
    }});
    assert.equal(provider.capacity(24).ready,true);
    for(const step of result.steps){
      active=step;const c=plan.cases.find((v:any)=>v.id===step.caseId);assert.equal(provider.receipt(step.runId),undefined);
      const completed=packet.cases.find(v=>v.id===c.id);
      if(step.arm==='original'){
        active.input={...c.originalInput,runId:step.runId};active.expectedBody=sourceIdAnswerRequestBody(active.input);
      }else{
        assert.ok(completed);const {modelAlias,...input}=correctionComparisonInput(plan.protocol,completed,step.arm);assert.equal(modelAlias,'gpt-luna');active.input={...input,runId:step.runId};active.expectedBody=correctionComparisonRequest(plan.protocol,completed,step.arm,step.runId);
      }
      active.inputSha256=contextComparisonHash(active.input);active.status='dispatching';checkpoint();const started=performance.now();
      try{
        const output: Awaited<ReturnType<SapiomFeedbackProvider['answerWithSourceIds']>> | Awaited<ReturnType<SapiomFeedbackProvider['reviseWithSourceIds']>> = step.arm==='original'?await provider.answerWithSourceIds(active.input):await provider.reviseWithSourceIds(active.input);
        active.result=output;active.durationMs=Math.round(performance.now()-started);active.receipt=provider.receipt(step.runId);assert.equal(active.receipt.status,'completed');assert.equal(active.receipt.error_code,null);assert.equal(output.model,'gpt-5.6-luna');
        assert.equal(output.citationInterface,'source_ids_v1');
        const returnedReceipt=JSON.parse(active.receipt.receipt_json);assert.equal(returnedReceipt.citationInterface,'source_ids_v1');assert.equal(returnedReceipt.optionSetSha256,sha(JSON.stringify(c.quoteOptions)));
        const selected=c.retrieval.passages;
        active.quoteChecks=output.answer.citations.map(q=>({passageId:q.passageId,matched:selected.some((s:any)=>s.id===q.passageId&&s.text===q.quote)}));
        assert.ok(active.quoteChecks.every((q:any)=>q.matched));assert.ok(output.answer.status!=='answered'||active.quoteChecks.length>0);
        if(step.arm==='original'){
          const shared:any={id:c.id,product:c.product,question:c.question,sources:c.sources,generationSourceIds:c.generationSourceIds,original:{id:step.runId,answer:output.answer,model:output.model,providerCallId:active.receipt.id,inputSha256:active.inputSha256,requestSha256:active.requestSha256},critique:c.critique,clarifications:[],investigation:{issue:'answer_quality',query:c.question.slice(0,240),selectedSourceIds:c.generationSourceIds,addedSourceIds:[],stopReason:'Frozen hybrid retrieval for a source-ID comparison; no production investigation or external discovery.'},arms:{}};
          for(const arm of ['baseline','candidate'] as const){const runId=result.steps.find((v:any)=>v.caseId===c.id&&v.arm===arm).runId;shared.arms[arm]={id:runId,inputSha256:contextComparisonHash(correctionComparisonInput(plan.protocol,shared,arm)),requestSha256:correctionComparisonRequestHash(plan.protocol,shared,arm,runId),status:'not_attempted',answer:null,model:null,latencyMs:null,usage:null,providerCallId:null,error:'Not attempted; execution has not completed.'};}
          packet.cases.push(shared);
        }else{
          const expected=plan.protocol.policies[step.arm],receipt=JSON.parse(active.receipt.receipt_json);assert.equal(receipt.promptVersion,expected.promptVersion);assert.equal(receipt.systemInstructionsSha256,expected.systemInstructionsSha256);
          const attempt=completed!.arms[step.arm as 'baseline'|'candidate'];assert.equal(active.requestSha256,attempt.requestSha256);
          Object.assign(attempt,{status:'completed',answer:output.answer,model:output.model,latencyMs:active.durationMs,usage:output.usage,providerCallId:active.receipt.id,error:null});
        }
        active.status='completed';checkpoint();console.log(JSON.stringify({caseId:c.id,arm:step.arm,status:'completed'}));
      }catch{
        active.receipt=provider.receipt(step.runId)??null;active.status='failed_or_uncertain';active.durationMs=Math.round(performance.now()-started);
        if(completed&&step.arm!=='original')Object.assign(completed.arms[step.arm as 'baseline'|'candidate'],{status:active.receipt?.status==='failed_or_unknown'?'uncertain':'failed',providerCallId:active.receipt?.id??null,error:'Execution failed or is uncertain; retained without retry.'});
        result.status='stopped';result.stopReason='A dispatch, response or configuration check failed. No retry or case replacement.';checkpoint();break;
      }
    }
    if(result.steps.every((s:any)=>s.status==='completed'))result.status='awaiting_blind_human_review';
    // Preserve the planned eight-product denominator. Do not import a reduced cohort.
    if(packet.cases.length===8){const store=new ContextComparisonStore(flags.get('--db')!);try{result.imported=store.importPacket(packet);}finally{store.close();}result.comparisonPacket=packet;}
  }catch{result.status='stopped';result.stopReason??='Execution configuration or packet import failed. Inspect saved receipts; no automatic retry.';process.exitCode=1;}
  finally{
    provider?.close();result.finishedAt=new Date().toISOString();result.networkDispatches=networkDispatches;const after=calls();result.newProviderAttempts=after.length-before.length;result.newReceipts=after.slice(before.length);result.existingReceiptsUnchanged=contextComparisonHash(after.slice(0,before.length))===contextComparisonHash(before);result.existingReviewStateUnchanged=tables.every(t=>contextComparisonHash(review.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())===history[t]);if(result.status==='stopped')process.exitCode=1;checkpoint();review.close();budget.close();console.log(JSON.stringify({out,status:result.status,newProviderAttempts:result.newProviderAttempts,imported:!!result.imported}));
  }
}else throw new Error('Unknown command. No provider constructed.');
