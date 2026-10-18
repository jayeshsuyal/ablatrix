#!/usr/bin/env python3
"""Prepare a bounded source-only screening deck; never retrieve or generate."""
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
spec = importlib.util.spec_from_file_location('source_gap_coverage_rules', ROOT / COVERAGE_PATH)
coverage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(coverage)
base, flat, legacy = coverage.base, coverage.flat, coverage.legacy
SEED = 'ablatrix-source-gap-2026-10-18-v1'
PROTOCOL = 'baseline_source_gap_v1'
HELPERS = {COVERAGE_PATH: COVERAGE_SHA, **coverage.HELPERS}
QUOTAS = {'specification_gap': 3, 'model_detail_gap': 3, 'baseline_complete_control': 2}
FROZEN_FIELDS = {**coverage.FROZEN_FIELDS,
    'format': 'ablatrix-source-gap-candidate-freeze-v1', 'selectionSeed': SEED}
REQUIRED_CODE = coverage.REQUIRED_CODE | {
    'scripts/prepare-source-gap-deck.py', 'scripts/finalize-source-gap-cohort.py',
    'scripts/test_prepare_source_gap_cohort.py', 'scripts/source-gap-retrieval.ts',
}
PROTOCOL_FIELDS = {
    'format': 'ablatrix-source-gap-selection-protocol-v1', 'selectionProtocol': PROTOCOL,
    'selectionSeed': SEED, 'screeningProducts': 64, 'rounds': 8,
    'roundStrata': [{'name': name, 'count': count} for name, count in base.STRATA],
    'deckStrata': {name: count * 8 for name, count in base.STRATA}, 'quotas': QUOTAS,
    'candidateEligibilityUsed': False, 'modelOutputsUsed': False,
    'caseReplacement': False, 'finalBaselineRevalidationRequired': True,
    'maximumNewAnswerAttempts': 16,
}


def verify_helpers():
    if legacy.sha((ROOT / COVERAGE_PATH).read_bytes()) != COVERAGE_SHA:
        raise ValueError('Pinned retrieval selector changed.')
    coverage.verify_helpers()


def artifact(path):
    resolved = pathlib.Path(path).resolve(strict=True)
    if ROOT not in resolved.parents or not resolved.is_file():
        raise ValueError('Input artifacts must be existing repository files.')
    raw = resolved.read_bytes()
    return {'path': resolved.relative_to(ROOT).as_posix(),
            'fileSha256': legacy.sha(raw), 'document': json.loads(raw)}


def checked_seal(document, field, format_name):
    if document.get('format') != format_name or document.get(field) != flat.checksum(document, field):
        raise ValueError('Source-only artifact format or seal is invalid.')


def candidate_freeze(path):
    value = artifact(path)
    document = value['document']
    if (set(document) != set(FROZEN_FIELDS) | {'createdAt', 'implementationSha256'} or
            any(document.get(key) != expected for key, expected in FROZEN_FIELDS.items())):
        raise ValueError('Source-gap candidate freeze differs from the fixed protocol.')
    try:
        timestamp = datetime.datetime.fromisoformat(document['createdAt'].replace('Z', '+00:00'))
        if timestamp.tzinfo is None:
            raise ValueError('Timezone missing.')
    except (AttributeError, TypeError, ValueError):
        raise ValueError('Candidate freeze requires an ISO timestamp with timezone.') from None
    fingerprints = document['implementationSha256']
    if not isinstance(fingerprints, dict) or not REQUIRED_CODE <= set(fingerprints):
        raise ValueError('Source-gap candidate freeze lacks required implementation files.')
    for name, expected in fingerprints.items():
        coverage.require_digest(expected)
        relative = pathlib.PurePosixPath(name)
        if (not relative.parts or relative.is_absolute() or '..' in relative.parts or
                not (name == 'package-lock.json' or relative.parts[0] in {'server', 'scripts'})):
            raise ValueError('Candidate implementation must bind repository code only.')
        actual = (ROOT / name).resolve(strict=True)
        if ROOT not in actual.parents or legacy.sha(actual.read_bytes()) != expected:
            raise ValueError('Source-gap implementation changed after freezing.')
    verify_helpers()
    return value


def protocol(path, freeze):
    value = artifact(path)
    document = value['document']
    checked_seal(document, 'protocolSha256', PROTOCOL_FIELDS['format'])
    if (set(document) != set(PROTOCOL_FIELDS) | {'candidateFreezeFileSha256', 'protocolSha256'} or
            any(document.get(key) != expected for key, expected in PROTOCOL_FIELDS.items()) or
            document.get('candidateFreezeFileSha256') != freeze['fileSha256']):
        raise ValueError('Selection protocol must freeze the exact deck and quotas before source reads.')
    return value


def source_cases(document, count):
    """Validate literal source pools without admitting generated-output fields."""
    cases = document.get('cases', [])
    if len(cases) != count or len({case['id'] for case in cases}) != count:
        raise ValueError('Source packet has the wrong case denominator.')
    result = []
    for case in cases:
        product, sources = case['product'], case['sources']
        if (not flat.ASIN.fullmatch(product['id']) or not product['title'].strip() or
                not sources or len({source['id'] for source in sources}) != len(sources) or
                case['sourcePoolSha256'] != legacy.sha(legacy.compact(sources))):
            raise ValueError('Source packet product or source-pool identity is invalid.')
        for source in sources:
            if set(source) != {'id', 'label', 'text', 'originalQuestion', 'reference', 'sha256'}:
                raise ValueError('Only literal source fields may enter screening.')
            values = [source[key] for key in ('id', 'label', 'text', 'originalQuestion', 'reference')]
            if (not isinstance(source['text'], str) or not source['text'] or
                    source['sha256'] != legacy.sha(json.dumps(values, ensure_ascii=False, separators=(',', ':')))):
                raise ValueError('Source packet body binding is invalid.')
        result.append({'id': product['id'], 'title': product['title'],
                       'question': case['question'], 'sources': sources})
    if len({case['id'].upper() for case in result}) != count:
        raise ValueError('Source packet products must be distinct.')
    return result


def exposed_unexecuted(cohort_path, review_path):
    cohort, review = artifact(cohort_path), artifact(review_path)
    document, assessed = cohort['document'], review['document']
    checked_seal(document, 'cohortSha256', 'ablatrix-retrieval-coverage-cohort-v1')
    cases = source_cases(document, 8)
    if (document.get('status', {}).get('generationPerformed') is not False or
            assessed.get('status') != 'passed' or
            assessed.get('provenance') != 'independent_ai_source_and_family_review' or
            assessed.get('cohortFileSha256') != cohort['fileSha256'] or
            [row.get('caseId') for row in assessed.get('cases', [])] != [case['id'] for case in document['cases']] or
            any(row.get('sourceScopeReviewed') is not True or row.get('familySeparationReviewed') is not True
                for row in assessed['cases'])):
        raise ValueError('The natural cohort must remain an unexecuted packet with its passed source review.')
    projection = {
        'fileSha256': cohort['fileSha256'], 'cohortSha256': document['cohortSha256'],
        'sourceReviewFileSha256': review['fileSha256'], 'status': 'exposed_unexecuted_cohort',
        'generationPerformed': False, 'productIds': sorted(case['id'].upper() for case in cases),
        'canonicalFamilyTitles': sorted({flat.previous.title_family(case['title']) for case in cases}),
        'modelIdentifiers': sorted(set().union(*(flat.source_identifiers(case) for case in cases))),
        'sourcePacketFingerprints': sorted({base.source_packet_fingerprint(source)
                                          for case in cases for source in case['sources']}),
    }
    return {'cases': cases, 'projection': projection}


def prepare(args):
    freeze = candidate_freeze(args.candidate_freeze)
    selection_protocol = protocol(args.protocol, freeze)
    destination = pathlib.Path(args.prepare_dir).resolve()
    if destination.exists() or destination == ROOT / 'docs' or ROOT / 'docs' in destination.parents:
        raise ValueError('Preparation requires a new private directory; no overwrite or resume.')
    inventories = coverage.inventory_inputs(args)
    priors, reviews, consumed = coverage.protected_inputs(args)
    exposed = exposed_unexecuted(args.exposed_cohort, args.exposed_source_review)
    protected = [*priors, consumed, exposed]
    if len({case['id'].upper() for item in protected for case in item['cases']}) != 32:
        raise ValueError('Rejected, consumed and exposed-unexecuted protections must be distinct.')
    rows = flat.load_rows(args.train)
    args.exposure_audit = None
    exposure = flat.exposure(args, rows)
    cases, rounds = [], []
    for number in range(1, 9):
        seed = f'{SEED}:round:{number}'
        selected, decisions, inventory = base.select(rows, exposure, protected,
                                                    seed=seed, case_prefix='source-gap-train')
        rounds.append({'round': number, 'seed': seed, 'caseIds': [case['id'] for case in selected],
                       'inventory': inventory, 'decisions': decisions})
        if not inventory['passed'] or len(selected) != 8:
            raise ValueError('The frozen 64-product deck is insufficient; stop without reseeding or replacement.')
        cases.extend({**case, 'deckRound': number} for case in selected)
        protected.append({'cases': [{'id': case['product']['id'], 'title': case['product']['title'],
                                     'question': case['question'], 'sources': case['sources']} for case in selected]})
    source_cases({'cases': cases}, 64)
    common = {
        'selectionCodeSha256': legacy.sha(pathlib.Path(__file__).read_bytes()),
        'immutableHelperSha256': HELPERS, 'priorCohorts': [item['projection'] for item in priors],
        'eligibilityAmendment': {**coverage.ELIGIBILITY, 'newExperimentSeed': SEED},
        'priorSourceReviews': reviews, 'consumedCohorts': [consumed['projection']],
        'exposedUnexecutedCohorts': [exposed['projection']], 'inventoryInputs': inventories,
        'generatedAnswersOrJudgmentsRead': False, 'modelOutputsUsed': False,
        'candidateContextInspected': False,
    }
    deck = flat.bind({
        'format': 'ablatrix-source-gap-deck-v1', 'selectionProtocol': PROTOCOL,
        'selectionSeed': SEED, 'protocolFileSha256': selection_protocol['fileSha256'],
        'candidateFreeze': freeze,
        'source': {'url': legacy.URL, 'sha256': legacy.TRAIN_SHA, 'commit': legacy.COMMIT,
                   'license': 'CDLA-Sharing-1.0', 'testSplitUsed': False},
        'selection': common, 'exposureAuditSha256': exposure['auditSha256'], 'rounds': rounds,
        'status': {'generationPerformed': False, 'paidExecutionAuthorized': False,
                   'qualityClaimEligible': False}, 'cases': cases}, 'deckSha256')
    # No publication or candidate-context assembly is performed here.
    if (candidate_freeze(args.candidate_freeze) != freeze or protocol(args.protocol, freeze) != selection_protocol or
            coverage.inventory_inputs(args) != inventories or
            coverage.protected_inputs(args) != (priors, reviews, consumed) or
            exposed_unexecuted(args.exposed_cohort, args.exposed_source_review) != exposed):
        raise ValueError('Frozen code, protocol or source protections changed while preparing.')
    destination.mkdir(parents=True, exist_ok=False)
    flat.write_new(destination / 'exposure-audit.json', exposure)
    flat.write_new(destination / 'deck.json', deck)
    return {'screeningProducts': 64, 'newProviderCalls': 0, 'candidateContextInspected': False,
            'deckSha256': deck['deckSha256'], 'paidExecutionAuthorized': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ('candidate-freeze', 'protocol', 'train', 'prepare-dir', 'consumed-cohort',
                 'consumed-source-review', 'consumed-execution-record', 'exposed-cohort', 'exposed-source-review'):
        parser.add_argument('--' + flag, required=True)
    for flag in ('workspace-db', 'comparison-db', 'prior-cohort', 'prior-source-review'):
        parser.add_argument('--' + flag, action='append', default=[])
    try:
        print(json.dumps(prepare(parser.parse_args()), indent=2))
    except (ValueError, KeyError, TypeError, OSError, sqlite3.Error) as error:
        parser.exit(1, f'Source-gap screening stopped: {error}\n')


if __name__ == '__main__':
    main()
