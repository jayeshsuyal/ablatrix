import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {SyntheticAnswerProvider} from '../server/synthetic-answer-provider.ts';
import {ProductWorkspace} from '../server/product-workspace.ts';
import {AutomaticSupport} from '../server/automatic-support.ts';
import {createRuntimeGraderBinding} from '../server/runtime-grader.ts';
import {CITED_APPLICABILITY_GRADER_VERSION} from '../server/claim-support-v4.ts';
import {localDemoRetriever} from '../server/local-demo.ts';
import {buildWorkspaceProof,verifyWorkspaceProof} from '../server/workspace-proof.ts';
import {runDevelopmentRewriteControl,verifyDevelopmentRewriteControl} from '../server/development-rewrite-control.ts';
const [flag,destination,...rest]=process.argv.slice(2);if(flag!=='--out'||!destination||rest.length)throw new Error('Usage: node --import tsx scripts/development-proof.ts --out <new-file.json>');
const priorFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('Development proof is offline; network access is disabled.');};
const provider=new SyntheticAnswerProvider(':memory:'),workspace=new ProductWorkspace(':memory:',provider,localDemoRetriever),checks=new AutomaticSupport(provider,':memory:',{graderBinding:createRuntimeGraderBinding('synthetic',CITED_APPLICABILITY_GRADER_VERSION)});
try{
 const products=[{title:'Fictional Thistle flask',question:'What capacity and lid are listed?',text:'SYNTHETIC fixture: The fictional Thistle flask holds six cups and has a cork lid.'},{title:'Fictional Aster box',question:'What is its maximum temperature rating?',text:'SYNTHETIC stop fixture: The fictional Aster box has a snap-on lid and two-liter capacity. No temperature rating is supplied.'}];
 for(const fixture of products){const product=workspace.createProduct({title:fixture.title,sources:[{label:'Exposed fictional development specification',text:fixture.text}]});const run=await workspace.ask({productId:product.id,question:fixture.question,mode:'synthetic'});checks.enqueue(workspace.reviewSnapshots(run.id)[0]);for(let phase=0;phase<3;phase++)await checks.tick();}
 const controls=[];for(const job of checks.verifiedOverview())if(job.repaired&&job.assessments.some(item=>item.phase==='repair'))controls.push(await runDevelopmentRewriteControl(job,provider));
 const proof=buildWorkspaceProof(workspace.proofRuns(),checks.verifiedOverview(),id=>provider.receipt(id));verifyWorkspaceProof(proof);for(const control of controls)verifyDevelopmentRewriteControl(control);
 const files=['server/workspace-proof.ts','server/development-rewrite-control.ts','server/workflow-proof-plan.ts','server/workspace-generation.ts','server/workspace-generation-identity.ts','server/workspace-retrieval-context.ts','server/automatic-support.ts','server/feedback-provider.ts','server/synthetic-answer-provider.ts','server/claim-support-v4.ts','server/runtime-grader.ts','scripts/development-proof.ts'];
 const packet={format:'development-proof-rehearsal-v1',provenance:'synthetic_exposed_development',qualityClaimEligible:false,providerCalls:0,embeddingDownloads:0,sourceHashes:Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')])),proof,controls};
 const output=resolve(destination);mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(packet,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({output,cases:proof.cohort.planned,paired:proof.paired,matchedControls:controls.length,providerCalls:0,qualityClaimEligible:false}));
}finally{checks.close();workspace.close();provider.close();globalThis.fetch=priorFetch;}
