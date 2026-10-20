#!/usr/bin/env python3
"""Version-pinned, finite opaque custody. Never parses APQA product records."""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
SHA = re.compile(r'^[a-f0-9]{64}$')
MAX_BYTES = 16 * 1024 * 1024
FORMAT = 'ablatrix-amazon-pqa-acquisition'
FLAGS = {'humanSourceCheckedAnswers': 0, 'qualityClaimEligible': False,
         'activationAuthorized': False, 'paidPlan': None, 'providerCalls': 0}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical_file(name, root=ROOT):
    path = pathlib.Path(name)
    if not path.is_absolute():
        require(bool(path.parts) and not any(x in ('.', '..') for x in path.parts), 'Use canonical artifact paths.')
        path = root / path
    require(path.is_file() and not path.is_symlink() and path.resolve(strict=True) == path,
            'Artifacts require canonical regular files with no symlink ancestors.')
    return path


def read(name, root=ROOT):
    path = canonical_file(name, root)
    raw = path.read_bytes()
    require(len(raw) <= 16 * 1024 * 1024, 'Metadata artifact exceeds its bound.')
    return {'path': str(path), 'fileSha256': digest(raw), 'document': json.loads(raw)}


def write_new(name, value):
    path = pathlib.Path(name)
    require(path.is_absolute() and not path.exists() and path.parent.resolve(strict=True) == path.parent,
            'Use a new absolute output with a canonical existing parent.')
    with path.open('x', encoding='utf-8') as stream:
        path.chmod(0o600)
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def source_metadata(value):
    require(value.get('format') == FORMAT + '-source-metadata-v1', 'Unknown source metadata format.')
    require(value.get('host') == 'amazon-pqa.s3.amazonaws.com', 'Only the official anonymous APQA host is allowed.')
    require(value.get('objectKey') == 'amazon_pqa_accessories.json', 'This version freezes the first lexical category object.')
    require(isinstance(value.get('versionId'), str) and 1 <= len(value['versionId']) <= 256,
            'An immutable S3 version is required.')
    require(isinstance(value.get('etag'), str) and re.fullmatch(r'"[a-f0-9]{32}(?:-\d+)?"', value['etag']),
            'An opaque S3 ETag is required; it is not a SHA256 checksum.')
    require(type(value.get('objectBytes')) is int and value['objectBytes'] > MAX_BYTES, 'Full object length is invalid.')
    require(value.get('rangeStart') == 0 and value.get('rangeBytes') == MAX_BYTES,
            'Only the fixed first16MiB range is allowed.')
    require(value.get('publisherSplit') == 'unpartitioned_release' and
            value.get('use') == 'prospective_exploratory_validation', 'Do not invent a publisher training split.')
    require(value.get('semanticRowsInspected') == 0 and value.get('artifactDownloads') == 0,
            'The acquisition metadata must precede product-body access.')
    return value


def history_metadata(value):
    require(value.get('format') == 'ablatrix-amazon-pqa-protected-history-v1' and value.get('completeHistoricalUnion') is True,
            'The new history must bind the complete historical and consumed exposure union.')
    for key in ('productIds', 'canonicalFamilyTitles', 'modelIdentifiers', 'sourcePacketFingerprints', 'sourceBodyFingerprints'):
        require(isinstance(value.get(key), list) and bool(value[key]) and all(isinstance(x, str) and x for x in value[key]), 'Historical exclusion arrays are required.')
    require(value.get('incidentalUnknownFamilyProductIds') == ['B000050B6Z'], 'Incidental documentation exposure must remain protected.')


def verify_history(pin, root):
    history = read(pin['history']['path'], root)
    history_metadata(history['document'])
    if pin['source'].get('provenance') == 'synthetic_fixture':
        require(root != ROOT, 'Synthetic history bypass is restricted to isolated imported-function tests.')
        return
    require('scripts/prepare-amazon-pqa-history-v1.py' in pin['implementationSha256'], 'The complete history verifier must be code-pinned.')
    history_path = pathlib.Path(history['path'])
    require(history_path.is_relative_to(root), 'Protected history must be a canonical checkout artifact.')
    result = subprocess.run([sys.executable, '-I', str(root/'scripts/prepare-amazon-pqa-history-v1.py'), '--verify', history_path.relative_to(root).as_posix()],
                            cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60, check=False)
    require(result.returncode == 0, 'Complete historical exposure did not replay before custody.')
    proof = json.loads(result.stdout)
    require(proof.get('format') == 'ablatrix-amazon-pqa-history-proof-v1' and proof.get('historyFileSha256') == history['fileSha256'],
            'History replay did not bind the exact proposed exclusion bytes.')


def freeze(metadata_name, history_name, implementation_names, out, root=ROOT):
    metadata, history = read(metadata_name, root), read(history_name, root)
    source_metadata(metadata['document'])
    history_metadata(history['document'])
    code = {}
    for name in sorted(set(implementation_names)):
        path = canonical_file(name, root)
        require(path.is_relative_to(root), 'Implementation must stay in this checkout.')
        code[path.relative_to(root).as_posix()] = digest(path.read_bytes())
    require('scripts/acquire-amazon-pqa-v1.py' in code and len(code) >= 4, 'Pin the complete new acquisition/import workflow implementation.')
    packet = {'format': FORMAT + '-pin-v1', 'createdAt': datetime.now(timezone.utc).isoformat(),
              'sourceMetadata': {k: metadata[k] for k in ('path', 'fileSha256')},
              'history': {k: history[k] for k in ('path', 'fileSha256')}, 'source': metadata['document'],
              'implementationSha256': code, 'sourceBodyChecksumStatus': 'unknown_before_opaque_acquisition',
              'semanticRowsInspected': 0, 'artifactDownloads': 0, 'existingSealedTestsOpened': False,
              'policy': {'maxBytes': MAX_BYTES, 'maxInspectedRecords': 4096, 'targetPackets': 32,
                         'selectedProducts': 16, 'order': 'physical_prefix_no_replacement',
                         'targetAnswerInRetrieval': False, 'newApprovalRequiredBeforePaidDispatch': True}, **FLAGS}
    write_new(out, packet)
    return {'format': FORMAT + '-freeze-result-v1', 'pinPath': out, 'pinFileSha256': read(out, root)['fileSha256'], **FLAGS}


def verify_pin(name, root=ROOT):
    pin = read(name, root)
    p = pin['document']
    require(p.get('format') == FORMAT + '-pin-v1' and all(p.get(k) == v for k, v in FLAGS.items()), 'Invalid custody pin provenance.')
    require(p.get('semanticRowsInspected') == 0 and p.get('artifactDownloads') == 0 and p.get('existingSealedTestsOpened') is False,
            'Pre-acquisition pin cannot conceal body access.')
    source_metadata(p['source'])
    created = datetime.fromisoformat(p['createdAt'])
    require(created.tzinfo is not None, 'Freeze timestamp must include its timezone.')
    for name in ('sourceMetadata', 'history'):
        require(read(p[name]['path'], root)['fileSha256'] == p[name]['fileSha256'], 'Pinned source/history metadata changed.')
    require(read(p['sourceMetadata']['path'], root)['document'] == p['source'], 'Source metadata mismatch.')
    for path, expected in p['implementationSha256'].items():
        require(SHA.fullmatch(expected) and digest(canonical_file(path, root).read_bytes()) == expected,
                'Pinned acquisition/import implementation changed.')
    require('scripts/acquire-amazon-pqa-v1.py' in p['implementationSha256'] and len(p['implementationSha256']) >= 4,
            'Pin the complete new acquisition/import workflow implementation.')
    verify_history(p, root)
    require(p['policy'] == {'maxBytes': MAX_BYTES, 'maxInspectedRecords': 4096, 'targetPackets': 32,
                           'selectedProducts': 16, 'order': 'physical_prefix_no_replacement',
                           'targetAnswerInRetrieval': False, 'newApprovalRequiredBeforePaidDispatch': True},
            'Finite acquisition policy changed.')
    return pin


def verify_reviews(pin, independent, adjudication, root=ROOT):
    p = pin['document']
    bindings = {'pinFileSha256': pin['fileSha256'], 'historyFileSha256': p['history']['fileSha256'],
                'sourceMetadataFileSha256': p['sourceMetadata']['fileSha256']}
    require(len(independent) == 2 and len(set([*independent, adjudication])) == 3, 'Exactly three separate review paths are required.')
    records = [read(name, root) for name in [*independent, adjudication]]
    require(len({str(r['document'].get('reviewer', '')).strip().casefold() for r in records}) == 3,
            'Two distinct independent reviewers and a third adjudicator are required.')
    require(len({r['fileSha256'] for r in records}) == 3, 'Review records must be separate exact artifacts.')
    for index, record in enumerate(records):
        r = record['document']
        require(r.get('format') == FORMAT + '-review-v1' and r.get('stage') == 'opaque_source_access', 'Unknown source-access review.')
        require(r.get('bindings') == bindings and r.get('sourceAware') is True, 'Review must bind exact source, history and implementation pin.')
        require(isinstance(r.get('reviewer'), str) and len(r['reviewer'].strip()) >= 3, 'Named reviewer required.')
        reviewed = datetime.fromisoformat(r['reviewedAt'])
        require(reviewed.tzinfo is not None and reviewed >= datetime.fromisoformat(p['createdAt']), 'Review must occur after the exact freeze.')
        require(r.get('provenance') == ('independent_source_aware_ai' if index < 2 else 'source_aware_ai_adjudication'), 'Review provenance differs.')
        require(all(r.get(k) == v for k, v in FLAGS.items()) and r.get('outcome') == 'approved_opaque_custody_only', 'Review cannot authorize semantic inspection or provider spending.')
        require(isinstance(r.get('reviewEvidence'), str) and len(r['reviewEvidence'].strip()) >= 160,
                'A Boolean-only review cannot qualify source access.')
        require(isinstance(r.get('retainedUncertainty'), list) and bool(r['retainedUncertainty']) and
                all(isinstance(x, str) and len(x.strip()) >= 12 for x in r['retainedUncertainty']), 'Retain concrete uncertainty.')
        require(r.get('unresolvedBlockingFindings') == [], 'Unresolved source-access blockers stop custody.')
        require(r.get('artifactDownloads') == 0 and r.get('semanticRowsInspected') == 0, 'Review must precede dataset access.')
        if index == 2:
            require(r.get('independentReviewFileSha256') == [x['fileSha256'] for x in records[:2]],
                    'Adjudicator must bind both independent review bytes in order.')
    return records


def qualify(pin_name, independent, adjudication, out, root=ROOT):
    pin = verify_pin(pin_name, root)
    records = verify_reviews(pin, independent, adjudication, root)
    value = {'format': FORMAT + '-qualification-v1', 'pinPath': pin['path'], 'pinFileSha256': pin['fileSha256'],
             'independentReviews': [{k: x[k] for k in ('path', 'fileSha256')} for x in records[:2]],
             'adjudication': {k: records[2][k] for k in ('path', 'fileSha256')},
             'status': 'reviewed_for_opaque_custody_only', 'artifactDownloads': 0, 'semanticRowsInspected': 0, **FLAGS}
    write_new(out, value)
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Redirected dataset custody is forbidden.')


def acquire(pin_name, qualification_name, out_dir, root=ROOT, opener=None):
    pin = verify_pin(pin_name, root)
    q = read(qualification_name, root)['document']
    require(q.get('format') == FORMAT + '-qualification-v1' and q.get('pinPath') == pin['path'] and
            q.get('pinFileSha256') == pin['fileSha256'] and q.get('status') == 'reviewed_for_opaque_custody_only' and
            all(q.get(k) == v for k, v in FLAGS.items()), 'Custody requires an exact reviewed qualification.')
    records = verify_reviews(pin, [x['path'] for x in q['independentReviews']], q['adjudication']['path'], root)
    require([x['fileSha256'] for x in records[:2]] == [x['fileSha256'] for x in q['independentReviews']] and
            records[2]['fileSha256'] == q['adjudication']['fileSha256'], 'Qualified review bytes changed.')
    directory = pathlib.Path(out_dir)
    require(directory.is_absolute() and not directory.exists() and directory.parent.resolve(strict=True) == directory.parent,
            'Use a new canonical custody directory; no overwrite, resume or replacement.')
    directory.mkdir(mode=0o700)
    source = pin['document']['source']
    url = 'https://' + source['host'] + '/' + source['objectKey'] + '?' + urllib.parse.urlencode({'versionId': source['versionId']})
    request = urllib.request.Request(url, headers={'Range': f'bytes=0-{MAX_BYTES-1}', 'If-Match': source['etag'], 'Accept-Encoding': 'identity'})
    response_opener = opener or urllib.request.build_opener(NoRedirect()).open
    record = {'format': FORMAT + '-custody-v1', 'pinPath': pin['path'], 'pinFileSha256': pin['fileSha256'],
              'qualificationPath': str(canonical_file(qualification_name, root)), 'source': source,
              'artifactDownloadAttempts': 1, 'artifactDownloads': 0, 'bytesReceived': 0, 'semanticRowsInspected': 0,
              'bodyParsed': False, 'automaticReviewComplete': True, 'freshnessEstablished': False,
              'existingSealedTestsOpened': False, **FLAGS}
    target = directory / 'source-prefix.bin'
    try:
        with response_opener(request, timeout=45) as response:
            expected_range = f'bytes 0-{MAX_BYTES-1}/{source["objectBytes"]}'
            require(response.status == 206 and response.headers.get('Content-Range') == expected_range,
                    'Dataset host did not honor the exact finite byte range.')
            require(response.headers.get('ETag') == source['etag'] and response.headers.get('x-amz-version-id') == source['versionId'],
                    'Dataset version or opaque ETag differs.')
            require(response.headers.get('Content-Encoding', 'identity') == 'identity' and
                    response.headers.get('Content-Length') == str(MAX_BYTES), 'Dataset range length or encoding differs.')
            with target.open('xb') as stream:
                target.chmod(0o600)
                h = hashlib.sha256()
                while record['bytesReceived'] < MAX_BYTES:
                    chunk = response.read(min(65536, MAX_BYTES - record['bytesReceived']))
                    require(bool(chunk), 'Dataset range ended before its pinned length.')
                    stream.write(chunk); h.update(chunk); record['bytesReceived'] += len(chunk)
                require(not response.read(1), 'Dataset exceeded the pinned byte range.')
            record.update(status='opaque_prefix_sealed', artifactDownloads=1, sourcePath=str(target),
                          sourcePrefixSha256=h.hexdigest(), checksumEstablishedBeforeSemanticRead=True)
        write_new(str(directory/'custody.json'), record)
        return record
    except Exception:
        record.update(status='failed_or_unknown_no_retry', errorCode='bounded_custody_failed',
                      partialArtifactRetained=target.exists())
        if target.exists():
            record.update(partialArtifactSha256=digest(target.read_bytes()), partialArtifactBytes=target.stat().st_size)
        write_new(str(directory/'custody.json'), record)
        raise ValueError('Bounded source custody failed; its record and any partial bytes were retained. No automatic retry.') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    p = sub.add_parser('freeze'); p.add_argument('--metadata', required=True); p.add_argument('--history', required=True); p.add_argument('--implementation', action='append', required=True); p.add_argument('--out', required=True)
    p = sub.add_parser('verify'); p.add_argument('--pin', required=True)
    p = sub.add_parser('qualify'); p.add_argument('--pin', required=True); p.add_argument('--review', action='append', required=True); p.add_argument('--adjudication', required=True); p.add_argument('--out', required=True)
    p = sub.add_parser('acquire'); p.add_argument('--pin', required=True); p.add_argument('--qualification', required=True); p.add_argument('--out-dir', required=True)
    args = parser.parse_args()
    if args.mode == 'freeze': result = freeze(args.metadata, args.history, args.implementation, args.out)
    elif args.mode == 'verify':
        pin = verify_pin(args.pin); result = {'format': FORMAT + '-pin-proof-v1', 'pinFileSha256': pin['fileSha256'], 'semanticRowsInspected': 0, **FLAGS}
    elif args.mode == 'qualify': result = qualify(args.pin, args.review, args.adjudication, args.out)
    else: result = acquire(args.pin, args.qualification, args.out_dir)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        print('APQA custody: ' + str(error), file=sys.stderr)
        sys.exit(1)
