"""Prospective v2 selector checks with fictional sources, never the train CSV."""
import argparse
import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

PATH = pathlib.Path(__file__).with_name('prepare-source-coverage-v2-deck.py')
spec = importlib.util.spec_from_file_location('source_coverage_v2_tested', PATH)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
fixture_spec = importlib.util.spec_from_file_location('source_coverage_v2_fixtures', PATH.with_name('test_prepare_source_calibration_cohort.py'))
fixture = importlib.util.module_from_spec(fixture_spec)
fixture_spec.loader.exec_module(fixture)


def write(folder, name, value):
    target = folder / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, ensure_ascii=False))
    return target


def rows():
    titles = ['Aster vessel', 'Birch stand', 'Cedar shelf', 'Dahlia tray', 'Elm basket',
              'Fir frame', 'Gorse bowl', 'Hazel platter', 'Iris canister', 'Juniper box',
              'Kalmia bin', 'Laurel crock']
    data = []
    for index, title in enumerate(titles, 1):
        question = 'What is the height of this item?' if index <= 8 else 'Is a lid included with this item?'
        body = f'The item is {10 + index} inches tall.' if index <= 8 else f'The item comes with a lid bearing the word {title.split()[0]}.'
        data.append(fixture.row(f'B{index:09d}', index, title, question, body))
    data.append(fixture.row('B000000001', 1, titles[0], data[0]['question'],
                            'Only the small setup. Question: Is the large setup shown?', 'cqa', number=90))
    return data


def selected():
    cases, _, summary = m.select(rows(), fixture.audit(), [])
    assert summary['passed'], summary
    return cases


def synthetic_pool(folder, cases=None):
    template = (cases or selected())[0]
    values = []
    for number in range(44):
        case = copy.deepcopy(template)
        case['id'] = f'fictional-exposed-{number}'
        case['product'] = {'id': f'B{1000 + number:09d}', 'title': f'Fictional exposed article {number}'}
        values.append(case)
    document = m.flat.bind({'format': 'ablatrix-source-gap-exposed-pool-v1',
                           'status': {'generationPerformed': False}, 'cases': values}, 'poolSha256')
    path = write(folder, 'pool.json', document)
    return path, document


class FreshV2SelectionTests(unittest.TestCase):
    def test_fixed_recipe_is_order_invariant_label_blind_and_restores_imported_quota(self):
        old = m.base.STRATA
        cases, audit, inventory = m.select(rows(), fixture.audit(), [])
        self.assertTrue(inventory['passed'])
        self.assertEqual(m.base.STRATA, old)
        self.assertEqual(m.select(list(reversed(rows())), fixture.audit(), []), (cases, audit, inventory))
        self.assertEqual([c['stratum'] for c in cases], ['capacity_dimensions'] * 8 + ['preservation_control'] * 4)
        self.assertEqual(len({case['product']['id'] for case in cases}), 12)
        self.assertNotIn('SECRET_', json.dumps((cases, audit, inventory)))
        for case in cases:
            self.assertEqual(case['selectionRankSha256'], m.legacy.sha(f"{m.SEED}:{case['stratum']}:{case['upstream']['qid']}"))
        scoped = next(c for c in cases if c['product']['id'] == 'B000000001')
        self.assertEqual(next(s for s in scoped['sources'] if s['label'] == 'cqa')['originalQuestion'], 'Is the large setup shown?')

    def test_helper_quota_is_restored_even_when_selection_raises(self):
        old = m.base.STRATA
        with patch.object(m.base, 'select', side_effect=RuntimeError('SYNTHETIC interruption')):
            with self.assertRaises(RuntimeError):
                m.select([], {}, [])
        self.assertEqual(m.base.STRATA, old)

    def test_development_body_model_family_and_exact_product_exclusions_are_reused(self):
        sources, _ = m.legacy.pool([fixture.row('B000000099', 99, 'Old object', 'What is shown?', 'The item is 11 inches tall.')])
        for prior, reason in [
            ({'id': 'B000000001', 'title': 'Other item', 'question': '', 'sources': []}, 'previously_exposed_or_reserved'),
            ({'id': 'B000000099', 'title': 'Aster old object', 'question': '', 'sources': []}, 'protected_brand_family_or_near_title'),
            ({'id': 'B000000099', 'title': 'Other item', 'question': '', 'sources': sources}, 'protected_prior_source_packet'),
        ]:
            cases, audit, inventory = m.select(rows(), fixture.audit(), [{'cases': [prior]}])
            self.assertFalse(inventory['passed'])
            self.assertLess(len(cases), 12)
            self.assertIn(reason, {entry.get('reason') for entry in audit})
        model_rows = rows()
        model_rows[0]['candidate'] += ' Identified as BRANCH771.'
        prior = {'id': 'B000000099', 'title': 'Other item', 'question': 'Is BRANCH771 listed?', 'sources': []}
        _, audit, inventory = m.select(model_rows, fixture.audit(), [{'cases': [prior]}])
        self.assertFalse(inventory['passed'])
        self.assertIn('protected_full_source_identifier_or_near_model', {entry.get('reason') for entry in audit})

    def test_literal_source_scope_cannot_be_changed_or_gain_generated_fields(self):
        cases = selected()
        self.assertEqual(len(m.literal_cases({'cases': cases}, 12)), 12)
        for mutate in [
            lambda d: d[0]['sources'][0].update(originalQuestion='A different original question'),
            lambda d: d[0]['sources'][0].update(text='A changed source body'),
            lambda d: d[0]['sources'][0].update(answer='SECRET_GENERATED'),
            lambda d: d[1].update(product=d[0]['product']),
        ]:
            value = copy.deepcopy(cases)
            mutate(value)
            with self.assertRaises(ValueError):
                m.literal_cases({'cases': value}, 12)

    def test_development_pool_requires_exact_bytes_all44_and_source_seal(self):
        with tempfile.TemporaryDirectory() as name:
            folder = pathlib.Path(name).resolve()
            path, value = synthetic_pool(folder)
            raw_sha = m.legacy.sha(path.read_bytes())
            with patch.object(m, 'ROOT', folder), patch.object(m, 'DEVELOPMENT_POOL', 'pool.json'), patch.object(m, 'DEVELOPMENT_POOL_SHA', raw_sha):
                result = m.development_pool(path)
                self.assertEqual(len(result['cases']), 44)
                self.assertEqual(len(result['projection']['productIds']), 44)
                self.assertIn(m.base.source_packet_fingerprint(value['cases'][0]['sources'][0]), result['projection']['sourcePacketFingerprints'])
                for mutate in [lambda d: d['cases'].pop(), lambda d: d['cases'][0]['sources'][0].update(originalQuestion='Different scope')]:
                    changed = copy.deepcopy(value)
                    mutate(changed)
                    write(folder, 'pool.json', changed)
                    with self.assertRaises(ValueError):
                        m.development_pool(path)
                    # Matching a newly rewritten raw SHA cannot hide a broken seal or denominator.
                    with patch.object(m, 'DEVELOPMENT_POOL_SHA', m.legacy.sha(path.read_bytes())):
                        with self.assertRaises(ValueError):
                            m.development_pool(path)

    def test_freeze_rejects_changed_bytes_missing_bindings_and_outside_code_paths(self):
        with tempfile.TemporaryDirectory() as name:
            folder = pathlib.Path(name).resolve()
            helper = folder / m.COVERAGE_PATH
            helper.parent.mkdir()
            helper.write_text('SYNTHETIC immutable helper')
            core = folder / 'server/core.ts'
            core.parent.mkdir()
            core.write_text('SYNTHETIC frozen candidate')
            files = {m.COVERAGE_PATH: m.legacy.sha(helper.read_bytes()), 'server/core.ts': m.legacy.sha(core.read_bytes())}
            original = {**m.FROZEN_FIELDS, 'createdAt': '2026-10-18T00:00:00Z', 'implementationSha256': files}
            path = write(folder, 'freeze.json', original)
            with patch.object(m, 'ROOT', folder), patch.object(m, 'COVERAGE_SHA', files[m.COVERAGE_PATH]), patch.object(m, 'REQUIRED_CODE', set(files)), patch.object(m.coverage, 'verify_helpers'):
                self.assertEqual(m.candidate_freeze(path)['document'], original)
                for mutate in [
                    lambda d: d['implementationSha256'].pop('server/core.ts'),
                    lambda d: d['implementationSha256'].update({'../escape.ts': 'a' * 64}),
                    lambda d: d.update(createdAt='2026-10-18T00:00:00'),
                    lambda d: d.update(retrievalContract='workspace-source-coverage-v1'),
                ]:
                    value = copy.deepcopy(original)
                    mutate(value)
                    write(folder, 'freeze.json', value)
                    with self.assertRaises(ValueError):
                        m.candidate_freeze(path)
                write(folder, 'freeze.json', original)
                core.write_text('SYNTHETIC changed after freeze')
                with self.assertRaisesRegex(ValueError, 'changed after freezing'):
                    m.candidate_freeze(path)

    def test_protocol_cannot_reseal_a_different_quota_or_paid_gate(self):
        with tempfile.TemporaryDirectory() as name:
            folder = pathlib.Path(name).resolve()
            freeze = {'fileSha256': 'a' * 64}
            original = m.flat.bind({**m.PROTOCOL_FIELDS, 'candidateFreezeFileSha256': freeze['fileSha256']}, 'protocolSha256')
            path = write(folder, 'protocol.json', original)
            with patch.object(m, 'ROOT', folder):
                self.assertEqual(m.protocol(path, freeze)['document'], original)
                for mutate in [
                    lambda d: d.update(screeningProducts=8),
                    lambda d: d.update(candidateEligibilityUsed=True),
                    lambda d: d.update(modelDetailGapRequired=True),
                    lambda d: d.update(zeroDesignatedFactDeliveryBlocksPaidPlan=False),
                    lambda d: d.update(candidateFreezeFileSha256='b' * 64),
                    lambda d: d.update(historyFileSha256={}),
                ]:
                    value = copy.deepcopy(original)
                    mutate(value)
                    m.flat.bind(value, 'protocolSha256')
                    write(folder, 'protocol.json', value)
                    with self.assertRaises(ValueError):
                        m.protocol(path, freeze)

    def test_missing_freeze_stops_before_dataset_metadata_or_protection_reads(self):
        with patch.object(m, 'candidate_freeze', side_effect=ValueError('Missing freeze')), patch.object(m.flat, 'load_rows') as load, patch.object(m.coverage, 'inventory_inputs') as inventory, patch.object(m, 'protected_inputs') as protection:
            with self.assertRaisesRegex(ValueError, 'Missing freeze'):
                m.prepare(argparse.Namespace(candidate_freeze='missing'))
            load.assert_not_called()
            inventory.assert_not_called()
            protection.assert_not_called()

    def test_infeasible_recipe_writes_no_partial_deck_or_reseed(self):
        with tempfile.TemporaryDirectory() as name:
            folder = pathlib.Path(name).resolve()
            args = argparse.Namespace(candidate_freeze='frozen', protocol='protocol', train='SYNTHETIC.csv', prepare_dir=str(folder / 'new'))
            with patch.object(m, 'ROOT', folder), patch.object(m, 'candidate_freeze', return_value={'fileSha256': 'a' * 64}), patch.object(m, 'protocol', return_value={'fileSha256': 'b' * 64}), patch.object(m.coverage, 'inventory_inputs', return_value={}), patch.object(m, 'protected_inputs', return_value=([], [])), patch.object(m.flat, 'load_rows', return_value=rows()[:5]), patch.object(m.flat, 'exposure', return_value=fixture.audit()), patch.object(m, 'select', wraps=m.select) as selector:
                with self.assertRaisesRegex(ValueError, 'Insufficient fixed twelve-product'):
                    m.prepare(args)
                self.assertFalse((folder / 'new').exists())
                self.assertEqual(selector.call_count, 1)

    def test_success_writes_one_full_deck_and_detects_metadata_drift_before_any_write(self):
        with tempfile.TemporaryDirectory() as name:
            folder = pathlib.Path(name).resolve()
            args = argparse.Namespace(candidate_freeze='frozen', protocol='protocol', train='SYNTHETIC.csv', prepare_dir=str(folder / 'new'))
            audit = {**fixture.audit(), 'auditSha256': 'c' * 64}
            protection = [{'cases': [], 'projection': {'productIds': ['SYNTHETIC_PROTECTED']}}]
            with patch.object(m, 'ROOT', folder), patch.object(m, 'candidate_freeze', return_value={'fileSha256': 'a' * 64}), patch.object(m, 'protocol', return_value={'fileSha256': 'b' * 64}), patch.object(m.coverage, 'inventory_inputs', return_value={}), patch.object(m, 'protected_inputs', return_value=(protection, [])), patch.object(m.flat, 'load_rows', return_value=rows()), patch.object(m.flat, 'exposure', return_value=audit):
                result = m.prepare(args)
                self.assertEqual(result['screeningProducts'], 12)
                self.assertEqual(result['newProviderCalls'], 0)
                deck = json.loads((folder / 'new/deck.json').read_text())
                self.assertEqual(len(deck['cases']), 12)
                self.assertNotIn('decisions', deck['selection'])
                self.assertFalse(deck['status']['paidExecutionAuthorized'])
                self.assertEqual(deck['selection']['protectedCohorts'], [protection[0]['projection']])
            args.prepare_dir = str(folder / 'drifting')
            with patch.object(m, 'ROOT', folder), patch.object(m, 'candidate_freeze', return_value={'fileSha256': 'a' * 64}), patch.object(m, 'protocol', return_value={'fileSha256': 'b' * 64}), patch.object(m.coverage, 'inventory_inputs', return_value={}), patch.object(m, 'protected_inputs', return_value=(protection, [])), patch.object(m.flat, 'load_rows', return_value=rows()), patch.object(m.flat, 'exposure', side_effect=[audit, {**audit, 'auditSha256': 'd' * 64}]):
                with self.assertRaisesRegex(ValueError, 'metadata changed'):
                    m.prepare(args)
                self.assertFalse((folder / 'drifting').exists())

    def test_saved_deck_verifier_binds_original_protocol_audits_and_selected_source_bytes(self):
        with tempfile.TemporaryDirectory() as name:
            folder = pathlib.Path(name).resolve()
            args = argparse.Namespace(candidate_freeze='frozen', protocol='protocol', train='SYNTHETIC.csv', prepare_dir=str(folder / 'new'))
            freeze = {'path': 'freeze.json', 'fileSha256': 'a' * 64}
            protocol = {'path': 'protocol.json', 'fileSha256': 'b' * 64}
            inventories = {'workspaceCount': 2, 'comparisonCount': 1,
                           'canonicalPathSha256': ['a' * 64, 'b' * 64, 'c' * 64]}
            metadata = {'workspaces': [{'inventory': f'workspace-{i}', 'products': [], 'runs': []} for i in (1, 2)],
                        'comparisons': [{'inventory': 'comparison-1', 'cases': [], 'reservedProducts': []}]}
            exposure = m.flat.bind({**fixture.audit(), 'format': 'ablatrix-flat-source-exposure-audit-v1',
                'metadata': metadata, 'inputFiles': [], 'publicIdentifierProjections': [],
                'metadataSha256': m.legacy.sha(m.legacy.compact(metadata)),
                'metadataInventorySha256': {item['inventory']: m.legacy.sha(m.legacy.compact(item))
                    for item in metadata['workspaces'] + metadata['comparisons']},
                'metadataOnly': True, 'generatedAnswersOrJudgmentsRead': False,
                'newProviderCalls': 0, 'paidExecutionAuthorized': False}, 'auditSha256')
            with patch.object(m, 'ROOT', folder), patch.object(m, 'candidate_freeze', return_value=freeze), patch.object(m, 'protocol', return_value=protocol), patch.object(m.coverage, 'inventory_inputs', return_value=inventories), patch.object(m, 'protected_inputs', return_value=([], [])), patch.object(m.flat, 'load_rows', return_value=rows()), patch.object(m.flat, 'exposure', return_value=exposure), patch.object(m.flat, 'fixed_inputs', return_value=[]):
                m.prepare(args)
                path = folder / 'new/deck.json'
                original = json.loads(path.read_text())
                result = m.verify_deck(path)
                self.assertEqual(result['mode'], 'verified_source_only_deck')
                self.assertEqual(result['deckFileSha256'], m.legacy.sha(path.read_bytes()))
                self.assertEqual(result['newProviderCalls'], 0)
                for mutate in [
                    lambda d: d['candidateFreeze'].update(fileSha256='d' * 64),
                    lambda d: d['protocol'].update(fileSha256='d' * 64),
                    lambda d: d['selection']['historyFileSha256'].clear(),
                    lambda d: d['cases'][0].update(selectionRankSha256='d' * 64),
                    lambda d: d['cases'][0].update(sourceSnapshotFingerprint='d' * 64),
                    lambda d: d['cases'][0].update(question='What is the width of this item?'),
                    lambda d: d['cases'][0]['product'].update(title='Altered fictional listing'),
                    lambda d: next(iter(d['cases'][0]['sourceOrigins'].values()))[0].update(answer='SECRET_GENERATED'),
                    lambda d: d['inputArtifacts']['selectionAudit'].update(fileSha256='d' * 64),
                ]:
                    value = copy.deepcopy(original)
                    mutate(value)
                    m.flat.bind(value, 'deckSha256')
                    write(folder, 'new/deck.json', value)
                    with self.assertRaises(ValueError):
                        m.verify_deck(path)
                value = copy.deepcopy(original)
                source = value['cases'][0]['sources'][0]
                extra = ' SYNTHETIC fabricated fact.'
                old_id = source['id']
                source['text'] += extra
                source['id'] = f"epqa-{value['cases'][0]['product']['id']}-{source['label']}-{m.legacy.sha(m.legacy.compact([source['label'], source['text'], source['originalQuestion']]))[:16]}"
                origins = value['cases'][0]['sourceOrigins'].pop(old_id)
                for origin in origins:
                    origin['bodyEnd'] += len(extra)
                value['cases'][0]['sourceOrigins'][source['id']] = origins
                source['sha256'] = m.legacy.sha(json.dumps([source[key] for key in ('id', 'label', 'text', 'originalQuestion', 'reference')], ensure_ascii=False, separators=(',', ':')))
                value['cases'][0]['sourcePoolSha256'] = m.legacy.sha(m.legacy.compact(value['cases'][0]['sources']))
                m.flat.bind(value, 'deckSha256')
                write(folder, 'new/deck.json', value)
                with self.assertRaisesRegex(ValueError, 'producer selection record'):
                    m.verify_deck(path)
                write(folder, 'new/deck.json', original)
                (folder / 'new/exposure-audit.json').write_text('{}')
                with self.assertRaisesRegex(ValueError, 'raw-bound'):
                    m.verify_deck(path)


if __name__ == '__main__':
    unittest.main()
