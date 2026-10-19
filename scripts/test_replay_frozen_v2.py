"""Public frozen replay must work without ancestor commits or ignored inputs."""
import contextlib
import importlib.util
import io
import json
import pathlib
import shutil
import tempfile
import unittest
from unittest import mock
spec = importlib.util.spec_from_file_location('frozen_v2', pathlib.Path(__file__).with_name('replay-frozen-v2.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class FrozenReplayTests(unittest.TestCase):
    def test_unrelated_checkout_without_git_can_restore_and_replay_original_code(self):
        with tempfile.TemporaryDirectory(prefix='ablatrix-unrelated-replay-') as temporary:
            repository = pathlib.Path(temporary)
            directory = repository / m.DIRECTORY
            directory.mkdir(parents=True)
            for name in ('frozen-v2-code-bundle-v1.json', 'frozen-v2-public-inputs-v1.json'):
                shutil.copyfile(m.ROOT / m.DIRECTORY / name, directory / name)
            bundle = json.loads((directory / 'frozen-v2-code-bundle-v1.json').read_text())
            for name in bundle['publicFileSha256']:
                target = repository / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(m.ROOT / name, target)
            (repository / 'node_modules').symlink_to(m.ROOT / 'node_modules', target_is_directory=True)
            # Any regression to `git archive` or object lookup fails even when
            # the real test caller happens to have historical Git objects.
            run = m.subprocess.run
            def no_git(command, *args, **kwargs):
                self.assertNotEqual(command[0], 'git')
                return run(command, *args, **kwargs)
            with mock.patch.object(m.subprocess, 'run', side_effect=no_git), contextlib.redirect_stdout(io.StringIO()) as output:
                m.replay(repository)
            self.assertIn('"gitRequired": false', output.getvalue())
            self.assertFalse((repository / '.git').exists())
            self.assertFalse((repository / 'work').exists())

    def test_bundle_tampering_and_noncanonical_paths_are_rejected(self):
        for name in ('/absolute', '../outside', 'server/../outside', './server/x', 'server\\x'):
            with self.assertRaises(ValueError): m.safe_path(name)
        with tempfile.TemporaryDirectory(prefix='ablatrix-tampered-replay-') as temporary:
            repository = pathlib.Path(temporary)
            directory = repository / m.DIRECTORY
            directory.mkdir(parents=True)
            source = m.ROOT / m.DIRECTORY / 'frozen-v2-code-bundle-v1.json'
            (directory / source.name).write_bytes(source.read_bytes() + b' ')
            with self.assertRaises(AssertionError): m.restore_frozen_v2(repository / 'checkout', repository)
