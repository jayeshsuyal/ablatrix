#!/usr/bin/env python3
"""V4 fixed third-frame opaque custody. Both consumed frames stay protected; no fresh row is parsed."""
import argparse
import hashlib
import json
import os
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
RANGE_START = 2 * MAX_BYTES
FORMAT = 'ablatrix-amazon-pqa-acquisition'
FLAGS = {'humanSourceCheckedAnswers': 0, 'qualityClaimEligible': False,
         'activationAuthorized': False, 'paidPlan': None, 'paidExecutionAuthorized': False, 'providerCalls': 0}
HISTORY_VERIFIER = 'scripts/amazon-pqa-consumed-history-v4.ts'
REQUIRED_CODE = {'scripts/acquire-amazon-pqa-v4.py', HISTORY_VERIFIER,
                 'server/semantic-supplement-v7.ts', 'server/amazon-pqa-validation-v4.ts',
                 'scripts/amazon-pqa-validation-v4.ts', 'package.json', 'package-lock.json'}
POLICY = {'maxBytes': MAX_BYTES, 'maxInspectedRecords': 4096, 'targetPackets': 32,
          'selectedProducts': 16, 'order': 'physical_prefix_no_replacement',
          'targetAnswerInRetrieval': False, 'newApprovalRequiredBeforePaidDispatch': True,
          'control': 'workspace-semantic-supplement-v6-quantified-peer-dev',
          'candidate': 'workspace-semantic-supplement-v7-small-packet-dev',
          'sharedGenerationContract': 'workspace-answer-uncertainty-v2',
          'candidateApplicabilityUsedForSelection': False,
          'pendingBoundaryPermits': 'opaque_custody_only'}


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
        stream.flush()
        os.fsync(stream.fileno())


def source_metadata(value):
    require(value.get('format') == FORMAT + '-source-metadata-v4', 'Unknown source metadata format.')
    require(value.get('host') == 'amazon-pqa.s3.amazonaws.com', 'Only the official anonymous APQA host is allowed.')
    require(value.get('objectKey') == 'amazon_pqa_accessories.json', 'This version freezes the first lexical category object.')
    require(isinstance(value.get('versionId'), str) and 1 <= len(value['versionId']) <= 256,
            'An immutable S3 version is required.')
    require(isinstance(value.get('etag'), str) and re.fullmatch(r'"[a-f0-9]{32}(?:-\d+)?"', value['etag']),
            'An opaque S3 ETag is required; it is not a SHA256 checksum.')
    require(type(value.get('objectBytes')) is int and value['objectBytes'] > RANGE_START + MAX_BYTES, 'Full object length is invalid.')
    require(value.get('rangeStart') == RANGE_START and value.get('rangeBytes') == MAX_BYTES,
            'Only the separate fixed third16MiB range is allowed.')
    require(value.get('publisherSplit') == 'unpartitioned_release' and
            value.get('use') == 'prospective_exploratory_validation', 'Do not invent a publisher training split.')
    require(value.get('semanticRowsInspected') == 0 and value.get('artifactDownloads') == 0,
            'The acquisition metadata must precede product-body access.')
    require(value.get('provenance') in ('publisher_metadata', 'synthetic_fixture') and
            value.get('existingSealedTestsOpened') is False and value.get('providerCalls') == 0 and value.get('paidPlan') is None,
            'Source metadata must retain unpartitioned, pre-access, zero-provider provenance.')
    return value


def history_metadata(value, source=None):
    require(value.get('format') == 'ablatrix-amazon-pqa-protected-history-v4' and value.get('completeHistoricalUnion') is True and value.get('priorConsumedCompleteRowsMappingVerified') is True and value.get('unparsedTailExposureResolved') is True,
            'Opaque custody must bind all complete rows from both consumed whole frames; only their trailing boundary may remain pending.')
    require(type(value.get('unresolvedPriorSemanticExposure')) is bool and type(value.get('priorConsumedPrefixMappingVerified')) is bool and
            value.get('priorConsumedPrefixMappingVerified') is not value['unresolvedPriorSemanticExposure'],
            'Pending boundary exposure must remain explicit; opaque custody does not qualify fresh semantic access.')
    for key in ('productIds', 'canonicalFamilyTitles', 'modelIdentifiers', 'sourcePacketFingerprints', 'sourceBodyFingerprints'):
        require(isinstance(value.get(key), list) and bool(value[key]) and all(isinstance(x, str) and x for x in value[key]), 'Historical exclusion arrays are required.')
        if key in ('sourcePacketFingerprints', 'sourceBodyFingerprints'):
            require(all(SHA.fullmatch(x) for x in value[key]), 'Historical body and scope fingerprints must remain exact SHA256 values.')
    require(value.get('incidentalUnknownFamilyProductIds') == ['B000050B6Z'], 'Incidental documentation exposure must remain protected.')
    require(value.get('sourceSelectionAllowed') is False and value.get('providerCalls') == 0 and value.get('qualityClaimEligible') is False,
            'Historical custody cannot authorize fresh rows, providers or quality claims.')
    require(type(value.get('wholeConsumedFramesProtected')) is int and value['wholeConsumedFramesProtected'] >= 2,
            'Both consumed whole frames must remain protected.')
    prefixes = value.get('consumedSourcePrefixes')
    require(isinstance(prefixes, list) and len(prefixes) >= 2, 'Complete consumed interval commitments are required.')
    if source is not None:
        exact = set()
        for prefix in prefixes:
            require(isinstance(prefix, dict) and isinstance(prefix.get('key'), str) and isinstance(prefix.get('versionId'), str) and SHA.fullmatch(prefix.get('sha256', '')),
                    'Consumed intervals require exact source identities and byte hashes.')
            interval = prefix.get('range')
            require(isinstance(interval, dict) and type(interval.get('start')) is int and type(interval.get('endInclusive')) is int and interval['endInclusive'] >= interval['start'] >= 0,
                    'Consumed source intervals require exact finite bounds.')
            if prefix['key'] == source['objectKey'] and prefix['versionId'] == source['versionId']:
                exact.add((interval['start'], interval['endInclusive']))
                require(interval['endInclusive'] < RANGE_START or interval['start'] >= RANGE_START + MAX_BYTES,
                        'An already consumed interval cannot be reacquired as the fresh third frame.')
        require({(0, MAX_BYTES - 1), (MAX_BYTES, RANGE_START - 1)} <= exact,
                'The same immutable object must retain both exact consumed whole frames.')
    if value['unresolvedPriorSemanticExposure']:
        boundary = value.get('unresolvedTrailingBoundary')
        require(isinstance(boundary, dict) and boundary.get('nextByte') == RANGE_START,
                'Only the immediately preceding trailing boundary can remain pending for opaque custody.')
        fragment = boundary.get('trailingFragment')
        require(isinstance(fragment, dict) and type(fragment.get('bytes')) is int and fragment['bytes'] > 0 and
                fragment.get('endExclusive') == RANGE_START and SHA.fullmatch(fragment.get('sha256', '')),
                'Pending boundary needs its exact nonempty old fragment commitment.')
        if source is not None:
            require(boundary.get('objectKey') == source['objectKey'] and boundary.get('versionId') == source['versionId'],
                    'Pending boundary must belong to the same immutable source object.')
    else:
        require(value.get('unresolvedTrailingBoundary') is None, 'Resolved history cannot retain a hidden pending boundary.')


def verify_history(pin, root):
    history = read(pin['history']['path'], root)
    require(history['fileSha256'] == pin['history']['fileSha256'], 'Exact protected history bytes changed.')
    history_metadata(history['document'], pin['source'])
    require(HISTORY_VERIFIER in pin['implementationSha256'], 'The complete consumed-history verifier must be code-pinned.')
    history_path = pathlib.Path(history['path'])
    require(history_path.is_relative_to(root), 'Protected history must be a canonical checkout artifact.')
    try:
        result = subprocess.run(['node', '--import', 'tsx', HISTORY_VERIFIER, '--verify-history', '--input', history_path.relative_to(root).as_posix()],
                                cwd=root, env={'PATH': os.environ.get('PATH', '')}, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=600, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise ValueError('Complete historical exposure verifier unavailable or timed out before custody.') from None
    require(result.returncode == 0, 'Complete historical exposure did not replay before custody.')
    proof = json.loads(result.stdout)
    require(proof.get('format') == 'ablatrix-amazon-pqa-history-proof-v4' and proof.get('historyFileSha256') == history['fileSha256'] and
            type(proof.get('wholeConsumedFramesProtected')) is int and proof['wholeConsumedFramesProtected'] >= 2 and
            proof['wholeConsumedFramesProtected'] == history['document']['wholeConsumedFramesProtected'] and
            proof.get('unresolvedPriorSemanticExposure') is history['document']['unresolvedPriorSemanticExposure'] and
            proof.get('priorConsumedPrefixMappingVerified') is history['document']['priorConsumedPrefixMappingVerified'] and
            proof.get('providerCalls') == 0 and proof.get('sourceSelectionAllowed') is False and
            proof.get('counts') == {k: len(history['document'][k]) for k in ('productIds', 'canonicalFamilyTitles', 'modelIdentifiers', 'sourceBodyFingerprints', 'sourcePacketFingerprints')},
            'History replay did not bind the exact proposed exclusion bytes.')
    return proof


def implementation_paths(roots, root=ROOT):
    found, pending = set(), list(REQUIRED_CODE | set(roots))
    while pending:
        name = pending.pop()
        path = canonical_file(name, root)
        require(root in path.parents, 'Implementation must stay in this exact checkout.')
        relative = path.relative_to(root).as_posix()
        if relative in found:
            continue
        found.add(relative)
        if path.suffix not in ('.ts', '.tsx', '.js', '.py'):
            continue
        source = path.read_text(encoding='utf-8')
        if path.suffix in ('.ts', '.tsx', '.js'):
            for imported in re.findall(r'(?:from\s*|import\s*\(?\s*)[\'"](\.[^\'"]+)[\'"]', source):
                target = (path.parent/imported).resolve(strict=True)
                require(root in target.parents and target.suffix in ('.ts', '.tsx', '.js', '.json'), 'Implementation import escapes its frozen checkout.')
                pending.append(target.relative_to(root).as_posix())
        for dynamic in re.findall(r'[\'"]((?:scripts|server|sapiom-agent|web)/[^\'"]+\.(?:py|ts|tsx|js))[\'"]', source):
            # Historical verifier fixtures also name invented code paths. A
            # literal becomes a dependency only when the checkout contains it;
            # adding it later changes this exact closure and invalidates pin.
            if (root/dynamic).exists() or (root/dynamic).is_symlink():
                pending.append(dynamic)
        if path.suffix == '.py':
            for sibling in re.findall(r'with_name\([\'"]([^\'"]+\.py)[\'"]\)', source):
                pending.append((path.parent/sibling).relative_to(root).as_posix())
    return sorted(found)


def freeze(metadata_name, history_name, implementation_names, out, root=ROOT):
    metadata, history = read(metadata_name, root), read(history_name, root)
    source_metadata(metadata['document'])
    history_metadata(history['document'], metadata['document'])
    require(root in pathlib.Path(metadata['path']).parents and root in pathlib.Path(history['path']).parents,
            'Source/history metadata must remain inside this exact checkout.')
    code = {}
    for name in implementation_paths(implementation_names, root):
        path = canonical_file(name, root)
        require(path.is_relative_to(root), 'Implementation must stay in this checkout.')
        code[path.relative_to(root).as_posix()] = digest(path.read_bytes())
    require(REQUIRED_CODE <= set(code), 'Pin the complete new acquisition/history/v7 implementation closure.')
    packet = {'format': FORMAT + '-pin-v4', 'createdAt': datetime.now(timezone.utc).isoformat(),
              'sourceMetadata': {k: metadata[k] for k in ('path', 'fileSha256')},
              'history': {k: history[k] for k in ('path', 'fileSha256')}, 'source': metadata['document'],
              'implementationSha256': code, 'sourceBodyChecksumStatus': 'unknown_before_opaque_acquisition',
              'implementationEntryPoints': sorted(set(implementation_names) | REQUIRED_CODE),
              'semanticRowsInspected': 0, 'artifactDownloads': 0, 'existingSealedTestsOpened': False,
              'semanticAccessAuthorized': False, 'policy': POLICY, **FLAGS}
    write_new(out, packet)
    return {'format': FORMAT + '-freeze-result-v4', 'pinPath': out, 'pinFileSha256': read(out, root)['fileSha256'], **FLAGS}


def verify_pin(name, root=ROOT):
    pin = read(name, root)
    p = pin['document']
    require(p.get('format') == FORMAT + '-pin-v4' and all(p.get(k) == v for k, v in FLAGS.items()), 'Invalid custody pin provenance.')
    require(p.get('semanticRowsInspected') == 0 and p.get('artifactDownloads') == 0 and p.get('existingSealedTestsOpened') is False,
            'Pre-acquisition pin cannot conceal body access.')
    source_metadata(p['source'])
    created = datetime.fromisoformat(p['createdAt'])
    require(created.tzinfo is not None, 'Freeze timestamp must include its timezone.')
    for name in ('sourceMetadata', 'history'):
        artifact = read(p[name]['path'], root)
        require(root in pathlib.Path(artifact['path']).parents and artifact['fileSha256'] == p[name]['fileSha256'], 'Pinned source/history metadata changed or escaped this checkout.')
    require(read(p['sourceMetadata']['path'], root)['document'] == p['source'], 'Source metadata mismatch.')
    for path, expected in p['implementationSha256'].items():
        require(SHA.fullmatch(expected) and digest(canonical_file(path, root).read_bytes()) == expected,
                'Pinned acquisition/import implementation changed.')
    require(isinstance(p.get('implementationEntryPoints'), list) and REQUIRED_CODE <= set(p['implementationEntryPoints']) and
            set(p['implementationSha256']) == set(implementation_paths(p['implementationEntryPoints'], root)),
            'The exact transitive acquisition/history/v7 implementation closure is required.')
    verify_history(p, root)
    require(p.get('semanticAccessAuthorized') is False and p['policy'] == POLICY, 'Finite opaque-only acquisition policy changed.')
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
        require(r.get('format') == FORMAT + '-review-v4' and r.get('stage') == 'opaque_source_access', 'Unknown source-access review.')
        require(r.get('bindings') == bindings and r.get('sourceAware') is True, 'Review must bind exact source, history and implementation pin.')
        require(isinstance(r.get('reviewer'), str) and len(r['reviewer'].strip()) >= 3, 'Named reviewer required.')
        reviewed = datetime.fromisoformat(r['reviewedAt'])
        require(reviewed.tzinfo is not None and reviewed >= datetime.fromisoformat(p['createdAt']), 'Review must occur after the exact freeze.')
        require(r.get('provenance') == ('independent_source_aware_ai' if index < 2 else 'source_aware_ai_adjudication'), 'Review provenance differs.')
        require(r.get('role') == ('independent' if index < 2 else 'adjudicator'), 'Custody review roles must remain independent and explicit.')
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
        else:
            require(r.get('independentReviewFileSha256') == [], 'Independent custody reviews must precede the other reviewers.')
    return records


def qualify(pin_name, independent, adjudication, out, root=ROOT):
    pin = verify_pin(pin_name, root)
    records = verify_reviews(pin, independent, adjudication, root)
    value = {'format': FORMAT + '-qualification-v4', 'pinPath': pin['path'], 'pinFileSha256': pin['fileSha256'],
             'independentReviews': [{k: x[k] for k in ('path', 'fileSha256')} for x in records[:2]],
             'adjudication': {k: records[2][k] for k in ('path', 'fileSha256')},
             'status': 'reviewed_for_opaque_custody_only', 'artifactDownloads': 0, 'semanticRowsInspected': 0,
             'semanticAccessAuthorized': False, **FLAGS}
    write_new(out, value)
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Redirected dataset custody is forbidden.')


def acquire(pin_name, qualification_name, out_dir, root=ROOT, opener=None):
    pin = verify_pin(pin_name, root)
    q = read(qualification_name, root)['document']
    require(q.get('format') == FORMAT + '-qualification-v4' and q.get('pinPath') == pin['path'] and
            q.get('pinFileSha256') == pin['fileSha256'] and q.get('status') == 'reviewed_for_opaque_custody_only' and
            q.get('semanticAccessAuthorized') is False and q.get('artifactDownloads') == 0 and q.get('semanticRowsInspected') == 0 and
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
    request = urllib.request.Request(url, headers={'Range': f'bytes={RANGE_START}-{RANGE_START+MAX_BYTES-1}', 'If-Match': source['etag'], 'Accept-Encoding': 'identity',
                                                  'User-Agent': 'Ablatrix-APQA-opaque-custody-v4'}, method='GET')
    response_opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open
    record = {'format': FORMAT + '-custody-v4', 'pinPath': pin['path'], 'pinFileSha256': pin['fileSha256'],
              'qualificationPath': str(canonical_file(qualification_name, root)), 'source': source,
              'artifactDownloadAttempts': 1, 'artifactDownloads': 0, 'bytesReceived': 0, 'semanticRowsInspected': 0,
              'bodyParsed': False, 'automaticReviewComplete': True, 'freshnessEstablished': False,
              'priorBoundaryResolutionRequired': read(pin['document']['history']['path'], root)['document']['unresolvedPriorSemanticExposure'],
              'semanticAccessAuthorized': False,
              'existingSealedTestsOpened': False, **FLAGS}
    target = directory / 'source-prefix.bin'
    attempt = {'format': FORMAT + '-attempt-v4', 'pinFileSha256': pin['fileSha256'],
               'qualificationFileSha256': read(qualification_name, root)['fileSha256'],
               'requestMethod': 'GET', 'requestHost': source['host'], 'objectKey': source['objectKey'],
               'versionId': source['versionId'], 'rangeStart': RANGE_START, 'rangeBytes': MAX_BYTES,
               'createdAt': datetime.now(timezone.utc).isoformat(), 'artifactDownloadAttempts': 1,
               'semanticRowsInspected': 0, 'bodyParsed': False, 'automaticRetryAllowed': False, **FLAGS}
    write_new(str(directory/'attempt.json'), attempt)
    record['attemptFileSha256'] = read(str(directory/'attempt.json'), root)['fileSha256']
    try:
        with response_opener(request, timeout=45) as response:
            expected_range = f'bytes {RANGE_START}-{RANGE_START+MAX_BYTES-1}/{source["objectBytes"]}'
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
                    requested = min(65536, MAX_BYTES - record['bytesReceived'])
                    chunk = response.read(requested)
                    require(isinstance(chunk, bytes) and 0 < len(chunk) <= requested, 'Dataset range ended early or violated its bounded read contract.')
                    stream.write(chunk); h.update(chunk); record['bytesReceived'] += len(chunk)
                extra = response.read(1)
                record['extraBytesObserved'] = len(extra)
                require(not extra, 'Dataset exceeded the pinned byte range.')
                stream.flush()
                os.fsync(stream.fileno())
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
        pin = verify_pin(args.pin); result = {'format': FORMAT + '-pin-proof-v4', 'pinFileSha256': pin['fileSha256'], 'semanticRowsInspected': 0, **FLAGS}
    elif args.mode == 'qualify': result = qualify(args.pin, args.review, args.adjudication, args.out)
    else: result = acquire(args.pin, args.qualification, args.out_dir)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        print('APQA custody: ' + str(error), file=sys.stderr)
        sys.exit(1)
