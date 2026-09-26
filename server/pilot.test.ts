import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPilotSchedule, loadPilotSuite, PilotRunner, PilotStore, validatePilotSuite, type PilotProvider, type PilotProviderResult, type PilotRequest } from './pilot.ts';

function fakeProvider(overrides: Partial<PilotProvider> = {}): PilotProvider {
  return {
    readiness: () => ({ ready: true, reason: 'Injected test provider only.', capReference: 'test:cap', preflightReference: 'test:both-arms', capMicros: 10_000_000, priorSpendMicros: 100_000, maxCallMicros: 10_000 }),
    execute: async request => {
      const task = loadPilotSuite().tasks.find(task => task.question === request.question)!;
      await new Promise(resolve => setTimeout(resolve, request.searchEnabled ? 8 : 1));
      return { status: 'completed', output: { answer: task.expectedAnswer, citations: [{ url: request.source.url, quote: task.supportQuote }] },
        model: 'gpt-luna', modelVerified: true, charge: { micros: request.searchEnabled ? 9000 : 3000, reference: `test:${request.attemptId}` },
        calls: { search: request.searchEnabled ? 1 : 0, model: 1 }, usage: { inputTokens: 100, outputTokens: 20 }, executionId: `test:${request.attemptId}` };
    }, ...overrides
  };
}

test('pilot verifies snapshots and schedules eight distinct questions with two genuine paired repetitions', () => {
  const suite = loadPilotSuite();
  const schedule = buildPilotSchedule(suite, 'repeatable-seed');
  assert.equal(schedule.length, 32);
  assert.equal(new Set(schedule.map(slot => slot.taskId)).size, 8);
  const stripIds = (slots: typeof schedule) => slots.map(({ taskId, repetition, arm }) => ({ taskId, repetition, arm }));
  assert.deepEqual(stripIds(schedule), stripIds(buildPilotSchedule(suite, 'repeatable-seed')));
  assert.notDeepEqual(stripIds(schedule), stripIds(buildPilotSchedule(suite, 'another-seed')));
  for (const task of suite.tasks) {
    const slots = schedule.filter(slot => slot.taskId === task.id);
    assert.equal(slots.length, task.split === 'evaluation' ? 4 : 0);
    if (slots.length) assert.equal(new Set(slots.map(slot => `${slot.arm}:${slot.repetition}`)).size, 4);
  }
  const tampered = structuredClone(suite); tampered.sources[0].text += 'altered';
  assert.throws(() => validatePilotSuite(tampered), /checksum/);
});

test('fixture pilot completes without any network provider, persists full sources, and never claims a win', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ablatrix-pilot-')), path = join(dir, 'pilot.sqlite');
  const store = new PilotStore(path), provider = fakeProvider({ execute: async () => { throw new Error('Must not call provider in fixture mode.'); } });
  const runner = new PilotRunner(store, loadPilotSuite(), provider);
  const initial = runner.create({ mode: 'fixture' });
  const result = (await runner.wait(initial.id))!;
  assert.equal(result.completedRuns, 32); assert.equal(result.status, 'completed');
  assert.equal(result.decision, 'inconclusive'); assert.equal(result.baseline.costUsd, null);
  assert.equal(result.medianPairedReductionPercent, null); assert.equal(result.baseline.searchCalls, 16); assert.equal(result.candidate.searchCalls, 0);
  assert.equal(result.reviewCount, 32); assert.equal(result.exportReady, true);
  const artifact = runner.export(initial.id);
  assert.equal(artifact.attempts.length, 32); assert.ok(artifact.suite.sources[0].text);
  assert.equal(artifact.attempts[0].review?.kind, 'synthetic');
  await runner.close();
  const reopened = new PilotRunner(new PilotStore(path));
  assert.equal(reopened.get(initial.id)?.completedRuns, 32);
  assert.equal(reopened.export(initial.id).suiteHash, artifact.suiteHash);
  await reopened.close(); rmSync(dir, { recursive: true, force: true });
});

test('production pilot stays blocked even with numeric budget environment flags', async () => {
  const runner = new PilotRunner(new PilotStore());
  assert.equal(runner.readiness().ready, false);
  assert.throws(() => runner.create({ mode: 'live' }), /blocked/);
  assert.equal(runner.overview().runs.length, 0);
  await runner.close();
});

test('metered paired pilot uses identical answer controls and requires blind semantic review', async () => {
  const seen: PilotRequest[] = [], base = fakeProvider();
  const runner = new PilotRunner(new PilotStore(), loadPilotSuite(), fakeProvider({ execute: async request => { seen.push(structuredClone(request)); return base.execute(request); } }));
  const { id } = runner.create({ mode: 'live' });
  const result = (await runner.wait(id))!;
  assert.equal(result.completedRuns, 32); assert.equal(result.decision, 'inconclusive'); assert.equal(result.rows.length, 0);
  assert.throws(() => runner.export(id), /reviews/);
  assert.ok(seen.every(request => request.model === 'gpt-luna' && request.lane === 'run_now' && request.maxTokens === 4096));
  assert.ok(seen.every(request => !('expectedAnswer' in request) && !('requiredFacts' in request)));
  for (const question of new Set(seen.map(request => request.question))) assert.equal(new Set(seen.filter(request => request.question === question).map(request => request.source.sha256)).size, 1);
  const cards = runner.reviewCards(id);
  assert.equal(cards.length, 32); assert.ok(cards.every(card => !('arm' in card) && !('repetition' in card) && !('durationMs' in card)));
  for (const card of cards) runner.review(id, { cardId: card.id, correct: true, supported: true, referenceCorrect: true, notes: 'Checked against the excerpt.' });
  const final = runner.get(id)!;
  assert.equal(final.decision, 'accepted'); assert.equal(final.rows.length, 8); assert.equal(final.regressions, 0);
  assert.equal(final.baseline.costUsd, 0.144); assert.equal(final.candidate.costUsd, 0.048);
  assert.throws(() => runner.review(id, { cardId: cards[0].id, correct: false, supported: false, referenceCorrect: true, notes: '' }), /frozen/);
  await runner.close();
});

test('a semantic regression is rejected even when words and exact quotes match', async () => {
  const base = fakeProvider();
  const runner = new PilotRunner(new PilotStore(), loadPilotSuite(), fakeProvider({ execute: async request => {
    const result = await base.execute(request);
    if (!request.searchEnabled) (result.output as { answer: string }).answer = 'Incorrect claim using relevant words.';
    return result;
  } }));
  const { id } = runner.create({ mode: 'live' }); await runner.wait(id);
  for (const card of runner.reviewCards(id)) {
    const correct = !card.answer.answer.startsWith('Incorrect');
    runner.review(id, { cardId: card.id, correct, supported: correct, referenceCorrect: true, notes: '' });
  }
  assert.equal(runner.get(id)?.decision, 'rejected'); assert.equal(runner.get(id)?.regressions, 8);
  await runner.close();
});

test('missing charges hold the queue after one call and remain blocked after restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ablatrix-pilot-budget-')), path = join(dir, 'pilot.sqlite');
  const base = fakeProvider(); let calls = 0;
  const provider = fakeProvider({ execute: async request => { calls++; return { ...await base.execute(request), charge: null }; } });
  const runner = new PilotRunner(new PilotStore(path), loadPilotSuite(), provider);
  const { id } = runner.create({ mode: 'live' }); await runner.wait(id);
  assert.equal(calls, 1); assert.equal(runner.get(id)?.status, 'blocked'); assert.equal(runner.readiness().ready, false);
  await runner.close();
  const reopened = new PilotRunner(new PilotStore(path), loadPilotSuite(), provider);
  assert.throws(() => reopened.create({ mode: 'live' }), /blocked/);
  await reopened.close(); rmSync(dir, { recursive: true, force: true });
});

test('invalid output is a priced failure with no hidden retry and does not erase other pairs', async () => {
  const base = fakeProvider(); let count = 0;
  const runner = new PilotRunner(new PilotStore(), loadPilotSuite(), fakeProvider({ execute: async request => {
    const result = await base.execute(request); count++;
    if (count === 1) result.output = { answer: 'Unsupported.', citations: [{ url: request.source.url, quote: 'This quote is not in the frozen documentation.' }] };
    return result;
  } }));
  const { id } = runner.create({ mode: 'live' }); await runner.wait(id);
  assert.equal(count, 32); assert.equal(runner.get(id)?.completedRuns, 32);
  assert.equal(runner.get(id)!.baseline.failed + runner.get(id)!.candidate.failed, 1);
  assert.notEqual(runner.get(id)?.baseline.costUsd, null); assert.notEqual(runner.get(id)?.candidate.costUsd, null);
  await runner.close();
});

test('timeouts preserve unknown spend and late replies cannot overwrite the failed attempt', async () => {
  let resolve!: (result: PilotProviderResult) => void;
  const runner = new PilotRunner(new PilotStore(), loadPilotSuite(), fakeProvider({ execute: () => new Promise(done => { resolve = done; }) }), 5);
  const { id } = runner.create({ mode: 'live' }); await runner.wait(id);
  const before = runner.get(id)!;
  assert.equal(before.status, 'blocked'); assert.equal(before.completedRuns, 1);
  assert.ok(before.baseline.modelCalls === null || before.candidate.modelCalls === null);
  resolve({ status: 'completed', output: {}, model: 'gpt-luna', modelVerified: true, charge: { micros: 1, reference: 'late' }, calls: { search: 0, model: 1 }, usage: null, executionId: 'late' });
  await new Promise(done => setImmediate(done)); assert.deepEqual(runner.get(id), before);
  await runner.close();
});

test('budget includes prior spend and refuses the full run before dispatch', async () => {
  const runner = new PilotRunner(new PilotStore(), loadPilotSuite(), fakeProvider({ readiness: () => ({ ready: true, reason: 'test', capReference: 'test:cap', preflightReference: 'test:both-arms', capMicros: 10_000_000, priorSpendMicros: 9_900_000, maxCallMicros: 10_000 }) }));
  assert.throws(() => runner.create({ mode: 'live' }), /32 bounded calls/);
  assert.equal(runner.overview().runs.length, 0); await runner.close();
});

test('over-bound failures preserve actual spend and request identity while halting later calls', async () => {
  const store = new PilotStore(), base = fakeProvider();
  const runner = new PilotRunner(store, loadPilotSuite(), fakeProvider({ execute: async request => ({ ...await base.execute(request), charge: { micros: 11_000, reference: 'over-bound' }, executionId: 'execution-over', requestId: 'router-over' }) }));
  const { id } = runner.create({ mode: 'live' }); await runner.wait(id);
  assert.equal(runner.get(id)?.status, 'blocked'); assert.equal(runner.get(id)?.completedRuns, 1);
  assert.equal(store.reservedTotal(), 11_000); assert.equal(runner.readiness().ready, false);
  const attempt = runner.export(id).attempts[0];
  assert.equal(attempt.charge?.micros, 11_000); assert.equal(attempt.executionId, 'execution-over'); assert.equal(attempt.requestId, 'router-over');
  await runner.close();
});

test('an unverified answer model stops the batch after its settled call', async () => {
  const base = fakeProvider();
  const runner = new PilotRunner(new PilotStore(), loadPilotSuite(), fakeProvider({ execute: async request => ({ ...await base.execute(request), model: 'some-other-model', modelVerified: false }) }));
  const { id } = runner.create({ mode: 'live' }); await runner.wait(id);
  assert.equal(runner.get(id)?.status, 'blocked'); assert.equal(runner.get(id)?.completedRuns, 1);
  assert.equal(runner.export(id).attempts[0].charge?.reference.startsWith('test:'), true);
  await runner.close();
});

test('returned model identity is frozen across arms even when both identifiers are known aliases', async () => {
  const base = fakeProvider();
  const runner = new PilotRunner(new PilotStore(), loadPilotSuite(), fakeProvider({ execute: async request => ({ ...await base.execute(request), model: request.searchEnabled ? 'gpt-luna' : 'gpt-5.6-luna' }) }));
  const { id } = runner.create({ mode: 'live' }); await runner.wait(id);
  assert.equal(runner.get(id)?.status, 'blocked'); assert.equal(runner.get(id)?.completedRuns, 2);
  assert.match(runner.get(id)?.error ?? '', /identifier changed/);
  await runner.close();
});

test('cancellation finishes the current paid call and stops the next slot', async () => {
  let release!: () => void;
  const base = fakeProvider();
  const runner = new PilotRunner(new PilotStore(), loadPilotSuite(), fakeProvider({ execute: async request => { await new Promise<void>(resolve => { release = resolve; }); return base.execute(request); } }));
  const { id } = runner.create({ mode: 'live' });
  await new Promise(done => setImmediate(done)); runner.cancel(id); release(); await runner.wait(id);
  assert.equal(runner.get(id)?.status, 'cancelled'); assert.equal(runner.get(id)?.completedRuns, 1);
  await runner.close();
});
