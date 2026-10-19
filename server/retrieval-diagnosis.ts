import assert from 'node:assert/strict';
import { textHash } from './product-corpus.ts';
import type { RetrievalStageTrace } from './product-retrieval.ts';
import { workspaceCompleteSourceContext, type WorkspaceSourceProduct } from './workspace-retrieval-context.ts';
import type { ProductCorpus, RetrievalResult, RetrievedPassage } from './loop-types.ts';
export type DesignatedFact = { fact: string; qualification: string; quote: string; sourceIds: string[] };
export function diagnoseUsefulSources(product: WorkspaceSourceProduct, corpus: ProductCorpus, retrieval: RetrievalResult, trace: RetrievalStageTrace, facts: DesignatedFact[], finalContext: RetrievedPassage[], supplemental: { sourceId: string; reasons: string[] }[] = []) {
  const restored = workspaceCompleteSourceContext(product, corpus, retrieval), seen = new Set<string>();
  const parentRestoration = retrieval.passages.map(chunk => {
    const parent = product.sources.find(s => s.id === chunk.id || chunk.id.startsWith(`${s.id}-`) && /^\d+$/.test(chunk.id.slice(s.id.length + 1)))!;
    const duplicate = seen.has(parent.id); seen.add(parent.id);
    return { chunkId: chunk.id, parentId: parent.id, bodySha256: textHash(parent.text), originalQuestion: parent.originalQuestion ?? null, restored: !duplicate, reason: duplicate ? 'parent_already_restored' : 'literal_parent_restored' };
  });
  const designated = facts.map(fact => ({ ...fact, sources: fact.sourceIds.map(id => {
    const parent = product.sources.find(s => s.id === id); assert.ok(parent && parent.text.includes(fact.quote), 'Designations must identify literal sources.');
    const chunkIds = corpus.passages.filter(p => p.productId === product.id && (p.id === id || p.id.startsWith(`${id}-`) && /^\d+$/.test(p.id.slice(id.length + 1)))).map(p => p.id);
    const membership = (rows: { id: string; rank: number }[]) => rows.filter(r => chunkIds.includes(r.id));
    return { sourceId: id, bodySha256: textHash(parent.text), originalQuestion: parent.originalQuestion ?? null, chunkIds,
      bm25Raw: membership(trace.bm25Raw), bm25Candidates: membership(trace.bm25Candidates), denseRaw: membership(trace.denseRaw), denseCandidates: membership(trace.denseCandidates), fusion: membership(trace.fusion),
      chunkSelection: trace.selection.filter(r => chunkIds.includes(r.id)), parentRestored: restored.some(p => p.id === id), supplemental: supplemental.find(s => s.sourceId === id) ?? null,
      literalFactDelivered: finalContext.some(p => p.id === id && p.text.includes(fact.quote) && (p.originalQuestion ?? null) === (parent.originalQuestion ?? null)) };
  }) }));
  return { definitions: trace.definitions, parentRestoration, supplemental, designated };
}
