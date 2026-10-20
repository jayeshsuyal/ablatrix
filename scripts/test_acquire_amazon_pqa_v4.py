"""Synthetic metadata/opaque bytes only; every HTTP and history process is mocked."""
import hashlib
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import types
import unittest
from datetime import datetime, timezone
from unittest import mock

spec = importlib.util.spec_from_file_location('apqa_custody_v4', pathlib.Path(__file__).with_name('acquire-amazon-pqa-v4.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class Response:
    status = 206
    def __init__(self, source, length=m.MAX_BYTES):
        self.remaining = length; self.read_calls = 0
        self.headers = {'Content-Range': f'bytes {m.RANGE_START}-{m.RANGE_START+m.MAX_BYTES-1}/{source["objectBytes"]}',
                        'Content-Length': str(m.MAX_BYTES), 'ETag': source['etag'], 'x-amz-version-id': source['versionId']}
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self, count):
        self.read_calls += 1; size = min(count, self.remaining); self.remaining -= size
        return b'x' * size  # Deliberately not JSON: opaque custody must not decode it.


class CustodyV4Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = pathlib.Path(self.temp.name).resolve()
        for name in m.REQUIRED_CODE:
            p = self.root/name; p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text('SYNTHETIC fixture code; never executed.\n')
        (self.root/'server/semantic-supplement-v7.ts').write_text("import './synthetic-guard.ts';\n// SYNTHETIC v7 guard fixture\n")
        (self.root/'server/synthetic-guard.ts').write_text('// SYNTHETIC transitive guard\n')
        self.metadata = {'format': m.FORMAT+'-source-metadata-v4', 'host': 'amazon-pqa.s3.amazonaws.com',
                         'objectKey': 'amazon_pqa_accessories.json', 'versionId': 'synthetic-version', 'etag': '"'+'a'*32+'-2"',
                         'objectBytes': m.RANGE_START+m.MAX_BYTES+100, 'rangeStart': m.RANGE_START, 'rangeBytes': m.MAX_BYTES,
                         'publisherSplit': 'unpartitioned_release', 'use': 'prospective_exploratory_validation',
                         'semanticRowsInspected': 0, 'artifactDownloads': 0, 'provenance': 'synthetic_fixture',
                         'existingSealedTestsOpened': False, 'providerCalls': 0, 'paidPlan': None}
        self.history = {'format': 'ablatrix-amazon-pqa-protected-history-v4', 'completeHistoricalUnion': True,
                        'priorConsumedCompleteRowsMappingVerified': True, 'unparsedTailExposureResolved': True,
                        'priorConsumedPrefixMappingVerified': False, 'unresolvedPriorSemanticExposure': True,
                        'sourceSelectionAllowed': False, 'providerCalls': 0, 'qualityClaimEligible': False,
                        'wholeConsumedFramesProtected': 2, 'incidentalUnknownFamilyProductIds': ['B000050B6Z'],
                        'consumedSourcePrefixes': [{'key': self.metadata['objectKey'], 'versionId': self.metadata['versionId'],
                          'sha256': str(i+1)*64, 'range': {'start': i*m.MAX_BYTES, 'endInclusive': (i+1)*m.MAX_BYTES-1}} for i in range(2)],
                        'unresolvedTrailingBoundary': {'objectKey': self.metadata['objectKey'], 'versionId': self.metadata['versionId'],
                          'nextByte': m.RANGE_START, 'trailingFragment': {'start': m.RANGE_START-12, 'endExclusive': m.RANGE_START, 'bytes': 12, 'sha256': 'a'*64}}}
        self.history.update({key: ['b'*64 if 'Fingerprints' in key else 'synthetic-exclusion'] for key in ['productIds','canonicalFamilyTitles','modelIdentifiers','sourcePacketFingerprints','sourceBodyFingerprints']})
        self.write('metadata.json', self.metadata); self.write('history.json', self.history)
        self.history_calls = []
        self.runner_patch = mock.patch.object(m.subprocess, 'run', side_effect=self.run_history); self.runner_patch.start()
        self.pin_path = str(self.root/'pin.json')
        m.freeze('metadata.json', 'history.json', ['scripts/acquire-amazon-pqa-v4.py'], self.pin_path, self.root)
        self.pin = m.read(self.pin_path, self.root)
        bindings = {'pinFileSha256': self.pin['fileSha256'], 'historyFileSha256': self.pin['document']['history']['fileSha256'],
                    'sourceMetadataFileSha256': self.pin['document']['sourceMetadata']['fileSha256']}
        self.reviews = []
        for i in range(3):
            document = {'format': m.FORMAT+'-review-v4', 'stage': 'opaque_source_access', 'reviewer': f'synthetic-independent-{i}',
                        'role': 'independent' if i<2 else 'adjudicator', 'reviewedAt': datetime.now(timezone.utc).isoformat(),
                        'provenance': 'independent_source_aware_ai' if i<2 else 'source_aware_ai_adjudication',
                        'bindings': bindings, 'sourceAware': True, 'outcome': 'approved_opaque_custody_only',
                        'reviewEvidence': 'SYNTHETIC source-aware review: both exact consumed whole frames and the fixed third interval are bound to one immutable object. All code dependencies, v7, retained boundary uncertainty and anonymous conditional byte-only custody are reviewed.',
                        'retainedUncertainty': ['The unresolved trailing boundary permits opaque custody only; all fresh semantic rows remain closed.'],
                        'unresolvedBlockingFindings': [], 'artifactDownloads': 0, 'semanticRowsInspected': 0,
                        'independentReviewFileSha256': [m.read(x, self.root)['fileSha256'] for x in self.reviews] if i==2 else [], **m.FLAGS}
            name = f'review-{i}.json'; self.write(name, document); self.reviews.append(name)
        self.qpath = str(self.root/'qualification.json')
        m.qualify(self.pin_path, self.reviews[:2], self.reviews[2], self.qpath, self.root)
    def tearDown(self): self.runner_patch.stop(); self.temp.cleanup()
    def write(self, name, value): (self.root/name).write_text(json.dumps(value))
    def run_history(self, args, **kwargs):
        self.history_calls.append((args, kwargs))
        self.assertEqual(args, ['node','--import','tsx',m.HISTORY_VERIFIER,'--verify-history','--input','history.json'])
        self.assertEqual(set(kwargs['env']), {'PATH'}); self.assertEqual(kwargs['cwd'], self.root); self.assertEqual(kwargs['timeout'], 600)
        value = json.loads((self.root/'history.json').read_bytes())
        proof = {'format': 'ablatrix-amazon-pqa-history-proof-v4', 'historyFileSha256': m.digest((self.root/'history.json').read_bytes()),
                 'wholeConsumedFramesProtected': value['wholeConsumedFramesProtected'], 'unresolvedPriorSemanticExposure': value['unresolvedPriorSemanticExposure'],
                 'priorConsumedPrefixMappingVerified': value['priorConsumedPrefixMappingVerified'],
                 'counts': {k:len(value[k]) for k in ['productIds','canonicalFamilyTitles','modelIdentifiers','sourceBodyFingerprints','sourcePacketFingerprints']},
                 'providerCalls': 0, 'sourceSelectionAllowed': False}
        return subprocess.CompletedProcess(args, 0, json.dumps(proof).encode(), b'')
    def acquire(self, response, out='custody'):
        self.requests = []
        def open_(request, timeout):
            self.requests.append(request)
            self.assertTrue((self.root/out/'attempt.json').exists(), 'Durable attempt must precede the only HTTP request.')
            self.assertEqual(timeout, 45)
            return response
        return m.acquire(self.pin_path, self.qpath, str(self.root/out), self.root, open_)
    def test_fixed_third_interval_opaque_sha_modes_and_no_resume(self):
        result = self.acquire(Response(self.metadata)); self.assertEqual(len(self.requests), 1)
        self.assertEqual(result['format'], m.FORMAT+'-custody-v4'); self.assertEqual(result['semanticRowsInspected'], 0); self.assertFalse(result['bodyParsed'])
        self.assertFalse(result['semanticAccessAuthorized']); self.assertTrue(result['priorBoundaryResolutionRequired'])
        self.assertEqual(result['sourcePrefixSha256'], hashlib.sha256(b'x'*m.MAX_BYTES).hexdigest()); self.assertEqual(result['artifactDownloads'], 1)
        request = self.requests[0]; self.assertEqual(request.get_method(), 'GET'); self.assertEqual(request.get_header('Range'), 'bytes=33554432-50331647')
        self.assertEqual(request.get_header('If-match'), self.metadata['etag']); self.assertNotIn('Authorization', dict(request.header_items())); self.assertNotIn('Cookie', dict(request.header_items()))
        self.assertEqual((self.root/'custody').stat().st_mode & 0o777, 0o700)
        for name in ['attempt.json','source-prefix.bin','custody.json']: self.assertEqual((self.root/'custody'/name).stat().st_mode & 0o777, 0o600)
        with self.assertRaises(ValueError): self.acquire(Response(self.metadata))
        self.assertEqual(self.requests, [])
    def test_all_transitive_code_and_both_history_intervals_are_required(self):
        self.assertIn('server/synthetic-guard.ts', self.pin['document']['implementationSha256'])
        revised = json.loads(json.dumps(self.pin['document'])); revised['implementationSha256'].pop('server/synthetic-guard.ts'); self.write('tampered-pin.json', revised)
        with self.assertRaises(ValueError): m.verify_pin(str(self.root/'tampered-pin.json'), self.root)
        for field in ['consumedSourcePrefixes', 'unresolvedTrailingBoundary']:
            history = json.loads(json.dumps(self.history))
            if field=='consumedSourcePrefixes': history[field] = history[field][:1]
            else: history[field]['nextByte'] = m.MAX_BYTES
            with self.assertRaises(ValueError): m.history_metadata(history, self.metadata)
        changed = dict(self.metadata, rangeStart=m.MAX_BYTES)
        with self.assertRaises(ValueError): m.source_metadata(changed)
        with self.assertRaises(ValueError): m.history_metadata(self.history, dict(self.metadata, versionId='another-version'))
    def test_exact_history_proof_is_mandatory_even_for_synthetic_metadata(self):
        with mock.patch.object(m.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, b'', b'SYNTHETIC failure')):
            with self.assertRaises(ValueError): self.acquire(Response(self.metadata))
        self.assertFalse((self.root/'custody').exists())
        proof = self.run_history(['node','--import','tsx',m.HISTORY_VERIFIER,'--verify-history','--input','history.json'], env={'PATH':''},cwd=self.root,timeout=600)
        document = json.loads(proof.stdout); document['sourceSelectionAllowed'] = True
        with mock.patch.object(m.subprocess, 'run', return_value=subprocess.CompletedProcess([],0,json.dumps(document).encode(),b'')):
            with self.assertRaises(ValueError): self.acquire(Response(self.metadata))
        self.assertFalse((self.root/'custody').exists())
    def test_pending_boundary_never_opens_semantic_access(self):
        self.assertFalse(self.pin['document']['semanticAccessAuthorized']); self.assertEqual(self.pin['document']['policy']['pendingBoundaryPermits'], 'opaque_custody_only')
        self.assertFalse(self.pin['document']['policy']['candidateApplicabilityUsedForSelection'])
        bad = dict(self.history, unparsedTailExposureResolved=False)
        with self.assertRaises(ValueError): m.history_metadata(bad, self.metadata)
        bad = dict(self.history, sourceSelectionAllowed=True)
        with self.assertRaises(ValueError): m.history_metadata(bad, self.metadata)
    def test_header_failures_stop_before_read_with_one_durable_attempt(self):
        for label in ['status','range','version','etag','length','encoding']:
            with self.subTest(label=label):
                response = Response(self.metadata)
                if label=='status': response.status = 200
                else: response.headers[{'range':'Content-Range','version':'x-amz-version-id','etag':'ETag','length':'Content-Length','encoding':'Content-Encoding'}[label]] = 'SYNTHETIC invalid'
                with self.assertRaises(ValueError): self.acquire(response,label)
                self.assertEqual(response.read_calls,0); self.assertEqual(len(self.requests),1)
                record=json.loads((self.root/label/'custody.json').read_bytes()); self.assertEqual(record['status'],'failed_or_unknown_no_retry'); self.assertEqual(record['artifactDownloads'],0)
                self.assertEqual(record['attemptFileSha256'], m.digest((self.root/label/'attempt.json').read_bytes()))
    def test_partial_and_overlong_response_fail_without_retry_or_overwrite(self):
        for label,length in [('short',11),('long',m.MAX_BYTES+1)]:
            with self.subTest(label=label):
                with self.assertRaises(ValueError): self.acquire(Response(self.metadata,length),label)
                record=json.loads((self.root/label/'custody.json').read_bytes()); size=min(length,m.MAX_BYTES)
                self.assertEqual(record['partialArtifactBytes'],size); self.assertEqual(record['partialArtifactSha256'],hashlib.sha256(b'x'*size).hexdigest()); self.assertEqual(len(self.requests),1)
                if label=='long': self.assertEqual(record['extraBytesObserved'],1)
    def test_metadata_history_review_or_v7_change_precedes_any_http_or_output(self):
        for name in ['metadata.json','history.json','review-0.json','server/semantic-supplement-v7.ts','server/synthetic-guard.ts','package-lock.json']:
            with self.subTest(name=name):
                path=self.root/name; original=path.read_bytes(); path.write_bytes(original+b' ')
                try:
                    with self.assertRaises(ValueError): self.acquire(Response(self.metadata))
                    self.assertFalse((self.root/'custody').exists()); self.assertEqual(self.requests,[])
                finally: path.write_bytes(original)
    def test_review_provenance_identity_and_adjudicator_bindings_are_required(self):
        for label in ['boolean-evidence','duplicate-identity','wrong-role','wrong-binding','blocker','quality-claim']:
            document=json.loads((self.root/'review-0.json').read_bytes()); changed=dict(document)
            if label=='boolean-evidence': changed['reviewEvidence']='approved'
            elif label=='duplicate-identity': changed['reviewer']='synthetic-independent-1'
            elif label=='wrong-role': changed['role']='adjudicator'
            elif label=='wrong-binding': changed['bindings']={}
            elif label=='blocker': changed['unresolvedBlockingFindings']=['Missing source constraint']
            else: changed['qualityClaimEligible']=True
            self.write('review-0.json',changed)
            with self.assertRaises(ValueError): m.qualify(self.pin_path,self.reviews[:2],self.reviews[2],str(self.root/(label+'.json')),self.root)
            self.write('review-0.json',document)
    def test_default_transport_disables_proxies_and_redirects(self):
        calls=[]
        def open_(request, timeout): calls.append(request); return Response(self.metadata)
        with mock.patch.object(m.urllib.request,'build_opener',return_value=types.SimpleNamespace(open=open_)) as build:
            result=m.acquire(self.pin_path,self.qpath,str(self.root/'default'),self.root)
        handlers=build.call_args.args; self.assertTrue(any(isinstance(h,m.NoRedirect) for h in handlers))
        proxy=next(h for h in handlers if isinstance(h,m.urllib.request.ProxyHandler)); self.assertEqual(proxy.proxies,{})
        self.assertEqual(len(calls),1); self.assertEqual(result['providerCalls'],0)
        with self.assertRaises(ValueError):m.NoRedirect().redirect_request(None,None,302,'redirect',{},'https://elsewhere.invalid/data')
    def test_symlink_artifacts_and_existing_outputs_fail_closed(self):
        (self.root/'pin-link.json').symlink_to(self.root/'pin.json')
        with self.assertRaises(ValueError):m.verify_pin(str(self.root/'pin-link.json'),self.root)
        with self.assertRaises(ValueError):m.freeze('metadata.json','history.json',[],self.pin_path,self.root)


if __name__ == '__main__': unittest.main()
