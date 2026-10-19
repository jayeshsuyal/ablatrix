"""Synthetic prospective mechanics only; never selects a real fresh product."""
import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('fresh', pathlib.Path(__file__).with_name('prepare-fresh-validation-v1.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def sources(number, text=None, question=None):
    rows = [{'id': f'source-{number}', 'label': 'cqa', 'text': text or f'SYNTHETIC report unique {number}', 'originalQuestion': question, 'reference': 'SYNTHETIC fixture'}]
    for source in rows:
        source['sha256'] = m.sha(m.compact([source[k] for k in ('id', 'label', 'text', 'originalQuestion', 'reference')]))
    return rows

def pool():
    return {'format': 'ablatrix-fresh-source-only-pool-v1', 'cases': [{'id': f'SYNTHETIC-{i}', 'product': {'id': f'B{i:09d}', 'title': f'Brand{chr(65+i)} unique fixture'}, 'question': 'How long?', 'sources': sources(i), 'sourcePoolSha256': m.sha(m.compact(sources(i)))} for i in range(24)]}

def frozen():
    return {'history': {'fileSha256': '1'*64, 'document': {'productIds': [], 'canonicalFamilyTitles': [], 'modelIdentifiers': [], 'sourcePacketFingerprints': []}},
            'protocol': {'fileSha256': '2'*64}, 'freeze': {'fileSha256': '3'*64}}

def screen(document=None, history=None):
    f = frozen()
    if history: f['history']['document'].update(history)
    return m.screen_document({'fileSha256': '4'*64, 'document': document or pool()}, f, {'fileSha256': '5'*64})

def review_inputs():
    s = screen()
    # Synthetic titles are intentionally distinctive; model/family guard may
    # reject near-identical names, so isolated selector fixtures set eligibility.
    for row in s['decisions']: row['eligible'] = True; row['reasons'] = []
    s['acceptedCaseIds'] = [r['caseId'] for r in s['decisions']]
    baseline = {'format': 'ablatrix-fresh-validation-baseline-v1', 'screeningSha256': s['screeningSha256'], 'candidateContextInspected': False,
                'results': [{'caseId': r['caseId'], 'baseline': [r['packet']['sources'][0]] if i in {1,2} else []} for i,r in enumerate(s['decisions'])]}
    cases = []
    for i,r in enumerate(s['decisions']):
        c = r['packet']; source = c['sources'][0]
        tags = ['supported_gap'] if i == 0 else ['baseline_complete_control'] if i in {1,2} else ['insufficient_evidence'] if i == 3 else ['uncertain']
        cases.append({'caseId': c['id'], 'sourcePoolSha256': c['sourcePoolSha256'], 'sourceScopeReviewed': True,
                      'originalQuestionsReviewed': True, 'familySeparationReviewed': True, 'titleAndBaselineReviewed': True,
                      'referenceSufficiencyReviewed': True, 'baselineContextSha256': m.sha(m.compact(baseline['results'][i]['baseline'])), 'tags': tags,
                      'unknowns': ['SYNTHETIC average unknown'], 'applicabilityNotes': 'SYNTHETIC source report only',
                      'referenceSourceIds': [source['id']], 'designatedFacts': [{'fact': 'SYNTHETIC report', 'quote': source['text'], 'sourceIds': [source['id']], 'qualification': 'SYNTHETIC customer conditions', 'applicability': 'SYNTHETIC exact product'}],
                      'noEquivalentFactInBaseline': True, 'baselineComplete': i in {1,2}, 'insufficiencyNotes': 'SYNTHETIC insufficient population evidence'})
    review = {'format': 'ablatrix-fresh-validation-source-review-v1', 'screeningSha256': s['screeningSha256'], 'baselineSha256': m.seal(baseline),
              'candidateContextInspected': False, 'answerOutputsInspected': False, 'provenance': 'independent_source_review_ai', 'reviewer': 'SYNTHETIC reviewer', 'cases': cases}
    return s, baseline, review

class FreshValidationTests(unittest.TestCase):
    def test_repeated_packet_is_rejected_across_ids_and_original_scope_is_preserved(self):
        p = pool(); p['cases'][1]['sources'] = sources(1, '  SHARED literal  body ', 'Model AB-1?')
        p['cases'][0]['sources'] = sources(0, 'shared literal body', ' model ab-1? ')
        for c in p['cases']: c['sourcePoolSha256'] = m.sha(m.compact(c['sources']))
        result = screen(p)
        self.assertFalse(result['packetGuard']['passed'])
        self.assertTrue(any('within_deck_packet_guard' in r['reasons'] for r in result['decisions']))
        p['cases'][1]['sources'] = sources(1, '  SHARED literal  body ', 'Model AB-2?')
        p['cases'][1]['sourcePoolSha256'] = m.sha(m.compact(p['cases'][1]['sources']))
        self.assertTrue(screen(p)['packetGuard']['passed'])

    def test_history_fingerprint_product_family_and_model_protections_apply_before_acceptance(self):
        p = pool(); target = p['cases'][0]
        for h, reason in [({'productIds': [target['product']['id']]}, 'product'),
                          ({'canonicalFamilyTitles': [target['product']['title']]}, 'family'),
                          ({'sourcePacketFingerprints': [m.packet.fingerprint(target['sources'][0])]}, 'body_and_original_question')]:
            row = next(r for r in screen(p, h)['decisions'] if r['caseId'] == target['id'])
            self.assertFalse(row['eligible']); self.assertTrue(any(reason in x for x in row['reasons']))
        p['cases'][0]['question'] = 'Does model ZX90001 work?'
        row = next(r for r in screen(p, {'modelIdentifiers': ['zx90001']})['decisions'] if r['caseId'] == target['id'])
        self.assertIn('historical_or_within_pool_model', row['reasons'])

    def test_explicit_historical_identifier_projections_reject_unrelated_title_packets(self):
        fields = ('protectedTargetIdentifiers', 'modelIdentifiers', 'manuallyConsideredIdentifiers',
                  'fullContextModelIdentifiers', 'questionTargetIdentifiers', 'titleModelIdentifiers',
                  'requestedIdentifiers', 'sourceManufacturerBrandIdentifiers')
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp).resolve()
            for field in fields:
                with self.subTest(field=field):
                    (root/'audit.json').write_text(json.dumps({'checks': {field: ['ＷＫ-500']}}))
                    history = m.inventory(root, ['audit.json'])
                    candidate = pool(); candidate['cases'][0]['question'] = 'Does this work with WK-500?'
                    row = next(r for r in screen(candidate, history)['decisions'] if r['caseId'] == 'SYNTHETIC-0')
                    self.assertFalse(row['eligible'])
                    self.assertIn('historical_or_within_pool_model', row['reasons'])

    def test_explicit_digit_free_family_and_brand_aliases_are_family_exclusions(self):
        aliases = {'manuallyConsideredIdentifiers': 'Under Armour Reflex',
                   'sourceManufacturerBrandIdentifiers': 'Brita',
                   'sourceEstablishedApplianceBrandVocabulary': 'Maytag'}
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp).resolve()
            for field, alias in aliases.items():
                with self.subTest(field=field):
                    (root/'audit.json').write_text(json.dumps({field: [alias]}))
                    history = m.inventory(root, ['audit.json'])
                    candidate = pool(); candidate['cases'][0]['product']['title'] = alias + ' novel fixture'
                    row = next(r for r in screen(candidate, history)['decisions'] if r['caseId'] == 'SYNTHETIC-0')
                    self.assertFalse(row['eligible'])
                    self.assertIn('historical_or_within_pool_family', row['reasons'])

    def test_real_saved_manual_family_audit_protects_wk500_and_family_projection(self):
        history = m.inventory(m.ROOT, ['docs/evidence/flat-source-quality-2026-10-11/manual-family-audit.json'])
        self.assertIn('wk500', history['modelIdentifiers'])
        self.assertIn(m.family('Casio SP-20 sustain pedal with WK-110 target'), history['canonicalFamilyTitles'])
        candidate = pool(); candidate['cases'][0]['question'] = 'Does this work with WK-500?'
        row = next(r for r in screen(candidate, history)['decisions'] if r['caseId'] == 'SYNTHETIC-0')
        self.assertFalse(row['eligible'])
        self.assertIn('historical_or_within_pool_model', row['reasons'])

    def test_pool_rejects_answers_extra_fields_scope_hash_changes_and_unbounded_denominator(self):
        for mutate in [lambda p: p['cases'][0].update(answer='outcome'), lambda p: p['cases'].pop(), lambda p: p['cases'][0]['sources'][0].update(originalQuestion='wrong scope')]:
            p = pool(); mutate(p)
            with self.assertRaises(ValueError): m.source_cases(p)

    def test_pending_review_stops_before_pool_read_even_if_pool_does_not_exist(self):
        f = frozen()
        with mock.patch.object(m, 'verify_freeze', return_value=f), mock.patch.object(m, 'read', return_value={'document': {'format': 'ablatrix-fresh-validation-source-screening-qualification-v1', 'status': 'review_pending'}}) as read:
            with self.assertRaisesRegex(ValueError, 'fresh packet not read'):
                m.load_screening(pathlib.Path('/private/tmp'), '/private/tmp/frozen', 'qualification.json', 'MUST-NOT-READ.json')
            self.assertEqual(read.call_count, 1)
            self.assertEqual(read.call_args.args[1], 'qualification.json')

    def test_qualification_binds_raw_reviewed_artifacts_and_finite_pool(self):
        f = frozen(); f['protocol']['document'] = {'createdAt': '2026-10-19T00:00:00+00:00'}
        q = {'format': 'ablatrix-fresh-validation-source-screening-qualification-v1', 'status': 'reviewed_for_source_only_screening',
             'protocolFileSha256': '2'*64, 'candidateFreezeFileSha256': '3'*64, 'historyInventoryFileSha256': '1'*64,
             'reviewer': 'SYNTHETIC independent review', 'provenance': 'independent_code_review_ai', 'freshInputsInspectedBeforeReview': False,
             'poolFileSha256': '4'*64, 'reviewEvidence': 'SYNTHETIC reviewed exact diff', 'reviewedAt': '2026-10-19T01:00:00+00:00'}
        with mock.patch.object(m, 'read', return_value={'document': q}): self.assertIsNotNone(m.qualify(pathlib.Path('/private/tmp'), f, 'q'))
        q['historyInventoryFileSha256'] = '6'*64
        with mock.patch.object(m, 'read', return_value={'document': q}), self.assertRaisesRegex(ValueError, 'raw artifact'): m.qualify(pathlib.Path('/private/tmp'), f, 'q')

    def test_minima_shortfall_retains_all24_and_never_replaces_uncertain_cases(self):
        s,b,r = review_inputs(); result = m.finalize_document(s,b,r)
        self.assertEqual(result['stopReason'], 'source_only_minima_unsatisfied')
        self.assertEqual(result['missingMinima'], {'conflicting_reports': 1})
        self.assertEqual(len(result['screenedCaseIds']), 24); self.assertEqual(result['selectedDenominator'], 8)
        self.assertFalse(result['candidateContextInspected']); self.assertTrue(result['candidateMissesRetained'])

    def test_missing_review_or_unreviewed_source_scope_stops_before_selection(self):
        for change in [lambda r: r['cases'].pop(), lambda r: r['cases'][0].update(originalQuestionsReviewed=False), lambda r: r.update(candidateContextInspected=True), lambda r: r['cases'][0]['designatedFacts'][0].update(sourceIds=['wrong-source'])]:
            s,b,r = review_inputs(); change(r)
            with self.assertRaises(ValueError): m.finalize_document(s,b,r)

    def test_history_union_uses_raw_embedded_scopes_without_git_or_ignored_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp).resolve()
            source = {'id': 's', 'label': 'cqa', 'text': 'Literal answer.', 'originalQuestion': 'Model ZZ-100?'}
            embedded = json.dumps({'cases': [{'product': {'id': 'B000000001', 'title': 'Historical title'}, 'sources': [source]}]})
            raw = {'files': {'ignored/work/cohort.json': {'utf8': embedded, 'sha256': m.sha(embedded)}}}
            (root/'public.json').write_text(json.dumps(raw))
            result = m.inventory(root, ['public.json'])
            self.assertEqual(result['productIds'], ['B000000001'])
            self.assertIn(m.packet.fingerprint(source), result['sourcePacketFingerprints'])
            self.assertIn('zz100', result['modelIdentifiers'])
            (root/'public.json').write_text(json.dumps({'files': {'bad': {'utf8': embedded+' ', 'sha256': m.sha(embedded)}}}))
            with self.assertRaisesRegex(ValueError, 'raw hash'): m.inventory(root, ['public.json'])

    def test_self_consistent_partial_history_inventory_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp).resolve()
            (root/'docs/evidence').mkdir(parents=True)
            (root/'docs/evidence/required.json').write_text(json.dumps({'productId': 'B000000001'}))
            (root/'docs/evidence/other-exposure.json').write_text(json.dumps({'productId': 'B000000002'}))
            (root/'implementation.py').write_text('# SYNTHETIC frozen code')
            lineage = {'codeSha256': {'implementation.py': m.sha((root/'implementation.py').read_bytes())}}
            (root/'lineage.json').write_text(json.dumps(lineage))
            names = ['docs/evidence/required.json', 'docs/evidence/other-exposure.json']
            with mock.patch.object(m, 'CODE', ['implementation.py']), mock.patch.object(m, 'V5', 'lineage.json'), mock.patch.object(m, 'V5_SHA', m.sha((root/'lineage.json').read_bytes())), mock.patch.object(m, 'REQUIRED_HISTORY', {names[0]}), mock.patch.object(m, 'historical_paths', return_value=names):
                directory = root/'frozen'
                m.create_freeze(root, directory)
                m.verify_freeze(root, directory)
                # Reseal every dependent document, keeping all eight-style
                # mandatory inputs but silently dropping another real exposure.
                history = m.inventory(root, [names[0]])
                (directory/'history-inventory-v1.json').write_text(json.dumps(history))
                protocol = json.loads((directory/'protocol-v1.json').read_text()); protocol['historyInventorySha256'] = history['inventorySha256']; protocol.pop('protocolSha256'); protocol['protocolSha256'] = m.seal(protocol)
                (directory/'protocol-v1.json').write_text(json.dumps(protocol))
                freeze = json.loads((directory/'candidate-freeze-v1.json').read_text()); freeze['historyInventoryFileSha256'] = m.sha((directory/'history-inventory-v1.json').read_bytes()); freeze['protocolFileSha256'] = m.sha((directory/'protocol-v1.json').read_bytes())
                (directory/'candidate-freeze-v1.json').write_text(json.dumps(freeze))
                with self.assertRaisesRegex(ValueError, 'omitted a tracked public record'):
                    m.verify_freeze(root, directory)

    def test_unicode_normalization_cannot_hide_historical_body_scope_packet(self):
        p = pool(); c = p['cases'][0]
        c['sources'] = sources(0, 'ＳＹＮＴＨＥＴＩＣ shared BODY', 'ＭＯＤＥＬ Q-1?')
        c['sourcePoolSha256'] = m.sha(m.compact(c['sources']))
        protected = m.scoped_fingerprint({'text': 'synthetic shared body', 'originalQuestion': 'model q-1?'})
        row = next(r for r in screen(p, {'sourcePacketFingerprints': [protected]})['decisions'] if r['caseId'] == c['id'])
        self.assertFalse(row['eligible']); self.assertIn('historical_or_within_pool_body_and_original_question', row['reasons'])

if __name__ == '__main__': unittest.main()

class ImplementationClosureTests(unittest.TestCase):
    def test_freeze_closes_over_relative_runtime_and_type_imports(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory).resolve()
            (root/'entry.ts').write_text("import type {X} from './types.ts';\nexport {x} from './helper.ts';\n")
            (root/'types.ts').write_text('export type X = string;\n')
            (root/'helper.ts').write_text('export const x = 1;\n')
            with mock.patch.object(m, 'CODE', ['entry.ts']):
                self.assertEqual(m.code_paths(root), ['entry.ts', 'helper.ts', 'types.ts'])
