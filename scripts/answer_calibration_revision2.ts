import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SapiomFeedbackProvider } from '../server/feedback-provider.ts';
import { loadProductCorpus } from '../server/product-corpus.ts';
import { ProductRetriever } from '../server/product-retrieval.ts';
import { externalValidationProducts, reserveExternalValidation } from '../server/validation-ledger.ts';
import type { LoopPolicy, LoopProvider, LoopValidation, ProductCase, RetrievalResult } from '../server/loop-types.ts';

const date = '2026-09-25';
const priorPath = resolve('docs/evidence/answer-calibration-development-restart-' + date + '.json');
const protocolPath = resolve('docs/answer-calibration-revision2-' + date + '.md');
const developmentPath = resolve('docs/evidence/answer-calibration-revision2-development-' + date + '.json');
const validationPath = resolve('docs/evidence/answer-calibration-revision2-validation-' + date + '.json');
const gatePath = resolve('docs/evidence/answer-calibration-revision2-development-gate-' + date + '.json');
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const protocol = readFileSync(protocolPath, 'utf8');
const match = protocol.match(/The candidate policy is frozen before dispatch:\n\n> (.+)\n/);
if (!match) throw new Error('Frozen revision 2 policy is missing.');
const corpus = loadProductCorpus();
const products = new Map(corpus.products.map(product => [product.id, product]));
const db = new DatabaseSync(process.env.ABLATRIX_LOOP_DB ?? '.data/feedback-loop.sqlite');
function records<T>(kind: string): T[] { return (db.prepare('SELECT document FROM loop_documents WHERE kind=?').all(kind) as { document: string }[]).map(row => JSON.parse(row.document) as T); }
const baseline = records<LoopPolicy>('policy').find(policy => policy.id === 'live-baseline' && policy.status === 'baseline');
if (!baseline) throw new Error('Saved live baseline is missing.');
const candidate: LoopPolicy = { id: 'exploratory-answer-calibration-r2-' + date, parentId: baseline.id, mode: 'live', instructions: match[1], rationale: 'State attributed listing facts directly and reconcile compatible descriptions.', feedbackRunIds: [], status: 'candidate', createdAt: new Date().toISOString() };
const officialValidations = records<LoopValidation>('validation');
type Case = { caseId: string; question: string; productId: string; retrieval: RetrievalResult; retrievalSha256: string; baselineRunId?: string };
type Step = { caseId: string; arm: 'baseline' | 'candidate'; status: string; origin: 'saved_revision1' | 'revision2_live'; answer?: { answer: string; status: string; citations: { passageId: string; quote: string }[] }; rawAnswer?: string; model?: string; usage?: unknown; durationMs?: number; quoteIds?: string[]; optionCount?: number; exactQuoteMembership?: boolean; error?: string; aiReview: null };
const prior = JSON.parse(readFileSync(priorPath, 'utf8')) as { baselinePolicySha256: string; cases: Case[]; steps: Step[]; citationInterface: string; corpusVersion: string };
if (prior.baselinePolicySha256 !== sha(baseline.instructions) || prior.citationInterface !== 'snippet_id_both_arms' || prior.corpusVersion !== corpus.version || prior.steps.length !== 4 || prior.steps.some(step => step.status !== 'passed_execution' || step.model !== 'gpt-5.6-luna')) throw new Error('Saved development controls are not complete or comparable.');
for (const item of prior.cases) if (item.retrievalSha256 !== sha(JSON.stringify(item.retrieval))) throw new Error('Saved retrieval hash changed.');
const mode = process.argv.includes('--execute-development') ? 'development' : process.argv.includes('--execute-validation') ? 'validation' : 'dry-run';
const outputPath = mode === 'validation' ? validationPath : developmentPath;
if (mode === 'dry-run') {
  console.log(JSON.stringify({ dryRun: true, phase: 'development', plannedNewCalls: 2, savedControls: 2, policySha256: sha(candidate.instructions), outputPath, existingPacket: existsSync(outputPath) }));
  db.close();
  process.exit(0);
}
if (existsSync(outputPath)) throw new Error('This phase already has a packet; no call was made.');
if (mode === 'validation') {
  if (!existsSync(developmentPath) || !existsSync(gatePath)) throw new Error('Passing development packet and AI gate required.');
  const development = JSON.parse(readFileSync(developmentPath, 'utf8')) as { policySha256: string; steps: Step[] };
  const gate = JSON.parse(readFileSync(gatePath, 'utf8')) as { policySha256: string; developmentPassed: boolean; reviewer: string };
  if (development.policySha256 !== sha(candidate.instructions) || gate.policySha256 !== development.policySha256 || !gate.developmentPassed || gate.reviewer !== 'GPT-6 Astra AI assessment' || development.steps.length !== 4 || development.steps.some(step => step.status !== 'passed_execution')) throw new Error('Frozen development gate did not pass.');
}
const cases: Case[] = [];
const steps: Step[] = [];
if (mode === 'development') {
  cases.push(...prior.cases);
  for (const item of cases) {
    const saved = prior.steps.find(step => step.caseId === item.caseId && step.arm === 'baseline');
    if (!saved?.answer) throw new Error('Saved baseline control is missing.');
    const baselineStep: Step = { ...saved, origin: 'saved_revision1', aiReview: null };
    const candidateStep: Step = { caseId: item.caseId, arm: 'candidate', status: 'planned', origin: 'revision2_live', aiReview: null };
    if (item.caseId === 'epqa-train-775') steps.push(baselineStep, candidateStep);
    else steps.push(candidateStep, baselineStep);
  }
} else {
  const used = new Set(officialValidations.flatMap(validation => validation.caseIds.map(id => corpus.cases.find(item => item.id === id)?.productId).filter((id): id is string => Boolean(id))));
  for (const productId of externalValidationProducts(db, corpus.version)) used.add(productId);
  const selected: ProductCase[] = [];
  for (const item of corpus.cases) if (item.split === 'validation' && !used.has(item.productId) && !selected.some(other => other.productId === item.productId)) { selected.push(item); if (selected.length === 2) break; }
  if (selected.length !== 2) throw new Error('Two untouched validation products are unavailable.');
  const retriever = new ProductRetriever(corpus, process.env.ABLATRIX_RETRIEVAL_DB ?? '.data/product-retrieval.sqlite');
  try {
    for (const item of selected) {
      const retrieval = await retriever.retrieve(item.productId, item.question);
      cases.push({ caseId: item.id, question: item.question, productId: item.productId, retrieval, retrievalSha256: sha(JSON.stringify(retrieval)) });
    }
  } finally { retriever.close(); }
  for (const [index, item] of cases.entries()) {
    for (const arm of index === 0 ? ['baseline', 'candidate'] as const : ['candidate', 'baseline'] as const) {
      steps.push({ caseId: item.caseId, arm, status: 'planned', origin: 'revision2_live', aiReview: null });
    }
  }
}
function checkpoint(packet: object) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const temp = outputPath + '.tmp';
  writeFileSync(temp, JSON.stringify(packet, null, 2) + '\n', { mode: 0o600 });
  renameSync(temp, outputPath);
}
const newSteps = steps.filter(step => step.origin === 'revision2_live');
const packet = { format: 'ablatrix-answer-calibration-revision2-v1', phase: mode, protocolPath: 'docs/answer-calibration-revision2-' + date + '.md', policyId: candidate.id, policySha256: sha(candidate.instructions), baselinePolicySha256: sha(baseline.instructions), sourceControlPacket: mode === 'development' ? priorPath : null, modelAlias: 'gpt-luna', citationInterface: 'snippet_id_both_arms', corpusVersion: corpus.version, cases, steps, allowancePerNewCallUsd: 0.10, actualBilledCostUsd: null, startedAt: null as string | null, finishedAt: null as string | null };
const provider = new SapiomFeedbackProvider();
try {
  const capacity = provider.capacity(newSteps.length);
  if (!capacity.ready) throw new Error(capacity.reason);
  if (mode === 'validation') reserveExternalValidation(db, corpus, `packet:${candidate.id}`, sha(JSON.stringify({ corpusVersion: corpus.version, policyId: candidate.id, cases: cases.map(item => [item.caseId, item.productId, item.question]) })), cases.map(item => ({ id: item.caseId, productId: item.productId, question: item.question })));
  packet.startedAt = new Date().toISOString(); checkpoint(packet);
  for (const step of newSteps) {
    const item = cases.find(entry => entry.caseId === step.caseId)!;
    const product = products.get(item.productId);
    if (!product) throw new Error('Frozen product missing: ' + item.productId);
    const input: Parameters<LoopProvider['answer']>[0] = { question: item.question, product, policy: step.arm === 'candidate' ? candidate : baseline, passages: item.retrieval.passages };
    step.status = 'started'; checkpoint(packet);
    const started = performance.now();
    try {
      const result = await provider.answerWithSnippetIds(input);
      const exact = result.answer.citations.every(citation => input.passages.some(passage => passage.id === citation.passageId && passage.text.includes(citation.quote)));
      Object.assign(step, { status: exact && (result.answer.status !== 'answered' || result.answer.citations.length > 0) ? 'passed_execution' : 'failed_execution', answer: result.answer, rawAnswer: result.rawAnswer, model: result.model, usage: result.usage, durationMs: Math.round(performance.now() - started), quoteIds: result.quoteIds, optionCount: result.optionCount, exactQuoteMembership: exact });
    } catch (error) {
      Object.assign(step, { status: 'failed_or_unknown', durationMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : 'Unknown error' });
      checkpoint(packet);
      break;
    }
    checkpoint(packet);
  }
  packet.finishedAt = new Date().toISOString(); checkpoint(packet);
  console.log(JSON.stringify({ outputPath, phase: mode, newCalls: newSteps.length, steps: steps.map(step => ({ caseId: step.caseId, arm: step.arm, origin: step.origin, status: step.status })), actualBilledCostUsd: null }));
} finally { provider.close(); db.close(); }
