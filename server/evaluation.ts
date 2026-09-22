import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { RunRecord } from './contracts.ts';

const taskSchema = z.object({
  id: z.string(), split: z.enum(['development', 'validation', 'holdout']),
  entity: z.string(), question: z.string(), expectedFact: z.string(),
  answerTerms: z.array(z.string()).min(1), sourceHost: z.string(),
  evidenceUrl: z.url(), labelKind: z.literal('human-checked')
});
const suiteSchema = z.object({ version: z.number(), reviewedAt: z.string(), tasks: z.array(taskSchema) });
const suitePath = fileURLToPath(new URL('../data/tasks.v1.json', import.meta.url));
const suite = suiteSchema.parse(JSON.parse(readFileSync(suitePath, 'utf8')));
type Task = z.infer<typeof taskSchema>;

export function publicTasks() {
  return {
    version: suite.version, reviewedAt: suite.reviewedAt,
    development: suite.tasks.filter(task => task.split === 'development').map(({ id, split, entity, question }) => ({ id, split, entity, question })),
    validation: suite.tasks.filter(task => task.split === 'validation').map(({ id, split, entity, question }) => ({ id, split, entity, question })),
    holdoutCount: suite.tasks.filter(task => task.split === 'holdout').length
  };
}

export function taskForRun(id: string): Pick<Task, 'id' | 'split' | 'entity' | 'question'> | null {
  const task = suite.tasks.find(item => item.id === id && item.split !== 'holdout');
  return task ? { id: task.id, split: task.split, entity: task.entity, question: task.question } : null;
}

export type Evaluation = {
  taskId: string; split: Task['split']; completed: boolean; correct: boolean;
  deterministic: { answerTermsPresent: boolean; approvedSourcePresent: boolean; citationsResolve: boolean };
  labelKind: 'human-checked'; modelJudge: null;
  evidenceUrl: string; expectedFact: string | null; fixture: boolean;
};

export function evaluate(run: RunRecord, revealHoldout = false): Evaluation | null {
  const task = suite.tasks.find(item => item.id === run.taskId);
  if (!task) return null;
  const answer = run.output?.answer.toLowerCase() ?? '';
  const answerTermsPresent = task.answerTerms.every(term => answer.includes(term.toLowerCase()));
  const approvedSourcePresent = run.output?.sources.some(source => {
    const host = new URL(source.url).hostname.toLowerCase();
    return host === task.sourceHost || host.endsWith(`.${task.sourceHost}`);
  }) ?? false;
  const urls = new Set(run.output?.sources.map(source => source.url) ?? []);
  const citationsResolve = run.output?.facts.every(fact => fact.sourceUrls.every(url => urls.has(url))) ?? false;
  const completed = run.status === 'completed';
  return {
    taskId: task.id, split: task.split, completed,
    correct: completed && answerTermsPresent && approvedSourcePresent && citationsResolve,
    deterministic: { answerTermsPresent, approvedSourcePresent, citationsResolve },
    labelKind: task.labelKind, modelJudge: null,
    evidenceUrl: task.evidenceUrl,
    expectedFact: task.split === 'holdout' && !revealHoldout ? null : task.expectedFact,
    fixture: run.mode === 'fixture'
  };
}

export function report(runs: RunRecord[]) {
  const latest = new Map<string, RunRecord>();
  for (const run of runs) if (!latest.has(run.taskId)) latest.set(run.taskId, run);
  const evaluations = [...latest.values()].map(run => evaluate(run)).filter((item): item is Evaluation => item !== null && item.split !== 'holdout');
  const live = evaluations.filter(item => !item.fixture);
  const liveCorrect = live.filter(item => item.correct).length;
  const pricedRuns = runs.filter(run => run.mode === 'live' && run.costStatus === 'priced' && run.costUsd !== null);
  const allLivePriced = runs.filter(run => run.mode === 'live').length === pricedRuns.length;
  return {
    version: suite.version, sampleSize: live.length, correct: liveCorrect,
    qualityRate: live.length ? liveCorrect / live.length : null,
    costPerCorrectUsd: allLivePriced && liveCorrect > 0 ? pricedRuns.reduce((sum, run) => sum + (run.costUsd ?? 0), 0) / liveCorrect : null,
    costNote: 'Unknown when any live run is unpriced or no task is correctly completed; fixture cost is excluded.',
    uncertainty: live.length < 30 ? 'Small sample; no reliable performance claim.' : 'Report a confidence interval before comparison.',
    evaluations
  };
}
