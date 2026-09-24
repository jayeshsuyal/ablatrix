export type PilotArm = 'baseline' | 'candidate';
export type PilotMode = 'fixture' | 'live';
export type PilotStatus = 'running' | 'completed' | 'cancelled' | 'blocked' | 'interrupted';
export type PilotSource = { id: string; title: string; url: string; capturedAt: string; text: string; sha256: string };
export type PilotTask = { id: string; split: 'development' | 'evaluation'; question: string; sourceId: string; expectedAnswer: string; requiredFacts: string[]; supportQuote: string };
export type PilotSuite = { version: number; scope: string; labelStatus: string; sources: PilotSource[]; tasks: PilotTask[] };
export type PilotAnswer = { answer: string; citations: { url: string; quote: string }[] };
export type PilotReview = { correct: boolean; supported: boolean; referenceCorrect: boolean; notes: string; kind: 'human' | 'synthetic'; reviewedAt: string };
export type PilotProtocol = {
  version: 1; hypothesis: string; model: 'gpt-luna'; lane: 'run_now'; maxTokens: number;
  repetitions: 2; developmentQuestions: number; evaluationQuestions: number; measuredRuns: number;
  latencyTargetPercent: 20; spendCapUsd: 10; sourceCollection: string; scope: string;
};
export type PilotReadiness = { ready: boolean; reason: string };
export type PilotMetrics = {
  completed: number; failed: number; reviewed: number; supportedCorrect: number;
  medianMs: number | null; costUsd: number | null; searchCalls: number | null; modelCalls: number | null;
  inputTokens: number | null; outputTokens: number | null;
};
export type PilotRow = {
  taskId: string; question: string; baseline: PilotMetrics; candidate: PilotMetrics;
  regression: boolean; sources: { title: string; url: string }[];
};
export type PilotPublicRun = {
  id: string; mode: PilotMode; status: PilotStatus; createdAt: string; updatedAt: string;
  completedRuns: number; plannedRuns: number; reviewCount: number; reviewsNeeded: number;
  protocol: PilotProtocol; decision: 'accepted' | 'rejected' | 'inconclusive'; reason: string;
  baseline: PilotMetrics; candidate: PilotMetrics; rows: PilotRow[];
  medianPairedReductionPercent: number | null; regressions: number; error: string | null;
  reviewComplete: boolean; exportReady: boolean; sourceHash: string; seed: string;
};
export type PilotReviewCard = {
  id: string; taskId: string; question: string; answer: PilotAnswer;
  source: PilotSource; expectedAnswer: string; requiredFacts: string[]; review: PilotReview | null;
};
export type PilotOverview = {
  protocol: PilotProtocol; readiness: PilotReadiness;
  runs: PilotPublicRun[]; labelStatus: string;
};
