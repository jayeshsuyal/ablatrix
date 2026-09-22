import { createClient } from '@sapiom/tools';
import { researchOutput, type ResearchInput, type ResearchOutput } from './contracts.ts';
import { sourceUrlForTask } from './evaluation.ts';

export async function runSapiom(input: ResearchInput, attemptId: string): Promise<{ output: ResearchOutput; usage: Record<string, unknown> }> {
  const apiKey = process.env.SAPIOM_API_KEY;
  const slug = process.env.SAPIOM_AGENT_SLUG;
  const cap = Number(process.env.ABLATRIX_SPEND_CAP_USD);
  if (!apiKey || !slug || !Number.isFinite(cap) || cap <= 0 || process.env.SAPIOM_BUDGET_ENFORCED !== '1') {
    throw new Error('Live mode requires credentials, a positive approved cap, and SAPIOM_BUDGET_ENFORCED=1 after configuring Sapiom spending rules');
  }
  const sourceUrl = input.taskId ? sourceUrlForTask(input.taskId) : null;
  if (!sourceUrl) throw new Error('Live research currently requires a curated development or validation task');
  const client = createClient({ apiKey });
  const result = await client.agents.run({
    definition: slug, input: { entity: input.entity, question: input.question, sourceUrl },
    idempotencyKey: attemptId
  });
  if (result.status !== 'completed') throw new Error(`Sapiom run ${result.status}: ${String(result.error ?? 'unknown error')}`);
  return { output: researchOutput.parse(result.output), usage: { executionId: result.executionId } };
}
