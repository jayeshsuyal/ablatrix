import { defineAgent, defineStep, terminate } from '@sapiom/agent';
import { z } from 'zod/v4';

const inputSchema = z.object({
  entity: z.string().min(2).max(120),
  question: z.string().min(8).max(500)
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
    const sources = search.results.filter(result => publicHttps(result.url)).slice(0, 3);
    if (!sources.length || !search.answer) throw new Error('No cited answer was returned');
    const read = await Promise.allSettled(sources.slice(0, 2).map(result =>
      ctx.sapiom.search.scrape({ url: result.url, formats: ['markdown'], onlyMainContent: true })));
    const readSources = sources.map((source, index) => ({
      ...source,
      snippet: read[index]?.status === 'fulfilled'
        ? (read[index].value.markdown ?? source.snippet).slice(0, 500)
        : source.snippet
    }));
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
