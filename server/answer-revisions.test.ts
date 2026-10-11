import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { PaidAnswerReview } from './paid-answer-review.ts';
import { AnswerRevisions } from './answer-revisions.ts';
import { SapiomFeedbackProvider } from './feedback-provider.ts';

// These cases cover the existing direct-revision path; investigation has its own workflow tests.
const directRequest = (flow: AnswerRevisions, qid: string, input: object) => flow.request(qid, { ...input, investigate: false });

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
    const job=directRequest(flow,first.qid,input);
    assert.equal(job.reviewKind,'human');
    assert.equal(directRequest(flow,first.qid,input).id,job.id);
    assert.throws(()=>directRequest(flow,first.qid,{...input,idempotencyKey:'different-click-2'}),/active or unresolved job/);
    flow.close(); flow=new AnswerRevisions(reviews,provider,path,false);
    assert.equal(flow.overview().cases.find(c=>c.qid===first.qid)?.jobs[0].status,'queued');
    await flow.tick();
    const completed=flow.overview().cases.find(c=>c.qid===first.qid)!;
    assert.equal(completed.jobs[0].status,'ready');
    assert.equal(completed.versions.length,2);
    assert.equal(completed.versions[1].parentId,id);
    assert.equal(completed.versions[1].model,'gpt-5.6-luna');
    assert.equal(seen.promptVersion,'answer-revision-v2-context');
    assert(seen.evidence.some((e:{originalQuestion?:string})=>Boolean(e.originalQuestion)));
    assert(seen.evidence.every((e:{text:string})=>!e.text.startsWith('Original customer question:')));
    assert.throws(()=>flow.decide(first.qid,{versionId:id,reviewer:'Reviewer',decision:'accept',note:'',checkedSourceShas:[reviews.overview().cases.find(c=>c.qid===first.qid)!.sources[0].sha256]}),/stale/);
    const current=completed.versions[1].id, checkedSourceShas=[reviews.overview().cases.find(c=>c.qid===first.qid)!.sources[0].sha256];
    flow.decide(first.qid,{versionId:current,reviewer:'Reviewer',decision:'accept',note:'Source checked.',checkedSourceShas});
    assert.equal(flow.overview().cases.find(c=>c.qid===first.qid)!.events.at(-1)!.reviewKind,'human');
    assert.equal(flow.overview().cases.find(c=>c.qid===first.qid)!.jobs[0].status,'accepted');
    assert.equal(flow.overview().ready,0);
    assert.equal(flow.overview().summary.accepted,1);
    assert.equal(flow.overview().summary.unresolved,0);
    assert.throws(()=>flow.decide(first.qid,{versionId:current,reviewer:'Reviewer',decision:'accept',note:'Again.',checkedSourceShas}),/already has a decision or is unavailable/);
    assert.throws(()=>directRequest(flow,first.qid,{...input,versionId:current,idempotencyKey:'after-accept-1'}),/has been accepted/);
    assert.equal(provider.receipt(job.id)?.status,'completed');
    assert.equal(provider.receipt(job.id)?.input_tokens,12);
    assert.equal(provider.capacity(1).ready,false);
  } finally { flow.close();provider.close();reviews.close();rmSync(directory,{recursive:true,force:true}); }
});

test('AI critique provenance persists without relabeling live answers and binds replay attribution', () => {
  const directory=mkdtempSync(join(tmpdir(),'revision-critique-provenance-')),path=join(directory,'review.sqlite'),ledger=join(directory,'budget.sqlite');
  const reviews=new PaidAnswerReview(path);
  const provider=new SapiomFeedbackProvider({enabled:false,dbPath:ledger,fetchImpl:async()=>{throw new Error('No provider calls in this provenance test.');}});
  let flow=new AnswerRevisions(reviews,provider,path,false);
  try {
    const [first,second]=flow.overview().cases;
    const aiInput={versionId:first.versions[0].id,idempotencyKey:'ai-critique-provenance-1',reviewer:'AI development source check',reviewKind:'ai_assisted',feedback:'The source question scopes this claim to a different model.'};
    const aiJob=directRequest(flow,first.qid,aiInput);
    assert.equal(aiJob.reviewKind,'ai_assisted');
    assert.equal(aiJob.mode,'live');
    assert.equal(directRequest(flow,first.qid,aiInput).id,aiJob.id);
    assert.throws(()=>directRequest(flow,first.qid,{...aiInput,reviewKind:'human'}),/different request/);
    const {reviewKind:_aiKind,...withoutKind}=aiInput;
    assert.throws(()=>directRequest(flow,first.qid,withoutKind),/different request/);

    const humanInput={versionId:second.versions[0].id,idempotencyKey:'human-critique-provenance-2',reviewer:'Fixture human reviewer',feedback:'Check the product scope before carrying this claim forward.'};
    const humanJob=directRequest(flow,second.qid,humanInput);
    assert.equal(humanJob.reviewKind,'human');
    assert.equal(directRequest(flow,second.qid,{...humanInput,reviewKind:'human'}).id,humanJob.id);
    assert.throws(()=>directRequest(flow,second.qid,{...humanInput,reviewKind:'ai_assisted'}),/different request/);
    assert.throws(()=>flow.decide(first.qid,{versionId:first.versions[0].id,reviewer:'AI development source check',reviewKind:'ai_assisted',decision:'accept',note:'',checkedSourceShas:[first.versions[0].sourceContextSha256]}),/Unrecognized key/);

    // Old persisted requests did not carry reviewKind. They remain human for
    // replay comparison without rewriting their original document or event.
    const {reviewKind:_humanKind,...legacy}=humanJob;
    const db=new DatabaseSync(path);
    db.prepare('UPDATE answer_revision_jobs SET document=? WHERE id=?').run(JSON.stringify(legacy),humanJob.id);
    db.close();
    flow.close();flow=new AnswerRevisions(reviews,provider,path,false);
    assert.equal(directRequest(flow,second.qid,humanInput).id,humanJob.id);
    assert.equal(directRequest(flow,second.qid,{...humanInput,reviewKind:'human'}).id,humanJob.id);
    assert.throws(()=>directRequest(flow,second.qid,{...humanInput,reviewKind:'ai_assisted'}),/different request/);
    const ai=flow.overview().cases.find(item=>item.qid===first.qid)!;
    assert.equal(ai.jobs[0].reviewKind,'ai_assisted');
    assert.equal(ai.events.length,1,'idempotent replay never creates another critique event');
    assert.equal(ai.events[0].kind,'reject');
    assert.equal(ai.events[0].reviewKind,'ai_assisted');
    assert.equal(ai.events[0].qualityClaimEligible,false);
    assert.equal(ai.events[0].mode,'live');
    assert.equal(ai.versions[0].mode,'live','AI feedback does not make the original live generation synthetic');
    const human=flow.overview().cases.find(item=>item.qid===second.qid)!;
    assert.equal(human.events[0].reviewKind,'human');
    assert.equal(human.events[0].qualityClaimEligible,true,'existing human event behavior is unchanged');
    assert.equal(flow.overview().summary.accepted,0,'critiques never create human acceptance');
    assert.equal(provider.receipt(aiJob.id),undefined);
  } finally {flow.close();provider.close();reviews.close();rmSync(directory,{recursive:true,force:true});}
});

test('uncertain provider outcome consumes allowance and is not redispatched', async () => {
  const directory=mkdtempSync(join(tmpdir(),'revision-unknown-')),path=join(directory,'review.sqlite'),ledger=join(directory,'budget.sqlite');
  const reviews=new PaidAnswerReview(path);let calls=0;
  const provider=new SapiomFeedbackProvider({enabled:true,apiKey:'fixture',capUsd:0.2,allowancePerCallUsd:0.1,callLimit:2,dbPath:ledger,fetchImpl:async()=>{calls++;throw new Error('network uncertain');}});
  const flow=new AnswerRevisions(reviews,provider,path,false);
  try {const first=flow.overview().cases[0];const job=directRequest(flow,first.qid,{versionId:first.versions[0].id,idempotencyKey:'uncertain-call-1',reviewer:'Reviewer',feedback:'This answer needs more support.'});await flow.tick();await flow.tick();assert.equal(calls,1);assert.equal(flow.overview().cases[0].jobs[0].status,'reconciliation');assert.equal(provider.receipt(job.id)?.status,'failed_or_unknown');const db=new DatabaseSync(ledger);assert.equal((db.prepare('SELECT COUNT(*) AS n FROM loop_provider_calls').get() as {n:number}).n,1);db.close();} finally {flow.close();provider.close();reviews.close();rmSync(directory,{recursive:true,force:true});}
});

test('completed provider receipt materializes after interrupted app persistence', async () => {
  const directory=mkdtempSync(join(tmpdir(),'revision-replay-')),path=join(directory,'review.sqlite'),ledger=join(directory,'budget.sqlite');
  const reviews=new PaidAnswerReview(path);const item=reviews.overview().cases[0];const source=item.sources[0],quote=source.text.slice(0,24);
  const provider=new SapiomFeedbackProvider({enabled:true,apiKey:'fixture',capUsd:0.1,allowancePerCallUsd:0.1,callLimit:1,dbPath:ledger,fetchImpl:async()=>new Response(JSON.stringify({model:'gpt-5.6-luna',choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'answer_revision_v1',arguments:JSON.stringify({answer:'A revised answer.',status:'answered',citations:[{passageId:`${item.qid}:${source.sha256}`,quote}]})}}]}}],usage:{prompt_tokens:9,completion_tokens:5}}),{status:200})});
  let flow=new AnswerRevisions(reviews,provider,path,false);
  try {
    const id=flow.overview().cases.find(c=>c.qid===item.qid)!.versions[0].id;
    const job=directRequest(flow,item.qid,{versionId:id,idempotencyKey:'receipt-replay-1',reviewer:'Reviewer',feedback:'The first answer omits a key fact.'});
    await provider.revise({runId:job.id,question:item.question,product:{id:item.asin,title:item.title},rejectedAnswer:item.result!.run.answer!.answer,critique:job.feedback,evidence:[{id:`${item.qid}:${source.sha256}`,source:source.label,text:source.text}]});
    // Existing v1 jobs do not contain a context snapshot. They must still replay.
    const { context: _context, promptVersion: _promptVersion, additionalSources: _additionalSources, clarification: _clarification, ...legacyJob }=job;
    const db=new DatabaseSync(path);db.prepare('UPDATE answer_revision_jobs SET status=?,document=?,lease_expires=? WHERE id=?').run('running',JSON.stringify({...legacyJob,status:'running'}),0,job.id);db.close();
    flow.close();flow=new AnswerRevisions(reviews,provider,path,false);
    const state=flow.overview().cases.find(c=>c.qid===item.qid)!;
    assert.equal(state.jobs[0].status,'ready');assert.equal(state.versions.length,2);
    assert.equal(state.versions[1].promptVersion,'answer-revision-v1');
    assert.equal(state.versions[1].sourceContextSha256,state.versions[0].sourceContextSha256);
    assert.equal(state.versions[1].context,undefined);
    flow.reconcile();assert.equal(flow.overview().cases.find(c=>c.qid===item.qid)!.versions.length,2);
  } finally {flow.close();provider.close();reviews.close();rmSync(directory,{recursive:true,force:true});}
});

test('added sources and customer clarification persist, bind idempotency, and carry into the next revision', async () => {
  const directory=mkdtempSync(join(tmpdir(),'revision-context-')),path=join(directory,'review.sqlite'),ledger=join(directory,'budget.sqlite');
  const reviews=new PaidAnswerReview(path);
  const seen: { evidence:{id:string;source:string;text:string;originalQuestion?:string}[];clarifications:{text:string;reviewer:string}[] }[]=[];
  const provider=new SapiomFeedbackProvider({enabled:true,apiKey:'fixture',capUsd:0.2,allowancePerCallUsd:0.1,callLimit:2,dbPath:ledger,fetchImpl:async(_url,init)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).messages[1].content);seen.push(input);
    const source=input.evidence.find((entry:{source:string})=>entry.source==='Synthetic fixture manual');
    return new Response(JSON.stringify({model:'gpt-5.6-luna',choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'answer_revision_v1',arguments:JSON.stringify({answer:'The fixture manual identifies the compatible model.',status:'answered',citations:[{passageId:source.id,quote:source.text}]})}}]}}],usage:{prompt_tokens:12,completion_tokens:8}}),{status:200});
  }});
  let flow=new AnswerRevisions(reviews,provider,path,false);
  try {
    const first=flow.overview().cases[0],originalContextSha=first.versions[0].sourceContextSha256;
    const source={label:'Synthetic fixture manual',text:'Synthetic fixture only: replacement drawer ZX-11 is compatible with refrigerator model AB-123.',reference:'https://example.test/fixture-manual',originalQuestion:'Does the fixture drawer fit refrigerator model AB-123?'};
    const sourceBefore={...source};
    const input={versionId:first.versions[0].id,idempotencyKey:'context-durable-1',reviewer:'Fixture reviewer',feedback:'Check the supplied fixture manual for the exact refrigerator model.',additionalSources:[source],clarification:'The customer reports owning fixture model AB-123.'};
    const job=directRequest(flow,first.qid,input);
    assert.equal(directRequest(flow,first.qid,input).id,job.id);
    assert.throws(()=>directRequest(flow,first.qid,{...input,clarification:'The customer reports a different fixture model.'}),/different request/);
    assert.throws(()=>directRequest(flow,first.qid,{...input,additionalSources:[{...source,text:'Synthetic fixture only: this is a different source statement for the same label.'}]}),/different request/);
    assert.throws(()=>directRequest(flow,first.qid,{...input,additionalSources:[{...source,originalQuestion:'Does it fit a different fixture model?'}]}),/different request/);
    source.text='Caller mutation must not change the saved source snapshot.';
    input.clarification='Caller mutation must not change the saved clarification.';
    flow.close();flow=new AnswerRevisions(reviews,provider,path,false);
    const savedJob=flow.overview().cases.find(c=>c.qid===first.qid)!.jobs[0];
    const savedSource=savedJob.context!.sources.find(s=>s.origin==='reviewer_added')!;
    assert.equal(savedSource.text,sourceBefore.text);
    assert.equal(savedSource.originalQuestion,sourceBefore.originalQuestion);
    assert.equal(savedSource.reference,sourceBefore.reference);
    assert.equal(savedSource.addedBy,'Fixture reviewer');
    assert.deepEqual(savedJob.context!.clarifications,[{text:'The customer reports owning fixture model AB-123.',reviewer:'Fixture reviewer'}]);
    await flow.tick();
    const firstRevision=flow.overview().cases.find(c=>c.qid===first.qid)!.versions.at(-1)!;
    assert.equal(firstRevision.answer.citations[0].passageId,savedSource.id);
    assert.deepEqual(firstRevision.context,savedJob.context);
    assert.equal(firstRevision.sourceContextSha256,createHash('sha256').update(JSON.stringify(firstRevision.context)).digest('hex'));
    assert.notEqual(firstRevision.sourceContextSha256,originalContextSha);
    assert.equal(firstRevision.promptVersion,'answer-revision-v2-context');
    const supplied=seen[0].evidence.find(s=>s.id===savedSource.id)!;
    assert.equal(supplied.text,sourceBefore.text);
    assert.equal(supplied.originalQuestion,sourceBefore.originalQuestion);
    assert.deepEqual(seen[0].clarifications,savedJob.context!.clarifications);
    const second=directRequest(flow,first.qid,{versionId:firstRevision.id,idempotencyKey:'context-inherit-2',reviewer:'Second fixture reviewer',feedback:'Retain the source and account for the customer clarification.',clarification:'The customer confirms fixture model AB-123 from its label.'});
    assert.deepEqual(second.context!.sources,firstRevision.context!.sources);
    assert.equal(second.context!.clarifications.length,2);
    await flow.tick();
    const finalState=flow.overview().cases.find(c=>c.qid===first.qid)!,latest=finalState.versions.at(-1)!;
    assert.equal(finalState.jobs.at(-1)!.status,'ready');
    assert.equal(seen.length,2);
    assert.equal(seen[1].evidence.find(s=>s.id===savedSource.id)!.text,sourceBefore.text);
    assert.equal(seen[1].clarifications.length,2);
    assert.notEqual(latest.sourceContextSha256,firstRevision.sourceContextSha256);
    assert.throws(()=>flow.decide(first.qid,{versionId:latest.id,reviewer:'Fixture reviewer',decision:'accept',note:'Checked.',checkedSourceShas:['f'.repeat(64)]}),/source/);
    flow.decide(first.qid,{versionId:latest.id,reviewer:'Fixture reviewer',decision:'accept',note:'Checked the added fixture source.',checkedSourceShas:[savedSource.sha256]});
    assert.equal(flow.overview().cases.find(c=>c.qid===first.qid)!.jobs.at(-1)!.status,'accepted');
  } finally {flow.close();provider.close();reviews.close();rmSync(directory,{recursive:true,force:true});}
});

test('an interrupted receipt replays an added-source citation from its saved context', async () => {
  const directory=mkdtempSync(join(tmpdir(),'revision-added-replay-')),path=join(directory,'review.sqlite'),ledger=join(directory,'budget.sqlite');
  const reviews=new PaidAnswerReview(path);let calls=0;
  const provider=new SapiomFeedbackProvider({enabled:true,apiKey:'fixture',capUsd:0.1,allowancePerCallUsd:0.1,callLimit:1,dbPath:ledger,fetchImpl:async(_url,init)=>{
    calls++;
    const input=JSON.parse(JSON.parse(String(init?.body)).messages[1].content),source=input.evidence.at(-1);
    return new Response(JSON.stringify({model:'gpt-5.6-luna',choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'answer_revision_v1',arguments:JSON.stringify({answer:'This answer uses the added fixture source.',status:'answered',citations:[{passageId:source.id,quote:source.text}]})}}]}}],usage:{prompt_tokens:9,completion_tokens:5}}),{status:200});
  }});
  let flow=new AnswerRevisions(reviews,provider,path,false);
  try {
    const first=flow.overview().cases[0];
    const job=directRequest(flow,first.qid,{versionId:first.versions[0].id,idempotencyKey:'added-receipt-replay-1',reviewer:'Fixture reviewer',feedback:'The new fixture source answers the missing model question.',additionalSources:[{label:'Synthetic replay source',text:'Synthetic fixture only: this manual states that drawer ZX-11 fits refrigerator AB-123.'}]});
    const context=job.context!,source=context.sources.at(-1)!;
    await provider.revise({runId:job.id,question:context.question,product:context.product,rejectedAnswer:first.versions[0].answer.answer,critique:job.feedback,evidence:context.sources.map(s=>({id:s.id,source:s.label,text:s.text,originalQuestion:s.originalQuestion ?? undefined})),clarifications:context.clarifications});
    const db=new DatabaseSync(path);db.prepare('UPDATE answer_revision_jobs SET status=?,document=?,lease_expires=? WHERE id=?').run('running',JSON.stringify({...job,status:'running'}),0,job.id);db.close();
    flow.close();flow=new AnswerRevisions(reviews,provider,path,false);
    const state=flow.overview().cases.find(c=>c.qid===first.qid)!;
    assert.equal(state.jobs[0].status,'ready');
    assert.equal(state.versions.length,2);
    assert.equal(state.versions[1].answer.citations[0].passageId,source.id);
    assert.deepEqual(state.versions[1].context,context);
    flow.reconcile();await flow.tick();
    assert.equal(calls,1);
    assert.equal(flow.overview().cases.find(c=>c.qid===first.qid)!.versions.length,2);
  } finally {flow.close();provider.close();reviews.close();rmSync(directory,{recursive:true,force:true});}
});

test('oversized serialized revision context is rejected before a job can enter an endless pre-dispatch retry', async () => {
  const directory=mkdtempSync(join(tmpdir(),'revision-context-bound-')),path=join(directory,'review.sqlite'),ledger=join(directory,'budget.sqlite');
  const reviews=new PaidAnswerReview(path);let calls=0;
  const provider=new SapiomFeedbackProvider({enabled:true,apiKey:'fixture',capUsd:0.2,allowancePerCallUsd:0.1,callLimit:2,dbPath:ledger,fetchImpl:async(_url,init)=>{
    calls++;
    const input=JSON.parse(JSON.parse(String(init?.body)).messages[1].content),source=input.evidence[0];
    // Escapes count once in the schema's answer limit but twice in the next JSON payload.
    return new Response(JSON.stringify({model:'gpt-5.6-luna',choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'answer_revision_v1',arguments:JSON.stringify({answer:'\\'.repeat(9999)+'x',status:'answered',citations:[{passageId:source.id,quote:source.text.slice(0,30)}]})}}]}}],usage:{prompt_tokens:12,completion_tokens:8}}),{status:200});
  }});
  const flow=new AnswerRevisions(reviews,provider,path,false);
  const additions=(start:number)=>Array.from({length:3},(_,i)=>({label:`Synthetic long source ${start+i}`,text:`Fixture ${start+i}: `.padEnd(2000,'a'),reference:'r'.repeat(500),originalQuestion:'q'.repeat(500)}));
  try {
    const first=flow.overview().cases[0];
    directRequest(flow,first.qid,{versionId:first.versions[0].id,idempotencyKey:'context-size-first',reviewer:'Fixture reviewer',feedback:'Use the supplied synthetic source excerpts.',additionalSources:additions(0)});
    await flow.tick();
    const latest=flow.overview().cases.find(c=>c.qid===first.qid)!.versions.at(-1)!;
    assert.notEqual(latest.id,first.versions[0].id);
    assert.throws(()=>directRequest(flow,first.qid,{versionId:latest.id,idempotencyKey:'context-size-second',reviewer:'Fixture reviewer',feedback:'\\'.repeat(1999)+'x',additionalSources:additions(3)}),/too large|context size/);
    assert.equal(flow.overview().cases.find(c=>c.qid===first.qid)!.jobs.length,1);
    assert.equal(calls,1);
  } finally {flow.close();provider.close();reviews.close();rmSync(directory,{recursive:true,force:true});}
});

test('revision citations must quote the identified source body rather than another source or its question', async t => {
  for (const failure of ['wrong_source_id','question_as_evidence'] as const) await t.test(failure,async()=>{
    const directory=mkdtempSync(join(tmpdir(),'revision-quote-context-')),path=join(directory,'review.sqlite'),ledger=join(directory,'budget.sqlite');
    const reviews=new PaidAnswerReview(path);let calls=0;
    const provider=new SapiomFeedbackProvider({enabled:true,apiKey:'fixture',capUsd:0.1,allowancePerCallUsd:0.1,callLimit:1,dbPath:ledger,fetchImpl:async(_url,init)=>{
      calls++;
      const input=JSON.parse(JSON.parse(String(init?.body)).messages[1].content),source=input.evidence.at(-1);
      const citation=failure==='wrong_source_id' ? {passageId:input.evidence[0].id,quote:source.text} : {passageId:source.id,quote:source.originalQuestion};
      return new Response(JSON.stringify({model:'gpt-5.6-luna',choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'answer_revision_v1',arguments:JSON.stringify({answer:'An unsupported fixture answer.',status:'answered',citations:[citation]})}}]}}],usage:{prompt_tokens:7,completion_tokens:4}}),{status:200});
    }});
    const flow=new AnswerRevisions(reviews,provider,path,false);
    try {
      const first=flow.overview().cases[0];
      const rejected=directRequest(flow,first.qid,{versionId:first.versions[0].id,idempotencyKey:`invalid-${failure}`,reviewer:'Fixture reviewer',feedback:'Use the new fixture source and preserve its question context.',additionalSources:[{label:'Synthetic source with question',text:'Synthetic fixture only: the listing identifies drawer ZX-11 but gives no refrigerator compatibility.',originalQuestion:'Can I assume this fixture drawer fits refrigerator AB-123?'}],clarification:'The customer confirms owning the synthetic fixture model AB-123.'});
      await flow.tick();await flow.tick();
      const state=flow.overview().cases.find(c=>c.qid===first.qid)!;
      assert.equal(state.jobs[0].status,'needs_information');
      assert.equal(state.jobs[0].attempts[0].status,'invalid_output');
      assert.equal(state.versions.length,1);
      assert.equal(calls,1);
      const retry=directRequest(flow,first.qid,{versionId:first.versions[0].id,idempotencyKey:`retry-${failure}`,reviewer:'Fixture reviewer',feedback:'Use the source answer body for citations and keep the earlier customer context.'});
      assert.deepEqual(retry.context,rejected.context,'An invalid output must not discard the source additions needed by the next attempt.');
    } finally {flow.close();provider.close();reviews.close();rmSync(directory,{recursive:true,force:true});}
  });
});

test('receipt replay cannot materialize output rejected by the provider schema', async () => {
  const directory=mkdtempSync(join(tmpdir(),'revision-invalid-')),path=join(directory,'review.sqlite'),ledger=join(directory,'budget.sqlite');
  const reviews=new PaidAnswerReview(path),item=reviews.overview().cases[0],source=item.sources[0];
  const provider=new SapiomFeedbackProvider({enabled:true,apiKey:'fixture',capUsd:0.1,allowancePerCallUsd:0.1,callLimit:1,dbPath:ledger,fetchImpl:async()=>new Response(JSON.stringify({model:'gpt-5.6-luna',choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'answer_revision_v1',arguments:JSON.stringify({answer:'Unsupported output.',status:'answered',citations:[{passageId:`${item.qid}:${source.sha256}`,quote:''}]})}}]}}],usage:{prompt_tokens:5,completion_tokens:4}}),{status:200})});
  const flow=new AnswerRevisions(reviews,provider,path,false);
  try {const state=flow.overview().cases.find(c=>c.qid===item.qid)!;directRequest(flow,item.qid,{versionId:state.versions[0].id,idempotencyKey:'invalid-receipt-1',reviewer:'Reviewer',feedback:'The answer omits a supported fact.'});await flow.tick();const after=flow.overview().cases.find(c=>c.qid===item.qid)!;assert.equal(after.jobs[0].status,'needs_information');assert.equal(after.versions.length,1);assert.equal(after.jobs[0].attempts[0].status,'invalid_output');} finally {flow.close();provider.close();reviews.close();rmSync(directory,{recursive:true,force:true});}
});
