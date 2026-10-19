"""Fictional source-only contracts; never select from the actual train CSV."""
import argparse
import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest
import uuid
from unittest.mock import patch

PATH = pathlib.Path(__file__).with_name('prepare-retrieval-coverage-cohort.py')
spec = importlib.util.spec_from_file_location('retrieval_coverage_tested', PATH)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
fixture_spec = importlib.util.spec_from_file_location('source_selection_fixtures', PATH.with_name('test_prepare_source_calibration_cohort.py'))
fixture = importlib.util.module_from_spec(fixture_spec)
fixture_spec.loader.exec_module(fixture)


def write(folder, name, document):
    path = folder / name
    path.write_text(json.dumps(document, ensure_ascii=False))
    return path


def archive(folder, tag, offset, actual_cases=False):
    cases = m.base.select(fixture.rows(), fixture.audit())[0]
    if not actual_cases:
        for index, case in enumerate(cases):
            case['id'] = f'history-{tag}-{index}'
            case['product'] = {'id': f'B{offset + index:09d}', 'title': f'Historical {tag} article {index}'}
            case['question'] = 'What finish is listed on this historical article?'
            source = {'id': f'history-{tag}-{index}', 'label': 'SYNTHETIC historical source',
                      'text': f'Archived {tag} source for fictional article number {index}.',
                      'originalQuestion': None, 'reference': 'synthetic:archive'}
            source['sha256'] = m.legacy.sha(json.dumps([source[key] for key in ('id', 'label', 'text', 'originalQuestion', 'reference')], ensure_ascii=False, separators=(',', ':')))
            case['sources'] = [source]
            case['sourcePoolSha256'] = m.legacy.sha(m.legacy.compact(case['sources']))
    cohort = m.flat.bind({'format': 'ablatrix-source-calibration-cohort-v1', 'status': {'generationPerformed': False}, 'cases': cases}, 'cohortSha256')
    path = write(folder, tag + '-cohort.json', cohort)
    review = {'format': 'source-calibration-source-family-review-v1',
              'status': 'passed' if tag == 'consumed' else 'failed',
              'provenance': 'independent_ai_source_and_family_review',
              'cohortFileSha256': m.legacy.sha(path.read_bytes()),
              'cases': [{'caseId': c['id'], 'sourceScopeReviewed': True,
                         'familySeparationReviewed': True, 'notes': 'SYNTHETIC source check.'} for c in cases]}
    review_path = write(folder, tag + '-review.json', review)
    return path, review_path, cases


def consumed_record(folder, cohort_path, review_path, cases, count=1):
    slots = [(case['id'], arm) for case in cases for arm in ('baseline', 'candidate')]
    value = {'format': 'ablatrix-consumed-source-cohort-execution-v1',
             'cohortFileSha256': m.legacy.sha(cohort_path.read_bytes()),
             'sourceReviewFileSha256': m.legacy.sha(review_path.read_bytes()),
             'planSha256': 'a' * 64, 'generationPerformed': True, 'newProviderAttempts': count,
             'attempts': [{'caseId': case_id, 'arm': arm, 'attemptId': str(uuid.uuid4())} for case_id, arm in slots[:count]],
             'modelOutputsUsed': False, 'generatedAnswersOrJudgmentsRead': False,
             'provenance': 'allowlisted_existing_execution_metadata_for_full_cohort_exclusion',
             'sourceExecutionRecordFileSha256': 'b' * 64}
    return write(folder, 'execution.json', value)


def inputs(folder):
    one = archive(folder, 'rejectedone', 101)
    two = archive(folder, 'rejectedtwo', 201)
    consumed = archive(folder, 'consumed', 301)
    execution = consumed_record(folder, *consumed)
    stores = [folder / f'synthetic-{index}.sqlite' for index in range(3)]
    for path in stores:
        path.touch()
    return argparse.Namespace(candidate_freeze='synthetic-freeze', train='synthetic-pinned.csv',
        prepare_dir=str(folder / 'new'), workspace_db=[str(p) for p in stores[:2]],
        comparison_db=[str(stores[2])], prior_cohort=[str(one[0]), str(two[0])],
        prior_source_review=[str(one[1]), str(two[1])], consumed_cohort=str(consumed[0]),
        consumed_source_review=str(consumed[1]), consumed_execution_record=str(execution))


class RetrievalSelectionTests(unittest.TestCase):
    def test_old_defaults_remain_unchanged_new_seed_and_prefix_are_explicit(self):
        m.verify_helpers()
        default = m.base.select(fixture.rows(), fixture.audit())
        self.assertTrue(default[2]['passed'])
        self.assertTrue(all(case['id'].startswith('source-calibration-train-') for case in default[0]))
        selected = m.base.select(fixture.rows(), fixture.audit(), seed=m.SEED, case_prefix=m.CASE_PREFIX)
        self.assertTrue(selected[2]['passed'])
        self.assertEqual(selected, m.base.select(list(reversed(fixture.rows())), fixture.audit(), seed=m.SEED, case_prefix=m.CASE_PREFIX))
        for case in selected[0]:
            self.assertEqual(case['id'], f"retrieval-coverage-train-{case['upstream']['qid']}")
            self.assertEqual(case['selectionRankSha256'], m.legacy.sha(f"{m.SEED}:{case['stratum']}:{case['upstream']['qid']}"))
        self.assertNotIn('SECRET_', json.dumps(selected))

    def test_one_attempt_protects_entire_consumed_cohort_and_source_families(self):
        with tempfile.TemporaryDirectory() as name:
            folder = pathlib.Path(name)
            cohort, review, cases = archive(folder, 'consumed', 301, actual_cases=True)
            execution = consumed_record(folder, cohort, review, cases)
            consumed = m.consumed_cohort(cohort, review, execution)
            self.assertEqual(len(consumed['projection']['productIds']), 8)
            self.assertEqual(consumed['projection']['newProviderAttempts'], 1)
            self.assertTrue(consumed['projection']['generationPerformed'])
            selected, _, summary = m.base.select(fixture.rows(), fixture.audit(), [consumed], seed=m.SEED, case_prefix=m.CASE_PREFIX)
            self.assertFalse(summary['passed'])
            self.assertEqual(summary['rejectedCounts']['previously_exposed_or_reserved'], 8)
            for title, body, question, reason in [
                ('Ivory object', 'This vessel holds 12 cups.', 'How many cups does it hold?', 'protected_prior_source_packet'),
                ('Aster container', 'Different source.', 'What size is this?', 'protected_brand_family_or_near_title'),
                ('Ivory object', 'Different source.', 'Does it fit TULIP771?', 'protected_full_source_identifier_or_near_model'),
            ]:
                _, decisions, _ = m.base.select([fixture.row('B000000099', 99, title, question, body)], fixture.audit(), [consumed], seed=m.SEED, case_prefix=m.CASE_PREFIX)
                self.assertIn(reason, {d['reason'] for d in decisions})

    def test_consumed_scope_bindings_and_passed_review_are_strict_without_outcome_fields(self):
        with tempfile.TemporaryDirectory() as name:
            folder = pathlib.Path(name)
            cohort, review, cases = archive(folder, 'consumed', 301)
            execution = consumed_record(folder, cohort, review, cases, 16)
            original = json.loads(execution.read_text())
            self.assertEqual(m.consumed_cohort(cohort, review, execution)['projection']['newProviderAttempts'], 16)
            changes = [lambda d: d.update(answer='SECRET_GENERATED'), lambda d: d.update(judgments=['SECRET_VERDICT']),
                       lambda d: d.update(newProviderAttempts=0), lambda d: d.update(cohortFileSha256='0' * 64),
                       lambda d: d.update(sourceReviewFileSha256='0' * 64), lambda d: d.update(modelOutputsUsed=True),
                       lambda d: d['attempts'][0].update(caseId='unplanned'),
                       lambda d: d['attempts'][0].update(arm='revision'),
                       lambda d: d['attempts'][0].update(attemptId=d['attempts'][1]['attemptId']),
                       lambda d: d['attempts'][0].update(caseId=d['attempts'][1]['caseId'], arm=d['attempts'][1]['arm'])]
            for change in changes:
                value = copy.deepcopy(original)
                change(value)
                execution.write_text(json.dumps(value))
                with self.assertRaises(ValueError):
                    m.consumed_cohort(cohort, review, execution)
            execution.write_text(json.dumps(original))
            value = json.loads(review.read_text())
            value['status'] = 'failed'
            review.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError, 'passed'):
                m.consumed_cohort(cohort, review, execution)

    def test_rejected_and_consumed_records_remain_separate_and_one_to_one(self):
        with tempfile.TemporaryDirectory() as name:
            args = inputs(pathlib.Path(name))
            priors, reviews, consumed = m.protected_inputs(args)
            self.assertEqual(len(priors), 2)
            self.assertTrue(all(r['status'] == 'failed' for r in reviews))
            self.assertTrue(consumed['projection']['generationPerformed'])
            args.prior_source_review[1] = args.prior_source_review[0]
            with self.assertRaises(ValueError):
                m.protected_inputs(args)
            args = inputs(pathlib.Path(name))
            args.prior_cohort[0] = args.consumed_cohort
            args.prior_source_review[0] = args.consumed_source_review
            with self.assertRaises(ValueError):
                m.protected_inputs(args)

    def test_freeze_checks_code_and_contract_before_csv_or_store_access(self):
        with tempfile.TemporaryDirectory() as name:
            root = pathlib.Path(name).resolve()
            hashes = {}
            for relative in m.REQUIRED_CODE:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('SYNTHETIC code')
                hashes[relative] = m.legacy.sha(path.read_bytes())
            value = {**m.FROZEN_FIELDS, 'createdAt': '2026-10-18T00:00:00Z', 'implementationSha256': hashes}
            freeze = write(root, 'freeze.json', value)
            with patch.object(m, 'ROOT', root), patch.object(m, 'verify_helpers'):
                self.assertEqual(m.candidate_freeze(freeze)['document'], value)
                for change in [lambda d: d.update(frozen=False), lambda d: d.update(selectionSeed='changed'), lambda d: d.update(systemInstructionsSha256='0' * 64), lambda d: d['implementationSha256'].update({'server/workspace-source-coverage.ts': '0' * 64}), lambda d: d['implementationSha256'].update({'': '0' * 64}), lambda d: d['implementationSha256'].update({'../external': '0' * 64})]:
                    altered = copy.deepcopy(value)
                    change(altered)
                    freeze.write_text(json.dumps(altered))
                    with patch.object(m.flat, 'load_rows', side_effect=AssertionError('CSV must not open')), patch.object(m.flat, 'exposure', side_effect=AssertionError('Store must not open')):
                        with self.assertRaises(ValueError):
                            m.prepare(argparse.Namespace(candidate_freeze=str(freeze)))

    def test_preparation_seals_all_protections_and_never_overwrites_or_leaks_outcomes(self):
        with tempfile.TemporaryDirectory() as name:
            root = pathlib.Path(name)
            args = inputs(root)
            audit = m.flat.bind({**fixture.audit(), 'metadataOnly': True}, 'auditSha256')
            freeze = {'fileSha256': 'f' * 64, 'document': {**m.FROZEN_FIELDS}}
            with patch.object(m, 'candidate_freeze', return_value=freeze), patch.object(m.flat, 'load_rows', return_value=fixture.rows()), patch.object(m.flat, 'exposure', return_value=audit):
                summary = m.prepare(args)
                self.assertEqual(summary['cases'], 8)
                cohort = json.loads((root / 'new/cohort.json').read_text())
                selection = json.loads((root / 'new/selection-audit.json').read_text())
                self.assertEqual(cohort['cohortSha256'], m.flat.checksum(cohort, 'cohortSha256'))
                self.assertEqual(selection['selectionAuditSha256'], m.flat.checksum(selection, 'selectionAuditSha256'))
                for key in ('priorCohorts', 'priorSourceReviews', 'consumedCohorts', 'inventoryInputs', 'immutableHelperSha256'):
                    self.assertEqual(cohort['selection'][key], selection[key])
                self.assertEqual(len(selection['priorCohorts']), 2)
                self.assertEqual(len(selection['consumedCohorts']), 1)
                self.assertFalse(selection['modelOutputsUsed'])
                self.assertFalse(cohort['status']['generationPerformed'])
                self.assertNotIn('SECRET_', json.dumps((cohort, selection)))
                with patch.object(m.flat, 'load_rows', side_effect=AssertionError('No selection after existing output')):
                    with self.assertRaisesRegex(ValueError, 'new private'):
                        m.prepare(args)
            args.workspace_db[1] = args.workspace_db[0]
            with self.assertRaisesRegex(ValueError, 'distinct'):
                m.inventory_inputs(args)


if __name__ == '__main__':
    unittest.main()
