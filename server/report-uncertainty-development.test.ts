import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { REPORT_DEVELOPMENT_PATHS, freezeReportUncertaintyDevelopment, replayReportUncertaintyDevelopment, reportDevelopmentImplementation, verifyReportUncertaintyDevelopment } from './report-uncertainty-development.ts';

/** Copy only already exposed public inputs and implementation bytes. No .data, credentials, model cache or fresh pool. */
function fixture() {
  const source = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'ablatrix-v6-public-replay-')));
  const pending = [...Object.values(REPORT_DEVELOPMENT_PATHS), ...Object.keys(reportDevelopmentImplementation(source))];
  const seen = new Set<string>();
  while (pending.length) {
    const path = pending.pop()!; if (seen.has(path)) continue; seen.add(path);
    mkdirSync(dirname(resolve(root, path)), { recursive: true }); copyFileSync(resolve(source, path), resolve(root, path));
    if (path.endsWith('.json')) {
      const value = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
      for (const map of [value.codeSha256, value.inputSha256]) if (map) pending.push(...Object.keys(map));
    }
  }
  const directory = 'docs/evidence/SYNTHETIC-v6-replay-test'; mkdirSync(resolve(root, directory));
  const freeze = `${directory}/candidate-freeze.json`, policy = `${directory}/policy-freeze.json`;
  return { root, freeze, policy, freezeNow: () => freezeReportUncertaintyDevelopment(freeze, policy, root),
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('frozen v6 replay retains all twelve exposed cases, unchanged inputs/prefixes and all unknown cases without model calls', async () => {
  const f = fixture();
  try {
    f.freezeNow(); const result = await replayReportUncertaintyDevelopment(f.freeze, f.root);
    assert.deepEqual({ cases: result.summary.cases, baseline: result.summary.baselineDelivered, v5: result.summary.v5Delivered, v6: result.summary.v6Delivered, designated: result.summary.designatedFacts,
      prefixes: result.summary.baselinePrefixesRetained, v5Additions: result.summary.v5Additions, v6Additions: result.summary.v6Additions },
    { cases: 12, baseline: 10, v5: 12, v6: 13, designated: 13, prefixes: 12, v5Additions: 16, v6Additions: 16 });
    assert.deepEqual(result.summary.changedCases, ['source-coverage-v2-train-12870']); assert.deepEqual(result.summary.regressionsAgainstV5, []);
    assert.equal(result.results.filter(r => r.designatedFacts === 0).length, 5, 'Unlabeled uncertainty is retained rather than counted as correctness.');
    const peer = result.results.find(r => r.caseId === 'source-coverage-v2-train-12870')!.candidate.peerSelection.applied;
    assert.equal(peer.peer.rerankerRank, 6); assert.equal(peer.peer.rerankerLogit, -6.578994274139404);
    assert.equal(peer.unit, 'hour'); assert.equal(result.providerCalls, 0); assert.equal(result.generatedAnswers, 0); assert.equal(result.freshInputReads, 0); assert.equal(result.qualityClaimEligible, false);
    await verifyReportUncertaintyDevelopment(result, f.freeze, f.root);
    assert.throws(f.freezeNow);
  } finally { f.cleanup(); }
});

test('saved output verification rejects altered delivery, literal context and conditional anchor/scope trace', async () => {
  const f = fixture();
  try {
    f.freezeNow(); const saved = await replayReportUncertaintyDevelopment(f.freeze, f.root);
    for (const mutate of [
      (r: typeof saved) => { r.summary.v6Delivered++; },
      (r: typeof saved) => { r.results[0]!.candidate.passages.push({ ...r.results[0]!.candidate.passages[0]!, id: 'SYNTHETIC-forged-append' }); },
      (r: typeof saved) => { r.results.find(r => r.candidate.peerSelection.applied)!.candidate.peerSelection.applied.unit = 'year'; },
      (r: typeof saved) => { r.results.find(r => r.candidate.peerSelection.applied)!.candidate.peerSelection.applied.peer.originalQuestion = 'SYNTHETIC another model?'; },
    ]) { const changed = structuredClone(saved); mutate(changed); await assert.rejects(verifyReportUncertaintyDevelopment(changed, f.freeze, f.root), /Replay every candidate row/); }
    const observational = structuredClone(saved); observational.results[0]!.candidate.proposal.resources.elapsedMs += 999;
    await verifyReportUncertaintyDevelopment(observational, f.freeze, f.root);
  } finally { f.cleanup(); }
});

test('frozen code, raw source inputs and declared candidate changes reject before replay can bless a result', async () => {
  for (const which of ['code', 'source', 'candidate'] as const) {
    const f = fixture();
    try {
      f.freezeNow();
      if (which === 'code') writeFileSync(resolve(f.root, 'server/semantic-supplement-v6.ts'), '// SYNTHETIC altered implementation\n');
      else if (which === 'source') writeFileSync(resolve(f.root, REPORT_DEVELOPMENT_PATHS.deck), readFileSync(resolve(f.root, REPORT_DEVELOPMENT_PATHS.deck), 'utf8') + ' ');
      else { const path = resolve(f.root, f.freeze), value = JSON.parse(readFileSync(path, 'utf8')); value.candidate.peerAbsoluteFloor = -10; writeFileSync(path, JSON.stringify(value)); }
      await assert.rejects(replayReportUncertaintyDevelopment(f.freeze, f.root));
    } finally { f.cleanup(); }
  }
});
