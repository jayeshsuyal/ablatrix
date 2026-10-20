#!/usr/bin/env python3
"""Automatic, source-aware prospective v3. No human-review or paid-call gate bypass.

Old versions are immutable. Independent AI assessments stay provisional; this
version records a direct-user-authorized decision amendment before fresh access.
"""
import argparse
import collections
import datetime
import importlib.util
import json
import pathlib
import re
import sqlite3
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fresh_v2_readonly', ROOT/'scripts/prepare-fresh-validation-v2.py')
v2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v2)
v1 = v2.v1
sha, seal, compact, read, require = v2.sha, v2.seal, v2.compact, v2.read, v2.require
SOURCE = v2.SOURCE
EVIDENCE = 'docs/evidence/automatic-fresh-v3-2026-10-19'
SEED = v2.SEED  # Preserve the preregistered unread finite source experiment; no reseed.
DEVELOPMENT_VERIFIER = 'scripts/automatic-source-review-v1.ts'
CODE = ['scripts/prepare-fresh-validation-v3.py', 'scripts/prepare-fresh-validation-v2.py',
        'scripts/prepare-fresh-validation-v1.py', 'scripts/fresh-validation-contexts-v3.ts',
        'scripts/source-packet-disjointness.py', 'scripts/prepare-correction-cohort.py',
        'scripts/prepare-flat-source-cohort.py', 'scripts/prepare-source-id-cohort.py',
        DEVELOPMENT_VERIFIER, 'package.json', 'package-lock.json']
AUTOMATIC_REVIEW_POLICY = {'independentSourceAwareReviewers': 2, 'sourceAwareAdjudicators': 1,
                           'irreducibleUncertainty': 'retain_and_report'}
# Reused helpers have no mutable protocol globals and consume explicit inputs.
source_pool = v2.source_pool
merge_bindings = v2.merge_bindings


def metadata():
    return {'format': 'ablatrix-fresh-v3-source-custodian-metadata-v1', 'source': SOURCE,
            'sourceOnlyColumns': ['qid', 'question', 'ASIN', 'candidate', 'source', 'qa_pair_id', 'title'],
            'automaticReviewPolicy': AUTOMATIC_REVIEW_POLICY, 'humanSourceCheckedAnswers': 0,
            'qualityClaimEligible': False, 'activationAuthorized': False,
            'freshInputReads': 0, 'providerCalls': 0, 'paidPlan': None,
            'note': 'Prior pinned source metadata only. The new frozen automatic outcome/code/source-access gate precedes every dataset or pool path access. AI assessments are not human calibration.'}


def historical_paths(root):
    raw = subprocess.check_output(['git','ls-files','-z','docs/evidence','data/product-qa'], cwd=root, stderr=subprocess.PIPE)
    paths = sorted(p for p in raw.decode().split('\0') if p.endswith('.json') and not p.startswith(EVIDENCE+'/'))
    require(v1.REQUIRED_HISTORY <= set(paths), 'The complete tracked historical manifest must retain all old exposed studies and source bundles.')
    # v1 excluded its own prospective freeze. For a new protocol that old v1/v2
    # directory is historical input too; do not silently omit its audited IDs.
    return paths


def body_fingerprint(source):
    """A real body-only fingerprint; unlike historical hashes, no CQA scope."""
    return sha(compact([v1.norm(source['text'])]))


def history_body_fingerprints(root, paths):
    values = set()
    def walk(value):
        if isinstance(value, list):
            for child in value: walk(child)
        elif isinstance(value, dict):
            if isinstance(value.get('sourceBodyFingerprints'), list):
                require(all(isinstance(x,str) and v1.DIGEST.fullmatch(x) for x in value['sourceBodyFingerprints']), 'Historical body-only fingerprints must be SHA256 values.')
                values.update(value['sourceBodyFingerprints'])
            if isinstance(value.get('text'), str) and value['text'] and any(k in value for k in ('source','label','originalQuestion')):
                values.add(body_fingerprint(value))
            if isinstance(value.get('utf8'), str) and isinstance(value.get('sha256'), str):
                require(sha(value['utf8']) == value['sha256'], 'Historical embedded artifact raw hash mismatch.')
                if value['utf8'].lstrip().startswith(('{','[')): walk(json.loads(value['utf8']))
            for key, child in value.items():
                if key != 'utf8': walk(child)
    for name in paths: walk(read(root,name)['document'])
    return values


def protected_inventory(root, projection):
    paths = historical_paths(root)
    base = v1.inventory(root, paths)
    document = {**base, 'format':'ablatrix-v6-protected-history-inventory-v3', 'oldLiveProjectionFileSha256':projection['fileSha256']}
    prior = projection['document']
    for key in ('productIds','canonicalFamilyTitles','modelIdentifiers','sourcePacketFingerprints'):
        document[key] = sorted(set(document[key]) | set(prior[key]))
    document['sourceBodyFingerprints'] = sorted(history_body_fingerprints(root,paths) | set(prior['sourceBodyFingerprints']))
    document['sourceFingerprintForms'] = ['historical_body_and_original_question_v1','nfkc_body_and_original_question_v1','literal_body_nfkc_casefold_v1']
    document.pop('inventorySha256',None); document['inventorySha256'] = seal(document)
    return document


def protected_sets(document):
    values = v2.protected_sets(document); values['bodies'] = set(document.get('sourceBodyFingerprints',[]))
    return values


def protection_reasons(case, history):
    reasons, identifiers, fingerprints = v2.protection_reasons(case, history)
    if {body_fingerprint(s) for s in case['sources']} & history['bodies']:
        reasons.append('historical_or_prior_body_without_original_question')
    return reasons, identifiers, fingerprints


def extend_protection(history, case, identifiers, fingerprints):
    v2.extend_protection(history,case,identifiers,fingerprints)
    history['bodies'].update(body_fingerprint(s) for s in case['sources'])


def contract_artifacts(root, candidate_path, policy_path, projection_path, development_protocol_path, amendment_path):
    # Old contract validation is reused without modifying its globals or bytes.
    contracts = v2.contract_artifacts(root, candidate_path, policy_path, projection_path, development_protocol_path)
    prior = contracts['projection']['document']
    require(isinstance(prior.get('sourceBodyFingerprints'),list) and prior['sourceBodyFingerprints']
            and all(isinstance(x,str) and v1.DIGEST.fullmatch(x) for x in prior['sourceBodyFingerprints'])
            and prior.get('additionalFingerprintForms') == ['literal_body_nfkc_casefold_v1'],
            'The new exposure projection must add real body-only protection without changing historical scoped fingerprints.')
    amendment = read(root, amendment_path); d = amendment['document']
    require(d.get('format') == 'ablatrix-automatic-fresh-decision-amendment-v1' and d.get('authorizedBy') == 'direct_user_instruction'
            and ('authorizationText' not in d or isinstance(d['authorizationText'], str) and bool(d['authorizationText'].strip())),
            'Bind the direct user instruction in a new decision amendment; old human gates remain unchanged.')
    created = datetime.datetime.fromisoformat(d['createdAt'])
    require(created.tzinfo is not None, 'Decision amendment requires a timezone-aware date.')
    require(d.get('comparison') == {'control':'v5','candidate':'v6','sharedGenerationContract':'workspace-answer-uncertainty-v2'}
            and d.get('diagnosticInstructionContracts') == ['workspace-answer-flat-sources-v1','workspace-answer-uncertainty-v2'],
            'Fresh comparison must isolate v6 versus v5 under the same uncertainty policy and retain flat-policy interaction diagnostics.')
    require(d.get('automaticReviewPolicy') == AUTOMATIC_REVIEW_POLICY and d.get('humanSourceCheckedAnswers') == 0
            and d.get('qualityClaimEligible') is False and d.get('activationAuthorized') is False
            and d.get('freshInputsInspectedBeforeAmendment') is False and d.get('paidPlan') is None,
            'Automatic source review must retain uncertainty without claiming human calibration, promotion or spending approval.')
    outcome = read(root, d['developmentOutcomePath'])
    require(outcome['fileSha256'] == d.get('developmentOutcomeFileSha256'), 'Decision amendment must bind the actual automatic development outcome bytes.')
    for field, contract in [('candidateFreezeFileSha256','candidate'),('policyFreezeFileSha256','policy'),('developmentProtocolFileSha256','development')]:
        require(outcome['document'].get(field) == contracts[contract]['fileSha256'], 'Automatic outcome applies to different candidate, policy or development protocol.')
    contracts['amendment'] = amendment
    contracts['outcome'] = outcome
    return contracts


def protocol_fields(contracts):
    return {'format': 'ablatrix-fresh-validation-protocol-v3', 'seed': SEED,
            'candidate': contracts['candidate']['document']['candidate'],
            'candidateFreezeFileSha256': contracts['candidate']['fileSha256'],
            'sharedPromptContract': 'workspace-answer-uncertainty-v2', 'sharedPolicy': contracts['policy']['document']['prompt'], 'policyFreezeFileSha256': contracts['policy']['fileSha256'],
            'old3ExposureProjectionFileSha256': contracts['projection']['fileSha256'],
            'newDevelopmentProtocolFileSha256': contracts['development']['fileSha256'],
            'decisionAmendmentFileSha256': contracts['amendment']['fileSha256'],
            'automaticDevelopmentOutcomeFileSha256': contracts['outcome']['fileSha256'],
            'automaticReviewPolicy': AUTOMATIC_REVIEW_POLICY, 'humanReviewRequired': False,
            'humanSourceCheckedAnswers': 0, 'activationAuthorized': False,
            'eligibilityUncertainty': 'Retain uncertain rows; unresolved gap/control/conflict/insufficiency tags cannot fill strata. No favorable adjudication by default.',
            'screeningDenominator': 24, 'selectedDenominator': 8, 'minima': v1.MINIMA,
            'custodian': {'source': SOURCE, 'maximumQuestionCandidates': 256, 'poolPackets': 24,
                          'rank': 'SHA256 compact [seed,ASIN,qid] then ASIN/qid; retain finite candidate prefix and every rejection; accept first24 disjoint eligible product packets, stop without replacement if insufficient.',
                          'sourceConstruction': 'Complete literal parents, original CQA question separate; exact source/body/scope deduplication, max128 parents/product and1500 UTF16 units/body; reject rather than truncate or split conditions.',
                          'eligibility': 'Only pinned source fields; stable question identity/consumer bounds; historical and within-prefix product/family/model/body-plus-question protection. No source-gap, model score, answer or quality label used.'},
            'sourceProtection': 'Historical and within-prefix true body-only plus body-and-original-question hashes; every inspected rejected parent/model/family stays exposed, including oversized/count-overflow packets.',
            'screeningOrder': 'SHA256 compact [seed,product.id,question,sourcePoolSha256], then case.id',
            'sourceReviewBeforeCandidate': True, 'candidateSuccessFiltering': False, 'allScreenedRowsRetained': True,
            'sourceContexts': {'current':'frozen_v5_control','semantic':'frozen_v6_candidate','reference':'independent_curated'},
            'baselinePreparation': 'Save original index baseline separately; the independently reviewed experimental baseline is frozen v5 on all24 packets. Score v5 with cached model before source review; do not compute v6 selections until fixed8 eligibility. Reuse only exact query/document-bound savedv5 logits for v6; no extra inference or success filtering.',
            'generation': {'policyAcrossArms': 'Exact same workspace-answer-uncertainty-v2 prompt and generic frozen policy in current/v6/reference; vary only literal context and derived operation/source identities.',
                           'attribution': 'Shared policy does not make old3 receipts evidence of v6/policy gain; development ablation evaluates retrieval and policy separately.'},
            'stop': 'Any missing frozen automatic-development/code/source/pool/context gate, fewer24 disjoint packets, unsatisfied source-only strata, candidate replay failure or no source benefit stops. No reseeding, replacement, paid retry or automatic activation.',
            'freshPaidGate': 'Actual new24 canonical receipts, two independent source-aware AI reviews and a third source-aware adjudicator under the newly frozen decision amendment; retain irreducible uncertainty and flat-policy negative interactions. Exact fresh source/code/context review, refreshed canonical ledger and separate exact financial approval. Human review is not a prerequisite; quality claims and activation remain unauthorized.',
            'providerCalls': 0, 'paidPlan': None, 'qualityClaimEligible': False}


def implementation(root, contracts):
    paths = set(CODE)
    if (root/DEVELOPMENT_VERIFIER).is_file(): paths.add(DEVELOPMENT_VERIFIER)
    for item in contracts.values():
        for field in ('codeSha256', 'implementationSha256'):
            values = item['document'].get(field, {})
            require(isinstance(values, dict), 'Frozen code map must be a map.')
            for p, expected in values.items():
                require(sha(v1.canonical_file(root, p).read_bytes()) == expected, 'New candidate/policy/development frozen code changed: '+p)
                paths.add(p)
    for item in contracts.values():
        for p, expected in item['document'].get('inputSha256', {}).items():
            require(p.startswith(('docs/evidence/','data/product-qa/')), 'Prospective input freezes may bind only saved public development artifacts, never credentials or an unread dataset.')
            require(sha(v1.canonical_file(root,p).read_bytes()) == expected, 'Frozen development input changed: '+p)
    pending = list(paths)
    while pending:
        name = pending.pop()
        if not name.endswith('.ts'): continue
        file = v1.canonical_file(root, name)
        for imported in re.findall(r"(?:from\s*|import\s*(?:\(\s*)?)[\"'](\.{1,2}/[^\"']+)[\"']", file.read_text()):
            target = (file.parent/imported).resolve(strict=True)
            require(root in target.parents, 'New frozen implementation import escapes the repository.')
            relative = target.relative_to(root).as_posix(); v1.canonical_file(root, relative)
            if relative not in paths: paths.add(relative); pending.append(relative)
    return {p: sha(v1.canonical_file(root, p).read_bytes()) for p in sorted(paths)}


def freeze(root, directory, contracts):
    directory = pathlib.Path(directory)
    require(directory.is_absolute() and not directory.exists() and directory.parent.resolve(strict=True) == directory.parent, 'Use a new canonical versioned freeze directory.')
    history = protected_inventory(root, contracts['projection']); code = implementation(root, contracts)
    created = datetime.datetime.now(datetime.timezone.utc).isoformat()
    protocol = {**protocol_fields(contracts), 'createdAt': created, 'contracts': {k: {'path': v['path'], 'fileSha256': v['fileSha256']} for k,v in contracts.items()}, 'implementationSha256': code, 'historyInventorySha256': history['inventorySha256']}
    protocol['protocolSha256'] = seal(protocol)
    directory.mkdir()
    v1.write_new(directory/'history-inventory-v3.json', history); v1.write_new(directory/'protocol-v3.json', protocol)
    frozen = {'format': 'ablatrix-fresh-candidate-policy-freeze-v3', 'protocolFileSha256': sha((directory/'protocol-v3.json').read_bytes()),
              'historyInventoryFileSha256': sha((directory/'history-inventory-v3.json').read_bytes()), 'implementationSha256': code,
              'candidateFreezeFileSha256': contracts['candidate']['fileSha256'], 'policyFreezeFileSha256': contracts['policy']['fileSha256'],
              'freshInputReads': 0, 'providerCalls': 0, 'paidPlan': None}
    v1.write_new(directory/'candidate-policy-freeze-v3.json', frozen)
    pending = {'format': 'ablatrix-fresh-source-access-qualification-v3', 'status': 'review_pending',
               'protocolFileSha256': frozen['protocolFileSha256'], 'candidatePolicyFreezeFileSha256': sha((directory/'candidate-policy-freeze-v3.json').read_bytes()),
               'historyInventoryFileSha256': frozen['historyInventoryFileSha256'], 'automaticReviewComplete': False, 'humanSourceCheckedAnswers': 0, 'qualityClaimEligible': False,
               'poolFileSha256': None, 'freshInputReads': 0, 'providerCalls': 0, 'paidPlan': None}
    v1.write_new(directory/'qualification-pending-v3.json', pending)
    return {'mode': 'frozen_v6_policy_prospective_no_fresh_reads', 'directory': str(directory), 'source': SOURCE, 'freshInputReads': 0, 'providerCalls': 0, 'paidPlan': None, 'stopReason': 'automatic_development_code_and_source_review_pending'}


def verify_freeze(root, directory):
    directory = pathlib.Path(directory)
    if not directory.is_absolute(): directory = root/directory
    rel = directory.relative_to(root).as_posix()
    p, f, h = [read(root, rel+'/'+name) for name in ('protocol-v3.json', 'candidate-policy-freeze-v3.json', 'history-inventory-v3.json')]
    protocol, frozen, history = p['document'], f['document'], h['document']
    descriptors = protocol['contracts']
    contracts = contract_artifacts(root, *(descriptors[k]['path'] for k in ('candidate', 'policy', 'projection', 'development', 'amendment')))
    require(all(contracts[k]['fileSha256'] == v['fileSha256'] for k,v in descriptors.items()), 'Candidate/policy/exposure/development raw artifact bytes changed.')
    body = dict(protocol); digest = body.pop('protocolSha256', None)
    require(digest == seal(body) and all(protocol.get(k) == v for k,v in protocol_fields(contracts).items()), 'New prospective protocol changed.')
    require(frozen.get('format') == 'ablatrix-fresh-candidate-policy-freeze-v3' and frozen.get('protocolFileSha256') == p['fileSha256'] and frozen.get('historyInventoryFileSha256') == h['fileSha256'], 'New protocol/history/freeze raw bindings differ.')
    require(frozen['candidateFreezeFileSha256'] == contracts['candidate']['fileSha256'] and frozen['policyFreezeFileSha256'] == contracts['policy']['fileSha256'], 'New candidate or shared policy binding changed.')
    require(implementation(root, contracts) == frozen['implementationSha256'] == protocol['implementationSha256'], 'New prospectively frozen implementation changed.')
    require(protected_inventory(root, contracts['projection']) == history and protocol['historyInventorySha256'] == history['inventorySha256'], 'Complete historical inventory omitted/changed an old artifact or scoped source.')
    return {'protocol': p, 'freeze': f, 'history': h, 'contracts': contracts}


def automatic_review_evidence(root, document, stage, bindings):
    """Check exact independent review/adjudication records, never a bare bool.

    These records are transparent AI judgments, not cryptographic proof of an
    agent's identity or human calibration. Named, separately authored records and
    their complete literal-source assessments remain available for audit.
    """
    require(document.get('automaticReviewPolicy') == AUTOMATIC_REVIEW_POLICY,
            'Require the preregistered two independent reviews plus third adjudicator.')
    refs = document.get('independentReviewArtifacts')
    adjudicator = document.get('adjudicationArtifact')
    require(isinstance(refs, list) and len(refs) == 2 and isinstance(adjudicator, dict),
            'Two actual independent review artifacts and a third adjudication artifact are required.')
    records, names, paths, digests = [], [], [], []
    for index, descriptor in enumerate([*refs, adjudicator]):
        artifact = read(root, descriptor['path'])
        require(artifact['fileSha256'] == descriptor.get('fileSha256'), 'Automatic source review artifact changed.')
        r = artifact['document']
        require(r.get('format') == 'ablatrix-automatic-fresh-review-record-v1'
                and r.get('reviewStage') == stage and r.get('artifactSha256') == bindings,
                'Automatic review must bind the exact source/code/artifact scope for its stage.')
        provenance = 'independent_source_aware_ai' if index < 2 else 'independent_source_aware_ai_adjudication'
        require(r.get('provenance') == provenance and isinstance(r.get('reviewer'), str) and r['reviewer'].strip()
                and isinstance(r.get('reviewEvidence'), str) and r['reviewEvidence'].strip(),
                'Independently named source-aware AI review and evidence are required.')
        require(r.get('sourceAware') is True and r.get('humanSourceCheckedAnswers') == 0
                and r.get('qualityClaimEligible') is False and r.get('activationAuthorized') is False
                and isinstance(r.get('retainedUncertainty'), list) and r.get('providerCalls') == 0
                and r.get('paidPlan') is None, 'AI source review must retain uncertainty and honest scope.')
        if index == 2:
            require(r.get('independentReviewFileSha256') == [a['fileSha256'] for a in refs],
                    'Third adjudicator must bind both independent review bytes in order.')
        names.append(r['reviewer'].strip()); paths.append(artifact['path']); digests.append(artifact['fileSha256']); records.append(r)
    require(len(set(names)) == len(set(paths)) == len(set(digests)) == 3,
            'Reviews and adjudication must be three distinct named artifacts.')
    return records


def qualification(root, frozen, path, kind='source-access'):
    q = read(root, path); d = q['document']
    expected = 'ablatrix-fresh-source-access-qualification-v3' if kind == 'source-access' else 'ablatrix-fresh-pool-qualification-v3'
    status = 'reviewed_for_custodian_only' if kind == 'source-access' else 'reviewed_for_source_only_screening'
    # This entire gate precedes even stat/open/hash of the dataset or finite pool.
    require(d.get('format') == expected and d.get('status') == status,
            'Pending automatic development/code/source qualification; fresh source not read.')
    bindings = {}
    for field, key in [('protocolFileSha256','protocol'), ('candidatePolicyFreezeFileSha256','freeze'), ('historyInventoryFileSha256','history')]:
        require(d.get(field) == frozen[key]['fileSha256'], 'Source qualification must bind exact protocol/candidate/policy/history bytes.')
        bindings[frozen[key]['path']] = frozen[key]['fileSha256']
    require(d.get('automaticReviewComplete') is True and d.get('humanSourceCheckedAnswers') == 0
            and d.get('qualityClaimEligible') is False and d.get('activationAuthorized') is False,
            'Automatic review must not manufacture human review or quality/promotion eligibility.')
    require(d.get('reviewedImplementationSha256') == frozen['freeze']['document']['implementationSha256'],
            'Source-access review must bind the whole actual frozen implementation.')
    reviewed = datetime.datetime.fromisoformat(d['reviewedAt'])
    require(reviewed.tzinfo is not None and reviewed >= datetime.datetime.fromisoformat(frozen['protocol']['document']['createdAt']),
            'Source qualification review must postdate the prospective freeze.')
    require(d.get('provenance') == 'automated_independent_source_review' and d.get('freshInputsInspectedBeforeFreeze') is False
            and d.get('paidPlan') is None, 'Automatic source qualification cannot conceal early exposure or approve spending.')
    require(d.get('developmentOutcomePath') == frozen['contracts']['outcome']['path'],
            'Source qualification must use the exact frozen automatic development outcome path.')
    outcome = read(root, d['developmentOutcomePath'])
    require(outcome['fileSha256'] == d.get('developmentOutcomeFileSha256') == frozen['contracts']['outcome']['fileSha256'],
            'Exact automatic new-development outcome bytes changed.')
    result = outcome['document']
    require(result.get('format') == 'ablatrix-automatic-development-outcome-v1'
            and result.get('status') == 'eligible_for_automated_exploratory_fresh_preparation',
            'Old3 or source-delivery-only results cannot qualify the new automatic development outcome.')
    for field, contract in [('candidateFreezeFileSha256','candidate'),('policyFreezeFileSha256','policy'),('developmentProtocolFileSha256','development')]:
        require(result.get(field) == frozen['contracts'][contract]['fileSha256'], 'Automatic outcome is for a different candidate/policy/development design.')
    require(result.get('verifiedActualCompletedAttempts') == 24 and result.get('automaticReviewComplete') is True
            and result.get('humanSourceCheckedAnswers') == 0 and result.get('qualityClaimEligible') is False
            and result.get('newProviderCalls') == 0, 'Actual24 source-aware automatic review is required without relabeling AI as human.')
    verifier = v1.canonical_file(root, DEVELOPMENT_VERIFIER)
    require(DEVELOPMENT_VERIFIER in frozen['freeze']['document']['implementationSha256'], 'Automatic development verifier absent from frozen implementation.')
    require(sha(verifier.read_bytes()) == frozen['freeze']['document']['implementationSha256'][DEVELOPMENT_VERIFIER], 'Automatic development verifier changed.')
    verified = json.loads(subprocess.check_output(['node', '--import', 'tsx', DEVELOPMENT_VERIFIER, '--verify-outcome', d['developmentOutcomePath']],
                                                 cwd=root, stderr=subprocess.PIPE, timeout=60))
    require(verified.get('format') == 'ablatrix-automatic-development-outcome-proof-v1'
            and verified.get('outcomeFileSha256') == outcome['fileSha256'] and verified.get('verifiedActualCompletedAttempts') == 24
            and verified.get('automaticReviewComplete') is True and verified.get('humanSourceCheckedAnswers') == 0
            and verified.get('qualityClaimEligible') is False and verified.get('newProviderCalls') == 0
            and isinstance(verified.get('canonicalActualReceiptsSha256'),str) and v1.DIGEST.fullmatch(verified['canonicalActualReceiptsSha256']),
            'Actual canonical receipts/source reviews/adjudication failed frozen automatic verification.')
    for field, contract in [('candidateFreezeFileSha256','candidate'),('policyFreezeFileSha256','policy')]:
        require(verified.get(field) == frozen['contracts'][contract]['fileSha256'], 'Verified automatic outcome candidate/policy binding differs.')
    bindings[outcome['path']] = outcome['fileSha256']
    if kind == 'pool':
        require(v1.DIGEST.fullmatch(d.get('poolFileSha256','')), 'One exact finite pool byte commitment is required.')
        access = qualification(root, frozen, d['sourceAccessQualificationPath'])
        require(access['fileSha256'] == d.get('sourceAccessQualificationFileSha256'), 'Separate source-access qualification changed.')
        require(v1.DIGEST.fullmatch(d.get('custodianRecordFileSha256','')), 'Exact custodian record commitment is required.')
        bindings[access['path']] = access['fileSha256']
        bindings[d['custodianRecordPath']] = d['custodianRecordFileSha256']
        bindings[d['poolPath']] = d['poolFileSha256']
        records = automatic_review_evidence(root, d, kind, bindings)
        require(all(r.get('outcome') == status for r in records), 'An automatic review retained an unresolved pool/code objection.')
        # The evidence gate completes BEFORE opening the custodian record, which
        # itself embeds the fresh source pool. Claimed hashes are checked below.
        record = read(root,d['custodianRecordPath'])
        require(record['fileSha256'] == d.get('custodianRecordFileSha256'), 'Exact finite custodian record changed.')
        c = record['document']; body = dict(c); digest = body.pop('custodianSha256',None)
        require(c.get('format') == 'ablatrix-v6-source-custodian-record-v3' and c.get('source') == SOURCE and c.get('seed') == SEED
                and c.get('finiteQuestionDenominator') == 256 and c.get('screeningPacketDenominator') == 24
                and c.get('stopReason') is None and digest == seal(body), 'Finite custodian provenance/denominator changed.')
        require(len(c.get('decisions',[])) == 256 and c.get('modelOutputsUsed') is False
                and c.get('answerColumnsUsed') is False and c.get('candidateContextInspected') is False,
                'A different or outcome-filtered source pool cannot qualify.')
        expected_bytes = (json.dumps(c['pool'],ensure_ascii=False,indent=2)+'\n').encode()
        require(sha(expected_bytes) == d['poolFileSha256'], 'Pool-byte commitment must be the actual fixed custodian output.')
    else:
        records = automatic_review_evidence(root, d, kind, bindings)
        require(all(r.get('outcome') == status for r in records), 'An automatic review retained an unresolved source/code objection.')
    return q


def custodian_document(rows, history_document, split_context):
    """Deterministic finite source-only producer; fixtures may inject rows."""
    allowed = ('qid','question','ASIN','candidate','source','qa_pair_id','title','row')
    rows = [{k:r[k] for k in allowed} for r in rows]  # outcomes cannot enter ranking
    products, questions = collections.defaultdict(list), {}
    inconsistent = set()
    for row in rows:
        products[row['ASIN']].append(row)
        previous = questions.setdefault(row['qid'], row)
        if any(previous[k] != row[k] for k in ('ASIN','title','question')): inconsistent.add(row['qid'])
    ordered = sorted(questions.values(), key=lambda r:(sha(compact([SEED,r['ASIN'],r['qid']])),r['ASIN'],r['qid']))[:256]
    require(len(ordered) == 256, 'The frozen256-question finite prefix is unavailable; stop without enlarging or reseeding.')
    protections = protected_sets(history_document); seen_products = set(); cases, decisions = [], []
    for row in ordered:
        pid = row['ASIN']; decision = {'productId': pid, 'qid': row['qid'], 'rankSha256': sha(compact([SEED,pid,row['qid']])), 'sourceInspected': False, 'eligible': False, 'reasons': []}
        if len(cases) == 24:
            decision['reasons'] = ['finite_pool_already_fixed_not_source_inspected']; decisions.append(decision); continue
        try:
            require(pid not in seen_products, 'duplicate_product_in_finite_prefix'); seen_products.add(pid)
            require(v1.ASIN.fullmatch(pid) and re.fullmatch(r'[A-Za-z0-9_-]{1,90}',row['qid']) and row['qid'] not in inconsistent and 8 <= len(row['question'].strip()) <= 300, 'unsupported_or_inconsistent_question_identity')
            require(3 <= len(row['title'].strip()) <= 160 and all(r['title'].strip() == row['title'].strip() for r in products[pid]), 'inconsistent_or_unbounded_product_title')
            # Prior source-only consumer exclusions, without learned strata or
            # candidate outputs. The protocol's later independent source review
            # determines gap/control/conflict/insufficiency eligibility.
            require(not re.search(r'\b(?:medical|dosage|prescription|pregnan|baby formula|infant formula|suicide|firearm|ammunition|legal advice)\b', row['title']+' '+row['question'], re.I), 'outside_consumer_protocol_scope')
            decision['sourceInspected'] = True
            # Every parsed complete parent becomes exposed even if a later
            # length/count/identity bound rejects this product. No clipping.
            literal_sources, scope_errors = [], []
            for source_row in products[pid]:
                try: body, original = split_context(source_row)
                except ValueError as error:
                    # Failed parsing does not make the already viewed literal
                    # candidate/model aliases disappear from exposure history.
                    body, original = source_row['candidate'].strip(), None
                    scope_errors.append(str(error))
                literal_sources.append({'text':body,'originalQuestion':original})
            inspected = {'product':{'id':pid,'title':row['title']},'question':row['question'],'sources':literal_sources}
            reasons, ids, fps = protection_reasons(inspected, protections)
            extend_protection(protections, inspected, ids, fps)
            decision['inspectedExposure'] = {'productIds':[pid],'canonicalFamilyTitles':[v1.family(row['title'])],
                'modelIdentifiers':sorted(ids),'sourcePacketFingerprints':sorted(fps),
                'sourceBodyFingerprints':sorted({body_fingerprint(s) for s in literal_sources}),
                'sourceParentsInspected':len(literal_sources),'unparsedRawCandidateCount':len(scope_errors)}
            require(not scope_errors, 'source_scope_parse_failed:'+ '|'.join(scope_errors))
            sources = source_pool(products[pid], split_context)
            case = {'id':'fresh-v6-train-'+row['qid'],'product':{'id':pid,'title':row['title'].strip()},'question':row['question'].strip(),'sources':sources,'sourcePoolSha256':sha(compact(sources))}
            require(not reasons, '|'.join(reasons))
            decision['eligible'] = True; cases.append(case)
        except ValueError as error: decision['reasons'] = [str(error)]
        decisions.append(decision)
    pool = {'format':'ablatrix-fresh-source-only-pool-v1','cases':cases}
    body = {'format':'ablatrix-v6-source-custodian-record-v3','source':SOURCE,'seed':SEED,'finiteQuestionDenominator':256,'screeningPacketDenominator':len(cases),'decisions':decisions,
            'stopReason':None if len(cases)==24 else 'insufficient_fixed_pool_without_replacement','pool':pool,
            'modelOutputsUsed':False,'answerColumnsUsed':False,'candidateContextInspected':False,'providerCalls':0,'paidPlan':None}
    return {**body,'custodianSha256':seal(body)}


def custodian(root, directory, access_path, train_path, output_directory):
    frozen = verify_freeze(root, directory); access = qualification(root, frozen, access_path)
    # DO NOT move any path access/loader import above qualification.
    require(str(pathlib.Path(train_path)) == SOURCE['localPath'], 'Use only the reviewed existing pinned local train path.')
    spec = importlib.util.spec_from_file_location('source_only_flat_custodian', root/'scripts/prepare-flat-source-cohort.py')
    flat = importlib.util.module_from_spec(spec); spec.loader.exec_module(flat)
    source_path = pathlib.Path(train_path)
    require(source_path.is_file() and not source_path.is_symlink() and source_path.resolve(strict=True) == source_path, 'Pinned CSV must be a canonical regular file; no symlink source.')
    rows = flat.load_rows(train_path)
    result = custodian_document(rows, frozen['history']['document'], flat.legacy.split_context)
    destination = pathlib.Path(output_directory)
    require(destination.is_absolute() and not destination.exists() and destination.parent.resolve(strict=True)==destination.parent, 'Use a new canonical private custodian directory; no resume/replacement.')
    destination.mkdir(mode=0o700)
    v1.write_new(destination/'custodian-record-v3.json', result)
    if result['stopReason'] is None:
        v1.source_cases(result['pool']); v1.write_new(destination/'pool-v3.json', result['pool'])
    return {'mode':'source_only_custodian','screeningPackets':len(result['pool']['cases']),'stopReason':result['stopReason'],'freshInputReads':1,'providerCalls':0,'paidPlan':None,'poolContentInspectedByModel':False,'sourceAccessQualificationFileSha256':access['fileSha256']}


def screening(pool, frozen, q):
    cases = v1.source_cases(pool['document']); protections = protected_sets(frozen['history']['document'])
    ordered = sorted(cases,key=lambda c:(sha(compact([SEED,c['product']['id'],c['question'],c['sourcePoolSha256']])),c['id']))
    overlaps = v1.packet.verify(ordered); overlap_ids = {r['caseId'] for r in overlaps['overlaps']}
    decisions=[]
    for case in ordered:
        reasons,ids,fps=protection_reasons(case,protections)
        if case['id'] in overlap_ids: reasons.append('within_deck_packet_guard')
        decisions.append({'caseId':case['id'],'eligible':not reasons,'reasons':reasons,'packet':case})
        extend_protection(protections,case,ids,fps)
    body={'format':'ablatrix-fresh-validation-screening-v3','screeningDenominator':24,'poolFileSha256':pool['fileSha256'],'protocolFileSha256':frozen['protocol']['fileSha256'],
          'candidatePolicyFreezeFileSha256':frozen['freeze']['fileSha256'],'historyInventoryFileSha256':frozen['history']['fileSha256'],'qualificationFileSha256':q['fileSha256'],
          'acceptedCaseIds':[r['caseId'] for r in decisions if r['eligible']],'decisions':decisions,'packetGuard':overlaps,
          'candidateContextInspected':False,'generatedAnswersInspected':False,'providerCalls':0,'paidPlan':None,'paidExecutionAuthorized':False}
    return {**body,'screeningSha256':seal(body)}


def screen(root,directory,qualification_path,pool_path):
    return load_screening(root,directory,qualification_path,pool_path)[3]


def load_screening(root,directory,qualification_path,pool_path,saved_path=None):
    frozen=verify_freeze(root,directory); q=qualification(root,frozen,qualification_path,'pool')
    require(pool_path == q['document']['poolPath'], 'Use the exact independently committed pool path; no replacement.')
    pool=read(root,pool_path)
    require(pool['fileSha256']==q['document']['poolFileSha256'],'Finite pool commitment changed; no replacement.')
    document=screening(pool,frozen,q)
    saved=read(root,saved_path) if saved_path else None
    if saved: require(saved['document']==document,'Saved v3 screening cannot reproduce exact reviewed raw inputs.')
    artifacts=[frozen['protocol'],frozen['freeze'],frozen['history'],*frozen['contracts'].values(),q,pool,*([saved] if saved else [])]
    bindings=merge_bindings(*({a['path']:a['fileSha256']} for a in artifacts))
    return frozen,q,pool,document,bindings


def verify_source_review(root, screening_artifact, baseline_artifact, review_artifact):
    review = review_artifact['document']; screening_document = screening_artifact['document']
    require(review.get('provenance') == 'independent_source_review_ai' and review.get('automaticReviewComplete') is True
            and review.get('humanSourceCheckedAnswers') == 0 and review.get('qualityClaimEligible') is False,
            'Automatic full-source eligibility review remains provisional AI evidence.')
    bindings = {a['path']:a['fileSha256'] for a in (screening_artifact, baseline_artifact)}
    records = automatic_review_evidence(root, review, 'source-eligibility', bindings)
    expected_ids = [row['caseId'] for row in screening_document['decisions']]
    for record in records:
        require([c.get('caseId') for c in record.get('cases',[])] == expected_ids,
                'Both source reviewers and adjudicator must retain every ordered screened row.')
        require(record.get('candidateContextInspected') is False and record.get('answerOutputsInspected') is False,
                'Source eligibility must precede candidate selections and answer outputs.')
        for assessed, decision in zip(record['cases'], screening_document['decisions']):
            require(assessed.get('sourcePoolSha256') == decision['packet']['sourcePoolSha256'],
                    'Each independent source review must bind the literal complete source pool.')
    require(records[-1]['cases'] == review.get('cases'), 'Aggregate eligibility must be the actual third adjudicator assessment.')
    for record in records:
        assessed_review = {**review,'reviewer':record['reviewer'],'cases':record['cases']}
        select_document(screening_document,baseline_artifact['document'],assessed_review,baseline_artifact['fileSha256'],review_artifact['fileSha256'])
    adjudication = records[-1].get('caseAdjudications',[])
    require([a.get('caseId') for a in adjudication] == expected_ids, 'Adjudicator must retain a decision and source-based reason for every row.')
    for index, final_case in enumerate(records[-1]['cases']):
        rationale = adjudication[index]
        require(isinstance(rationale.get('sourceBasedRationale'),str) and rationale['sourceBasedRationale'].strip()
                and rationale.get('independentCaseSha256') == [seal(r['cases'][index]) for r in records[:2]]
                and rationale.get('adjudicatedCaseSha256') == seal(final_case),
                'Each adjudication must bind both full independent assessments, the final row and its source-based reason.')
    return {artifact['path']:artifact['fileSha256'] for artifact in [read(root,r['path']) for r in [*review['independentReviewArtifacts'],review['adjudicationArtifact']]]}


def select_document(screening_document,baseline,review,baseline_sha,review_sha):
    require(baseline.get('format')=='ablatrix-fresh-validation-baseline-v3' and review.get('format')=='ablatrix-fresh-validation-source-review-v3',
            'Require separately versioned baseline and automatic source review.')
    require(review.get('automaticReviewComplete') is True and review.get('humanSourceCheckedAnswers') == 0
            and review.get('qualityClaimEligible') is False, 'AI source eligibility cannot masquerade as calibrated human review.')
    ids = [r['caseId'] for r in screening_document['decisions']]
    require([r.get('caseId') for r in review.get('cases',[])] == ids, 'Retain every ordered source-only review row.')
    by_review = {r['caseId']:r for r in review['cases']}
    uncertain = []
    for decision in screening_document['decisions']:
        assessed = by_review[decision['caseId']]
        require(assessed.get('sourcePoolSha256') == decision['packet']['sourcePoolSha256'], 'Source review pool binding changed.')
        if decision['eligible']:
            require(assessed.get('eligibility') in {'certain','uncertain'}, 'Automatic eligibility certainty must be explicit.')
            if assessed['eligibility'] == 'uncertain':
                require(isinstance(assessed.get('uncertaintyNotes'),str) and assessed['uncertaintyNotes'].strip(),
                        'Irreducible eligibility uncertainty needs an explicit retained reason.')
                for field in ('sourceScopeReviewed','originalQuestionsReviewed','familySeparationReviewed','titleAndBaselineReviewed','referenceSufficiencyReviewed'):
                    require(assessed.get(field) is True, 'Uncertain source eligibility still requires a complete literal-source review: '+field)
                require(isinstance(assessed.get('unknowns'),list) and isinstance(assessed.get('applicabilityNotes'),str) and assessed['applicabilityNotes'].strip(),
                        'Uncertain rows must retain applicable unknowns and scope, not a bare uncertainty flag.')
                uncertain.append(decision['caseId'])
    # Validate every accepted row's context, references, literal facts and source
    # logic before eligibility uncertainty removes it from quota consideration.
    # The original validator skips excluded rows, so validating only the quota
    # projection would permit incomplete uncertain assessments to escape review.
    if uncertain:
        v1.finalize_document(screening_document,
                             {**baseline,'format':'ablatrix-fresh-validation-baseline-v1'},
                             {**review,'format':'ablatrix-fresh-validation-source-review-v1'},
                             baseline_sha,review_sha)
    # Explicit local projections exclude uncertain rows from quota eligibility.
    # Saved v3 records retain their true status and complete source assessments.
    decisions = [{**d,'eligible':False} if d['caseId'] in uncertain else dict(d) for d in screening_document['decisions']]
    old_screening = {**screening_document,'decisions':decisions}
    old_baseline = {**baseline,'format':'ablatrix-fresh-validation-baseline-v1',
                    'results':[r for r in baseline['results'] if r['caseId'] not in uncertain]}
    old_review = {**review,'format':'ablatrix-fresh-validation-source-review-v1',
                  'cases':[{**r,'status':'excluded_by_disjointness'} if r['caseId'] in uncertain else dict(r) for r in review['cases']]}
    result = v1.finalize_document(old_screening,old_baseline,old_review,baseline_sha,review_sha)
    result['format'] = 'ablatrix-fresh-validation-selection-v3'
    result['uncertainEligibilityCaseIds'] = uncertain
    result['uncertainEligibilityRetained'] = [{'caseId':cid,'reason':by_review[cid]['uncertaintyNotes']} for cid in uncertain]
    result['automaticReviewComplete'] = True; result['humanSourceCheckedAnswers'] = 0; result['qualityClaimEligible'] = False
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__); sub=parser.add_subparsers(dest='mode',required=True)
    sub.add_parser('metadata')
    freeze_parser=sub.add_parser('freeze')
    for flag in ('candidate','policy','exposure-projection','development-protocol','decision-amendment','out-dir'):freeze_parser.add_argument('--'+flag,required=True)
    verify=sub.add_parser('verify');verify.add_argument('--freeze-dir',required=True)
    c=sub.add_parser('custodian')
    for flag in ('freeze-dir','source-access','train','out-dir'):c.add_argument('--'+flag,required=True)
    s=sub.add_parser('screen')
    for flag in ('freeze-dir','qualification','pool','out'):s.add_argument('--'+flag,required=True)
    for mode in ('verify-screen','select'):
        p=sub.add_parser(mode)
        for flag in ('freeze-dir','qualification','pool','screening'):p.add_argument('--'+flag,required=True)
        if mode=='select':
            for flag in ('baseline','review','out'):p.add_argument('--'+flag,required=True)
    args=parser.parse_args()
    try:
        if args.mode=='metadata':result=metadata()
        elif args.mode=='freeze':result=freeze(ROOT,args.out_dir,contract_artifacts(ROOT,args.candidate,args.policy,args.exposure_projection,args.development_protocol,args.decision_amendment))
        elif args.mode=='verify':
            f=verify_freeze(ROOT,args.freeze_dir);result={'mode':'verified_v6_policy_prospective_no_fresh_reads','freshInputReads':0,'providerCalls':0,'paidPlan':None,'candidatePolicyFreezeFileSha256':f['freeze']['fileSha256']}
        elif args.mode=='custodian':result=custodian(ROOT,args.freeze_dir,args.source_access,args.train,args.out_dir)
        else:
            frozen,q,pool,document,bindings=load_screening(ROOT,args.freeze_dir,args.qualification,args.pool,getattr(args,'screening',None))
            result=document
            if args.mode=='select':
                baseline,review=read(ROOT,args.baseline),read(ROOT,args.review)
                proof=json.loads(subprocess.check_output(['node','--import','tsx','scripts/fresh-validation-contexts-v3.ts','--verify-baseline','--freeze-dir',args.freeze_dir,'--qualification',args.qualification,'--pool',args.pool,'--screening',args.screening,'--baseline',args.baseline],cwd=ROOT,stderr=subprocess.PIPE))
                require(proof.get('baselineFileSha256')==baseline['fileSha256'] and proof.get('screeningFileSha256')==bindings[args.screening],'Parsed baseline/screening snapshots changed during genuine saved-stage replay.')
                review_bindings=verify_source_review(ROOT,read(ROOT,args.screening),baseline,review)
                result=select_document(document,baseline['document'],review['document'],baseline['fileSha256'],review['fileSha256'])
                bindings=merge_bindings(bindings,{baseline['path']:baseline['fileSha256'],review['path']:review['fileSha256']},review_bindings)
                result['artifactSha256']=bindings;result['selectionSha256']=seal(result)
            if args.mode in {'screen','select'}:v1.write_new(pathlib.Path(args.out),result)
            result={'mode':args.mode,'screeningDenominator':24,'accepted':len(document['acceptedCaseIds']),'stopReason':result.get('stopReason'),'artifactSha256':bindings,'providerCalls':0,'paidPlan':None}
        print(json.dumps(result,indent=2))
    except (ValueError,KeyError,TypeError,OSError,sqlite3.Error,subprocess.CalledProcessError,subprocess.TimeoutExpired) as error:parser.exit(1,'Freshv3 preparation stopped: '+str(error)+'\n')

if __name__=='__main__':main()
