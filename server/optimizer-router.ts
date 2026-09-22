import { researchConfig, type ResearchConfig } from './config.ts';

export async function proposeWithSapiom(investigation: string): Promise<ResearchConfig> {
  const apiKey = process.env.SAPIOM_API_KEY;
  if (!apiKey || process.env.SAPIOM_BUDGET_ENFORCED !== '1' || !Number.isFinite(Number(process.env.ABLATRIX_SPEND_CAP_USD)) || Number(process.env.ABLATRIX_SPEND_CAP_USD) <= 0) {
    throw new Error('Live modifier requires Sapiom credentials and an enforced approved budget');
  }
  const response = await fetch('https://router.sapiom.ai/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(20_000),
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'x-sapiom-lane': 'flex' },
    body: JSON.stringify({
      model: 'gpt-luna', max_tokens: 220,
      messages: [
        { role: 'system', content: 'You are a bounded research workflow modifier. Return only a JSON object with the five allowed configuration fields. Propose at most one change from baseline, except maxSources=2 may be paired with parallelReads=true. Never invent prices or claim improvement.' },
        { role: 'user', content: `Baseline: {"modelAssignment":"search-native","promptStyle":"full","cacheTtlMinutes":0,"maxSources":1,"parallelReads":false}\nInvestigation: ${investigation}` }
      ]
    })
  });
  if (!response.ok) throw new Error(`Sapiom Router modifier failed with HTTP ${response.status}`);
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Sapiom Router returned no proposal');
  return researchConfig.parse(JSON.parse(content) as unknown);
}
