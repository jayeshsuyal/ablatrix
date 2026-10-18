"""Synthetic source-only screening; never reads actual datasets or stores."""
import argparse
import copy
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch


def load(filename, name):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


f = load('finalize-source-gap-cohort.py', 'gap_finalizer_tested')
m = f.deck_rules
old = load('test_prepare_retrieval_coverage_cohort.py', 'gap_old_fixtures')


def save(root, name, document):
    path = root / name
    path.write_text(json.dumps(document, ensure_ascii=False))
    return {'path': name, 'fileSha256': m.legacy.sha(path.read_bytes()), 'document': document}


def case(index):
    sources = []
    for number in range(2):
        source = {'id': f'synthetic-{index}-{number}', 'label': 'attribute',
                  'text': f'SYNTHETIC literal fact {index}/{number}.',
                  'originalQuestion': None, 'reference': 'synthetic:source'}
        source['sha256'] = m.legacy.sha(json.dumps([source[key] for key in
            ('id', 'label', 'text', 'originalQuestion', 'reference')], ensure_ascii=False, separators=(',', ':')))
        sources.append(source)
    stratum = [name for name, count in m.base.STRATA for _ in range(count)][index % 8]
    return {'id': f'source-gap-train-{index}', 'product': {'id': f'B{1000 + index:09d}',
            'title': f'SYNTHETIC Object {index}'}, 'question': 'What useful fact is supplied?',
            'sources': sources, 'sourcePoolSha256': m.legacy.sha(m.legacy.compact(sources)),
            'stratum': stratum, 'upstream': {'split': 'train', 'qid': str(index)},
            'selectionRankSha256': m.legacy.sha(f'SYNTHETIC rank {index}'), 'deckRound': index // 8 + 1}


def preparation(root):
    freeze = save(root, 'freeze.json', {**m.FROZEN_FIELDS})
    protocol = save(root, 'protocol.json', m.flat.bind({**m.PROTOCOL_FIELDS,
        'candidateFreezeFileSha256': freeze['fileSha256']}, 'protocolSha256'))
    cases = [case(index) for index in range(64)]
    selection = {'selectionCodeSha256': m.legacy.sha(f.SCRIPT.read_bytes()),
                 'immutableHelperSha256': m.HELPERS, 'candidateContextInspected': False,
                 'modelOutputsUsed': False, 'generatedAnswersOrJudgmentsRead': False,
                 'exposedUnexecutedCohorts': [{'status': 'exposed_unexecuted_cohort', 'generationPerformed': False}]}
    deck = save(root, 'deck.json', m.flat.bind({'format': 'ablatrix-source-gap-deck-v1',
        'selectionSeed': m.SEED, 'selectionProtocol': m.PROTOCOL,
        'protocolFileSha256': protocol['fileSha256'],
        'candidateFreeze': freeze,
        'selection': selection, 'source': {'testSplitUsed': False},
        'exposureAuditSha256': 'e' * 64, 'cases': cases}, 'deckSha256'))
    results = []
    for item in cases:
        source = item['sources'][0]
        passage = {'id': source['id'], 'productId': item['product']['id'], 'source': source['label'],
                   'text': source['text'], 'reference': source['label'], 'sha256': m.legacy.sha(source['text'])}
        retrieval = {'passages': [passage], 'durationMs': 0.001, 'method': 'SYNTHETIC',
                     'embeddingModel': 'SYNTHETIC', 'corpusVersion': 'SYNTHETIC'}
        results.append({'caseId': item['id'], 'indexRetrieval': retrieval, 'baseline': retrieval,
                        'baselineContextSha256': m.legacy.sha(item['id'])})
    body = {'format': 'ablatrix-source-gap-baseline-v1', 'scope': 'screening_deck',
            'inputFileSha256': deck['fileSha256'], 'corpusSha256': 'c' * 64,
            'implementationSha256': {}, 'results': results, 'providerCalls': 0,
            'generationPerformed': False, 'candidateContextInspected': False}
    baseline = save(root, 'baseline.json', {**body, 'sha256': m.legacy.sha(json.dumps(body, separators=(',', ':')))})
    reviewed = []
    for index, item in enumerate(cases):
        group = ['specification_gap', 'model_detail_gap', 'baseline_complete_control',
                 'ineligible_or_uncertain'][index % 4]
        missing = group in {'specification_gap', 'model_detail_gap'}
        source = item['sources'][1 if missing else 0]
        reviewed.append({'caseId': item['id'], 'sourceGapGroup': group,
            'baselineContextSha256': results[index]['baselineContextSha256'],
            'sourcePoolSha256': item['sourcePoolSha256'], 'sourceScopeReviewed': True,
            'baselineAndTitleReviewed': True, 'originalQuestionsReviewed': True,
            'noEquivalentFactInBaseline': missing, 'baselineComplete': group == 'baseline_complete_control',
            'designatedFacts': [] if group == 'ineligible_or_uncertain' else
                [{'fact': 'SYNTHETIC supported fact.', 'sourceIds': [source['id']],
                  'quote': source['text'], 'qualification': 'SYNTHETIC source scope only.'}],
            'notes': 'SYNTHETIC independent source check, not an answer quality result.'})
    review = save(root, 'review.json', {'format': 'ablatrix-source-gap-review-v1', 'status': 'completed',
        'provenance': 'independent_ai_source_gap_review', 'protocolFileSha256': protocol['fileSha256'],
        'deckFileSha256': deck['fileSha256'], 'baselineFileSha256': baseline['fileSha256'],
        'modelOutputsInspected': False, 'candidateContextInspected': False, 'cases': reviewed})
    args = argparse.Namespace(candidate_freeze=str(root / freeze['path']), protocol=str(root / protocol['path']),
        deck=str(root / deck['path']), baseline=str(root / baseline['path']),
        gapReview=str(root / review['path']), prepare_dir=str(root / 'final'))
    return args, freeze, protocol, deck, baseline, review


class SourceGapPreparationTests(unittest.TestCase):
    def test_protocol_is_bounded_and_rejects_drift_before_dataset_or_store_read(self):
        m.verify_helpers()
        self.assertEqual(m.PROTOCOL_FIELDS['deckStrata'], {'capacity_dimensions': 16,
            'appearance_material': 16, 'model_scope': 16, 'missing_information': 8, 'preservation_control': 8})
        with tempfile.TemporaryDirectory() as name:
            root = pathlib.Path(name).resolve()
            args, freeze, protocol, *_ = preparation(root)
            protocol['document']['screeningProducts'] = 65
            m.flat.bind(protocol['document'], 'protocolSha256')
            save(root, 'protocol.json', protocol['document'])
            with patch.object(m, 'ROOT', root), patch.object(m, 'candidate_freeze', return_value=freeze), \
                    patch.object(m.flat, 'load_rows', side_effect=AssertionError('No CSV read')), \
                    patch.object(m.coverage, 'inventory_inputs', side_effect=AssertionError('No store paths read')):
                with self.assertRaisesRegex(ValueError, 'exact deck'):
                    m.prepare(args)

    def test_candidate_freeze_verifies_all_current_code_and_timestamp_before_reading(self):
        with tempfile.TemporaryDirectory() as name:
            root = pathlib.Path(name).resolve()
            hashes = {}
            for relative in m.REQUIRED_CODE:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('SYNTHETIC implementation')
                hashes[relative] = m.legacy.sha(path.read_bytes())
            value = {**m.FROZEN_FIELDS, 'createdAt': '2026-10-18T00:00:00Z', 'implementationSha256': hashes}
            save(root, 'freeze.json', value)
            with patch.object(m, 'ROOT', root), patch.object(m, 'verify_helpers'):
                self.assertEqual(m.candidate_freeze(root / 'freeze.json')['document'], value)
                (root / 'scripts/finalize-source-gap-cohort.py').write_text('changed')
                with self.assertRaisesRegex(ValueError, 'changed after freezing'):
                    m.candidate_freeze(root / 'freeze.json')

    def test_passed_natural_packet_is_protected_without_reclassifying_as_failed_or_consumed(self):
        with tempfile.TemporaryDirectory() as name:
            root = pathlib.Path(name).resolve()
            cohort_path, review_path, _ = old.archive(root, 'consumed', 301)
            cohort = json.loads(cohort_path.read_text())
            cohort['format'] = 'ablatrix-retrieval-coverage-cohort-v1'
            m.flat.bind(cohort, 'cohortSha256')
            cohort_path.write_text(json.dumps(cohort))
            review = json.loads(review_path.read_text())
            review['cohortFileSha256'] = m.legacy.sha(cohort_path.read_bytes())
            review_path.write_text(json.dumps(review))
            with patch.object(m, 'ROOT', root):
                protected = m.exposed_unexecuted(cohort_path, review_path)
                self.assertEqual(len(protected['cases']), 8)
                self.assertEqual(protected['projection']['status'], 'exposed_unexecuted_cohort')
                self.assertFalse(protected['projection']['generationPerformed'])
                self.assertEqual(len(protected['projection']['sourcePacketFingerprints']), 8)
                review['status'] = 'failed'
                review_path.write_text(json.dumps(review))
                with self.assertRaisesRegex(ValueError, 'passed source review'):
                    m.exposed_unexecuted(cohort_path, review_path)

    def test_all64_are_reviewed_but_only_first_quota_members_selected_in_deck_order(self):
        with tempfile.TemporaryDirectory() as name:
            _, _, protocol, deck, baseline, review = preparation(pathlib.Path(name))
            selected = f.reviewed_selection(deck, baseline, review, protocol)
            self.assertEqual([case['id'] for case in selected],
                [f'source-gap-train-{i}' for i in (0, 1, 2, 4, 5, 6, 8, 9)])
            for item in selected:
                original = next(case for case in deck['document']['cases'] if case['id'] == item['id'])
                for field in ('question', 'product', 'sources', 'sourcePoolSha256'):
                    self.assertEqual(item[field], original[field])
            review['document']['cases'][63]['sourceScopeReviewed'] = False
            with self.assertRaises(ValueError):
                f.reviewed_selection(deck, baseline, review, protocol)

    def test_rejects_candidate_success_outcomes_detached_reviews_and_question_only_quotes(self):
        mutations = [
            lambda d, b, r: r['document'].update(candidateContextInspected=True),
            lambda d, b, r: r['document'].update(answer='SECRET_GENERATED'),
            lambda d, b, r: r['document'].update(baselineFileSha256='0' * 64),
            lambda d, b, r: r['document']['cases'][0].update(candidateRecovered=True),
            lambda d, b, r: r['document']['cases'][0].update(noEquivalentFactInBaseline=False),
            lambda d, b, r: r['document']['cases'][0]['designatedFacts'][0].update(
                sourceIds=[d['document']['cases'][0]['sources'][0]['id']],
                quote=d['document']['cases'][0]['sources'][0]['text']),
            lambda d, b, r: r['document']['cases'][0].update(sourcePoolSha256='0' * 64),
            lambda d, b, r: r['document']['cases'][2].update(designatedFacts=[]),
            lambda d, b, r: r['document']['cases'][2]['designatedFacts'][0].update(
                sourceIds=[d['document']['cases'][2]['sources'][1]['id']],
                quote=d['document']['cases'][2]['sources'][1]['text']),
            lambda d, b, r: r['document']['cases'][0]['designatedFacts'][0].update(quote=d['document']['cases'][0]['question']),
            lambda d, b, r: b['document']['results'][0].update(candidate={}),
            lambda d, b, r: b['document']['results'][0]['baseline']['passages'][0].update(text='Changed source'),
            lambda d, b, r: r['document']['cases'].reverse(),
        ]
        for mutate in mutations:
            with tempfile.TemporaryDirectory() as name:
                _, _, protocol, deck, baseline, review = preparation(pathlib.Path(name))
                mutate(deck, baseline, review)
                with self.assertRaises(ValueError):
                    f.reviewed_selection(deck, baseline, review, protocol)

    def test_insufficient_qualifying_cases_stop_without_relaxing_or_replacing(self):
        with tempfile.TemporaryDirectory() as name:
            _, _, protocol, deck, baseline, review = preparation(pathlib.Path(name))
            for row in review['document']['cases']:
                if row['sourceGapGroup'] == 'model_detail_gap':
                    row.update(sourceGapGroup='ineligible_or_uncertain', designatedFacts=[])
            with self.assertRaisesRegex(ValueError, 'Insufficient'):
                f.reviewed_selection(deck, baseline, review, protocol)

    def test_same_short_quote_in_another_cqa_scope_is_not_a_mechanical_contradiction(self):
        with tempfile.TemporaryDirectory() as name:
            _, _, protocol, deck, baseline, review = preparation(pathlib.Path(name))
            item = deck['document']['cases'][0]
            for index, source in enumerate(item['sources']):
                source['text'] = 'Yes.'
                source['originalQuestion'] = f'SYNTHETIC distinct applicability question {index}?'
                source['sha256'] = m.legacy.sha(json.dumps([source[key] for key in
                    ('id', 'label', 'text', 'originalQuestion', 'reference')], separators=(',', ':')))
            item['sourcePoolSha256'] = m.legacy.sha(m.legacy.compact(item['sources']))
            baseline['document']['results'][0]['baseline']['passages'][0].update(
                text='Yes.', originalQuestion=item['sources'][0]['originalQuestion'], sha256=m.legacy.sha('Yes.'))
            row = review['document']['cases'][0]
            row['sourcePoolSha256'] = item['sourcePoolSha256']
            row['designatedFacts'][0]['quote'] = 'Yes.'
            # The designated source is source1; baseline source0 answers another
            # original question. Semantic applicability is still review-owned.
            self.assertEqual(len(f.reviewed_selection(deck, baseline, review, protocol)), 8)

    def test_finalize_seals_inputs_preserves_all_sources_and_stops_before_candidate(self):
        with tempfile.TemporaryDirectory() as name:
            root = pathlib.Path(name).resolve()
            args, freeze, *_ = preparation(root)
            with patch.object(m, 'ROOT', root), patch.object(f, 'ROOT', root), \
                    patch.object(m, 'candidate_freeze', return_value=freeze):
                result = f.finalize(args)
                self.assertEqual(result['selectedProducts'], 8)
                self.assertFalse(result['candidateContextInspected'])
                self.assertEqual(result['finalBaselineEligibility'], 'pending_independent_revalidation')
                cohort = json.loads((root / 'final/cohort.json').read_bytes())
                audit = json.loads((root / 'final/selection-audit.json').read_bytes())
                self.assertEqual(cohort['cohortSha256'], m.flat.checksum(cohort, 'cohortSha256'))
                self.assertEqual(audit['selectionAuditSha256'], m.flat.checksum(audit, 'selectionAuditSha256'))
                self.assertEqual(cohort['selection']['inputArtifacts'], audit['inputArtifacts'])
                self.assertEqual(cohort['candidateFreeze'], freeze)
                self.assertTrue(cohort['executionPlan']['candidateMissesRetained'])
                self.assertEqual(cohort['executionPlan']['maximumNewAnswerAttempts'], 16)
                self.assertNotIn('SECRET_', json.dumps((cohort, audit)))
                with self.assertRaisesRegex(ValueError, 'new private'):
                    f.finalize(args)

    def test_deck_stops_exactly_after_eight_rounds_and_protects_every_previous_round(self):
        with tempfile.TemporaryDirectory() as name:
            root = pathlib.Path(name).resolve()
            args, freeze, protocol, *_ = preparation(root)
            repository = pathlib.Path(__file__).resolve().parents[1]
            names = subprocess.run(['node', '--import', 'tsx', '--input-type=module', '-e',
                "import { SOURCE_GAP_CODE_FILES } from './server/source-calibration-comparison.ts'; console.log(JSON.stringify(SOURCE_GAP_CODE_FILES));"],
                cwd=repository, check=True, capture_output=True, text=True, timeout=30)
            fake_bindings = {path: m.legacy.sha('SYNTHETIC implementation ' + path) for path in json.loads(names.stdout)}
            freeze = save(root, 'freeze.json', {**m.FROZEN_FIELDS,
                'createdAt': '2026-10-18T00:00:00Z', 'implementationSha256': fake_bindings})
            protocol = save(root, 'protocol.json', m.flat.bind({**m.PROTOCOL_FIELDS,
                'candidateFreezeFileSha256': freeze['fileSha256']}, 'protocolSha256'))
            args.prepare_dir = str(root / 'screening')
            args.exposed_cohort = 'synthetic-natural'
            args.exposed_source_review = 'synthetic-passed-review'
            args.train = 'synthetic.csv'
            def protection(offset):
                return {'cases': [{'id': f'B{offset + n:09d}'} for n in range(8)],
                        'projection': {'fileSha256': m.legacy.sha(str(offset))}}
            priors, consumed, exposed = [protection(1), protection(11)], protection(21), protection(31)
            calls = []
            def select(rows, audit, protected, seed, case_prefix):
                index = len(calls)
                self.assertEqual(len(protected), 4 + index)
                self.assertEqual(seed, f'{m.SEED}:round:{index + 1}')
                self.assertEqual(case_prefix, 'source-gap-train')
                calls.append(seed)
                return [case(i) for i in range(index * 8, index * 8 + 8)], [], {'passed': True}
            with patch.object(m, 'ROOT', root), patch.object(m, 'candidate_freeze', return_value=freeze), \
                    patch.object(m, 'protocol', return_value=protocol), \
                    patch.object(m.coverage, 'inventory_inputs', return_value={'workspaceCount': 2, 'comparisonCount': 1}), \
                    patch.object(m.coverage, 'protected_inputs', return_value=(priors, [], consumed)), \
                    patch.object(m, 'exposed_unexecuted', return_value=exposed), \
                    patch.object(m.flat, 'load_rows', return_value=[]), \
                    patch.object(m.flat, 'exposure', return_value={'auditSha256': 'e' * 64}), \
                    patch.object(m.base, 'select', side_effect=select):
                result = m.prepare(args)
                self.assertEqual(result['screeningProducts'], 64)
                self.assertEqual(len(calls), 8)
                saved = json.loads((root / 'screening/deck.json').read_bytes())
                self.assertEqual(len(saved['cases']), 64)
                self.assertEqual(len(saved['rounds']), 8)
                self.assertEqual(saved['deckSha256'], m.flat.checksum(saved, 'deckSha256'))
                self.assertEqual(saved['candidateFreeze'], freeze)
            # Consume the production Python serialization through the real TS
            # freeze gate with a fake full code map and injected local retrieval.
            # No tokenizer, embedding model, provider, private store or CSV runs.
            consumer = """
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freezeSourceGapBaseline } from './scripts/source-gap-retrieval.ts';
import { retrievalCoverageCorpus, sourceCalibrationHash } from './server/source-calibration-comparison.ts';
const raw = readFileSync(process.argv[1]);
const packet = {path:'synthetic/deck.json',fileSha256:sourceCalibrationHash(raw),document:JSON.parse(raw)};
const corpus = retrievalCoverageCorpus(packet), calls = [];
const result = await freezeSourceGapBaseline(packet, 'screening_deck', packet.document.candidateFreeze.document.implementationSha256, {
  async retrieve(productId) { calls.push(productId); const source = corpus.passages.find(p => p.productId === productId);
    return {passages:[{...source,lexicalRank:1,semanticRank:1,score:1}],durationMs:0,method:'SYNTHETIC',embeddingModel:'SYNTHETIC',corpusVersion:corpus.version}; }
});
assert.equal(calls.length,64); assert.equal(result.results.length,64); assert.equal(result.providerCalls,0);
const missing = structuredClone(packet); delete missing.document.candidateFreeze.path;
await assert.rejects(() => freezeSourceGapBaseline(missing,'screening_deck',packet.document.candidateFreeze.document.implementationSha256,{
  async retrieve() { throw new Error('Malformed freeze must reject before retrieval.'); }
}), /Invalid embedded candidate freeze artifact/);
console.log(JSON.stringify({verifiedPythonProducer:true,baselineRows:result.results.length,providerCalls:result.providerCalls}));
"""
            checked = subprocess.run(['node', '--import', 'tsx', '--input-type=module', '-e',
                consumer, str(root / 'screening/deck.json')], cwd=repository,
                check=True, capture_output=True, text=True, timeout=30)
            self.assertEqual(json.loads(checked.stdout),
                {'verifiedPythonProducer': True, 'baselineRows': 64, 'providerCalls': 0})


if __name__ == '__main__':
    unittest.main()
