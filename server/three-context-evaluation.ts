import assert from 'node:assert/strict';
import { readFileSync, realpathSync, lstatSync, openSync, writeFileSync, closeSync, fsyncSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { ANSWER_DIAGNOSTIC_RUBRIC, calibratedAIReview, type SourceCheckedJudgment } from './answer-diagnostic-evaluation.ts';
import { anonymousDiagnosticReview, diagnosticHash, type DiagnosticCheckpoint } from './three-context-diagnostic.ts';
import { verifyThreeContextLiveCheckpoints, type ThreeContextLiveManifest } from './three-context-live.ts';
import { textHash } from './product-corpus.ts';
import { sourceCitationEvidence } from './citation-options.ts';

const literalCitation = (source: { id: string; source: string; text: string; originalQuestion?: string }, citation: { passageId: string; quote: string }) =>
  source.id === citation.passageId && sourceCitationEvidence([source])[0]!.text === citation.quote;

/** An offline observer only: no provider, ledger, environment or arm mapping is read. */
export function prepareThreeContextEvaluation(manifest: ThreeContextLiveManifest, checkpoints: DiagnosticCheckpoint[], savedResult: unknown,
  review: ReturnType<typeof anonymousDiagnosticReview>['review']) {
  assert.deepEqual(savedResult, verifyThreeContextLiveCheckpoints(manifest, checkpoints), 'Saved result must equal full journal/receipt replay.');
  const expected = anonymousDiagnosticReview(manifest.diagnostic, checkpoints.at(-1)!, 'evaluation-verifier-does-not-reveal-private-order').review;
  const { answers, ...header } = review, { answers: expectedAnswers, ...expectedHeader } = expected;
  assert.deepEqual(header, expectedHeader, 'Review sources, scope and qualifications must match the frozen manifest.');
  assert.deepEqual(answers.map(a => a.label).sort(), expectedAnswers.map(a => a.label).sort(), 'Neutral labels must be unique and complete.');
  const observations = (rows: typeof answers) => rows.map(({ label: _label, ...row }) => JSON.stringify(row)).sort();
  assert.deepEqual(observations(answers), observations(expectedAnswers), 'Anonymous answers must equal replayed receipt outputs, including failed/unattempted entries.');
  for (const answer of answers) assert.deepEqual(Object.keys(answer).sort(), ['caseId', 'label', 'output', 'status']);
  const publicBytes = JSON.stringify(review);
  for (const [i, slot] of manifest.diagnostic.document.slots.entries()) {
    assert.ok(!publicBytes.includes(slot.input.runId), 'Operation identity in answer text would reveal its arm.');
    const attemptId = checkpoints.at(-1)!.steps[i]!.attemptId; if (attemptId) assert.ok(!publicBytes.includes(attemptId), 'Attempt identity must remain private.');
  }
  const cases = review.cases.map(c => ({ id: c.id, product: c.product, question: c.question,
    // Ranking observations are not needed for answer review. Complete literal
    // source bodies and original customer-question scope are kept for every arm.
    completeSources: c.completeSources.map(({ lexicalRank: _l, semanticRank: _s, score: _score, ...source }) => {
      const scoped = sourceCitationEvidence([source])[0]!;
      return { ...source, ...(scoped.originalQuestion !== undefined ? { originalQuestion: scoped.originalQuestion } : {}) };
    }),
    designatedFacts: c.designatedFacts.map((fact, i) => ({ ...fact, factId: `fact-${i + 1}-${diagnosticHash(fact).slice(0, 12)}` })), unknowns: c.unknowns,
    referenceReviewProvenance: manifest.preparation.diagnostic.cases.find(item => item.id === c.id)!.referenceReview.provenance }));
  const packetAnswers = answers.map(answer => {
    const item = cases.find(c => c.id === answer.caseId)!;
    const citations = answer.output?.citations ?? [];
    for (const citation of citations) assert.ok(item.completeSources.some(s => literalCitation(s, citation)), 'Citation must equal a whole offered literal body.');
    return { ...structuredClone(answer), sourcePoolSha256: diagnosticHash(item.completeSources), answerSha256: diagnosticHash({ status: answer.status, output: answer.output }),
      literalCitationMatching: { status: answer.status === 'completed' ? 'pass' as const : 'not_assessable' as const, checkedCitations: citations.length,
        meaning: 'Receipt replay verifies request-offered ID membership and exact whole-body equality only; semantic support is independently judged.' } };
  });
  const document = { format: 'ablatrix-three-context-evaluation-v1' as const, scope: manifest.diagnostic.document.scope,
    transportProvenance: checkpoints.at(-1)!.provenance, rubric: ANSWER_DIAGNOSTIC_RUBRIC,
    instruction: 'Review complete sources, original customer questions, each designated qualification and unknown. Record every substantive unsupported answer claim. Source membership is not support. AI judgments are provisional; agreement is not ground truth. Review entries may cover a focused subset; all other answers remain unreviewed.',
    cases, answers: packetAnswers, qualityClaimEligible: false as const, activationAllowed: false as const };
  return { ...document, sha256: diagnosticHash(document) };
}
export type ThreeContextEvaluationPacket = ReturnType<typeof prepareThreeContextEvaluation>;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/), nonempty = z.string().trim().min(1);
const evidenceSchema = z.object({ sourceId: nonempty, quote: nonempty, originalQuestion: z.string().nullable() }).strict();
const axisSchema = z.object({ judgment: z.enum(['pass', 'fail', 'uncertain']), rationale: nonempty, evidence: z.array(evidenceSchema) }).strict();
const reviewSchema = z.object({ format: z.literal('ablatrix-source-checked-review-v1'), packetSha256: hashSchema,
  reviewer: nonempty, provenance: z.enum(['source_checked_human', 'ai_provisional']),
  purpose: z.enum(['independent_review', 'calibration_reference', 'focused_disagreement']), recordedAt: z.iso.datetime(), sourceChecked: z.literal(true),
  entries: z.array(z.object({ label: nonempty, sourcePoolSha256: hashSchema, answerSha256: hashSchema,
    facts: z.array(z.object({ factId: nonempty, status: z.enum(['covered', 'missing', 'distorted', 'uncertain']), rationale: nonempty, evidence: z.array(evidenceSchema) }).strict()),
    unsupportedClaims: z.array(z.object({ claim: nonempty, severity: z.enum(['material', 'minor']), rationale: nonempty }).strict()),
    exactApplicability: axisSchema, appropriateUncertainty: axisSchema, directRelevance: axisSchema,
    unknowns: z.array(z.object({ unknown: nonempty, status: z.enum(['preserved', 'missing', 'contradicted', 'not_relevant']), rationale: nonempty }).strict())
  }).strict()).min(1)
}).strict();
export type ThreeContextReviewImport = z.infer<typeof reviewSchema>;
export type ImportedThreeContextReview = { format: 'ablatrix-imported-source-review-v1'; packetSha256: string; reviewSha256: string; review: ThreeContextReviewImport };

export function verifyThreeContextEvaluation(packet: ThreeContextEvaluationPacket) {
  const { sha256, ...document } = packet; assert.equal(sha256, diagnosticHash(document));
  assert.equal(packet.format, 'ablatrix-three-context-evaluation-v1'); assert.equal(packet.qualityClaimEligible, false); assert.equal(packet.activationAllowed, false);
  assert.ok(['live_router', 'mocked_mechanics_only'].includes(packet.transportProvenance)); assert.deepEqual(packet.rubric, ANSWER_DIAGNOSTIC_RUBRIC);
  assert.equal(new Set(packet.cases.map(c => c.id)).size, packet.cases.length); assert.ok(packet.cases.length && packet.cases.length <= 8);
  assert.equal(packet.answers.length, packet.cases.length * 3);
  assert.deepEqual(packet.answers.map(a => a.label).sort(), packet.answers.map((_, i) => `Answer ${i + 1}`).sort());
  for (const item of packet.cases) {
    assert.equal(new Set(item.completeSources.map(s => s.id)).size, item.completeSources.length);
    item.completeSources.forEach(s => { assert.equal(s.productId, item.product.id); assert.equal(s.sha256, textHash(s.text)); });
    for (const [i, { factId, ...fact }] of item.designatedFacts.entries()) {
      assert.equal(factId, `fact-${i + 1}-${diagnosticHash(fact).slice(0, 12)}`);
      assert.ok(fact.sourceIds.length && fact.sourceIds.every(id => item.completeSources.some(s => s.id === id && s.text.includes(fact.quote))));
    }
    assert.equal(packet.answers.filter(a => a.caseId === item.id).length, 3);
  }
  for (const answer of packet.answers) {
    const item = packet.cases.find(c => c.id === answer.caseId); assert.ok(item);
    assert.equal(answer.sourcePoolSha256, diagnosticHash(item.completeSources)); assert.equal(answer.answerSha256, diagnosticHash({ status: answer.status, output: answer.output }));
    assert.ok(['completed', 'failed_or_unknown', 'not_attempted'].includes(answer.status));
    assert.equal(answer.literalCitationMatching.status, answer.status === 'completed' ? 'pass' : 'not_assessable');
    assert.equal(answer.literalCitationMatching.checkedCitations, answer.output?.citations.length ?? 0);
    if (answer.status !== 'completed') assert.equal(answer.output, null);
    else {
      assert.ok(answer.output && answer.output.answer.trim());
      for (const citation of answer.output.citations) assert.ok(item.completeSources.some(s => literalCitation(s, citation)));
    }
  }
  return packet;
}

/** A saved human provenance value is an explicit reviewer attestation, not an
 * identity-verification mechanism. Evidence equality cannot prove entailment. */
export function importThreeContextReview(packet: ThreeContextEvaluationPacket, raw: unknown): ImportedThreeContextReview {
  verifyThreeContextEvaluation(packet); const review = reviewSchema.parse(raw); assert.equal(review.packetSha256, packet.sha256);
  assert.equal(new Set(review.entries.map(e => e.label)).size, review.entries.length, 'Duplicate reviewed answer.');
  if (review.purpose === 'calibration_reference') assert.equal(review.provenance, 'source_checked_human', 'AI agreement cannot create a calibration reference.');
  for (const entry of review.entries) {
    const answer = packet.answers.find(a => a.label === entry.label); assert.ok(answer && answer.status === 'completed' && answer.output, 'Failed or unattempted answers cannot acquire a quality judgment.');
    const item = packet.cases.find(c => c.id === answer.caseId)!;
    assert.equal(entry.sourcePoolSha256, answer.sourcePoolSha256); assert.equal(entry.answerSha256, answer.answerSha256);
    assert.deepEqual(entry.facts.map(f => f.factId).sort(), item.designatedFacts.map(f => f.factId).sort(), 'Every designated fact must be judged once.');
    assert.deepEqual(entry.unknowns.map(u => u.unknown).sort(), [...item.unknowns].sort(), 'Every predeclared unknown must be assessed once.');
    const evidence = [...entry.facts.flatMap(f => f.evidence), ...entry.exactApplicability.evidence, ...entry.appropriateUncertainty.evidence, ...entry.directRelevance.evidence];
    for (const e of evidence) assert.ok(item.completeSources.some(s => s.id === e.sourceId && s.text.includes(e.quote) && (s.originalQuestion ?? null) === e.originalQuestion), 'Review evidence must match literal source and original customer-question scope.');
    for (const fact of entry.facts) if (fact.status === 'covered' || fact.status === 'distorted') {
      const designated = item.designatedFacts.find(f => f.factId === fact.factId)!;
      assert.ok(fact.evidence.some(e => designated.sourceIds.includes(e.sourceId)), 'A covered/distorted fact requires its independently designated source.');
    }
    assert.equal(new Set(entry.unsupportedClaims.map(c => c.claim)).size, entry.unsupportedClaims.length);
    for (const claim of entry.unsupportedClaims) assert.ok(answer.output.answer.includes(claim.claim), 'Unsupported claim text must occur literally in this answer.');
  }
  return { format: 'ablatrix-imported-source-review-v1', packetSha256: packet.sha256, reviewSha256: diagnosticHash(review), review };
}

const judgment = (review: ThreeContextReviewImport, entry: ThreeContextReviewImport['entries'][number]): SourceCheckedJudgment => ({ itemId: entry.label, reviewer: review.reviewer, provenance: review.provenance,
  sourcePoolSha256: entry.sourcePoolSha256, answerSha256: entry.answerSha256, facts: entry.facts.map(f => ({ factId: f.factId, status: f.status, sourceIds: f.evidence.map(e => e.sourceId), rationale: f.rationale })),
  unsupportedClaims: entry.unsupportedClaims, exactApplicability: entry.exactApplicability.judgment, appropriateUncertainty: entry.appropriateUncertainty.judgment, directRelevance: entry.directRelevance.judgment });
const axes = (entry: ThreeContextReviewImport['entries'][number]) => ({ ...Object.fromEntries(entry.facts.map(f => [`fact:${f.factId}`, f.status])),
  unsupportedClaims: JSON.stringify(entry.unsupportedClaims.map(c => [c.claim, c.severity]).sort()), exactApplicability: entry.exactApplicability.judgment,
  appropriateUncertainty: entry.appropriateUncertainty.judgment, directRelevance: entry.directRelevance.judgment,
  ...Object.fromEntries(entry.unknowns.map(u => [`unknown:${u.unknown}`, u.status])) });
export function reportThreeContextEvaluation(packet: ThreeContextEvaluationPacket, imports: ImportedThreeContextReview[]) {
  verifyThreeContextEvaluation(packet);
  const reviews = imports.map(record => { const verified = importThreeContextReview(packet, record.review); assert.deepEqual(record, verified); return verified; });
  assert.equal(new Set(reviews.map(r => r.reviewSha256)).size, reviews.length, 'Duplicate imports cannot inflate review counts.');
  assert.equal(new Set(reviews.map(r => r.review.reviewer)).size, reviews.length, 'Use one consolidated record per reviewer; do not double-count revisions.');
  const focusedReview = packet.answers.map(answer => {
    const judgments = reviews.flatMap(r => r.review.entries.filter(e => e.label === answer.label).map(e => ({ reviewer: r.review.reviewer, provenance: r.review.provenance, axes: axes(e) })));
    const differences = judgments.length < 2 ? [] : Object.keys(judgments[0]!.axes).filter(axis => new Set(judgments.map(j => j.axes[axis as keyof typeof j.axes])).size > 1);
    return { label: answer.label, caseId: answer.caseId, status: answer.status, reviewers: judgments.map(j => ({ reviewer: j.reviewer, provenance: j.provenance })), disagreementAxes: differences,
      humanSourceChecked: judgments.some(j => j.provenance === 'source_checked_human'), needsFocusedHumanReview: answer.status === 'completed' && (differences.length > 0 || !judgments.length) };
  });
  const calibration = reviews.filter(r => r.review.purpose === 'calibration_reference').flatMap(human => reviews.filter(r => r.review.provenance === 'ai_provisional').flatMap(ai => {
    const common = human.review.entries.filter(h => ai.review.entries.some(a => a.label === h.label)); if (!common.length) return [];
    return [{ humanReviewer: human.review.reviewer, aiReviewer: ai.review.reviewer, referenceReviewSha256: human.reviewSha256,
      ...calibratedAIReview(common.map(h => judgment(human.review, h)), common.map(h => judgment(ai.review, ai.review.entries.find(a => a.label === h.label)!))) }];
  }));
  return { format: 'ablatrix-three-context-evaluation-report-v1', packetSha256: packet.sha256, scope: packet.scope, transportProvenance: packet.transportProvenance,
    denominator: { plannedAnswers: packet.answers.length, completed: packet.answers.filter(a => a.status === 'completed').length, failedOrUnknown: packet.answers.filter(a => a.status === 'failed_or_unknown').length, unattempted: packet.answers.filter(a => a.status === 'not_attempted').length },
    humanSourceCheckedActualAnswers: packet.transportProvenance === 'live_router' ? focusedReview.filter(r => r.humanSourceChecked).length : 0,
    reviewRecords: reviews.map(r => ({ reviewer: r.review.reviewer, provenance: r.review.provenance, purpose: r.review.purpose, reviewSha256: r.reviewSha256,
      sourceCheckedAttestation: true, aiCalibration: r.review.provenance === 'ai_provisional' ? calibration.some(c => c.aiReviewer === r.review.reviewer) ? 'small_bound_reference_only' : 'uncalibrated' : 'not_applicable',
      answers: r.review.entries.map(e => ({ label: e.label, usefulFactCompleteness: { covered: e.facts.filter(f => f.status === 'covered').length, total: e.facts.length, facts: e.facts.map(f => ({ factId: f.factId, status: f.status })) },
        unsupportedClaims: { count: e.unsupportedClaims.length, material: e.unsupportedClaims.filter(c => c.severity === 'material').length }, exactApplicability: e.exactApplicability.judgment,
        appropriateUncertainty: e.appropriateUncertainty.judgment, directRelevance: e.directRelevance.judgment, literalCitationMatching: packet.answers.find(a => a.label === e.label)!.literalCitationMatching, unknowns: e.unknowns })) })),
    focusedReview, calibration, interpretation: 'Per-reviewer source-checked judgments and disagreements; no composite winner, ground truth, population accuracy or promotion decision. Human provenance is a saved reviewer attestation. AI-only agreement and exposed development outcomes do not establish quality gains.',
    qualityClaimEligible: false, activationAllowed: false, newProviderCalls: 0 };
}

const readJson = (path: string): unknown => { const p = resolve(path); assert.equal(realpathSync(p), p); assert.ok(lstatSync(p).isFile() && !lstatSync(p).isSymbolicLink()); return JSON.parse(readFileSync(p, 'utf8')); };
function exclusiveJson(path: string, value: unknown) {
  const p = resolve(path); assert.equal(realpathSync(dirname(p)), dirname(p)); const fd = openSync(p, 'wx', 0o600);
  try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
}
export function threeContextEvaluationCli(argv: string[]) {
  if (!argv.length) return { usage: 'prepare --plan FILE --checkpoint JSONL --result FILE --review FILE --out NEW | import --packet FILE --judgments FILE --out NEW | report --packet FILE [--import FILE ...] --out NEW', newProviderCalls: 0 };
  const [command, ...rest] = argv, allowed = command === 'prepare' ? ['--plan', '--checkpoint', '--result', '--review', '--out'] : command === 'import' ? ['--packet', '--judgments', '--out'] : command === 'report' ? ['--packet', '--import', '--out'] : [];
  assert.ok(allowed.length && rest.length % 2 === 0); const flags = new Map<string, string[]>();
  for (let i = 0; i < rest.length; i += 2) { const key = rest[i]!, value = rest[i + 1]!; assert.ok(allowed.includes(key) && value && (!flags.has(key) || command === 'report' && key === '--import')); flags.set(key, [...flags.get(key) ?? [], value]); }
  for (const key of allowed) if (!(command === 'report' && key === '--import')) assert.ok(flags.has(key), `Missing ${key}`);
  const one = (key: string) => flags.get(key)![0]!; let output: unknown;
  if (command === 'prepare') {
    const path = resolve(one('--checkpoint')); assert.equal(realpathSync(path), path); assert.ok(lstatSync(path).isFile()); const raw = readFileSync(path, 'utf8'); assert.ok(raw.endsWith('\n') && raw.trim());
    output = prepareThreeContextEvaluation(readJson(one('--plan')) as ThreeContextLiveManifest, raw.trimEnd().split('\n').map(line => JSON.parse(line) as DiagnosticCheckpoint), readJson(one('--result')), readJson(one('--review')) as ReturnType<typeof anonymousDiagnosticReview>['review']);
  } else {
    const packet = readJson(one('--packet')) as ThreeContextEvaluationPacket;
    output = command === 'import' ? importThreeContextReview(packet, readJson(one('--judgments'))) : reportThreeContextEvaluation(packet, (flags.get('--import') ?? []).map(path => readJson(path) as ImportedThreeContextReview));
  }
  exclusiveJson(one('--out'), output); return { written: resolve(one('--out')), newProviderCalls: 0, qualityClaimEligible: false };
}
