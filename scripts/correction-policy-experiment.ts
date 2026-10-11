import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { correctionDevelopmentPlan, correctionHash } from '../server/correction-policy-development.ts';
import { SapiomFeedbackProvider, revisionRequestBody } from '../server/feedback-provider.ts';
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
const args=process.argv.slice(2),command=args.shift();
const flags=new Map<string,string>();
for(let index=0;index<args.length;index+=2){if(!['--plan','--out'].includes(args[index])||!args[index+1]||flags.has(args[index]))throw new Error('Usage: --prepare-development --out <new.json> OR --execute-development --plan <frozen.json> --out <new.json>');flags.set(args[index],args[index+1]);}
const out=flags.get('--out');
assert.ok(out && !existsSync(out),'A new output file is required; runs never overwrite or resume.');
if(command==='--prepare-development'){
  assert.equal(flags.size,1);
  const plan=correctionDevelopmentPlan();
  writeFileSync(out,JSON.stringify({createdAt:new Date().toISOString(),planSha256:correctionHash(plan),plan},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({out,planSha256:correctionHash(plan),newProviderCalls:0}));
}else if(command==='--execute-development'){
  assert.equal(flags.size,2);assert.ok(flags.get('--plan'));
  const frozen=JSON.parse(readFileSync(flags.get('--plan')!,'utf8'));
  const plan=correctionDevelopmentPlan();
  assert.equal(frozen.planSha256,correctionHash(plan),'Frozen inputs or implementation changed');assert.deepEqual(frozen.plan,plan);
  assert.equal(process.env.ABLATRIX_LOOP_LIVE,'1');assert.equal(process.env.ABLATRIX_REVISION_WEB,'0');assert.equal(process.env.ABLATRIX_LOOP_CALL_LIMIT,'93');
  const dbPath=process.env.ABLATRIX_LOOP_BUDGET_DB;assert.ok(dbPath&&existsSync(dbPath),'Existing shared budget required');
  try { assert.equal(execFileSync('lsof',['-nP','-iTCP:4194','-sTCP:LISTEN'],{encoding:'utf8'}).trim(),'','Stop the local app first'); } catch(error){if((error as {status?:number}).status!==1)throw error;}
  const db=new DatabaseSync(dbPath,{readOnly:true});
  const calls=()=>db.prepare('SELECT * FROM loop_provider_calls ORDER BY rowid').all();
  const before=calls();assert.equal(before.length,plan.limits.initialLedgerAttempts);
  assert.equal(before.filter(row=>row.status==='pending').length,0);
  const owner=db.prepare('SELECT expires_at FROM loop_provider_owner WHERE id=1').get();assert.ok(!owner||Number(owner.expires_at)<=Date.now(),'Active budget owner');
  const reviewPath=process.env.ABLATRIX_PAID_REVIEW_DB;assert.ok(reviewPath&&existsSync(reviewPath));
  const review=new DatabaseSync(reviewPath,{readOnly:true});
  assert.equal(review.prepare("SELECT COUNT(*) AS n FROM answer_revision_jobs WHERE status IN ('queued','running','reconciliation')").get()!.n,0);
  const tables=['answer_versions','answer_review_events','answer_revision_jobs','answer_revision_attempts','paid_answer_reviews','paid_answer_reviews_v2'];
  const history=Object.fromEntries(tables.map(table=>[table,correctionHash(review.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())]));
  const steps=plan.cases.map(item=>({qid:item.qid,runId:`correction-dev-${frozen.planSha256.slice(0,16)}-${item.qid}`,status:'not_attempted',criterion:item.criterion,input:{...item.input,revisionPolicy:'candidate_v4' as const}}));
  const packet:any={format:'ablatrix-correction-development-result-v1',planSha256:frozen.planSha256,startedAt:new Date().toISOString(),mode:'live',status:'running',steps,qualityClaimEligible:false,humanJudgments:0,actualProviderCharges:'unavailable',initialLedgerAttempts:before.length};
  writeFileSync(out,JSON.stringify(packet,null,2)+'\n',{flag:'wx'});
  const checkpoint=()=>{writeFileSync(out+'.tmp',JSON.stringify(packet,null,2)+'\n',{mode:0o600});renameSync(out+'.tmp',out);};
  let active:any=null,networkDispatches=0;
  let provider: SapiomFeedbackProvider | undefined;
  try {
    provider=new SapiomFeedbackProvider({enabled:true,dbPath,capUsd:10,priorSpendUsd:0.200281,allowancePerCallUsd:0.1,callLimit:93,fetchImpl:async(url,options)=>{
    assert.ok(active&&!active.dispatched);assert.equal(String(url),'https://router.sapiom.ai/v1/chat/completions');assert.equal(options?.method,'POST');
    assert.equal(options.body,JSON.stringify(active.requestBody),'Actual request differs from frozen candidate');
    assert.ok(++networkDispatches<=6);active.dispatched=true;active.dispatchAt=new Date().toISOString();checkpoint();
    const response=await fetch(url,{...options,redirect:'error'});active.httpStatus=response.status;checkpoint();return response;
  }});
    assert.equal(provider.capacity(6).ready,true,'Credential or capacity unavailable');
    for(const step of steps){
      active=step;assert.equal(provider.receipt(step.runId),undefined,'No repeated attempts');
      active.input={...active.input,runId:step.runId};active.requestBody=revisionRequestBody(active.input);active.requestSha256=sha(JSON.stringify(active.requestBody));active.status='dispatching';checkpoint();
      const started=performance.now();
      try{
        const result=await provider.revise(active.input);Object.assign(active,{result,durationMs:Math.round(performance.now()-started),receipt:provider.receipt(step.runId)});
        assert.equal(active.receipt.status,'completed');assert.equal(active.receipt.error_code,null);assert.equal(result.model,'gpt-5.6-luna');
        const savedReceipt=JSON.parse(active.receipt.receipt_json);
        assert.equal(result.promptVersion,plan.policies.candidate.promptVersion);assert.equal(result.systemInstructionsSha256,plan.policies.candidate.systemInstructionsSha256);
        assert.equal(savedReceipt.promptVersion,result.promptVersion);assert.equal(savedReceipt.systemInstructionsSha256,result.systemInstructionsSha256);assert.equal(savedReceipt.revisionPolicy,'candidate_v4');
        active.quoteChecks=result.answer.citations.map(citation=>({passageId:citation.passageId,matched:active.input.evidence.some((source:any)=>source.id===citation.passageId&&source.text.includes(citation.quote))}));
        assert.ok(active.quoteChecks.every((check:any)=>check.matched));
        active.status='completed';checkpoint();console.log(JSON.stringify({qid:step.qid,status:active.status,answerStatus:result.answer.status,quotes:active.quoteChecks.length}));
      }catch{
        active.receipt=provider.receipt(step.runId)??null;active.status='failed_or_uncertain';active.durationMs=Math.round(performance.now()-started);packet.status='stopped';packet.stopReason='A provider, validation or configuration check failed; saved receipt retained with no retry.';checkpoint();break;
      }
    }
    if(steps.every(step=>step.status==='completed'))packet.status='awaiting_ai_development_gate';
  } catch {
    packet.status='stopped';packet.stopReason='Configuration or execution preflight failed. No automatic retry.';process.exitCode=1;
  } finally {
    provider?.close();packet.finishedAt=new Date().toISOString();packet.networkDispatches=networkDispatches;
    const after=calls();packet.newProviderAttempts=after.length-before.length;packet.newReceipts=after.slice(before.length);
    packet.existingReceiptsUnchanged=correctionHash(after.slice(0,before.length))===correctionHash(before);
    packet.existingReviewStateUnchanged=tables.every(table=>correctionHash(review.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())===history[table]);
    if(packet.status==='stopped')process.exitCode=1;
    checkpoint();review.close();db.close();console.log(JSON.stringify({out,status:packet.status,newProviderAttempts:packet.newProviderAttempts,existingReviewStateUnchanged:packet.existingReviewStateUnchanged}));
  }
}else throw new Error('Unknown command; no provider was constructed.');
