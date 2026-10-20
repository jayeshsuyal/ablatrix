"""Historical prospective replay only; no fresh/private/live artifacts."""
import importlib.util
import io
import pathlib
import subprocess
import tarfile
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('prospective_replay', pathlib.Path(__file__).with_name('replay-prospective-v1.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ProspectiveReplayTests(unittest.TestCase):
    def test_exact_archived_code_and_full_history_verify_gitless_without_changing_current_runtime(self):
        current = m.ROOT / 'server/workspace-generation.ts'
        before = current.read_bytes()
        original = m.subprocess.check_output
        def fixed_commit(command, *args, **kwargs):
            self.assertIn(m.COMMIT, command)
            self.assertNotIn('HEAD', command)
            return original(command, *args, **kwargs)
        with tempfile.TemporaryDirectory(prefix='ablatrix-prospective-test-') as temporary:
            checkout = pathlib.Path(temporary).resolve() / 'historical'
            with mock.patch.object(m.subprocess, 'check_output', side_effect=fixed_commit):
                restored = m.restore(checkout)
            self.assertFalse((checkout / '.git').exists())
            self.assertFalse((checkout / '.data').exists())
            self.assertFalse((checkout / 'node_modules').exists())
            self.assertEqual(m.verify(checkout)['providerCalls'], 0)
            self.assertGreater(restored['restoredCodeFiles'], 0)
            self.assertGreater(restored['restoredHistoryFiles'], 0)
            # The unchanged historical verifier must still reject modified code.
            historical = checkout / 'server/workspace-generation.ts'
            historical.write_bytes(historical.read_bytes() + b'\n// SYNTHETIC tamper fixture\n')
            with self.assertRaises(subprocess.CalledProcessError):
                m.verify(checkout)
        self.assertEqual(current.read_bytes(), before)

    def test_freeze_raw_byte_tamper_fails_before_archive_or_runtime_access(self):
        with tempfile.TemporaryDirectory(prefix='ablatrix-prospective-tamper-') as temporary:
            root = pathlib.Path(temporary).resolve()
            target = root / m.FREEZE / 'protocol-v1.json'
            target.parent.mkdir(parents=True)
            target.write_bytes((m.ROOT / m.FREEZE / target.name).read_bytes() + b' ')
            with mock.patch.object(m, 'archive_code', side_effect=AssertionError('Archive must remain unread')):
                with self.assertRaisesRegex(ValueError, 'public input changed'):
                    m.restore(root / 'replay', root)
            self.assertFalse((root / 'replay').exists())

    def test_archive_paths_and_implementation_bytes_are_not_trusted(self):
        for name in ['/absolute', '../outside', './server/x', 'server/../outside', 'server\\x']:
            with self.assertRaises(ValueError):
                m.safe_path(name)
        def archive(name, body=b'SYNTHETIC changed code', kind=tarfile.REGTYPE):
            data = io.BytesIO()
            with tarfile.open(fileobj=data, mode='w') as output:
                member = tarfile.TarInfo(name); member.type = kind; member.size = len(body) if kind == tarfile.REGTYPE else 0
                output.addfile(member, io.BytesIO(body) if kind == tarfile.REGTYPE else None)
            return data.getvalue()
        expected = {'server/frozen.ts': m.sha(b'SYNTHETIC expected code')}
        with self.assertRaisesRegex(ValueError, 'implementation changed'):
            m.archive_files(archive('server/frozen.ts'), expected)
        with self.assertRaisesRegex(ValueError, 'nonregular'):
            m.archive_files(archive('server/frozen.ts', kind=tarfile.SYMTYPE), expected)
        with self.assertRaises(ValueError):
            m.archive_files(archive('../outside'), expected)


if __name__ == '__main__':
    unittest.main()
