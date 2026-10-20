import assert from 'node:assert/strict';
import { textHash } from './product-corpus.ts';
import type { ProductCorpus, RetrievalResult, RetrievedPassage } from './loop-types.ts';
import type { RetrievalStageTrace } from './product-retrieval.ts';
import type { WorkspaceSourceProduct } from './workspace-retrieval-context.ts';
import type { PairScorer } from './semantic-reranker.ts';
import { semanticSupplementContextV5, SEMANTIC_SUPPLEMENT_V5 } from './semantic-supplement-v5.ts';

const aliases = Object.freeze(Object.fromEntries(Object.entries({
  hour: ['hour', 'hours', 'hr', 'hrs'], minute: ['minute', 'minutes', 'min', 'mins'], second: ['second', 'seconds', 'sec', 'secs'],
  day: ['day', 'days'], week: ['week', 'weeks'], month: ['month', 'months'], year: ['year', 'years'],
  inch: ['inch', 'inches', 'in.'], foot: ['foot', 'feet', 'ft'], centimeter: ['centimeter', 'centimeters', 'centimetre', 'centimetres', 'cm'],
  millimeter: ['millimeter', 'millimeters', 'millimetre', 'millimetres', 'mm'], meter: ['meter', 'meters', 'metre', 'metres'],
  ounce: ['ounce', 'ounces', 'oz'], pound: ['pound', 'pounds', 'lb', 'lbs'], gram: ['gram', 'grams'], kilogram: ['kilogram', 'kilograms', 'kg'],
  liter: ['liter', 'liters', 'litre', 'litres'], milliliter: ['milliliter', 'milliliters', 'millilitre', 'millilitres', 'ml'],
  gallon: ['gallon', 'gallons', 'gal'], quart: ['quart', 'quarts', 'qt'], pint: ['pint', 'pints'], cup: ['cup', 'cups'],
  volt: ['volt', 'volts'], watt: ['watt', 'watts'], ampere: ['ampere', 'amperes', 'amp', 'amps'],
}).map(([unit, values]) => [unit, Object.freeze(values)]))) as Readonly<Record<string, readonly string[]>>;
const word = '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)';
const quantity = `(?:\\d+(?:\\.\\d+)?(?:\\s+\\d+/\\d+)?|\\d+/\\d+|\\.\\d+|${word}(?:[\\s-]+(?:${word}|and))*)`;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unitPatterns = Object.entries(aliases).map(([unit, values]) => [unit,
  new RegExp(`(?<![A-Za-z0-9_/-])${quantity}(?:\\s*(?:-|–|—|to)\\s*${quantity})?\\s*(?:${[...values].sort((a, b) => b.length - a.length || a.localeCompare(b)).map(escape).join('|')})(?![A-Za-z0-9_])`, 'i'),
] as const);

/** Presence of a literal quantity/unit only; neither its value nor its meaning is inferred. */
export function quantifiedCanonicalUnitsV6(text: string): string[] {
  const normalized = text.normalize('NFKC');
  return unitPatterns.filter(([, pattern]) => pattern.test(normalized)).map(([unit]) => unit).sort();
}
export const SEMANTIC_SUPPLEMENT_V6 = Object.freeze({
  contract: 'workspace-semantic-supplement-v6-quantified-peer-dev', inherits: SEMANTIC_SUPPLEMENT_V5.contract,
  maxAdditions: 3, maxParents: 8, maxParentBodyCharacters: 1500, maxBodyCharacters: 12000,
  strictAbsoluteFloor: -5, peerAbsoluteFloor: -7, relativeLogitBand: 8, minimumDistinctAnchors: 2, maxPromotedPeers: 1,
  mmrPenalty: 3, sameScopeNearDuplicateJaccard: .85, peerSourceLabels: Object.freeze(['review', 'cqa']),
  quantityParser: 'literal-body-quantities-v1: digits/decimals/fractions/ranges and English number words; canonical unit aliases only; no unit conversion, query parsing or original-question-as-proof',
  canonicalUnitAliases: aliases,
  anchorScope: 'Two distinct v5-selected strict-band literal bodies share the same canonical unit and exact originalQuestion-or-null. Peer must preserve that same scope.',
  selection: 'Reserve the two strict anchors and one eligible lower-band peer; then fill in original v5 order. Group/peer ties use MMR utility, raw score, actual reranker rank and stable identity. Otherwise return exact v5 passages.',
  limitation: 'Quantified-unit recurrence is a retrieval signal, not corroboration, compatibility, truth, identical workflow, or a population-average estimate. Same-unit age, warranty and runtime can still differ.',
});
type Source = WorkspaceSourceProduct['sources'][number];
const scope = (source: Pick<Source, 'originalQuestion'>) => source.originalQuestion ?? null;
const bodyScope = (source: Pick<Source, 'text' | 'originalQuestion'>) => JSON.stringify([source.text, scope(source)]);
const terms = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]+(?:[-.][a-z0-9]+)*/g) ?? []);
const similarity = (a: Set<string>, b: Set<string>) => [...a].filter(term => b.has(term)).length / Math.max(1, new Set([...a, ...b]).size);
const nearDuplicate = (a: Pick<Source, 'text' | 'originalQuestion'>, b: Pick<Source, 'text' | 'originalQuestion'>) =>
  scope(a) === scope(b) && similarity(terms(a.text), terms(b.text)) > SEMANTIC_SUPPLEMENT_V6.sameScopeNearDuplicateJaccard;

/** A separately versioned exposed-development selector. V5 and its scoring inputs are unchanged. */
export async function semanticSupplementContextV6(
  product: WorkspaceSourceProduct & { title: string }, corpus: ProductCorpus, retrieval: RetrievalResult,
  trace: RetrievalStageTrace, question: string, scorer: PairScorer,
) {
  // V5 performs genuine literal parent/chunk/scope validation and calls the unchanged v4 scorer once.
  const inherited = await semanticSupplementContextV5(product, corpus, retrieval, trace, question, scorer);
  const proposal = inherited.proposal, baseline = inherited.passages.slice(0, inherited.baselinePreservation.baselineParentIds.length);
  const ranked = proposal.ranking.map(rank => {
    const source = product.sources.find(source => source.id === rank.sourceId)!;
    const input = proposal.actualInputs.documents.find(input => input.sourceId === source.id)!;
    assert.ok(input && input.score === rank.score && input.sourceBodySha256 === textHash(source.text) && input.originalQuestion === scope(source));
    return { ...rank, source, units: quantifiedCanonicalUnitsV6(source.text) };
  });
  const config = SEMANTIC_SUPPLEMENT_V6, best = ranked[0]?.score ?? 0;
  const strictFloor = Math.max(config.strictAbsoluteFloor, best - config.relativeLogitBand), peerFloor = Math.max(config.peerAbsoluteFloor, best - config.relativeLogitBand);
  const groups = new Map<string, { unit: string; originalQuestion: string | null; anchors: typeof ranked }>();
  for (const passage of inherited.passages) {
    const row = ranked.find(row => row.sourceId === passage.id);
    if (!row || row.score < strictFloor) continue;
    for (const unit of row.units) {
      const key = JSON.stringify([unit, scope(row.source)]), group = groups.get(key) ?? { unit, originalQuestion: scope(row.source), anchors: [] };
      if (!group.anchors.some(anchor => bodyScope(anchor.source) === bodyScope(row.source))) group.anchors.push(row);
      groups.set(key, group);
    }
  }
  const eligibleGroups = [...groups.values()].filter(group => group.anchors.length >= config.minimumDistinctAnchors).map(group => ({ ...group, anchors: group.anchors.slice(0, config.minimumDistinctAnchors) }));
  const candidates = eligibleGroups.flatMap(group => ranked.filter(row => row.score < strictFloor && row.score >= peerFloor
    && row.units.includes(group.unit) && scope(row.source) === group.originalQuestion
    && SEMANTIC_SUPPLEMENT_V6.peerSourceLabels.some(label => label === row.source.label)
    && !inherited.passages.some(passage => bodyScope(passage) === bodyScope(row.source)))
    .map(peer => ({ group, peer, utility: peer.score - config.mmrPenalty * Math.max(0, ...group.anchors.map(anchor => similarity(terms(peer.source.text), terms(anchor.source.text)))) })))
    .sort((a, b) => b.utility - a.utility || b.peer.score - a.peer.score || a.peer.rank - b.peer.rank
      || a.peer.sourceId.localeCompare(b.peer.sourceId) || a.group.unit.localeCompare(b.group.unit)
      || JSON.stringify(a.group.originalQuestion).localeCompare(JSON.stringify(b.group.originalQuestion)));
  const attempts: { peerId: string; unit: string; originalQuestion: string | null; utility: number; reason: string }[] = [];
  let applied: typeof candidates[number] | undefined, selected: RetrievedPassage[] | undefined;
  for (const candidate of candidates) {
    const passages = [...baseline], seenIds = new Set(passages.map(p => p.id)), seenBodies = new Set(passages.map(bodyScope));
    let failure: string | undefined;
    for (const row of [...candidate.group.anchors, candidate.peer]) {
      if (seenIds.has(row.sourceId)) continue;
      const source = row.source;
      const reason = seenBodies.has(bodyScope(source)) ? 'same_body_and_scope_already_retained'
        : passages.some(p => nearDuplicate(p, source)) ? 'same_scope_near_duplicate'
        : passages.length - baseline.length >= config.maxAdditions ? 'three_supplement_limit' : passages.length >= config.maxParents ? 'eight_parent_limit'
        : source.text.length > config.maxParentBodyCharacters ? 'parent_length_bound'
        : passages.reduce((n, p) => n + p.text.length, 0) + source.text.length > config.maxBodyCharacters ? 'body_budget' : null;
      if (reason) { failure = reason; break; }
      passages.push({ id: source.id, productId: product.id, source: source.label, reference: source.label, text: source.text, sha256: textHash(source.text),
        ...(source.originalQuestion !== undefined ? { originalQuestion: source.originalQuestion } : {}), lexicalRank: null, semanticRank: null, score: 0 });
      seenIds.add(source.id); seenBodies.add(bodyScope(source));
    }
    attempts.push({ peerId: candidate.peer.sourceId, unit: candidate.group.unit, originalQuestion: candidate.group.originalQuestion, utility: candidate.utility, reason: failure ?? 'selected_quantified_peer_group' });
    if (failure) continue;
    for (const passage of inherited.passages.slice(baseline.length)) {
      if (passages.length - baseline.length >= config.maxAdditions || passages.length >= config.maxParents) break;
      if (seenIds.has(passage.id) || seenBodies.has(bodyScope(passage)) || passages.some(p => nearDuplicate(p, passage))
        || passages.reduce((n, p) => n + p.text.length, 0) + passage.text.length > config.maxBodyCharacters) continue;
      passages.push(passage); seenIds.add(passage.id); seenBodies.add(bodyScope(passage));
    }
    applied = candidate; selected = passages; break;
  }
  const passages = selected ?? inherited.passages;
  const anchorIds = applied?.group.anchors.map(anchor => anchor.sourceId) ?? [];
  const additions = selected ? passages.slice(baseline.length).map(passage => {
    const rank = ranked.find(row => row.sourceId === passage.id)!;
    return { sourceId: passage.id, sourceBodySha256: passage.sha256, originalQuestion: scope(passage),
      reasons: [passage.id === applied!.peer.sourceId ? 'conditional_quantified_peer' : anchorIds.includes(passage.id) ? 'strict_quantified_anchor' : 'unchanged_v5_fill'],
      rerankerRank: rank.rank, rerankerLogit: rank.score };
  }) : inherited.additions;
  assert.deepEqual(passages.slice(0, baseline.length), baseline);
  assert.ok(additions.length <= config.maxAdditions && passages.length <= config.maxParents && passages.every(p => p.text.length <= config.maxParentBodyCharacters) && passages.reduce((n, p) => n + p.text.length, 0) <= config.maxBodyCharacters);
  const observation = (row: typeof ranked[number]) => ({ sourceId: row.sourceId, sourceBodySha256: textHash(row.source.text), originalQuestion: scope(row.source), rerankerRank: row.rank, rerankerLogit: row.score });
  return { ...inherited, contract: SEMANTIC_SUPPLEMENT_V6.contract, passages, additions,
    decisions: selected ? additions.map(addition => ({ sourceId: addition.sourceId, reason: addition.reasons[0]! })) : inherited.decisions,
    bounds: { parents: passages.length, additions: additions.length, bodyCharacters: passages.reduce((n, p) => n + p.text.length, 0) },
    peerSelection: { strictFloor, peerFloor, originalV5PassageIds: inherited.passages.map(p => p.id),
      anchorGroups: eligibleGroups.map(group => ({ unit: group.unit, originalQuestion: group.originalQuestion, anchors: group.anchors.map(observation) })),
      attempts, applied: applied ? { unit: applied.group.unit, originalQuestion: applied.group.originalQuestion, anchors: applied.group.anchors.map(observation), peer: observation(applied.peer), utility: applied.utility } : null,
      replacedV5SourceIds: inherited.passages.filter(p => !passages.some(s => s.id === p.id)).map(p => p.id),
      fallbackExactlyV5: !selected, limitation: SEMANTIC_SUPPLEMENT_V6.limitation },
    qualityClaimEligible: false, exposure: 'Quantified-peer selector tuned on exposed development; no fresh validation or answer-quality gain is established.' };
}
