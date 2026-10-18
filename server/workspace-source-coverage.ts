import { textHash, validateProductCorpus } from './product-corpus.ts';
import { workspaceCompleteSourceContext, workspaceSourceChunks, type WorkspaceSourceProduct } from './workspace-retrieval-context.ts';
import type { ProductCorpus, RetrievalResult, RetrievedPassage } from './loop-types.ts';

export const WORKSPACE_SOURCE_COVERAGE_CONTRACT = 'workspace-source-coverage-v1' as const;
type Source = WorkspaceSourceProduct['sources'][number];
export type WorkspaceSourceCoverage = {
  contract: typeof WORKSPACE_SOURCE_COVERAGE_CONTRACT;
  passages: RetrievedPassage[];
  additions: { sourceId: string; reasons: string[] }[];
};

const dimensionKeys = new Set(['dimensions', 'itemdimensions', 'productdimensions', 'size', 'itemsize', 'productsize', 'length', 'width', 'height', 'depth', 'diameter', 'thickness']);
const packageDimensionKeys = new Set(['packagedimensions', 'itempackagedimensions', 'shippingdimensions', 'boxdimensions', 'packagelength', 'packagewidth', 'packageheight', 'packagedepth']);
const identityKeys = new Set(['model', 'modelname', 'modelnumber', 'itemmodelnumber', 'partnumber', 'manufacturerpartnumber', 'mpn', 'sku']);
const facetKeys = {
  color: new Set(['color', 'colour', 'colors', 'colours', 'colorname', 'colourname']),
  material: new Set(['material', 'materialtype', 'composition', 'primarymaterial', 'fabric']),
  capacity: new Set(['capacity', 'volume', 'liquidcapacity', 'storagecapacity', 'maximumcapacity', 'weightcapacity']),
};
const listingLabel = /^(?:attribute|attributes|specification|specifications|specs|product specifications|listing|product details)$/i;
const proseListingLabel = /^(?:bullet|description|listing|product description|product details)$/i;
const itemScope = String.raw`\b(?:item|product)\b`;
const packageScope = String.raw`\b(?:packag(?:e|es|ing)|box|carton|shipping)\b`;
const scopeJoin = String.raw`(?:\s*(?:&|/)\s*|\s+(?:and|or|versus|vs\.?|as\s+well\s+as|compared\s+(?:with|to))\s+)(?:(?:also|of|for|the|its|this|that)\s+)*`;
const coordinatedDimensionScopes = new RegExp(`${itemScope}${scopeJoin}${packageScope}|${packageScope}${scopeJoin}${itemScope}`);
// Case folding is permitted; punctuation is part of a literal identifier.
// ZX-100 and ZX100 must never be presented as an established exact match.
const canonicalIdentifier = (value: string) => value.toUpperCase();
function identifiers(text: string): Set<string> {
  return new Set((text.match(/[a-z0-9]+(?:[-_.][a-z0-9]+)*/gi) ?? [])
    .map(canonicalIdentifier)
    // Measurements, years and arbitrary shared words are not model anchors.
    .filter(token => {
      const shape = token.replace(/[-_.]/g, '');
      return /^(?:[A-Z]{1,12}\d[A-Z0-9]*|\d{5,}[A-Z][A-Z0-9]*)$/.test(shape) &&
        !/^\d+(?:MM|CM|IN|FT|ML|L|GAL|OZ|LB|KG|V|W|A|GB|TB)$/.test(shape);
    }));
}

function relevance(source: Source, question: string): { priority: number; reasons: string[] } | undefined {
  // Normalize possessive scope nouns only for intent matching. Identifier
  // comparisons and every returned question/source byte use the original text.
  const q = question.toLowerCase().replace(/\b(item|product|package|packaging|box|carton)['’]s\b/g, '$1'), requested = identifiers(question);
  const dimensionIntent = /\b(?:dimensions?|measurements?|length|width|height|depth|diameter|size|thickness|tall|wide|long|deep)\b|\bhow\s+(?:big|large|small)\b/.test(q);
  const packageIntent = /\b(?:packag(?:e|es|ing)|box|carton|shipping)\b/.test(q);
  const itemDimensionIntent = !packageIntent || /\b(?:item|product)\s+(?:dimensions?|measurements?|size|length|width|height|depth|diameter|thickness)\b/.test(q) || coordinatedDimensionScopes.test(q);
  const identityIntent = requested.size > 0 || /\b(?:fit(?:s|ting)?|compatib\w*|replac(?:e|es|ing|ement)|models?|part\s*(?:numbers?|no\.?|#)|skus?)\b/.test(q);
  const intents = {
    color: /\bcolou?rs?\b|\b(?:white|black|red|blue|green|yellow|brown|grey|gray|beige|silver|gold|pink|purple|orange)\b/.test(q),
    material: /\b(?:materials?|composition|made\s+(?:of|from|out\s+of))\b|\b(?:is|are)\b.*\b(?:wood(?:en)?|plastic|metal|steel|glass|cotton|leather)\b/.test(q),
    capacity: /\b(?:capacity|volume|hold|holds|holding|liters?|litres?|gallons?|cups?|quarts?|ounces?)\b/.test(q),
  };
  const reasons: string[] = [];
  let priority = 3;
  const field = source.text.match(/^\s*(?:\{\s*)?(?:"([a-z][a-z0-9_ -]{0,60})"|'([a-z][a-z0-9_ -]{0,60})'|([a-z][a-z0-9_ -]{0,60}))\s*:\s*/i);
  const key = field?.slice(1).find(value => value !== undefined)?.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key && listingLabel.test(source.label.trim())) {
    if (dimensionIntent && ((packageIntent && packageDimensionKeys.has(key)) || (itemDimensionIntent && dimensionKeys.has(key)))) {
      reasons.push(`structured_field:${key}`, packageDimensionKeys.has(key) ? 'question_intent:package_dimensions' : 'question_intent:item_dimensions');
      priority = 0;
    }
    for (const facet of ['color', 'material', 'capacity'] as const) {
      if (intents[facet] && facetKeys[facet].has(key)) {
        reasons.push(`structured_field:${key}`, `question_intent:${facet}`);
        priority = 0;
      }
    }
    if (identityIntent && identityKeys.has(key)) {
      reasons.push(`structured_field:${key}`, 'product_identity_context');
      const exact = [...identifiers(source.text)].filter(token => requested.has(token));
      if (exact.length) { reasons.push(...exact.map(token => `exact_identifier_context:${token}`)); priority = Math.min(priority, 1); }
      else priority = Math.min(priority, 2);
    }
  }
  if (identityIntent && proseListingLabel.test(source.label.trim())) {
    const sourceIds = identifiers(source.text), words = new Set((source.text.match(/[a-z0-9]+(?:[-_.][a-z0-9]+)*/gi) ?? []).map(canonicalIdentifier));
    const exact = [...sourceIds].filter(token => requested.has(token));
    const families = [...requested].flatMap(token => token.match(/^([A-Z]{3,12})[-_.]?(?=\d)/)?.[1] ?? []).filter(prefix => words.has(prefix));
    if (exact.length) { reasons.push(...exact.map(token => `exact_identifier_context:${token}`)); priority = Math.min(priority, 1); }
    // A literal bare family token such as VGSU is contextual, never an alias,
    // a near-model match, or a conclusion that the requested model fits.
    if (families.length) reasons.push(...families.map(prefix => `identifier_family_context_only:${prefix}`));
  }
  return reasons.length ? { priority, reasons: [...new Set(reasons)].sort() } : undefined;
}

/** Add bounded, literal listing context to the unchanged hybrid selection.
 * No report is evicted, no polarity is inferred and no compatibility is decided.
 * The fixed vocabulary is deliberately narrow; this is not semantic reranking. */
export function workspaceSourceCoverageContext(product: WorkspaceSourceProduct, corpus: ProductCorpus, retrieval: RetrievalResult, question: string): WorkspaceSourceCoverage {
  if (!question.trim() || !product.id || new Set(product.sources.map(source => source.id)).size !== product.sources.length ||
      product.sources.some(source => !source.id || !source.label || !source.text.trim() || source.text.includes('\u0000'))) throw new Error('Workspace source coverage requires unique literal source parents and a question.');
  validateProductCorpus(corpus);
  if (!corpus.products.some(item => item.id === product.id) || retrieval.corpusVersion !== corpus.version) throw new Error('Workspace source coverage does not match its product corpus.');
  const passages = workspaceCompleteSourceContext(product, corpus, retrieval);
  const selected = new Set(passages.map(passage => passage.id)), additions: WorkspaceSourceCoverage['additions'] = [];
  const candidates = product.sources.flatMap(source => {
    if (selected.has(source.id) || source.text.length > 1500) return [];
    const match = relevance(source, question);
    return match ? [{ source, ...match }] : [];
  }).sort((a, b) => a.priority - b.priority || (a.source.id < b.source.id ? -1 : a.source.id > b.source.id ? 1 : 0));
  for (const { source, reasons } of candidates) {
    if (additions.length === 3 || passages.length === 8) break;
    if (passages.reduce((sum, passage) => sum + passage.text.length, 0) + source.text.length > 12_000) continue;
    const chunks = workspaceSourceChunks(source.text);
    for (const [index, text] of chunks.entries()) {
      const id = chunks.length === 1 ? source.id : `${source.id}-${index + 1}`;
      const indexed = corpus.passages.find(passage => passage.id === id);
      if (!indexed || indexed.productId !== product.id || indexed.source !== source.label || indexed.text !== text || indexed.sha256 !== textHash(text) || indexed.originalQuestion !== source.originalQuestion) throw new Error('Workspace supplemental source does not match its frozen indexing corpus.');
    }
    passages.push({ id: source.id, productId: product.id, source: source.label, text: source.text, reference: source.label,
      sha256: textHash(source.text), ...(source.originalQuestion !== undefined ? { originalQuestion: source.originalQuestion } : {}), lexicalRank: null, semanticRank: null, score: 0 });
    selected.add(source.id); additions.push({ sourceId: source.id, reasons });
  }
  return { contract: WORKSPACE_SOURCE_COVERAGE_CONTRACT, passages, additions };
}
