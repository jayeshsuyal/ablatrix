import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { correctionDevelopmentPlan, correctionHash } from './correction-policy-development.ts';

test('development manifest preserves prior controlled inputs and separates current/candidate prompts',()=>{
  const plan=correctionDevelopmentPlan();
  const prior=JSON.parse(readFileSync(new URL('../docs/evidence/local-correction-live-2026-10-10.json',import.meta.url),'utf8'));
  assert.deepEqual(plan.cases.map(item=>item.qid),['26','63','19','47','75','4']);
  for(const qid of ['26','63']){
    const {runId:_,...input}=prior.cases.find((item:{qid:string})=>item.qid===qid).input;
    assert.deepEqual(plan.cases.find(item=>item.qid===qid)!.input,input);
  }
  assert.equal(plan.policies.baseline.promptVersion,'answer-revision-v3-investigation');
  assert.equal(plan.policies.candidate.promptVersion,'answer-revision-v4-attributed-listing');
  assert.notEqual(plan.policies.baseline.systemInstructionsSha256,plan.policies.candidate.systemInstructionsSha256);
  assert.equal(plan.limits.developmentAttempts+plan.limits.conditionalFreshAttempts,30);
  assert.equal(plan.limits.initialLedgerAttempts+30,93);
  assert.equal(plan.gate.qualityClaimEligible,false);
  assert.equal(correctionHash(plan),correctionHash(correctionDevelopmentPlan()));
});

test('preparation never opens configured live ledgers and refuses overwrite or changed execution inputs',()=>{
  const dir=mkdtempSync(join(tmpdir(),'correction-policy-')),out=join(dir,'plan.json'),repo=resolve(new URL('..',import.meta.url).pathname);
  try{
    const script=join(repo,'scripts/correction-policy-experiment.ts');
    const env={...process.env,ABLATRIX_LOOP_LIVE:'1',ABLATRIX_REVISION_WEB:'0',ABLATRIX_LOOP_CALL_LIMIT:'93',SAPIOM_API_KEY:'synthetic-unused-key',ABLATRIX_LOOP_BUDGET_DB:join(dir,'must-not-create.sqlite')};
    const result=spawnSync(process.execPath,['--import','tsx',script,'--prepare-development','--out',out],{cwd:repo,env,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.deepEqual(readdirSync(dir),['plan.json']);
    const before=readFileSync(out,'utf8');
    assert.notEqual(spawnSync(process.execPath,['--import','tsx',script,'--prepare-development','--out',out],{cwd:repo,env,encoding:'utf8'}).status,0);
    assert.equal(readFileSync(out,'utf8'),before);
    const changed=JSON.parse(before);changed.plan.cases[0].input.critique='Different critique';writeFileSync(out,JSON.stringify(changed));
    const execution=spawnSync(process.execPath,['--import','tsx',script,'--execute-development','--plan',out,'--out',join(dir,'result.json')],{cwd:repo,env,encoding:'utf8'});
    assert.notEqual(execution.status,0);assert.deepEqual(readdirSync(dir),['plan.json']);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
