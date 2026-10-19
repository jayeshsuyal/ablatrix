#!/usr/bin/env python3
"""Replay original unmodified v2 verifier and failed comparison in an isolated tree.
No ignored local inputs required. The public bundle restores exact original paths.
"""
import hashlib
import json
import pathlib
import subprocess
import tempfile
import tarfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
BUNDLE = ROOT / 'docs/evidence/retrieval-diagnosis-2026-10-19/frozen-v2-public-inputs-v1.json'
COMMIT = '71e21e4eaee87a966983ccc35b0ee4e8df6fab54'

def replay():
    bundle = json.loads(BUNDLE.read_text())
    assert bundle['commit'] == COMMIT
    with tempfile.TemporaryDirectory(prefix='ablatrix-frozen-v2-') as temporary:
        directory = pathlib.Path(temporary)
        archive = directory / 'tracked.tar'
        subprocess.run(['git', 'archive', '--format=tar', '--output', str(archive), COMMIT], cwd=ROOT, check=True)
        checkout = directory / 'checkout'
        checkout.mkdir()
        with tarfile.open(archive) as files:
            for member in files.getmembers():
                assert not pathlib.PurePosixPath(member.name).is_absolute() and '..' not in pathlib.PurePosixPath(member.name).parts
            files.extractall(checkout)
        for name, item in bundle['files'].items():
            path = pathlib.PurePosixPath(name)
            assert path.parts[0] == 'work' and '..' not in path.parts
            raw = item['utf8'].encode()
            assert hashlib.sha256(raw).hexdigest() == item['sha256']
            target = checkout / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
        result = subprocess.run(['python3', '-I', 'scripts/prepare-source-coverage-v2-deck.py', '--verify-deck', 'docs/evidence/retrieval-source-coverage-v2-2026-10-18/deck-v1.json'], cwd=checkout, check=True, capture_output=True, text=True)
        print(result.stdout.strip())
        (checkout / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
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

if __name__ == '__main__':
    replay()
