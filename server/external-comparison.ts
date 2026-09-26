import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { LoopAnswer, LoopExternalComparison, ProductCorpus, RetrievalResult } from './loop-types.ts';

const packetUrl = new URL('../docs/evidence/answer-calibration-revision2-validation-2026-09-25.json', import.meta.url);
const reviewUrl = new URL('../docs/evidence/answer-calibration-revision2-validation-astra-review-2026-09-25.md', import.meta.url);
const expectedPacketHash = '206bd9f94b9b4e2c6c9b27d203f1b0d5e56af256b7c76b4da33e382fa463f16e';
const expectedReviewHash = '03bcbcce92b018a81b2d13f83819d2482c84eb4e2d3377c2d92b416c2e3913d4';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const pass = { support: 'pass', adequacy: 'pass', citations: 'pass' } as const;
const reviews = {
  'epqa-dev-535': { preferredBlindLabel: 'A', preferredArm: 'baseline', rationale: 'Both answers pass. The baseline narrowly wins because its direct iPhone 4S customer report better addresses the fit concern; the candidate highlights an iPhone 4 report.' },
  'epqa-dev-587': { preferredBlindLabel: 'A', preferredArm: 'candidate', rationale: 'Both answers pass. The candidate narrowly wins because it more clearly attributes generic buying advice while acknowledging that Droid Turbo fit is unverified.' },
} as const;

type Packet = { format: string; phase: string; corpusVersion: string; policyId: string; startedAt: string; finishedAt: string; cases: { caseId: string; productId: string; question: string; retrieval: RetrievalResult; retrievalSha256: string }[]; steps: { caseId: string; arm: 'baseline' | 'candidate'; status: string; answer: LoopAnswer; model: string; durationMs: number; exactQuoteMembership: boolean }[] };

/** A checked, read-only projection of a completed standalone round. Never creates an official validation. */
export function loadExternalComparison(corpus: ProductCorpus, packetRaw = readFileSync(packetUrl, 'utf8'), reviewRaw = readFileSync(reviewUrl, 'utf8')): LoopExternalComparison[] {
  if (corpus.version !== 'epqa-demo-v1-cec976cc2f22') return [];
  if (sha(packetRaw) !== expectedPacketHash || sha(reviewRaw) !== expectedReviewHash) throw new Error('External comparison evidence checksum mismatch.');
  const packet = JSON.parse(packetRaw) as Packet;
  const expectedIds = Object.keys(reviews);
  if (packet.format !== 'ablatrix-answer-calibration-revision2-v1' || packet.phase !== 'validation' || packet.corpusVersion !== corpus.version || packet.policyId !== 'exploratory-answer-calibration-r2-2026-09-25' || !packet.startedAt || !packet.finishedAt || packet.cases.length !== 2 || packet.steps.length !== 4 || new Set(packet.cases.map(item => item.caseId)).size !== 2 || !expectedIds.every(id => packet.cases.some(item => item.caseId === id))) throw new Error('External comparison packet is incomplete.');
  const cases = packet.cases.map(item => {
    const sourceCase = corpus.cases.find(entry => entry.id === item.caseId);
    if (!sourceCase || sourceCase.split !== 'validation' || sourceCase.productId !== item.productId || sourceCase.question !== item.question || item.retrieval.corpusVersion !== corpus.version || sha(JSON.stringify(item.retrieval)) !== item.retrievalSha256 || item.retrieval.passages.length !== 5 || new Set(item.retrieval.passages.map(passage => passage.id)).size !== 5) throw new Error(`External comparison case mismatch: ${item.caseId}.`);
    for (const passage of item.retrieval.passages) {
      const saved = corpus.passages.find(entry => entry.id === passage.id);
      if (!saved || saved.productId !== item.productId || saved.text !== passage.text || saved.sha256 !== passage.sha256 || saved.reference !== passage.reference || saved.source !== passage.source || sha(passage.text) !== passage.sha256) throw new Error(`External comparison source mismatch: ${passage.id}.`);
    }
    const pair = packet.steps.filter(step => step.caseId === item.caseId);
    if (pair.length !== 2 || new Set(pair.map(step => step.arm)).size !== 2) throw new Error(`External comparison pair mismatch: ${item.caseId}.`);
    const answers = pair.map(step => {
      if (step.status !== 'passed_execution' || step.model !== 'gpt-5.6-luna' || step.exactQuoteMembership !== true || !step.answer?.answer || !['answered', 'insufficient_evidence'].includes(step.answer.status) || !step.answer.citations.length || step.answer.citations.some(citation => !item.retrieval.passages.some(passage => passage.id === citation.passageId && passage.text.includes(citation.quote)))) throw new Error(`External comparison answer mismatch: ${item.caseId}/${step.arm}.`);
      return { arm: step.arm, blindLabel: ((item.caseId === 'epqa-dev-535' ? step.arm === 'baseline' : step.arm === 'candidate') ? 'A' : 'B') as 'A' | 'B', answer: step.answer, model: step.model, durationMs: step.durationMs, exactQuoteMembership: true as const };
    }).sort((a, b) => a.blindLabel.localeCompare(b.blindLabel));
    const review = reviews[item.caseId as keyof typeof reviews];
    return { caseId: item.caseId, productId: item.productId, question: item.question, retrieval: item.retrieval, answers, aiReview: { ...review, axes: { baseline: pass, candidate: pass } } };
  });
  return [{ id: packet.policyId, mode: 'live', kind: 'exploratory_ai_assessment', policyId: packet.policyId, baselinePolicyId: 'live-baseline', packetSha256: expectedPacketHash, reviewSha256: expectedReviewHash, corpusVersion: corpus.version, startedAt: packet.startedAt, finishedAt: packet.finishedAt, cases }];
}
