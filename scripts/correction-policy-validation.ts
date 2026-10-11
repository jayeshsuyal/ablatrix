import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,renameSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {SapiomFeedbackProvider} from '../server/feedback-provider.ts';
import {ProductRetriever} from '../server/product-retrieval.ts';
import {ContextComparisonStore,correctionComparisonProtocol,correctionComparisonInput,correctionComparisonRequest,correctionComparisonRequestHash,contextComparisonHash,type CorrectionComparisonPacket} from '../server/context-comparison.ts';
import type {ProductCorpus,LoopPolicy} from '../server/loop-types.ts';
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const json=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const base='docs/evidence/correction-policy-2026-10-10';
const codeFiles=['server/feedback-provider.ts','server/revision-policy.ts','server/context-comparison.ts','server/product-retrieval.ts','scripts/correction-policy-validation.ts'];
const codeHashes=()=>Object.fromEntries(codeFiles.map(path=>[path,sha(readFileSync(path))]));
const args=process.argv.slice(2),command=args.shift(),flags=new Map<string,string>();
for(let i=0;i<args.length;i+=2){assert.ok(['--out','--plan','--db'].includes(args[i])&&args[i+1]&&!flags.has(args[i]));flags.set(args[i],args[i+1]);}
const out=flags.get('--out');assert.ok(out&&!existsSync(out),'New output required. Never overwrite or resume an execution.');
const gate=json(`${base}/development-gate.json`);
assert.equal(gate.gate,'pass','Development gate must pass before fresh retrieval or execution');
assert.equal(gate.files['development-results.json'],sha(readFileSync(`${base}/development-results.json`)));
const development=json(`${base}/development-results.json`);
assert.equal(development.status,'awaiting_ai_development_gate');assert.equal(development.newProviderAttempts,6);
assert.equal(gate.planSha256,development.planSha256);assert.equal(gate.allCriteriaMet,true);
const cohort=json(`${base}/cohort-v3.json`),family=json(`${base}/manual-family-audit-v3.json`);
assert.equal(cohort.cases.length,8);assert.equal(family.passed,true);assert.equal(family.cohortFileSha256,sha(readFileSync(`${base}/cohort-v3.json`)));
assert.deepEqual(family.cases.filter((c:any)=>c.passed).map((c:any)=>c.id).sort(),cohort.cases.map((c:any)=>c.id).sort());
const baselinePolicy=readFileSync('server/feedback-loop.ts','utf8').match(/const baseline = '([^']+)';/)?.[1];assert.ok(baselinePolicy);
if(command==='--prepare'){
  assert.equal(flags.size,1);
  // A fresh private cache stores embeddings only; no live or review database is opened.
  const corpus:ProductCorpus={version:`correction-cohort-${cohort.cohortSha256.slice(0,20)}`,source:cohort.source.url,license:cohort.source.license,products:cohort.cases.map((c:any)=>({...c.product,split:'validation'})),cases:[],passages:cohort.cases.flatMap((c:any)=>c.sources.map((s:any)=>({id:s.id,productId:c.product.id,source:s.label,text:s.text,reference:s.reference,sha256:sha(s.text),...(s.originalQuestion?{originalQuestion:s.originalQuestion}:{})})))};
  const retriever=new ProductRetriever(corpus,'.data/correction-policy-validation-retrieval.sqlite');
  const cases=[];
  try{
    for(const c of cohort.cases){
      const retrieval=await retriever.retrieve(c.product.id,c.question);
      assert.ok(retrieval.passages.length>=1&&retrieval.passages.length<=8);
      cases.push({...c,retrieval,generationSourceIds:retrieval.passages.map(s=>s.id)});
    }
  }finally{retriever.close();}
  const protocol=correctionComparisonProtocol('gpt-luna',execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim());
  assert.equal(protocol.policies.candidate.systemInstructionsSha256,gate.candidateIdentity.systemInstructionsSha256);
  const plan={format:'ablatrix-correction-validation-plan-v1',id:'correction-policy-validation-2026-10-10',cohortFileSha256:sha(readFileSync(`${base}/cohort-v3.json`)),familyAuditSha256:sha(readFileSync(`${base}/manual-family-audit-v3.json`)),developmentGateSha256:sha(readFileSync(`${base}/development-gate.json`)),implementationSha256:codeHashes(),protocol,baselinePolicy,cases,
    order:cases.flatMap((c,i)=>[{caseId:c.id,arm:'original'},...((i%2===0?['baseline','candidate']:['candidate','baseline']).map(arm=>({caseId:c.id,arm})))]),
    limits:{initialLedgerAttempts:69,maximumNewAttempts:24,absoluteCallLimit:93,planningAllowancePerAttemptUsd:0.1,maximumPlanningAllowanceUsd:2.4,capUsd:10,priorSpendUsd:0.200281,web:false,retries:0},
    selection:'Frozen eight-product stratified cohort; no selection, replacement or critique adaptation based on model outputs.',humanJudgments:0,qualityClaimEligible:false};
  writeFileSync(out,JSON.stringify({createdAt:new Date().toISOString(),planSha256:contextComparisonHash(plan),plan},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({out,planSha256:contextComparisonHash(plan),cases:8,plannedCalls:24,newCalls:0}));
}else if(command==='--execute'){
  assert.equal(flags.size,3);assert.ok(flags.get('--plan')&&flags.get('--db'));
  const frozen=json(flags.get('--plan')!),plan=frozen.plan;assert.equal(frozen.planSha256,contextComparisonHash(plan));
  assert.deepEqual(plan.implementationSha256,codeHashes());assert.deepEqual(plan.protocol,correctionComparisonProtocol('gpt-luna',plan.protocol.codeCommit));
  assert.equal(plan.cohortFileSha256,sha(readFileSync(`${base}/cohort-v3.json`)));assert.equal(plan.familyAuditSha256,sha(readFileSync(`${base}/manual-family-audit-v3.json`)));assert.equal(plan.developmentGateSha256,sha(readFileSync(`${base}/development-gate.json`)));assert.equal(plan.baselinePolicy,baselinePolicy);
  assert.equal(plan.cases.length,8);assert.equal(plan.order.length,24);assert.deepEqual(plan.cases.map((c:any)=>c.id),cohort.cases.map((c:any)=>c.id));
  for(const c of plan.cases){const original=cohort.cases.find((v:any)=>v.id===c.id);const {retrieval,generationSourceIds,...snapshot}=c;assert.deepEqual(snapshot,original);assert.deepEqual(generationSourceIds,retrieval.passages.map((s:any)=>s.id));assert.ok(generationSourceIds.length>0&&generationSourceIds.length<=8);for(const p of retrieval.passages){const source=c.sources.find((s:any)=>s.id===p.id);assert.ok(source&&source.text===p.text&&source.originalQuestion===(p.originalQuestion??null));}}
  assert.deepEqual(plan.order,plan.cases.flatMap((c:any,i:number)=>[{caseId:c.id,arm:'original'},...(i%2===0?['baseline','candidate']:['candidate','baseline']).map(arm=>({caseId:c.id,arm}))]));
  assert.equal(process.env.ABLATRIX_LOOP_LIVE,'1');assert.equal(process.env.ABLATRIX_REVISION_WEB,'0');assert.equal(process.env.ABLATRIX_LOOP_CALL_LIMIT,'93');
  const budgetPath=process.env.ABLATRIX_LOOP_BUDGET_DB,reviewPath=process.env.ABLATRIX_PAID_REVIEW_DB;assert.ok(budgetPath&&reviewPath&&existsSync(budgetPath)&&existsSync(reviewPath));
  try{assert.equal(execFileSync('lsof',['-nP','-iTCP:4194','-sTCP:LISTEN'],{encoding:'utf8'}).trim(),'');}catch(e){if((e as any).status!==1)throw e;}
  const budget=new DatabaseSync(budgetPath,{readOnly:true}),review=new DatabaseSync(reviewPath,{readOnly:true});
  const calls=()=>budget.prepare('SELECT * FROM loop_provider_calls ORDER BY rowid').all();
  const before=calls();assert.equal(before.length,69);assert.equal(before.filter(c=>c.status==='pending').length,0);
  const owner=budget.prepare('SELECT expires_at FROM loop_provider_owner WHERE id=1').get();assert.ok(!owner||Number(owner.expires_at)<=Date.now());
  assert.equal(review.prepare("SELECT COUNT(*) AS n FROM answer_revision_jobs WHERE status IN ('queued','running','reconciliation')").get()!.n,0);
  const tables=['answer_versions','answer_review_events','answer_revision_jobs','answer_revision_attempts','paid_answer_reviews','paid_answer_reviews_v2'];
  const history=Object.fromEntries(tables.map(t=>[t,contextComparisonHash(review.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())]));
  mkdirSync(dirname(resolve(out)),{recursive:true});
  const result:any={format:'ablatrix-correction-validation-results-v1',mode:'live',planSha256:frozen.planSha256,startedAt:new Date().toISOString(),status:'running',humanJudgments:0,qualityClaimEligible:false,actualProviderCharges:'unavailable',steps:plan.order.map((step:any)=>({...step,runId:`correction-val-${frozen.planSha256.slice(0,14)}-${step.caseId}-${step.arm}`,status:'not_attempted'}))};
  writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  const checkpoint=()=>{writeFileSync(out+'.tmp',JSON.stringify(result,null,2)+'\n',{mode:0o600});renameSync(out+'.tmp',out);};
  const packet:CorrectionComparisonPacket={format:'ablatrix-correction-comparison-v1',id:plan.id,title:'Correction policy: eight fresh product pairs',mode:'live',createdAt:result.startedAt,hypothesis:'compare_correction_policy',protocol:plan.protocol,provenance:{kind:'imported_live',note:'Explicitly approved local run bound to a separately published pre-generation manifest. Imported provider authenticity and prospectivity remain independently unverified.',sourcePacketSha256:frozen.planSha256},cases:[]};
  let active:any,networkDispatches=0,provider:SapiomFeedbackProvider|undefined;
  try{
    provider=new SapiomFeedbackProvider({enabled:true,dbPath:budgetPath,capUsd:10,priorSpendUsd:0.200281,allowancePerCallUsd:0.1,callLimit:93,fetchImpl:async(url,options)=>{
      assert.ok(active&&!active.dispatched);assert.equal(String(url),'https://router.sapiom.ai/v1/chat/completions');assert.equal(options?.method,'POST');
      const body=JSON.parse(String(options.body));assert.equal(body.model,'gpt-luna');assert.equal(body.max_tokens,4096);assert.equal(body.reasoning_effort,'none');assert.equal(body.parallel_tool_calls,false);
      if(active.arm!=='original')assert.equal(options.body,JSON.stringify(active.expectedBody));
      else {assert.equal(body.tool_choice.function.name,'product_answer');const payload=JSON.parse(body.messages[1].content);assert.deepEqual(payload,{promptVersion:'product-answer-v2-context',question:active.input.question,product:{id:active.input.product.id,title:active.input.product.title},answerPolicy:plan.baselinePolicy,evidence:active.input.passages.map((p:any)=>({id:p.id,source:p.source,text:p.text,...(p.originalQuestion?{originalQuestion:p.originalQuestion}:{})}))});}
      assert.ok(++networkDispatches<=24);active.dispatched=true;active.requestBody=body;active.requestSha256=sha(String(options.body));active.dispatchAt=new Date().toISOString();checkpoint();
      const response=await fetch(url,{...options,redirect:'error'});active.httpStatus=response.status;checkpoint();return response;
    }});
    assert.equal(provider.capacity(24).ready,true);
    for(const step of result.steps){
      active=step;const c=plan.cases.find((v:any)=>v.id===step.caseId);assert.equal(provider.receipt(step.runId),undefined);
      const completed=packet.cases.find(v=>v.id===c.id);
      if(step.arm==='original'){
        const policy:LoopPolicy={id:'frozen-current-original',parentId:null,mode:'live',instructions:plan.baselinePolicy,rationale:'Shared current-baseline original for both revisions.',feedbackRunIds:[],status:'baseline',createdAt:result.startedAt};
        active.input={runId:step.runId,question:c.question,product:{...c.product,split:'validation'},policy,passages:c.retrieval.passages};
      }else{
        assert.ok(completed);const {modelAlias,...input}=correctionComparisonInput(plan.protocol,completed,step.arm);assert.equal(modelAlias,'gpt-luna');active.input={...input,runId:step.runId};active.expectedBody=correctionComparisonRequest(plan.protocol,completed,step.arm,step.runId);
      }
      active.inputSha256=contextComparisonHash(active.input);active.status='dispatching';checkpoint();const started=performance.now();
      try{
        const output: Awaited<ReturnType<SapiomFeedbackProvider['answer']>> = step.arm==='original'?await provider.answer(active.input):await provider.revise(active.input);
        active.result=output;active.durationMs=Math.round(performance.now()-started);active.receipt=provider.receipt(step.runId);assert.equal(active.receipt.status,'completed');assert.equal(active.receipt.error_code,null);assert.equal(output.model,'gpt-5.6-luna');
        const selected=c.retrieval.passages;
        active.quoteChecks=output.answer.citations.map(q=>({passageId:q.passageId,matched:selected.some((s:any)=>s.id===q.passageId&&s.text.includes(q.quote))}));
        assert.ok(active.quoteChecks.every((q:any)=>q.matched));assert.ok(output.answer.status!=='answered'||active.quoteChecks.length>0);
        if(step.arm==='original'){
          const shared:any={id:c.id,product:c.product,question:c.question,sources:c.sources,generationSourceIds:c.generationSourceIds,original:{id:step.runId,answer:output.answer,model:output.model,providerCallId:active.receipt.id,inputSha256:active.inputSha256,requestSha256:active.requestSha256},critique:c.critique,clarifications:[],investigation:{issue:'answer_quality',query:c.question.slice(0,240),selectedSourceIds:c.generationSourceIds,addedSourceIds:[],stopReason:'Frozen hybrid retrieval for a controlled evaluation; no production investigation or external discovery.'},arms:{}};
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
