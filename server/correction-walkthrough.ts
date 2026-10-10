import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PaidAnswerReview, originalAnswerVersionId } from './paid-answer-review.ts';
import { investigateRevision, type InvestigationIssue, type InvestigationTrace } from './revision-investigation.ts';
import type { RevisionContext } from './answer-review-source.ts';

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Walkthrough hashes require JSON values.');
  return encoded;
};
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const jsonHash = (value: unknown) => hash(canonical(value));
const selection = [
  { qid: '75', action: 'unchanged_control', issue: null, feedback: null, expectedRoute: null, maxNewRevisionAttempts: 0 },
  { qid: '26', action: 'proposed_revision', issue: 'answer_quality', feedback: 'Make the answer concise and natural. Remove repeated evidence framing. Retain buyers’ white/off-white/light-gray descriptions and lighter-than-pewter comparison; do not claim an exact manufacturer color.', expectedRoute: 'ready_to_revise', maxNewRevisionAttempts: 1 },
  { qid: '63', action: 'proposed_revision', issue: 'missed_source', feedback: 'The No cites only a tentative customer opinion. Use saved description 595 to explain one slim quarter keg versus up to two sixth-barrel kegs. Cite exact listing text and do not claim independently tested fit.', expectedRoute: 'ready_to_revise', maxNewRevisionAttempts: 1 },
  { qid: '19', action: 'reuse_historical_correction', issue: null, feedback: null, expectedRoute: null, maxNewRevisionAttempts: 0 },
  { qid: '47', action: 'offline_missing_information', issue: 'missing_evidence', feedback: 'No saved source establishes WMR200 compatibility. Request exact compatibility documentation rather than generalizing from other stations.', expectedRoute: 'needs_information', maxNewRevisionAttempts: 0 }
] as const;

type OriginalAnswer = NonNullable<ReturnType<PaidAnswerReview['overview']>['cases'][number]['result']>['run']['answer'];
export type CorrectionWalkthroughCase = {
  qid: string; action: typeof selection[number]['action']; issue: InvestigationIssue | null; feedback: string | null;
  reviewKind: 'ai_assisted'; expectedRoute: InvestigationTrace['status'] | null; maxNewRevisionAttempts: number;
  context: RevisionContext; sourceContextSha256: string; inputSha256: string;
  original: { mode: 'live'; runId: string; versionId: string; model: string | null; answer: NonNullable<OriginalAnswer>; retrievedSourceIds: string[] };
  originalSourceIds: string[]; originalCitedSourceIds: string[];
  citationMapping: { passageId: string; sourceId: string | null; sourceSha256: string | null; quote: string; exactQuoteMatch: boolean }[];
  outcome: 'original_retained_unreviewed' | 'not_executed' | 'historical_document_only' | 'rules_only_no_revision';
};
export type CorrectionWalkthroughPlan = {
  protocol: 'correction-development-walkthrough-v1'; manifestSha256: string; implementationSha256: { investigation: string; feedbackProvider: string; answerRevisions: string };
  selection: 'ai_assisted_development_selection'; freshValidation: false; qualityClaimEligible: false;
  humanJudgments: 0; humanReviewStatus: 'pending'; reviewContextProvenance: 'restored_original_customer_questions_after_original_generation';
  limits: { maxNewRevisionAttempts: 2; planningAllowancePerAttemptUsd: 0.1; maxNewPlanningAllowanceUsd: 0.2; actualProviderCharges: 'unavailable'; webEnabled: false; automaticRetries: 0 };
  generationPlan: { requestedModelAlias: 'gpt-luna'; promptVersion: 'answer-revision-v3-investigation'; execution: 'not_implemented_by_this_command' };
  cases: CorrectionWalkthroughCase[];
  historicalCorrection: { qid: '19'; path: string; documentSha256: string; document: string; answerText: string; mode: 'historical_live'; newCalls: 0; humanDecision: 'pending_as_recorded'; qualityClaimEligible: false };
};
export type WalkthroughCheck = { name: string; passed: boolean; detail: string };
export const correctionWalkthroughPlanHash = (plan: CorrectionWalkthroughPlan) => jsonHash(plan);

/** Reads only hash-pinned public artifacts and an in-memory review database. */
export function correctionWalkthroughPlan(): CorrectionWalkthroughPlan {
  const reviews = new PaidAnswerReview(':memory:');
  try {
    const saved = reviews.overview();
    const cases = selection.map(item => {
      const original = saved.cases.find(candidate => candidate.qid === item.qid);
      if (!original?.result?.run.answer || !original.result.run.retrieval) throw new Error(`Walkthrough: missing pinned answer ${item.qid}.`);
      const run = original.result.run;
      const context: RevisionContext = { question: original.question, product: { id: original.asin, title: original.title }, sources: original.sources.map(source => ({ ...source, id: `${item.qid}:${source.sha256}`, origin: 'pinned' })), clarifications: [] };
      const citationMapping = run.answer!.citations.map(citation => {
        const passage = run.retrieval!.passages.find(value => value.id === citation.passageId);
        const source = context.sources.find(value => value.sha256 === passage?.sha256 && value.text === passage?.text);
        return { ...citation, sourceId: source?.id ?? null, sourceSha256: source?.sha256 ?? null, exactQuoteMatch: !!source && source.text.includes(citation.quote) };
      });
      const frozen = { ...item, reviewKind: 'ai_assisted' as const, context, sourceContextSha256: jsonHash(context),
        original: { mode: 'live' as const, runId: run.id, versionId: originalAnswerVersionId(item.qid, run.id), model: run.model, answer: run.answer!, retrievedSourceIds: run.retrieval!.passages.map(passage => context.sources.find(source => source.sha256 === passage.sha256 && source.text === passage.text)?.id ?? passage.id) },
        originalSourceIds: context.sources.map(source => source.id), originalCitedSourceIds: citationMapping.map(citation => citation.sourceId ?? citation.passageId), citationMapping,
        outcome: item.action === 'proposed_revision' ? 'not_executed' as const : item.action === 'unchanged_control' ? 'original_retained_unreviewed' as const : item.action === 'reuse_historical_correction' ? 'historical_document_only' as const : 'rules_only_no_revision' as const };
      return { ...frozen, inputSha256: jsonHash(frozen) };
    });
    const path = 'docs/evidence/q19-live-revision-2026-09-29.md', document = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    const answerText = document.match(/The saved revision says:\s*\n\n> ([^\n]+)/)?.[1];
    if (!answerText) throw new Error('Walkthrough: historical Q19 report no longer contains its saved correction.');
    return { protocol: 'correction-development-walkthrough-v1', manifestSha256: saved.manifestSha256, implementationSha256: { investigation: hash(readFileSync(new URL('./revision-investigation.ts', import.meta.url))), feedbackProvider: hash(readFileSync(new URL('./feedback-provider.ts', import.meta.url))), answerRevisions: hash(readFileSync(new URL('./answer-revisions.ts', import.meta.url))) },
      selection: 'ai_assisted_development_selection', freshValidation: false, qualityClaimEligible: false, humanJudgments: 0, humanReviewStatus: 'pending', reviewContextProvenance: 'restored_original_customer_questions_after_original_generation',
      limits: { maxNewRevisionAttempts: 2, planningAllowancePerAttemptUsd: 0.1, maxNewPlanningAllowanceUsd: 0.2, actualProviderCharges: 'unavailable', webEnabled: false, automaticRetries: 0 },
      generationPlan: { requestedModelAlias: 'gpt-luna', promptVersion: 'answer-revision-v3-investigation', execution: 'not_implemented_by_this_command' }, cases,
      historicalCorrection: { qid: '19', path, documentSha256: hash(document), document, answerText, mode: 'historical_live', newCalls: 0, humanDecision: 'pending_as_recorded', qualityClaimEligible: false } };
  } finally { reviews.close(); }
}

/** No search adapter is supplied; this function cannot dispatch provider calls. */
export async function preflightCorrectionWalkthrough(plan: CorrectionWalkthroughPlan) {
  const checks: WalkthroughCheck[] = plan.cases.map(item => ({ name: `q${item.qid}_citation_mapping`, passed: item.citationMapping.every(citation => citation.sourceId !== null && citation.exactQuoteMatch), detail: 'Exact quote membership and passage-to-source mapping only; this does not judge answer correctness.' }));
  const investigations: { qid: string; inputSha256: string; trace: InvestigationTrace }[] = [];
  for (const item of plan.cases) {
    if (!item.issue || !item.feedback) continue;
    const result = await investigateRevision({ context: item.context, critique: item.feedback, issue: item.issue, runId: `walkthrough-${item.qid}-${item.inputSha256.slice(0, 16)}`, originalCitedSourceIds: item.originalCitedSourceIds, originalSourceIds: item.originalSourceIds });
    investigations.push({ qid: item.qid, inputSha256: item.inputSha256, trace: result.investigation });
    checks.push({ name: `q${item.qid}_route`, passed: result.investigation.status === item.expectedRoute && result.investigation.externalCalls === 0, detail: `Expected ${item.expectedRoute}; observed ${result.investigation.status}; external calls ${result.investigation.externalCalls}. Routing is not a quality verdict.` });
    if (item.qid === '26') checks.push({ name: 'q26_color_sources_available', passed: ['ePQA review 220', 'ePQA cqa 222', 'ePQA review 223'].every(label => item.context.sources.some(source => source.label === label && result.investigation.selectedSourceIds.includes(source.id))), detail: 'White, off-white/light-gray, and lighter-than-pewter buyer descriptions must remain available; their original questions remain attached.' });
    if (item.qid === '63') checks.push({ name: 'q63_listing_candidate', passed: result.investigation.selectedSourceIds.some(id => item.context.sources.some(source => source.id === id && source.label === 'ePQA description 595')), detail: 'The saved listing configuration must remain available to the proposed revision.' });
    if (item.qid === '47') checks.push({ name: 'q47_other_station_questions_excluded', passed: ['ePQA cqa 431', 'ePQA cqa 434'].every(label => item.context.sources.some(source => source.label === label && !result.investigation.selectedSourceIds.includes(source.id))), detail: 'Customer answers about WS-1171A and BAA968HG/THGR228N must not become source candidates for WMR200 compatibility.' });
  }
  return { passed: checks.every(check => check.passed), checks, investigations };
}

export async function buildCorrectionWalkthrough(createdAt = new Date().toISOString()) {
  const plan = correctionWalkthroughPlan();
  return { kind: 'no_call_development_walkthrough' as const, createdAt, planSha256: correctionWalkthroughPlanHash(plan), plan, execution: { newProviderCalls: 0, newAnswersGenerated: 0, newHumanJudgments: 0, qualityClaimEligible: false }, preflight: await preflightCorrectionWalkthrough(plan) };
}
