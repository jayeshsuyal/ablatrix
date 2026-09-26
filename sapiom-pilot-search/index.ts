import { defineAgent, defineStep, fail, terminate } from '@sapiom/agent';
import { z } from 'zod/v4';

const inputSchema = z.object({ question: z.string().min(8).max(500) });

const search = defineStep({
  name: 'search', next: [], terminal: true, canFail: true, inputSchema, timeoutMs: 30_000,
  async run(input, ctx) {
    const result = await ctx.sapiom.search.webSearch({ query: input.question, intent: 'answer', depth: 'standard' });
    if (!result || typeof result.answer !== 'string') return fail('Search returned no answer hypothesis.');
    return terminate({ hypothesis: result.answer.slice(0, 4_000) });
  }
});

export const agent = defineAgent({ name: 'ablatrix-pilot-search', entry: 'search', steps: { search } });
