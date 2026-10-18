import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { verifyAutomaticSupportEvidence, type AutomaticSupportJob } from './automatic-support.ts';
import type { WorkspaceRun } from './product-workspace.ts';
import { verifyWorkspaceRunGeneration } from './workspace-generation-identity.ts';
import type { AnswerRevisionReceipt } from './answer-revisions.ts';
import type { ClaimSupportV4Assessment } from './claim-support-v4.ts';
import { replayWorkspaceGenerationReceipt } from './workspace-generation.ts';

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Outcome = 'win' | 'tie' | 'regression' | 'unresolved';
type ReceiptReader = (runId: string) => AnswerRevisionReceipt | undefined;
const elapsed = (start: string, end?: string) => end && Number.isFinite(Date.parse(end) - Date.parse(start)) && Date.parse(end) >= Date.parse(start) ? Date.parse(end) - Date.parse(start) : null;
function axes(grade: AutomaticSupportJob['assessments'][number] | undefined) {
  if (!grade) return null;
  const a = grade.assessment;
  const explicit = 'v4' in a ? (a as ClaimSupportV4Assessment).v4 : null;
  return { disposition: a.disposition, usefulSupported: a.disposition === 'pass' && a.answerability === 'answerable', factualErrors: a.correctness === 'contradicted_by_sources' || a.units.some(unit => unit.verdict === 'contradicted'), citedSupport: explicit ? explicit.units.every(unit => ['supported', 'non_factual'].includes(unit.citedSupport)) : a.units.every(unit => ['supported', 'non_factual'].includes(unit.verdict)), factualNotEstablished: explicit ? explicit.units.some(unit => unit.factualConsistency === 'not_established') : null, applicability: explicit ? explicit.units.map(unit=>unit.applicability) : null, availableFactCoverage: a.questionCoverage, unnecessaryAbstention: a.uncertaintyHandling === 'unnecessary_abstention', assessment: a, graderVersion: grade.promptVersion, model: grade.model, receiptId: grade.receiptId };
}

/** This is a local evidence export. Receipt consistency is checked by the
 * workers before building it; it does not attest provider authenticity or quality. */
export function buildWorkspaceProof(runs: WorkspaceRun[], jobs: AutomaticSupportJob[], receipt: ReceiptReader) {
  for(const run of runs) {
    verifyWorkspaceRunGeneration(run);
    if(run.generation && ((run.status==='completed') !== (run.generation.phase==='completed'))) throw new Error('Proof generation acceptance state is inconsistent.');
  }
  const generated = runs.filter(run => run.mode !== 'preview');
  if (jobs.some(job => !generated.some(run => job.qid === `workspace-${run.id}`))) throw new Error('Proof contains an automatic check without its original workspace run.');
  const cases = generated.map(run => {
    const job = jobs.find(item => item.qid === `workspace-${run.id}`);
    if (job && (job.original.runId !== run.id || !isDeepStrictEqual(job.original.answer, run.answer) || !isDeepStrictEqual(job.original.context, run.reviewContext) || !isDeepStrictEqual(job.original.runtimePolicy, run.runtimePolicy) || job.original.model !== run.model || job.original.promptVersion !== run.generationProtocol || job.original.createdAt !== run.createdAt || (job.original.mode ?? 'live') !== run.mode)) throw new Error('Proof automatic check does not bind this exact original workspace run, context and policy.');
    const originalGrade = axes(job?.assessments.find(item => item.phase === 'original'));
    const repairGrade = axes(job?.assessments.find(item => item.phase === 'repair'));
    let outcome: Outcome = 'unresolved';
    if (originalGrade && job?.delivery?.origin === 'original' && originalGrade.disposition === 'pass') outcome = 'tie';
    if (originalGrade && repairGrade) outcome = originalGrade.disposition !== 'pass' && repairGrade.disposition === 'pass' ? 'win' : originalGrade.disposition === 'pass' && repairGrade.disposition !== 'pass' ? 'regression' : originalGrade.disposition === repairGrade.disposition ? 'tie' : 'unresolved';
    const originalReceipt = receipt(run.id) ?? null;
    const operations = (job?.operations ?? []).map(operation => ({ ...operation, receipt: receipt(operation.runId) ?? null }));
    const receipts = [originalReceipt, ...operations.map(operation => operation.receipt)].filter((item): item is AnswerRevisionReceipt => !!item);
    const unknowns: string[] = [];
    if (!originalReceipt && run.status !== 'evidence_ready') unknowns.push('original_receipt_unavailable');
    if (run.generation && (run.status !== 'completed' || run.generation.phase !== 'completed')) unknowns.push('generation_result_not_accepted');
    if (!run.generation) unknowns.push('legacy_generation_contract_not_replayable');
    if (!originalGrade) unknowns.push('original_assessment_unavailable');
    if (job?.repaired && !repairGrade) unknowns.push('repair_assessment_unavailable');
    if (operations.some(operation => ['unknown', 'invalid', 'started'].includes(operation.status))) unknowns.push('non_completed_operation');
    const end = job?.finishedAt ?? run.finishedAt;
    const totalMs = elapsed(run.createdAt, end);
    if (totalMs === null) unknowns.push('elapsed_time_unavailable');
    const live = run.mode === 'live';
    const allReceiptsPresent = !!originalReceipt && operations.every(operation=>!!operation.receipt);
    const allowanceKnown = allReceiptsPresent && receipts.every(item => typeof item.allowance_usd === 'number' && Number.isFinite(item.allowance_usd));
    const planningAllowanceUsd = live && allowanceKnown && originalReceipt ? receipts.reduce((sum, item) => sum + item.allowance_usd, 0) : live ? null : 0;
    if (live && planningAllowanceUsd === null) unknowns.push('planning_allowance_incomplete');
    const unknownCallSlots = live ? Number(!originalReceipt) + operations.filter(operation=>!operation.receipt).length : 0;
    if (unknownCallSlots) unknowns.push('call_slots_without_receipts');
    const tokensKnown = allReceiptsPresent && receipts.length > 0 && receipts.every(item => item.input_tokens !== null && item.output_tokens !== null);
    if (live && !tokensKnown) unknowns.push('usage_incomplete');
    const tokens = live && tokensKnown ? { input: receipts.reduce((sum,item) => sum + item.input_tokens!,0), output: receipts.reduce((sum,item) => sum + item.output_tokens!,0) } : null;
    return { run: structuredClone(run), questionId: run.id, productId: run.productId, question: run.question, mode: run.mode, status: run.status, original: { answer: run.answer, grade: originalGrade, generationVersion: run.generationProtocol ?? 'legacy_unknown', policy: run.runtimePolicy ?? null, sources: run.reviewContext?.sources ?? run.retrieval?.passages ?? [], receipt: originalReceipt }, repair: job?.repaired ? { ...job.repaired, grade: repairGrade } : null,
      outcome, repairTriggered: !!job?.operations.some(operation => operation.phase === 'repair'), job: job ?? null, operations, calls: live ? receipts.length : 0, unknownCallSlots, recordedOperations: receipts.length, totalMs, planningAllowanceUsd, tokens, unknowns };
  });
  const paired = { wins: cases.filter(item=>item.outcome==='win').length, ties: cases.filter(item=>item.outcome==='tie').length, regressions: cases.filter(item=>item.outcome==='regression').length, unresolved: cases.filter(item=>item.outcome==='unresolved').length };
  const repairCases = cases.filter(item=>item.repairTriggered);
  const metrics = (items: typeof cases, phase: 'original' | 'repair') => ({ denominator: items.length, assessed: items.filter(item => item[phase]?.grade).length,
    usefulSupportedAnswers: items.filter(item => item[phase]?.grade?.usefulSupported).length, factualErrors: items.filter(item => item[phase]?.grade?.factualErrors).length, citedSupport: items.filter(item => item[phase]?.grade?.citedSupport).length,
    factsNotEstablished: items.filter(item => item[phase]?.grade?.factualNotEstablished).length, applicabilityUnresolved: items.filter(item => item[phase]?.grade?.applicability?.some(axis=>axis==='ambiguous_scope')).length, wrongVariant: items.filter(item => item[phase]?.grade?.applicability?.some(axis=>axis==='wrong_variant')).length, completeCoverage: items.filter(item => item[phase]?.grade?.availableFactCoverage === 'complete').length, unnecessaryAbstentions: items.filter(item => item[phase]?.grade?.unnecessaryAbstention).length });
  const modes = new Set(cases.map(item=>item.mode));
  const body = { schemaVersion: 'workspace-paired-proof-v1' as const, kind: 'original_vs_repair' as const, qualityClaimEligible: false as const,
    provenance: { kind: modes.size > 1 ? 'mixed' : modes.has('live') ? 'live' : 'synthetic', assessment: 'unqualified_automated_or_scripted', providerAuthenticity: 'not_attested', generationVersions: [...new Set(cases.map(item=>item.original.generationVersion))].sort(), graderVersions: [...new Set(jobs.flatMap(job=>job.assessments.map(item=>item.promptVersion)))].sort() },
    cohort: { planned: generated.length, evaluated: cases.length-paired.unresolved, repairTriggered: repairCases.length, previewExcluded: runs.length-generated.length }, paired,
    metrics: { wholeCohort: { original: metrics(cases,'original'), repair: metrics(cases,'repair') }, repairTriggered: { original: metrics(repairCases,'original'), repair: metrics(repairCases,'repair') } },
    accounting: { calls: cases.reduce((sum,item)=>sum+item.calls,0), unknownCallSlots: cases.reduce((sum,item)=>sum+item.unknownCallSlots,0), recordedOperations: cases.reduce((sum,item)=>sum+item.recordedOperations,0), totalMs: cases.some(item=>item.totalMs===null) ? null : cases.reduce((sum,item)=>sum+item.totalMs!,0), knownTotalMs: cases.reduce((sum,item)=>sum+(item.totalMs??0),0), planningAllowanceUsd: cases.some(item=>item.planningAllowanceUsd===null) ? null : cases.reduce((sum,item)=>sum+item.planningAllowanceUsd!,0), tokens: cases.some(item=>item.mode==='live' && item.tokens===null) ? null : { input: cases.reduce((sum,item)=>sum+(item.tokens?.input??0),0), output: cases.reduce((sum,item)=>sum+(item.tokens?.output??0),0) }, accounting: 'planning_allowance_not_provider_charges' },
    cases, unknowns: cases.flatMap(item=>item.unknowns.map(reason=>({questionId:item.questionId,reason}))), limitations: ['Observed local workspace requests, not a prospectively frozen independent cohort.', 'AI and scripted judgments do not establish human-reviewed quality gain.', 'Synthetic operations make zero provider calls; planning allowances are not charges.', 'Future-policy evaluation is a separate comparison and is excluded here.', 'Missing measurements remain unknown; unresolved and failed attempts retain their denominator.'] };
  return { ...body, sha256: sha(body) };
}
export type WorkspaceProof = ReturnType<typeof buildWorkspaceProof>;
/** Pure offline check: neither provider construction nor reservation is possible. */
export function verifyWorkspaceProof(packet: WorkspaceProof) {
  const {sha256,...body}=packet;
  if (sha(body)!==sha256 || packet.schemaVersion!=='workspace-paired-proof-v1' || packet.kind!=='original_vs_repair' || packet.qualityClaimEligible!==false) throw new Error('Proof bundle identity does not match its frozen contents.');
  const runs=packet.cases.map(item=>item.run), jobs=packet.cases.flatMap(item=>item.job?[item.job]:[]), receipts=new Map<string,AnswerRevisionReceipt>();
  if (new Set(runs.map(run=>run.id)).size!==runs.length) throw new Error('Proof contains duplicate original runs.');
  for(const item of packet.cases){
    if(item.original.receipt)receipts.set(item.questionId,item.original.receipt);
    for(const operation of item.operations)if(operation.receipt)receipts.set(operation.runId,operation.receipt);
    if(item.run.generation?.phase==='completed' && (!item.original.receipt || item.original.receipt.status!=='completed'))throw new Error('Completed proof generation lacks its exact receipt.');
    if(item.run.status==='completed' && item.run.generation?.phase==='completed' && item.original.receipt?.status==='completed'){
      const result=replayWorkspaceGenerationReceipt(item.run.generation.input,item.original.receipt,item.run.mode==='synthetic'?'synthetic':'live');
      if(result.attemptId!==item.run.generation.receiptId)throw new Error('Proof generation receipt identity is inconsistent.');
      if(JSON.stringify(result.answer)!==JSON.stringify(item.run.answer)||result.model!==item.run.model||JSON.stringify(result.usage)!==JSON.stringify(item.run.usage))throw new Error('Proof original differs from its exact generation receipt.');
    }
  }
  for(const job of jobs)verifyAutomaticSupportEvidence(job,id=>receipts.get(id));
  const rebuilt=buildWorkspaceProof(runs,jobs,id=>receipts.get(id));
  // Preview requests carry no generation or cost; only their exclusion count is
  // retained. Every generated run, including failures, must match recomputation.
  rebuilt.cohort.previewExcluded=packet.cohort.previewExcluded;
  const {sha256:ignored,...rebuiltBody}=rebuilt;
  if(sha(rebuiltBody)!==sha(body))throw new Error('Proof derived outcomes, denominators, sources or accounting are inconsistent.');
  return { valid:true as const, sha256, cases:runs.length, qualityClaimEligible:false as const };
}
