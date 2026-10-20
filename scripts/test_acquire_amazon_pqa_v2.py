import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location('apqa_custody', pathlib.Path(__file__).with_name('acquire-amazon-pqa-v2.py'))
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
        self.read_calls += 1
        size = min(count, self.remaining); self.remaining -= size
        return b'x' * size


class CustodyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = pathlib.Path(self.temp.name).resolve()
        (self.root/'scripts').mkdir()
        names = ['scripts/acquire-amazon-pqa-v2.py', 'source.ts', 'workflow.ts', 'cli.ts']
        for name in names: (self.root/name).write_text('SYNTHETIC offline custody fixture\n')
        self.metadata = {'format': m.FORMAT+'-source-metadata-v2', 'host': 'amazon-pqa.s3.amazonaws.com',
                         'objectKey': 'amazon_pqa_accessories.json', 'versionId': 'synthetic-version', 'etag': '"'+'a'*32+'-2"',
                         'objectBytes': m.RANGE_START+m.MAX_BYTES+100, 'rangeStart': m.RANGE_START, 'rangeBytes': m.MAX_BYTES,
                         'publisherSplit': 'unpartitioned_release', 'use': 'prospective_exploratory_validation',
                         'semanticRowsInspected': 0, 'artifactDownloads': 0, 'provenance': 'synthetic_fixture'}
        history = {'format': 'ablatrix-amazon-pqa-protected-history-v2', 'completeHistoricalUnion': True, 'priorConsumedCompleteRowsMappingVerified': True, 'priorConsumedPrefixMappingVerified': False, 'unresolvedPriorSemanticExposure': True,
                   'incidentalUnknownFamilyProductIds': ['B000050B6Z']}
        history.update({key: ['synthetic-exclusion'] for key in ['productIds','canonicalFamilyTitles','modelIdentifiers','sourcePacketFingerprints','sourceBodyFingerprints']})
        self.write('metadata.json', self.metadata); self.write('history.json', history)
        self.pin_path = str(self.root/'pin.json')
        m.freeze('metadata.json', 'history.json', names, self.pin_path, self.root)
        self.pin = m.read(self.pin_path, self.root)
        bindings = {'pinFileSha256': self.pin['fileSha256'], 'historyFileSha256': self.pin['document']['history']['fileSha256'],
                    'sourceMetadataFileSha256': self.pin['document']['sourceMetadata']['fileSha256']}
        self.reviews = []
        for i in range(3):
            document = {'format':m.FORMAT+'-review-v2','stage':'opaque_source_access','reviewer':f'synthetic-independent-{i}',
                        'reviewedAt':datetime.now(timezone.utc).isoformat(),
                        'provenance': 'independent_source_aware_ai' if i<2 else 'source_aware_ai_adjudication',
                        'bindings':bindings,'sourceAware':True,'outcome':'approved_opaque_custody_only',
                        'reviewEvidence':'SYNTHETIC review: fixed version and conditional range checked against exact metadata. No parser, credentials, model dispatcher or retry path exists in the bounded opaque acquisition fixture.',
                        'retainedUncertainty':['No product eligibility or answer quality is established by opaque custody.'],
                        'unresolvedBlockingFindings':[],'artifactDownloads':0,'semanticRowsInspected':0,**m.FLAGS}
            if i==2: document['independentReviewFileSha256']=[m.read(x,self.root)['fileSha256'] for x in self.reviews]
            name=f'review-{i}.json'; self.write(name,document); self.reviews.append(name)
        self.qpath=str(self.root/'qualification.json')
        m.qualify(self.pin_path,self.reviews[:2],self.reviews[2],self.qpath,self.root)
    def tearDown(self): self.temp.cleanup()
    def write(self,name,value): (self.root/name).write_text(json.dumps(value))
    def acquire(self, response, out='custody'):
        self.requests=[]
        def open_(request, timeout): self.requests.append(request); return response
        return m.acquire(self.pin_path,self.qpath,str(self.root/out),self.root,open_)
    def test_exact_range_opaque_hash_no_parse_and_no_resume(self):
        response=Response(self.metadata)
        result=self.acquire(response)
        self.assertEqual(result['semanticRowsInspected'],0);self.assertFalse(result['bodyParsed'])
        self.assertEqual(result['artifactDownloads'],1);self.assertEqual(result['bytesReceived'],m.MAX_BYTES)
        self.assertEqual(result['sourcePrefixSha256'],hashlib.sha256(b'x'*m.MAX_BYTES).hexdigest())
        self.assertEqual(self.requests[0].get_header('Range'),f'bytes={m.RANGE_START}-{m.RANGE_START+m.MAX_BYTES-1}')
        self.assertEqual(self.requests[0].get_header('If-match'),self.metadata['etag'])
        self.assertIn('versionId=synthetic-version',self.requests[0].full_url)
        with self.assertRaises(ValueError): self.acquire(Response(self.metadata))
        self.assertEqual(self.requests,[])
    def test_ignored_range_and_changed_version_fail_before_read(self):
        for label in ('status','version','range','length','encoding'):
            with self.subTest(label=label):
                response=Response(self.metadata)
                if label=='status': response.status=200
                elif label=='version': response.headers['x-amz-version-id']='different'
                elif label=='range': response.headers['Content-Range']='bytes 0-4/5'
                elif label=='length': response.headers['Content-Length']='5'
                else: response.headers['Content-Encoding']='gzip'
                with self.assertRaises(ValueError): self.acquire(response,label)
                self.assertEqual(response.read_calls,0)
                record=json.loads((self.root/label/'custody.json').read_text())
                self.assertEqual(record['status'],'failed_or_unknown_no_retry');self.assertEqual(record['artifactDownloads'],0)
    def test_partial_body_is_retained_and_never_retried(self):
        with self.assertRaises(ValueError): self.acquire(Response(self.metadata,11))
        record=json.loads((self.root/'custody/custody.json').read_text())
        self.assertEqual(record['bytesReceived'],11);self.assertTrue(record['partialArtifactRetained'])
        self.assertEqual(record['partialArtifactBytes'],11);self.assertEqual(record['partialArtifactSha256'],hashlib.sha256(b'x'*11).hexdigest())
        self.assertEqual(len(self.requests),1)
    def test_late_review_and_history_changes_precede_network_or_output(self):
        for name in ('review-0.json','history.json','source.ts'):
            raw=(self.root/name).read_bytes();(self.root/name).write_bytes(raw+b' ')
            response=Response(self.metadata)
            with self.assertRaises((ValueError,AssertionError)): self.acquire(response)
            self.assertEqual(response.read_calls,0);self.assertFalse((self.root/'custody').exists())
            (self.root/name).write_bytes(raw)
    def test_boolean_only_review_and_duplicate_identity_cannot_qualify(self):
        for change in ('evidence','identity','blocker'):
            original=json.loads((self.root/'review-0.json').read_text()); revised=dict(original)
            if change=='evidence': revised['reviewEvidence']='approved'
            elif change=='identity': revised['reviewer']='synthetic-independent-1'
            else: revised['unresolvedBlockingFindings']=['Missing immutable version pin']
            self.write('review-0.json',revised)
            with self.assertRaises(ValueError): m.qualify(self.pin_path,self.reviews[:2],self.reviews[2],str(self.root/(change+'.json')),self.root)
            self.write('review-0.json',original)
    def test_symlinks_are_rejected_before_qualification(self):
        (self.root/'link.json').symlink_to(self.root/'pin.json')
        with self.assertRaises(ValueError): m.verify_pin(str(self.root/'link.json'),self.root)
    def test_redirect_handler_never_follows_other_hosts(self):
        with self.assertRaises(ValueError): m.NoRedirect().redirect_request(None,None,302,'redirect',{},'https://elsewhere.invalid/data')
    def test_real_history_replay_uses_the_required_repository_relative_argument(self):
        script=self.root/'scripts/prepare-amazon-pqa-history-v2.py'
        script.write_text('import pathlib,sys,json,hashlib\np=pathlib.Path(sys.argv[-1]);assert not p.is_absolute()\nprint(json.dumps({"format":"ablatrix-amazon-pqa-history-proof-v2","historyFileSha256":hashlib.sha256(p.read_bytes()).hexdigest()}))\n')
        pin=json.loads(json.dumps(self.pin['document']));pin['source']['provenance']='publisher_metadata'
        pin['implementationSha256']['scripts/prepare-amazon-pqa-history-v2.py']=hashlib.sha256(script.read_bytes()).hexdigest()
        m.verify_history(pin,self.root)


if __name__=='__main__':unittest.main()
