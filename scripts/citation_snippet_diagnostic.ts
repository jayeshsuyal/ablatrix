import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SapiomFeedbackProvider, quoteOptions } from '../server/feedback-provider.ts';
import { loadProductCorpus } from '../server/product-corpus.ts';
import type { LoopPolicy, LoopRun, LoopProvider } from '../server/loop-types.ts';

const outputPath = resolve('docs/evidence/citation-snippet-diagnostic-2026-09-25.json');
const plan = [
  { caseId: 'epqa-train-775', arms: ['raw_quote', 'snippet_id'] as const },
  { caseId: 'epqa-train-647', arms: ['snippet_id', 'raw_quote'] as const },
];
const db = new DatabaseSync(process.env.ABLATRIX_LOOP_DB ?? '.data/feedback-loop.sqlite');
function records<T>(kind: string): T[] { return (db.prepare('SELECT document FROM loop_documents WHERE kind=?').all(kind) as { document: string }[]).map(row => JSON.parse(row.document) as T); }
const policy = records<LoopPolicy>('policy').find(item => item.id === 'f9f3e212-5691-48d9-aaf3-0fd8ad79aff9' && item.status === 'rejected');
const runs = records<LoopRun>('run');
const products = new Map(loadProductCorpus().products.map(item => [item.id, item]));
if (!policy) throw new Error('Saved rejected candidate is missing.');
const cases = plan.map(item => {
  const run = runs.filter(saved => saved.mode === 'live' && saved.caseId === item.caseId && saved.policyId === 'live-baseline' && !saved.validationId && saved.status === 'completed' && saved.retrieval).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!run?.retrieval) throw new Error(`Saved baseline development retrieval is missing for ${item.caseId}.`);
  const options = quoteOptions(run.retrieval.passages);
  if (!options.length || options.length > 60) throw new Error(`Quote options out of bounds for ${item.caseId}: ${options.length}.`);
  return { caseId: item.caseId, run, arms: item.arms, optionCount: options.length };
});
db.close();
const steps = cases.flatMap(item => item.arms.map(arm => ({ caseId: item.caseId, arm, baselineRunId: item.run.id, status: 'planned' as string })));
const packet = {
  format: 'ablatrix-citation-snippet-diagnostic-v1',
  hypothesis: 'Server-provided literal quote IDs reduce exact-quote execution failures while preserving answer correctness and support.',
  interpretation: 'Development-only exploratory diagnostic using the previously rejected candidate policy. It does not reopen its consumed validation or change the active baseline. Exact quote membership is mechanical; answer correctness and citation relevance require independent human review. No fresh validation product is consumed.',
  policyId: policy.id, policyStatus: policy.status, modelAlias: 'gpt-luna', sameSavedRetrievalWithinEachPair: true,
  cases: cases.map(item => ({ caseId: item.caseId, baselineRunId: item.run.id, question: item.run.question, productId: item.run.productId, corpusVersion: item.run.retrieval!.corpusVersion, passageIds: item.run.retrieval!.passages.map(p => p.id), quoteOptions: quoteOptions(item.run.retrieval!.passages), quoteOptionCount: item.optionCount })),
  steps, allowancePerCallUsd: 0.10, actualBilledCostUsd: null, startedAt: null as string | null, finishedAt: null as string | null,
};
function checkpoint() {
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(packet, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, outputPath);
}
if (!process.argv.includes('--execute')) {
  console.log(JSON.stringify({ dryRun: true, outputPath, plannedCalls: steps.length, cases: packet.cases.map(item => ({ caseId: item.caseId, baselineRunId: item.baselineRunId, quoteOptionCount: item.quoteOptionCount })), existingPacket: existsSync(outputPath) }));
  process.exit(0);
}
if (existsSync(outputPath)) throw new Error('Diagnostic packet already exists. No call was made; inspect it before any new execution.');
const provider = new SapiomFeedbackProvider();
try {
  const capacity = provider.capacity(steps.length);
  if (!capacity.ready) throw new Error(capacity.reason);
  packet.startedAt = new Date().toISOString(); checkpoint();
  for (const step of steps) {
    const item = cases.find(entry => entry.caseId === step.caseId)!;
    const product = products.get(item.run.productId);
    if (!product) throw new Error(`Product missing from frozen corpus: ${item.run.productId}`);
    const input: Parameters<LoopProvider['answer']>[0] = { question: item.run.question, product, policy, passages: item.run.retrieval!.passages };
    step.status = 'started'; checkpoint();
    const started = performance.now();
    try {
      const result = step.arm === 'raw_quote' ? await provider.answer(input) : await provider.answerWithSnippetIds(input);
      const exact = result.answer.citations.every(citation => input.passages.some(passage => passage.id === citation.passageId && passage.text.includes(citation.quote)));
      Object.assign(step, { status: exact && (result.answer.status !== 'answered' || result.answer.citations.length > 0) ? 'passed_execution' : 'failed_execution', answer: result.answer, model: result.model, usage: result.usage, durationMs: Math.round(performance.now() - started), ...(step.arm === 'snippet_id' ? { quoteIds: 'quoteIds' in result ? result.quoteIds : [], optionCount: 'optionCount' in result ? result.optionCount : 0 } : {}), exactQuoteMembership: exact, humanReview: null });
    } catch (error) {
      Object.assign(step, { status: 'failed_or_unknown', durationMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : 'Unknown error', humanReview: null });
      checkpoint();
      break; // No retries or further paid calls after an uncertain attempt.
    }
    checkpoint();
  }
  packet.finishedAt = new Date().toISOString(); checkpoint();
  console.log(JSON.stringify({ outputPath, steps: steps.map(item => ({ caseId: item.caseId, arm: item.arm, status: item.status })), actualBilledCostUsd: null }));
} finally { provider.close(); }
