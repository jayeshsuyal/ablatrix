import { textHash } from './product-corpus.ts';
import type { ProductCorpus, RetrievalResult, RetrievedPassage } from './loop-types.ts';

export type WorkspaceSourceProduct = { id: string; sources: { id: string; label: string; text: string; originalQuestion?: string }[] };
/** Historical 300-byte indexing chunks, retained for repeatable before/after tests. */
export function workspaceSourceChunks(text: string): string[] {
  const chars = [...text], chunks: string[] = []; let start = 0;
  while (start < chars.length) {
    let end = start, bytes = 0;
    while (end < chars.length && bytes + Buffer.byteLength(chars[end]!) <= 300) bytes += Buffer.byteLength(chars[end++]!);
    if (end < chars.length) { const boundary = chars.lastIndexOf(' ', end - 1); if (boundary > start && boundary - start > 40) end = boundary + 1; }
    const chunk = chars.slice(start, end).join('').trim(); if (chunk) chunks.push(chunk); start = end;
  }
  return chunks;
}
/** Restore only the bounded original bodies selected by the existing retriever.
 * Ranking/chunk identities remain in retrieval; qualifiers are not split away
 * from their claim when a complete source is supplied to generation. */
export function workspaceCompleteSourceContext(product: WorkspaceSourceProduct, corpus: ProductCorpus, retrieval: RetrievalResult): RetrievedPassage[] {
  if (new Set(retrieval.passages.map(passage => passage.id)).size !== retrieval.passages.length) throw new Error('Workspace retrieval contains duplicate passage IDs.');
  const selected: RetrievedPassage[] = [], seen = new Set<string>();
  for (const passage of retrieval.passages) {
    const indexed = corpus.passages.find(item => item.id === passage.id);
    if (!indexed || passage.productId !== product.id || passage.sha256 !== textHash(passage.text) || indexed.text !== passage.text || indexed.originalQuestion !== passage.originalQuestion) throw new Error('Workspace retrieval does not match its frozen indexing corpus.');
    const parent = product.sources.find(source => source.id === passage.id || passage.id.startsWith(`${source.id}-`) && /^\d+$/.test(passage.id.slice(source.id.length + 1)));
    if (!parent) throw new Error('Workspace retrieval has no original source body.');
    if (seen.has(parent.id)) continue; seen.add(parent.id);
    selected.push({ ...passage, id: parent.id, source: parent.label, text: parent.text, sha256: textHash(parent.text), reference: parent.label, ...(parent.originalQuestion ? { originalQuestion: parent.originalQuestion } : {}) });
  }
  if (selected.length > 8 || selected.some(item => item.text.length > 1500) || selected.reduce((sum, item) => sum + item.text.length, 0) > 12_000) throw new Error('Workspace complete-source context exceeds its fixed product input bounds.');
  return selected;
}
