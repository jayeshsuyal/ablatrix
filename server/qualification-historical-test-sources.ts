import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,resolve,join} from 'node:path';
import {QUALIFICATION_CODE_FILES} from './grader-qualification.ts';
import {QUALIFICATION_SOURCE_DIRECTORY,QUALIFICATION_SOURCE_HASHES,readQualificationLiveSources} from './grader-qualification-live.ts';

/** Only test mechanics use this source-only historical copy. Production reads
 * stay strict against current code and reject the consumed v3 plan after edits. */
export function historicalQualificationTestSources(repository:string){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'ablatrix-historical-qualification-test-')));
 try{
  for(const [name,hash]of Object.entries(QUALIFICATION_SOURCE_HASHES)){
   const source=resolve(repository,QUALIFICATION_SOURCE_DIRECTORY,name),bytes=readFileSync(source);
   if(createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('Historical public qualification source changed.');
   const target=resolve(root,QUALIFICATION_SOURCE_DIRECTORY,name);mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);
  }
  const plan=JSON.parse(readFileSync(resolve(root,QUALIFICATION_SOURCE_DIRECTORY,'seal-v1/plan.json'),'utf8'));
  if(!/^[a-f0-9]{40}$/.test(plan.implementationCommit))throw new Error('Invalid sealed historical commit.');
  for(const file of QUALIFICATION_CODE_FILES){
   const bytes=execFileSync('git',['show',`${plan.implementationCommit}:${file}`],{cwd:repository,stdio:['ignore','pipe','pipe']});
   if(createHash('sha256').update(bytes).digest('hex')!==plan.codeFileSha256[file])throw new Error('Committed historical code does not match its seal.');
   const target=resolve(root,file);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);
  }
  return readQualificationLiveSources(root);
 }finally{rmSync(root,{recursive:true,force:true});}
}
