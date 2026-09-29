import { createHash } from 'node:crypto';
import type { RevisionContext, RevisionSource } from './answer-revisions.ts';

export type InvestigationIssue = 'auto' | 'wrong_model' | 'missing_evidence' | 'conflicting_sources' | 'missed_source' | 'answer_quality';
export type InvestigationTrace = {
  protocol: 'revision-investigation-v1'; planner: 'rules'; issue: Exclude<InvestigationIssue, 'auto'>;
  status: 'running' | 'ready_to_revise' | 'needs_information' | 'blocked'; query: string;
  requestedIdentifiers: string[];
  steps: { kind: string; status: 'completed' | 'skipped' | 'failed'; detail: string; url?: string; sourceIds?: string[] }[];
  selectedSourceIds: string[]; addedSourceIds: string[]; stopReason?: string; clarificationQuestion?: string;
  newEvidence: boolean; externalCalls: number;
};
export interface RevisionInvestigationSearch {
  readiness(): { ready: boolean; reason: string };
  allowed(url: string): boolean;
  search(query: string, runId: string): Promise<{ results: { title: string; url: string; snippet: string }[] }>;
  read(url: string, runId: string): Promise<{ url: string; title?: string; text: string }>;
}
type Input = { context: RevisionContext; critique: string; issue: InvestigationIssue; runId: string; originalCitedSourceIds?: string[]; originalSourceIds?: string[] };
const unique = <T>(items: T[]) => [...new Set(items)];
const normalizedContent = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
// Identical answers to different customer questions retain different scope.
// For ordinary documents, a different URL does not create new evidence.
const alreadyCovered = (prior: RevisionSource, candidate: RevisionSource) => normalizedContent(prior.text).includes(normalizedContent(candidate.text)) && normalizedContent(prior.originalQuestion ?? '') === normalizedContent(candidate.originalQuestion ?? '');
const stopWords = new Set('about after again also answer available because before better both could does evidence first from have into just listing make missing model more need number only original other part please product question really same should source sources still supplied than that their them then there these they this those using very want what when where which will with would your'.split(' '));
const tokens = (text: string) => unique(text.toLowerCase().match(/[a-z0-9][a-z0-9.-]{2,}/g) ?? []).filter(word => !stopWords.has(word));
// Customer identifiers come only from their question and clarification. Digits
// from a source's historical question must never become the current model.
const identifiers = (text: string) => unique((text.match(/\b[a-z0-9]+(?:-[a-z0-9]+|\.[0-9]+)*\b/gi) ?? []).map(value => value.toUpperCase())).filter(value => value.length >= 5 && /\d/.test(value));
const mentions = (text: string, identifier: string) => identifiers(text).includes(identifier);
const compatibilityWords = /\b(fit|fits|fitting|compatible|compatibility|interchangeable|interchangeability|replace|replaces|replacement|replacing|cross.reference)\b/i;
function resolvedIssue(input: Input): Exclude<InvestigationIssue, 'auto'> {
  if (input.issue !== 'auto') return input.issue;
  if (/\b(wrong|different|another|unrelated)\b.{0,45}\b(model|part|refrigerator|product)\b|\bmodel\b.{0,30}\b(mismatch|wrong)\b/i.test(input.critique)) return 'wrong_model';
  if (/\b(conflict|conflicting|contradict|contradictory|disagree)\b/i.test(input.critique)) return 'conflicting_sources';
  if (/\b(missed|overlooked|ignored)\b.{0,45}\b(source|fact|detail|manual|information|answer)\b/i.test(input.critique)) return 'missed_source';
  if (/\b(missing|unsupported|unproven|unknown|verify|verification|cannot confirm|not establish|no support)\b/i.test(input.critique)) return 'missing_evidence';
  if (compatibilityWords.test(input.context.question) && /\b(same answer|same as before|paraphrase|paraphrasing|no new|still cannot|still can't|not answer|doesn't answer)\b/i.test(input.critique)) return 'missing_evidence';
  return 'answer_quality';
}
function labeledIdentifiers(text: string, labels: string) {
  const pattern = new RegExp(`\\b(?:${labels})(?:\\s+model)?(?:\\s+(?:number|no\\.?))?\\s*(?:is\\s+)?[:#]?\\s*([a-z0-9]+(?:-[a-z0-9]+|\\.[0-9]+)*)\\b`, 'gi');
  return unique([...text.matchAll(pattern)].flatMap(match => identifiers(match[1])));
}
function wrongQuestionScope(source: RevisionSource, requested: string[], compatibility: boolean, requestText: string, productTitle: string) {
  if (!source.originalQuestion || !compatibility) return false;
  const scoped = identifiers(source.originalQuestion);
  if (!scoped.length) return false;
  if (!requested.length) return true;
  const partLabels = 'part|product|sku';
  const modelLabels = 'model|refrigerator|fridge|washer|dryer|dishwasher|freezer|printer';
  const explicitTargets = labeledIdentifiers(requestText, modelLabels);
  const requestedParts = labeledIdentifiers(requestText, partLabels);
  const targets = explicitTargets.length ? explicitTargets : requested.filter(id => !requestedParts.includes(id));
  const scopedModels = labeledIdentifiers(source.originalQuestion, modelLabels);
  // An explicit different device model must not be admitted by an overlapping
  // part number or an identifier that happens to occur in the product title.
  if (scopedModels.some(id => !targets.includes(id))) return true;
  const matchingTarget = targets.some(id => scoped.includes(id));
  const extraParts = matchingTarget ? labeledIdentifiers(source.originalQuestion, partLabels) : [];
  const knownProductIds = identifiers(productTitle);
  return scoped.some(id => !requested.includes(id) && !extraParts.includes(id) && !knownProductIds.includes(id));
}
function excerpt(text: string, requested: string[], queryTerms: string[]) {
  const upper = text.toUpperCase();
  const hits = requested.map(id => upper.indexOf(id)).filter(index => index >= 0);
  const first = hits.length ? Math.min(...hits) : queryTerms.map(term => text.toLowerCase().indexOf(term)).find(index => index >= 0) ?? 0;
  const start = Math.max(0, first - 300);
  return text.slice(start, start + 2000).trim();
}

/** Bounded source discovery. Admission identifies candidates, never factual support. */
export async function investigateRevision(input: Input, search?: RevisionInvestigationSearch, onProgress?: (trace: InvestigationTrace) => void): Promise<{ context: RevisionContext; investigation: InvestigationTrace }> {
  const context = structuredClone(input.context);
  const requestText = [context.question, ...context.clarifications.map(item => item.text)].join(' ');
  const requested = identifiers(requestText);
  const compatibility = compatibilityWords.test(`${context.question} ${input.critique}`);
  const queryTerms = tokens(`${context.question} ${input.critique}`).slice(0, 24);
  // Do not send reviewer names or whole clarifications to the search provider.
  const query = unique([context.product.title.slice(0, 120), ...requested.slice(0, 6), ...tokens(context.question).slice(0, 12)]).join(' ').slice(0, 500);
  const trace: InvestigationTrace = { protocol: 'revision-investigation-v1', planner: 'rules', issue: resolvedIssue(input), status: 'running', query, requestedIdentifiers: requested, steps: [], selectedSourceIds: [], addedSourceIds: [], newEvidence: false, externalCalls: 0 };
  const progress = () => onProgress?.(structuredClone(trace));
  const step = (entry: InvestigationTrace['steps'][number]) => { trace.steps.push(entry); progress(); };
  const stop = (status: InvestigationTrace['status'], reason: string, clarification?: string) => {
    trace.status = status; trace.stopReason = reason;
    if (clarification) trace.clarificationQuestion = clarification;
    progress(); return { context, investigation: trace };
  };
  const clarification = () => compatibility
    ? requested.length ? `What is the full device model number, or can you supply documentation confirming the requested compatibility (${requested.join(', ')})?` : 'What is the full device model number and the part you want to replace?'
    : 'Can you provide the specific missing fact or a source that addresses it?';
  step({ kind: 'diagnosis', status: 'completed', detail: `Rule-based routing selected ${trace.issue.replaceAll('_', ' ')}. This is a search plan, not a correctness judgment.` });
  const ranked = context.sources.filter(source => {
    if (!wrongQuestionScope(source, requested, compatibility, requestText, context.product.title)) return true;
    step({ kind: 'scope_check', status: 'skipped', detail: 'This customer answer refers to a different or unspecified target model in its original question.', sourceIds: [source.id] });
    return false;
  }).map(source => ({ source, score: queryTerms.filter(term => tokens(source.text).includes(term)).length + requested.filter(id => mentions(source.text, id)).length * 8 }))
    .sort((a, b) => b.score - a.score);
  // Preserve all original sources in the audit snapshot; the provider receives
  // only this explicit selection. Source questions are context, not proof.
  trace.selectedSourceIds = ranked.slice(0, 12).map(item => item.source.id);
  step({ kind: 'local_search', status: 'completed', detail: `Ranked ${ranked.length} saved sources using the current question and critique; selected ${trace.selectedSourceIds.length}. Reusing a saved source adds no new evidence.`, sourceIds: trace.selectedSourceIds });
  const cited = new Set(input.originalCitedSourceIds ?? []);
  const applicable = (source: RevisionSource) => {
    if (wrongQuestionScope(source, requested, compatibility, requestText, context.product.title)) return false;
    if (compatibility) return requested.length > 0 && requested.every(id => mentions(source.text, id)) && compatibilityWords.test(source.text);
    return queryTerms.filter(term => tokens(source.text).includes(term)).length >= 2;
  };
  const candidates = ranked.filter(item => applicable(item.source));
  const uncited = candidates.filter(item => !cited.has(item.source.id));
  // Without a parent snapshot, novelty is unknown: conservatively treat the
  // current packet as already supplied. Callers pass pinned IDs for originals.
  const originalIds = new Set(input.originalSourceIds ?? context.sources.map(source => source.id));
  const originalSources = context.sources.filter(source => originalIds.has(source.id));
  const newlySupplied = candidates.filter(({ source }) => source.origin !== 'pinned' && !originalIds.has(source.id) && !originalSources.some(original => alreadyCovered(original, source)));
  const selectCandidates = (items: typeof candidates) => {
    trace.selectedSourceIds = unique([...items.map(item => item.source.id), ...trace.selectedSourceIds]).slice(0, 12);
    return items.filter(item => trace.selectedSourceIds.includes(item.source.id)).map(item => item.source.id);
  };
  if (trace.issue === 'wrong_model' || trace.issue === 'answer_quality' || trace.issue === 'conflicting_sources') {
    if (trace.selectedSourceIds.length) return stop('ready_to_revise', trace.issue === 'wrong_model' ? 'Saved sources can support removal or qualification of the disputed model claim. This does not establish compatibility.' : 'The revision can address the critique using saved source candidates; factual support still needs review.');
  } else if (trace.issue === 'missed_source' && uncited.length) {
    const sourceIds = selectCandidates(uncited);
    step({ kind: 'candidate_found', status: 'completed', detail: 'Saved source candidates address the search terms and were not cited by the rejected answer. Identifier or word matches do not prove the claim.', sourceIds });
    return stop('ready_to_revise', 'An uncited saved source candidate is available for the revision to assess.');
  } else if (trace.issue === 'missing_evidence' && newlySupplied.length) {
    const sourceIds = selectCandidates(newlySupplied);
    trace.newEvidence = true;
    step({ kind: 'candidate_found', status: 'completed', detail: 'Applicable source candidates were added after the rejected answer. Identifier or word matches do not prove the claim.', sourceIds });
    return stop('ready_to_revise', 'Newly supplied source candidates are available for the revision to assess.');
  }
  if (!search) {
    step({ kind: 'web_search', status: 'skipped', detail: 'External source discovery is not configured; only saved sources were examined.' });
    return stop('needs_information', 'Saved sources did not yield a new applicable candidate for the missing claim.', clarification());
  }
  const readiness = search.readiness();
  if (!readiness.ready) {
    step({ kind: 'web_search', status: 'skipped', detail: readiness.reason });
    return stop('needs_information', 'External discovery is unavailable and the missing claim remains unresolved.', clarification());
  }
  let hits: { title: string; url: string; snippet: string }[];
  try {
    trace.externalCalls++; progress();
    hits = (await search.search(query, `${input.runId}:search:1`)).results;
    step({ kind: 'web_search', status: 'completed', detail: `Received ${hits.length} search leads. Search snippets are not citation sources.` });
  } catch (error) {
    step({ kind: 'web_search', status: 'failed', detail: 'Source discovery did not return a verified result; no automatic retry was made.' });
    if (error && typeof error === 'object' && 'code' in error && ['unverified_outcome', 'reconciliation_required'].includes(String(error.code))) throw error;
    return stop('blocked', 'Source discovery failed before a usable result was available.');
  }
  const seen = new Set<string>();
  let reads = 0;
  for (const hit of hits.slice(0, 20)) {
    let url: string;
    try { const parsed = new URL(hit.url); parsed.hash = ''; url = parsed.href; } catch { step({ kind: 'source_read', status: 'skipped', detail: 'Search returned an invalid URL.' }); continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    if (!search.allowed(url)) { step({ kind: 'source_read', status: 'skipped', detail: 'Search result is outside the configured source domains.', url }); continue; }
    if (reads >= 2) break;
    reads++;
    try {
      trace.externalCalls++; progress();
      const page = await search.read(url, `${input.runId}:read:${reads}`);
      if (!search.allowed(page.url)) { step({ kind: 'source_read', status: 'skipped', detail: 'Returned page URL is outside the configured source domains.', url: page.url }); continue; }
      const text = excerpt(page.text, requested, queryTerms);
      if (text.length < 30) { step({ kind: 'source_read', status: 'skipped', detail: 'The page did not provide a usable source excerpt.', url: page.url }); continue; }
      const digest = createHash('sha256').update(JSON.stringify([page.url, text])).digest('hex');
      const source: RevisionSource = { id: `${context.sources[0]?.id.split(':')[0] ?? context.product.id}:${digest}`, label: (page.title || hit.title || new URL(page.url).hostname).slice(0, 80), text, sha256: digest, originalQuestion: null, origin: 'agent_retrieved', reference: page.url, retrievedAt: new Date().toISOString() };
      if (!applicable(source)) { step({ kind: 'scope_check', status: 'skipped', detail: 'The read excerpt did not contain the requested identifiers or enough question terms to admit it as a candidate.', url: page.url }); continue; }
      if (context.sources.some(item => alreadyCovered(item, source))) { step({ kind: 'source_read', status: 'skipped', detail: 'This source content is already saved; a different URL or formatting does not add evidence.', url: page.url }); continue; }
      if (JSON.stringify({ ...context, sources: [...context.sources, source] }).length > 30_000) { step({ kind: 'source_read', status: 'skipped', detail: 'Adding this excerpt would exceed the bounded source context.', url: page.url }); continue; }
      context.sources.push(source); trace.selectedSourceIds.push(source.id); trace.addedSourceIds.push(source.id); trace.newEvidence = true;
      step({ kind: 'source_read', status: 'completed', detail: 'Saved an exact excerpt and its URL as a source candidate. Matching terms and source domain do not prove the claim.', url: page.url, sourceIds: [source.id] });
    } catch (error) {
      step({ kind: 'source_read', status: 'failed', detail: 'Reading this source did not return a verified result; no automatic retry was made.', url });
      if (error && typeof error === 'object' && 'code' in error && ['unverified_outcome', 'reconciliation_required'].includes(String(error.code))) throw error;
      return stop('blocked', 'A source read failed before its outcome could be used.');
    }
  }
  return trace.newEvidence ? stop('ready_to_revise', 'New source candidates were saved for the revision to assess; claim support requires review.') : stop('needs_information', 'The bounded search found no new applicable source candidate for the missing claim.', clarification());
}
