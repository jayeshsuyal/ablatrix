"""Source-calibration selection contracts using fictional rows and temp files."""
import argparse
import copy
import hashlib
import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

PATH = pathlib.Path(__file__).with_name('prepare-source-calibration-cohort.py')
spec = importlib.util.spec_from_file_location('source_calibration_tested', PATH)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def row(pid, qid, title, question, body, source='description', number=2):
    return {'ASIN': pid, 'qid': str(qid), 'title': title, 'question': question,
            'candidate': body, 'source': source, 'qa_pair_id': str(number), 'row': number,
            'label': 'SECRET_LABEL', 'answer': 'SECRET_REFERENCE', 'outcome': 'SECRET_OUTCOME'}


def rows():
    return [
        row('B000000001', 1, 'Aster vessel', 'How many cups does this vessel hold?', 'This vessel holds 12 cups.'),
        row('B000000002', 2, 'Birch stand', 'What is the height of this stand?', 'This stand is 18 inches tall.'),
        row('B000000003', 3, 'Cedar basket', 'What material is this basket made of?', 'This basket is made of wood.'),
        row('B000000004', 4, 'Dahlia tray', 'What color is this tray?', 'This tray is white.'),
        row('B000000005', 5, 'Elm holder', 'Will this holder fit TULIP771?', 'Yes. Question: Will this holder fit AZURE441?', 'cqa'),
        row('B000000006', 6, 'Fir frame', 'Will this frame fit PEARL663?', 'Yes. Question: Will this frame fit ONYX995?', 'cqa'),
        row('B000000007', 7, 'Gorse bracket', 'Will this bracket fit ZEPHYR239?', 'This bracket is made of metal.'),
        row('B000000008', 8, 'Hazel bowl', 'Is a lid included with this bowl?', 'This bowl comes with a lid.'),
    ]


def audit():
    return {'protectedProducts': [], 'extraTitles': [], 'protectedTargetIdentifiers': [],
            'metadata': {'workspaces': [], 'comparisons': []}}


def freeze_file(folder):
    path = folder / 'candidate-freeze.json'
    path.write_text(json.dumps({**m.FROZEN_CANDIDATE, 'createdAt': '2026-10-18T03:00:00.000Z'}))
    return path


def prior_file(folder):
    cases, _, summary = m.select(rows(), audit())
    assert summary['passed']
    document = m.flat.bind({
        'format': 'ablatrix-source-calibration-cohort-v1',
        'status': {'generationPerformed': False}, 'cases': cases}, 'cohortSha256')
    path = folder / 'prior-cohort.json'
    path.write_text(json.dumps(document))
    return path


class SelectorTests(unittest.TestCase):
    def test_helpers_immutable_fixed_seed_and_row_order_determinism(self):
        m.verify_helpers()
        self.assertEqual(m.SEED, 'ablatrix-source-calibration-2026-10-18-v1')
        selected, decisions, inventory = m.select(rows(), audit())
        self.assertTrue(inventory['passed'])
        self.assertEqual(len(selected), 8)
        self.assertEqual(len({item['product']['id'] for item in selected}), 8)
        self.assertEqual(m.select(list(reversed(rows())), audit()), (selected, decisions, inventory))
        self.assertEqual(dict(m.STRATA), dict(__import__('collections').Counter(item['stratum'] for item in selected)))
        self.assertTrue(all(item['familyAudit']['status'] == 'pending_independent_source_and_family_review' for item in selected))
        self.assertNotIn('SECRET_', json.dumps((selected, decisions, inventory)))

    def test_complete_reviewer_pool_can_exceed_eight_and_preserves_source_hashes(self):
        data = rows()
        for index in range(9):
            data.append(row('B000000001', 1, 'Aster vessel', data[0]['question'],
                            f'Additional factual paragraph number {index}.', number=20 + index))
        selected, _, summary = m.select(data, audit())
        self.assertTrue(summary['passed'])
        case = next(item for item in selected if item['product']['id'] == 'B000000001')
        self.assertEqual(len(case['sources']), 10)
        self.assertEqual(case['sourcePoolSha256'], m.legacy.sha(m.legacy.compact(case['sources'])))
        for source in case['sources']:
            values = [source['id'], source['label'], source['text'], source['originalQuestion'], source['reference']]
            expected = hashlib.sha256(json.dumps(values, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
            self.assertEqual(source['sha256'], expected)
            self.assertLessEqual(len(source['text']), 2000)
        scoped = next(item for item in selected if item['product']['id'] == 'B000000005')
        self.assertEqual(scoped['sources'][0]['text'], 'Yes.')
        self.assertEqual(scoped['sources'][0]['originalQuestion'], 'Will this holder fit AZURE441?')
        self.assertTrue(scoped['sourceOrigins'])

    def test_exposed_product_family_identifiers_and_source_pool_are_excluded(self):
        for protected in [
            {'protectedProducts': [{'id': 'B000000001', 'title': ''}]},
            {'protectedProducts': [{'id': 'B000000099', 'title': 'Aster container'}]},
            {'protectedTargetIdentifiers': ['tulip771']},
        ]:
            value = audit()
            value.update(protected)
            selected, decisions, summary = m.select(rows(), value)
            self.assertFalse(summary['passed'])
            self.assertLess(len(selected), 8)
            self.assertTrue(any(not item['eligible'] and item['reason'].startswith(('previously_', 'protected_')) for item in decisions))
        duplicate = rows()
        duplicate.append(row('B000000009', 9, 'Iris vessel', duplicate[0]['question'], duplicate[0]['candidate']))
        with patch.object(m, 'STRATA', (('capacity_dimensions', 3),)):
            selected, decisions, summary = m.select(duplicate, audit())
        self.assertFalse(summary['passed'])
        fingerprints = [case['sourceSnapshotFingerprint'] for case in selected]
        self.assertEqual(len(set(fingerprints)), len(fingerprints))
        self.assertTrue(any(item.get('reason') == 'selected_source_pool_overlap' for item in decisions))

    def test_high_stakes_questions_and_products_are_rejected_before_ranking(self):
        for question in [
            'What voltage does this stand accept?', 'Is this tray safe for medical treatment?',
            'Does this bracket meet electrical wiring regulations?', 'Will this holder fit a pistol?',
            'Is this basket safe for carrying infants?', 'What medication dose fits in this vessel?',
            'Does the included battery need charging?',
            'Can this vessel hold 20psi?', 'Can this vessel be pressurized?',
            'Does this vessel support compressed gas?', 'Can this vessel withstand 20 PSIG?',
        ]:
            data = rows()
            data[0] = {**data[0], 'question': question}
            _, decisions, summary = m.select(data, audit())
            self.assertFalse(summary['passed'])
            self.assertTrue(any(item.get('qid') == '1' and item['reason'] == 'outside_consumer_demo_question_scope' for item in decisions))
        data = rows()
        data[0] = {**data[0], 'title': 'Aster medical vessel'}
        _, decisions, _ = m.select(data, audit())
        self.assertIn('outside_consumer_demo_domain', {item['reason'] for item in decisions if not item['eligible']})

    def test_pressure_source_exclusion_is_uniform_before_ranking(self):
        for body in ['The vessel is rated for 20psi.', 'Designed as a pressurized drum.',
                     'Suitable for compressed air.', 'Maximum pressure: 20 psi.']:
            data = rows()
            data[0]['candidate'] = body
            _, decisions, summary = m.select(data, audit())
            self.assertFalse(summary['passed'])
            self.assertTrue(any(item.get('productId') == 'B000000001' and
                                item['reason'] == 'outside_consumer_demo_source_scope'
                                for item in decisions))

    def test_brand_aliases_require_explicit_source_relationships(self):
        data = rows()
        data[0]['title'] = 'Amana vessel'
        protected = audit()
        protected['protectedProducts'] = [{'id': 'B000000099', 'title': 'Whirlpool agitator'}]
        _, _, summary = m.select(data, protected)
        self.assertTrue(summary['passed'], 'No corporate relationship may be assumed from brand names alone.')
        for text in ['Fits Whirlpool, Amana, Maytag and Kenmore appliances.',
                     'Manufacturer: { value: Whirlpool / Amana / Maytag / Kenmore }']:
            related = copy.deepcopy(data)
            related.append(row('B000000090', 90, 'Quartz accessory',
                               'What color is this item?', text))
            _, decisions, _ = m.select(related, protected)
            self.assertTrue(any(item.get('productId') == 'B000000001' and
                                item['reason'] == 'protected_brand_family_or_near_title'
                                for item in decisions))

    def test_kitchenaid_alias_needs_source_evidence_and_does_not_link_mount_compatibility(self):
        protected = audit()
        protected['protectedProducts'] = [{'id': 'B000000099', 'title': 'Whirlpool agitator'}]
        for title in ['KitchenAid mixing bowl', 'Kitchen Aid mixing bowl']:
            data = rows()
            data[0]['title'] = title
            _, _, summary = m.select(data, protected)
            self.assertTrue(summary['passed'], 'Corporate aliases cannot be assumed without source evidence.')
            related = data + [row('B000000090', 90, 'Quartz accessory',
                                 'What color is this item?',
                                 'Compatible appliance parts for Whirlpool, Kenmore and KitchenAid.')]
            _, decisions, _ = m.select(related, protected)
            self.assertTrue(any(item.get('productId') == 'B000000001' and
                                item['reason'] == 'protected_brand_family_or_near_title'
                                for item in decisions))
        camera = rows()
        camera[0]['title'] = 'Lensmate camera lens'
        camera[0]['candidate'] = 'This lens holds 12 cups. Compatible with Canon camera mounts.'
        separate = audit()
        separate['protectedProducts'] = [{'id': 'B000000099', 'title': 'Canon toner cartridge'}]
        _, _, summary = m.select(camera, separate)
        self.assertTrue(summary['passed'], 'Mount compatibility alone must not create a manufacturer-family alias.')

    def test_multiple_prior_drafts_protect_every_product(self):
        with tempfile.TemporaryDirectory() as name:
            folder = pathlib.Path(name)
            first_path = prior_file(folder)
            second_path = folder / 'second-cohort.json'
            second = json.loads(first_path.read_text())
            extra_rows = []
            for index, case in enumerate(second['cases']):
                original_id = case['product']['id']
                new_id = f'B0000001{index:02d}'
                case['product']['id'] = new_id
                extra_rows.extend({**item, 'ASIN': new_id, 'qid': str(100 + index)}
                                  for item in rows() if item['ASIN'] == original_id)
            m.flat.bind(second, 'cohortSha256')
            second_path.write_text(json.dumps(second))
            priors = [m.prior_cohort(first_path), m.prior_cohort(second_path)]
            _, _, summary = m.select(rows() + extra_rows, audit(), priors)
            self.assertEqual(summary['rejectedCounts']['previously_exposed_or_reserved'], 16)
            self.assertFalse(summary['passed'])

    def test_prior_draft_protects_products_families_models_and_renamed_source_packets(self):
        with tempfile.TemporaryDirectory() as name:
            prior = m.prior_cohort(prior_file(pathlib.Path(name)))
            self.assertEqual(len(prior['projection']['productIds']), 8)
            _, decisions, summary = m.select(rows(), audit(), [prior])
            self.assertFalse(summary['passed'])
            self.assertEqual(summary['rejectedCounts']['previously_exposed_or_reserved'], 8)
            for title, question, body, expected in [
                ('Ivory object', 'How many cups does this item hold?', 'This vessel holds 12 cups.', 'protected_prior_source_packet'),
                ('Aster container', 'How many cups does this item hold?', 'Different factual source.', 'protected_brand_family_or_near_title'),
                ('Ivory object', 'Will this object fit TULIP771?', 'Different factual source.', 'protected_full_source_identifier_or_near_model'),
            ]:
                _, decisions, _ = m.select([row('B000000099', 99, title, question, body)], audit(), [prior])
                self.assertIn(expected, {item['reason'] for item in decisions})
            self.assertNotIn('SECRET_', json.dumps(prior))

    def test_prior_cohort_integrity_and_source_binding_are_required(self):
        with tempfile.TemporaryDirectory() as name:
            path = prior_file(pathlib.Path(name))
            original = json.loads(path.read_text())
            for mutate in [
                lambda d: d['status'].update(generationPerformed=True),
                lambda d: d['cases'][0]['sources'][0].update(text='Changed source.'),
                lambda d: d['cases'][0].update(sourcePoolSha256='0' * 64),
            ]:
                document = copy.deepcopy(original)
                mutate(document)
                m.flat.bind(document, 'cohortSha256')
                path.write_text(json.dumps(document))
                with self.assertRaises(ValueError):
                    m.prior_cohort(path)

    def test_prior_review_is_bound_to_the_explicit_draft_and_remains_a_rejection(self):
        with tempfile.TemporaryDirectory() as name:
            folder = pathlib.Path(name)
            prior = m.prior_cohort(prior_file(folder))['projection']
            path = folder / 'review.json'
            review = {'status': 'failed', 'provenance': 'independent_ai_source_and_family_review',
                      'cohortFileSha256': prior['fileSha256']}
            path.write_text(json.dumps(review))
            result = m.prior_source_reviews([path], [prior])
            self.assertEqual(result[0]['fileSha256'], m.legacy.sha(path.read_bytes()))
            for update in [{'status': 'passed'}, {'cohortFileSha256': '0' * 64},
                           {'provenance': 'self_review'}]:
                path.write_text(json.dumps({**review, **update}))
                with self.assertRaises(ValueError):
                    m.prior_source_reviews([path], [prior])

    def test_prior_reviews_cover_multiple_cohorts_exactly_once(self):
        with tempfile.TemporaryDirectory() as name:
            folder = pathlib.Path(name)
            priors = [{'fileSha256': '1' * 64}, {'fileSha256': '2' * 64}]
            paths = [folder / f'review-{index}.json' for index in range(3)]
            for index, cohort in enumerate([priors[0], priors[0], priors[1]]):
                paths[index].write_text(json.dumps({
                    'status': 'failed', 'provenance': 'independent_ai_source_and_family_review',
                    'cohortFileSha256': cohort['fileSha256'], 'independentReviewId': index,
                }))
            # Different files and hashes are insufficient when both cover only
            # the first cohort: the second cohort still lacks its own review.
            self.assertNotEqual(m.legacy.sha(paths[0].read_bytes()), m.legacy.sha(paths[1].read_bytes()))
            for incomplete in [[], paths[:1], paths[:2], paths]:
                with self.assertRaisesRegex(ValueError, 'every prior cohort exactly once'):
                    m.prior_source_reviews(incomplete, priors)
            valid = m.prior_source_reviews([paths[0], paths[2]], priors)
            self.assertEqual({item['cohortFileSha256'] for item in valid},
                             {item['fileSha256'] for item in priors})
            self.assertEqual(len(valid), 2)

    def test_pool_and_context_bounds_remain_fail_closed_without_replacement(self):
        oversized = rows()
        oversized[0]['candidate'] = 'x' * 1501
        _, _, summary = m.select(oversized, audit())
        self.assertIn('full_source_parent_exceeds_1500', summary['rejectedCounts'])
        data = rows()
        data += [row('B000000001', 1, 'Aster vessel', data[0]['question'],
                     f'Unique complete source {index}.', number=100 + index) for index in range(128)]
        _, decisions, summary = m.select(data, audit())
        self.assertFalse(summary['passed'])
        self.assertIn('full_pool_exceeds_128', summary['rejectedCounts'])
        self.assertEqual(sum(summary['rejectedCounts'].values()), sum(not item['eligible'] for item in decisions))
        data = rows()
        data[4]['candidate'] = 'Yes. Question: One? Question: Two?'
        _, decisions, summary = m.select(data, audit())
        self.assertFalse(summary['passed'])
        self.assertIn('ambiguous_cqa_context', summary['rejectedCounts'])

    def test_candidate_freeze_checked_before_csv_or_metadata_access(self):
        with tempfile.TemporaryDirectory() as name:
            folder = pathlib.Path(name)
            path = freeze_file(folder)
            expected = m.candidate_freeze(path)
            self.assertEqual(expected['fileSha256'], hashlib.sha256(path.read_bytes()).hexdigest())
            for field, value in [('frozen', False), ('systemInstructionsSha256', '0' * 64),
                                 ('selectionSeed', 'different-seed'), ('createdAt', '2026-10-18')]:
                document = json.loads(path.read_text())
                document[field] = value
                bad = folder / (field + '.json')
                bad.write_text(json.dumps(document))
                args = argparse.Namespace(candidate_freeze=str(bad), prepare_dir=str(folder / 'new'), train='not-to-read')
                with patch.object(m.flat, 'load_rows', side_effect=AssertionError('CSV must not open')), patch.object(m.flat, 'exposure', side_effect=AssertionError('Metadata must not open')):
                    with self.assertRaisesRegex(ValueError, 'Candidate freeze'):
                        m.prepare(args)

    def test_pinned_projection_discards_reference_labels(self):
        with tempfile.TemporaryDirectory() as name:
            path = pathlib.Path(name) / 'fictional.csv'
            path.write_text('qid,question,ASIN,candidate,source,qa_pair_id,title,label,answer\n1,How many cups?,B000000001,Holds 10 cups.,description,1,Aster vessel,SECRET_LABEL,SECRET_REFERENCE\n')
            with self.assertRaisesRegex(ValueError, 'checksum'):
                m.flat.load_rows(path)
            with patch.object(m.legacy, 'TRAIN_SHA', m.legacy.sha(path.read_bytes())):
                projected = m.flat.load_rows(path)
            self.assertEqual(set(projected[0]), set(m.flat.ALLOWED_COLUMNS) | {'row'})
            self.assertNotIn('SECRET_', json.dumps(projected))

    def test_current_metadata_selects_only_source_fields_and_never_changes_stores(self):
        with tempfile.TemporaryDirectory() as name:
            folder = pathlib.Path(name)
            workspace, comparison = folder / 'workspace.sqlite', folder / 'comparison.sqlite'
            with sqlite3.connect(workspace) as db:
                db.execute('CREATE TABLE workspace_products(id TEXT,document TEXT)')
                db.execute('CREATE TABLE workspace_runs(id TEXT,document TEXT)')
                db.execute('INSERT INTO workspace_products VALUES (?,?)', ('p', json.dumps({'id': 'p', 'title': 'Aster vessel', 'answer': 'SECRET_GENERATED', 'sources': [{'id': 's', 'label': 'description', 'text': 'Capacity 10 cups.'}]})))
                db.execute('INSERT INTO workspace_runs VALUES (?,?)', ('r', json.dumps({'productId': 'p', 'question': 'What is its capacity?', 'answer': 'SECRET_GENERATED', 'reviewContext': {'product': {'title': 'Aster vessel'}, 'sources': []}})))
            with sqlite3.connect(comparison) as db:
                db.execute('CREATE TABLE context_comparisons(id TEXT,document TEXT)')
                db.execute('CREATE TABLE context_comparison_exposure(mode TEXT,product_id TEXT,fingerprint TEXT)')
                case = {'product': {'id': 'B000000002', 'title': 'Birch stand'}, 'question': 'How tall?', 'sources': [], 'arms': {'answer': 'SECRET_GENERATED'}}
                db.execute('INSERT INTO context_comparisons VALUES (?,?)', ('c', json.dumps({'mode': 'live', 'cases': [case]})))
                db.execute('INSERT INTO context_comparison_exposure VALUES (?,?,?)', ('live', 'B000000002', 'fingerprint'))
            before = {path: path.read_bytes() for path in (workspace, comparison)}
            metadata = m.flat.current_metadata([workspace], [comparison])
            self.assertNotIn('SECRET_', json.dumps(metadata))
            self.assertEqual(before, {path: path.read_bytes() for path in before})

    def test_prepare_records_pending_audits_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as name:
            folder = pathlib.Path(name)
            freeze = freeze_file(folder)
            exposure = m.flat.bind(audit(), 'auditSha256')
            args = argparse.Namespace(candidate_freeze=str(freeze), prepare_dir=str(folder / 'output'), train='fictional-only', workspace_db=[], comparison_db=[], exposure_audit='fictional-only')
            with patch.object(m.flat, 'load_rows', return_value=rows()), patch.object(m.flat, 'exposure', return_value=exposure):
                result = m.prepare(args)
                with self.assertRaisesRegex(ValueError, 'must be new'):
                    m.prepare(args)
            document = json.loads((folder / 'output/cohort.json').read_text())
            self.assertEqual(result['cases'], 8)
            self.assertFalse(result['paidExecutionAuthorized'])
            self.assertEqual(document['candidateFreeze']['fileSha256'], m.legacy.sha(freeze.read_bytes()))
            self.assertEqual(document['status']['independentSourceAndFamilyReview'], 'pending')
            self.assertFalse(document['status']['cohortFrozen'])
            self.assertFalse(document['status']['generationPerformed'])
            self.assertNotIn('SECRET_', json.dumps(document))
            self.assertEqual(document['cohortSha256'], m.flat.checksum(document, 'cohortSha256'))


if __name__ == '__main__':
    unittest.main()
