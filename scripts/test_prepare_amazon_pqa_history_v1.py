import importlib.util
import json
import hashlib
import pathlib
import unicodedata
import unittest

spec=importlib.util.spec_from_file_location('apqa_history',pathlib.Path(__file__).with_name('prepare-amazon-pqa-history-v1.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
norm=lambda text:' '.join(unicodedata.normalize('NFKC',text).casefold().split())
hash_=lambda values:hashlib.sha256(json.dumps(values,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
body=lambda source:hash_([norm(source['text'])])
scoped=lambda source:hash_([norm(source['text']),norm(source.get('originalQuestion') or '')])


class HistoryTests(unittest.TestCase):
    def test_actual_failed_pool_wrapper_and_replay_cannot_become_a_list_or_success(self):
        seal=lambda value:hashlib.sha256(json.dumps(value,ensure_ascii=False,separators=(',',':'),sort_keys=True).encode()).hexdigest()
        document={'format':'ablatrix-v6-source-custodian-record-v3','pool':{'format':'ablatrix-fresh-source-only-pool-v1','cases':[]},'screeningPacketDenominator':0,'stopReason':'insufficient_fixed_pool_without_replacement','modelOutputsUsed':False,'answerColumnsUsed':False,'candidateContextInspected':False,'providerCalls':0,'paidPlan':None}
        document['custodianSha256']=seal(document)
        m.verify_failed_custodian(document,seal)
        for change in ('pool','stopReason','custodianSha256'):
            altered=dict(document);altered[change]=[] if change=='pool' else 'changed'
            with self.assertRaises(AssertionError):m.verify_failed_custodian(altered,seal)
    def fixture(self):
        base={field:['prior-'+field] for field in m.FIELDS}
        consumed={field:['rejected-'+field] for field in m.FIELDS}
        consumed['custodianRecordFileSha256']='raw-exact-custodian'
        custodian={'fileSha256':'raw-exact-custodian','document':{'finiteQuestionDenominator':2,'decisions':[{'inspectedExposure':{field:['rejected-'+field] for field in m.FIELDS}},{'inspectedExposure':{}}]}}
        metadata={'incidentalDocumentationExposure':[{'asin':'B000050B6Z','productExcluded':True,'familySeparationStatus':'unqualified_until_checked','questionText':'SYNTHETIC Straße?','answerText':'SYNTHETIC Σςσ','literalObservedQuestionAnswerBody':'SYNTHETIC Straße?\nSYNTHETIC Σςσ'}]}
        return base,consumed,custodian,metadata
    def test_complete_union_keeps_rejected_and_unknown_family_and_casefold(self):
        result=m.merge_exposure(*self.fixture(),norm,body,scoped)
        for field in m.FIELDS:self.assertIn('prior-'+field,result[field]);self.assertIn('rejected-'+field,result[field])
        self.assertIn('B000050B6Z',result['productIds']);self.assertEqual(result['incidentalUnknownFamilyProductIds'],['B000050B6Z'])
        self.assertIn(body({'text':'SYNTHETIC strasse?'}),result['sourceBodyFingerprints'])
        self.assertIn(body({'text':'SYNTHETIC σσσ'}),result['sourceBodyFingerprints'])
    def test_missing_rejected_body_and_wrong_custodian_fail(self):
        for mode in ('omission','binding','denominator'):
            base,consumed,custodian,metadata=self.fixture()
            if mode=='omission':consumed['sourceBodyFingerprints']=[]
            elif mode=='binding':consumed['custodianRecordFileSha256']='wrong'
            else:custodian['document']['finiteQuestionDenominator']=3
            with self.assertRaises(AssertionError):m.merge_exposure(base,consumed,custodian,metadata,norm,body,scoped)
    def test_incidental_unknown_family_cannot_silently_be_claimed_resolved(self):
        base,consumed,custodian,metadata=self.fixture();metadata['incidentalDocumentationExposure'][0]['familySeparationStatus']='fresh'
        with self.assertRaises(AssertionError):m.merge_exposure(base,consumed,custodian,metadata,norm,body,scoped)


if __name__=='__main__':unittest.main()
