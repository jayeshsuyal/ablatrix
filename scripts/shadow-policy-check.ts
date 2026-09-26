import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadProductCorpus } from '../server/product-corpus.ts';
import { SapiomFeedbackProvider } from '../server/feedback-provider.ts';
import type { LoopPolicy, LoopRun } from '../server/loop-types.ts';

const revision = process.argv.includes('--revision=2') ? 2 : 1;
const output = revision === 2
  ? 'docs/evidence/feedback-v02-shadow-policy-revision2-2026-09-25.json'
  : 'docs/evidence/feedback-v02-shadow-policy-2026-09-25.json';
const caseIds = ['epqa-train-775', 'epqa-train-647'];
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
if (existsSync(output)) throw new Error(`Shadow check already recorded at ${output}; no calls were made.`);

const db = new DatabaseSync(process.env.ABLATRIX_LOOP_DB ?? '.data/feedback-loop.sqlite', { readOnly: true });
let baseline: LoopPolicy;
let runs: LoopRun[];
try {
  const rows = db.prepare('SELECT kind, document FROM loop_documents').all() as { kind: string; document: string }[];
  const documents = rows.map(row => ({ kind: row.kind, value: JSON.parse(row.document) }));
  baseline = documents.find(row => row.kind === 'policy' && row.value.id === 'live-baseline')?.value as LoopPolicy;
  runs = caseIds.map(caseId => documents.find(row => row.kind === 'run' && row.value.caseId === caseId && row.value.mode === 'live' && !!row.value.batchId)?.value as LoopRun);
} finally { db.close(); }
if (!baseline || baseline.mode !== 'live' || runs.some(run => !run || run.policyId !== baseline.id || run.status !== 'completed' || !run.answer || !run.retrieval || run.feedback)) throw new Error('The frozen, unreviewed live baseline is unavailable; no calls were made.');
const corpus = loadProductCorpus();
const instructions = revision === 2
  ? "Answer the selected product question using only the supplied evidence. Cite exact supporting quotes and passage IDs. Distinguish listing or manufacturer specifications from customer reports. Address each requested detail separately. Report an explicit listing specification as the listing's claim, with a citation; lack of independent verification alone does not invalidate a stated specification. State unknown details separately. When evidence directly conflicts about a specification, authenticity, or delivered item, explain the conflict and withhold only the disputed conclusion. Return answered when the supported parts give a useful answer, and insufficient_evidence when no requested detail can be answered from the evidence. Never invent a specification or transfer evidence between products."
  : `${baseline.instructions}\nFor each requested attribute, report a source's explicit specification as that source's claim, with a citation. State any unresolved verification or composition question separately. Limit abstention to the requested detail that lacks adequate evidence. When credible reports conflict about authenticity or the delivered item, preserve that uncertainty; a listing alone cannot settle it.`;
const candidate: LoopPolicy = { ...baseline, id: revision === 2 ? 'shadow-partial-answer-clarity-v2' : 'shadow-listed-specification-clarity', parentId: baseline.id, instructions, rationale: 'AI-draft hypothesis: avoid global abstention when a listing supports a qualified material answer, while preserving authenticity uncertainty.', feedbackRunIds: [], status: 'candidate' };
const provider = new SapiomFeedbackProvider();
const capacity = provider.capacity(caseIds.length);
if (!capacity.ready) { provider.close(); throw new Error(`Two-call local capacity check failed: ${capacity.reason}`); }

const artifact = {
  format: `ablatrix-shadow-policy-check-v${revision}`,
  createdAt: new Date().toISOString(),
  classification: 'exploratory-ai-draft-hypothesis; no human review or measured quality claim',
  design: `Two historical baseline answers compared with fresh candidate answers using the same saved retrieval passages and model route. Revision ${revision} is a behavior check, not a contemporaneous randomized paired evaluation.`,
  candidatePolicy: { id: candidate.id, parentId: candidate.parentId, instructions: candidate.instructions, sha256: sha256(candidate.instructions) },
  planningAllowanceUsd: Number(process.env.ABLATRIX_LOOP_ALLOWANCE_USD ?? 0.10) * caseIds.length,
  providerBilledCostUsd: null,
  results: [] as unknown[]
};
function save() {
  mkdirSync(dirname(output), { recursive: true });
  const temporary = `${output}.tmp`;
  writeFileSync(temporary, JSON.stringify(artifact, null, 2) + '\n');
  renameSync(temporary, output);
}
save();
try {
  for (const run of runs) {
    const product = corpus.products.find(item => item.id === run.productId);
    if (!product) throw new Error(`Unknown saved product for ${run.caseId}`);
    const input = { question: run.question, product, policy: candidate, passages: run.retrieval!.passages };
    const started = Date.now();
    try {
      const result = await provider.answer(input);
      if (result.answer.status === 'answered' && !result.answer.citations.length || result.answer.citations.some(citation => !input.passages.some(passage => passage.id === citation.passageId && passage.text.includes(citation.quote)))) throw new Error('Candidate returned invalid citations.');
      artifact.results.push({ caseId: run.caseId, productId: run.productId, question: run.question, baselineRunId: run.id, baselineAnswer: run.answer, candidateAnswer: result.answer, candidateModel: result.model, candidateUsage: result.usage, candidateDurationMs: Date.now() - started, retrievalSnapshotSha256: sha256(JSON.stringify(input.passages.map(item => [item.id, item.sha256, item.text]))), status: 'completed' });
      save();
      console.log(JSON.stringify({ caseId: run.caseId, status: 'completed', candidateStatus: result.answer.status, model: result.model, output }));
    } catch (error) {
      artifact.results.push({ caseId: run.caseId, baselineRunId: run.id, status: 'failed_or_unknown', reason: error instanceof Error ? error.message : 'unknown error' });
      save();
      throw error;
    }
  }
} finally { provider.close(); }
