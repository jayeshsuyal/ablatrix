import { createHash } from 'node:crypto';
import { z } from 'zod';

export const researchConfig = z.object({
  modelAssignment: z.enum(['search-native', 'small']),
  promptStyle: z.enum(['full', 'compact']),
  cacheTtlMinutes: z.union([z.literal(0), z.literal(10)]),
  maxSources: z.union([z.literal(1), z.literal(2)]),
  parallelReads: z.boolean()
}).strict();
export type ResearchConfig = z.infer<typeof researchConfig>;
export const baselineConfig: ResearchConfig = {
  modelAssignment: 'search-native', promptStyle: 'full', cacheTtlMinutes: 0,
  maxSources: 1, parallelReads: false
};
export function candidateId(config: ResearchConfig): string {
  return `candidate-${createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 10)}`;
}
export function allowedCandidateChange(config: ResearchConfig): boolean {
  const changed = (Object.keys(baselineConfig) as (keyof ResearchConfig)[])
    .filter(key => config[key] !== baselineConfig[key]);
  return changed.length === 0 || changed.length === 1 || changed.length === 2 &&
    changed.includes('maxSources') && changed.includes('parallelReads') &&
    config.maxSources === 2 && config.parallelReads;
}
