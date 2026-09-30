import { isIP } from 'node:net';
import { search as sapiomSearch } from '@sapiom/tools';
import { FeedbackExternalError, SapiomFeedbackProvider } from './feedback-provider.ts';

export { FeedbackExternalError as RevisionSearchError } from './feedback-provider.ts';
export function isRevisionSearchUncertain(error: unknown): boolean {
  return error instanceof FeedbackExternalError && (error.code === 'unverified_outcome' || error.code === 'reconciliation_required');
}
export type RevisionSearchHit = { title: string; url: string; snippet: string };
export type RevisionSearchDiagnostics = { returned: number; inspected: number; excluded: Record<'invalid_url' | 'off_domain' | 'invalid_shape' | 'duplicate' | 'over_limit' | 'uninspected', number> };
export type RevisionSearchPage = { url: string; title?: string; text: string };
/** Injectable SDK surface for synthetic tests. Production always uses the provider's bounded transport. */
export type RevisionSearchClient = {
  search: {
    webSearch(input: { query: string; intent: 'links'; depth: 'standard' }): Promise<unknown>;
    scrape(input: { url: string; formats: ['markdown']; onlyMainContent: true; waitFor: 0 }): Promise<unknown>;
  };
};
type Options = { enabled?: boolean; allowedDomains?: string[]; client?: RevisionSearchClient };

function publicDomain(value: string): string | null {
  const host = value.trim().toLowerCase();
  if (host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
  if (isIP(host) || /(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/.test(host)) return null;
  try { if (new URL(`https://${host}`).hostname !== host) return null; } catch { return null; }
  return host;
}

/** Discovery snippets are never evidence; only a successfully read page supplies source text. */
export class SapiomRevisionSearch {
  private readonly enabled: boolean;
  private readonly domains: Set<string>;
  private readonly domainConfigValid: boolean;
  private readonly client?: RevisionSearchClient;
  constructor(private readonly provider: SapiomFeedbackProvider, options: Options = {}) {
    this.enabled = options.enabled ?? process.env.ABLATRIX_REVISION_WEB === '1';
    const configured = options.allowedDomains ?? (process.env.ABLATRIX_REVISION_SOURCE_DOMAINS ?? '').split(',').filter(Boolean);
    const domains = configured.map(publicDomain);
    this.domainConfigValid = domains.length > 0 && domains.length <= 10 && domains.every(domain => domain !== null);
    this.domains = new Set(domains.filter((domain): domain is string => domain !== null));
    this.client = options.client;
  }
  private configuration() {
    if (!this.enabled) return { ready: false, reason: 'Web investigation is disabled. Enable ABLATRIX_REVISION_WEB for bounded Sapiom source discovery.' };
    if (!this.domainConfigValid) return { ready: false, reason: 'Configure one to ten exact public source domains in ABLATRIX_REVISION_SOURCE_DOMAINS.' };
    return { ready: true, reason: 'Web investigation is configured.' };
  }
  readiness() {
    const config = this.configuration();
    return config.ready ? this.provider.readiness() : config;
  }
  allowed(value: string): boolean {
    if (!this.domainConfigValid || typeof value !== 'string' || value.length > 2048 || value !== value.trim() || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
    // Inspect the raw authority too: URL normalization otherwise hides an explicit :443 port.
    const authority = /^https:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(value)?.[1];
    if (!authority || /[@:%\[\]]/.test(authority)) return false;
    try {
      const url = new URL(value), host = publicDomain(url.hostname);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && host !== null && this.domains.has(host);
    } catch { return false; }
  }
  private configured() {
    const config = this.configuration();
    if (!config.ready) throw new FeedbackExternalError('unavailable', config.reason);
  }
  private sdk(boundedFetch: typeof fetch): RevisionSearchClient {
    // The SDK capability functions need only transport.fetch. Avoid createClient's independent
    // analytics emitter so every outbound request goes through the shared reservation and timeout.
    const transport = { fetch: boundedFetch } as Parameters<typeof sapiomSearch.webSearch>[1];
    return this.client ?? { search: {
      webSearch: input => sapiomSearch.webSearch(input, transport, 'https://api.sapiom.ai'),
      scrape: input => sapiomSearch.scrape(input, transport, 'https://api.sapiom.ai')
    } };
  }
  private hits(raw: unknown, replay: boolean): { results: RevisionSearchHit[]; diagnostics?: RevisionSearchDiagnostics } {
    if (!raw || typeof raw !== 'object' || !('results' in raw) || !Array.isArray(raw.results)) throw new Error('invalid_search_response');
    // A completed receipt already contains the filtered result. Revalidate it
    // without recomputing the original raw-result diagnostics from five leads.
    if (replay && !('diagnostics' in raw)) {
      // Older receipts contain eligible leads only. Their raw count is unknown.
      if (raw.results.length > 5 || raw.results.some(hit => !hit || typeof hit !== 'object' || !('url' in hit) || !this.allowed(hit.url as string) || !('title' in hit) || typeof hit.title !== 'string' || !('snippet' in hit) || typeof hit.snippet !== 'string')) throw new Error('invalid_search_receipt');
      return { results: raw.results as RevisionSearchHit[] };
    }
    if (replay && 'diagnostics' in raw) {
      const value = raw as { results: unknown[]; diagnostics: RevisionSearchDiagnostics };
      const counts = value.diagnostics;
      if (!counts || !Number.isSafeInteger(counts.returned) || !Number.isSafeInteger(counts.inspected) || counts.returned < 0 || counts.inspected < 0 || counts.inspected > counts.returned ||
        !counts.excluded || !(['invalid_url', 'off_domain', 'invalid_shape', 'duplicate', 'over_limit', 'uninspected'] as const).every(key => Number.isSafeInteger(counts.excluded[key]) && counts.excluded[key] >= 0) ||
        value.results.length > 5 || value.results.some(hit => !hit || typeof hit !== 'object' || !('url' in hit) || !this.allowed(hit.url as string) || !('title' in hit) || typeof hit.title !== 'string' || !('snippet' in hit) || typeof hit.snippet !== 'string')) throw new Error('invalid_search_receipt');
      return value as { results: RevisionSearchHit[]; diagnostics: RevisionSearchDiagnostics };
    }
    const seen = new Set<string>(); const results: RevisionSearchHit[] = [];
    const diagnostics: RevisionSearchDiagnostics = { returned: raw.results.length, inspected: Math.min(raw.results.length, 100), excluded: { invalid_url: 0, off_domain: 0, invalid_shape: 0, duplicate: 0, over_limit: 0, uninspected: Math.max(0, raw.results.length - 100) } };
    for (const item of raw.results.slice(0, 100)) {
      if (!item || typeof item !== 'object' || typeof item.url !== 'string' || typeof item.title !== 'string' || typeof item.snippet !== 'string') { diagnostics.excluded.invalid_shape++; continue; }
      if (!/^https:\/\//i.test(item.url)) { diagnostics.excluded.invalid_url++; continue; }
      try { new URL(item.url); } catch { diagnostics.excluded.invalid_url++; continue; }
      if (!this.allowed(item.url)) { diagnostics.excluded.off_domain++; continue; }
      const url = new URL(item.url); url.hash = ''; const canonical = url.href;
      if (seen.has(canonical)) { diagnostics.excluded.duplicate++; continue; }
      seen.add(canonical);
      if (results.length === 5) { diagnostics.excluded.over_limit++; continue; }
      results.push({ title: item.title.slice(0, 200), url: canonical, snippet: item.snippet.slice(0, 500) });
    }
    return { results, diagnostics };
  }
  async search(query: string, runId: string): Promise<{ results: RevisionSearchHit[]; diagnostics?: RevisionSearchDiagnostics }> {
    this.configured();
    if (typeof query !== 'string' || !query.trim() || query.length > 600 || /[\u0000-\u001f\u007f]/.test(query)) throw new FeedbackExternalError('invalid_input', 'The source search query is missing or exceeds its bounded size.');
    const request = { query: `${query.trim()} (${[...this.domains].map(domain => `site:${domain}`).join(' OR ')})`, intent: 'links' as const, depth: 'standard' as const };
    return this.provider.meteredExternal({ kind: 'revision_search', runId, request }, fetch => this.sdk(fetch).search.webSearch(request), (raw, replay) => this.hits(raw, replay));
  }
  private page(raw: unknown, receipt = false): RevisionSearchPage {
    if (!raw || typeof raw !== 'object') throw new Error('invalid_page_response');
    const value = raw as Record<string, unknown>;
    // Receipts store the validated page rather than provider metadata. Revalidate its URL on replay.
    if (receipt) {
      if (typeof value.url !== 'string' || !this.allowed(value.url) || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 6000 || (value.title !== undefined && typeof value.title !== 'string')) throw new Error('invalid_page_receipt');
      return { url: value.url, text: value.text, ...(typeof value.title === 'string' ? { title: value.title.slice(0, 200) } : {}) };
    }
    const metadata = value.metadata as Record<string, unknown> | undefined;
    if (typeof value.url !== 'string' || !this.allowed(value.url) || !metadata || typeof metadata.sourceUrl !== 'string' || !this.allowed(metadata.sourceUrl)) throw new Error('unverified_page_origin');
    if (metadata.statusCode !== undefined && (typeof metadata.statusCode !== 'number' || metadata.statusCode < 200 || metadata.statusCode >= 300)) throw new Error('invalid_page_status');
    if (typeof value.markdown !== 'string' || !value.markdown.trim()) throw new Error('missing_page_markdown');
    const url = new URL(metadata.sourceUrl); url.hash = '';
    return { url: url.href, text: value.markdown.trim().slice(0, 6000), ...(typeof metadata.title === 'string' ? { title: metadata.title.slice(0, 200) } : {}) };
  }
  async read(url: string, runId: string): Promise<RevisionSearchPage> {
    this.configured();
    if (!this.allowed(url)) throw new FeedbackExternalError('invalid_input', 'The source URL must use HTTPS and an exact configured public domain.');
    const canonical = new URL(url); canonical.hash = '';
    const request = { url: canonical.href, formats: ['markdown'] as ['markdown'], onlyMainContent: true as const, waitFor: 0 as const };
    return this.provider.meteredExternal({ kind: 'revision_read', runId, request }, async fetch => this.page(await this.sdk(fetch).search.scrape(request)), raw => this.page(raw, true));
  }
}
