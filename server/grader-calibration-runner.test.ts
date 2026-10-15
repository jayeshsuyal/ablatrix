import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SapiomFeedbackProvider } from './feedback-provider.ts';
import { claimSupportAnswerUnits, type ClaimSupportReceipt } from './claim-support.ts';
import { CALIBRATION_CODE_FILES, calibrationHash, prepareCalibrationPlan, type CalibrationPlan, type CalibrationPlanSlot } from './grader-calibration.ts';
import { executeGraderCalibration, verifyGraderCalibrationCheckpoint, type CalibrationExecutionDependencies, type CalibrationExecutionOptions } from './grader-calibration-runner.ts';

function seedLedger(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE loop_provider_calls(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,kind TEXT NOT NULL,allowance_usd REAL NOT NULL,status TEXT NOT NULL,model TEXT,input_tokens INTEGER,output_tokens INTEGER,run_id TEXT,error_code TEXT,receipt_json TEXT);`);
  const insert = db.prepare('INSERT INTO loop_provider_calls(id,created_at,kind,allowance_usd,status,run_id) VALUES(?,?,?,?,?,?)');
  for (let index = 0; index < 86; index++) insert.run(`scripted-historical-metadata-${index}`, '2026-10-14T00:00:00.000Z', 'scripted_metadata_only', .1, 'completed', `scripted-historical-run-${index}`);
  db.close();
}
function rows(path: string) { const db = new DatabaseSync(path, { readOnly: true }); try { return db.prepare('SELECT * FROM loop_provider_calls ORDER BY id').all(); } finally { db.close(); } }
function fixtureOutput(slot: CalibrationPlanSlot, wrong = false) {
  const reference = slot.reference, supported = wrong || reference.support === 'supported', contradicted = !wrong && reference.support === 'contradicted', nonFactual = !wrong && reference.support === 'non_factual';
  const proof = contradicted ? reference.spans.filter(span => span.role === 'conflict').map(span => ({ sourceId: span.sourceId, quote: span.quote, relation: 'contradicts' })) : supported ? slot.input.answer.citations.map(citation => ({ sourceId: citation.passageId, quote: citation.quote, relation: 'supports' })) : [];
  return { units: claimSupportAnswerUnits(slot.input.answer.answer).map(unit => ({ unitId: unit.id, verdict: nonFactual ? 'non_factual' : contradicted ? 'contradicted' : supported ? 'supported' : 'unsupported', evidence: proof, reason: 'SYNTHETIC mocked transport mechanics only.' })),
    questionCoverage: wrong ? 'complete' : reference.questionCoverage, answerability: wrong ? 'answerable' : reference.acceptableAxes.answerability[0], correctness: wrong ? 'consistent_with_sources' : reference.acceptableAxes.correctness[0], uncertaintyHandling: wrong ? 'appropriate' : reference.uncertaintyHandling, reason: 'SYNTHETIC mechanics fixture; no live calibration evidence.' };
}
function response(output: unknown) { return new Response(JSON.stringify({ model: 'gpt-luna', usage: { prompt_tokens: 100, completion_tokens: 60 }, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: 'claim_support_v1', arguments: JSON.stringify(output) } }] } }] })); }
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'grader-calibration-runner-')), ledgerPath = join(directory, 'ledger.sqlite'); seedLedger(ledgerPath);
  const historical = calibrationHash(rows(ledgerPath));
  const callerScope = { repositoryPath: directory, budgetPath: ledgerPath, reviewPath: join(directory, 'review.sqlite'), appDbPath: join(directory, 'app.sqlite'), loopDbPath: join(directory, 'loop.sqlite'), workspaceDbPath: join(directory, 'workspace.sqlite'), runtimePolicyDbPath: join(directory, 'runtime.sqlite'), claimDirectory: join(directory, 'claims'), configuredPort: '4194', initiatingThreadId: 'mocked-runner-test', executionAuthority: 'parent_execution_only', ledgerInitialSha256: historical };
  const codeFileSha256 = Object.fromEntries([...new Set([...CALIBRATION_CODE_FILES, 'server/source-id-diagnostic.ts'])].map(path => [path, calibrationHash(`SYNTHETIC mocked code identity: ${path}`)]));
  const verification = { callerScope, codeFileSha256, implementationCommit: '1'.repeat(40) };
  const plan = prepareCalibrationPlan(verification);
  const options: CalibrationExecutionOptions = { plan, execute: true, liveOptIn: true, acknowledgedPlanSha256: plan.planSha256, ledgerPath, claimDirectory: callerScope.claimDirectory, checkpointPath: join(directory, 'private-checkpoint.jsonl'), reportPath: join(directory, 'public-report.json'), transportProvenance: 'mocked_mechanics_only' };
  let factoryCalls = 0, networkCalls = 0, preflightDone = false, preflightBoundaryDone = false;
  const boundaries: string[] = [];
  const readLedgerReceipts = (value: CalibrationPlan) => {
    const db = new DatabaseSync(ledgerPath, { readOnly: true });
    try { return Object.fromEntries(value.slots.map(slot => {
      const receipts = db.prepare('SELECT id,kind,status,model,input_tokens,output_tokens,error_code,receipt_json,allowance_usd FROM loop_provider_calls WHERE run_id=?').all(slot.input.runId) as ClaimSupportReceipt[];
      assert.ok(receipts.length <= 1); return [slot.input.runId, receipts[0] ?? null];
    })); } finally { db.close(); }
  };
  const dependencies: CalibrationExecutionDependencies = { verification, readLedgerReceipts,
    async preflight() { const initial = rows(ledgerPath); assert.equal(initial.length, 86); assert.equal(calibrationHash(initial), historical); preflightDone = true; },
    async inspectBoundary(boundary) {
      boundaries.push(boundary.phase);
      const all = rows(ledgerPath), historicalNow = all.filter(row => String(row.id).startsWith('scripted-historical-metadata-'));
      assert.equal(calibrationHash(historicalNow), historical);
      assert.equal(all.length, 86 + boundary.reservedRunIds.length); assert.ok(all.length <= 96);
      const reservation = all.reduce((sum, row) => sum + Number(row.allowance_usd), 0);
      assert.ok(reservation <= 9.6 + 1e-9); assert.ok(.200281 + reservation <= 10);
      const pending = all.filter(row => row.status === 'pending');
      assert.ok(pending.every(row => row.run_id === boundary.runId));
      if (boundary.phase === 'preflight') { assert.equal(factoryCalls, 0); preflightBoundaryDone = true; }
      if (boundary.phase === 'before_transport' || boundary.phase === 'after_reservation') {
        assert.equal(pending.length, 1);
        const document = JSON.parse(String(pending[0].receipt_json));
        assert.equal(document.requestSha256, plan.slots[boundary.slotIndex!].requestSha256);
        assert.equal(String(pending[0].id), boundary.attemptId);
      }
    },
    createProvider(hooks) { factoryCalls++; assert.ok(preflightDone && preflightBoundaryDone); return new SapiomFeedbackProvider({ enabled: true, apiKey: 'synthetic-placeholder', credentialsFile: '', dbPath: ledgerPath, capUsd: 10, priorSpendUsd: .200281, allowancePerCallUsd: .1, callLimit: 96, ...hooks }); },
    async transport(url, init) {
      networkCalls++; assert.equal(url, 'https://router.sapiom.ai/v1/chat/completions'); assert.equal(init?.redirect, 'error'); assert.ok(init?.signal);
      const slot = plan.slots[networkCalls - 1]; assert.deepEqual(JSON.parse(String(init?.body)), slot.requestBody); return response(fixtureOutput(slot));
    }
  };
  return { directory, ledgerPath, historical, plan, options, dependencies, readLedgerReceipts, boundaries, counts: () => ({ factoryCalls, networkCalls }), cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test('calibration performs exactly ten guarded frozen calls in the existing finite ledger and reconstructs every slot', async () => {
  const fixture = setup();
  try {
    const result = await executeGraderCalibration(fixture.options, fixture.dependencies);
    assert.equal(result.stopped, false); assert.equal(result.report.complete, true);
    assert.equal(result.report.evidenceMode, 'mocked_transport_mechanics_only'); assert.equal(result.report.qualityClaimEligible, false); assert.equal(result.report.productionActivationQualified, false);
    assert.equal(result.report.slots.length, 10); assert.equal(fixture.counts().networkCalls, 10); assert.equal(fixture.counts().factoryCalls, 1);
    assert.equal(rows(fixture.ledgerPath).length, 96); assert.equal(result.report.metrics.overall.expectedBad, 5);
    assert.equal(fixture.boundaries.filter(value => value === 'before_transport').length, 10); assert.equal(fixture.boundaries.filter(value => value === 'after_transport').length, 10);
    assert.equal(fixture.boundaries.filter(value => value === 'after_operation').length, 10); assert.equal(fixture.boundaries.filter(value => value === 'before_report_publish').length, 1);
    assert.equal(result.report.checkpointProof.records.filter(record => record.kind === 'slot_reserved').length, 10);
    assert.deepEqual(verifyGraderCalibrationCheckpoint(fixture.options, fixture.dependencies).report, result.report);
    await assert.rejects(executeGraderCalibration(fixture.options, fixture.dependencies), /existing durable intent/);
    assert.equal(fixture.counts().networkCalls, 10);
  } finally { fixture.cleanup(); }
});

test('all full preflight gates precede provider creation, credentials, intent and transport', async () => {
  for (const behavior of ['execute', 'optin', 'ack', 'code', 'code-during-preflight', 'plan-during-preflight', 'preflight', 'boundary', 'ledger', 'scope'] as const) {
    const fixture = setup();
    try {
      const options = { ...fixture.options }, dependencies = { ...fixture.dependencies };
      if (behavior === 'execute') options.execute = false;
      if (behavior === 'optin') options.liveOptIn = false;
      if (behavior === 'ack') options.acknowledgedPlanSha256 = '0'.repeat(64);
      if (behavior === 'code') dependencies.verification = { ...dependencies.verification, codeFileSha256: { ...dependencies.verification.codeFileSha256, 'server/claim-support.ts': '0'.repeat(64) } };
      if (behavior === 'code-during-preflight') dependencies.preflight = async () => { dependencies.verification = { ...dependencies.verification, codeFileSha256: { ...dependencies.verification.codeFileSha256, 'server/claim-support.ts': '0'.repeat(64) } }; };
      if (behavior === 'plan-during-preflight') dependencies.preflight = async plan => { plan.slots[0].reference.rationale += ' Changed during preflight.'; };
      if (behavior === 'preflight') dependencies.preflight = async () => { throw new Error('SYNTHETIC merged-code/OS preflight rejection'); };
      if (behavior === 'boundary') dependencies.inspectBoundary = async () => { throw new Error('SYNTHETIC changed listener or pending worker'); };
      if (behavior === 'ledger') dependencies.readLedgerReceipts = plan => ({ [plan.slots[0].input.runId]: { id: 'recorded-attempt', kind: 'claim_support_v1', status: 'pending', model: null, error_code: null, receipt_json: null } });
      if (behavior === 'scope') options.claimDirectory = join(fixture.directory, 'unapproved-claim-root');
      await assert.rejects(executeGraderCalibration(options, dependencies));
      assert.deepEqual(fixture.counts(), { factoryCalls: 0, networkCalls: 0 }); assert.equal(rows(fixture.ledgerPath).length, 86);
      assert.equal(existsSync(options.checkpointPath), false); assert.equal(existsSync(options.reportPath), false);
    } finally { fixture.cleanup(); }
  }
});

test('unknown and malformed outcomes stop without hiding expected-bad denominators or resuming dispatch', async () => {
  for (const behavior of ['unknown', 'malformed'] as const) {
    const fixture = setup(); let calls = 0;
    fixture.dependencies.transport = async () => { calls++; if (behavior === 'unknown') throw new Error('SYNTHETIC unknown network outcome'); return response({ ...fixtureOutput(fixture.plan.slots[0]), units: [] }); };
    try {
      const result = await executeGraderCalibration(fixture.options, fixture.dependencies);
      assert.equal(result.report.complete, false); assert.equal(result.report.slots[0].status, behavior === 'unknown' ? 'unknown' : 'invalid');
      assert.equal(result.report.slots.filter(slot => slot.status === 'unattempted').length, 9); assert.equal(result.report.metrics.overall.expectedBad, 5);
      assert.equal(result.report.metrics.overall.acceptedBadOverExpectedBad.denominator, 5); assert.equal(rows(fixture.ledgerPath).length, 87); assert.equal(calls, 1);
      assert.deepEqual(verifyGraderCalibrationCheckpoint(fixture.options, fixture.dependencies).report, result.report);
      await assert.rejects(executeGraderCalibration({ ...fixture.options, checkpointPath: join(fixture.directory, 'other-journal'), reportPath: join(fixture.directory, 'other-report') }, fixture.dependencies), /existing durable intent/);
      assert.equal(calls, 1); assert.equal(fixture.counts().factoryCalls, 1);
    } finally { fixture.cleanup(); }
  }
});

test('a well-formed semantically wrong grade continues through every frozen slot', async () => {
  const fixture = setup(); let calls = 0;
  fixture.dependencies.transport = async () => { const slot = fixture.plan.slots[calls++]; return response(fixtureOutput(slot, slot.reference.answerQuality === 'flawed')); };
  try {
    const result = await executeGraderCalibration(fixture.options, fixture.dependencies);
    assert.equal(calls, 10); assert.equal(result.report.complete, true);
    assert.ok(result.report.metrics.overall.expectedBadPassed > 0); assert.equal(result.report.metrics.overall.expectedBad, 5);
  } finally { fixture.cleanup(); }
});

test('the transport rejects altered requests and a second dispatch under the same reserved slot', async () => {
  for (const behavior of ['body', 'model', 'destination', 'method', 'duplicate'] as const) {
    const fixture = setup(), create = fixture.dependencies.createProvider;
    fixture.dependencies.createProvider = hooks => create({ ...hooks, fetchImpl: async (url, init) => {
      if (behavior === 'duplicate') { const first = await hooks.fetchImpl(url, init); await hooks.fetchImpl(url, init); return first; }
      if (behavior === 'destination') return hooks.fetchImpl('https://example.invalid/forbidden', init);
      if (behavior === 'method') return hooks.fetchImpl(url, { ...init, method: 'GET' });
      if (behavior === 'model') { const body = JSON.parse(String(init?.body)); body.model = 'unapproved-model'; return hooks.fetchImpl(url, { ...init, body: JSON.stringify(body) }); }
      return hooks.fetchImpl(url, { ...init, body: '{}' });
    } });
    try {
      const result = await executeGraderCalibration(fixture.options, fixture.dependencies);
      assert.equal(result.stopped, true); assert.equal(result.report.slots[0].status, 'unknown');
      assert.equal(fixture.counts().networkCalls, behavior === 'duplicate' ? 1 : 0); assert.equal(rows(fixture.ledgerPath).length, 87);
      assert.equal(result.report.slots.filter(slot => slot.status === 'unattempted').length, 9);
    } finally { fixture.cleanup(); }
  }
});

test('journal deletion, edits, anchor truncation and swapped or altered ledger receipts cannot verify or reopen execution', async () => {
  const fixture = setup();
  try {
    const result = await executeGraderCalibration(fixture.options, fixture.dependencies);
    const journal = readFileSync(result.checkpointPath, 'utf8'), anchor = readFileSync(result.claimPath, 'utf8'), publicReport = readFileSync(result.reportPath, 'utf8');
    writeFileSync(result.checkpointPath, journal.replace('slot_observed', 'slot_started'));
    assert.throws(() => verifyGraderCalibrationCheckpoint(fixture.options, fixture.dependencies), /checkpoint|journal|claim/);
    writeFileSync(result.checkpointPath, journal); writeFileSync(result.claimPath, anchor.split('\n').slice(0, -2).join('\n') + '\n');
    assert.throws(() => verifyGraderCalibrationCheckpoint(fixture.options, fixture.dependencies), /record counts/);
    writeFileSync(result.claimPath, anchor);
    const first = fixture.readLedgerReceipts(fixture.plan)[fixture.plan.slots[0].input.runId]!, second = fixture.readLedgerReceipts(fixture.plan)[fixture.plan.slots[1].input.runId]!;
    const db = new DatabaseSync(fixture.ledgerPath);
    db.prepare('UPDATE loop_provider_calls SET receipt_json=? WHERE id=?').run(second.receipt_json, first.id); db.close();
    assert.throws(() => verifyGraderCalibrationCheckpoint(fixture.options, fixture.dependencies), /trusted ledger/);
    const restored = new DatabaseSync(fixture.ledgerPath); restored.prepare('UPDATE loop_provider_calls SET receipt_json=? WHERE id=?').run(first.receipt_json, first.id); restored.close();
    chmodSync(result.reportPath, 0o600); writeFileSync(result.reportPath, '{}');
    assert.throws(() => verifyGraderCalibrationCheckpoint(fixture.options, fixture.dependencies), /Immutable calibration report/);
    writeFileSync(result.reportPath, publicReport);
    rmSync(result.checkpointPath); assert.throws(() => verifyGraderCalibrationCheckpoint(fixture.options, fixture.dependencies));
    await assert.rejects(executeGraderCalibration({ ...fixture.options, checkpointPath: join(fixture.directory, 'replacement-checkpoint'), reportPath: join(fixture.directory, 'replacement-report') }, fixture.dependencies), /existing durable intent/);
    assert.equal(fixture.counts().networkCalls, 10);
  } finally { fixture.cleanup(); }
});

test('a durable intent before provider construction blocks changed-path restart even with no reservation', async () => {
  const fixture = setup(); let factories = 0;
  fixture.dependencies.createProvider = () => { factories++; throw new Error('SYNTHETIC provider unavailable after durable intent'); };
  try {
    const result = await executeGraderCalibration(fixture.options, fixture.dependencies);
    assert.equal(result.report.slots.filter(slot => slot.status === 'unattempted').length, 10); assert.equal(rows(fixture.ledgerPath).length, 86);
    await assert.rejects(executeGraderCalibration({ ...fixture.options, checkpointPath: join(fixture.directory, 'new-checkpoint'), reportPath: join(fixture.directory, 'new-report') }, fixture.dependencies), /existing durable intent/);
    assert.equal(factories, 1);
  } finally { fixture.cleanup(); }
});

test('read-only replay inspects a single unanchored append without trusting its grade, timing or completion', async () => {
  for (const recordCount of [0, 1, 2, 3, 4, 32]) {
    const fixture = setup();
    try {
      const result = await executeGraderCalibration(fixture.options, fixture.dependencies);
      const records = result.report.checkpointProof.records.slice(0, recordCount);
      const originalAnchors = readFileSync(result.claimPath, 'utf8').trimEnd().split('\n');
      const anchors = originalAnchors.slice(0, Math.max(1, recordCount));
      rmSync(result.reportPath);
      writeFileSync(result.checkpointPath, records.map(record => JSON.stringify(record) + '\n').join(''));
      writeFileSync(result.claimPath, anchors.join('\n') + '\n');
      // Model a crash at this write boundary: no later reservation occurred.
      const db = new DatabaseSync(fixture.ledgerPath);
      for (const slot of fixture.plan.slots) if (!records.some(record => record.kind === 'slot_reserved' && record.runId === slot.input.runId)) db.prepare('DELETE FROM loop_provider_calls WHERE run_id=?').run(slot.input.runId);
      db.close();
      const before = [readFileSync(result.checkpointPath, 'utf8'), readFileSync(result.claimPath, 'utf8')];
      const counts = fixture.counts();
      const replay = verifyGraderCalibrationCheckpoint(fixture.options, fixture.dependencies);
      assert.equal(replay.report.complete, false); assert.equal(replay.stopped, true);
      assert.equal(replay.report.checkpointProof.recordCount, Math.max(0, recordCount - 1));
      assert.equal(replay.report.accounting.reservedSlots, records.filter(record => record.kind === 'slot_reserved').length);
      if (recordCount) {
        assert.equal(replay.checkpointInspection?.state, 'one_record_append_window');
        assert.deepEqual(replay.checkpointInspection?.unanchoredTail, records.at(-1));
        assert.match(replay.checkpointInspection?.explanation ?? '', /anchor deletion/);
      } else assert.equal(replay.checkpointInspection, undefined);
      if (recordCount === 4) { assert.equal(replay.report.slots[0].status, 'unknown'); assert.equal(replay.report.accounting.validGrades, 0); assert.equal(replay.report.accounting.exactTransportCount, null); }
      if (recordCount === 32) { assert.equal(replay.report.terminal.kind, 'interrupted'); assert.equal(replay.report.accounting.validGrades, 10); }
      assert.deepEqual([readFileSync(result.checkpointPath, 'utf8'), readFileSync(result.claimPath, 'utf8')], before);
      assert.equal(existsSync(result.reportPath), false); assert.deepEqual(fixture.counts(), counts);
      await assert.rejects(executeGraderCalibration(fixture.options, fixture.dependencies), /existing durable intent/);
      if (recordCount === 4) {
        writeFileSync(result.claimPath, anchors.slice(0, -1).join('\n') + '\n');
        assert.throws(() => verifyGraderCalibrationCheckpoint(fixture.options, fixture.dependencies), /record counts/);
        writeFileSync(result.claimPath, before[1]);
        const tail = structuredClone(records.at(-1)!); tail.receipt!.error_code = 'altered-unanchored-receipt'; tail.receiptSha256 = calibrationHash(tail.receipt);
        const { sha256: _old, ...body } = tail; tail.sha256 = calibrationHash(body);
        writeFileSync(result.checkpointPath, [...records.slice(0, -1), tail].map(record => JSON.stringify(record) + '\n').join(''));
        assert.throws(() => verifyGraderCalibrationCheckpoint(fixture.options, fixture.dependencies), /trusted ledger/);
      }
    } finally { fixture.cleanup(); }
  }
});

test('a historical change while the final response body streams cannot publish a completed report', { timeout: 15_000 }, async () => {
  const fixture = setup(), inspect = fixture.dependencies.inspectBoundary;
  let calls = 0, headersObserved!: () => void;
  const afterFinalHeaders = new Promise<void>(resolveHeaders => { headersObserved = resolveHeaders; });
  fixture.dependencies.inspectBoundary = async boundary => { await inspect(boundary); if (boundary.phase === 'after_transport' && boundary.slotIndex === 9) headersObserved(); };
  fixture.dependencies.transport = async () => {
    const slot = fixture.plan.slots[calls++];
    if (slot.index !== 9) return response(fixtureOutput(slot));
    const encoded = new TextEncoder().encode(await response(fixtureOutput(slot)).text());
    return new Response(new ReadableStream<Uint8Array>({ async pull(controller) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([afterFinalHeaders, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('SYNTHETIC final response headers were not observed within five seconds.')), 5_000); })]); }
      finally { if (timer) clearTimeout(timer); }
      const db = new DatabaseSync(fixture.ledgerPath); db.prepare('UPDATE loop_provider_calls SET kind=? WHERE id=?').run('scripted-unexpected-history-change', 'scripted-historical-metadata-0'); db.close();
      controller.enqueue(encoded); controller.close();
    } }));
  };
  try {
    const result = await executeGraderCalibration(fixture.options, fixture.dependencies);
    assert.equal(calls, 10); assert.equal(rows(fixture.ledgerPath).length, 96);
    assert.equal(result.report.slots.filter(slot => ['accepted', 'rejected', 'uncertain'].includes(slot.status)).length, 10);
    assert.equal(result.report.complete, false); assert.equal(result.stopped, true);
    assert.equal(result.report.checkpointProof.records.at(-1)?.kind, 'stopped');
    assert.match(result.report.checkpointProof.records.at(-1)?.reason ?? '', /after_operation_boundary_failed/);
    assert.match(result.report.checkpointProof.records.at(-1)?.reason ?? '', /before_report_publish_boundary_failed/);
    assert.deepEqual(result.report.terminal.stopReasons, ['after_operation_boundary_failed', 'before_report_publish_boundary_failed']);
  } finally { headersObserved(); fixture.cleanup(); }
});

test('the final boundary runs after provider close and can stop ten otherwise valid observations', async () => {
  const fixture = setup(), inspect = fixture.dependencies.inspectBoundary;
  fixture.dependencies.inspectBoundary = async boundary => {
    await inspect(boundary);
    if (boundary.phase === 'before_report_publish') {
      const db = new DatabaseSync(fixture.ledgerPath, { readOnly: true });
      try { assert.equal(db.prepare('SELECT count(*) AS count FROM loop_provider_owner').get()!.count, 0); } finally { db.close(); }
      throw new Error('SYNTHETIC final listener/owner state changed');
    }
  };
  try {
    const result = await executeGraderCalibration(fixture.options, fixture.dependencies);
    assert.equal(result.report.complete, false); assert.equal(result.report.slots.filter(slot => ['accepted', 'rejected', 'uncertain'].includes(slot.status)).length, 10);
    assert.equal(result.report.checkpointProof.records.at(-1)?.kind, 'stopped'); assert.match(result.report.checkpointProof.records.at(-1)?.reason ?? '', /before_report_publish_boundary_failed/);
    assert.deepEqual(result.report.terminal.stopReasons, ['before_report_publish_boundary_failed']);
    assert.deepEqual(verifyGraderCalibrationCheckpoint(fixture.options, fixture.dependencies).report, result.report);
  } finally { fixture.cleanup(); }
});
