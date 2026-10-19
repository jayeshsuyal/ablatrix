"""Fictional source-exposed pool mechanics; no dataset, store or provider reads."""
import copy
import argparse
import importlib.util
import json
import pathlib
import tempfile
import subprocess
import unittest
from unittest.mock import patch


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


f = load(pathlib.Path(__file__).with_name('finalize-source-gap-partial-cohort.py'), 'partial_finalizer_tested')
m = f.deck_rules
old = load(m.ROOT / 'scripts/test_prepare_source_gap_cohort.py', 'partial_old_fixtures')


def save(root, name, document):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, ensure_ascii=False))
    return {'path': name, 'fileSha256': m.legacy.sha(path.read_bytes()), 'document': document}


def origin_fixture(root, projected=False):
    """Two fictional returns: eight complete cases, then four before failure."""
    code = {path: m.legacy.sha((m.ROOT / path).read_bytes()) for path in m.REQUIRED_CODE}
    old_freeze = save(root, 'old-freeze.json', {**m.original.FROZEN_FIELDS,
        'createdAt': '2026-10-18T00:00:00Z', 'implementationSha256': code})
    freeze = save(root, 'freeze.json', {**m.FROZEN_FIELDS,
        'createdAt': '2026-10-18T01:00:00Z', 'implementationSha256': code})
    old_protocol = save(root, 'old-protocol.json', m.flat.bind({**m.original.PROTOCOL_FIELDS,
        'candidateFreezeFileSha256': old_freeze['fileSha256']}, 'protocolSha256'))
    rounds, summaries, cases = [], [], []
    for number, count in ((1, 8), (2, 4)):
        selected = []
        for index in range((number - 1) * 8, (number - 1) * 8 + count):
            case = old.case(index)
            case.pop('deckRound')
            case['selectionRankSha256'] = m.legacy.sha(f"{m.SEED}:round:{number}:{case['stratum']}:{case['upstream']['qid']}")
            selected.append(case)
        summary = {'round': number, 'seed': f'{m.SEED}:round:{number}', 'selectedCount': count,
            'inventory': {'passed': number == 1}, 'eligibleDistinctProductsByStratum': {},
            'lastStratumVisited': 'preservation_control' if number == 1 else 'model_scope',
            'lastStratumSelectedCount': 1 if number == 1 else 0, 'elapsedSeconds': 1.25}
        row = save(root, f'origin/round-{number:02d}.json', {
            'format': 'ablatrix-source-gap-failed-round-observation-v1', **summary,
            'selectedSourceOnlyCases': selected, 'decisions': [], 'candidateContextsInspected': False,
            'modelOutputsInspected': False, 'generationPerformed': False, 'newProviderCalls': 0})
        rounds.append(row)
        summaries.append({**summary, 'observationFile': pathlib.Path(row['path']).name,
                          'observationFileSha256': row['fileSha256']})
        cases.extend({**case, 'diagnosticRound': number} for case in selected)
    partial = save(root, 'origin/partial-source-exposure.json', {
        'format': 'ablatrix-source-gap-partial-failure-exposure-v1',
        'status': 'failed_frozen_deck_not_a_benchmark', 'selectionSeed': m.SEED,
        'selectedProducts': len(cases), 'cases': cases,
        'productIds': sorted(case['product']['id'] for case in cases),
        'canonicalFamilyTitles': sorted({m.flat.previous.title_family(case['product']['title']) for case in cases}),
        'modelIdentifiers': [], 'sourcePacketFingerprints': [],
        'generationPerformed': False, 'candidateContextsInspected': False,
        'modelOutputsInspected': False, 'newProviderCalls': 0, 'qualityClaimEligible': False})
    diagnostic = save(root, 'origin/diagnostic-summary.json', {
        'format': 'ablatrix-source-gap-failure-diagnostic-v1', 'selectorExitCode': 1,
        'unexpectedExceptionType': None, 'status': 'reproduced_frozen_deck_insufficiency',
        'plannedProducts': 64, 'completedRounds': 1, 'roundsObserved': 2,
        'partialSelectedProducts': len(cases), 'rounds': summaries,
        'partialSourceExposureFileSha256': partial['fileSha256'],
        **{key: True for key in ('inputArtifactBytesUnchangedDuringReplay', 'frozenCodeUnchangedDuringReplay',
            'sourceMetadataUnchangedDuringReplay', 'publicExposureProjectionUnchangedDuringReplay',
            'originalFailureLogUnchanged', 'originalPrepareDirectoryAbsent')},
        'originalAttemptInventoryEquality': 'unknown_original_attempt_wrote_no_source_inventory',
        'elapsedSeconds': 2.5, 'newProviderCalls': 0, 'candidateContextsInspected': False,
        'modelOutputsInspected': False, 'qualityClaimEligible': False, 'paidExecutionAuthorized': False})
    source = {'url': m.legacy.URL, 'sha256': m.legacy.TRAIN_SHA, 'commit': m.legacy.COMMIT,
              'license': 'CDLA-Sharing-1.0', 'testSplitUsed': False}
    def projection(index):
        return {'fileSha256': str(index) * 64, 'productIds': [f'B{2000 + index * 10 + n:09d}' for n in range(8)]}
    protection = save(root, 'origin/source-protection-projection.json', {
        'format': 'ablatrix-source-gap-post-failure-protections-v1',
        'provenance': 'post_failure_reconstruction_from_unchanged_original_inputs',
        'originalProcessPrintedThisProjection': False,
        'diagnosticSummaryFileSha256': diagnostic['fileSha256'],
        'replayInputManifestFileSha256': 'a' * 64, 'replayExposureAuditFileSha256': 'b' * 64,
        'exposureAuditSha256': 'e' * 64, 'candidateFreezeFileSha256': old_freeze['fileSha256'],
        'protocolFileSha256': old_protocol['fileSha256'], 'source': source,
        'selectionCodeSha256': m.ORIGINAL_HELPER_SHA, 'immutableHelperSha256': m.original.HELPERS,
        'eligibilityAmendment': {**m.coverage.ELIGIBILITY, 'newExperimentSeed': m.SEED},
        'priorCohorts': [projection(1), projection(2)], 'priorSourceReviews': [{}, {}],
        'consumedCohorts': [projection(3)], 'exposedUnexecutedCohorts': [projection(4)],
        'inventoryInputs': {'workspaceCount': 2, 'comparisonCount': 1, 'canonicalPathSha256': ['1' * 64, '2' * 64, '3' * 64]},
        **dict.fromkeys(m.SOURCE_ONLY_FLAGS, False), 'newSelectionPerformed': False,
        'newCsvReadsPerformed': False, 'newProviderCalls': 0})
    origin = save(root, 'origin/original-failure-v1.json', {
        'format': 'ablatrix-source-gap-partial-origin-v1', 'diagnostic': diagnostic['document'],
        'diagnosticFileSha256': diagnostic['fileSha256'], 'source': source,
        'selection': {key: protection['document'][key] for key in (*m.PROTECTION_FIELDS, *m.SOURCE_ONLY_FLAGS)},
        'originalCandidateFreezeFileSha256': old_freeze['fileSha256'],
        'originalProtocolFileSha256': old_protocol['fileSha256'], 'replayInputsFileSha256': 'a' * 64,
        'sourceProtectionProjectionFileSha256': protection['fileSha256']})
    inputs = {'originalFailure': origin, 'partialExposure': partial, 'originalCandidateFreeze': old_freeze,
              'originalProtocol': old_protocol, 'diagnostic': diagnostic, 'protectionProjection': protection,
              'rounds': rounds}
    if projected:
        inputs['rounds'] = [save(root, f'public/round-{index + 1:02d}-projection.json', {
            'format': 'ablatrix-source-gap-round-projection-v1', 'rawObservationFileSha256': row['fileSha256'],
            **{key: row['document'][key] for key in ('round', 'seed', 'selectedCount', 'inventory',
                'selectedSourceOnlyCases', 'candidateContextsInspected', 'modelOutputsInspected',
                'generationPerformed', 'newProviderCalls')}}) for index, row in enumerate(rounds)]
    args = argparse.Namespace(candidate_freeze=str(root / 'freeze.json'), prepare_dir=str(root / 'prepared'),
        **{flag: str(root / inputs[key]['path']) for key, flag in m.INPUT_FLAGS.items()},
        round=[str(root / row['path']) for row in inputs['rounds']])
    return args, freeze, inputs


def preparation(root, groups=None):
    groups = groups or ['specification_gap', 'model_detail_gap', 'baseline_complete_control',
        'specification_gap', 'model_detail_gap', 'baseline_complete_control',
        'specification_gap', 'model_detail_gap', 'ineligible_or_uncertain',
        'specification_gap', 'model_detail_gap', 'baseline_complete_control']
    args, freeze, protocol, deck, baseline, review = old.preparation(root)
    cases = deck['document']['cases'][:len(groups)]
    deck['document']['cases'] = cases
    deck['document']['format'] = 'ablatrix-source-gap-exposed-pool-v1'
    deck['document']['selectionProtocol'] = m.PROTOCOL
    deck['document']['selectionSeed'] = m.SEED
    baseline['document']['scope'] = 'screening_pool'
    baseline['document']['results'] = baseline['document']['results'][:len(groups)]
    review['document']['format'] = 'ablatrix-source-gap-partial-review-v1'
    review['document']['poolFileSha256'] = review['document'].pop('deckFileSha256')
    review['document']['cases'] = review['document']['cases'][:len(groups)]
    for case, row, group in zip(cases, review['document']['cases'], groups):
        missing = group in ('specification_gap', 'model_detail_gap')
        source = case['sources'][1 if missing else 0]
        row.update(sourceGapGroup=group, noEquivalentFactInBaseline=missing,
                   baselineComplete=group == 'baseline_complete_control',
                   designatedFacts=[] if group == 'ineligible_or_uncertain' else
                     [{'fact': 'SYNTHETIC supported fact.', 'sourceIds': [source['id']],
                       'quote': source['text'], 'qualification': 'SYNTHETIC source scope only.'}])
    return args, freeze, protocol, deck, baseline, review


class PartialSourceGapTests(unittest.TestCase):
    def test_public_round_projections_preserve_every_case_and_cross_language_contract(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder).resolve()
            args, freeze, inputs = origin_fixture(root, projected=True)
            with patch.object(m, 'ROOT', root), patch.object(m, 'candidate_freeze', return_value=freeze):
                m.prepare(args)
                pool = m.artifact(root / 'prepared/pool.json')
                self.assertEqual(m.verify_pool(pool, freeze), inputs['partialExposure']['document']['cases'])
                self.assertTrue(all('decisions' not in row['document'] for row in inputs['rounds']))
                self.assertNotEqual(inputs['rounds'][0]['fileSha256'],
                                    inputs['diagnostic']['document']['rounds'][0]['observationFileSha256'])
            consumer = """
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifySourceGapPartialPool,sourceCalibrationHash} from './server/source-calibration-comparison.ts';
const raw=readFileSync(process.argv[1]);
const pool={path:'synthetic/pool.json',fileSha256:sourceCalibrationHash(raw),document:JSON.parse(raw)};
assert.equal(verifySourceGapPartialPool(pool,pool.document.candidateFreeze.document.implementationSha256).length,12);
assert.ok(pool.document.inputArtifacts.rounds.every(r=>!Object.hasOwn(r.document,'decisions')));
console.log('verified compact Python producer');
"""
            checked = subprocess.run(['node', '--import', 'tsx', '--input-type=module', '-e', consumer,
                str(root / 'prepared/pool.json')], cwd=m.ROOT, check=True, capture_output=True, text=True, timeout=30)
            self.assertEqual(checked.stdout.strip(), 'verified compact Python producer')

    def test_public_projection_rejects_wrong_case_range_raw_hash_or_decision_disclosure(self):
        mutations = [
            lambda row: row.update(rawObservationFileSha256='0' * 64),
            lambda row: row.update(round=2),
            lambda row: row['selectedSourceOnlyCases'].reverse(),
            lambda row: row['selectedSourceOnlyCases'].pop(),
            lambda row: row['selectedSourceOnlyCases'][0].update(question='SYNTHETIC changed question'),
            lambda row: row.update(decisions=[]),
        ]
        for mutate in mutations:
            with tempfile.TemporaryDirectory() as folder:
                root = pathlib.Path(folder).resolve()
                _, freeze, inputs = origin_fixture(root, projected=True)
                row = copy.deepcopy(inputs['rounds'][0]['document'])
                mutate(row)
                inputs['rounds'][0] = save(root, inputs['rounds'][0]['path'], row)
                with patch.object(m, 'ROOT', root), self.assertRaises(ValueError):
                    m.original_cases(inputs, freeze)

    def test_producer_preserves_complete_failed_prefix_without_inventory_or_selection_reads(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder).resolve()
            args, freeze, inputs = origin_fixture(root)
            with patch.object(m, 'ROOT', root), patch.object(m, 'candidate_freeze', return_value=freeze), \
                    patch.object(m.flat, 'load_rows', side_effect=AssertionError('No CSV reads')), \
                    patch.object(m.flat, 'current_metadata', side_effect=AssertionError('No store reads')), \
                    patch.object(m.original.base, 'select', side_effect=AssertionError('No new selection')):
                result = m.prepare(args)
                pool = m.artifact(root / 'prepared/pool.json')
                self.assertEqual(result['screeningProducts'], 12)
                self.assertEqual(pool['document']['cases'], inputs['partialExposure']['document']['cases'])
                self.assertEqual(pool['document']['inputArtifacts'], inputs)
                self.assertEqual(pool['document']['poolSha256'], m.flat.checksum(pool['document'], 'poolSha256'))
                self.assertEqual(m.verify_pool(pool, freeze), pool['document']['cases'])
                self.assertTrue(pool['document']['status']['sourceExposed'])
                self.assertFalse(pool['document']['status']['qualityClaimEligible'])
                with self.assertRaisesRegex(ValueError, 'new private'):
                    m.prepare(args)
            # The actual Python producer serialization is consumed by the TS
            # origin verifier; only synthetic sources and frozen code hashes run.
            consumer = """
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifySourceGapPartialPool,sourceCalibrationHash} from './server/source-calibration-comparison.ts';
const raw=readFileSync(process.argv[1]);
const pool={path:'synthetic/pool.json',fileSha256:sourceCalibrationHash(raw),document:JSON.parse(raw)};
const cases=verifySourceGapPartialPool(pool,pool.document.candidateFreeze.document.implementationSha256);
assert.equal(cases.length,12); assert.equal(cases[11].diagnosticRound,2);
console.log(JSON.stringify({verifiedPythonProducer:true,cases:cases.length,providerCalls:0}));
"""
            checked = subprocess.run(['node', '--import', 'tsx', '--input-type=module', '-e',
                consumer, str(root / 'prepared/pool.json')], cwd=m.ROOT,
                check=True, capture_output=True, text=True, timeout=30)
            self.assertEqual(json.loads(checked.stdout), {'verifiedPythonProducer': True, 'cases': 12, 'providerCalls': 0})

    def test_candidate_freeze_fails_before_any_original_source_artifact_read(self):
        with patch.object(m, 'candidate_freeze', side_effect=ValueError('Frozen code mismatch')), \
                patch.object(m, 'artifact', side_effect=AssertionError('Must not inspect source artifacts')):
            with self.assertRaisesRegex(ValueError, 'Frozen code'):
                m.prepare(argparse.Namespace(candidate_freeze='SYNTHETIC'))

    def test_raw_diagnostic_blocks_a_self_consistent_truncated_wrapper_and_partial(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder).resolve()
            _, freeze, inputs = origin_fixture(root)
            changed = copy.deepcopy(inputs)
            changed['rounds'] = changed['rounds'][:1]
            partial = changed['partialExposure']['document']
            partial['cases'] = partial['cases'][:8]
            partial['selectedProducts'] = 8
            changed['partialExposure'] = save(root, changed['partialExposure']['path'], partial)
            origin = copy.deepcopy(changed['originalFailure']['document'])
            origin['diagnostic'].update(roundsObserved=1, completedRounds=0, partialSelectedProducts=8,
                rounds=origin['diagnostic']['rounds'][:1], partialSourceExposureFileSha256=changed['partialExposure']['fileSha256'])
            changed['originalFailure'] = save(root, changed['originalFailure']['path'], origin)
            with patch.object(m, 'ROOT', root), self.assertRaisesRegex(ValueError, 'actual complete diagnostic'):
                m.original_cases(changed, freeze)

    def test_raw_protection_bytes_reject_rewritten_origin_exclusions(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder).resolve()
            _, freeze, inputs = origin_fixture(root)
            origin = copy.deepcopy(inputs['originalFailure']['document'])
            origin['selection']['consumedCohorts'] = []
            inputs['originalFailure'] = save(root, inputs['originalFailure']['path'], origin)
            with patch.object(m, 'ROOT', root), self.assertRaisesRegex(ValueError, 'protection projections'):
                m.original_cases(inputs, freeze)

    def test_raw_round_change_reorder_missing_freeze_path_and_new_core_are_rejected(self):
        mutations = [
            lambda inputs, freeze: inputs['rounds'].reverse(),
            lambda inputs, freeze: inputs['rounds'][0]['document']['selectedSourceOnlyCases'].pop(),
            lambda inputs, freeze: inputs['originalCandidateFreeze'].pop('path'),
            lambda inputs, freeze: freeze['document']['implementationSha256'].update(
                {'server/workspace-source-coverage.ts': '0' * 64}),
        ]
        for mutate in mutations:
            with tempfile.TemporaryDirectory() as folder:
                root = pathlib.Path(folder).resolve()
                _, freeze, inputs = origin_fixture(root)
                mutate(inputs, freeze)
                with patch.object(m, 'ROOT', root), self.assertRaises((ValueError, KeyError)):
                    m.original_cases(inputs, freeze)

    def test_finalize_binds_origin_and_records_actual_four_case_eight_call_denominator(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder).resolve()
            args, freeze, _ = origin_fixture(root)
            with patch.object(m, 'ROOT', root), patch.object(f, 'ROOT', root), \
                    patch.object(m, 'candidate_freeze', return_value=freeze):
                m.prepare(args)
                pool = m.artifact(root / 'prepared/pool.json')
                fixture_dir = root / 'review-fixture'
                fixture_dir.mkdir()
                groups = ['specification_gap', 'model_detail_gap', 'baseline_complete_control',
                          'baseline_complete_control'] + ['ineligible_or_uncertain'] * 8
                _, _, _, _, baseline, review = preparation(fixture_dir, groups)
                protocol = save(root, 'protocol.json', m.flat.bind({**m.PROTOCOL_FIELDS,
                    'candidateFreezeFileSha256': freeze['fileSha256'], 'poolFileSha256': pool['fileSha256'],
                    'poolSize': 12}, 'protocolSha256'))
                baseline['document']['inputFileSha256'] = pool['fileSha256']
                baseline = save(root, 'baseline.json', baseline['document'])
                review['document'].update(protocolFileSha256=protocol['fileSha256'],
                    poolFileSha256=pool['fileSha256'], baselineFileSha256=baseline['fileSha256'])
                save(root, 'review.json', review['document'])
                args = argparse.Namespace(candidate_freeze=str(root / 'freeze.json'),
                    protocol=str(root / 'protocol.json'), pool=str(root / 'prepared/pool.json'),
                    baseline=str(root / 'baseline.json'), gapReview=str(root / 'review.json'),
                    prepare_dir=str(root / 'selected'))
                result = f.finalize(args)
                cohort = json.loads((root / 'selected/cohort.json').read_bytes())
                audit = json.loads((root / 'selected/selection-audit.json').read_bytes())
                self.assertEqual(result['selectedProducts'], 4)
                self.assertEqual(cohort['executionPlan']['maximumNewAnswerAttempts'], 8)
                self.assertEqual(cohort['selection']['inputArtifacts'], audit['inputArtifacts'])
                self.assertEqual(cohort['inventory']['selectedCounts'], m.MINIMA)
                self.assertTrue(cohort['status']['sourceExposed'])
                self.assertFalse(cohort['status']['qualityClaimEligible'])
                self.assertEqual(cohort['status']['finalBaselineEligibility'], 'pending_independent_revalidation')
                with self.assertRaisesRegex(ValueError, 'new private'):
                    f.finalize(args)

    def test_first_up_to_three_three_two_preserves_entire_pool_order(self):
        with tempfile.TemporaryDirectory() as folder:
            _, _, protocol, pool, baseline, review = preparation(pathlib.Path(folder))
            selected = f.reviewed_selection(pool, baseline, review, protocol)
            self.assertEqual([case['id'] for case in selected],
                             [f'source-gap-train-{i}' for i in range(8)])
            self.assertEqual([sum(case['sourceGapGroup'] == group for case in selected)
                              for group in m.QUOTAS], [3, 3, 2])
            for selected_case, original_case in zip(selected, pool['document']['cases']):
                for key in ('question', 'product', 'sources', 'sourcePoolSha256'):
                    self.assertEqual(selected_case[key], original_case[key])

    def test_minimum_four_can_proceed_without_replacing_or_relaxing_cases(self):
        groups = ['ineligible_or_uncertain', 'specification_gap', 'baseline_complete_control',
                  'ineligible_or_uncertain', 'model_detail_gap', 'baseline_complete_control']
        with tempfile.TemporaryDirectory() as folder:
            _, _, protocol, pool, baseline, review = preparation(pathlib.Path(folder), groups)
            selected = f.reviewed_selection(pool, baseline, review, protocol)
            self.assertEqual([case['id'] for case in selected],
                             [f'source-gap-train-{i}' for i in (1, 2, 4, 5)])

    def test_every_pool_case_must_be_reviewed_even_after_selected_maxima_filled(self):
        with tempfile.TemporaryDirectory() as folder:
            _, _, protocol, pool, baseline, review = preparation(pathlib.Path(folder))
            review['document']['cases'][-1]['sourceScopeReviewed'] = False
            with self.assertRaises(ValueError):
                f.reviewed_selection(pool, baseline, review, protocol)

    def test_each_gap_type_and_exactly_two_controls_are_required(self):
        for groups in [
            ['specification_gap', 'specification_gap', 'baseline_complete_control', 'baseline_complete_control'],
            ['specification_gap', 'model_detail_gap', 'baseline_complete_control', 'ineligible_or_uncertain'],
        ]:
            with tempfile.TemporaryDirectory() as folder:
                _, _, protocol, pool, baseline, review = preparation(pathlib.Path(folder), groups)
                with self.assertRaisesRegex(ValueError, 'Insufficient'):
                    f.reviewed_selection(pool, baseline, review, protocol)

    def test_candidate_conditioning_detached_scope_and_false_facts_are_rejected(self):
        mutations = [
            lambda p, b, r: r['document'].update(candidateContextInspected=True),
            lambda p, b, r: r['document'].update(poolFileSha256='0' * 64),
            lambda p, b, r: r['document'].update(answer='NOT_A_SOURCE'),
            lambda p, b, r: r['document']['cases'][0].update(candidateRecovered=True),
            lambda p, b, r: r['document']['cases'][0].update(sourcePoolSha256='0' * 64),
            lambda p, b, r: r['document']['cases'][0]['designatedFacts'][0].update(
                sourceIds=[p['document']['cases'][0]['sources'][0]['id']],
                quote=p['document']['cases'][0]['sources'][0]['text']),
            lambda p, b, r: r['document']['cases'][2]['designatedFacts'][0].update(
                sourceIds=[p['document']['cases'][2]['sources'][1]['id']],
                quote=p['document']['cases'][2]['sources'][1]['text']),
            lambda p, b, r: b['document']['results'].pop(),
            lambda p, b, r: r['document']['cases'].reverse(),
        ]
        for mutate in mutations:
            with tempfile.TemporaryDirectory() as folder:
                _, _, protocol, pool, baseline, review = preparation(pathlib.Path(folder))
                mutate(pool, baseline, review)
                with self.assertRaises(ValueError):
                    f.reviewed_selection(pool, baseline, review, protocol)


if __name__ == '__main__':
    unittest.main()
