"""Focused offline invariants; temporary synthetic databases only."""
import argparse
import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

PATH = pathlib.Path(__file__).with_name('prepare-flat-source-cohort.py')
spec = importlib.util.spec_from_file_location('flat_cohort_tested', PATH)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def row(pid, qid, title, question, body, source='description', number=2):
    return {'ASIN': pid, 'qid': str(qid), 'title': title, 'question': question, 'candidate': body,
            'source': source, 'qa_pair_id': str(number), 'row': number}


def audit():
    return {'protectedProducts': [], 'extraTitles': [], 'protectedTargetIdentifiers': [],
            'metadata': {'workspaces': [], 'comparisons': []}}


class PreparationTests(unittest.TestCase):
    def test_frozen_helpers_and_new_seed_and_all_previous_products(self):
        before = {p: m.legacy.sha((m.ROOT / p).read_bytes()) for p in m.HELPERS}
        m.verify_helpers()
        self.assertEqual(m.SEED, 'ablatrix-flat-source-quality-2026-10-11-v1')
        self.assertEqual(m.CRITIQUE, m.previous.CRITIQUE)
        self.assertNotIn('quoteIds', m.CRITIQUE)
        protected = m.build_exposure([], {'workspaces': [], 'comparisons': []}, [])
        ids = {p['id'] for p in protected['protectedProducts']}
        for file in m.FIXED_FILES[1:4]:
            self.assertTrue({c['product']['id'] for c in m.read(m.ROOT / file)['cases']} <= ids)
        self.assertIn('B00B8Q31UQ', ids)
        self.assertGreaterEqual(len(ids), 82)
        self.assertEqual(before, m.HELPERS)
        self.assertEqual(before, {p: m.legacy.sha((m.ROOT / p).read_bytes()) for p in m.HELPERS})

    def test_pinned_train_rejects_other_bytes_and_projection_omits_labels(self):
        with tempfile.TemporaryDirectory() as name:
            path = pathlib.Path(name) / 'train.csv'
            path.write_text('qid,question,ASIN,candidate,source,qa_pair_id,title,label,answer\n1,How many?,B000000001,10 cups,description,1,Acme box,SECRET_LABEL,SECRET_ANSWER\n')
            with self.assertRaisesRegex(ValueError, 'checksum'):
                m.load_rows(path)
            with patch.object(m.legacy, 'TRAIN_SHA', m.legacy.sha(path.read_bytes())):
                projected = m.load_rows(path)
            self.assertEqual(set(projected[0]), set(m.ALLOWED_COLUMNS) | {'row'})
            self.assertNotIn('SECRET_', json.dumps(projected))

    def test_metadata_projection_replays_without_answers_or_review_tables(self):
        with tempfile.TemporaryDirectory() as name:
            folder = pathlib.Path(name); workspace = folder / 'workspace.sqlite'; comparison = folder / 'comparison.sqlite'
            with sqlite3.connect(workspace) as db:
                db.execute('CREATE TABLE workspace_products(id TEXT, document TEXT)')
                db.execute('CREATE TABLE workspace_runs(id TEXT, document TEXT)')
                db.execute('INSERT INTO workspace_products VALUES (?,?)', ('p', json.dumps({'id': 'p', 'title': 'Acme box', 'sources': [{'id': 's', 'label': 'description', 'text': 'Holds 10 cups.'}]})))
                db.execute('INSERT INTO workspace_runs VALUES (?,?)', ('r', json.dumps({'productId': 'p', 'question': 'Will it fit TARGET777?', 'answer': {'answer': 'DO_NOT_READ'}, 'retrieval': {'passages': [{'id': 's', 'source': 'description', 'text': 'Only MODEL777 works.', 'lexicalRank': 1}]}})))
            with sqlite3.connect(comparison) as db:
                db.execute('CREATE TABLE context_comparisons(id TEXT,document TEXT)')
                db.execute('CREATE TABLE context_comparison_exposure(mode TEXT,product_id TEXT,fingerprint TEXT)')
                case = {'product': {'id': 'B000000002', 'title': 'Beta box'}, 'question': 'MODEL888?', 'sources': [{'id': 's2', 'label': 'cqa', 'text': 'Yes.', 'originalQuestion': 'MODEL999?'}], 'arms': {'answer': 'DO_NOT_READ'}}
                db.execute('INSERT INTO context_comparisons VALUES (?,?)', ('c', json.dumps({'mode': 'live', 'cases': [case]})))
                db.execute('INSERT INTO context_comparison_exposure VALUES (?,?,?)', ('live', 'B000000002', 'fingerprint'))
            initial = {p: p.read_bytes() for p in (workspace, comparison)}
            metadata = m.current_metadata([workspace], [comparison])
            encoded = json.dumps(metadata)
            self.assertNotIn('DO_NOT_READ', encoded); self.assertNotIn('lexicalRank', encoded)
            self.assertEqual({p: p.read_bytes() for p in initial}, initial)
            frozen = m.build_exposure([], metadata, [])
            path = folder / 'exposure.json'; path.write_text(json.dumps(frozen))
            args = argparse.Namespace(exposure_audit=str(path), workspace_db=[], comparison_db=[])
            with patch.object(m, 'current_metadata', side_effect=AssertionError('Replay must not open databases')):
                self.assertEqual(m.exposure(args, []), frozen)
            self.assertIn('target777', frozen['protectedTargetIdentifiers'])
            frozen['protectedProducts'] = []; m.bind(frozen, 'auditSha256'); path.write_text(json.dumps(frozen))
            with self.assertRaisesRegex(ValueError, 'cannot remove'):
                m.exposure(args, [])

    def test_family_identifiers_and_source_pool_bounds_stop_selection(self):
        rows = [row('B000000001', 1, 'GENUINE OEM Acme holder', 'How many cups?', 'capacity: 10 cups'),
                row('B000000001', 1, 'GENUINE OEM Acme holder', 'How many cups?', 'manufacturer: { value: SharedCo }', 'attribute'),
                row('B000000002', 2, 'Other holder', 'How many cups?', 'Replacement for PROTECT12345 holds 10 cups.'),
                row('B000000003', 3, 'Third holder', 'How many cups?', '10 cups. Yes. Question: target? Question: other?', 'cqa')]
        x = audit(); x['protectedProducts'] = [{'id': 'B000000099', 'title': 'Independent brand'}]; x['protectedTargetIdentifiers'] = ['protect12345']
        x['metadata']['workspaces'] = [{'products': [{'title': 'Independent brand', 'sources': [{'text': 'manufacturer: { value: SharedCo }'}]}], 'runs': []}]
        _, decisions, inventory = m.select(rows, x)
        reasons = {d['reason'] for d in decisions if not d['eligible']}
        self.assertFalse(inventory['passed'])
        self.assertIn('protected_brand_family_or_near_title', reasons)
        self.assertIn('protected_full_source_identifier_or_near_model', reasons)
        self.assertIn('ambiguous_cqa_context', reasons)
        oversized = [row('B000000010', 10, 'Large box', 'How many cups?', f'Source {i} holds 10 cups.', number=i+2) for i in range(129)]
        with self.assertRaisesRegex(ValueError, '128'):
            m.legacy.pool(oversized)

    def test_complete_source_chunks_context_and_distinct_identifiers(self):
        body = ('Complete factual source sentence. ' * 70).strip()
        rows = [row('B000000001', 1, 'Acme holder', 'How many cups?', body + ' Question: Will it fit MODEL777?', 'cqa')]
        sources, origins = m.legacy.pool(rows)
        self.assertTrue(all(s['originalQuestion'] == 'Will it fit MODEL777?' for s in sources))
        covered = set()
        for source in sources:
            origin = origins[source['id']][0]
            self.assertEqual(body[origin['bodyStart']:origin['bodyEnd']], source['text'])
            covered.update(range(origin['bodyStart'], origin['bodyEnd']))
        self.assertTrue(all(i in covered for i,c in enumerate(body) if not c.isspace()))
        self.assertNotEqual(m.snapshot_fingerprint(rows), m.snapshot_fingerprint([{**rows[0], 'candidate': body + ' Question: Will it fit MODEL888?'}]))
        self.assertEqual(m.snapshot_fingerprint(rows), m.snapshot_fingerprint([{**rows[0], 'ASIN': 'B000000099'}]))

    def test_strata_exclude_units_and_deterministic_rank_and_no_overwrite(self):
        source = {'id': 'epqa-B000000001-description-a', 'label': 'description', 'text': 'Holds 10 gallons. White plastic.', 'originalQuestion': 'Fits MODEL888.'}
        self.assertNotIn('model_scope', m.previous.strata_for('Will this fit a 10gallon tank?', [source]))
        self.assertNotIn('appearance_material', m.previous.strata_for('When will white be back in stock?', [source]))
        self.assertIn('model_scope', m.previous.strata_for('Will this fit MODEL777?', [source]))
        rows = [row('B000000001', 1, 'Acme holder', 'How many cups does it hold?', 'Holds 10 cups.'),
                row('B000000002', 2, 'Beta holder', 'How many cups does it hold?', 'Holds 20 cups.')]
        with patch.object(m.legacy, 'STRATA', [('capacity_dimensions', 2)]):
            self.assertEqual(m.select(rows, audit()), m.select(list(reversed(rows)), audit()))
        with tempfile.TemporaryDirectory() as folder:
            args = argparse.Namespace(prepare_dir=folder)
            with self.assertRaisesRegex(ValueError, 'must be new'):
                m.prepare(args)

    def test_physical_quantity_intent_excludes_draw_without_changing_valid_capacity(self):
        sources = [{'id': 'epqa-B000000001-description-a', 'label': 'description', 'text': 'Capacity 10 liters; 12 inches tall; holds 3 chairs.', 'originalQuestion': None}]
        for question in ['How many amps does it draw at full load?', 'How many settings are there?', 'How many liters per minute does it pump?']:
            self.assertNotIn('capacity_dimensions', m.strata_for(question, sources))
        for question in ['What are the dimensions l x w x h?', 'How many liters does it hold?', 'How many chairs can it carry?', 'What is its load capacity?']:
            self.assertIn('capacity_dimensions', m.strata_for(question, sources))
        rows = [row('B000000001', 1, 'Acme winch', 'How many amps does it draw at full load?', 'Capacity 4500 pounds.')]
        _, decisions, _ = m.select(rows, audit())
        self.assertIn('outside_physical_capacity_or_dimensions_intent', {d['reason'] for d in decisions if not d['eligible']})


if __name__ == '__main__':
    unittest.main()
