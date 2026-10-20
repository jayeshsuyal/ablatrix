"""Synthetic v2 protocol/custodian/gate fixtures; no fresh corpus is read."""
import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('fresh_v2',pathlib.Path(__file__).with_name('prepare-fresh-validation-v2.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def empty_history():return {'productIds':[],'canonicalFamilyTitles':[],'modelIdentifiers':[],'sourcePacketFingerprints':[]}


def letters(number):
    return chr(97+(number//676)%26)+chr(97+(number//26)%26)+chr(97+number%26)


def rows():
    return [{'qid':str(i),'question':'How does this product operate?','ASIN':f'B{i:09d}','candidate':'SYNTHETIC independent report '+letters(i),
             'source':'review','qa_pair_id':str(i),'title':'Brand'+letters(i),'row':i+2,'answer':'MUST-NOT-ENTER','relevance':'MUST-NOT-ENTER'} for i in range(256)]


def split(row):return row['candidate'],None


def frozen_fixture():
    return {'protocol':{'fileSha256':'1'*64,'document':{'createdAt':'2026-10-19T00:00:00+00:00'}},
            'freeze':{'fileSha256':'2'*64,'document':{'implementationSha256':{m.DEVELOPMENT_VERIFIER:'9'*64}}},
            'history':{'fileSha256':'3'*64,'document':empty_history()},
            'contracts':{'candidate':{'fileSha256':'4'*64},'policy':{'fileSha256':'5'*64},'development':{'fileSha256':'6'*64}}}


def access_record():
    return {'format':'ablatrix-fresh-source-access-qualification-v2','status':'reviewed_for_custodian_only',
            'protocolFileSha256':'1'*64,'candidatePolicyFreezeFileSha256':'2'*64,'historyInventoryFileSha256':'3'*64,
            'reviewedImplementationSha256':{m.DEVELOPMENT_VERIFIER:'9'*64},'reviewedAt':'2026-10-19T01:00:00+00:00',
            'applicableHumanDisagreementsResolved':True,'newDevelopmentOutcomeEligible':True,'reviewer':'SYNTHETIC independent reviewer',
            'reviewEvidence':'SYNTHETIC exact-code source-access review','provenance':'independent_source_code_review',
            'freshInputsInspectedBeforeFreeze':False,'paidPlan':None,'developmentOutcomePath':'outcome.json','developmentOutcomeFileSha256':'7'*64}


def outcome_record():
    return {'format':'ablatrix-v6-development-outcome-qualification-v1','status':'independently_reviewed_for_bounded_fresh_preparation',
            'candidateFreezeFileSha256':'4'*64,'policyFreezeFileSha256':'5'*64,'developmentProtocolFileSha256':'6'*64,
            'verifiedActualCompletedAttempts':24,'sourceAwareReviewsComplete':True,'newHumanDisagreementsResolved':True,
            'independentReviewer':'SYNTHETIC reviewer','independentRationale':'SYNTHETIC bounded exploratory reason',
            'noUnresolvedMaterialRegression':True,'paidPlan':None,'humanResolutionArtifacts':[],
            'old3UsedAsQualityEvidence':False,'unresolvedApplicableHumanAxes':[]}


class V2Tests(unittest.TestCase):
    def test_metadata_exposes_prior_path_and_sha_without_opening_dataset_or_ledger(self):
        with mock.patch.object(pathlib.Path,'read_bytes',side_effect=AssertionError('no data read')),mock.patch.object(m,'ledger_rows',side_effect=AssertionError('no ledger needed')):
            value=m.metadata()
        self.assertEqual(value['freshInputReads'],0);self.assertEqual(value['source']['sha256'],'b63de9681b770573240367e919f7f04f087f6a4745ab1f79a77e6b800105ea25');self.assertIsNone(value['paidPlan'])

    def test_pending_source_access_precedes_dataset_path_access_and_loader_import(self):
        with mock.patch.object(m,'verify_freeze',return_value=frozen_fixture()),mock.patch.object(m,'read',return_value={'document':{'format':'ablatrix-fresh-source-access-qualification-v2','status':'review_pending'}}) as read:
            with self.assertRaisesRegex(ValueError,'fresh source not read'):
                m.custodian(pathlib.Path('/private/tmp'),'freeze','pending.json','DO-NOT-READ.csv','/private/tmp/DO-NOT-CREATE')
        self.assertEqual(read.call_count,1)

    def test_pending_pool_gate_precedes_pool_read_or_stat(self):
        with mock.patch.object(m,'verify_freeze',return_value=frozen_fixture()),mock.patch.object(m,'read',return_value={'document':{'format':'ablatrix-fresh-pool-qualification-v2','status':'review_pending'}}) as read:
            with self.assertRaisesRegex(ValueError,'fresh source not read'):m.screen(pathlib.Path('/private/tmp'),'freeze','pending.json','DO-NOT-READ.json')
        self.assertEqual(read.call_count,1);self.assertEqual(read.call_args.args[1],'pending.json')

    def test_old3_or_changed_policy_cannot_qualify_new_candidate(self):
        for change in [lambda o:o.update(verifiedActualCompletedAttempts=3),lambda o:o.update(policyFreezeFileSha256='8'*64),lambda o:o.update(unresolvedApplicableHumanAxes=['uncertainty']),lambda o:o.update(old3UsedAsQualityEvidence=True)]:
            q,o=access_record(),outcome_record();change(o)
            def read(_root,path):return {'fileSha256':'7'*64,'document':o} if path=='outcome.json' else {'document':q,'fileSha256':'8'*64}
            with mock.patch.object(m,'read',side_effect=read),self.assertRaises(ValueError):m.qualification(pathlib.Path('/private/tmp'),frozen_fixture(),'access.json')

    def test_bool_only_human_and_receipt_assertion_has_no_verifier_fallback(self):
        q,o=access_record(),outcome_record()
        def read(_root,path):return {'fileSha256':'7'*64,'document':o} if path=='outcome.json' else {'document':q,'fileSha256':'8'*64}
        with mock.patch.object(m,'read',side_effect=read),self.assertRaises((ValueError,FileNotFoundError)):m.qualification(pathlib.Path('/private/tmp'),frozen_fixture(),'access.json')

    def test_new_reviewed_verifier_can_prove_new24_without_relabeling_old_unresolved_axes(self):
        q,o=access_record(),outcome_record();proof={'format':'ablatrix-report-calibration-development-outcome-proof-v1','outcomeFileSha256':'7'*64,'verifiedActualCompletedAttempts':24,'newHumanDisagreementsResolved':True,'newProviderCalls':0}
        def read(_root,path):return {'fileSha256':'7'*64,'document':o} if path=='outcome.json' else {'document':q,'fileSha256':'8'*64}
        verifier=mock.Mock();verifier.read_bytes.return_value=b'SYNTHETIC verified source'
        f=frozen_fixture();f['freeze']['document']['implementationSha256'][m.DEVELOPMENT_VERIFIER]=m.sha(verifier.read_bytes());q['reviewedImplementationSha256']=f['freeze']['document']['implementationSha256']
        with mock.patch.object(m,'read',side_effect=read),mock.patch.object(m.v1,'canonical_file',return_value=verifier),mock.patch.object(m.subprocess,'check_output',return_value=json.dumps(proof).encode()):
            self.assertEqual(m.qualification(pathlib.Path('/private/tmp'),f,'access.json')['fileSha256'],'8'*64)
        self.assertFalse(o['old3UsedAsQualityEvidence']);self.assertNotIn('oldHumanAxisReviewResolved',o)

    def test_source_custodian_is_finite_deterministic_and_never_uses_answer_columns(self):
        original=rows();a=m.custodian_document(original,empty_history(),split);b=m.custodian_document(list(reversed(original)),empty_history(),split)
        self.assertEqual(a,b);self.assertEqual(len(a['decisions']),256);self.assertEqual(len(a['pool']['cases']),24);self.assertIsNone(a['stopReason'])
        self.assertEqual(sum(r['sourceInspected'] for r in a['decisions']),24);self.assertNotIn('MUST-NOT-ENTER',json.dumps(a));self.assertIsNone(a['paidPlan'])
        m.v1.source_cases(a['pool'])

    def test_complete_parent_conditions_are_never_split_or_truncated(self):
        row=rows()[0];row['candidate']='SYNTHETIC report '+('x'*950)+'; manually stopped, not measured exhaustion.'
        value=m.source_pool([row],split)
        self.assertEqual(len(value),1);self.assertEqual(value[0]['text'],row['candidate']);self.assertIn('not measured exhaustion',value[0]['text'])
        row['candidate']='x'*1501
        with self.assertRaisesRegex(ValueError,'no splitting'):m.source_pool([row],split)

    def test_historical_and_within_pool_body_scope_overlap_retains_negative_denominator(self):
        original=rows()
        for row in original:row['candidate']='SYNTHETIC identical body'
        result=m.custodian_document(original,empty_history(),split)
        self.assertEqual(len(result['pool']['cases']),1);self.assertEqual(len(result['decisions']),256);self.assertEqual(result['stopReason'],'insufficient_fixed_pool_without_replacement')
        self.assertTrue(any('body_and_original_question' in str(r['reasons']) for r in result['decisions']))
        original=rows();first=m.custodian_document(original,empty_history(),split)['pool']['cases'][0]
        protected=empty_history();protected['sourcePacketFingerprints']=[m.v1.scoped_fingerprint(first['sources'][0])]
        result=m.custodian_document(original,protected,split)
        self.assertNotIn(first['id'],[c['id'] for c in result['pool']['cases']]);self.assertEqual(len(result['decisions']),256)

    def test_source_pool_identity_preserves_original_cqa_scope(self):
        row=rows()[0]
        a=m.source_pool([row],lambda r:(r['candidate'],'Model ZA-1?'))
        b=m.source_pool([row],lambda r:(r['candidate'],'Model ZA-2?'))
        self.assertNotEqual(a[0]['id'],b[0]['id']);self.assertNotEqual(m.v1.scoped_fingerprint(a[0]),m.v1.scoped_fingerprint(b[0]))

    def test_old_projection_publishes_no_answer_text_or_arm_mapping_and_retains_human_gap(self):
        cases=[{'id':'old-exposed-case','product':{'id':'B000000001','title':'Old exposed product'},'completeSources':[{'text':'OLD literal source','originalQuestion':None}]}]
        rows_fixture=[];steps=[];slots=[]
        for i in range(3):
            row={'id':str(i),'run_id':'private-operation-'+str(i),'kind':'answer','status':'completed','model':'SYNTHETIC','input_tokens':1,'output_tokens':1,'allowance_usd':.1,'receipt_json':json.dumps({'output':'SYNTHETIC PRIVATE ANSWER MUST NOT PUBLISH','requestSha256':'x'*64}),'error_code':None}
            rows_fixture.append(row);steps.append({'attemptId':str(i),'receipt':dict(row)});slots.append({'input':{'runId':row['run_id']},'binding':{'requestSha256':'x'*64}})
        p={'fileSha256':'a'*64,'document':{'sha256':'p','diagnostic':{'sha256':'d','document':{'scope':'exposed_development_only','slots':slots,'preparation':{'cases':cases}}}}}
        p['document']['diagnostic']['sha256']=m.sha(m.compact(p['document']['diagnostic']['document']))
        p['document'].pop('sha256');p['document']['sha256']=m.sha(m.compact(p['document']))
        c={'fileSha256':'b'*64,'document':{'planSha256':p['document']['diagnostic']['sha256'],'provenance':'live_router','steps':steps}}
        r={'fileSha256':'c'*64,'document':{'scope':'exposed_development_only','transportProvenance':'live_router','denominator':{'plannedAnswers':3,'completed':3,'failedOrUnknown':0,'unattempted':0},'focusedReview':[{'label':'Answer 2','disagreementAxes':['appropriateUncertainty'],'humanSourceChecked':False}],'humanSourceCheckedActualAnswers':0}}
        result=m.exposure_projection(p,c,r,rows_fixture,{'attempts':141,'reservedUsd':14.1,'priorAdjustmentUsd':.200281,'pending':0,'owners':0})
        text=json.dumps(result);self.assertNotIn('PRIVATE ANSWER',text);self.assertNotIn('private-operation-',text);self.assertNotIn('OLD literal source',text)
        self.assertFalse(result['humanGatePassed']);self.assertFalse(result['newV6DevelopmentQualified']);self.assertEqual(result['oldStudy']['completedAttempts'],3)
        rows_fixture[0]['receipt_json']='changed'
        with self.assertRaisesRegex(ValueError,'differs from saved'):m.exposure_projection(p,c,r,rows_fixture,{'attempts':141,'pending':0,'owners':0})

    def fixture_contracts(self,root):
        (root/'implementation.py').write_text('# SYNTHETIC frozen code')
        code={'implementation.py':m.sha((root/'implementation.py').read_bytes())}
        candidate={'candidate':{'contract':'workspace-semantic-supplement-v6-quantified-peer-dev','minimumDistinctAnchors':2},'implementationSha256':code,'policyPath':'policy.json'}
        instructions='SYNTHETIC generic source uncertainty rules without product identifiers.'
        policy={'contract':'workspace-answer-uncertainty-v2','prompt':{'contract':'workspace-answer-uncertainty-v2','systemInstructions':instructions,'systemInstructionsSha256':m.sha(instructions)},'implementationSha256':code}
        projection={'format':'ablatrix-old3-source-exposure-projection-v2','oldStudy':{'completedAttempts':3},'newV6DevelopmentQualified':False,'actualAnswersPublished':False,'privateArmMappingPublished':False,'paidPlan':None,'productIds':['B000000001'],'canonicalFamilyTitles':['Prior family'],'sourcePacketFingerprints':[]}
        projection['projectionSha256']=m.seal(projection)
        development={'format':'ablatrix-report-calibration-development-protocol-v1','design':{'actualProducts':2,'freshProducts':0,'caseInstances':8,'instructionVariants':2,'contextsPerInstance':3,'repetitions':2,'maximumNewAttempts':24,'selectedSourceCaseIds':['source-coverage-v2-train-12870','source-coverage-v2-train-13347'],'instructionContracts':['workspace-answer-flat-sources-v1','workspace-answer-uncertainty-v2'],'contexts':{'current':'v5','semantic':'v6','reference':'independent_curated'}}}
        for name,value in [('candidate.json',candidate),('policy.json',policy),('projection.json',projection),('development.json',development)]:
            (root/name).write_text(json.dumps(value))
        return m.contract_artifacts(root,'candidate.json','policy.json','projection.json','development.json')

    def test_freeze_binds_new_policy_candidate_and_full_historical_pathset(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp).resolve();(root/'history.json').write_text(json.dumps({'productId':'B000000010'}));(root/'other.json').write_text(json.dumps({'productId':'B000000011'}))
            contracts=self.fixture_contracts(root)
            with mock.patch.object(m,'CODE',['implementation.py']),mock.patch.object(m,'historical_paths',return_value=['history.json','other.json']):
                output=root/'freeze';m.freeze(root,output,contracts);m.verify_freeze(root,output)
                pending=json.loads((output/'qualification-pending-v2.json').read_text());self.assertEqual(pending['status'],'review_pending');self.assertIsNone(pending['paidPlan'])
                policy=json.loads((root/'policy.json').read_text());policy['prompt']['systemInstructions']+=' changed';policy['prompt']['systemInstructionsSha256']=m.sha(policy['prompt']['systemInstructions']);(root/'policy.json').write_text(json.dumps(policy))
                with self.assertRaisesRegex(ValueError,'raw artifact bytes changed'):m.verify_freeze(root,output)
                (root/'policy.json').write_text(json.dumps(contracts['policy']['document']))
                with mock.patch.object(m,'historical_paths',return_value=['history.json','other.json','additional.json']):
                    (root/'additional.json').write_text(json.dumps({'productId':'B000000012'}))
                    with self.assertRaisesRegex(ValueError,'Complete historical inventory'):m.verify_freeze(root,output)

    def test_candidate_or_development_design_cannot_silently_change_to_v5_or_cherry_picked_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp).resolve();self.fixture_contracts(root)
            candidate=json.loads((root/'candidate.json').read_text());candidate['candidate']['contract']='workspace-semantic-supplement-v5-dev';(root/'candidate.json').write_text(json.dumps(candidate))
            with self.assertRaisesRegex(ValueError,'separately frozen v6'):m.contract_artifacts(root,'candidate.json','policy.json','projection.json','development.json')
            self.fixture_contracts(root)
            development=json.loads((root/'development.json').read_text());development['design']['actualProducts']=3;(root/'development.json').write_text(json.dumps(development))
            with self.assertRaisesRegex(ValueError,'24-answer development design'):m.contract_artifacts(root,'candidate.json','policy.json','projection.json','development.json')

    def test_raw_binding_conflicts_are_never_overwritten(self):
        self.assertEqual(m.merge_bindings({'x.json':'1'*64},{'x.json':'1'*64}),{'x.json':'1'*64})
        with self.assertRaisesRegex(ValueError,'Conflicting duplicate'):m.merge_bindings({'x.json':'1'*64},{'x.json':'2'*64})

if __name__=='__main__':unittest.main()
