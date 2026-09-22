import type { ResearchInput, ResearchOutput } from './contracts.ts';
import { baselineConfig, type ResearchConfig } from './config.ts';

export async function runFixture(input: ResearchInput, settings: ResearchConfig = baselineConfig): Promise<ResearchOutput> {
  const url = 'https://example.com/';
  const sources = [{ title: 'Synthetic example source', url, snippet: 'Fixture only; not evidence.' }];
  if (settings.maxSources === 2) sources.push({ title: 'Second synthetic source', url: 'https://example.com/second', snippet: 'Fixture only; not evidence.' });
  return {
    answer: `Fixture research for ${input.entity}: this is synthetic data and does not answer a live question. Configuration: ${settings.modelAssignment}, ${settings.promptStyle}, ${settings.maxSources} source(s).`,
    facts: [{ claim: `${input.entity} is a synthetic fixture subject.`, sourceUrls: sources.map(item => item.url) }],
    sources
  };
}
