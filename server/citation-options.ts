import { createHash } from 'node:crypto';

export const SOURCE_ID_CITATION_INTERFACE = 'source_ids_v1' as const;
export const SOURCE_ID_LIMITS = Object.freeze({ sources: 12, sourceCharacters: 3000, totalSourceCharacters: 12_000 });
export type CitationEvidence = { id: string; source: string; text: string; originalQuestion?: string; origin?: string; reference?: string };
export type SourceCitationScope = { productId: string; question: string; evidence: readonly CitationEvidence[] };
export type SourceCitationOption = { id: string; passageId: string; quote: string };

/** Separate legacy CQA context without turning the customer's question into proof. */
export function sourceCitationEvidence(evidence: readonly CitationEvidence[]): CitationEvidence[] {
  return evidence.map(source => {
    if (source.source !== 'cqa') return { ...source };
    const markers = [...source.text.matchAll(/(?:^|\s+)Question:\s*/gi)];
    if (!markers.length) return { ...source };
    if (markers.length !== 1) throw new Error('Source-ID citations require unambiguous customer-question context.');
    const marker = markers[0], text = source.text.slice(0, marker.index).trim(), originalQuestion = source.text.slice(marker.index! + marker[0].length).trim();
    if (!text || !originalQuestion || (source.originalQuestion !== undefined && source.originalQuestion !== originalQuestion)) throw new Error('Source-ID citations have conflicting customer-question context.');
    return { ...source, text, originalQuestion };
  });
}

/** One whole literal body per source. Never split decimal values or structured attributes. */
export function sourceCitationOptions(scope: SourceCitationScope): SourceCitationOption[] {
  const evidence = sourceCitationEvidence(scope.evidence);
  if (!scope.productId.trim() || !scope.question.trim() || !evidence.length || evidence.length > SOURCE_ID_LIMITS.sources) throw new Error('Source-ID citation scope or source count is invalid.');
  const seen = new Set<string>();
  let characters = 0;
  for (const source of evidence) {
    if (!source.id.trim() || source.id.length > 160 || seen.has(source.id) || !source.source.trim() || !source.text.trim() || source.text.length > SOURCE_ID_LIMITS.sourceCharacters) throw new Error('Source-ID citations require unique source IDs and bounded nonempty bodies.');
    seen.add(source.id); characters += source.text.length;
  }
  if (characters > SOURCE_ID_LIMITS.totalSourceCharacters) throw new Error('Source-ID citations exceed the total source-body limit.');
  // Bind every option to the whole ordered request context, not just its ordinal.
  const context = JSON.stringify([SOURCE_ID_CITATION_INTERFACE, scope.productId, scope.question, evidence.map(source => [source.id, source.source, source.text, source.originalQuestion ?? null, source.origin ?? null, source.reference ?? null])]);
  return evidence.map((source, index) => ({ id: `src_${createHash('sha256').update(JSON.stringify([context, index])).digest('hex').slice(0, 24)}`, passageId: source.id, quote: source.text }));
}

/** Resolve only this request's offered IDs; matching is not a semantic support judgment. */
export function resolveSourceCitationIds(scope: SourceCitationScope, selectedIds: readonly string[]) {
  if (new Set(selectedIds).size !== selectedIds.length || selectedIds.length > 5) throw new Error('Source-ID citations must be distinct and bounded.');
  const offered = new Map(sourceCitationOptions(scope).map(option => [option.id, option]));
  return selectedIds.map(id => {
    const option = offered.get(id);
    if (!option) throw new Error('Source-ID citation was not offered in this request.');
    return { passageId: option.passageId, quote: option.quote };
  });
}

/** Remove selected bracketed IDs only; never leave internal or unselected IDs in prose. */
export function stripSourceIdMarkers(answer: string, selectedIds: readonly string[]): string {
  const selected = new Set(selectedIds);
  const cleaned = answer.replace(/\s*\[\s*src_[A-Za-z0-9_-]+(?:\s*,\s*src_[A-Za-z0-9_-]+)*\s*\]/g, marker => {
    const ids = marker.match(/src_[A-Za-z0-9_-]+/g) ?? [];
    if (ids.some(id => !selected.has(id))) throw new Error('Answer contains an unselected source ID.');
    return '';
  }).trim();
  if (!cleaned || /\bsrc_[A-Za-z0-9_-]+\b/.test(cleaned)) throw new Error('Answer contains an unresolved source ID or no readable text.');
  return cleaned;
}
