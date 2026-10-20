"""Synthetic automatic-review gates only. No fresh source or provider is used."""
import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest import mock


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).with_name(file))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


m = load('fresh_v3_tested', 'prepare-fresh-validation-v3.py')
f2 = load('fresh_v2_fixtures', 'test_prepare_fresh_validation_v2.py')
f1 = load('fresh_v1_fixtures', 'test_prepare_fresh_validation_v1.py')


def artifact(path, document, digest=None):
    return {'path':path,'document':document,'fileSha256':digest or m.sha(json.dumps(document).encode())}


def fixtures():
    verifier = mock.Mock(); verifier.read_bytes.return_value = b'SYNTHETIC automatic verifier'
    code = {m.DEVELOPMENT_VERIFIER:m.sha(verifier.read_bytes())}
    outcome = {'format':'ablatrix-automatic-development-outcome-v1', 'status':'eligible_for_automated_exploratory_fresh_preparation',
               'candidateFreezeFileSha256':'4'*64,'policyFreezeFileSha256':'5'*64,'developmentProtocolFileSha256':'6'*64,
               'verifiedActualCompletedAttempts':24,'automaticReviewComplete':True,'humanSourceCheckedAnswers':0,
               'qualityClaimEligible':False,'newProviderCalls':0}
    o = artifact('outcome.json',outcome,'7'*64)
    frozen = {'protocol':artifact('freeze/protocol-v3.json',{'createdAt':'2026-10-19T00:00:00+00:00'},'1'*64),
              'freeze':artifact('freeze/candidate-policy-freeze-v3.json',{'implementationSha256':code},'2'*64),
              'history':artifact('freeze/history-inventory-v3.json',f2.empty_history(),'3'*64),
              'contracts':{'candidate':{'fileSha256':'4'*64},'policy':{'fileSha256':'5'*64},
                           'development':{'fileSha256':'6'*64},'outcome':o}}
    q = {'format':'ablatrix-fresh-source-access-qualification-v3','status':'reviewed_for_custodian_only',
         'protocolFileSha256':'1'*64,'candidatePolicyFreezeFileSha256':'2'*64,'historyInventoryFileSha256':'3'*64,
         'reviewedImplementationSha256':code,'reviewedAt':'2026-10-19T01:00:00+00:00',
         'provenance':'automated_independent_source_review','freshInputsInspectedBeforeFreeze':False,
         'automaticReviewComplete':True,'humanSourceCheckedAnswers':0,'qualityClaimEligible':False,'activationAuthorized':False,
         'developmentOutcomePath':'outcome.json','developmentOutcomeFileSha256':'7'*64,'paidPlan':None,
         'automaticReviewPolicy':m.AUTOMATIC_REVIEW_POLICY}
    bindings = {frozen[k]['path']:frozen[k]['fileSha256'] for k in ('protocol','freeze','history')}
    bindings['outcome.json']='7'*64
    reviews = review_artifacts('source-access',bindings,q['status'])
    q['independentReviewArtifacts'] = [{'path':r['path'],'fileSha256':r['fileSha256']} for r in reviews[:2]]
    q['adjudicationArtifact'] = {'path':reviews[2]['path'],'fileSha256':reviews[2]['fileSha256']}
    docs = {a['path']:a for a in [o,artifact('access.json',q),*reviews]}
    proof = {'format':'ablatrix-automatic-development-outcome-proof-v1','outcomeFileSha256':'7'*64,
             'verifiedActualCompletedAttempts':24,'automaticReviewComplete':True,'humanSourceCheckedAnswers':0,
             'qualityClaimEligible':False,'newProviderCalls':0,'candidateFreezeFileSha256':'4'*64,'policyFreezeFileSha256':'5'*64,'canonicalActualReceiptsSha256':'c'*64}
    return frozen,docs,proof,verifier


def review_artifacts(stage,bindings,outcome,cases=None):
    result = []
    for i in range(3):
        d = {'format':'ablatrix-automatic-fresh-review-record-v1','reviewStage':stage,'artifactSha256':bindings,
             'reviewer':'SYNTHETIC independent '+str(i),'reviewEvidence':'SYNTHETIC literal source/code checks',
             'provenance':'independent_source_aware_ai' if i<2 else 'independent_source_aware_ai_adjudication',
             'sourceAware':True,'humanSourceCheckedAnswers':0,'qualityClaimEligible':False,'activationAuthorized':False,
             'retainedUncertainty':['SYNTHETIC AI reliability remains uncalibrated'],'providerCalls':0,'paidPlan':None,
             'outcome':outcome}
        if cases is not None:
            d.update(cases=copy.deepcopy(cases),candidateContextInspected=False,answerOutputsInspected=False)
            if i==2:d['caseAdjudications']=[{'caseId':c['caseId'],'independentCaseSha256':[m.seal(a['document']['cases'][j]) for a in result],
                                          'adjudicatedCaseSha256':m.seal(c),'sourceBasedRationale':'SYNTHETIC literal source rationale'} for j,c in enumerate(cases)]
        if i==2:d['independentReviewFileSha256']=[a['fileSha256'] for a in result]
        result.append(artifact('review-'+str(i)+'.json',d))
    return result


def selection_fixture():
    s,b,r=f1.review_inputs()
    b['format']='ablatrix-fresh-validation-baseline-v3';r['format']='ablatrix-fresh-validation-source-review-v3'
    r.update(automaticReviewComplete=True,humanSourceCheckedAnswers=0,qualityClaimEligible=False)
    for case in r['cases']:case['eligibility']='certain'
    # Provide the old protocol's fixed conflict stratum with literal distinct reports.
    decision=s['decisions'][4];c=decision['packet'];extra=f1.sources(999,'SYNTHETIC different report')[0]
    c['sources'].append(extra);c['sourcePoolSha256']=m.sha(m.compact(c['sources']))
    assessed=r['cases'][4];assessed['sourcePoolSha256']=c['sourcePoolSha256'];assessed['tags']=['conflicting_reports']
    assessed['conflictNotes']='SYNTHETIC conditions differ';assessed['referenceSourceIds'].append(extra['id'])
    assessed['designatedFacts'].append({'fact':'SYNTHETIC distinct report','quote':extra['text'],'sourceIds':[extra['id']],
                                        'qualification':'SYNTHETIC separate observation','applicability':'SYNTHETIC same product'})
    r['baselineSha256']=m.seal(b)
    return s,b,r


class AutomaticV3Tests(unittest.TestCase):
    def test_metadata_reads_no_dataset_or_ledger_and_does_not_reseed(self):
        with mock.patch.object(pathlib.Path,'read_bytes',side_effect=AssertionError('no fresh read')):
            value=m.metadata()
        self.assertEqual(m.SEED,m.v2.SEED);self.assertEqual(value['freshInputReads'],0)
        self.assertEqual(value['humanSourceCheckedAnswers'],0);self.assertFalse(value['qualityClaimEligible'])

    def test_pending_source_access_blocks_before_dataset_stat_or_loader_import(self):
        f,_,_,_=fixtures()
        with mock.patch.object(m,'verify_freeze',return_value=f),mock.patch.object(m,'read',return_value={'document':{'status':'review_pending'}}) as reader:
            with self.assertRaisesRegex(ValueError,'fresh source not read'):
                m.custodian(pathlib.Path('/private/tmp'),'freeze','pending.json','DO-NOT-READ.csv','/private/tmp/DO-NOT-CREATE')
        self.assertEqual(reader.call_count,1)

    def test_pending_pool_gate_blocks_before_pool_read(self):
        f,_,_,_=fixtures()
        with mock.patch.object(m,'verify_freeze',return_value=f),mock.patch.object(m,'read',return_value={'document':{'status':'review_pending'}}) as reader:
            with self.assertRaisesRegex(ValueError,'fresh source not read'):m.screen(pathlib.Path('/private/tmp'),'freeze','pending.json','DO-NOT-READ')
        self.assertEqual(reader.call_count,1)

    def test_actual_automatic_proof_and_three_reviews_pass_with_zero_humans(self):
        f,docs,proof,verifier=fixtures()
        with mock.patch.object(m,'read',side_effect=lambda root,path:docs[path]),mock.patch.object(m.v1,'canonical_file',return_value=verifier),mock.patch.object(m.subprocess,'check_output',return_value=json.dumps(proof).encode()) as subprocess_call:
            actual=m.qualification(pathlib.Path('/private/tmp'),f,'access.json')
        self.assertEqual(actual['document']['humanSourceCheckedAnswers'],0)
        self.assertNotIn('newHumanDisagreementsResolved',actual['document'])
        self.assertEqual(subprocess_call.call_args.args[0][-2:],['--verify-outcome','outcome.json'])

    def test_same_byte_outcome_alias_cannot_replace_the_frozen_path(self):
        f,docs,_,_=fixtures()
        docs['access.json']['document']['developmentOutcomePath']='same-byte-alias.json'
        docs['same-byte-alias.json']=artifact('same-byte-alias.json',docs['outcome.json']['document'],'7'*64)
        with mock.patch.object(m,'read',side_effect=lambda root,path:docs[path]) as reader,\
             mock.patch.object(m.subprocess,'check_output') as replay:
            with self.assertRaisesRegex(ValueError,'exact frozen automatic development outcome path'):
                m.qualification(pathlib.Path('/private/tmp'),f,'access.json')
        self.assertEqual([call.args[1] for call in reader.call_args_list],['access.json'])
        replay.assert_not_called()

    def test_forged_boolean_proof_wrong_candidate_human_label_or_missing_verifier_rejects(self):
        changes=[lambda p:p.update(verifiedActualCompletedAttempts=3),lambda p:p.update(format='forged'),
                 lambda p:p.update(candidateFreezeFileSha256='a'*64),lambda p:p.update(policyFreezeFileSha256='a'*64),
                 lambda p:p.update(humanSourceCheckedAnswers=1),lambda p:p.update(qualityClaimEligible=True),
                 lambda p:p.update(automaticReviewComplete=False)]
        for change in changes:
            f,docs,proof,verifier=fixtures();change(proof)
            with self.subTest(change=change),mock.patch.object(m,'read',side_effect=lambda root,path:docs[path]),mock.patch.object(m.v1,'canonical_file',return_value=verifier),mock.patch.object(m.subprocess,'check_output',return_value=json.dumps(proof).encode()),self.assertRaises(ValueError):
                m.qualification(pathlib.Path('/private/tmp'),f,'access.json')
        f,docs,proof,verifier=fixtures()
        with mock.patch.object(m,'read',side_effect=lambda root,path:docs[path]),mock.patch.object(m.v1,'canonical_file',side_effect=FileNotFoundError),self.assertRaises(FileNotFoundError):
            m.qualification(pathlib.Path('/private/tmp'),f,'access.json')

    def test_duplicate_reviewer_or_changed_source_binding_cannot_qualify(self):
        for mutate in [lambda r:r.update(reviewer='SYNTHETIC independent 0'),lambda r:r.update(artifactSha256={}),lambda r:r.update(outcome='unresolved_objection')]:
            f,docs,proof,verifier=fixtures();mutate(docs['review-1.json']['document'])
            with mock.patch.object(m,'read',side_effect=lambda root,path:docs[path]),mock.patch.object(m.v1,'canonical_file',return_value=verifier),mock.patch.object(m.subprocess,'check_output',return_value=json.dumps(proof).encode()),self.assertRaises(ValueError):
                m.qualification(pathlib.Path('/private/tmp'),f,'access.json')

    def test_pool_evidence_is_checked_before_embedded_fresh_pool_is_opened(self):
        f,docs,proof,verifier=fixtures()
        pool_record=m.custodian_document(f2.rows(),f2.empty_history(),f2.split)
        pool_bytes=(json.dumps(pool_record['pool'],ensure_ascii=False,indent=2)+'\n').encode()
        pool_q=copy.deepcopy(docs['access.json']['document'])
        pool_q.update(format='ablatrix-fresh-pool-qualification-v3',status='reviewed_for_source_only_screening',
                      sourceAccessQualificationPath='access.json',sourceAccessQualificationFileSha256=docs['access.json']['fileSha256'],
                      custodianRecordPath='DO-NOT-READ-RECORD.json',custodianRecordFileSha256='d'*64,
                      poolPath='DO-NOT-READ-POOL.json',poolFileSha256=m.sha(pool_bytes),independentReviewArtifacts=[])
        docs['pool-access.json']=artifact('pool-access.json',pool_q)
        read_paths=[]
        def read(root,path):
            read_paths.append(path)
            if path.startswith('DO-NOT-READ'):raise AssertionError('fresh pool opened before its evidence gate')
            return docs[path]
        with mock.patch.object(m,'read',side_effect=read),mock.patch.object(m.v1,'canonical_file',return_value=verifier),mock.patch.object(m.subprocess,'check_output',return_value=json.dumps(proof).encode()),self.assertRaisesRegex(ValueError,'Two actual independent'):
            m.qualification(pathlib.Path('/private/tmp'),f,'pool-access.json','pool')
        self.assertNotIn('DO-NOT-READ-RECORD.json',read_paths)

    def test_separate_pool_qualification_binds_actual_finite_record_and_pool_bytes(self):
        f,docs,proof,verifier=fixtures();record=m.custodian_document(f2.rows(),f2.empty_history(),f2.split)
        custodian=artifact('custodian.json',record);docs[custodian['path']]=custodian
        pool_bytes=(json.dumps(record['pool'],ensure_ascii=False,indent=2)+'\n').encode()
        q=copy.deepcopy(docs['access.json']['document'])
        q.update(format='ablatrix-fresh-pool-qualification-v3',status='reviewed_for_source_only_screening',
                 sourceAccessQualificationPath='access.json',sourceAccessQualificationFileSha256=docs['access.json']['fileSha256'],
                 custodianRecordPath='custodian.json',custodianRecordFileSha256=custodian['fileSha256'],
                 poolPath='pool.json',poolFileSha256=m.sha(pool_bytes))
        bindings={f[k]['path']:f[k]['fileSha256'] for k in ('protocol','freeze','history')}
        bindings.update({'outcome.json':'7'*64,'access.json':docs['access.json']['fileSha256'],'custodian.json':custodian['fileSha256'],'pool.json':m.sha(pool_bytes)})
        records=review_artifacts('pool',bindings,q['status'])
        for i,a in enumerate(records):a['path']='pool-review-'+str(i)+'.json';docs[a['path']]=a
        q['independentReviewArtifacts']=[{k:a[k] for k in ('path','fileSha256')} for a in records[:2]]
        q['adjudicationArtifact']={k:records[-1][k] for k in ('path','fileSha256')}
        docs['pool-access.json']=artifact('pool-access.json',q)
        with mock.patch.object(m,'read',side_effect=lambda root,path:docs[path]),mock.patch.object(m.v1,'canonical_file',return_value=verifier),mock.patch.object(m.subprocess,'check_output',return_value=json.dumps(proof).encode()):
            m.qualification(pathlib.Path('/private/tmp'),f,'pool-access.json','pool')
            record['decisions'].pop()
            with self.assertRaises(ValueError):m.qualification(pathlib.Path('/private/tmp'),f,'pool-access.json','pool')

    def test_old_outcome_assertions_never_substitute_for_new_receipt_review_verifier(self):
        f,docs,proof,verifier=fixtures();docs['outcome.json']['document']['format']='ablatrix-v6-development-outcome-qualification-v1'
        with mock.patch.object(m,'read',side_effect=lambda root,path:docs[path]),mock.patch.object(m.subprocess,'check_output') as call,self.assertRaises(ValueError):
            m.qualification(pathlib.Path('/private/tmp'),f,'access.json')
        call.assert_not_called()

    def test_finite_custodian_retains_order_and_every_rejection_without_answers(self):
        a=m.custodian_document(f2.rows(),f2.empty_history(),f2.split)
        b=m.custodian_document(list(reversed(f2.rows())),f2.empty_history(),f2.split)
        self.assertEqual(a,b);self.assertEqual(len(a['decisions']),256);self.assertEqual(len(a['pool']['cases']),24)
        self.assertNotIn('MUST-NOT-ENTER',json.dumps(a));self.assertIsNone(a['stopReason'])
        old=m.v2.custodian_document(f2.rows(),f2.empty_history(),f2.split)
        self.assertEqual(a['pool'],old['pool'])
        self.assertEqual([{k:v for k,v in d.items() if k!='inspectedExposure'} for d in a['decisions']],old['decisions'])

    def test_rejected_body_scope_remains_protected_and_conditions_are_intact(self):
        rows=f2.rows()
        for row in rows:row['candidate']='SYNTHETIC one shared body; manually stopped before exhaustion.'
        result=m.custodian_document(rows,f2.empty_history(),f2.split)
        self.assertEqual(result['stopReason'],'insufficient_fixed_pool_without_replacement');self.assertEqual(len(result['decisions']),256)
        self.assertEqual(len(result['pool']['cases']),1)
        self.assertIn('manually stopped',result['pool']['cases'][0]['sources'][0]['text'])
        row=f2.rows()[0]
        a=m.source_pool([row],lambda r:(r['candidate'],'Model AA-1?'))
        b=m.source_pool([row],lambda r:(r['candidate'],'Model AA-2?'))
        self.assertNotEqual(m.v1.scoped_fingerprint(a[0]),m.v1.scoped_fingerprint(b[0]))

    def test_uncertain_nonquota_row_is_retained_and_cannot_be_selected(self):
        s,b,r=selection_fixture();r['cases'][5].update(eligibility='uncertain',uncertaintyNotes='SYNTHETIC ambiguous applicability')
        result=m.select_document(s,b,r,m.seal(b),m.seal(r))
        self.assertIsNone(result['stopReason']);self.assertEqual(result['selectedDenominator'],8)
        self.assertNotIn(r['cases'][5]['caseId'],result['selectedCaseIds'])
        self.assertEqual(len(result['screenedCaseIds']),24);self.assertEqual(result['uncertainEligibilityCaseIds'],[r['cases'][5]['caseId']])
        self.assertNotEqual(r['cases'][5].get('status'),'excluded_by_disjointness')

    def test_uncertain_rows_still_require_complete_context_and_literal_source_semantics(self):
        changes=[('missing_context',lambda c:c.pop('baselineContextSha256')),
                 ('wrong_context',lambda c:c.update(baselineContextSha256='0'*64)),
                 ('missing_references',lambda c:c.pop('referenceSourceIds')),
                 ('wrong_reference',lambda c:c.update(referenceSourceIds=['SYNTHETIC absent source'])),
                 ('missing_facts',lambda c:c.pop('designatedFacts')),
                 ('wrong_quote',lambda c:c['designatedFacts'][0].update(quote='SYNTHETIC quote absent from literal source')),
                 ('missing_tags',lambda c:c.pop('tags'))]
        for name,change in changes:
            s,b,r=selection_fixture()
            assessed=r['cases'][5]
            assessed.update(eligibility='uncertain',uncertaintyNotes='SYNTHETIC unresolved applicability retained')
            change(assessed)
            with self.subTest(change=name),self.assertRaises(ValueError):
                m.select_document(s,b,r,m.seal(b),m.seal(r))

    def test_uncertain_gap_does_not_fill_gap_quota_or_allow_replacement(self):
        s,b,r=selection_fixture();r['cases'][0].update(eligibility='uncertain',uncertaintyNotes='SYNTHETIC gap uncertain')
        result=m.select_document(s,b,r,m.seal(b),m.seal(r))
        self.assertEqual(result['stopReason'],'source_only_minima_unsatisfied');self.assertEqual(result['missingMinima']['supported_gap'],1)
        self.assertNotIn(r['cases'][0]['caseId'],result['selectedCaseIds']);self.assertFalse(result['qualityClaimEligible'])

    def test_same_body_under_different_cqa_scope_is_a_true_body_duplicate(self):
        rows=f2.rows()
        for row in rows:row['candidate']='SYNTHETIC same body'
        result=m.custodian_document(rows,f2.empty_history(),lambda r:(r['candidate'],'Question '+r['qid']))
        self.assertEqual(len(result['pool']['cases']),1)
        self.assertTrue(any('body_without_original_question' in str(d['reasons']) for d in result['decisions']))

    def test_oversized_rejected_packet_exposes_its_other_parent_before_rejection(self):
        rows=f2.rows()
        ranked=sorted(rows,key=lambda r:(m.sha(m.compact([m.SEED,r['ASIN'],r['qid']])),r['ASIN'],r['qid']))
        first,second=ranked[:2];first['candidate']='X'*1501
        second['candidate']='SYNTHETIC parent already inspected in a rejected product'
        extra={**first,'candidate':second['candidate'],'row':9000}
        result=m.custodian_document([*rows,extra],f2.empty_history(),f2.split)
        first_decision=next(d for d in result['decisions'] if d['qid']==first['qid'])
        second_decision=next(d for d in result['decisions'] if d['qid']==second['qid'])
        self.assertFalse(first_decision['eligible']);self.assertFalse(second_decision['eligible'])
        self.assertIn('body_without_original_question',str(second_decision['reasons']))
        self.assertEqual(len(result['decisions']),256)
        self.assertEqual(first_decision['inspectedExposure']['sourceParentsInspected'],2)
        self.assertIn(m.body_fingerprint({'text':second['candidate']}),first_decision['inspectedExposure']['sourceBodyFingerprints'])

    def test_parse_failure_retains_all_viewed_literal_bodies_and_model_aliases(self):
        rows=f2.rows();ranked=sorted(rows,key=lambda r:(m.sha(m.compact([m.SEED,r['ASIN'],r['qid']])),r['ASIN'],r['qid']))
        ranked[0]['candidate']='SYNTHETIC raw model ZXZZ-998877 ambiguous context'
        def parse(row):
            if row['qid']==ranked[0]['qid']:raise ValueError('ambiguous_cqa_context')
            return row['candidate'],None
        result=m.custodian_document(rows,f2.empty_history(),parse)
        decision=next(d for d in result['decisions'] if d['qid']==ranked[0]['qid'])
        self.assertFalse(decision['eligible']);self.assertEqual(decision['inspectedExposure']['unparsedRawCandidateCount'],1)
        self.assertIn('zxzz998877',decision['inspectedExposure']['modelIdentifiers'])
        self.assertIn(m.body_fingerprint({'text':ranked[0]['candidate']}),decision['inspectedExposure']['sourceBodyFingerprints'])

    def test_source_eligibility_two_reviews_and_adjudicator_bind_all24_and_candidate_blindness(self):
        s,b,r=selection_fixture();sa,ba=artifact('screening.json',s),artifact('baseline.json',b)
        bindings={a['path']:a['fileSha256'] for a in [sa,ba]};r['baselineSha256']=ba['fileSha256']
        records=review_artifacts('source-eligibility',bindings,'source_review_complete',r['cases'])
        r.update(automaticReviewPolicy=m.AUTOMATIC_REVIEW_POLICY,
                 independentReviewArtifacts=[{k:a[k] for k in ('path','fileSha256')} for a in records[:2]],
                 adjudicationArtifact={k:records[-1][k] for k in ('path','fileSha256')})
        docs={a['path']:a for a in records}
        with mock.patch.object(m,'read',side_effect=lambda root,path:docs[path]):
            self.assertEqual(len(m.verify_source_review(pathlib.Path('/private/tmp'),sa,ba,artifact('review.json',r))),3)
            records[0]['document']['cases'].pop()
            with self.assertRaisesRegex(ValueError,'every ordered'):m.verify_source_review(pathlib.Path('/private/tmp'),sa,ba,artifact('review.json',r))

    def test_independent_source_review_requires_full_semantics_and_row_specific_adjudication(self):
        for incomplete in ('sourceScopeReviewed','caseAdjudications'):
            s,b,r=selection_fixture();sa,ba=artifact('screening.json',s),artifact('baseline.json',b);r['baselineSha256']=ba['fileSha256']
            records=review_artifacts('source-eligibility',{a['path']:a['fileSha256'] for a in [sa,ba]},'source_review_complete',r['cases'])
            if incomplete=='caseAdjudications':records[-1]['document'].pop(incomplete)
            else:records[0]['document']['cases'][0].pop(incomplete)
            r.update(automaticReviewPolicy=m.AUTOMATIC_REVIEW_POLICY,
                     independentReviewArtifacts=[{k:a[k] for k in ('path','fileSha256')} for a in records[:2]],
                     adjudicationArtifact={k:records[-1][k] for k in ('path','fileSha256')})
            docs={a['path']:a for a in records}
            with mock.patch.object(m,'read',side_effect=lambda root,path:docs[path]),self.assertRaises(ValueError):
                m.verify_source_review(pathlib.Path('/private/tmp'),sa,ba,artifact('review.json',r))

    def test_freeze_requires_new_direct_user_amendment_and_pins_outcome(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp).resolve();f2.V2Tests().fixture_contracts(root)
            projection=json.loads((root/'projection.json').read_text());projection['sourceBodyFingerprints']=['b'*64];projection['additionalFingerprintForms']=['literal_body_nfkc_casefold_v1']
            projection.pop('projectionSha256');projection['projectionSha256']=m.seal(projection);(root/'projection.json').write_text(json.dumps(projection))
            base=m.v2.contract_artifacts(root,'candidate.json','policy.json','projection.json','development.json')
            outcome={'candidateFreezeFileSha256':base['candidate']['fileSha256'],'policyFreezeFileSha256':base['policy']['fileSha256'],'developmentProtocolFileSha256':base['development']['fileSha256']}
            (root/'outcome.json').write_text(json.dumps(outcome))
            amendment={'format':'ablatrix-automatic-fresh-decision-amendment-v1','authorizedBy':'direct_user_instruction','createdAt':'2026-10-19T01:00:00+00:00',
                       'comparison':{'control':'v5','candidate':'v6','sharedGenerationContract':'workspace-answer-uncertainty-v2'},
                       'diagnosticInstructionContracts':['workspace-answer-flat-sources-v1','workspace-answer-uncertainty-v2'],
                       'automaticReviewPolicy':m.AUTOMATIC_REVIEW_POLICY,'humanSourceCheckedAnswers':0,'qualityClaimEligible':False,'activationAuthorized':False,
                       'freshInputsInspectedBeforeAmendment':False,'paidPlan':None,'developmentOutcomePath':'outcome.json','developmentOutcomeFileSha256':m.sha((root/'outcome.json').read_bytes())}
            (root/'amendment.json').write_text(json.dumps(amendment))
            contracts=m.contract_artifacts(root,'candidate.json','policy.json','projection.json','development.json','amendment.json')
            (root/'history.json').write_text(json.dumps({'productId':'B000000010'}))
            with mock.patch.object(m,'CODE',['implementation.py']),mock.patch.object(m,'historical_paths',return_value=['history.json']):
                m.freeze(root,root/'freeze',contracts);m.verify_freeze(root,root/'freeze')
                protocol=json.loads((root/'freeze/protocol-v3.json').read_text())
                self.assertFalse(protocol['humanReviewRequired']);self.assertEqual(protocol['sharedPromptContract'],'workspace-answer-uncertainty-v2')
                amendment['qualityClaimEligible']=True;(root/'amendment.json').write_text(json.dumps(amendment))
                with self.assertRaisesRegex(ValueError,'human calibration'):m.verify_freeze(root,root/'freeze')


if __name__=='__main__':unittest.main()
