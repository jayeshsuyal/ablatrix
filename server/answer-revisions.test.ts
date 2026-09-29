import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PaidAnswerReview } from './paid-answer-review.ts';
import { AnswerRevisions } from './answer-revisions.ts';
import { SapiomFeedbackProvider } from './feedback-provider.ts';

test('revision queue is durable, idempotent, version bound, and preserves source questions', async () => {
  const directory=mkdtempSync(join(tmpdir(),'revision-flow-')), path=join(directory,'review.sqlite'), ledger=join(directory,'budget.sqlite');
  const reviews=new PaidAnswerReview(path); let seen:any;
  const provider=new SapiomFeedbackProvider({enabled:true,apiKey:'fixture',capUsd:0.1,allowancePerCallUsd:0.1,callLimit:1,dbPath:ledger,fetchImpl:async (_url,init) => {
    const body=JSON.parse(String(init?.body)); seen=JSON.parse(body.messages[1].content);
    const evidence=seen.evidence[0], quote=evidence.text.split('\n').at(-1).slice(0,30);
    return new Response(JSON.stringify({model:'gpt-5.6-luna',choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'answer_revision_v1',arguments:JSON.stringify({answer:'A direct answer.',status:'answered',citations:[{passageId:evidence.id,quote}]})}}]}}],usage:{prompt_tokens:12,completion_tokens:8}}),{status:200});
  }});
  let flow=new AnswerRevisions(reviews,provider,path,false);
  try {
    const first=flow.overview().cases.find(c => reviews.overview().cases.find(i=>i.qid===c.qid)?.sources.some(source=>source.originalQuestion))!, id=first.versions[0].id;
    const input={versionId:id,idempotencyKey:'duplicate-click-1',reviewer:'Reviewer',feedback:'The original answer misses relevant source information.'};
    const job=flow.request(first.qid,input);
    assert.equal(flow.request(first.qid,input).id,job.id);
    assert.throws(()=>flow.request(first.qid,{...input,idempotencyKey:'different-click-2'}),/active or unresolved job/);
    flow.close(); flow=new AnswerRevisions(reviews,provider,path,false);
    assert.equal(flow.overview().cases.find(c=>c.qid===first.qid)?.jobs[0].status,'queued');
    await flow.tick();
    const completed=flow.overview().cases.find(c=>c.qid===first.qid)!;
    assert.equal(completed.jobs[0].status,'ready');
    assert.equal(completed.versions.length,2);
    assert.equal(completed.versions[1].parentId,id);
    assert.equal(completed.versions[1].model,'gpt-5.6-luna');
    assert.equal(seen.promptVersion,'answer-revision-v1');
    assert(seen.evidence.some((e:{text:string})=>e.text.includes('Original customer question:')));
    assert.throws(()=>flow.decide(first.qid,{versionId:id,reviewer:'Reviewer',decision:'accept',note:'',checkedSourceShas:[reviews.overview().cases.find(c=>c.qid===first.qid)!.sources[0].sha256]}),/stale/);
    const current=completed.versions[1].id, checkedSourceShas=[reviews.overview().cases.find(c=>c.qid===first.qid)!.sources[0].sha256];
    flow.decide(first.qid,{versionId:current,reviewer:'Reviewer',decision:'accept',note:'Source checked.',checkedSourceShas});
    assert.equal(flow.overview().cases.find(c=>c.qid===first.qid)!.jobs[0].status,'accepted');
    assert.equal(flow.overview().ready,0);
    assert.equal(flow.overview().summary.accepted,1);
    assert.equal(flow.overview().summary.unresolved,0);
    assert.throws(()=>flow.decide(first.qid,{versionId:current,reviewer:'Reviewer',decision:'accept',note:'Again.',checkedSourceShas}),/already has a decision or is unavailable/);
    assert.throws(()=>flow.request(first.qid,{...input,versionId:current,idempotencyKey:'after-accept-1'}),/has been accepted/);
    assert.equal(provider.receipt(job.id)?.status,'completed');
    assert.equal(provider.receipt(job.id)?.input_tokens,12);
    assert.equal(provider.capacity(1).ready,false);
  } finally { flow.close();provider.close();reviews.close();rmSync(directory,{recursive:true,force:true}); }
});

test('uncertain provider outcome consumes allowance and is not redispatched', async () => {
  const directory=mkdtempSync(join(tmpdir(),'revision-unknown-')),path=join(directory,'review.sqlite'),ledger=join(directory,'budget.sqlite');
  const reviews=new PaidAnswerReview(path);let calls=0;
  const provider=new SapiomFeedbackProvider({enabled:true,apiKey:'fixture',capUsd:0.2,allowancePerCallUsd:0.1,callLimit:2,dbPath:ledger,fetchImpl:async()=>{calls++;throw new Error('network uncertain');}});
  const flow=new AnswerRevisions(reviews,provider,path,false);
  try {const first=flow.overview().cases[0];const job=flow.request(first.qid,{versionId:first.versions[0].id,idempotencyKey:'uncertain-call-1',reviewer:'Reviewer',feedback:'This answer needs more support.'});await flow.tick();await flow.tick();assert.equal(calls,1);assert.equal(flow.overview().cases[0].jobs[0].status,'reconciliation');assert.equal(provider.receipt(job.id)?.status,'failed_or_unknown');const db=new DatabaseSync(ledger);assert.equal((db.prepare('SELECT COUNT(*) AS n FROM loop_provider_calls').get() as {n:number}).n,1);db.close();} finally {flow.close();provider.close();reviews.close();rmSync(directory,{recursive:true,force:true});}
});

test('completed provider receipt materializes after interrupted app persistence', async () => {
  const directory=mkdtempSync(join(tmpdir(),'revision-replay-')),path=join(directory,'review.sqlite'),ledger=join(directory,'budget.sqlite');
  const reviews=new PaidAnswerReview(path);const item=reviews.overview().cases[0];const source=item.sources[0],quote=source.text.slice(0,24);
  const provider=new SapiomFeedbackProvider({enabled:true,apiKey:'fixture',capUsd:0.1,allowancePerCallUsd:0.1,callLimit:1,dbPath:ledger,fetchImpl:async()=>new Response(JSON.stringify({model:'gpt-5.6-luna',choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'answer_revision_v1',arguments:JSON.stringify({answer:'A revised answer.',status:'answered',citations:[{passageId:`${item.qid}:${source.sha256}`,quote}]})}}]}}],usage:{prompt_tokens:9,completion_tokens:5}}),{status:200})});
  let flow=new AnswerRevisions(reviews,provider,path,false);
  try {
    const id=flow.overview().cases.find(c=>c.qid===item.qid)!.versions[0].id;
    const job=flow.request(item.qid,{versionId:id,idempotencyKey:'receipt-replay-1',reviewer:'Reviewer',feedback:'The first answer omits a key fact.'});
    await provider.revise({runId:job.id,question:item.question,product:{id:item.asin,title:item.title},rejectedAnswer:item.result!.run.answer!.answer,critique:job.feedback,evidence:[{id:`${item.qid}:${source.sha256}`,source:source.label,text:source.text}]});
    const db=new DatabaseSync(path);db.prepare('UPDATE answer_revision_jobs SET status=?,document=?,lease_expires=? WHERE id=?').run('running',JSON.stringify({...job,status:'running'}),0,job.id);db.close();
    flow.close();flow=new AnswerRevisions(reviews,provider,path,false);
    const state=flow.overview().cases.find(c=>c.qid===item.qid)!;
    assert.equal(state.jobs[0].status,'ready');assert.equal(state.versions.length,2);
    flow.reconcile();assert.equal(flow.overview().cases.find(c=>c.qid===item.qid)!.versions.length,2);
  } finally {flow.close();provider.close();reviews.close();rmSync(directory,{recursive:true,force:true});}
});

test('receipt replay cannot materialize output rejected by the provider schema', async () => {
  const directory=mkdtempSync(join(tmpdir(),'revision-invalid-')),path=join(directory,'review.sqlite'),ledger=join(directory,'budget.sqlite');
  const reviews=new PaidAnswerReview(path),item=reviews.overview().cases[0],source=item.sources[0];
  const provider=new SapiomFeedbackProvider({enabled:true,apiKey:'fixture',capUsd:0.1,allowancePerCallUsd:0.1,callLimit:1,dbPath:ledger,fetchImpl:async()=>new Response(JSON.stringify({model:'gpt-5.6-luna',choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'answer_revision_v1',arguments:JSON.stringify({answer:'Unsupported output.',status:'answered',citations:[{passageId:`${item.qid}:${source.sha256}`,quote:''}]})}}]}}],usage:{prompt_tokens:5,completion_tokens:4}}),{status:200})});
  const flow=new AnswerRevisions(reviews,provider,path,false);
  try {const state=flow.overview().cases.find(c=>c.qid===item.qid)!;flow.request(item.qid,{versionId:state.versions[0].id,idempotencyKey:'invalid-receipt-1',reviewer:'Reviewer',feedback:'The answer omits a supported fact.'});await flow.tick();const after=flow.overview().cases.find(c=>c.qid===item.qid)!;assert.equal(after.jobs[0].status,'needs_information');assert.equal(after.versions.length,1);assert.equal(after.jobs[0].attempts[0].status,'invalid_output');} finally {flow.close();provider.close();reviews.close();rmSync(directory,{recursive:true,force:true});}
});
