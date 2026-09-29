import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildInvestigationQuery, investigateRevision, type InvestigationTrace, type RevisionInvestigationSearch } from './revision-investigation.ts';
import type { RevisionContext, RevisionSource } from './answer-revisions.ts';

const source = (id: string, text: string, originalQuestion: string | null = null): RevisionSource => ({ id: `19:${id}`, label: 'Saved listing', text, sha256: id.padEnd(64, 'a'), originalQuestion, origin: 'pinned' });
const context = (): RevisionContext => ({ question: 'Does drawer 240337103 replace part 241543917?', product: { id: 'product-19', title: 'Frigidaire 240337103 crisper drawer' }, sources: [source('listing', 'This listing identifies the Frigidaire refrigerator crisper drawer as part 240337103.'), source('customer', 'Yes, this drawer matches your model.', 'Will this fit Kenmore refrigerator 25367889506?')], clarifications: [] });
function searchAdapter(reads: { url: string; title?: string; text: string }[], results?: { title: string; url: string; snippet: string }[]) {
  const calls: { kind: string; id: string; input: string }[] = [];
  const adapter: RevisionInvestigationSearch = {
    readiness: () => ({ ready: true, reason: 'Synthetic adapter' }),
    allowed: url => { try { return new URL(url).hostname === 'manufacturer.example'; } catch { return false; } },
    search: async (query, id) => { calls.push({ kind: 'search', id, input: query }); return { results: results ?? reads.map(page => ({ title: page.title ?? 'Parts manual', url: page.url, snippet: 'Discovery only.' })) }; },
    read: async (url, id) => { calls.push({ kind: 'read', id, input: url }); return reads.find(page => page.url === url)!; }
  };
  return { adapter, calls };
}

test('missing compatibility stops without inheriting the model in a historical customer question', async () => {
  const original = context(); const snapshot = structuredClone(original);
  const result = await investigateRevision({ context: original, critique: 'Compatibility is still missing.', issue: 'missing_evidence', runId: 'job' });
  assert.equal(result.investigation.status, 'needs_information');
  assert.deepEqual(result.investigation.requestedIdentifiers, ['240337103', '241543917']);
  assert.equal(result.investigation.selectedSourceIds.includes('19:customer'), false);
  assert.equal(result.investigation.query.includes('25367889506'), false);
  assert.match(result.investigation.clarificationQuestion!, /full device model/);
  assert.equal(result.investigation.newEvidence, false);
  assert.equal(result.investigation.externalCalls, 0);
  assert.deepEqual(original, snapshot);
  assert.deepEqual(result.context, snapshot);
});

test('identifier extraction separates ellipses and sentence text while keeping ordinary model separators', async () => {
  const input = context(); input.question = 'I need part number 241543917...what drawer replaces it?';
  const result = await investigateRevision({ context: input, critique: 'Compatibility is missing.', issue: 'missing_evidence', runId: 'job' });
  assert.deepEqual(result.investigation.requestedIdentifiers, ['241543917']);
  assert.match(result.investigation.query, /\b241543917\b/);
  assert.equal(result.investigation.query.match(/241543917/g)?.length, 1);
  assert.match(result.investigation.query, /replacement/);
  assert.doesNotMatch(result.investigation.query, /240337103|241543917\.\.\.what/);
  input.clarifications.push({ text: 'The full model is RF-12345 and the old Kenmore model is 253.67889506.', reviewer: 'Reviewer' });
  const clarified = await investigateRevision({ context: input, critique: 'Compatibility is missing.', issue: 'missing_evidence', runId: 'job2' });
  assert.deepEqual(clarified.investigation.requestedIdentifiers, ['241543917', 'RF-12345', '253.67889506']);
});

test('question-led queries cover the pinned 20-product batch without leaking listing-only identifiers', () => {
  const manifest = JSON.parse(readFileSync(new URL('../docs/evidence/paid-qa-batch-2026-09-28/manifest.json', import.meta.url), 'utf8')) as { cases: { title: string; question: string }[] };
  assert.equal(manifest.cases.length, 20);
  for (const item of manifest.cases) {
    const query = buildInvestigationQuery(item.question, item.title, []);
    assert.ok(query.length > 0 && query.length <= 240, item.question);
    assert.doesNotMatch(query, /\.\.\.|[\r\n]/, item.question);
    const titleIdentifiers = item.title.match(/\b\d{5,}\b/g) ?? [];
    for (const id of titleIdentifiers) assert.equal(query.split(' ').includes(id), false, `${item.question}: ${id}`);
  }
  assert.match(buildInvestigationQuery('How wide is it?', 'Drawer 240337103', []), /dimensions specifications/);
  assert.match(buildInvestigationQuery('What material is this made of?', 'Jacket X123456', []), /material.*composition/);
  assert.match(buildInvestigationQuery('How do I install it?', 'Fixture X123456', []), /installation instructions/);
});

test('search diagnostics distinguish no raw results from leads rejected by source checks', async () => {
  for (const returned of [0, 2]) {
    const adapter: RevisionInvestigationSearch = {
      readiness: () => ({ ready: true, reason: 'Fixture' }), allowed: () => true,
      search: async () => ({ results: [], diagnostics: { returned, inspected: returned, excluded: { off_domain: returned ? 1 : 0, invalid_shape: returned ? 1 : 0 } } }),
      read: async () => { throw new Error('No eligible read'); }
    };
    const result = await investigateRevision({ context: context(), critique: 'Compatibility missing.', issue: 'missing_evidence', runId: `empty-${returned}` }, adapter);
    assert.equal(result.investigation.status, 'needs_information');
    assert.equal(result.investigation.externalCalls, 1);
    assert.match(result.investigation.steps.find(step => step.kind === 'web_search')!.detail, new RegExp(`${returned} raw results`));
    assert.match(result.investigation.stopReason!, returned ? /none passed/ : /no search results/);
  }
});

test('matching device-model Q&A retains an extra labeled part or known product identifier', async () => {
  for (const originalQuestion of ['Does part PART123 fit model RF-12345?', 'Does part number PART123 fit refrigerator model number RF-12345?', 'Does PART999 fit RF-12345?']) {
    const input: RevisionContext = { question: 'Does this fit RF-12345?', product: { id: 'drawer', title: 'Drawer PART999' }, sources: [source('matched', 'This drawer fits RF-12345 according to this customer report.', originalQuestion)], clarifications: [] };
    const result = await investigateRevision({ context: input, critique: 'The answer missed this customer source.', issue: 'missed_source', runId: 'job' });
    assert.ok(result.investigation.selectedSourceIds.includes('19:matched'), originalQuestion);
    assert.equal(result.investigation.status, 'ready_to_revise', originalQuestion);
    assert.deepEqual(result.investigation.requestedIdentifiers, ['RF-12345']);
  }
});

test('an overlapping part never admits Q&A explicitly about a different device model', async () => {
  const input: RevisionContext = { question: 'Does part PART123 fit model RF-12345?', product: { id: 'drawer', title: 'Drawer PART123 for RF-98765' }, sources: [source('wrong-device', 'Part PART123 fits the requested refrigerator.', 'Does part PART123 fit model RF-98765?')], clarifications: [] };
  const result = await investigateRevision({ context: input, critique: 'The answer missed a customer source.', issue: 'missed_source', runId: 'job' });
  assert.equal(result.investigation.selectedSourceIds.includes('19:wrong-device'), false);
  assert.equal(result.investigation.status, 'needs_information');
  const withoutRequestedModel = await investigateRevision({ context: { ...input, question: 'Does part PART123 fit?' }, critique: 'The compatibility is missing.', issue: 'missing_evidence', runId: 'job2' });
  assert.equal(withoutRequestedModel.investigation.selectedSourceIds.includes('19:wrong-device'), false);
});

test('matching model overlap does not admit an additional ambiguous unmatched identifier', async () => {
  const input: RevisionContext = { question: 'Does this fit model RF-12345?', product: { id: 'drawer', title: 'Drawer PART123' }, sources: [source('ambiguous', 'This drawer fits RF-12345 according to this customer report.', 'Does it fit RF-12345 and RF-98765?')], clarifications: [] };
  const result = await investigateRevision({ context: input, critique: 'The answer missed this customer source.', issue: 'missed_source', runId: 'job' });
  assert.equal(result.investigation.selectedSourceIds.includes('19:ambiguous'), false);
  assert.equal(result.investigation.status, 'needs_information');
});

test('wrong-model correction can remove an unsupported claim using the retained listing', async () => {
  const { adapter, calls } = searchAdapter([]);
  const result = await investigateRevision({ context: context(), critique: 'The answer uses the wrong model from another customer.', issue: 'auto', runId: 'job' }, adapter);
  assert.equal(result.investigation.issue, 'wrong_model');
  assert.equal(result.investigation.status, 'ready_to_revise');
  assert.deepEqual(result.investigation.selectedSourceIds, ['19:listing']);
  assert.equal(result.investigation.newEvidence, false);
  assert.deepEqual(calls, []);
  assert.match(result.investigation.stopReason!, /does not establish compatibility/);
});

test('a repeated compatibility paraphrase triggers investigation instead of another style revision', async () => {
  const result = await investigateRevision({ context: context(), critique: 'This is the same answer as before.', issue: 'auto', runId: 'job' });
  assert.equal(result.investigation.issue, 'missing_evidence');
  assert.equal(result.investigation.status, 'needs_information');
  assert.equal(result.investigation.externalCalls, 0);
});

test('an uncited explicit cross-reference is a local candidate without a model clarification', async () => {
  const input = context();
  input.sources.push(source('crossref', 'Replacement drawer 240337103 replaces discontinued part 241543917. Check the installation instructions.'));
  const result = await investigateRevision({ context: input, critique: 'Missing replacement relationship.', issue: 'missed_source', runId: 'job', originalCitedSourceIds: ['19:listing'] });
  assert.equal(result.investigation.status, 'ready_to_revise');
  assert.equal(result.investigation.newEvidence, false);
  assert.equal(result.investigation.clarificationQuestion, undefined);
  assert.equal(result.investigation.externalCalls, 0);
  assert.match(result.investigation.steps.find(item => item.kind === 'candidate_found')!.detail, /do not prove/);
});

test('missing evidence cannot claim progress from an uncited source already supplied to the rejected answer', async () => {
  const input = context();
  input.sources.push({ ...source('added', 'Replacement drawer 240337103 replaces discontinued part 241543917.'), origin: 'reviewer_added' });
  const originalSourceIds = input.sources.map(item => item.id);
  const result = await investigateRevision({ context: input, critique: 'The compatibility support is still missing.', issue: 'missing_evidence', runId: 'job', originalSourceIds, originalCitedSourceIds: ['19:listing'] });
  assert.equal(result.investigation.status, 'needs_information');
  assert.equal(result.investigation.newEvidence, false);
  assert.equal(result.investigation.steps.some(item => item.kind === 'candidate_found'), false);
  const withoutSnapshot = await investigateRevision({ context: input, critique: 'The compatibility support is still missing.', issue: 'missing_evidence', runId: 'job2' });
  assert.equal(withoutSnapshot.investigation.status, 'needs_information');
});

test('missing evidence can assess an applicable source added since the rejected answer', async () => {
  const input = context(); const originalSourceIds = input.sources.map(item => item.id);
  const added = { ...source('added', 'Replacement drawer 240337103 replaces discontinued part 241543917.'), origin: 'reviewer_added' as const };
  input.sources.push(added);
  const result = await investigateRevision({ context: input, critique: 'The replacement relationship is missing.', issue: 'missing_evidence', runId: 'job', originalSourceIds });
  assert.equal(result.investigation.status, 'ready_to_revise');
  assert.equal(result.investigation.newEvidence, true);
  assert.ok(result.investigation.selectedSourceIds.includes(added.id));
  // The same addition is already part of the next answer's source packet.
  const repeated = await investigateRevision({ context: result.context, critique: 'The replacement relationship is still missing.', issue: 'missing_evidence', runId: 'next', originalSourceIds: result.context.sources.map(item => item.id) });
  assert.equal(repeated.investigation.status, 'needs_information');
  assert.equal(repeated.investigation.newEvidence, false);
});

test('a candidate justifying revision is selected even when raw ranking placed it below the twelve-source cap', async () => {
  const jargon = 'alpha beta gamma delta epsilon zeta theta iota kappa lambda mu nu omicron';
  for (const issue of ['missing_evidence', 'missed_source'] as const) {
    const input = context(); input.sources = Array.from({ length: 12 }, (_, index) => source(`distractor${index}`, `Drawer 240337103 ${jargon}. This unrelated text supplies no cross-reference.`));
    const originalSourceIds = input.sources.map(item => item.id);
    const candidate = { ...source('relevant', '240337103 replaces part 241543917.'), origin: 'reviewer_added' as const };
    input.sources.push(candidate);
    const result = await investigateRevision({ context: input, critique: `Missing compatibility ${jargon}`, issue, runId: issue, originalSourceIds });
    assert.equal(result.investigation.status, 'ready_to_revise');
    assert.equal(result.investigation.selectedSourceIds.length, 12);
    assert.ok(result.investigation.selectedSourceIds.includes(candidate.id));
    const initialSelection = result.investigation.steps.find(item => item.kind === 'local_search')!.sourceIds!;
    assert.equal(initialSelection.includes(candidate.id), false);
    assert.ok(result.investigation.steps.find(item => item.kind === 'candidate_found')!.sourceIds!.every(id => result.investigation.selectedSourceIds.includes(id)));
  }
});

test('search snippets alone cannot become support and repeated URLs are read once', async () => {
  const url = 'https://manufacturer.example/parts';
  const { adapter, calls } = searchAdapter([{ url, text: '' }], [{ title: 'Parts', url, snippet: '240337103 replaces 241543917' }, { title: 'Duplicate', url: `${url}#result`, snippet: '240337103 replaces 241543917' }]);
  const result = await investigateRevision({ context: context(), critique: 'Missing compatibility.', issue: 'missing_evidence', runId: 'job' }, adapter);
  assert.equal(result.investigation.status, 'needs_information');
  assert.equal(result.context.sources.length, 2);
  assert.deepEqual(calls.map(call => call.id), ['job:search:1', 'job:read:1']);
  assert.equal(result.investigation.newEvidence, false);
});

test('bounded discovery ignores off-domain leads, limits reads, and saves exact source text with provenance', async () => {
  const first = { url: 'https://manufacturer.example/incorrect', text: 'Drawer 240337103 replaces the old part 987654321 for a different refrigerator.' };
  const exact = 'Drawer 240337103 replaces part 241543917 according to this synthetic manufacturer catalog.';
  const second = { url: 'https://manufacturer.example/crossref', title: 'Synthetic cross-reference', text: `${'Introduction '.repeat(250)}${exact}` };
  const third = { url: 'https://manufacturer.example/unused', text: exact };
  const { adapter, calls } = searchAdapter([first, second, third], [{ title: 'Other', url: 'https://unapproved.example/parts', snippet: exact }, ...[first, second, third].map(page => ({ title: 'Manual', url: page.url, snippet: exact }))]);
  const progress: InvestigationTrace[] = [];
  const result = await investigateRevision({ context: context(), critique: 'Compatibility remains missing.', issue: 'missing_evidence', runId: 'job' }, adapter, trace => progress.push(trace));
  assert.deepEqual(calls.map(call => call.id), ['job:search:1', 'job:read:1', 'job:read:2']);
  assert.equal(result.investigation.status, 'ready_to_revise');
  assert.equal(result.investigation.newEvidence, true);
  assert.equal(result.investigation.externalCalls, 3);
  assert.equal(result.investigation.addedSourceIds.length, 1);
  const added = result.context.sources.at(-1)!;
  assert.equal(added.origin, 'agent_retrieved');
  assert.equal(added.reference, second.url);
  assert.ok(second.text.includes(added.text));
  assert.ok(added.text.includes(exact));
  assert.ok(added.text.length <= 2000);
  assert.match(added.sha256, /^[a-f0-9]{64}$/);
  assert.match(added.retrievedAt!, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(result.investigation.selectedSourceIds.includes(added.id));
  assert.equal(progress[0].status, 'running');
  assert.equal(progress.at(-1)!.status, 'ready_to_revise');
  assert.notDeepEqual(progress[0].steps, progress.at(-1)!.steps);
});

test('identical normalized source content at new URLs is not new evidence', async () => {
  const input = context();
  const body = 'Drawer 240337103 replaces part 241543917 according to the parts catalog.';
  input.sources.push({ ...source('existing', body), reference: 'https://manufacturer.example/original' });
  const { adapter } = searchAdapter([{ url: 'https://manufacturer.example/copy', text: body.toUpperCase().replaceAll(' ', '\n  ') }, { url: 'https://manufacturer.example/another-copy', text: body }]);
  const result = await investigateRevision({ context: input, critique: 'Missing compatibility.', issue: 'missing_evidence', runId: 'job', originalSourceIds: input.sources.map(item => item.id) }, adapter);
  assert.equal(result.investigation.status, 'needs_information');
  assert.equal(result.investigation.newEvidence, false);
  assert.deepEqual(result.investigation.addedSourceIds, []);
  assert.equal(result.context.sources.length, input.sources.length);
  assert.equal(result.investigation.steps.filter(item => /already saved/.test(item.detail)).length, 2);
});

test('a shortened reread of a saved document is not new evidence, but additional document text is retained', async () => {
  const input = context();
  const body = 'Drawer 240337103 replaces part 241543917 according to the parts catalog.';
  input.sources.push(source('existing', `Catalog introduction. ${body} Installation instructions follow.`));
  const originalSourceIds = input.sources.map(item => item.id);
  const shorter = searchAdapter([{ url: 'https://manufacturer.example/short', text: body }]);
  const repeated = await investigateRevision({ context: input, critique: 'Compatibility is missing.', issue: 'missing_evidence', runId: 'job', originalSourceIds }, shorter.adapter);
  assert.equal(repeated.investigation.status, 'needs_information');
  assert.equal(repeated.investigation.newEvidence, false);
  const longer = searchAdapter([{ url: 'https://manufacturer.example/full', text: `${input.sources.at(-1)!.text} The cross-reference was updated on September 29.` }]);
  const added = await investigateRevision({ context: input, critique: 'Compatibility is missing.', issue: 'missing_evidence', runId: 'job2', originalSourceIds }, longer.adapter);
  assert.equal(added.investigation.status, 'ready_to_revise');
  assert.equal(added.investigation.newEvidence, true);
});

test('a copied reviewer excerpt cannot bypass content dedup by receiving a new source ID', async () => {
  const input = context();
  const body = 'Drawer 240337103 replaces part 241543917 according to the parts catalog.';
  input.sources.push(source('existing', body));
  const originalSourceIds = input.sources.map(item => item.id);
  input.sources.push({ ...source('copy', body.replaceAll(' ', '  ')), origin: 'reviewer_added' });
  const result = await investigateRevision({ context: input, critique: 'Missing compatibility.', issue: 'missing_evidence', runId: 'job', originalSourceIds });
  assert.equal(result.investigation.status, 'needs_information');
  assert.equal(result.investigation.newEvidence, false);
});

test('identical body text with a different original customer-question scope remains distinct', async () => {
  const input = context();
  const body = 'Drawer 240337103 replaces part 241543917 according to the parts catalog.';
  input.sources.push(source('different-context', body, 'Does it fit model RF-98765?'));
  const { adapter } = searchAdapter([{ url: 'https://manufacturer.example/crossref', text: body }]);
  const result = await investigateRevision({ context: input, critique: 'Missing compatibility.', issue: 'missing_evidence', runId: 'job', originalSourceIds: input.sources.map(item => item.id) }, adapter);
  assert.equal(result.investigation.status, 'ready_to_revise');
  assert.equal(result.investigation.newEvidence, true);
  assert.equal(result.investigation.addedSourceIds.length, 1);
  assert.equal(result.investigation.selectedSourceIds.includes('19:different-context'), false);
});

test('a changed return URL outside allowed domains never supplies citations', async () => {
  const { adapter } = searchAdapter([]);
  adapter.search = async () => ({ results: [{ title: 'Manual', url: 'https://manufacturer.example/redirect', snippet: '' }] });
  adapter.read = async () => ({ url: 'https://unapproved.example/page', text: 'Drawer 240337103 replaces part 241543917 according to this page.' });
  const result = await investigateRevision({ context: context(), critique: 'Compatibility missing.', issue: 'missing_evidence', runId: 'job' }, adapter);
  assert.equal(result.investigation.status, 'needs_information');
  assert.equal(result.investigation.addedSourceIds.length, 0);
});

test('uncertain dispatched outcomes propagate for reconciliation without retry', async () => {
  const { adapter, calls } = searchAdapter([]);
  const uncertain = Object.assign(new Error('Synthetic ambiguous response'), { code: 'unverified_outcome' });
  adapter.search = async (_query, id) => { calls.push({ kind: 'search', id, input: '' }); throw uncertain; };
  await assert.rejects(investigateRevision({ context: context(), critique: 'Compatibility missing.', issue: 'missing_evidence', runId: 'job' }, adapter), error => error === uncertain);
  assert.equal(calls.length, 1);
});

test('non-compatibility missed facts and conflicting sources can use saved candidates', async () => {
  const input: RevisionContext = { question: 'Is the jacket shell nylon or cotton?', product: { id: 'jacket', title: 'Trail jacket' }, sources: [source('jacket1', 'The jacket shell is waterproof nylon and the lining is cotton.'), source('jacket2', 'This jacket shell is listed as cotton in the customer review.')], clarifications: [] };
  const missed = await investigateRevision({ context: input, critique: 'The answer missed the shell material source.', issue: 'auto', runId: 'jacket' });
  assert.equal(missed.investigation.issue, 'missed_source');
  assert.equal(missed.investigation.status, 'ready_to_revise');
  const conflict = await investigateRevision({ context: input, critique: 'The sources conflict about the shell.', issue: 'auto', runId: 'jacket2' });
  assert.equal(conflict.investigation.issue, 'conflicting_sources');
  assert.equal(conflict.investigation.selectedSourceIds.length, 2);
  assert.equal(conflict.investigation.status, 'ready_to_revise');
});

test('customer clarification identifiers affect scope without sending reviewer names to search', async () => {
  const input = context(); input.clarifications.push({ text: 'The refrigerator model is RF-12345.', reviewer: 'Private reviewer name' });
  const { adapter, calls } = searchAdapter([]);
  const result = await investigateRevision({ context: input, critique: 'Missing compatibility.', issue: 'missing_evidence', runId: 'job' }, adapter);
  assert.ok(result.investigation.requestedIdentifiers.includes('RF-12345'));
  assert.ok(calls[0].input.includes('RF-12345'));
  assert.equal(calls[0].input.includes('Private reviewer name'), false);
  assert.equal(result.investigation.status, 'needs_information');
});

test('disabled search explains the local-only limit and makes no external calls', async () => {
  const { adapter, calls } = searchAdapter([]);
  adapter.readiness = () => ({ ready: false, reason: 'Source discovery is disabled by the server configuration.' });
  const result = await investigateRevision({ context: context(), critique: 'Missing support.', issue: 'missing_evidence', runId: 'job' }, adapter);
  assert.equal(result.investigation.status, 'needs_information');
  assert.equal(result.investigation.externalCalls, 0);
  assert.equal(calls.length, 0);
  assert.match(result.investigation.steps.find(item => item.kind === 'web_search')!.detail, /disabled/);
});
