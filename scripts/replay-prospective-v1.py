#!/usr/bin/env python3
"""Verify the superseded prospective freeze with its exact historical code.

The current opt-in answer policy intentionally differs from the v1 freeze.
Restore only its pinned code and public history into a temporary Gitless tree;
run the unchanged historical verifier there. No source pool, private execution
artifact, provider, environment file or current runtime file is opened/written.
"""
import hashlib
import io
import json
import os
import pathlib
import subprocess
import sys
import tarfile
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMMIT = '975aded2e09db480ec378ccf47857fb2b03fbc23'
FREEZE = 'docs/evidence/retrieval-validation-prospective-2026-10-19/freeze-v2'
FREEZE_SHA256 = {
    'protocol-v1.json': '18b513a79bd0f80248d0360c538cd086ed51073311cf760f476844726470d59a',
    'candidate-freeze-v1.json': 'c6f1cae4dae038714c24954534ca9932ec13037b06977efca57cde0a015d6df2',
    'history-inventory-v1.json': '8765dc74cc033505e2340bbdedb669582bb57081ebdde5c01a4d213483283808',
    'qualification-pending-v1.json': 'a71df2d06568729bf42ad9dcea223387a05b01ea56a466d3c45bd6647f3d27eb',
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def safe_path(name):
    path = pathlib.PurePosixPath(name)
    if path.is_absolute() or not path.parts or '..' in path.parts or '\\' in name or str(path) != name:
        raise ValueError('Historical replay paths must be canonical relative paths.')
    return path


def public_bytes(repository, name, expected):
    path = repository / safe_path(name)
    if not path.is_file() or path.is_symlink() or path.resolve(strict=True) != path:
        raise ValueError('Historical public inputs require canonical regular files.')
    raw = path.read_bytes()
    if sha(raw) != expected:
        raise ValueError('Historical public input changed: ' + name)
    return raw


def archive_code(repository, paths):
    # Exact immutable commit, never HEAD/current working files. Clearing ambient
    # Git variables also prevents an unrelated GIT_DIR from changing the source.
    return subprocess.check_output(['git', '-C', str(repository), 'archive', '--format=tar', COMMIT, '--', *sorted(paths)],
                                   env={'PATH': os.defpath}, stderr=subprocess.PIPE)


def archive_files(raw, expected):
    files = {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:') as archive:
        for member in archive.getmembers():
            name = member.name.rstrip('/') if member.isdir() else member.name
            safe_path(name)
            if member.isdir():
                continue
            if not member.isfile() or name not in expected or name in files:
                raise ValueError('Historical archive has an unexpected, duplicate or nonregular member.')
            body = archive.extractfile(member).read()
            if sha(body) != expected[name]:
                raise ValueError('Historical archived implementation changed: ' + name)
            files[name] = body
    if set(files) != set(expected):
        raise ValueError('Historical archive must contain the complete exact frozen implementation.')
    return files


def restore(checkout, repository=ROOT):
    repository = pathlib.Path(repository).resolve(strict=True)
    checkout = pathlib.Path(checkout)
    if not checkout.is_absolute() or checkout.exists() or checkout.parent.resolve(strict=True) != checkout.parent:
        raise ValueError('Use a new canonical temporary replay directory.')
    frozen = {name: public_bytes(repository, FREEZE + '/' + name, expected) for name, expected in FREEZE_SHA256.items()}
    candidate = json.loads(frozen['candidate-freeze-v1.json'])
    protocol = json.loads(frozen['protocol-v1.json'])
    history = json.loads(frozen['history-inventory-v1.json'])
    code = candidate['implementationSha256']
    if code != protocol['implementationSha256'] or not code:
        raise ValueError('The old protocol and candidate must bind one exact implementation.')
    for name in code:
        path = safe_path(name)
        if name not in {'package.json', 'package-lock.json'} and path.parts[0] not in {'server', 'scripts'}:
            raise ValueError('Historical implementation must contain only its frozen code paths.')
    files = archive_files(archive_code(repository, code), code)
    for name, expected in history['artifactSha256'].items():
        safe_path(name)
        if not name.startswith(('docs/evidence/', 'data/product-qa/')) or name in files:
            raise ValueError('Only exact public historical records may enter the replay bundle.')
        files[name] = public_bytes(repository, name, expected)
    for name, raw in frozen.items():
        key = FREEZE + '/' + name
        if key in files:
            raise ValueError('Frozen replay inputs cannot overwrite each other.')
        files[key] = raw
    checkout.mkdir(mode=0o700)
    for name, raw in files.items():
        target = checkout / safe_path(name)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as output:
            output.write(raw)
    assert not (checkout / '.git').exists()
    return {'frozenCodeCommit': COMMIT, 'restoredCodeFiles': len(code), 'restoredHistoryFiles': len(history['artifactSha256']), 'restoredFreezeFiles': len(frozen)}


def verify(checkout):
    assert not (checkout / '.git').exists()
    result = subprocess.run([sys.executable, '-I', 'scripts/prepare-fresh-validation-v1.py', 'verify', '--freeze-dir', FREEZE],
                            cwd=checkout, env={'PATH': os.defpath}, check=True, capture_output=True, text=True)
    checked = json.loads(result.stdout)
    assert checked['mode'] == 'verified_prospective_no_fresh_reads'
    assert checked['freshInputReads'] == checked['providerCalls'] == 0
    return checked


def replay(repository=ROOT):
    with tempfile.TemporaryDirectory(prefix='ablatrix-prospective-v1-') as temporary:
        checkout = pathlib.Path(temporary).resolve() / 'historical'
        restored = restore(checkout, repository)
        checked = verify(checkout)
    return {**restored, 'verification': checked['mode'], 'gitRequiredForRestore': True, 'gitlessVerification': True,
            'freshInputReads': 0, 'providerCalls': 0, 'currentRuntimeFilesWritten': 0}


if __name__ == '__main__':
    print(json.dumps(replay(), indent=2))
