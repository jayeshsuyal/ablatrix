import importlib.util
import pathlib
import unittest
spec = importlib.util.spec_from_file_location('guard', pathlib.Path(__file__).with_name('source-packet-disjointness.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class DisjointTests(unittest.TestCase):
    def test_cross_product_ids_and_whitespace_cannot_hide_repeat(self):
        cases = [{'id': 'one', 'sources': [{'id': 'a', 'text': 'A  shared body', 'originalQuestion': 'Model ZX-1?'}]}, {'id': 'two', 'sources': [{'id': 'b', 'text': ' a shared BODY ', 'originalQuestion': 'model ZX-1?'}]}]
        self.assertFalse(m.verify(cases)['passed'])
        cases[1]['sources'][0]['originalQuestion'] = 'Model ZX-2?'
        self.assertTrue(m.verify(cases)['passed'])
        self.assertFalse(m.verify(cases[1:], cases[:1] + cases[1:])['passed'])
