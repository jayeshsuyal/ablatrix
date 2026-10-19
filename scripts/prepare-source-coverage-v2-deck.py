#!/usr/bin/env python3
"""Prepare one frozen, source-only twelve-product validation deck.

This is a new protocol. The failed original 64-product and exposed 44-product
studies remain failed. No candidate context, generated answer, judgment, provider,
credential or environment file is read. Materialization requires a code freeze.
"""
import argparse
import datetime
import importlib.util
import json
import pathlib
import re
import sqlite3

ROOT = pathlib.Path(__file__).resolve().parents[1]
COVERAGE_PATH = 'scripts/prepare-retrieval-coverage-cohort.py'
COVERAGE_SHA = 'd4a7d904245721d1277914a52dff1ace6094e76357999909287d2de8653f3445'
spec = importlib.util.spec_from_file_location('source_coverage_v2_immutable_rules', ROOT / COVERAGE_PATH)
coverage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(coverage)
base, flat, legacy = coverage.base, coverage.flat, coverage.legacy
SEED = 'ablatrix-source-coverage-v2-2026-10-18-v1'
CASE_PREFIX = 'source-coverage-v2-train'
PROTOCOL = 'fresh_source_coverage_v2_v1'
STRATA = (('capacity_dimensions', 8), ('preservation_control', 4))
HELPERS = {COVERAGE_PATH: COVERAGE_SHA, **coverage.HELPERS}
DEVELOPMENT_POOL = 'docs/evidence/retrieval-source-gap-exploratory-2026-10-18/pool-v2.json'
DEVELOPMENT_POOL_SHA = '00506e7875c4a47705f06ff14302de3648b9d9343b5240fe7225706d5c83b737'
HISTORY_INPUTS = {
    'work/source-calibration-2026-10-18-preparation/cohort.json': '800addd39722f6717312d81eca706ac02085bf30f65358c133db4a86c9e03b9d',
    'work/source-calibration-2026-10-18-preparation-v2/cohort.json': '0aeb9892647fe8f9501a94d4b4b4a2012805c613bee319768efeaac02cf3fc04',
    'work/source-calibration-2026-10-18-preparation/source-family-review-v1.json': 'a5355d9ecdce007a2fb00a3bc30691a8bf060e7da3ee4f8e61bb2ab164253b94',
    'work/source-calibration-2026-10-18-preparation-v2/source-family-review-v1.json': '9e2dd517b86b656eaae9e9225957ad63009ba2362e584c0798d60bfa62a7c8db',
    'docs/evidence/answer-quality-source-calibration-2026-10-18/cohort-v1.json': '658b9e2ab6e2cec0904da67b31980b4e4d6bd0f1e2dadb8181e5f4ec31869934',
    'docs/evidence/answer-quality-source-calibration-2026-10-18/source-family-review-v1.json': '948391ed5a5a31b4a3e86e867d374a5ff7a1ca3628ae5d8fafce7626dec9cfbe',
    'work/retrieval-coverage-2026-10-18-metadata/consumed-cohort-execution-v1.json': '70887bb1f0d967327175bbde1280f97592663683e99ae9a37d0045ec77615faa',
    'docs/evidence/retrieval-source-coverage-2026-10-18/cohort-v1.json': '681544a9e7ea23b1d0cef61106655fafd6736ee26e6228d33389d99c3cc84164',
    'docs/evidence/retrieval-source-coverage-2026-10-18/source-family-review-v1.json': '6385aaa92cdd44a18ea063793067fcafce4aedba54749a305294205f1c230153',
}
FROZEN_FIELDS = {
    **coverage.FROZEN_FIELDS, 'format': 'ablatrix-source-coverage-v2-candidate-freeze-v1',
    'retrievalContract': 'workspace-source-coverage-v2', 'selectionSeed': SEED,
}
REQUIRED_CODE = coverage.REQUIRED_CODE | {
    'scripts/prepare-source-coverage-v2-deck.py', 'scripts/test_prepare_source_coverage_v2_deck.py',
    'scripts/source-coverage-v2-retrieval.ts', 'scripts/source-coverage-v2-retrieval.test.ts',
    'server/workspace-source-coverage-v2.ts', 'server/workspace-source-coverage-v2.test.ts',
    'server/workspace-generation-identity.ts', 'server/product-workspace.ts',
    'server/context-comparison.ts', 'server/answer-review-source.ts',
    'server/workspace-source-coverage-integration.test.ts',
}
PROTOCOL_FIELDS = {
    'format': 'ablatrix-source-coverage-v2-selection-protocol-v1', 'selectionProtocol': PROTOCOL,
    'selectionSeed': SEED, 'screeningProducts': 12,
    'strata': [{'name': name, 'count': count} for name, count in STRATA],
    'historyFileSha256': HISTORY_INPUTS, 'developmentPoolFileSha256': DEVELOPMENT_POOL_SHA,
    'developmentProductsProtected': 44, 'candidateEligibilityUsed': False,
    'modelOutputsUsed': False, 'caseReplacement': False, 'reseeding': False,
    'evaluateAllScreenedProducts': True, 'sameTwelveProductCorpus': True,
    'sourceReviewBeforeCandidateContexts': True,
    'paidEligibilityMinima': {'supported_gap': 1, 'baseline_complete_control': 2},
    'modelDetailGapRequired': False, 'candidateMissesRetained': True,
    'zeroDesignatedFactDeliveryBlocksPaidPlan': True, 'maximumNewAnswerAttempts': 24,
}


def artifact(path):
    resolved = pathlib.Path(path).resolve(strict=True)
    if ROOT not in resolved.parents or not resolved.is_file():
        raise ValueError('Artifacts must be existing repository files.')
    raw = resolved.read_bytes()
    return {'path': resolved.relative_to(ROOT).as_posix(), 'fileSha256': legacy.sha(raw),
            'document': json.loads(raw)}


def candidate_freeze(path):
    value = artifact(path)
    document = value['document']
    if (set(document) != set(FROZEN_FIELDS) | {'createdAt', 'implementationSha256'} or
            any(document.get(key) != expected for key, expected in FROZEN_FIELDS.items())):
        raise ValueError('The v2 code freeze differs from the prospective contract.')
    try:
        stamp = datetime.datetime.fromisoformat(document['createdAt'].replace('Z', '+00:00'))
        if stamp.tzinfo is None:
            raise ValueError('Timezone missing.')
    except (AttributeError, TypeError, ValueError):
        raise ValueError('The v2 freeze needs an ISO timestamp with timezone.') from None
    files = document['implementationSha256']
    if not isinstance(files, dict) or set(files) != REQUIRED_CODE:
        raise ValueError('The v2 freeze lacks required implementation files.')
    for name, expected in files.items():
        coverage.require_digest(expected)
        relative = pathlib.PurePosixPath(name)
        if (not relative.parts or relative.is_absolute() or '..' in relative.parts or
                str(relative) != name or '\\' in name or
                not (name == 'package-lock.json' or relative.parts[0] in {'server', 'scripts'})):
            raise ValueError('Freeze implementation paths must be canonical repository code.')
        actual = (ROOT / name).resolve(strict=True)
        if ROOT not in actual.parents or legacy.sha(actual.read_bytes()) != expected:
            raise ValueError('The v2 implementation changed after freezing.')
    if legacy.sha((ROOT / COVERAGE_PATH).read_bytes()) != COVERAGE_SHA:
        raise ValueError('The immutable source-only selector changed.')
    coverage.verify_helpers()
    return value


def protocol(path, freeze):
    value = artifact(path)
    document = value['document']
    if (set(document) != set(PROTOCOL_FIELDS) | {'candidateFreezeFileSha256', 'protocolSha256'} or
            any(document.get(key) != expected for key, expected in PROTOCOL_FIELDS.items()) or
            document.get('candidateFreezeFileSha256') != freeze['fileSha256'] or
            document.get('protocolSha256') != flat.checksum(document, 'protocolSha256')):
        raise ValueError('The exact v2 recipe and analysis gates must be frozen before source reads.')
    return value


def literal_cases(document, count):
    cases = document.get('cases', [])
    if (len(cases) != count or len({case['id'] for case in cases}) != count or
            len({case['product']['id'].upper() for case in cases}) != count):
        raise ValueError('The source-only deck must contain its exact distinct denominator.')
    result = []
    for case in cases:
        product, sources = case['product'], case['sources']
        if (not flat.ASIN.fullmatch(product['id']) or not product['title'].strip() or
                not 1 <= len(sources) <= 128 or len({source['id'] for source in sources}) != len(sources) or
                case['sourcePoolSha256'] != legacy.sha(legacy.compact(sources))):
            raise ValueError('A literal source pool or product binding is invalid.')
        for source in sources:
            if set(source) != {'id', 'label', 'text', 'originalQuestion', 'reference', 'sha256'}:
                raise ValueError('Source-only packets cannot include generated or judgment fields.')
            if (not isinstance(source['text'], str) or not 1 <= len(source['text']) <= 1500 or
                    (source['originalQuestion'] is not None and not isinstance(source['originalQuestion'], str)) or
                    source['sha256'] != legacy.sha(json.dumps(
                        [source[key] for key in ('id', 'label', 'text', 'originalQuestion', 'reference')],
                        ensure_ascii=False, separators=(',', ':')))):
                raise ValueError('Literal source body or original-question binding changed.')
        result.append({'id': product['id'], 'title': product['title'],
                       'question': case['question'], 'sources': sources})
    return result


def development_pool(path):
    value = artifact(path)
    document = value['document']
    if (value['path'] != DEVELOPMENT_POOL or value['fileSha256'] != DEVELOPMENT_POOL_SHA or
            document.get('format') != 'ablatrix-source-gap-exposed-pool-v1' or
            document.get('poolSha256') != flat.checksum(document, 'poolSha256') or
            document.get('status', {}).get('generationPerformed') is not False):
        raise ValueError('Protect the exact previously exposed 44-product pool; it cannot become fresh validation.')
    cases = literal_cases(document, 44)
    return {'cases': cases, 'projection': {
        'path': value['path'], 'fileSha256': value['fileSha256'], 'poolSha256': document['poolSha256'],
        'protectionScope': 'all_44_exposed_products_sources_models_and_families',
        'productIds': sorted(case['id'].upper() for case in cases),
        'canonicalFamilyTitles': sorted({flat.previous.title_family(case['title']) for case in cases}),
        'modelIdentifiers': sorted(set().union(*(flat.source_identifiers(case) for case in cases))),
        'sourcePacketFingerprints': sorted({base.source_packet_fingerprint(source)
                                          for case in cases for source in case['sources']}),
    }}


def protected_inputs(args):
    requested = [*args.prior_cohort, *args.prior_source_review, args.consumed_cohort,
                 args.consumed_source_review, args.consumed_execution_record,
                 args.exposed_cohort, args.exposed_source_review]
    values = [artifact(path) for path in requested]
    actual = {value['path']: value['fileSha256'] for value in values}
    if len(values) != len(HISTORY_INPUTS) or actual != HISTORY_INPUTS:
        raise ValueError('Every rejected, consumed and exposed prior history input must remain protected.')
    priors, reviews, consumed = coverage.protected_inputs(args)
    exposed = artifact(args.exposed_cohort)
    source_review = artifact(args.exposed_source_review)
    cases = literal_cases(exposed['document'], 8)
    cohort, review = exposed['document'], source_review['document']
    if (cohort.get('format') != 'ablatrix-retrieval-coverage-cohort-v1' or
            cohort.get('cohortSha256') != flat.checksum(cohort, 'cohortSha256') or
            cohort.get('status', {}).get('generationPerformed') is not False or
            review.get('status') != 'passed' or
            review.get('provenance') != 'independent_ai_source_and_family_review' or
            review.get('cohortFileSha256') != exposed['fileSha256'] or
            [row.get('caseId') for row in review.get('cases', [])] != [case['id'] for case in cohort['cases']] or
            any(row.get('sourceScopeReviewed') is not True or row.get('familySeparationReviewed') is not True
                for row in review['cases'])):
        raise ValueError('The exposed unexecuted eight-case source packet must retain its review.')
    exposed_protection = {'cases': cases, 'projection': {
        'path': exposed['path'], 'fileSha256': exposed['fileSha256'],
        'sourceReviewFileSha256': source_review['fileSha256'],
        'productIds': sorted(case['id'].upper() for case in cases),
        'status': 'exposed_unexecuted_cohort',
    }}
    development = development_pool(args.development_pool)
    protections = [*priors, consumed, exposed_protection, development]
    if len({case['id'].upper() for item in protections for case in item['cases']}) != 76:
        raise ValueError('All 32 prior cohort products and 44 development products must be distinct protections.')
    return protections, reviews


def select(rows, exposure, protections):
    # This imported module instance is private to this script. Reuse all pinned
    # source construction/exclusion rules, explicitly replacing only its quota.
    # Restore the old value even on failure; no frozen helper file is edited.
    previous = base.STRATA
    try:
        base.STRATA = STRATA
        return base.select(rows, exposure, protections, seed=SEED, case_prefix=CASE_PREFIX)
    finally:
        base.STRATA = previous


def encoded(document):
    return (json.dumps(document, ensure_ascii=False, indent=2) + '\n').encode()


def history_args():
    return argparse.Namespace(
        prior_cohort=[str(ROOT / path) for path in list(HISTORY_INPUTS)[:2]],
        prior_source_review=[str(ROOT / path) for path in list(HISTORY_INPUTS)[2:4]],
        consumed_cohort=str(ROOT / list(HISTORY_INPUTS)[4]),
        consumed_source_review=str(ROOT / list(HISTORY_INPUTS)[5]),
        consumed_execution_record=str(ROOT / list(HISTORY_INPUTS)[6]),
        exposed_cohort=str(ROOT / list(HISTORY_INPUTS)[7]),
        exposed_source_review=str(ROOT / list(HISTORY_INPUTS)[8]),
        development_pool=str(ROOT / DEVELOPMENT_POOL))


def read_reference(value):
    if not isinstance(value, dict) or set(value) != {'path', 'fileSha256'}:
        raise ValueError('Deck inputs need exact canonical raw-file references.')
    result = artifact(ROOT / value['path'])
    if {key: result[key] for key in ('path', 'fileSha256')} != value:
        raise ValueError('A raw-bound source-only input changed.')
    return result


def verify_deck(path):
    """Verify saved producer provenance without reopening CSV or outcomes.

    This verifies local producer records and literal byte bindings; it is not an
    externally authenticated proof of train membership or a selector replay.
    An eventual approved paid plan must additionally bind these exact raw files.
    """
    saved = artifact(path)
    document = saved['document']
    fields = {'format', 'selectionProtocol', 'selectionSeed', 'protocol', 'candidateFreeze',
              'source', 'selection', 'inventory', 'inputArtifacts', 'exposureAuditSha256',
              'status', 'cases', 'deckSha256'}
    if (set(document) != fields or document.get('format') != 'ablatrix-source-coverage-v2-deck-v1' or
            document.get('selectionProtocol') != PROTOCOL or document.get('selectionSeed') != SEED or
            document.get('deckSha256') != flat.checksum(document, 'deckSha256')):
        raise ValueError('The fixed v2 deck identity or seal changed.')
    freeze = candidate_freeze(ROOT / document['candidateFreeze']['path'])
    recipe = protocol(ROOT / document['protocol']['path'], freeze)
    if freeze != document['candidateFreeze'] or recipe != document['protocol']:
        raise ValueError('Embedded protocol or implementation bindings changed.')
    expected_source = {'url': legacy.URL, 'sha256': legacy.TRAIN_SHA, 'commit': legacy.COMMIT,
                       'license': 'CDLA-Sharing-1.0', 'testSplitUsed': False}
    expected_status = {'generationPerformed': False, 'candidateContextInspected': False,
                       'independentSourceReview': 'pending', 'paidExecutionAuthorized': False,
                       'qualityClaimEligible': False}
    if document['source'] != expected_source or document['status'] != expected_status:
        raise ValueError('Deck source identity or pre-review status changed.')
    references = document['inputArtifacts']
    if set(references) != {'exposureAudit', 'selectionAudit'}:
        raise ValueError('Both original source-only producer audits must remain bound.')
    exposure_artifact = read_reference(references['exposureAudit'])
    selection_artifact = read_reference(references['selectionAudit'])
    if exposure_artifact['path'] == selection_artifact['path']:
        raise ValueError('Producer audits must identify distinct raw files.')
    exposure, audit = exposure_artifact['document'], selection_artifact['document']
    if (exposure.get('format') != 'ablatrix-flat-source-exposure-audit-v1' or
            exposure.get('auditSha256') != flat.checksum(exposure, 'auditSha256') or
            document['exposureAuditSha256'] != exposure['auditSha256'] or
            exposure.get('inputFiles') != flat.fixed_inputs() or
            exposure.get('metadataOnly') is not True or exposure.get('generatedAnswersOrJudgmentsRead') is not False or
            exposure.get('newProviderCalls') != 0 or exposure.get('paidExecutionAuthorized') is not False or
            exposure.get('metadataSha256') != legacy.sha(legacy.compact(exposure.get('metadata')))):
        raise ValueError('Source-only exposure provenance changed.')
    metadata = exposure['metadata']
    inventories = metadata.get('workspaces', []) + metadata.get('comparisons', [])
    if (len(metadata.get('workspaces', [])) != 2 or len(metadata.get('comparisons', [])) != 1 or
            exposure.get('metadataInventorySha256') != {
                item['inventory']: legacy.sha(legacy.compact(item)) for item in inventories}):
        raise ValueError('All three source metadata inventories must remain bound.')
    for reference in exposure.get('publicIdentifierProjections', []):
        relative = pathlib.PurePosixPath(reference['path'])
        if relative.is_absolute() or '..' in relative.parts or not relative.parts or relative.parts[0] != 'docs':
            raise ValueError('Public source protection paths must remain canonical documentation.')
        ids = sorted(set(flat.ASIN.findall((ROOT / relative).read_text())))
        if ids != reference['productIds'] or legacy.sha(legacy.compact(ids)) != reference['identifierProjectionSha256']:
            raise ValueError('A recorded public exposure projection changed.')
    protections, reviews = protected_inputs(history_args())
    common = document['selection']
    expected = {'selectionCodeSha256': legacy.sha(pathlib.Path(__file__).read_bytes()),
                'immutableHelperSha256': HELPERS, 'inventoryInputs': common.get('inventoryInputs'),
                'historyFileSha256': HISTORY_INPUTS,
                'protectedCohorts': [item['projection'] for item in protections], 'priorSourceReviews': reviews,
                'sourceEligibility': 'unchanged_source_calibration_revision_3_except_explicit_eight_four_quota',
                'generatedAnswersOrJudgmentsRead': False, 'modelOutputsUsed': False,
                'candidateContextInspected': False}
    inventory = common.get('inventoryInputs', {})
    if (common != expected or set(inventory) != {'workspaceCount', 'comparisonCount', 'canonicalPathSha256'} or
            inventory['workspaceCount'] != 2 or inventory['comparisonCount'] != 1 or
            len(inventory['canonicalPathSha256']) != 3 or len(set(inventory['canonicalPathSha256'])) != 3 or
            any(not re.fullmatch(r'[a-f0-9]{64}', value) for value in inventory['canonicalPathSha256'])):
        raise ValueError('Deck source-protection or inventory bindings changed.')
    expected_audit = {'format': 'ablatrix-source-coverage-v2-selection-audit-v1',
        'selectionSeed': SEED, 'candidateFreezeFileSha256': freeze['fileSha256'],
        'protocolFileSha256': recipe['fileSha256'], 'exposureAuditSha256': exposure['auditSha256'],
        'inventory': document['inventory'], 'decisions': audit.get('decisions'),
        'selectedSourceBindings': audit.get('selectedSourceBindings'), **common,
        'generationPerformed': False, 'newProviderCalls': 0}
    if (audit.get('selectionAuditSha256') != flat.checksum(audit, 'selectionAuditSha256') or
            {key: value for key, value in audit.items() if key != 'selectionAuditSha256'} != expected_audit or
            document['inventory'].get('passed') is not True):
        raise ValueError('The original successful producer selection audit changed.')
    cases = document['cases']
    projected = literal_cases(document, 12)
    if [case['stratum'] for case in cases] != [name for name, count in STRATA for _ in range(count)]:
        raise ValueError('The exact prospective eight/four case order changed.')
    for case in cases:
        if (set(case) != {'id', 'stratum', 'product', 'question', 'sources', 'sourceOrigins',
                        'sourcePoolSha256', 'sourceSnapshotFingerprint', 'upstream', 'selectionRankSha256', 'familyAudit'} or
                set(case['product']) != {'id', 'title'} or
                set(case['upstream']) != {'split', 'qid', 'questionRow'} or
                case['id'] != f"{CASE_PREFIX}-{case['upstream']['qid']}" or
                case['upstream'].get('split') != 'train' or
                type(case['upstream']['questionRow']) is not int or case['upstream']['questionRow'] < 2 or
                not re.fullmatch(r'[A-Za-z0-9_-]{1,90}', case['upstream']['qid']) or
                not 8 <= len(case['question'].strip()) <= 300 or
                not re.fullmatch(r'[a-f0-9]{64}', case['sourceSnapshotFingerprint']) or
                case['familyAudit'] != {'status': 'pending_independent_source_and_family_review'} or
                case['selectionRankSha256'] != legacy.sha(f"{SEED}:{case['stratum']}:{case['upstream']['qid']}")):
            raise ValueError('A source-only selected case or deterministic rank identity changed.')
        if (case['stratum'] not in flat.strata_for(case['question'], case['sources']) or
                any(flat.DOMAIN.search(text) or base.HIGH_STAKES.search(text)
                    for text in [case['product']['title'], case['question'],
                                 *[source['text'] + ' ' + (source['originalQuestion'] or '') for source in case['sources']]])):
            raise ValueError('A selected question or literal source violates the frozen source-only eligibility rules.')
        origins = case['sourceOrigins']
        if not isinstance(origins, dict) or set(origins) != {source['id'] for source in case['sources']}:
            raise ValueError('Every selected literal source needs its original producer row bindings.')
        for source in case['sources']:
            digest = legacy.sha(legacy.compact([source['label'], source['text'], source['originalQuestion']]))[:16]
            if source['id'] != f"epqa-{case['product']['id']}-{source['label']}-{digest}":
                raise ValueError('A source ID does not match its literal product/body/question scope.')
            if not isinstance(origins[source['id']], list) or not origins[source['id']]:
                raise ValueError('A literal source must retain at least one original row binding.')
            for origin in origins[source['id']]:
                if (set(origin) != {'row', 'qaPairId', 'qid', 'bodyStart', 'bodyEnd', 'rawCandidateSha256'} or
                        type(origin['row']) is not int or origin['row'] < 2 or
                        not isinstance(origin['qid'], str) or not isinstance(origin['qaPairId'], str) or
                        type(origin['bodyStart']) is not int or type(origin['bodyEnd']) is not int or
                        not 0 <= origin['bodyStart'] < origin['bodyEnd'] <= 1500 or
                        origin['bodyEnd'] - origin['bodyStart'] != len(source['text']) or
                        not re.fullmatch(r'[a-f0-9]{64}', origin['rawCandidateSha256'])):
                    raise ValueError('Selected source origins must contain only exact source-only row fields.')
    accepted = [row for row in audit['decisions'] if row.get('selected') is True]
    expected_accepted = [{'stage': 'ranked_selection', 'eligible': True, 'selected': True,
        'qid': case['upstream']['qid'], 'productId': case['product']['id'],
        'stratum': case['stratum'], 'rankSha256': case['selectionRankSha256']} for case in cases]
    if accepted != expected_accepted or audit['selectedSourceBindings'] != source_bindings(cases):
        raise ValueError('Deck cases do not match the source-only producer selection record.')
    # Recheck all source-established cross-case and historical exclusions. The
    # producer's full-train rank audit remains the provenance for first selection.
    prior_cases = [case for item in protections for case in item['cases']]
    metadata_items = flat.metadata_items(metadata)
    rows = [{'title': case['title'], 'question': case['question'], 'candidate': source['text']}
            for case in projected for source in case['sources']]
    base.source_family_brands(rows, metadata_items + prior_cases)
    pids = {case['id'].upper() for case in prior_cases} | {case['id'].upper() for case in exposure['protectedProducts']}
    titles = {case['title'] for case in prior_cases} | {case['title'] for case in exposure['protectedProducts'] if case['title']} | set(exposure['extraTitles'])
    ids = set(exposure['protectedTargetIdentifiers']) | set().union(*(flat.source_identifiers(case) for case in prior_cases))
    fingerprints = {base.source_packet_fingerprint(source) for case in prior_cases for source in case['sources']}
    selected_snapshots = set()
    for case, raw_case in zip(projected, cases):
        case_ids = flat.source_identifiers(case)
        if (case['id'].upper() in pids or any(flat.previous.family_conflict(case['title'], title) for title in titles) or
                legacy.identifier_conflict(case_ids, ids) or
                any(base.source_packet_fingerprint(source) in fingerprints for source in case['sources']) or
                raw_case['sourceSnapshotFingerprint'] in selected_snapshots):
            raise ValueError('A selected product, model, source packet or family overlaps protected exposure.')
        pids.add(case['id'].upper())
        titles.add(case['title'])
        ids |= case_ids
        selected_snapshots.add(raw_case['sourceSnapshotFingerprint'])
    return {'mode': 'verified_source_only_deck', 'newProviderCalls': 0,
            'deckFileSha256': saved['fileSha256'], 'screeningProducts': 12,
            'provenance': 'verified_local_source_only_producer_records_not_external_train_authentication'}


def source_bindings(cases):
    return [{'caseId': case['id'], 'productId': case['product']['id'],
             'sourceCaseSha256': legacy.sha(legacy.compact(case)),
             'sourcePoolSha256': case['sourcePoolSha256'],
             'sourceSnapshotFingerprint': case['sourceSnapshotFingerprint'],
             'selectionRankSha256': case['selectionRankSha256']} for case in cases]


def prepare(args):
    # These two checks precede every CSV, source metadata and source-pool read.
    freeze = candidate_freeze(args.candidate_freeze)
    recipe = protocol(args.protocol, freeze)
    destination = pathlib.Path(args.prepare_dir).resolve()
    if ROOT not in destination.parents or destination.exists() or ROOT / 'docs' in destination.parents:
        raise ValueError('Use a new private repository directory; no overwrite or resume.')
    inventories = coverage.inventory_inputs(args)
    protections, reviews = protected_inputs(args)
    rows = flat.load_rows(args.train)
    args.exposure_audit = None
    exposure = flat.exposure(args, rows)
    cases, decisions, summary = select(rows, exposure, protections)
    if not summary['passed'] or len(cases) != 12:
        raise ValueError('Insufficient fixed twelve-product deck; stop without partial output, reseeding or replacement.')
    literal_cases({'cases': cases}, 12)
    if [case['stratum'] for case in cases] != [name for name, count in STRATA for _ in range(count)]:
        raise ValueError('The fixed v2 eight/four selection order changed.')
    common = {'selectionCodeSha256': legacy.sha(pathlib.Path(__file__).read_bytes()),
              'immutableHelperSha256': HELPERS, 'inventoryInputs': inventories,
              'historyFileSha256': HISTORY_INPUTS,
              'protectedCohorts': [item['projection'] for item in protections], 'priorSourceReviews': reviews,
              'sourceEligibility': 'unchanged_source_calibration_revision_3_except_explicit_eight_four_quota',
              'generatedAnswersOrJudgmentsRead': False, 'modelOutputsUsed': False,
              'candidateContextInspected': False}
    selection = flat.bind({'format': 'ablatrix-source-coverage-v2-selection-audit-v1',
        'selectionSeed': SEED, 'candidateFreezeFileSha256': freeze['fileSha256'],
        'protocolFileSha256': recipe['fileSha256'], 'exposureAuditSha256': exposure['auditSha256'],
        'inventory': summary, 'decisions': decisions, 'selectedSourceBindings': source_bindings(cases), **common,
        'generationPerformed': False, 'newProviderCalls': 0}, 'selectionAuditSha256')
    input_artifacts = {name: {'path': (destination / filename).relative_to(ROOT).as_posix(),
                              'fileSha256': legacy.sha(encoded(value))}
                       for name, filename, value in [('exposureAudit', 'exposure-audit.json', exposure),
                                                     ('selectionAudit', 'selection-audit.json', selection)]}
    deck = flat.bind({
        'format': 'ablatrix-source-coverage-v2-deck-v1', 'selectionProtocol': PROTOCOL,
        'selectionSeed': SEED, 'protocol': recipe, 'candidateFreeze': freeze,
        'source': {'url': legacy.URL, 'sha256': legacy.TRAIN_SHA, 'commit': legacy.COMMIT,
                   'license': 'CDLA-Sharing-1.0', 'testSplitUsed': False},
        'selection': common, 'inventory': summary, 'inputArtifacts': input_artifacts,
        'exposureAuditSha256': exposure['auditSha256'],
        'status': {'generationPerformed': False, 'candidateContextInspected': False,
                   'independentSourceReview': 'pending', 'paidExecutionAuthorized': False,
                   'qualityClaimEligible': False}, 'cases': cases}, 'deckSha256')
    # Keep the raw decision audit private. The deck contains the selected source
    # bodies and aggregate exclusions, without rejected source bodies or answers.
    if (candidate_freeze(args.candidate_freeze) != freeze or protocol(args.protocol, freeze) != recipe or
            coverage.inventory_inputs(args) != inventories or protected_inputs(args) != (protections, reviews) or
            flat.exposure(args, rows) != exposure):
        raise ValueError('Frozen code, recipe, source history or metadata changed during preparation.')
    destination.mkdir(parents=True, exist_ok=False)
    flat.write_new(destination / 'exposure-audit.json', exposure)
    flat.write_new(destination / 'selection-audit.json', selection)
    flat.write_new(destination / 'deck.json', deck)
    return {'screeningProducts': 12, 'sources': sum(len(case['sources']) for case in cases),
            'deckSha256': deck['deckSha256'], 'newProviderCalls': 0,
            'candidateContextInspected': False, 'paidExecutionAuthorized': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-deck', metavar='FILE', help='Verify a saved deck and raw-bound producer records without CSV, provider or outcome reads.')
    for flag in ('candidate-freeze', 'protocol', 'train', 'prepare-dir', 'consumed-cohort',
                 'consumed-source-review', 'consumed-execution-record', 'exposed-cohort',
                 'exposed-source-review', 'development-pool'):
        parser.add_argument('--' + flag)
    for flag in ('workspace-db', 'comparison-db', 'prior-cohort', 'prior-source-review'):
        parser.add_argument('--' + flag, action='append', default=[])
    try:
        args = parser.parse_args()
        if args.verify_deck:
            if any(value for key, value in vars(args).items() if key != 'verify_deck'):
                raise ValueError('Deck verification accepts only --verify-deck FILE.')
            result = verify_deck(args.verify_deck)
        else:
            missing = [key for key, value in vars(args).items()
                       if key not in {'verify_deck', 'workspace_db', 'comparison_db', 'prior_cohort', 'prior_source_review'} and not value]
            if missing:
                raise ValueError('Preparation requires every explicit input: ' + ', '.join(missing))
            result = prepare(args)
        print(json.dumps(result, indent=2))
    except (ValueError, KeyError, TypeError, OSError, sqlite3.Error) as error:
        parser.exit(1, f'Fresh v2 source selection stopped: {error}\n')


if __name__ == '__main__':
    main()
