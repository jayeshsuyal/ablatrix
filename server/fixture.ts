import type { ResearchInput, ResearchOutput } from './contracts.ts';

export async function runFixture(input: ResearchInput): Promise<ResearchOutput> {
  const url = 'https://example.com/';
  return {
    answer: `Fixture research for ${input.entity}: this is synthetic data and does not answer a live question.`,
    facts: [{ claim: `${input.entity} is a synthetic fixture subject.`, sourceUrls: [url] }],
    sources: [{ title: 'Synthetic example source', url, snippet: 'Fixture only; not evidence.' }]
  };
}
