#!/usr/bin/env python3
"""Replay unchanged frozen v2 code without Git ancestry, models or private files.

The checked-in code bundle contains the exact required implementation files and
runtime dependencies from 71e21e4. Public inputs retain their original paths and
byte hashes. Restoring these files does not weaken the old verifier's contracts.
"""
import hashlib
import json
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
DIRECTORY = 'docs/evidence/retrieval-diagnosis-2026-10-19'
COMMIT = '71e21e4eaee87a966983ccc35b0ee4e8df6fab54'
CODE_BUNDLE_SHA256 = 'e6b069041df20c76a96eb73d8125be3571ff34944861bddafd6da6b6d7402f03'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def safe_path(name):
    path = pathlib.PurePosixPath(name)
    if (path.is_absolute() or not path.parts or '..' in path.parts or
            '\\' in name or str(path) != name):
        raise ValueError('Frozen replay paths must be canonical relative paths.')
    return path


def restore_frozen_v2(checkout, repository=ROOT):
    """Restore only raw-bound code, required public artifacts and bundled work/."""
    raw = (repository / DIRECTORY / 'frozen-v2-code-bundle-v1.json').read_bytes()
    assert sha(raw) == CODE_BUNDLE_SHA256, 'Frozen code bundle bytes changed.'
    code = json.loads(raw)
    assert code['format'] == 'ablatrix-frozen-v2-code-bundle-v1'
    assert code['commit'] == COMMIT and code['newProviderCalls'] == 0
    private_raw = (repository / DIRECTORY / 'frozen-v2-public-inputs-v1.json').read_bytes()
    assert sha(private_raw) == code['privateInputBundleSha256']
    private = json.loads(private_raw)
    assert private['commit'] == COMMIT
    written = set()

    def write(name, body):
        path = safe_path(name)
        assert name not in written, 'Frozen inputs must identify distinct files.'
        written.add(name)
        target = checkout / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)

    for name, item in code['files'].items():
        path = safe_path(name)
        assert name in ('package.json', 'package-lock.json') or path.parts[0] in ('server', 'scripts')
        body = item['utf8'].encode()
        assert sha(body) == item['sha256']
        assert hashlib.sha1(b'blob ' + str(len(body)).encode() + b'\0' + body).hexdigest() == item['gitBlobSha1']
        write(name, body)
    for name, expected in code['frozenImplementationSha256'].items():
        assert name in code['files'] and code['files'][name]['sha256'] == expected
    for name, expected in code['publicFileSha256'].items():
        assert safe_path(name).parts[0] == 'docs'
        body = (repository / name).read_bytes()
        assert sha(body) == expected, f'Original public input changed: {name}'
        write(name, body)
    for name, item in private['files'].items():
        assert safe_path(name).parts[0] == 'work'
        body = item['utf8'].encode()
        assert sha(body) == item['sha256']
        write(name, body)
    return code


def replay(repository=ROOT):
    with tempfile.TemporaryDirectory(prefix='ablatrix-frozen-v2-') as temporary:
        checkout = pathlib.Path(temporary) / 'checkout'
        checkout.mkdir()
        code = restore_frozen_v2(checkout, repository)
        assert not (checkout / '.git').exists()
        result = subprocess.run(['python3', '-I', 'scripts/prepare-source-coverage-v2-deck.py', '--verify-deck', 'docs/evidence/retrieval-source-coverage-v2-2026-10-18/deck-v1.json'], cwd=checkout, check=True, capture_output=True, text=True)
        print(result.stdout.strip())
        (checkout / 'node_modules').symlink_to(repository / 'node_modules', target_is_directory=True)
        subprocess.run(['node', '--import', 'tsx', '--input-type=module', '-e', """
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {textHash} from './server/product-corpus.ts';
import {compareV2,verifyV2Implementation} from './scripts/source-coverage-v2-retrieval.ts';
const dir='docs/evidence/retrieval-source-coverage-v2-2026-10-18';
const a=name=>{const path=`${dir}/${name}`, raw=readFileSync(path,'utf8');return {path,fileSha256:textHash(raw),document:JSON.parse(raw)}};
verifyV2Implementation(a('candidate-freeze-v1.json').document.implementationSha256);
const result=compareV2(a('deck-v1.json'),a('baseline-v1.json'),a('source-review-v1.json'));
assert.deepEqual(result,a('comparison-v1.json').document);console.log(result.summary);
"""], cwd=checkout, check=True)
        print(json.dumps({'frozenCodeCommit': COMMIT, 'restoredCodeFiles': len(code['files']), 'gitRequired': False, 'providerCalls': 0}))


if __name__ == '__main__':
    replay()
