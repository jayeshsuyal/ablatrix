import importlib.util,pathlib,unittest,copy
s=importlib.util.spec_from_file_location('history2',pathlib.Path(__file__).with_name('prepare-amazon-pqa-history-v2.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

class NativeHistoryTests(unittest.TestCase):
    def fixture(self):
        prefix={'key':'amazon_pqa_accessories.json','versionId':'SYNTHETIC','sha256':'a'*64,'range':{'start':0,'endInclusive':16*1024*1024-1}}
        base={'completeHistoricalUnion':True,'normalization':{'pythonVersion':'SYNTHETIC','unicodeVersion':'SYNTHETIC'},**{k:['old-'+k] for k in m.FIELDS}}
        failed={'format':'ablatrix-amazon-pqa-semantic-access-failure-v1','status':'source_parse_failed','wholePrefixConsumed':True,'eligiblePackets':0,'providerCalls':0,'consumedExposure':{k:['recognized-'+k] for k in m.FIELDS},'opaquePrefixObjects':[{**prefix,'rawSha256':prefix['sha256']}]}
        exposed={'format':'ablatrix-amazon-pqa-exposed-prefix-replay-v2','developmentOnly':True,'completeRowsMapped':True,'completePrefixMapping':True,'sourceEligibilityPassed':False,'candidateContextInspected':False,'answerOutputsInspected':False,'providerCalls':0,'sourcePrefixes':[prefix],'semanticRowsInspected':3,'normalization':base['normalization'],'consumedExposure':{k:['mapped-'+k] for k in m.FIELDS},'unresolvedBoundary':False,'withheldAggregateFingerprints':['label-hash']}
        return base,failed,exposed
    def test_complete_native_mapping_keeps_old_failure_and_annotation_roles(self):
        result=m.combine(*self.fixture())
        for key in m.FIELDS:self.assertEqual(len(result[key]),3);self.assertNotIn('label-hash',result[key])
        self.assertTrue(result['priorConsumedPrefixMappingVerified']);self.assertFalse(result['unresolvedPriorSemanticExposure']);self.assertEqual(result['withheldAggregateFingerprints'],['label-hash'])
    def test_changed_raw_prefix_incomplete_or_claimed_fresh_replay_fail(self):
        for mode in ('version','range','checksum','incomplete','fresh','profile','zero'):
            base,failed,exposed=self.fixture()
            if mode=='version':exposed['sourcePrefixes'][0]['versionId']='other'
            elif mode=='range':exposed['sourcePrefixes'][0]['range']['start']=2
            elif mode=='checksum':exposed['sourcePrefixes'][0]['sha256']='b'*64
            elif mode=='incomplete':exposed['completeRowsMapped']=False
            elif mode=='fresh':exposed['sourceEligibilityPassed']=True
            elif mode=='profile':exposed['normalization']={'pythonVersion':'other','unicodeVersion':'SYNTHETIC'}
            else:exposed['semanticRowsInspected']=0
            with self.assertRaises(AssertionError):m.combine(base,failed,exposed)
    def test_missing_or_uncertain_boundary_stays_blocked(self):
        base,failed,exposed=self.fixture();exposed.update(unresolvedBoundary=True,completePrefixMapping=False)
        result=m.combine(base,failed,exposed)
        self.assertTrue(result['unresolvedPriorSemanticExposure']);self.assertFalse(result['priorConsumedPrefixMappingVerified'])
        for value in (None,False):
            base,failed,exposed=self.fixture();exposed.update(unresolvedBoundary=value,completePrefixMapping=False)
            with self.assertRaises(AssertionError):m.combine(base,failed,exposed)

if __name__=='__main__':unittest.main()
