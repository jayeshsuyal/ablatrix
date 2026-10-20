#!/usr/bin/env python3
"""Versioned v6/policy prospective preparation. No provider/credential/env path.

Existing v1 code and evidence are imported read-only. No fresh source is read by
metadata, capture-exposure, freeze, verify or pending qualification commands.
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
spec = importlib.util.spec_from_file_location('fresh_v1_readonly', ROOT/'scripts/prepare-fresh-validation-v1.py')
v1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v1)
sha, seal, compact, read = v1.sha, v1.seal, v1.compact, v1.read
EVIDENCE = 'docs/evidence/fresh-product-v6-2026-10-19'
SEED = 'ablatrix-fresh-product-v6-uncertainty-v2-2026-10-19-v1'
CANONICAL_LEDGER = '/Users/jayeshsuyal/Documents/ChatGPT/Ablatrix/repo/.data/feedback-budget.sqlite'
SOURCE = {'localPath': '/Users/jayeshsuyal/Documents/ChatGPT/Ablatrix/repo/work/epqa/train.csv',
          'url': 'https://raw.githubusercontent.com/amazon-science/contextual-product-qa/cec976cc2f2218aa76e562ecc9c7d79f1f3271bc/ePQA/train.csv',
          'sha256': 'b63de9681b770573240367e919f7f04f087f6a4745ab1f79a77e6b800105ea25',
          'commit': 'cec976cc2f2218aa76e562ecc9c7d79f1f3271bc', 'license': 'CDLA-Sharing-1.0', 'split': 'train', 'testSplitUsed': False}
CODE = ['scripts/prepare-fresh-validation-v2.py', 'scripts/prepare-fresh-validation-v1.py', 'scripts/fresh-validation-contexts-v2.ts',
        'scripts/source-packet-disjointness.py', 'scripts/prepare-correction-cohort.py',
        'scripts/prepare-flat-source-cohort.py', 'scripts/prepare-source-id-cohort.py', 'package.json', 'package-lock.json']
DEVELOPMENT_VERIFIER = 'scripts/qualify-report-calibration-v1.ts'


def require(condition, message):
    if not condition: raise ValueError(message)


def artifact_external(path, jsonl=False):
    path = pathlib.Path(path)
    require(path.is_absolute() and path.is_file() and not path.is_symlink() and path.resolve(strict=True) == path,
            'Use an explicitly selected canonical old-study regular file.')
    raw = path.read_bytes()
    return {'fileSha256': sha(raw), 'document': json.loads(raw.decode().strip().split('\n')[-1]) if jsonl else json.loads(raw)}


def metadata():
    return {'format': 'ablatrix-fresh-v2-source-custodian-metadata-v1', 'source': SOURCE,
            'sourceOnlyColumns': ['qid', 'question', 'ASIN', 'candidate', 'source', 'qa_pair_id', 'title'],
            'reusedHelpers': ['scripts/prepare-flat-source-cohort.py:load_rows', 'scripts/prepare-correction-cohort.py:split_context'],
            'freshInputReads': 0, 'providerCalls': 0, 'paidPlan': None,
            'note': 'Path/SHA are prior pinned metadata, not a fresh read or a new checksum verification. Code, human/new-development and source-access gates precede the custodian read; separate exact pool-byte review precedes screening.'}


def ledger_rows():
    # Read-only canonical ledger; never create an empty checkout-local ledger.
    database = sqlite3.connect('file:'+CANONICAL_LEDGER+'?mode=ro', uri=True)
    database.row_factory = sqlite3.Row
    try:
        rows = [dict(row) for row in database.execute('SELECT * FROM loop_provider_calls ORDER BY created_at,id')]
        pending = sum(row['status'] == 'pending' for row in rows)
        owners = database.execute('SELECT COUNT(*) FROM loop_provider_owner').fetchone()[0]
        return rows, {'attempts': len(rows), 'reservedUsd': round(sum(row['allowance_usd'] for row in rows), 6), 'priorAdjustmentUsd': .200281, 'pending': pending, 'owners': owners}
    finally: database.close()


def exposure_projection(plan, checkpoint, evaluation_report, rows, summary):
    """Source-free projection of the OLD3, never a v6 quality qualification."""
    p, c, report = plan['document'], checkpoint['document'], evaluation_report['document']
    diagnostic = p['diagnostic']['document']
    require(sha(compact({k:v for k,v in p.items() if k!='sha256'}))==p.get('sha256') and sha(compact(diagnostic))==p['diagnostic'].get('sha256'), 'Old plan and diagnostic checksum mismatch; preserve exact frozen old records.')
    require(summary['attempts'] >= 141 and summary['pending'] == 0 and summary['owners'] == 0, 'Use the actual completed canonical ledger, without pending attempts/owners.')
    require(diagnostic['scope'] == 'exposed_development_only' and c['provenance'] == 'live_router' and len(c['steps']) == 3,
            'Only the existing completed three-arm development study may seed this projection.')
    require(c['planSha256'] == p['diagnostic']['sha256'] and report['transportProvenance'] == 'live_router' and report['scope'] == 'exposed_development_only' and report['denominator'] == {'plannedAnswers':3,'completed':3,'failedOrUnknown':0,'unattempted':0}, 'Old plan/checkpoint/report identity mismatch.')
    selected = []
    for index, step in enumerate(c['steps']):
        slot = diagnostic['slots'][index]
        matches = [r for r in rows if r['run_id'] == slot['input']['runId']]
        require(len(matches) == 1 and step.get('receipt') and step['receipt']['status'] == 'completed', 'All old3 receipts must exist, completed, once in the actual canonical ledger.')
        row = matches[0]
        require(row['id'] == step['attemptId'] and row['status'] == 'completed', 'Old attempt identity mismatch.')
        for key in ('id', 'kind', 'status', 'model', 'input_tokens', 'output_tokens', 'allowance_usd', 'receipt_json', 'error_code'):
            require(row.get(key) == step['receipt'].get(key), 'Old canonical receipt differs from saved old study.')
        receipt_body=json.loads(row['receipt_json'])
        for key,value in slot.get('binding',{}).items(): require(receipt_body.get(key)==value,'Old request binding differs from canonical receipt.')
        selected.append(row)
    cases = diagnostic['preparation']['cases']
    unresolved = [{'label': r['label'], 'axes': r['disagreementAxes']} for r in report['focusedReview'] if r['disagreementAxes'] and not r['humanSourceChecked']]
    body = {'format': 'ablatrix-old3-source-exposure-projection-v2',
            'provenance': 'canonical_local_old3_receipt_occurrence_and_saved_report_projection',
            'oldStudy': {'planFileSha256': plan['fileSha256'], 'checkpointFileSha256': checkpoint['fileSha256'], 'evaluationReportFileSha256': evaluation_report['fileSha256'],
                         'planSha256': p['sha256'], 'diagnosticPlanSha256': p['diagnostic']['sha256'], 'completedAttempts': 3,
                         'canonicalReceiptRowsSha256': seal(selected), 'canonicalRunIdHashes': sorted(sha(r['run_id']) for r in selected)},
            'ledgerAtProjection': summary,
            'caseIds': [case['id'] for case in cases], 'productIds': sorted(case['product']['id'] for case in cases),
            'canonicalFamilyTitles': sorted(v1.family(case['product']['title']) for case in cases),
            'modelIdentifiers': sorted({model for case in cases for model in v1.models(case['product']['title']+' '+case['question']+' '+' '.join(source['text']+' '+(source.get('originalQuestion') or '') for source in case['completeSources']))}),
            'sourcePacketFingerprints': sorted({fingerprint for case in cases for source in case['completeSources'] for fingerprint in (v1.packet.fingerprint(source),v1.scoped_fingerprint(source))}),
            'sourceFingerprintForms': ['body_v1','body_and_original_question_v1'],
            'sourcePoolSha256': sorted(sha(compact(case['completeSources'])) for case in cases),
            'humanSourceCheckedOldAnswers': report['humanSourceCheckedActualAnswers'], 'unresolvedHumanAxes': unresolved,
            'humanGatePassed': not unresolved, 'newV6DevelopmentQualified': False,
            'actualAnswersPublished': False, 'privateArmMappingPublished': False, 'qualityClaimEligible': False, 'paidPlan': None}
    return {**body, 'projectionSha256': seal(body)}


def historical_paths(root):
    raw = subprocess.check_output(['git','ls-files','-z','docs/evidence','data/product-qa'], cwd=root, stderr=subprocess.PIPE)
    paths = sorted(p for p in raw.decode().split('\0') if p.endswith('.json') and not p.startswith(EVIDENCE+'/'))
    require(v1.REQUIRED_HISTORY <= set(paths), 'The complete tracked historical manifest must retain all old exposed studies and source bundles.')
    # v1 excluded its own prospective freeze. For a new protocol that old v1/v2
    # directory is historical input too; do not silently omit its audited IDs.
    return paths


def protected_inventory(root, projection):
    base = v1.inventory(root, historical_paths(root))
    document = {**base, 'format': 'ablatrix-v6-protected-history-inventory-v2',
                'oldLiveProjectionFileSha256': projection['fileSha256']}
    prior = projection['document']
    for key in ('productIds', 'canonicalFamilyTitles', 'modelIdentifiers', 'sourcePacketFingerprints'):
        document[key] = sorted(set(document[key]) | set(prior[key]))
    document.pop('inventorySha256', None)
    document['inventorySha256'] = seal(document)
    return document


def contract_artifacts(root, candidate_path, policy_path, projection_path, development_protocol_path):
    candidate, policy, projection, development = [read(root, p) for p in (candidate_path, policy_path, projection_path, development_protocol_path)]
    descriptor = candidate['document'].get('candidate')
    require(isinstance(descriptor, dict) and descriptor.get('contract') == 'workspace-semantic-supplement-v6-quantified-peer-dev', 'Require the exact separately frozen v6 candidate descriptor.')
    policy_document=policy['document'];prompt=policy_document.get('prompt',{})
    require(policy_document.get('contract')=='workspace-answer-uncertainty-v2' and prompt.get('contract')=='workspace-answer-uncertainty-v2' and isinstance(prompt.get('systemInstructions'),str) and len(prompt['systemInstructions'])>=40,
            'Require the separately frozen generic uncertainty prompt, not the old live-plan policy.')
    require(prompt.get('systemInstructionsSha256')==sha(prompt['systemInstructions']) and not v1.ASIN.search(prompt['systemInstructions'].upper()), 'Shared prompt must match exact generic instruction bytes, without development identifiers.')
    require(candidate['document'].get('policyPath')==policy_path, 'Candidate and generic prompt freezes must bind one exact policy artifact.')
    old = projection['document']
    require(old.get('format') == 'ablatrix-old3-source-exposure-projection-v2' and old.get('oldStudy', {}).get('completedAttempts') == 3 and old.get('newV6DevelopmentQualified') is False,
            'The old3 exposure projection cannot become v6 evidence.')
    require(old.get('actualAnswersPublished') is False and old.get('privateArmMappingPublished') is False and old.get('paidPlan') is None,
            'Only source-free old-study metadata may enter the public freeze.')
    require(isinstance(old.get('modelIdentifiers'),list) and all(isinstance(m,str) and m for m in old['modelIdentifiers']) and old.get('sourceFingerprintForms')==['body_v1','body_and_original_question_v1'],
            'Old private exposure must retain model identifiers and both body-only/original-question-scoped fingerprints.')
    body = dict(old); digest = body.pop('projectionSha256', None)
    require(digest == seal(body), 'Old exposure projection seal mismatch.')
    design = development['document']
    required_design = {'actualProducts':2,'freshProducts':0,'caseInstances':8,'instructionVariants':2,'contextsPerInstance':3,'repetitions':2,'maximumNewAttempts':24,
                       'selectedSourceCaseIds':['source-coverage-v2-train-12870','source-coverage-v2-train-13347'],
                       'instructionContracts':['workspace-answer-flat-sources-v1','workspace-answer-uncertainty-v2'],
                       'contexts':{'current':'v5','semantic':'v6','reference':'independent_curated'}}
    require(design.get('format') == 'ablatrix-report-calibration-development-protocol-v1' and isinstance(design.get('design'),dict) and all(design['design'].get(k)==v for k,v in required_design.items()),
            'Bind the reviewed exposed2 ×2prompt ×2rep ×3context24-answer development design; no answers are run here.')
    return {'candidate': candidate, 'policy': policy, 'projection': projection, 'development': development}


def protocol_fields(contracts):
    return {'format': 'ablatrix-fresh-validation-protocol-v2', 'seed': SEED,
            'candidate': contracts['candidate']['document']['candidate'],
            'candidateFreezeFileSha256': contracts['candidate']['fileSha256'],
            'sharedPromptContract': 'workspace-answer-uncertainty-v2', 'sharedPolicy': contracts['policy']['document']['prompt'], 'policyFreezeFileSha256': contracts['policy']['fileSha256'],
            'old3ExposureProjectionFileSha256': contracts['projection']['fileSha256'],
            'newDevelopmentProtocolFileSha256': contracts['development']['fileSha256'],
            'screeningDenominator': 24, 'selectedDenominator': 8, 'minima': v1.MINIMA,
            'custodian': {'source': SOURCE, 'maximumQuestionCandidates': 256, 'poolPackets': 24,
                          'rank': 'SHA256 compact [seed,ASIN,qid] then ASIN/qid; retain finite candidate prefix and every rejection; accept first24 disjoint eligible product packets, stop without replacement if insufficient.',
                          'sourceConstruction': 'Complete literal parents, original CQA question separate; exact source/body/scope deduplication, max128 parents/product and1500 UTF16 units/body; reject rather than truncate or split conditions.',
                          'eligibility': 'Only pinned source fields; stable question identity/consumer bounds; historical and within-prefix product/family/model/body-plus-question protection. No source-gap, model score, answer or quality label used.'},
            'screeningOrder': 'SHA256 compact [seed,product.id,question,sourcePoolSha256], then case.id',
            'sourceReviewBeforeCandidate': True, 'candidateSuccessFiltering': False, 'allScreenedRowsRetained': True,
            'sourceContexts': {'current':'frozen_v5_control','semantic':'frozen_v6_candidate','reference':'independent_curated'},
            'baselinePreparation': 'Save original index baseline separately; the independently reviewed experimental baseline is frozen v5 on all24 packets. Score v5 with cached model before source review; do not compute v6 selections until fixed8 eligibility. Reuse only exact query/document-bound savedv5 logits for v6; no extra inference or success filtering.',
            'generation': {'policyAcrossArms': 'Exact same workspace-answer-uncertainty-v2 prompt and generic frozen policy in current/v6/reference; vary only literal context and derived operation/source identities.',
                           'attribution': 'Shared policy does not make old3 receipts evidence of v6/policy gain; development ablation evaluates retrieval and policy separately.'},
            'stop': 'Any missing code/human/new-development/source/pool/context gate, fewer24 disjoint packets, unsatisfied source-only strata, candidate replay failure or no source benefit stops. No reseeding, replacement, paid retry or automatic activation.',
            'freshPaidGate': 'Actual new24-development receipts, source-aware reviews, focused human resolution of applicable new disagreements (old3 remain unresolved history unless explicitly used as quality evidence), explicit independent outcome, exact fresh source/code/context review, refreshed canonical ledger and separate exact financial approval.',
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
    v1.write_new(directory/'history-inventory-v2.json', history); v1.write_new(directory/'protocol-v2.json', protocol)
    frozen = {'format': 'ablatrix-fresh-candidate-policy-freeze-v2', 'protocolFileSha256': sha((directory/'protocol-v2.json').read_bytes()),
              'historyInventoryFileSha256': sha((directory/'history-inventory-v2.json').read_bytes()), 'implementationSha256': code,
              'candidateFreezeFileSha256': contracts['candidate']['fileSha256'], 'policyFreezeFileSha256': contracts['policy']['fileSha256'],
              'freshInputReads': 0, 'providerCalls': 0, 'paidPlan': None}
    v1.write_new(directory/'candidate-policy-freeze-v2.json', frozen)
    pending = {'format': 'ablatrix-fresh-source-access-qualification-v2', 'status': 'review_pending',
               'protocolFileSha256': frozen['protocolFileSha256'], 'candidatePolicyFreezeFileSha256': sha((directory/'candidate-policy-freeze-v2.json').read_bytes()),
               'historyInventoryFileSha256': frozen['historyInventoryFileSha256'], 'applicableHumanDisagreementsResolved': False, 'newDevelopmentOutcomeEligible': False,
               'poolFileSha256': None, 'freshInputReads': 0, 'providerCalls': 0, 'paidPlan': None}
    v1.write_new(directory/'qualification-pending-v2.json', pending)
    return {'mode': 'frozen_v6_policy_prospective_no_fresh_reads', 'directory': str(directory), 'source': SOURCE, 'freshInputReads': 0, 'providerCalls': 0, 'paidPlan': None, 'stopReason': 'code_human_new_development_source_review_pending'}


def verify_freeze(root, directory):
    directory = pathlib.Path(directory)
    if not directory.is_absolute(): directory = root/directory
    rel = directory.relative_to(root).as_posix()
    p, f, h = [read(root, rel+'/'+name) for name in ('protocol-v2.json', 'candidate-policy-freeze-v2.json', 'history-inventory-v2.json')]
    protocol, frozen, history = p['document'], f['document'], h['document']
    descriptors = protocol['contracts']
    contracts = contract_artifacts(root, *(descriptors[k]['path'] for k in ('candidate', 'policy', 'projection', 'development')))
    require(all(contracts[k]['fileSha256'] == v['fileSha256'] for k,v in descriptors.items()), 'Candidate/policy/exposure/development raw artifact bytes changed.')
    body = dict(protocol); digest = body.pop('protocolSha256', None)
    require(digest == seal(body) and all(protocol.get(k) == v for k,v in protocol_fields(contracts).items()), 'New prospective protocol changed.')
    require(frozen.get('format') == 'ablatrix-fresh-candidate-policy-freeze-v2' and frozen.get('protocolFileSha256') == p['fileSha256'] and frozen.get('historyInventoryFileSha256') == h['fileSha256'], 'New protocol/history/freeze raw bindings differ.')
    require(frozen['candidateFreezeFileSha256'] == contracts['candidate']['fileSha256'] and frozen['policyFreezeFileSha256'] == contracts['policy']['fileSha256'], 'New candidate or shared policy binding changed.')
    require(implementation(root, contracts) == frozen['implementationSha256'] == protocol['implementationSha256'], 'New prospectively frozen implementation changed.')
    require(protected_inventory(root, contracts['projection']) == history and protocol['historyInventorySha256'] == history['inventorySha256'], 'Complete historical inventory omitted/changed an old artifact or scoped source.')
    return {'protocol': p, 'freeze': f, 'history': h, 'contracts': contracts}


def qualification(root, frozen, path, kind='source-access'):
    q = read(root, path); d = q['document']
    expected = 'ablatrix-fresh-source-access-qualification-v2' if kind == 'source-access' else 'ablatrix-fresh-pool-qualification-v2'
    status = 'reviewed_for_custodian_only' if kind == 'source-access' else 'reviewed_for_source_only_screening'
    # Must precede even stat/open/hash of dataset or finite pool.
    require(d.get('format') == expected and d.get('status') == status, 'Pending code/human/new-development/source qualification; fresh source not read.')
    for field, key in [('protocolFileSha256','protocol'), ('candidatePolicyFreezeFileSha256','freeze'), ('historyInventoryFileSha256','history')]:
        require(d.get(field) == frozen[key]['fileSha256'], 'Source qualification must bind exact reviewed protocol/candidate/policy/history bytes.')
    require(d.get('applicableHumanDisagreementsResolved') is True and d.get('newDevelopmentOutcomeEligible') is True, 'Unresolved applicable human axes or missing new-development outcome blocks fresh reads.')
    require(d.get('reviewedImplementationSha256') == frozen['freeze']['document']['implementationSha256'], 'The source-access review must bind the whole actual frozen implementation.')
    reviewed = datetime.datetime.fromisoformat(d['reviewedAt'])
    require(reviewed.tzinfo is not None and reviewed >= datetime.datetime.fromisoformat(frozen['protocol']['document']['createdAt']), 'Source qualification review must postdate the prospective freeze.')
    require(d.get('reviewer') and d.get('reviewEvidence') and d.get('provenance') in {'source_checked_human', 'independent_source_code_review'}, 'Named independent source/code review required.')
    require(d.get('freshInputsInspectedBeforeFreeze') is False and d.get('paidPlan') is None, 'Source-only qualification cannot approve paid execution or conceal early exposure.')
    outcome = read(root, d['developmentOutcomePath'])
    require(outcome['fileSha256'] == d['developmentOutcomeFileSha256'], 'Exact new-development/human qualification bytes changed.')
    result = outcome['document']
    require(result.get('format') == 'ablatrix-v6-development-outcome-qualification-v1' and result.get('status') == 'independently_reviewed_for_bounded_fresh_preparation', 'Old3 or source-delivery-only result cannot qualify newv6/policy.')
    require(result.get('candidateFreezeFileSha256') == frozen['contracts']['candidate']['fileSha256'] and result.get('policyFreezeFileSha256') == frozen['contracts']['policy']['fileSha256'], 'Development outcome must apply to this exact new candidate and policy.')
    require(result.get('developmentProtocolFileSha256') == frozen['contracts']['development']['fileSha256'] and result.get('verifiedActualCompletedAttempts') == 24 and result.get('sourceAwareReviewsComplete') is True and result.get('newHumanDisagreementsResolved') is True,
            'All24 real new-development receipts/reviews and focused applicable human resolution are prerequisites.')
    require(result.get('independentReviewer') and result.get('independentRationale') and result.get('noUnresolvedMaterialRegression') is True and result.get('paidPlan') is None,
            'An explicit independent outcome reason is required; no hidden financial approval.')
    require(isinstance(result.get('humanResolutionArtifacts'), list) and all(v1.DIGEST.fullmatch(v.get('fileSha256','')) for v in result['humanResolutionArtifacts']), 'Bind actual focused human source checks whenever disagreements require them; AI-only agreement is not human review.')
    if result.get('old3UsedAsQualityEvidence') is True:
        require(result.get('oldHumanAxisReviewResolved') is True and result['humanResolutionArtifacts'], 'The unresolved old3 may be history/exposure only unless their relevant human axes are actually resolved.')
    require(isinstance(result.get('unresolvedApplicableHumanAxes'), list) and not result['unresolvedApplicableHumanAxes'], 'Applicable human-review axes remain unresolved.')
    for item in result['humanResolutionArtifacts']:
        actual = read(root, item['path']); require(actual['fileSha256'] == item['fileSha256'], 'Focused human resolution artifact changed.')
        require(actual['document'].get('review', actual['document']).get('provenance') == 'source_checked_human', 'Do not relabel provisional AI review as human.')
    # A JSON assertion is not a receipt/human review verifier. The separately
    # frozen development CLI must replay canonical receipts and imports before
    # this process may access fresh sources. No bool-only fallback exists.
    verifier = v1.canonical_file(root, DEVELOPMENT_VERIFIER)
    require(DEVELOPMENT_VERIFIER in frozen['freeze']['document']['implementationSha256'], 'New development verifier is absent from the reviewed implementation closure.')
    require(sha(verifier.read_bytes()) == frozen['freeze']['document']['implementationSha256'][DEVELOPMENT_VERIFIER], 'New development verifier changed.')
    verified = json.loads(subprocess.check_output(['node', '--import', 'tsx', DEVELOPMENT_VERIFIER, '--verify-outcome', d['developmentOutcomePath']], cwd=root, stderr=subprocess.PIPE))
    require(verified.get('format') == 'ablatrix-report-calibration-development-outcome-proof-v1' and verified.get('outcomeFileSha256') == outcome['fileSha256'] and verified.get('verifiedActualCompletedAttempts') == 24 and verified.get('newHumanDisagreementsResolved') is True and verified.get('newProviderCalls') == 0,
            'Actual new-development receipt and human gate replay did not qualify fresh source access.')
    if kind == 'pool':
        require(v1.DIGEST.fullmatch(d.get('poolFileSha256','')), 'One exact finite pool byte commitment required.')
        require(d.get('sourceAccessQualificationPath') and d.get('sourceAccessQualificationFileSha256'), 'Pool byte review must retain the separately reviewed custodian/source-access qualification.')
        access = qualification(root, frozen, d['sourceAccessQualificationPath'])
        require(access['fileSha256'] == d['sourceAccessQualificationFileSha256'], 'Custodian source-access qualification changed.')
        record=read(root,d['custodianRecordPath'])
        require(record['fileSha256']==d['custodianRecordFileSha256'], 'Exact finite custodian record changed.')
        c=record['document']; body=dict(c); digest=body.pop('custodianSha256',None)
        require(c.get('format')=='ablatrix-v6-source-custodian-record-v2' and c.get('source')==SOURCE and c.get('seed')==SEED and c.get('finiteQuestionDenominator')==256 and c.get('screeningPacketDenominator')==24 and c.get('stopReason') is None and digest==seal(body), 'Finite custodian provenance or denominator changed.')
        require(len(c.get('decisions',[]))==256 and c.get('modelOutputsUsed') is False and c.get('answerColumnsUsed') is False and c.get('candidateContextInspected') is False, 'A different or outcome-filtered source pool cannot qualify.')
        expected_bytes=(json.dumps(c['pool'],ensure_ascii=False,indent=2)+'\n').encode()
        require(sha(expected_bytes)==d['poolFileSha256'], 'Committed pool bytes must be the actual fixed custodian output.')
    return q


def protection_reasons(case, history):
    ids = v1.models(case['product']['title']+' '+case['question']+' '+' '.join(s['text']+' '+(s['originalQuestion'] or '') for s in case['sources']))
    fps = {f for s in case['sources'] for f in (v1.packet.fingerprint(s), v1.scoped_fingerprint(s))}
    reasons = []
    if case['product']['id'] in history['products']: reasons.append('historical_or_prior_product')
    if any(v1.family_conflict(case['product']['title'], t) for t in history['titles']): reasons.append('historical_or_prior_family')
    if v1.model_conflict(ids, history['models']): reasons.append('historical_or_prior_model')
    if fps & history['packets']: reasons.append('historical_or_prior_body_and_original_question')
    return reasons, ids, fps


def protected_sets(document):
    return {'products': set(document['productIds']), 'titles': list(document['canonicalFamilyTitles']), 'models': set(document['modelIdentifiers']), 'packets': set(document['sourcePacketFingerprints'])}


def extend_protection(history, case, ids, fps):
    history['products'].add(case['product']['id']); history['titles'].append(v1.family(case['product']['title'])); history['models'].update(ids); history['packets'].update(fps)


def source_pool(rows, split_context):
    result, seen = [], set()
    for row in sorted(rows, key=lambda r: (r['row'], r['source'], r['candidate'])):
        body, original = split_context(row)
        require(body and len(body.encode('utf-16-le'))//2 <= 1500, 'Complete parent exceeds1500; no splitting or clipping qualifications.')
        key = (row['source'], body, original)
        if key in seen: continue
        seen.add(key)
        source_id = f"epqa-{row['ASIN']}-{row['source']}-{sha(compact(list(key)))[:16]}"
        reference = f"{SOURCE['url']}#row={row['row']}&qa_pair_id={row['qa_pair_id']}&chars=0-{len(body)}"
        s = {'id': source_id, 'label': row['source'], 'text': body, 'originalQuestion': original, 'reference': reference}
        s['sha256'] = sha(compact([s[k] for k in ('id','label','text','originalQuestion','reference')]))
        result.append(s)
    require(1 <= len(result) <= 128, 'Complete source-pool bound violated.')
    return result


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
            sources = source_pool(products[pid], split_context)
            case = {'id': 'fresh-v6-train-'+row['qid'], 'product': {'id':pid,'title':row['title'].strip()}, 'question': row['question'].strip(), 'sources':sources,'sourcePoolSha256':sha(compact(sources))}
            reasons, ids, fps = protection_reasons(case, protections)
            extend_protection(protections, case, ids, fps)  # rejected viewed packets remain exposed
            require(not reasons, '|'.join(reasons))
            decision['eligible'] = True; cases.append(case)
        except ValueError as error: decision['reasons'] = [str(error)]
        decisions.append(decision)
    pool = {'format':'ablatrix-fresh-source-only-pool-v1','cases':cases}
    body = {'format':'ablatrix-v6-source-custodian-record-v2','source':SOURCE,'seed':SEED,'finiteQuestionDenominator':256,'screeningPacketDenominator':len(cases),'decisions':decisions,
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
    v1.write_new(destination/'custodian-record-v2.json', result)
    if result['stopReason'] is None:
        v1.source_cases(result['pool']); v1.write_new(destination/'pool-v2.json', result['pool'])
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
    body={'format':'ablatrix-fresh-validation-screening-v2','screeningDenominator':24,'poolFileSha256':pool['fileSha256'],'protocolFileSha256':frozen['protocol']['fileSha256'],
          'candidatePolicyFreezeFileSha256':frozen['freeze']['fileSha256'],'historyInventoryFileSha256':frozen['history']['fileSha256'],'qualificationFileSha256':q['fileSha256'],
          'acceptedCaseIds':[r['caseId'] for r in decisions if r['eligible']],'decisions':decisions,'packetGuard':overlaps,
          'candidateContextInspected':False,'generatedAnswersInspected':False,'providerCalls':0,'paidPlan':None,'paidExecutionAuthorized':False}
    return {**body,'screeningSha256':seal(body)}


def screen(root,directory,qualification_path,pool_path):
    return load_screening(root,directory,qualification_path,pool_path)[3]


def merge_bindings(*maps):
    result={}
    for values in maps:
        for path,digest in values.items():
            require(v1.DIGEST.fullmatch(digest), 'Artifact byte binding must be a SHA256.')
            require(path not in result or result[path]==digest, 'Conflicting duplicate artifact byte bindings.')
            result[path]=digest
    return result


def load_screening(root,directory,qualification_path,pool_path,saved_path=None):
    frozen=verify_freeze(root,directory); q=qualification(root,frozen,qualification_path,'pool')
    pool=read(root,pool_path)
    require(pool['fileSha256']==q['document']['poolFileSha256'],'Finite pool commitment changed; no replacement.')
    document=screening(pool,frozen,q)
    saved=read(root,saved_path) if saved_path else None
    if saved: require(saved['document']==document,'Saved v2 screening cannot reproduce exact reviewed raw inputs.')
    artifacts=[frozen['protocol'],frozen['freeze'],frozen['history'],*frozen['contracts'].values(),q,pool,*([saved] if saved else [])]
    bindings=merge_bindings(*({a['path']:a['fileSha256']} for a in artifacts))
    return frozen,q,pool,document,bindings


def select_document(screening_document,baseline,review,baseline_sha,review_sha):
    require(baseline.get('format')=='ablatrix-fresh-validation-baseline-v2' and review.get('format')=='ablatrix-fresh-validation-source-review-v2','Require separately versioned baseline and independent source review.')
    # Pure copies reuse v1's literal-scope/semantic-review predicate. Historical
    # producer/files are not patched, and actual raw v2 bytes stay the bindings.
    old_baseline={**baseline,'format':'ablatrix-fresh-validation-baseline-v1'}
    old_review={**review,'format':'ablatrix-fresh-validation-source-review-v1'}
    result=v1.finalize_document(screening_document,old_baseline,old_review,baseline_sha,review_sha)
    result['format']='ablatrix-fresh-validation-selection-v2'
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__); sub=parser.add_subparsers(dest='mode',required=True)
    sub.add_parser('metadata')
    capture=sub.add_parser('capture-exposure')
    for flag in ('plan','checkpoint','evaluation-report','out'):capture.add_argument('--'+flag,required=True)
    freeze_parser=sub.add_parser('freeze')
    for flag in ('candidate','policy','exposure-projection','development-protocol','out-dir'):freeze_parser.add_argument('--'+flag,required=True)
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
        elif args.mode=='capture-exposure':
            p=artifact_external(args.plan); c=artifact_external(args.checkpoint,jsonl=True); e=artifact_external(args.evaluation_report)
            rows,summary=ledger_rows();result=exposure_projection(p,c,e,rows,summary);v1.write_new(pathlib.Path(args.out),result)
        elif args.mode=='freeze':result=freeze(ROOT,args.out_dir,contract_artifacts(ROOT,args.candidate,args.policy,args.exposure_projection,args.development_protocol))
        elif args.mode=='verify':
            f=verify_freeze(ROOT,args.freeze_dir);result={'mode':'verified_v6_policy_prospective_no_fresh_reads','freshInputReads':0,'providerCalls':0,'paidPlan':None,'candidatePolicyFreezeFileSha256':f['freeze']['fileSha256']}
        elif args.mode=='custodian':result=custodian(ROOT,args.freeze_dir,args.source_access,args.train,args.out_dir)
        else:
            frozen,q,pool,document,bindings=load_screening(ROOT,args.freeze_dir,args.qualification,args.pool,getattr(args,'screening',None))
            result=document
            if args.mode=='select':
                baseline,review=read(ROOT,args.baseline),read(ROOT,args.review)
                proof=json.loads(subprocess.check_output(['node','--import','tsx','scripts/fresh-validation-contexts-v2.ts','--verify-baseline','--freeze-dir',args.freeze_dir,'--qualification',args.qualification,'--pool',args.pool,'--screening',args.screening,'--baseline',args.baseline],cwd=ROOT,stderr=subprocess.PIPE))
                require(proof.get('baselineFileSha256')==baseline['fileSha256'] and proof.get('screeningFileSha256')==bindings[args.screening],'Parsed baseline/screening snapshots changed during genuine saved-stage replay.')
                result=select_document(document,baseline['document'],review['document'],baseline['fileSha256'],review['fileSha256'])
                bindings=merge_bindings(bindings,{baseline['path']:baseline['fileSha256'],review['path']:review['fileSha256']})
                result['artifactSha256']=bindings;result['selectionSha256']=seal(result)
            if args.mode in {'screen','select'}:v1.write_new(pathlib.Path(args.out),result)
            result={'mode':args.mode,'screeningDenominator':24,'accepted':len(document['acceptedCaseIds']),'stopReason':result.get('stopReason'),'artifactSha256':bindings,'providerCalls':0,'paidPlan':None}
        print(json.dumps(result,indent=2))
    except (ValueError,KeyError,TypeError,OSError,sqlite3.Error,subprocess.CalledProcessError) as error:parser.exit(1,'Freshv2 preparation stopped: '+str(error)+'\n')

if __name__=='__main__':main()
