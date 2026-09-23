import { z } from 'zod';
import type { ResearchConfig } from './config.ts';

export const researchInput = z.object({
  entity: z.string().trim().min(2).max(120),
  question: z.string().trim().min(8).max(500),
  taskId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional()
}).strict();

export const source = z.object({
  title: z.string().min(1),
  url: z.url().refine(value => value.startsWith('https://'), 'HTTPS source required'),
  snippet: z.string().default('')
});

export const researchOutput = z.object({
  answer: z.string().min(1),
  facts: z.array(z.object({ claim: z.string().min(1), sourceUrls: z.array(z.url()).min(1) })).min(1),
  sources: z.array(source).min(1)
}).refine(value => {
  const urls = new Set(value.sources.map(item => item.url));
  return value.facts.every(fact => fact.sourceUrls.every(url => urls.has(url)));
}, 'Every fact citation must match a returned source');

export type ResearchInput = z.infer<typeof researchInput>;
export type ResearchOutput = z.infer<typeof researchOutput>;
export type RunMode = 'fixture' | 'live';
export type RunRecord = {
  id: string; taskId: string; candidateId: string; mode: RunMode;
  provider: string; model: string | null; status: 'running' | 'completed' | 'failed';
  input: ResearchInput; output: ResearchOutput | null; error: string | null;
  startedAt: string; finishedAt: string | null; durationMs: number | null;
  costUsd: number | null; costStatus: 'unknown' | 'priced' | 'fixture';
  usage: Record<string, unknown> | null;
  settings?: ResearchConfig;
};
export type ExperimentRecord = {
  id: string; candidateId: string; mode: RunMode;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  taskIds: string[]; runIds: string[]; maxAttempts: number; maxDurationMs: number;
  maxSpendUsd: number; fixtureDelayMs: number; createdAt: string; updatedAt: string;
  cancelRequested: boolean; error: string | null;
  steps: { at: string; message: string }[];
  settings?: ResearchConfig;
};
export type OptimizationRecord = {
  id: string; mode: RunMode; status: 'running' | 'completed' | 'failed';
  baselineExperimentId: string; candidateExperimentId: string; candidateId: string;
  settings: ResearchConfig; createdAt: string; updatedAt: string;
  investigation: string; proposal: string; decision: 'pending' | 'accepted' | 'no-improvement' | 'rejected';
  challenge: string; error: string | null;
  proposalChargeId?: string;
  proposalMetadata?: { model: string | null; requestId: string | null; inputTokens: number | null; outputTokens: number | null };
  holdoutRunIds?: string[];
  holdoutBaselineRunIds?: string[];
  holdoutStatus?: 'running' | 'completed' | 'failed';
};
