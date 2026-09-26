import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SapiomFeedbackProvider } from '../server/feedback-provider.ts';
import { loadProductCorpus } from '../server/product-corpus.ts';
import { ProductRetriever } from '../server/product-retrieval.ts';
import type { LoopPolicy, LoopRun, LoopValidation, LoopProvider, ProductCase, RetrievalResult } from '../server/loop-types.ts';

const date = '2026-09-25';
const developmentPath = resolve('docs/evidence/answer-calibration-development-' + date + '.json');
const restartPath = resolve('docs/evidence/answer-calibration-development-restart-' + date + '.json');
const validationPath = resolve('docs/evidence/answer-calibration-validation-' + date + '.json');
const gatePath = resolve('docs/evidence/answer-calibration-development-gate-' + date + '.json');
const protocol = readFileSync(resolve('docs/answer-calibration-round-' + date + '.md'), 'utf8');
const policyText = protocol.match(/The candidate uses this complete policy:\n\n> (.+)\n/);
if (!policyText) throw new Error('The frozen candidate policy is missing from the protocol.');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const corpus = loadProductCorpus();
const products = new Map(corpus.products.map(item => [item.id, item]));
const db = new DatabaseSync(process.env.ABLATRIX_LOOP_DB ?? '.data/feedback-loop.sqlite');
function records<T>(kind: string): T[] { return (db.prepare('SELECT document FROM loop_documents WHERE kind=?').all(kind) as { document: string }[]).map(row => JSON.parse(row.document) as T); }
const baseline = records<LoopPolicy>('policy').find(item => item.id === 'live-baseline' && item.status === 'baseline');
if (!baseline) throw new Error('The saved live baseline is missing.');
const candidate: LoopPolicy = { id: 'exploratory-answer-calibration-' + date, parentId: baseline.id, mode: 'live', instructions: policyText[1], rationale: 'Separate directly supported listing claims from narrower uncertainty.', feedbackRunIds: [], status: 'candidate', createdAt: new Date().toISOString() };
const runs = records<LoopRun>('run');
const validationRecords = records<LoopValidation>('validation');
const mode = process.argv.includes('--execute-development-restart') ? 'development_restart' : process.argv.includes('--execute-development') ? 'development' : process.argv.includes('--execute-validation') ? 'validation' : 'dry-run';
const outputPath = mode === 'validation' ? validationPath : mode === 'development_restart' ? restartPath : developmentPath;
type Case = { caseId: string; question: string; productId: string; retrieval: RetrievalResult; baselineRunId?: string; retrievalSha256: string };
type Step = { caseId: string; arm: 'baseline' | 'candidate'; status: string; answer?: unknown; model?: string; usage?: unknown; durationMs?: number; quoteIds?: string[]; optionCount?: number; exactQuoteMembership?: boolean; error?: string; aiReview: null };
const cases: Case[] = [];
if (mode !== 'validation') {
  for (const caseId of ['epqa-train-775', 'epqa-train-647']) {
    const run = runs.filter(item => item.mode === 'live' && item.caseId === caseId && item.policyId === baseline.id && !item.validationId && item.status === 'completed' && item.retrieval).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!run?.retrieval) throw new Error('Saved development retrieval is missing for ' + caseId + '.');
    cases.push({ caseId, question: run.question, productId: run.productId, retrieval: run.retrieval, baselineRunId: run.id, retrievalSha256: digest(JSON.stringify(run.retrieval)) });
  }
} else {
  if (!existsSync(restartPath) || !existsSync(gatePath)) throw new Error('Completed development restart and AI review gate are required before fresh validation.');
  const development = JSON.parse(readFileSync(restartPath, 'utf8')) as { policySha256: string; steps: Step[] };
  const gate = JSON.parse(readFileSync(gatePath, 'utf8')) as { policySha256: string; developmentPassed: boolean; reviewer: string };
  if (development.policySha256 !== digest(candidate.instructions) || gate.policySha256 !== development.policySha256 || !gate.developmentPassed || gate.reviewer !== 'GPT-6 Astra AI assessment' || development.steps.length !== 4 || development.steps.some(step => step.status !== 'passed_execution')) throw new Error('Frozen development policy or AI review gate did not pass.');
}
db.close();
function checkpoint(packet: object, path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + '.tmp';
  writeFileSync(temporary, JSON.stringify(packet, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, path);
}
const armOrder = (index: number): ['baseline' | 'candidate', 'baseline' | 'candidate'] => index % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
if (mode === 'dry-run') {
  console.log(JSON.stringify({ dryRun: true, phase: 'development', outputPath, plannedCalls: 4, cases: cases.map(item => ({ caseId: item.caseId, baselineRunId: item.baselineRunId, retrievalSha256: item.retrievalSha256 })), policySha256: digest(candidate.instructions), existingPacket: existsSync(outputPath), validationGateExists: existsSync(gatePath) }));
  process.exit(0);
}
if (existsSync(outputPath)) throw new Error('This phase already has a packet. No paid call was made.');
if (mode === 'development_restart') {
  if (!existsSync(developmentPath)) throw new Error('The original failed packet is required before a recorded restart.');
  const prior = JSON.parse(readFileSync(developmentPath, 'utf8')) as { policySha256: string; steps: Step[] };
  if (prior.policySha256 !== digest(candidate.instructions) || prior.steps[0]?.status !== 'failed_or_unknown' || prior.steps.slice(1).some(step => step.status !== 'planned')) throw new Error('The original packet is not the diagnosed one-attempt stop.');
}
if (mode === 'validation') {
  const used = new Set(validationRecords.flatMap(item => item.caseIds.map(id => corpus.cases.find(entry => entry.id === id)?.productId).filter((id): id is string => Boolean(id))));
  const selected: ProductCase[] = [];
  for (const item of corpus.cases) if (item.split === 'validation' && !used.has(item.productId) && !selected.some(other => other.productId === item.productId)) { selected.push(item); if (selected.length === 2) break; }
  if (selected.length !== 2) throw new Error('Two untouched validation products are unavailable.');
  const retriever = new ProductRetriever(corpus, process.env.ABLATRIX_RETRIEVAL_DB ?? '.data/product-retrieval.sqlite');
  try {
    for (const item of selected) {
      const retrieval = await retriever.retrieve(item.productId, item.question);
      cases.push({ caseId: item.id, question: item.question, productId: item.productId, retrieval, retrievalSha256: digest(JSON.stringify(retrieval)) });
    }
  } finally { retriever.close(); }
}
const steps: Step[] = cases.flatMap((item, index) => armOrder(index).map(arm => ({ caseId: item.caseId, arm, status: 'planned', aiReview: null })));
const packet = { format: 'ablatrix-answer-calibration-v1', phase: mode, protocolPath: 'docs/answer-calibration-round-' + date + '.md', policyId: candidate.id, policySha256: digest(candidate.instructions), baselinePolicySha256: digest(baseline.instructions), modelAlias: 'gpt-luna', citationInterface: 'snippet_id_both_arms', corpusVersion: corpus.version, cases, steps, allowancePerCallUsd: 0.10, actualBilledCostUsd: null, startedAt: null as string | null, finishedAt: null as string | null };
const provider = new SapiomFeedbackProvider();
try {
  const capacity = provider.capacity(steps.length);
  if (!capacity.ready) throw new Error(capacity.reason);
  packet.startedAt = new Date().toISOString(); checkpoint(packet, outputPath);
  for (const step of steps) {
    const item = cases.find(entry => entry.caseId === step.caseId)!;
    const product = products.get(item.productId);
    if (!product) throw new Error('Frozen corpus product missing: ' + item.productId);
    const input: Parameters<LoopProvider['answer']>[0] = { question: item.question, product, policy: step.arm === 'baseline' ? baseline : candidate, passages: item.retrieval.passages };
    step.status = 'started'; checkpoint(packet, outputPath);
    const started = performance.now();
    try {
      const result = await provider.answerWithSnippetIds(input);
      const exact = result.answer.citations.every(citation => input.passages.some(passage => passage.id === citation.passageId && passage.text.includes(citation.quote)));
      Object.assign(step, { status: exact && (result.answer.status !== 'answered' || result.answer.citations.length > 0) ? 'passed_execution' : 'failed_execution', answer: result.answer, model: result.model, usage: result.usage, durationMs: Math.round(performance.now() - started), quoteIds: result.quoteIds, optionCount: result.optionCount, exactQuoteMembership: exact });
    } catch (error) {
      Object.assign(step, { status: 'failed_or_unknown', durationMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : 'Unknown error' });
      checkpoint(packet, outputPath);
      break;
    }
    checkpoint(packet, outputPath);
  }
  packet.finishedAt = new Date().toISOString(); checkpoint(packet, outputPath);
  console.log(JSON.stringify({ outputPath, phase: mode, steps: steps.map(item => ({ caseId: item.caseId, arm: item.arm, status: item.status })), actualBilledCostUsd: null }));
} finally { provider.close(); }
