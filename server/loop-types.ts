export type LoopMode = 'fixture' | 'live';
export type LoopSplit = 'development' | 'validation' | 'holdout';
export type Product = { id: string; title: string; split: LoopSplit };
export type Passage = { id: string; productId: string; source: string; text: string; reference: string; sha256: string };
export type ProductCase = { id: string; productId: string; question: string; split: LoopSplit; referenceAnswer: string; referencePassageIds: string[]; labelStatus: string };
export type ProductCorpus = { version: string; source: string; license: string; products: Product[]; passages: Passage[]; cases: ProductCase[] };
export type RetrievedPassage = Passage & { lexicalRank: number | null; semanticRank: number | null; score: number };
export type RetrievalResult = { passages: RetrievedPassage[]; durationMs: number; method: string; embeddingModel: string; corpusVersion: string };
export type LoopAnswer = { answer: string; status: 'answered' | 'insufficient_evidence'; citations: { passageId: string; quote: string }[] };
export type LoopUsage = { inputTokens: number; outputTokens: number } | null;
export type LoopTimings = { retrievalStartedAt?: string; retrievalEndedAt?: string; generationStartedAt?: string; generationEndedAt?: string; retrievalReused: boolean };
export type LoopDetailReview = { detail: string; evidence: 'listing' | 'customer_report' | 'conflicting' | 'missing'; response: 'addressed' | 'qualified' | 'missed' | 'overstated' };
export type LoopFeedback = { correct: boolean; supported: boolean; referenceChecked: boolean; category: 'none' | 'unsupported_claim' | 'incomplete_answer' | 'missed_evidence' | 'source_conflict' | 'unnecessary_abstention'; correction: string; sourceIds: string[]; reviewer: string; kind: 'human' | 'synthetic'; createdAt: string; draftId?: string; details?: LoopDetailReview[] };
export type LoopReviewDraft = Pick<LoopFeedback, 'correct' | 'supported' | 'category' | 'correction' | 'sourceIds' | 'reviewer'> & { id: string; kind: 'ai_assisted'; rationale: string; confidence: 'high' | 'medium' | 'low'; createdAt: string };
export type LoopPolicy = { id: string; parentId: string | null; instructions: string; rationale: string; feedbackRunIds: string[]; status: 'baseline' | 'candidate' | 'promoted' | 'rejected'; mode: LoopMode; createdAt: string };
export type LoopRun = { id: string; mode: LoopMode; productId: string; caseId: string | null; split: LoopSplit; question: string; policyId: string; status: 'running' | 'completed' | 'failed' | 'interrupted'; answer: LoopAnswer | null; retrieval: RetrievalResult | null; model: string | null; usage: LoopUsage; durationMs: number | null; error: string | null; feedback: LoopFeedback | null; createdAt: string; validationId: string | null; batchId?: string | null; finalId?: string | null; blindLabel?: string; reviewDraft?: LoopReviewDraft; timings?: LoopTimings };
export type LoopBatch = { id: string; mode: LoopMode; policyId: string; caseIds: string[]; runIds: string[]; manifestSha256: string; status: 'running' | 'completed' | 'interrupted'; reason: string; createdAt: string };
export type LoopFinalResult = { baselineCorrect: number; candidateCorrect: number; wins: number; losses: number; ties: number; regressions: number; pairedDifferencePoints: number; interval95: [number, number]; baselineAnswered: number; candidateAnswered: number; baselineUnsupported: number; candidateUnsupported: number; baselineTokens: number | null; candidateTokens: number | null; baselineMedianMs: number; candidateMedianMs: number; billedCostUsd: null; verdict: 'gain_observed' | 'decline_observed' | 'inconclusive'; cases: { caseId: string; baselineRunId: string; candidateRunId: string; baselineGood: boolean; candidateGood: boolean }[] };
export type LoopFinal = { id: string; mode: LoopMode; baselineId: string; candidateId: string; caseIds: string[]; runIds: string[]; corpusVersion: string; manifestSha256: string; status: 'running' | 'awaiting_review' | 'reported' | 'interrupted'; reason: string; createdAt: string; result: LoopFinalResult | null };
export type LoopValidation = { id: string; candidateId: string; parentId: string; mode: LoopMode; status: 'running' | 'awaiting_review' | 'accepted' | 'rejected' | 'interrupted'; caseIds: string[]; runIds: string[]; createdAt: string; reason: string; parentCorrect: number | null; candidateCorrect: number | null; regressions: number | null };
export type LoopEvent = { id: string; at: string; kind: string; message: string; policyId: string | null };
export type LoopExternalComparison = { id: string; mode: 'live'; kind: 'exploratory_ai_assessment'; policyId: string; baselinePolicyId: string; packetSha256: string; reviewSha256: string; corpusVersion: string; startedAt: string; finishedAt: string; cases: { caseId: string; productId: string; question: string; retrieval: RetrievalResult; answers: { arm: 'baseline' | 'candidate'; blindLabel: 'A' | 'B'; answer: LoopAnswer; model: string; durationMs: number; exactQuoteMembership: true }[]; aiReview: { preferredBlindLabel: 'A'; preferredArm: 'baseline' | 'candidate'; rationale: string; axes: { baseline: { support: 'pass'; adequacy: 'pass'; citations: 'pass' }; candidate: { support: 'pass'; adequacy: 'pass'; citations: 'pass' } } } }[] };
export type LoopOverview = { products: Product[]; cases: ProductCase[]; corpus: { version: string; source: string; license: string; passageCount: number }; policies: LoopPolicy[]; activePolicyIds: Record<LoopMode, string>; runs: LoopRun[]; batches: LoopBatch[]; validations: LoopValidation[]; externalValidationCases: { caseId: string; productId: string; sourceId: string; sourceSha256: string; reservedAt: string }[]; externalComparisons?: LoopExternalComparison[]; finals: LoopFinal[]; reviewCards: Record<string, LoopRun[]>; events: LoopEvent[]; readiness: { ready: boolean; reason: string }; busy: boolean };
export interface LoopProvider {
  readiness(): { ready: boolean; reason: string };
  capacity?(requests: number): { ready: boolean; reason: string };
  answer(input: { question: string; product: Product; policy: LoopPolicy; passages: RetrievedPassage[]; runId?: string }): Promise<{ answer: LoopAnswer; model: string; usage: LoopUsage }>;
  answerWithSnippetIds?(input: { question: string; product: Product; policy: LoopPolicy; passages: RetrievedPassage[]; runId?: string }): Promise<{ answer: LoopAnswer; model: string; usage: LoopUsage }>;
  propose(input: { policy: LoopPolicy; examples: { question: string; answer: LoopAnswer; feedback: LoopFeedback; evidence: Passage[] }[] }): Promise<{ instructions: string; rationale: string }>;
}
export interface LoopRetriever {
  retrieve(productId: string, question: string): Promise<RetrievalResult>;
  close(): void;
}
