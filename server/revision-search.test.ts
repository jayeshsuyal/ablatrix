import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SapiomFeedbackProvider } from './feedback-provider.ts';
import { SapiomRevisionSearch, RevisionSearchError, isRevisionSearchUncertain } from './revision-search.ts';

const options = { enabled: true, apiKey: 'fixture-only-credential', capUsd: 10, allowancePerCallUsd: 0.1, callLimit: 10, dbPath: ':memory:' };
const searchOptions = { enabled: true, allowedDomains: ['manufacturer.com', 'docs.manufacturer.com'] };
function json(value: unknown) { return new Response(JSON.stringify(value)); }
function page(url = 'https://manufacturer.com/parts') { return { url, markdown: 'This fixture drawer replaces the listed part.', metadata: { sourceURL: url, title: 'Fixture part reference', statusCode: 200 } }; }
function hasCode(code: RevisionSearchError['code']) { return (error: unknown) => error instanceof RevisionSearchError && error.code === code; }

test('web investigation defaults closed and invalid domains fail before reserving or calling', async () => {
  let calls = 0;
  const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async () => { calls++; return json({ results: [] }); } });
  try {
    for (const config of [
      { enabled: false, allowedDomains: ['manufacturer.com'] },
      { enabled: true, allowedDomains: [] },
      { enabled: true, allowedDomains: ['localhost'] },
      { enabled: true, allowedDomains: ['manufacturer.com', 'https://malformed.com'] },
      { enabled: true, allowedDomains: ['127.0.0.1'] },
    ]) {
      const search = new SapiomRevisionSearch(provider, config);
      assert.equal(search.readiness().ready, false);
      await assert.rejects(search.search('replacement part', 'blocked'), hasCode('unavailable'));
    }
    assert.equal(calls, 0); assert.equal(provider.receipt('blocked'), undefined);
  } finally { provider.close(); }
});

test('source allowlist checks exact canonical public HTTPS hosts and rejects URL tricks', () => {
  const provider = new SapiomFeedbackProvider(options);
  try {
    const search = new SapiomRevisionSearch(provider, searchOptions);
    assert.equal(search.allowed('https://manufacturer.com/parts?q=240337103'), true);
    assert.equal(search.allowed('https://DOCS.manufacturer.com/reference#p2'), true);
    for (const url of [
      'http://manufacturer.com/parts', 'https://manufacturer.com:443/parts', 'https://manufacturer.com:8443/',
      'https://user:pass@manufacturer.com/', 'https://manufacturer.com.evil.com/', 'https://evil.manufacturer.com/',
      'https://manufacturer.com./', 'https://manu%66acturer.com/', 'https://manufacturer.com\\@evil.com',
      'https://127.0.0.1/', 'https://[::1]/', 'https://2130706433/', 'https://localhost/',
      'https://manufacturer.com/\nparts', ' https://manufacturer.com/parts'
    ]) assert.equal(search.allowed(url), false, url);
  } finally { provider.close(); }
});

test('SDK search uses pinned Core origin, private provider credential, links intent, bounded discovery and durable replay', async () => {
  let calls = 0;
  const provider = new SapiomFeedbackProvider({ ...options, callLimit: 1, fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.sapiom.ai/v1/capabilities/web.search');
    assert.equal(new Headers(init?.headers).get('x-api-key'), options.apiKey);
    assert.equal(init?.redirect, 'error'); assert.ok(init?.signal);
    const input = JSON.parse(String(init?.body));
    assert.equal(input.intent, 'links'); assert.equal(input.depth, 'standard'); assert.match(input.query, /site:manufacturer.com/);
    return json({ answer: 'This generated search answer must not be returned.', results: [
      { title: 'Off domain', url: 'https://retailer.com/parts', snippet: 'Unsupported.' },
      { title: 'x'.repeat(300), url: 'https://manufacturer.com/a#one', snippet: 's'.repeat(600) },
      { title: 'Duplicate', url: 'https://manufacturer.com/a#two', snippet: 'Duplicate.' },
      ...Array.from({ length: 8 }, (_, index) => ({ title: `Fixture ${index}`, url: `https://manufacturer.com/part/${index}`, snippet: 'Discovery only.' }))
    ] });
  } });
  try {
    const search = new SapiomRevisionSearch(provider, searchOptions);
    const result = await search.search('fixture compatibility', 'job:search:1');
    assert.deepEqual(Object.keys(result), ['results', 'diagnostics']); assert.equal(result.results.length, 5);
    assert.deepEqual(result.diagnostics, { returned: 11, inspected: 11, excluded: { invalid_url: 0, off_domain: 1, invalid_shape: 0, duplicate: 1, over_limit: 4, uninspected: 0 } });
    assert.equal(result.results[0].url, 'https://manufacturer.com/a');
    assert.equal(result.results[0].title.length, 200); assert.equal(result.results[0].snippet.length, 500);
    assert.equal(provider.readiness().ready, false);
    assert.deepEqual(await search.search('fixture compatibility', 'job:search:1'), result);
    assert.equal(calls, 1);
    const receipt = provider.receipt('job:search:1')!;
    assert.equal(receipt.kind, 'revision_search'); assert.equal(receipt.status, 'completed');
    assert.equal(receipt.model, null); assert.equal(receipt.input_tokens, null); assert.equal(receipt.allowance_usd, 0.1);
    await assert.rejects(search.search('changed query', 'job:search:1'), hasCode('reconciliation_required'));
    await assert.rejects(search.search('next query', 'job:search:2'), hasCode('unavailable'));
    assert.equal(calls, 1);
  } finally { provider.close(); }
});

test('empty and filtered search results retain distinct, bounded diagnostics in receipts', async () => {
  for (const [raw, expected] of [
    [[], { returned: 0, off_domain: 0, invalid_shape: 0 }],
    [[{ title: 'off', url: 'https://retailer.com/a', snippet: 'not permitted' }], { returned: 1, off_domain: 1, invalid_shape: 0 }],
  ] as const) {
    const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async () => json({ results: raw }) });
    try {
      const search = new SapiomRevisionSearch(provider, searchOptions);
      const result = await search.search('fixture', 'diagnostic:search:1');
      assert.equal(result.results.length, 0);
      assert.equal(result.diagnostics.returned, expected.returned);
      assert.equal(result.diagnostics.excluded.off_domain, expected.off_domain);
      assert.equal(result.diagnostics.excluded.invalid_shape, expected.invalid_shape);
      assert.deepEqual(await search.search('fixture', 'diagnostic:search:1'), result);
      assert.doesNotMatch(JSON.stringify(provider.receipt('diagnostic:search:1')), /retailer\.com|not permitted/);
    } finally { provider.close(); }
  }
});

test('SDK page reads preserve actual markdown, bound excerpts, and share search planning allowance', async () => {
  const calls: string[] = [];
  const provider = new SapiomFeedbackProvider({ ...options, callLimit: 2, fetchImpl: async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith('web.search')) return json({ results: [] });
    assert.deepEqual(JSON.parse(String(init?.body)), { url: 'https://manufacturer.com/parts', formats: ['markdown'], onlyMainContent: true, waitFor: 0 });
    return json({ ...page(), markdown: 'Actual source text. '.repeat(500) });
  } });
  try {
    const search = new SapiomRevisionSearch(provider, searchOptions);
    await search.search('part reference', 'job:search:1');
    const result = await search.read('https://manufacturer.com/parts#section', 'job:read:1');
    assert.equal(result.title, 'Fixture part reference'); assert.equal(result.text.length, 6000);
    assert.ok(result.text.startsWith('Actual source text.')); assert.equal(result.url, 'https://manufacturer.com/parts');
    assert.equal(provider.capacity(1).ready, false);
    assert.deepEqual(await search.read('https://manufacturer.com/parts', 'job:read:1'), result);
    await assert.rejects(search.read('https://manufacturer.com/second', 'job:read:2'), hasCode('unavailable'));
    assert.equal(calls.length, 2);
  } finally { provider.close(); }
});

test('off-domain or missing final source origins and absent markdown never become page evidence', async () => {
  for (const response of [
    { ...page(), url: 'https://evil.com/' },
    { ...page(), metadata: { sourceURL: 'https://evil.com/', statusCode: 200 } },
    { ...page(), metadata: {} },
    { ...page(), metadata: { sourceURL: 'https://manufacturer.com/parts', statusCode: 404 } },
    { ...page(), markdown: undefined, answer: 'A generated answer is not page content.' },
  ]) {
    let calls = 0;
    const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async () => { calls++; return json(response); } });
    try {
      const search = new SapiomRevisionSearch(provider, searchOptions);
      await assert.rejects(search.read('https://manufacturer.com/parts', 'job:read:1'), hasCode('unverified_outcome'));
      await assert.rejects(search.read('https://manufacturer.com/parts', 'job:read:1'), hasCode('reconciliation_required'));
      assert.equal(calls, 1); assert.equal(provider.receipt('job:read:1')?.status, 'failed_or_unknown');
    } finally { provider.close(); }
  }
});

test('HTTP errors, timeouts, and oversized provider responses keep reservations and redact details', async () => {
  for (const fetchImpl of [
    async () => new Response('fixture-only-credential and raw upstream body', { status: 503 }),
    async () => { throw new DOMException('fixture-only-credential', 'TimeoutError'); },
    async () => json({ results: [], padding: 'x'.repeat(256 * 1024) }),
  ]) {
    let calls = 0;
    const provider = new SapiomFeedbackProvider({ ...options, fetchImpl: async () => { calls++; return fetchImpl(); } });
    try {
      const search = new SapiomRevisionSearch(provider, searchOptions);
      await assert.rejects(search.search('fixture', 'job:search:1'), error => {
        assert.ok(isRevisionSearchUncertain(error));
        assert.ok(error instanceof Error); assert.doesNotMatch(error.message, /credential|raw upstream body/); return true;
      });
      await assert.rejects(search.search('fixture', 'job:search:1'), hasCode('reconciliation_required'));
      assert.equal(calls, 1); assert.match(provider.readiness().reason, /1\/10 calls/);
    } finally { provider.close(); }
  }
});

test('pending and interrupted attempts remain non-dispatchable across process restarts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'revision-search-')); const dbPath = join(dir, 'budget.sqlite');
  let calls = 0;
  const provider = new SapiomFeedbackProvider({ ...options, dbPath, fetchImpl: async () => { calls++; return json({ results: [] }); } });
  const db = new DatabaseSync(dbPath);
  try {
    for (const status of ['pending', 'interrupted', 'failed_or_unknown']) {
      db.prepare('INSERT INTO loop_provider_calls(id,created_at,kind,allowance_usd,status,run_id) VALUES(?,?,?,?,?,?)').run(status, new Date().toISOString(), 'revision_search', 0.1, status, `job:${status}`);
      const search = new SapiomRevisionSearch(provider, searchOptions);
      await assert.rejects(search.search('fixture', `job:${status}`), hasCode('reconciliation_required'));
    }
    assert.equal(calls, 0);
  } finally { db.close(); provider.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('bad search and read inputs do not reserve a call', async () => {
  const provider = new SapiomFeedbackProvider(options);
  try {
    const search = new SapiomRevisionSearch(provider, searchOptions);
    await assert.rejects(search.search('q'.repeat(601), 'job:search:1'), hasCode('invalid_input'));
    await assert.rejects(search.read('https://evil.com/parts', 'job:read:1'), hasCode('invalid_input'));
    assert.equal(provider.receipt('job:search:1'), undefined); assert.equal(provider.receipt('job:read:1'), undefined);
  } finally { provider.close(); }
});
