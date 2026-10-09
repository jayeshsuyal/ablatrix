import { createHash } from 'node:crypto';
import { z } from 'zod';
import { answerSchema } from './feedback-provider.ts';

export type RevisionSource = { id: string; label: string; text: string; sha256: string; originalQuestion: string | null; origin: 'pinned' | 'workspace' | 'reviewer_added' | 'agent_retrieved'; reference?: string; addedBy?: string; retrievedAt?: string };
export type RevisionContext = { question: string; product: { id: string; title: string }; sources: RevisionSource[]; clarifications: { text: string; reviewer: string }[] };
export type ReviewContextProvenance = 'workspace_source_snapshot' | 'saved_retrieval_only';
export type ReviewAnswerSnapshot = {
  id: string;
  runId: string;
  context: RevisionContext;
  answer: z.infer<typeof answerSchema>;
  model: string;
  promptVersion: string;
  createdAt: string;
  contextProvenance: ReviewContextProvenance;
  generationSourceIds: string[];
};

/** A human source check must bind to the source's identity and question, not just repeated answer text. */
export function workspaceReviewSourceHash(source: Pick<RevisionSource, 'id' | 'label' | 'text' | 'originalQuestion' | 'reference'>): string {
  return createHash('sha256').update(JSON.stringify([source.id, source.label, source.text, source.originalQuestion, source.reference ?? ''])).digest('hex');
}

const snapshotSchema = z.object({
  id: z.string().regex(/^workspace-[a-f0-9-]{36}$/),
  runId: z.uuid(),
  context: z.object({
    question: z.string().min(1).max(500),
    product: z.object({ id: z.string().min(1).max(160), title: z.string().min(1).max(200) }).strict(),
    sources: z.array(z.object({
      id: z.string().min(1).max(160), label: z.string().min(1).max(200), text: z.string().min(1).max(3000),
      sha256: z.string().regex(/^[a-f0-9]{64}$/), originalQuestion: z.string().max(500).nullable(),
      origin: z.literal('workspace'), reference: z.string().max(500).optional()
    }).strict()).min(1).max(256),
    clarifications: z.array(z.object({ text: z.string(), reviewer: z.string() }).strict()).length(0)
  }).strict(),
  answer: answerSchema,
  model: z.string().min(1).max(160),
  promptVersion: z.string().min(1).max(160),
  createdAt: z.iso.datetime(),
  contextProvenance: z.enum(['workspace_source_snapshot', 'saved_retrieval_only']),
  generationSourceIds: z.array(z.string().min(1).max(160)).min(1).max(256)
}).strict();

/** Validate and copy the trusted workspace handoff before it enters the review ledger. */
export function parseReviewAnswerSnapshot(raw: ReviewAnswerSnapshot): ReviewAnswerSnapshot {
  const snapshot = snapshotSchema.parse(raw);
  const sources = snapshot.context.sources;
  if (snapshot.id !== `workspace-${snapshot.runId}` || new Set(sources.map(source => source.id)).size !== sources.length ||
    new Set(snapshot.generationSourceIds).size !== snapshot.generationSourceIds.length ||
    snapshot.generationSourceIds.some(id => !sources.some(source => source.id === id)) ||
    sources.some(source => workspaceReviewSourceHash(source) !== source.sha256) ||
    (snapshot.answer.status === 'answered' && !snapshot.answer.citations.length) ||
    snapshot.answer.citations.some(citation => !snapshot.generationSourceIds.includes(citation.passageId) || !sources.some(source => source.id === citation.passageId && source.text.includes(citation.quote)))) {
    throw new Error('Revision: workspace answer snapshot has inconsistent identity or source provenance.');
  }
  return snapshot;
}
