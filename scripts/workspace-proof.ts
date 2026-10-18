import {readFileSync} from 'node:fs';
import {verifyWorkspaceProof,type WorkspaceProof} from '../server/workspace-proof.ts';
import {verifyDevelopmentRewriteControl} from '../server/development-rewrite-control.ts';
import {proposedWorkflowProofBudget} from '../server/workflow-proof-plan.ts';
const [mode,path,...rest]=process.argv.slice(2);
if(mode==='--proposal'&&!path)console.log(JSON.stringify(proposedWorkflowProofBudget(),null,2));
else if(mode==='--verify'&&path&&!rest.length){
 const packet=JSON.parse(readFileSync(path,'utf8'));
 const result=packet.format==='development-proof-rehearsal-v1' ? {proof:verifyWorkspaceProof(packet.proof),controls:packet.controls.map(verifyDevelopmentRewriteControl),providerCalls:0,qualityClaimEligible:false} : verifyWorkspaceProof(packet as WorkspaceProof);
 console.log(JSON.stringify(result,null,2));
}else throw new Error('Usage: node --import tsx scripts/workspace-proof.ts --verify <export.json> | --proposal');
