import { defineAgent, defineStep, terminate } from '@sapiom/agent';
import { z } from 'zod/v4';

const inputSchema = z.object({
  entity: z.string().min(2).max(120),
  question: z.string().min(8).max(500),
  sourceUrl: z.url()
});

function publicHttps(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password &&
      host !== 'localhost' && !host.endsWith('.localhost') &&
      !host.endsWith('.local') && !/^\d+\.\d+\.\d+\.\d+$/.test(host) &&
      !host.includes(':');
  } catch { return false; }
}

const research = defineStep({
  name: 'research', next: [], terminal: true, inputSchema, timeoutMs: 60_000,
  async run(input, ctx) {
    const search = await ctx.sapiom.search.webSearch({
      query: `${input.entity}: ${input.question}`, intent: 'answer', depth: 'standard'
    });
    if (!publicHttps(input.sourceUrl) || !search.answer) throw new Error('No safe cited answer was returned');
    const page = await ctx.sapiom.search.scrape({ url: input.sourceUrl, formats: ['markdown'], onlyMainContent: true });
    const readSources = [{
      title: page.metadata.title ?? input.entity,
      url: input.sourceUrl,
      snippet: (page.markdown ?? '').slice(0, 500)
    }];
    return terminate({
      answer: search.answer,
      facts: readSources.map(source => ({
        claim: source.snippet || `Search result: ${source.title}`,
        sourceUrls: [source.url]
      })),
      sources: readSources
    });
  }
});

export const agent = defineAgent({ name: 'ablatrix-research', entry: 'research', steps: { research } });
