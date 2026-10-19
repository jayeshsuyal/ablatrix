import { textHash, validateProductCorpus } from './product-corpus.ts';
import { workspaceCompleteSourceContext, workspaceSourceChunks, type WorkspaceSourceProduct } from './workspace-retrieval-context.ts';
import type { ProductCorpus, RetrievalResult, RetrievedPassage } from './loop-types.ts';

export const WORKSPACE_SOURCE_COVERAGE_V2_CONTRACT = 'workspace-source-coverage-v2' as const;
type Source = WorkspaceSourceProduct['sources'][number];
export type WorkspaceSourceCoverageV2 = {
  contract: typeof WORKSPACE_SOURCE_COVERAGE_V2_CONTRACT;
  passages: RetrievedPassage[];
  additions: { sourceId: string; reasons: string[] }[];
};

const structuredLabel = /^(?:attributes?|specifications?|specs|product specifications|listing|product details)$/i;
const listingLabel = /^(?:bullets?|description|listing|product description|product details)$/i;
const reportLabel = /^(?:reviews?|cqa)$/i;
const dimensionKeys = new Set(['dimensions', 'measurements', 'size', 'length', 'width', 'height', 'depth', 'diameter', 'thickness']);
const identityKeys = new Set(['model', 'modelname', 'modelnumber', 'itemmodelnumber', 'partnumber', 'manufacturerpartnumber', 'mpn', 'sku']);
const facets = {
  color: new Set(['color', 'colour', 'colors', 'colours', 'colorname', 'colourname']),
  material: new Set(['material', 'materialtype', 'composition', 'primarymaterial', 'fabric']),
  capacity: new Set(['capacity', 'volume', 'liquidcapacity', 'storagecapacity', 'maximumcapacity', 'weightcapacity', 'maximumweight', 'maximumload', 'loadcapacity', 'loadlimit']),
};
const compact = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
const packageKey = (key: string) => /^(?:package|packaging|itempackage|shipping|box|carton)(?:dimensions?|size|length|width|height|depth)?$/.test(key);
const dimensionKey = (key: string) => dimensionKeys.has(key) || /^(?:item|product|overall|band|case|screen|seat|frame)(?:dimensions|measurements|size|length|width|height|depth|diameter|thickness)$/.test(key) || packageKey(key) && /(?:dimensions?|size|length|width|height|depth)$/.test(key);
const packageScope = /\b(?:packages?|packaging|box|carton|shipping)\b/;
const itemScopeToken = String.raw`\b(?:item|product)\b`;
const packageScopeToken = String.raw`\b(?:packag(?:e|es|ing)|box|carton|shipping)\b`;
const scopeJoin = String.raw`(?:\s*(?:&|/)\s*|\s+(?:and|or|versus|vs\.?|as\s+well\s+as|compared\s+(?:with|to))\s+)(?:(?:also|of|for|the|its|this|that)\s+)*`;
const coordinatedScopes = String.raw`(?:${itemScopeToken}${scopeJoin}${packageScopeToken}|${packageScopeToken}${scopeJoin}${itemScopeToken})`;
const dimensionNoun = String.raw`\b(?:dimensions?|measurements?|size|length|width|height|depth|diameter|thickness)\b`;
const coordinatedDimensionRequest = new RegExp(`${coordinatedScopes}\\s+${dimensionNoun}|${dimensionNoun}\\s+(?:of|for)\\s+(?:(?:the|its|this|that)\\s+)*${coordinatedScopes}|\\bhow\\s+(?:big|large|small|wide|tall|long|deep)\\s+(?:is|are)\\s+(?:(?:the|its|this|that)\\s+)*${coordinatedScopes}`);
const physicalRequest = /\b(?:dimensions?|measurements?|length|width|height|depth|diameter|size|thickness|tall|wide|deep)\b|\bhow\s+(?:big|large|small)\b/;
const durationRequest = /\b(?:duration|runtime)\b|\bhow\s+(?:many|much)\s+(?:seconds?|minutes?|hours?)\b|\bhow\s+long\b.{0,100}\b(?:take|takes|last|lasts|scan|scanning|charge|charging|print|printing|cook|cooking|heat|heating|run|running)\b|\b(?:scan(?:ning)?|charg(?:e|ing)|print(?:ing)?|cook(?:ing)?|heat(?:ing)?|battery)\b.{0,60}\b(?:time|duration|speed|life)\b|\btime\s+(?:does|to|for)\b/;
const timeQuantity = /\b(?:\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|half(?:\s+an?)?|quarter(?:\s+of\s+an?)?)\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/i;
const capacityQuantity = /\b\d+(?:\.\d+)?\s*(?:g|grams?|kg|kilograms?|lb|lbs|pounds?|oz|ounces?|ml|milliliters?|millilitres?|l|liters?|litres?|gallons?|quarts?|cups?|gb|tb)\b/i;
const capacityAssertion = /\b(?:supports?|holds?|holding|capacity|volume|load(?:s|ing)?|maximum\s+(?:weight|volume)|weight\s+limit|can\s+(?:carry|contain)|carries|contains?)\b/i;
const operationPatterns = [
  ['scan', /\bscan(?:s|ned|ning|ner)?\b/], ['charge', /\bcharg(?:e|es|ed|ing|er)\b/],
  ['print', /\bprint(?:s|ed|ing|er)?\b/], ['cook', /\bcook(?:s|ed|ing|er)?\b/],
  ['heat', /\bheat(?:s|ed|ing|er)?\b/], ['brew', /\bbrew(?:s|ed|ing|er)?\b/],
  ['transfer', /\btransfer(?:s|red|ring)?\b/], ['download', /\bdownload(?:s|ed|ing)?\b/],
  ['boot', /\bboot(?:s|ed|ing)?\b/], ['dry', /\b(?:dry|dries|dried|drying|dryer)\b/],
  ['battery', /\b(?:battery|batteries|runtime)\b/],
] as const;

/** Read key paths from bounded JSON/JSON-like attributes, without evaluating or
 * repairing them. A nested package scope is inherited by every child field.
 * Only keys are interpreted; every delivered value remains in its literal body. */
function fieldPaths(text: string): string[][] {
  const tokens = text.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[a-z_][a-z0-9_ -]{0,60}(?=\s*:)|[{}\[\]:,;]/gi) ?? [];
  const stack: { path: string[]; closing: string }[] = [{ path: [], closing: '' }], fields: string[][] = [];
  let pending: string[] | undefined;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (tokens[index + 1] === ':' && !/^[{}\[\]:,;]$/.test(token)) {
      pending = [...stack.at(-1)!.path, compact(token.replace(/^["']|["']$/g, ''))];
      fields.push(pending);
      index++;
    } else if (token === '{' || token === '[') {
      stack.push({ path: pending ?? stack.at(-1)!.path, closing: token === '{' ? '}' : ']' }); pending = undefined;
    } else if (token === '}' || token === ']') {
      if (stack.length < 2 || stack.at(-1)!.closing !== token) return [];
      stack.pop(); pending = undefined;
    } else if (token !== ':') pending = undefined;
  }
  return stack.length === 1 ? fields : [];
}

/** A deliberately bounded request heuristic. Literal model punctuation and
 * decimal points are retained; this does not resolve arbitrary discourse. */
function requestedClauses(question: string): string[] {
  const text = question.toLowerCase().replace(/\b(item|product|package|packaging|box|carton)['’]s\b/g, '$1').replace(/\bvs\.(?=\s|$)/g, 'vs');
  const parts = text.split(/([;?!]+|\.(?=\s|$))/), clauses: { text: string; requested: boolean }[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const body = parts[index]!.trim(); if (!body) continue;
    const marker = body.match(/\b(?:what|how|which|where|when|why|tell|show|need|want|compare|comparing|give|list|provide|find|confirm|describe|check)\b/);
    // Preserve a nominal request preceding a trailing polite request marker.
    const trailingPolite = /,\s*(?:can|could|would)\s+you\s+(?:tell|show|give|list|provide|confirm)\b/.test(body);
    clauses.push({ text: marker && !trailingPolite ? body.slice(marker.index) : body, requested: Boolean(marker) || Boolean(parts[index + 1]?.includes('?')) });
  }
  const explicit = clauses.filter(clause => clause.requested);
  return (explicit.length ? explicit : clauses).map(clause => clause.text);
}

// No separator stripping or fuzzy aliases: ZX-100, ZX.100 and ZX100 differ.
function identifiers(text: string): Set<string> {
  return new Set((text.match(/[a-z0-9]+(?:[-_.][a-z0-9]+)*/gi) ?? []).map(token => token.toUpperCase()).filter(token => {
    const shape = token.replace(/[-_.]/g, '');
    return /^(?:[A-Z]{1,12}\d[A-Z0-9]*|\d{5,}[A-Z][A-Z0-9]*)$/.test(shape) && !/^\d+(?:MM|CM|IN|FT|ML|L|GAL|OZ|LB|KG|V|W|A|GB|TB)$/.test(shape);
  }));
}

function relevance(source: Source, question: string): { priority: number; specificity: number; reasons: string[] } | undefined {
  const clauses = requestedClauses(question), q = clauses.join(' '), requested = identifiers(question);
  const dimensions = clauses.filter(clause => physicalRequest.test(clause) || /\bhow\s+long\b/.test(clause) && !durationRequest.test(clause));
  const packageIntent = dimensions.some(clause => packageScope.test(clause));
  const itemIntent = dimensions.some(clause => !packageScope.test(clause) || /\b(?:item|product)\s+(?:dimensions?|measurements?|size|length|width|height|depth|diameter|thickness)\b/.test(clause) || coordinatedDimensionRequest.test(clause));
  const intents = {
    color: /\bcolou?rs?\b|\b(?:white|black|red|blue|green|yellow|brown|grey|gray|beige|silver|gold|pink|purple|orange)\b/.test(q),
    material: /\b(?:materials?|composition|made\s+(?:of|from|out\s+of))\b|\b(?:is|are)\b.*\b(?:wood(?:en)?|plastic|metal|steel|glass|cotton|leather)\b/.test(q),
    capacity: /\b(?:capacity|volume|hold|holds|holding|supports?|carry|carrying|load|weight\s+limit|liters?|litres?|gallons?|cups?|quarts?|ounces?)\b/.test(q),
  };
  const identityIntent = identifiers(q).size > 0 || /\b(?:fit(?:s|ting)?|compatib\w*|replac(?:e|es|ing|ement)|models?|part\s*(?:numbers?|no\.?|#)|skus?)\b/.test(q);
  let priority = 5, specificity = 0;
  const reasons: string[] = [];
  if (structuredLabel.test(source.label.trim())) {
    const paths = fieldPaths(source.text);
    for (const path of paths) {
      const key = path.at(-1)!, isPackage = path.some(packageKey);
      if (dimensions.length && dimensionKey(key) && (isPackage ? packageIntent : itemIntent)) {
        reasons.push(`structured_path:${path.join('.')}`, `question_intent:${isPackage ? 'package' : 'item'}_dimensions`); priority = 0;
        if (path.some(part => new RegExp(`\\b${part}\\b`).test(q))) specificity++;
      }
      for (const facet of ['color', 'material', 'capacity'] as const) if (intents[facet] && facets[facet].has(key)) {
        reasons.push(`structured_path:${path.join('.')}`, `question_intent:${facet}`); priority = 0;
      }
      if (identityIntent && identityKeys.has(key)) {
        reasons.push(`structured_path:${path.join('.')}`, 'product_identity_context'); priority = Math.min(priority, 3);
      }
    }
  }
  const isListing = listingLabel.test(source.label.trim()), isReport = reportLabel.test(source.label.trim());
  if (intents.capacity && isListing && capacityQuantity.test(source.text) && capacityAssertion.test(source.text)) {
    reasons.push('literal_numeric_capacity_context', 'question_intent:capacity'); priority = Math.min(priority, 1);
  }
  if (clauses.some(clause => durationRequest.test(clause)) && (isListing || isReport)) {
    const context = `${source.originalQuestion ?? ''} ${source.text}`.toLowerCase();
    const sharedOperations = operationPatterns.filter(([, pattern]) => pattern.test(q) && pattern.test(context)).map(([name]) => name);
    if (sharedOperations.length && timeQuantity.test(source.text)) {
      reasons.push('literal_duration_report_context', ...sharedOperations.map(operation => `shared_operation:${operation}`)); priority = Math.min(priority, 1);
      specificity += sharedOperations.length;
    }
  }
  if (identityIntent && (isListing || structuredLabel.test(source.label.trim()))) {
    const exact = [...identifiers(source.text)].filter(token => requested.has(token));
    if (exact.length) { reasons.push(...exact.map(token => `exact_identifier_context:${token}`)); priority = Math.min(priority, 2); specificity += exact.length; }
    if (isListing) {
      const words = new Set((source.text.match(/[a-z0-9]+(?:[-_.][a-z0-9]+)*/gi) ?? []).map(token => token.toUpperCase()));
      const families = [...requested].flatMap(token => token.match(/^([A-Z]{3,12})[-_.]?(?=\d)/)?.[1] ?? []).filter(prefix => words.has(prefix));
      if (families.length) { reasons.push(...families.map(prefix => `identifier_family_context_only:${prefix}`)); priority = Math.min(priority, 4); }
    }
  }
  if (identityIntent && /^cqa$/i.test(source.label.trim()) && source.originalQuestion) {
    const exact = [...identifiers(source.originalQuestion)].filter(token => requested.has(token));
    if (exact.length) {
      reasons.push('question_scoped_report_context_only', ...exact.map(token => `exact_original_question_identifier:${token}`)); priority = Math.min(priority, 1); specificity += exact.length;
    }
  }
  return reasons.length ? { priority, specificity, reasons: [...new Set(reasons)].sort() } : undefined;
}

/** Opt-in source delivery, not a compatibility or correctness decision. Every
 * complete hybrid-selected parent is retained, followed by at most three
 * bounded literal sources. Reports keep their source label, conditions and
 * original question; timing reports are not treated as equivalent workflows.
 * The vocabulary is fixed and may miss useful sources or include redundant ones. */
export function workspaceSourceCoverageV2Context(product: WorkspaceSourceProduct, corpus: ProductCorpus, retrieval: RetrievalResult, question: string): WorkspaceSourceCoverageV2 {
  if (!question.trim() || !product.id || new Set(product.sources.map(source => source.id)).size !== product.sources.length || product.sources.some(source => !source.id || !source.label || !source.text.trim() || source.text.includes('\u0000'))) throw new Error('Workspace source coverage v2 requires unique literal source parents and a question.');
  validateProductCorpus(corpus);
  if (!corpus.products.some(item => item.id === product.id) || retrieval.corpusVersion !== corpus.version) throw new Error('Workspace source coverage v2 does not match its product corpus.');
  const passages = workspaceCompleteSourceContext(product, corpus, retrieval);
  const verifyParent = (source: Source) => {
    const chunks = workspaceSourceChunks(source.text);
    for (const [index, text] of chunks.entries()) {
      const id = chunks.length === 1 ? source.id : `${source.id}-${index + 1}`, indexed = corpus.passages.find(passage => passage.id === id);
      if (!indexed || indexed.productId !== product.id || indexed.source !== source.label || indexed.text !== text || indexed.sha256 !== textHash(text) || indexed.originalQuestion !== source.originalQuestion) throw new Error('Workspace supplemental v2 source does not match its frozen indexing corpus.');
    }
  };
  for (const passage of passages) verifyParent(product.sources.find(source => source.id === passage.id)!);
  const selected = new Set(passages.map(passage => passage.id)), additions: WorkspaceSourceCoverageV2['additions'] = [];
  const candidates = product.sources.flatMap(source => {
    if (selected.has(source.id) || source.text.length > 1500) return [];
    const match = relevance(source, question); return match ? [{ source, ...match }] : [];
  }).sort((a, b) => a.priority - b.priority || b.specificity - a.specificity || (a.source.id < b.source.id ? -1 : a.source.id > b.source.id ? 1 : 0));
  for (const { source, reasons } of candidates) {
    if (additions.length === 3 || passages.length === 8) break;
    if (passages.reduce((sum, passage) => sum + passage.text.length, 0) + source.text.length > 12_000) continue;
    verifyParent(source);
    passages.push({ id: source.id, productId: product.id, source: source.label, text: source.text, reference: source.label, sha256: textHash(source.text), ...(source.originalQuestion !== undefined ? { originalQuestion: source.originalQuestion } : {}), lexicalRank: null, semanticRank: null, score: 0 });
    selected.add(source.id); additions.push({ sourceId: source.id, reasons });
  }
  return { contract: WORKSPACE_SOURCE_COVERAGE_V2_CONTRACT, passages, additions };
}
