import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCorrectionWalkthrough, correctionWalkthroughPlan, correctionWalkthroughPlanHash, preflightCorrectionWalkthrough } from './correction-walkthrough.ts';

test('walkthrough freezes historical source scope and citation identity without human or quality claims', async () => {
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error('Walkthrough must never use the network.');};
  try {
    const bundle=await buildCorrectionWalkthrough('2026-10-09T00:00:00.000Z'),plan=bundle.plan;
    assert.deepEqual(plan.cases.map(item=>item.qid),['75','26','63','19','47']);
    assert.equal(plan.cases.reduce((sum,item)=>sum+item.maxNewRevisionAttempts,0),2);
    assert.deepEqual(plan.cases.filter(item=>item.maxNewRevisionAttempts).map(item=>item.qid),['26','63']);
    assert.equal(plan.limits.maxNewPlanningAllowanceUsd,0.2);
    assert.equal(plan.limits.webEnabled,false);
    assert.equal(plan.limits.automaticRetries,0);
    assert.equal(plan.freshValidation,false);
    assert.equal(plan.qualityClaimEligible,false);
    assert.equal(plan.humanJudgments,0);
    assert.equal(plan.humanReviewStatus,'pending');
    assert.equal(bundle.execution.newProviderCalls,0);
    assert.equal(bundle.execution.newAnswersGenerated,0);
    assert.equal(bundle.execution.newHumanJudgments,0);
    assert.ok(plan.cases.every(item=>item.reviewKind==='ai_assisted'&&item.original.mode==='live'));
    assert.equal(plan.reviewContextProvenance,'restored_original_customer_questions_after_original_generation');
    for(const item of plan.cases) {
      assert.match(item.sourceContextSha256,/^[a-f0-9]{64}$/);
      assert.match(item.inputSha256,/^[a-f0-9]{64}$/);
      assert.deepEqual(item.originalSourceIds,item.context.sources.map(source=>source.id));
      for(const citation of item.citationMapping) {
        const source=item.context.sources.find(value=>value.id===citation.sourceId)!;
        assert.ok(source);
        assert.equal(source.sha256,citation.sourceSha256);
        assert.ok(source.text.includes(citation.quote));
        assert.notEqual(citation.passageId,citation.sourceId,'original retrieval passage IDs remain separate from the revision source IDs');
      }
    }
    const crisper=plan.cases.find(item=>item.qid==='19')!;
    assert.equal(crisper.context.sources.find(source=>source.label==='ePQA cqa 154')!.originalQuestion,'will this fit kenmore refrigerator 25367889506?');
    assert.equal(plan.historicalCorrection.newCalls,0);
    assert.equal(plan.historicalCorrection.humanDecision,'pending_as_recorded');
    assert.ok(plan.historicalCorrection.document.includes(`> ${plan.historicalCorrection.answerText}`));
    assert.match(plan.historicalCorrection.answerText,/does not establish that it is interchangeable with part 241543917/);
    assert.equal(plan.cases.find(item=>item.qid==='75')!.outcome,'original_retained_unreviewed');
  } finally {globalThis.fetch=originalFetch;}
});

test('offline routing exposes revision candidates and stops missing compatibility without an adapter', async () => {
  const plan=correctionWalkthroughPlan(),result=await preflightCorrectionWalkthrough(plan);
  assert.equal(result.passed,true,JSON.stringify(result.checks.filter(check=>!check.passed)));
  assert.deepEqual(result.investigations.map(item=>[item.qid,item.trace.status]),[['26','ready_to_revise'],['63','ready_to_revise'],['47','needs_information']]);
  assert.ok(result.investigations.every(item=>item.trace.externalCalls===0&&item.trace.addedSourceIds.length===0&&!item.trace.newEvidence));
  const missing=result.investigations.find(item=>item.qid==='47')!.trace;
  assert.match(missing.clarificationQuestion!,/WMR200/);
  assert.ok(missing.steps.some(step=>step.kind==='web_search'&&step.status==='skipped'));
  const sensor=plan.cases.find(item=>item.qid==='47')!;
  for(const label of ['ePQA cqa 431','ePQA cqa 434']) assert.ok(!missing.selectedSourceIds.includes(sensor.context.sources.find(source=>source.label===label)!.id));
  const color=plan.cases.find(item=>item.qid==='26')!;
  for(const label of ['ePQA review 220','ePQA cqa 222','ePQA review 223']) assert.ok(result.investigations.find(item=>item.qid==='26')!.trace.selectedSourceIds.includes(color.context.sources.find(source=>source.label===label)!.id));
  const keg=plan.cases.find(item=>item.qid==='63')!,listing=keg.context.sources.find(source=>source.label==='ePQA description 595')!;
  assert.ok(result.investigations.find(item=>item.qid==='63')!.trace.selectedSourceIds.includes(listing.id));
  assert.ok(!keg.originalCitedSourceIds.includes(listing.id),'the listing was retrieved but not cited by the historical answer');
  const unexpected=structuredClone(plan);unexpected.cases.find(item=>item.qid==='47')!.expectedRoute='ready_to_revise';
  const failure=await preflightCorrectionWalkthrough(unexpected);
  assert.equal(failure.passed,false);
  assert.ok(failure.checks.some(check=>check.name==='q47_route'&&!check.passed));
  assert.equal(failure.investigations.find(item=>item.qid==='47')!.trace.status,'needs_information','a requested expectation cannot override the source gate');
});

test('plan hashes ignore report timestamps and bind question context, critique, and historical reports', async () => {
  const first=await buildCorrectionWalkthrough('2026-10-09T00:00:00.000Z'),later=await buildCorrectionWalkthrough('2026-10-10T00:00:00.000Z');
  assert.equal(first.planSha256,later.planSha256);
  assert.equal(first.planSha256,correctionWalkthroughPlanHash(first.plan));
  for(const mutate of [
    (plan:typeof first.plan)=>{plan.cases[1].feedback+=' Preserve scope.';},
    (plan:typeof first.plan)=>{plan.cases[1].context.sources[1].originalQuestion='A different original customer question';},
    (plan:typeof first.plan)=>{plan.cases[0].original.answer.citations[0].quote='Changed quote';},
    (plan:typeof first.plan)=>{plan.historicalCorrection.document+='\nChanged historical record';}
  ]) {const changed=structuredClone(first.plan);mutate(changed);assert.notEqual(correctionWalkthroughPlanHash(changed),first.planSha256);}
});

test('CLI writes a new report from an unrelated cwd and refuses overwrite without opening configured live data', () => {
  const directory=mkdtempSync(join(tmpdir(),'correction-walkthrough-')),repo=dirname(dirname(fileURLToPath(import.meta.url)));
  try {
    writeFileSync(join(directory,'.env'),'ABLATRIX_LOOP_LIVE=1\nSAPIOM_API_KEY=unused-fixture\n');
    const args=['--import',join(repo,'node_modules/tsx/dist/loader.mjs'),join(repo,'scripts/correction-walkthrough.ts'),'--out','report.json'];
    const env={...process.env,ABLATRIX_LOOP_LIVE:'1',ABLATRIX_LOOP_DB:join(directory,'must-not-open.sqlite'),ABLATRIX_LOOP_BUDGET_DB:join(directory,'must-not-open-budget.sqlite'),SAPIOM_API_KEY:'unused-fixture'};
    const result=spawnSync(process.execPath,args,{cwd:directory,env,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const before=readFileSync(join(directory,'report.json'));
    const report=JSON.parse(before.toString());
    assert.equal(report.execution.newProviderCalls,0);
    assert.equal(report.preflight.passed,true);
    assert.deepEqual(readdirSync(directory).sort(),['.env','report.json']);
    const repeated=spawnSync(process.execPath,args,{cwd:directory,env,encoding:'utf8'});
    assert.notEqual(repeated.status,0);
    assert.match(repeated.stderr,/EEXIST/);
    assert.deepEqual(readFileSync(join(directory,'report.json')),before);
    const dispatch=spawnSync(process.execPath,[...args,'--execute'],{cwd:directory,env,encoding:'utf8'});
    assert.notEqual(dispatch.status,0);
    assert.match(dispatch.stderr,/Usage/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
