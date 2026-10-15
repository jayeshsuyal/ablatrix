import { createHash } from 'node:crypto';
import { ABSTENTION_GRADER_VERSION, claimSupportRequestParts, type ClaimSupportDisposition, type ClaimSupportInput, type ClaimSupportUnitGrade, type ClaimSupportWireOutput } from './claim-support.ts';

export type CalibrationInputCase = { id: string; familyId: string; input: Omit<ClaimSupportInput, 'runId'> };
export type CalibrationFixtureCase = CalibrationInputCase;
export type CalibrationReferenceProvenance = {
  authorship: 'ai_authored_constructed_reference';
  reviewStatus: 'pending_parent_source_review';
};
export type CalibrationReference = {
  caseId: string;
  familyId: string;
  answerQuality: 'good' | 'flawed';
  acceptableDispositions: ClaimSupportDisposition[];
  support: 'supported' | 'unsupported' | 'contradicted' | 'non_factual';
  questionCoverage: 'complete' | 'incomplete';
  uncertaintyHandling: 'appropriate' | 'overconfident' | 'unnecessary_abstention';
  acceptableAxes: {
    support: ClaimSupportUnitGrade['verdict'][];
    questionCoverage: ClaimSupportWireOutput['questionCoverage'][];
    uncertaintyHandling: ClaimSupportWireOutput['uncertaintyHandling'][];
    answerability: ClaimSupportWireOutput['answerability'][];
    correctness: ClaimSupportWireOutput['correctness'][];
  };
  rationale: string;
  spans: { sourceId: string; quote: string; role: 'supports' | 'scope' | 'conflict' | 'missing_context' }[];
  provenance: CalibrationReferenceProvenance;
};
export type CalibrationFixtureDataset = {
  format: 'constructed-grader-pilot-v1' | 'constructed-abstention-smoke-v1';
  cases: CalibrationInputCase[];
  references: CalibrationReference[];
  families: { id: string; name: string; pattern: string }[];
  referenceProvenance: CalibrationReferenceProvenance;
};

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const provenance = (): CalibrationReferenceProvenance => ({ authorship: 'ai_authored_constructed_reference', reviewStatus: 'pending_parent_source_review' });
const identity = (seed: string) => digest(`constructed-grader-pilot-v1:${seed}`);
const sourceId = (seed: string) => `s_${identity(seed).slice(0, 20)}`;
const product = (seed: string, title: string) => ({ id: `p_${identity(seed).slice(0, 20)}`, title });

/** Ten wholly fictional, source-limited cases. The separate references are
 * AI-authored constructions awaiting source review, never human gold labels.
 * Only a case's input is eligible for serialization into a grader request. */
export function calibrationFixtureDataset(): CalibrationFixtureDataset {
  const cases: CalibrationInputCase[] = [], references: CalibrationReference[] = [], families: CalibrationFixtureDataset['families'] = [];
  function pair(seed: string, name: string, pattern: string, inputs: [CalibrationInputCase['input'], CalibrationInputCase['input']], labels: [Omit<CalibrationReference, 'caseId' | 'familyId' | 'provenance'>, Omit<CalibrationReference, 'caseId' | 'familyId' | 'provenance'>]) {
    const familyId = identity(seed); families.push({ id: familyId, name, pattern });
    for (const [index, input] of inputs.entries()) {
      const id = digest(JSON.stringify(input));
      // Pure contract validation: this opens no provider, ledger or credential.
      claimSupportRequestParts({ runId: `calibration-fixture:${id}`, ...input });
      cases.push({ id, familyId, input: structuredClone(input) });
      references.push({ caseId: id, familyId, ...labels[index]!, provenance: provenance() });
    }
  }
  const supportedAxes = () => ({ support: ['supported'] as ClaimSupportUnitGrade['verdict'][], questionCoverage: ['complete'] as ClaimSupportWireOutput['questionCoverage'][], uncertaintyHandling: ['appropriate'] as ClaimSupportWireOutput['uncertaintyHandling'][], answerability: ['answerable'] as ClaimSupportWireOutput['answerability'][], correctness: ['consistent_with_sources'] as ClaimSupportWireOutput['correctness'][] });
  const absentSupportAxes = () => ({ support: ['unsupported'] as ClaimSupportUnitGrade['verdict'][], questionCoverage: ['complete'] as ClaimSupportWireOutput['questionCoverage'][], uncertaintyHandling: ['overconfident'] as ClaimSupportWireOutput['uncertaintyHandling'][], answerability: ['answerable'] as ClaimSupportWireOutput['answerability'][], correctness: ['consistent_with_sources', 'uncertain'] as ClaimSupportWireOutput['correctness'][] });

  const jugSource = { id: sourceId('rivel-manual'), source: 'Product description', text: 'The Rivel measuring jug holds 750 milliliters and has a removable lid.' };
  const jug = { question: 'What is the capacity of the Rivel measuring jug?', product: product('rivel-jug', 'Rivel measuring jug'), evidence: [jugSource], clarifications: [] };
  const jugCitation = { passageId: jugSource.id, quote: 'holds 750 milliliters' };
  pair('family-rivel', 'Capacity and an added claim', 'A supported numerical first clause must not hide a second assertion with no source support.', [
    { ...jug, answer: { status: 'answered', answer: 'It holds 750 milliliters.', citations: [jugCitation] } },
    { ...jug, answer: { status: 'answered', answer: 'It holds 750 milliliters and is safe to use in a microwave.', citations: [jugCitation] } }
  ], [
    { answerQuality: 'good', acceptableDispositions: ['pass'], support: 'supported', questionCoverage: 'complete', uncertaintyHandling: 'appropriate', acceptableAxes: supportedAxes(), rationale: 'The numerical capacity and unit match the cited source clause, and the answer addresses the entire question.', spans: [{ sourceId: jugSource.id, quote: jugCitation.quote, role: 'supports' }] },
    { answerQuality: 'flawed', acceptableDispositions: ['repair', 'uncertain'], support: 'unsupported', questionCoverage: 'complete', uncertaintyHandling: 'overconfident', acceptableAxes: absentSupportAxes(), rationale: 'The capacity is supported, but the same answer unit also asserts microwave safety. Neither the citation nor the complete supplied body states microwave safety. Missing support is not an explicit source contradiction; source-level correctness may reasonably remain uncertain.', spans: [{ sourceId: jugSource.id, quote: jugCitation.quote, role: 'supports' }, { sourceId: jugSource.id, quote: jugSource.text, role: 'missing_context' }] }
  ]);

  const fitTable = { id: sourceId('taren-fit-table'), source: 'Fit table', text: 'The Taren insert fits model VX-24.' };
  const fitReport = { id: sourceId('taren-customer-answer'), source: 'Customer answer', text: 'Yes, it fits without an adapter.', originalQuestion: 'Does the Taren insert fit model VX-60?' };
  const insert = { question: 'Does the Taren insert fit model VX-24?', product: product('taren-insert', 'Taren replacement insert'), evidence: [fitTable, fitReport], clarifications: [] };
  pair('family-taren', 'Exact model and customer context', 'A customer answer for one model cannot supply an extra relationship for another model.', [
    { ...insert, answer: { status: 'answered', answer: 'The fit table says the insert fits model VX-24.', citations: [{ passageId: fitTable.id, quote: fitTable.text }] } },
    { ...insert, answer: { status: 'answered', answer: 'The insert fits model VX-24 without an adapter.', citations: [{ passageId: fitTable.id, quote: fitTable.text }, { passageId: fitReport.id, quote: fitReport.text }] } }
  ], [
    { answerQuality: 'good', acceptableDispositions: ['pass'], support: 'supported', questionCoverage: 'complete', uncertaintyHandling: 'appropriate', acceptableAxes: supportedAxes(), rationale: 'The answer attributes the exact VX-24 relationship to the fit table. It does not transfer the adapter statement from the customer question about VX-60.', spans: [{ sourceId: fitTable.id, quote: fitTable.text, role: 'supports' }, { sourceId: fitReport.id, quote: fitReport.text, role: 'scope' }] },
    { answerQuality: 'flawed', acceptableDispositions: ['repair', 'uncertain'], support: 'unsupported', questionCoverage: 'complete', uncertaintyHandling: 'overconfident', acceptableAxes: absentSupportAxes(), rationale: 'The VX-24 fit is supported, but the adapter-free relationship appears only in a customer answer whose original question concerns VX-60. That context cannot establish the requested model relationship. Wrong-scope evidence is missing support, not an applicable contradiction; uncertain source-level correctness is acceptable.', spans: [{ sourceId: fitTable.id, quote: fitTable.text, role: 'supports' }, { sourceId: fitReport.id, quote: fitReport.text, role: 'scope' }] }
  ]);

  const lampSource = { id: sourceId('orin-description'), source: 'Product description', text: 'The base of the Orin desk lamp is aluminum. Its shade is fabric.' };
  const lamp = { question: 'What materials are the base and shade of the Orin desk lamp made of?', product: product('orin-lamp', 'Orin desk lamp'), evidence: [lampSource], clarifications: [] };
  const baseQuote = 'The base of the Orin desk lamp is aluminum.', shadeQuote = 'Its shade is fabric.';
  pair('family-orin', 'Two requested details', 'A supported partial answer still misses a separately requested fact that is present in the same source.', [
    { ...lamp, answer: { status: 'answered', answer: 'The base is aluminum and the shade is fabric.', citations: [{ passageId: lampSource.id, quote: baseQuote }, { passageId: lampSource.id, quote: shadeQuote }] } },
    { ...lamp, answer: { status: 'answered', answer: 'The base is aluminum.', citations: [{ passageId: lampSource.id, quote: baseQuote }] } }
  ], [
    { answerQuality: 'good', acceptableDispositions: ['pass'], support: 'supported', questionCoverage: 'complete', uncertaintyHandling: 'appropriate', acceptableAxes: supportedAxes(), rationale: 'Both requested materials are stated and each assertion has a directly supporting citation.', spans: [{ sourceId: lampSource.id, quote: baseQuote, role: 'supports' }, { sourceId: lampSource.id, quote: shadeQuote, role: 'supports' }] },
    { answerQuality: 'flawed', acceptableDispositions: ['repair'], support: 'supported', questionCoverage: 'incomplete', uncertaintyHandling: 'appropriate', acceptableAxes: { ...supportedAxes(), questionCoverage: ['incomplete'] }, rationale: 'The stated base material is supported and needs no uncertainty qualifier, but the answer omits the requested shade material even though it is explicitly supplied.', spans: [{ sourceId: lampSource.id, quote: baseQuote, role: 'supports' }, { sourceId: lampSource.id, quote: shadeQuote, role: 'missing_context' }] }
  ]);

  const dryReport = { id: sourceId('doran-customer-one'), source: 'Customer report', text: 'My Doran bottle stayed dry during an hour in my bag.' };
  const leakReport = { id: sourceId('doran-customer-two'), source: 'Customer report', text: 'My Doran bottle leaked into my bag during an hour-long commute.' };
  const bottle = { question: 'Do the supplied customer reports agree about leakage from the Doran bottle during their trips?', product: product('doran-bottle', 'Doran travel bottle'), evidence: [dryReport, leakReport], clarifications: [] };
  pair('family-doran', 'Reports and attribution', 'Keep two conflicting customer experiences attributed rather than turning one report into agreement by both customers.', [
    { ...bottle, answer: { status: 'answered', answer: 'The reports differ: one customer reports that the bottle stayed dry during an hour in a bag; the other reports that it leaked during an hour-long commute.', citations: [{ passageId: dryReport.id, quote: dryReport.text }, { passageId: leakReport.id, quote: leakReport.text }] } },
    { ...bottle, answer: { status: 'answered', answer: 'Both customers report that the bottle did not leak during their trips.', citations: [{ passageId: dryReport.id, quote: dryReport.text }] } }
  ], [
    { answerQuality: 'good', acceptableDispositions: ['pass'], support: 'supported', questionCoverage: 'complete', uncertaintyHandling: 'appropriate', acceptableAxes: supportedAxes(), rationale: 'The question asks what the reports say, which the packet answers directly. The response preserves both attributions and their different outcomes without making a universal product claim.', spans: [{ sourceId: dryReport.id, quote: dryReport.text, role: 'supports' }, { sourceId: leakReport.id, quote: leakReport.text, role: 'supports' }] },
    { answerQuality: 'flawed', acceptableDispositions: ['repair'], support: 'contradicted', questionCoverage: 'complete', uncertaintyHandling: 'overconfident', acceptableAxes: { support: ['contradicted'], questionCoverage: ['complete'], uncertaintyHandling: ['overconfident'], answerability: ['answerable'], correctness: ['contradicted_by_sources'] }, rationale: 'The answer addresses the agreement question but gets the supplied reports wrong: saying both customers report no leakage directly conflicts with the second customer saying their bottle leaked. This overstates agreement. The contradiction concerns the supplied reports, not an external claim about every bottle.', spans: [{ sourceId: dryReport.id, quote: dryReport.text, role: 'scope' }, { sourceId: leakReport.id, quote: leakReport.text, role: 'conflict' }] }
  ]);

  const boxSource = { id: sourceId('aven-description'), source: 'Product description', text: 'The Aven storage box has a snap-on lid and a 2-liter capacity.' };
  const box = { question: 'What is the maximum temperature rating of the Aven storage box?', product: product('aven-box', 'Aven storage box'), evidence: [boxSource], clarifications: [] };
  pair('family-aven', 'Missing temperature information', 'Withhold an absent specification; an unrelated literal quote cannot support an invented rating.', [
    { ...box, answer: { status: 'insufficient_evidence', answer: 'I cannot determine a maximum temperature rating from the supplied text.', citations: [] } },
    { ...box, answer: { status: 'answered', answer: 'The box is rated for temperatures up to 100°C.', citations: [{ passageId: boxSource.id, quote: 'a 2-liter capacity' }] } }
  ], [
    { answerQuality: 'good', acceptableDispositions: ['abstain'], support: 'non_factual', questionCoverage: 'complete', uncertaintyHandling: 'appropriate', acceptableAxes: { support: ['non_factual'], questionCoverage: ['complete'], uncertaintyHandling: ['appropriate'], answerability: ['insufficient'], correctness: ['consistent_with_sources'] }, rationale: 'The complete source body gives a closure and capacity but no temperature rating. The answer appropriately withholds the absent value. This is a good source-limited abstention whose expected runtime disposition is abstain; it is not a literal pass and does not change runtime routing.', spans: [{ sourceId: boxSource.id, quote: boxSource.text, role: 'missing_context' }] },
    { answerQuality: 'flawed', acceptableDispositions: ['abstain', 'uncertain'], support: 'unsupported', questionCoverage: 'complete', uncertaintyHandling: 'overconfident', acceptableAxes: { ...absentSupportAxes(), answerability: ['insufficient'] }, rationale: 'The source supplies no temperature rating, and a capacity quote does not support 100°C. The answer supplies the requested type of value but invents its content. Missing evidence is not a literal contradiction, so uncertain source-level correctness is acceptable.', spans: [{ sourceId: boxSource.id, quote: 'a 2-liter capacity', role: 'scope' }, { sourceId: boxSource.id, quote: boxSource.text, role: 'missing_context' }] }
  ]);

  return { format: 'constructed-grader-pilot-v1', cases, references, families, referenceProvenance: provenance() };
}

/** New, unpaired development smoke cases. No old case is retried or relabeled. */
export function abstentionCalibrationFixtureDataset(): CalibrationFixtureDataset {
  const cases: CalibrationInputCase[] = [], references: CalibrationReference[] = [], families: CalibrationFixtureDataset['families'] = [];
  function add(seed: string, name: string, text: string, question: string, answer: ClaimSupportInput['answer'], label: Omit<CalibrationReference, 'caseId' | 'familyId' | 'provenance' | 'spans'>) {
    const familyId = identity(`abstention-v2:${seed}`), source = { id: sourceId(`abstention-v2:${seed}`), source: 'Fictional specification', text };
    const input = { graderVersion: ABSTENTION_GRADER_VERSION, question, product: product(`abstention-v2:${seed}`, `Fictional ${seed}`), evidence: [source], clarifications: [], answer: { ...answer, citations: answer.status === 'answered' ? [{ passageId: source.id, quote: text.split('. ')[0] + (text.includes('. ') ? '.' : '') }] : answer.citations } };
    const id = digest(JSON.stringify(input)); claimSupportRequestParts({ runId: `abstention-fixture:${id}`, ...input });
    cases.push({ id, familyId, input }); families.push({ id: familyId, name, pattern: name });
    references.push({ caseId: id, familyId, ...label, spans: [{ sourceId: source.id, quote: text, role: label.support === 'contradicted' ? 'conflict' : label.support === 'supported' ? 'supports' : 'missing_context' }], provenance: provenance() });
  }
  const axes = (support: CalibrationReference['support'], questionCoverage: CalibrationReference['questionCoverage'], answerability: ClaimSupportWireOutput['answerability'], correctness: ClaimSupportWireOutput['correctness'][], uncertaintyHandling: CalibrationReference['uncertaintyHandling']) => ({ support: [support], questionCoverage: [questionCoverage], answerability: [answerability], correctness, uncertaintyHandling: [uncertaintyHandling] });
  add('Halven lantern', 'Justified missing-information refusal', 'The fictional Halven lantern weighs 240 grams and has a USB-C charging port.', 'What IP water-resistance rating is specified for the fictional Halven lantern?',
    { status: 'insufficient_evidence', answer: 'I cannot determine its IP water-resistance rating from the supplied specification.', citations: [] },
    { answerQuality: 'good', acceptableDispositions: ['abstain'], support: 'non_factual', questionCoverage: 'complete', uncertaintyHandling: 'appropriate', acceptableAxes: axes('non_factual', 'complete', 'insufficient', ['consistent_with_sources'], 'appropriate'), rationale: 'The source states mass and charging port but no IP rating. This pure refusal asserts no product fact and needs no invented absence quote.' });
  add('Morven board', 'Unnecessary refusal of an available fact', 'The fictional Morven cutting board is 17 millimeters thick.', 'How thick is the fictional Morven cutting board?',
    { status: 'insufficient_evidence', answer: 'I cannot determine its thickness from the supplied specification.', citations: [] },
    { answerQuality: 'flawed', acceptableDispositions: ['repair'], support: 'non_factual', questionCoverage: 'incomplete', uncertaintyHandling: 'unnecessary_abstention', acceptableAxes: axes('non_factual', 'incomplete', 'answerable', ['consistent_with_sources'], 'unnecessary_abstention'), rationale: 'The pure refusal asserts no product fact, but the supplied thickness directly answers the question. Non-factual is not a certificate of appropriate refusal; coverage and uncertainty must fail.' });
  add('Kelmor speaker', 'Refusal with an unsupported factual addition', 'The fictional Kelmor speaker has a USB-C charging port and a cloth carrying strap.', 'What warranty period is specified for the fictional Kelmor speaker?',
    { status: 'insufficient_evidence', answer: 'I cannot determine the warranty period from the supplied specification. It plays for 24 hours on one charge.', citations: [] },
    { answerQuality: 'flawed', acceptableDispositions: ['abstain', 'uncertain'], support: 'unsupported', questionCoverage: 'complete', uncertaintyHandling: 'overconfident', acceptableAxes: axes('unsupported', 'complete', 'insufficient', ['consistent_with_sources', 'uncertain'], 'overconfident'), rationale: 'The requested warranty is absent, but the same answer unit adds an unsupported battery-duration assertion. The whole unit cannot be non-factual. Missing evidence does not prove the physical claim false, so source correctness may be consistent or uncertain; existing routing permits abstain or uncertain, never pass.' });
  add('Peldin notebook', 'Supported factual control', 'The fictional Peldin notebook contains 96 pages. Its spine is stitched.', 'How many pages does the fictional Peldin notebook contain?',
    { status: 'answered', answer: 'It contains 96 pages.', citations: [] },
    { answerQuality: 'good', acceptableDispositions: ['pass'], support: 'supported', questionCoverage: 'complete', uncertaintyHandling: 'appropriate', acceptableAxes: axes('supported', 'complete', 'answerable', ['consistent_with_sources'], 'appropriate'), rationale: 'The complete cited first sentence supplies exactly the requested page count.' });
  add('Varnel spoon', 'Contradicted factual control', 'The fictional Varnel measuring spoon holds exactly 5 milliliters per level scoop.', 'How many milliliters does one level scoop with the fictional Varnel spoon hold?',
    { status: 'answered', answer: 'One level scoop holds 15 milliliters.', citations: [] },
    { answerQuality: 'flawed', acceptableDispositions: ['repair'], support: 'contradicted', questionCoverage: 'complete', uncertaintyHandling: 'overconfident', acceptableAxes: axes('contradicted', 'complete', 'answerable', ['contradicted_by_sources'], 'overconfident'), rationale: 'The asserted 15 milliliters directly conflicts with the same requested unit and relationship stated as exactly 5 milliliters.' });
  return { format: 'constructed-abstention-smoke-v1', cases, references, families, referenceProvenance: provenance() };
}
